/**
 * Seat geometry for the ring layout.
 *
 * Positions are percentages of the table box, on an ellipse (rx 42 %, ry 38 %) so the seats straddle the gold rail.
 * The viewer's seat is always at the bottom centre; the remaining seats keep their clockwise table order, which on
 * screen means bottom → left → top → right (screen `y` grows downward, so an increasing angle reads as clockwise).
 *
 * Seats are spaced by **arc length, not by angle**. The table box is wider than it is tall (twice on a desktop, `.ring`
 * in `table.module.css`; about three times on a phone held sideways), so an even sweep of angle bunches seats together
 * on the short flanks — at nine seats two neighbours there ended up 100 px apart with 150 px-tall name plates, i.e. on
 * top of each other. Dividing the rim into equal *distances* instead spreads all nine evenly around it, which is also
 * how a real table seats people. Distances are only equal in the box's own pixels, so the box's shape is an input: the
 * table measures its ring and passes it in (Plan 26, B3); the default is the desktop's 2:1.
 */

/** Seat ellipse, as percentages of the table box. */
const RX = 42
const RY = 38
/** Fine enough that the residual spacing error is well under a pixel at any realistic table size. */
const SAMPLES = 1440

/**
 * The `n` angles that cut the seat ellipse into equal arcs, the first at the bottom centre and the rest clockwise.
 * `ratio` is the box's width over its height: the half-axes are measured in units of the box height, which is the space
 * distances have to be measured in. Walked numerically: a closed form for the inverse of an elliptic arc does not
 * exist, and n ≤ 9 runs once per seat count and box shape.
 */
function equalArcAngles(n: number, ratio: number): number[] {
  const ax = RX * ratio
  const ay = RY
  const step = (2 * Math.PI) / SAMPLES
  const start = Math.PI / 2
  const cumulative = new Float64Array(SAMPLES + 1)
  for (let i = 1; i <= SAMPLES; i++) {
    const mid = start + (i - 0.5) * step
    const dx = ax * Math.sin(mid)
    const dy = ay * Math.cos(mid)
    cumulative[i] = cumulative[i - 1]! + Math.hypot(dx, dy) * step
  }
  const perimeter = cumulative[SAMPLES]!
  const out: number[] = []
  let i = 0
  for (let k = 0; k < n; k++) {
    const target = (k * perimeter) / n
    while (i < SAMPLES && cumulative[i + 1]! < target) i++
    // linear interpolation inside the sample the target falls in
    const span = cumulative[i + 1]! - cumulative[i]!
    const frac = span === 0 ? 0 : (target - cumulative[i]!) / span
    out.push(start + (i + frac) * step)
  }
  return out
}

/** Angles are the same for every table of a given size and shape, so they are computed once per seat count and box
 * ratio (to three decimals: a resize that moves the ratio less than that moves no seat by a pixel). */
const angleCache = new Map<string, number[]>()

/** The desktop's ring: `.ring` pins `aspect-ratio: 2 / 1`. */
const DEFAULT_BOX = { w: 2, h: 1 }

export function ringPositions(
  seatOrder: number[],
  anchorSeat: number | null,
  box: { w: number; h: number } = DEFAULT_BOX,
): Map<number, { x: number; y: number }> {
  const n = seatOrder.length
  const out = new Map<number, { x: number; y: number }>()
  if (n === 0) return out
  // A box not laid out yet (0 × 0) has no shape to speak of: it is taken as the default.
  const raw = box.w > 0 && box.h > 0 ? box.w / box.h : DEFAULT_BOX.w / DEFAULT_BOX.h
  // rounded before use, so a seat lands on the same spot whichever ratio of a cached pair came first
  const ratio = Number(raw.toFixed(3))
  const key = `${n}:${ratio}`
  let angles = angleCache.get(key)
  if (angles === undefined) {
    angles = equalArcAngles(n, ratio)
    angleCache.set(key, angles)
  }
  const anchorIdx = anchorSeat === null ? 0 : Math.max(0, seatOrder.indexOf(anchorSeat))
  for (let i = 0; i < n; i++) {
    const rel = (i - anchorIdx + n) % n
    const angle = angles[rel]!
    out.set(seatOrder[i]!, { x: 50 + RX * Math.cos(angle), y: 50 + RY * Math.sin(angle) })
  }
  return out
}

