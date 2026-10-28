import { describe, expect, it } from 'vitest'
import { seededRng, type Rng } from '../cards/rng.js'
import type { BlindRules } from '../hand/types.js'
import { CHAOS_CARDS_SPEC } from './fixtures.js'
import { receiveCard, toHeld } from './hold.js'
import { afterHand, type AfterHandSeat } from './settle.js'
import {
  DEFAULT_CHAOS_CONFIG, EMPTY_CHAOS_SEAT, EMPTY_CHAOS_TABLE, type ChaosCardDef, type ChaosHandPlan, type ChaosSeat, type ChaosTableState, type PlannedEffect,
} from './types.js'

const card = (id: string): ChaosCardDef => {
  const c = CHAOS_CARDS_SPEC.find((x) => x.id === id)
  if (!c) throw new Error(`no card ${id}`)
  return c
}
const pool = CHAOS_CARDS_SPEC
const WAGER = 1_000
const RULES: BlindRules = { mode: 'blind', holeCards: 2, decisionMode: 'playOrFold', fixedWager: WAGER, tableFeeRate: 0 }
/** An Rng that always answers `v` (clamped), to force a Bạo kích roll. */
const fixed = (v: number): Rng => ({ int: (max) => Math.min(v, max - 1) })

let uid = 1
function holding(ids: string[], extra: Partial<ChaosSeat> = {}): ChaosSeat {
  const rng = seededRng(1)
  const next = () => uid++
  const seat = ids.reduce((s, id) => receiveCard(s, card(id), next, pool, 'playOrFold', rng).seat, EMPTY_CHAOS_SEAT)
  return { ...seat, ...extra }
}
const fired = (held: ChaosSeat, cardId: string): PlannedEffect => {
  const c = held.cards.find((x) => x.cardId === cardId)!
  return { uid: c.uid, cardId: c.cardId, effect: c.effect, params: c.params, timing: c.timing, debuff: c.debuff, targets: [] }
}
const planOf = (effects: Record<number, PlannedEffect[]> = {}): ChaosHandPlan => ({
  seats: Object.entries(effects).map(([seat, e]) => ({ seat: Number(seat), effects: e, shield: null, blindfolded: false })),
  reverse: false,
})
const seat = (chaos: ChaosSeat, s: Partial<AfterHandSeat> = {}): AfterHandSeat => ({
  seat: 0, isBot: false, chaos, stackAfter: 10_000, net: 0, inHand: true, outcome: 'none', ...s,
})

type Input = Parameters<typeof afterHand>[0]
function settle(seats: AfterHandSeat[], over: Partial<Input> = {}) {
  let n = 5_000
  return afterHand({
    rules: RULES, config: DEFAULT_CHAOS_CONFIG, pool, rng: seededRng(3), nextUid: () => n++, plan: planOf(),
    consumed: new Set(), carryOverOnly: false, marks: [], seats, ...over,
  })
}
/** Plays `outcomes` one after another for seat 0 and returns its chaos seat after each hand. */
function run(start: ChaosSeat, outcomes: ('win' | 'loss' | 'none')[]): ChaosSeat[] {
  const out: ChaosSeat[] = []
  let chaos = start
  for (const outcome of outcomes) {
    chaos = settle([seat(chaos, { outcome })], { config: { ...DEFAULT_CHAOS_CONFIG, pointsThreshold: 1_000 } }).seats.get(0)!
    out.push(chaos)
  }
  return out
}

