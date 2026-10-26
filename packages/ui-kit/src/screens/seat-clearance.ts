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
 * 3. neither (a short phone such as 375 × 812, where the seat is pinned under a short stage): `null`, and the card
 *    keeps the whole stage over the seat, closable as before.
 *
 * `minRoom` is what the thing laid over the felt needs above the seat: the result card's `MIN_CARD` by default; the chaos
 * draft passes 0, so it always stops above the seat's block and scrolls inside. `aboveHand` also counts the cards of the
 * viewer's fan (`[data-hand]`), which may stand above the seat's own box: the draft never lies over them.
 * A spectator has no seat to clear (`null`). The answer is never negative: a seat laid out below the stage's foot has
 * nothing on screen to clear.
 */
export function clearanceFor(stage: DOMRect, seat: Pick<DOMRect, 'top'> | null, plate: Pick<DOMRect, 'top'> | null, minRoom: number = MIN_CARD): number | null {
  if (seat === null) return null
  if (seat.top - stage.top - CLEARANCE_GAP >= minRoom) return Math.max(0, stage.bottom - seat.top + CLEARANCE_GAP)
  if (plate !== null && plate.top - stage.top - CLEARANCE_GAP >= minRoom) return Math.max(0, stage.bottom - plate.top + CLEARANCE_GAP)
  return null
}

/**
 * `clearanceFor` the viewer's own seat inside `stageRef`, kept current while `active` (while a result card is up).
 *
 * The seat and its plate are found by `Seat`'s `data-me="true"` and `data-plate` markers — a contract of their own,
 * not CSS-module class names. It is measured before paint, again whenever the stage or the seat changes size (a
 * resize, the tray growing, the seat's lines filling in), once the web fonts have landed, and whenever `seat` — the
 * viewer's seat number, `null` while they watch — changes: taking a seat or leaving it under the card resizes
 * nothing that is watched. The seat is looked up afresh on every measurement and the new element observed, because a
 * switch between the ring and the stack layouts draws it anew. Where there is no `ResizeObserver` (jsdom) it measures
 * once per change. Not active, it observes nothing and returns `null`, and it forgets its last answer then, so the next
 * card starts from nothing rather than from the last hand's seat.
 */
export function useSeatClearance(
  stageRef: RefObject<HTMLElement>,
  active: boolean,
  seat: number | null,
  { minRoom = MIN_CARD, aboveHand = false }: { minRoom?: number; aboveHand?: boolean } = {},
): number | null {
  const [clearance, setClearance] = useState<number | null>(null)
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!active || stage === null) return
    let live = true
    let watched: Element | null = null
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure())
    function measure(): void {
      if (!live || stage === null) return
      const mine = stage.querySelector('[data-me="true"]')
      const plate = mine?.querySelector('[data-plate]') ?? null
      if (observer !== null && mine !== watched) {
        if (watched !== null) observer.unobserve(watched)
        if (mine !== null) observer.observe(mine)
        watched = mine
      }
      let seatTop: Pick<DOMRect, 'top'> | null = mine?.getBoundingClientRect() ?? null
      // The viewer's fan may stand above the seat's own box (the stack's strip splays its cards up from their feet): the draft
      // wants to stop above the highest card, not above the box they overflow.
      if (aboveHand && mine !== null && seatTop !== null) {
        const tops = Array.from(mine.querySelectorAll('[data-hand] > *'), (card) => card.getBoundingClientRect().top)
        seatTop = { top: Math.min(seatTop.top, ...tops) }
      }
      setClearance(clearanceFor(stage.getBoundingClientRect(), seatTop, plate?.getBoundingClientRect() ?? null, minRoom))
    }
    observer?.observe(stage)
    measure()
    void document.fonts?.ready.then(measure)
    return () => {
      live = false
      observer?.disconnect()
      // Switched off (or about to measure again for a new seat): nothing from here may outlive this card.
      setClearance(null)
    }
    // `seat` is read by nothing above: its change is the moment to look for the seat again (drawn, moved or removed).
  }, [stageRef, active, seat, minRoom, aboveHand])
  return active ? clearance : null
}
