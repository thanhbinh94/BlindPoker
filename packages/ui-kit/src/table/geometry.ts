/**
 * Seat geometry for the ring layout.
 *
 * Positions are percentages of the table box, on an ellipse (rx 42 %, ry 38 %) so the seats straddle the gold rail.
 * The viewer's seat is always at the bottom centre; the remaining seats keep their clockwise table order, which on
 * screen means bottom → left → top → right (screen `y` grows downward, so an increasing angle reads as clockwise).
 *
 * Seats are spaced by **arc length, not by angle**. The table box is twice as wide as it is tall (`.ring` in
 * `table.module.css`), so an even sweep of angle bunches seats together on the short flanks — at nine seats two
 * neighbours there ended up 100 px apart with 150 px-tall name plates, i.e. on top of each other. Dividing the rim
 * into equal *distances* instead spreads all nine evenly around it, which is also how a real table seats people.
 */

/** Seat ellipse, as percentages of the table box. */
const RX = 42
const RY = 38
/** Width ÷ height of the table box; `.ring` pins it, and the rim is only "even" in the box's own pixels. */
const BOX_RATIO = 2
/** Fine enough that the residual spacing error is well under a pixel at any realistic table size. */
const SAMPLES = 1440

/** Half-axes in units of the box height, which is the space distances have to be measured in. */
const AX = RX * BOX_RATIO
const AY = RY

/**
 * The `n` angles that cut the seat ellipse into equal arcs, the first at the bottom centre and the rest clockwise.
 * Walked numerically: a closed form for the inverse of an elliptic arc does not exist, and n ≤ 9 runs once per render.
 */
function equalArcAngles(n: number): number[] {
  const step = (2 * Math.PI) / SAMPLES
  const start = Math.PI / 2
  const cumulative = new Float64Array(SAMPLES + 1)
  for (let i = 1; i <= SAMPLES; i++) {
    const mid = start + (i - 0.5) * step
    const dx = AX * Math.sin(mid)
    const dy = AY * Math.cos(mid)
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

/** Angles are the same for every table of a given size, so they are computed once per seat count. */
const angleCache = new Map<number, number[]>()

export function ringPositions(seatOrder: number[], anchorSeat: number | null): Map<number, { x: number; y: number }> {
  const n = seatOrder.length
  const out = new Map<number, { x: number; y: number }>()
  if (n === 0) return out
  let angles = angleCache.get(n)
  if (angles === undefined) {
    angles = equalArcAngles(n)
    angleCache.set(n, angles)
  }
  const anchorIdx = anchorSeat === null ? 0 : Math.max(0, seatOrder.indexOf(anchorSeat))
  for (let i = 0; i < n; i++) {
    const rel = (i - anchorIdx + n) % n
    const angle = angles[rel]!
    out.set(seatOrder[i]!, { x: 50 + RX * Math.cos(angle), y: 50 + RY * Math.sin(angle) })
  }
  return out
}
