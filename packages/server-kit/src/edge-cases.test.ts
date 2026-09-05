import type { RoomConfig } from '@bp/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createRoomHarness, TEST_ROOM_OPTIONS } from './testing/room-harness.js'
import { startTestServer, type TestServer } from './testing/harness.js'
import { TestClient } from './testing/test-client.js'

/**
 * Spec §30's edge-case table, row by row, for the rows the rest of the suite did not already cover
 * (`docs/test-matrix.md` maps every row to its test). Most of them are races between a client and
 * the room's own state machine, so they run over a real socket via `startTestServer`; two of them —
 * the timer/action race and a blind nobody can cover — are only reproducible with a clock the test
 * owns, and use `createRoomHarness` instead. Each says which and why.
 */

const HOLDEM: RoomConfig = { name: 'E', mode: 'holdem', maxPlayers: 4, isPrivate: false, turnTimerSec: 30, autoStart: false, holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 } }
const BLIND_BOT: RoomConfig = { name: 'B', mode: 'blind', maxPlayers: 4, isPrivate: false, turnTimerSec: 15, autoStart: false, blind: { holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1_000, botCount: 1 } }

let ts: TestServer
const clients: TestClient[] = []
let n = 0
const rid = () => `e${n++}`
const connect = async (id: string) => {
  const c = await TestClient.connect(ts.url)
  clients.push(c)
  await c.hello(`tok:${id}`)
  return c
}
afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => undefined)
  await ts?.close()
})

/** Creates a room on `host`, brings `rest` in by code, and returns the host's snapshot. */
async function openRoom(host: TestClient, rest: TestClient[], config: RoomConfig) {
  host.send({ t: 'CREATE_ROOM', config })
  const snap = await host.next('ROOM_SNAPSHOT')
  for (const c of rest) {
    c.send({ t: 'JOIN_ROOM', code: snap.room.code })
    await c.next('ROOM_SNAPSHOT')
  }
  return snap
}

/** Seats everyone in order, readies them, and has the host start the hand. */
async function seatAndStart(host: TestClient, all: { client: TestClient; id: string }[], buyIn?: number) {
  for (const [seat, m] of all.entries()) {
    expect(await m.client.request({ t: 'SIT_DOWN', reqId: rid(), seat, ...(buyIn === undefined ? {} : { buyIn }) })).toMatchObject({ t: 'ACK' })
    expect(await m.client.request({ t: 'READY', reqId: rid(), ready: true })).toMatchObject({ t: 'ACK' })
  }
  expect(await host.request({ t: 'START_GAME', reqId: rid() })).toMatchObject({ t: 'ACK' })
}

/**
 * Answers every turn passively (check, else call, else fold) from one client's event stream —
 * `seq` and `TURN_CHANGED` are room-wide, so one stream can drive every seat — until the hand ends.
 */
async function playOut(driver: TestClient, bySeat: Map<number, TestClient>, budget = 60): Promise<void> {
  for (let i = 0; i < budget; i++) {
    const m = await driver.next('GAME_EVENT', (x) => x.event.type === 'TURN_CHANGED' || x.event.type === 'HAND_COMPLETE', 8_000)
    if (m.event.type === 'HAND_COMPLETE') return
    if (m.event.type !== 'TURN_CHANGED') continue
    const seat = m.event.seat
    const c = bySeat.get(seat)
    if (!c) continue // an auto-folding seat: the room answers for it
    const kinds = m.event.legal.kinds
    const kind = kinds.includes('check') ? 'check' : kinds.includes('call') ? 'call' : 'fold'
    await c.request({ t: 'ACTION', reqId: rid(), baseSeq: m.seq, action: { kind } })
  }
  throw new Error('hand did not finish inside the budget')
}

