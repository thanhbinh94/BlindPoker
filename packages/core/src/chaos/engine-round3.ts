import { rankOf, type Card } from '../cards/cards.js'
import type { Rng } from '../cards/rng.js'
import { dealCards, getPlayer, seatsClockwiseFrom } from '../hand/common.js'
import type { GameEvent, HandState } from '../hand/types.js'
import {
  addUid, backfireAgainst, blockForSeat, canDealAtDeal, effectOf, effectsOf, highestIndex, isImmune, record, resolveDebuff, resolveHoleDebuff,
  shieldUp, takeFromDeck, type DebuffHarm,
} from './engine-core.js'
import type { ChaosEffectKind, ChaosHandState, PlannedEffect } from './types.js'

/**
 * BP-41 Task 3b (spec 2026-10-28 §3, §6): Nhật thực's event, Kẻ phá đám, Cướp đoạt, Lời nguyền and Mắt diều hâu. Called
 * from `engine.ts` at the deal and the decision round; every function draws from `rng` only when a seat holds its card.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Before the deal: Nhật thực, Kẻ phá đám

/**
 * Nhật thực: `planHand` already switched every other seat's cards off (`eclipsed`, A11); here its holder is told to the
 * whole table, with the seats it darkened as targets, so every player knows why their cards are quiet this hand.
 */
export function recordEclipse(state: HandState, events: GameEvent[]): void {
  const chaos = state.chaos!
  for (const p of seatsClockwiseFrom(state, state.button)) {
    const e = effectOf(chaos, p.seat, 'eclipse')
    if (!e) continue
    record(chaos, events, p.seat, e, chaos.plan.seats.filter((s) => s.eclipsed).map((s) => s.seat), 'applied')
  }
}

/**
 * Effects that acted when the hand was planned (a rolled Tích lũy's points, Nhật thực) or stand from the first moment
 * of the deal (Gậy ông đập lưng ông, told before any Kẻ phá đám): nothing left to switch off.
 */
const ACTED_AT_PLAN: ReadonlySet<ChaosEffectKind> = new Set(['chaosPoints', 'eclipse', 'backfire'])

/**
 * What Kẻ phá đám may switch off on `seat`: a card firing this hand that has not acted yet — never a bonus card pressed
 * for this hand (A8: private until it fires, and the event names the card), never `except` (the Kẻ phá đám acting), never
 * a card the table was already told of this hand (`recorded`: it acted, so there is nothing left to switch off).
 */
const switchable = (chaos: ChaosHandState, seat: number, except: number): PlannedEffect[] =>
  effectsOf(chaos, seat).filter((e) => e.uid !== except && !e.fromBonus && !ACTED_AT_PLAN.has(e.effect) && !chaos.recorded.includes(e.uid))

/**
 * Kẻ phá đám (a debuff): each holder, clockwise from the button, picks at random an opponent not hit yet that has a card
 * firing this hand, and switches one of those cards off at random through the debuff resolver (a shield blocks it, a
 * mirror turns it on a card of the holder's). The card leaves this hand's plan before anything acts (Ruling 3b-2): a
 * one-shot card stays held for a later hand, a duration card still counts the hand down (it was the hand the debuff
 * spoilt). No opponent with such a card: it fizzles. The event names the card switched off (`off`) to its owner and
 * target only (`PRIVATE_AT_DEAL`).
 */
export function resolveSpoilers(state: HandState, events: GameEvent[], rng: Rng): void {
  const chaos = state.chaos!
  for (const user of seatsClockwiseFrom(state, state.button)) {
    const e = effectOf(chaos, user.seat, 'spoiler') // an earlier Kẻ phá đám may have switched this one off
    if (!e) continue
    const opponents = state.players
      .filter((p) => p.seat !== user.seat && !chaos.hit.includes(p.seat) && switchable(chaos, p.seat, e.uid).length > 0)
      .map((p) => p.seat)
    if (opponents.length === 0) {
      record(chaos, events, user.seat, e, [], 'fizzled')
      continue
    }
    const target = opponents[rng.int(opponents.length)]!
    resolveDebuff(state, events, user.seat, e, target, (victim) => switchOff(chaos, victim, e.uid, rng), { rng })
  }
}

/** Takes one random switchable card of `seat` out of this hand's plan (a new plan object: the caller's is never changed). */
function switchOff(chaos: ChaosHandState, seat: number, except: number, rng: Rng): DebuffHarm {
  const candidates = switchable(chaos, seat, except)
  if (candidates.length === 0) return false
  const off = candidates[rng.int(candidates.length)]!
  const seats = chaos.plan.seats.map((s) => (s.seat === seat ? { ...s, effects: s.effects.filter((x) => x.uid !== off.uid) } : s))
  chaos.plan = { ...chaos.plan, seats, reverse: seats.some((s) => s.effects.some((x) => x.effect === 'reverseRank')) }
  // What `initialChaosState` read off the plan before the deal.
  if (off.effect === 'freeFold') chaos.freeFoldSeats = chaos.freeFoldSeats.filter((s) => s !== seat)
  if (off.effect === 'refundStake') chaos.insured = chaos.insured.filter((i) => i.seat !== seat)
  return { off: off.cardId }
}

