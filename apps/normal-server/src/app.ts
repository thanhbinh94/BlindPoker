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
 *    place a promised item id is written down. The gift schedule's named items are kept off it too —
 *    the economy reads them from the schedule itself.
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
import type { ChaosCardDef } from '@bp/core'
import {
  assetSourceFromDir,
  createRateLimiter,
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
  type DomainEvent,
  type GameServer,
  type GatewayOptions,
  type Logger,
  type RoomOptions,
} from '@bp/server-kit'
import fastifyCookie from '@fastify/cookie'
import { lt } from 'drizzle-orm'
import Fastify, { type FastifyInstance } from 'fastify'
import { createAchievementService, type AchievementService } from './achievements/achievement-service.js'
import { loadAchievements, type AchievementDef } from './achievements/definitions.js'
import { createAuthService, type AuthService } from './auth/auth-service.js'
import { readSessionCookie } from './auth/cookie.js'
import { loadChaosCatalogue } from './chaos/chaos-catalogue.js'
import { createChaosPort } from './chaos/chaos-port.js'
import { createChaosService, type ChaosService } from './chaos/chaos-service.js'
import type { Argon2Params } from './auth/password.js'
import { createSessionService, type SessionService } from './auth/session-service.js'
import type { NormalConfig } from './config.js'
import type { AppDb } from './db/client.js'
import { packageRoot } from './db/migrate.js'
import { readDailyGiftsRaw } from './economy/daily-gifts.js'
import { createGiftScheduleStore, type GiftScheduleStore } from './economy/gift-schedule-store.js'
import { createEconomyService, type EconomyService } from './economy/economy-service.js'
import { createWelcomeService, type WelcomeService } from './economy/welcome-service.js'
import { createEventBus, type AppEventBus } from './events.js'
import { createGmRoomService, type GmRoomService } from './gm/gm-rooms.js'
import { createGmService, type GmService } from './gm/gm-service.js'
import { createHistoryService, type HistoryService } from './history/history-service.js'
import { loadAliases } from './inventory/aliases.js'
import { readAvatarConfig } from './inventory/avatar-migrate.js'
import { wearItemWithin } from './inventory/avatar.js'
import { loadBodies, type Bodies } from './inventory/bodies.js'
import { createInventoryService, type InventoryService } from './inventory/inventory-service.js'
import { loadItemCatalog, type ItemCatalog } from './inventory/items.js'
import { loadAvatarManifest, type AvatarManifest } from './inventory/manifest.js'
import { createOutfitsService, type OutfitsService } from './inventory/outfits-service.js'
import { WS_PATH } from './http/routes-catalog.js'
import { registerRoutes } from './http/routes.js'
import { createRepositories, pruneLedgerKeys, type NormalRepositories } from './repos/index.js'
import { createReputationService, seedDefaults as seedReputationDefaults, type ReputationService } from './reputation/reputation-service.js'
import { seedConfig as seedShopConfig, seedPrices as seedShopPrices } from './shop/shop-prices-seed.js'
import { createShopService, type ShopService } from './shop/shop-service.js'
import { sessions as sessionsTable } from './db/schema.js'
import { createStatsService, type StatsService } from './stats/stats-service.js'
import { createTrustedPeerCheck, upgradeAddress } from './trust-proxy.js'

/** A request body larger than this is a mistake or an attack: the largest thing this API accepts is an avatar. */
const BODY_LIMIT_BYTES = 16 * 1024

/** How long `close()` waits for the progression writes the drain set off. */
export const SHUTDOWN_DRAIN_MS = 5_000

/**
 * WebSocket upgrades one address may attempt in a minute.
 *
 * The upgrade was the one internet-facing entry point nothing metered: every refused one still cost
 * a `sessions` primary-key lookup on a pool of ten connections — the same pool `/health`, every hand
 * settlement and every claim waits on — so an unauthenticated flood turned into sustained database
 * work. Thirty a minute is far more than a person reloading a tab and far less than a flood, and the
 * verdict is reached *before* the session lookup, which is the whole point.
 */
export const UPGRADE_RATE_LIMIT = { limit: 30, windowMs: 60_000 }

/** How often expired `sessions` rows are swept. */
export const SESSION_SWEEP_INTERVAL_MS = 3_600_000

