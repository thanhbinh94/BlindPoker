import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { createGameServer, type GameServer, type GatewayOptions, type Logger, type RoomOptions } from '@bp/server-kit'
import Fastify, { type FastifyInstance } from 'fastify'
import type { LiteConfig } from './config.js'
import { createEconomyService } from './economy/economy-service.js'
import type { AssetSource } from './http/assets.js'
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

  /**
   * Every mutating Lite route takes its input from headers or the URL, so a `POST` that announces
   * `application/json` and then sends nothing is a normal request — but Fastify's stock parser
   * answers an empty body with `FST_ERR_CTP_EMPTY_JSON_BODY` (400). Treat it as "no body" instead,
   * and keep the 400 for a body that is present but malformed.
   */
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body.trim() : ''
    if (text === '') return done(null, undefined)
    try {
      done(null, JSON.parse(text) as unknown)
    } catch (err) {
      const failure = err instanceof Error ? err : new Error(String(err))
      ;(failure as Error & { statusCode?: number }).statusCode = 400
      done(failure, undefined)
    }
  })

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
    // Points credited outside a hand still have to reach a live session — and a Blind seat mirrors
    // the balance, so this must go through the game server rather than straight to the socket.
    onBalanceChanged: (playerId) => game.balanceChanged(playerId),
  })

  let closing: Promise<void> | null = null

  const closeApp = (): Promise<void> => {
    // Order matters: the run file goes first, because from here on this instance can no longer be
    // stopped — then draining the game settles every live hand and closes the sockets, so
    // `fastify.close()` is not left waiting on connections that were upgraded out from under it,
    // and the database stays open until the last repository write has happened.
    closing ??= (async () => {
      if (runFilePath) removeRunFile(runFilePath)
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
    assets: deps.assets,
    admin: { token: runToken, requestShutdown },
    ...(deps.now ? { now: deps.now } : {}),
  })

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
