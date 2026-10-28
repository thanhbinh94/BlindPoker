import { rankOf, suitOf, type Card } from '../cards/cards.js'
import type { Rng } from '../cards/rng.js'
import type { Pot } from '../betting/pots.js'
import { dealCards, seatsClockwiseFrom, type SettleHooks } from '../hand/common.js'
import type { GameEvent, HandPlayer, HandState } from '../hand/types.js'
import { canInsertThisHand } from './bonus.js'
import {
  DEAL_RESERVE, addUid, canDealAtDeal, effectOf, effectsOf, evaluateChaosSeat, lowestIndex, record, remaining, reserveOf, resolveDebuff,
  takeFromDeck,
} from './engine-core.js'
import { applyHoleDebuffs, emitHawkEyes, recordEclipse, resolveSpoilers } from './engine-round3.js'
import { recordBackfires } from './engine-reveal.js'
import { markNoFold } from './engine-stake.js'
import type { ChaosEffectKind, ChaosHandPlan, ChaosHandState, ChaosOutcome, PlannedEffect } from './types.js'

export { DEAL_RESERVE, isImmune } from './engine-core.js'
export { applyRevealEffects } from './engine-reveal.js'

/**
 * The chaos effect appliers of a Blind hand (spec 2026-10-26 §3.5), called from `hand/blind.ts` at the deal, the
 * decision round and the reveal, and from `settle` through `chaosSettleHooks`. Every function here is a no-op for a
 * hand without `state.chaos`; the Blind engine only calls them when the hand has a plan. What the appliers share lives
 * in `engine-core.ts`; BP-41's hole-card debuffs, Kẻ phá đám, Nhật thực's event and Mắt diều hâu in `engine-round3.ts`.
 */

/**
 * Deal-time effects told only to their owner (and, for a debuff, its targets) when they happen: the table learns of
 * them from `CHAOS_SUMMARY` at the settlement. `reverseRank` is the one deal-time card the whole table is told at once,
 * and BP-41's Lá chung thứ sáu is public too (the river shows it), as is Nhật thực (every other seat's cards are off).
 * BP-41 A8 adds Siêu cộng dồn, Lá ma, Liều ăn nhiều, Đảo bài, Hên xui and Cướp đoạt; Task 3b the other two deal-time
 * debuffs, Lời nguyền and Kẻ phá đám (their target is told, as for a freeze).
 */
export const PRIVATE_AT_DEAL: ReadonlySet<ChaosEffectKind> = new Set([
  'swapLowest', 'redealWeak', 'swapAll', 'bestOfN', 'highCard', 'suited', 'extraHole', 'freeze', 'blindfold',
  'acesCharge', 'wildCard', 'riskyHand', 'flipFlop', 'coinFlip', 'plunder', 'curse', 'spoiler',
])

/**
 * The order a seat's deal-time buffs act in. Luck that picks a set comes before the promises that must hold at the end.
 * BP-41: Liều ăn nhiều's sets after "Giữ bộ tốt hơn", and Lá ma last, on the cards the seat ends the deal with.
 */
const DEAL_BUFFS: readonly ChaosEffectKind[] = [
  'swapLowest', 'redealWeak', 'swapAll', 'bestOfN', 'riskyHand', 'bigTable', 'highCard', 'suited', 'extraHole', 'wildCard',
]
/** Deal buffs that would replace a card of a seat Siêu cộng dồn (or the Thần) just dealt its Aces to: they fizzle there. */
const BREAK_ACES: ReadonlySet<ChaosEffectKind> = new Set(['swapLowest', 'suited'])
const DEAL_DEBUFFS: ReadonlySet<ChaosEffectKind> = new Set(['freeze', 'blindfold'])

export function initialChaosState(plan: ChaosHandPlan): ChaosHandState {
  const effects = (kind: ChaosEffectKind) => plan.seats.flatMap((s) => s.effects.filter((e) => e.effect === kind).map((e) => ({ seat: s.seat, e })))
  return {
    plan,
    applied: [],
    blocked: [],
    recorded: [],
    peek: [],
    freeFoldSeats: effects('freeFold').map((x) => x.seat),
    insured: effects('refundStake').map((x) => ({ seat: x.seat, percent: x.e.params.percent ?? 0 })),
    borrowed: [],
    marks: [],
    used: [],
    hit: [],
    shieldSpent: [],
  }
}

