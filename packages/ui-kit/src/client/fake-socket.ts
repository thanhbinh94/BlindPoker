import type { ServerMessage } from '@bp/core'
import type { SocketFactory, SocketLike } from './connection.js'

/** In-memory `SocketLike` for tests: drive it with `open()` / `receive()` / `serverClose()` and read `sent`. */
export class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = []
  static reset(): void {
    FakeSocket.instances = []
  }

  readonly sent: object[] = []
  readyState = 0
  closedWith: { code: number; reason: string } | null = null
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { code: number; reason: string }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null

  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
  }

  open(): void {
    this.readyState = 1
    this.onopen?.()
  }

  receive(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }

  serverClose(code: number, reason = ''): void {
    this.readyState = 3
    this.onclose?.({ code, reason })
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as object)
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.closedWith = { code, reason }
    this.onclose?.({ code, reason })
  }
}

export const fakeSocketFactory: SocketFactory = (url) => new FakeSocket(url)