/**
 * The one alert an operator gets for a hand that was recorded but never paid.
 *
 * `HAND_SETTLED` is emitted with `cancelled: false` even when `balances.apply` threw — the room
 * flags the summary and carries on, deliberately, so the hand is still recorded for reconciliation.
 * That flag needs an alert as well as a column: for a Hold'em hand the write that was lost is the
 * `table_fee` sink row, so `Σ balances + Σ sinks` (§18.4) has silently drifted by the fee and
 * somebody has to put it right by hand. `docs/normal-server.md` has the query that finds them.
 *
 * The stats subscriber skips these hands entirely, so nothing else in the process will mention one.
 */
export function logSettlementFailure(log: Logger, event: DomainEvent): void {
  if (event.type !== 'HAND_SETTLED' || event.summary.settlementError === undefined) return
  log.error('hand settlement failed', {
    handId: event.summary.handId,
    roomId: event.summary.roomId,
    fee: event.summary.fee,
    err: event.summary.settlementError,
  })
}

/** `promise`, given up on after `budgetMs`. The timer is unref'd so waiting on it never holds the process open. */
async function withDeadline(promise: Promise<void>, budgetMs: number, onTimeout: () => void): Promise<void> {
  const expiry = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), budgetMs).unref())
  if ((await Promise.race([promise.then(() => 'done' as const), expiry])) === 'timeout') onTimeout()
}

/**
 * The Normal edition's CSP: the default, plus the two hosts Google Fonts needs, plus `blob:` images.
 *
 * Derived from `DEFAULT_CSP` rather than written out again, so a directive added there — or
 * tightened — reaches this edition without anyone remembering to copy it. `normal-web` (Plan 6)
 * loads its display face from `fonts.googleapis.com`, which then fetches the font files themselves
 * from `fonts.gstatic.com`; a stylesheet host alone would load a CSS file that could not fetch
 * anything.
 *
 * `img-src` gains `blob:` for the recoloured avatar layers (Plan 13): `ui-kit`'s `tinted.ts` paints a
 * layer on a canvas and hands the `<img>` an object URL for the result. Without it the browser refuses
 * every recoloured layer — a hair colour blanked the head, an eye colour changed nothing (No15, No16).
 * Only Normal recolours; Lite keeps `DEFAULT_CSP`.
 */
export const FONTS_STYLESHEET_HOST = 'https://fonts.googleapis.com'
export const FONTS_FILE_HOST = 'https://fonts.gstatic.com'
/**
 * Scripts stay `'self'`. Since Plan 11 the avatar is same-origin PNG layers (`docs/avatar-2d.md`) — no
 * WebAssembly, nothing `default-src 'self'` does not already allow on its own — and the recoloured layers
 * of Plan 13 are `blob:` *images* (`img-src` above), not scripts. This is written out anyway, `'self'` and
 * nothing more, so a directive added here later narrows a policy that already named `script-src` rather
 * than falling back to `default-src` silently.
 */
export const SCRIPT_SRC = "script-src 'self'"

export function normalCsp(base: string = DEFAULT_CSP): string {
  const directives = base.split('; ').map((d) => {
    if (d.startsWith('style-src ')) return `${d} ${FONTS_STYLESHEET_HOST}`
    if (d.startsWith('img-src ')) return `${d} blob:`
    return d
  })
  if (!directives.some((d) => d.startsWith('font-src '))) directives.push(`font-src 'self' ${FONTS_FILE_HOST}`)
  if (!directives.some((d) => d.startsWith('script-src '))) directives.push(SCRIPT_SRC)
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
  writeIpRateLimit?: { limit: number; windowMs: number }
  /** Lowered by tests so a handful of sockets can reach the upgrade limit. */
  upgradeRateLimit?: { limit: number; windowMs: number }
  /** Shortened by the sweep test; production runs `SESSION_SWEEP_INTERVAL_MS`. */
  sessionSweepIntervalMs?: number
  /** Test-only: mounts extra routes before `ready()` (the e2e entry's loopback promote). Production passes none. */
  extraRoutes?: (fastify: FastifyInstance) => void
  /**
   * Test-only (BP-41 A-ops): the chaos cards in place of `data/chaos-cards.json` — the ops pack's copy whose Cá chép starts at
   * 100 % energy, so a GM rule can force a Thần. Production passes none and reads the shipped file.
   */
  chaosCatalogue?: ChaosCardDef[]
}

