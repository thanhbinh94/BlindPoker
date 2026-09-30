import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * Where the result card's stage stops (review round 2, R2-3). The card is dealt over the felt, centred on the room's
 * stage; on a short stage it reached down onto the viewer's own seat at the bottom of the ring and covered it —
 * entirely at 1366 × 768 and below, the plate at 1920 × 940. So the card's stage ends above that seat when that
 * leaves the card enough room, and is the whole stage when it does not.
 */

/** The space kept between the foot of the card's stage and the top of what it clears. */
export const CLEARANCE_GAP = 8
/** The overlay height above the seat that the card needs: title, one full row and the footer (≈ 184 px of card) plus the overlay's own 2 × 16 px padding. */
export const MIN_CARD = 216

/**
 * How far up from the stage's bottom edge the result card's stage must stop, or null to use the whole stage.
 *
 * Three tiers, the first that leaves the card `MIN_CARD` of room wins:
 * 1. above the whole seat block — its cards, plate and the lines under it;
 * 2. above the plate — the plate and the lines under it stay clear, and the card may lie over the top of the viewer's
 *    own hole cards, which the card's own row repeats;
 * 3. neither (a phone, where the seat is pinned under a short stage): `null`, and the card keeps the whole stage over
 *    the seat, closable as before.
 *
 * A spectator has no seat to clear (`null`). The answer is never negative: a seat laid out below the stage's foot has
 * nothing on screen to clear.
 */
export function clearanceFor(stage: DOMRect, seat: DOMRect | null, plate: DOMRect | null): number | null {
  if (seat === null) return null
  if (seat.top - stage.top - CLEARANCE_GAP >= MIN_CARD) return Math.max(0, stage.bottom - seat.top + CLEARANCE_GAP)
  if (plate !== null && plate.top - stage.top - CLEARANCE_GAP >= MIN_CARD) return Math.max(0, stage.bottom - plate.top + CLEARANCE_GAP)
  return null
}

/**
 * `clearanceFor` the viewer's own seat inside `stageRef`, kept current while `active` (while a result card is up).
 *
 * The seat and its plate are found by `Seat`'s `data-me="true"` and `data-plate` markers — a contract of their own,
 * not CSS-module class names. It is measured before paint, again whenever the stage or the seat changes size (a
 * resize, the tray growing, the seat's lines filling in) and once the web fonts have landed. The seat is looked up
 * afresh on every measurement and the new element observed, because a switch between the ring and the stack
 * layouts draws it anew. Where there is no `ResizeObserver` (jsdom) it measures once. Not active, it observes
 * nothing and returns `null`.
 */
export function useSeatClearance(stageRef: RefObject<HTMLElement>, active: boolean): number | null {
  const [clearance, setClearance] = useState<number | null>(null)
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!active || stage === null) return
    let live = true
    let watched: Element | null = null
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure())
    function measure(): void {
      if (!live || stage === null) return
      const seat = stage.querySelector('[data-me="true"]')
      const plate = seat?.querySelector('[data-plate]') ?? null
      if (observer !== null && seat !== watched) {
        if (watched !== null) observer.unobserve(watched)
        if (seat !== null) observer.observe(seat)
        watched = seat
      }
      setClearance(clearanceFor(stage.getBoundingClientRect(), seat?.getBoundingClientRect() ?? null, plate?.getBoundingClientRect() ?? null))
    }
    observer?.observe(stage)
    measure()
    void document.fonts?.ready.then(measure)
    return () => {
      live = false
      observer?.disconnect()
    }
  }, [stageRef, active])
  return active ? clearance : null
}
