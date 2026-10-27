import { describe, expect, it } from 'vitest'
import { cardToString, parseCards, rankOf, suitOf, type Card } from '../cards/cards.js'
import { seededRng, type Rng } from '../cards/rng.js'
import { evaluate } from '../evaluator/evaluator.js'
import { applyBlindCommand, createBlindHand } from '../hand/blind.js'
import type { BlindRules, GameEvent, HandCommand, HandState } from '../hand/types.js'
import { filterEvent, playerView } from '../hand/view.js'
import { addRevealEffect } from './engine.js'
import { CHAOS_CARDS_SPEC } from './fixtures.js'
import type { ChaosHandPlan, PlannedEffect } from './types.js'

/** `int(n)` → n − 1: an unshuffled deck, and the last candidate wherever the engine picks at random. */
const lastRng: Rng = { int: (n) => n - 1 }
const firstRng: Rng = { int: () => 0 }

/**
 * An rng whose first shuffle lays the deck out as `top` (then every other card in order), and that acts as `after`
 * from then on. Fisher–Yates fills the deck from the end, so each step picks the index that holds the wanted card.
 */
function deckRng(top: string, after: Rng = lastRng): Rng {
  const want = parseCards(top)
  const final = [...want, ...Array.from({ length: 52 }, (_, i) => i).filter((c) => !want.includes(c))]
  const d = Array.from({ length: 52 }, (_, i) => i)
  const picks: number[] = []
  for (let i = 51; i > 0; i--) {
    const j = d.indexOf(final[i]!)
    picks.push(j)
    const tmp = d[i]!
    d[i] = d[j]!
    d[j] = tmp
  }
  let k = 0
  return { int: (n) => (k < picks.length ? picks[k++]! : after.int(n)) }
}

/** The deck top that deals `hands[seat]` to each seat with the button on seat 0 (dealing starts at seat 1), then `rest`. */
function layout(hands: string[], rest = ''): string {
  const cards = hands.map(parseCards)
  const order = [...hands.keys()].slice(1).concat(0)
  const out: Card[] = []
  for (let r = 0; r < cards[0]!.length; r++) for (const s of order) out.push(cards[s]![r]!)
  return [...out.map(cardToString), rest].join(' ').trim()
}

/**
 * An 8-seat, 3-card deck top: seat 0 holds `seat0`, the 18 cards after the deal (all a deal-time draw may take above
 * the 10-card reserve) are the first that pass `next`, and seats 1–7 hold the rest.
 */
function crowded(seat0: string, next: (c: Card) => boolean): string {
  const mine = parseCards(seat0)
  const pool = Array.from({ length: 52 }, (_, i) => i).filter((c) => !mine.includes(c))
  const rest = pool.filter(next).slice(0, 18)
  const others = pool.filter((c) => !rest.includes(c))
  const hands = [seat0, ...Array.from({ length: 7 }, (_, i) => others.slice(i * 3, i * 3 + 3).map(cardToString).join(' '))]
  return layout(hands, rest.map(cardToString).join(' '))
}

let uidSeq = 100
function fx(cardId: string, targets: number[] = []): PlannedEffect {
  const d = CHAOS_CARDS_SPEC.find((c) => c.id === cardId)!
  return { uid: ++uidSeq, cardId, effect: d.effect, params: d.params, timing: d.timing, debuff: d.debuff, targets }
}

interface SeatPlan { effects?: PlannedEffect[]; shield?: 'shield' | 'mirror' | 'lasting'; blindfolded?: boolean }
const SHIELD_CARD = { shield: 's_shield', mirror: 'd_mirror', lasting: 'g_shield_3' } as const
function plan(n: number, by: Record<number, SeatPlan>): ChaosHandPlan {
  const seats = Array.from({ length: n }, (_, seat) => {
    const s = by[seat] ?? {}
    const shield = s.shield === undefined ? null : {
      uid: ++uidSeq, cardId: SHIELD_CARD[s.shield], kind: s.shield === 'mirror' ? ('mirror' as const) : ('shield' as const),
      ...(s.shield === 'lasting' ? { lasting: true as const } : {}),
    }
    return { seat, effects: s.effects ?? [], shield, blindfolded: s.blindfolded ?? false }
  })
  return { seats, reverse: seats.some((s) => s.effects.some((e) => e.effect === 'reverseRank')) }
}

