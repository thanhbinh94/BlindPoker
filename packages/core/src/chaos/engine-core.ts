import { rankOf, type Card } from '../cards/cards.js'
import type { GameEvent, HandState } from '../hand/types.js'
import type { ChaosEffectKind, ChaosHandState, ChaosOutcome, PlannedEffect } from './types.js'

/**
 * What every chaos applier shares (`engine.ts`, `engine-round3.ts`): the deck reserve, the plan lookups, the record of
 * one effect, the immunity rule and the debuff resolver (shields, mirrors, one debuff per seat). Server-side only.
 */

/**
 * Cards a deal-time draw must leave in the deck: the 5-card board plus a full storm re-deal (spec §3.5, amendment).
 * BP-41 A9 raised it to 11 for the sixth board card; Ruling (Task 3a): only a hand that has the sixth card keeps the
 * extra one (`reserveOf`), so every hand without it draws exactly as before.
 */
export const DEAL_RESERVE = 10
export const reserveOf = (state: HandState): number => DEAL_RESERVE + (state.chaos?.sixthBoard ? 1 : 0)

export type Applied = Extract<GameEvent, { type: 'CHAOS_APPLIED' }>
/** What an effect's `CHAOS_APPLIED` carries besides its outcome, and whether its card is used up. */
export interface RecordExtra {
  community?: Card[]
  amount?: number
  holeDelta?: number
  wild?: Card
  off?: string
  consume?: 'applied' | 'blocked' | null
}

export const remaining = (state: HandState): number => state.deck.length - state.deckIndex
/**
 * BP-41 spec §3 "thiếu lá": a deal-time draw of `n` cards acts only when the deck keeps its reserve afterwards; else the
 * card fizzles ("không có tác dụng"), as every re-deal card always has.
 */
export const canDealAtDeal = (state: HandState, n: number): boolean => remaining(state) - n >= reserveOf(state)
export const effectsOf = (chaos: ChaosHandState, seat: number): PlannedEffect[] => chaos.plan.seats.find((s) => s.seat === seat)?.effects ?? []
export const effectOf = (chaos: ChaosHandState, seat: number, kind: ChaosEffectKind): PlannedEffect | undefined =>
  effectsOf(chaos, seat).find((e) => e.effect === kind)
export const addUid = (list: number[], uid: number): void => {
  if (!list.includes(uid)) list.push(uid)
}
export const lowestIndex = (cards: readonly Card[]): number => cards.reduce((lo, c, i) => (rankOf(c) < rankOf(cards[lo]!) ? i : lo), 0)
export const highestIndex = (cards: readonly Card[]): number => cards.reduce((hi, c, i) => (rankOf(c) > rankOf(cards[hi]!) ? i : hi), 0)

/**
 * BP-41 spec §3 "miễn nhiễm rút bài" — the one immunity predicate. A seat it names is out of reach this hand of every
 * effect that takes, lowers, swaps, shuffles, redeals, curses or plunders its hole cards (Liều ăn nhiều while it lasts,
 * Đảo bài on a −1 hand: `ChaosHandState.immune`). Every such applier asks this, and only this: Task 6 extends it for the
 * Thần.
 */
export const isImmune = (chaos: ChaosHandState, seat: number): boolean => chaos.immune?.includes(seat) ?? false

/**
 * Moves the undealt card at `at` to the deck's dealt end and returns it: the deck stays all 52 cards and the deal goes on
 * from the rest (the Aces rule, Lời nguyền's 2).
 */
export function takeFromDeck(state: HandState, at: number): Card {
  const [card] = state.deck.splice(at, 1)
  state.deck.splice(state.deckIndex, 0, card!)
  state.deckIndex += 1
  return card!
}