/**
 * A bonus card played during the play/fold choice for this hand's reveal (BP-39, spec 2026-10-27 §3.4): its effect joins
 * `seat`'s plan, in place on the live state, so the reveal fires it and settlement sees it among the seat's fired cards
 * (a held Bạo kích reads the same list). When the seat plans a reveal debuff and this one is a debuff, the planned one
 * leaves this hand's plan (its card stays held: its uid is never applied) and the played one takes its place — the
 * pressed debuff fires first. `armBonus` guarantees the rest, which this checks: the effect is a one-shot reveal card,
 * the seat is in the hand, it has fired no deal-time debuff and plans no effect of the same kind.
 */
export function addRevealEffect(state: HandState, seat: number, effect: PlannedEffect): void {
  const chaos = state.chaos
  const planSeat = chaos?.plan.seats.find((s) => s.seat === seat)
  if (!chaos || !planSeat) throw new Error(`addRevealEffect: seat ${seat} is not in this chaos hand`)
  if (!canInsertThisHand(planSeat, effect.effect)) throw new Error(`addRevealEffect: ${effect.cardId} cannot join seat ${seat}'s reveal`)
  if (effect.debuff) planSeat.effects = planSeat.effects.filter((e) => !e.debuff)
  planSeat.effects.push({ ...effect, targets: effect.targets.slice() })
}

/** Blindfolded this hand ("Che mắt" landed last hand): the seat does not see its own cards until the showdown. */
export function isBlindfolded(plan: ChaosHandPlan | undefined, seat: number): boolean {
  return plan?.seats.some((s) => s.seat === seat && s.blindfolded) ?? false
}

// ---------------------------------------------------------------------------------------------------------------------
// The deal

/**
 * Hole-card strength for "keep the better set" (spec §5.3a): the biggest group first (trips, a pair), then the ranks
 * group by group from the top. Never looks at the board.
 */
function holeKey(cards: readonly Card[]): number[] {
  const counts = new Map<number, number>()
  for (const c of cards) counts.set(rankOf(c), (counts.get(rankOf(c)) ?? 0) + 1)
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  return [groups[0]?.[1] ?? 0, ...groups.flatMap(([r, n]) => Array<number>(n).fill(r))]
}
function stronger(a: readonly Card[], b: readonly Card[]): boolean {
  const ka = holeKey(a), kb = holeKey(b)
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) if ((ka[i] ?? -1) !== (kb[i] ?? -1)) return (ka[i] ?? -1) > (kb[i] ?? -1)
  return false
}
const noPair = (cards: readonly Card[]): boolean => new Set(cards.map(rankOf)).size === cards.length
const topRank = (cards: readonly Card[]): number => Math.max(...cards.map(rankOf))

