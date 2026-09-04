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
/** Polls until `pred` holds; the alternative is sleeping on a guessed duration. */
async function waitUntil(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!pred()) {
    if (Date.now() > deadline) throw new Error('condition never became true')
    await new Promise((r) => setTimeout(r, 5))
  }
}
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

describe('bind and close races', () => {
  it('a socket that dies mid-bind never leaves the player marked connected, and a reconnect sends WELCOME before ROOM_SNAPSHOT', async () => {
    ts = await startTestServer()
    const a = await connect('a')
    a.send({ t: 'CREATE_ROOM', config: HOLDEM })
    const snap = await a.next('ROOM_SNAPSHOT')
    const room = ts.server.rooms.get(snap.room.roomId)!
    expect(room.players.get('a')!.connected).toBe(true)

    // Hold the balance lookup open so the socket is guaranteed to die while bind() is still awaiting.
    const realGet = ts.repos.balances.get.bind(ts.repos.balances)
    let slow = false
    ts.repos.balances.get = async (playerId: string) => {
      if (slow) await new Promise((r) => setTimeout(r, 120))
      return realGet(playerId)
    }
    slow = true
    const racer = await TestClient.connect(ts.url)
    racer.send({ t: 'HELLO', sessionToken: 'tok:a' })
    await racer.close()
    await a.closed // the racing session replaced the first one
    slow = false

    // The player must end up disconnected: neither socket is alive to receive anything.
    await waitUntil(() => room.players.get('a')!.connected === false)
    expect(ts.server.connectionCount).toBe(0)

    // A real reconnect resyncs, and its very first frames are WELCOME then ROOM_SNAPSHOT.
    const back = await connect('a')
    await back.next('ROOM_SNAPSHOT')
    expect(back.received.map((m) => m.t).slice(0, 2)).toEqual(['WELCOME', 'ROOM_SNAPSHOT'])
    expect(room.players.get('a')!.connected).toBe(true)
  })

  it('replays the original ERROR when a failed request is retransmitted with the same reqId', async () => {
    ts = await startTestServer()
    const a = await connect('a')
    const b = await connect('b')
    await seatTwo(a, b)
    await a.next('GAME_EVENT', (m) => m.event.type === 'TURN_CHANGED')
    const dup = rid()
    const first = await a.request({ t: 'ACTION', reqId: dup, baseSeq: 0, action: { kind: 'call' } })
    expect(first).toMatchObject({ t: 'ERROR', code: 'STALE_STATE' })
    const again = await a.request({ t: 'ACTION', reqId: dup, baseSeq: 0, action: { kind: 'call' } })
    expect(again).toEqual(first) // not an ACK: the retry must not look like success
  }, 20_000)
})

describe('out-of-band pushes', () => {
  it('notify reaches a live session, and balanceChanged refreshes a blind seat\u2019s mirrored stack', async () => {
    ts = await startTestServer()
    const a = await connect('a')
    a.send({ t: 'CREATE_ROOM', config: { ...BLIND_BOT, blind: { ...BLIND_BOT.blind!, botCount: 0 } } })
    const snap = await a.next('ROOM_SNAPSHOT')
    a.send({ t: 'SIT_DOWN', seat: 0 })
    await a.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_SAT')
    const room = ts.server.rooms.get(snap.room.roomId)!
    expect(room.view().players.find((p) => p.playerId === 'a')!.stack).toBe(100_000)

    // points granted elsewhere (a purchase, a daily reward) must reach both the client and the seat
    ts.repos.records.get('a')!.balance = 142_000
    await ts.server.balanceChanged('a')
    expect((await a.next('BALANCE')).balance).toBe(142_000)
    expect(room.view().players.find((p) => p.playerId === 'a')!.stack).toBe(142_000)

    ts.server.notify('a', { t: 'NOTIFICATION', kind: 'DAILY_REWARD', payload: { amount: 500 } })
    expect(await a.next('NOTIFICATION')).toMatchObject({ kind: 'DAILY_REWARD', payload: { amount: 500 } })

    ts.server.notify('nobody', { t: 'NOTIFICATION', kind: 'X', payload: null }) // offline: a no-op, not a throw
    await ts.server.balanceChanged('b') // not in a room and not connected: also a no-op
  })
})

describe('abuse protection', () => {
  it('rate-limits floods, closes after repeated invalid messages, and rejects oversized payloads', async () => {
    ts = await startTestServer()
    const a = await connect('a')
    for (let i = 0; i < 100; i++) a.send({ t: 'PONG' })
    await a.next('ERROR', (m) => m.code === 'RATE_LIMITED')
    expect((await a.closed).code).toBe(4002) // a sustained flood costs a strike every 5 rejections

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

  it('does not treat a rejected room config as protocol abuse', async () => {
    ts = await startTestServer()
    const a = await connect('a')
    for (let i = 0; i < 3; i++) {
      expect(await a.request({ t: 'CREATE_ROOM', reqId: rid(), config: { name: '', mode: 'holdem' } })).toMatchObject({ t: 'ERROR', code: 'INVALID_ROOM_CONFIG' })
    }
    expect(a.isOpen).toBe(true) // three refusals in a row, still connected
    expect(await a.request({ t: 'CREATE_ROOM', reqId: rid(), config: HOLDEM })).toMatchObject({ t: 'ACK' })
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
  it('stops accepting before it drains: new sockets get 503 and CREATE_ROOM/JOIN_ROOM are refused', async () => {
    ts = await startTestServer()
    const a = await connect('a')
    ts.server.gateway.stopAccepting()
    expect(await a.request({ t: 'CREATE_ROOM', reqId: rid(), config: HOLDEM })).toMatchObject({ t: 'ERROR', code: 'SERVER_SHUTDOWN' })
    expect(await a.request({ t: 'JOIN_ROOM', reqId: rid(), code: 'ZZZZZZ' })).toMatchObject({ t: 'ERROR', code: 'SERVER_SHUTDOWN' })
    expect(ts.server.rooms.size).toBe(0)
    await expect(TestClient.connect(ts.url)).rejects.toThrow(/503/)
    expect(a.isOpen).toBe(true) // existing sessions keep playing while the server drains
  })

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
    await expect(TestClient.connect(ts.url)).rejects.toThrow(/503/) // no new sockets after shutdown
  })
})
