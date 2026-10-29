import { describe, expect, it } from 'vitest'
import { seededRng, type Rng } from '../cards/rng.js'
import { applyBlindCommand, blindLegalActions, createBlindHand } from '../hand/blind.js'
import type { BlindRules } from '../hand/types.js'
import { rollFortuneDice } from './dice.js'
import { CHAOS_CARDS_SPEC } from './fixtures.js'
import { draftTierFor, liftTier, receiveCard, toHeld } from './hold.js'
import { planHand } from './plan.js'
import { afterHand, type AfterHandSeat } from './settle.js'
import { standingShield, stealPoints } from './steal.js'
import {
  DEFAULT_CHAOS_CONFIG, EMPTY_CHAOS_SEAT, EMPTY_CHAOS_TABLE,
  type ChaosCardDef, type ChaosHandPlan, type ChaosSeat, type ChaosTableState, type ChaosTier, type HeldCard, type PlannedEffect,
} from './types.js'

/**
 * BP-41 Task 5c: what `afterHand` pays for the round-three money cards — Xúc xắc vận may (three tiers, the triples, the
 * sink and the jackpots), the crits ×3/×4/×5 of Liều ăn nhiều and Xúc xắc định mệnh's ×2 (the highest one only, Ruling
 * 6), Mạo hiểm gia's jackpot — plus Nâng tầm uy lực and Trộm điểm, and a 500-hand run with every money card keeping
 * every point. The cards ship disabled in data, so the tests hold them directly or draw from an enabled copy.
 */

const WAGER = 1_000
const def = (id: string): ChaosCardDef => {
  const d = CHAOS_CARDS_SPEC.find((c) => c.id === id)
  if (!d) throw new Error(`no card ${id}`)
  return d
}
/** The catalogue with every card on, or only `ids` on. */
const ENABLED = CHAOS_CARDS_SPEC.map((c) => ({ ...c, enabled: true }))
const only = (...ids: string[]): ChaosCardDef[] => ids.map((id) => ({ ...def(id), enabled: true }))

let uid = 1
const held = (...ids: string[]): HeldCard[] => ids.map((id) => toHeld(def(id), uid++))
const seatWith = (cards: HeldCard[], extra: Partial<ChaosSeat> = {}): ChaosSeat => ({ ...EMPTY_CHAOS_SEAT, cards, ...extra })
const fx = (c: HeldCard, extra: Partial<PlannedEffect> = {}): PlannedEffect => ({
  uid: c.uid, cardId: c.cardId, effect: c.effect, params: c.params, timing: c.timing, debuff: c.debuff, targets: [], ...extra,
})
const planOf = (effects: Record<number, PlannedEffect[]> = {}, extra: Partial<ChaosHandPlan['seats'][number]> = {}): ChaosHandPlan => ({
  seats: Object.entries(effects).map(([seat, e]) => ({ seat: Number(seat), effects: e, shield: null, blindfolded: false, ...extra })),
  reverse: false,
})
const at = (chaos: ChaosSeat, s: Partial<AfterHandSeat> = {}): AfterHandSeat => ({
  seat: 0, isBot: false, chaos, stackAfter: 10_000, net: 0, inHand: true, outcome: 'loss', ...s,
})
/** Answers `vals` in order (each must fit), then 0. */
function script(...vals: number[]): Rng {
  return {
    int: (n) => {
      const v = vals.length > 0 ? vals.shift()! : 0
      if (v >= n) throw new Error(`scripted ${v} does not fit ${n}`)
      return v
    },
  }
}
const fixed = (v: number): Rng => ({ int: (max) => Math.min(v, max - 1) })
/** Dice faces as the rng answers that roll them. */
const faces = (...f: number[]): Rng => script(...f.map((x) => x - 1))

const RULES: BlindRules = { mode: 'blind', holeCards: 2, decisionMode: 'none', fixedWager: WAGER, tableFeeRate: 0 }
const BIG = { ...DEFAULT_CHAOS_CONFIG, pointsThreshold: 1_000 }
type Input = Parameters<typeof afterHand>[0]
function settle(seats: AfterHandSeat[], over: Partial<Input> = {}) {
  let n = 9_000
  return afterHand({
    rules: RULES, config: BIG, pool: ENABLED, rng: script(), nextUid: () => n++, plan: planOf(),
    consumed: new Set(), carryOverOnly: false, marks: [], seats, ...over,
  })
}