/** One deal-time buff on `p`; returns its outcome (`fizzled` when the reserve or its condition says no). */
function dealBuff(state: HandState, p: HandPlayer, e: PlannedEffect, keepTopRank: number | null, rng: Rng): ChaosOutcome {
  const hole = p.holeCards
  const chaos = state.chaos!
  if (BREAK_ACES.has(e.effect) && chaos.outcomes?.acesDealt?.includes(p.seat)) return 'fizzled'
  switch (e.effect) {
    case 'swapLowest': {
      if (!canDealAtDeal(state, 1)) return 'fizzled'
      hole[lowestIndex(hole)] = dealCards(state, 1)[0]!
      return 'applied'
    }
    case 'redealWeak':
    case 'swapAll': {
      if (!noPair(hole) || topRank(hole) >= (e.params.minRank ?? 0)) return 'fizzled'
      if (!canDealAtDeal(state, hole.length)) return 'fizzled'
      p.holeCards = dealCards(state, hole.length)
      return 'applied'
    }
    // Liều ăn nhiều (BP-41) keeps the best of its `sets` sets of the one-fewer cards it was dealt, as "Giữ bộ tốt hơn";
    // so does Sới lớn's holder (BP-41 §6.2, `sets` 2).
    case 'bestOfN':
    case 'riskyHand':
    case 'bigTable': {
      const extra = Math.max(0, (e.params.sets ?? 1) - 1)
      const n = extra * hole.length
      if (n === 0 || !canDealAtDeal(state, n)) return 'fizzled'
      let best = hole
      for (let s = 0; s < extra; s++) {
        const set = dealCards(state, hole.length)
        if (stronger(set, best)) best = set
      }
      p.holeCards = best.slice()
      return 'applied'
    }
    // The two guaranteed cards draw one card at a time. When the reserve runs out first, the hand goes back to what it
    // was before the effect ("fizzled" changes nothing); the cards drawn on the way stay burned.
    case 'highCard': {
      const min = e.params.minRank ?? 0
      const before = hole.slice()
      while (topRank(hole) < min) {
        if (!canDealAtDeal(state, 1)) {
          p.holeCards = before
          return 'fizzled'
        }
        hole[lowestIndex(hole)] = dealCards(state, 1)[0]!
      }
      return 'applied'
    }
    case 'suited': {
      if (hole.length < 2) return 'fizzled'
      // When "Chất bổ" applied on this seat, a redraw is kept only if the hand still has its high card.
      const min = keepTopRank ?? -1
      const before = hole.slice()
      const ok = (): boolean => suitOf(hole[1]!) === suitOf(hole[0]!) && topRank(hole) >= min
      while (!ok()) {
        if (!canDealAtDeal(state, 1)) {
          p.holeCards = before
          return 'fizzled'
        }
        hole[1] = dealCards(state, 1)[0]!
      }
      return 'applied'
    }
    case 'extraHole': {
      const n = e.params.count ?? 1
      if (!canDealAtDeal(state, n)) return 'fizzled'
      hole.push(...dealCards(state, n))
      return 'applied'
    }
    case 'wildCard': {
      if (hole.length === 0) return 'fizzled'
      ;(chaos.wild ??= []).push({ seat: p.seat, card: hole[rng.int(hole.length)]! })
      return 'applied'
    }
    default:
      return 'fizzled'
  }
}

/**
 * BP-41 spec §3 "Lá A có hạn" (A4): takes `n` cards for one seat out of the undealt deck before the hole cards are
 * dealt — an Ace while one is left, else the highest card left (the first of its rank in deck order). Each card moves
 * to the deck's dealt end, so the deck stays all 52 cards and the deal goes on from the rest.
 */
function takeAces(state: HandState, n: number): Card[] {
  const out: Card[] = []
  for (let k = 0; k < n && remaining(state) > 0; k++) {
    let at = state.deckIndex
    for (let i = state.deckIndex; i < state.deck.length; i++) {
      if (rankOf(state.deck[i]!) > rankOf(state.deck[at]!)) at = i
      if (rankOf(state.deck[at]!) === 12) break
    }
    out.push(takeFromDeck(state, at))
  }
  return out
}

const markImmune = (chaos: ChaosHandState, seat: number): void => addUid((chaos.immune ??= []), seat)

