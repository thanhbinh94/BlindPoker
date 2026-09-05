import {
  applyCommand, createHand, filterEvent, legalActions, playerView, seededRng,
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
    players: stacks.map((stack, seat) => ({ playerId: `p${seat}`, displayName: `P${seat}`, isBot: false, isHost: seat === 0, connected: true, seat, status: 'IN_HAND', stack, ready: true })),
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
    client = { ...client, room: { ...client.room!, players: [...client.room!.players, { playerId: 'p5', displayName: 'P5', isBot: false, isHost: false, connected: true, seat: null, status: null, stack: 0, ready: false }] } }
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
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq: 43, event: { type: 'PLAYER_JOINED', player: { playerId: 'p9', displayName: 'P9', isBot: false, isHost: false, connected: true, seat: null, status: null, stack: 0, ready: false } } }, now: 0 })
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

  it('PLAYER_SIT_OUT moves the seat status both ways and leaves the seatless and the offline alone', () => {
    let s = start('holdem', HOLDEM_RULES, [20000, 20000], 1)
    const statusOf = (id: string) => s.room!.players.find((p) => p.playerId === id)!.status
    const sitOut = (playerId: string, sittingOut: boolean, seq: number): ClientState =>
      reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq, event: { type: 'PLAYER_SIT_OUT', playerId, sittingOut } }, now: 0 })

    s = sitOut('p1', true, 11)
    expect(statusOf('p1')).toBe('SITTING_OUT')
    s = sitOut('p1', false, 12)
    expect(statusOf('p1')).toBe('READY') // the fixture's seats are ready; an unready one goes back to SEATED

    // A spectator has no seat to sit out of, and a seat that is offline keeps saying so.
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq: 13, event: { type: 'PLAYER_JOINED', player: { playerId: 'p9', displayName: 'P9', isBot: false, isHost: false, connected: true, seat: null, status: null, stack: 0, ready: false } } }, now: 0 })
    s = sitOut('p9', true, 14)
    expect(statusOf('p9')).toBeNull()
    s = reduceClient(s, { type: 'server', msg: { t: 'ROOM_EVENT', seq: 15, event: { type: 'PLAYER_DISCONNECTED', playerId: 'p0', deadline: 0 } }, now: 0 })
    s = sitOut('p0', true, 16)
    expect(statusOf('p0')).toBe('DISCONNECTED')
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