describe('rollFortuneDice: the dice tables of spec §5', () => {
  const roll = (id: string, ...f: number[]) => rollFortuneDice(def(id).params, faces(...f))

  it('Bạc, one die: 1–2 nothing, 3–4 +2 chaos points, 5 a Bạc card, 6 a Vàng card', () => {
    const none = { points: 0, cards: [], lose: 0, jackpot: 0, triple: false, herald: false }
    expect(roll('s_dice', 1)).toEqual({ dice: [1], ...none })
    expect(roll('s_dice', 2)).toEqual({ dice: [2], ...none })
    expect(roll('s_dice', 3)).toMatchObject({ points: 2, cards: [] })
    expect(roll('s_dice', 4)).toMatchObject({ points: 2, cards: [] })
    expect(roll('s_dice', 5)).toMatchObject({ points: 0, cards: [{ tier: 'silver', count: 1 }] })
    expect(roll('s_dice', 6)).toMatchObject({ points: 0, cards: [{ tier: 'gold', count: 1 }] })
  })

  it('Vàng, two dice summed: 2 loses a wager, 3–6 +3, 7–9 a Vàng card, 10–11 a Kim cương card, 12 a 10 × jackpot', () => {
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        const r = roll('g_dice', a, b)
        const t = a + b
        expect(r.dice).toEqual([a, b])
        expect(r.lose, `${a}+${b}`).toBe(t === 2 ? 1 : 0)
        expect(r.points, `${a}+${b}`).toBe(t >= 3 && t <= 6 ? 3 : 0)
        expect(r.cards, `${a}+${b}`).toEqual(t >= 7 && t <= 9 ? [{ tier: 'gold', count: 1 }] : t === 10 || t === 11 ? [{ tier: 'diamond', count: 1 }] : [])
        expect(r.jackpot, `${a}+${b}`).toBe(t === 12 ? 10 : 0)
        expect(r.triple || r.herald).toBe(false)
      }
    }
  })

  it('Kim cương, three dice summed, every one of the 216 rolls, triples doubled (spec §5)', () => {
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        for (let c = 1; c <= 6; c++) {
          const r = roll('d_dice', a, b, c)
          const t = a + b + c
          const k = a === b && b === c ? 2 : 1
          const label = `${a}-${b}-${c}`
          expect(r.triple, label).toBe(k === 2)
          expect(r.lose, label).toBe(t === 3 ? 2 * k : 0)
          expect(r.points, label).toBe(t >= 4 && t <= 7 ? 5 * k : 0)
          const cards: { tier: ChaosTier; count: number }[] =
            t >= 8 && t <= 11 ? [{ tier: 'gold', count: k }]
              : t >= 12 && t <= 14 ? [{ tier: 'diamond', count: k }]
                : t >= 15 && t <= 17 ? [{ tier: 'diamond', count: 2 * k }]
                  : t === 18 ? [{ tier: 'diamond', count: k }] : []
          expect(r.cards, label).toEqual(cards)
          expect(r.jackpot, label).toBe(t === 18 ? 30 * k : 0)
          expect(r.herald, label).toBe(t === 18)
        }
      }
    }
    // The spec's own list of the triples.
    expect(roll('d_dice', 1, 1, 1)).toMatchObject({ lose: 4, triple: true })
    expect(roll('d_dice', 2, 2, 2)).toMatchObject({ points: 10 })
    expect(roll('d_dice', 3, 3, 3)).toMatchObject({ cards: [{ tier: 'gold', count: 2 }] })
    expect(roll('d_dice', 4, 4, 4)).toMatchObject({ cards: [{ tier: 'diamond', count: 2 }] })
    expect(roll('d_dice', 5, 5, 5)).toMatchObject({ cards: [{ tier: 'diamond', count: 4 }] })
    expect(roll('d_dice', 6, 6, 6)).toMatchObject({ jackpot: 60, cards: [{ tier: 'diamond', count: 2 }], herald: true, triple: true })
  })

  it('draws exactly one rng.int(6) per die', () => {
    const asked: number[] = []
    rollFortuneDice(def('d_dice').params, { int: (n) => { asked.push(n); return 0 } })
    expect(asked).toEqual([6, 6, 6])
  })
})

