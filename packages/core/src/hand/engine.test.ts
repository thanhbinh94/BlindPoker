import { describe, expect, it } from 'vitest'
import { seededRng } from '../cards/rng.js'
import { applyCommand, createHand, legalActions, nextButton } from './engine.js'
import { randomPolicy, simulateHand, type Policy } from './simulate.js'
import { EngineError, type BlindRules, type GameEvent, type HoldemRules } from './types.js'
import { filterEvent, playerView } from './view.js'

const HOLDEM: HoldemRules = { mode: 'holdem', smallBlind: 50, bigBlind: 100, tableFeeRate: 0.02, tableFeeCapBB: 1 }
const BLIND_B: BlindRules = { mode: 'blind', holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1000, tableFeeRate: 0.02 }
const seats = (stacks: number[]) => stacks.map((stack, seat) => ({ seat, playerId: `p${seat}`, stack, isBot: false }))
/** Checks when possible, otherwise calls: both players check down to a showdown. */
const passive: Policy = (_v, legal) => ({ kind: legal.kinds.includes('check') ? 'check' : 'call' })

describe('facade', () => {
  it('dispatches by mode', () => {
    const h = createHand({ handId: 'a', rules: HOLDEM, seats: seats([1000, 1000]), button: 0 }, seededRng(1))
    expect(h.state.phase).toBe('BETTING')
    const b = createHand({ handId: 'b', rules: BLIND_B, seats: seats([5000, 5000]), button: 0 }, seededRng(1))
    expect(b.state.phase).toBe('DECISION')
    expect(legalActions(b.state, 0).kinds).toEqual(['play', 'fold'])
    const b2 = applyCommand(b.state, { type: 'ACTION', seat: 0, action: { kind: 'play' } }, seededRng(1))
    expect(b2.state.players[0]!.decision).toBe('play')
  })
  it('nextButton picks randomly first, then the next clockwise active seat', () => {
    expect([0, 3, 5]).toContain(nextButton(null, [0, 3, 5], seededRng(9)))
    expect(nextButton(3, [0, 3, 5], seededRng(9))).toBe(5)
    expect(nextButton(5, [0, 3, 5], seededRng(9))).toBe(0)
    expect(nextButton(4, [0, 3, 5], seededRng(9))).toBe(5) // previous button seat left the table
  })
})

describe('playerView', () => {
  it('hides other hole cards and decisions but shows my own', () => {
    let { state } = createHand({ handId: 'b', rules: BLIND_B, seats: seats([5000, 5000, 5000]), button: 0 }, seededRng(2))
    state = applyCommand(state, { type: 'ACTION', seat: 1, action: { kind: 'play' } }, seededRng(1)).state
    const v = playerView(state, 0)
    expect(v.mySeat).toBe(0)
    expect(v.seats[0]!.holeCards).toHaveLength(2)
    expect(v.seats[1]!.holeCards).toBeNull()
    expect(v.seats[1]!.cardCount).toBe(2)
    expect(v.seats[1]!.hasDecided).toBe(true)
    expect(v.seats[1]!.decision).toBeNull()
    expect(v.seats[1]!.stack).toBe(4000) // unchanged from before the decision: the wager waits for resolution
    expect(v.pot).toBe(3000)
    const spectator = playerView(state, null)
    expect(spectator.mySeat).toBeNull()
    expect(spectator.seats.every((s) => s.holeCards === null)).toBe(true)
    expect(v.seats[0]!.decision).toBeNull() // not decided yet myself
  })
  it('reveals showdown hands after completion', () => {
    const { state } = simulateHand({ handId: 'x', rules: HOLDEM, seats: seats([1000, 1000]), button: 0 }, passive, seededRng(5))
    const v = playerView(state, null)
    expect(v.result?.showdown).not.toBeNull()
    expect(v.seats.filter((s) => s.holeCards !== null)).toHaveLength(2)
  })
})

