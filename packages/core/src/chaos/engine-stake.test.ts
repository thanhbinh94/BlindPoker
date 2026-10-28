import { describe, expect, it } from 'vitest'
import { seededRng, type Rng } from '../cards/rng.js'
import { createBotStrategy } from '../bot/strategy.js'
import { applyBlindCommand, blindLegalActions, createBlindHand } from '../hand/blind.js'
import { applyHoldemCommand, createHoldemHand } from '../hand/holdem.js'
import type { BlindRules, GameEvent, HandCommand, HandState } from '../hand/types.js'
import { filterEvent, playerView } from '../hand/view.js'
import { CHAOS_CARDS_SPEC } from './fixtures.js'
import { toHeld } from './hold.js'
import { planHand } from './plan.js'
import { afterHand, type AfterHandSeat } from './settle.js'
import {
  DEFAULT_CHAOS_CONFIG, EMPTY_CHAOS_SEAT, type ChaosCardDef, type ChaosHandPlan, type ChaosSeat, type HeldCard, type PlannedEffect,
} from './types.js'

/**
 * BP-41 Task 5a: the stake multipliers with their dead money (Mạo hiểm gia, Sới lớn; A1, Ruling 1) and the no-fold rule
 * (Cấm bỏ bài; A2) with the `FORFEIT` command. The cards ship disabled in data; the plans here name them directly.
 */

const lastRng: Rng = { int: (n) => n - 1 }
const WAGER = 1000

const def = (id: string): ChaosCardDef => {
  const d = CHAOS_CARDS_SPEC.find((c) => c.id === id)
  if (!d) throw new Error(`no card ${id}`)
  return d
}
let uidSeq = 900
function fx(cardId: string, extra: Partial<PlannedEffect> = {}): PlannedEffect {
  const d = def(cardId)
  return { uid: ++uidSeq, cardId, effect: d.effect, params: d.params, timing: d.timing, debuff: d.debuff, targets: [], ...extra }
}
type SeatPlan = { effects?: PlannedEffect[]; stake?: number }
function plan(n: number, by: Record<number, SeatPlan>, noFoldSeats?: number[]): ChaosHandPlan {
  return {
    seats: Array.from({ length: n }, (_, seat) => ({
      seat, effects: by[seat]?.effects ?? [], shield: null, blindfolded: false, ...(by[seat]?.stake ? { stake: by[seat]!.stake } : {}),
    })),
    reverse: false,
    ...(noFoldSeats ? { noFoldSeats } : {}),
  }
}

class Table {
  state: HandState
  events: GameEvent[] = []
  readonly start: number
  constructor(o: { chaos: ChaosHandPlan; stacks?: number[]; rng?: Rng; rules?: Partial<BlindRules>; carryOverIn?: number }) {
    const rules: BlindRules = { mode: 'blind', holeCards: 2, decisionMode: 'playOrFold', fixedWager: WAGER, tableFeeRate: 0, ...o.rules }
    const seats = o.chaos.seats.map(({ seat }) => ({ seat, playerId: `p${seat}`, stack: o.stacks?.[seat] ?? 50_000, isBot: false }))
    this.start = seats.reduce((a, s) => a + s.stack, 0) + (o.carryOverIn ?? 0)
    const res = createBlindHand({ handId: 'stake', rules, seats, button: 0, carryOverIn: o.carryOverIn ?? 0, chaos: o.chaos }, o.rng ?? seededRng(7))
    this.state = res.state
    this.events.push(...res.events)
  }
  apply(cmd: HandCommand) {
    const r = applyBlindCommand(this.state, cmd, lastRng)
    this.state = r.state
    this.events.push(...r.events)
  }
  decide(...kinds: ('play' | 'fold')[]) {
    kinds.forEach((kind, seat) => {
      if (blindLegalActions(this.state, seat).kinds.length > 0) this.apply({ type: 'ACTION', seat, action: { kind } })
    })
  }
  advanceAll() { while (this.state.phase === 'REVEAL') this.apply({ type: 'ADVANCE' }) }
  p(seat: number) { return this.state.players.find((x) => x.seat === seat)! }
  stacks() { return this.state.players.reduce((a, x) => a + x.stack, 0) }
  of<T extends GameEvent['type']>(type: T) { return this.events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type) }
  /** While the hand runs every point is on a stack or in the pot; once it is over, on a stack, in the fee or carried out. */
  conserved() {
    const r = this.state.result
    if (r === null) expect(this.stacks() + this.state.pot).toBe(this.start)
    else expect(this.stacks() + r.fee + r.carryOverOut).toBe(this.start)
  }
}