describe('afterHand — chaos points and streaks', () => {
  it('a carry-over hand counts for nobody', () => {
    const start = { ...EMPTY_CHAOS_SEAT, points: 5, streak: { kind: 'loss' as const, len: 2 } }
    const r = settle([seat(start, { outcome: 'loss' }), seat(start, { seat: 1, outcome: 'win', net: 500 })], { carryOverOnly: true })
    expect(r.seats.get(0)).toMatchObject({ points: 5, streak: { kind: 'loss', len: 2 } })
    expect(r.seats.get(1)).toMatchObject({ points: 5, streak: { kind: 'loss', len: 2 } })
    expect(r.credits).toEqual([])
    expect(r.awarded).toEqual([])
  })

  it('a win is worth 1, a loss 2, doubled from the 3rd hand of a streak; a hand that counts nothing keeps the streak', () => {
    expect(run(EMPTY_CHAOS_SEAT, ['loss', 'loss', 'loss', 'loss']).map((s) => s.points)).toEqual([2, 4, 8, 12])
    const wins = run(EMPTY_CHAOS_SEAT, ['win', 'win', 'none', 'win', 'loss'])
    expect(wins.map((s) => s.points)).toEqual([1, 2, 2, 4, 6])
    expect(wins.map((s) => s.streak)).toEqual([
      { kind: 'win', len: 1 }, { kind: 'win', len: 2 }, { kind: 'win', len: 2 }, { kind: 'win', len: 3 }, { kind: 'loss', len: 1 },
    ])
  })

  it('"Cày điểm" doubles the points of a hand it fired in', () => {
    const chaos = holding(['g_farm'])
    const r = settle([seat(chaos, { outcome: 'loss' })], { plan: planOf({ 0: [fired(chaos, 'g_farm')] }) })
    expect(r.seats.get(0)).toMatchObject({ points: 4, farmHandsLeft: 4 })
  })

  it('10 points award a card and keep the remainder', () => {
    // A bot's bonus card acts at once, as every bonus card did before BP-39; a human's path is below.
    const r = settle([seat({ ...EMPTY_CHAOS_SEAT, points: 9 }, { outcome: 'loss', isBot: true })])
    expect(r.seats.get(0)!.points).toBe(1)
    expect(r.awarded).toHaveLength(1)
    expect(r.awarded[0]!.seat).toBe(0)
    expect(r.awarded[0]!.cards.length).toBeGreaterThanOrEqual(1)
    expect(r.awarded[0]!.cards[0]!.enabled).toBe(true)
  })

  it('a seat frozen this hand gets its bonus card at the end of its next unfrozen hand', () => {
    const frozen = settle([seat({ ...EMPTY_CHAOS_SEAT, points: 9, frozenNextHand: true }, { outcome: 'loss' })])
    expect(frozen.awarded).toEqual([])
    expect(frozen.seats.get(0)).toMatchObject({ points: 1, pendingBonus: 1, frozenNextHand: false })
    const next = settle([seat(frozen.seats.get(0)!, { outcome: 'none' })])
    expect(next.awarded).toHaveLength(1)
    expect(next.seats.get(0)!.pendingBonus).toBe(0)
  })

  it('bonus cards follow the weights', () => {
    const onlyShield = new Map(CHAOS_CARDS_SPEC.filter((c) => c.id !== 's_shield').map((c) => [c.id, 0]))
    const config = { ...DEFAULT_CHAOS_CONFIG, tierWeights: { silver: 1, gold: 0, diamond: 0 } }
    const r = settle([seat({ ...EMPTY_CHAOS_SEAT, points: 9 }, { outcome: 'loss' })], { weights: onlyShield, config })
    expect(r.awarded[0]!.cards.map((c) => c.id)).toEqual(['s_shield'])
    expect(r.seats.get(0)!.cards.map((c) => c.cardId)).toEqual(['s_shield'])
  })
})

