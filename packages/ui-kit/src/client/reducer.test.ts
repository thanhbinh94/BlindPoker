import {
  applyCommand, createHand, filterEvent, legalActions, parseCards, playerView, seededRng,
  type BlindRules, type GameEvent, type HandState, type HoldemRules, type PlayerAction, type Rng, type RoomConfig, type RoomView, type ServerMessage,
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
    state = reduceClient(state, { type: 'server', msg: { t: 'GAME_EVENT', seq: seqRef.seq, event: filterEvent(e, me) }, now: 0 })
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
  // The stack each seat had before the hand was settled — what the table keeps showing while the result is held back
  // (the reveal hold) — is the settled stack less what the settlement paid that seat and handed back to it.
  const result = client.hand!.result!
  for (const cs of client.hand!.seats) {
    const paid = result.payouts.filter((p) => p.seat === cs.seat).reduce((sum, p) => sum + p.amount, 0)
    const returned = result.uncalledReturned?.seat === cs.seat ? result.uncalledReturned.amount : 0
    expect(cs.stackBeforeResult, `seat ${cs.seat}: the stack before the settlement`).toBe(cs.stack - paid - returned)
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
