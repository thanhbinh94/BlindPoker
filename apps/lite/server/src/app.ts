import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import {
  DEFAULT_RESERVED,
  registerCsrfGuard,
  registerErrorHandler,
  registerSecurityHeaders,
  registerStaticRoute,
  registerTolerantJsonParser,
  type AssetSource,
} from '@bp/http-kit'
import { createGameServer, type GameServer, type GatewayOptions, type Logger, type RoomOptions } from '@bp/server-kit'
import Fastify, { type FastifyInstance } from 'fastify'
import type { LiteConfig } from './config.js'
import { createEconomyService } from './economy/economy-service.js'
import { registerRoutes } from './http/routes.js'
import type { LiteRepositories } from './repos/sqlite-repos.js'
import { removeRunFile, writeRunFile } from './run-file.js'
import { createSessionService } from './session/session-service.js'

export interface LiteApp {
  fastify: FastifyInstance
  game: GameServer
  /** The run token this instance published; `POST /api/admin/shutdown` accepts nothing else. */
  readonly runToken: string
  /** True once a stop has begun, whether from a signal, `close()` or the admin endpoint. */
  readonly isClosing: boolean
  /** Binds the HTTP listener, attaches the WebSocket upgrade handler and writes the run file. Resolves to the bound address. */
  listen(): Promise<string>
  /** Removes the run file, drains rooms, closes sockets and the listener, then closes the database. Idempotent. */
  close(): Promise<void>
}

export interface BuildAppDeps {
  config: LiteConfig
  repos: LiteRepositories
  assets: AssetSource | null
  log: Logger
  now?: () => number
  roomOptions?: Partial<RoomOptions>
  gatewayOptions?: Partial<GatewayOptions>
  /** Absolute path of this instance's `bind-poker.run.json`. `null` (the default) writes none. */
  runFilePath?: string | null
  /** Lowered by tests that need to reach the general write limit without sending sixty real requests. */
  writeRateLimit?: { limit: number; windowMs: number }
}

/** A request body larger than this is a mistake or an attack: the largest thing Lite accepts is a display name. */
const BODY_LIMIT_BYTES = 16 * 1024
const WS_PATH = '/ws'

export function buildApp(deps: BuildAppDeps): LiteApp {
  const { config, repos, log } = deps
  const fastify = Fastify({ logger: false, trustProxy: false, bodyLimit: BODY_LIMIT_BYTES })
  const runFilePath = deps.runFilePath ?? null
  // Fresh per boot: this is a handle on *this* process, not a password to be remembered.
  const runToken = randomBytes(32).toString('hex')

  // The shared HTTP plumbing, in the order a request meets it. Headers first, so they are on error
  // and 404 responses too; the CSRF guard next; then the error handler that turns everything —
  // including what those two throw — into the one `{ error: { code, message } }` envelope.
  registerTolerantJsonParser(fastify)
  registerSecurityHeaders(fastify)
  registerCsrfGuard(fastify)
  registerErrorHandler(fastify, log)

  const sessions = createSessionService(repos)
  const game = createGameServer({
    repos,
    resolver: { fromToken: (token) => Promise.resolve(sessions.resolve(token)) },
    log,
    // `RECONNECT_WINDOW_SEC` is the one room parameter Lite exposes (spec §22.5); a test's
    // `roomOptions` still wins over it.
    roomOptions: { reconnectWindowMs: config.reconnectWindowSec * 1000, ...deps.roomOptions },
    gatewayOptions: { allowedOrigins: config.allowedOrigins, ...deps.gatewayOptions },
    onDomainEvent: (event) => log.debug('domain event', { type: event.type }),
  })

  const economy = createEconomyService({
    repos,
    timezone: config.timezone,
    ...(deps.now ? { now: deps.now } : {}),
    // Points credited outside a hand still have to reach a live session — through the game server
    // rather than straight to the socket, so the push lands in order with the room's own.
    onBalanceChanged: (playerId) => game.balanceChanged(playerId),
  })

  let closing: Promise<void> | null = null

  const closeApp = (): Promise<void> => {
    // Order matters: the run file goes first, because from here on this instance can no longer be
    // stopped — then draining the game settles every live hand and closes the sockets, so
    // `fastify.close()` is not left waiting on connections that were upgraded out from under it,
    // and the database stays open until the last repository write has happened.
    closing ??= (async () => {
      if (runFilePath) removeRunFile(runFilePath, { pid: process.pid, token: runToken })
      await game.shutdown('server shutdown')
      await fastify.close()
      repos.close()
    })()
    return closing
  }

  /**
   * The admin endpoint's exit: never awaited by the request that asked for it, because the drain
   * closes the listener that request is riding on. `closeApp` is memoized, so a second call — a
   * signal arriving at the same moment, the test harness's own `close()` — joins the first.
   */
  const requestShutdown = (): void => {
    setTimeout(() => {
      void closeApp().catch((err: unknown) => log.error('graceful shutdown failed', { err: String(err) }))
    }, 0)
  }

  registerRoutes(fastify, {
    repos,
    sessions,
    economy,
    game,
    config,
    log,
    admin: { token: runToken, requestShutdown },
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.writeRateLimit ? { writeRateLimit: deps.writeRateLimit } : {}),
  })

  // Last: `/*` matches everything the routes above did not claim. Lite mounts exactly the surface
  // `DEFAULT_RESERVED` names — `/api`, `/ws`, `/health` — so the default is the whole list.
  registerStaticRoute(fastify, deps.assets, { reserved: DEFAULT_RESERVED })

  /** Only `/ws` is a WebSocket endpoint; every other upgrade is refused rather than left half-open. */
  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const path = (req.url ?? '').split('?')[0]
    if (path === WS_PATH) {
      game.handleUpgrade(req, socket, head)
      return
    }
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
    socket.destroy()
  }

  let upgradeAttached = false

  return {
    fastify,
    game,
    runToken,

    get isClosing() {
      return closing !== null
    },

    async listen() {
      if (runFilePath) {
        // This instance owns the data directory, and no room exists before the listener binds: every key in
        // `ledger_keys` was claimed by a process that has ended, and its rooms went with it. A smoke run is given no
        // run file — it may share a live server's database — so it never gets here.
        const pruned = repos.pruneLedgerKeys()
        if (pruned > 0) log.info('ledger keys pruned', { count: pruned })
      }
      const address = await fastify.listen({ port: config.port, host: config.host })
      if (!upgradeAttached) {
        upgradeAttached = true
        fastify.server.on('upgrade', onUpgrade)
      }
      if (runFilePath) {
        // The bound port, not the configured one: `PORT=0` is a real deployment choice here, and a
        // run file naming port 0 would be useless to `--stop`.
        const bound = fastify.server.address()
        const port = typeof bound === 'object' && bound !== null ? (bound as AddressInfo).port : config.port
        writeRunFile(runFilePath, { pid: process.pid, port, host: config.host, token: runToken })
      }
      return address
    },

    close: closeApp,
  }
}
