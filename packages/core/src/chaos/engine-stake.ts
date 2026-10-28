import type { GameEvent, HandPlayer, HandState } from '../hand/types.js'
import { effectOf, record } from './engine-core.js'
import type { ChaosHandState } from './types.js'

/**
 * BP-41 Task 5a: the stake multipliers (Mạo hiểm gia, Sới lớn; A1, Ruling 1) and the no-fold rule (Cấm bỏ bài, and the
 * Thần through the same `noFoldSeats`; A2). Every function here is a no-op on a plain hand and on a chaos hand whose
 * plan holds none of these cards, so such a hand plays exactly as before.
 */

/** The multiple of the fixed wager `seat` stakes this hand (`ChaosHandPlan.seats[].stake`); 1 without a multiplier. */
export function stakeOf(chaos: ChaosHandState | undefined, seat: number): number {
  return chaos?.plan.seats.find((s) => s.seat === seat)?.stake ?? 1
}

/** `seat` may not fold this hand (Cấm bỏ bài from last hand, a Thần): "Chơi" is its only choice. */
export function mayNotFold(chaos: ChaosHandState | undefined, seat: number): boolean {
  return chaos?.plan.noFoldSeats?.includes(seat) ?? false
}

/**
 * Takes the multiplied part of one wager from `p` (A1): (stake − 1) × `wager`, as dead money — off the stack, into the
 * pot and `deadMoney`, never into `totalCommitted`. Call it right after the seat's real wager went in through `commit`, so
 * a short stack pays the real wager first and stays in the pot it can win. `reserve`: points the call leaves on the stack
 * (the ante keeps the real "Chơi" wager back on a "Chơi hoặc bỏ" table — the whole hand's real wagers come before any
 * extra). A stack it empties is all in, as `commit` does. Returns what it took (0 with no multiplier). The chips sit in
 * front of the seat like its wager (`betThisStreet`), so a snapshot shows what the events showed.
 */
export function takeDeadMoney(state: HandState, p: HandPlayer, wager: number, reserve = 0): number {
  const chaos = state.chaos
  const stake = stakeOf(chaos, p.seat)
  if (!chaos || stake <= 1) return 0
  const amount = Math.max(0, Math.min((stake - 1) * wager, p.stack - reserve))
  if (amount === 0) return 0
  p.stack -= amount
  p.betThisStreet += amount
  state.pot += amount
  if (p.stack === 0) p.allIn = true
  const rows = (chaos.deadMoney ??= [])
  const row = rows.find((r) => r.seat === p.seat)
  if (row) row.amount += amount
  else rows.push({ seat: p.seat, amount })
  return amount
}

/**
 * Tells the stake cards at the ante, before a point moves (public: the ante shows them anyway): each Mạo hiểm gia with
 * its holder's whole stake, each Sới lớn with the table's ×. Told this early they have acted, so no Kẻ phá đám can
 * switch one off once the ante paid it (Ruling 5a-3). A Sới lớn's own "Giữ bộ tốt hơn" acts later, at the deal.
 */
export function recordStakes(state: HandState, events: GameEvent[]): void {
  const chaos = state.chaos
  if (!chaos) return
  for (const p of state.players) {
    const big = effectOf(chaos, p.seat, 'bigTable')
    if (big) record(chaos, events, p.seat, big, [], 'applied', { stake: big.params.stake ?? 1 })
    const adv = effectOf(chaos, p.seat, 'adventurer')
    if (adv) record(chaos, events, p.seat, adv, [], 'applied', { stake: stakeOf(chaos, p.seat) })
  }
}

/**
 * Cấm bỏ bài at the deal (A2): every other seat dealt into this hand takes a `noFold` mark, so it may only "Chơi" in the
 * table's next hand (`afterHand` → `ChaosSeat.noFoldNextHand` → `planHand`'s `noFoldSeats`). Not a debuff (spec §3): no
 * shield stops it and it counts toward nobody's one debuff. Public. A ✱ card: on a table without the choice it fizzles.
 */
export function markNoFold(state: HandState, events: GameEvent[]): void {
  const chaos = state.chaos
  if (!chaos) return
  for (const p of state.players) {
    const e = effectOf(chaos, p.seat, 'noFold')
    if (!e) continue
    if (state.rules.mode !== 'blind' || state.rules.decisionMode !== 'playOrFold') {
      record(chaos, events, p.seat, e, [], 'fizzled')
      continue
    }
    const targets = state.players.filter((x) => x.seat !== p.seat).map((x) => x.seat)
    for (const seat of targets) if (!chaos.marks.some((m) => m.seat === seat && m.kind === 'noFold')) chaos.marks.push({ seat, kind: 'noFold' })
    record(chaos, events, p.seat, e, targets, 'applied')
  }
}

/** The total dead money in the hand (`settle` adds it to the main pot). */
export function deadMoneyOf(state: HandState): number {
  return state.chaos?.deadMoney?.reduce((sum, r) => sum + r.amount, 0) ?? 0
}
