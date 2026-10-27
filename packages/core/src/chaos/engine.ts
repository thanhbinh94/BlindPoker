import { rankOf, suitOf, type Card } from '../cards/cards.js'
import type { Rng } from '../cards/rng.js'
import type { Pot } from '../betting/pots.js'
import { dealCards, getPlayer, seatsClockwiseFrom, type SettleHooks } from '../hand/common.js'
import type { GameEvent, HandPlayer, HandState } from '../hand/types.js'
import { canInsertThisHand } from './bonus.js'
import type { ChaosEffectKind, ChaosHandPlan, ChaosHandState, ChaosOutcome, PlannedEffect } from './types.js'

/**
 * The chaos effect appliers of a Blind hand (spec 2026-10-26 §3.5), called from `hand/blind.ts` at the deal, the
 * decision round and the reveal, and from `settle` through `chaosSettleHooks`. Every function here is a no-op for a
 * hand without `state.chaos`; the Blind engine only calls them when the hand has a plan.
 */

/** Cards a deal-time draw must leave in the deck: the 5-card board plus a full storm re-deal (spec §3.5, amendment). */
export const DEAL_RESERVE = 10

/**
 * Deal-time effects told only to their owner (and, for a debuff, its targets) when they happen: the table learns of
 * them from `CHAOS_SUMMARY` at the settlement. `reverseRank` is the one deal-time card the whole table is told at once.
 */
export const PRIVATE_AT_DEAL: ReadonlySet<ChaosEffectKind> = new Set([
  'swapLowest', 'redealWeak', 'swapAll', 'bestOfN', 'highCard', 'suited', 'extraHole', 'freeze', 'blindfold',
])

/** The order a seat's deal-time buffs act in. Luck that picks a set comes before the promises that must hold at the end. */
const DEAL_BUFFS: readonly ChaosEffectKind[] = ['swapLowest', 'redealWeak', 'swapAll', 'bestOfN', 'highCard', 'suited', 'extraHole']
const DEAL_DEBUFFS: ReadonlySet<ChaosEffectKind> = new Set(['freeze', 'blindfold'])
const HAND_DEBUFFS: readonly ChaosEffectKind[] = ['stealHole', 'lowerHole', 'swapHands']

type Applied = Extract<GameEvent, { type: 'CHAOS_APPLIED' }>

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

const remaining = (state: HandState): number => state.deck.length - state.deckIndex
const effectsOf = (chaos: ChaosHandState, seat: number): PlannedEffect[] => chaos.plan.seats.find((s) => s.seat === seat)?.effects ?? []
const effectOf = (chaos: ChaosHandState, seat: number, kind: ChaosEffectKind): PlannedEffect | undefined => effectsOf(chaos, seat).find((e) => e.effect === kind)
const addUid = (list: number[], uid: number): void => {
  if (!list.includes(uid)) list.push(uid)
}

