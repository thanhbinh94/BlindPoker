import { rankOf, type Card } from '../cards/cards.js'
import type { Rng } from '../cards/rng.js'
import type { HandEvaluation } from '../evaluator/evaluator.js'
import type { GameEvent, HandPlayer, HandState } from '../hand/types.js'
import { evaluateAny, evaluateWild } from './evaluate.js'
import type { ChaosEffectKind, ChaosHandState, ChaosOutcome, ChaosReignKind, ChaosTitles, ChaosTransfer, PlannedEffect } from './types.js'

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

/**
 * Deal-time effects told only to their owner (and, for a debuff, its targets) when they happen: the table learns of
 * them from `CHAOS_SUMMARY` at the settlement. `reverseRank` is the one deal-time card the whole table is told at once,
 * and BP-41's Lá chung thứ sáu is public too (the river shows it), as is Nhật thực (every other seat's cards are off).
 * BP-41 A8 adds Siêu cộng dồn, Lá ma, Liều ăn nhiều, Đảo bài, Hên xui and Cướp đoạt; Task 3b the other two deal-time
 * debuffs, Lời nguyền and Kẻ phá đám (their target is told, as for a freeze); Task 5b Bom nổ chậm's plant (who planted
 * it stays between owner and carrier until the settlement; its going off, which moves points, is public: `filterEvent`
 * lets every event with `transfers` through). Kept here (re-exported by `engine.ts`) so the debuff resolver can give
 * Bia đỡ đạn's hand-off the privacy of the debuff it passes on.
 */
export const PRIVATE_AT_DEAL: ReadonlySet<ChaosEffectKind> = new Set([
  'swapLowest', 'redealWeak', 'swapAll', 'bestOfN', 'highCard', 'suited', 'extraHole', 'freeze', 'blindfold',
  'acesCharge', 'wildCard', 'riskyHand', 'flipFlop', 'coinFlip', 'plunder', 'curse', 'spoiler', 'timeBomb',
])

export type Applied = Extract<GameEvent, { type: 'CHAOS_APPLIED' }>
/** What an effect's `CHAOS_APPLIED` carries besides its outcome, and whether its card is used up. */
export interface RecordExtra {
  /** The only seats `filterEvent` lets the event reach (BP-41 Bia đỡ đạn passing a private deal debuff on). */
  privateTo?: number[]
  community?: Card[]
  amount?: number
  holeDelta?: number
  wild?: Card
  off?: string
  dice?: number[]
  wagers?: number
  stake?: number
  transfers?: ChaosTransfer[]
  /** BP-41 Cá chép hóa rồng: the line tells a reign (on the event and in the summary). */
  reign?: ChaosReignKind
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
 * Đảo bài on a −1 hand: `ChaosHandState.immune`), and the Thần Bài whose powers act this hand (BP-41 §4.2 G11:
 * `plan.god`). Every such applier asks this, and only this.
 */
export const isImmune = (chaos: ChaosHandState, seat: number): boolean => (chaos.immune?.includes(seat) ?? false) || isGodSeat(chaos, seat)

/** BP-41 §4.2: `seat` is the Thần whose powers act this hand. */
export const isGodSeat = (chaos: ChaosHandState, seat: number): boolean => chaos.plan.god?.seat === seat

/** BP-41 A12: adds a title mark for `seat` to this hand's (`ChaosHandState.titles`), merged with the seat's others. */
export function markTitle(chaos: ChaosHandState, seat: number, mark: ChaosTitles): void {
  const titles = (chaos.titles ??= [])
  const row = titles.find((t) => t.seat === seat)
  if (!row) {
    titles.push({ seat, ...mark })
    return
  }
  if (mark.ascended) row.ascended = true
  if (mark.demigod) row.demigod = true
  if (mark.slew) row.slew = (row.slew ?? 0) + mark.slew
}

/**
 * Deals the hole hands of `players` round among them at random, each hand moving whole (Fisher–Yates, one
 * `rng.int(i + 1)` for each i from the last down to 1): Hoán vị định mệnh and the Thần's tráo bài.
 */
