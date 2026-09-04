/**
 * Seat geometry for the ring layout.
 *
 * Positions are percentages of the table box, on an ellipse (rx 42 %, ry 38 %) so the seats straddle the gold rail.
 * The viewer's seat is always at the bottom centre; the remaining seats keep their clockwise table order, which on
 * screen means bottom → left → top → right (screen `y` grows downward, so an increasing angle reads as clockwise).
 */
export function ringPositions(seatOrder: number[], anchorSeat: number | null): Map<number, { x: number; y: number }> {
  const n = seatOrder.length
  const out = new Map<number, { x: number; y: number }>()
  if (n === 0) return out
  const anchorIdx = anchorSeat === null ? 0 : Math.max(0, seatOrder.indexOf(anchorSeat))
  for (let i = 0; i < n; i++) {
    const rel = (i - anchorIdx + n) % n
    const angle = Math.PI / 2 + (rel * 2 * Math.PI) / n // anchor at bottom, clockwise = increasing angle (screen y grows downward)
    out.set(seatOrder[i]!, { x: 50 + 42 * Math.cos(angle), y: 50 + 38 * Math.sin(angle) })
  }
  return out
}
