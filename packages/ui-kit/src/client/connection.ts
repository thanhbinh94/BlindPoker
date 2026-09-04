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

  const open = (): void => {
    manualClose = false
    if (reconnectTimer !== null) {
      timers.clearTimeout(reconnectTimer as ReturnType<typeof setTimeout>)
      reconnectTimer = null
    }
    setStatus(attempt === 0 ? 'connecting' : 'reconnecting')
    const ws = factory(opts.url)
    socket = ws
    ws.onopen = () => {
      attempt = 0
      setStatus('open')
      if (token !== null) ws.send(JSON.stringify({ t: 'HELLO', sessionToken: token } satisfies ClientMessage))
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
      token = next
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