class Table {
  state: HandState
  events: GameEvent[] = []
  readonly startTotal: number
  constructor(o: { chaos: ChaosHandPlan; deck?: string; rules?: Partial<BlindRules>; stacks?: number[]; rng?: Rng; carryOverIn?: number; reveal?: Rng }) {
    const stacks = o.stacks ?? o.chaos.seats.map(() => 5000)
    const rules: BlindRules = { mode: 'blind', holeCards: 2, decisionMode: 'none', fixedWager: 1000, tableFeeRate: 0, ...o.rules }
    const seats = stacks.map((stack, seat) => ({ seat, playerId: `p${seat}`, stack, isBot: false }))
    const res = createBlindHand({ handId: 'c1', rules, seats, button: 0, carryOverIn: o.carryOverIn ?? 0, chaos: o.chaos }, o.rng ?? deckRng(o.deck ?? ''))
    this.state = res.state
    this.events.push(...res.events)
    this.startTotal = stacks.reduce((a, b) => a + b, 0) + (o.carryOverIn ?? 0)
    this.reveal = o.reveal ?? lastRng
  }
  private readonly reveal: Rng
  apply(cmd: HandCommand) {
    const r = applyBlindCommand(this.state, cmd, this.reveal)
    this.state = r.state
    this.events.push(...r.events)
    return r.events
  }
  play(seat: number) { return this.apply({ type: 'ACTION', seat, action: { kind: 'play' } }) }
  fold(seat: number) { return this.apply({ type: 'ACTION', seat, action: { kind: 'fold' } }) }
  advanceAll() { while (this.state.phase === 'REVEAL') this.apply({ type: 'ADVANCE' }) }
  hole(seat: number) { return this.state.players.find((p) => p.seat === seat)!.holeCards }
  stack(seat: number) { return this.state.players.find((p) => p.seat === seat)!.stack }
  applied() { return this.events.filter((e): e is Extract<GameEvent, { type: 'CHAOS_APPLIED' }> => e.type === 'CHAOS_APPLIED') }
  dealt(seat: number) { return this.events.find((e): e is Extract<GameEvent, { type: 'CARDS_DEALT' }> => e.type === 'CARDS_DEALT' && e.seat === seat)! }
  showdown(seat: number) { return this.state.result!.showdown!.find((h) => h.seat === seat)! }
  index(type: GameEvent['type']) { return this.events.findIndex((e) => e.type === type) }
  assertMoney() {
    const r = this.state.result!
    expect(this.state.players.reduce((a, p) => a + p.stack, 0) + r.fee + r.carryOverOut).toBe(this.startTotal)
  }
}

const BOARD = '9h 8s 5h 4c Jd'