// ---------------------------------------------------------------------------------------------------------------------
// After the deal: Cướp đoạt, Lời nguyền

/**
 * The hole-card debuffs of the deal, once every seat's buffs have acted, holder by holder clockwise from the button (a
 * seat fires one debuff a hand, so each holder runs one of them).
 */
export function applyHoleDebuffs(state: HandState, events: GameEvent[], rng: Rng): void {
  const chaos = state.chaos!
  for (const user of seatsClockwiseFrom(state, state.button)) {
    const plunderE = effectOf(chaos, user.seat, 'plunder')
    if (plunderE) plunder(state, events, user.seat, plunderE)
    const curseE = effectOf(chaos, user.seat, 'curse')
    if (curseE) curse(state, events, user.seat, curseE, rng)
  }
}

/**
 * Lời nguyền (a debuff): a random opponent not hit yet has its highest hole card changed into a 2 — the first 2 left in
 * the undealt deck; when every 2 is out, the lowest card left (Ruling 3b-4). Through the hole-card resolver: an immune
 * target lets it fizzle, a shield blocks it, a mirror turns it on the holder. It needs one card from the deck above the
 * reserve, else it fizzles (spec §3 "thiếu lá"); a hand whose highest card is no higher than that card is left alone
 * (fizzled).
 */
function curse(state: HandState, events: GameEvent[], user: number, e: PlannedEffect, rng: Rng): void {
  const chaos = state.chaos!
  if (!canDealAtDeal(state, 1)) {
    record(chaos, events, user, e, [], 'fizzled')
    return
  }
  const fresh = state.players.filter((p) => p.seat !== user && !chaos.hit.includes(p.seat)).map((p) => p.seat)
  if (fresh.length === 0) {
    record(chaos, events, user, e, [], 'fizzled')
    return
  }
  const target = fresh[rng.int(fresh.length)]!
  resolveHoleDebuff(state, events, user, e, target, (victim) => lowerTo(state, victim, e.params.toRank ?? 0), rng)
}

function lowerTo(state: HandState, seat: number, toRank: number): boolean {
  const hole = getPlayer(state, seat).holeCards
  if (hole.length === 0) return false
  const i = highestIndex(hole)
  let at = -1
  for (let k = state.deckIndex; k < state.deck.length && at < 0; k++) if (rankOf(state.deck[k]!) === toRank) at = k
  if (at < 0) {
    for (let k = state.deckIndex; k < state.deck.length; k++) if (at < 0 || rankOf(state.deck[k]!) < rankOf(state.deck[at]!)) at = k
  }
  if (at < 0 || rankOf(state.deck[at]!) >= rankOf(hole[i]!)) return false
  hole[i] = takeFromDeck(state, at)
  return true
}

/**
 * Cướp đoạt (a debuff on several seats at once): the holder throws its hole cards away and takes, from the opponents'
 * hole cards, the set of as many cards as it held that is the strongest before the board (`strongestTake`). It never
 * takes from an immune seat (spec §3) or from a seat already hit this hand. A seat whose cards it would take and that
 * holds a shield or a mirror blocks it for itself (spec §3: on a multi-seat effect a mirror only blocks; a one-shot one
 * is spent), and the set is chosen again without that seat. Each seat robbed takes a card from the deck in each slot it
 * lost and counts as hit. When the opponents within reach hold fewer cards than the holder needs, it takes them all and
 * the rest comes from the top of the deck (random: Ruling 3b-3). Nobody within reach: it fizzles, and the holder keeps
 * its cards. It needs as many cards from the deck as the holder holds, above the reserve, else it fizzles (spec §3
 * "thiếu lá"). Its event names the seats robbed, never a card (A8), and reaches only them and the holder. Under another
 * seat's Gậy ông đập lưng ông (Task 4) it turns back on its holder, who would rob itself: `reflected`, nothing changes,
 * and the holder counts as hit, as for every bounced debuff (`fizzled` when it was hit already). A Bia đỡ đạn never
 * moves it (it is aimed at no one seat).
 */
function plunder(state: HandState, events: GameEvent[], user: number, e: PlannedEffect): void {
  const chaos = state.chaos!
  const me = getPlayer(state, user)
  const n = me.holeCards.length
  if (backfireAgainst(chaos, user)) {
    if (chaos.hit.includes(user)) {
      record(chaos, events, user, e, [], 'fizzled')
      return
    }
    chaos.hit.push(user)
    record(chaos, events, user, e, [], 'reflected')
    return
  }
  if (n === 0 || !canDealAtDeal(state, n)) {
    record(chaos, events, user, e, [], 'fizzled')
    return
  }
  let reach = seatsClockwiseFrom(state, user)
    .filter((p) => p.seat !== user && p.holeCards.length > 0 && !isImmune(chaos, p.seat) && !chaos.hit.includes(p.seat))
    .map((p) => p.seat)
  let take: Taken[]
  for (;;) {
    if (reach.length === 0) {
      record(chaos, events, user, e, [], 'fizzled')
      return
    }
    take = strongestTake(state, reach, n)
    const shielded = [...new Set(take.map((t) => t.seat))].filter((s) => shieldUp(chaos, s))
    if (shielded.length === 0) break
    for (const s of shielded) blockForSeat(chaos, events, user, e, s)
    reach = reach.filter((s) => !shielded.includes(s))
  }
  const victims = [...new Set(take.map((t) => t.seat))]
  const cards = take.map((t) => t.card)
  const fill = dealCards(state, n - cards.length)
  for (const t of take) getPlayer(state, t.seat).holeCards[t.index] = dealCards(state, 1)[0]!
  me.holeCards = [...cards, ...fill]
  chaos.hit.push(...victims)
  record(chaos, events, user, e, victims, 'applied')
}