/** Records one effect's result: its event, its line in the summary, and whether its card is used up. */
export function record(chaos: ChaosHandState, events: GameEvent[], seat: number, e: PlannedEffect, targets: number[], outcome: ChaosOutcome, extra: RecordExtra = {}): void {
  const ev: Applied = { type: 'CHAOS_APPLIED', seat, cardId: e.cardId, effect: e.effect, targets, outcome }
  if (extra.community) ev.community = extra.community
  if (extra.amount !== undefined) ev.amount = extra.amount
  if (extra.holeDelta !== undefined) ev.holeDelta = extra.holeDelta
  if (extra.wild !== undefined) ev.wild = extra.wild
  if (extra.off !== undefined) ev.off = extra.off
  events.push(ev)
  chaos.used.push({ seat, cardId: e.cardId, effect: e.effect, outcome, targets: targets.slice() })
  addUid(chaos.recorded, e.uid)
  const consume = extra.consume === undefined ? 'applied' : extra.consume
  if (consume === 'applied') addUid(chaos.applied, e.uid)
  else if (consume === 'blocked') addUid(chaos.blocked, e.uid)
}

/** What a debuff's harm returns: whether anything changed, or (it did) what its event adds. */
export type DebuffHarm = boolean | RecordExtra

/**
 * Resolves one debuff aimed at `target`: a seat already hit this hand lets it fizzle (the card is still used); a
 * shield blocks it (a one-shot shield is spent on it); a mirror turns it back on its user when the user has taken no
 * debuff yet (otherwise it blocks); else it lands. `apply(victim)` does the harm and says whether anything changed.
 * A reflected debuff is not shielded again, so two mirrors cannot bounce it forever.
 */
export function resolveDebuff(state: HandState, events: GameEvent[], user: number, e: PlannedEffect, target: number, apply: (victim: number) => DebuffHarm): void {
  const chaos = state.chaos!
  if (chaos.hit.includes(target)) {
    record(chaos, events, user, e, [target], 'fizzled')
    return
  }
  if (spendShield(chaos, target)) {
    const shield = chaos.plan.seats.find((s) => s.seat === target)!.shield!
    if (shield.kind === 'mirror' && user !== target && !chaos.hit.includes(user)) {
      chaos.hit.push(user)
      const harm = apply(user)
      record(chaos, events, user, e, [target], 'reflected', typeof harm === 'object' ? harm : {})
      return
    }
    record(chaos, events, user, e, [target], 'blocked', { consume: 'blocked' })
    return
  }
  chaos.hit.push(target)
  const harm = apply(target)
  record(chaos, events, user, e, [target], harm === false ? 'fizzled' : 'applied', typeof harm === 'object' ? harm : {})
}

/** Whether `seat` has a shield or mirror standing this hand (a one-shot one not spent yet). */
export const shieldUp = (chaos: ChaosHandState, seat: number): boolean => {
  const shield = chaos.plan.seats.find((s) => s.seat === seat)?.shield ?? null
  return shield !== null && !chaos.shieldSpent.includes(seat)
}

/**
 * Whether `seat` has a shield or mirror standing this hand; when it does, a one-shot one is spent (its uid joins
 * `blocked`). The caller decides what the shield does: block, or (a mirror, on a one-seat debuff) reflect.
 */
export function spendShield(chaos: ChaosHandState, seat: number): boolean {
  if (!shieldUp(chaos, seat)) return false
  const shield = chaos.plan.seats.find((s) => s.seat === seat)!.shield!
  if (!shield.lasting) {
    chaos.shieldSpent.push(seat)
    addUid(chaos.blocked, shield.uid)
  }
  return true
}

/**
 * `resolveDebuff` for an effect on hole cards (spec §3 "miễn nhiễm rút bài"): an immune target lets it fizzle — the card
 * is spent, the seat is not counted hit, its shield is not touched (Task 3a Ruling 7) — and a mirror turning it back on
 * an immune user changes nothing.
 */
export function resolveHoleDebuff(state: HandState, events: GameEvent[], user: number, e: PlannedEffect, target: number, apply: (victim: number) => DebuffHarm): void {
  const chaos = state.chaos!
  if (isImmune(chaos, target)) {
    record(chaos, events, user, e, [target], 'fizzled')
    return
  }
  resolveDebuff(state, events, user, e, target, (victim) => !isImmune(chaos, victim) && apply(victim))
}
