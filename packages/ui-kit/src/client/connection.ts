import type { ClientMessage, ServerMessage } from '@bp/core'
import type { ConnectionStatus } from './types.js'

export type { ConnectionStatus } from './types.js'

/** The slice of `WebSocket` this module needs, so tests can hand it a fake. */
export interface SocketLike {
  readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: (() => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code: number; reason: string }) => void) | null
  onerror: ((ev: unknown) => void) | null
}

export type SocketFactory = (url: string) => SocketLike
export type AckOrError = Extract<ServerMessage, { t: 'ACK' }> | Extract<ServerMessage, { t: 'ERROR' }>

export const DEFAULT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000]

export interface ConnectionOptions {
  url: string
  token?: string | null
  socketFactory?: SocketFactory
  onMessage(msg: ServerMessage): void
  onStatus(status: ConnectionStatus, reason?: string): void
  backoffMs?: number[]
  requestTimeoutMs?: number
  timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }
}

export interface Connection {
  connect(): void
  disconnect(): void
  send(msg: ClientMessage): boolean
  request(msg: ClientMessage): Promise<AckOrError>
  setToken(token: string | null): void
  readonly status: ConnectionStatus
}

const OPEN = 1

/** The server's close code for "this session token is not good" (docs/server-kit.md, wire contract). */
export const UNAUTHENTICATED_CLOSE = 4001

/**
 * One reconnecting WebSocket. It owns the socket lifecycle only: `HELLO` on open, `PONG` on `PING`, `reqId`
 * correlation for `request()`, and exponential backoff (1s → 30s) on an unexpected close. Everything it receives is
 * handed to `onMessage` verbatim — interpreting the protocol is the reducer's job.
 */
export function createConnection(opts: ConnectionOptions): Connection {
  const timers = opts.timers ?? {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>),
  }
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS
  const factory = opts.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as SocketLike)

  let socket: SocketLike | null = null
  let status: ConnectionStatus = 'idle'
  let token = opts.token ?? null
  let manualClose = false
  let attempt = 0
  /** Per socket: has a `WELCOME` come back on it yet? Both the backoff reset and `setToken` key off this. */
  let welcomed = false
  /** Per socket: the server refused this token. Retrying it would only be refused again. */
  let unauthenticated = false
  let reconnectTimer: unknown = null
  let reqCounter = 0
  const pending = new Map<string, { resolve: (m: AckOrError) => void; reject: (e: Error) => void; timer: unknown }>()

  const setStatus = (s: ConnectionStatus, reason?: string): void => {
    status = s
    if (reason === undefined) opts.onStatus(s)
    else opts.onStatus(s, reason)
  }
  const failPending = (why: string): void => {
    for (const [id, p] of pending) {
      timers.clearTimeout(p.timer as ReturnType<typeof setTimeout>)
      pending.delete(id)
      p.reject(new Error(why))
    }
  }

  const hello = (ws: SocketLike): void => {
    if (token === null) return
    ws.send(JSON.stringify({ t: 'HELLO', sessionToken: token } satisfies ClientMessage))
  }

  const open = (): void => {
    manualClose = false
    welcomed = false
    unauthenticated = false
    if (reconnectTimer !== null) {
      timers.clearTimeout(reconnectTimer as ReturnType<typeof setTimeout>)
      reconnectTimer = null
    }
    setStatus(attempt === 0 ? 'connecting' : 'reconnecting')
    const ws = factory(opts.url)
    socket = ws
    // Deliberately *not* where `attempt` resets. A server that accepts the TCP handshake and then drops the
    // session — the classic bad-gateway or overloaded-backend shape — would otherwise reset the backoff on every
    // attempt and leave the client hammering it once a second forever. Only a `WELCOME` proves the session works.
    ws.onopen = () => {
      setStatus('open')
      hello(ws)
    }
    ws.onmessage = (ev) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage
      } catch {
        return
      }
      if (msg.t === 'PING') {
        ws.send(JSON.stringify({ t: 'PONG' } satisfies ClientMessage))
        return
      }
      if (msg.t === 'WELCOME') {
        welcomed = true
        attempt = 0
      }
      // A refused token will be refused again: remember it so the close that follows is terminal.
      if (msg.t === 'ERROR' && msg.code === 'UNAUTHENTICATED') unauthenticated = true
      // A replaced session must not reconnect: the new connection owns the player now.
      if (msg.t === 'SESSION_REPLACED') manualClose = true
      if ((msg.t === 'ACK' || msg.t === 'ERROR') && msg.reqId !== undefined) {
        const p = pending.get(msg.reqId)
        if (p) {
          pending.delete(msg.reqId)
          timers.clearTimeout(p.timer as ReturnType<typeof setTimeout>)
          p.resolve(msg)
        }
      }
      opts.onMessage(msg)
    }
    ws.onerror = () => {
      /* `onclose` always follows; nothing to do here. */
    }
    ws.onclose = (ev) => {
      if (socket !== ws) return
      socket = null
      failPending('connection closed')
      if (manualClose) {
        setStatus('closed', ev.reason === '' ? undefined : ev.reason)
        return
      }
      // A rejected token is a terminal state, not a blip: reconnecting cannot fix it, and a client that keeps
      // trying looks to the server like an attack. The app is told why so it can send the player back to sign in.
      if (ev.code === UNAUTHENTICATED_CLOSE || unauthenticated) {
        setStatus('closed', 'unauthenticated')
        return
      }
      const delay = backoff[Math.min(attempt, backoff.length - 1)]!
      attempt += 1
      setStatus('reconnecting', ev.reason === '' ? undefined : ev.reason)
      reconnectTimer = timers.setTimeout(() => {
        reconnectTimer = null
        open()
      }, delay)
    }
  }

  return {
    get status() {
      return status
    },
    connect() {
      if (socket) return
      attempt = 0
      open()
    },
    disconnect() {
      manualClose = true
      if (reconnectTimer !== null) {
        timers.clearTimeout(reconnectTimer as ReturnType<typeof setTimeout>)
        reconnectTimer = null
      }
      const ws = socket
      socket = null
      failPending('disconnected')
      if (ws) ws.close(1000, 'bye')
      setStatus('closed')
    },
    setToken(next) {
      const changed = next !== token
      token = next
      // A token that arrives while the socket is already up — Lite hands one over as soon as the player types a
      // name — greets on the spot instead of waiting for a reconnect that may be half a minute away. Once this
      // socket has been welcomed there is nothing to greet: a second `HELLO` would replace the live session.
      if (!changed || next === null || welcomed) return
      const ws = socket
      if (ws && ws.readyState === OPEN) hello(ws)
    },
    send(msg) {
      if (!socket || socket.readyState !== OPEN) return false
      socket.send(JSON.stringify(msg))
      return true
    },
    request(msg) {
      return new Promise<AckOrError>((resolve, reject) => {
        if (!socket || socket.readyState !== OPEN) {
          reject(new Error(`request ${msg.t}: not connected`))
          return
        }
        const reqId = `q${++reqCounter}`
        const timer = timers.setTimeout(() => {
          pending.delete(reqId)
          reject(new Error(`request ${msg.t} timed out`))
        }, opts.requestTimeoutMs ?? 10_000)
        pending.set(reqId, { resolve, reject, timer })
        socket.send(JSON.stringify({ ...msg, reqId }))
      })
    },
  }
}
