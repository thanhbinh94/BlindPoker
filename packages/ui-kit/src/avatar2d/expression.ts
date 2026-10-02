import type { RoomPlayerView } from '@bp/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClientState } from '../client/types.js'
import type { Expression } from './types.js'

const HAPPY_MS = 4000
const SAD_MS = 3000
const SURPRISED_MS = 2000
const IDLE_MS = 60_000

interface TimedExpression {
  expression: Expression
  until: number
}

/**
 * What the hook remembers between renders: the last hand id it reacted to (so a win/loss fires once, not on every
 * render the result stays in state), which seats were already all-in (so the surprised reaction fires on the edge
 * into all-in, not for as long as it holds), each seat's active timed reaction, and when the room last had a hand
 * — the anchor for the 60 s idle-to-sleep rule.
 */
export interface ExpressionMemory {
  handId: string | null
  timed: Map<number, TimedExpression>
  allIn: Set<number>
  idleSince: number
}

/** A fresh memory anchored at `now` — spec 08 §3.4's "room entry" starting point for the idle clock. */
export function initialExpressionMemory(now: number): ExpressionMemory {
  return { handId: null, timed: new Map(), allIn: new Set(), idleSince: now }
}

/**
 * Folds one snapshot of `state` into `prev`, detecting the *edges* that start a timed reaction — a hand that just
 * completed, a seat that just went all-in — rather than re-triggering on every render the condition still holds.
 * Pure and idempotent: calling it again with the same `state` and a `now` inside the already-recorded window
 * changes nothing.
 */
export function advanceExpressionMemory(prev: ExpressionMemory, state: ClientState, now: number): ExpressionMemory {
  const hand = state.hand
  const timed = new Map(prev.timed)
  for (const [seat, entry] of timed) if (entry.until <= now) timed.delete(seat)

  if (hand === null) {
    // Between hands (or before the first one): nothing to react to. `idleSince` only ever moves forward on a
    // *completed* hand below, so it is left exactly where the last transition put it.
    return { handId: prev.handId, timed, allIn: new Set(), idleSince: prev.idleSince }
  }

  // Surprised is table-wide: the seat that shoved and everyone watching react to the same event.
  const nowAllIn = new Set(hand.seats.filter((seat) => seat.allIn).map((seat) => seat.seat))
  const freshAllIn = [...nowAllIn].some((seat) => !prev.allIn.has(seat))
  if (freshAllIn) for (const seat of hand.seats) timed.set(seat.seat, { expression: 'surprised', until: now + SURPRISED_MS })

  let handId = prev.handId
  let idleSince = prev.idleSince
  if (hand.phase === 'COMPLETE' && hand.result !== null && hand.handId !== handId) {
    const payouts = new Map<number, number>()
    for (const payout of hand.result.payouts) payouts.set(payout.seat, (payouts.get(payout.seat) ?? 0) + payout.amount)
    const showdownSeats = new Set((hand.result.showdown ?? []).map((h) => h.seat))
    for (const seat of hand.seats) {
      if ((payouts.get(seat.seat) ?? 0) > 0) timed.set(seat.seat, { expression: 'happy', until: now + HAPPY_MS })
      else if (showdownSeats.has(seat.seat)) timed.set(seat.seat, { expression: 'sad', until: now + SAD_MS })
    }
    idleSince = now
  }
  handId = hand.handId

  return { handId, timed, allIn: nowAllIn, idleSince }
}

/**
 * The expression one seat should show right now, in priority order: `sleep` and `closed` are states — they hold
 * for as long as their condition does — over any timed reaction, which itself falls back to `neutral` once it
 * expires.
 */
export function expressionForSeat(memory: ExpressionMemory, state: ClientState, seat: number, now: number): Expression {
  const player: RoomPlayerView | undefined = state.room?.players.find((p) => p.seat === seat)
  const roomIdle = state.hand === null && now - memory.idleSince > IDLE_MS
  if (player?.sittingOut === true || player?.connected === false || roomIdle) return 'sleep'

  const clientSeat = state.hand?.seats.find((s) => s.seat === seat)
  if (clientSeat?.folded === true) return 'closed'

  const timed = memory.timed.get(seat)
  if (timed !== undefined && timed.until > now) return timed.expression

  return 'neutral'
}

/**
 * Per-seat expressions for a live table (spec 08 §3.4): happy on a won hand (4 s), sad on a showdown loss (3 s),
 * surprised on any seat going all-in (2 s, table-wide), closed while folded (until the hand ends), sleep while
 * sitting out, disconnected, or the room has gone 60 s with no hand — in that priority over neutral.
 *
 * The memory itself is pure (`advanceExpressionMemory` / `expressionForSeat`); this hook adds only what React
 * needs: re-deriving it as `state` changes, and a low-frequency re-render so a timed reaction — or the 60 s idle
 * boundary — still expires on the wall clock even when nothing else about the room changes.
 *
 * `resultPending` is the room holding a finished hand's result back (`RoomScreen`'s reveal hold, while an opponent's
 * cards turn over). The faces keep the result to themselves with it: `state` is not folded in, so no happy or sad starts
 * — and the edge it would have started from is still there to be seen once the flag drops, which starts the reaction
 * then and lets it run its full 4 s or 3 s rather than whatever was left of it after the hold. What a seat shows meanwhile
 * is still what its own state says (folded, sitting out, disconnected, an earlier reaction still running). Defaults to
 * `false`.
 */
export function useTableExpressions(state: ClientState, serverNow: () => number, resultPending = false): (seat: number) => Expression {
  const [, tick] = useState(0)
  const memoryRef = useRef<ExpressionMemory | null>(null)
  if (memoryRef.current === null) memoryRef.current = initialExpressionMemory(serverNow())

  // Re-derive synchronously on every render so the very first read after a state change already reflects it.
  // Idempotent for an unchanged `state`: the edges it looks for (a new hand id, a freshly all-in seat) are already
  // folded into `memoryRef.current` by the time this runs again with the same input.
  if (!resultPending) memoryRef.current = advanceExpressionMemory(memoryRef.current, state, serverNow())

  useEffect(() => {
    const memory = memoryRef.current
    if (memory === null) return
    const now = serverNow()
    const pending = memory.timed.size > 0 || (state.hand === null && now - memory.idleSince <= IDLE_MS)
    if (!pending) return
    const timer = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(timer)
  })

  return useCallback((seat: number) => expressionForSeat(memoryRef.current!, state, seat, serverNow()), [state, serverNow])
}