/** Everything `buildApp` constructed, for tests and for anything Task 7 mounts beside it. */
export interface AppServices {
  bus: AppEventBus
  catalog: ItemCatalog
  defs: AchievementDef[]
  /** The check-in's gift schedule: `data/daily-gifts.json` checked at boot, with the months a GM has set over it. */
  gifts: GiftScheduleStore
  repos: NormalRepositories
  sessions: SessionService
  auth: AuthService
  inventory: InventoryService
  outfits: OutfitsService
  stats: StatsService
  achievements: AchievementService
  economy: EconomyService
  history: HistoryService
  /** What a GM may do to an account, and the façade over live rooms (Plan 25). */
  gm: GmService
  gmRooms: GmRoomService
  /** Plan 27: reputation and the rank it reaches (spec §2). */
  reputation: ReputationService
  /** Plan 27: catalogue cosmetics sold for points behind a rank (spec §3). */
  shop: ShopService
  /** Plan 27: the welcome gift — one of three rare items, worn at once, with the first reputation (spec §4 C1). */
  welcome: WelcomeService
  /** Plan 37: Poker hỗn loạn — the cards (`data/chaos-cards.json` and a GM's rules), the settings and the ledgered credit. */
  chaos: ChaosService
  /** Old wardrobe ids, kept readable — see `inventory/aliases.ts`. */
  aliases: ReadonlyMap<string, string>
  manifest: AvatarManifest
  /** The v4 bodies, one per gender (Plan 19) — see `inventory/bodies.ts`. */
  bodies: Bodies
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
  const manifest = loadAvatarManifest()
  // Since Plan 19 (avatar v4) a figure is a body per gender; the old base registry is gone (D1) — an old
  // account's base is history, fixed in `avatar-migrate.ts`.
  const bodies = loadBodies(undefined, manifest)
  const aliases = loadAliases()
  const catalog = loadItemCatalog(undefined, manifest)
  const defs = loadAchievements(catalog)
  // Checked against the catalogue it names, before anything is seeded: a bad schedule stops the boot here, with its
  // file and its problem in the message (spec 2026-10-12 §6). A month a GM set that no longer validates is warned about
  // and skipped instead (Plan 26): the file is the operator's, the rows are history.
  // Plan 37: the chaos cards, checked at boot like the other catalogues — a bad file stops it with the file named.
  const chaos = createChaosService({ db, catalogue: deps.chaosCatalogue ?? loadChaosCatalogue(), timezone: config.timezone, ...(deps.now ? { now: deps.now } : {}) })
  const gifts = await createGiftScheduleStore({ db, catalog, defaults: readDailyGiftsRaw(), timezone: config.timezone, log, ...(deps.now ? { now: deps.now } : {}) })
  // Before anything reads or grants an item: every reward is a foreign key into this table.
  await catalog.seed(db)
  // Plan 27: the reputation rules and ranks the migration seeds, put back where a row is missing (a test reset, a
  // hand-cleared table). Never overwrites a GM's edit.
  await seedReputationDefaults(db)
  // Plan 27: a price row for every catalogue item that has none (a fresh database, an item added to `items.json`), and
  // the welcome choices where the row is missing. Neither overwrites a GM's edit.
  const priced = await seedShopPrices(db, catalog, defs)
  if (priced > 0) log.info('shop prices seeded', { count: priced })
  await seedShopConfig(db)
  // Before any room exists: the keys a past process claimed can never be retried — its rooms went with it.
  const pruned = await pruneLedgerKeys(db)
  if (pruned > 0) log.info('ledger keys pruned', { count: pruned })

  const repos = createRepositories(db)
  const sessions = createSessionService(db, { secret: config.sessionSecret, ...(deps.now ? { now: deps.now } : {}) })
  // No `onLogin` hook is wired: a "login day" is the daily check-in (§10.3 ruling), so nothing in
  // this edition subscribes to a plain sign-in. The hook stays optional in the auth service for
  // whatever wants it later rather than publishing an event with no subscriber.
  const auth = createAuthService({
    db,
    repos,
    sessions,
    catalog,
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
    chaos: createChaosPort(chaos),
    roomOptions: { reconnectWindowMs: config.reconnectWindowSec * 1000, ...deps.roomOptions },
    gatewayOptions: { allowedOrigins: config.allowedOrigins, ...deps.gatewayOptions },
    // The one place every domain event passes through, and therefore the one place a hand that was
    // *recorded but never paid* is visible. See `logSettlementFailure`.
    onDomainEvent: (event) => {
      logSettlementFailure(log, event)
      void bus.publish(event)
    },
  })

