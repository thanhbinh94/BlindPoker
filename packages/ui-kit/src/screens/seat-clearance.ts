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
 * Every place the stage may stop, best first, each as `clearanceFor` answers it: above the whole seat block, then above the
 * plate — each only when it leaves `minRoom` above it — and last the whole stage (`null`). A spectator gets the whole stage
 * alone; a tier no different from the one before it is not listed twice.
 */
export function clearanceTiers(
  stage: Pick<DOMRect, 'top' | 'bottom'>,
  seat: Pick<DOMRect, 'top'> | null,
  plate: Pick<DOMRect, 'top'> | null,
  minRoom: number = MIN_CARD,
): (number | null)[] {
  const tiers: (number | null)[] = []
  if (seat === null) return [null]
  for (const top of [seat.top, plate?.top ?? null]) {
    if (top === null || top - stage.top - CLEARANCE_GAP < minRoom) continue
    const clearance = Math.max(0, stage.bottom - top + CLEARANCE_GAP)
    if (tiers.at(-1) !== clearance) tiers.push(clearance)
  }
  tiers.push(null)
  return tiers
}

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
 * draft passes 0, so tier 1 always qualifies and the hook's `fit` decides how far down it steps. `aboveHand` also counts the
 * cards of the viewer's fan (`[data-hand]`), which may stand above the seat's own box.
 * A spectator has no seat to clear (`null`). The answer is never negative: a seat laid out below the stage's foot has
 * nothing on screen to clear.
 */
export function clearanceFor(stage: DOMRect, seat: Pick<DOMRect, 'top'> | null, plate: Pick<DOMRect, 'top'> | null, minRoom: number = MIN_CARD): number | null {
  return clearanceTiers(stage, seat, plate, minRoom)[0] ?? null
}

/** Two lists of tiers that say the same, so a measurement that found nothing new does not draw the room again. */
const sameTiers = (a: (number | null)[] | null, b: (number | null)[]): boolean => a !== null && a.length === b.length && a.every((x, i) => x === b[i])

/**
 * The top of the viewer's fan as it will lie (BP-40). A card still being dealt — the stack's strip deals the last hand's cards
 * again from the deck when the result strip gives the seat back (`display: none` restarts a CSS animation) — stands wherever
 * its flight has got to, as far up as the deck; the fan's own box, which no animation moves, stands for it until it lands.
 */
function fanTop(mine: Element): number | null {
  const hand = mine.querySelector('[data-hand]')
  if (hand === null) return null
  const tops = Array.from(hand.children, (card) => {
    const flying = typeof card.getAnimations === 'function' && card.getAnimations().length > 0
    return (flying ? hand : card).getBoundingClientRect().top
  })
  return tops.length === 0 ? null : Math.min(...tops)
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
 *
 * With `aboveHand`, the viewer's fan counts too, and a fan card's deal animation ending measures again: a transform moves
 * nothing a `ResizeObserver` sees. With `fit` — the overlay whose first child is the panel laid over the felt (the chaos
 * draft) — the stage stops at the first tier where that panel does not have to scroll: it steps down from above the hand
 * to above the plate, then to the whole stage (BP-40: on a short stage the last hand's fan and lines lift the seat, and above
 * them the draft had half its height). It steps down only, starting again from the top for the next card, a new seat, or a
 * stage of another size.
 */
export function useSeatClearance(
  stageRef: RefObject<HTMLElement>,
  active: boolean,
  seat: number | null,
  { minRoom = MIN_CARD, aboveHand = false, fit }: { minRoom?: number; aboveHand?: boolean; fit?: RefObject<HTMLElement> } = {},
): number | null {
  const [tiers, setTiers] = useState<(number | null)[] | null>(null)
  /** How many tiers `fit` has stepped down past, the panel having to scroll on each. */
  const [step, setStep] = useState(0)
  const clearance = tiers === null ? null : (tiers[Math.min(step, tiers.length - 1)] ?? null)
  const steps = tiers === null ? 0 : tiers.length - 1

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!active || stage === null) return
    let live = true
    let watched: Element | null = null
    let size: string | null = null
    const panel = fit?.current?.firstElementChild ?? null
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
      const box = stage.getBoundingClientRect()
      // A stage of another size (a phone turned, the browser's bars) may have room above the hand again.
      const now = `${Math.round(box.width)}×${Math.round(box.height)}`
      // The first look of a card: the panel is still laid out at the last answer, which says nothing about this card.
      const first = size === null
      const resized = !first && size !== now
      if (resized) setStep(0)
      size = now
      let seatTop: Pick<DOMRect, 'top'> | null = mine?.getBoundingClientRect() ?? null
      // The viewer's fan may stand above the seat's own box (the stack's strip splays its cards up from their feet): the draft
      // wants to stop above the highest card, not above the box they overflow.
      if (aboveHand && mine !== null && seatTop !== null) {
        const top = fanTop(mine)
        if (top !== null) seatTop = { top: Math.min(seatTop.top, top) }
      }
      const next = clearanceTiers(box, seatTop, plate?.getBoundingClientRect() ?? null, minRoom)
      setTiers((was) => (sameTiers(was, next) ? was : next))
      // The panel's own content changed (a pick, the waiting line) and it scrolls where it stands: one tier down.
      if (!first && !resized && panel !== null && panel.scrollHeight > panel.clientHeight + 1) setStep((was) => Math.min(was + 1, next.length - 1))
    }
    // A fan card landing, or one turning over in place: the measurement taken while it flew is stale now.
    const landed = (event: Event): void => {
      if (event.target instanceof Element && event.target.closest('[data-me="true"] [data-hand]') !== null) measure()
    }
    observer?.observe(stage)
    if (panel !== null) observer?.observe(panel)
    if (aboveHand) {
      stage.addEventListener('animationend', landed)
      stage.addEventListener('animationcancel', landed)
    }
    measure()
    void document.fonts?.ready.then(measure)
    return () => {
      live = false
      observer?.disconnect()
      stage.removeEventListener('animationend', landed)
      stage.removeEventListener('animationcancel', landed)
      // Switched off (or about to measure again for a new seat): nothing from here may outlive this card.
      setTiers(null)
      setStep(0)
    }
    // `seat` is read by nothing above: its change is the moment to look for the seat again (drawn, moved or removed).
  }, [stageRef, active, seat, minRoom, aboveHand, fit])

  // The panel is laid out at the clearance just drawn: if it has to scroll there, the next tier down is tried, before paint.
  useLayoutEffect(() => {
    const panel = fit?.current?.firstElementChild ?? null
    if (!active || panel === null || step >= steps) return
    if (panel.scrollHeight > panel.clientHeight + 1) setStep(step + 1)
  }, [fit, active, clearance, step, steps])

  return active ? clearance : null
}
