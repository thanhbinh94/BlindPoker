import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { createBotStrategy, type BotStrategy, type Rng, type ServerMessage } from '@bp/core'
import type { DomainEvent } from './domain-events.js'
import { DEFAULT_GATEWAY_OPTIONS, Gateway, type GatewayOptions } from './gateway/gateway.js'
import { realClock, type Clock } from './infra/clock.js'
import { consoleLogger, type Logger } from './infra/logger.js'
import { cryptoRng } from './infra/rng.js'
import type { Repositories, SessionResolver } from './repositories.js'
import { RoomManager } from './room/room-manager.js'
import { DEFAULT_ROOM_OPTIONS, type RoomOptions } from './room/types.js'

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000

export interface GameServerOptions {
  repos: Repositories
  resolver: SessionResolver
  clock?: Clock
  rng?: Rng
  log?: Logger
  bot?: BotStrategy
  roomOptions?: Partial<RoomOptions>
  gatewayOptions?: Partial<GatewayOptions>
  onDomainEvent?: (e: DomainEvent) => void
  /** Upper bound on `shutdown()`; past it the remaining work is abandoned and a warning is logged. Default 10s. */
  shutdownTimeoutMs?: number
}

export interface GameServer {
  rooms: RoomManager
  gateway: Gateway
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
  /**
   * Pushes a message to a player's live session, if they have one. Editions use it for things
   * `server-kit` knows nothing about — daily rewards, friend requests, moderation notices.
   * Silently does nothing when the player is offline: it is a push, not a mailbox.
   */
  notify(playerId: string, msg: ServerMessage): void
  /**
   * Tells the server a player's balance changed outside a hand (a purchase, a reward, an admin
   * adjustment). Pushes `BALANCE` — through the room's queue when the player is in one, so it lands in
   * order with the room's own pushes. A table stack is never touched: since the table limit (spec
   * 2026-09-29) a seat in either mode plays from points it brought to the table.
   */
  balanceChanged(playerId: string): Promise<void>
  /**
   * Tells the server a player's display name changed outside the socket (a rename). Their live connection
   * takes the new name for every room they create or join from now on; a room they are already in keeps the
   * name its seat was given. See `Gateway.renameIdentity`.
   */
  renameIdentity(playerId: string, displayName: string): void
  shutdown(reason?: string): Promise<void>
  readonly connectionCount: number
}

export function createGameServer(options: GameServerOptions): GameServer {
  const clock = options.clock ?? realClock
  const log = options.log ?? consoleLogger
  let gateway: Gateway | null = null
  const rooms = new RoomManager({
    clock,
    rng: options.rng ?? cryptoRng,
    repos: options.repos,
    outbox: { send: (playerId, msg) => gateway?.outbox.send(playerId, msg) },
    bot: options.bot ?? createBotStrategy(),
    log,
    options: { ...DEFAULT_ROOM_OPTIONS, ...options.roomOptions },
    ...(options.onDomainEvent ? { onDomainEvent: options.onDomainEvent } : {}),
  })
  gateway = new Gateway({ clock, rooms, resolver: options.resolver, repos: options.repos, log, options: { ...DEFAULT_GATEWAY_OPTIONS, ...options.gatewayOptions } })
  const gw = gateway
  return {
    rooms,
    gateway: gw,
    handleUpgrade: (req, socket, head) => gw.handleUpgrade(req, socket, head),
    get connectionCount() {
      return gw.connectionCount
    },
    notify(playerId, msg) {
      gw.outbox.send(playerId, msg)
    },
    async balanceChanged(playerId) {
      const room = rooms.roomOf(playerId)
      if (room) return room.refreshBalance(playerId) // queued: lands in order with the room's own BALANCE pushes
      try {
        gw.outbox.send(playerId, { t: 'BALANCE', balance: await options.repos.balances.get(playerId) })
      } catch (err) {
        log.warn('balanceChanged lookup failed', { playerId, err: String(err) })
      }
    },
    renameIdentity(playerId, displayName) {
      gw.renameIdentity(playerId, displayName)
    },
    async shutdown(reason = 'server shutdown') {
      log.info('shutting down', { reason, rooms: rooms.size, connections: gw.connectionCount })
      // Two phases: stop accepting first, so nothing new enters while rooms settle their money,
      // then drain rooms, then close sockets. Time-boxed so a wedged repository cannot hang a deploy.
      gw.stopAccepting()
      const drain = (async () => {
        await rooms.shutdown(reason)
        await gw.closeAll(1001, reason, { t: 'ERROR', code: 'SERVER_SHUTDOWN', message: reason })
      })()
      const budget = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
      let expire: (v: 'timeout') => void = () => {}
      const expiry = new Promise<'timeout'>((resolve) => { expire = resolve })
      const timer = clock.setTimeout(() => expire('timeout'), budget)
      const outcome = await Promise.race([drain.then(() => 'done' as const), expiry])
      timer.cancel()
      if (outcome === 'timeout') {
        log.warn('shutdown timed out', { reason, budgetMs: budget, rooms: rooms.size, connections: gw.connectionCount })
        drain.catch((err: unknown) => log.error('shutdown failed after timing out', { err: String(err) }))
      }
    },
  }
}
