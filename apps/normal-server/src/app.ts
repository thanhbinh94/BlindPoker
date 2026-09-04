/**
 * The Normal server, assembled.
 *
 * `main.ts` reads the environment and opens the database; everything after that is here, and
 * everything here is testable against PGlite without a socket or a signal. The order the pieces are
 * built in is the interesting part, and three steps of it are load-bearing:
 *
 * 1. **The item catalogue is seeded before any service starts.** The daily draw and every
 *    achievement reward name a row in `items` by foreign key; seeding at boot is what makes a fresh
 *    database — or one whose catalogue has grown since the last deploy — correct on the first claim
 *    rather than on the next migration.
 * 2. **`stats.start()` subscribes before `achievements.start()`.** The bus runs subscribers in
 *    subscription order and waits for each, so an achievement is evaluated against counters that are
 *    already written. Reversed, every threshold would be one hand behind.
 * 3. **The achievements' reward items are what the daily draw may not hand out.** They are read from
 *    the loaded definitions rather than listed again here, so `achievements.json` stays the only
 *    place a promised item id is written down.
 *
 * The WebSocket is authenticated at the upgrade, from the same session cookie the REST routes use:
 * `resolver.fromUpgrade` is handed the raw `IncomingMessage`, so there is no second credential, no
 * token in a query string, and no window in which a socket is open but unidentified. A request with
 * no cookie — or one naming a session that has expired — resolves to `null`, and the gateway refuses
 * the upgrade with a plain `401` before a WebSocket ever exists.
 */
