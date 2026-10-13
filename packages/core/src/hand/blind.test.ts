import { describe, expect, it } from 'vitest'
import type { Rng } from '../cards/rng.js'
import { seededRng } from '../cards/rng.js'
import { applyBlindCommand, blindLegalActions, blindRequiredStack, blindTableLimit, createBlindHand } from './blind.js'
import { playerView } from './view.js'
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
  it('sets the table limit at five wagers for every tier (spec 2026-09-29)', () => {
    expect([1_000, 2_000, 5_000, 10_000, 20_000, 50_000].map((fixedWager) => blindTableLimit({ fixedWager }))).toEqual([
      5_000, 10_000, 25_000, 50_000, 100_000, 250_000,
    ])
    expect(blindTableLimit(rules({ decisionMode: 'playOrFold' }))).toBe(5_000) // the mode does not change it
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
    expect(ev.map((e) => e.type)).toEqual(['DECISION_MADE'])
    expect(blindLegalActions(t.state, 0).kinds).toEqual([])
    expect(() => t.play(0)).toThrow(/NOT_YOUR_TURN/)
    expect(t.stack(0)).toBe(4000) // wager is only committed once every seat has decided
    expect(t.state.pot).toBe(3000)
    expect(t.state.phase).toBe('DECISION')
    // nothing observable to seat 1 tells them what seat 0 chose
    const v = playerView(t.state, 1)
    expect(v.pot).toBe(3000)
    expect(v.seats[0]).toMatchObject({ stack: 4000, totalCommitted: 1000, hasDecided: true, decision: null })
  })
  it('reveals every decision at once when the last seat decides', () => {
    const t = new Table(rules(), [5000, 5000, 5000])
    t.play(0); t.fold(1)
    const ev = t.play(2)
    expect(ev.map((e) => e.type)).toEqual([
      'DECISION_MADE', 'PLAYER_ACTED', 'PLAYER_ACTED', 'PLAYER_ACTED', 'POT_UPDATED', 'DECISIONS_REVEALED',
    ])
    expect(ev.filter((e) => e.type === 'PLAYER_ACTED')).toMatchObject([
      { seat: 0, action: { kind: 'play' } }, { seat: 1, action: { kind: 'fold' } }, { seat: 2, action: { kind: 'play' } },
    ])
    expect(t.stack(0)).toBe(3000)
    expect(t.stack(1)).toBe(4000)
    expect(t.state.pot).toBe(5000)
    expect(t.state.phase).toBe('REVEAL')
  })
  it('one player plays → wins the pot immediately without reveal', () => {
    const t = new Table(rules(), [5000, 5000, 5000])
    t.play(1); t.fold(0); t.fold(2)
    expect(t.state.phase).toBe('COMPLETE')
    expect(t.state.community).toHaveLength(0)
    expect(t.state.result!.showdown).toBeNull()
    // seat 1 committed 2000, the folders 1000 each → 1000 uncalled goes back
    expect(t.state.result!.uncalledReturned).toEqual({ seat: 1, amount: 1000 })
    // pot 3000, fee 60 → 2940 to seat 1
    expect(t.state.result!.fee).toBe(60)
    expect(t.stack(1)).toBe(5000 - 2000 + 1000 + 2940) // 6940
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
    expect(ev).toContainEqual(expect.objectContaining({ type: 'PLAYER_ACTED', seat: 2, action: { kind: 'fold' } }))
    expect(t.state.phase).toBe('REVEAL')
    expect(t.state.players[2]!.folded).toBe(true)
  })
  it('a seat the timer folds is reported timedOut once the decisions resolve; a chosen play or fold is not (spec §8.7)', () => {
    const t = new Table(rules(), [5000, 5000, 5000, 5000])
    // Nothing about a timer may leave the engine while the round is open: DECISION_MADE stays as bare as for a choice.
    expect(t.play(0)).toEqual([{ type: 'DECISION_MADE', seat: 0 }])
    expect(t.fold(1)).toEqual([{ type: 'DECISION_MADE', seat: 1 }])
    expect(t.apply({ type: 'TIMEOUT', seat: 2 })).toEqual([{ type: 'DECISION_MADE', seat: 2 }])
    const ev = t.apply({ type: 'TIMEOUT', seat: 3 })
    expect(ev.filter((e) => e.type === 'PLAYER_ACTED')).toMatchObject([
      { seat: 0, action: { kind: 'play' }, timedOut: false },
      { seat: 1, action: { kind: 'fold' }, timedOut: false }, // an explicit fold is a real action
      { seat: 2, action: { kind: 'fold' }, timedOut: true },
      { seat: 3, action: { kind: 'fold' }, timedOut: true },
    ])
  })
  it('nothing of the timer reaches a client before the reveal: a timed-out seat reads like any other decided seat', () => {
    const timed = new Table(rules(), [5000, 5000, 5000])
    timed.apply({ type: 'TIMEOUT', seat: 2 })
    const chosen = new Table(rules(), [5000, 5000, 5000])
    chosen.fold(2)
    expect(playerView(timed.state, 0)).toEqual(playerView(chosen.state, 0))
    expect(JSON.stringify(playerView(timed.state, 0))).not.toContain('timedOut')
  })
  it('a hand every seat times out of folds them all and carries the pot, each reported timedOut', () => {
    const t = new Table(rules(), [5000, 5000])
    t.apply({ type: 'TIMEOUT', seat: 0 })
    const ev = t.apply({ type: 'TIMEOUT', seat: 1 })
    expect(ev.filter((e) => e.type === 'PLAYER_ACTED')).toMatchObject([{ seat: 0, timedOut: true }, { seat: 1, timedOut: true }])
    expect(t.state.phase).toBe('COMPLETE')
    expect(t.state.result!.carryOverOut).toBe(2000)
    t.assertMoney()
  })
  it('timeout for an already-decided seat is a no-op', () => {
    const t = new Table(rules(), [5000, 5000, 5000])
    t.play(0)
    const before = structuredClone(t.state)
    const ev = t.apply({ type: 'TIMEOUT', seat: 0 })
    expect(ev).toEqual([])
    expect(t.state).toEqual(before)
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

describe('squeeze mode (spec 2026-10-08)', () => {
  const squeezeRules = (decisionMode: BlindRules['decisionMode']) => rules({ decisionMode, squeeze: true })
  /** Three seats; `bots` names the bot seats. */
  const deal = (decisionMode: BlindRules['decisionMode'], bots: number[] = []) => {
    const seats = [0, 1, 2].map((seat) => ({ seat, playerId: `p${seat}`, stack: 5000, isBot: bots.includes(seat) }))
    return createBlindHand({ handId: 'sq', rules: squeezeRules(decisionMode), seats, button: 0, carryOverIn: 0 }, seededRng(3))
  }
  const step = (state: HandState, cmd: Parameters<typeof applyBlindCommand>[1]) => applyBlindCommand(state, cmd, identityRng)

  it('pure luck: deals into a SQUEEZE phase, bots already revealed, ending when every human has turned', () => {
    const { state, events } = deal('none', [2])
    expect(state.phase).toBe('SQUEEZE')
    expect(state.players.map((p) => p.revealed)).toEqual([false, false, true])
    expect(events.at(-1)).toEqual({ type: 'SQUEEZE_PHASE', seats: [0, 1], turnSeq: 1 })
    expect(state.turnSeq).toBe(1)

    const r1 = step(state, { type: 'REVEALED', seat: 0 })
    expect(r1.events).toEqual([{ type: 'PLAYER_REVEALED', seat: 0 }])
    expect(r1.state.phase).toBe('SQUEEZE')
    const again = step(r1.state, { type: 'REVEALED', seat: 0 })
    expect(again.events).toEqual([]) // a second REVEALED from the same seat is nothing
    const r2 = step(again.state, { type: 'REVEALED', seat: 1 })
    expect(r2.events).toEqual([{ type: 'PLAYER_REVEALED', seat: 1 }, { type: 'SQUEEZE_ENDED' }])
    expect(r2.state.phase).toBe('REVEAL')
    // From here the hand runs out as any pure-luck hand does.
    let s = r2.state
    while (s.phase === 'REVEAL') s = step(s, { type: 'ADVANCE' }).state
    expect(s.phase).toBe('COMPLETE')
    expect(s.result?.showdown).not.toBeNull()
  })

  it('a table of bots only skips the phase: SQUEEZE_PHASE names nobody and the hand is in REVEAL at once', () => {
    const { state, events } = deal('none', [0, 1, 2])
    expect(events.filter((e) => e.type === 'SQUEEZE_PHASE' || e.type === 'SQUEEZE_ENDED')).toEqual([
      { type: 'SQUEEZE_PHASE', seats: [], turnSeq: 1 },
      { type: 'SQUEEZE_ENDED' },
    ])
    expect(state.phase).toBe('REVEAL')
  })

  it('play or fold: no SQUEEZE phase; REVEALED marks the seat without ending the round; a decision turns the cards too', () => {
    const { state } = deal('playOrFold')
    expect(state.phase).toBe('DECISION')
    expect(state.players.map((p) => p.revealed)).toEqual([false, false, false])
    const r1 = step(state, { type: 'REVEALED', seat: 1 })
    expect(r1.events).toEqual([{ type: 'PLAYER_REVEALED', seat: 1 }])
    expect(r1.state.phase).toBe('DECISION')
    // Deciding without having turned: the engine turns the cards for the seat, before the decision is recorded.
    const r2 = step(r1.state, { type: 'ACTION', seat: 0, action: { kind: 'play' } })
    expect(r2.events).toEqual([{ type: 'PLAYER_REVEALED', seat: 0 }, { type: 'DECISION_MADE', seat: 0 }])
    // A seat that had turned already decides with no second PLAYER_REVEALED.
    const r3 = step(r2.state, { type: 'ACTION', seat: 1, action: { kind: 'fold' } })
    expect(r3.events).toEqual([{ type: 'DECISION_MADE', seat: 1 }])
  })

  it('play or fold: a decision the timer folds still counts as a timeout, the squeeze riding on the decision round (§8.7)', () => {
    const { state } = deal('playOrFold', [2])
    const r1 = step(state, { type: 'TIMEOUT', seat: 0 })
    expect(r1.events).toEqual([{ type: 'PLAYER_REVEALED', seat: 0 }, { type: 'DECISION_MADE', seat: 0 }]) // cards turned, nothing else said
    const r2 = step(r1.state, { type: 'ACTION', seat: 1, action: { kind: 'play' } })
    const r3 = step(r2.state, { type: 'ACTION', seat: 2, action: { kind: 'fold' } })
    expect(r3.events.filter((e) => e.type === 'PLAYER_ACTED')).toMatchObject([
      { seat: 0, action: { kind: 'fold' }, timedOut: true },
      { seat: 1, action: { kind: 'play' }, timedOut: false },
      { seat: 2, action: { kind: 'fold' }, timedOut: false },
    ])
  })

  it('pure luck: the squeeze round runs out on REVEALED, which is no action at all — no PLAYER_ACTED, so no timeout (§8.7)', () => {
    const { state, events } = deal('none', [2])
    const all: GameEvent[] = [...events]
    let s = state
    for (const seat of [0, 1]) { // the server turning the seats that were still down
      const r = step(s, { type: 'REVEALED', seat })
      all.push(...r.events)
      s = r.state
    }
    while (s.phase === 'REVEAL') {
      const r = step(s, { type: 'ADVANCE' })
      all.push(...r.events)
      s = r.state
    }
    expect(s.phase).toBe('COMPLETE')
    expect(all.some((e) => e.type === 'PLAYER_ACTED')).toBe(false)
    expect(all.some((e) => e.type === 'DECISION_MADE')).toBe(false)
  })

  it('REVEALED is a no-op outside squeezing, and ADVANCE is refused during SQUEEZE', () => {
    const plain = new Table(rules({ decisionMode: 'none' }), [5000, 5000])
    expect(plain.state.players.every((p) => p.revealed)).toBe(true)
    expect(plain.apply({ type: 'REVEALED', seat: 0 })).toEqual([])
    const { state } = deal('none', [2])
    expect(() => step(state, { type: 'ADVANCE' })).toThrow(EngineError)
    expect(() => step(state, { type: 'REVEALED', seat: 7 })).toThrow(EngineError) // NOT_IN_HAND
  })

  it('the view carries revealed per seat, and a Hold’em or plain Blind seat is always revealed', () => {
    const { state } = deal('none', [2])
    const r = step(state, { type: 'REVEALED', seat: 0 })
    expect(playerView(r.state, 1).seats.map((s) => s.revealed)).toEqual([true, false, true])
    expect(playerView(r.state, 1).phase).toBe('SQUEEZE')
  })
})
