import type { PlayerIdentity, ServerMessage } from '@bp/core'
import { WebSocket } from 'ws'
import type { TimerHandle } from '../infra/clock.js'
import type { TokenBucket } from './rate-limit.js'

const REQ_ID_MEMORY = 32

export class ClientConnection {
  identity: PlayerIdentity | null = null
  inLobby = false
  replaced = false
  lastPongAt: number
  invalidMessages = 0
  /** Set once the close path has run for this socket, so it can be driven from the queue and be idempotent. */
  closeHandled = false
  helloTimer: TimerHandle | null = null
  private readonly reqOutcomes = new Map<string, ServerMessage>()
  private readonly reqOrder: string[] = []
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    readonly id: string,
    private readonly socket: WebSocket,
    private readonly bucket: TokenBucket,
    now: number,
  ) {
    this.lastPongAt = now
  }

  get isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN
  }

  send(msg: ServerMessage): void {
    if (this.isOpen) this.socket.send(JSON.stringify(msg))
  }

  tryTake(): boolean {
    return this.bucket.tryTake()
  }

  /** Messages from one connection are handled strictly in arrival order. */
  enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  /** The exact frame a previously handled `reqId` produced (`ACK` or the `ERROR` that was sent), if still remembered. */
  recallReq(reqId: string): ServerMessage | undefined {
    return this.reqOutcomes.get(reqId)
  }

  /** Remembers the outcome of a `reqId` so a retransmission replays it instead of re-executing. */
  rememberReq(reqId: string, outcome: ServerMessage): void {
    if (!this.reqOutcomes.has(reqId)) this.reqOrder.push(reqId)
    this.reqOutcomes.set(reqId, outcome)
    while (this.reqOrder.length > REQ_ID_MEMORY) this.reqOutcomes.delete(this.reqOrder.shift()!)
  }

  close(code: number, reason: string): void {
    this.helloTimer?.cancel()
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) this.socket.close(code, reason)
  }

  terminate(): void {
    this.helloTimer?.cancel()
    this.socket.terminate()
  }
}
