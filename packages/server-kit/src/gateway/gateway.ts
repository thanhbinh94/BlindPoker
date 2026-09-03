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
}

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
  private readonly unsubscribeList: () => void
  readonly outbox: Outbox

  constructor(private readonly deps: GatewayDeps) {
    this.wss = new WebSocketServer({ noServer: true, maxPayload: deps.options.maxPayloadBytes })
    this.outbox = { send: (playerId, msg) => this.bound.get(playerId)?.send(msg) }
    this.unsubscribeList = deps.rooms.onListChanged(() => this.broadcastRoomList())
    this.scheduleHeartbeat()
  }

  get connectionCount(): number {
    return this.all.size
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!this.originAllowed(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }
    void (async () => {
      let identity: PlayerIdentity | null = null
      try {
        identity = this.deps.resolver.fromUpgrade ? await this.deps.resolver.fromUpgrade(req) : null
      } catch (err) {
        this.deps.log.warn('fromUpgrade failed', { err: String(err) })
      }
      if (!identity && !this.deps.resolver.fromToken) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, identity))
    })()
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
  }

  // ---------- connection lifecycle ----------

  private onConnection(ws: WebSocket, identity: PlayerIdentity | null): void {
    const conn = new ClientConnection(newId(), ws, new TokenBucket(this.deps.options.rateLimitBurst, this.deps.options.rateLimitPerSec, this.deps.clock), this.deps.clock.now())
    this.all.add(conn)
    ws.on('message', (data) => this.onMessage(conn, data))
    ws.on('close', () => this.onClose(conn))
    ws.on('error', (err) => this.deps.log.warn('socket error', { conn: conn.id, err: String(err) }))
    if (identity) this.guard(conn.enqueue(() => this.bind(conn, identity)), 'bind', { playerId: identity.playerId })
    else conn.helloTimer = this.deps.clock.setTimeout(() => { if (!conn.identity) conn.close(4001, 'HELLO timeout') }, this.deps.options.helloTimeoutMs)
  }

  private async bind(conn: ClientConnection, identity: PlayerIdentity): Promise<void> {
    conn.helloTimer?.cancel()
    conn.helloTimer = null
    conn.identity = identity
    const old = this.bound.get(identity.playerId)
    if (old && old !== conn) {
      old.replaced = true
      old.send({ t: 'SESSION_REPLACED' })
      old.close(4000, 'replaced')
      this.all.delete(old)
    }
    this.bound.set(identity.playerId, conn)
    let balance = 0
    try {
      balance = await this.deps.repos.balances.get(identity.playerId)
    } catch (err) {
      this.deps.log.warn('balance lookup failed at bind', { playerId: identity.playerId, err: String(err) })
    }
    conn.send({ t: 'WELCOME', playerId: identity.playerId, displayName: identity.displayName, balance, serverTime: this.deps.clock.now() })
    const room = this.deps.rooms.roomOf(identity.playerId)
    if (room) {
      try {
        await room.onReconnect(identity.playerId)
        conn.send(room.snapshot(identity.playerId))
      } catch (err) {
        this.deps.log.error('onReconnect failed', { playerId: identity.playerId, err: String(err) })
      }
    }
  }

  private onClose(conn: ClientConnection): void {
    conn.helloTimer?.cancel()
    this.all.delete(conn)
    const playerId = conn.identity?.playerId
    if (!playerId || conn.replaced || this.bound.get(playerId) !== conn) return
    this.bound.delete(playerId)
    const room = this.deps.rooms.roomOf(playerId)
    if (room) this.guard(room.onDisconnect(playerId), 'onDisconnect', { playerId })
  }

  // ---------- messages ----------

  private onMessage(conn: ClientConnection, data: unknown): void {
    if (!conn.tryTake()) {
      conn.send({ t: 'ERROR', code: 'RATE_LIMITED', message: 'too many messages' })
      return
    }
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
    conn.invalidMessages += 1
    conn.send(reqId === undefined ? { t: 'ERROR', code, message } : { t: 'ERROR', reqId, code, message })
    if (conn.invalidMessages >= this.deps.options.maxInvalidMessages) conn.close(4002, 'too many invalid messages')
  }

  private async dispatch(conn: ClientConnection, msg: ClientMessage): Promise<void> {
    const reqId = msg.reqId
    const ack = () => { if (reqId !== undefined) conn.send({ t: 'ACK', reqId }) }
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
      if (reqId !== undefined && conn.seenReqId(reqId)) return ack()
      const playerId = identity.playerId
      switch (msg.t) {
        case 'LIST_ROOMS':
          conn.inLobby = true
          conn.send({ t: 'ROOM_LIST', rooms: this.deps.rooms.listPublic() })
          break
        case 'CREATE_ROOM': {
          if (this.deps.rooms.roomOf(playerId)) throw new RoomError('ALREADY_IN_ROOM')
          const room = this.deps.rooms.create(identity, msg.config)
          conn.inLobby = false
          conn.send(room.snapshot(playerId))
          break
        }
        case 'JOIN_ROOM': {
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
        conn.send(reqId === undefined ? { t: 'ERROR', code: err.code, message: err.message } : { t: 'ERROR', reqId, code: err.code, message: err.message })
        return
      }
      this.deps.log.error('dispatch failed', { conn: conn.id, type: msg.t, err: err instanceof Error ? err.stack ?? err.message : String(err) })
      conn.send(reqId === undefined ? { t: 'ERROR', code: 'INTERNAL', message: 'internal error' } : { t: 'ERROR', reqId, code: 'INTERNAL', message: 'internal error' })
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

  private broadcastRoomList(): void {
    const rooms = this.deps.rooms.listPublic()
    for (const conn of this.all) if (conn.inLobby && conn.identity) conn.send({ t: 'ROOM_LIST', rooms })
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