/**
 * The short ring's seat, as `table.module.css` sizes it (`[data-tier='short'] .seat`): 11 % of the ring's width, never
 * under 92 px. `edge` is what a seat keeps from the ring's side, `gap` what two seats keep between them.
 */
export const SHORT_SEAT = { share: 0.11, minPx: 92, edgePx: 4, gapPx: 4 } as const
/** The short ring's box until it is measured (and in jsdom): the stage of the user's 855 × 319 phone (bug log §10). */
export const SHORT_DEFAULT_BOX = { w: 831, h: 255 } as const

/**
 * The seats of the landscape frame's `short` tier (BP-28, R1): a stage under 300 px tall, where an ellipse of the
 * stage's height put two seats on top of each other at each flank and the viewer's cards on the board. The table is a
 * stadium as wide as the stage, and the seats sit on three lines of it — no seat has another above or below it, and the
 * board has the middle to itself:
 *
 * - the viewer at the bottom centre (`y` 100), standing on the stage's foot between the two corner docks;
 * - with three opponents or more, the next seat clockwise and the last one at the stadium's two ends (`y` 50), against
 *   the ring's sides (`SHORT_SEAT.edgePx` in), beside the board;
 * - everyone else on the top line (`y` 0), hung from the stage's top edge, left to right in clockwise order, evenly
 *   spaced between the end seats — clear of them across, so the two lines never meet whatever either holds — and never
 *   more than a quarter of the width apart. Too many for that (nine seats on a narrow phone), the line takes the
 *   whole width and passes over the end seats, whose blocks the CSS keeps below it.
 *
 * Distances are pixels, so the box's width is an input (`PokerTable` measures the ring); `x` and `y` come back as
 * percentages of it, as `ringPositions` gives them. The short tier's CSS hangs a `y < 50` seat from its point, centres an
 * end seat on its own line and stands the viewer's on the foot. A spectator (`anchorSeat` null) sees the first seat in
 * the viewer's place, as on the ellipse.
 */
export function shortRingPositions(
  seatOrder: number[],
  anchorSeat: number | null,
  box: { w: number; h: number } = SHORT_DEFAULT_BOX,
): Map<number, { x: number; y: number }> {
  const n = seatOrder.length
  const out = new Map<number, { x: number; y: number }>()
  if (n === 0) return out
  const w = box.w > 0 ? box.w : SHORT_DEFAULT_BOX.w
  const pct = (px: number): number => (px / w) * 100
  const seatW = Math.max(SHORT_SEAT.share * w, SHORT_SEAT.minPx)
  const anchorIdx = anchorSeat === null ? 0 : Math.max(0, seatOrder.indexOf(anchorSeat))
  const at = (rel: number): number => seatOrder[(anchorIdx + rel) % n]!
  out.set(at(0), { x: 50, y: 100 })
  const others = n - 1
  const ends = others >= 3
  const endX = seatW / 2 + SHORT_SEAT.edgePx
  if (ends) {
    out.set(at(1), { x: pct(endX), y: 50 })
    out.set(at(n - 1), { x: 100 - pct(endX), y: 50 })
  }
  const first = ends ? 2 : 1
  const top = ends ? others - 2 : others
  // The outermost centres of the top line: clear of the end seats when the line fits between them, else the whole width.
  const pitch = seatW + SHORT_SEAT.gapPx
  const between = ends ? endX + seatW / 2 + SHORT_SEAT.gapPx + seatW / 2 : endX
  const inner = top <= 1 || (w - 2 * between) / (top - 1) >= pitch ? between : endX
  const step = top <= 1 ? 0 : Math.min((w - 2 * inner) / (top - 1), w / 4)
  for (let k = 0; k < top; k++) out.set(at(first + k), { x: 50 + pct((k - (top - 1) / 2) * step), y: 0 })
  return out
}