describe('deal-time effects', () => {
  it('swapLowest redeals the lowest hole card, told only to its owner before CARDS_DEALT', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('s_swap_one')] } }), deck: layout(['Kc 3d', '7h 8h'], 'Qh') })
    expect(t.hole(0)).toEqual(parseCards('Kc Qh'))
    expect(t.hole(1)).toEqual(parseCards('7h 8h'))
    expect(t.state.deckIndex).toBe(5)
    const [ev] = t.applied()
    expect(ev).toEqual({ type: 'CHAOS_APPLIED', seat: 0, cardId: 's_swap_one', effect: 'swapLowest', targets: [], outcome: 'applied' })
    expect(t.events.indexOf(ev!)).toBeLessThan(t.index('CARDS_DEALT'))
    expect(t.dealt(0)).toMatchObject({ cards: parseCards('Kc Qh'), cardCount: 2 })
    expect(filterEvent(ev!, 0)).toEqual(ev)
    expect(filterEvent(ev!, 1)).toBeNull()
    expect(filterEvent(ev!, null)).toBeNull()
  })
  it('redealWeak redeals a hand with no pair and nothing from J up, and leaves a J alone', () => {
    const weak = new Table({ chaos: plan(2, { 0: { effects: [fx('s_redeal_weak')] } }), deck: layout(['7c 3d', '7h 8h'], 'Ts 2s') })
    expect(weak.hole(0)).toEqual(parseCards('Ts 2s'))
    expect(weak.applied()[0]!.outcome).toBe('applied')
    const strong = new Table({ chaos: plan(2, { 0: { effects: [fx('s_redeal_weak')] } }), deck: layout(['Jc 3d', '7h 8h'], 'Ts 2s') })
    expect(strong.hole(0)).toEqual(parseCards('Jc 3d'))
    expect(strong.applied()[0]!.outcome).toBe('fizzled')
    expect(strong.state.deckIndex).toBe(4)
  })
  it('swapAll redeals a hand with no pair and nothing from Q up, and leaves a pair alone', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('g_swap_all')] } }), deck: layout(['Jc 3d', '7h 8h'], 'Ah Ks') })
    expect(t.hole(0)).toEqual(parseCards('Ah Ks'))
    const pair = new Table({ chaos: plan(2, { 0: { effects: [fx('g_swap_all')] } }), deck: layout(['5c 5d', '7h 8h'], 'Ah Ks') })
    expect(pair.hole(0)).toEqual(parseCards('5c 5d'))
    expect(pair.applied()[0]!.outcome).toBe('fizzled')
  })
  it('highCard redeals the lowest card until one is T or higher (guaranteed within the reserve)', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('s_high_card')] } }), deck: layout(['2c 3d', '7h 8h'], '4h Th') })
    expect(t.hole(0)).toEqual(parseCards('4h Th'))
    expect(t.state.deckIndex).toBe(6)
    expect(t.applied()[0]!.outcome).toBe('applied')
  })
  it('suited redraws the second card until it matches the first card’s suit', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('s_suited')] } }), deck: layout(['Kc 3d', '7h 8h'], '5h 9c') })
    expect(t.hole(0)).toEqual(parseCards('Kc 9c'))
    expect(t.state.deckIndex).toBe(6)
  })
  it('suited and highCard together keep both promises', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('s_high_card'), fx('s_suited')] } }), deck: layout(['2c Kd', '7h 8h'], '5c Ac') })
    // highCard is already met by Kd; suited must not trade the K away for a low club: 5c is refused, Ac is kept.
    expect(t.hole(0)).toEqual(parseCards('2c Ac'))
  })
  it('a fizzled highCard or suited leaves the hole cards as dealt (the cards it drew stay burned)', () => {
    const by = (cardId: string): ChaosHandPlan => plan(8, { 0: { effects: [fx(cardId)] } })
    // 8 × 3 dealt, 28 left: 18 draws reach the 10-card reserve, and none of them qualifies.
    const high = new Table({ chaos: by('s_high_card'), rules: { holeCards: 3 }, deck: crowded('2c 3c 4c', (c) => rankOf(c) < 8) })
    expect(high.applied()[0]).toMatchObject({ effect: 'highCard', outcome: 'fizzled' })
    expect(high.hole(0)).toEqual(parseCards('2c 3c 4c'))
    expect(high.dealt(0).cards).toEqual(parseCards('2c 3c 4c'))
    expect(high.state.deckIndex).toBe(42)
    const suited = new Table({ chaos: by('s_suited'), rules: { holeCards: 3 }, deck: crowded('Kc 3d 4d', (c) => suitOf(c) !== 0) })
    expect(suited.applied()[0]).toMatchObject({ effect: 'suited', outcome: 'fizzled' })
    expect(suited.hole(0)).toEqual(parseCards('Kc 3d 4d'))
    expect(suited.state.deckIndex).toBe(42)
  })
  it('highCard and suited together on a crowded deck never end with highCard applied and no card from T up', () => {
    const p = plan(8, { 0: { effects: [fx('s_high_card'), fx('s_suited')] } })
    // Kd keeps highCard; suited needs a club of T or higher in second place and the deck has none above the reserve.
    const t = new Table({ chaos: p, rules: { holeCards: 3 }, deck: crowded('2c Kd 5h', (c) => !(suitOf(c) === 0 && rankOf(c) >= 8)) })
    expect(t.applied().map((e) => [e.effect, e.outcome])).toEqual([['highCard', 'applied'], ['suited', 'fizzled']])
    expect(t.hole(0)).toEqual(parseCards('2c Kd 5h'))
    expect(Math.max(...t.hole(0).map(rankOf))).toBeGreaterThanOrEqual(8)
  })
  it('bestOfN keeps the strongest set by hole cards alone — pair first, then the top card — and burns the rest', () => {
    const pick = new Table({ chaos: plan(2, { 0: { effects: [fx('d_pick_3')] } }), deck: layout(['Kc 3d', '7h 8h'], 'Ah 2s 5h 5s') })
    expect(pick.hole(0)).toEqual(parseCards('5h 5s'))
    expect(pick.state.deckIndex).toBe(8)
    const top = new Table({ chaos: plan(2, { 0: { effects: [fx('g_luck_3')] } }), deck: layout(['Kc 3d', '7h 8h'], 'Ah 2s') })
    expect(top.hole(0)).toEqual(parseCards('Ah 2s'))
    const keep = new Table({ chaos: plan(2, { 0: { effects: [fx('s_luck_1')] } }), deck: layout(['Kc Qd', '7h 8h'], 'Kh 2s') })
    expect(keep.hole(0)).toEqual(parseCards('Kc Qd'))
    expect(keep.state.deckIndex).toBe(6)
  })
  it('extraHole deals one more hole card', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('g_extra_card')] } }), deck: layout(['Kc 3d', '7h 8h'], 'Qh') })
    expect(t.hole(0)).toEqual(parseCards('Kc 3d Qh'))
    expect(t.dealt(0)).toMatchObject({ cardCount: 3 })
    t.advanceAll()
    expect(t.showdown(0).cards).toHaveLength(3)
  })
  it('reverseRank is told to the whole table at the deal', () => {
    const t = new Table({ chaos: plan(2, { 1: { effects: [fx('d_reverse')] } }), deck: layout(['Kc 3d', '7h 8h']) })
    const ev = t.applied().find((e) => e.effect === 'reverseRank')!
    expect(ev).toMatchObject({ seat: 1, outcome: 'applied' })
    expect(filterEvent(ev, 0)).toEqual(ev)
    expect(filterEvent(ev, null)).toEqual(ev)
    expect(playerView(t.state, 0).chaos?.reverse).toBe(true)
  })
  it('a full table of extra draws fizzles instead of exhausting the deck', () => {
    const by: Record<number, SeatPlan> = {}
    for (let s = 0; s < 8; s++) by[s] = { effects: [fx('d_pick_3'), fx('g_extra_card')] }
    const t = new Table({ chaos: plan(8, by), rules: { holeCards: 3 }, rng: seededRng(5) })
    // 24 dealt, 28 left: two 6-card picks and six extra cards fit above the 10-card reserve, nothing more.
    expect(52 - t.state.deckIndex).toBe(10)
    const count = (effect: string, outcome: string) => t.applied().filter((e) => e.effect === effect && e.outcome === outcome).length
    expect([count('bestOfN', 'applied'), count('bestOfN', 'fizzled')]).toEqual([2, 6])
    expect([count('extraHole', 'applied'), count('extraHole', 'fizzled')]).toEqual([6, 2])
    t.advanceAll()
    expect(t.state.phase).toBe('COMPLETE')
    t.assertMoney()
  })
  it('a hand without a chaos plan carries no chaos state', () => {
    const r = createBlindHand({ handId: 'p', rules: { mode: 'blind', holeCards: 2, decisionMode: 'none', fixedWager: 1000, tableFeeRate: 0 }, seats: [0, 1].map((seat) => ({ seat, playerId: `p${seat}`, stack: 5000, isBot: false })), button: 0, carryOverIn: 0 }, seededRng(1))
    expect('chaos' in r.state).toBe(false)
    expect('chaos' in playerView(r.state, 0)).toBe(false)
  })
})

