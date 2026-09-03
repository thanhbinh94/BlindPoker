import { describe, expect, it } from 'vitest'
import type { Rng } from '../cards/rng.js'
import { seededRng } from '../cards/rng.js'
import { applyHoldemCommand, createHoldemHand, holdemLegalActions } from './holdem.js'
import { EngineError, type GameEvent, type HandState, type HoldemRules, type PlayerAction } from './types.js'

const RULES: HoldemRules = { mode: 'holdem', smallBlind: 50, bigBlind: 100, tableFeeRate: 0.02, tableFeeCapBB: 1 }
/** Fisher–Yates with j = i is the identity: deck stays 2c 3c 4c … so showdowns are predictable. */
const identityRng: Rng = { int: (n) => n - 1 }

class Table {
  state: HandState
  events: GameEvent[] = []
  readonly startStacks: number
  constructor(stacks: number[], button = 0, rng: Rng = seededRng(1)) {
    const seats = stacks.map((stack, seat) => ({ seat, playerId: `p${seat}`, stack, isBot: false }))
    const r = createHoldemHand({ handId: 'h1', rules: RULES, seats, button }, rng)
    this.state = r.state
    this.events.push(...r.events)
    this.startStacks = stacks.reduce((a, b) => a + b, 0)
  }
  act(seat: number, kind: PlayerAction['kind'], amount?: number) {
    const action = (amount === undefined ? { kind } : { kind, amount }) as PlayerAction
    const r = applyHoldemCommand(this.state, { type: 'ACTION', seat, action }, identityRng)
    this.state = r.state
    this.events.push(...r.events)
    return r.events
  }
  timeout(seat: number) {
    const r = applyHoldemCommand(this.state, { type: 'TIMEOUT', seat }, identityRng)
    this.state = r.state
    this.events.push(...r.events)
    return r.events
  }
  advance() {
    const r = applyHoldemCommand(this.state, { type: 'ADVANCE' }, identityRng)
    this.state = r.state
    this.events.push(...r.events)
    return r.events
  }
  legal(seat: number) {
    return holdemLegalActions(this.state, seat)
  }
  stack(seat: number) {
    return this.state.players.find((p) => p.seat === seat)!.stack
  }
  assertMoney() {
    const after = this.state.players.reduce((a, p) => a + p.stack, 0)
    expect(after + (this.state.result?.fee ?? 0) + this.state.pot * (this.state.phase === 'COMPLETE' ? 0 : 1)).toBe(this.startStacks)
  }
  types() {
    return this.events.map((e) => e.type)
  }
}

describe('createHoldemHand', () => {
  it('posts blinds, deals two cards each, and gives action to the seat after the BB', () => {
    const t = new Table([1000, 1000, 1000], 0)
    expect(t.state.players.every((p) => p.holeCards.length === 2)).toBe(true)
    expect(t.stack(1)).toBe(950)
    expect(t.stack(2)).toBe(900)
    expect(t.state.pot).toBe(150)
    expect(t.state.currentBet).toBe(100)
    expect(t.state.actingSeat).toBe(0)
    expect(t.types()).toEqual(['HAND_STARTED', 'CARDS_DEALT', 'CARDS_DEALT', 'CARDS_DEALT', 'BLINDS_POSTED', 'POT_UPDATED', 'TURN_CHANGED'])
  })
  it('heads-up: button posts SB and acts first preflop', () => {
    const t = new Table([1000, 1000], 1)
    expect(t.stack(1)).toBe(950)
    expect(t.stack(0)).toBe(900)
    expect(t.state.actingSeat).toBe(1)
    t.act(1, 'call')
    t.act(0, 'check')
    expect(t.state.street).toBe('FLOP')
    expect(t.state.actingSeat).toBe(0) // non-button acts first postflop
  })
  it('does not mutate the caller state', () => {
    const t = new Table([1000, 1000, 1000])
    const before = structuredClone(t.state)
    applyHoldemCommand(t.state, { type: 'ACTION', seat: 0, action: { kind: 'fold' } }, identityRng)
    expect(t.state).toEqual(before)
  })
  it('rejects fewer than two players or empty stacks', () => {
    expect(() => new Table([1000])).toThrow(EngineError)
    expect(() => new Table([1000, 0])).toThrow(EngineError)
  })
})