export function dealRound(players: readonly HandPlayer[], rng: Rng): void {
  const hands = players.map((p) => p.holeCards)
  for (let i = hands.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    const tmp = hands[i]!
    hands[i] = hands[j]!
    hands[j] = tmp
  }
  players.forEach((p, k) => {
    p.holeCards = hands[k]!
  })
}

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
  if (extra.dice !== undefined) ev.dice = extra.dice.slice()
  if (extra.wagers !== undefined) ev.wagers = extra.wagers
  if (extra.stake !== undefined) ev.stake = extra.stake
  if (extra.privateTo !== undefined) ev.privateTo = extra.privateTo.slice()
  if (extra.transfers !== undefined) ev.transfers = extra.transfers.map((t) => ({ ...t }))
  if (extra.reign !== undefined) ev.reign = extra.reign
  events.push(ev)
  chaos.used.push({ seat, cardId: e.cardId, effect: e.effect, outcome, targets: targets.slice(), ...(extra.reign === undefined ? {} : { reign: extra.reign }) })
  addUid(chaos.recorded, e.uid)
  const consume = extra.consume === undefined ? 'applied' : extra.consume
  if (consume === 'applied') addUid(chaos.applied, e.uid)
  else if (consume === 'blocked') addUid(chaos.blocked, e.uid)
}

/** What a debuff's harm returns: whether anything changed, or (it did) what its event adds. */
export type DebuffHarm = boolean | RecordExtra
/**
 * Does a debuff's harm to `victim`. `target` is the seat the debuff was finally aimed at (after a Bia đỡ đạn moved it):
 * the victim is the target when it lands, and the user when a mirror or Gậy ông đập lưng ông turns it back — a duel
 * needs both to know who challenges whom.
 */
export type DebuffApply = (victim: number, target: number) => DebuffHarm

export interface ResolveOpts {
  /** Bia đỡ đạn picks the seat it hands the debuff to with this; without it no Bia đỡ đạn acts. */
  rng?: Rng
  /** An effect on hole cards (spec §3 "miễn nhiễm rút bài"): an immune seat is never handed it, nor bounced into. */
  holes?: true
  /** Seats a Bia đỡ đạn already passed this debuff on from (never handed it back). */
  passed?: number[]
}

/**
 * BP-41 Gậy ông đập lưng ông: the card that turns a debuff by `user` back on `user` — one another seat fired this hand
 * ("mọi debuff … trừ của bạn"), or undefined. It stands once told (`recordBackfires`: at the deal, or at the reveal for
 * one pressed during the choice), whatever its holder does after: it is a rule of the hand.
 */
export function backfireAgainst(chaos: ChaosHandState, user: number): PlannedEffect | undefined {
  for (const s of chaos.plan.seats) {
    if (s.seat === user) continue
    const e = s.effects.find((x) => x.effect === 'backfire' && chaos.recorded.includes(x.uid))
    if (e) return e
  }
  return undefined
}

/** BP-41 Bia đỡ đạn: `seat`'s scapegoat waiting this hand (exposed by `planHand`), not used yet, or null. */
const scapegoatOf = (chaos: ChaosHandState, seat: number): PlannedEffect | null => {
  const sg = chaos.plan.seats.find((s) => s.seat === seat)?.scapegoat
  if (!sg || chaos.applied.includes(sg.uid)) return null
  return { uid: sg.uid, cardId: sg.cardId, effect: 'scapegoat', params: {}, timing: 'wait', debuff: false, targets: [] }
}

/**
 * Resolves one debuff aimed at `target`, in this order (BP-41 Task 4; BP-37's steps unchanged in between):
 * 1. Gậy ông đập lưng ông (BP-41): when another seat fired one this hand, the debuff turns back on its user before it
 *    reaches anyone (`reflected`, its target named) — unless the user took a debuff already (or is immune to a hole-card
 *    effect), when it fizzles. Nothing shields a bounced debuff.
 * 2. A seat already hit this hand lets it fizzle (the card is still used).
 * 3. A shield blocks it (a one-shot shield is spent on it); a mirror turns it back on its user when the user has taken
 *    no debuff yet (otherwise it blocks). A reflected debuff is not shielded again, so two mirrors cannot bounce it
 *    forever.
 * 4. Bia đỡ đạn (BP-41): the target hands it to another seat at random — still in the hand, not its user, not hit yet,
 *    not immune to a hole-card effect, not a seat it was passed on from — and the card is spent (its own event names the
 *    new target, private to the three seats involved when the debuff is a private deal one: `privateTo`); the new
 *    target resolves it from step 2. Nobody to hand it to: the card waits and the debuff lands.
 * 5. It lands: `apply` does the harm and says whether anything changed.
 * Without a Gậy ông or a Bia đỡ đạn in the hand this draws nothing from `rng` and is BP-37's resolver, step for step.
 */
