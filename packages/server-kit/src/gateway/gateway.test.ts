import type { RoomConfig } from '@bp/core'
import { afterEach, describe, expect, it } from 'vitest'
import { startTestServer, type TestServer } from '../testing/harness.js'
import { TestClient } from '../testing/test-client.js'

const HOLDEM: RoomConfig = { name: 'T', mode: 'holdem', maxPlayers: 4, isPrivate: false, turnTimerSec: 30, autoStart: false, holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 } }
const BLIND_BOT: RoomConfig = { name: 'B', mode: 'blind', maxPlayers: 3, isPrivate: false, turnTimerSec: 15, autoStart: false, blind: { holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1000, botCount: 1 } }

let ts: TestServer
const clients: TestClient[] = []
const connect = async (id: string) => {
  const c = await TestClient.connect(ts.url)
  clients.push(c)
  await c.hello(`tok:${id}`)
  return c
}
let n = 0
const rid = () => `r${n++}`
afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => undefined)
  await ts?.close()
})

async function seatTwo(a: TestClient, b: TestClient, config = HOLDEM, buyIn: number | undefined = 20_000) {
  a.send({ t: 'CREATE_ROOM', config })
  const snap = await a.next('ROOM_SNAPSHOT')
  b.send({ t: 'JOIN_ROOM', code: snap.room.code })
  await b.next('ROOM_SNAPSHOT')
  await a.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_JOINED')
  a.send({ t: 'SIT_DOWN', seat: 0, buyIn })
  b.send({ t: 'SIT_DOWN', seat: 1, buyIn })
  a.send({ t: 'READY', ready: true })
  b.send({ t: 'READY', ready: true })
  await b.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_READY' && m.event.playerId === 'a')
  await a.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_READY' && m.event.playerId === 'b')
  a.send({ t: 'START_GAME' })
  return snap
}

describe('authentication', () => {
  it('accepts a valid token, rejects an invalid one, and closes silent sockets after the HELLO timeout', async () => {
    ts = await startTestServer({ gatewayOptions: { helloTimeoutMs: 150 } })
    const good = await TestClient.connect(ts.url)
    clients.push(good)
    const welcome = await good.hello('tok:a')
    expect(welcome).toMatchObject({ playerId: 'a', displayName: 'A', balance: 100_000 })

    const bad = await TestClient.connect(ts.url)
    bad.send({ t: 'HELLO', sessionToken: 'tok:nobody' })
    await bad.next('ERROR', (m) => m.code === 'UNAUTHENTICATED')
    expect((await bad.closed).code).toBe(4001)

    const silent = await TestClient.connect(ts.url)
    silent.send({ t: 'LIST_ROOMS' })
    await silent.next('ERROR', (m) => m.code === 'UNAUTHENTICATED')
    expect((await silent.closed).code).toBe(4001)
  })
})

describe('lobby and rooms', () => {
  it('lists public rooms live, joins by code, refuses wrong passwords and double rooms', async () => {
    ts = await startTestServer()
    const a = await connect('a')
    const b = await connect('b')
    b.send({ t: 'LIST_ROOMS' })
    expect((await b.next('ROOM_LIST')).rooms).toEqual([])
    const res = await a.request({ t: 'CREATE_ROOM', reqId: rid(), config: { ...HOLDEM, isPrivate: true, password: 'pw12' } })
    expect(res.t).toBe('ACK')
    const snap = await a.next('ROOM_SNAPSHOT')
    expect(snap.room.hostPlayerId).toBe('a')
    expect((await b.next('ROOM_LIST')).rooms).toEqual([]) // private: not listed
    expect(await b.request({ t: 'JOIN_ROOM', reqId: rid(), code: snap.room.code, password: 'nope' })).toMatchObject({ t: 'ERROR', code: 'WRONG_PASSWORD' })
    expect(await b.request({ t: 'JOIN_ROOM', reqId: rid(), code: 'ZZZZZZ' })).toMatchObject({ t: 'ERROR', code: 'ROOM_NOT_FOUND' })
    expect(await b.request({ t: 'JOIN_ROOM', reqId: rid(), code: snap.room.code.toLowerCase(), password: 'pw12' })).toMatchObject({ t: 'ACK' })
    expect((await b.next('ROOM_SNAPSHOT')).room.players.map((p) => p.playerId)).toEqual(['a', 'b'])
    expect((await a.next('ROOM_EVENT')).event).toMatchObject({ type: 'PLAYER_JOINED', player: { playerId: 'b' } })
    expect(await a.request({ t: 'CREATE_ROOM', reqId: rid(), config: HOLDEM })).toMatchObject({ t: 'ERROR', code: 'ALREADY_IN_ROOM' })
    expect(await b.request({ t: 'LEAVE_ROOM', reqId: rid() })).toMatchObject({ t: 'ACK' })
    expect((await a.next('ROOM_EVENT')).event).toMatchObject({ type: 'PLAYER_LEFT', playerId: 'b' })
    b.send({ t: 'LIST_ROOMS' })
    await b.next('ROOM_LIST')
    a.send({ t: 'LEAVE_ROOM' })
    a.send({ t: 'CREATE_ROOM', config: HOLDEM })
    await a.next('ROOM_SNAPSHOT')
    const list = await b.next('ROOM_LIST', (m) => m.rooms.length === 1)
    expect(list.rooms[0]).toMatchObject({ name: 'T', mode: 'holdem', playerCount: 1, status: 'OPEN' })
  })
})

