import { useLayoutEffect, useState, type RefObject } from 'react'
import { useMediaQuery } from './useMediaQuery.js'

/**
 * Which stage the room is laid out for: the `desktop` one (tray under the felt, header on top — which also serves a
 * portrait phone) or the `landscape` one, a phone held sideways, where every pixel of height is the table's.
 */
export type RoomFrame = 'desktop' | 'landscape'

/** A phone on its side: wider than tall, no more than 500 px of height, and at least 700 px wide — 915 × 355 (a tall
 * phone under its browser bars), 915 × 412 and 844 × 390. A laptop window never gets this short; a narrower short
 * window (a 640 × 360 phone) has no width for the ring's rim and keeps the stacked layout (Plan 26, ruling 8). */
export const LANDSCAPE_PHONE = '(orientation: landscape) and (max-height: 500px) and (min-width: 700px)'

/** The room's frame: `override` when given (a host app, the playground), otherwise what the viewport says. */
export function useRoomFrame(override?: RoomFrame): RoomFrame {
  // The hook runs either way, so the order of hooks does not change when an override comes and goes.
  const landscape = useMediaQuery(LANDSCAPE_PHONE)
  return override ?? (landscape ? 'landscape' : 'desktop')
}

/**
 * The landscape frame's two tiers (BP-28). `normal` is the frame Plan 26 designed: a 10 : 3 ellipse sized from the stage's
 * height. `short` is a stage under `SHORT_STAGE_PX` — a phone whose browser keeps its address bar, 855 × 319 on the user's
 * Android (a 255 px stage), and 915 × 355 (291 px) — and lays the ring out from the whole stage instead
 * (`shortRingPositions`, the `[data-tier='short']` rules). The desktop frame has one tier, `normal`.
 */
export type FrameTier = 'normal' | 'short'

/**
 * Under this many pixels of stage the landscape frame is `short` (BP-28, R1; ruling 1). The stage, not the viewport: the
 * header, the room's padding and its gaps are what stand between the two, and they are the frame's own business. 300, not
 * the 290 Plan 26 was drawn down to: at 915 × 355 the stage is 291 px, and there a six-seat Blind table's upper flank
 * seats lay "Bot · Đã chọn · 2.000" over the deck and the pot's figure; from 915 × 365 (301 px) the ellipse is clear.
 */
export const SHORT_STAGE_PX = 300

/** The tier for a stage `height` px tall in `frame`. A stage not laid out yet (0 px) is `normal`. */
export function stageTier(frame: RoomFrame, height: number): FrameTier {
  return frame === 'landscape' && height > 0 && height < SHORT_STAGE_PX ? 'short' : 'normal'
}

/**
 * The tier of the stage `ref` points at, in `frame`: measured before the first paint and again whenever the stage is
 * resized (a rotation, the browser's bars, full screen). Where there is no `ResizeObserver` (jsdom) it is measured once.
 * `mounted` says the stage is in the tree: a screen that renders nothing until its data arrives attaches the ref late,
 * and the measuring starts then.
 */
export function useStageTier(ref: RefObject<HTMLElement>, frame: RoomFrame, mounted = true): FrameTier {
  const [height, setHeight] = useState(0)
  const active = frame === 'landscape' && mounted
  useLayoutEffect(() => {
    const el = ref.current
    if (!active || el === null) return
    const measure = (): void => setHeight(el.getBoundingClientRect().height)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, active])
  return stageTier(frame, active ? height : 0)
}