  const inventory = createInventoryService(db, aliases, catalog.freeIds())
  // A saved outfit is read the way `players.avatar_config` is: repaired to v4 on the way out (spec §4.5, R6).
  const outfits = createOutfitsService(db, inventory, (stored) => readAvatarConfig(stored, catalog, aliases, bodies))
  const stats = createStatsService({ db, bus })
  // Before the services that pay it (economy, achievements, GM): each takes it as an optional dependency.
  const reputation = createReputationService({ db, bus, notify: (playerId, msg) => game.notify(playerId, msg), log, ...(deps.now ? { now: deps.now } : {}) })
  const economy = createEconomyService({
    db,
    repos,
    inventory,
    catalog,
    gifts: () => gifts.current(),
    bus,
    timezone: config.timezone,
    // Points credited outside a hand still have to reach a live session, so this goes through the game
    // server, which pushes `BALANCE` in order with the room's own pushes when the player is in a room.
    // Only the balance moves: a table stack, in either mode, is left alone.
    onBalanceChanged: (playerId) => void game.balanceChanged(playerId),
    // Everything an achievement has promised is off the random draw's table.
    reservedItemIds: defs.flatMap((def) => (def.reward.itemId === undefined ? [] : [def.reward.itemId])),
    reputation,
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
    reputation,
    ...(deps.now ? { now: deps.now } : {}),
  })
  const shop = createShopService({
    db,
    repos,
    inventory,
    catalog,
    defs,
    gifts,
    reputation,
    timezone: config.timezone,
    // As the economy's: a purchase moves only the balance, never a table stack.
    onBalanceChanged: (playerId) => void game.balanceChanged(playerId),
    ...(deps.now ? { now: deps.now } : {}),
  })
  const welcome = createWelcomeService({
    db,
    inventory,
    catalog,
    shop,
    reputation,
    avatars: { wearWithin: (tx, playerId, itemId) => wearItemWithin(tx, catalog, aliases, bodies, playerId, itemId) },
    timezone: config.timezone,
    ...(deps.now ? { now: deps.now } : {}),
  })
  const history = createHistoryService({ db, repos })
  const gm = createGmService({ db, repos, sessions, inventory, catalog, defs, history, stats, game, log, gifts, timezone: config.timezone, reputation, shop, chaos, ...(deps.now ? { now: deps.now } : {}) })
  const gmRooms = createGmRoomService(game)

  // Order matters: the counters must be written before the thresholds are compared against them. Reputation's
  // per-hand listener depends on neither, so it goes last.
  const unsubscribes = [stats.start(), achievements.start(), reputation.start()]