interface Taken {
  seat: number
  index: number
  card: Card
}

/**
 * Spec §3 "bài mạnh nhất trước khi lật" on any number of cards: suits and the board do not count; the shape of the
 * groups decides first (four of a kind, a full house, trips, two pair, a pair, high cards — the counts compared from
 * the biggest group down), then the ranks group by group from the top. For two or three cards it orders exactly as
 * "Giữ bộ tốt hơn" does.
 */
function preBoardKey(counts: readonly number[]): number[] {
  const groups = counts.flatMap((c, rank) => (c > 0 ? [{ rank, c }] : [])).sort((a, b) => b.c - a.c || b.rank - a.rank)
  return [...groups.map((g) => g.c), ...groups.flatMap((g) => Array<number>(g.c).fill(g.rank))]
}
function above(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! > b[i]!
  return false
}

/**
 * The strongest `n` cards before the board among the hole cards of `seats` (in that order), as the slots they come
 * from. Every card when they hold `n` or fewer. Searched over ranks (suits never count), then the cards of each rank
 * taken in seat order, so the result is the same for the same table.
 */
function strongestTake(state: HandState, seats: readonly number[], n: number): Taken[] {
  const all: Taken[] = seats.flatMap((seat) => getPlayer(state, seat).holeCards.map((card, index) => ({ seat, index, card })))
  if (all.length <= n) return all
  const avail = Array<number>(13).fill(0)
  for (const t of all) avail[rankOf(t.card)]! += 1
  const counts = Array<number>(13).fill(0)
  let best: number[] | null = null
  let bestCounts = counts
  const search = (rank: number, left: number): void => {
    if (left === 0) {
      const key = preBoardKey(counts)
      if (best === null || above(key, best)) {
        best = key
        bestCounts = counts.slice()
      }
      return
    }
    if (rank < 0) return
    for (let c = Math.min(avail[rank]!, left); c >= 0; c--) {
      counts[rank] = c
      search(rank - 1, left - c)
    }
    counts[rank] = 0
  }
  search(12, n)
  const want = bestCounts.slice()
  return all.filter((t) => {
    const r = rankOf(t.card)
    if (want[r]! <= 0) return false
    want[r]! -= 1
    return true
  })
}

// ---------------------------------------------------------------------------------------------------------------------
// The decision round: Mắt diều hâu

/**
 * Mắt diều hâu (✱, "Chơi hoặc bỏ" only): each holder, clockwise from the button, looks at a random opponent's hole cards
 * before choosing — one card at random (`count`, Bạc) or all of them (`all`, Vàng). Private (A8): `CHAOS_HAWK` carries
 * the cards to the holder only (`filterEvent` blanks them for everyone else) and `ChaosHandState.hawk` keeps them for a
 * reconnect. It always has a target: a hand has two seats or more and nobody has folded yet.
 */
export function emitHawkEyes(state: HandState, events: GameEvent[], rng: Rng): void {
  const chaos = state.chaos!
  for (const p of seatsClockwiseFrom(state, state.button)) {
    const e = effectOf(chaos, p.seat, 'hawkEye')
    if (!e) continue
    const opponents = state.players.filter((x) => x.seat !== p.seat && !x.folded && x.holeCards.length > 0)
    if (opponents.length === 0) {
      record(chaos, events, p.seat, e, [], 'fizzled')
      continue
    }
    const target = opponents[rng.int(opponents.length)]!
    let cards: Card[]
    if (e.params.all) cards = target.holeCards.slice()
    else {
      const rest = target.holeCards.slice()
      cards = []
      for (let k = 0; k < (e.params.count ?? 1) && rest.length > 0; k++) cards.push(rest.splice(rng.int(rest.length), 1)[0]!)
    }
    ;(chaos.hawk ??= []).push({ seat: p.seat, target: target.seat, cards })
    chaos.used.push({ seat: p.seat, cardId: e.cardId, effect: e.effect, outcome: 'applied', targets: [target.seat] })
    addUid(chaos.recorded, e.uid)
    addUid(chaos.applied, e.uid)
    events.push({ type: 'CHAOS_HAWK', seat: p.seat, target: target.seat, cards: cards.slice() })
  }
}
