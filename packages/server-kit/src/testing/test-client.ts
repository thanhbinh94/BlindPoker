import type { ServerMessage } from '@bp/core'
import { WebSocket } from 'ws'

type Msg<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>
interface Waiter { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }

export class TestClient {
  readonly received: ServerMessage[] = []
  readonly closed: Promise<{ code: number; reason: string }>
  private readonly buffer: ServerMessage[] = []
  private readonly waiters: Waiter[] = []
  private readonly listeners = new Set<(m: ServerMessage) => void>()

  private constructor(private readonly ws: WebSocket) {
    this.closed = new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })))
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as ServerMessage
      this.received.push(msg)
      if (msg.t === 'PING') this.ws.send(JSON.stringify({ t: 'PONG' }))
      // Listeners see *every* frame, in arrival order, whether or not a waiter or the buffer takes
      // it. A driver that must follow the whole stream (seq continuity, latency) uses this; one-off
      // assertions use next()/request().
      for (const fn of this.listeners) fn(msg)
      const idx = this.waiters.findIndex((w) => w.match(msg))
      if (idx >= 0) this.waiters.splice(idx, 1)[0]!.resolve(msg)
      else this.buffer.push(msg)
    })
  }

  static connect(url: string, headers: Record<string, string> = {}): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers })
      ws.once('open', () => resolve(new TestClient(ws)))
      ws.once('error', reject)
      ws.once('unexpected-response', (_req, res) => reject(new Error(`unexpected response ${res.statusCode}`)))
    })
  }

  get isOpen(): boolean {
    return this.ws.readyState === WebSocket.OPEN
  }

  /** Subscribes to every inbound frame. Returns an unsubscribe function. */
  onMessage(fn: (m: ServerMessage) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  send(msg: object): void {
    this.ws.send(JSON.stringify(msg))
  }

  async hello(token: string): Promise<Msg<'WELCOME'>> {
    this.send({ t: 'HELLO', sessionToken: token })
    return this.next('WELCOME')
  }

  next<T extends ServerMessage['t']>(t: T, pred: (m: Msg<T>) => boolean = () => true, timeoutMs = 3000): Promise<Msg<T>> {
    const match = (m: ServerMessage): m is Msg<T> => m.t === t && pred(m as Msg<T>)
    return this.nextMatching(match, timeoutMs, t)
  }

  async request<M extends object & { reqId: string }>(msg: M): Promise<Msg<'ACK'> | Msg<'ERROR'>> {
    this.send(msg)
    return this.answer(msg.reqId)
  }

  /** Awaits the `ACK`/`ERROR` for a request already in flight — for races that must be sent before either is read. */
  answer(reqId: string, timeoutMs = 3000): Promise<Msg<'ACK'> | Msg<'ERROR'>> {
    const match = (m: ServerMessage): m is Msg<'ACK'> | Msg<'ERROR'> => (m.t === 'ACK' || m.t === 'ERROR') && m.reqId === reqId
    return this.nextMatching(match, timeoutMs, `ACK/ERROR for ${reqId}`)
  }

  drain<T extends ServerMessage['t']>(t: T): Msg<T>[] {
    const out = this.buffer.filter((m): m is Msg<T> => m.t === t)
    for (const m of out) this.buffer.splice(this.buffer.indexOf(m), 1)
    return out
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) this.ws.close(1000, 'bye')
    await this.closed
  }

  /** Single waiter shared by next()/request(): consumes a buffered match immediately, otherwise registers exactly one waiter with its own timeout. */
  private nextMatching<M extends ServerMessage>(match: (m: ServerMessage) => m is M, timeoutMs: number, waitingFor: string): Promise<M> {
    const idx = this.buffer.findIndex(match)
    if (idx >= 0) return Promise.resolve(this.buffer.splice(idx, 1)[0] as M)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.resolve === done)
        if (i >= 0) this.waiters.splice(i, 1)
        reject(new Error(`timed out waiting for ${waitingFor}; buffered: ${this.buffer.slice(-5).map((m) => m.t).join(', ') || 'none'}`))
      }, timeoutMs)
      const done = (m: ServerMessage) => { clearTimeout(timer); resolve(m as M) }
      this.waiters.push({ match, resolve: done })
    })
  }
}
