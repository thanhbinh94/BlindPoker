import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { parseClientMessage, type ClientMessage, type ErrorCode, type PlayerIdentity, type ServerMessage } from '@bp/core'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Clock, TimerHandle } from '../infra/clock.js'
import { newId } from '../infra/ids.js'
import type { Logger } from '../infra/logger.js'
import type { Repositories, SessionResolver } from '../repositories.js'
import type { RoomManager } from '../room/room-manager.js'
import { RoomError, type Outbox } from '../room/types.js'
import { ClientConnection } from './connection.js'
import { TokenBucket } from './rate-limit.js'

export interface GatewayOptions {
  heartbeatIntervalMs: number
  heartbeatTimeoutMs: number
  rateLimitPerSec: number
  rateLimitBurst: number
  maxPayloadBytes: number
  helloTimeoutMs: number
  allowedOrigins: string[] | null
  maxInvalidMessages: number
  /** Room-list changes inside this window collapse into a single ROOM_LIST broadcast. */
  lobbyCoalesceMs: number
}

export const DEFAULT_GATEWAY_OPTIONS: GatewayOptions = {
  heartbeatIntervalMs: 15_000,
  heartbeatTimeoutMs: 30_000,
  rateLimitPerSec: 20,
  rateLimitBurst: 20,
  maxPayloadBytes: 4_096,
  helloTimeoutMs: 5_000,
  allowedOrigins: null,
  maxInvalidMessages: 3,
  lobbyCoalesceMs: 50,
}

/** Consecutive rate-limited messages that add up to one strike toward `maxInvalidMessages`. */
const RATE_LIMIT_STRIKE_EVERY = 5

export interface GatewayDeps {
  clock: Clock
  rooms: RoomManager
  resolver: SessionResolver
  repos: Repositories
  log: Logger
  options: GatewayOptions
}

export class Gateway {
  private readonly wss: WebSocketServer
  private readonly bound = new Map<string, ClientConnection>()
  private readonly all = new Set<ClientConnection>()
  private heartbeat: TimerHandle | null = null
  private lobbyTimer: TimerHandle | null = null
  private lobbyDirty = false
  private accepting = true
  private readonly unsubscribeList: () => void
  readonly outbox: Outbox

  constructor(private readonly deps: GatewayDeps) {
    this.wss = new WebSocketServer({ noServer: true, maxPayload: deps.options.maxPayloadBytes })
    this.outbox = { send: (playerId, msg) => this.bound.get(playerId)?.send(msg) }
    this.unsubscribeList = deps.rooms.onListChanged(() => this.scheduleRoomListBroadcast())
    this.scheduleHeartbeat()
  }