describe('afterHand — the bonus hand (BP-39)', () => {
  const only = (id: string) => new Map(CHAOS_CARDS_SPEC.filter((c) => c.id !== id).map((c) => [c.id, 0]))
  const SILVER = { ...DEFAULT_CHAOS_CONFIG, tierWeights: { silver: 1, gold: 0, diamond: 0 } }
  const bonusOf = (ids: string[]) => ids.map((id) => toHeld(card(id), uid++))

  it("a human's bonus card goes to the bonus hand while it holds fewer than 3", () => {
    const start = { ...EMPTY_CHAOS_SEAT, points: 9, bonus: bonusOf(['s_lower', 'g_borrow']) }
    const r = settle([seat(start, { outcome: 'loss' })], { weights: only('s_steal_one'), config: SILVER })
    const after = r.seats.get(0)!
    expect(after.points).toBe(1)
    expect(after.bonus.map((c) => c.cardId)).toEqual(['s_lower', 'g_borrow', 's_steal_one'])
    expect(after.cards).toEqual([])
    expect(r.bonusAwarded).toEqual([{ seat: 0, cards: [card('s_steal_one')] }])
    expect(r.awarded).toEqual([])
  })

  it('a full bonus hand keeps the points, the armed card counting toward the 3', () => {
    const full = { ...EMPTY_CHAOS_SEAT, points: 9, bonus: bonusOf(['s_lower', 'g_borrow', 's_steal_one']) }
    const r = settle([seat(full, { outcome: 'loss' })], { weights: only('s_steal_one'), config: SILVER })
    expect(r.seats.get(0)).toMatchObject({ points: 11, bonus: full.bonus })
    expect(r.bonusAwarded).toEqual([])

    const [armedCard, ...rest] = bonusOf(['s_lower', 'g_borrow', 's_steal_one'])
    const withArmed = { ...EMPTY_CHAOS_SEAT, points: 9, bonus: rest, armed: { card: armedCard!, hand: 'next' as const } }
    const r2 = settle([seat(withArmed, { outcome: 'loss' })], { weights: only('s_steal_one'), config: SILVER })
    expect(r2.seats.get(0)).toMatchObject({ points: 11, bonus: rest, armed: withArmed.armed })
  })

  it('fills the hand to 3 and keeps the rest of the points', () => {
    const r = settle([seat({ ...EMPTY_CHAOS_SEAT, points: 38 }, { outcome: 'loss' })], { weights: only('s_steal_one'), config: SILVER })
    expect(r.seats.get(0)!.bonus.map((c) => c.cardId)).toEqual(['s_steal_one', 's_steal_one', 's_steal_one'])
    expect(r.seats.get(0)!.points).toBe(10)
  })

  it('a drawn card that needs no press goes to the held cards as today', () => {
    const r = settle([seat({ ...EMPTY_CHAOS_SEAT, points: 9 }, { outcome: 'loss' })], { weights: only('s_rescue'), config: SILVER })
    expect(r.seats.get(0)!.cards.map((c) => c.cardId)).toEqual(['s_rescue'])
    expect(r.seats.get(0)!.bonus).toEqual([])
    expect(r.awarded).toEqual([{ seat: 0, cards: [card('s_rescue')] }])
    expect(r.bonusAwarded).toEqual([])
  })

  it('a low threshold cannot loop on Tích lũy: only the points the hand ended with convert', () => {
    const config = { ...SILVER, pointsThreshold: 1 }
    const r = settle([seat({ ...EMPTY_CHAOS_SEAT, points: 3 }, { outcome: 'loss' })], { weights: only('s_charge'), config })
    // 5 points → 5 Tích lũy, +3 each, waiting for the next hand
    expect(r.awarded[0]!.cards.map((c) => c.id)).toEqual(Array<string>(5).fill('s_charge'))
    expect(r.seats.get(0)!.points).toBe(15)
  })

  it("a bot's bonus card acts at once", () => {
    const r = settle([seat({ ...EMPTY_CHAOS_SEAT, points: 9 }, { outcome: 'loss', isBot: true })], { weights: only('s_steal_one'), config: SILVER })
    expect(r.seats.get(0)!.cards.map((c) => c.cardId)).toEqual(['s_steal_one'])
    expect(r.seats.get(0)!.bonus).toEqual([])
    expect(r.awarded).toEqual([{ seat: 0, cards: [card('s_steal_one')] }])
    expect(r.bonusAwarded).toEqual([])
  })

  it("a frozen human's bonus cards wait in pendingBonus and act as today", () => {
    const frozen = settle([seat({ ...EMPTY_CHAOS_SEAT, points: 9, frozenNextHand: true }, { outcome: 'loss' })], { weights: only('s_steal_one'), config: SILVER })
    expect(frozen.seats.get(0)).toMatchObject({ points: 1, pendingBonus: 1, bonus: [] })
    const next = settle([seat(frozen.seats.get(0)!, { outcome: 'none' })], { weights: only('s_steal_one'), config: SILVER })
    expect(next.awarded).toEqual([{ seat: 0, cards: [card('s_steal_one')] }])
    expect(next.seats.get(0)!.cards.map((c) => c.cardId)).toEqual(['s_steal_one'])
  })

  it('a card played for this hand leaves when used, else goes back to the bonus hand at its old place', () => {
    const [lower, steal, borrow] = bonusOf(['s_lower', 's_steal_one', 'g_borrow'])
    const start = { ...EMPTY_CHAOS_SEAT, bonus: [lower!, borrow!], armed: { card: steal!, hand: 'this' as const } }
    const back = settle([seat(start)]).seats.get(0)!
    expect(back.armed).toBeNull()
    expect(back.bonus).toEqual([lower, steal, borrow])
    const used = settle([seat(start)], { consumed: new Set([steal!.uid]) }).seats.get(0)!
    expect(used.armed).toBeNull()
    expect(used.bonus).toEqual([lower, borrow])
  })

  it('a card played for this hand that fizzled where the table saw it is spent, never back in the private hand (I1)', () => {
    const [lower, storm] = bonusOf(['s_lower', 'd_storm'])
    const start = { ...EMPTY_CHAOS_SEAT, bonus: [lower!], armed: { card: storm!, hand: 'this' as const }, bonusPlayedThisHand: true }
    // an armed storm on a short deck: CHAOS_APPLIED "fizzled", nothing consumed, but recorded
    const r = settle([seat(start, { outcome: 'win' })], { recorded: new Set([storm!.uid]) }).seats.get(0)!
    expect(r).toMatchObject({ armed: null, bonus: [lower], bonusPlayedThisHand: false })
  })

  it('a decision card played for this hand is spent with its hand, used or not, once it entered the plan (Ruling 5)', () => {
    const [freeFold] = bonusOf(['s_free_fold'])
    const ff = freeFold!
    const start = { ...EMPTY_CHAOS_SEAT, armed: { card: ff, hand: 'this' as const }, bonusPlayedThisHand: true }
    const inPlan: PlannedEffect = { uid: ff.uid, cardId: ff.cardId, effect: ff.effect, params: ff.params, timing: ff.timing, debuff: false, targets: [] }
    // the owner played, so Bỏ không mất did nothing: not consumed, but in the plan
    const played = settle([seat(start, { outcome: 'loss' })], { plan: planOf({ 0: [inPlan] }) }).seats.get(0)!
    expect(played).toMatchObject({ armed: null, bonus: [], bonusPlayedThisHand: false })
    // a card that never entered the plan (a mode the table excludes) goes back
    const excluded = settle([seat({ ...start, bonusPlayedThisHand: false }, { outcome: 'loss' })]).seats.get(0)!
    expect(excluded).toMatchObject({ armed: null, bonus: [ff] })
  })

  it('a draw that finds no card costs a human nothing', () => {
    const none = new Map(CHAOS_CARDS_SPEC.map((c) => [c.id, 0]))
    const r = settle([seat({ ...EMPTY_CHAOS_SEAT, points: 9 }, { outcome: 'loss' })], { weights: none })
    expect(r.seats.get(0)).toMatchObject({ points: 11, bonus: [], cards: [] })
    expect(r.bonusAwarded).toEqual([])
  })

  it('clears the played-this-hand marker', () => {
    const r = settle([seat({ ...EMPTY_CHAOS_SEAT, bonusPlayedThisHand: true })])
    expect(r.seats.get(0)!.bonusPlayedThisHand).toBe(false)
  })

  it('a card played for the next hand stays armed', () => {
    const [steal] = bonusOf(['s_steal_one'])
    const start = { ...EMPTY_CHAOS_SEAT, armed: { card: steal!, hand: 'next' as const } }
    expect(settle([seat(start)]).seats.get(0)!.armed).toEqual({ card: steal, hand: 'next' })
  })

  it('a held Bạo kích pays in a hand where a played card joined the plan', () => {
    const chaos = holding(['g_crit'])
    const [steal] = bonusOf(['s_steal_one'])
    const inserted: PlannedEffect = { uid: steal!.uid, cardId: steal!.cardId, effect: steal!.effect, params: steal!.params, timing: steal!.timing, debuff: true, targets: [] }
    const start = { ...chaos, armed: { card: steal!, hand: 'this' as const } }
    const r = settle([seat(start, { outcome: 'win', net: 700 })], {
      rng: fixed(0), plan: planOf({ 0: [fired(chaos, 'g_crit'), inserted] }), consumed: new Set([steal!.uid]),
    })
    expect(r.credits).toMatchObject([{ reason: 'chaos_crit', amount: 1_400, multiplier: 3 }])
    expect(r.seats.get(0)!.armed).toBeNull()
    expect(r.seats.get(0)!.bonus).toEqual([])
  })
})

