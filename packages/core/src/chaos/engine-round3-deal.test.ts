import { describe, expect, it } from 'vitest'
import { parseCards, rankOf, type Card } from '../cards/cards.js'
import { seededRng, type Rng } from '../cards/rng.js'
import { HandCategory } from '../evaluator/evaluator.js'
import { applyBlindCommand, createBlindHand } from '../hand/blind.js'
import type { BlindRules, GameEvent, HandCommand, HandState } from '../hand/types.js'
import { filterEvent, playerView } from '../hand/view.js'
import { evaluateAny } from './evaluate.js'
import { CHAOS_CARDS_SPEC } from './fixtures.js'
import type { ChaosHandPlan, PlannedEffect } from './types.js'

/**
 * BP-41 Task 3a: the round-three cards that change the hole cards and the board at the deal — Siêu cộng dồn (both),
 * Liều ăn nhiều, Hên xui, Đảo bài, Lá ma, Lá chung thứ sáu — the Aces rule and the evaluator above ten cards. The cards
 * ship disabled in data; the plans here name them directly.
 */

const lastRng: Rng = { int: (n) => n - 1 }
const firstRng: Rng = { int: () => 0 }

/** An rng whose shuffle lays the deck out as `top` (then every other card in order), then acts as `after`. */
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

let uidSeq = 900
function fx(cardId: string, charge?: number): PlannedEffect {
  const d = CHAOS_CARDS_SPEC.find((c) => c.id === cardId)
  if (!d) throw new Error(`no card ${cardId}`)
  return {
    uid: ++uidSeq, cardId, effect: d.effect, params: d.params, timing: d.timing, debuff: d.debuff, targets: [],
    ...(charge === undefined ? {} : { charge }),
  }
}
function plan(n: number, by: Record<number, { effects?: PlannedEffect[]; blindfolded?: boolean }>): ChaosHandPlan {
  return {
    seats: Array.from({ length: n }, (_, seat) => ({ seat, effects: by[seat]?.effects ?? [], shield: null, blindfolded: by[seat]?.blindfolded ?? false })),
    reverse: false,
  }
}

class Table {
  state: HandState
  events: GameEvent[] = []
  constructor(o: { chaos?: ChaosHandPlan; seats?: number; rng: Rng; rules?: Partial<BlindRules>; reveal?: Rng }) {
    const n = o.chaos?.seats.length ?? o.seats ?? 2
    const rules: BlindRules = { mode: 'blind', holeCards: 2, decisionMode: 'none', fixedWager: 1000, tableFeeRate: 0, ...o.rules }
    const seats = Array.from({ length: n }, (_, seat) => ({ seat, playerId: `p${seat}`, stack: 5000, isBot: false }))
    const res = createBlindHand({ handId: 'd3', rules, seats, button: 0, carryOverIn: 0, ...(o.chaos ? { chaos: o.chaos } : {}) }, o.rng)
    this.state = res.state
    this.events.push(...res.events)
    this.reveal = o.reveal ?? lastRng
  }
  private readonly reveal: Rng
  apply(cmd: HandCommand) {
    const r = applyBlindCommand(this.state, cmd, this.reveal)
    this.state = r.state
    this.events.push(...r.events)
  }
  advanceAll() { while (this.state.phase === 'REVEAL') this.apply({ type: 'ADVANCE' }) }
  hole(seat: number) { return this.state.players.find((p) => p.seat === seat)!.holeCards }
  applied(effect?: string) {
    return this.events.filter((e): e is Extract<GameEvent, { type: 'CHAOS_APPLIED' }> => e.type === 'CHAOS_APPLIED' && (effect === undefined || e.effect === effect))
  }
  showdown(seat: number) { return this.state.result!.showdown!.find((h) => h.seat === seat)! }
  /** Every card dealt or still in the deck exactly once. */
  assertDeck() {
    expect([...this.state.deck].sort((a, b) => a - b)).toEqual(Array.from({ length: 52 }, (_, i) => i))
    const held = this.state.players.flatMap((p) => p.holeCards)
    expect(new Set(held).size).toBe(held.length)
  }
}

const isAce = (c: Card): boolean => rankOf(c) === 12
const expectPrivate = (ev: GameEvent, owner: number, other: number) => {
  expect(filterEvent(ev, owner)).toEqual(ev)
  expect(filterEvent(ev, other)).toBeNull()
  expect(filterEvent(ev, null)).toBeNull()
}