describe('blindfold', () => {
  it('a blindfolded seat is dealt face down to itself until the showdown', () => {
    const t = new Table({ chaos: plan(2, { 0: { blindfolded: true } }), deck: layout(['Kc 3d', '7h 8h']) })
    expect(t.dealt(0)).toEqual({ type: 'CARDS_DEALT', seat: 0, cards: [], cardCount: 2 })
    expect(t.dealt(1).cards).toEqual(parseCards('7h 8h'))
    const v = playerView(t.state, 0)
    expect(v.seats[0]).toMatchObject({ holeCards: null, cardCount: 2 })
    expect(v.chaos?.blindfolded).toBe(true)
    expect(playerView(t.state, 1).chaos?.blindfolded).toBe(false)
    t.advanceAll()
    expect(playerView(t.state, 0).seats[0]!.holeCards).toEqual(parseCards('Kc 3d'))
  })
  it('on a squeeze table a blindfolded seat starts turned', () => {
    const t = new Table({ chaos: plan(2, { 0: { blindfolded: true } }), deck: layout(['Kc 3d', '7h 8h']), rules: { squeeze: true } })
    expect(t.state.players.map((p) => p.revealed)).toEqual([true, false])
    expect(t.events.find((e) => e.type === 'SQUEEZE_PHASE')).toMatchObject({ seats: [1] })
  })
})

describe('the decision round', () => {
  it('peek shows the real next board to its seat only, and again on reconnect', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('g_peek_3')] } }), deck: layout(['Kc 3d', '7h 8h'], BOARD), rules: { decisionMode: 'playOrFold' } })
    const peek = t.events.find((e): e is Extract<GameEvent, { type: 'CHAOS_PEEK' }> => e.type === 'CHAOS_PEEK')!
    expect(peek).toEqual({ type: 'CHAOS_PEEK', seat: 0, cards: parseCards('9h 8s 5h') })
    expect(t.events.indexOf(peek)).toBeGreaterThan(t.index('DECISION_PHASE'))
    expect(filterEvent(peek, 1)).toEqual({ type: 'CHAOS_PEEK', seat: 0, cards: [] })
    expect(filterEvent(peek, null)).toEqual({ type: 'CHAOS_PEEK', seat: 0, cards: [] })
    expect(playerView(t.state, 0).chaos?.peek).toEqual(parseCards('9h 8s 5h'))
    expect(playerView(t.state, 1).chaos?.peek).toEqual([])
    t.play(0); t.play(1); t.advanceAll()
    expect(t.state.community.slice(0, 3)).toEqual(peek.cards)
    expect(t.state.chaos!.applied).toContain(t.state.chaos!.plan.seats[0]!.effects[0]!.uid)
  })
  it('freeFold gives a folder its ante back from the pot and the books balance', () => {
    const t = new Table({ chaos: plan(3, { 0: { effects: [fx('s_free_fold')] } }), deck: layout(['Kc 3d', '7h 8h', '2c 2d'], BOARD), rules: { decisionMode: 'playOrFold', tableFeeRate: 0.02 } })
    t.fold(0); t.play(1); t.play(2)
    expect(t.stack(0)).toBe(5000)
    expect(t.state.pot).toBe(4000)
    expect(t.events.find((e) => e.type === 'PLAYER_ACTED' && e.seat === 0)).toMatchObject({ stack: 5000 })
    const ev = t.applied().find((e) => e.effect === 'freeFold')!
    expect(ev).toMatchObject({ seat: 0, outcome: 'applied', amount: 1000 })
    expect(t.events.indexOf(ev)).toBeGreaterThan(t.index('DECISIONS_REVEALED'))
    t.advanceAll()
    t.assertMoney()
  })
  it('freeFold on a hand everyone folds carries over only what is left', () => {
    const t = new Table({ chaos: plan(2, { 1: { effects: [fx('s_free_fold')] } }), deck: layout(['Kc 3d', '7h 8h']), rules: { decisionMode: 'playOrFold' } })
    t.fold(0); t.fold(1)
    expect(t.stack(1)).toBe(5000)
    expect(t.state.result!.carryOverOut).toBe(1000)
    t.assertMoney()
  })
  it('when every folder takes its ante back, the lone player gets its own points back and wins only the carry-over', () => {
    const p = plan(3, { 1: { effects: [fx('s_free_fold')] }, 2: { effects: [fx('s_free_fold')] } })
    const t = new Table({ chaos: p, deck: layout(['Kc 3d', '7h 8h', '2c 2d']), rules: { decisionMode: 'playOrFold', tableFeeRate: 0.02 }, carryOverIn: 700 })
    t.play(0); t.fold(1); t.fold(2)
    expect(t.state.phase).toBe('COMPLETE')
    expect([t.stack(0), t.stack(1), t.stack(2)]).toEqual([5686, 5000, 5000])
    expect(t.state.result!.uncalledReturned).toEqual({ seat: 0, amount: 2000 })
    t.assertMoney()
  })
  it('freeFold does nothing for a seat that plays', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('s_free_fold')] } }), deck: layout(['Kc 3d', '7h 8h'], BOARD), rules: { decisionMode: 'playOrFold' } })
    t.play(0); t.play(1)
    expect(t.applied()).toEqual([])
  })
})

