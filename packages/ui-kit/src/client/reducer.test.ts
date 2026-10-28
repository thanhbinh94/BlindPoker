import {
  applyCommand, createHand, filterEvent, legalActions, parseCards, playerView, seededRng,
  type BlindRules, type GameEvent, type HandState, type HandView, type HoldemRules, type PlayerAction, type Rng, type RoomConfig, type RoomEvent, type RoomView, type ServerMessage,
} from '@bp/core'
import { describe, expect, it } from 'vitest'
import { initialClientState, reduceClient } from './reducer.js'
import type { ClientState } from './types.js'

const HOLDEM_RULES: HoldemRules = { mode: 'holdem', smallBlind: 100, bigBlind: 200, tableFeeRate: 0.02, tableFeeCapBB: 1 }
const BLIND_B: BlindRules = { mode: 'blind', holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1000, tableFeeRate: 0.02 }
const BLIND_A: BlindRules = { ...BLIND_B, decisionMode: 'none', holeCards: 3 }

function roomView(mode: 'holdem' | 'blind', rules: HoldemRules | BlindRules, stacks: number[]): RoomView {
  const config: RoomConfig = mode === 'holdem'
    ? { name: 'T', mode, maxPlayers: 6, isPrivate: false, turnTimerSec: 30, autoStart: false, holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 } }
    : { name: 'B', mode, maxPlayers: 6, isPrivate: false, turnTimerSec: 15, autoStart: false, blind: { holeCards: (rules as BlindRules).holeCards, decisionMode: (rules as BlindRules).decisionMode, fixedWager: 1000, botCount: 0 } }
  return {
    roomId: 'r', code: 'ABC234', name: config.name, mode, config: { ...config, hasPassword: false }, playerCount: stacks.length, maxPlayers: 6, status: 'IN_GAME',
    hostPlayerId: 'p0', carryOverPot: 0, nextHandAt: null,
    players: stacks.map((stack, seat) => ({ playerId: `p${seat}`, displayName: `P${seat}`, isBot: false, isHost: seat === 0, connected: true, seat, status: 'IN_HAND', sittingOut: false, stack, ready: true })),
  }
}

function start(mode: 'holdem' | 'blind', rules: HoldemRules | BlindRules, stacks: number[], me: number): ClientState {
  let s = reduceClient(initialClientState, { type: 'server', msg: { t: 'WELCOME', playerId: `p${me}`, displayName: `P${me}`, balance: 0, serverTime: 0 }, now: 0 })
  s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 10, room: roomView(mode, rules, stacks), hand: null, deadlineAt: null }, now: 0 })
  return s
}

/** Feeds a batch of engine events to the client exactly as the server would (filtered per viewer, one message per event). */
function feed(state: ClientState, events: GameEvent[], me: number | null, seqRef: { seq: number }): ClientState {
  for (const e of events) {
    seqRef.seq += 1
    const seen = filterEvent(e, me)
    if (seen !== null) state = reduceClient(state, { type: 'server', msg: { t: 'GAME_EVENT', seq: seqRef.seq, event: seen }, now: 0 })
  }
  return state
}

function expectMirror(client: ClientState, engine: HandState, me: number) {
  const view = playerView(engine, me)
  const hand = client.hand!
  expect(hand.handId).toBe(view.handId)
  expect(hand.community).toEqual(view.community)
  expect(hand.pot).toBe(view.pot)
  if (view.phase === 'DECISION' || view.phase === 'COMPLETE') expect(hand.phase).toBe(view.phase)
  if (view.phase === 'BETTING') expect(hand.actingSeat).toBe(view.actingSeat)
  expect(hand.mySeat).toBe(view.mySeat)
  for (const sv of view.seats) {
    const cs = hand.seats.find((x) => x.seat === sv.seat)!
    expect(cs, `seat ${sv.seat}`).toBeDefined()
    expect(cs.stack).toBe(sv.stack)
    expect(cs.folded).toBe(sv.folded)
    expect(cs.allIn).toBe(sv.allIn)
    expect(cs.cardCount).toBe(sv.cardCount)
    expect(cs.holeCards).toEqual(sv.holeCards)
    expect(cs.hasDecided).toBe(sv.hasDecided)
    if (view.phase !== 'COMPLETE') expect(cs.betThisStreet).toBe(sv.betThisStreet)
  }
  if (view.phase === 'COMPLETE') expect(hand.result?.payouts).toEqual(view.result?.payouts)
  if (view.phase === 'COMPLETE') expect(hand.result?.pots).toEqual(view.result?.pots)
  if (view.phase === 'BETTING' && view.actingSeat === me) expect(hand.legal).toEqual(view.legal)
  if (view.phase === 'DECISION' && !view.seats.find((s) => s.seat === me)?.hasDecided) expect(hand.legal?.kinds).toEqual(['play', 'fold'])
}

/** Picks a random legal command for whoever is on turn (or `ADVANCE` during a run-out). */
function nextCommand(state: HandState, rng: Rng): Parameters<typeof applyCommand>[1] {
  if (state.phase === 'REVEAL') return { type: 'ADVANCE' }
  const seat = state.phase === 'DECISION' ? state.players.find((p) => p.decision === null)!.seat : state.actingSeat!
  const legal = legalActions(state, seat)
  const kind = legal.kinds[rng.int(legal.kinds.length)]!
  const action: PlayerAction = kind === 'bet' ? { kind, amount: legal.minBet + rng.int(legal.maxBet - legal.minBet + 1) } : kind === 'raise' ? { kind, amount: legal.minRaiseTo + rng.int(legal.maxRaiseTo - legal.minRaiseTo + 1) } : { kind }
  return { type: 'ACTION', seat, action }
}

function seatsOf(stacks: number[]) {
  return stacks.map((stack, seat) => ({ seat, playerId: `p${seat}`, stack, isBot: false }))
}

function playThrough(mode: 'holdem' | 'blind', rules: HoldemRules | BlindRules, seed: number, me: number, stacks: number[]) {
  const rng = seededRng(seed)
  const seqRef = { seq: 10 }
  let client = start(mode, rules, stacks, me)
  let { state, events } = createHand({ handId: `h${seed}`, rules, seats: seatsOf(stacks), button: 0, carryOverIn: 0 }, rng)
  client = feed(client, events, me, seqRef)
  expectMirror(client, state, me)
  let guard = 0
  while (state.phase !== 'COMPLETE' && guard++ < 200) {
    ;({ state, events } = applyCommand(state, nextCommand(state, rng), rng))
    client = feed(client, events, me, seqRef)
    expectMirror(client, state, me)
  }
  expect(state.phase).toBe('COMPLETE')
  expect(client.hand!.phase).toBe('COMPLETE')
  expect(client.room!.players.find((p) => p.seat === me)!.stack).toBe(state.players.find((p) => p.seat === me)!.stack)
  // The stack the table keeps showing while the result is held back (the reveal hold) is the settled stack less what the
  // pots paid that seat; an uncalled bet handed back is not a result, so it is already in it.
  const result = client.hand!.result!
  for (const cs of client.hand!.seats) {
    const paid = result.payouts.filter((p) => p.seat === cs.seat).reduce((sum, p) => sum + p.amount, 0)
    expect(cs.stackBeforeResult, `seat ${cs.seat}: the stack before the pots were paid`).toBe(cs.stack - paid)
  }
  return client
}

describe('client reducer mirrors playerView through whole hands', () => {
  it('hold’em, 3 seats, 40 seeds', () => {
    for (let seed = 1; seed <= 40; seed++) playThrough('holdem', HOLDEM_RULES, seed, seed % 3, [20000, 20000, 20000])
  })
  it('blind mode B (2 cards), 4 seats, 40 seeds', () => {
    for (let seed = 1; seed <= 40; seed++) playThrough('blind', BLIND_B, seed, seed % 4, [50000, 50000, 50000, 50000])
  })
  it('blind mode A (3 cards), 2 seats, 20 seeds', () => {
    for (let seed = 1; seed <= 20; seed++) playThrough('blind', BLIND_A, seed, seed % 2, [50000, 50000])
  })
  it('spectator (not seated) sees no hole cards and has no legal actions', () => {
    const rng = seededRng(3)
    const seqRef = { seq: 10 }
    let client = start('holdem', HOLDEM_RULES, [20000, 20000], 5) // p5 is not in the room's seats
    client = { ...client, room: { ...client.room!, players: [...client.room!.players, { playerId: 'p5', displayName: 'P5', isBot: false, isHost: false, connected: true, seat: null, status: null, sittingOut: false, stack: 0, ready: false }] } }
    const { state, events } = createHand({ handId: 'x', rules: HOLDEM_RULES, seats: [{ seat: 0, playerId: 'p0', stack: 20000, isBot: false }, { seat: 1, playerId: 'p1', stack: 20000, isBot: false }], button: 0 }, rng)
    client = feed(client, events, null, seqRef)
    expect(client.hand!.mySeat).toBeNull()
    expect(client.hand!.legal).toBeNull()
    expect(client.hand!.seats.every((s) => s.holeCards === null && s.cardCount === 2)).toBe(true)
    expect(state.phase).toBe('BETTING')
  })
})