/**
 * The deal of a chaos hand (A4), in place of the plain deal: what decides the hole cards before they are dealt, the
 * deal, then the deal-time cards (`applyDealEffects`). A hand whose plan holds no round-three deal card deals exactly as
 * a plain hand and draws nothing more from `rng`. In order:
 * 1. Lá chung thứ sáu: the board gets a sixth card (the river deals two) when the deck can spare it above the reserve
 *    once every seat is dealt (spec §3 "thiếu lá": else it fizzles); from then on the reserve is 11.
 * 2. Each seat's hole count, clockwise from the button: Liều ăn nhiều −`count`, Đảo bài ±`count` by its phase, Hên xui
 *    ±`count` on a coin of `odds` %. A −1 that would leave no hole card fizzles; a +1 the deck cannot spare above the
 *    reserve fizzles. Liều ăn nhiều, and Đảo bài on a −1 hand, make the seat immune to the steal family this hand.
 * 3. The Aces (spec §3 "Lá A có hạn"): the Thần's first (Task 6 plugs its claim in here, before every other), then each
 *    Siêu cộng dồn, clockwise, that rolls under its charge — all its hole cards (`all`) or `aces` of them — taken out of
 *    the deck before anyone is dealt (`takeAces`). A seat that got them is in `outcomes.acesDealt`.
 * 4. The deal, round by round as a plain hand, each seat up to its count (Aces already in hand count).
 * 5. `applyDealEffects`.
 * Before all of it (BP-41 Task 3b, the plan's second pass): Nhật thực is told (`planHand` already switched every other
 * seat's cards off), then each Kẻ phá đám switches one card of an opponent off for this hand (`resolveSpoilers`), so
 * the card it takes away never acts. Both draw nothing from `rng` when the plan holds neither. Between the two, each
 * Gậy ông đập lưng ông is told (`recordBackfires`, Task 4): it is a rule of the whole hand, so every debuff of another
 * seat from here on — Kẻ phá đám's and the deal's included — turns back on its user (`resolveDebuff`).
 */
export function dealChaosHand(state: HandState, events: GameEvent[], rng: Rng): void {
  const chaos = state.chaos
  if (!chaos) throw new Error('dealChaosHand: not a chaos hand')
  recordEclipse(state, events)
  recordBackfires(state, events)
  resolveSpoilers(state, events, rng)
  const base = state.rules.mode === 'blind' ? state.rules.holeCards : 2
  const order = seatsClockwiseFrom(state, state.button)
  let toDeal = base * order.length

  const sixth = order.flatMap((p) => {
    const e = effectOf(chaos, p.seat, 'sixthBoard')
    return e ? [{ seat: p.seat, e }] : []
  })
  if (sixth.length > 0) {
    const ok = remaining(state) - toDeal >= DEAL_RESERVE + 1
    if (ok) chaos.sixthBoard = true
    // One sixth card for the whole board, however many seats hold the card: each holder's card acted.
    for (const { seat, e } of sixth) record(chaos, events, seat, e, [], ok ? 'applied' : 'fizzled')
  }

  const counts = new Map<number, number>()
  const riskyDelta = new Map<number, number>()
  for (const p of order) {
    let n = base
    const change = (delta: number): ChaosOutcome => {
      if (delta < 0 ? n + delta < 1 : remaining(state) - toDeal - delta < reserveOf(state)) return 'fizzled'
      n += delta
      toDeal += delta
      return 'applied'
    }
    const risky = effectOf(chaos, p.seat, 'riskyHand')
    if (risky) {
      markImmune(chaos, p.seat)
      const delta = -(risky.params.count ?? 1)
      riskyDelta.set(p.seat, change(delta) === 'applied' ? delta : 0)
    }
    const flip = effectOf(chaos, p.seat, 'flipFlop')
    if (flip) {
      const c = flip.params.count ?? 1
      const delta = (flip.charge ?? 0) % 2 === 0 ? c : -c
      if (delta < 0) markImmune(chaos, p.seat)
      record(chaos, events, p.seat, flip, [], change(delta), { holeDelta: delta })
    }
    const coin = effectOf(chaos, p.seat, 'coinFlip')
    if (coin) {
      const c = coin.params.count ?? 1
      const delta = rng.int(100) < (coin.params.odds ?? 50) ? c : -c
      record(chaos, events, p.seat, coin, [], change(delta), { holeDelta: delta })
    }
    counts.set(p.seat, n)
  }

  // Task 6: the Thần's Aces are claimed here, before any Siêu cộng dồn.
  for (const p of order) {
    const e = effectOf(chaos, p.seat, 'acesCharge')
    if (!e) continue
    if (rng.int(100) >= (e.charge ?? 0)) {
      record(chaos, events, p.seat, e, [], 'fizzled')
      continue
    }
    const n = counts.get(p.seat)!
    p.holeCards = takeAces(state, e.params.all ? n : Math.min(e.params.aces ?? 2, n))
    chaos.outcomes = { ...chaos.outcomes, acesDealt: [...(chaos.outcomes?.acesDealt ?? []), p.seat] }
    record(chaos, events, p.seat, e, [], 'applied')
  }

  const rounds = Math.max(...counts.values())
  for (let round = 0; round < rounds; round++) {
    for (const p of order) if (p.holeCards.length <= round && round < counts.get(p.seat)!) p.holeCards.push(...dealCards(state, 1))
  }
  applyDealEffects(state, events, rng, riskyDelta)
}