describe('afterHand — cards in hand', () => {
  it('durations count down and a spent card leaves; consumed one-shots are removed, the rest wait', () => {
    const chaos = holding(['g_luck_3', 's_luck_1', 's_steal_one', 's_lower', 'g_shield_3', 's_shield'])
    const consumed = new Set([chaos.cards.find((c) => c.cardId === 's_steal_one')!.uid, chaos.cards.find((c) => c.cardId === 's_shield')!.uid])
    const r = settle([seat(chaos)], { consumed })
    expect(r.seats.get(0)!.cards.map((c) => [c.cardId, c.handsLeft])).toEqual([['g_luck_3', 2], ['s_lower', null], ['g_shield_3', 2]])
  })

  it('a frozen seat keeps its durations for later', () => {
    const chaos = holding(['g_luck_3'], { frozenNextHand: true })
    expect(settle([seat(chaos)]).seats.get(0)!.cards[0]!.handsLeft).toBe(3)
  })

  it('a seat that sat the hand out keeps everything', () => {
    const chaos = holding(['g_luck_3', 's_rescue'], { points: 9, frozenNextHand: true })
    const r = settle([seat(chaos, { inHand: false, outcome: 'loss', stackAfter: 0 })])
    expect(r.seats.get(0)).toEqual(chaos)
    expect(r.credits).toEqual([])
  })

  it("sets next hand's freeze and blindfold from the engine's marks only", () => {
    const r = settle(
      [seat(holding([], { frozenNextHand: true, blindfoldedNextHand: true })), seat(EMPTY_CHAOS_SEAT, { seat: 1 }), seat(EMPTY_CHAOS_SEAT, { seat: 2 })],
      { marks: [{ seat: 1, kind: 'freeze' }, { seat: 2, kind: 'blindfold' }] },
    )
    expect(r.seats.get(0)).toMatchObject({ frozenNextHand: false, blindfoldedNextHand: false })
    expect(r.seats.get(1)).toMatchObject({ frozenNextHand: true, blindfoldedNextHand: false })
    expect(r.seats.get(2)).toMatchObject({ frozenNextHand: false, blindfoldedNextHand: true })
  })

  it('never changes its input', () => {
    const chaos = holding(['g_luck_3', 'g_rescue'], { points: 9 })
    const snapshot = JSON.stringify(chaos)
    settle([seat(chaos, { outcome: 'loss', stackAfter: 0 })])
    expect(JSON.stringify(chaos)).toBe(snapshot)
  })
})