describe('HAND_CANCELLED', () => {
  it('hold’em: refunds every committed chip, zeroes the pot and marks the result cancelled', () => {
    const rng = seededRng(5)
    const seqRef = { seq: 10 }
    const me = 1
    const stacks = [20000, 20000, 20000]
    let client = start('holdem', HOLDEM_RULES, stacks, me)
    let { state, events } = createHand({ handId: 'c1', rules: HOLDEM_RULES, seats: seatsOf(stacks), button: 0 }, rng)
    client = feed(client, events, me, seqRef)

    const raiser = state.actingSeat!
    ;({ state, events } = applyCommand(state, { type: 'ACTION', seat: raiser, action: { kind: 'raise', amount: legalActions(state, raiser).minRaiseTo } }, rng))
    client = feed(client, events, me, seqRef)
    const caller = state.actingSeat!
    ;({ state, events } = applyCommand(state, { type: 'ACTION', seat: caller, action: { kind: 'call' } }, rng))
    client = feed(client, events, me, seqRef)
    expect(state.pot).toBeGreaterThan(0)
    expect(client.hand!.pot).toBe(state.pot)
    expectMirror(client, state, me)

    ;({ state, events } = applyCommand(state, { type: 'CANCEL', reason: 'shutdown' }, rng))
    client = feed(client, events, me, seqRef)

    const hand = client.hand!
    expect(hand.phase).toBe('COMPLETE')
    expect(hand.result).toEqual({ cancelled: true, reason: 'shutdown', payouts: [], pots: [], fee: 0, showdown: null, carryOverOut: 0, uncalledReturned: null })
    expect(hand.pot).toBe(0)
    expect(state.pot).toBe(0)
    for (const p of state.players) {
      const cs = hand.seats.find((s) => s.seat === p.seat)!
      expect(cs.stack, `seat ${p.seat} stack`).toBe(p.stack)
      expect(cs.stack).toBe(stacks[p.seat])
      expect(cs.betThisStreet).toBe(0)
      expect(cs.allIn).toBe(false)
      expect(client.room!.players.find((rp) => rp.seat === p.seat)!.stack).toBe(p.stack)
    }
  })

  it('blind: refunds the antes mid-decision and hands the carry-over back out', () => {
    const rng = seededRng(7)
    const seqRef = { seq: 10 }
    const me = 1
    const stacks = [50000, 50000, 50000]
    let client = start('blind', BLIND_B, stacks, me)
    let { state, events } = createHand({ handId: 'c2', rules: BLIND_B, seats: seatsOf(stacks), button: 0, carryOverIn: 1500 }, rng)
    client = feed(client, events, me, seqRef)
    expect(state.phase).toBe('DECISION')
    expect(client.hand!.pot).toBe(1500 + 3 * BLIND_B.fixedWager)
    expectMirror(client, state, me)

    const first = state.players.find((p) => p.decision === null)!.seat
    ;({ state, events } = applyCommand(state, { type: 'ACTION', seat: first, action: { kind: 'play' } }, rng))
    client = feed(client, events, me, seqRef)
    expect(client.hand!.seats.find((s) => s.seat === first)!.hasDecided).toBe(true)
    expectMirror(client, state, me)

    ;({ state, events } = applyCommand(state, { type: 'CANCEL', reason: 'room closed' }, rng))
    client = feed(client, events, me, seqRef)

    const hand = client.hand!
    expect(hand.phase).toBe('COMPLETE')
    expect(hand.result).toMatchObject({ cancelled: true, reason: 'room closed', carryOverOut: 1500, payouts: [], fee: 0 })
    expect(hand.pot).toBe(0)
    for (const p of state.players) {
      const cs = hand.seats.find((s) => s.seat === p.seat)!
      expect(cs.stack, `seat ${p.seat} ante refunded`).toBe(50000)
      expect(cs.stack).toBe(p.stack)
      expect(cs.betThisStreet).toBe(0)
      expect(cs.allIn).toBe(false)
      expect(client.room!.players.find((rp) => rp.seat === p.seat)!.stack).toBe(p.stack)
    }
  })
})

describe('mid-hand reconnect', () => {
  it('rebuilds from a snapshot after the flop and keeps mirroring through the rest of the hand', () => {
    const rng = seededRng(11)
    const seqRef = { seq: 10 }
    const me = 1
    const stacks = [20000, 20000, 20000]
    let client = start('holdem', HOLDEM_RULES, stacks, me)
    let { state, events } = createHand({ handId: 'rc', rules: HOLDEM_RULES, seats: seatsOf(stacks), button: 0 }, rng)
    client = feed(client, events, me, seqRef)

    // Passive preflop so the flop is guaranteed to come out with the hand still live.
    while (state.community.length === 0) {
      const seat = state.actingSeat!
      const kind = legalActions(state, seat).kinds.includes('check') ? 'check' : 'call'
      ;({ state, events } = applyCommand(state, { type: 'ACTION', seat, action: { kind } }, rng))
      client = feed(client, events, me, seqRef)
    }
    expect(state.phase).toBe('BETTING')
    expect(state.community).toHaveLength(3)
    expectMirror(client, state, me)

    // Drop everything the event stream built and rebuild from a snapshot, the way a reconnect does.
    seqRef.seq += 1
    client = reduceClient({ ...client, hand: null }, { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: seqRef.seq, room: client.room!, hand: playerView(state, me), deadlineAt: null }, now: 0 })
    expect(client.resyncNeeded).toBe(false)
    expectMirror(client, state, me)

    let guard = 0
    while (state.phase !== 'COMPLETE' && guard++ < 200) {
      ;({ state, events } = applyCommand(state, nextCommand(state, rng), rng))
      client = feed(client, events, me, seqRef)
      expectMirror(client, state, me)
    }
    expect(state.phase).toBe('COMPLETE')
    expect(client.hand!.phase).toBe('COMPLETE')
    expect(client.room!.players.find((p) => p.seat === me)!.stack).toBe(state.players.find((p) => p.seat === me)!.stack)
  })
})

describe('client reducer — snapshot, room events, errors', () => {
  it('builds the hand from a snapshot and patches room membership', () => {
    const room = roomView('holdem', HOLDEM_RULES, [20000, 20000])
    const rng = seededRng(9)
    const { state } = createHand({ handId: 'snap', rules: HOLDEM_RULES, seats: [{ seat: 0, playerId: 'p0', stack: 20000, isBot: false }, { seat: 1, playerId: 'p1', stack: 20000, isBot: false }], button: 0 }, rng)
    let s = reduceClient(initialClientState, { type: 'server', msg: { t: 'WELCOME', playerId: 'p1', displayName: 'P1', balance: 5, serverTime: 1000 }, now: 400 })
    expect(s.serverTimeOffset).toBe(600)
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 42, room, hand: playerView(state, 1), deadlineAt: 99 }, now: 0 })
    expectMirror(s, state, 1)
    expect(s.deadlineAt).toBe(99)
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq: 43, event: { type: 'PLAYER_JOINED', player: { playerId: 'p9', displayName: 'P9', isBot: false, isHost: false, connected: true, seat: null, status: null, sittingOut: false, stack: 0, ready: false } } }, now: 0 })
    expect(s.room!.players.map((p) => p.playerId)).toEqual(['p0', 'p1', 'p9'])
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq: 44, event: { type: 'HOST_CHANGED', hostPlayerId: 'p1' } }, now: 0 })
    expect(s.room!.hostPlayerId).toBe('p1')
    expect(s.room!.players.find((p) => p.playerId === 'p1')!.isHost).toBe(true)
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq: 40, event: { type: 'PLAYER_LEFT', playerId: 'p9' } }, now: 0 })
    expect(s.resyncNeeded).toBe(true) // seq went backwards
    s = reduceClient(s, { type: 'resyncSent' })
    s = reduceClient(s, { type: 'server', msg: { t: 'ERROR', code: 'STALE_STATE', message: 'x' }, now: 5 })
    expect(s.lastError).toMatchObject({ code: 'STALE_STATE', at: 5 })
    expect(s.resyncNeeded).toBe(true)
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq: 45, event: { type: 'ROOM_CLOSED', reason: 'empty' } }, now: 0 })
    expect(s.room).toBeNull()
    expect(s.hand).toBeNull()
    expect(s.notifications.at(-1)).toMatchObject({ kind: 'ROOM_CLOSED' })
    s = reduceClient(s, { type: 'server', msg: { t: 'SESSION_REPLACED' } as ServerMessage, now: 0 })
    expect(s.replaced).toBe(true)
  })

  it('PLAYER_SIT_OUT moves the seat status both ways between hands, and leaves the seatless and the offline alone', () => {
    let s = start('holdem', HOLDEM_RULES, [20000, 20000], 1)
    const statusOf = (id: string) => s.room!.players.find((p) => p.playerId === id)!.status
    const flagOf = (id: string) => s.room!.players.find((p) => p.playerId === id)!.sittingOut
    const sitOut = (playerId: string, sittingOut: boolean, seq: number): ClientState =>
      reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq, event: { type: 'PLAYER_SIT_OUT', playerId, sittingOut } }, now: 0 })

    // The fixture's seats are dealt in; the hand has to be over before SITTING_OUT is the seat's whole story.
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq: 11, event: { type: 'PLAYER_READY', playerId: 'p1', ready: true } }, now: 0 })
    expect(statusOf('p1')).toBe('READY')

    s = sitOut('p1', true, 12)
    expect(statusOf('p1')).toBe('SITTING_OUT')
    expect(flagOf('p1')).toBe(true)
    s = sitOut('p1', false, 13)
    expect(statusOf('p1')).toBe('READY') // the fixture's seats are ready; an unready one goes back to SEATED
    expect(flagOf('p1')).toBe(false)

    // A spectator has no seat to sit out of, and a seat that is offline keeps saying so.
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq: 14, event: { type: 'PLAYER_JOINED', player: { playerId: 'p9', displayName: 'P9', isBot: false, isHost: false, connected: true, seat: null, status: null, sittingOut: false, stack: 0, ready: false } } }, now: 0 })
    s = sitOut('p9', true, 15)
    expect(statusOf('p9')).toBeNull()
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq: 16, event: { type: 'PLAYER_DISCONNECTED', playerId: 'p0', deadline: 0 } }, now: 0 })
    s = sitOut('p0', true, 17)
    expect(statusOf('p0')).toBe('DISCONNECTED')
    expect(flagOf('p0')).toBe(true) // the status yields to being offline; the request itself is still recorded
  })

  /**
   * `Room.playerView` ranks IN_HAND above SITTING_OUT (spec §11.3, docs/server-kit.md), and the server plays the
   * current hand out. So the event may not repaint a seat that still holds cards: it would put the muted pill on
   * the seat the table is waiting on, and the next snapshot would silently take it away again.
   */
  it('leaves a seat that still holds cards reading IN_HAND, and a snapshot agrees', () => {
    let s = start('holdem', HOLDEM_RULES, [20000, 20000], 1)
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq: 11, event: { type: 'PLAYER_SIT_OUT', playerId: 'p1', sittingOut: true } }, now: 0 })
    const seat = () => s.room!.players.find((p) => p.playerId === 'p1')!
    expect(seat().status).toBe('IN_HAND') // the flag moved; the status did not
    expect(seat().sittingOut).toBe(true)

    // A RESYNC answers with the room as the server holds it: still in the hand, and still sitting out — the
    // same two values the event left behind, so nothing flickers when the snapshot lands.
    const room = roomView('holdem', HOLDEM_RULES, [20000, 20000])
    room.players = room.players.map((p) => (p.playerId === 'p1' ? { ...p, status: 'IN_HAND' as const, sittingOut: true } : p))
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 20, room, hand: null, deadlineAt: null }, now: 0 })
    expect(seat().status).toBe('IN_HAND')
    expect(seat().sittingOut).toBe(true)

    // Sitting back in mid-hand is the same story from the other side: only the flag moves.
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq: 21, event: { type: 'PLAYER_SIT_OUT', playerId: 'p1', sittingOut: false } }, now: 0 })
    expect(seat().status).toBe('IN_HAND')
    expect(seat().sittingOut).toBe(false)

    // And a seat given back forgets it, so a fresh sit-down never starts pre-pressed.
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq: 22, event: { type: 'PLAYER_SIT_OUT', playerId: 'p1', sittingOut: true } }, now: 0 })
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq: 23, event: { type: 'PLAYER_STOOD', playerId: 'p1', seat: 1 } }, now: 0 })
    expect(seat().sittingOut).toBe(false)
  })
})

