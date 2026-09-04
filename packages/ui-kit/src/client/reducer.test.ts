import {
  applyCommand, createHand, filterEvent, legalActions, playerView, seededRng,
  type BlindRules, type GameEvent, type HandState, type HoldemRules, type PlayerAction, type RoomConfig, type RoomView, type ServerMessage,
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
  if (view.phase === 'BETTING' && view.actingSeat === me) expect(hand.legal).toEqual(view.legal)
  if (view.phase === 'DECISION' && !view.seats.find((s) => s.seat === me)?.hasDecided) expect(hand.legal?.kinds).toEqual(['play', 'fold'])
}

function playThrough(mode: 'holdem' | 'blind', rules: HoldemRules | BlindRules, seed: number, me: number, stacks: number[]) {
  const rng = seededRng(seed)
  const seqRef = { seq: 10 }
  let client = start(mode, rules, stacks, me)
  let { state, events } = createHand({ handId: `h${seed}`, rules, seats: stacks.map((stack, seat) => ({ seat, playerId: `p${seat}`, stack, isBot: false })), button: 0, carryOverIn: 0 }, rng)
  client = feed(client, events, me, seqRef)
  expectMirror(client, state, me)
  let guard = 0
  while (state.phase !== 'COMPLETE' && guard++ < 200) {
    let cmd: Parameters<typeof applyCommand>[1]
    if (state.phase === 'REVEAL') cmd = { type: 'ADVANCE' }
    else {
      const seat = state.phase === 'DECISION' ? state.players.find((p) => p.decision === null)!.seat : state.actingSeat!
      const legal = legalActions(state, seat)
      const kind = legal.kinds[rng.int(legal.kinds.length)]!
      const action: PlayerAction = kind === 'bet' ? { kind, amount: legal.minBet + rng.int(legal.maxBet - legal.minBet + 1) } : kind === 'raise' ? { kind, amount: legal.minRaiseTo + rng.int(legal.maxRaiseTo - legal.minRaiseTo + 1) } : { kind }
      cmd = { type: 'ACTION', seat, action }
    }
    ;({ state, events } = applyCommand(state, cmd, rng))
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
})