describe('a chaos hand without a round-three deal card deals exactly as a plain hand', () => {
  it('same hole cards, same deck position, same events but the chaos ones, for 2 and 3 cards', () => {
    for (const holeCards of [2, 3] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        const chaos = new Table({ chaos: plan(5, {}), rng: seededRng(seed), rules: { holeCards } })
        const plain = new Table({ seats: 5, rng: seededRng(seed), rules: { holeCards } })
        expect(chaos.state.players.map((p) => p.holeCards)).toEqual(plain.state.players.map((p) => p.holeCards))
        expect(chaos.state.deckIndex).toBe(plain.state.deckIndex)
        expect(chaos.state.deck).toEqual(plain.state.deck)
        expect(chaos.events).toEqual(plain.events)
      }
    }
  })
})

describe('Siêu cộng dồn and the Aces rule (spec §3 "Lá A có hạn", A4)', () => {
  it('the Kim cương card at a sure charge deals all the hole cards as Aces, before the deal, told only to its owner', () => {
    const t = new Table({ chaos: plan(3, { 0: { effects: [fx('d_aces_charge', 100)] } }), rng: seededRng(5), rules: { holeCards: 3 } })
    expect(t.hole(0)).toHaveLength(3)
    expect(t.hole(0).every(isAce)).toBe(true)
    expect(t.state.chaos!.outcomes?.acesDealt).toEqual([0])
    const [ev] = t.applied('acesCharge')
    expect(ev).toMatchObject({ seat: 0, cardId: 'd_aces_charge', outcome: 'applied' })
    expect(t.events.indexOf(ev!)).toBeLessThan(t.events.findIndex((e) => e.type === 'CARDS_DEALT'))
    expectPrivate(ev!, 0, 1)
    t.assertDeck()
  })

  it('the Vàng card deals a pair of Aces; the third card is dealt as usual, after the Aces left the deck', () => {
    const t = new Table({
      chaos: plan(2, { 0: { effects: [fx('g_aces_charge', 60)] } }), rng: deckRng('2c 3c 4c 5c 6c 7c Ah As', firstRng), rules: { holeCards: 3 },
    })
    expect(t.hole(0)).toEqual(parseCards('Ah As 5c'))
    expect(t.hole(1)).toEqual(parseCards('2c 3c 4c'))
    t.assertDeck()
  })

  it('a roll above the charge deals as usual and is told as fizzled', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('d_aces_charge', 0)] } }), rng: deckRng('7h 8d 9c Tc') })
    expect(t.hole(0)).toEqual(parseCards('8d Tc'))
    expect(t.applied('acesCharge')[0]!.outcome).toBe('fizzled')
    expect(t.state.chaos!.outcomes).toBeUndefined()
  })

  it('Aces are scarce: the first seat clockwise takes them, the next takes the last Ace and then the highest cards left', () => {
    const t = new Table({
      chaos: plan(3, { 1: { effects: [fx('d_aces_charge', 100)] }, 2: { effects: [fx('d_aces_charge', 100)] } }),
      rng: deckRng('Ac Ad Ah As Kc Kd Kh Ks'), rules: { holeCards: 3 },
    })
    expect(t.hole(1)).toEqual(parseCards('Ac Ad Ah'))
    expect(t.hole(2)).toEqual(parseCards('As Kc Kd'))
    expect(t.hole(0)).toEqual(parseCards('Kh Ks 2c'))
    expect(t.state.chaos!.outcomes?.acesDealt).toEqual([1, 2])
    t.assertDeck()
  })

  it('a blindfolded owner is not told (Ruling 9): no event, only its line in "Thẻ đã dùng"', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('d_aces_charge', 100)], blindfolded: true } }), rng: seededRng(5) })
    expect(t.hole(0).every(isAce)).toBe(true)
    expect(t.applied('acesCharge')).toEqual([])
    expect(t.state.chaos!.used).toContainEqual({ seat: 0, cardId: 'd_aces_charge', effect: 'acesCharge', outcome: 'applied', targets: [] })
    // A miss is not told either.
    const miss = new Table({ chaos: plan(2, { 0: { effects: [fx('d_aces_charge', 0)], blindfolded: true } }), rng: deckRng('7h 8d 9c Tc') })
    expect(miss.applied('acesCharge')).toEqual([])
    expect(miss.state.chaos!.used.map((u) => u.outcome)).toEqual(['fizzled'])
  })

  it('a card that would replace one of the Aces ("Đổi lá", "Đồng hoa") fizzles on that seat', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('d_aces_charge', 100), fx('s_swap_one'), fx('s_suited')] } }), rng: seededRng(3) })
    expect(t.hole(0).every(isAce)).toBe(true)
    expect(t.applied('swapLowest')[0]!.outcome).toBe('fizzled')
    expect(t.applied('suited')[0]!.outcome).toBe('fizzled')
  })
})