/** docs/server-kit.md, "Reconnecting and frame order": WELCOME first, a snapshot only if we are still in a room. */
describe('session handshake', () => {
  const welcome: ServerMessage = { t: 'WELCOME', playerId: 'p1', displayName: 'P1', balance: 5, serverTime: 0 }

  it('starts with no confirmed room and asks for one as soon as WELCOME lands', () => {
    expect(initialClientState.roomStale).toBe(true)
    const s = reduceClient(initialClientState, { type: 'server', msg: welcome, now: 0 })
    expect(s.roomStale).toBe(true)
    expect(s.resyncNeeded).toBe(true)
  })

  it('WELCOME → RESYNC → snapshot restores the room we were already sitting in', () => {
    const room = roomView('holdem', HOLDEM_RULES, [20000, 20000])
    let s = reduceClient(initialClientState, { type: 'server', msg: welcome, now: 0 })
    s = reduceClient(s, { type: 'resyncSent' })
    expect(s.resyncNeeded).toBe(false)
    expect(s.roomStale).toBe(true) // still unconfirmed: the answer has not arrived
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 7, room, hand: null, deadlineAt: null }, now: 0 })
    expect(s.roomStale).toBe(false)
    expect(s.room?.roomId).toBe('r')
  })

  it('WELCOME → RESYNC → NOT_IN_ROOM clears the stale room without surfacing an error', () => {
    const room = roomView('holdem', HOLDEM_RULES, [20000, 20000])
    let s = reduceClient(initialClientState, { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 7, room, hand: null, deadlineAt: null }, now: 0 })
    s = reduceClient(s, { type: 'server', msg: welcome, now: 0 })
    expect(s.room).not.toBeNull() // the room stays on screen while the probe is in flight
    s = reduceClient(s, { type: 'resyncSent' })
    s = reduceClient(s, { type: 'server', msg: { t: 'ERROR', code: 'NOT_IN_ROOM', message: 'not in a room' }, now: 9 })
    expect(s.room).toBeNull()
    expect(s.hand).toBeNull()
    expect(s.seq).toBe(0)
    expect(s.deadlineAt).toBeNull()
    expect(s.roomStale).toBe(false)
    expect(s.lastError).toBeNull() // an expected probe answer, not a refusal to show the player
  })

  it('counts each "still in a room" answer to a (re)connect, and nothing else (T5)', () => {
    const room = roomView('holdem', HOLDEM_RULES, [20000, 20000])
    const snapshot: ServerMessage = { t: 'ROOM_SNAPSHOT', seq: 7, room, hand: null, deadlineAt: null }
    expect(initialClientState.roomReturns).toBe(0)

    // Connect: WELCOME, then the snapshot the server sends because we are still in a room — one return.
    let s = reduceClient(initialClientState, { type: 'server', msg: welcome, now: 0 })
    s = reduceClient(s, { type: 'server', msg: snapshot, now: 0 })
    expect(s.roomReturns).toBe(1)
    // The answer to the hook's own RESYNC, a moment later, is the same news: not a second return.
    s = reduceClient(s, { type: 'server', msg: { ...snapshot, seq: 8 }, now: 0 })
    expect(s.roomReturns).toBe(1)

    // Leaving, then a room event that sends the client after a snapshot: not a return either.
    s = reduceClient(s, { type: 'leftRoom' })
    s = reduceClient(s, { type: 'server', msg: { ...snapshot, seq: 9 }, now: 0 })
    expect(s.roomReturns).toBe(1)

    // A dropped socket comes back: WELCOME, still in the room — the second return.
    s = reduceClient(s, { type: 'server', msg: welcome, now: 0 })
    s = reduceClient(s, { type: 'server', msg: { ...snapshot, seq: 10 }, now: 0 })
    expect(s.roomReturns).toBe(2)

    // And a reconnect the server answers with NOT_IN_ROOM counts nothing.
    s = reduceClient(s, { type: 'server', msg: welcome, now: 0 })
    s = reduceClient(s, { type: 'server', msg: { t: 'ERROR', code: 'NOT_IN_ROOM', message: 'not in a room' }, now: 0 })
    expect(s.roomReturns).toBe(2)
    expect(reduceClient(s, { type: 'reset' }).roomReturns).toBe(0)
  })
})

describe('notifications', () => {
  it('keeps at most five, dropping the oldest', () => {
    let s = initialClientState
    for (let i = 1; i <= 8; i++) {
      s = reduceClient(s, { type: 'server', msg: { t: 'NOTIFICATION', kind: `K${i}`, payload: null }, now: i })
    }
    expect(s.notifications).toHaveLength(5)
    expect(s.notifications.map((n) => n.kind)).toEqual(['K4', 'K5', 'K6', 'K7', 'K8'])
    expect(new Set(s.notifications.map((n) => n.id)).size).toBe(5)
  })
})

describe('frames with nothing to apply ask for a snapshot', () => {
  const started: GameEvent = { type: 'HAND_STARTED', handId: 'h', mode: 'holdem', button: 0, seats: [0, 1], carryOverIn: 0 }

  it('a game event with no hand advances seq and sets resyncNeeded', () => {
    const room = roomView('holdem', HOLDEM_RULES, [20000, 20000])
    let s = reduceClient(initialClientState, { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 7, room, hand: null, deadlineAt: null }, now: 0 })
    expect(s.hand).toBeNull()
    s = reduceClient(s, { type: 'server', msg: { t: 'GAME_EVENT', seq: 8, event: { type: 'POT_UPDATED', pot: 400 } }, now: 0 })
    expect(s.seq).toBe(8)
    expect(s.resyncNeeded).toBe(true)
  })

  it('HAND_STARTED with no room sets resyncNeeded', () => {
    const s = reduceClient(initialClientState, { type: 'server', msg: { t: 'GAME_EVENT', seq: 3, event: started }, now: 0 })
    expect(s.hand).toBeNull()
    expect(s.seq).toBe(3)
    expect(s.resyncNeeded).toBe(true)
  })

  it('a room event with no room sets resyncNeeded', () => {
    const s = reduceClient(initialClientState, {
      type: 'server',
      msg: { t: 'ROOM_EVENT', seq: 4, event: { type: 'PLAYER_READY', playerId: 'p0', ready: true } },
      now: 0,
    })
    expect(s.seq).toBe(4)
    expect(s.resyncNeeded).toBe(true)
  })
})

describe('PLAYER_LEFT that names me', () => {
  it('takes the room off the client, as a leave it asked for would — a Leave that only took effect at the hand’s end', () => {
    let s = start('holdem', HOLDEM_RULES, [20000, 20000], 1)
    s = reduceClient(s, { type: 'autoPlay', on: true })
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq: 30, event: { type: 'PLAYER_LEFT', playerId: 'p1' } }, now: 0 })
    expect(s.room).toBeNull()
    expect(s.hand).toBeNull()
    expect(s.roomStale).toBe(false) // confirmed gone: the room screen hands over to the app
    expect(s.autoPlay).toBe(false)
    expect(s.resyncNeeded).toBe(false) // nothing to ask for: the server just said so
    expect(s.lastError).toBeNull()
  })

  it('a kick: the KICKED notice stays a toast, and the room goes once, through PLAYER_LEFT', () => {
    let s = start('holdem', HOLDEM_RULES, [20000, 20000], 1)
    s = reduceClient(s, { type: 'server', msg: { t: 'NOTIFICATION', kind: 'KICKED', payload: { roomId: 'r' } }, now: 5 })
    expect(s.room).not.toBeNull() // the notice alone moves nothing
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq: 30, event: { type: 'PLAYER_LEFT', playerId: 'p1' } }, now: 6 })
    expect(s.room).toBeNull()
    expect(s.notifications.map((n) => n.kind)).toEqual(['KICKED'])
    expect(s.lastError).toBeNull()
  })

  it('someone else leaving only shortens the roster', () => {
    let s = start('holdem', HOLDEM_RULES, [20000, 20000], 1)
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq: 30, event: { type: 'PLAYER_LEFT', playerId: 'p0' } }, now: 0 })
    expect(s.room?.players.map((p) => p.playerId)).toEqual(['p1'])
  })
})

describe('renamed (T7)', () => {
  it('gives `me` the new name at once, and leaves the table roster as the server named it', () => {
    let s = start('blind', BLIND_B, [5000, 5000], 1)
    s = reduceClient(s, { type: 'renamed', displayName: 'Minh Sài Gòn' })
    expect(s.me).toEqual({ playerId: 'p1', displayName: 'Minh Sài Gòn' })
    expect(s.room?.players.find((p) => p.playerId === 'p1')?.displayName).toBe('P1')
  })

  it('has nobody to rename before WELCOME', () => {
    expect(reduceClient(initialClientState, { type: 'renamed', displayName: 'Minh' })).toBe(initialClientState)
  })
})

describe('reset', () => {
  it('forgets the session: identity, balance, room, hand and notifications all go back to nothing', () => {
    const room = roomView('holdem', HOLDEM_RULES, [20000, 20000])
    let s = reduceClient(initialClientState, { type: 'server', msg: { t: 'WELCOME', playerId: 'p1', displayName: 'P1', balance: 123_000, serverTime: 0 }, now: 0 })
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 7, room, hand: null, deadlineAt: null }, now: 0 })
    s = reduceClient(s, { type: 'server', msg: { t: 'NOTIFICATION', kind: 'ACHIEVEMENT_UNLOCKED', payload: { id: 'login_days_7' } }, now: 0 })
    s = reduceClient(s, { type: 'status', status: 'open' })
    expect(s.me).not.toBeNull()
    expect(s.notifications).toHaveLength(1)

    // The next player on this machine must not be greeted by the previous one's name, points or table.
    expect(reduceClient(s, { type: 'reset' })).toEqual(initialClientState)
  })
})