describe('Mạo hiểm gia and Sới lớn: the stake (planHand)', () => {
  const RULES: BlindRules = { mode: 'blind', holeCards: 2, decisionMode: 'playOrFold', fixedWager: WAGER, tableFeeRate: 0 }
  let uid = 1
  const card = (id: string, extra: Partial<HeldCard> = {}): HeldCard => ({ ...toHeld(def(id), uid++), ...extra })
  const seat = (cards: HeldCard[], extra: Partial<ChaosSeat> = {}): ChaosSeat => ({ ...EMPTY_CHAOS_SEAT, cards, ...extra })
  const planOf = (by: Record<number, ChaosSeat>, rules: BlindRules = RULES) => planHand({
    seats: Object.entries(by).map(([s, chaos]) => ({ seat: Number(s), isBot: false, chaos })), rules, pool: CHAOS_CARDS_SPEC,
    rng: seededRng(3), nextUid: () => 5000 + uid++,
  })
  const stakes = (r: ReturnType<typeof planOf>) => r.plan.seats.map((s) => s.stake ?? 1)

  it('Mạo hiểm gia stakes its holder ×2 on its first hand and doubles each hand after, up to ×32', () => {
    expect([0, 1, 2, 3, 4].map((charge) => stakes(planOf({ 0: seat([card('d_adventurer', { charge })]), 1: seat([]) }))[0])).toEqual([2, 4, 8, 16, 32])
    // A second copy added hands (Ruling 6), never steps: ×32 is the top.
    expect(stakes(planOf({ 0: seat([card('d_adventurer', { charge: 7, handsLeft: 3 })]), 1: seat([]) }))).toEqual([32, 1])
    // The step travels with the fired effect, so afterHand can move it on.
    expect(planOf({ 0: seat([card('d_adventurer')]), 1: seat([]) }).plan.seats[0]!.effects[0]).toMatchObject({ effect: 'adventurer', charge: 0 })
  })

  it('Sới lớn stakes the whole table ×2, once however many seats hold it; with Mạo hiểm gia the two multiply (Ruling 1)', () => {
    expect(stakes(planOf({ 0: seat([]), 1: seat([card('g_big_table')]), 2: seat([]) }))).toEqual([2, 2, 2])
    expect(stakes(planOf({ 0: seat([card('g_big_table')]), 1: seat([card('g_big_table')]) }))).toEqual([2, 2])
    expect(stakes(planOf({ 0: seat([card('d_adventurer', { charge: 1 })]), 1: seat([card('g_big_table')]) }))).toEqual([8, 2])
  })

  it('a card that does not fire stakes nothing: a frozen holder, a holder in Nhật thực’s dark', () => {
    expect(stakes(planOf({ 0: seat([card('d_adventurer')], { frozenNextHand: true }), 1: seat([card('g_big_table')], { frozenNextHand: true }) }))).toEqual([1, 1])
    const r = planOf({ 0: seat([card('d_eclipse')]), 1: seat([card('d_adventurer')]), 2: seat([card('g_big_table')]) })
    expect(stakes(r)).toEqual([1, 1, 1])
  })

  it('a plain plan carries no stake and no noFoldSeats', () => {
    const r = planOf({ 0: seat([card('g_luck_3')]), 1: seat([]) })
    expect(r.plan.seats.every((s) => !('stake' in s))).toBe(true)
    expect('noFoldSeats' in r.plan).toBe(false)
  })
})