describe('blind hand against a bot over the wire', () => {
  it('deals private cards only to their owner, drives the decision phase, settles and pushes the balance', async () => {
    ts = await startTestServer()
    const a = await connect('a')
    a.send({ t: 'CREATE_ROOM', config: BLIND_BOT })
    const snap = await a.next('ROOM_SNAPSHOT')
    expect(snap.room.players.filter((p) => p.isBot)).toHaveLength(1)
    a.send({ t: 'SIT_DOWN', seat: 0 })
    a.send({ t: 'READY', ready: true })
    a.send({ t: 'START_GAME' })
    const started = await a.next('GAME_EVENT', (m) => m.event.type === 'HAND_STARTED')
    expect(started.event).toMatchObject({ type: 'HAND_STARTED', mode: 'blind' })
    const mine = await a.next('GAME_EVENT', (m) => m.event.type === 'CARDS_DEALT' && m.event.seat === 0)
    const theirs = await a.next('GAME_EVENT', (m) => m.event.type === 'CARDS_DEALT' && m.event.seat === 2)
    expect(mine.event.type === 'CARDS_DEALT' && mine.event.cards).toHaveLength(2)
    expect(theirs.event.type === 'CARDS_DEALT' && theirs.event.cards).toEqual([])
    expect(theirs.event.type === 'CARDS_DEALT' && theirs.event.cardCount).toBe(2)
    const phase = await a.next('GAME_EVENT', (m) => m.event.type === 'DECISION_PHASE')
    expect(phase.event.deadlineAt).toBeGreaterThan(Date.now() - 1000)
    expect(await a.request({ t: 'ACTION', reqId: rid(), baseSeq: phase.seq, action: { kind: 'play' } })).toMatchObject({ t: 'ACK' })
    await a.next('GAME_EVENT', (m) => m.event.type === 'HAND_COMPLETE', 5000)
    const balance = await a.next('BALANCE')
    expect(balance.balance).not.toBe(100_000)
    expect(await ts.repos.balances.get('a')).toBe(balance.balance)
    expect(ts.repos.hands).toHaveLength(1)
    const status = await a.next('ROOM_EVENT', (m) => m.event.type === 'ROOM_STATUS' && m.event.nextHandAt !== null)
    expect(status.event.type).toBe('ROOM_STATUS')
  })
})

describe('hold’em between two clients', () => {
  it('enforces turn order, staleness, duplicates and legality', async () => {
    ts = await startTestServer()
    const a = await connect('a')
    const b = await connect('b')
    await seatTwo(a, b)
    const first = await a.next('GAME_EVENT', (m) => m.event.type === 'TURN_CHANGED')
    const actingSeat = first.event.type === 'TURN_CHANGED' ? first.event.seat : -1
    const [actor, other] = actingSeat === 0 ? [a, b] : [b, a]
    await b.next('GAME_EVENT', (m) => m.event.type === 'TURN_CHANGED')
    expect(await other.request({ t: 'ACTION', reqId: rid(), baseSeq: first.seq, action: { kind: 'call' } })).toMatchObject({ t: 'ERROR', code: 'NOT_YOUR_TURN' })
    expect(await actor.request({ t: 'ACTION', reqId: rid(), baseSeq: 0, action: { kind: 'call' } })).toMatchObject({ t: 'ERROR', code: 'STALE_STATE' })
    expect(await actor.request({ t: 'ACTION', reqId: rid(), baseSeq: first.seq, action: { kind: 'check' } })).toMatchObject({ t: 'ERROR', code: 'ILLEGAL_ACTION' })
    const dup = rid()
    expect(await actor.request({ t: 'ACTION', reqId: dup, baseSeq: first.seq, action: { kind: 'call' } })).toMatchObject({ t: 'ACK' })
    expect(await actor.request({ t: 'ACTION', reqId: dup, baseSeq: first.seq, action: { kind: 'call' } })).toMatchObject({ t: 'ACK' }) // idempotent
    await other.next('GAME_EVENT', (m) => m.event.type === 'PLAYER_ACTED')
    expect(other.drain('GAME_EVENT').filter((m) => m.event.type === 'PLAYER_ACTED')).toHaveLength(0) // not applied twice
    // play the rest passively, driving both seats from a's event stream (seq is room-wide)
    const clientForSeat = (seat: number) => (seat === 0 ? a : b)
    for (let i = 0; i < 40; i++) {
      const ev = await a.next('GAME_EVENT', (m) => m.event.type === 'TURN_CHANGED' || m.event.type === 'HAND_COMPLETE', 5000)
      if (ev.event.type === 'HAND_COMPLETE') break
      if (ev.event.type !== 'TURN_CHANGED') continue
      const kind = ev.event.legal.kinds.includes('check') ? 'check' : 'call'
      expect(await clientForSeat(ev.event.seat).request({ t: 'ACTION', reqId: rid(), baseSeq: ev.seq, action: { kind } })).toMatchObject({ t: 'ACK' })
    }
    const done = await a.next('GAME_EVENT', (m) => m.event.type === 'SETTLEMENT', 5000)
    expect(done.event.type === 'SETTLEMENT' && done.event.fee).toBeGreaterThan(0)
  }, 20_000)
})