describe('hole counts: Hên xui, Đảo bài, Liều ăn nhiều', () => {
  it('Hên xui on heads adds a card, dealt after every seat has its usual cards', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('s_coin_flip')] } }), rng: deckRng('2c 3c 4c 5c 6c', firstRng) })
    expect(t.hole(0)).toEqual(parseCards('3c 5c 6c'))
    expect(t.hole(1)).toEqual(parseCards('2c 4c'))
    const [ev] = t.applied('coinFlip')
    expect(ev).toMatchObject({ outcome: 'applied', holeDelta: 1 })
    expectPrivate(ev!, 0, 1)
  })

  it('Hên xui on tails takes a card', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('s_coin_flip')] } }), rng: deckRng('2c 3c 4c 5c', lastRng) })
    expect(t.hole(0)).toEqual(parseCards('3c'))
    expect(t.hole(1)).toEqual(parseCards('2c 4c'))
    expect(t.applied('coinFlip')[0]).toMatchObject({ outcome: 'applied', holeDelta: -1 })
  })

  it('a seat never ends with no hole card: a −1 on a one-card seat fizzles', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('d_risky_hand'), fx('s_coin_flip')] } }), rng: deckRng('2c 3c 4c 9d Ks', lastRng) })
    expect(t.hole(0)).toHaveLength(1)
    expect(t.applied('coinFlip')[0]).toMatchObject({ outcome: 'fizzled', holeDelta: -1 })
  })

  it('Đảo bài adds a card on an even phase and takes one on an odd phase, which makes the seat immune', () => {
    const plus = new Table({ chaos: plan(2, { 0: { effects: [fx('g_flip_flop', 0)] } }), rng: seededRng(4) })
    expect(plus.hole(0)).toHaveLength(3)
    expect(plus.applied('flipFlop')[0]).toMatchObject({ outcome: 'applied', holeDelta: 1 })
    expect(plus.state.chaos!.immune).toBeUndefined()
    const minus = new Table({ chaos: plan(2, { 0: { effects: [fx('g_flip_flop', 3)] } }), rng: seededRng(4) })
    expect(minus.hole(0)).toHaveLength(1)
    expect(minus.applied('flipFlop')[0]).toMatchObject({ outcome: 'applied', holeDelta: -1 })
    expect(minus.state.chaos!.immune).toEqual([0])
    expectPrivate(minus.applied('flipFlop')[0]!, 0, 1)
  })

  it('Liều ăn nhiều deals one card fewer and keeps the best of three sets, told privately with the card it took', () => {
    // Seat 1 is dealt 7h and 8h, seat 0 its one card 3c; its two more sets are 9d and Ks.
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('d_risky_hand')] } }), rng: deckRng('7h 3c 8h 9d Ks') })
    expect(t.hole(0)).toEqual(parseCards('Ks'))
    expect(t.hole(1)).toEqual(parseCards('7h 8h'))
    const [ev] = t.applied('riskyHand')
    expect(ev).toMatchObject({ seat: 0, outcome: 'applied', holeDelta: -1 })
    expectPrivate(ev!, 0, 1)
    expect(t.state.chaos!.immune).toEqual([0])
  })

  it('an immune seat shrugs off the steal family: the debuff is spent and does nothing', () => {
    const lower = new Table({
      chaos: plan(2, { 0: { effects: [fx('d_risky_hand')] }, 1: { effects: [fx('s_lower')] } }), rng: deckRng('7h 3c 8h 9d Ks'),
    })
    lower.advanceAll()
    expect(lower.hole(0)).toEqual(parseCards('Ks'))
    expect(lower.applied('lowerHole')[0]).toMatchObject({ seat: 1, targets: [0], outcome: 'fizzled' })
    expect(lower.state.chaos!.hit).toEqual([])
    const swap = new Table({
      chaos: plan(2, { 0: { effects: [fx('g_flip_flop', 1)] }, 1: { effects: [fx('d_swap_hands')] } }), rng: seededRng(8),
    })
    const before = swap.hole(0).slice()
    swap.advanceAll()
    expect(swap.hole(0)).toEqual(before)
    expect(swap.applied('swapHands')[0]!.outcome).toBe('fizzled')
  })

  it('on a short deck a +1 fizzles: it would eat into the reserve', () => {
    // 14 seats × 3 cards leave exactly the 10-card reserve.
    const t = new Table({
      chaos: plan(14, { 0: { effects: [fx('s_coin_flip')] }, 1: { effects: [fx('g_flip_flop', 0)] } }), rng: deckRng('', firstRng), rules: { holeCards: 3 },
    })
    expect(t.hole(0)).toHaveLength(3)
    expect(t.hole(1)).toHaveLength(3)
    expect(t.applied('coinFlip')[0]).toMatchObject({ outcome: 'fizzled', holeDelta: 1 })
    expect(t.applied('flipFlop')[0]).toMatchObject({ outcome: 'fizzled', holeDelta: 1 })
  })
})