describe('legal actions', () => {
  it('offers call/raise/allIn/fold when facing a bet, check/bet when not', () => {
    const t = new Table([1000, 1000, 1000])
    expect(t.legal(0)).toEqual({ seat: 0, kinds: ['fold', 'call', 'raise', 'allIn'], callAmount: 100, minBet: 0, maxBet: 0, minRaiseTo: 200, maxRaiseTo: 1000 })
    t.act(0, 'call')
    t.act(1, 'call')
    expect(t.legal(2).kinds).toEqual(['fold', 'check', 'raise', 'allIn']) // BB option: raise, not bet
    t.act(2, 'check')
    expect(t.legal(1)).toEqual({ seat: 1, kinds: ['fold', 'check', 'bet', 'allIn'], callAmount: 0, minBet: 100, maxBet: 900, minRaiseTo: 0, maxRaiseTo: 0 })
  })
})

describe('betting rules', () => {
  it('everyone folds to the BB: BB wins without showdown, fee taken', () => {
    const t = new Table([1000, 1000, 1000])
    t.act(0, 'fold')
    t.act(1, 'fold')
    expect(t.state.phase).toBe('COMPLETE')
    expect(t.state.result!.showdown).toBeNull()
    // BB committed 100, SB 50 → 50 uncalled goes back; pot 100, fee floor(100 × 0.02) = 2 (cap 100)
    expect(t.state.result!.uncalledReturned).toEqual({ seat: 2, amount: 50 })
    expect(t.state.result!.fee).toBe(2)
    expect(t.stack(2)).toBe(1048) // 1000 − 100 + 50 + 98
    t.assertMoney()
  })
  it('caps the table fee at one big blind', () => {
    const t = new Table([5000, 5000], 0, identityRng)
    t.act(0, 'allIn') // heads-up: the button posts the SB and acts first
    t.act(1, 'call')
    t.advance(); t.advance(); t.advance()
    expect(t.state.phase).toBe('COMPLETE')
    // both committed 5000 → nothing uncalled; pot 10,000, floor(10,000 × 0.02) = 200, capped at 1 BB = 100
    expect(t.state.result!.uncalledReturned).toBeNull()
    expect(t.state.result!.fee).toBe(100)
    t.assertMoney()
  })
  it('gives folded, all-in and off-turn seats no legal actions', () => {
    const t = new Table([1000, 1000, 1000])
    expect(t.legal(1).kinds).toEqual([]) // not on turn
    t.act(0, 'fold')
    expect(t.legal(0).kinds).toEqual([]) // folded
    expect(t.legal(0)).toEqual({ seat: 0, kinds: [], callAmount: 0, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 })
    t.act(1, 'allIn')
    expect(t.legal(1).kinds).toEqual([]) // all-in
  })
  it('enforces min-raise = last raise increment and rejects smaller raises', () => {
    const t = new Table([5000, 5000, 5000])
    t.act(0, 'raise', 300)
    expect(t.legal(1).minRaiseTo).toBe(500)
    expect(() => t.act(1, 'raise', 450)).toThrow(/INVALID_AMOUNT/)
    t.act(1, 'raise', 800) // increment 500
    expect(t.legal(2).minRaiseTo).toBe(1300)
    expect(t.state.minRaise).toBe(500)
  })
  it('a short all-in raise does not reopen raising for players who already acted', () => {
    const t = new Table([1000, 1000, 400])
    t.act(0, 'raise', 300)
    t.act(1, 'call')
    t.act(2, 'allIn') // total 400: increment 100 < min raise 300
    expect(t.state.currentBet).toBe(400)
    expect(t.state.actingSeat).toBe(0)
    expect(t.legal(0).kinds).toEqual(['fold', 'call'])
    t.act(0, 'call')
    expect(t.legal(1).kinds).toEqual(['fold', 'call'])
    t.act(1, 'call')
    expect(t.state.street).toBe('FLOP')
    expect(t.state.phase).toBe('BETTING') // seats 0 and 1 can still bet
    expect(t.legal(1).kinds).toContain('bet') // seat 1 (first after the button) opens the flop
  })
  it('a full raise reopens action for everyone', () => {
    const t = new Table([5000, 5000, 5000])
    t.act(0, 'raise', 300)
    t.act(1, 'call')
    t.act(2, 'raise', 900)
    expect(t.legal(0).kinds).toContain('raise')
    expect(t.state.actingSeat).toBe(0)
  })
  it('rejects out-of-turn and illegal actions', () => {
    const t = new Table([1000, 1000, 1000])
    expect(() => t.act(1, 'call')).toThrow(/NOT_YOUR_TURN/)
    expect(() => t.act(0, 'check')).toThrow(/ILLEGAL_ACTION/)
    expect(() => t.act(0, 'bet', 300)).toThrow(/ILLEGAL_ACTION/)
    expect(() => t.act(0, 'raise', 5000)).toThrow(/INVALID_AMOUNT/)
    expect(() => t.advance()).toThrow(/INVALID_COMMAND/)
  })
  it('timeout checks when possible, otherwise folds', () => {
    const t = new Table([1000, 1000, 1000])
    t.timeout(0)
    expect(t.state.players[0]!.folded).toBe(true)
    t.act(1, 'call')
    const ev = t.timeout(2)
    expect(ev[0]).toMatchObject({ type: 'PLAYER_ACTED', seat: 2, action: { kind: 'check' }, timedOut: true })
    expect(t.state.street).toBe('FLOP')
  })
})