describe('afterHand — Cấp cứu', () => {
  it('fires after a lost hand that leaves the stack under 2 wagers, paying 5/10/20 × wager by tier', () => {
    for (const [id, multiplier] of [['s_rescue', 5], ['g_rescue', 10], ['d_rescue', 20]] as const) {
      const chaos = holding([id, 'g_luck_3'])
      const r = settle([seat(chaos, { outcome: 'loss', stackAfter: 2 * WAGER - 1, net: -WAGER })])
      const held = chaos.cards[0]!
      expect(r.credits).toEqual([{ seat: 0, amount: multiplier * WAGER, reason: 'chaos_rescue', cardId: id, uid: held.uid }])
      expect(r.seats.get(0)!.cards.map((c) => c.cardId)).toEqual(['g_luck_3'])
    }
  })

  it('waits after a win, a hand that counts nothing, a stack of 2 wagers or more, and a frozen hand', () => {
    const cases: [Partial<AfterHandSeat>, Partial<ChaosSeat>][] = [
      [{ outcome: 'win', stackAfter: 0 }, {}],
      [{ outcome: 'none', stackAfter: 0 }, {}],
      [{ outcome: 'loss', stackAfter: 2 * WAGER }, {}],
      [{ outcome: 'loss', stackAfter: 0 }, { frozenNextHand: true }],
    ]
    for (const [s, extra] of cases) {
      const chaos = holding(['g_rescue'], extra)
      const r = settle([seat(chaos, s)])
      expect(r.credits).toEqual([])
      expect(r.seats.get(0)!.cards.map((c) => c.cardId)).toEqual(['g_rescue'])
    }
  })

  it('fires one rescue card per hand, the oldest', () => {
    const chaos = holding(['d_rescue', 's_rescue'])
    const r = settle([seat(chaos, { outcome: 'loss', stackAfter: 0 })])
    expect(r.credits.map((c) => c.cardId)).toEqual(['d_rescue'])
    expect(r.seats.get(0)!.cards.map((c) => c.cardId)).toEqual(['s_rescue'])
  })
})

