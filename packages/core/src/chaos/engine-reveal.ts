import type { Rng } from '../cards/rng.js'
import { dealCards, getPlayer, seatsClockwiseFrom } from '../hand/common.js'
import type { GameEvent, HandPlayer, HandState } from '../hand/types.js'
import {
  addUid, dealRound, effectOf, highestIndex, isGodSeat, isImmune, record, remaining, resolveDebuff, resolveHoleDebuff, showdownScore, type DebuffHarm,
} from './engine-core.js'
import { applyGodCurse } from './engine-god.js'
import type { ChaosEffectKind, ChaosHandState, PlannedEffect } from './types.js'

/**
 * The reveal-time cards (spec 2026-10-26 §3.5.3; BP-41 Task 4 adds round three's), after the river and before the
 * showdown, and only when two or more seats are still in (otherwise they wait, held, for a hand with a showdown). A
 * holder who folded fires nothing and keeps the card. Reveal draws need only the cards they take (no reserve). Within each
 * step the holders act clockwise from the button.
 *
 * The order, in the spirit of the original §3.5 — what protects first, then what changes one hand, then the whole
 * table, then what reads the finished hands:
 * 0. Protection is not a step: Khiên / Gương, Bia đỡ đạn and Gậy ông đập lưng ông stand from the deal and are asked by
 *    every debuff as it resolves (`resolveDebuff`). A Gậy ông pressed from the bonus hand during the choice is told here
 *    first (`recordBackfires`) and stands from now on.
 * 1. Hand debuffs on one seat: Rút bài, Hạ bài, Đổi bài liều (`swapHands`), Xào bài (`redealHole`), Đổi lá hàng xóm
 *    (`neighbourSwap`) — each through the hole-card resolver (immunity, one debuff a seat, shields, Bia đỡ đạn, Gậy ông).
 * 2. Shuffles: Hoán vị định mệnh (`shuffleHoles`) — every live hand, immune seats aside, dealt round among their seats.
 * 3. Re-deals: Đại hồng thủy (`deluge`: every live hand but the immune ones, and the whole board), then the board
 *    re-deals (`redealBoard`).
 * 4. Xúc xắc định mệnh (`fateDie`): the holder's own hand loses or gains a card on its die.
 * 5. Ngược dòng (`swapLeader`): it needs the finished board and every hand above settled, so it reads the leader only
 *    after the re-deals and the die, and swaps once.
 * 6. Borrowed cards (`borrowHole`).
 * 7. Duels (`duel`, Thách đấu bạc / vàng): the hands are final now; each duel compares two hands as the showdown will
 *    and records what the loser owes (`ChaosHandState.duels`; the points move at the settlement, Task 5b).
 * The Thần's curse (BP-41 §4.2, Task 6, `applyGodCurse`) takes its place among them: rút bài closes step 1, tráo bài opens
 * step 2, thách đấu closes step 7. The Thần's own hand is out of reach of every step (`isImmune`), its own cards' too:
 * a swap, Ngược dòng or Xúc xắc định mệnh's low roll that would change the Thần's hand changes nothing.
 * The settlement hooks (`chaosSettleHooks`: insurance, the summary) follow in `settle`; `afterHand` reads the outcomes
 * (Xúc xắc định mệnh's crit flag, the duel wins).
 */