/**
 * The deal-time cards (spec §3.5.1), once every seat holds its dealt cards and before `CARDS_DEALT`: seat by seat
 * clockwise from the button, each seat's buffs in `DEAL_BUFFS` order, then its freeze or blindfold through the debuff
 * resolver; then every "Thế giới đảo ngược", told to the whole table. `riskyDelta`: the hole cards each Liều ăn nhiều
 * took before the deal (`dealChaosHand`), told with its event. Lá ma tells its owner the wild card, unless the owner is
 * blindfolded (it would show a card the seat must not see).
 */
export function applyDealEffects(state: HandState, events: GameEvent[], rng: Rng, riskyDelta: ReadonlyMap<number, number> = new Map()): void {
  const chaos = state.chaos
  if (!chaos) return
  for (const p of seatsClockwiseFrom(state, state.button)) {
    const effects = effectsOf(chaos, p.seat)
    // The rank "Chất bổ" promised once it applied: "Đồng hoa" after it must not take that card away.
    let keepTopRank: number | null = null
    for (const kind of DEAL_BUFFS) {
      const e = effects.find((x) => x.effect === kind)
      if (!e) continue
      const outcome = dealBuff(state, p, e, keepTopRank, rng)
      if (kind === 'highCard' && outcome === 'applied') keepTopRank = e.params.minRank ?? 0
      if (kind === 'riskyHand') {
        // The card acts (one card fewer, immunity) even when the deck could not spare its extra sets.
        record(chaos, events, p.seat, e, [], 'applied', { holeDelta: riskyDelta.get(p.seat) ?? 0 })
      } else if (kind === 'bigTable') {
        // Sới lớn was told at the ante (`recordStakes`); its sets are part of the same card and tell nothing more.
      } else if (kind === 'wildCard' && outcome === 'applied' && !isBlindfolded(chaos.plan, p.seat)) {
        record(chaos, events, p.seat, e, [], outcome, { wild: chaos.wild!.find((w) => w.seat === p.seat)!.card })
      } else record(chaos, events, p.seat, e, [], outcome)
    }
    for (const e of effects) {
      if (!DEAL_DEBUFFS.has(e.effect)) continue
      const kind = e.effect as 'freeze' | 'blindfold'
      for (const target of e.targets) {
        if (!state.players.some((x) => x.seat === target)) continue
        resolveDebuff(state, events, p.seat, e, target, (victim) => {
          chaos.marks.push({ seat: victim, kind })
          return true
        }, { rng })
      }
    }
  }
  // BP-41: Cướp đoạt and Lời nguyền, once every seat's buffs have acted, on the hole cards each seat ends the deal with.
  applyHoleDebuffs(state, events, rng)
  for (const p of seatsClockwiseFrom(state, state.button)) {
    const e = effectOf(chaos, p.seat, 'reverseRank')
    if (e) record(chaos, events, p.seat, e, [], 'applied')
  }
  // BP-41 Cấm bỏ bài: marks for the next hand, told to the table.
  markNoFold(state, events)
}

// ---------------------------------------------------------------------------------------------------------------------
// The decision round

/**
 * "Nhìn trộm" (spec §3.5.2): each peeking seat sees the next `count` board cards, privately; kept for a reconnect. Then
 * BP-41's Mắt diều hâu (`emitHawkEyes`, which alone draws from `rng`, and only when a seat holds it).
 */