describe('Mạo hiểm gia and Sới lớn: dead money (engine)', () => {
  it('the ante takes the real wager, then the rest of the stake as dead money: out of totalCommitted, into the pot', () => {
    const t = new Table({ chaos: plan(3, { 0: { effects: [fx('d_adventurer', { charge: 1 })], stake: 4 } }), rules: { decisionMode: 'none' } })
    expect(t.of('BLINDS_POSTED')[0]!.posts.map((x) => x.amount)).toEqual([4000, 1000, 1000])
    expect(t.p(0)).toMatchObject({ stack: 46_000, totalCommitted: 1000, betThisStreet: 4000 })
    expect(t.state.chaos!.deadMoney).toEqual([{ seat: 0, amount: 3000 }])
    expect(t.state.pot).toBe(6000)
    // Told to everyone, before the ante, with the stake it set.
    const [ev] = t.of('CHAOS_APPLIED').filter((e) => e.effect === 'adventurer')
    expect(ev).toMatchObject({ seat: 0, outcome: 'applied', stake: 4 })
    expect(filterEvent(ev!, 2)).not.toBeNull()
    expect(t.events.indexOf(ev!)).toBeLessThan(t.events.findIndex((e) => e.type === 'BLINDS_POSTED'))
    t.conserved()
    t.advanceAll()
    // The main pot pays the dead money with the antes.
    expect(t.state.result!.payouts.reduce((a, x) => a + x.amount, 0)).toBe(6000)
    t.conserved()
  })

  it('"Chơi" costs the stake: the decision says so per seat, the legal call agrees, the play takes the real wager then the extra', () => {
    const t = new Table({ chaos: plan(3, { 0: { effects: [fx('d_adventurer', { charge: 1 })], stake: 4 } }) })
    expect(t.of('DECISION_PHASE')[0]).toMatchObject({ calls: [{ seat: 0, amount: 4000 }] })
    expect('noFold' in t.of('DECISION_PHASE')[0]!).toBe(false)
    expect(blindLegalActions(t.state, 0).callAmount).toBe(4000)
    expect(blindLegalActions(t.state, 1).callAmount).toBe(1000)
    expect(playerView(t.state, 0).legal!.callAmount).toBe(4000)
    t.decide('play', 'play', 'fold')
    expect(t.of('PLAYER_ACTED').find((e) => e.seat === 0)).toMatchObject({ amount: 4000, stack: 42_000, allIn: false })
    expect(t.p(0).totalCommitted).toBe(2000)
    expect(t.state.chaos!.deadMoney).toEqual([{ seat: 0, amount: 6000 }])
    t.conserved()
    t.advanceAll()
    t.conserved()
  })

  it('Review Focus 2: ×32 on a short stack — the real wagers first, the rest dead; the holder ends all in and its dead money goes to the pot’s winner', () => {
    // 10 wagers: ante 1 000 + 8 000 dead (1 000 kept back for "Chơi"), then "Chơi" 1 000 and nothing left for more.
    const t = new Table({ chaos: plan(3, { 0: { effects: [fx('d_adventurer', { charge: 4 })], stake: 32 } }), stacks: [10_000, 50_000, 50_000] })
    expect(t.of('BLINDS_POSTED')[0]!.posts[0]!.amount).toBe(9000)
    expect(t.p(0)).toMatchObject({ stack: 1000, allIn: false })
    expect(t.of('DECISION_PHASE')[0]).toMatchObject({ calls: [{ seat: 0, amount: 1000 }] })
    t.decide('play', 'play', 'play')
    expect(t.of('PLAYER_ACTED').find((e) => e.seat === 0)).toMatchObject({ amount: 1000, stack: 0, allIn: true })
    expect(t.p(0).totalCommitted).toBe(2000)
    expect(t.state.chaos!.deadMoney).toEqual([{ seat: 0, amount: 8000 }])
    t.advanceAll()
    // Every pot went to someone, the dead money with the main pot; not a point made or lost; no stack below 0.
    const r = t.state.result!
    expect(r.payouts.reduce((a, x) => a + x.amount, 0)).toBe(6000 + 8000)
    expect(r.pots[0]!.amount).toBe(6000 + 8000)
    expect(t.state.players.every((x) => x.stack >= 0)).toBe(true)
    t.conserved()
  })

  it('×32 short-stacked on a table without the choice: the ante takes the whole stack, all in', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('d_adventurer', { charge: 4 })], stake: 32 } }), stacks: [10_000, 50_000], rules: { decisionMode: 'none' } })
    expect(t.p(0)).toMatchObject({ stack: 0, allIn: true, totalCommitted: 1000 })
    expect(t.state.chaos!.deadMoney).toEqual([{ seat: 0, amount: 9000 }])
    t.advanceAll()
    expect(t.state.result!.payouts.reduce((a, x) => a + x.amount, 0)).toBe(11_000)
    t.conserved()
  })

  it('the holder folds: its dead money stays for the winner; "Bỏ không mất" hands back its ante only (Ruling 1)', () => {
    const t = new Table({ chaos: plan(3, { 0: { effects: [fx('d_adventurer', { charge: 1 }), fx('s_free_fold')], stake: 4 } }) })
    t.decide('fold', 'play', 'play')
    expect(t.p(0)).toMatchObject({ stack: 47_000, totalCommitted: 0 })
    t.advanceAll()
    expect(t.state.result!.payouts.reduce((a, x) => a + x.amount, 0)).toBe(4000 + 3000)
    t.conserved()
  })

  it('everyone else folds: the holder takes back the uncalled part of its real wager and wins the antes and its own dead money', () => {
    const t = new Table({ chaos: plan(3, { 0: { effects: [fx('d_adventurer', { charge: 1 })], stake: 4 } }) })
    t.decide('play', 'fold', 'fold')
    expect(t.state.result!.uncalledReturned).toEqual({ seat: 0, amount: 1000 })
    expect(t.p(0).stack).toBe(52_000)
    t.conserved()
  })

  it('everyone folds: the dead money carries over with the pot', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('d_adventurer', { charge: 1 })], stake: 4 } }), carryOverIn: 500 })
    t.decide('fold', 'fold')
    expect(t.state.result!.carryOverOut).toBe(500 + 2000 + 3000)
    t.conserved()
  })

  it('a cancelled hand refunds the dead money with the wagers', () => {
    const t = new Table({ chaos: plan(3, { 0: { effects: [fx('d_adventurer', { charge: 4 })], stake: 32 } }), stacks: [10_000, 50_000, 50_000] })
    t.decide('play')
    t.apply({ type: 'CANCEL', reason: 'test' })
    // The ante and its dead money; the "Chơi" chosen had not moved a point yet.
    expect(t.of('HAND_CANCELLED')[0]!.refunds).toEqual([{ seat: 0, amount: 9000 }, { seat: 1, amount: 1000 }, { seat: 2, amount: 1000 }])
    expect(t.state.players.map((x) => x.stack)).toEqual([10_000, 50_000, 50_000])
    expect(t.state.chaos!.deadMoney).toBeUndefined()
    t.conserved()
  })

  it('Sới lớn: every seat antes and plays twice the wager; its holder keeps the better of 2 sets; told once, at the ante', () => {
    const t = new Table({ chaos: plan(3, { 0: { stake: 2 }, 1: { effects: [fx('g_big_table')], stake: 2 }, 2: { stake: 2 } }) })
    expect(t.of('BLINDS_POSTED')[0]!.posts.map((x) => x.amount)).toEqual([2000, 2000, 2000])
    const evs = t.of('CHAOS_APPLIED').filter((e) => e.effect === 'bigTable')
    expect(evs).toHaveLength(1)
    expect(evs[0]).toMatchObject({ seat: 1, targets: [], stake: 2, outcome: 'applied' })
    // 3 seats × 2 cards + the holder's second set.
    expect(t.state.deckIndex).toBe(8)
    expect(t.of('DECISION_PHASE')[0]!.calls).toEqual([0, 1, 2].map((seat) => ({ seat, amount: 2000 })))
    t.decide('play', 'play', 'play')
    t.advanceAll()
    expect(t.state.result!.payouts.reduce((a, x) => a + x.amount, 0)).toBe(12_000)
    t.conserved()
  })

  it('Kẻ phá đám cannot switch off a stake card: the ante already acted on it', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('d_adventurer')], stake: 2 }, 1: { effects: [fx('s_spoiler')] } }), rules: { decisionMode: 'none' } })
    expect(t.of('CHAOS_APPLIED').find((e) => e.effect === 'spoiler')).toMatchObject({ outcome: 'fizzled' })
    expect(t.state.chaos!.plan.seats[0]!.effects.map((e) => e.effect)).toEqual(['adventurer'])
  })

  it('a chaos hand without a stake card antes and calls exactly as a plain one', () => {
    const t = new Table({ chaos: plan(3, {}) })
    expect(t.of('BLINDS_POSTED')[0]!.posts.map((x) => x.amount)).toEqual([1000, 1000, 1000])
    expect(Object.keys(t.of('DECISION_PHASE')[0]!).sort()).toEqual(['seats', 'turnSeq', 'type'])
    expect(t.state.chaos!.deadMoney).toBeUndefined()
  })
})

