import type { Rng } from '../cards/rng.js'
import type { BlindRules } from '../hand/types.js'
import { drawOffer, drawTier } from './draw.js'
import { needsNoPress, returnToBonus } from './bonus.js'
import { farmHandsOf, receiveCard, tierFromParam, toHeld } from './hold.js'
import {
  BONUS_HAND_MAX, EMPTY_CHAOS_TABLE,
  type ChaosCardDef, type ChaosConfig, type ChaosCredit, type ChaosDebit, type ChaosHandOutcomes, type ChaosHandPlan, type ChaosMark, type ChaosMode,
  type ChaosEffectKind, type ChaosSeat, type ChaosTableState, type ChaosTier, type HeldCard, type PlannedEffect,
} from './types.js'

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

export interface AfterHandResult {
  seats: Map<number, ChaosSeat>
  credits: ChaosCredit[]
  /** BP-41: points cards take into the sink (the dice); the room lowers the stacks and writes the sink rows. */
  debits: ChaosDebit[]
  /** BP-41 A3: the table's chaos state for the next hand (reigns and bombs counted down, a Thần dethroned…). */
  table: ChaosTableState
  /** Cards that reached a seat through `receiveCard` (draft-style: public, they act on their own). */
  awarded: { seat: number; cards: ChaosCardDef[] }[]
  /** Bonus cards that went into a human's bonus hand (BP-39): private, told only to their owner. */
  bonusAwarded: { seat: number; cards: ChaosCardDef[] }[]
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
 * - a bonus card played for this hand (`armed.hand === 'this'`, BP-39) leaves if its uid is in `consumed` or `recorded`, else goes
 *   back to the bonus hand at its old place — except a decision card that entered the plan, spent with its hand (Ruling
 *   5); `bonusPlayedThisHand` is cleared;
 * - every `pointsThreshold` points become a bonus card (the remainder stays); a frozen seat's bonus cards wait in
 *   `pendingBonus` for the end of its next unfrozen hand and then act as today. A bot's bonus cards act at once
 *   (`receiveCard`); a human's go to the bonus hand (`bonusAwarded`) while it holds fewer than `BONUS_HAND_MAX` cards,
 *   the armed one included — when it is full the points wait — except a card that needs no press, which acts as today;
 * - next hand's freeze and blindfold come from `marks` only;
 * - BP-41: a seat Nhật thực switched off (`eclipsed`) keeps its durations and wait cards as a frozen seat does; each
 *   fired Mồi lửa gives every seat in the hand its `points`, and a fired Tích tiểu thành đại gives its holder `points`
 *   on a lost hand — flat, never doubled; Cao thủ (unless idle) is spent by a won or lost hand, `points` on a win.
 * The input is never changed; every draw goes through `rng` and `weights`.
 *
 * BP-41 A3: `table` is the table's chaos state as `planHand` returned it (absent = `EMPTY_CHAOS_TABLE`), and `outcomes`
 * what the engine recorded in `ChaosHandState.outcomes`; the result's `table` is the state for the next hand.
 */
export function afterHand(input: {
  rules: BlindRules
  config: ChaosConfig
  pool: readonly ChaosCardDef[]
  rng: Rng
  nextUid: () => number
  plan: ChaosHandPlan
  consumed: ReadonlySet<number>
  /**
   * The uids the table was told of this hand (`ChaosHandState.recorded`), used up or fizzled: an armed card named there
   * is spent, never returned to the private bonus hand (BP-39 I1). Defaults to none.
   */
  recorded?: ReadonlySet<number>
  carryOverOnly: boolean
  marks: readonly ChaosMark[]
  seats: readonly AfterHandSeat[]
  weights?: ReadonlyMap<string, number>
  table?: ChaosTableState
  outcomes?: ChaosHandOutcomes
}): AfterHandResult {
  const { rules, config, pool, rng, nextUid, plan, consumed, marks, weights } = input
  const recorded = input.recorded ?? new Set<number>()
  const mode: ChaosMode = rules.decisionMode
  const wager = rules.fixedWager
  const result: AfterHandResult = { seats: new Map(), credits: [], debits: [], table: input.table ?? EMPTY_CHAOS_TABLE, awarded: [], bonusAwarded: [] }
  // BP-41 Mồi lửa: every seat in the hand takes each fired one's points (spec §6.3 "mọi người ngồi bàn").
  const kindling = plan.seats.reduce((sum, p) => sum + p.effects.reduce((n, e) => n + (e.effect === 'kindling' ? (e.params.points ?? 0) : 0), 0), 0)

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
    const planSeat = plan.seats.find((p) => p.seat === s.seat)
    const fired = planSeat?.effects ?? []
    // BP-41 Nhật thực (A11): a seat whose cards were off this hand loses no hand of them and fires no wait card, as frozen.
    const idle = frozen || planSeat?.eclipsed === true

    let cards: HeldCard[] = chaos.cards.filter((c) => !(c.handsLeft === null && consumed.has(c.uid)))
    if (!idle) {
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
    // BP-41 Mồi lửa and Tích tiểu thành đại: flat chaos points, outside the streak and Cày điểm's ×2.
    points += kindling
    const lossPoints = fired.find((e) => e.effect === 'lossPoints')
    if (lossPoints && outcome === 'loss') points += lossPoints.params.points ?? 0

    // BP-41 charge cards (Ruling: their state moves here, after the hand they played): Siêu cộng dồn is spent once it
    // dealt its Aces (spec §6.1 "nổ xong về 0, thẻ hết": the card leaves, so its charge goes with it); Đảo bài's phase
    // moves on one for each hand it fired; Liều ăn nhiều ends with a win ("tới khi thắng" — Task 5c rolls its crit here).
    const firedKind = (kind: ChaosEffectKind): PlannedEffect | undefined => fired.find((e) => e.effect === kind)
    if (input.outcomes?.acesDealt?.includes(s.seat)) cards = cards.filter((c) => c.effect !== 'acesCharge')
    const flip = firedKind('flipFlop')
    if (flip) cards = cards.map((c) => (c.uid === flip.uid ? { ...c, charge: (c.charge ?? 0) + 1 } : c))
    const risky = firedKind('riskyHand')
    if (risky && outcome === 'win') cards = cards.filter((c) => c.uid !== risky.uid)

    const prizes: { tier: ChaosTier; count: number }[] = []
    if (!idle) {
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

      // BP-41 Cao thủ (spec §6.3 "Thắng ván kế tiếp → +3"): the oldest one is spent by the next hand the seat plays to a
      // result — `points` chaos points on a win, nothing on a loss; a carry-over hand ('none') leaves it waiting. Flat,
      // like Mồi lửa: never doubled by the streak or Cày điểm.
      const master = cards.find((c) => c.effect === 'master')
      if (master && outcome !== 'none') {
        if (outcome === 'win') points += master.params.points ?? 0
        cards = cards.filter((c) => c !== master)
      }
    }

    // A bonus card played for this hand (BP-39) leaves if it was used, else goes back to the bonus hand where it was. A
    // decision card (Nhìn trộm, Bỏ không mất) that entered the plan is spent with its hand, used or not (Ruling 5); one
    // that never entered it (a mode the table excludes) goes back. A card the table was told of (`recorded`: a reveal card
    // that fizzled still reaches CHAOS_APPLIED and the summary) is spent too, or every viewer would know it went back
    // into the private hand (I1).
    let bonus = chaos.bonus
    let armed = chaos.armed
    if (armed?.hand === 'this') {
      const uid = armed.card.uid
      const spent = consumed.has(uid) || recorded.has(uid) || (armed.card.timing === 'decision' && fired.some((e) => e.uid === uid))
      if (!spent) bonus = returnToBonus(bonus, armed.card)
      armed = null
    }

    // A human's bonus cards go to the bonus hand (BP-39), unless frozen: those wait in `pendingBonus` as today.
    const toBonusHand = !s.isBot && !frozen
    let pendingBonus = chaos.pendingBonus
    if (config.pointsThreshold > 0 && !toBonusHand) {
      while (points >= config.pointsThreshold) {
        points -= config.pointsThreshold
        pendingBonus++
      }
    }

    let next: ChaosSeat = { ...chaos, cards, points, streak, pendingBonus, bonus, armed, bonusPlayedThisHand: false }
    const got: ChaosCardDef[] = []
    const receive = (card: ChaosCardDef): void => {
      const r = receiveCard(next, card, nextUid, pool, mode, rng, weights, config.tierWeights)
      next = r.seat
      got.push(...r.received)
    }
    const give = (tier: ChaosTier): void => {
      const card = drawOffer(pool, tier, mode, rng, 1, weights)[0]
      if (card) receive(card)
    }
    for (const p of prizes) for (let i = 0; i < p.count; i++) give(p.tier)
    if (!frozen) {
      for (let i = 0; i < pendingBonus; i++) give(drawTier(config.tierWeights, rng))
      next = { ...next, pendingBonus: 0 }
    }

    // The bonus hand holds at most BONUS_HAND_MAX cards, the armed one included; when it is full the points wait. A card
    // that needs no press goes to the seat as today and takes no room. Only the points the hand ended with convert: a
    // Tích lũy drawn here adds points for a later hand, so a low threshold cannot loop. A draw that finds no card (an
    // empty tier) costs nothing.
    const drawn: ChaosCardDef[] = []
    if (toBonusHand && config.pointsThreshold > 0) {
      let spendable = next.points
      while (spendable >= config.pointsThreshold && next.bonus.length + (next.armed ? 1 : 0) < BONUS_HAND_MAX) {
        spendable -= config.pointsThreshold
        const card = drawOffer(pool, drawTier(config.tierWeights, rng), mode, rng, 1, weights)[0]
        if (!card) continue
        next = { ...next, points: next.points - config.pointsThreshold }
        if (needsNoPress(card)) receive(card)
        else {
          next = { ...next, bonus: [...next.bonus, toHeld(card, nextUid())] }
          drawn.push(card)
        }
      }
    }
    if (got.length > 0) result.awarded.push({ seat: s.seat, cards: got })
    if (drawn.length > 0) result.bonusAwarded.push({ seat: s.seat, cards: drawn })

    result.seats.set(s.seat, {
      ...next, farmHandsLeft: farmHandsOf(next.cards), frozenNextHand: frozenMark, blindfoldedNextHand: blindMark,
    })
  }
  return result
}
