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

  it('setToken on a live socket greets immediately, and only once', () => {
    const { conn, socket } = make(null)
    conn.connect(); socket().open()
    expect(socket().sent).toEqual([])
    conn.setToken('tok:b')
    expect(socket().sent).toEqual([{ t: 'HELLO', sessionToken: 'tok:b' }])
    conn.setToken('tok:b') // same token again: nothing to re-announce
    expect(socket().sent).toHaveLength(1)
    socket().receive({ t: 'WELCOME', playerId: 'p', displayName: 'P', balance: 0, serverTime: 0 })
    conn.setToken('tok:c') // this socket already has a session; a second HELLO would replace it
    expect(socket().sent).toHaveLength(1)
  })

  it('stops for good when the server rejects the token', () => {
    const { conn, statuses, socket } = make()
    conn.connect(); socket().open()
    socket().serverClose(4001, 'bad token')
    expect(statuses.at(-1)).toBe('closed')
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('reports why it closed as unauthenticated, including after an UNAUTHENTICATED error frame', () => {
    const reasons: (string | undefined)[] = []
    const conn = createConnection({
      url: 'ws://x/ws', token: 'tok:bad', socketFactory: fakeSocketFactory,
      onMessage: () => {}, onStatus: (_s, reason) => reasons.push(reason),
    })
    conn.connect()
    const sock = FakeSocket.instances.at(-1)!
    sock.open()
    sock.receive({ t: 'ERROR', code: 'UNAUTHENTICATED', message: 'no' })
    sock.serverClose(1006) // a plain close, but this socket was already refused
    expect(reasons.at(-1)).toBe('unauthenticated')
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('keeps backing off when a server accepts the socket and then drops it without a WELCOME', () => {
    const { conn, socket } = make()
    conn.connect()
    for (const delay of [1000, 2000, 4000]) {
      socket().open() // the socket opens every time, so `onopen` must not be what resets the backoff
      socket().serverClose(1006)
      const before = FakeSocket.instances.length
      vi.advanceTimersByTime(delay - 1)
      expect(FakeSocket.instances).toHaveLength(before)
      vi.advanceTimersByTime(1)
      expect(FakeSocket.instances).toHaveLength(before + 1)
    }
    // A WELCOME is what proves the session works; only then does the ladder go back to the first rung.
    socket().open()
    socket().receive({ t: 'WELCOME', playerId: 'p', displayName: 'P', balance: 0, serverTime: 0 })
    socket().serverClose(1006)
    const before = FakeSocket.instances.length
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.instances).toHaveLength(before + 1)
  })

  it('rejects an in-flight request when the socket closes under it', async () => {
    const { conn, socket } = make()
    conn.connect(); socket().open()
    const pending = conn.request({ t: 'START_GAME' })
    socket().serverClose(1006)
    await expect(pending).rejects.toThrow(/closed/)
    vi.advanceTimersByTime(60_000)
  })

  it('disconnect() during backoff cancels the pending retry', () => {
    const { conn, socket } = make()
    conn.connect(); socket().open()
    socket().serverClose(1006)
    conn.disconnect()
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('connect() during backoff connects at once and cancels the pending retry', () => {
    const { conn, socket } = make()
    conn.connect(); socket().open()
    socket().serverClose(1006)
    conn.connect()
    expect(FakeSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(2) // the queued retry did not fire on top of it
  })
})