describe('afterHand — Xúc xắc vận may', () => {
  it('rolls at the end of the hand, once, and leaves: chaos points are flat, the event names no card', () => {
    const [die] = held('s_dice')
    const r = settle([at(seatWith([die!]), { outcome: 'loss' })], { rng: faces(3) })
    expect(r.dice).toEqual([{ seat: 0, cardId: 's_dice', uid: die!.uid, dice: [3], result: { points: 2 } }])
    expect(r.seats.get(0)!.points).toBe(2 + 2) // a loss is worth 2, the dice 2 more
    expect(r.seats.get(0)!.cards).toEqual([])
    expect(r.credits).toEqual([])
    expect(r.debits).toEqual([])
  })

  it('rolls on a win, a loss and a carry-over alike; a roll that gives nothing still leaves and is told', () => {
    for (const outcome of ['win', 'loss', 'none'] as const) {
      const [die] = held('s_dice')
      const r = settle([at(seatWith([die!]), { outcome, net: outcome === 'win' ? 500 : 0 })], { rng: faces(1) })
      expect(r.dice, outcome).toEqual([{ seat: 0, cardId: 's_dice', uid: die!.uid, dice: [1], result: {} }])
      expect(r.seats.get(0)!.cards, outcome).toEqual([])
    }
    const r = settle([at(seatWith(held('s_dice')), { outcome: 'none' })], { rng: faces(4), carryOverOnly: true })
    expect(r.dice[0]!.result).toEqual({ points: 2 })
  })

  it('waits while the seat is frozen, switched off by Nhật thực, or sits the hand out', () => {
    const frozen = settle([at(seatWith(held('g_dice'), { frozenNextHand: true }))], { rng: fixed(5) })
    expect(frozen.dice).toEqual([])
    expect(frozen.seats.get(0)!.cards.map((c) => c.cardId)).toEqual(['g_dice'])
    const dark = settle([at(seatWith(held('g_dice')))], { rng: fixed(5), plan: planOf({ 0: [] }, { eclipsed: true }) })
    expect(dark.dice).toEqual([])
    expect(dark.seats.get(0)!.cards.map((c) => c.cardId)).toEqual(['g_dice'])
    const out = settle([at(seatWith(held('g_dice')), { inHand: false })], { rng: fixed(5) })
    expect(out.dice).toEqual([])
  })

  it('a lost wager is a debit to the sink (Review Focus 3): a wager, at most the stack, nothing at 0', () => {
    const [die] = held('g_dice')
    const full = settle([at(seatWith([die!]), { stackAfter: 5_000 })], { rng: faces(1, 1) })
    expect(full.debits).toEqual([{ seat: 0, amount: WAGER, reason: 'chaos_dice', cardId: 'g_dice', uid: die!.uid }])
    expect(full.dice[0]!.result).toEqual({ burned: WAGER })
    const short = settle([at(seatWith(held('g_dice')), { stackAfter: 300 })], { rng: faces(1, 1) })
    expect(short.debits.map((d) => d.amount)).toEqual([300])
    expect(short.dice[0]!.result).toEqual({ burned: 300 })
    const broke = settle([at(seatWith(held('g_dice')), { stackAfter: 0 })], { rng: faces(1, 1) })
    expect(broke.debits).toEqual([])
    expect(broke.dice[0]!.result).toEqual({ burned: 0 })
  })

  it('1-1-1 on the Kim cương dice loses 4 wagers, capped at the stack', () => {
    const r = settle([at(seatWith(held('d_dice')), { stackAfter: 2_500 })], { rng: faces(1, 1, 1) })
    expect(r.debits.map((d) => d.amount)).toEqual([2_500])
    expect(r.dice[0]!.result).toEqual({ burned: 2_500, triple: true })
  })

  it('two dice held both roll, and their losses together never pass the stack', () => {
    const r = settle([at(seatWith(held('g_dice', 'g_dice')), { stackAfter: 1_500 })], { rng: faces(1, 1, 1, 1) })
    expect(r.dice).toHaveLength(2)
    expect(r.debits.map((d) => d.amount)).toEqual([1_000, 500])
    expect(r.seats.get(0)!.cards).toEqual([])
  })

  it('12 on the Vàng dice is a 10 × wager jackpot: a credit, new points', () => {
    const [die] = held('g_dice')
    const r = settle([at(seatWith([die!]))], { rng: faces(6, 6) })
    expect(r.credits).toEqual([{ seat: 0, amount: 10 * WAGER, reason: 'chaos_jackpot', cardId: 'g_dice', uid: die!.uid }])
    expect(r.dice[0]!.result).toEqual({ jackpot: 10 * WAGER })
  })

  it('6-6-6 for a human: a 60 × jackpot, the herald, and 2 Kim cương cards into the private bonus hand (A7)', () => {
    const r = settle([at(seatWith(held('d_dice')))], { rng: faces(6, 6, 6), pool: only('d_pick_3') })
    expect(r.credits.map((c) => [c.reason, c.amount])).toEqual([['chaos_jackpot', 60 * WAGER]])
    expect(r.dice[0]!.result).toEqual({ jackpot: 60 * WAGER, cards: [{ tier: 'diamond', count: 2 }], triple: true, herald: true })
    expect(r.awarded).toEqual([])
    expect(r.bonusAwarded).toEqual([{ seat: 0, cards: [def('d_pick_3'), def('d_pick_3')].map((c) => ({ ...c, enabled: true })) }])
    expect(r.seats.get(0)!.bonus.map((c) => c.cardId)).toEqual(['d_pick_3', 'd_pick_3'])
  })

  it('a prize that finds the bonus hand full is dropped (Ruling 3), and comes before the points', () => {
    const bonus = held('s_luck_1', 's_suited')
    const r = settle([at(seatWith(held('d_dice'), { bonus, points: 20 }))], {
      rng: faces(6, 6, 6), pool: only('d_pick_3', 's_luck_1'), config: { ...DEFAULT_CHAOS_CONFIG, pointsThreshold: 10 },
    })
    expect(r.seats.get(0)!.bonus.map((c) => c.cardId)).toEqual(['s_luck_1', 's_suited', 'd_pick_3'])
    expect(r.bonusAwarded).toEqual([{ seat: 0, cards: [{ ...def('d_pick_3'), enabled: true }] }])
    // The hand is full: the points (20 + 2 for the loss) wait.
    expect(r.seats.get(0)!.points).toBe(22)
  })

  it('a prize card that needs no press goes to the seat as a bonus card does', () => {
    const r = settle([at(seatWith(held('s_dice')))], { rng: faces(6), pool: only('g_shield_3') })
    expect(r.bonusAwarded).toEqual([])
    expect(r.awarded).toEqual([{ seat: 0, cards: [{ ...def('g_shield_3'), enabled: true }] }])
    expect(r.seats.get(0)!.cards.map((c) => c.cardId)).toEqual(['g_shield_3'])
  })

  it("a bot's prize cards act at once (the receive path)", () => {
    const r = settle([at(seatWith(held('d_dice')), { isBot: true })], { rng: faces(6, 6, 6), pool: only('d_pick_3') })
    expect(r.bonusAwarded).toEqual([])
    expect(r.awarded[0]!.cards.map((c) => c.id)).toEqual(['d_pick_3', 'd_pick_3'])
    expect(r.seats.get(0)!.cards).toMatchObject([{ cardId: 'd_pick_3', handsLeft: 2 }])
  })

  it('a dice card won by a roll waits for the next hand the seat plays (Ruling 5)', () => {
    const r = settle([at(seatWith(held('s_dice')))], { rng: faces(6), pool: only('g_dice') })
    expect(r.dice).toHaveLength(1)
    expect(r.seats.get(0)!.cards.map((c) => c.cardId)).toEqual(['g_dice'])
  })
})

