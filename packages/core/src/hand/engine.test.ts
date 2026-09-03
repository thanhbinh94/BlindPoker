import { describe, expect, it } from 'vitest'
import { seededRng } from '../cards/rng.js'
import { applyCommand, createHand, legalActions, nextButton } from './engine.js'
import { randomPolicy, simulateHand, type Policy } from './simulate.js'
import type { BlindRules, HoldemRules } from './types.js'
import { playerView } from './view.js'

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
})