export function resolveDebuff(state: HandState, events: GameEvent[], user: number, e: PlannedEffect, target: number, apply: DebuffApply, opts: ResolveOpts = {}): void {
  const chaos = state.chaos!
  if (backfireAgainst(chaos, user) && !opts.passed?.length) {
    if (chaos.hit.includes(user) || (opts.holes && isImmune(chaos, user))) {
      record(chaos, events, user, e, [target], 'fizzled')
      return
    }
    chaos.hit.push(user)
    const harm = apply(user, target)
    record(chaos, events, user, e, [target], 'reflected', typeof harm === 'object' ? harm : {})
    return
  }
  if (chaos.hit.includes(target)) {
    record(chaos, events, user, e, [target], 'fizzled')
    return
  }
  if (spendShield(chaos, target)) {
    const shield = chaos.plan.seats.find((s) => s.seat === target)!.shield!
    if (shield.kind === 'mirror' && user !== target && !chaos.hit.includes(user)) {
      chaos.hit.push(user)
      const harm = apply(user, target)
      record(chaos, events, user, e, [target], 'reflected', typeof harm === 'object' ? harm : {})
      return
    }
    record(chaos, events, user, e, [target], 'blocked', { consume: 'blocked' })
    return
  }
  const sg = opts.rng ? scapegoatOf(chaos, target) : null
  if (sg) {
    const passed = [...(opts.passed ?? []), target]
    const others = state.players
      .filter((p) => !p.folded && p.seat !== user && !passed.includes(p.seat) && !chaos.hit.includes(p.seat) && !(opts.holes && isImmune(chaos, p.seat)))
      .map((p) => p.seat)
    if (others.length > 0) {
      const to = others[opts.rng!.int(others.length)]!
      // The hand-off is as private as what it passes: a private deal debuff's hand-off reaches only the seat passing it,
      // the seat taking it and the debuff's user (A8); the table reads it in CHAOS_SUMMARY. Any other is public.
      const privacy = PRIVATE_AT_DEAL.has(e.effect) ? { privateTo: [...new Set([target, to, user])] } : {}
      record(chaos, events, target, sg, [to], 'applied', privacy)
      resolveDebuff(state, events, user, e, to, apply, { ...opts, passed })
      return
    }
  }
  chaos.hit.push(target)
  const harm = apply(target, target)
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
export function resolveHoleDebuff(state: HandState, events: GameEvent[], user: number, e: PlannedEffect, target: number, apply: DebuffApply, rng?: Rng): void {
  const chaos = state.chaos!
  // A Gậy ông turns the debuff back before it reaches the immune target: the user's own immunity decides then.
  if (isImmune(chaos, target) && !backfireAgainst(chaos, user)) {
    record(chaos, events, user, e, [target], 'fizzled')
    return
  }
  resolveDebuff(state, events, user, e, target, (victim, t) => !isImmune(chaos, victim) && apply(victim, t), { holes: true, ...(rng ? { rng } : {}) })
}

/**
 * Spec §3 (A16) for an effect on several seats at once: a shield or a mirror standing on `seat` only blocks it for that
 * seat — never reflects — and a one-shot one is spent; the `blocked` event names that seat. Returns whether it blocked.
 */
export function blockForSeat(chaos: ChaosHandState, events: GameEvent[], user: number, e: PlannedEffect, seat: number): boolean {
  if (!spendShield(chaos, seat)) return false
  record(chaos, events, user, e, [seat], 'blocked', { consume: 'blocked' })
  return true
}

/**
 * How `seat` ranks `cards` in a chaos hand — the showdown's `SettleHooks.evaluateSeat`, and the reveal's Ngược dòng and
 * Thách đấu: any number of cards, and Lá ma's wild card while the seat still holds it.
 */
export function evaluateChaosSeat(state: HandState, seat: number, cards: readonly Card[]): HandEvaluation & { wild?: { card: Card; as: Card } } {
  const chaos = state.chaos!
  const wild = chaos.wild?.find((w) => w.seat === seat)?.card
  const holds = state.players.find((p) => p.seat === seat)?.holeCards.includes(wild ?? -1) ?? false
  return wild !== undefined && holds ? evaluateWild(cards, wild) : evaluateAny(cards)
}

/**
 * `seat`'s strength right now as the showdown would rank it — its hole cards, the board and a borrowed card — higher is
 * better, "Thế giới đảo ngược" included (the weakest hand wins, so the rank is negated as `settle` does).
 */
export function showdownScore(state: HandState, seat: number): number {
  const chaos = state.chaos!
  const p = state.players.find((x) => x.seat === seat)!
  const borrowed = chaos.borrowed.find((b) => b.seat === seat)?.card
  const cards = borrowed === undefined ? [...p.holeCards, ...state.community] : [...p.holeCards, ...state.community, borrowed]
  const rank = evaluateChaosSeat(state, seat, cards).rank
  return chaos.plan.reverse ? -rank : rank
}