describe('§30 — host leaves mid-hand', () => {
  it('the hand plays on without them, and the host passes to the earliest joiner once it ends', async () => {
    ts = await startTestServer({ players: [['a', 100_000], ['b', 100_000], ['c', 100_000]], roomOptions: { turnTimerMsOverride: 10_000 } })
    const a = await connect('a')
    const b = await connect('b')
    const c = await connect('c')
    const snap = await openRoom(a, [b, c], HOLDEM)
    await seatAndStart(a, [{ client: a, id: 'a' }, { client: b, id: 'b' }, { client: c, id: 'c' }], 20_000)
    await b.next('GAME_EVENT', (m) => m.event.type === 'HAND_STARTED')

    // The host walks out with the hand still running. It must neither cancel nor stall.
    expect(await a.request({ t: 'LEAVE_ROOM', reqId: rid() })).toMatchObject({ t: 'ACK' })
    const room = ts.server.rooms.get(snap.room.roomId)!
    expect(room.hostPlayerId).toBe('a') // still host, still in the hand: the transfer waits for the hand
    expect(room.handActive).toBe(true)

    await playOut(b, new Map([[1, b], [2, c]])) // seat 0 is the host's, and folds itself
    const changed = await b.next('ROOM_EVENT', (m) => m.event.type === 'HOST_CHANGED', 8_000)
    expect(changed.event).toMatchObject({ type: 'HOST_CHANGED', hostPlayerId: 'b' }) // b joined before c
    expect(room.hasPlayer('a')).toBe(false)
    expect(ts.repos.hands).toHaveLength(1)
    const summary = ts.repos.hands[0]!
    expect(summary.cancelled).toBe(false)
    // A settled hand plus a mid-hand cash-out is exactly the path where points could leak, so the
    // plan's money invariant is asserted here too: nothing is created, and the fee is the only sink.
    expect(summary.players.reduce((t, p) => t + p.net, 0) + summary.fee).toBe(0)
    const hostNet = summary.players.find((p) => p.playerId === 'a')!.net
    expect(await ts.repos.balances.get('a')).toBe(100_000 + hostNet)
  })
})

describe('§30 — two players sit down on one seat', () => {
  it('the queue lets exactly one in and the loser gets SEAT_TAKEN with their buy-in untouched', async () => {
    ts = await startTestServer({ players: [['a', 100_000], ['b', 100_000], ['c', 100_000]] })
    const a = await connect('a')
    const b = await connect('b')
    const c = await connect('c')
    const snap = await openRoom(a, [b, c], HOLDEM)

    // Both frames are in flight before either has been dispatched: the room's serial queue is the
    // only thing deciding this, and the loser's buy-in must be refunded inside the same slot.
    const first = rid()
    const second = rid()
    b.send({ t: 'SIT_DOWN', reqId: first, seat: 1, buyIn: 20_000 })
    c.send({ t: 'SIT_DOWN', reqId: second, seat: 1, buyIn: 20_000 })
    const answers = await Promise.all([b.answer(first), c.answer(second)])
    const acked = answers.filter((m) => m.t === 'ACK')
    const refused = answers.filter((m) => m.t === 'ERROR')
    expect(acked).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect(refused[0]).toMatchObject({ code: 'SEAT_TAKEN' })

    const room = ts.server.rooms.get(snap.room.roomId)!
    expect([...room.players.values()].filter((p) => p.seat === 1)).toHaveLength(1)
    const winner = [...room.players.values()].find((p) => p.seat === 1)!.identity.playerId
    const loser = winner === 'b' ? 'c' : 'b'
    expect(await ts.repos.balances.get(winner)).toBe(80_000)
    expect(await ts.repos.balances.get(loser)).toBe(100_000) // debited and refunded inside one slot
  })
})