describe('afterHand — Bạo kích', () => {
  const crit = (rng: Rng, s: Partial<AfterHandSeat>) => {
    const chaos = holding(['g_crit'])
    return { chaos, r: settle([seat(chaos, s)], { rng, plan: planOf({ 0: [fired(chaos, 'g_crit')] }) }) }
  }

  it('pays (k − 1) × net only on a win: 10 % ×3, 25 % ×2 for Gold', () => {
    const triple = crit(fixed(9), { outcome: 'win', net: 700 })
    expect(triple.r.credits).toEqual([{ seat: 0, amount: 1_400, reason: 'chaos_crit', cardId: 'g_crit', uid: triple.chaos.cards[0]!.uid, multiplier: 3 }])
    expect(crit(fixed(10), { outcome: 'win', net: 700 }).r.credits).toMatchObject([{ amount: 700, multiplier: 2 }])
    expect(crit(fixed(34), { outcome: 'win', net: 700 }).r.credits).toMatchObject([{ amount: 700, multiplier: 2 }])
    expect(crit(fixed(35), { outcome: 'win', net: 700 }).r.credits).toEqual([])
    expect(crit(fixed(0), { outcome: 'loss', net: -1_000 }).r.credits).toEqual([])
    expect(crit(fixed(0), { outcome: 'win', net: 0 }).r.credits).toEqual([])
  })

  it('stays on the seat for its remaining hands', () => {
    expect(crit(fixed(0), { outcome: 'win', net: 700 }).r.seats.get(0)!.cards.map((c) => [c.cardId, c.handsLeft])).toEqual([['g_crit', 2]])
  })

  it('hits about 25 % + 10 % of wins with a seeded rng', () => {
    const rng = seededRng(11)
    const counts = { 2: 0, 3: 0, 4: 0, 5: 0 }
    for (let i = 0; i < 4_000; i++) {
      for (const c of crit(rng, { outcome: 'win', net: 100 }).r.credits) counts[c.multiplier!]++
    }
    expect(Math.abs(counts[2] - 1_000)).toBeLessThan(120)
    expect(Math.abs(counts[3] - 400)).toBeLessThan(80)
  })
})

describe('afterHand — Thần tài', () => {
  const lossStreak = (len: number) => ({ streak: { kind: 'loss' as const, len } })

  it('Gold pays 8 × wager and 1 Gold card for a 4-loss streak ended by a win', () => {
    const chaos = holding(['g_fortune'], lossStreak(4))
    const r = settle([seat(chaos, { outcome: 'win', net: 300 })])
    expect(r.credits).toEqual([{ seat: 0, amount: 8 * WAGER, reason: 'chaos_fortune', cardId: 'g_fortune', uid: chaos.cards[0]!.uid }])
    expect(r.awarded).toHaveLength(1)
    expect(r.awarded[0]!.cards[0]!.tier).toBe('gold')
    const left = r.seats.get(0)!.cards.map((c) => c.cardId)
    expect(left).not.toContain('g_fortune')
    expect(r.seats.get(0)!.streak).toEqual({ kind: 'win', len: 1 })
  })

  it('pays per the spec table by tier and streak length', () => {
    const table: [string, number, number, number, string | null][] = [
      ['s_fortune', 2, 2, 0, null], ['s_fortune', 5, 4, 1, 'silver'], ['s_fortune', 6, 6, 1, 'gold'],
      ['g_fortune', 3, 4, 0, null], ['g_fortune', 9, 12, 2, 'gold'],
      ['d_fortune', 2, 8, 1, 'silver'], ['d_fortune', 4, 15, 1, 'diamond'], ['d_fortune', 6, 20, 2, 'diamond'],
    ]
    for (const [id, len, mult, cards, tier] of table) {
      const r = settle([seat(holding([id], lossStreak(len)), { outcome: 'win', net: 100 })])
      expect(r.credits.map((c) => c.amount), `${id} ${len}`).toEqual([mult * WAGER])
      // a prize card that is itself a Cấp độ shows up with what it turned into, so count at least `cards` of the tier
      const got = r.awarded.flatMap((a) => a.cards)
      expect(got.filter((c) => c.tier === tier).length, `${id} ${len}`).toBeGreaterThanOrEqual(cards)
      if (cards === 0) expect(got).toEqual([])
    }
  })

  it('waits after a win that ends a streak shorter than 2, after a loss, and through a frozen hand', () => {
    const cases: [Partial<ChaosSeat>, AfterHandSeat['outcome']][] = [
      [lossStreak(1), 'win'], [{ streak: { kind: 'win', len: 4 } }, 'win'], [lossStreak(5), 'loss'],
      [{ ...lossStreak(5), frozenNextHand: true }, 'win'],
    ]
    for (const [extra, outcome] of cases) {
      const r = settle([seat(holding(['g_fortune'], extra), { outcome, net: outcome === 'win' ? 100 : -100 })])
      expect(r.credits).toEqual([])
      expect(r.seats.get(0)!.cards.map((c) => c.cardId)).toEqual(['g_fortune'])
    }
  })
})