describe('Mạo hiểm gia: after the hand', () => {
  const RULES: BlindRules = { mode: 'blind', holeCards: 2, decisionMode: 'playOrFold', fixedWager: WAGER, tableFeeRate: 0 }
  const held = toHeld(def('d_adventurer'), 77)
  const run = (outcome: AfterHandSeat['outcome'], card: HeldCard = held, frozen = false) => afterHand({
    rules: RULES, config: DEFAULT_CHAOS_CONFIG, pool: CHAOS_CARDS_SPEC, rng: seededRng(1), nextUid: () => 9000,
    plan: { seats: [{ seat: 0, effects: frozen ? [] : [fx('d_adventurer', { uid: card.uid, charge: card.charge ?? 0 })], shield: null, blindfolded: false }], reverse: false },
    consumed: new Set([card.uid]), carryOverOnly: false, marks: [],
    seats: [{ seat: 0, isBot: false, chaos: { ...EMPTY_CHAOS_SEAT, cards: [card], frozenNextHand: frozen }, stackAfter: 0, net: 0, inHand: true, outcome }],
  }).seats.get(0)!.cards

  it('a lost hand steps the stake on and counts a hand down; a win ends the card', () => {
    expect(run('loss')).toEqual([{ ...held, handsLeft: 4, charge: 1 }])
    expect(run('none')).toEqual([{ ...held, handsLeft: 4, charge: 1 }])
    expect(run('win')).toEqual([])
  })

  it('out after its fifth hand without a win', () => {
    let card: HeldCard = held
    for (let i = 0; i < 4; i++) card = run('loss', card)[0]!
    expect(card).toMatchObject({ handsLeft: 1, charge: 4 })
    expect(run('loss', card)).toEqual([])
  })

  it('a frozen hand neither steps nor counts down', () => {
    expect(run('loss', held, true)).toEqual([held])
  })
})

