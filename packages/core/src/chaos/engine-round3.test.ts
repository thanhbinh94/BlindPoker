import { describe, expect, it } from 'vitest'
import { parseCards, rankOf } from '../cards/cards.js'
import { seededRng, type Rng } from '../cards/rng.js'
import { applyBlindCommand, createBlindHand } from '../hand/blind.js'
import type { BlindRules, GameEvent, HandCommand, HandState } from '../hand/types.js'
import { filterEvent, playerView } from '../hand/view.js'
import { armBonus, canInsertThisHand } from './bonus.js'
import { addRevealEffect } from './engine.js'
import { CHAOS_CARDS_SPEC } from './fixtures.js'
import { toHeld } from './hold.js'
import { planHand } from './plan.js'
import { afterHand, type AfterHandSeat } from './settle.js'
import {
  DEFAULT_CHAOS_CONFIG, EMPTY_CHAOS_SEAT, type ChaosCardDef, type ChaosHandPlan, type ChaosSeat, type PlannedEffect,
} from './types.js'

/**
 * BP-41 Task 3b: Cướp đoạt, Lời nguyền, Kẻ phá đám, Nhật thực, Mắt diều hâu, Mồi lửa, Tích tiểu thành đại, the immunity
 * rule and the short deck. The cards ship disabled in data; the plans here name them directly.
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
type SeatPlan = { effects?: PlannedEffect[]; shield?: 'shield' | 'mirror'; eclipsed?: true }
function plan(n: number, by: Record<number, SeatPlan>, reverse = false): ChaosHandPlan {
  return {
    seats: Array.from({ length: n }, (_, seat) => ({
      seat,
      effects: by[seat]?.effects ?? [],
      shield: by[seat]?.shield ? { uid: 700 + seat, cardId: by[seat]!.shield === 'mirror' ? 'd_mirror' : 's_shield', kind: by[seat]!.shield! } : null,
      blindfolded: false,
      ...(by[seat]?.eclipsed ? { eclipsed: true as const } : {}),
    })),
    reverse,
  }
}

class Table {
  state: HandState
  events: GameEvent[] = []
  constructor(o: { chaos: ChaosHandPlan; rng: Rng; rules?: Partial<BlindRules> }) {
    const rules: BlindRules = { mode: 'blind', holeCards: 2, decisionMode: 'none', fixedWager: 1000, tableFeeRate: 0, ...o.rules }
    const seats = o.chaos.seats.map(({ seat }) => ({ seat, playerId: `p${seat}`, stack: 5000, isBot: false }))
    const res = createBlindHand({ handId: 'r3', rules, seats, button: 0, carryOverIn: 0, chaos: o.chaos }, o.rng)
    this.state = res.state
    this.events.push(...res.events)
  }
  apply(cmd: HandCommand) {
    const r = applyBlindCommand(this.state, cmd, lastRng)
    this.state = r.state
    this.events.push(...r.events)
  }
  advanceAll() { while (this.state.phase === 'REVEAL') this.apply({ type: 'ADVANCE' }) }
  hole(seat: number) { return this.state.players.find((p) => p.seat === seat)!.holeCards }
  applied(effect: string) {
    return this.events.filter((e): e is Extract<GameEvent, { type: 'CHAOS_APPLIED' }> => e.type === 'CHAOS_APPLIED' && e.effect === effect)
  }
  assertDeck() {
    expect([...this.state.deck].sort((a, b) => a - b)).toEqual(Array.from({ length: 52 }, (_, i) => i))
    const held = this.state.players.flatMap((p) => p.holeCards)
    expect(new Set(held).size).toBe(held.length)
  }
}

const sees = (ev: GameEvent, seat: number | null): boolean => filterEvent(ev, seat) !== null

describe('Cướp đoạt (plunder)', () => {
  it('takes the strongest hand before the board from the opponents; each robbed seat gets deck cards; told only to its parties, without cards', () => {
    // Deal order from the button: seats 1, 2, 3, 0, twice. Seat 0 holds 2c 4d; the Aces sit with seats 1 and 2.
    const t = new Table({ chaos: plan(4, { 0: { effects: [fx('d_plunder')] } }), rng: deckRng('Ah Ad 5c 2c 7c 3s 6d 4d Kh Qh') })
    expect(t.hole(0)).toEqual(parseCards('Ah Ad'))
    expect(t.hole(1)).toEqual(parseCards('Kh 7c'))
    expect(t.hole(2)).toEqual(parseCards('Qh 3s'))
    expect(t.hole(3)).toEqual(parseCards('5c 6d'))
    const [ev] = t.applied('plunder')
    expect(ev).toMatchObject({ seat: 0, targets: [1, 2], outcome: 'applied' })
    expect(Object.keys(ev!).sort()).toEqual(['cardId', 'effect', 'outcome', 'seat', 'targets', 'type'])
    for (const s of [0, 1, 2]) expect(sees(ev!, s)).toBe(true)
    expect(sees(ev!, 3)).toBe(false)
    expect(sees(ev!, null)).toBe(false)
    expect(t.state.chaos!.hit).toEqual([1, 2])
    // The deal events show the hands as they are after the deal-time cards.
    const dealt = t.events.find((e): e is Extract<GameEvent, { type: 'CARDS_DEALT' }> => e.type === 'CARDS_DEALT' && e.seat === 0)!
    expect(dealt.cards).toEqual(parseCards('Ah Ad'))
    t.assertDeck()
  })

  it('ranks two pair above a pair with a higher kicker on four cards', () => {
    // Seat 0 holds four cards (Hên xui heads); the opponent offers Ah Kd Kc 3d 3s on a 3-card table plus Thêm lá.
    const t = new Table({
      chaos: plan(2, { 0: { effects: [fx('d_plunder'), fx('s_coin_flip')] }, 1: { effects: [fx('g_extra_card'), fx('s_coin_flip')] } }),
      rng: deckRng('Ah 2c Kd 4c Kc 5c 3d 6c 3s 7h 8h 9h Th Jh', firstRng), rules: { holeCards: 3 },
    })
    expect(t.hole(1)).toHaveLength(5)
    expect(t.hole(0).map(rankOf).sort((a, b) => b - a)).toEqual([11, 11, 1, 1])
    t.assertDeck()
  })

  it('never takes from an immune seat', () => {
    // Seat 1 is on an Đảo bài −1 hand (one card, Ah): immune. Seat 2's two Kings are all within reach.
    const t = new Table({
      chaos: plan(3, { 0: { effects: [fx('d_plunder')] }, 1: { effects: [fx('g_flip_flop', { charge: 1 })] } }), rng: deckRng('Ah Kd 2c Ks 3d 9h 8h'),
    })
    expect(t.hole(1)).toEqual(parseCards('Ah'))
    expect(t.hole(0)).toEqual(parseCards('Kd Ks'))
    expect(t.hole(2)).toEqual(parseCards('9h 8h'))
    expect(t.applied('plunder')[0]).toMatchObject({ targets: [2], outcome: 'applied' })
  })

  it('nobody within reach: it fizzles and the holder keeps its cards', () => {
    const t = new Table({
      chaos: plan(2, { 0: { effects: [fx('d_plunder')] }, 1: { effects: [fx('g_flip_flop', { charge: 1 })] } }), rng: deckRng('Ah 2c 3d'),
    })
    expect(t.hole(0)).toEqual(parseCards('2c 3d'))
    expect(t.applied('plunder')[0]).toMatchObject({ targets: [], outcome: 'fizzled' })
    expect(t.state.chaos!.hit).toEqual([])
  })

  it('a shield blocks it for its seat (spent), and the hand is chosen again without that seat', () => {
    const t = new Table({ chaos: plan(3, { 0: { effects: [fx('d_plunder')] }, 1: { shield: 'shield' } }), rng: deckRng('Ah Ad 2c 7c 3s 4d Kh Qh') })
    expect(t.hole(1)).toEqual(parseCards('Ah 7c'))
    expect(t.hole(0)).toEqual(parseCards('Ad 3s'))
    expect(t.hole(2)).toEqual(parseCards('Kh Qh'))
    expect(t.applied('plunder').map((e) => [e.targets, e.outcome])).toEqual([[[1], 'blocked'], [[2], 'applied']])
    expect(t.state.chaos!.shieldSpent).toEqual([1])
    expect(t.state.chaos!.blocked).toContain(701)
  })

  it('a mirror only blocks it: a debuff on several seats is never turned back (spec §3)', () => {
    const t = new Table({ chaos: plan(3, { 0: { effects: [fx('d_plunder')] }, 1: { shield: 'mirror' } }), rng: deckRng('Ah Ad 2c 7c 3s 4d Kh Qh') })
    expect(t.applied('plunder').map((e) => e.outcome)).toEqual(['blocked', 'applied'])
    expect(t.hole(0)).toEqual(parseCards('Ad 3s'))
    expect(t.state.chaos!.hit).toEqual([2])
  })

  it('when the opponents within reach hold too few cards it takes them all and the rest comes from the deck', () => {
    // Seat 0 has three cards (Hên xui heads), seat 1 two: Kc 9h, then 7h from the deck; seat 1 gets 6h 5h.
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('d_plunder'), fx('s_coin_flip')] } }), rng: deckRng('Kc Qd 9h 8s 2c 7h 6h 5h', firstRng) })
    expect(t.hole(0)).toEqual(parseCards('Kc 9h 7h'))
    expect(t.hole(1)).toEqual(parseCards('6h 5h'))
    t.assertDeck()
  })

  it('fizzles on a short deck (spec §3 "thiếu lá")', () => {
    // 14 seats × 3 cards leave exactly the 10-card reserve.
    const t = new Table({ chaos: plan(14, { 0: { effects: [fx('d_plunder')] } }), rng: seededRng(3), rules: { holeCards: 3 } })
    const before = t.state.players.map((p) => p.holeCards.length)
    expect(t.applied('plunder')[0]).toMatchObject({ outcome: 'fizzled', targets: [] })
    expect(before.every((n) => n === 3)).toBe(true)
    expect(t.state.deck.length - t.state.deckIndex).toBe(10)
  })
})

describe('Lời nguyền (curse)', () => {
  it("turns a random opponent's highest card into the first 2 left in the deck, told only to holder and target", () => {
    const t = new Table({ chaos: plan(3, { 0: { effects: [fx('g_curse')] } }), rng: deckRng('Ah 8d 5c 3d 8s 7s 9c 2h') })
    // lastRng picks the last fresh opponent, seat 2 (8d 8s): an 8 becomes 2h; 9c stays the next card of the deck.
    expect(t.hole(2)).toEqual(parseCards('2h 8s'))
    expect(t.hole(1)).toEqual(parseCards('Ah 3d'))
    expect(t.state.deck[t.state.deckIndex]).toBe(parseCards('9c')[0])
    const [ev] = t.applied('curse')
    expect(ev).toMatchObject({ seat: 0, targets: [2], outcome: 'applied' })
    expect([sees(ev!, 0), sees(ev!, 2), sees(ev!, 1)]).toEqual([true, true, false])
    t.assertDeck()
  })

  it('with every 2 out, the lowest card left takes its place (Ruling 3b-4)', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('g_curse')] } }), rng: deckRng('2c 2d 2h 2s Ah 3c 9d 4h'), rules: { holeCards: 3 } })
    expect(t.hole(1)).toEqual(parseCards('2c 2h 3d'))
    t.assertDeck()
  })

  it('an immune target lets it fizzle: the card is spent, the seat not hit', () => {
    const t = new Table({
      chaos: plan(2, { 0: { effects: [fx('g_curse')] }, 1: { effects: [fx('g_flip_flop', { charge: 1 })] } }), rng: deckRng('Ah 5c 7s'),
    })
    expect(t.hole(1)).toEqual(parseCards('Ah'))
    expect(t.applied('curse')[0]).toMatchObject({ targets: [1], outcome: 'fizzled' })
    expect(t.state.chaos!.hit).toEqual([])
    expect(t.state.chaos!.applied).toContain(t.state.chaos!.plan.seats[0]!.effects[0]!.uid)
  })

  it('a mirror turns it on the holder; a shield blocks it', () => {
    const mirror = new Table({ chaos: plan(2, { 0: { effects: [fx('g_curse')] }, 1: { shield: 'mirror' } }), rng: deckRng('Ah 5c 3d 7s 9c 2h') })
    expect(mirror.hole(0)).toEqual(parseCards('5c 2h'))
    expect(mirror.hole(1)).toEqual(parseCards('Ah 3d'))
    expect(mirror.applied('curse')[0]!.outcome).toBe('reflected')
    const shield = new Table({ chaos: plan(2, { 0: { effects: [fx('g_curse')] }, 1: { shield: 'shield' } }), rng: deckRng('Ah 5c 3d 7s 9c 2h') })
    expect(shield.hole(1)).toEqual(parseCards('Ah 3d'))
    expect(shield.applied('curse')[0]!.outcome).toBe('blocked')
  })

  it('fizzles on a short deck', () => {
    const t = new Table({ chaos: plan(14, { 0: { effects: [fx('g_curse')] } }), rng: seededRng(5), rules: { holeCards: 3 } })
    expect(t.applied('curse')[0]).toMatchObject({ outcome: 'fizzled', targets: [] })
  })
})

describe('Kẻ phá đám (spoiler)', () => {
  it('switches one card of an opponent off before anything acts, naming it to holder and target only; the caller plan is untouched', () => {
    const p = plan(3, { 0: { effects: [fx('s_spoiler')] }, 1: { effects: [fx('s_coin_flip')] } })
    const t = new Table({ chaos: p, rng: deckRng('', lastRng) })
    expect(t.applied('coinFlip')).toEqual([])
    expect(t.hole(1)).toHaveLength(2)
    const [ev] = t.applied('spoiler')
    expect(ev).toMatchObject({ seat: 0, targets: [1], outcome: 'applied', off: 's_coin_flip' })
    expect([sees(ev!, 0), sees(ev!, 1), sees(ev!, 2)]).toEqual([true, true, false])
    expect(t.state.chaos!.plan.seats[1]!.effects).toEqual([])
    expect(p.seats[1]!.effects.map((e) => e.cardId)).toEqual(['s_coin_flip'])
  })

  it('never names a card pressed from the bonus hand: with nothing else to switch off it fizzles', () => {
    const t = new Table({
      chaos: plan(2, { 0: { effects: [fx('s_spoiler')] }, 1: { effects: [fx('g_peek_3', { fromBonus: true })] } }),
      rng: seededRng(2), rules: { decisionMode: 'playOrFold' },
    })
    expect(t.applied('spoiler')[0]).toMatchObject({ targets: [], outcome: 'fizzled' })
    expect(t.events.some((e) => e.type === 'CHAOS_PEEK' && e.seat === 1)).toBe(true)
  })

  it('a shield blocks it and the card acts', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('s_spoiler')] }, 1: { effects: [fx('s_coin_flip')], shield: 'shield' } }), rng: seededRng(4) })
    expect(t.applied('spoiler')[0]!.outcome).toBe('blocked')
    expect(t.applied('coinFlip')).toHaveLength(1)
  })

  it('a mirror turns it on a card of the holder: the event names that card, to holder and target only', () => {
    const t = new Table({
      chaos: plan(3, { 0: { effects: [fx('s_spoiler'), fx('s_coin_flip')] }, 1: { effects: [fx('s_coin_flip')], shield: 'mirror' } }), rng: seededRng(7),
    })
    const [ev] = t.applied('spoiler')
    expect(ev).toMatchObject({ seat: 0, targets: [1], outcome: 'reflected', off: 's_coin_flip' })
    expect([sees(ev!, 0), sees(ev!, 1), sees(ev!, 2), sees(ev!, null)]).toEqual([true, true, false, false])
    expect(t.applied('coinFlip').map((e) => e.seat)).toEqual([1])
    expect(t.state.chaos!.plan.seats[0]!.effects.map((e) => e.cardId)).toEqual(['s_spoiler'])
    expect(t.state.chaos!.blocked).toContain(701)
  })

  it('never switches off a card that already acted this hand', () => {
    // Seat 1's Kẻ phá đám acts first and is blocked by seat 2's shield; seat 2's then finds nothing that has not acted.
    const t = new Table({ chaos: plan(3, { 1: { effects: [fx('s_spoiler')] }, 2: { effects: [fx('s_spoiler')], shield: 'shield' } }), rng: seededRng(9) })
    expect(t.applied('spoiler').map((e) => [e.seat, e.targets, e.outcome])).toEqual([[1, [2], 'blocked'], [2, [], 'fizzled']])
    expect(t.state.chaos!.plan.seats[1]!.effects.map((e) => e.cardId)).toEqual(['s_spoiler'])
  })

  it('switching off a "Thế giới đảo ngược" or a "Bỏ không mất" takes back what the plan had promised', () => {
    const rev = new Table({ chaos: plan(2, { 0: { effects: [fx('s_spoiler')] }, 1: { effects: [fx('d_reverse')] } }, true), rng: seededRng(6) })
    expect(rev.state.chaos!.plan.reverse).toBe(false)
    expect(rev.applied('reverseRank')).toEqual([])
    expect(playerView(rev.state, 1).chaos!.reverse).toBe(false)
    const fold = new Table({
      chaos: plan(2, { 0: { effects: [fx('s_spoiler')] }, 1: { effects: [fx('s_free_fold')] } }), rng: seededRng(6), rules: { decisionMode: 'playOrFold' },
    })
    expect(fold.state.chaos!.freeFoldSeats).toEqual([])
  })
})

describe('Nhật thực (eclipse)', () => {
  const RULES: BlindRules = { mode: 'blind', holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1000, tableFeeRate: 0 }
  let uid = 1
  const holding = (ids: string[], extra: Partial<ChaosSeat> = {}): ChaosSeat => ({ ...EMPTY_CHAOS_SEAT, cards: ids.map((id) => toHeld(def(id), uid++)), ...extra })
  const planOf = (chaos: Record<number, ChaosSeat>, seed = 1) => planHand({
    seats: Object.entries(chaos).map(([seat, c]) => ({ seat: Number(seat), isBot: false, chaos: c })),
    rules: RULES, pool: CHAOS_CARDS_SPEC, rng: seededRng(seed), nextUid: () => 5000 + uid++,
  })

  it('switches every other seat off: nothing fires, no shield, the seat goes in exactly as it came', () => {
    const other = holding(['g_luck_3', 'd_reverse', 's_shield', 'd_aces_charge'], { armed: { card: toHeld(def('s_lower'), uid++), hand: 'next' } })
    const r = planOf({ 0: holding(['d_eclipse']), 1: other })
    expect(r.plan.seats[0]!.effects.map((e) => e.cardId)).toEqual(['d_eclipse'])
    expect(r.plan.seats[1]).toEqual({ seat: 1, effects: [], shield: null, blindfolded: false, eclipsed: true })
    expect(r.plan.reverse).toBe(false)
    expect(r.seats.get(1)).toBe(other)
  })

  it('two seats firing it: one is the eclipse, the other is switched off and keeps its card', () => {
    const r = planOf({ 0: holding(['d_eclipse']), 1: holding(['d_eclipse']) })
    const suns = r.plan.seats.filter((s) => s.effects.some((e) => e.effect === 'eclipse'))
    expect(suns).toHaveLength(1)
    const dark = r.plan.seats.find((s) => s.eclipsed)!
    expect(r.seats.get(dark.seat)!.cards.map((c) => c.cardId)).toEqual(['d_eclipse'])
  })

  it('a bonus card that fires from armed is marked fromBonus; a held one is not', () => {
    const r = planOf({ 0: holding(['g_peek_3'], { armed: { card: toHeld(def('s_hawk_eye'), uid++), hand: 'next' } }), 1: EMPTY_CHAOS_SEAT })
    expect(r.plan.seats[0]!.effects.map((e) => [e.cardId, e.fromBonus])).toEqual([['s_hawk_eye', true], ['g_peek_3', undefined]])
  })

  it('the engine tells the whole table, naming the seats it darkened', () => {
    const t = new Table({ chaos: plan(3, { 0: { effects: [fx('d_eclipse')] }, 1: { eclipsed: true }, 2: { eclipsed: true } }), rng: seededRng(1) })
    const [ev] = t.applied('eclipse')
    expect(ev).toMatchObject({ seat: 0, targets: [1, 2], outcome: 'applied' })
    expect(sees(ev!, 2)).toBe(true)
    expect(sees(ev!, null)).toBe(true)
  })

  it('afterHand: an eclipsed seat loses no hand of its cards and fires no wait card', () => {
    const chaos = holding(['g_luck_3', 's_rescue'])
    const p = { seats: [{ seat: 0, effects: [], shield: null, blindfolded: false, eclipsed: true as const }], reverse: false }
    const r = afterHand({
      rules: RULES, config: DEFAULT_CHAOS_CONFIG, pool: CHAOS_CARDS_SPEC, rng: seededRng(1), nextUid: () => 9000, plan: p,
      consumed: new Set(), carryOverOnly: false, marks: [],
      seats: [{ seat: 0, isBot: false, chaos, stackAfter: 0, net: -1000, inHand: true, outcome: 'loss' }],
    })
    expect(r.seats.get(0)!.cards).toEqual(chaos.cards)
    expect(r.credits).toEqual([])
  })
})

describe('Mắt diều hâu (hawk eye)', () => {
  const deck = 'Kd 2c Qs 3c'
  it('Bạc: one random card of a random opponent, for the holder only; kept for a reconnect', () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('s_hawk_eye')] } }), rng: deckRng(deck), rules: { decisionMode: 'playOrFold' } })
    const ev = t.events.find((e): e is Extract<GameEvent, { type: 'CHAOS_HAWK' }> => e.type === 'CHAOS_HAWK')!
    expect(ev).toEqual({ type: 'CHAOS_HAWK', seat: 0, target: 1, cards: parseCards('Qs') })
    expect(filterEvent(ev, 1)).toEqual({ ...ev, cards: [] })
    expect(filterEvent(ev, null)).toEqual({ ...ev, cards: [] })
    expect(playerView(t.state, 0).chaos!.hawk).toEqual({ seat: 1, cards: parseCards('Qs') })
    expect(playerView(t.state, 1).chaos!.hawk).toBeUndefined()
    expect(t.state.chaos!.used).toEqual([{ seat: 0, cardId: 's_hawk_eye', effect: 'hawkEye', outcome: 'applied', targets: [1] }])
  })

  it("Vàng: the opponent's whole hand", () => {
    const t = new Table({ chaos: plan(2, { 0: { effects: [fx('g_hawk_eye')] } }), rng: deckRng(deck), rules: { decisionMode: 'playOrFold' } })
    expect(t.state.chaos!.hawk).toEqual([{ seat: 0, target: 1, cards: parseCards('Kd Qs') }])
  })

  it('never fires at a "Hoàn toàn may rủi" table (✱)', () => {
    const r = planHand({
      seats: [{ seat: 0, isBot: false, chaos: { ...EMPTY_CHAOS_SEAT, cards: [toHeld(def('g_hawk_eye'), 1)] } }, { seat: 1, isBot: false, chaos: EMPTY_CHAOS_SEAT }],
      rules: { mode: 'blind', holeCards: 2, decisionMode: 'none', fixedWager: 1000, tableFeeRate: 0 }, pool: CHAOS_CARDS_SPEC, rng: seededRng(1), nextUid: () => 50,
    })
    expect(r.plan.seats[0]!.effects).toEqual([])
  })
})

describe('bonus cards pressed during the choice (BP-39 × round three)', () => {
  const withBonus = (id: string): ChaosSeat => ({ ...EMPTY_CHAOS_SEAT, bonus: [toHeld(def(id), 4242)] })
  const live = (by: Record<number, SeatPlan>) => new Table({ chaos: plan(2, by), rng: deckRng('Kd 2c Qs 3c'), rules: { decisionMode: 'playOrFold' } })

  it('a seat Nhật thực switched off arms for the next hand, and addRevealEffect refuses it', () => {
    const t = live({ 0: { effects: [fx('d_eclipse')] }, 1: { eclipsed: true } })
    const dark = t.state.chaos!.plan.seats[1]!
    expect(canInsertThisHand(dark, 'stealHole')).toBe(false)
    const r = armBonus(withBonus('s_steal_one'), 4242, { phase: 'decision', frozen: false, planSeat: dark })
    expect(r).toMatchObject({ armed: { hand: 'next' } })
    expect(() => addRevealEffect(t.state, 1, fx('s_steal_one'))).toThrow()
    // The eclipse holder itself still plays a card into this hand.
    expect(armBonus(withBonus('s_steal_one'), 4242, { phase: 'decision', frozen: false, planSeat: t.state.chaos!.plan.seats[0]! })).toMatchObject({ armed: { hand: 'this' } })
  })

  it('the round-three one-shot reveal cards may join this hand (controller Ruling 12); a fired deal-time debuff still sends them to the next', () => {
    for (const kind of ['redealHole', 'neighbourSwap', 'shuffleHoles', 'swapLeader', 'deluge', 'fateDie', 'duel'] as const) {
      expect(canInsertThisHand(undefined, kind), kind).toBe(true)
      expect(canInsertThisHand({ effects: [fx('d_plunder')] }, kind), kind).toBe(false)
    }
  })

  it('Xúc xắc định mệnh pressed during the choice fires at this hand\'s reveal', () => {
    const t = live({})
    const r = armBonus(withBonus('g_fate_die'), 4242, { phase: 'decision', frozen: false, planSeat: t.state.chaos!.plan.seats[0]! })
    expect(r).toMatchObject({ armed: { hand: 'this' } })
    addRevealEffect(t.state, 0, { ...fx('g_fate_die'), uid: 4242 })
    t.apply({ type: 'ACTION', seat: 0, action: { kind: 'play' } })
    t.apply({ type: 'ACTION', seat: 1, action: { kind: 'play' } })
    t.advanceAll()
    const [ev] = t.applied('fateDie')
    expect(ev).toMatchObject({ seat: 0, outcome: 'applied' })
    expect(ev!.dice).toHaveLength(1)
    expect(t.state.chaos!.applied).toContain(4242)
  })
})

describe('Mồi lửa and Tích tiểu thành đại', () => {
  const RULES: BlindRules = { mode: 'blind', holeCards: 2, decisionMode: 'none', fixedWager: 1000, tableFeeRate: 0 }
  const settle = (effects: PlannedEffect[], seats: AfterHandSeat[]) => afterHand({
    rules: RULES, config: { ...DEFAULT_CHAOS_CONFIG, pointsThreshold: 1000 }, pool: CHAOS_CARDS_SPEC, rng: seededRng(1), nextUid: () => 9000,
    plan: { seats: seats.map((s) => ({ seat: s.seat, effects: s.seat === 0 ? effects : [], shield: null, blindfolded: false })), reverse: false },
    consumed: new Set(), carryOverOnly: false, marks: [], seats,
  })
  const seat = (n: number, outcome: AfterHandSeat['outcome'], streak: ChaosSeat['streak'] = null): AfterHandSeat => ({
    seat: n, isBot: false, chaos: { ...EMPTY_CHAOS_SEAT, streak }, stackAfter: 5000, net: 0, inHand: true, outcome,
  })

  it('Mồi lửa gives every seat in the hand its point, outside the streak doubling', () => {
    const r = settle([fx('s_kindling')], [seat(0, 'loss'), seat(1, 'win', { kind: 'win', len: 2 }), seat(2, 'none')])
    expect([0, 1, 2].map((s) => r.seats.get(s)!.points)).toEqual([3, 3, 1])
  })

  it('Tích tiểu thành đại gives its holder a point on a lost hand only', () => {
    expect(settle([fx('s_loss_points')], [seat(0, 'loss'), seat(1, 'loss')]).seats.get(0)!.points).toBe(3)
    expect(settle([fx('s_loss_points')], [seat(0, 'win'), seat(1, 'loss')]).seats.get(0)!.points).toBe(1)
    expect(settle([fx('s_loss_points')], [seat(0, 'loss'), seat(1, 'loss')]).seats.get(1)!.points).toBe(2)
  })
})