describe('pre-actions', () => {
  /** Deals a three-handed hold'em hand seen from `me` and hands back the engine and client side by side. */
  function dealt(me: number, seed = 11) {
    const rng = seededRng(seed)
    const seqRef = { seq: 10 }
    const stacks = [20000, 20000, 20000]
    let client = start('holdem', HOLDEM_RULES, stacks, me)
    const created = createHand({ handId: `pa${seed}`, rules: HOLDEM_RULES, seats: seatsOf(stacks), button: 0 }, rng)
    client = feed(client, created.events, me, seqRef)
    return { client, state: created.state, rng, seqRef, me }
  }
  const tick = (client: ClientState, kind: 'checkFold' | 'callAny' | 'fold') => reduceClient(client, { type: 'preAction', kind })

  it('pins a tick to the hand it was made in, and refuses one outside a hand', () => {
    const { client } = dealt(1)
    expect(tick(client, 'callAny').preAction).toEqual({ kind: 'callAny', handId: client.hand!.handId })
    expect(reduceClient(tick(client, 'callAny'), { type: 'preAction', kind: null }).preAction).toBeNull()
    expect(tick(initialClientState, 'fold').preAction).toBeNull()
  })

  it('clears the tick when I act, and keeps it while others act', () => {
    const { seqRef, me } = dealt(1)
    let client = tick(dealt(1).client, 'checkFold')
    // Someone else acting leaves the tick standing; my own action — by hand or by the tick — closes it.
    const other = (me + 1) % 3
    client = feed(client, [{ type: 'PLAYER_ACTED', seat: other, action: { kind: 'call' }, amount: 200, stack: 19800, allIn: false, timedOut: false }], me, seqRef)
    expect(client.preAction?.kind).toBe('checkFold')
    client = feed(client, [{ type: 'PLAYER_ACTED', seat: me, action: { kind: 'fold' }, amount: 0, stack: 20000, allIn: false, timedOut: false }], me, seqRef)
    expect(client.preAction).toBeNull()
  })

  it('clears the tick on a new street, at the end of the hand, and when a new hand starts', () => {
    const { client, me, seqRef } = dealt(1)
    const flop = feed(tick(client, 'callAny'), [{ type: 'COMMUNITY_REVEALED', street: 'FLOP', cards: parseCards('Ah Kd 2c'), community: parseCards('Ah Kd 2c') }], me, seqRef)
    expect(flop.preAction).toBeNull()

    const over = feed(tick(client, 'callAny'), [{ type: 'HAND_COMPLETE' }], me, seqRef)
    expect(over.preAction).toBeNull()

    const rng = seededRng(12)
    const next = createHand({ handId: 'pa-next', rules: HOLDEM_RULES, seats: seatsOf([20000, 20000, 20000]), button: 1 }, rng)
    const restarted = feed(tick(client, 'fold'), next.events, me, seqRef)
    expect(restarted.preAction).toBeNull()
  })

  it('keeps the tick through a run-out reveal, where no betting resumes', () => {
    const { client: dealtClient, me, seqRef } = dealt(1)
    let client: ClientState = { ...dealtClient, hand: { ...dealtClient.hand!, seats: dealtClient.hand!.seats.map((s) => (s.seat === me ? s : { ...s, allIn: true })) } }
    client = feed(tick(client, 'callAny'), [{ type: 'COMMUNITY_REVEALED', street: 'FLOP', cards: parseCards('Ah Kd 2c'), community: parseCards('Ah Kd 2c') }], me, seqRef)
    expect(client.preAction?.kind).toBe('callAny')
  })

  it('drops the tick and auto-play on leaving, on a snapshot, and when I stand or sit out', () => {
    const { client, me, seqRef } = dealt(1)
    const s = reduceClient(tick(client, 'fold'), { type: 'autoPlay', on: true })
    expect(s.autoPlay).toBe(true)

    expect(reduceClient(s, { type: 'leftRoom' })).toMatchObject({ preAction: null, autoPlay: false })
    expect(reduceClient(s, { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 99, room: s.room!, hand: null, deadlineAt: null }, now: 0 }).preAction).toBeNull()

    seqRef.seq += 1
    const stood = reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq: seqRef.seq, event: { type: 'PLAYER_STOOD', playerId: `p${me}`, seat: me } }, now: 0 })
    expect(stood).toMatchObject({ preAction: null, autoPlay: false })

    seqRef.seq += 1
    const out = reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq: seqRef.seq, event: { type: 'PLAYER_SIT_OUT', playerId: `p${me}`, sittingOut: true } }, now: 0 })
    expect(out.autoPlay).toBe(false)

    seqRef.seq += 1
    const someoneElse = reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq: seqRef.seq, event: { type: 'PLAYER_STOOD', playerId: 'p0', seat: 0 } }, now: 0 })
    expect(someoneElse).toMatchObject({ preAction: { kind: 'fold' }, autoPlay: true })
  })
})

describe('squeeze mode (spec 2026-10-08)', () => {
  const SQUEEZE: BlindRules = { ...BLIND_A, holeCards: 2, squeeze: true }
  const squeezeRoom = (stacks: number[]): RoomView => {
    const room = roomView('blind', SQUEEZE, stacks)
    return { ...room, config: { ...room.config, turnTimerSec: 20, blind: { ...room.config.blind!, squeeze: true } } }
  }

  it('starts a pure-luck squeeze hand in SQUEEZE with my seat unrevealed and the bot revealed, then follows the round', () => {
    let s = reduceClient(initialClientState, { type: 'server', msg: { t: 'WELCOME', playerId: 'p0', displayName: 'P0', balance: 0, serverTime: 0 }, now: 0 })
    const room = squeezeRoom([5000, 5000])
    room.players[1]!.isBot = true
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 1, room, hand: null, deadlineAt: null }, now: 0 })
    s = reduceClient(s, { type: 'server', msg: { t: 'GAME_EVENT', seq: 2, event: { type: 'HAND_STARTED', handId: 'h1', mode: 'blind', button: 0, seats: [0, 1], carryOverIn: 0 } }, now: 0 })
    expect(s.hand).toMatchObject({ phase: 'SQUEEZE', restored: false, seats: [{ seat: 0, revealed: false }, { seat: 1, revealed: true }] })
    s = reduceClient(s, { type: 'server', msg: { t: 'GAME_EVENT', seq: 3, event: { type: 'SQUEEZE_PHASE', seats: [0], turnSeq: 1, deadlineAt: 20_000 } }, now: 0 })
    expect(s.deadlineAt).toBe(20_000)
    expect(s.hand?.phase).toBe('SQUEEZE')
    s = reduceClient(s, { type: 'server', msg: { t: 'GAME_EVENT', seq: 4, event: { type: 'PLAYER_REVEALED', seat: 0 } }, now: 0 })
    expect(s.hand?.seats[0]?.revealed).toBe(true)
    s = reduceClient(s, { type: 'server', msg: { t: 'GAME_EVENT', seq: 5, event: { type: 'SQUEEZE_ENDED' } }, now: 0 })
    expect(s.hand?.phase).toBe('REVEAL')
    expect(s.deadlineAt).toBeNull()
  })

  it('a hand from a snapshot is restored, and keeps the view’s revealed flags', () => {
    const s = start('blind', SQUEEZE, [5000, 5000], 0)
    const room = squeezeRoom([5000, 5000])
    const res = createHand({ handId: 'h2', rules: SQUEEZE, seats: [{ seat: 0, playerId: 'p0', stack: 5000, isBot: false }, { seat: 1, playerId: 'p1', stack: 5000, isBot: false }], button: 0, carryOverIn: 0 }, seededRng(1))
    const turned = applyCommand(res.state, { type: 'REVEALED', seat: 1 }, seededRng(1)).state
    const next = reduceClient(s, { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 9, room, hand: playerView(turned, 0), deadlineAt: 20_000 }, now: 0 })
    expect(next.hand).toMatchObject({ phase: 'SQUEEZE', restored: true, seats: [{ revealed: false }, { revealed: true }] })
  })

  it('a plain hand carries no revealed flag at all', () => {
    const s = start('blind', BLIND_A, [5000, 5000], 0)
    const next = reduceClient(s, { type: 'server', msg: { t: 'GAME_EVENT', seq: 2, event: { type: 'HAND_STARTED', handId: 'h3', mode: 'blind', button: 0, seats: [0, 1], carryOverIn: 0 } }, now: 0 })
    expect(next.hand?.seats.every((seat) => seat.revealed === undefined)).toBe(true)
    expect(next.hand?.phase).toBe('REVEAL')
  })

  it('a snapshot of a plain hand carries no revealed flag either, although the view always has one', () => {
    const s = start('blind', BLIND_A, [5000, 5000], 0)
    const res = createHand({ handId: 'h4', rules: BLIND_A, seats: [{ seat: 0, playerId: 'p0', stack: 5000, isBot: false }, { seat: 1, playerId: 'p1', stack: 5000, isBot: false }], button: 0, carryOverIn: 0 }, seededRng(1))
    const next = reduceClient(s, { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 9, room: s.room!, hand: playerView(res.state, 0), deadlineAt: null }, now: 0 })
    expect(next.hand?.restored).toBe(true)
    expect(next.hand?.seats.every((seat) => seat.revealed === undefined)).toBe(true)
  })

  it('a squeeze room that plays or folds opens in DECISION, with the seats still unrevealed', () => {
    const room = squeezeRoom([5000, 5000])
    room.config.blind!.decisionMode = 'playOrFold'
    let s = reduceClient(initialClientState, { type: 'server', msg: { t: 'WELCOME', playerId: 'p0', displayName: 'P0', balance: 0, serverTime: 0 }, now: 0 })
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 1, room, hand: null, deadlineAt: null }, now: 0 })
    s = reduceClient(s, { type: 'server', msg: { t: 'GAME_EVENT', seq: 2, event: { type: 'HAND_STARTED', handId: 'h5', mode: 'blind', button: 0, seats: [0, 1], carryOverIn: 0 } }, now: 0 })
    expect(s.hand).toMatchObject({ phase: 'DECISION', seats: [{ revealed: false }, { revealed: false }] })
  })
})

describe('short stacks in play-or-fold (plan 27 D2)', () => {
  const deal = (stacks: number[]) =>
    createHand({ handId: 'hs', rules: BLIND_B, seats: stacks.map((stack, seat) => ({ seat, playerId: `p${seat}`, stack, isBot: false })), button: 0, carryOverIn: 0 }, seededRng(3))

  it('offers a seat short of the second wager the play for what the ante left: callAmount is min(stack, wager)', () => {
    const res = deal([1_500, 5_000])
    const s = feed(start('blind', BLIND_B, [1_500, 5_000], 0), res.events, 0, { seq: 10 })
    expect(s.hand?.legal).toMatchObject({ kinds: ['play', 'fold'], callAmount: 500 })
    expect(s.hand?.legal?.callAmount).toBe(legalActions(res.state, 0).callAmount)
    const other = feed(start('blind', BLIND_B, [1_500, 5_000], 1), res.events, 1, { seq: 10 })
    expect(other.hand?.legal?.callAmount).toBe(1_000) // a full stack still plays the wager
  })

  it('marks a seat the ante emptied all in from the post, and never offers it a choice', () => {
    const res = deal([800, 5_000])
    const posted = res.events.findIndex((e) => e.type === 'BLINDS_POSTED')
    const ref = { seq: 10 }
    let s = feed(start('blind', BLIND_B, [800, 5_000], 0), res.events.slice(0, posted + 1), 0, ref)
    expect(s.hand?.seats[0]).toMatchObject({ stack: 0, allIn: true })
    expect(s.hand?.seats[1]?.allIn).toBe(false)
    s = feed(s, res.events.slice(posted + 1), 0, ref)
    expect(s.hand?.legal).toBeNull()
    expect(s.hand?.seats[0]).toMatchObject({ allIn: true, hasDecided: true })
  })
})