describe('debuffs: shields, mirrors and one per seat', () => {
  it('a shield blocks a freeze and is spent; both cards are reported used', () => {
    const p = plan(2, { 0: { effects: [fx('s_freeze_one', [1])] }, 1: { shield: 'shield' } })
    const t = new Table({ chaos: p, deck: layout(['Kc 3d', '7h 8h']) })
    expect(t.applied()).toEqual([{ type: 'CHAOS_APPLIED', seat: 0, cardId: 's_freeze_one', effect: 'freeze', targets: [1], outcome: 'blocked' }])
    expect(t.state.chaos!.marks).toEqual([])
    expect(t.state.chaos!.blocked).toEqual(expect.arrayContaining([p.seats[0]!.effects[0]!.uid, p.seats[1]!.shield!.uid]))
  })
  it('a mirror turns a freeze back on its user', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('s_freeze_one', [1])] }, 1: { shield: 'mirror' } }), deck: layout(['Kc 3d', '7h 8h']) })
    expect(t.applied()[0]).toMatchObject({ seat: 0, targets: [1], outcome: 'reflected' })
    expect(t.state.chaos!.marks).toEqual([{ seat: 0, kind: 'freeze' }])
  })
  it('a second debuff on the same seat fizzles but still counts as used', () => {
    const p = plan(3, { 0: { effects: [fx('s_freeze_one', [2])] }, 1: { effects: [fx('s_blindfold', [2])] } })
    const t = new Table({ chaos: p, deck: layout(['Kc 3d', '7h 8h', '2c 2d']), rules: { decisionMode: 'playOrFold' } })
    // Seat 1 deals before seat 0 (clockwise from the button on 0): its blindfold lands, seat 0's freeze fizzles.
    expect(t.applied().map((e) => [e.seat, e.outcome])).toEqual([[1, 'applied'], [0, 'fizzled']])
    expect(t.state.chaos!.marks).toEqual([{ seat: 2, kind: 'blindfold' }])
    expect(t.state.chaos!.applied).toEqual(expect.arrayContaining([p.seats[0]!.effects[0]!.uid, p.seats[1]!.effects[0]!.uid]))
  })
  it('a one-shot shield stops one debuff, a lasting shield stops them all', () => {
    const debuffs = { 0: { effects: [fx('s_freeze_one', [2])] }, 1: { effects: [fx('s_blindfold', [2])] } }
    const once = new Table({ chaos: plan(3, { ...debuffs, 2: { shield: 'shield' } }), deck: layout(['Kc 3d', '7h 8h', '2c 2d']), rules: { decisionMode: 'playOrFold' } })
    expect(once.applied().map((e) => e.outcome)).toEqual(['blocked', 'applied'])
    expect(once.state.chaos!.marks).toEqual([{ seat: 2, kind: 'freeze' }])
    const lasting = plan(3, { ...debuffs, 2: { shield: 'lasting' } })
    const all = new Table({ chaos: lasting, deck: layout(['Kc 3d', '7h 8h', '2c 2d']), rules: { decisionMode: 'playOrFold' } })
    expect(all.applied().map((e) => e.outcome)).toEqual(['blocked', 'blocked'])
    expect(all.state.chaos!.marks).toEqual([])
    expect(all.state.chaos!.blocked).not.toContain(lasting.seats[2]!.shield!.uid) // a duration shield is not used up
  })
  it('a deal-time debuff reaches only its user and its target', () => {
    const t = new Table({ chaos: plan(3, { 0: { effects: [fx('s_freeze_one', [1])] } }), deck: layout(['Kc 3d', '7h 8h', '2c 2d']) })
    const ev = t.applied()[0]!
    expect(filterEvent(ev, 0)).toEqual(ev)
    expect(filterEvent(ev, 1)).toEqual(ev)
    expect(filterEvent(ev, 2)).toBeNull()
  })
})

