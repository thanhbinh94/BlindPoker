import { describe, expect, it } from 'vitest'
import type { Rng } from '../cards/rng.js'
import { seededRng } from '../cards/rng.js'
import { applyBlindCommand, blindLegalActions, blindRequiredStack, createBlindHand } from './blind.js'
import { EngineError, type BlindRules, type GameEvent, type HandState } from './types.js'

const identityRng: Rng = { int: (n) => n - 1 }
const rules = (over: Partial<BlindRules> = {}): BlindRules => ({ mode: 'blind', holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1000, tableFeeRate: 0.02, ...over })

class Table {
  state: HandState
  events: GameEvent[] = []
  readonly startTotal: number
  constructor(r: BlindRules, stacks: number[], carryOverIn = 0, button = 0, rng: Rng = seededRng(3)) {
    const seats = stacks.map((stack, seat) => ({ seat, playerId: `p${seat}`, stack, isBot: false }))
    const res = createBlindHand({ handId: 'b1', rules: r, seats, button, carryOverIn }, rng)
    this.state = res.state
    this.events.push(...res.events)
    this.startTotal = stacks.reduce((a, b) => a + b, 0) + carryOverIn
  }
  apply(cmd: Parameters<typeof applyBlindCommand>[1]) {
    const r = applyBlindCommand(this.state, cmd, identityRng)
    this.state = r.state
    this.events.push(...r.events)
    return r.events
  }
  play(seat: number) { return this.apply({ type: 'ACTION', seat, action: { kind: 'play' } }) }
  fold(seat: number) { return this.apply({ type: 'ACTION', seat, action: { kind: 'fold' } }) }
  advanceAll() { while (this.state.phase === 'REVEAL') this.apply({ type: 'ADVANCE' }) }
  stack(seat: number) { return this.state.players.find((p) => p.seat === seat)!.stack }
  assertMoney() {
    const r = this.state.result!
    const after = this.state.players.reduce((a, p) => a + p.stack, 0)
    expect(after + r.fee + r.carryOverOut).toBe(this.startTotal)
  }
  types() { return this.events.map((e) => e.type) }
}

describe('setup', () => {
  it('required stack depends on decision mode', () => {
    expect(blindRequiredStack(rules({ decisionMode: 'none' }))).toBe(1000)
    expect(blindRequiredStack(rules({ decisionMode: 'playOrFold' }))).toBe(2000)
  })
  it('antes every seat, deals the configured hole cards, adds carry-over', () => {
    const t = new Table(rules({ holeCards: 3 }), [5000, 5000, 5000], 700)
    expect(t.state.players.every((p) => p.holeCards.length === 3 && p.stack === 4000)).toBe(true)
    expect(t.state.pot).toBe(3700)
    expect(t.state.carryOverIn).toBe(700)
    expect(t.state.phase).toBe('DECISION')
    expect(t.types()).toEqual(['HAND_STARTED', 'BLINDS_POSTED', 'POT_UPDATED', 'CARDS_DEALT', 'CARDS_DEALT', 'CARDS_DEALT', 'DECISION_PHASE'])
  })
  it('rejects a seat that cannot afford the required stack', () => {
    expect(() => new Table(rules(), [5000, 1500])).toThrow(EngineError)
    expect(() => new Table(rules({ decisionMode: 'none' }), [5000, 1500])).not.toThrow()
  })
})

describe('mode A (no decision)', () => {
  it('goes straight to REVEAL and settles after three ADVANCEs with a fee', () => {
    const t = new Table(rules({ decisionMode: 'none' }), [5000, 5000], 0, 0, identityRng)
    expect(t.state.phase).toBe('REVEAL')
    expect(t.state.revealQueue).toEqual(['FLOP', 'TURN', 'RIVER'])
    t.advanceAll()
    expect(t.state.phase).toBe('COMPLETE')
    expect(t.state.community).toHaveLength(5)
    expect(t.state.result!.fee).toBe(40) // 2% of 2000
    expect(t.state.result!.showdown).toHaveLength(2)
    t.assertMoney()
  })
})

describe('mode B (play or fold)', () => {
  it('offers play/fold only to undecided seats and hides decisions until all decided', () => {
    const t = new Table(rules(), [5000, 5000, 5000])
    expect(blindLegalActions(t.state, 0)).toMatchObject({ kinds: ['play', 'fold'], callAmount: 1000 })
    const ev = t.play(0)
    expect(ev.map((e) => e.type)).toEqual(['PLAYER_ACTED', 'DECISION_MADE', 'POT_UPDATED'])
    expect(blindLegalActions(t.state, 0).kinds).toEqual([])
    expect(() => t.play(0)).toThrow(/NOT_YOUR_TURN/)
    expect(t.stack(0)).toBe(3000)
    expect(t.state.phase).toBe('DECISION')
  })
  it('one player plays → wins the pot immediately without reveal', () => {
    const t = new Table(rules(), [5000, 5000, 5000])
    t.play(1); t.fold(0); t.fold(2)
    expect(t.state.phase).toBe('COMPLETE')
    expect(t.state.community).toHaveLength(0)
    expect(t.state.result!.showdown).toBeNull()
    // pot 3000 + 1000 = 4000, fee 80 → 3920 to seat 1 who put in 2000
    expect(t.stack(1)).toBe(5000 - 2000 + 3920)
    expect(t.types().slice(-3)).toEqual(['DECISIONS_REVEALED', 'SETTLEMENT', 'HAND_COMPLETE'])
    t.assertMoney()
  })
  it('everyone folds → pot carries over, no fee', () => {
    const t = new Table(rules(), [5000, 5000], 500)
    t.fold(0); t.fold(1)
    expect(t.state.phase).toBe('COMPLETE')
    expect(t.state.result!.carryOverOut).toBe(2500)
    expect(t.state.result!.fee).toBe(0)
    expect(t.stack(0)).toBe(4000)
    t.assertMoney()
  })
  it('timeout counts as fold', () => {
    const t = new Table(rules(), [5000, 5000, 5000])
    t.play(0); t.play(1)
    const ev = t.apply({ type: 'TIMEOUT', seat: 2 })
    expect(ev[0]).toMatchObject({ type: 'PLAYER_ACTED', seat: 2, action: { kind: 'fold' }, timedOut: true })
    expect(t.state.phase).toBe('REVEAL')
    expect(t.state.players[2]!.folded).toBe(true)
  })
  it('two or more players → reveal and showdown among players only', () => {
    const t = new Table(rules({ holeCards: 3 }), [5000, 5000, 5000], 0, 0, identityRng)
    t.play(0); t.play(2); t.fold(1)
    expect(t.state.phase).toBe('REVEAL')
    t.advanceAll()
    const r = t.state.result!
    expect(r.showdown!.map((h) => h.seat)).toEqual([0, 2])
    expect(r.showdown![0]!.cards).toHaveLength(3)
    expect(r.fee).toBe(100) // pot 3000 + 2000 = 5000
    expect(r.pots.map((p) => p.eligibleSeats)).toEqual([[0, 2]])
    t.assertMoney()
  })
  it('rejects ADVANCE during DECISION and actions after completion', () => {
    const t = new Table(rules(), [5000, 5000])
    expect(() => t.apply({ type: 'ADVANCE' })).toThrow(/INVALID_COMMAND/)
    expect(() => t.apply({ type: 'ACTION', seat: 0, action: { kind: 'call' } })).toThrow(/ILLEGAL_ACTION/)
    t.fold(0); t.fold(1)
    expect(() => t.fold(0)).toThrow(/HAND_COMPLETE/)
  })
})