/** Records one effect's result: its event, its line in the summary, and whether its card is used up. */
function record(
  chaos: ChaosHandState, events: GameEvent[], seat: number, e: PlannedEffect, targets: number[], outcome: ChaosOutcome,
  extra: { community?: Card[]; amount?: number; consume?: 'applied' | 'blocked' | null } = {},
): void {
  const ev: Applied = { type: 'CHAOS_APPLIED', seat, cardId: e.cardId, effect: e.effect, targets, outcome }
  if (extra.community) ev.community = extra.community
  if (extra.amount !== undefined) ev.amount = extra.amount
  events.push(ev)
  chaos.used.push({ seat, cardId: e.cardId, effect: e.effect, outcome, targets: targets.slice() })
  addUid(chaos.recorded, e.uid)
  const consume = extra.consume === undefined ? 'applied' : extra.consume
  if (consume === 'applied') addUid(chaos.applied, e.uid)
  else if (consume === 'blocked') addUid(chaos.blocked, e.uid)
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
const lowestIndex = (cards: readonly Card[]): number => cards.reduce((lo, c, i) => (rankOf(c) < rankOf(cards[lo]!) ? i : lo), 0)
const highestIndex = (cards: readonly Card[]): number => cards.reduce((hi, c, i) => (rankOf(c) > rankOf(cards[hi]!) ? i : hi), 0)
const noPair = (cards: readonly Card[]): boolean => new Set(cards.map(rankOf)).size === cards.length
const topRank = (cards: readonly Card[]): number => Math.max(...cards.map(rankOf))
const canDealAtDeal = (state: HandState, n: number): boolean => remaining(state) - n >= DEAL_RESERVE

/** One deal-time buff on `p`; returns its outcome (`fizzled` when the reserve or its condition says no). */
function dealBuff(state: HandState, p: HandPlayer, e: PlannedEffect, keepTopRank: number | null): ChaosOutcome {
  const hole = p.holeCards
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
    case 'bestOfN': {
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
    default:
      return 'fizzled'
  }
}

/**
 * The deal-time cards (spec §3.5.1), once every seat holds its dealt cards and before `CARDS_DEALT`: seat by seat
 * clockwise from the button, each seat's buffs in `DEAL_BUFFS` order, then its freeze or blindfold through the debuff
 * resolver; then every "Thế giới đảo ngược", told to the whole table.
 */
export function applyDealEffects(state: HandState, events: GameEvent[]): void {
  const chaos = state.chaos
  if (!chaos) return
  for (const p of seatsClockwiseFrom(state, state.button)) {
    const effects = effectsOf(chaos, p.seat)
    // The rank "Chất bổ" promised once it applied: "Đồng hoa" after it must not take that card away.
    let keepTopRank: number | null = null
    for (const kind of DEAL_BUFFS) {
      const e = effects.find((x) => x.effect === kind)
      if (!e) continue
      const outcome = dealBuff(state, p, e, keepTopRank)
      if (kind === 'highCard' && outcome === 'applied') keepTopRank = e.params.minRank ?? 0
      record(chaos, events, p.seat, e, [], outcome)
    }
    for (const e of effects) {
      if (!DEAL_DEBUFFS.has(e.effect)) continue
      const kind = e.effect as 'freeze' | 'blindfold'
      for (const target of e.targets) {
        if (!state.players.some((x) => x.seat === target)) continue
        resolveDebuff(state, events, p.seat, e, target, (victim) => {
          chaos.marks.push({ seat: victim, kind })
          return true
        })
      }
    }
  }
  for (const p of seatsClockwiseFrom(state, state.button)) {
    const e = effectOf(chaos, p.seat, 'reverseRank')
    if (e) record(chaos, events, p.seat, e, [], 'applied')
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Debuffs: shields, mirrors, one per seat (spec §3.5.3a, §3.5.4)

/**
 * Resolves one debuff aimed at `target`: a seat already hit this hand lets it fizzle (the card is still used); a
 * shield blocks it (a one-shot shield is spent on it); a mirror turns it back on its user when the user has taken no
 * debuff yet (otherwise it blocks); else it lands. `apply(victim)` does the harm and says whether anything changed.
 * A reflected debuff is not shielded again, so two mirrors cannot bounce it forever.
 */
function resolveDebuff(state: HandState, events: GameEvent[], user: number, e: PlannedEffect, target: number, apply: (victim: number) => boolean): void {
  const chaos = state.chaos!
  if (chaos.hit.includes(target)) {
    record(chaos, events, user, e, [target], 'fizzled')
    return
  }
  const shield = chaos.plan.seats.find((s) => s.seat === target)?.shield ?? null
  if (shield && !chaos.shieldSpent.includes(target)) {
    if (!shield.lasting) {
      chaos.shieldSpent.push(target)
      addUid(chaos.blocked, shield.uid)
    }
    if (shield.kind === 'mirror' && user !== target && !chaos.hit.includes(user)) {
      chaos.hit.push(user)
      apply(user)
      record(chaos, events, user, e, [target], 'reflected')
      return
    }
    record(chaos, events, user, e, [target], 'blocked', { consume: 'blocked' })
    return
  }
  chaos.hit.push(target)
  record(chaos, events, user, e, [target], apply(target) ? 'applied' : 'fizzled')
}

// ---------------------------------------------------------------------------------------------------------------------
// The decision round

/** "Nhìn trộm" (spec §3.5.2): each peeking seat sees the next `count` board cards, privately; kept for a reconnect. */
export function emitPeeks(state: HandState, events: GameEvent[]): void {
  const chaos = state.chaos
  if (!chaos || state.phase !== 'DECISION') return
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
// The reveal

/**
 * The reveal-time cards (spec §3.5.3), after the river and before the showdown, and only when two or more seats are
 * still in (otherwise they wait, held, for a hand with a showdown). In order: (b) each holder's hand debuff, aimed at
 * random among the opponents still in and not yet hit; (c) board re-deals; (d) borrowed cards. A holder who folded
 * fires nothing and keeps the card. Reveal draws need only the cards they take.
 */
export function applyRevealEffects(state: HandState, events: GameEvent[], rng: Rng): void {
  const chaos = state.chaos
  if (!chaos) return
  const live = (): HandPlayer[] => state.players.filter((p) => !p.folded)
  if (live().length < 2) return
  const order = seatsClockwiseFrom(state, state.button).filter((p) => !p.folded)

  for (const user of order) {
    for (const kind of HAND_DEBUFFS) {
      const e = effectOf(chaos, user.seat, kind)
      if (!e) continue
      const opponents = live().filter((p) => p.seat !== user.seat).map((p) => p.seat)
      if (kind === 'lowerHole' && remaining(state) < 1) {
        record(chaos, events, user.seat, e, [], 'fizzled', { consume: null })
        continue
      }
      let targets: number[]
      if (e.params.all) targets = opponents
      else {
        const fresh = opponents.filter((s) => !chaos.hit.includes(s))
        if (fresh.length === 0) {
          record(chaos, events, user.seat, e, [], 'fizzled')
          continue
        }
        targets = [fresh[rng.int(fresh.length)]!]
      }
      for (const target of targets) resolveDebuff(state, events, user.seat, e, target, (victim) => handDebuff(state, kind, user.seat, victim, rng))
    }
  }

  for (const user of order) {
    const e = effectOf(chaos, user.seat, 'redealBoard')
    if (!e) continue
    const count = Math.min(e.params.count ?? 1, state.community.length)
    if (count <= 0 || remaining(state) < count) {
      record(chaos, events, user.seat, e, [], 'fizzled', { consume: null })
      continue
    }
    if (count >= state.community.length) state.community = dealCards(state, state.community.length)
    else {
      for (let i = 0; i < count; i++) state.community[rng.int(state.community.length)] = dealCards(state, 1)[0]!
    }
    record(chaos, events, user.seat, e, [], 'applied', { community: state.community.slice() })
  }

  for (const user of order) {
    const e = effectOf(chaos, user.seat, 'borrowHole')
    if (!e) continue
    const opponents = live().filter((p) => p.seat !== user.seat && p.holeCards.length > 0)
    if (opponents.length === 0) {
      record(chaos, events, user.seat, e, [], 'fizzled', { consume: null })
      continue
    }
    const from = opponents[rng.int(opponents.length)]!
    chaos.borrowed.push({ seat: user.seat, card: from.holeCards[rng.int(from.holeCards.length)]! })
    record(chaos, events, user.seat, e, [from.seat], 'applied')
  }
}

/** Steal, lower or swap on `victim`; false when nothing could change (a last card is never stolen). */
function handDebuff(state: HandState, kind: ChaosEffectKind, user: number, victim: number, rng: Rng): boolean {
  const v = getPlayer(state, victim)
  switch (kind) {
    case 'stealHole': {
      if (v.holeCards.length <= 1) return false
      v.holeCards.splice(rng.int(v.holeCards.length), 1)
      return true
    }
    case 'lowerHole': {
      if (v.holeCards.length === 0 || remaining(state) < 1) return false
      v.holeCards[highestIndex(v.holeCards)] = dealCards(state, 1)[0]!
      return true
    }
    case 'swapHands': {
      if (victim === user) return false // a mirrored swap would trade the hand with itself
      const u = getPlayer(state, user)
      const mine = u.holeCards
      u.holeCards = v.holeCards
      v.holeCards = mine
      return true
    }
    default:
      return false
  }
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
    beforePayout: (pots, winners) => insure(state, pots, winners),
    beforeSettlement: () => [{ type: 'CHAOS_SUMMARY', used: chaos.used.map((u) => ({ ...u })) }],
  }
}