  get connectionCount(): number {
    return this.all.size
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!this.accepting) return this.refuseUpgrade(socket)
    if (!this.originAllowed(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }
    void (async () => {
      let identity: PlayerIdentity | null = null
      try {
        // A slow session store must not pin a half-open socket forever: bound it by helloTimeoutMs.
        identity = this.deps.resolver.fromUpgrade ? await this.withTimeout(this.deps.resolver.fromUpgrade(req), 'fromUpgrade') : null
      } catch (err) {
        this.deps.log.warn('fromUpgrade failed', { err: String(err) })
      }
      if (!identity && !this.deps.resolver.fromToken) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
      if (!this.accepting) return this.refuseUpgrade(socket)
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, identity))
    })()
  }

  /** Phase 1 of a two-phase shutdown: refuse new sockets, new rooms and new joins while live rooms drain. */
  stopAccepting(): void {
    this.accepting = false
  }

  get isAccepting(): boolean {
    return this.accepting
  }

  private refuseUpgrade(socket: Duplex): void {
    socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n')
    socket.destroy()
  }

  private withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = this.deps.clock.setTimeout(() => reject(new Error(what + ' timed out')), this.deps.options.helloTimeoutMs)
      p.then(
        (v) => { timer.cancel(); resolve(v) },
        (err: unknown) => { timer.cancel(); reject(err instanceof Error ? err : new Error(String(err))) },
      )
    })
  }

  async closeAll(code: number, reason: string, message?: ServerMessage): Promise<void> {
    for (const conn of this.all) {
      if (message) conn.send(message)
      conn.close(code, reason)
    }
    this.dispose()
    await new Promise<void>((resolve) => this.wss.close(() => resolve()))
  }

  dispose(): void {
    this.heartbeat?.cancel()
    this.heartbeat = null
    this.unsubscribeList()
    this.lobbyTimer?.cancel()
    this.lobbyTimer = null
    this.all.clear()
    this.bound.clear()
  }

  // ---------- connection lifecycle ----------

  private onConnection(ws: WebSocket, identity: PlayerIdentity | null): void {
    const conn = new ClientConnection(newId(), ws, new TokenBucket(this.deps.options.rateLimitBurst, this.deps.options.rateLimitPerSec, this.deps.clock), this.deps.clock.now())
    this.all.add(conn)
    ws.on('message', (data) => this.onMessage(conn, data))
    ws.on('close', () => void conn.enqueue(() => this.closeConnection(conn)))
    ws.on('error', (err) => this.deps.log.warn('socket error', { conn: conn.id, err: String(err) }))
    if (identity) this.guard(conn.enqueue(() => this.bind(conn, identity)), 'bind', { playerId: identity.playerId })
    else conn.helloTimer = this.deps.clock.setTimeout(() => { if (!conn.identity) conn.close(4001, 'HELLO timeout') }, this.deps.options.helloTimeoutMs)
  }

  /**
   * Attaches an identity to a socket. Every step after an `await` re-checks that this connection is
   * still the live one for the player: a socket that dies (or is replaced) mid-bind must not leave
   * the player marked connected in their room, and its close path must still run.
   *
   * Frame order is part of the contract: `WELCOME` first, then `ROOM_SNAPSHOT`. The connection is
   * published in `bound` — and so becomes reachable by the outbox — only once `WELCOME` has gone out.
   */
  private async bind(conn: ClientConnection, identity: PlayerIdentity): Promise<void> {
    conn.helloTimer?.cancel()
    conn.helloTimer = null
    conn.identity = identity
    const playerId = identity.playerId
    // 1. this connection replaces any older one for the same player
    const old = this.bound.get(playerId)
    if (old && old !== conn) {
      old.replaced = true
      old.send({ t: 'SESSION_REPLACED' })
      old.close(4000, 'replaced')
      this.all.delete(old)
      this.bound.delete(playerId)
    }
    let balance = 0
    try {
      balance = await this.deps.repos.balances.get(playerId)
    } catch (err) {
      this.deps.log.warn('balance lookup failed at bind', { playerId, err: String(err) })
    }
    if (this.abandoned(conn, playerId)) return
    // 2. WELCOME, then 3. publish the connection
    conn.send({ t: 'WELCOME', playerId, displayName: identity.displayName, balance, serverTime: this.deps.clock.now() })
    this.bound.set(playerId, conn)
    // 4. rejoin whatever room the player is still in
    const room = this.deps.rooms.roomOf(playerId)
    if (!room) return
    try {
      await room.onReconnect(playerId)
      if (this.abandoned(conn, playerId)) return
      conn.send(room.snapshot(playerId))
    } catch (err) {
      this.deps.log.error('resync failed at bind', { playerId, err: String(err) })
      conn.send({ t: 'ERROR', code: 'INTERNAL', message: 'resync required' })
    }
  }

  /** True when `conn` is no longer the live connection for `playerId`; runs the close path once if it has not run. */
  private abandoned(conn: ClientConnection, playerId: string): boolean {
    const bound = this.bound.get(playerId)
    if (conn.isOpen && !conn.replaced && (bound === undefined || bound === conn)) return false
    this.closeConnection(conn)
    return true
  }

  /** Idempotent close path: reached from the socket's `close` event (via the connection queue) and from an abandoned bind. */
  private closeConnection(conn: ClientConnection): void {
    conn.helloTimer?.cancel()
    if (conn.closeHandled) return
    conn.closeHandled = true
    this.all.delete(conn)
    const playerId = conn.identity?.playerId
    if (!playerId || conn.replaced) return
    const bound = this.bound.get(playerId)
    if (bound !== undefined && bound !== conn) return // a newer connection already owns this player
    this.bound.delete(playerId)
    const room = this.deps.rooms.roomOf(playerId)
    if (room) this.guard(room.onDisconnect(playerId), 'onDisconnect', { playerId })
  }

  // ---------- messages ----------

  private onMessage(conn: ClientConnection, data: unknown): void {
    if (!conn.tryTake()) {
      conn.rateLimitedStreak += 1
      conn.send({ t: 'ERROR', code: 'RATE_LIMITED', message: 'too many messages' })
      // A client that keeps hammering a closed bucket is flooding, not merely unlucky: every fifth
      // consecutive rejection costs one strike, so a sustained flood eventually closes the socket.
      if (conn.rateLimitedStreak % RATE_LIMIT_STRIKE_EVERY === 0) this.strike(conn)
      return
    }
    conn.rateLimitedStreak = 0
    let raw: unknown
    try {
      raw = JSON.parse(String(data))
    } catch {
      this.invalid(conn, undefined, 'INVALID_MESSAGE', 'invalid JSON')
      return
    }
    const parsed = parseClientMessage(raw)
    if (!parsed.ok) {
      const reqId = typeof (raw as { reqId?: unknown })?.reqId === 'string' ? (raw as { reqId: string }).reqId : undefined
      this.invalid(conn, reqId, parsed.code, parsed.message)
      return
    }
    void conn.enqueue(() => this.dispatch(conn, parsed.value))
  }

  private invalid(conn: ClientConnection, reqId: string | undefined, code: ErrorCode, message: string): void {
    conn.send(reqId === undefined ? { t: 'ERROR', code, message } : { t: 'ERROR', reqId, code, message })
    // Only unparseable frames count as abuse. A rejected room config (INVALID_ROOM_CONFIG) is a
    // well-formed request the server said no to, and must never cost a client its connection.
    if (code === 'INVALID_MESSAGE') this.strike(conn)
  }

  private strike(conn: ClientConnection): void {
    conn.invalidMessages += 1
    if (conn.invalidMessages >= this.deps.options.maxInvalidMessages) conn.close(4002, 'too many invalid messages')
  }

  private async dispatch(conn: ClientConnection, msg: ClientMessage): Promise<void> {
    const reqId = msg.reqId
    /** Sends a frame and, when the message carried a `reqId`, remembers it as that request's outcome. */
    const reply = (out: ServerMessage): void => {
      if (reqId !== undefined) conn.rememberReq(reqId, out)
      conn.send(out)
    }
    const ack = () => { if (reqId !== undefined) reply({ t: 'ACK', reqId }) }
    try {
      if (msg.t === 'HELLO') {
        if (conn.identity) return ack()
        const identity = this.deps.resolver.fromToken ? await this.deps.resolver.fromToken(msg.sessionToken) : null
        if (!identity) {
          conn.send({ t: 'ERROR', code: 'UNAUTHENTICATED', message: 'invalid session' })
          conn.close(4001, 'unauthenticated')
          return
        }
        await this.bind(conn, identity)
        return ack()
      }
      const identity = conn.identity
      if (!identity) {
        conn.send({ t: 'ERROR', code: 'UNAUTHENTICATED', message: 'send HELLO first' })
        return
      }
      if (msg.t === 'PONG') {
        conn.lastPongAt = this.deps.clock.now()
        return
      }
      if (reqId !== undefined) {
        // A retransmission replays the exact frame the first attempt produced: an ACK stays an ACK,
        // and a failure stays the same ERROR rather than being mistaken for success.
        const cached = conn.recallReq(reqId)
        if (cached !== undefined) {
          conn.send(cached)
          return
        }
      }
      const playerId = identity.playerId
      switch (msg.t) {
        case 'LIST_ROOMS':
          conn.inLobby = true
          conn.send({ t: 'ROOM_LIST', rooms: this.deps.rooms.listPublic() })
          break
        case 'CREATE_ROOM': {
          if (!this.accepting) throw new RoomError('SERVER_SHUTDOWN', 'server is shutting down')
          if (this.deps.rooms.roomOf(playerId)) throw new RoomError('ALREADY_IN_ROOM')
          const room = this.deps.rooms.create(identity, msg.config)
          conn.inLobby = false
          conn.send(room.snapshot(playerId))
          break
        }
        case 'JOIN_ROOM': {
          if (!this.accepting) throw new RoomError('SERVER_SHUTDOWN', 'server is shutting down')
          if (this.deps.rooms.roomOf(playerId)) throw new RoomError('ALREADY_IN_ROOM')
          const room = msg.roomId !== undefined ? this.deps.rooms.get(msg.roomId) : msg.code !== undefined ? this.deps.rooms.getByCode(msg.code) : undefined
          if (!room) throw new RoomError('ROOM_NOT_FOUND')
          await room.join(identity, msg.password)
          conn.inLobby = false
          conn.send(room.snapshot(playerId))
          break
        }
        case 'LEAVE_ROOM':
          await this.roomOf(playerId).leave(playerId)
          break
        case 'SIT_DOWN':
          await this.roomOf(playerId).sitDown(playerId, msg.seat, msg.buyIn)
          break
        case 'STAND_UP':
          await this.roomOf(playerId).standUp(playerId)
          break
        case 'READY':
          await this.roomOf(playerId).setReady(playerId, msg.ready)
          break
        case 'START_GAME':
          await this.roomOf(playerId).startGame(playerId)
          break
        case 'KICK':
          await this.roomOf(playerId).kick(playerId, msg.playerId)
          break
        case 'ACTION':
          await this.roomOf(playerId).action(playerId, msg.action, msg.baseSeq)
          break
        case 'RESYNC':
          conn.send(this.roomOf(playerId).snapshot(playerId))
          break
      }
      ack()
    } catch (err) {
      if (err instanceof RoomError) {
        reply(reqId === undefined ? { t: 'ERROR', code: err.code, message: err.message } : { t: 'ERROR', reqId, code: err.code, message: err.message })
        return
      }
      this.deps.log.error('dispatch failed', { conn: conn.id, type: msg.t, err: err instanceof Error ? err.stack ?? err.message : String(err) })
      reply(reqId === undefined ? { t: 'ERROR', code: 'INTERNAL', message: 'internal error' } : { t: 'ERROR', reqId, code: 'INTERNAL', message: 'internal error' })
    }
  }

  private roomOf(playerId: string) {
    const room = this.deps.rooms.roomOf(playerId)
    if (!room) throw new RoomError('NOT_IN_ROOM')
    return room
  }

  /** Fire-and-forget async work must never become an unhandled rejection. */
  private guard(p: Promise<unknown>, what: string, data?: object): void {
    p.catch((err) => this.deps.log.error(`${what} failed`, { ...data, err: String(err) }))
  }

  // ---------- lobby / heartbeat / origin ----------

  /**
   * A single seat change notifies the list twice (once for the room, once for the manager) and a
   * busy server changes rooms constantly, so broadcasts are coalesced into one frame per window and
   * the payload is serialized once for every lobby client instead of once per client.
   */
  private scheduleRoomListBroadcast(): void {
    this.lobbyDirty = true
    if (this.lobbyTimer) return
    this.lobbyTimer = this.deps.clock.setTimeout(() => {
      this.lobbyTimer = null
      if (!this.lobbyDirty) return
      this.lobbyDirty = false
      this.broadcastRoomList()
    }, this.deps.options.lobbyCoalesceMs)
  }

  private broadcastRoomList(): void {
    const lobby = [...this.all].filter((conn) => conn.inLobby && conn.identity !== null)
    if (lobby.length === 0) return
    const frame = JSON.stringify({ t: 'ROOM_LIST', rooms: this.deps.rooms.listPublic() } satisfies ServerMessage)
    for (const conn of lobby) conn.sendRaw(frame)
  }

  private scheduleHeartbeat(): void {
    this.heartbeat = this.deps.clock.setTimeout(() => {
      const now = this.deps.clock.now()
      for (const conn of this.all) {
        if (now - conn.lastPongAt > this.deps.options.heartbeatTimeoutMs) {
          this.deps.log.info('heartbeat timeout', { conn: conn.id, playerId: conn.identity?.playerId })
          conn.terminate()
        } else conn.send({ t: 'PING' })
      }
      this.scheduleHeartbeat()
    }, this.deps.options.heartbeatIntervalMs)
  }

  private originAllowed(req: IncomingMessage): boolean {
    const allowed = this.deps.options.allowedOrigins
    if (allowed === null) return true
    const origin = req.headers.origin
    return typeof origin === 'string' && allowed.includes(origin)
  }
}