  // `config.trustProxy` is `false` or a spec string (`uniquelocal`, `10.0.0.0/8,192.168.1.7`, …),
  // never `true` — `loadConfig` refuses that. Fastify splits the string and compiles it with
  // `proxy-addr`; `trust-proxy.ts` compiles the same string for the upgrade path below.
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
    outfits,
    history,
    gm,
    gmRooms,
    reputation,
    shop,
    welcome,
    catalog,
    defs,
    aliases,
    manifest,
    bodies,
    log,
    game,
    version: packageVersion(),
    pingDb: deps.pingDb,
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.writeRateLimit ? { writeRateLimit: deps.writeRateLimit } : {}),
    ...(deps.readRateLimit ? { readRateLimit: deps.readRateLimit } : {}),
    ...(deps.writeIpRateLimit ? { writeIpRateLimit: deps.writeIpRateLimit } : {}),
  })

  deps.extraRoutes?.(fastify)

  // Last: `/*` matches everything the routes above did not claim. The reserved list is exactly the
  // surface mounted here — `/api`, `/ws`, `/health` — which is `DEFAULT_RESERVED`.
  registerStaticRoute(fastify, deps.assets === undefined ? loadAssets(config, log) : deps.assets, { reserved: DEFAULT_RESERVED })

  const isTrustedPeer = createTrustedPeerCheck(config.trustProxy)
  const upgradeLimiter = createRateLimiter({ ...(deps.upgradeRateLimit ?? UPGRADE_RATE_LIMIT), ...(deps.now ? { now: deps.now } : {}) })

  /** A refusal written straight to the socket: there is no `reply` here, and no WebSocket yet. */
  const refuseUpgrade = (socket: Duplex, status: string, retryAfterSec?: number): void => {
    const retry = retryAfterSec === undefined ? '' : `Retry-After: ${String(retryAfterSec)}\r\n`
    socket.write(`HTTP/1.1 ${status}\r\n${retry}Connection: close\r\n\r\n`)
    socket.destroy()
  }

  /**
   * Only `/ws` is a WebSocket endpoint; every other upgrade is refused rather than left half-open.
   *
   * Both guards run **before** `game.handleUpgrade`, which is what makes them worth anything: that
   * call is where `resolver.fromUpgrade` reads the cookie and asks the database for the session, so
   * a metered refusal here costs a string comparison while an unmetered one cost a query on the
   * pool every hand settlement is waiting for.
   *
   * The key is the forwarded address when the peer is a trusted proxy and the socket peer otherwise
   * — the same rule `req.ip` follows on the REST surface, so the two agree about who a caller is,
   * and so 1,000 players behind one Caddy are not one bucket of thirty.
   */
  fastify.server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if ((req.url ?? '').split('?')[0] !== WS_PATH) return refuseUpgrade(socket, '404 Not Found')

    const address = upgradeAddress(req, isTrustedPeer)
    const verdict = upgradeLimiter.check(`ws:${address}`)
    if (!verdict.allowed) {
      log.warn('websocket upgrade rate limited', { ip: address })
      return refuseUpgrade(socket, '429 Too Many Requests', verdict.retryAfterSec)
    }
    // §24 targets 1,000 concurrent connections; past that a signed-in caller opening sockets in a
    // loop would be spending everyone else's memory and heartbeat budget.
    if (game.connectionCount >= config.maxConnections) {
      log.warn('websocket upgrade refused: at capacity', { connections: game.connectionCount, max: config.maxConnections })
      return refuseUpgrade(socket, '503 Service Unavailable')
    }
    game.handleUpgrade(req, socket, head)
  })

  /**
   * Expired sessions, swept hourly.
   *
   * `session-service.ts` deletes a row when its token is presented after expiry — which never
   * happens for a player who does not come back, so their rows would sit in the table for the life
   * of the database. `sessions_expires_idx` exists; this is what uses it that way. Unref'd, so it
   * never holds the process open, and cleared in `close()`.
   */
  const sweepExpiredSessions = async (): Promise<void> => {
    try {
      await db.delete(sessionsTable).where(lt(sessionsTable.expiresAt, new Date((deps.now ?? Date.now)())))
    } catch (err) {
      log.warn('session sweep failed', { err: String(err) })
    }
  }
  const sweepTimer = setInterval(() => void sweepExpiredSessions(), deps.sessionSweepIntervalMs ?? SESSION_SWEEP_INTERVAL_MS)
  sweepTimer.unref()

  await fastify.ready()

  let closing: Promise<void> | null = null
  const close = (): Promise<void> => {
    /**
     * Draining the game first settles every live hand and closes the sockets, so `fastify.close()`
     * is not left waiting on connections that were upgraded out from under it; the subscriptions go
     * next, so nothing new is published into a closing world; the progression writes those sockets
     * already triggered are drained before the pool goes.
     *
     * Every step is best-effort. A rejected `game.shutdown()` (its 10 s budget covers a hang, not a
     * throw) or a rejected `fastify.close()` must not skip the ones after it — that would leave the
     * listener up and the pool open — and because this promise is memoized, a rejection here could
     * never be retried by a later caller. So each step logs and the sequence continues, and the memo
     * always resolves.
     */
    closing ??= (async () => {
      const step = async (what: string, fn: () => Promise<void>): Promise<void> => {
        try {
          await fn()
        } catch (err) {
          log.error('shutdown step failed', { step: what, err: String(err) })
        }
      }
      clearInterval(sweepTimer)
      await step('game', () => game.shutdown('server shutdown'))
      await step('fastify', () => fastify.close())
      for (const off of unsubscribes) off()
      // Bounded: a subscriber that never settles must not hold a deploy open, and losing the last
      // counter is better than a container that will not stop.
      await step('events', () => withDeadline(bus.idle(), SHUTDOWN_DRAIN_MS, () => log.warn('progression writes still in flight at shutdown', { budgetMs: SHUTDOWN_DRAIN_MS })))
      await step('db', () => deps.closeDb())
    })()
    return closing
  }

  log.debug('app built', { timezone: config.timezone, reconnectWindowSec: config.reconnectWindowSec, items: catalog.all().length, achievements: defs.length })

  return {
    fastify,
    game,
    services: { bus, catalog, defs, gifts, repos, sessions, auth, inventory, outfits, stats, achievements, economy, history, gm, gmRooms, reputation, shop, welcome, chaos, aliases, manifest, bodies },
    close,
  }
}