describe('§30 — a timer and an action arriving together', () => {
  /**
   * Real sockets cannot land an action inside the same millisecond as a turn timer on demand, so
   * this one drives a `Room` against a `ManualClock`: both orderings are queued deliberately, which
   * is exactly the race §30 names ("hàng đợi tuần tự; timer kiểm `handId` + `turnSeq`").
   */
  const acted = (h: ReturnType<typeof createRoomHarness>, id: string, seat: number) =>
    h.ofType(id, 'GAME_EVENT').filter((m) => m.event.type === 'PLAYER_ACTED' && m.event.seat === seat)

  it('applies exactly one of them, whichever reached the queue first, and drops the other', async () => {
    const h = createRoomHarness(HOLDEM)
    await h.room.join(h.identity('a'))
    for (const [seat, id] of [[0, 'h'], [1, 'a']] as [number, string][]) {
      await h.room.sitDown(id, seat, 20_000)
      await h.room.setReady(id, true)
    }
    await h.room.startGame('h')

    // Round one: the action is queued first, so the timer that fires behind it is a no-op.
    const firstSeat = h.room.snapshot(null).hand!.actingSeat!
    const firstId = firstSeat === 0 ? 'h' : 'a'
    const before = acted(h, 'h', firstSeat).length
    const action = h.room.action(firstId, { kind: 'call' }, h.room.seq)
    h.clock.advance(TEST_ROOM_OPTIONS.turnTimerMsOverride!) // the turn timer is now queued behind it
    await action
    await h.room.enqueue(() => undefined)
    const applied = acted(h, 'h', firstSeat).slice(before)
    expect(applied).toHaveLength(1)
    expect(applied[0]!.event).toMatchObject({ type: 'PLAYER_ACTED', timedOut: false })

    // Round two: the timer wins the queue, and the action that lands behind it is refused rather
    // than applied to a turn that has already moved on.
    const secondSeat = h.room.snapshot(null).hand!.actingSeat!
    const secondId = secondSeat === 0 ? 'h' : 'a'
    const seen = acted(h, 'h', secondSeat).length
    h.clock.advance(TEST_ROOM_OPTIONS.turnTimerMsOverride!)
    const late = await h.room.action(secondId, { kind: 'call' }, h.room.seq).then(() => null, (e: Error & { code?: string }) => e.code)
    expect(['STALE_STATE', 'NOT_YOUR_TURN', 'NOT_IN_HAND']).toContain(late)
    const timedOut = acted(h, 'h', secondSeat).slice(seen)
    expect(timedOut).toHaveLength(1)
    expect(timedOut[0]!.event).toMatchObject({ type: 'PLAYER_ACTED', timedOut: true })
  })
})

describe("§30 — leaving a hold'em hand with chips already in the pot", () => {
  it('folds the seat and leaves the chips where they are: the leaver is never refunded', async () => {
    ts = await startTestServer({ players: [['a', 100_000], ['b', 100_000]], roomOptions: { turnTimerMsOverride: 10_000 } })
    const a = await connect('a')
    const b = await connect('b')
    await openRoom(a, [b], HOLDEM)
    await seatAndStart(a, [{ client: a, id: 'a' }, { client: b, id: 'b' }], 20_000)

    const turn = await a.next('GAME_EVENT', (m) => m.event.type === 'TURN_CHANGED')
    const actingSeat = turn.event.type === 'TURN_CHANGED' ? turn.event.seat : -1
    const [leaver, stayer] = actingSeat === 0 ? [a, b] : [b, a]
    const leaverId = actingSeat === 0 ? 'a' : 'b'
    const stayerId = leaverId === 'a' ? 'b' : 'a'
    // Put real money in the pot, then walk away from it.
    expect(await leaver.request({ t: 'ACTION', reqId: rid(), baseSeq: turn.seq, action: { kind: 'raise', amount: 1_000 } })).toMatchObject({ t: 'ACK' })
    expect(await leaver.request({ t: 'LEAVE_ROOM', reqId: rid() })).toMatchObject({ t: 'ACK' })

    await playOut(stayer, new Map([[actingSeat === 0 ? 1 : 0, stayer]]))
    await stayer.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_LEFT' && m.event.playerId === leaverId, 8_000)

    const summary = ts.repos.hands[0]!
    const leaverNet = summary.players.find((p) => p.playerId === leaverId)!.net
    const stayerNet = summary.players.find((p) => p.playerId === stayerId)!.net
    expect(leaverNet).toBeLessThanOrEqual(-1_000) // the raise stayed in the pot
    expect(leaverNet + stayerNet + summary.fee).toBe(0) // and went to the player who stayed
    // Cashed out at exactly what was left of the buy-in: nothing was handed back for the fold.
    expect(await ts.repos.balances.get(leaverId)).toBe(100_000 + leaverNet)
  })
})