describe('Cấm bỏ bài and the no-fold rule', () => {
  it('a seat on noFoldSeats may only play: no fold among its actions, a fold refused, its timer plays', () => {
    const t = new Table({ chaos: plan(3, {}, [1, 2]) })
    expect(t.of('DECISION_PHASE')[0]).toMatchObject({ noFold: [1, 2] })
    expect(blindLegalActions(t.state, 0).kinds).toEqual(['play', 'fold'])
    expect(blindLegalActions(t.state, 1).kinds).toEqual(['play'])
    expect(playerView(t.state, 1).legal!.kinds).toEqual(['play'])
    expect(() => t.apply({ type: 'ACTION', seat: 1, action: { kind: 'fold' } })).toThrow(/ILLEGAL_ACTION/)
    t.apply({ type: 'TIMEOUT', seat: 0 })
    t.apply({ type: 'TIMEOUT', seat: 1 })
    t.apply({ type: 'TIMEOUT', seat: 2 })
    const acted = t.of('PLAYER_ACTED')
    expect(acted.map((e) => [e.seat, e.action.kind, e.timedOut])).toEqual([[0, 'fold', true], [1, 'play', true], [2, 'play', true]])
    t.advanceAll()
    t.conserved()
  })

  it('FORFEIT folds a seat that left, no-fold or not; outside the choice it is refused', () => {
    const t = new Table({ chaos: plan(3, {}, [0, 1, 2]) })
    t.apply({ type: 'FORFEIT', seat: 1 })
    expect(() => t.apply({ type: 'FORFEIT', seat: 1 })).toThrow(/NOT_YOUR_TURN/)
    t.decide('play', 'play', 'play')
    expect(t.of('DECISIONS_REVEALED')[0]!.decisions).toEqual([{ seat: 0, decision: 'play' }, { seat: 1, decision: 'fold' }, { seat: 2, decision: 'play' }])
    expect(t.of('PLAYER_ACTED').find((e) => e.seat === 1)).toMatchObject({ action: { kind: 'fold' }, timedOut: false })
  })

  it('Hold’em: FORFEIT is a fold on the seat’s turn', () => {
    const rules = { mode: 'holdem' as const, smallBlind: 50, bigBlind: 100, tableFeeRate: 0, tableFeeCapBB: 0 }
    const seats = [0, 1, 2].map((seat) => ({ seat, playerId: `p${seat}`, stack: 5000, isBot: false }))
    const { state } = createHoldemHand({ handId: 'h', rules, seats, button: 0 }, seededRng(1))
    const acting = state.actingSeat!
    const r = applyHoldemCommand(state, { type: 'FORFEIT', seat: acting }, seededRng(1))
    expect(r.events.find((e) => e.type === 'PLAYER_ACTED')).toMatchObject({ seat: acting, action: { kind: 'fold' }, timedOut: false })
    expect(() => applyHoldemCommand(r.state, { type: 'FORFEIT', seat: acting }, seededRng(1))).toThrow()
  })

  it('a bot with no fold to choose plays', () => {
    const t = new Table({ chaos: plan(2, {}, [1]) })
    const bot = createBotStrategy()
    for (let i = 0; i < 20; i++) expect(bot.decide(playerView(t.state, 1), blindLegalActions(t.state, 1), seededRng(i))).toEqual({ kind: 'play' })
  })

  it('Cấm bỏ bài at the deal marks every other seat for the next hand, told to the whole table, the card spent', () => {
    const e = fx('s_no_fold')
    const t = new Table({ chaos: plan(3, { 1: { effects: [e] } }) })
    const ev = t.of('CHAOS_APPLIED').find((x) => x.effect === 'noFold')!
    expect(ev).toMatchObject({ seat: 1, targets: [0, 2], outcome: 'applied' })
    for (const v of [0, 1, 2, null]) expect(filterEvent(ev, v)).not.toBeNull()
    expect(t.state.chaos!.marks).toEqual([{ seat: 0, kind: 'noFold' }, { seat: 2, kind: 'noFold' }])
    expect(t.state.chaos!.applied).toContain(e.uid)
    // It binds the next hand, not this one.
    expect(blindLegalActions(t.state, 0).kinds).toEqual(['play', 'fold'])
  })

  it('on a table without the choice it fizzles', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('s_no_fold')] } }), rules: { decisionMode: 'none' } })
    expect(t.of('CHAOS_APPLIED').find((x) => x.effect === 'noFold')).toMatchObject({ outcome: 'fizzled', targets: [] })
    expect(t.state.chaos!.marks).toEqual([])
  })

  it('from the card to the next hand: afterHand keeps the mark one hand, planHand turns it into noFoldSeats', () => {
    const RULES: BlindRules = { mode: 'blind', holeCards: 2, decisionMode: 'playOrFold', fixedWager: WAGER, tableFeeRate: 0 }
    const held = toHeld(def('s_no_fold'), 55)
    let uid = 100
    const seats0 = new Map<number, ChaosSeat>([[0, { ...EMPTY_CHAOS_SEAT, cards: [held] }], [1, EMPTY_CHAOS_SEAT], [2, EMPTY_CHAOS_SEAT]])
    const p1 = planHand({ seats: [0, 1, 2].map((seat) => ({ seat, isBot: false, chaos: seats0.get(seat)! })), rules: RULES, pool: CHAOS_CARDS_SPEC, rng: seededRng(1), nextUid: () => uid++ })
    expect(p1.plan.seats[0]!.effects.map((e) => e.effect)).toEqual(['noFold'])
    const t = new Table({ chaos: p1.plan })
    t.decide('play', 'play', 'play')
    t.advanceAll()
    const settleOf = (planned: ChaosHandPlan, seats: Map<number, ChaosSeat>, inHand: (s: number) => boolean, marks = t.state.chaos!.marks) => afterHand({
      rules: RULES, config: DEFAULT_CHAOS_CONFIG, pool: CHAOS_CARDS_SPEC, rng: seededRng(1), nextUid: () => uid++, plan: planned,
      consumed: new Set(t.state.chaos!.applied), carryOverOnly: false, marks,
      seats: [0, 1, 2].map((seat) => ({ seat, isBot: false, chaos: seats.get(seat)!, stackAfter: 50_000, net: 0, inHand: inHand(seat), outcome: 'loss' as const })),
    }).seats
    const after1 = settleOf(p1.plan, p1.seats, () => true)
    expect([0, 1, 2].map((s) => after1.get(s)!.noFoldNextHand)).toEqual([undefined, true, true])
    expect(after1.get(0)!.cards).toEqual([])

    const p2 = planHand({ seats: [0, 1, 2].map((seat) => ({ seat, isBot: false, chaos: after1.get(seat)! })), rules: RULES, pool: CHAOS_CARDS_SPEC, rng: seededRng(2), nextUid: () => uid++ })
    expect(p2.plan.noFoldSeats).toEqual([1, 2])
    // The same marks on a table without the choice bind nobody.
    const none = planHand({ seats: [0, 1, 2].map((seat) => ({ seat, isBot: false, chaos: after1.get(seat)! })), rules: { ...RULES, decisionMode: 'none' }, pool: CHAOS_CARDS_SPEC, rng: seededRng(2), nextUid: () => uid++ })
    expect('noFoldSeats' in none.plan).toBe(false)

    // One hand only: seat 1 played it and is free again; seat 2 sat it out and is free too (Ruling 5a-5).
    const after2 = settleOf(p2.plan, p2.seats, (s) => s !== 2, [])
    expect([0, 1, 2].map((s) => 'noFoldNextHand' in after2.get(s)!)).toEqual([false, false, false])
  })

  it('a Tay bạc that rolled it marks the same way, with no held card behind it (Ruling 5a-4)', () => {
    // A roll fires under a fresh uid that no seat holds; the mark is all that carries it over.
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('s_no_fold', { uid: 4242 })] } }) })
    expect(t.state.chaos!.marks).toEqual([{ seat: 1, kind: 'noFold' }])
  })
})