describe('reveal effects', () => {
  const two = (effects: PlannedEffect[], hands = ['2c 7d', '8h Ks'], rest = 'Kd 9s 5h 4c 3s Qh Qc Qd Th Tc', more: Record<number, SeatPlan> = {}) =>
    new Table({ chaos: plan(2, { 0: { effects }, ...more }), deck: layout(hands, rest) })

  it('stealHole takes one hole card of a random opponent, after the river and before the showdown', () => {
    const t = two([fx('s_steal_one')])
    t.advanceAll()
    expect(t.hole(1)).toEqual(parseCards('8h'))
    const ev = t.applied()[0]!
    expect(ev).toMatchObject({ seat: 0, effect: 'stealHole', targets: [1], outcome: 'applied' })
    expect(t.events.indexOf(ev)).toBeGreaterThan(t.events.map((e) => e.type).lastIndexOf('COMMUNITY_REVEALED'))
    expect(t.events.indexOf(ev)).toBeLessThan(t.index('SHOWDOWN'))
    expect(t.showdown(1).rank).toBe(evaluate([...parseCards('8h'), ...t.state.community]).rank)
  })
  it('steal-all takes a card from every opponent not yet hit', () => {
    const t = new Table({ chaos: plan(3, { 0: { effects: [fx('g_steal_all')] }, 2: { effects: [fx('s_steal_one')] } }), deck: layout(['2c 7d', '8h Ks', 'As Ad'], 'Kd 9s 5h 4c 3s') })
    t.advanceAll()
    // seat 2 fires first (clockwise from the button: 1, 2, 0) and takes from seat 1; steal-all then hits only seat 2.
    expect(t.applied().map((e) => [e.seat, e.targets, e.outcome])).toEqual([[2, [1], 'applied'], [0, [1], 'fizzled'], [0, [2], 'applied']])
    expect(t.state.players.map((p) => p.holeCards.length)).toEqual([2, 1, 1])
  })
  it('lowerHole redeals the target’s highest card', () => {
    const t = two([fx('s_lower')])
    t.advanceAll()
    expect(t.hole(1)).toEqual(parseCards('8h Qh'))
  })
  it('swapHands trades the whole hand with an opponent', () => {
    const t = two([fx('d_swap_hands')])
    t.advanceAll()
    expect([t.hole(0), t.hole(1)]).toEqual([parseCards('8h Ks'), parseCards('2c 7d')])
    expect(t.showdown(0).cards).toEqual(parseCards('8h Ks'))
  })
  it('redealBoard redeals one board card and shows the new board', () => {
    const t = two([fx('g_redeal_board_1')])
    t.advanceAll()
    expect(t.state.community).toEqual(parseCards('Kd 9s 5h 4c Qh'))
    expect(t.applied()[0]).toMatchObject({ effect: 'redealBoard', outcome: 'applied', community: parseCards('Kd 9s 5h 4c Qh') })
    expect(t.showdown(0).rank).toBe(evaluate([...t.hole(0), ...t.state.community]).rank)
  })
  it('storm redeals all five board cards', () => {
    const t = two([fx('d_storm')])
    t.advanceAll()
    expect(t.state.community).toEqual(parseCards('Qh Qc Qd Th Tc'))
  })
  it('borrowHole ranks the seat with a copy of an opponent’s card', () => {
    const t = two([fx('g_borrow')])
    t.advanceAll()
    const sd = t.showdown(0)
    expect(sd.borrowed).toBe(parseCards('Ks')[0])
    expect(t.hole(1)).toEqual(parseCards('8h Ks')) // a copy: the owner keeps it
    expect(sd.rank).toBe(evaluate([...parseCards('2c 7d Ks'), ...t.state.community]).rank)
    expect(sd.rank).toBeGreaterThan(evaluate([...parseCards('2c 7d'), ...t.state.community]).rank)
    expect(t.showdown(1).borrowed).toBeUndefined()
  })
  it('a reveal debuff picks only an unfolded opponent not yet hit', () => {
    const p = plan(3, { 2: { effects: [fx('s_freeze_one', [1])] }, 0: { effects: [fx('s_steal_one')] } })
    const t = new Table({ chaos: p, deck: layout(['2c 7d', '8h Ks', 'As Ad'], 'Kd 9s 5h 4c 3s'), reveal: firstRng })
    t.advanceAll()
    expect(t.applied().find((e) => e.effect === 'stealHole')).toMatchObject({ targets: [2], outcome: 'applied' })
  })
  it('a shield blocks a reveal debuff', () => {
    const t = two([fx('s_lower')], undefined, undefined, { 1: { shield: 'shield' } })
    t.advanceAll()
    expect(t.hole(1)).toEqual(parseCards('8h Ks'))
    expect(t.applied()[0]!.outcome).toBe('blocked')
  })
  it('a mirror turns a reveal debuff back on its user: lowerHole redeals the user’s own highest card (M5)', () => {
    const t = two([fx('s_lower')], undefined, undefined, { 1: { shield: 'mirror' } })
    t.advanceAll()
    expect(t.applied()[0]).toMatchObject({ seat: 0, effect: 'lowerHole', targets: [1], outcome: 'reflected' })
    expect(t.hole(1)).toEqual(parseCards('8h Ks')) // the target is untouched
    expect(t.hole(0)).toEqual(parseCards('2c Qh')) // the user's 7d went back, the next card came in
    expect(t.showdown(0).rank).toBe(evaluate([...parseCards('2c Qh'), ...t.state.community]).rank)
    t.assertMoney()
  })
  it('reveal effects wait for a showdown', () => {
    const p = plan(2, { 0: { effects: [fx('s_steal_one'), fx('g_redeal_board_1')] } })
    const t = new Table({ chaos: p, deck: layout(['2c 7d', '8h Ks']), rules: { decisionMode: 'playOrFold' } })
    t.play(0); t.fold(1)
    expect(t.state.phase).toBe('COMPLETE')
    expect(t.applied()).toEqual([])
    expect(t.state.chaos!.applied).toEqual([])
  })
  it('a holder who folded fires nothing and keeps the card', () => {
    const p = plan(3, { 0: { effects: [fx('s_steal_one')] } })
    const t = new Table({ chaos: p, deck: layout(['2c 7d', '8h Ks', 'As Ad'], BOARD), rules: { decisionMode: 'playOrFold' } })
    t.fold(0); t.play(1); t.play(2); t.advanceAll()
    expect(t.applied()).toEqual([])
    expect(t.state.chaos!.applied).not.toContain(p.seats[0]!.effects[0]!.uid)
  })
})