describe('§30 — a player who cannot cover the blind', () => {
  /**
   * Only reachable after a player has been ground down below one blind: no buy-in a client may ask
   * for can produce it (§11.2 floors the buy-in at 20 BB, and `Room` enforces that), so the stack
   * is worn down here directly, the way a losing session would have done it.
   */
  it('posts what they have and is all-in for it, and the hand still balances', async () => {
    const h = createRoomHarness(HOLDEM)
    await h.room.join(h.identity('a'))
    await h.room.sitDown('h', 0, 20_000)
    h.room.players.get('h')!.stack = 50 // a quarter of the small blind, all that is left of the buy-in
    await h.room.sitDown('a', 1, 20_000)
    await h.room.setReady('h', true)
    await h.room.setReady('a', true)
    await h.room.startGame('h')

    const posts = h.ofType('h', 'GAME_EVENT').find((m) => m.event.type === 'BLINDS_POSTED')!.event
    expect(posts.type === 'BLINDS_POSTED' && posts.posts.find((p) => p.seat === 0)?.amount).toBe(50)
    const shortSeat = h.room.snapshot(null).hand!.seats.find((s) => s.seat === 0)!
    expect(shortSeat.allIn).toBe(true)
    expect(shortSeat.stack).toBe(0)
    expect(shortSeat.totalCommitted).toBe(50)

    for (let i = 0; i < 400 && h.room.handActive; i++) {
      const hand = h.room.snapshot('a').hand!
      if (hand.legal && hand.legal.kinds.length > 0) await h.room.action('a', { kind: hand.legal.kinds.includes('check') ? 'check' : 'call' }, h.room.seq)
      else {
        h.clock.advance(10)
        await h.room.enqueue(() => undefined)
      }
    }
    await h.room.enqueue(() => undefined)
    await h.room.enqueue(() => undefined)
    const summary = h.repos.hands[0]!
    expect(summary.players.reduce((s, p) => s + p.net, 0) + summary.fee).toBe(0)
    expect(summary.players.find((p) => p.seat === 0)!.net).toBeGreaterThanOrEqual(-50) // could never lose more
  })
})

describe('§30 — a balance that changes while the player is at a table', () => {
  it("touches the hold'em balance and leaves the chips on the table alone", async () => {
    ts = await startTestServer({ players: [['a', 100_000]] })
    const a = await connect('a')
    const snap = await openRoom(a, [], HOLDEM)
    expect(await a.request({ t: 'SIT_DOWN', reqId: rid(), seat: 0, buyIn: 20_000 })).toMatchObject({ t: 'ACK' })
    await a.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_SAT')
    const room = ts.server.rooms.get(snap.room.roomId)!
    expect(room.players.get('a')!.stack).toBe(20_000)

    // A daily reward lands while they are sitting there (§30, "balance thay đổi ngoài ván"). The
    // record is moved directly rather than through the ledger `apply` path a real reward would take:
    // the ledger lives above server-kit, so what this row can pin at this layer is the effect of the
    // resulting `balanceChanged` on the seat, not the crediting itself.
    ts.repos.records.get('a')!.balance = 85_000
    await ts.server.balanceChanged('a')
    expect((await a.next('BALANCE')).balance).toBe(85_000)
    expect(room.players.get('a')!.stack).toBe(20_000) // unchanged: hold'em chips are not the balance
  })
})

describe('§30 — bots do not stand in for people', () => {
  it('the seat a human vacates mid-hand stays empty: the table keeps exactly botCount bots', async () => {
    ts = await startTestServer({ players: [['a', 100_000], ['b', 100_000]] })
    const a = await connect('a')
    const b = await connect('b')
    const snap = await openRoom(a, [b], BLIND_BOT)
    const room = ts.server.rooms.get(snap.room.roomId)!
    // The room seats its bot at the far end (`maxPlayers - 1`), so seats 0 and 1 are the humans'.
    expect(room.seatedBotCount).toBe(1)
    await seatAndStart(a, [{ client: a, id: 'a' }, { client: b, id: 'b' }])
    await b.next('GAME_EVENT', (m) => m.event.type === 'HAND_STARTED')
    expect(room.players.get('b')!.seat).toBe(1)

    // b walks out of the seat mid-hand. The risk the row names is the room backfilling seat 1.
    expect(await b.request({ t: 'LEAVE_ROOM', reqId: rid() })).toMatchObject({ t: 'ACK' })
    const phase = await a.next('GAME_EVENT', (m) => m.event.type === 'DECISION_PHASE', 8_000)
    if (phase.event.type === 'DECISION_PHASE' && phase.event.seats.includes(0)) {
      await a.request({ t: 'ACTION', reqId: rid(), baseSeq: phase.seq, action: { kind: 'play' } })
    }
    await a.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_LEFT' && m.event.playerId === 'b', 8_000)

    expect(room.hasPlayer('b')).toBe(false)
    expect([...room.players.values()].filter((p) => p.seat === 1)).toEqual([]) // nobody moved in
    expect(room.seatedBotCount).toBe(1)
    expect([...room.players.values()].filter((p) => p.identity.isBot)).toHaveLength(1)
    expect(room.view().players.filter((p) => p.isBot).map((p) => p.playerId)).toEqual([`bot:${room.roomId}:0`])
  })
})

