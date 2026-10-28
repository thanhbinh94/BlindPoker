import type { Rng } from '../cards/rng.js'
import type { BlindRules } from '../hand/types.js'
import { drawOffer, drawTier } from './draw.js'
import { needsNoPress, returnToBonus } from './bonus.js'
import { rollFortuneDice } from './dice.js'
import { carpOf, chargeCarp, countReigns, crownDemigod, reignCrit, reignEffect } from './god.js'
import { farmHandsOf, liftTier, receiveCard, tierFromParam, toHeld } from './hold.js'
import { stealPoints, type ChaosSteal } from './steal.js'
import {
  BONUS_HAND_MAX, EMPTY_CHAOS_TABLE,
  type ChaosBomb, type ChaosCardDef, type ChaosConfig, type ChaosCredit, type ChaosCritMultiplier, type ChaosDebit, type ChaosDiceResult,
  type ChaosHandOutcomes, type ChaosHandPlan, type ChaosMark, type ChaosMode,
  type ChaosEffectKind, type ChaosSeat, type ChaosTableState, type ChaosTier, type HeldCard, type PlannedEffect,
} from './types.js'

export interface AfterHandSeat {
  seat: number
  /** Who sits there (BP-41: kept on a Bán Thần's reign). Absent = ''. */
  playerId?: string
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
  /**
   * BP-41 §5: each Xúc xắc vận may rolled at the end of this hand, in order, for the room's public `CHAOS_DICE` (it adds
   * the seat's stack after the debits). `result` names prize cards by tier and count only (A7).
   */
  dice: { seat: number; cardId: string; uid: number; dice: number[]; result: ChaosDiceResult }[]
  /** BP-41 Trộm điểm cards the seats received here (prizes, bonus cards), resolved over the seats given (`stealPoints`). */
  steals: ChaosSteal[]
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
 *   on a lost hand — flat, never doubled; Cao thủ (unless idle) is spent by a won or lost hand, `points` on a win;
 *   a fired Mạo hiểm gia leaves on a win, else steps its stake on (`charge` + 1); a `noFold` mark (Cấm bỏ bài) becomes
 *   `noFoldNextHand`, which lasts the table's next hand only.
 * - BP-41 Task 5c (unless idle): a held Mạo hiểm gia's win pays its jackpot (`chaos_jackpot`) and chaos points; Bạo kích,
 *   Liều ăn nhiều (×3/×4/×5) and Xúc xắc định mệnh (`outcomes.fateCrit`) crit on a win with `net` > 0, the highest one
 *   only (Ruling 6); each held Xúc xắc vận may rolls (`dice`): chaos points, prize cards (a human's to the bonus hand,
 *   dropped when full — A7, Ruling 3), a lost wager as a `ChaosDebit` (at most the stack), a jackpot as a credit; a held
 *   Nâng tầm uy lực lifts the tier of the seat's next card drawn here and is spent (`liftTier`); a Trộm điểm received
 *   here is resolved over the seats given once all are settled (`steals`).
 * - BP-41 Task 6 (§4): every reign has a hand fewer and the Thần's curse ends after its first hands (`countReigns`); a
 *   Thần the engine saw beaten (`outcomes.dethroned`) falls, and each seat that beat it takes `slayCards` Kim cương
 *   cards (the prize path above); unless idle, a held Cá chép hóa rồng (not the Thần's) gains energy on a lost hand and
 *   makes its seat a Bán Thần on a won one (the card spent, the reign from the next hand); the Thần and a Bán Thần whose
 *   powers acted crit on a win with the other sources (the highest only).
 * The input is never changed; every draw goes through `rng` and `weights`.
 *
 * BP-41 A3: `table` is the table's chaos state as `planHand` returned it (absent = `EMPTY_CHAOS_TABLE`), and `outcomes`
 * what the engine recorded in `ChaosHandState.outcomes`; the result's `table` is the state for the next hand — the bombs
 * this hand played counted down, the ones it planted added (`countBombs`). The points the round-three cards move between
 * players (duels, Ép chia thưởng, Thuế thắng, the bombs) moved in the engine already (`payTransfers`): `net` and
 * `stackAfter` include them.
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
  const table = input.table ?? EMPTY_CHAOS_TABLE
  const result: AfterHandResult = {
    seats: new Map(), credits: [], debits: [], table: countReigns(countBombs(table, plan, input.outcomes), plan, input.outcomes), awarded: [], bonusAwarded: [],
    dice: [], steals: [],
  }
  /** BP-41 §4.2: the Thần reigning through this hand (its own Cá chép cards wait), and the seats that beat it. */
  const reigning = table.god?.seat
  const slain = plan.god ? (input.outcomes?.dethroned ?? []) : []
  /** Trộm điểm cards received below, resolved once every seat is settled (they act on another seat). */
  const thefts: { seat: number; card: ChaosCardDef }[] = []
  // BP-41 Mồi lửa: every seat at the table — in the hand or sitting it out — takes each fired one's points (spec §6.3
  // "mọi người ngồi bàn", Ruling 24).
  const kindling = plan.seats.reduce((sum, p) => sum + p.effects.reduce((n, e) => n + (e.effect === 'kindling' ? (e.params.points ?? 0) : 0), 0), 0)

  for (const s of input.seats) {
    const chaos = s.chaos
    const frozenMark = marks.some((m) => m.seat === s.seat && m.kind === 'freeze')
    const blindMark = marks.some((m) => m.seat === s.seat && m.kind === 'blindfold')
    const noFoldMark = marks.some((m) => m.seat === s.seat && m.kind === 'noFold')
    if (!s.inHand) {
      // BP-41 Cấm bỏ bài is for the table's next hand only: a seat that sat that hand out is free again (Ruling 5a-5).
      // Mồi lửa reaches it all the same: "mọi người ngồi bàn mỗi ván +1" (spec §6.3, Ruling 24).
      const freed = chaos.noFoldNextHand ? withoutNoFold(chaos) : chaos
      const kept = kindling > 0 ? { ...freed, points: freed.points + kindling } : freed
      result.seats.set(s.seat, frozenMark || blindMark
        ? { ...kept, frozenNextHand: chaos.frozenNextHand || frozenMark, blindfoldedNextHand: chaos.blindfoldedNextHand || blindMark }
        : kept)
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
    // BP-41 Mạo hiểm gia (Task 5a): "tới khi thắng" — a win ends it and pays its jackpot (Task 5c: `jackpot` × the fixed
    // wager as new points, `points` chaos points, flat) — only for a card the seat held, never a roll; any other hand it
    // played moves its stake one step on (×2 → ×4 …); its `hands` count it out after the 5th.
    const adventurer = firedKind('adventurer')
    if (adventurer && outcome === 'win') {
      cards = cards.filter((c) => c.uid !== adventurer.uid)
      if (chaos.cards.some((c) => c.uid === adventurer.uid)) {
        const amount = (adventurer.params.jackpot ?? 0) * wager
        if (amount > 0) result.credits.push({ seat: s.seat, amount, reason: 'chaos_jackpot', cardId: adventurer.cardId, uid: adventurer.uid })
        points += adventurer.params.points ?? 0
      }
    } else if (adventurer) cards = cards.map((c) => (c.uid === adventurer.uid ? { ...c, charge: (c.charge ?? 0) + 1 } : c))
    // BP-41 §4.1 Cá chép hóa rồng (unless idle; the Thần's own wait): a lost hand charges it +`stepMin`..`stepMax` %, a won
    // one ("thắng khi chưa hóa thần") spends it and makes the seat a Bán Thần from the next hand.
    const carp = idle || s.seat === reigning ? undefined : carpOf(chaos)
    if (carp && outcome === 'loss') cards = cards.map((c) => (c.uid === carp.uid ? chargeCarp(c, rng) : c))
    else if (carp && outcome === 'win') {
      cards = cards.filter((c) => c.uid !== carp.uid)
      result.table = crownDemigod(result.table, carp, s.seat, s.playerId ?? '', s.isBot)
    }

    const prizes: { tier: ChaosTier; count: number }[] = []
    /**
     * BP-41 prize cards, one tier per card (A7: a human's go to the private bonus hand, dropped when it is full): Xúc xắc
     * vận may's, and the Kim cương cards of a seat that beat the Thần (§4.2, `slayCards`).
     */
    const dicePrizes: ChaosTier[] = []
    if (!idle) {
      // Bạo kích (BP-37), Liều ăn nhiều (×3/×4/×5 on `p3`/`p4`/`p5`) and Xúc xắc định mệnh's 5–6 (× `multiplier`) each
      // pay (k − 1) × net on a win with `net` > 0. Two of them never multiply (Ruling 6): each rolls, in that order, and
      // only the highest multiplier pays (the first on a tie). Each rolls only when it fired, so a hand without the
      // round-three cards draws as before.
      const crits: { k: number; e: PlannedEffect }[] = []
      if (outcome === 'win' && s.net > 0) {
        const crit = firedKind('crit')
        if (crit) {
          const r = rng.int(100)
          const p3 = crit.params.p3 ?? 0
          crits.push({ k: r < p3 ? 3 : r < p3 + (crit.params.p2 ?? 0) ? 2 : 0, e: crit })
        }
        if (risky) {
          const r = rng.int(100)
          const p5 = risky.params.p5 ?? 0
          const p4 = p5 + (risky.params.p4 ?? 0)
          crits.push({ k: r < p5 ? 5 : r < p4 ? 4 : r < p4 + (risky.params.p3 ?? 0) ? 3 : 0, e: risky })
        }
        const fate = firedKind('fateDie')
        if (fate && input.outcomes?.fateCrit?.includes(s.seat)) crits.push({ k: fate.params.multiplier ?? 2, e: fate })
        // BP-41 §4.2–§4.3: the Thần (×2/×3/×4) and a Bán Thần (×2/×3) whose powers acted this hand.
        if (plan.god?.seat === s.seat) crits.push({ k: reignCrit('god', plan.god.params, rng), e: reignEffect(plan.god) })
        const demigod = plan.demigods?.find((d) => d.seat === s.seat)
        if (demigod) crits.push({ k: reignCrit('demigod', demigod.params, rng), e: reignEffect(demigod) })
      }
      // On a tie the round-three source is credited — Liều ăn nhiều, Xúc xắc định mệnh, a reign — before Bạo kích, so the card
      // that promised the crit is the one the toast names (Ruling 17). The rolls above keep their order (same draws).
      const ranked = [...crits.filter((c) => c.e.effect !== 'crit'), ...crits.filter((c) => c.e.effect === 'crit')]
      const best = ranked.reduce<{ k: number; e: PlannedEffect } | null>((b, c) => (c.k >= 2 && (b === null || c.k > b.k) ? c : b), null)
      if (best) {
        const k = Math.min(5, best.k) as ChaosCritMultiplier
        result.credits.push({ seat: s.seat, amount: (k - 1) * s.net, reason: 'chaos_crit', cardId: best.e.cardId, uid: best.e.uid, multiplier: k })
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

      // BP-41 §5 Xúc xắc vận may (Ruling 5): every one the seat held through the hand rolls now, won, lost or carried
      // over, once, and leaves; one received below waits for the next hand the seat plays. Chaos points are flat; a lost
      // wager is a debit (the sink) of at most what the stack still has; a jackpot is a credit (new points); prize cards
      // follow the bonus-card rule below.
      let debited = 0
      for (const die of cards.filter((c) => c.effect === 'fortuneDice')) {
        const roll = rollFortuneDice(die.params, rng)
        const res: ChaosDiceResult = {}
        if (roll.points > 0) {
          points += roll.points
          res.points = roll.points
        }
        if (roll.cards.length > 0) {
          res.cards = roll.cards
          for (const c of roll.cards) for (let i = 0; i < c.count; i++) dicePrizes.push(c.tier)
        }
        if (roll.lose > 0) {
          const amount = Math.min(roll.lose * wager, Math.max(0, s.stackAfter - debited))
          debited += amount
          res.burned = amount
          if (amount > 0) result.debits.push({ seat: s.seat, amount, reason: 'chaos_dice', cardId: die.cardId, uid: die.uid })
        }
        if (roll.jackpot > 0) {
          res.jackpot = roll.jackpot * wager
          result.credits.push({ seat: s.seat, amount: res.jackpot, reason: 'chaos_jackpot', cardId: die.cardId, uid: die.uid })
        }
        if (roll.triple) res.triple = true
        if (roll.herald) res.herald = true
        result.dice.push({ seat: s.seat, cardId: die.cardId, uid: die.uid, dice: roll.dice, result: res })
        cards = cards.filter((c) => c.uid !== die.uid)
      }
    }
    // BP-41 §4.2 "hạ Thần": each seat that beat the Thần takes `slayCards` random Kim cương cards, frozen or not.
    if (plan.god && slain.includes(s.seat)) for (let i = 0; i < (plan.god.params.slayCards ?? 2); i++) dicePrizes.push('diamond')

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
    const drawn: ChaosCardDef[] = []
    /** A human's card to its private bonus hand, told to it alone (`bonusAwarded`). */
    const bank = (card: ChaosCardDef): void => {
      next = { ...next, bonus: [...next.bonus, toHeld(card, nextUid())] }
      drawn.push(card)
    }
    /**
     * BP-41 Nâng tầm uy lực: the seat's next card drawn here (a prize, a bonus card) is drawn a tier up. The card is spent
     * only when that card is kept — received or banked (`spend`, called first) — not when the tier had no card or the
     * bonus hand was full and the card was dropped (5c M2).
     */
    const draw = (tier: ChaosTier): { card: ChaosCardDef | undefined; spend: () => void } => {
      const r = liftTier(next, tier)
      const card = drawOffer(pool, r.tier, mode, rng, 1, weights)[0]
      const spend = (): void => {
        const used = r.spent
        if (used) next = { ...next, cards: next.cards.filter((x) => x.uid !== used.uid) }
      }
      return { card, spend }
    }
    const give = (tier: ChaosTier): void => {
      const { card, spend } = draw(tier)
      if (!card) return
      spend()
      receive(card)
    }
    const hasRoom = (): boolean => next.bonus.length + (next.armed ? 1 : 0) < BONUS_HAND_MAX
    for (const p of prizes) for (let i = 0; i < p.count; i++) give(p.tier)
    // The dice's prize cards (A7): a bot's act at once; a human's go to its private bonus hand, or to the seat when they
    // need no press, and one that finds the bonus hand full is dropped (Ruling 3). They come before the points' bonus
    // cards, which wait as points when the hand is full.
    for (const tier of dicePrizes) {
      if (s.isBot) {
        give(tier)
        continue
      }
      const { card, spend } = draw(tier)
      if (!card) continue
      if (needsNoPress(card)) {
        spend()
        receive(card)
      } else if (hasRoom()) {
        spend()
        bank(card)
      }
    }
    if (!frozen) {
      for (let i = 0; i < pendingBonus; i++) give(drawTier(config.tierWeights, rng))
      next = { ...next, pendingBonus: 0 }
    }

    // The bonus hand holds at most BONUS_HAND_MAX cards, the armed one included; when it is full the points wait. A card
    // that needs no press goes to the seat as today and takes no room. Only the points the hand ended with convert: a
    // Tích lũy drawn here adds points for a later hand, so a low threshold cannot loop. A draw that finds no card (an
    // empty tier) costs nothing.
    if (toBonusHand && config.pointsThreshold > 0) {
      let spendable = next.points
      while (spendable >= config.pointsThreshold && hasRoom()) {
        spendable -= config.pointsThreshold
        const { card, spend } = draw(drawTier(config.tierWeights, rng))
        if (!card) continue
        spend()
        next = { ...next, points: next.points - config.pointsThreshold }
        if (needsNoPress(card)) receive(card)
        else bank(card)
      }
    }
    if (got.length > 0) result.awarded.push({ seat: s.seat, cards: got })
    if (drawn.length > 0) result.bonusAwarded.push({ seat: s.seat, cards: drawn })
    for (const card of got) if (card.effect === 'stealPoints') thefts.push({ seat: s.seat, card })

    result.seats.set(s.seat, {
      ...withoutNoFold(next), farmHandsLeft: farmHandsOf(next.cards), frozenNextHand: frozenMark, blindfoldedNextHand: blindMark,
      ...(noFoldMark ? { noFoldNextHand: true as const } : {}),
    })
  }
  // BP-41 Trộm điểm received here acts once every seat is settled, over the seats given, in the order received; it is
  // not held, so it gets its uid now.
  // A shield stands against it as `planHand` would stand it (5c M4): with hands left, in a mode the card allows.
  const defs = new Map(pool.map((c) => [c.id, c]))
  const validHere = (cardId: string): boolean => defs.get(cardId)?.modes.includes(mode) ?? true
  for (const t of thefts) {
    const r = stealPoints({ seats: result.seats, holder: t.seat, card: { cardId: t.card.id, uid: nextUid(), params: t.card.params }, rng, validHere })
    result.seats = r.seats
    result.steals.push(r.steal)
  }
  return result
}

/**
 * BP-41 Bom nổ chậm (Task 5b) after a hand that settled: each bomb this hand played (`plan.bombs`) has a hand fewer and
 * leaves at 0 (it went off in the engine, the carrier paying the owner); one whose owner sat the hand out waits; each
 * planted this hand joins with `fuse` − 1 hands left (the plant hand was its first). The table is returned as it came
 * when no bomb played or was planted.
 */
function countBombs(table: ChaosTableState, plan: ChaosHandPlan, outcomes: ChaosHandOutcomes | undefined): ChaosTableState {
  const played = new Set((plan.bombs ?? []).map((b) => b.uid))
  const planted = outcomes?.planted ?? []
  if (played.size === 0 && planted.length === 0) return table
  const bombs: ChaosBomb[] = [
    ...table.bombs.map((b) => (played.has(b.uid) ? { ...b, handsLeft: b.handsLeft - 1 } : b)),
    ...planted.map((b) => ({ owner: b.owner, carrier: b.carrier, handsLeft: b.fuse - 1, cardId: b.cardId, uid: b.uid, wagers: b.wagers })),
  ].filter((b) => b.handsLeft > 0)
  return { ...table, bombs }
}

/** The seat without its Cấm bỏ bài mark (the hand it was for is over). */
function withoutNoFold(seat: ChaosSeat): ChaosSeat {
  if (seat.noFoldNextHand === undefined) return seat
  const { noFoldNextHand: _gone, ...rest } = seat
  return rest
}
