import type { Rng } from '../cards/rng.js'
import type { BlindRules } from '../hand/types.js'
import { drawOffer, drawTier } from './draw.js'
import { farmHandsOf, receiveCard, tierFromParam } from './hold.js'
import type { ChaosCardDef, ChaosConfig, ChaosCredit, ChaosHandPlan, ChaosMode, ChaosSeat, ChaosTier, HeldCard } from './types.js'

export interface AfterHandSeat {
  seat: number
  isBot: boolean
  /** The seat as `planHand` returned it. */
  chaos: ChaosSeat
  stackAfter: number
  /** Points won from the pots minus points put in (spec §5.4 "phần thắng ròng"); Bạo kích pays on it. */
  net: number
  inHand: boolean
  /** Won a pot → win; folded, or in the hand without winning a pot → loss; carry-over or cancelled → none (spec §3.3). */
  outcome: 'win' | 'loss' | 'none'
}

/** A freeze or blindfold that landed this hand, after shields and mirrors (the engine's final marks). */
export interface ChaosMark {
  seat: number
  kind: 'freeze' | 'blindfold'
}

export interface AfterHandResult {
  seats: Map<number, ChaosSeat>
  credits: ChaosCredit[]
  awarded: { seat: number; cards: ChaosCardDef[] }[]
}

/** Thần tài's row for a loss streak of `len` hands (spec §5.5): 2–3, 4–5, 6 and more. */
const fortuneRow = (len: number): 2 | 4 | 6 => (len >= 6 ? 6 : len >= 4 ? 4 : 2)

/**
 * Settles the chaos side of a finished hand, seat by seat. A seat that sat the hand out keeps everything (it only takes
 * a mark). For a seat in the hand:
 * - consumed one-shot cards leave (`consumed` = the uids the engine applied or blocked); unless the seat was frozen this
 *   hand, every duration card loses a hand and leaves at 0 (a frozen seat's durations wait for a hand it can use them);
 * - points and streaks follow `outcome` (spec §3.3: +1 a win, +2 a loss, ×2 from the 3rd hand of a streak, ×2 again in
 *   a hand "Cày điểm" fired; `carryOverOnly` counts nobody);
 * - unless frozen: Bạo kích rolls on a win with `net > 0` and pays (k − 1) × net; the oldest Thần tài pays per its
 *   params when a win ends a loss streak of 2 or more; the oldest Cấp cứu pays multiplier × wager after a lost hand that
 *   leaves the stack under 2 wagers — each fired wait card leaves;
 * - every `pointsThreshold` points become a bonus card (the remainder stays); a frozen seat's bonus cards wait in
 *   `pendingBonus` for the end of its next unfrozen hand;
 * - next hand's freeze and blindfold come from `marks` only.
 * The input is never changed; every draw goes through `rng` and `weights`.
 */