describe('a bonus card played mid-hand (BP-39)', () => {
  const choice = (by: Record<number, SeatPlan> = {}) =>
    new Table({ chaos: plan(2, by), deck: layout(['2c 7d', '8h Ks'], 'Kd 9s 5h 4c 3s Qh Qc Qd Th Tc'), rules: { decisionMode: 'playOrFold' } })

  it('joins the live plan during the choice and fires at the reveal under its own uid', () => {
    const t = choice()
    expect(t.state.phase).toBe('DECISION')
    const steal = fx('s_steal_one')
    addRevealEffect(t.state, 0, steal)
    t.play(0); t.play(1); t.advanceAll()
    expect(t.hole(1)).toEqual(parseCards('8h'))
    expect(t.applied()).toEqual([{ type: 'CHAOS_APPLIED', seat: 0, cardId: 's_steal_one', effect: 'stealHole', targets: [1], outcome: 'applied' }])
    expect(t.state.chaos!.applied).toEqual([steal.uid])
    // settlement reads the seat's fired cards from the plan: the played card is there
    expect(t.state.chaos!.plan.seats[0]!.effects.map((e) => e.uid)).toEqual([steal.uid])
    t.assertMoney()
  })

  it('takes the place of a planned draft debuff, which stays held: only the played one fires', () => {
    const draft = fx('s_lower')
    const crit = fx('g_crit')
    const t = choice({ 0: { effects: [draft, crit] } })
    const steal = fx('s_steal_one')
    addRevealEffect(t.state, 0, steal)
    expect(t.state.chaos!.plan.seats[0]!.effects.map((e) => e.cardId)).toEqual(['g_crit', 's_steal_one'])
    t.play(0); t.play(1); t.advanceAll()
    expect(t.applied().map((e) => e.cardId)).toEqual(['s_steal_one'])
    expect(t.state.chaos!.applied).toContain(steal.uid)
    expect(t.state.chaos!.applied).not.toContain(draft.uid)
  })

  it('a non-debuff card joins beside a planned debuff', () => {
    const draft = fx('s_lower')
    const t = choice({ 0: { effects: [draft] } })
    addRevealEffect(t.state, 0, fx('g_redeal_board_1'))
    t.play(0); t.play(1); t.advanceAll()
    expect(t.applied().map((e) => [e.cardId, e.outcome])).toEqual([['s_lower', 'applied'], ['g_redeal_board_1', 'applied']])
  })

  it('goes back unfired when its owner folds', () => {
    const t = new Table({ chaos: plan(3, {}), deck: layout(['2c 7d', '8h Ks', 'As Ad'], BOARD), rules: { decisionMode: 'playOrFold' } })
    const steal = fx('s_steal_one')
    addRevealEffect(t.state, 0, steal)
    t.fold(0); t.play(1); t.play(2); t.advanceAll()
    expect(t.applied()).toEqual([])
    expect(t.state.chaos!.applied).not.toContain(steal.uid)
  })

  it('refuses what armBonus never sends: a card that is not a one-shot reveal card, a repeated effect, a seat that fired a deal debuff', () => {
    expect(() => addRevealEffect(choice().state, 0, fx('g_insure_full'))).toThrow()
    expect(() => addRevealEffect(choice().state, 5, fx('s_steal_one'))).toThrow()
    expect(() => addRevealEffect(choice({ 0: { effects: [fx('g_steal_all')] } }).state, 0, fx('s_steal_one'))).toThrow()
    expect(() => addRevealEffect(choice({ 0: { effects: [fx('s_freeze_one', [1])] } }).state, 0, fx('s_lower'))).toThrow()
  })
})

