import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { createGameServer, type GameServer, type GatewayOptions, type Logger, type RoomOptions } from '@bp/server-kit'
import Fastify, { type FastifyInstance } from 'fastify'
import type { LiteConfig } from './config.js'
import { createEconomyService } from './economy/economy-service.js'
import type { AssetSource } from './http/assets.js'
import { registerRoutes } from './http/routes.js'
import type { LiteRepositories } from './repos/sqlite-repos.js'
import { createSessionService } from './session/session-service.js'

export interface LiteApp {
  fastify: FastifyInstance
  game: GameServer
  /** Binds the HTTP listener and attaches the WebSocket upgrade handler. Resolves to the bound address. */
  listen(): Promise<string>
  /** Drains rooms, closes sockets and the listener, then closes the database. Idempotent. */
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
}

/** A request body larger than this is a mistake or an attack: the largest thing Lite accepts is a display name. */
const BODY_LIMIT_BYTES = 16 * 1024
const WS_PATH = '/ws'

export function buildApp(deps: BuildAppDeps): LiteApp {
  const { config, repos, log } = deps
  const fastify = Fastify({ logger: false, trustProxy: false, bodyLimit: BODY_LIMIT_BYTES })

  const sessions = createSessionService(repos)
  const game = createGameServer({
    repos,
    resolver: { fromToken: (token) => Promise.resolve(sessions.resolve(token)) },
    log,
    ...(deps.roomOptions ? { roomOptions: deps.roomOptions } : {}),
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

  registerRoutes(fastify, {
    repos,
    sessions,
    economy,
    game,
    config,
    log,
    assets: deps.assets,
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
  let closing: Promise<void> | null = null

  return {
    fastify,
    game,

    async listen() {
      const address = await fastify.listen({ port: config.port, host: config.host })
      if (!upgradeAttached) {
        upgradeAttached = true
        fastify.server.on('upgrade', onUpgrade)
      }
      return address
    },

    close() {
      // Order matters: draining the game first settles every live hand and closes the sockets, so
      // `fastify.close()` is not left waiting on connections that were upgraded out from under it,
      // and the database stays open until the last repository write has happened.
      closing ??= (async () => {
        await game.shutdown('server shutdown')
        await fastify.close()
        repos.close()
      })()
      return closing
    },
  }
}
