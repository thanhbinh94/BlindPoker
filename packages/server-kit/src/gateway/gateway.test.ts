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
/** Lets every pending timer, socket event and queued task drain before asserting. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60))
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

describe('origin policy', () => {
  /** The `host[:port]` the ws client will put in its `Host` header for `ts.url`. */
  const selfHost = (): string => new URL(ts.url).host

  it("with 'same-host', accepts a browser from this host, a client with no Origin at all, and refuses a foreign one", async () => {
    ts = await startTestServer({ gatewayOptions: { allowedOrigins: 'same-host' } })

    const sameOrigin = await TestClient.connect(ts.url, { origin: `http://${selfHost()}` })
    clients.push(sameOrigin)
    expect((await sameOrigin.hello('tok:a')).playerId).toBe('a')

    // No `Origin` header: a bot or a health probe, not a cross-site request.
    const headless = await TestClient.connect(ts.url)
    clients.push(headless)
    expect((await headless.hello('tok:b')).playerId).toBe('b')

    await expect(TestClient.connect(ts.url, { origin: 'http://evil.example' })).rejects.toThrow(/403/)
  })

  it("with 'same-host', ignores the scheme and a spelled-out default port", async () => {
    ts = await startTestServer({ gatewayOptions: { allowedOrigins: 'same-host' } })
    const host = selfHost()
    for (const origin of [`https://${host}`, `HTTP://${host.toUpperCase()}`]) {
      const c = await TestClient.connect(ts.url, { origin })
      clients.push(c)
      expect((await c.hello('tok:a')).playerId, origin).toBe('a')
      await c.close()
    }
    // A host that merely starts the same way is a different host.
    await expect(TestClient.connect(ts.url, { origin: `http://${host}.evil.example` })).rejects.toThrow(/403/)
  })

  it('with an explicit list, accepts exactly the listed origins and nothing else — not even this host', async () => {
    ts = await startTestServer({ gatewayOptions: { allowedOrigins: ['https://poker.example.com'] } })

    const listed = await TestClient.connect(ts.url, { origin: 'https://poker.example.com' })
    clients.push(listed)
    expect((await listed.hello('tok:a')).playerId).toBe('a')

    await expect(TestClient.connect(ts.url, { origin: `http://${selfHost()}` })).rejects.toThrow(/403/)
    // A list is a deliberate allowlist, so an absent Origin is not on it either.
    await expect(TestClient.connect(ts.url)).rejects.toThrow(/403/)
  })

  it('with null, lets anything through — the caller has decided elsewhere', async () => {
    ts = await startTestServer({ gatewayOptions: { allowedOrigins: null } })
    const c = await TestClient.connect(ts.url, { origin: 'http://evil.example' })
    clients.push(c)
    expect((await c.hello('tok:a')).playerId).toBe('a')
  })
})

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
  it('CREATE_ROOM with a chaos cycle on a server without a chaos port is CHAOS_UNAVAILABLE, and no room is made', async () => {
    ts = await startTestServer()
    const a = await connect('a')
    const config = { ...BLIND_BOT, blind: { ...BLIND_BOT.blind!, chaosCycle: 5 as const } }
    expect(await a.request({ t: 'CREATE_ROOM', reqId: rid(), config })).toMatchObject({ t: 'ERROR', code: 'CHAOS_UNAVAILABLE' })
    expect(ts.server.rooms.size).toBe(0)
    expect(await a.request({ t: 'CHAOS_PICK', reqId: rid(), offerId: 'o', cardId: 's_rescue' })).toMatchObject({ t: 'ERROR', code: 'NOT_IN_ROOM' })
    expect(await a.request({ t: 'CREATE_ROOM', reqId: rid(), config: BLIND_BOT })).toMatchObject({ t: 'ACK' })
  })

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

  it('SIT_OUT and SIT_IN need a seat, and tell the rest of the room', async () => {
    ts = await startTestServer()
    const a = await connect('a')
    const b = await connect('b')
    a.send({ t: 'CREATE_ROOM', config: HOLDEM })
    const snap = await a.next('ROOM_SNAPSHOT')
    b.send({ t: 'JOIN_ROOM', code: snap.room.code })
    await b.next('ROOM_SNAPSHOT')
    expect(await b.request({ t: 'SIT_OUT', reqId: rid() })).toMatchObject({ t: 'ERROR', code: 'NOT_SEATED' })
    b.send({ t: 'SIT_DOWN', seat: 1, buyIn: 20_000 })
    await a.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_SAT')
    expect(await b.request({ t: 'SIT_OUT', reqId: rid() })).toMatchObject({ t: 'ACK' })
    expect((await a.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_SIT_OUT')).event).toMatchObject({ type: 'PLAYER_SIT_OUT', playerId: 'b', sittingOut: true })
    b.send({ t: 'RESYNC' })
    expect((await b.next('ROOM_SNAPSHOT')).room.players.find((p) => p.playerId === 'b')?.status).toBe('SITTING_OUT')
    expect(await b.request({ t: 'SIT_IN', reqId: rid() })).toMatchObject({ t: 'ACK' })
    expect((await a.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_SIT_OUT')).event).toMatchObject({ sittingOut: false })
  })
})

describe('blind hand against a bot over the wire', () => {
  it('deals private cards only to their owner, drives the decision phase, settles the table stack and cashes it out on stand-up', async () => {
    ts = await startTestServer({ roomOptions: { handIntervalMs: 60_000 } })
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
    // Spec 2026-09-29 (table limit): the hand moved the table stack only; standing up takes it home.
    expect(await a.request({ t: 'STAND_UP', reqId: rid() })).toMatchObject({ t: 'ACK' })
    const balance = await a.next('BALANCE', (m) => m.balance !== 90_000)
    expect(balance.balance).not.toBe(100_000)
    expect(await ts.repos.balances.get('a')).toBe(balance.balance)
    expect(ts.repos.hands).toHaveLength(1)
    const status = await a.next('ROOM_EVENT', (m) => m.event.type === 'ROOM_STATUS' && m.event.nextHandAt !== null)
    expect(status.event.type).toBe('ROOM_STATUS')
  })
})

describe('squeeze round over the wire', () => {
  const SQUEEZE_BOT: RoomConfig = { ...BLIND_BOT, turnTimerSec: 20, blind: { ...BLIND_BOT.blind!, decisionMode: 'none', squeeze: true } }

  it('answers REVEAL with ACK in the round, sends the deadline with its opening event, and ends the round on the turn', async () => {
    ts = await startTestServer({ roomOptions: { handIntervalMs: 60_000 } })
    const a = await connect('a')
    a.send({ t: 'CREATE_ROOM', config: SQUEEZE_BOT })
    await a.next('ROOM_SNAPSHOT')
    expect(await a.request({ t: 'REVEAL', reqId: rid() })).toMatchObject({ t: 'ERROR', code: 'NOT_SEATED' })
    a.send({ t: 'SIT_DOWN', seat: 0 })
    // seated, with no hand running: nothing to turn, and nothing to complain of (final fix wave M1)
    expect(await a.request({ t: 'REVEAL', reqId: rid() })).toMatchObject({ t: 'ACK' })
    a.send({ t: 'READY', ready: true })
    a.send({ t: 'START_GAME' })
    const phase = await a.next('GAME_EVENT', (m) => m.event.type === 'SQUEEZE_PHASE')
    expect(phase.event).toMatchObject({ type: 'SQUEEZE_PHASE', seats: [0] })
    expect(phase.event.deadlineAt).toBeGreaterThan(Date.now())
    expect(await a.request({ t: 'REVEAL', reqId: rid() })).toMatchObject({ t: 'ACK' })
    await a.next('GAME_EVENT', (m) => m.event.type === 'SQUEEZE_ENDED')
    await a.next('GAME_EVENT', (m) => m.event.type === 'HAND_COMPLETE', 5000)
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

    // Gate the balance lookup so the racing socket is guaranteed to die while bind() is still
    // awaiting it, and so the test controls exactly when that bind resumes.
    const realGet = ts.repos.balances.get.bind(ts.repos.balances)
    let openGate: () => void = () => {}
    const gate = new Promise<void>((resolve) => { openGate = resolve })
    let gated = true
    ts.repos.balances.get = async (playerId: string) => {
      if (gated) {
        gated = false
        await gate
      }
      return realGet(playerId)
    }
    const racer = await TestClient.connect(ts.url)
    racer.send({ t: 'HELLO', sessionToken: 'tok:a' })
    await racer.close()
    await a.closed // the racing session replaced the first one, then died mid-bind

    openGate() // the bind resumes against a socket that is already gone
    await settle()
    await room.enqueue(() => undefined)
    // The player must end up disconnected: neither socket is alive to receive anything, and the
    // late-finishing bind must not resurrect them as connected.
    expect(room.players.get('a')!.connected).toBe(false)
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
  it('notify reaches a live session, and balanceChanged pushes the balance without touching a blind seat’s table stack', async () => {
    ts = await startTestServer()
    const a = await connect('a')
    a.send({ t: 'CREATE_ROOM', config: { ...BLIND_BOT, blind: { ...BLIND_BOT.blind!, botCount: 0 } } })
    const snap = await a.next('ROOM_SNAPSHOT')
    a.send({ t: 'SIT_DOWN', seat: 0 })
    await a.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_SAT')
    expect((await a.next('BALANCE')).balance).toBe(90_000) // the buy-in's push: the table limit left the balance
    const room = ts.server.rooms.get(snap.room.roomId)!
    expect(room.view().players.find((p) => p.playerId === 'a')!.stack).toBe(10_000)

    // points granted elsewhere (a purchase, a daily reward) must reach the client, and leave the table stack alone
    ts.repos.records.get('a')!.balance = 142_000
    await ts.server.balanceChanged('a')
    expect((await a.next('BALANCE')).balance).toBe(142_000)
    expect(room.view().players.find((p) => p.playerId === 'a')!.stack).toBe(10_000)

    ts.server.notify('a', { t: 'NOTIFICATION', kind: 'DAILY_REWARD', payload: { amount: 500 } })
    expect(await a.next('NOTIFICATION')).toMatchObject({ kind: 'DAILY_REWARD', payload: { amount: 500 } })

    ts.server.notify('nobody', { t: 'NOTIFICATION', kind: 'X', payload: null }) // offline: a no-op, not a throw
    await ts.server.balanceChanged('b') // not in a room and not connected: also a no-op
  })

  it('renameIdentity: the next room seats the new name; the room already joined keeps the old one (T7)', async () => {
    ts = await startTestServer()
    const a = await connect('a')
    const b = await connect('b')
    a.send({ t: 'CREATE_ROOM', config: HOLDEM })
    const first = await a.next('ROOM_SNAPSHOT')
    b.send({ t: 'JOIN_ROOM', code: first.room.code })
    await b.next('ROOM_SNAPSHOT')

    ts.server.renameIdentity('a', 'Anh Moi')
    ts.server.renameIdentity('nobody', 'X') // offline: a no-op
    // The seat other people are reading keeps its name for as long as a is in this room.
    const room = ts.server.rooms.get(first.room.roomId)!
    expect(room.view().players.find((p) => p.playerId === 'a')!.displayName).toBe('A')

    a.send({ t: 'LEAVE_ROOM', reqId: 'leave' })
    await a.next('ACK', (m) => m.reqId === 'leave')
    a.send({ t: 'CREATE_ROOM', config: HOLDEM })
    const second = await a.next('ROOM_SNAPSHOT')
    expect(second.room.players.find((p) => p.playerId === 'a')!.displayName).toBe('Anh Moi')
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

describe('Gateway.disconnect (Plan 25)', () => {
  it('disconnect(playerId) closes that player’s socket with the code given and returns how many it closed', async () => {
    ts = await startTestServer()
    const a = await connect('a')
    expect(ts.server.gateway.disconnect('a')).toBe(1)
    expect(await a.closed).toMatchObject({ code: 4003, reason: 'LOCKED' })
    expect(ts.server.gateway.disconnect('nobody')).toBe(0)
  })
})
