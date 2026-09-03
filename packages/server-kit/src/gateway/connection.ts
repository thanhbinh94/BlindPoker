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
  helloTimer: TimerHandle | null = null
  private readonly recentReqIds: string[] = []
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

  seenReqId(reqId: string): boolean {
    if (this.recentReqIds.includes(reqId)) return true
    this.recentReqIds.push(reqId)
    if (this.recentReqIds.length > REQ_ID_MEMORY) this.recentReqIds.shift()
    return false
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