import { existsSync, readFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { isAbsolute, join, resolve } from 'node:path'
import type { Duplex } from 'node:stream'
import {
  assetSourceFromDir,
  DEFAULT_CSP,
  DEFAULT_RESERVED,
  registerCsrfGuard,
  registerErrorHandler,
  registerSecurityHeaders,
  registerStaticRoute,
  registerTolerantJsonParser,
  type AssetSource,
} from '@bp/http-kit'
import {
  createGameServer,
  type GameServer,
  type GatewayOptions,
  type Logger,
  type RoomOptions,
} from '@bp/server-kit'
import fastifyCookie from '@fastify/cookie'
import Fastify, { type FastifyInstance } from 'fastify'
import { createAchievementService, type AchievementService } from './achievements/achievement-service.js'
import { loadAchievements, type AchievementDef } from './achievements/definitions.js'
import { createAuthService, type AuthService } from './auth/auth-service.js'
import { readSessionCookie } from './auth/cookie.js'
import type { Argon2Params } from './auth/password.js'
import { createSessionService, type SessionService } from './auth/session-service.js'
import type { NormalConfig } from './config.js'
import type { AppDb } from './db/client.js'
import { packageRoot } from './db/migrate.js'
import { createEconomyService, type EconomyService } from './economy/economy-service.js'
import { createEventBus, type AppEventBus } from './events.js'
import { createHistoryService, type HistoryService } from './history/history-service.js'
import { createInventoryService, type InventoryService } from './inventory/inventory-service.js'
import { loadItemCatalog, type ItemCatalog } from './inventory/items.js'
import { WS_PATH } from './http/routes-catalog.js'
import { registerRoutes } from './http/routes.js'
import { createRepositories, type NormalRepositories } from './repos/index.js'
import { createStatsService, type StatsService } from './stats/stats-service.js'

/** A request body larger than this is a mistake or an attack: the largest thing this API accepts is an avatar. */
const BODY_LIMIT_BYTES = 16 * 1024

/**
 * The Normal edition's CSP: the default, plus the two hosts Google Fonts needs.
 *
 * Derived from `DEFAULT_CSP` rather than written out again, so a directive added there — or
 * tightened — reaches this edition without anyone remembering to copy it. `normal-web` (Plan 6)
 * loads its display face from `fonts.googleapis.com`, which then fetches the font files themselves
 * from `fonts.gstatic.com`; a stylesheet host alone would load a CSS file that could not fetch
 * anything.
 */
export const FONTS_STYLESHEET_HOST = 'https://fonts.googleapis.com'
export const FONTS_FILE_HOST = 'https://fonts.gstatic.com'

export function normalCsp(base: string = DEFAULT_CSP): string {
  const directives = base.split('; ').map((d) => (d.startsWith('style-src ') ? `${d} ${FONTS_STYLESHEET_HOST}` : d))
  if (!directives.some((d) => d.startsWith('font-src '))) directives.push(`font-src 'self' ${FONTS_FILE_HOST}`)
  return directives.join('; ')
}

export interface AppDeps {
  config: NormalConfig
  db: AppDb
  /** Closes the pool. Called last, after the rooms have settled and the listener is shut. */
  closeDb(): Promise<void>
  /** Backs `/health`; `false` is a 503, not a throw. */
  pingDb(): Promise<boolean>
  log: Logger
  now?: () => number
  /**
   * The UI bundle. Omitted, it is read from `config.publicDir` — `null` there (or a directory that
   * is not present) is an API-only deployment, which is a warning rather than a failure: the server
   * is still useful to a client served from somewhere else.
   */
  assets?: AssetSource | null
  /** Test hooks. Production passes none of these and gets the configured values. */
  roomOptions?: Partial<RoomOptions>
  gatewayOptions?: Partial<GatewayOptions>
  /** Lowered by tests so a suite of registrations is not an argon2 benchmark. */
  argon2Params?: Argon2Params
  /** Injectable so a test can pin which unowned item the daily draw lands on. */
  rng?: () => number
  /** Lowered by tests that need to reach a limit without sending sixty real requests. */
  writeRateLimit?: { limit: number; windowMs: number }
  readRateLimit?: { limit: number; windowMs: number }
}

/** Everything `buildApp` constructed, for tests and for anything Task 7 mounts beside it. */
export interface AppServices {
  bus: AppEventBus
  catalog: ItemCatalog
  defs: AchievementDef[]
  repos: NormalRepositories
  sessions: SessionService
  auth: AuthService
  inventory: InventoryService
  stats: StatsService
  achievements: AchievementService
  economy: EconomyService
  history: HistoryService
}

export interface NormalApp {
  fastify: FastifyInstance
  game: GameServer
  services: AppServices
  /** Drains rooms, closes the listener, unsubscribes the services and closes the database. Idempotent. */
  close(): Promise<void>
}

/** This package's version, for `/health`. Read once: the file cannot change under a running process. */
function packageVersion(): string {
  try {
    return (JSON.parse(readFileSync(join(packageRoot(), 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function loadAssets(config: NormalConfig, log: Logger): AssetSource | null {
  if (config.publicDir === null) {
    log.info('no PUBLIC_DIR configured — the API is up but there is no UI to serve')
    return null
  }
  const dir = isAbsolute(config.publicDir) ? config.publicDir : resolve(process.cwd(), config.publicDir)
  if (!existsSync(dir)) {
    log.warn('PUBLIC_DIR does not exist — the API is up but there is no UI to serve', { dir })
    return null
  }
  return assetSourceFromDir(dir)
}

export async function buildApp(deps: AppDeps): Promise<NormalApp> {
  const { config, db, log } = deps

  const bus = createEventBus(log)
  const catalog = loadItemCatalog()
  const defs = loadAchievements(catalog)
  // Before anything reads or grants an item: every reward is a foreign key into this table.
  await catalog.seed(db)

  const repos = createRepositories(db)
  const sessions = createSessionService(db, { secret: config.sessionSecret, ...(deps.now ? { now: deps.now } : {}) })
  const auth = createAuthService({
    db,
    repos,
    sessions,
    catalog,
    // A hook rather than a bus dependency inside the auth service: signing in is a fact the
    // progression layer subscribes to, not something authentication has to know about.
    onLogin: (playerId, at) => void bus.publish({ type: 'LOGIN', playerId, at }),
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.argon2Params ? { argon2Params: deps.argon2Params } : {}),
  })

  const game = createGameServer({
    repos,
    resolver: {
      // The same cookie the REST routes read, off the raw upgrade request. No `fromToken`, so a
      // socket that arrives without a valid session is refused at the upgrade rather than being
      // accepted and left waiting for a `HELLO` it can never satisfy.
      fromUpgrade: async (req: IncomingMessage) => {
        const token = readSessionCookie(req)
        return token === null ? null : auth.identityForToken(token)
      },
    },
    log,
    roomOptions: { reconnectWindowMs: config.reconnectWindowSec * 1000, ...deps.roomOptions },
    gatewayOptions: { allowedOrigins: config.allowedOrigins, ...deps.gatewayOptions },
    onDomainEvent: (event) => void bus.publish(event),
  })

  const inventory = createInventoryService(db)
  const stats = createStatsService({ db, bus })
  const economy = createEconomyService({
    db,
    repos,
    inventory,
    catalog,
    bus,
    timezone: config.timezone,
    // Points credited outside a hand still have to reach a live session — and a Blind seat mirrors
    // the balance, so this goes through the game server rather than straight to the socket.
    onBalanceChanged: (playerId) => void game.balanceChanged(playerId),
    // Everything an achievement has promised is off the random draw's table.
    reservedItemIds: defs.flatMap((def) => (def.reward.itemId === undefined ? [] : [def.reward.itemId])),
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.rng ? { rng: deps.rng } : {}),
  })
  const achievements = createAchievementService({
    db,
    repos,
    inventory,
    stats,
    bus,
    defs,
    log,
    notify: (playerId, msg) => game.notify(playerId, msg),
    onBalanceChanged: (playerId) => void game.balanceChanged(playerId),
    ...(deps.now ? { now: deps.now } : {}),
  })
  const history = createHistoryService({ db, repos })

  // Order matters: the counters must be written before the thresholds are compared against them.
  const unsubscribes = [stats.start(), achievements.start()]

  const fastify = Fastify({ logger: false, trustProxy: config.trustProxy, bodyLimit: BODY_LIMIT_BYTES })
  await fastify.register(fastifyCookie)
  // The shared plumbing, in the order a request meets it: headers first (so they are on error and
  // 404 responses too), then the CSRF guard, then the handler that turns everything — including what
  // those two throw — into the one `{ error: { code, message } }` envelope.
  registerTolerantJsonParser(fastify)
  registerSecurityHeaders(fastify, { csp: normalCsp() })
  registerCsrfGuard(fastify)
  registerErrorHandler(fastify, log)

  registerRoutes(fastify, {
    config,
    db,
    repos,
    auth,
    sessions,
    economy,
    stats,
    achievements,
    inventory,
    history,
    catalog,
    defs,
    log,
    version: packageVersion(),
    pingDb: deps.pingDb,
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.writeRateLimit ? { writeRateLimit: deps.writeRateLimit } : {}),
    ...(deps.readRateLimit ? { readRateLimit: deps.readRateLimit } : {}),
  })

  // Last: `/*` matches everything the routes above did not claim. The reserved list is exactly the
  // surface mounted here — `/api`, `/ws`, `/health` — which is `DEFAULT_RESERVED`.
  registerStaticRoute(fastify, deps.assets === undefined ? loadAssets(config, log) : deps.assets, { reserved: DEFAULT_RESERVED })

  /** Only `/ws` is a WebSocket endpoint; every other upgrade is refused rather than left half-open. */
  fastify.server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if ((req.url ?? '').split('?')[0] === WS_PATH) {
      game.handleUpgrade(req, socket, head)
      return
    }
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
    socket.destroy()
  })

  await fastify.ready()

  let closing: Promise<void> | null = null
  const close = (): Promise<void> => {
    // Draining the game first settles every live hand and closes the sockets, so `fastify.close()`
    // is not left waiting on connections that were upgraded out from under it; the subscriptions go
    // next, so nothing publishes into a closing world; the database stays open until the last write
    // has happened.
    closing ??= (async () => {
      await game.shutdown('server shutdown')
      await fastify.close()
      for (const off of unsubscribes) off()
      await deps.closeDb()
    })()
    return closing
  }

  log.debug('app built', { timezone: config.timezone, reconnectWindowSec: config.reconnectWindowSec, items: catalog.all().length, achievements: defs.length })

  return {
    fastify,
    game,
    services: { bus, catalog, defs, repos, sessions, auth, inventory, stats, achievements, economy, history },
    close,
  }
}