describe('arrival stamps (the card motion reads them)', () => {
  const event = (seq: number, e: GameEvent): ServerMessage => ({ t: 'GAME_EVENT', seq, event: e })
  const flop = parseCards('Ah Kd 2c')
  const turn = parseCards('Ah Kd 2c 9s')

  it('stamps the first deal, the latest board and the showdown with the client time they arrived, and a new hand starts clean', () => {
    let s = start('holdem', HOLDEM_RULES, [20000, 20000], 0)
    s = reduceClient(s, { type: 'server', msg: event(11, { type: 'HAND_STARTED', handId: 'h1', mode: 'holdem', button: 0, seats: [0, 1], carryOverIn: 0 }), now: 1000 })
    expect(s.hand).toMatchObject({ dealtAt: null, boardAt: null, showdownAt: null })

    s = reduceClient(s, { type: 'server', msg: event(12, { type: 'CARDS_DEALT', seat: 0, cards: parseCards('As Ks'), cardCount: 2 }), now: 1100 })
    s = reduceClient(s, { type: 'server', msg: event(13, { type: 'CARDS_DEALT', seat: 1, cards: [], cardCount: 2 }), now: 1150 })
    expect(s.hand).toMatchObject({ dealtAt: 1100, boardAt: null, showdownAt: null })

    s = reduceClient(s, { type: 'server', msg: event(14, { type: 'COMMUNITY_REVEALED', street: 'FLOP', cards: flop, community: flop }), now: 2000 })
    expect(s.hand).toMatchObject({ dealtAt: 1100, boardAt: 2000 })
    s = reduceClient(s, { type: 'server', msg: event(15, { type: 'COMMUNITY_REVEALED', street: 'TURN', cards: parseCards('9s'), community: turn }), now: 3000 })
    expect(s.hand).toMatchObject({ dealtAt: 1100, boardAt: 3000, showdownAt: null })

    s = reduceClient(s, { type: 'server', msg: event(16, { type: 'SHOWDOWN', hands: [] }), now: 4000 })
    expect(s.hand).toMatchObject({ dealtAt: 1100, boardAt: 3000, showdownAt: 4000 })

    s = reduceClient(s, { type: 'server', msg: event(17, { type: 'HAND_STARTED', handId: 'h2', mode: 'holdem', button: 1, seats: [0, 1], carryOverIn: 0 }), now: 9000 })
    expect(s.hand).toMatchObject({ handId: 'h2', dealtAt: null, boardAt: null, showdownAt: null })
  })

  it('a hand built from a snapshot has no stamps: nothing was seen arriving', () => {
    const res = createHand({ handId: 'h3', rules: HOLDEM_RULES, seats: seatsOf([20000, 20000]), button: 0, carryOverIn: 0 }, seededRng(2))
    const s = reduceClient(start('holdem', HOLDEM_RULES, [20000, 20000], 0), {
      type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 11, room: roomView('holdem', HOLDEM_RULES, [20000, 20000]), hand: playerView(res.state, 0), deadlineAt: null }, now: 5000,
    })
    expect(s.hand).toMatchObject({ restored: true, dealtAt: null, boardAt: null, showdownAt: null })
  })

  it('a reconnect snapshot stamps nothing, even on a hand that was being followed', () => {
    let s = start('holdem', HOLDEM_RULES, [20000, 20000], 0)
    s = reduceClient(s, { type: 'server', msg: event(11, { type: 'HAND_STARTED', handId: 'h4', mode: 'holdem', button: 0, seats: [0, 1], carryOverIn: 0 }), now: 1000 })
    s = reduceClient(s, { type: 'server', msg: event(12, { type: 'CARDS_DEALT', seat: 0, cards: parseCards('As Ks'), cardCount: 2 }), now: 1100 })
    expect(s.hand?.dealtAt).toBe(1100)
    const res = createHand({ handId: 'h4', rules: HOLDEM_RULES, seats: seatsOf([20000, 20000]), button: 0, carryOverIn: 0 }, seededRng(2))
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 20, room: s.room!, hand: playerView(res.state, 0), deadlineAt: null }, now: 8000 })
    expect(s.hand).toMatchObject({ restored: true, dealtAt: null, boardAt: null, showdownAt: null })
  })
})