describe('§30 — a bet outside the legal range', () => {
  it('is refused as INVALID_AMOUNT and the message names the bounds that would have worked', async () => {
    ts = await startTestServer({ players: [['a', 100_000], ['b', 100_000]], roomOptions: { turnTimerMsOverride: 10_000 } })
    const a = await connect('a')
    const b = await connect('b')
    await openRoom(a, [b], HOLDEM)
    await seatAndStart(a, [{ client: a, id: 'a' }, { client: b, id: 'b' }], 20_000)
    const turn = await a.next('GAME_EVENT', (m) => m.event.type === 'TURN_CHANGED')
    const actor = turn.event.type === 'TURN_CHANGED' && turn.event.seat === 0 ? a : b
    const legal = turn.event.type === 'TURN_CHANGED' ? turn.event.legal : null

    const tooSmall = await actor.request({ t: 'ACTION', reqId: rid(), baseSeq: turn.seq, action: { kind: 'raise', amount: 1 } })
    expect(tooSmall).toMatchObject({ t: 'ERROR', code: 'INVALID_AMOUNT' })
    expect(tooSmall.t === 'ERROR' && tooSmall.message).toMatch(new RegExp(`between ${legal!.minRaiseTo} and ${legal!.maxRaiseTo}`))
    const tooBig = await actor.request({ t: 'ACTION', reqId: rid(), baseSeq: turn.seq, action: { kind: 'raise', amount: 999_999 } })
    expect(tooBig).toMatchObject({ t: 'ERROR', code: 'INVALID_AMOUNT' })
  })
})

describe('§30 — the same reqId sent again, on the same socket and on a fresh one', () => {
  /**
   * Spec §16.4: "Server nhớ 32 `reqId` gần nhất **mỗi kết nối**" — the ring buffer is a property of
   * the connection (`ClientConnection.rememberReq`), not of the player or the session. So the two
   * halves of the contract differ, and this test pins both:
   *
   * - on the *same* socket the cache answers, and the retransmission replays the original frame;
   * - on a *fresh* socket the cache is gone, so the request is re-evaluated on its merits and the
   *   `turnStartSeq` / turn guard refuses it — which is what keeps it from being applied twice.
   */
  it('replays on the connection that remembers it, and is re-evaluated — never re-applied — on a new one', async () => {
    ts = await startTestServer({ players: [['a', 100_000], ['b', 100_000]], roomOptions: { turnTimerMsOverride: 10_000 } })
    const a = await connect('a')
    const b = await connect('b')
    await openRoom(a, [b], HOLDEM)
    await seatAndStart(a, [{ client: a, id: 'a' }, { client: b, id: 'b' }], 20_000)
    const turn = await a.next('GAME_EVENT', (m) => m.event.type === 'TURN_CHANGED')
    const seat = turn.event.type === 'TURN_CHANGED' ? turn.event.seat : -1
    const [actor, actorId, other] = seat === 0 ? [a, 'a', b] : [b, 'b', a]

    const dup = rid()
    expect(await actor.request({ t: 'ACTION', reqId: dup, baseSeq: turn.seq, action: { kind: 'call' } })).toMatchObject({ t: 'ACK' })
    await other.next('GAME_EVENT', (m) => m.event.type === 'PLAYER_ACTED' && m.event.seat === seat)

    // Same connection: the ring buffer still holds the reqId, so the original ACK comes back rather
    // than the action being run a second time against a turn that has moved on.
    expect(await actor.request({ t: 'ACTION', reqId: dup, baseSeq: turn.seq, action: { kind: 'call' } })).toMatchObject({ t: 'ACK', reqId: dup })

    // Fresh connection for the same player: the buffer belonged to the socket that is now gone, so
    // there is nothing to replay and the retransmission is judged on its merits — and refused.
    const back = await connect(actorId)
    await back.next('ROOM_SNAPSHOT')
    const again = await back.request({ t: 'ACTION', reqId: dup, baseSeq: turn.seq, action: { kind: 'call' } })
    expect(again.t).toBe('ERROR')
    expect(['STALE_STATE', 'NOT_YOUR_TURN']).toContain(again.t === 'ERROR' ? again.code : '')

    // One action, applied once, across all three sends: neither path let it into the hand twice.
    const applied = other.received.filter((m) => m.t === 'GAME_EVENT' && m.event.type === 'PLAYER_ACTED' && m.event.seat === seat)
    expect(applied).toHaveLength(1)
  })
})