describe('reconnect and duplicate sessions', () => {
  it('a dropped client keeps its seat, gets a snapshot on return, and a second login replaces the first', async () => {
    ts = await startTestServer({ roomOptions: { turnTimerMsOverride: 10_000 } })
    const a = await connect('a')
    const b = await connect('b')
    await seatTwo(a, b, { ...BLIND_BOT, blind: { ...BLIND_BOT.blind!, botCount: 0 } }, undefined)
    await b.next('GAME_EVENT', (m) => m.event.type === 'DECISION_PHASE')
    await b.close()
    const dc = await a.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_DISCONNECTED')
    expect(dc.event).toMatchObject({ type: 'PLAYER_DISCONNECTED', playerId: 'b' })
    const b2 = await connect('b')
    const snap = await b2.next('ROOM_SNAPSHOT')
    expect(snap.hand?.mySeat).toBe(1)
    expect(snap.hand?.seats.find((s) => s.seat === 1)?.holeCards).toHaveLength(2)
    expect(snap.hand?.legal?.kinds).toEqual(['play', 'fold'])
    expect(snap.deadlineAt).not.toBeNull()
    expect((await a.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_RECONNECTED')).event).toMatchObject({ playerId: 'b' })

    const b3 = await connect('b')
    await b2.next('SESSION_REPLACED')
    expect((await b2.closed).code).toBe(4000)
    expect((await b3.next('ROOM_SNAPSHOT')).hand?.mySeat).toBe(1)
    expect(a.drain('ROOM_EVENT').some((m) => m.event.type === 'PLAYER_DISCONNECTED')).toBe(false) // replacement is not a disconnect
  })
})

describe('abuse protection', () => {
  it('rate-limits floods, closes after repeated invalid messages, and rejects oversized payloads', async () => {
    ts = await startTestServer()
    const a = await connect('a')
    for (let i = 0; i < 40; i++) a.send({ t: 'PONG' })
    await a.next('ERROR', (m) => m.code === 'RATE_LIMITED')

    const b = await connect('b')
    b.send({ t: 'NOPE' })
    b.send({ t: 'NOPE' })
    b.send({ t: 'NOPE' })
    await b.next('ERROR', (m) => m.code === 'INVALID_MESSAGE')
    expect((await b.closed).code).toBe(4002)

    const c = await connect('c')
    c.send({ t: 'LIST_ROOMS', pad: 'x'.repeat(5000) })
    expect((await c.closed).code).toBe(1009)
  })
})

describe('heartbeat', () => {
  it('pings clients and drops those that never answer', async () => {
    ts = await startTestServer({ gatewayOptions: { heartbeatIntervalMs: 50, heartbeatTimeoutMs: 120 } })
    const alive = await connect('a')
    await alive.next('PING')
    const mute = await TestClient.connect(ts.url)
    mute.send({ t: 'HELLO', sessionToken: 'tok:b' })
    await mute.next('WELCOME')
    ;(mute as unknown as { ws: { removeAllListeners: (e: string) => void } }).ws.removeAllListeners('message') // stop auto-PONG
    const closed = await mute.closed
    expect([1005, 1006]).toContain(closed.code)
    await alive.next('PING')
    expect(alive.isOpen).toBe(true)
  })
})

describe('shutdown', () => {
  it('cancels hands, refunds, notifies and closes every socket', async () => {
    ts = await startTestServer()
    const a = await connect('a')
    const b = await connect('b')
    await seatTwo(a, b)
    await a.next('GAME_EVENT', (m) => m.event.type === 'TURN_CHANGED')
    await ts.server.shutdown('deploy')
    await a.next('GAME_EVENT', (m) => m.event.type === 'HAND_CANCELLED')
    await a.next('ROOM_EVENT', (m) => m.event.type === 'ROOM_CLOSED')
    await a.next('ERROR', (m) => m.code === 'SERVER_SHUTDOWN')
    expect((await a.closed).code).toBe(1001)
    expect((await b.closed).code).toBe(1001)
    expect(await ts.repos.balances.get('a')).toBe(100_000)
    expect(await ts.repos.balances.get('b')).toBe(100_000)
    expect(ts.server.rooms.size).toBe(0)
  })
})
