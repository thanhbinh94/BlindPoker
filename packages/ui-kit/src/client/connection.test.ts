import type { ServerMessage } from '@bp/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConnection, type ConnectionStatus } from './connection.js'
import { FakeSocket, fakeSocketFactory } from './fake-socket.js'

describe('createConnection', () => {
  beforeEach(() => { vi.useFakeTimers(); FakeSocket.reset() })
  afterEach(() => { vi.useRealTimers() })

  function make(token: string | null = 'tok:a') {
    const messages: ServerMessage[] = []
    const statuses: ConnectionStatus[] = []
    const conn = createConnection({ url: 'ws://x/ws', token, socketFactory: fakeSocketFactory, onMessage: (m) => messages.push(m), onStatus: (s) => statuses.push(s), requestTimeoutMs: 500 })
    return { conn, messages, statuses, socket: () => FakeSocket.instances.at(-1)! }
  }

  it('connects, sends HELLO on open, answers PING, forwards messages', () => {
    const { conn, messages, statuses, socket } = make()
    conn.connect()
    expect(statuses).toEqual(['connecting'])
    socket().open()
    expect(statuses.at(-1)).toBe('open')
    expect(socket().sent[0]).toEqual({ t: 'HELLO', sessionToken: 'tok:a' })
    socket().receive({ t: 'PING' })
    expect(socket().sent.at(-1)).toEqual({ t: 'PONG' })
    socket().receive({ t: 'BALANCE', balance: 7 })
    expect(messages.at(-1)).toEqual({ t: 'BALANCE', balance: 7 })
  })

  it('request resolves with the matching ACK or ERROR and times out otherwise', async () => {
    const { conn, socket } = make()
    conn.connect(); socket().open()
    const p1 = conn.request({ t: 'READY', ready: true })
    const sent = socket().sent.at(-1) as { reqId: string }
    socket().receive({ t: 'ACK', reqId: 'other' })
    socket().receive({ t: 'ACK', reqId: sent.reqId })
    await expect(p1).resolves.toEqual({ t: 'ACK', reqId: sent.reqId })
    const p2 = conn.request({ t: 'START_GAME' })
    const sent2 = socket().sent.at(-1) as { reqId: string }
    socket().receive({ t: 'ERROR', reqId: sent2.reqId, code: 'NOT_HOST', message: 'no' })
    await expect(p2).resolves.toMatchObject({ t: 'ERROR', code: 'NOT_HOST' })
    const p3 = conn.request({ t: 'START_GAME' })
    vi.advanceTimersByTime(600)
    await expect(p3).rejects.toThrow(/timed out/)
    conn.disconnect()
    await expect(conn.request({ t: 'START_GAME' })).rejects.toThrow(/not connected/)
  })

  it('reconnects with exponential backoff, re-sends HELLO, stops on SESSION_REPLACED and on disconnect()', () => {
    const { conn, statuses, socket } = make()
    conn.connect(); socket().open()
    socket().serverClose(1006)
    expect(statuses.at(-1)).toBe('reconnecting')
    expect(FakeSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(999)
    expect(FakeSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.instances).toHaveLength(2)
    socket().serverClose(1006)
    vi.advanceTimersByTime(2000)
    expect(FakeSocket.instances).toHaveLength(3)
    socket().open()
    expect(socket().sent[0]).toEqual({ t: 'HELLO', sessionToken: 'tok:a' })
    socket().receive({ t: 'SESSION_REPLACED' })
    socket().serverClose(4000, 'replaced')
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(3)
    expect(statuses.at(-1)).toBe('closed')
    conn.connect(); socket().open()
    expect(FakeSocket.instances).toHaveLength(4)
    conn.disconnect()
    expect(socket().closedWith?.code).toBe(1000)
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(4)
  })

  it('without a token it sends no HELLO', () => {
    const { conn, socket } = make(null)
    conn.connect(); socket().open()
    expect(socket().sent).toEqual([])
    conn.setToken('tok:b')
    conn.disconnect(); conn.connect(); socket().open()
    expect(socket().sent[0]).toEqual({ t: 'HELLO', sessionToken: 'tok:b' })
  })
})