describe('filterEvent', () => {
  const dealt = (): GameEvent[] => createHand({ handId: 'f', rules: HOLDEM, seats: seats([1000, 1000, 1000]), button: 0 }, seededRng(4)).events.filter((e) => e.type === 'CARDS_DEALT')

  it('keeps my own hole cards and blanks everyone else’s', () => {
    const [mine, other] = dealt() as [GameEvent & { type: 'CARDS_DEALT' }, GameEvent & { type: 'CARDS_DEALT' }]
    expect(filterEvent(mine, 0)).toEqual(mine)
    const hidden = filterEvent(other, 0) as GameEvent & { type: 'CARDS_DEALT' }
    expect(hidden.cards).toEqual([])
    expect(hidden.cardCount).toBe(2)
    expect(hidden.seat).toBe(1)
    expect(other.cards).toHaveLength(2) // the original event is untouched
  })
  it('hides every hand from a spectator', () => {
    for (const e of dealt()) {
      const f = filterEvent(e, null) as GameEvent & { type: 'CARDS_DEALT' }
      expect(f.cards).toEqual([])
      expect(f.cardCount).toBe(2)
    }
  })
  it('passes non-card events through unchanged', () => {
    const { state } = simulateHand({ handId: 'y', rules: HOLDEM, seats: seats([1000, 1000]), button: 0 }, passive, seededRng(5))
    const showdown: GameEvent = { type: 'SHOWDOWN', hands: state.result!.showdown! }
    expect(filterEvent(showdown, 1)).toBe(showdown)
  })
})

describe('HandView.legal', () => {
  it('is filled for the acting seat and null for everyone else', () => {
    const { state } = createHand({ handId: 'l', rules: HOLDEM, seats: seats([1000, 1000, 1000]), button: 0 }, seededRng(6))
    expect(state.actingSeat).toBe(0)
    expect(playerView(state, 0).legal?.kinds).toEqual(['fold', 'call', 'raise', 'allIn'])
    expect(playerView(state, 1).legal).toBeNull()
    expect(playerView(state, null).legal).toBeNull()
  })
  it('is filled for every undecided seat during DECISION and null once the hand completes', () => {
    let { state } = createHand({ handId: 'l2', rules: BLIND_B, seats: seats([5000, 5000]), button: 0 }, seededRng(7))
    expect(playerView(state, 0).legal?.kinds).toEqual(['play', 'fold'])
    expect(playerView(state, 1).legal?.kinds).toEqual(['play', 'fold'])
    state = applyCommand(state, { type: 'ACTION', seat: 0, action: { kind: 'play' } }, seededRng(1)).state
    expect(playerView(state, 0).legal?.kinds).toEqual([]) // already decided
    state = applyCommand(state, { type: 'ACTION', seat: 1, action: { kind: 'fold' } }, seededRng(1)).state
    expect(state.phase).toBe('COMPLETE')
    expect(playerView(state, 0).legal).toBeNull()
  })
})