export function emitPeeks(state: HandState, events: GameEvent[], rng: Rng): void {
  const chaos = state.chaos
  if (!chaos || state.phase !== 'DECISION') return
  emitBoardPeeks(state, chaos, events)
  emitHawkEyes(state, events, rng)
}

function emitBoardPeeks(state: HandState, chaos: ChaosHandState, events: GameEvent[]): void {
  for (const p of seatsClockwiseFrom(state, state.button)) {
    const e = effectOf(chaos, p.seat, 'peekBoard')
    if (!e) continue
    const cards = state.deck.slice(state.deckIndex, state.deckIndex + (e.params.count ?? 1))
    chaos.peek.push({ seat: p.seat, cards })
    chaos.used.push({ seat: p.seat, cardId: e.cardId, effect: e.effect, outcome: 'applied', targets: [] })
    addUid(chaos.recorded, e.uid)
    addUid(chaos.applied, e.uid)
    events.push({ type: 'CHAOS_PEEK', seat: p.seat, cards: cards.slice() })
  }
}

/**
 * "Bỏ không mất" (spec §4): a seat holding it that folded takes its ante back out of the pot, before the dead excess
 * is handed back. Returns the events, which the caller tells after `DECISIONS_REVEALED` so they give no fold away early.
 */
export function refundFreeFolds(state: HandState): GameEvent[] {
  const chaos = state.chaos
  const events: GameEvent[] = []
  if (!chaos) return events
  for (const p of seatsClockwiseFrom(state, state.button)) {
    if (!p.folded || !chaos.freeFoldSeats.includes(p.seat) || p.totalCommitted <= 0) continue
    const e = effectOf(chaos, p.seat, 'freeFold')!
    const amount = p.totalCommitted
    p.totalCommitted = 0
    p.betThisStreet = Math.max(0, p.betThisStreet - amount)
    p.stack += amount
    state.pot -= amount
    if (p.stack > 0) p.allIn = false
    record(chaos, events, p.seat, e, [], 'applied', { amount })
  }
  return events
}

// ---------------------------------------------------------------------------------------------------------------------
// The settlement

/**
 * "Bảo hiểm" (spec §4): each insured seat still in that won no pot takes `percent` of what it put in back out of the
 * pots it could have won, from the last side pot back to the main pot, before the pots are paid.
 */
function insure(state: HandState, pots: Pot[], winners: ReadonlySet<number>): GameEvent[] {
  const chaos = state.chaos!
  const events: GameEvent[] = []
  for (const p of seatsClockwiseFrom(state, state.button)) {
    const ins = chaos.insured.find((i) => i.seat === p.seat)
    if (!ins || p.folded || winners.has(p.seat)) continue
    let due = Math.floor((p.totalCommitted * ins.percent) / 100)
    let paid = 0
    for (let i = pots.length - 1; i >= 0 && due > 0; i--) {
      const pot = pots[i]!
      if (!pot.eligibleSeats.includes(p.seat)) continue
      const take = Math.min(due, pot.amount)
      pot.amount -= take
      due -= take
      paid += take
    }
    if (paid <= 0) continue
    p.stack += paid
    state.pot -= paid
    record(chaos, events, p.seat, effectOf(chaos, p.seat, 'refundStake')!, [], 'applied', { amount: paid })
  }
  return events
}

/** The chaos side of `settle` and `carryOverAll`, or undefined for a plain hand. */
export function chaosSettleHooks(state: HandState): SettleHooks | undefined {
  const chaos = state.chaos
  if (!chaos) return undefined
  return {
    reverse: chaos.plan.reverse,
    borrowed: (seat) => chaos.borrowed.find((b) => b.seat === seat)?.card ?? null,
    // A9 / Ruling 4: any number of cards, and Lá ma's wild card while its seat still holds it.
    evaluateSeat: (seat, cards) => evaluateChaosSeat(state, seat, cards),
    beforePayout: (pots, winners) => insure(state, pots, winners),
    beforeSettlement: () => [{ type: 'CHAOS_SUMMARY', used: chaos.used.map((u) => ({ ...u })) }],
  }
}