describe('settlement', () => {
  it('reverseRank makes the weakest hand win', () => {
    const deck = layout(['Ac Ad', '7c 2d'], 'Kh 9s 5h 4c Js')
    const plain = new Table({ chaos: plan(2, {}), deck })
    plain.advanceAll()
    expect(plain.state.result!.payouts).toEqual([{ seat: 0, amount: 2000 }])
    const reversed = new Table({ chaos: plan(2, { 1: { effects: [fx('d_reverse')] } }), deck })
    reversed.advanceAll()
    expect(reversed.state.result!.payouts).toEqual([{ seat: 1, amount: 2000 }])
    expect(reversed.showdown(0).rank).toBeGreaterThan(reversed.showdown(1).rank) // the shown ranks stay the real ones
    reversed.assertMoney()
  })
  it('insurance refunds 50 % and 100 % to a losing insured seat only, and the books balance', () => {
    const p = plan(3, { 0: { effects: [fx('g_insure_full')] }, 1: { effects: [fx('s_insure_half')] }, 2: { effects: [fx('d_insure_2')] } })
    const t = new Table({ chaos: p, deck: layout(['Ac Ad', '7c 2d', '8c 3d'], 'Kh 9s 5h 4c Js') })
    t.advanceAll()
    expect([t.stack(0), t.stack(1), t.stack(2)]).toEqual([5500, 4500, 5000])
    expect(t.applied().map((e) => [e.seat, e.effect, e.amount])).toEqual([[1, 'refundStake', 500], [2, 'refundStake', 1000]])
    expect(t.events.indexOf(t.applied()[0]!)).toBeGreaterThan(t.index('SHOWDOWN'))
    t.assertMoney()
  })
  it('insurance with a fee keeps Σ stacks + fee + carry-over', () => {
    const p = plan(3, { 1: { effects: [fx('g_insure_full')] } })
    const t = new Table({ chaos: p, deck: layout(['Ac Ad', '7c 2d', '8c 3d'], 'Kh 9s 5h 4c Js'), rules: { tableFeeRate: 0.02 }, carryOverIn: 700 })
    t.advanceAll()
    expect(t.stack(1)).toBe(5000)
    expect(t.state.result!.fee).toBe(74)
    t.assertMoney()
  })
  it('insurance takes from the last side pot back to the main pot', () => {
    const p = plan(3, { 1: { effects: [fx('g_insure_full')] } })
    const t = new Table({ chaos: p, stacks: [500, 5000, 5000], deck: layout(['Ac Ad', '7c 2d', 'Kc Kd'], '9h 8s 5h 4c Jd') })
    t.advanceAll()
    expect([t.stack(0), t.stack(1), t.stack(2)]).toEqual([1500, 5000, 4000])
    t.assertMoney()
  })
  it('reverseRank with side pots: the weakest hand eligible for each pot wins it (M5)', () => {
    // Seat 0 is all in for 500: a main pot of 1.500 for all three, a side pot of 1.000 for seats 1 and 2.
    const deck = layout(['7c 2d', 'Ac Ad', 'Kc Kd'], '9h 8s 5h 4c Jd')
    const plain = new Table({ chaos: plan(3, {}), stacks: [500, 5000, 5000], deck })
    plain.advanceAll()
    expect([plain.stack(0), plain.stack(1), plain.stack(2)]).toEqual([0, 6500, 4000])
    const reversed = new Table({ chaos: plan(3, { 2: { effects: [fx('d_reverse')] } }), stacks: [500, 5000, 5000], deck })
    reversed.advanceAll()
    expect(reversed.state.result!.pots.map((p) => [p.amount, p.eligibleSeats, p.winners.map((w) => w.seat)])).toEqual([
      [1500, [0, 1, 2], [0]], // the weakest of the three
      [1000, [1, 2], [2]], // the weaker of the two it is for: the kings, not the aces
    ])
    expect([reversed.stack(0), reversed.stack(1), reversed.stack(2)]).toEqual([1500, 4000, 5000])
    reversed.assertMoney()
  })
  it('insurance on a reversed hand pays the seat that loses by the reversed ranking — the best hand — and the books balance (M5)', () => {
    const p = plan(3, { 0: { effects: [fx('g_insure_full')] }, 1: { effects: [fx('g_insure_full')] }, 2: { effects: [fx('d_reverse')] } })
    const t = new Table({ chaos: p, deck: layout(['Ac Ad', '7c 2d', '8c 3d'], 'Kh 9s 5h 4c Js') })
    t.advanceAll()
    // Seat 1 holds the weakest hand and wins; seat 0's aces lose and get their 1.000 back; seat 1's insurance pays nothing.
    expect(t.state.result!.payouts).toEqual([{ seat: 1, amount: 2000 }])
    expect(t.applied().filter((e) => e.effect === 'refundStake').map((e) => [e.seat, e.amount])).toEqual([[0, 1000]])
    expect([t.stack(0), t.stack(1), t.stack(2)]).toEqual([5000, 6000, 4000])
    t.assertMoney()
  })
  it('CHAOS_SUMMARY lists every card the hand used, for the whole table, just before SETTLEMENT', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('s_swap_one'), fx('s_steal_one')] } }), deck: layout(['Kc 3d', '7h 8h'], 'Qh') })
    t.advanceAll()
    const i = t.index('CHAOS_SUMMARY')
    expect(t.events[i + 1]!.type).toBe('SETTLEMENT')
    const summary = t.events[i]!
    expect(summary).toEqual({ type: 'CHAOS_SUMMARY', used: [
      { seat: 0, cardId: 's_swap_one', effect: 'swapLowest', outcome: 'applied', targets: [] },
      { seat: 0, cardId: 's_steal_one', effect: 'stealHole', outcome: 'applied', targets: [1] },
    ] })
    expect(filterEvent(summary, 1)).toEqual(summary)
  })
  it('CHAOS_SUMMARY also closes a hand everyone folded', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('s_swap_one')] } }), deck: layout(['Kc 3d', '7h 8h'], 'Qh'), rules: { decisionMode: 'playOrFold' } })
    t.fold(0); t.fold(1)
    expect(t.events[t.index('SETTLEMENT') - 1]).toMatchObject({ type: 'CHAOS_SUMMARY', used: [{ seat: 0, effect: 'swapLowest' }] })
  })
})