describe('CANCEL', () => {
  it('refunds a hold’em hand cancelled mid-flop', () => {
    let { state } = createHand({ handId: 'c1', rules: HOLDEM, seats: seats([1000, 1000, 1000]), button: 0 }, seededRng(8))
    for (const seat of [0, 1]) state = applyCommand(state, { type: 'ACTION', seat, action: { kind: 'call' } }, seededRng(1)).state
    state = applyCommand(state, { type: 'ACTION', seat: 2, action: { kind: 'check' } }, seededRng(1)).state
    state = applyCommand(state, { type: 'ACTION', seat: 1, action: { kind: 'bet', amount: 300 } }, seededRng(1)).state
    expect(state.street).toBe('FLOP')
    expect(state.pot).toBe(600)
    const res = applyCommand(state, { type: 'CANCEL', reason: 'server restart' }, seededRng(1))
    expect(res.events.map((e) => e.type)).toEqual(['HAND_CANCELLED', 'HAND_COMPLETE'])
    expect(res.events[0]).toMatchObject({ reason: 'server restart', carryOverOut: 0, refunds: [{ seat: 0, amount: 100 }, { seat: 1, amount: 400 }, { seat: 2, amount: 100 }] })
    expect(res.state.players.map((p) => p.stack)).toEqual([1000, 1000, 1000])
    expect(res.state.pot).toBe(0)
    expect(res.state.phase).toBe('COMPLETE')
    expect(res.state.result).toMatchObject({ fee: 0, payouts: [], carryOverOut: 0, uncalledReturned: null })
  })
  it('refunds antes and keeps the carry-over when a blind hand is cancelled during DECISION', () => {
    const { state } = createHand({ handId: 'c2', rules: BLIND_B, seats: seats([5000, 5000, 5000]), button: 0, carryOverIn: 1500 }, seededRng(9))
    expect(state.phase).toBe('DECISION')
    const res = applyCommand(state, { type: 'CANCEL', reason: 'room closed' }, seededRng(1))
    expect(res.state.players.map((p) => p.stack)).toEqual([5000, 5000, 5000])
    expect(res.state.result!.carryOverOut).toBe(1500)
    expect(res.state.result!.fee).toBe(0)
    expect(res.events[0]).toMatchObject({ type: 'HAND_CANCELLED', carryOverOut: 1500 })
  })
  it('cannot cancel a completed hand', () => {
    const { state } = simulateHand({ handId: 'c3', rules: HOLDEM, seats: seats([1000, 1000]), button: 0 }, passive, seededRng(10))
    expect(() => applyCommand(state, { type: 'CANCEL', reason: 'too late' }, seededRng(1))).toThrow(EngineError)
    expect(() => applyCommand(state, { type: 'CANCEL', reason: 'too late' }, seededRng(1))).toThrow(/HAND_COMPLETE/)
  })
})

describe('simulation invariants', () => {
  it('random hold’em hands never break money conservation or produce illegal states', () => {
    const rng = seededRng(2024)
    for (let i = 0; i < 300; i++) {
      const n = 2 + rng.int(8)
      const stacks = Array.from({ length: n }, () => 100 + rng.int(5000))
      const { state } = simulateHand({ handId: `h${i}`, rules: HOLDEM, seats: seats(stacks), button: rng.int(n) }, randomPolicy, rng)
      expect(state.phase).toBe('COMPLETE')
      expect(state.players.every((p) => p.stack >= 0)).toBe(true)
    }
  })
  it('random blind hands (2/3 cards, modes A/B) conserve money', () => {
    const rng = seededRng(77)
    for (let i = 0; i < 300; i++) {
      const n = 2 + rng.int(7)
      const rules: BlindRules = { ...BLIND_B, holeCards: rng.int(2) === 0 ? 2 : 3, decisionMode: rng.int(2) === 0 ? 'none' : 'playOrFold' }
      const stacks = Array.from({ length: n }, () => 2000 + rng.int(10000))
      const { state } = simulateHand({ handId: `b${i}`, rules, seats: seats(stacks), button: rng.int(n), carryOverIn: rng.int(3) === 0 ? 1500 : 0 }, randomPolicy, rng)
      expect(state.phase).toBe('COMPLETE')
    }
  })
  it('a squeeze hand is stepped through by turning every unturned seat', () => {
    const rules: BlindRules = { ...BLIND_B, decisionMode: 'none', squeeze: true }
    const { state, events } = simulateHand({ handId: 's', rules, seats: seats([5000, 5000, 5000]), button: 0 }, randomPolicy, seededRng(4))
    expect(state.phase).toBe('COMPLETE')
    expect(events.filter((e) => e.type === 'PLAYER_REVEALED')).toHaveLength(3)
    expect(events.filter((e) => e.type === 'SQUEEZE_ENDED')).toHaveLength(1)
  })
})