export function afterHand(input: {
  rules: BlindRules
  config: ChaosConfig
  pool: readonly ChaosCardDef[]
  rng: Rng
  nextUid: () => number
  plan: ChaosHandPlan
  consumed: ReadonlySet<number>
  carryOverOnly: boolean
  marks: readonly ChaosMark[]
  seats: readonly AfterHandSeat[]
  weights?: ReadonlyMap<string, number>
}): AfterHandResult {
  const { rules, config, pool, rng, nextUid, plan, consumed, marks, weights } = input
  const mode: ChaosMode = rules.decisionMode
  const wager = rules.fixedWager
  const result: AfterHandResult = { seats: new Map(), credits: [], awarded: [] }

  for (const s of input.seats) {
    const chaos = s.chaos
    const frozenMark = marks.some((m) => m.seat === s.seat && m.kind === 'freeze')
    const blindMark = marks.some((m) => m.seat === s.seat && m.kind === 'blindfold')
    if (!s.inHand) {
      result.seats.set(s.seat, frozenMark || blindMark
        ? { ...chaos, frozenNextHand: chaos.frozenNextHand || frozenMark, blindfoldedNextHand: chaos.blindfoldedNextHand || blindMark }
        : chaos)
      continue
    }

    const frozen = chaos.frozenNextHand
    const fired = plan.seats.find((p) => p.seat === s.seat)?.effects ?? []

    let cards: HeldCard[] = chaos.cards.filter((c) => !(c.handsLeft === null && consumed.has(c.uid)))
    if (!frozen) {
      cards = cards
        .map((c) => (c.handsLeft === null ? c : { ...c, handsLeft: c.handsLeft - 1 }))
        .filter((c) => c.handsLeft === null || c.handsLeft > 0)
    }

    const outcome = input.carryOverOnly ? 'none' : s.outcome
    const before = chaos.streak
    let streak = before
    let points = chaos.points
    if (outcome !== 'none') {
      const len = before?.kind === outcome ? before.len + 1 : 1
      streak = { kind: outcome, len }
      let gain = outcome === 'win' ? 1 : 2
      if (len >= 3) gain *= 2
      if (fired.some((e) => e.effect === 'farm')) gain *= 2
      points += gain
    }

    const prizes: { tier: ChaosTier; count: number }[] = []
    if (!frozen) {
      const crit = fired.find((e) => e.effect === 'crit')
      if (crit && outcome === 'win' && s.net > 0) {
        const r = rng.int(100)
        const p3 = crit.params.p3 ?? 0
        const k = r < p3 ? 3 : r < p3 + (crit.params.p2 ?? 0) ? 2 : 0
        if (k > 0) result.credits.push({ seat: s.seat, amount: (k - 1) * s.net, reason: 'chaos_crit', cardId: crit.cardId, uid: crit.uid, multiplier: k as 2 | 3 })
      }

      const fortune = cards.find((c) => c.effect === 'fortune')
      if (fortune && outcome === 'win' && before?.kind === 'loss' && before.len >= 2) {
        const row = fortuneRow(before.len)
        const amount = (fortune.params[`m${row}`] ?? 0) * wager
        if (amount > 0) result.credits.push({ seat: s.seat, amount, reason: 'chaos_fortune', cardId: fortune.cardId, uid: fortune.uid })
        const tier = tierFromParam(fortune.params[`t${row}`])
        const count = fortune.params[`c${row}`] ?? 0
        if (tier && count > 0) prizes.push({ tier, count })
        cards = cards.filter((c) => c !== fortune)
      }

      const rescue = cards.find((c) => c.effect === 'rescue')
      if (rescue && outcome === 'loss' && s.stackAfter < 2 * wager) {
        result.credits.push({ seat: s.seat, amount: (rescue.params.multiplier ?? 0) * wager, reason: 'chaos_rescue', cardId: rescue.cardId, uid: rescue.uid })
        cards = cards.filter((c) => c !== rescue)
      }
    }

    let pendingBonus = chaos.pendingBonus
    if (config.pointsThreshold > 0) {
      while (points >= config.pointsThreshold) {
        points -= config.pointsThreshold
        pendingBonus++
      }
    }

    let next: ChaosSeat = { ...chaos, cards, points, streak, pendingBonus }
    const got: ChaosCardDef[] = []
    const give = (tier: ChaosTier): void => {
      const card = drawOffer(pool, tier, mode, rng, 1, weights)[0]
      if (!card) return
      const r = receiveCard(next, card, nextUid, pool, mode, rng, weights, config.tierWeights)
      next = r.seat
      got.push(...r.received)
    }
    for (const p of prizes) for (let i = 0; i < p.count; i++) give(p.tier)
    if (!frozen) {
      for (let i = 0; i < pendingBonus; i++) give(drawTier(config.tierWeights, rng))
      next = { ...next, pendingBonus: 0 }
    }
    if (got.length > 0) result.awarded.push({ seat: s.seat, cards: got })

    result.seats.set(s.seat, {
      ...next, farmHandsLeft: farmHandsOf(next.cards), frozenNextHand: frozenMark, blindfoldedNextHand: blindMark,
    })
  }
  return result
}