describe('Lá ma (wild card)', () => {
  // Seat 0 holds Qh 2s; the wild pick (lastRng) is its second card, 2s. Board Ah Kh Jh 3c 4d.
  const deck = '7c Qh 8c 2s Ah Kh Jh 3c 4d'
  it('ranks the wild card as whatever makes the best hand; the showdown shows the real card and what it stood for', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('d_wild_card')] } }), rng: deckRng(deck) })
    const [ev] = t.applied('wildCard')
    expect(ev).toMatchObject({ seat: 0, outcome: 'applied', wild: parseCards('2s')[0] })
    expectPrivate(ev!, 0, 1)
    expect(playerView(t.state, 0).chaos?.wild).toBe(parseCards('2s')[0])
    expect(playerView(t.state, 1).chaos?.wild).toBeUndefined()
    t.advanceAll()
    const sd = t.showdown(0)
    expect(sd.category).toBe(HandCategory.ROYAL_FLUSH)
    expect(sd.cards).toEqual(parseCards('Qh 2s'))
    expect(sd.wild).toEqual({ card: parseCards('2s')[0], as: parseCards('Th')[0] })
    expect(sd.best).toContain(parseCards('2s')[0])
    expect(t.showdown(1).wild).toBeUndefined()
    expect(t.state.result!.payouts).toEqual([{ seat: 0, amount: 2000 }])
  })

  it('a blindfolded owner is not told which card is wild', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('d_wild_card')], blindfolded: true } }), rng: deckRng(deck) })
    expect(t.applied('wildCard')[0]!.wild).toBeUndefined()
    expect(playerView(t.state, 0).chaos?.wild).toBeUndefined()
  })

  it('a wild card swapped away loses its wildness', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('d_wild_card')] }, 1: { effects: [fx('d_swap_hands')] } }), rng: deckRng(deck) })
    t.advanceAll()
    expect(t.hole(1)).toEqual(parseCards('Qh 2s'))
    expect(t.showdown(1).wild).toBeUndefined()
    expect(t.showdown(1).category).toBe(HandCategory.HIGH_CARD)
    expect(playerView(t.state, 0).chaos?.wild).toBeUndefined()
  })
})

describe('Lá chung thứ sáu', () => {
  it('the river deals two cards, the board has six, and each seat ranks its best five; the card is public', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('g_sixth_board')] } }), rng: seededRng(11) })
    const [ev] = t.applied('sixthBoard')
    expect(ev!.outcome).toBe('applied')
    expect(filterEvent(ev!, 1)).toEqual(ev)
    t.advanceAll()
    expect(t.state.community).toHaveLength(6)
    const river = t.events.find((e): e is Extract<GameEvent, { type: 'COMMUNITY_REVEALED' }> => e.type === 'COMMUNITY_REVEALED' && e.street === 'RIVER')!
    expect(river.cards).toHaveLength(2)
    for (const seat of [0, 1]) expect(t.showdown(seat).rank).toBe(evaluateAny([...t.hole(seat), ...t.state.community]).rank)
  })

  it('fizzles when the deck cannot spare a sixth card above the reserve', () => {
    const t = new Table({ chaos: plan(14, { 0: { effects: [fx('g_sixth_board')] } }), rng: seededRng(2), rules: { holeCards: 3 } })
    expect(t.applied('sixthBoard')[0]!.outcome).toBe('fizzled')
    t.advanceAll()
    expect(t.state.community).toHaveLength(5)
  })

  it('with six board cards and six hole cards a seat ranks 12 cards (and 13 with a borrowed one) at the showdown', () => {
    const effects = [fx('g_sixth_board'), fx('g_extra_card'), fx('s_coin_flip'), fx('g_flip_flop', 0), fx('g_borrow')]
    const t = new Table({ chaos: plan(2, { 0: { effects } }), rng: deckRng('', firstRng), rules: { holeCards: 3 } })
    expect(t.hole(0)).toHaveLength(6)
    t.advanceAll()
    expect(t.state.community).toHaveLength(6)
    const borrowed = t.showdown(0).borrowed!
    expect(borrowed).toBeDefined()
    expect(t.showdown(0).rank).toBe(evaluateAny([...t.hole(0), ...t.state.community, borrowed]).rank)
    const r = t.state.result!
    expect(t.state.players.reduce((a, p) => a + p.stack, 0) + r.fee + r.carryOverOut).toBe(10_000)
  })
})