describe('afterHand — BP-41 plumbing', () => {
  it('takes the table state and the outcomes in and gives the table back (A3), with no debits yet', () => {
    const plain = settle([seat(EMPTY_CHAOS_SEAT, { outcome: 'win', net: 100 })])
    expect(plain.table).toEqual(EMPTY_CHAOS_TABLE)
    expect(plain.debits).toEqual([])
    const table: ChaosTableState = { god: null, demigods: [{ seat: 0, playerId: 'p0', isBot: false, handsLeft: 4, cardId: 'd_carp', uid: 9, params: {} }], bombs: [] }
    const r = settle([seat(EMPTY_CHAOS_SEAT, { outcome: 'win', net: 100 })], { table, outcomes: { dethroned: [0] } })
    // Task 6: the reign counts the hand down; no Thần acted, so the dethrone outcome gives nothing.
    expect(r.table).toEqual({ ...table, demigods: [{ ...table.demigods[0]!, handsLeft: 3 }] })
    // Nothing else moves: the same seat as without them.
    expect(r.seats.get(0)).toEqual(plain.seats.get(0))
  })
})

describe('afterHand — BP-41 charge cards', () => {
  const big = { config: { ...DEFAULT_CHAOS_CONFIG, pointsThreshold: 1_000 } }
  it('Siêu cộng dồn leaves once it dealt its Aces; otherwise it keeps its charge and loses a hand', () => {
    const held = holding(['d_aces_charge'])
    const charged = { ...held, cards: [{ ...held.cards[0]!, charge: 40 }] }
    const effects = { 0: [{ ...fired(charged, 'd_aces_charge'), charge: 40 }] }
    const kept = settle([seat(charged, { outcome: 'loss' })], { ...big, plan: planOf(effects) })
    expect(kept.seats.get(0)!.cards).toEqual([{ ...charged.cards[0]!, handsLeft: 19 }])
    const spent = settle([seat(charged, { outcome: 'win', net: 100 })], { ...big, plan: planOf(effects), outcomes: { acesDealt: [0] } })
    expect(spent.seats.get(0)!.cards).toEqual([])
  })
  it('Đảo bài moves its phase on by one for each hand it fired, and not in a hand it did not', () => {
    const held = holding(['g_flip_flop'])
    const once = settle([seat(held, { outcome: 'loss' })], { ...big, plan: planOf({ 0: [fired(held, 'g_flip_flop')] }) }).seats.get(0)!
    expect(once.cards[0]).toMatchObject({ charge: 1, handsLeft: 3 })
    const twice = settle([seat(once, { outcome: 'win', net: 10 })], { ...big, plan: planOf({ 0: [fired(once, 'g_flip_flop')] }) }).seats.get(0)!
    expect(twice.cards[0]).toMatchObject({ charge: 2, handsLeft: 2 })
    const out = settle([seat(once, { inHand: false })], big).seats.get(0)!
    expect(out.cards[0]).toMatchObject({ charge: 1, handsLeft: 3 })
  })
  it('Liều ăn nhiều lasts until a win: a loss keeps it, a win ends it', () => {
    const held = holding(['d_risky_hand'])
    const p = { ...big, plan: planOf({ 0: [fired(held, 'd_risky_hand')] }) }
    expect(settle([seat(held, { outcome: 'loss' })], p).seats.get(0)!.cards[0]).toMatchObject({ cardId: 'd_risky_hand', handsLeft: 9 })
    expect(settle([seat(held, { outcome: 'win', net: 500 })], p).seats.get(0)!.cards).toEqual([])
  })
})