describe('Poker hỗn loạn', () => {
  const card = (uid: number, cardId: string, tier: 'silver' | 'gold' | 'diamond' = 'silver', handsLeft: number | null = null) => ({ uid, cardId, tier, handsLeft })
  const OFFER = { offerId: 'o1', tier: 'gold' as const, cardIds: ['g_freeze', 's_shield', 's_peek_board'], deadlineAt: 50_000, draftMs: 30_000 }
  type Snapshot = Extract<ServerMessage, { t: 'ROOM_SNAPSHOT' }>

  function chaosRoom(): RoomView {
    const base = roomView('blind', BLIND_B, [20000, 20000, 20000])
    return { ...base, config: { ...base.config, blind: { ...base.config.blind!, chaosCycle: 5 } }, players: base.players.map((p) => (p.seat === 1 ? { ...p, chaos: { cards: [card(7, 's_shield')], points: 3, bonusCount: 0 } } : p)) }
  }
  function inChaosRoom(chaos?: Snapshot['chaos']): ClientState {
    let s = reduceClient(initialClientState, { type: 'server', msg: { t: 'WELCOME', playerId: 'p0', displayName: 'P0', balance: 0, serverTime: 0 }, now: 0 })
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 10, room: chaosRoom(), hand: null, deadlineAt: null, ...(chaos ? { chaos } : {}) }, now: 0 })
    return s
  }
  const room = (s: ClientState, seq: number, event: Extract<ServerMessage, { t: 'ROOM_EVENT' }>['event']) => reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq, event }, now: 1 })
  const game = (s: ClientState, seq: number, event: GameEvent) => reduceClient(s, { type: 'server', msg: { t: 'GAME_EVENT', seq, event }, now: 1 })
  const offer = (s: ClientState, payload: unknown = OFFER) => reduceClient(s, { type: 'server', msg: { t: 'NOTIFICATION', kind: 'CHAOS_OFFER', payload }, now: 1 })
  const draftFrame: RoomEvent = { type: 'CHAOS_DRAFT', tier: 'gold', deadlineAt: 50_000, draftMs: 30_000, seats: [0, 1, 2] }
  const started: GameEvent = { type: 'HAND_STARTED', handId: 'h1', mode: 'blind', button: 0, seats: [0, 1, 2], carryOverIn: 0 }
  const swap: GameEvent = { type: 'CHAOS_APPLIED', seat: 0, cardId: 's_swap_lowest', effect: 'swapLowest', targets: [], outcome: 'applied' }
  const settlement: GameEvent = { type: 'SETTLEMENT', payouts: [], fee: 0, pots: [], carryOverOut: 0, stacks: [], uncalledReturned: null }

  it('starts with no draft, no cards and nothing applied', () => {
    expect(initialClientState.chaos).toEqual({
      draft: null, seats: {}, applied: [], credits: [], awarded: [], peek: null, reverse: false, blindfolded: null, bonus: { cards: [], armed: null },
      table: null, heralds: [], rolls: [], wild: null, hawk: null,
    })
  })

  it('takes every seat\'s cards and points from the snapshot, and a draft it was in the middle of', () => {
    const s = inChaosRoom({ draft: { tier: 'gold', deadlineAt: 50_000, draftMs: 30_000, offer: { offerId: 'o1', cardIds: OFFER.cardIds }, picked: false } })
    expect(s.chaos.seats[1]).toEqual({ cards: [card(7, 's_shield')], points: 3, bonusCount: 0 })
    expect(s.chaos.draft).toEqual({ tier: 'gold', deadlineAt: 50_000, totalMs: 30_000, offer: { offerId: 'o1', cardIds: OFFER.cardIds }, picked: false })
  })

  it('a snapshot without a draft leaves none, and a plain table keeps an empty chaos state', () => {
    expect(inChaosRoom({ draft: null }).chaos.draft).toBeNull()
    expect(start('blind', BLIND_B, [20000, 20000], 0).chaos).toEqual(initialClientState.chaos)
  })

  it('stores a CHAOS_OFFER notification as the draft\'s offer, without making a toast', () => {
    const s = offer(room(inChaosRoom(), 11, draftFrame))
    expect(s.chaos.draft).toEqual({ tier: 'gold', deadlineAt: 50_000, totalMs: 30_000, offer: { offerId: 'o1', cardIds: OFFER.cardIds }, picked: false })
    expect(s.notifications).toEqual([])
  })

  it('keeps the offer whichever of the offer and the draft frame arrives first', () => {
    const s = room(offer(inChaosRoom()), 11, draftFrame)
    expect(s.chaos.draft).toEqual({ tier: 'gold', deadlineAt: 50_000, totalMs: 30_000, offer: { offerId: 'o1', cardIds: OFFER.cardIds }, picked: false })
    expect(s.notifications).toEqual([])
  })

  it('BP-41 Nâng tầm uy lực: an offer a tier above the draft frame keeps its own tier, whichever arrives first', () => {
    const silverFrame: RoomEvent = { ...draftFrame, tier: 'silver' } as RoomEvent
    const mine = { offerId: 'o1', tier: 'gold' as const, cardIds: OFFER.cardIds }
    for (const s of [room(offer(inChaosRoom()), 11, silverFrame), offer(room(inChaosRoom(), 11, silverFrame))]) {
      expect(s.chaos.draft).toEqual({ tier: 'gold', deadlineAt: 50_000, totalMs: 30_000, offer: { offerId: mine.offerId, cardIds: mine.cardIds }, picked: false })
    }
  })

  it('BP-41: a dice roll sets the seat\'s stack (after its loss); the table state and a steal leave the roster alone', () => {
    let s = room(inChaosRoom(), 11, { type: 'CHAOS_DICE', seat: 1, cardId: 'g_dice', dice: [1, 1], result: { burned: 1000 }, stack: 19000 })
    expect(s.room!.players.find((p) => p.seat === 1)!.stack).toBe(19000)
    const before = s.room
    s = room(s, 12, { type: 'CHAOS_TABLE', table: { god: { seat: 1, handsLeft: 5, curse: 2 }, demigods: [], bombs: [] } })
    s = room(s, 13, { type: 'CHAOS_STEAL', seat: 0, cardId: 'g_steal_points', outcome: 'applied', targets: [1], from: 1, to: 0, amount: 3, spent: [] })
    expect(s.room).toEqual(before)
  })

  it('a draft frame alone is a draft with no offer of mine (a spectator, or a seat drafted with nothing to pick)', () => {
    const s = room(inChaosRoom(), 11, { type: 'CHAOS_DRAFT', tier: 'silver', deadlineAt: 40_000, draftMs: 15_000, seats: [1] })
    expect(s.chaos.draft).toEqual({ tier: 'silver', deadlineAt: 40_000, totalMs: 15_000, offer: null, picked: false })
  })

  it('carries the draft window\'s length from the draft frame, the offer and the snapshot (M2)', () => {
    expect(room(inChaosRoom(), 11, { ...draftFrame, draftMs: 45_000 } as RoomEvent).chaos.draft?.totalMs).toBe(45_000)
    expect(offer(inChaosRoom(), { ...OFFER, draftMs: 8_000 }).chaos.draft?.totalMs).toBe(8_000)
    const { draftMs: _gone, ...older } = OFFER
    expect(offer(room(inChaosRoom(), 11, draftFrame), older).chaos.draft?.totalMs).toBe(30_000) // the frame's, kept
    expect(offer(inChaosRoom(), older).chaos.draft?.totalMs).toBe(15_000) // nothing said: the default
    expect(inChaosRoom({ draft: { tier: 'gold', deadlineAt: 50_000, draftMs: 60_000, offer: null, picked: false } }).chaos.draft?.totalMs).toBe(60_000)
  })

  it('ignores a malformed offer payload', () => {
    const s = offer(inChaosRoom(), { nonsense: true })
    expect(s.chaos.draft).toBeNull()
    expect(s.notifications).toEqual([])
  })

  it('marks the draft picked when my own seat\'s CHAOS_PICKED arrives, and not for another seat', () => {
    let s = offer(room(inChaosRoom(), 11, draftFrame))
    s = room(s, 12, { type: 'CHAOS_PICKED', seat: 1, cardIds: ['s_shield'] })
    expect(s.chaos.draft?.picked).toBe(false)
    s = room(s, 13, { type: 'CHAOS_PICKED', seat: 0, cardIds: ['g_freeze'] })
    expect(s.chaos.draft?.picked).toBe(true)
  })

  it('a local chaosPicked marks the offer picked at once (the server only says so when the draft ends)', () => {
    const drafting = offer(room(inChaosRoom(), 11, draftFrame))
    expect(reduceClient(drafting, { type: 'chaosPicked', offerId: 'o1' }).chaos.draft?.picked).toBe(true)
    expect(reduceClient(drafting, { type: 'chaosPicked', offerId: 'other' }).chaos.draft?.picked).toBe(false)
    expect(reduceClient(inChaosRoom(), { type: 'chaosPicked', offerId: 'o1' }).chaos.draft).toBeNull()
  })

  it('keeps each seat\'s cards from CHAOS_STATE and closes the draft', () => {
    let s = offer(room(inChaosRoom(), 11, draftFrame))
    s = room(s, 12, { type: 'CHAOS_STATE', seats: [{ seat: 0, cards: [card(9, 'g_freeze', 'gold', 2)], points: 0, bonusCount: 0 }, { seat: 1, cards: [], points: 4, bonusCount: 0 }] })
    expect(s.chaos.seats[0]).toEqual({ cards: [card(9, 'g_freeze', 'gold', 2)], points: 0, bonusCount: 0 })
    expect(s.chaos.seats[1]).toEqual({ cards: [], points: 4, bonusCount: 0 })
    expect(s.chaos.draft).toBeNull()
  })

  it('a seat sitting down starts with no cards and no points, and one standing or leaving loses its cards', () => {
    let s = room(inChaosRoom(), 11, { type: 'PLAYER_SAT', playerId: 'p2', seat: 2, stack: 20000 })
    expect(s.chaos.seats[2]).toEqual({ cards: [], points: 0, bonusCount: 0 })
    s = room(s, 12, { type: 'PLAYER_STOOD', playerId: 'p1', seat: 1 })
    expect(s.chaos.seats[1]).toBeUndefined()
    s = room(s, 13, { type: 'PLAYER_LEFT', playerId: 'p2' })
    expect(s.chaos.seats[2]).toBeUndefined()
  })

  it('collects credits and awards, and clears them with the next hand', () => {
    let s = room(inChaosRoom(), 11, { type: 'CHAOS_CREDIT', seat: 0, amount: 4000, stack: 24000, reason: 'chaos_crit', capped: false, multiplier: 2 })
    s = room(s, 12, { type: 'CHAOS_CREDIT', seat: 1, amount: 0, stack: 20000, reason: 'chaos_rescue', capped: true })
    s = room(s, 13, { type: 'CHAOS_AWARDED', seat: 2, cardIds: ['s_peek_board'] })
    expect(s.chaos.credits).toEqual([
      { seat: 0, amount: 4000, reason: 'chaos_crit', capped: false, multiplier: 2 },
      { seat: 1, amount: 0, reason: 'chaos_rescue', capped: true },
    ])
    expect(s.chaos.awarded).toEqual([{ seat: 2, cardIds: ['s_peek_board'] }])
    s = game(s, 14, started)
    expect(s.chaos.credits).toEqual([])
    expect(s.chaos.awarded).toEqual([])
  })

  it('collects CHAOS_APPLIED in order, keeps the viewer\'s peek, and clears both at the next hand', () => {
    let s = game(inChaosRoom(), 11, started)
    s = game(s, 12, swap)
    s = game(s, 13, { type: 'CHAOS_APPLIED', seat: 2, cardId: 'g_freeze', effect: 'freeze', targets: [1], outcome: 'blocked' })
    s = game(s, 14, { type: 'CHAOS_PEEK', seat: 0, cards: parseCards('Ah Kd') })
    expect(s.chaos.applied.map((a) => [a.seat, a.cardId, a.outcome])).toEqual([[0, 's_swap_lowest', 'applied'], [2, 'g_freeze', 'blocked']])
    expect(s.chaos.peek).toEqual({ seat: 0, cards: parseCards('Ah Kd') })
    s = game(s, 15, { ...started, handId: 'h2' } as GameEvent)
    expect(s.chaos.applied).toEqual([])
    expect(s.chaos.peek).toBeNull()
  })

  it("keeps my peek when another seat's blanked CHAOS_PEEK arrives later, and ignores one that comes first", () => {
    // `filterEvent` turns a peek for someone else into `cards: []` instead of dropping it.
    let s = game(inChaosRoom(), 11, started)
    s = game(s, 12, { type: 'CHAOS_PEEK', seat: 2, cards: [] })
    expect(s.chaos.peek).toBeNull()
    s = game(s, 13, { type: 'CHAOS_PEEK', seat: 0, cards: parseCards('Ah Kd') })
    s = game(s, 14, { type: 'CHAOS_PEEK', seat: 1, cards: [] })
    expect(s.chaos.peek).toEqual({ seat: 0, cards: parseCards('Ah Kd') })
  })

  it('moves what the hand used into result.chaosUsed at settlement (from the public summary)', () => {
    let s = game(inChaosRoom(), 11, started)
    s = game(s, 12, swap)
    s = game(s, 13, { type: 'CHAOS_SUMMARY', used: [{ seat: 0, cardId: 's_swap_lowest', effect: 'swapLowest', outcome: 'applied', targets: [] }, { seat: 2, cardId: 'g_freeze', effect: 'freeze', outcome: 'blocked', targets: [0] }] })
    s = game(s, 14, { ...settlement, payouts: [{ seat: 0, amount: 3000 }], stacks: [{ seat: 0, stack: 22000 }] } as GameEvent)
    expect(s.hand!.result!.chaosUsed).toEqual([{ seat: 0, cardId: 's_swap_lowest', outcome: 'applied', targets: [] }, { seat: 2, cardId: 'g_freeze', outcome: 'blocked', targets: [0] }])
  })

  it('falls back to the applied list when a hand settles without a summary, and a plain hand has no chaosUsed', () => {
    let s = game(inChaosRoom(), 11, started)
    s = game(s, 12, swap)
    s = game(s, 13, settlement)
    expect(s.hand!.result!.chaosUsed).toEqual([{ seat: 0, cardId: 's_swap_lowest', outcome: 'applied', targets: [] }])
    let plain = game(inChaosRoom(), 11, started)
    plain = game(plain, 12, settlement)
    expect(plain.hand!.result!.chaosUsed).toBeUndefined()
  })

  it('clears a draft left over when the hand starts (a draft that every seat finished at once)', () => {
    let s = room(inChaosRoom(), 11, { type: 'CHAOS_DRAFT', tier: 'silver', deadlineAt: 40_000, draftMs: 15_000, seats: [1] })
    expect(s.chaos.draft).not.toBeNull()
    s = game(s, 12, started)
    expect(s.chaos.draft).toBeNull()
  })

  it('a credit raises the roster stack, so a seat rescued at 0 is dealt in with chips, posts its ante and is asked to play', () => {
    // Plan 37 final wave (C1): the stack comes from the server, absolute, so a seat at 0 shows its rescue straight away.
    let s = room(inChaosRoom(), 11, { type: 'PLAYER_SAT', playerId: 'p0', seat: 0, stack: 0 })
    expect(s.room!.players.find((p) => p.seat === 0)!.stack).toBe(0)
    s = room(s, 12, { type: 'CHAOS_CREDIT', seat: 0, amount: 5000, stack: 5000, reason: 'chaos_rescue', capped: false })
    expect(s.room!.players.find((p) => p.seat === 0)!.stack).toBe(5000)
    expect(s.chaos.credits).toEqual([{ seat: 0, amount: 5000, reason: 'chaos_rescue', capped: false }]) // the stack is the roster's
    s = game(s, 13, started)
    s = game(s, 14, { type: 'BLINDS_POSTED', posts: [0, 1, 2].map((seat) => ({ seat, amount: 1000, kind: 'ANTE' as const })) })
    expect(s.hand!.seats.find((x) => x.seat === 0)).toMatchObject({ stack: 4000, allIn: false })
    s = reduceClient(s, { type: 'server', msg: { t: 'GAME_EVENT', seq: 15, event: { type: 'DECISION_PHASE', seats: [0, 1, 2], turnSeq: 1, deadlineAt: 9_000 } as GameEvent }, now: 1 })
    expect(s.hand!.legal).toMatchObject({ seat: 0, kinds: ['play', 'fold'], callAmount: 1000 })
  })

  it('BP-41: the decision takes the seat’s own call (a multiplied stake) and drops "fold" for a seat that may not fold', () => {
    let s = room(inChaosRoom(), 11, { type: 'PLAYER_SAT', playerId: 'p0', seat: 0, stack: 10_000 })
    s = game(s, 12, started)
    s = game(s, 13, { type: 'BLINDS_POSTED', posts: [{ seat: 0, amount: 4000, kind: 'ANTE' }, { seat: 1, amount: 1000, kind: 'ANTE' }, { seat: 2, amount: 1000, kind: 'ANTE' }] })
    const decision = (event: GameEvent) => reduceClient(s, { type: 'server', msg: { t: 'GAME_EVENT', seq: 14, event }, now: 1 }).hand!.legal
    expect(decision({ type: 'DECISION_PHASE', seats: [0, 1, 2], turnSeq: 1, calls: [{ seat: 0, amount: 4000 }] })).toMatchObject({ kinds: ['play', 'fold'], callAmount: 4000 })
    // Capped at the stack, as the engine caps it.
    expect(decision({ type: 'DECISION_PHASE', seats: [0, 1, 2], turnSeq: 1, calls: [{ seat: 0, amount: 32_000 }] })).toMatchObject({ callAmount: 6000 })
    // Another seat's call or no-fold is not mine.
    expect(decision({ type: 'DECISION_PHASE', seats: [0, 1, 2], turnSeq: 1, calls: [{ seat: 1, amount: 4000 }], noFold: [1, 2] })).toMatchObject({ kinds: ['play', 'fold'], callAmount: 1000 })
    expect(decision({ type: 'DECISION_PHASE', seats: [0, 1, 2], turnSeq: 1, noFold: [0, 1, 2] })).toMatchObject({ kinds: ['play'], callAmount: 1000 })
  })

  it('BP-41: keeps the call the server asked of my seat before the stack capped it (the tray’s "Tất tay")', () => {
    let s = room(inChaosRoom(), 11, { type: 'PLAYER_SAT', playerId: 'p0', seat: 0, stack: 3000 })
    s = game(s, 12, started)
    s = game(s, 13, { type: 'BLINDS_POSTED', posts: [{ seat: 0, amount: 2000, kind: 'ANTE' }] })
    s = game(s, 14, { type: 'DECISION_PHASE', seats: [0, 1, 2], turnSeq: 1, calls: [{ seat: 0, amount: 2000 }] })
    expect(s.hand!.legal).toMatchObject({ callAmount: 1000 })
    expect(s.hand!.myCall).toBe(2000)
    expect(game(s, 15, { type: 'DECISION_PHASE', seats: [0, 1, 2], turnSeq: 2 }).hand!.myCall).toBe(2000) // a frame naming none changes nothing
  })

  describe('BP-41 round three', () => {
    const TABLE = { god: { seat: 1, handsLeft: 4, curse: 2 as const }, demigods: [{ seat: 2, handsLeft: 5 }], bombs: [{ owner: 2, carrier: 0, handsLeft: 2 }] }
    const EMPTY = { god: null, demigods: [], bombs: [] }
    const seatState = { seat: 1, cards: [], points: 0, bonusCount: 0 }
    const at = (s: ClientState, seq: number, event: RoomEvent, now: number) => reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq, event }, now })

    it('keeps the table’s reign and bombs from CHAOS_TABLE, CHAOS_STATE and a snapshot; empty or absent is none', () => {
      let s = room(inChaosRoom(), 11, { type: 'CHAOS_TABLE', table: TABLE })
      expect(s.chaos.table).toEqual(TABLE)
      s = game(s, 12, started)
      expect(s.chaos.table).toEqual(TABLE) // a hand does not end a reign
      s = room(s, 13, { type: 'CHAOS_TABLE', table: EMPTY })
      expect(s.chaos.table).toBeNull()
      s = room(s, 14, { type: 'CHAOS_STATE', seats: [seatState], table: TABLE })
      expect(s.chaos.table).toEqual(TABLE)
      s = room(s, 15, { type: 'CHAOS_STATE', seats: [seatState] })
      expect(s.chaos.table).toBeNull()
      expect(inChaosRoom({ draft: null, table: TABLE }).chaos.table).toEqual(TABLE)
      expect(inChaosRoom({ draft: null }).chaos.table).toBeNull()
    })

    it('keeps each herald with the player’s name as it came, and the hand that follows does not clear it', () => {
      let s = at(inChaosRoom(), 11, { type: 'CHAOS_HERALD', kind: 'god', seat: 1, playerId: 'p1' }, 500)
      s = game(s, 12, started)
      s = at(s, 13, { type: 'CHAOS_HERALD', kind: 'godslain', seat: 2, playerId: 'p2' }, 900)
      expect(s.chaos.heralds).toEqual([
        { id: 1, kind: 'god', seat: 1, name: 'P1', at: 500 },
        { id: 2, kind: 'godslain', seat: 2, name: 'P2', at: 900 },
      ])
    })

    it('a dice roll is watched by the table, said in the toasts, lowers the finished hand’s plate, and a 6-6-6 brings a herald', () => {
      let s = game(inChaosRoom(), 11, started)
      s = game(s, 12, { ...settlement, stacks: [{ seat: 1, stack: 20_000 }] } as GameEvent)
      s = at(s, 13, { type: 'CHAOS_DICE', seat: 1, cardId: 'g_dice', dice: [1, 1], result: { burned: 1000 }, stack: 19_000 }, 700)
      expect(s.hand!.seats.find((x) => x.seat === 1)!.stack).toBe(19_000)
      expect(s.chaos.rolls).toEqual([{ id: 1, seat: 1, name: 'P1', cardId: 'g_dice', dice: [1, 1], result: { burned: 1000 }, at: 700 }])
      expect(s.chaos.applied.at(-1)).toEqual({ seat: 1, cardId: 'g_dice', effect: 'fortuneDice', targets: [], outcome: 'applied', dice: [1, 1], roll: { burned: 1000 }, rolledAt: 700 })
      expect(s.chaos.heralds).toEqual([])
      const jackpot = { jackpot: 60_000, cards: [{ tier: 'diamond' as const, count: 2 }], triple: true as const, herald: true as const }
      s = at(s, 14, { type: 'CHAOS_DICE', seat: 2, cardId: 'd_dice', dice: [6, 6, 6], result: jackpot, stack: 20_000 }, 800)
      expect(s.chaos.rolls.map((r) => r.id)).toEqual([1, 2])
      expect(s.chaos.heralds).toEqual([{ id: 3, kind: 'dice', seat: 2, name: 'P2', dice: [6, 6, 6], amount: 60_000, at: 800 }])
    })

    it('a Trộm điểm received is a line in the toasts with the points it moved', () => {
      const s = room(inChaosRoom(), 11, { type: 'CHAOS_STEAL', seat: 0, cardId: 'g_steal_points', outcome: 'applied', targets: [1], from: 1, to: 0, amount: 3, spent: [] })
      expect(s.chaos.applied).toEqual([{ seat: 0, cardId: 'g_steal_points', effect: 'stealPoints', targets: [1], outcome: 'applied', steal: { from: 1, to: 0, amount: 3 } }])
    })

    it('a duel told at the reveal and paid at the settlement is one line, with the payment on it; a bomb going off is its own', () => {
      let s = game(inChaosRoom(), 11, started)
      s = game(s, 12, { type: 'CHAOS_APPLIED', seat: 0, cardId: 'g_duel', effect: 'duel', targets: [2], outcome: 'applied', wagers: 2 })
      // The target won the duel: the holder pays it (the payment's seat is the winner).
      s = game(s, 13, { type: 'CHAOS_APPLIED', seat: 2, cardId: 'g_duel', effect: 'duel', targets: [0], outcome: 'applied', amount: 2000, transfers: [{ from: 0, to: 2, amount: 2000 }] })
      s = game(s, 14, { type: 'CHAOS_APPLIED', seat: 1, cardId: 'd_time_bomb', effect: 'timeBomb', targets: [2], outcome: 'applied', amount: 1000, transfers: [{ from: 2, to: 1, amount: 1000 }] })
      expect(s.chaos.applied).toEqual([
        { seat: 0, cardId: 'g_duel', effect: 'duel', targets: [2], outcome: 'applied', wagers: 2, transfers: [{ from: 0, to: 2, amount: 2000 }], amount: 2000 },
        { seat: 1, cardId: 'd_time_bomb', effect: 'timeBomb', targets: [2], outcome: 'applied', amount: 1000, transfers: [{ from: 2, to: 1, amount: 1000 }] },
      ])
    })

    it('the Thần’s duels, one payment per opponent, all join its curse’s line', () => {
      let s = game(inChaosRoom(), 11, started)
      s = game(s, 12, { type: 'CHAOS_APPLIED', seat: 1, cardId: 'd_carp', effect: 'carp', targets: [0, 2], outcome: 'applied' })
      s = game(s, 13, { type: 'CHAOS_APPLIED', seat: 1, cardId: 'd_carp', effect: 'carp', targets: [0], outcome: 'applied', amount: 1000, transfers: [{ from: 0, to: 1, amount: 1000 }] })
      s = game(s, 14, { type: 'CHAOS_APPLIED', seat: 2, cardId: 'd_carp', effect: 'carp', targets: [1], outcome: 'applied', amount: 1000, transfers: [{ from: 1, to: 2, amount: 1000 }] })
      expect(s.chaos.applied).toHaveLength(1)
      expect(s.chaos.applied[0]!.transfers).toEqual([{ from: 0, to: 1, amount: 1000 }, { from: 1, to: 2, amount: 1000 }])
    })

    it('"Thẻ đã dùng" says a card that hit several seats in several entries (Cướp đoạt) once, with every target', () => {
      let s = game(inChaosRoom(), 11, started)
      s = game(s, 12, {
        type: 'CHAOS_SUMMARY',
        used: [
          { seat: 0, cardId: 'd_plunder', effect: 'plunder', outcome: 'applied', targets: [1] },
          { seat: 2, cardId: 's_shield', effect: 'shield', outcome: 'applied', targets: [] },
          { seat: 0, cardId: 'd_plunder', effect: 'plunder', outcome: 'applied', targets: [2] },
          { seat: 0, cardId: 'd_plunder', effect: 'plunder', outcome: 'blocked', targets: [2] },
        ],
      })
      expect(s.hand!.result!.chaosUsed).toEqual([
        { seat: 0, cardId: 'd_plunder', outcome: 'applied', targets: [1, 2] },
        { seat: 2, cardId: 's_shield', outcome: 'applied', targets: [] },
        { seat: 0, cardId: 'd_plunder', outcome: 'blocked', targets: [2] },
      ])
    })

    it('keeps my own wild card and my hawk’s look for the hand, never another seat’s, and a new hand clears them', () => {
      let s = room(inChaosRoom(), 11, { type: 'PLAYER_SAT', playerId: 'p0', seat: 0, stack: 10_000 })
      s = game(s, 12, started)
      const [qd, nine] = parseCards('Qd 9c')
      s = game(s, 13, { type: 'CHAOS_APPLIED', seat: 0, cardId: 'd_wild_card', effect: 'wildCard', targets: [], outcome: 'applied', wild: qd })
      s = game(s, 14, { type: 'CHAOS_HAWK', seat: 0, target: 2, cards: [nine!] })
      s = game(s, 15, { type: 'CHAOS_HAWK', seat: 1, target: 0, cards: [] })
      expect(s.chaos.wild).toBe(qd)
      expect(s.chaos.hawk).toEqual({ target: 2, cards: [nine] })
      s = game(s, 16, { ...started, handId: 'h2' })
      expect(s.chaos.wild).toBeNull()
      expect(s.chaos.hawk).toBeNull()
    })
  })

  it('a credit after a finished hand raises that seat on the hand still shown too', () => {
    let s = game(inChaosRoom(), 11, started)
    s = game(s, 12, { ...settlement, stacks: [{ seat: 1, stack: 0 }] } as GameEvent)
    s = room(s, 13, { type: 'CHAOS_CREDIT', seat: 1, amount: 5000, stack: 5000, reason: 'chaos_rescue', capped: false })
    expect(s.hand!.seats.find((x) => x.seat === 1)!.stack).toBe(5000)
    expect(s.room!.players.find((p) => p.seat === 1)!.stack).toBe(5000)
  })

  it('a re-dealt board (CHAOS_APPLIED with community) replaces the board and lands like a street', () => {
    // Plan 37 final wave (C2): SHOWDOWN and SETTLEMENT carry no board, so this is the only place the new one comes from.
    let s = game(inChaosRoom(), 11, started)
    s = game(s, 12, { type: 'COMMUNITY_REVEALED', street: 'RIVER', community: parseCards('2c 3d 4h 5s 7c') } as GameEvent)
    const redeal = parseCards('Ah Kh Qh Jh Th')
    s = reduceClient(s, { type: 'server', msg: { t: 'GAME_EVENT', seq: 13, event: { type: 'CHAOS_APPLIED', seat: 1, cardId: 'g_redeal_board', effect: 'redealBoard', targets: [], outcome: 'applied', community: redeal } }, now: 777 })
    expect(s.hand!.community).toEqual(redeal)
    expect(s.hand!.boardAt).toBe(777)
    expect(s.chaos.applied.at(-1)).toMatchObject({ effect: 'redealBoard', community: redeal })
    // one without a board leaves the board alone
    const before = s.hand!
    s = game(s, 14, swap)
    expect(s.hand!.community).toBe(before.community)
    expect(s.hand!.boardAt).toBe(777)
  })

  it('keeps "Thế giới đảo ngược" on for the hand from its public CHAOS_APPLIED, and clears it at the next hand', () => {
    let s = game(inChaosRoom(), 11, started)
    s = game(s, 12, { type: 'CHAOS_APPLIED', seat: 2, cardId: 'd_reverse', effect: 'reverseRank', targets: [], outcome: 'blocked' })
    expect(s.chaos.reverse).toBe(false) // stopped: the ranking is not reversed
    s = game(s, 13, { type: 'CHAOS_APPLIED', seat: 2, cardId: 'd_reverse', effect: 'reverseRank', targets: [], outcome: 'applied' })
    expect(s.chaos.reverse).toBe(true)
    s = game(s, 14, { ...started, handId: 'h2' } as GameEvent)
    expect(s.chaos.reverse).toBe(false)
  })

  it('a reconnect mid-hand keeps the viewer\'s peek, the reversed ranking and the blindfold from the snapshot\'s hand view', () => {
    // Plan 37 final wave (I2): the event stream that built them is gone; the server's hand view still carries them.
    const view: HandView = {
      handId: 'h1', mode: 'blind', phase: 'DECISION', street: 'PREFLOP', community: [], pot: 3000, carryOverIn: 0, currentBet: 0, minRaise: 0,
      button: 0, actingSeat: null, turnSeq: 1, mySeat: 0, legal: null, result: null,
      seats: [0, 1, 2].map((seat) => ({ seat, playerId: `p${seat}`, isBot: false, stack: 19000, betThisStreet: 1000, totalCommitted: 1000, folded: false, allIn: false, cardCount: 2, holeCards: null, hasDecided: false, decision: null, revealed: true })),
      chaos: { reverse: true, peek: parseCards('Ah Kd'), blindfolded: true },
    }
    const s = reduceClient(inChaosRoom(), { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 20, room: chaosRoom(), hand: view, deadlineAt: null }, now: 5 })
    expect(s.chaos.peek).toEqual({ seat: 0, cards: parseCards('Ah Kd') })
    expect(s.chaos.reverse).toBe(true)
    expect(s.chaos.blindfolded).toBe(true)
    // a hand view with nothing of the sort, and a snapshot with no hand, leave them off (and the blindfold to the deal)
    const plain = reduceClient(inChaosRoom(), { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 21, room: chaosRoom(), hand: { ...view, chaos: { reverse: false, peek: [], blindfolded: false } }, deadlineAt: null }, now: 5 })
    expect([plain.chaos.peek, plain.chaos.reverse, plain.chaos.blindfolded]).toEqual([null, false, false])
    expect([inChaosRoom().chaos.reverse, inChaosRoom().chaos.blindfolded]).toEqual([false, null])
  })

  it('reset and leaving the room forget the chaos state', () => {
    const s = inChaosRoom()
    expect(reduceClient(s, { type: 'reset' }).chaos).toEqual(initialClientState.chaos)
    expect(reduceClient(s, { type: 'leftRoom' }).chaos).toEqual(initialClientState.chaos)
  })

  // ---- BP-39: the bonus hand and "Bỏ qua" ----
  const BONUS = { cards: [card(21, 's_steal_one'), card(22, 'g_redeal_board_1', 'gold')], armed: { uid: 23, cardId: 'd_insure_2', hand: 'next' as const } }
  const bonusNote = (s: ClientState, payload: unknown) => reduceClient(s, { type: 'server', msg: { t: 'NOTIFICATION', kind: 'CHAOS_BONUS', payload }, now: 1 })
  const skips = (s: ClientState, seq: number, skipped: number, total: number) => room(s, seq, { type: 'RESULT_SKIPS', skipped, total })

  it('keeps my bonus hand from CHAOS_BONUS without making a toast, and replaces it on the next one', () => {
    let s = bonusNote(inChaosRoom(), BONUS)
    expect(s.chaos.bonus).toEqual(BONUS)
    expect(s.notifications).toEqual([])
    s = bonusNote(s, { cards: [card(22, 'g_redeal_board_1', 'gold')], armed: null })
    expect(s.chaos.bonus).toEqual({ cards: [card(22, 'g_redeal_board_1', 'gold')], armed: null })
  })

  it('ignores a malformed CHAOS_BONUS', () => {
    const s = bonusNote(inChaosRoom(), BONUS)
    const good = card(21, 's_steal_one')
    for (const bad of [
      null, {}, { cards: 'x' }, { cards: [], armed: { uid: 'x', cardId: 'a', hand: 'next' } }, { cards: [], armed: { uid: 1, cardId: 'a', hand: 'later' } },
      // a card that is not a card (P9): no uid number, no card id, an unknown tier, hands that are not a number or null
      { cards: [null], armed: null }, { cards: [{ ...good, uid: '21' }], armed: null }, { cards: [{ ...good, cardId: 7 }], armed: null },
      { cards: [{ ...good, tier: 'bronze' }], armed: null }, { cards: [{ ...good, handsLeft: 'two' }], armed: null },
    ]) {
      expect(bonusNote(s, bad).chaos.bonus).toEqual(BONUS)
    }
  })

  it('takes my bonus hand from the snapshot, and an empty one when it carries none', () => {
    const snap = (bonus?: typeof BONUS) => reduceClient(inChaosRoom(), { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 30, room: chaosRoom(), hand: null, deadlineAt: null, chaos: { draft: null, ...(bonus ? { bonus } : {}) } }, now: 1 })
    expect(snap(BONUS).chaos.bonus).toEqual(BONUS)
    expect(snap().chaos.bonus).toEqual({ cards: [], armed: null })
  })

  it('keeps the bonus hand across hands and drafts, and forgets it on leaving and reset', () => {
    let s = bonusNote(inChaosRoom(), BONUS)
    s = game(s, 11, started)
    s = room(s, 12, draftFrame)
    expect(s.chaos.bonus).toEqual(BONUS)
    expect(reduceClient(s, { type: 'leftRoom' }).chaos.bonus).toEqual({ cards: [], armed: null })
    expect(reduceClient(s, { type: 'reset' }).chaos.bonus).toEqual({ cards: [], armed: null })
  })

  it('counts each seat\'s bonus cards from CHAOS_STATE, the snapshot roster and a seat sitting down', () => {
    let s = room(inChaosRoom(), 11, { type: 'CHAOS_STATE', seats: [{ seat: 0, cards: [], points: 0, bonusCount: 2 }, { seat: 1, cards: [], points: 4, bonusCount: 0 }] })
    expect(s.chaos.seats[0]!.bonusCount).toBe(2)
    expect(s.chaos.seats[1]!.bonusCount).toBe(0)
    s = room(s, 12, { type: 'PLAYER_SAT', playerId: 'p2', seat: 2, stack: 20000 })
    expect(s.chaos.seats[2]!.bonusCount).toBe(0)
    const withCount: RoomView = { ...chaosRoom(), players: chaosRoom().players.map((p) => (p.seat === 1 ? { ...p, chaos: { cards: [], points: 1, bonusCount: 3 } } : p)) }
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 30, room: withCount, hand: null, deadlineAt: null }, now: 1 })
    expect(s.chaos.seats[1]!.bonusCount).toBe(3)
    expect(s.chaos.seats[0]!.bonusCount).toBe(0)
  })

  it('carries the targets of each used card into result.chaosUsed', () => {
    let s = game(inChaosRoom(), 11, started)
    s = game(s, 12, { type: 'CHAOS_SUMMARY', used: [{ seat: 1, cardId: 's_steal_one', effect: 'stealHole', outcome: 'applied', targets: [0] }] })
    expect(s.hand!.result!.chaosUsed).toEqual([{ seat: 1, cardId: 's_steal_one', outcome: 'applied', targets: [0] }])
  })

  it('RESULT_SKIPS sets the count, the press stays mine while others join, and a hand starting ends the wait', () => {
    let s = skips(inChaosRoom(), 11, 0, 2)
    expect(s.resultSkips).toEqual({ skipped: 0, total: 2, mine: false })
    s = skips(s, 12, 1, 2)
    expect(s.resultSkips).toEqual({ skipped: 1, total: 2, mine: false })
    s = reduceClient(s, { type: 'resultSkipped' })
    expect(s.resultSkips).toEqual({ skipped: 1, total: 2, mine: true })
    s = skips(s, 13, 1, 3) // a seat joined the vote
    expect(s.resultSkips).toEqual({ skipped: 1, total: 3, mine: true })
    s = skips(s, 14, 0, 3) // a fresh count has nobody's press
    expect(s.resultSkips).toEqual({ skipped: 0, total: 3, mine: false })
    expect(game(s, 15, started).resultSkips).toBeNull()
  })

  it('the ack of my press does nothing outside a wait', () => {
    const s = inChaosRoom()
    expect(reduceClient(s, { type: 'resultSkipped' })).toBe(s)
  })

  it('a draft, a status with no next hand, leaving and reset end the wait', () => {
    const s = skips(inChaosRoom(), 11, 1, 2)
    expect(room(s, 12, draftFrame).resultSkips).toBeNull()
    expect(room(s, 12, { type: 'ROOM_STATUS', status: 'IN_GAME', nextHandAt: null }).resultSkips).toBeNull()
    expect(room(s, 12, { type: 'ROOM_STATUS', status: 'IN_GAME', nextHandAt: 99_000 }).resultSkips).toEqual({ skipped: 1, total: 2, mine: false })
    expect(reduceClient(s, { type: 'leftRoom' }).resultSkips).toBeNull()
    expect(reduceClient(s, { type: 'reset' }).resultSkips).toBeNull()
    expect(room(s, 12, { type: 'ROOM_CLOSED', reason: 'x' } as RoomEvent).resultSkips).toBeNull()
  })

  it('a snapshot brings the count back (a reconnect or a late joiner), with whether I pressed, and none outside a wait', () => {
    const snap = (resultSkips?: { skipped: number; total: number; mine?: boolean }) =>
      reduceClient(inChaosRoom(), { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 30, room: chaosRoom(), hand: null, deadlineAt: null, ...(resultSkips ? { resultSkips } : {}) }, now: 1 })
    expect(snap({ skipped: 2, total: 3, mine: true }).resultSkips).toEqual({ skipped: 2, total: 3, mine: true })
    expect(snap({ skipped: 0, total: 3 }).resultSkips).toEqual({ skipped: 0, total: 3, mine: false })
    expect(snap().resultSkips).toBeNull()
    expect(reduceClient(skips(inChaosRoom(), 11, 1, 2), { type: 'server', msg: { t: 'ROOM_SNAPSHOT', seq: 30, room: chaosRoom(), hand: null, deadlineAt: null }, now: 1 }).resultSkips).toBeNull()
  })
})