describe('afterHand — crits ×3/×4/×5 and the highest one only', () => {
  const win = { outcome: 'win' as const, net: 1_000 }

  it('Liều ăn nhiều crits on a win: 20 % ×5, 30 % ×4, 50 % ×3, and leaves', () => {
    const cases: [number, number][] = [[0, 5], [19, 5], [20, 4], [49, 4], [50, 3], [99, 3]]
    for (const [r, k] of cases) {
      const [risky] = held('d_risky_hand')
      const out = settle([at(seatWith([risky!]), win)], { rng: fixed(r), plan: planOf({ 0: [fx(risky!)] }) })
      expect(out.credits, `r=${r}`).toEqual([{ seat: 0, amount: (k - 1) * 1_000, reason: 'chaos_crit', cardId: 'd_risky_hand', uid: risky!.uid, multiplier: k }])
      expect(out.seats.get(0)!.cards).toEqual([])
    }
  })

  it('no crit on a loss or a win with nothing won; a loss keeps the card', () => {
    const [risky] = held('d_risky_hand')
    const plan = planOf({ 0: [fx(risky!)] })
    const lost = settle([at(seatWith([risky!]), { outcome: 'loss', net: -1_000 })], { rng: fixed(0), plan })
    expect(lost.credits).toEqual([])
    expect(lost.seats.get(0)!.cards).toHaveLength(1)
    expect(settle([at(seatWith([risky!]), { outcome: 'win', net: 0 })], { rng: fixed(0), plan }).credits).toEqual([])
  })

  it('Xúc xắc định mệnh rolled 5–6: ×2 on a win, only for the seat it marked', () => {
    const [die] = held('g_fate_die')
    const plan = planOf({ 0: [fx(die!)] })
    expect(settle([at(seatWith([]), win)], { plan, outcomes: { fateCrit: [0] } }).credits)
      .toEqual([{ seat: 0, amount: 1_000, reason: 'chaos_crit', cardId: 'g_fate_die', uid: die!.uid, multiplier: 2 }])
    expect(settle([at(seatWith([]), win)], { plan, outcomes: { fateCrit: [1] } }).credits).toEqual([])
    expect(settle([at(seatWith([]), win)], { plan }).credits).toEqual([])
    expect(settle([at(seatWith([]), { outcome: 'loss', net: -500 })], { plan, outcomes: { fateCrit: [0] } }).credits).toEqual([])
  })

  it('two crits never multiply: each rolls, the highest pays; on a tie the round-three card, not Bạo kích (Rulings 6, 17)', () => {
    const [crit, risky] = held('g_crit', 'd_risky_hand')
    const [fate] = held('g_fate_die')
    const both = planOf({ 0: [fx(crit!), fx(risky!)] })
    const five = settle([at(seatWith([crit!, risky!]), win)], { rng: script(9, 0), plan: both })
    expect(five.credits).toEqual([{ seat: 0, amount: 4_000, reason: 'chaos_crit', cardId: 'd_risky_hand', uid: risky!.uid, multiplier: 5 }])
    const tie = settle([at(seatWith([crit!, risky!]), win)], { rng: script(9, 60), plan: both })
    expect(tie.credits).toMatchObject([{ cardId: 'd_risky_hand', multiplier: 3, amount: 2_000 }])
    const withFate = planOf({ 0: [fx(crit!), fx(fate!)] })
    expect(settle([at(seatWith([crit!]), win)], { rng: script(9), plan: withFate, outcomes: { fateCrit: [0] } }).credits)
      .toMatchObject([{ cardId: 'g_crit', multiplier: 3 }])
    // Bạo kích ×2 against Xúc xắc định mệnh's ×2: the die is credited.
    expect(settle([at(seatWith([crit!]), win)], { rng: script(20), plan: withFate, outcomes: { fateCrit: [0] } }).credits)
      .toMatchObject([{ cardId: 'g_fate_die', multiplier: 2, amount: 1_000 }])
    expect(settle([at(seatWith([crit!]), win)], { rng: script(50), plan: withFate, outcomes: { fateCrit: [0] } }).credits)
      .toMatchObject([{ cardId: 'g_fate_die', multiplier: 2, amount: 1_000 }])
  })
})

