import { useEffect, useState } from 'react'
import type { ClientHand } from '../client/types.js'
import { CARD_STAGGER_MS, FLIP_MS } from '../table/Card.js'
import { useMediaQuery } from '../table/useMediaQuery.js'

/** The most cards one seat turns over: a Blind table deals two or three (`BlindRules.holeCards`), Hold'em two. */
const MOST_HOLE_CARDS = 3
/** Kept after the last card lands face up, so the result card does not open over a card still settling. */
const SETTLE_MS = 150

/**
 * How long the result card waits after a hand ends by turning an opponent's cards over where they lie (review round 2,
 * fix wave, No1): the turn itself (`FLIP_MS`, the `--dur-flip` token), the stagger to the last of three cards (`Seat`
 * passes card `i` a delay of `i × CARD_STAGGER_MS`) and a margin — 600 + 2 × 60 + 150 = 870 ms.
 */
export const REVEAL_HOLD_MS = FLIP_MS + (MOST_HOLE_CARDS - 1) * CARD_STAGGER_MS + SETTLE_MS

/** The seats other than the viewer's that `hand` draws face down: hole cards dealt, none of them known. */
const faceDownSeats = (hand: ClientHand | null): number[] =>
  hand === null ? [] : hand.seats.filter((s) => s.seat !== hand.mySeat && s.cardCount > 0 && s.holeCards === null).map((s) => s.seat)

/** The seats this screen has drawn face down at some point of hand `handId`. */
interface SeenDown {
  handId: string | null
  seats: readonly number[]
}

/**
 * Whether the result card of `hand` is held back while the showdown turns an opponent's cards over (review round 2,
 * fix wave, No1). Opened in the render that turns them, the card covered the turn it was meant to follow: the top
 * seat's at 1920 × 940, every opponent's on a 375 × 812 phone.
 *
 * It holds for `REVEAL_HOLD_MS` when a hand completes with a showdown in which at least one seat other than the viewer's
 * had been drawn face down on this screen — so its cards turn over in place (`Card`). It never holds:
 * - under `prefers-reduced-motion: reduce`, where nothing turns;
 * - for a hand with no showdown (everyone else folded), or one whose shown hands were never drawn face down here;
 * - for a hand that was already over when this screen first saw it — the snapshot that rebuilds the room after a
 *   refresh or on entering it draws the shown cards face up from the start, and nothing turns.
 *
 * The rule is the one `Card` turns by, so the two agree: a snapshot that lands on this same screen mid-hand and finds
 * the hand shown down (a resync, a reconnect) turns the backs it replaces, and holds like any showdown.
 *
 * Which seats were face down is remembered per hand, updated during render — React's pattern for information from
 * earlier renders, as `Card` does — and only ever added to, so a `SHOWDOWN` landing a render before the `SETTLEMENT`
 * still counts.
 */
export function useRevealHold(hand: ClientHand | null): boolean {
  const handId = hand?.handId ?? null
  const downNow = faceDownSeats(hand)
  const [seen, setSeen] = useState<SeenDown>({ handId, seats: downNow })
  let current = seen
  if (seen.handId !== handId) current = { handId, seats: downNow }
  else if (downNow.some((seat) => !seen.seats.includes(seat))) current = { handId, seats: [...new Set([...seen.seats, ...downNow])] }
  if (current !== seen) setSeen(current)

  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const shown = hand !== null && hand.phase === 'COMPLETE' ? (hand.result?.showdown ?? []) : []
  const turns = shown.some((h) => h.seat !== hand?.mySeat && current.seats.includes(h.seat))
  /** The hand whose hold has run out; a hand's hold runs once. */
  const [waited, setWaited] = useState<string | null>(null)
  const holding = turns && !reduceMotion && waited !== handId

  useEffect(() => {
    if (!holding || handId === null) return
    const timer = setTimeout(() => setWaited(handId), REVEAL_HOLD_MS)
    return () => clearTimeout(timer)
  }, [holding, handId])

  return holding
}
