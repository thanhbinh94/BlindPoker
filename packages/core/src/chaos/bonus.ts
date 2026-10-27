import { stackRule } from './hold.js'
import type { ArmedBonus, ChaosCardDef, ChaosEffectKind, ChaosHandPlan, ChaosSeat, HeldCard } from './types.js'

/**
 * The bonus hand (BP-39, spec 2026-10-27 §3.4): bonus cards wait in the player's hand, private, until the player presses
 * "Dùng" on one. This file holds the rules of pressing; `planHand` fires an armed card and `afterHand` removes or returns
 * it.
 */

/**
 * The one-shot reveal cards a player may press during the play/fold choice for this hand's reveal (spec §3.4: debuffs,
 * board re-deals, borrowed cards). Bảo hiểm and Bạo kích pressed mid-hand apply from the next hand (Ruling 3).
 */
export const MID_HAND_EFFECTS: ReadonlySet<ChaosEffectKind> = new Set(['stealHole', 'lowerHole', 'swapHands', 'redealBoard', 'borrowHole'])

/**
 * Cards that need no press (Cấp cứu, Thần tài, Khiên, Gương wait for their condition; Tích lũy, Cấp độ act on receipt):
 * as bonus cards they go straight to the seat through `receiveCard`, never into the bonus hand.
 */
export const needsNoPress = (def: Pick<ChaosCardDef, 'timing'>): boolean => def.timing === 'wait' || def.timing === 'now'

/**
 * An armed card that fires from `armed` in its hand's plan and stays there until `afterHand` sees whether it was used:
 * the one-shot reveal cards and the decision cards (Nhìn trộm, Bỏ không mất). Every other card (deal-time cards,
 * duration reveal cards such as Bảo hiểm and Bạo kích) joins the seat's `cards` at plan time and is used from then on.
 */
export const firesFromArmed = (card: Pick<HeldCard, 'timing' | 'handsLeft'>): boolean =>
  card.timing === 'decision' || (card.timing === 'reveal' && card.handsLeft === null)

/** The bonus hand with `card` put back where it was: bonus cards are received in uid order. */
export function returnToBonus(bonus: readonly HeldCard[], card: HeldCard): HeldCard[] {
  const out = bonus.slice()
  const i = out.findIndex((c) => c.uid > card.uid)
  out.splice(i < 0 ? out.length : i, 0, card)
  return out
}

/**
 * What a hand that never settled (cancelled, spec §3.4) leaves behind: a card armed for it goes back to the bonus hand
 * unfired and the "played" marker is cleared. A card whose uid is in `recorded` (the table was told of it before the
 * hand was cancelled) is spent instead: putting it back would tell every viewer what the private hand holds (I1). The
 * room calls it as soon as a hand is cancelled (M4); `planHand` calls it again for a hand that never reached that path.
 * Returns the same object when nothing changes.
 */
export function clearUnsettledHand(seat: ChaosSeat, recorded: ReadonlySet<number> = new Set()): ChaosSeat {
  let out = seat
  if (out.armed?.hand === 'this') {
    const card = out.armed.card
    out = { ...out, bonus: recorded.has(card.uid) ? out.bonus : returnToBonus(out.bonus, card), armed: null }
  }
  if (out.bonusPlayedThisHand) out = { ...out, bonusPlayedThisHand: false }
  return out
}

/**
 * Whether a card of `effect` can join this hand's reveal on a seat whose live plan is `planSeat`: a one-shot reveal card
 * (`MID_HAND_EFFECTS`), on a seat that has fired no deal-time debuff (freeze, blindfold: one debuff per seat per hand) and
 * plans no effect of the same kind (A2). A planned reveal debuff is no conflict: the played one replaces it.
 */
export function canInsertThisHand(planSeat: Pick<ChaosHandPlan['seats'][number], 'effects'> | undefined, effect: ChaosEffectKind): boolean {
  if (!MID_HAND_EFFECTS.has(effect)) return false
  const effects = planSeat?.effects ?? []
  return !effects.some((e) => (e.debuff && e.timing === 'deal') || e.effect === effect)
}

export type ArmWhen =
  | { phase: 'between' }
  | { phase: 'decision'; frozen: boolean; planSeat?: ChaosHandPlan['seats'][number] }

export type ArmError = 'NO_CARD' | 'ALREADY_ARMED' | 'FROZEN' | 'WEAKER_HELD'

/**
 * The player presses "Dùng" on bonus card `uid`: it leaves `bonus` for `armed`. One armed card at a time — the "one bonus
 * card per hand" limit, counted on the hand it applies to. `hand: 'this'` only during the play/fold choice, when no bonus
 * card was played into this hand yet (`bonusPlayedThisHand`) and `canInsertThisHand` allows it on the live plan seat
 * (`planSeat`); otherwise `'next'`. Refused: a uid not in
 * the bonus hand, a seat frozen this hand (spec §3.4), and a duration card weaker than the held one of the same effect,
 * which the stacking rule would drop (Ruling 2). The input seat is never changed.
 */
export function armBonus(seat: ChaosSeat, uid: number, when: ArmWhen): { seat: ChaosSeat; armed: ArmedBonus } | { error: ArmError } {
  const card = seat.bonus.find((c) => c.uid === uid)
  if (!card) return { error: 'NO_CARD' }
  if (seat.armed) return { error: 'ALREADY_ARMED' }
  if (when.phase === 'decision' && when.frozen) return { error: 'FROZEN' }
  if (card.handsLeft !== null && stackRule(seat.cards, card).kind === 'drop') return { error: 'WEAKER_HELD' }

  const hand: ArmedBonus['hand'] =
    when.phase === 'decision' && !seat.bonusPlayedThisHand && canInsertThisHand(when.planSeat, card.effect) ? 'this' : 'next'
  const armed: ArmedBonus = { card, hand }
  return { seat: { ...seat, bonus: seat.bonus.filter((c) => c.uid !== uid), armed }, armed }
}