describe('Conservation with the stake cards and the no-fold rule (seeded)', () => {
  it('400 random chaos hands: every point stays on a stack, in the pot, the fee or the carry-over; no stack below 0', () => {
    const rng = seededRng(41)
    for (let h = 0; h < 400; h++) {
      const n = 2 + rng.int(4)
      const by: Record<number, ChaosSeat> = {}
      let uid = 1
      for (let s = 0; s < n; s++) {
        const cards: HeldCard[] = []
        if (rng.int(3) === 0) cards.push({ ...toHeld(def('d_adventurer'), uid++), charge: rng.int(6) })
        if (rng.int(5) === 0) cards.push(toHeld(def('g_big_table'), uid++))
        if (rng.int(6) === 0) cards.push(toHeld(def('s_no_fold'), uid++))
        if (rng.int(6) === 0) cards.push(toHeld(def('s_free_fold'), uid++))
        if (rng.int(6) === 0) cards.push(toHeld(def('s_insure_half'), uid++))
        by[s] = { ...EMPTY_CHAOS_SEAT, cards, ...(rng.int(4) === 0 ? { noFoldNextHand: true as const } : {}) }
      }
      const rules: BlindRules = {
        mode: 'blind', holeCards: rng.int(2) === 0 ? 2 : 3, decisionMode: rng.int(3) === 0 ? 'none' : 'playOrFold', fixedWager: WAGER, tableFeeRate: rng.int(2) * 0.05,
      }
      const { plan: p } = planHand({ seats: Object.entries(by).map(([s, chaos]) => ({ seat: Number(s), isBot: false, chaos })), rules, pool: CHAOS_CARDS_SPEC, rng, nextUid: () => 1000 + uid++ })
      const stacks = Array.from({ length: n }, () => 200 + rng.int(60_000))
      const t = new Table({ chaos: p, stacks, rng, rules, carryOverIn: rng.int(3) * 700 })
      t.conserved()
      const cancelAt = rng.int(8)
      if (cancelAt === 0) t.apply({ type: 'CANCEL', reason: 'test' })
      while (t.state.phase === 'DECISION') {
        const undecided = t.state.players.filter((x) => blindLegalActions(t.state, x.seat).kinds.length > 0)
        const x = undecided[rng.int(undecided.length)]!
        const roll = rng.int(10)
        if (roll === 0) t.apply({ type: 'FORFEIT', seat: x.seat })
        else if (roll === 1) t.apply({ type: 'TIMEOUT', seat: x.seat })
        else {
          const kinds = blindLegalActions(t.state, x.seat).kinds as ('play' | 'fold')[]
          t.apply({ type: 'ACTION', seat: x.seat, action: { kind: kinds[rng.int(kinds.length)]! } })
        }
        t.conserved()
      }
      if (cancelAt === 1 && t.state.phase === 'REVEAL') t.apply({ type: 'CANCEL', reason: 'test' })
      t.advanceAll()
      expect(t.state.phase).toBe('COMPLETE')
      expect(t.state.players.every((x) => x.stack >= 0)).toBe(true)
      t.conserved()
      if (t.of('HAND_CANCELLED').length > 0) expect(t.state.players.map((x) => x.stack)).toEqual(stacks)
    }
  })
})
