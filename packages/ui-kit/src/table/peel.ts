/**
 * The squeeze's geometry (spec 2026-10-08 §3), pure: a card `w × h` peeled along the unit vector `u` (into the card
 * from the pressed side), `p` of the way (0 face down, 1 peeled right over). s(P) = P·u runs from `sMin` at the pressed
 * edge or corner to `sMax` at the far side, `L` apart; the fold is at s = sMin + p·L.
 *
 * The lifted part lies back over the rest showing the face — the face that was *under* the card, which a card laid
 * face down by a turn about the same axis shows upright: the face slid along u by 2f − L, clipped to its far `f`. At
 * p = ½ the face is exactly in place with its far half showing; at p = 1 it has moved a card length and the back is gone.
 *
 * The numbers: past `threshold` of the way, or let go moving inward at `flick` px/ms once past 0.12, the card finishes
 * (`finishMs`) and slides back into place face up (`slideMs`); let go earlier it snaps back face down (`snapMs`). A drag
 * of `travel` × L along the peel peels it right over. A press within `centreDead` px of the centre peels from the bottom.
 */
export const PEEL = { threshold: 0.5, flick: 0.9, travel: 0.75, snapMs: 200, finishMs: 260, slideMs: 220, centreDead: 16 } as const

export type Vec = readonly [number, number]

/** The clip of nothing: `clip-path` has no empty value, so a degenerate triangle stands for one. */
const EMPTY = 'polygon(0px 0px, 0px 0px, 0px 0px)'

/** `-0` as `0`, so a vector built by negating or scaling compares equal to the one written out. */
const tidy = (n: number): number => (n === 0 ? 0 : n)

/** From the press point relative to the card's centre, the direction the card peels: into the centre. */
export function peelDirection(dx: number, dy: number): Vec {
  const n = Math.hypot(dx, dy)
  if (n < PEEL.centreDead) return [0, -1]
  return [tidy(-dx / n), tidy(-dy / n)]
}

export function peelExtent(u: Vec, w: number, h: number): { sMin: number; sMax: number; L: number } {
  const ss = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => x! * u[0] + y! * u[1])
  const sMin = Math.min(...ss), sMax = Math.max(...ss)
  return { sMin, sMax, L: sMax - sMin }
}

/** The shoelace area of a polygon. */
function area(pts: readonly (readonly [number, number])[]): number {
  let twice = 0
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!, [x1, y1] = pts[(i + 1) % pts.length]!
    twice += x0 * y1 - x1 * y0
  }
  return Math.abs(twice) / 2
}

/**
 * The card rectangle kept where s(P) ≥ s0 as a clip-path: `none` when that is all of it, the empty polygon when it has
 * no area — so the two ends of a peel read as whole and as nothing, whatever the rounding left of a corner.
 */
function keepBeyond(u: Vec, s0: number, w: number, h: number): string {
  const rect: [number, number][] = [[0, 0], [w, 0], [w, h], [0, h]]
  const f = ([x, y]: [number, number]) => x * u[0] + y * u[1] - s0
  if (rect.every((pt) => f(pt) >= -1e-6)) return 'none'
  const out: [number, number][] = []
  for (let i = 0; i < 4; i++) {
    const a = rect[i]!, b = rect[(i + 1) % 4]!, da = f(a), db = f(b)
    if (da >= 0) out.push(a)
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db)
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  if (area(out) < 1e-6) return EMPTY
  return `polygon(${out.map(([x, y]) => `${x.toFixed(2)}px ${y.toFixed(2)}px`).join(', ')})`
}

export interface PeelFrame {
  /** The back's clip: the part not yet lifted. */
  backClip: string
  /** The face's clip, in its own box: its far `f`, the part that shows once it is slid by `faceShift`. */
  faceClip: string
  faceShift: Vec
  /** The fold's point nearest the card's centre, and the fold line's angle (0 = horizontal, for a peel from the bottom). */
  fold: { x: number; y: number; angle: number }
  done: boolean
}

export function peelFrame(u: Vec, p: number, w: number, h: number): PeelFrame {
  const { sMin, sMax, L } = peelExtent(u, w, h)
  const f = Math.max(0, Math.min(1, p)) * L
  const c = sMin + f
  const d = 2 * f - L
  const sc = (sMin + sMax) / 2
  const k = c - sc
  return {
    backClip: keepBeyond(u, c, w, h),
    faceClip: keepBeyond(u, sMax - f, w, h),
    faceShift: [tidy(d * u[0]), tidy(d * u[1])],
    fold: { x: w / 2 + k * u[0], y: h / 2 + k * u[1], angle: Math.atan2(u[0], -u[1]) },
    done: p >= 1,
  }
}

/** How far a drag of (dx, dy) travels along the peel. */
export const inward = (u: Vec, dx: number, dy: number): number => dx * u[0] + dy * u[1]

/** Whether a peel let go at `p`, moving inward at `velocity` px/ms, finishes: past the threshold, or flicked once begun. */
export const shouldOpen = (p: number, velocity: number): boolean => p >= PEEL.threshold || (p > 0.12 && velocity >= PEEL.flick)