describe('afterHand — Mạo hiểm gia', () => {
  it('a win pays its jackpot (5 × wager, new points) and 5 chaos points, flat, and ends the card', () => {
    const [adv] = held('d_adventurer')
    const card = { ...adv!, charge: 2 }
    const r = settle([at(seatWith([card]), { outcome: 'win', net: 7_000 })], { plan: planOf({ 0: [fx(card, { charge: 2 })] }) })
    expect(r.credits).toEqual([{ seat: 0, amount: 5 * WAGER, reason: 'chaos_jackpot', cardId: 'd_adventurer', uid: adv!.uid }])
    expect(r.seats.get(0)!.points).toBe(1 + 5)
    expect(r.seats.get(0)!.cards).toEqual([])
  })

  it('a loss pays nothing and steps the stake on; a card the seat does not hold pays no jackpot', () => {
    const [adv] = held('d_adventurer')
    const lost = settle([at(seatWith([adv!]), { outcome: 'loss' })], { plan: planOf({ 0: [fx(adv!)] }) })
    expect(lost.credits).toEqual([])
    expect(lost.seats.get(0)!.cards[0]).toMatchObject({ charge: 1, handsLeft: 4 })
    const stray = settle([at(seatWith([]), { outcome: 'win', net: 500 })], { plan: planOf({ 0: [fx(adv!)] }) })
    expect(stray.credits).toEqual([])
    expect(stray.seats.get(0)!.points).toBe(1)
  })
})

describe('Nâng tầm uy lực', () => {
  it('lifts the next card one tier and is spent; Kim cương stays Kim cương; a seat without one is untouched', () => {
    const [up] = held('s_tier_up')
    const seat = seatWith([...held('s_shield'), up!])
    expect(liftTier(seat, 'silver')).toMatchObject({ tier: 'gold', spent: up })
    expect(liftTier(seat, 'gold').tier).toBe('diamond')
    const top = liftTier(seat, 'diamond')
    expect(top.tier).toBe('diamond')
    expect(top.seat.cards.map((c) => c.cardId)).toEqual(['s_shield'])
    expect(draftTierFor(seat, 'silver')).toBe('gold')
    const plain = seatWith(held('s_shield'))
    expect(liftTier(plain, 'silver')).toEqual({ seat: plain, tier: 'silver' })
    expect(draftTierFor(plain, 'gold')).toBe('gold')
  })

  it('the next bonus card drawn at the end of a hand comes a tier up, and the card is gone', () => {
    const config = { ...DEFAULT_CHAOS_CONFIG, pointsThreshold: 10, tierWeights: { silver: 100, gold: 0, diamond: 0 } }
    const tiers = (r: ReturnType<typeof settle>) => [...r.awarded, ...r.bonusAwarded].flatMap((a) => a.cards).map((c) => c.tier)
    const up = settle([at(seatWith(held('s_tier_up'), { points: 9 }))], { config, rng: seededRng(4) })
    expect(tiers(up)[0]).toBe('gold')
    expect(up.seats.get(0)!.cards.some((c) => c.effect === 'tierUp')).toBe(false)
    const plain = settle([at(seatWith([], { points: 9 }))], { config, rng: seededRng(4) })
    expect(tiers(plain)[0]).toBe('silver')
  })

  it('a prize card counts as the next card received', () => {
    const r = settle([at(seatWith(held('s_tier_up', 's_dice')))], { rng: faces(5), pool: only('s_luck_1', 'g_luck_3') })
    expect(r.dice[0]!.result.cards).toEqual([{ tier: 'silver', count: 1 }])
    expect(r.bonusAwarded[0]!.cards.map((c) => c.id)).toEqual(['g_luck_3'])
    expect(r.seats.get(0)!.cards).toEqual([])
  })

  it('is spent only when the lifted card is kept: not by a prize dropped on a full bonus hand, nor by a tier with no card (5c M2)', () => {
    // The bonus hand is full: the dice's prize card is dropped, so Nâng tầm uy lực waits for the next card.
    const full = held('s_shield', 's_shield', 's_shield')
    const dropped = settle([at(seatWith(held('s_tier_up', 's_dice'), { bonus: full }))], { rng: faces(5), pool: only('s_luck_1', 'g_luck_3') })
    expect(dropped.bonusAwarded).toEqual([])
    expect(dropped.seats.get(0)!.cards.map((c) => c.effect)).toContain('tierUp')
    // No tier has a card (an empty pool; a lifted draw falls back to lower tiers): nothing is drawn, nothing spent.
    const empty = settle([at(seatWith(held('s_tier_up', 's_dice')))], { rng: faces(5), pool: [] })
    expect(empty.bonusAwarded).toEqual([])
    expect(empty.seats.get(0)!.cards.map((c) => c.effect)).toContain('tierUp')
  })
})