describe('streets, run-out and showdown', () => {
  it('check-around reaches showdown through all streets', () => {
    const t = new Table([1000, 1000, 1000])
    t.act(0, 'call'); t.act(1, 'call'); t.act(2, 'check')
    for (const street of ['FLOP', 'TURN', 'RIVER']) {
      expect(t.state.street).toBe(street)
      t.act(1, 'check'); t.act(2, 'check'); t.act(0, 'check')
    }
    expect(t.state.phase).toBe('COMPLETE')
    expect(t.state.result!.showdown).toHaveLength(3)
    expect(t.types().filter((x) => x === 'COMMUNITY_REVEALED')).toHaveLength(3)
    expect(t.types().slice(-3)).toEqual(['SHOWDOWN', 'SETTLEMENT', 'HAND_COMPLETE'])
    t.assertMoney()
  })
  it('all-in preflop and called → REVEAL phase driven by ADVANCE', () => {
    const t = new Table([1000, 1000], 0)
    t.act(0, 'allIn')
    t.act(1, 'call')
    expect(t.state.phase).toBe('REVEAL')
    expect(t.state.revealQueue).toEqual(['FLOP', 'TURN', 'RIVER'])
    t.advance(); t.advance()
    expect(t.state.phase).toBe('REVEAL')
    t.advance()
    expect(t.state.phase).toBe('COMPLETE')
    expect(t.state.community).toHaveLength(5)
    t.assertMoney()
  })
  it('side pots: short all-in, ties split with odd chip after the button', () => {
    // identity deck: seat1 gets 2c 5c, seat2 3c 6c, seat0 4c 7c; board 8c 9c Tc Jc Qc → everyone plays the board straight flush
    const t = new Table([1000, 1000, 400], 0, identityRng)
    t.act(0, 'raise', 300); t.act(1, 'call'); t.act(2, 'allIn'); t.act(0, 'call'); t.act(1, 'call')
    t.act(1, 'bet', 200); t.act(0, 'call') // flop
    t.act(1, 'check'); t.act(0, 'check')   // turn
    t.act(1, 'check'); t.act(0, 'check')   // river
    const r = t.state.result!
    expect(r.pots.map((p) => [p.amount, p.eligibleSeats])).toEqual([[1200 - 32, [0, 1, 2]], [400, [0, 1]]])
    expect(r.fee).toBe(32)
    // main 1168 / 3 = 389 r1 → odd chip to seat 1 (first after button 0); side 400 / 2 = 200
    expect(t.stack(1)).toBe(1000 - 600 + 390 + 200)
    expect(t.stack(0)).toBe(1000 - 600 + 389 + 200)
    expect(t.stack(2)).toBe(389)
    t.assertMoney()
  })
})