export function applyRevealEffects(state: HandState, events: GameEvent[], rng: Rng): void {
  const chaos = state.chaos
  if (!chaos) return
  const live = (): HandPlayer[] => state.players.filter((p) => !p.folded)
  if (live().length < 2) return
  const order = seatsClockwiseFrom(state, state.button).filter((p) => !p.folded)

  recordBackfires(state, events)
  for (const user of order) handDebuffs(state, events, user.seat, rng)
  applyGodCurse(state, events, rng, 1)
  applyGodCurse(state, events, rng, 3)
  for (const user of order) {
    const e = effectOf(chaos, user.seat, 'shuffleHoles')
    if (e) shuffleHoles(state, events, user.seat, e, rng)
  }
  for (const user of order) {
    const e = effectOf(chaos, user.seat, 'deluge')
    if (e) deluge(state, events, user.seat, e)
  }
  for (const user of order) {
    const e = effectOf(chaos, user.seat, 'redealBoard')
    if (e) redealBoard(state, events, user.seat, e, rng)
  }
  for (const user of order) {
    const e = effectOf(chaos, user.seat, 'fateDie')
    if (e) fateDie(state, events, user.seat, e, rng)
  }
  for (const user of order) {
    const e = effectOf(chaos, user.seat, 'swapLeader')
    if (e) swapLeader(state, events, user.seat, e, rng)
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
  for (const user of order) {
    const e = effectOf(chaos, user.seat, 'duel')
    if (e) duel(state, events, user.seat, e, rng)
  }
  applyGodCurse(state, events, rng, 2)
}

/**
 * Gậy ông đập lưng ông (BP-41, not a debuff): told to the whole table when it starts to stand — at the deal for a card
 * in the plan (before Kẻ phá đám, so nothing switches it off), at the reveal for one pressed during the choice. From
 * then every debuff another seat fires this hand turns back on its user (`backfireAgainst`, `resolveDebuff`); the card
 * is spent then, whatever its holder does after. A holder who folded before the reveal never tells a pressed one: it
 * goes back to the bonus hand unfired.
 */
export function recordBackfires(state: HandState, events: GameEvent[]): void {
  const chaos = state.chaos!
  for (const p of seatsClockwiseFrom(state, state.button)) {
    if (p.folded) continue
    const e = effectOf(chaos, p.seat, 'backfire')
    if (e && !chaos.recorded.includes(e.uid)) record(chaos, events, p.seat, e, [], 'applied')
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. Hand debuffs

/** The one-seat hand debuffs, in the order a holder fires them (a seat fires one debuff a hand, so at most one acts). */
const HAND_DEBUFFS: readonly ChaosEffectKind[] = ['stealHole', 'lowerHole', 'swapHands', 'redealHole', 'neighbourSwap']

/**
 * `user`'s hand debuff. Rút bài, Hạ bài, Đổi bài liều and Xào bài aim at random among the opponents still in and not hit
 * yet (`all` on BP-37's Rút bài aims at all of them); Đổi lá hàng xóm at the seat on the holder's left still in (the
 * next one clockwise), hit or not — a hit neighbour lets it fizzle. Hạ bài and Xào bài need the cards they deal, else
 * they fizzle and the card waits (`consume: null`, as BP-37's re-deals).
 */
function handDebuffs(state: HandState, events: GameEvent[], user: number, rng: Rng): void {
  const chaos = state.chaos!
  for (const kind of HAND_DEBUFFS) {
    const e = effectOf(chaos, user, kind)
    if (!e) continue
    // The Thần's own swap would give its Aces away (G11): spent for nothing before it is aimed, so no seat's shield,
    // mirror, Bia đỡ đạn or one debuff is touched (as its Ngược dòng and Cướp đoạt).
    if ((kind === 'swapHands' || kind === 'neighbourSwap') && isGodSeat(chaos, user)) {
      record(chaos, events, user, e, [], 'fizzled')
      continue
    }
    const need = kind === 'lowerHole' ? 1 : kind === 'redealHole' ? (e.params.count ?? 1) : 0
    if (need > 0 && remaining(state) < need) {
      record(chaos, events, user, e, [], 'fizzled', { consume: null })
      continue
    }
    const opponents = state.players.filter((p) => !p.folded && p.seat !== user).map((p) => p.seat)
    let targets: number[]
    if (kind === 'neighbourSwap') targets = [seatsClockwiseFrom(state, user).find((p) => !p.folded && p.seat !== user)!.seat]
    else if (e.params.all) targets = opponents
    else {
      const fresh = opponents.filter((s) => !chaos.hit.includes(s))
      if (fresh.length === 0) {
        record(chaos, events, user, e, [], 'fizzled')
        continue
      }
      targets = [fresh[rng.int(fresh.length)]!]
    }
    // BP-41 "miễn nhiễm rút bài": the card is spent on an immune seat and does nothing; the seat is not counted hit.
    for (const target of targets) resolveHoleDebuff(state, events, user, e, target, (victim) => handDebuff(state, kind, e, user, victim, rng), rng)
  }
}

/**
 * Steal, lower, swap, re-deal or neighbour-swap on `victim` (the user itself when a mirror or Gậy ông turned it back);
 * false when nothing could change (a last card is never stolen; a hand never trades with itself).
 */
function handDebuff(state: HandState, kind: ChaosEffectKind, e: PlannedEffect, user: number, victim: number, rng: Rng): DebuffHarm {
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
    // Xào bài (BP-41): `count` random hole cards of the victim dealt again from the deck.
    case 'redealHole': {
      const n = Math.min(e.params.count ?? 1, v.holeCards.length)
      if (n === 0 || remaining(state) < n) return false
      const slots = v.holeCards.map((_, i) => i)
      for (let k = 0; k < n; k++) v.holeCards[slots.splice(rng.int(slots.length), 1)[0]!] = dealCards(state, 1)[0]!
      return true
    }
    // Đổi lá hàng xóm (BP-41): one random card of the holder's for one random card of the victim's.
    case 'neighbourSwap': {
      const u = getPlayer(state, user)
      if (victim === user || u.holeCards.length === 0 || v.holeCards.length === 0) return false
      const i = rng.int(u.holeCards.length)
      const j = rng.int(v.holeCards.length)
      const mine = u.holeCards[i]!
      u.holeCards[i] = v.holeCards[j]!
      v.holeCards[j] = mine
      return true
    }
    default:
      return false
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// 2–3. Shuffles and re-deals (table rules, not debuffs: no shield stops them, spec §3; immunity does)

/** The live seats a table-wide hand effect reaches: clockwise from the button, every one but the immune (spec §3). */
const reachable = (state: HandState, chaos: ChaosHandState): HandPlayer[] =>
  seatsClockwiseFrom(state, state.button).filter((p) => !p.folded && !isImmune(chaos, p.seat))

/**
 * Hoán vị định mệnh: the hole hands of every seat still in, the holder's too, are dealt round among those seats at
 * random (each hand moves whole; sizes may differ). An immune seat keeps its own. Fewer than two hands to move: it
 * fizzles. Its event names the other seats it moved, never a card.
 */
function shuffleHoles(state: HandState, events: GameEvent[], user: number, e: PlannedEffect, rng: Rng): void {
  const chaos = state.chaos!
  const seats = reachable(state, chaos)
  if (seats.length < 2) {
    record(chaos, events, user, e, [], 'fizzled')
    return
  }
  dealRound(seats, rng)
  record(chaos, events, user, e, seats.map((p) => p.seat).filter((s) => s !== user), 'applied')
}

/**
 * Đại hồng thủy: every seat still in is dealt a new hand of as many cards as it holds, and the whole board (five
 * cards, six with Lá chung thứ sáu) is dealt again; an immune seat keeps its hand. The old cards stay out. The deck must
 * hold every card it deals, else it fizzles and the card waits (spec §3 "thiếu lá"; `consume: null`, as BP-37's board
 * re-deal). Its event carries the new board.
 */
function deluge(state: HandState, events: GameEvent[], user: number, e: PlannedEffect): void {
  const chaos = state.chaos!
  const seats = reachable(state, chaos)
  const need = seats.reduce((n, p) => n + p.holeCards.length, 0) + state.community.length
  if (remaining(state) < need) {
    record(chaos, events, user, e, [], 'fizzled', { consume: null })
    return
  }
  for (const p of seats) p.holeCards = dealCards(state, p.holeCards.length)
  state.community = dealCards(state, state.community.length)
  record(chaos, events, user, e, seats.map((p) => p.seat).filter((s) => s !== user), 'applied', { community: state.community.slice() })
}

/** BP-37's board re-deal: `count` board cards (all of them when `count` covers the board) dealt again. */
function redealBoard(state: HandState, events: GameEvent[], user: number, e: PlannedEffect, rng: Rng): void {
  const chaos = state.chaos!
  const count = Math.min(e.params.count ?? 1, state.community.length)
  if (count <= 0 || remaining(state) < count) {
    record(chaos, events, user, e, [], 'fizzled', { consume: null })
    return
  }
  if (count >= state.community.length) state.community = dealCards(state, state.community.length)
  else {
    for (let i = 0; i < count; i++) state.community[rng.int(state.community.length)] = dealCards(state, 1)[0]!
  }
  record(chaos, events, user, e, [], 'applied', { community: state.community.slice() })
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. Xúc xắc định mệnh

/**
 * Xúc xắc định mệnh (BP-41, A15): one die of `sides` faces, told on `CHAOS_APPLIED.dice`. Up to `loseTo`: the holder
 * loses a random hole card — never the last (`holeDelta` −1, or 0 on a one-card hand). From `gainFrom`: `count` cards
 * from the deck (0 when the deck is out) and the seat goes into `outcomes.fateCrit` (Bạo kích × `multiplier` if it wins
 * a pot: Task 5c pays it). In between: nothing. The card is always spent: the die was thrown.
 */
function fateDie(state: HandState, events: GameEvent[], user: number, e: PlannedEffect, rng: Rng): void {
  const chaos = state.chaos!
  const hole = getPlayer(state, user).holeCards
  const die = 1 + rng.int(e.params.sides ?? 6)
  let delta = 0
  if (die <= (e.params.loseTo ?? 2)) {
    // The Thần loses no card (G11 "miễn nhiễm rút bài"), even to its own die.
    if (hole.length > 1 && !isGodSeat(chaos, user)) {
      hole.splice(rng.int(hole.length), 1)
      delta = -1
    }
  } else if (die >= (e.params.gainFrom ?? 5)) {
    const n = e.params.count ?? 1
    if (remaining(state) >= n) {
      hole.push(...dealCards(state, n))
      delta = n
    }
    const crit = chaos.outcomes?.fateCrit ?? []
    addUid(crit, user)
    chaos.outcomes = { ...chaos.outcomes, fateCrit: crit }
  }
  record(chaos, events, user, e, [], 'applied', { dice: [die], holeDelta: delta })
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. Ngược dòng

/**
 * Ngược dòng (a debuff): once the board is complete, if the holder's hand is not the one leading (ranked as the showdown
 * will — the board, Lá ma, "Thế giới đảo ngược"), it swaps hands with the leader; a tie at the top counts as leading.
 * Several leaders: the first clockwise from the holder. The leader goes through the hole-card resolver: immune →
 * fizzled, already hit → fizzled, a shield blocks, a mirror (or Gậy ông) turns it back — a hand cannot swap with itself,
 * so it changes nothing. Leading: it fizzles, the card spent.
 */
function swapLeader(state: HandState, events: GameEvent[], user: number, e: PlannedEffect, rng: Rng): void {
  const chaos = state.chaos!
  const others = seatsClockwiseFrom(state, user).filter((p) => !p.folded && p.seat !== user)
  const mine = showdownScore(state, user)
  const scores = new Map(others.map((p) => [p.seat, showdownScore(state, p.seat)]))
  const best = Math.max(...scores.values())
  // The Thần never swaps its own hand away (G11): its Ngược dòng is spent for nothing.
  if (mine >= best || isGodSeat(chaos, user)) {
    record(chaos, events, user, e, [], 'fizzled')
    return
  }
  const leader = others.find((p) => scores.get(p.seat) === best)!.seat
  resolveHoleDebuff(state, events, user, e, leader, (victim) => {
    if (victim === user) return false
    const u = getPlayer(state, user)
    const v = getPlayer(state, victim)
    const hand = u.holeCards
    u.holeCards = v.holeCards
    v.holeCards = hand
    return true
  }, rng)
}

// ---------------------------------------------------------------------------------------------------------------------
// 7. Thách đấu

/**
 * Thách đấu bạc / vàng (a debuff, 🔓): the holder challenges a random opponent still in and not hit yet, through the
 * debuff resolver (a shield blocks, Bia đỡ đạn hands it on; no immunity — it touches no card). When the challenger's
 * hand beats the challenged one's, ranked as the showdown will, a roll under `p3` makes the loser owe 3 fixed wagers,
 * under `p3 + p2` 2, else nothing; a tie or a loss owes nothing. A mirror or a Gậy ông turns it round: the target
 * challenges the holder. A duel that pays goes into `ChaosHandState.duels` (paid at the settlement);
 * the event's `wagers` tells the table (0 when nothing is owed).
 */
function duel(state: HandState, events: GameEvent[], user: number, e: PlannedEffect, rng: Rng): void {
  const chaos = state.chaos!
  const fresh = state.players.filter((p) => !p.folded && p.seat !== user && !chaos.hit.includes(p.seat)).map((p) => p.seat)
  if (fresh.length === 0) {
    record(chaos, events, user, e, [], 'fizzled')
    return
  }
  const target = fresh[rng.int(fresh.length)]!
  resolveDebuff(state, events, user, e, target, (victim, aimed) => {
    const [winner, payer] = victim === user ? [aimed, user] : [user, victim]
    if (showdownScore(state, winner) <= showdownScore(state, payer)) return { wagers: 0 }
    const r = rng.int(100)
    const p3 = e.params.p3 ?? 0
    const wagers = r < p3 ? 3 : r < p3 + (e.params.p2 ?? 0) ? 2 : 0
    if (wagers > 0) (chaos.duels ??= []).push({ winner, payer, wagers, cardId: e.cardId, uid: e.uid })
    return { wagers }
  }, { rng })
}