describe('Trộm điểm', () => {
  const card = { cardId: 'g_steal_points', uid: 77, params: def('g_steal_points').params }
  const table = (pts: number[], extra: Record<number, Partial<ChaosSeat>> = {}): Map<number, ChaosSeat> =>
    new Map(pts.map((p, seat) => [seat, { ...EMPTY_CHAOS_SEAT, points: p, ...extra[seat] }]))
  const pointsOf = (m: Map<number, ChaosSeat>) => [...m.values()].map((s) => s.points)

  it('is never held: receiveCard lists it for its caller to resolve', () => {
    const r = receiveCard(EMPTY_CHAOS_SEAT, def('g_steal_points'), () => 1, ENABLED, 'none', script())
    expect(r.received.map((c) => c.id)).toEqual(['g_steal_points'])
    expect(r.seat.cards).toEqual([])
  })

  it('takes 5 chaos points from the richest other seat, all it has when fewer; a tie goes to the first clockwise', () => {
    const r = stealPoints({ seats: table([2, 9, 4]), holder: 0, card, rng: script() })
    expect(pointsOf(r.seats)).toEqual([7, 4, 4])
    expect(r.steal).toEqual({ seat: 0, cardId: 'g_steal_points', uid: 77, outcome: 'applied', targets: [1], from: 1, to: 0, amount: 5, spent: [] })
    expect(pointsOf(stealPoints({ seats: table([0, 3, 1]), holder: 0, card, rng: script() }).seats)).toEqual([3, 0, 1])
    // Seats 0 and 2 tie on 6 for holder 1: clockwise from 1 comes 2 first.
    expect(stealPoints({ seats: table([6, 50, 6]), holder: 1, card, rng: script() }).steal.targets).toEqual([2])
    expect(stealPoints({ seats: table([6, 6, 50]), holder: 2, card, rng: script() }).steal.targets).toEqual([0])
    expect(stealPoints({ seats: table([50, 6, 6]), holder: 0, card, rng: script() }).steal.targets).toEqual([1])
  })

  it('fizzles when no other seat has a point; the holder is never its own target', () => {
    const r = stealPoints({ seats: table([30, 0, 0]), holder: 0, card, rng: script() })
    expect(r.steal).toMatchObject({ outcome: 'fizzled', targets: [], amount: 0 })
    expect(pointsOf(r.seats)).toEqual([30, 0, 0])
  })

  it('a shield blocks it (a one-shot one is spent, Khiên sắt is not); a mirror turns it back on the holder', () => {
    const [shield] = held('s_shield')
    const one = stealPoints({ seats: table([3, 9], { 1: { cards: [shield!] } }), holder: 0, card, rng: script() })
    expect(one.steal).toMatchObject({ outcome: 'blocked', targets: [1], amount: 0, spent: [{ seat: 1, uid: shield!.uid, cardId: 's_shield' }] })
    expect(pointsOf(one.seats)).toEqual([3, 9])
    expect(one.seats.get(1)!.cards).toEqual([])
    const lasting = held('g_shield_3')
    const three = stealPoints({ seats: table([3, 9], { 1: { cards: lasting } }), holder: 0, card, rng: script() })
    expect(three.steal).toMatchObject({ outcome: 'blocked', spent: [] })
    expect(three.seats.get(1)!.cards).toEqual(lasting)
    const [mirror] = held('d_mirror')
    const back = stealPoints({ seats: table([3, 9], { 1: { cards: [mirror!] } }), holder: 0, card, rng: script() })
    expect(back.steal).toMatchObject({ outcome: 'reflected', targets: [1], from: 0, to: 1, amount: 3 })
    expect(pointsOf(back.seats)).toEqual([0, 12])
  })

  it('the shield that stands is the one planHand would stand: a lasting shield or mirror first, then the oldest, in this mode (5c M4)', () => {
    const [oneShot, other] = held('s_shield', 's_shield')
    const [mirror] = held('d_mirror')
    const lastingMirror = { ...mirror!, handsLeft: 2 }
    const pick = (cards: HeldCard[], validHere?: (id: string) => boolean) => standingShield(cards, validHere)?.uid ?? null
    const planned = (cards: HeldCard[]) =>
      planHand({ seats: [{ seat: 0, isBot: false, chaos: seatWith(cards) }, { seat: 1, isBot: false, chaos: EMPTY_CHAOS_SEAT }], rules: RULES, pool: ENABLED, rng: seededRng(1), nextUid: () => 9_000 })
        .plan.seats[0]!.shield?.uid ?? null
    for (const cards of [[oneShot!, lastingMirror], [oneShot!, other!], [lastingMirror, oneShot!], [{ ...oneShot!, handsLeft: 0 }, other!]]) {
      expect(pick(cards), cards.map((c) => `${c.cardId}/${c.handsLeft}`).join(' ')).toBe(planned(cards))
    }
    expect(pick([oneShot!, lastingMirror])).toBe(lastingMirror.uid)
    // A card the table's mode does not allow does not stand.
    expect(pick([lastingMirror, oneShot!], (id) => id !== 'd_mirror')).toBe(oneShot!.uid)
    expect(pick([])).toBeNull()
  })

  it('Bia đỡ đạn hands it to another seat at random and is spent; with nobody to take it, it lands and waits', () => {
    const [goat] = held('g_scapegoat')
    const r = stealPoints({ seats: table([0, 9, 4, 6], { 1: { cards: [goat!] } }), holder: 0, card, rng: script(1) })
    // Seats 2 and 3 can take it; the rng picks the second, seat 3.
    expect(r.steal).toMatchObject({ outcome: 'applied', targets: [3], from: 3, to: 0, amount: 5, spent: [{ seat: 1, uid: goat!.uid, passedTo: 3 }] })
    expect(pointsOf(r.seats)).toEqual([5, 9, 4, 1])
    expect(r.seats.get(1)!.cards).toEqual([])
    const alone = stealPoints({ seats: table([0, 9], { 1: { cards: [goat!] } }), holder: 0, card, rng: script() })
    expect(alone.steal).toMatchObject({ outcome: 'applied', targets: [1], amount: 5, spent: [] })
    expect(alone.seats.get(1)!.cards).toEqual([goat])
  })

  it('a standing Gậy ông of another seat turns it back; the holder\'s own does not', () => {
    const back = stealPoints({ seats: table([4, 9]), holder: 0, card, rng: script(), backfire: [1] })
    expect(back.steal).toMatchObject({ outcome: 'reflected', from: 0, to: 1, amount: 4 })
    expect(stealPoints({ seats: table([4, 9]), holder: 0, card, rng: script(), backfire: [0] }).steal.outcome).toBe('applied')
  })

  it('afterHand resolves one a seat receives at the end of the hand, over the seats given', () => {
    const r = settle([
      at(seatWith(held('g_dice')), { isBot: true }),
      at(seatWith([], { points: 8 }), { seat: 1, outcome: 'none' }),
    ], { rng: faces(3, 4), pool: only('g_steal_points'), config: DEFAULT_CHAOS_CONFIG })
    expect(r.dice[0]!.result.cards).toEqual([{ tier: 'gold', count: 1 }])
    expect(r.steals).toMatchObject([{ seat: 0, cardId: 'g_steal_points', outcome: 'applied', targets: [1], from: 1, to: 0, amount: 5 }])
    expect(r.seats.get(0)!.points).toBe(2 + 5)
    expect(r.seats.get(1)!.points).toBe(3)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// 500 hands in a row with every round-three money card: the room's loop in miniature, credits and debits included.

const MONEY = [
  'g_duel', 's_duel', 'd_share_winnings', 'g_win_tax', 'd_time_bomb', // transfers (5b)
  'd_adventurer', 'g_big_table', 'd_risky_hand', 'g_fate_die', 'g_crit', 'd_crit', // stakes and crits
  's_dice', 'g_dice', 'd_dice', 's_tier_up', 'g_steal_points', // dice, tier, steal
  's_shield', 'd_mirror', 'g_scapegoat', 's_master', 's_kindling',
]

describe('Conservation with every round-three money card (seeded)', () => {
  it('500 hands: stacks + pot + fee + carry-over + credits − debits keep every point; no stack below 0', () => {
    const rng = seededRng(4141)
    let next = 1
    const nextUid = (): number => next++
    interface Seated { seat: number; stack: number; chaos: ChaosSeat; isBot: boolean }
    const seated: Seated[] = Array.from({ length: 5 }, (_, seat) => ({ seat, stack: 20_000, chaos: EMPTY_CHAOS_SEAT, isBot: seat % 2 === 0 }))
    let table: ChaosTableState = EMPTY_CHAOS_TABLE
    let carry = 0
    // Points from outside the table: top-ups, the cards' credits, less the fees and the dice's sink.
    let outside = 0
    const seen = { rolls: 0, debits: 0, sunk: 0, diceJackpots: 0, advJackpots: 0, crit4: 0, steals: 0, lifted: 0 }
    const total = (): number => seated.reduce((a, s) => a + s.stack, 0) + carry - outside
    const start = total()
    const resolveSteals = (holder: Seated, received: readonly ChaosCardDef[]): void => {
      for (const c of received.filter((x) => x.effect === 'stealPoints')) {
        const pointsBefore = seated.reduce((a, s) => a + s.chaos.points, 0)
        const r = stealPoints({ seats: new Map(seated.map((s) => [s.seat, s.chaos])), holder: holder.seat, card: { cardId: c.id, uid: nextUid(), params: c.params }, rng })
        for (const s of seated) s.chaos = r.seats.get(s.seat)!
        // A steal only moves chaos points (5c M6): the table's sum is the same, and it takes no more than the card says.
        expect(seated.reduce((a, s) => a + s.chaos.points, 0)).toBe(pointsBefore)
        expect(r.steal.amount).toBeLessThanOrEqual(c.params.points ?? 0)
        seen.steals++
      }
    }

    for (let h = 0; h < 500; h++) {
      const rules: BlindRules = { mode: 'blind', holeCards: rng.int(2) === 0 ? 2 : 3, decisionMode: rng.int(2) === 0 ? 'none' : 'playOrFold', fixedWager: WAGER, tableFeeRate: rng.int(2) * 0.05 }
      for (const s of seated) {
        if (s.stack < WAGER) {
          outside += 20_000 - s.stack
          s.stack = 20_000
        }
        // A card now and then, the way a draft hands one over (the room resolves a Trộm điểm on receipt).
        if (rng.int(2) === 0) {
          const r = receiveCard(s.chaos, def(MONEY[rng.int(MONEY.length)]!), nextUid, ENABLED, rules.decisionMode, rng)
          s.chaos = r.seat
          resolveSteals(s, r.received)
        }
      }
      const dealt = seated.filter(() => rng.int(6) !== 0)
      if (dealt.length < 2) continue
      const planned = planHand({ seats: dealt.map((s) => ({ seat: s.seat, isBot: s.isBot, chaos: s.chaos })), rules, pool: ENABLED, rng, nextUid, table })
      for (const s of dealt) s.chaos = planned.seats.get(s.seat)!
      const before = new Map(dealt.map((s) => [s.seat, s.stack]))
      const sumBefore = [...before.values()].reduce((a, b) => a + b, 0)
      const hand = createBlindHand({ handId: `m${h}`, rules, seats: dealt.map((s) => ({ seat: s.seat, playerId: `p${s.seat}`, stack: s.stack, isBot: s.isBot })), button: dealt[h % dealt.length]!.seat, carryOverIn: carry, chaos: planned.plan }, rng)
      let state = hand.state
      const step = (cmd: Parameters<typeof applyBlindCommand>[1]): void => {
        state = applyBlindCommand(state, cmd, rng).state
        if (state.result === null) expect(state.players.reduce((a, x) => a + x.stack, 0) + state.pot).toBe(sumBefore + carry)
      }
      while (state.phase === 'DECISION') {
        const undecided = state.players.filter((x) => blindLegalActions(state, x.seat).kinds.length > 0)
        const x = undecided[rng.int(undecided.length)]!
        const kinds = blindLegalActions(state, x.seat).kinds as ('play' | 'fold')[]
        step({ type: 'ACTION', seat: x.seat, action: { kind: kinds[rng.int(kinds.length)]! } })
      }
      while (state.phase === 'REVEAL') step({ type: 'ADVANCE' })
      expect(state.phase).toBe('COMPLETE')
      const r = state.result!
      expect(state.players.reduce((a, x) => a + x.stack, 0) + r.fee + r.carryOverOut).toBe(sumBefore + carry)

      const chaos = state.chaos!
      const winners = new Set(r.pots.flatMap((pot) => pot.winners.map((w) => w.seat)))
      const tierUps = dealt.reduce((a, s) => a + s.chaos.cards.filter((c) => c.effect === 'tierUp').length, 0)
      const after = afterHand({
        rules, config: DEFAULT_CHAOS_CONFIG, pool: ENABLED, rng, nextUid, plan: chaos.plan, consumed: new Set([...chaos.applied, ...chaos.blocked]),
        recorded: new Set(chaos.recorded), carryOverOnly: r.pots.length === 0, marks: chaos.marks, table: planned.table,
        ...(chaos.outcomes ? { outcomes: chaos.outcomes } : {}),
        seats: state.players.map((hp) => ({
          seat: hp.seat, isBot: hp.isBot, chaos: seated.find((s) => s.seat === hp.seat)!.chaos, stackAfter: hp.stack, net: hp.stack - before.get(hp.seat)!,
          inHand: true, outcome: r.pots.length === 0 ? ('none' as const) : winners.has(hp.seat) ? ('win' as const) : ('loss' as const),
        })),
      })
      for (const s of dealt) {
        s.chaos = after.seats.get(s.seat)!
        s.stack = state.players.find((x) => x.seat === s.seat)!.stack
      }
      seen.lifted += tierUps - dealt.reduce((a, s) => a + s.chaos.cards.filter((c) => c.effect === 'tierUp').length, 0)
      // The room: each debit lowers the stack at once (a sink row), each credit raises it (a ledger row).
      for (const d of after.debits) {
        const s = seated.find((x) => x.seat === d.seat)!
        expect(d.amount).toBeGreaterThan(0)
        expect(d.amount).toBeLessThanOrEqual(s.stack)
        s.stack -= d.amount
        outside -= d.amount
        seen.debits++
        seen.sunk += d.amount
      }
      for (const c of after.credits) {
        seated.find((x) => x.seat === c.seat)!.stack += c.amount
        outside += c.amount
        if (c.reason === 'chaos_jackpot') {
          // Each jackpot is what its card's params say, in fixed wagers (5c M6).
          if (c.cardId === 'd_adventurer') {
            expect(c.amount).toBe((def('d_adventurer').params.jackpot ?? 0) * WAGER)
            seen.advJackpots++
          } else {
            const roll = after.dice.find((d) => d.uid === c.uid)!
            expect(c.amount).toBe(roll.result.jackpot)
            expect(c.amount).toBe(rollFortuneDice(def(c.cardId).params, script(...roll.dice.map((f) => f - 1))).jackpot * WAGER)
            seen.diceJackpots++
          }
        }
        if ((c.multiplier ?? 0) >= 4) seen.crit4++
      }
      for (const d of after.dice) {
        seen.rolls++
        // What the event says was lost is exactly the debit the room writes.
        expect(d.result.burned ?? 0).toBe(after.debits.filter((x) => x.uid === d.uid).reduce((a, x) => a + x.amount, 0))
      }
      for (const st of after.steals) expect(st.amount).toBeLessThanOrEqual(def(st.cardId).params.points ?? 0)
      seen.steals += after.steals.length
      outside -= r.fee
      table = after.table
      carry = r.carryOverOut
      expect(seated.every((s) => s.stack >= 0)).toBe(true)
      expect(total()).toBe(start)
    }
    // The run went through every money path.
    expect(seen.rolls).toBeGreaterThan(20)
    expect(seen.debits).toBeGreaterThan(0)
    expect(seen.diceJackpots).toBeGreaterThan(0)
    expect(seen.advJackpots).toBeGreaterThan(0)
    expect(seen.crit4).toBeGreaterThan(0)
    expect(seen.steals).toBeGreaterThan(0)
    expect(seen.lifted).toBeGreaterThan(0)
  })
})
