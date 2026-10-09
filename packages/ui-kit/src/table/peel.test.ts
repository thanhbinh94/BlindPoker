import { describe, expect, it } from 'vitest'
import { PEEL, inward, peelDirection, peelExtent, peelFrame, shouldOpen, type Vec } from './peel.js'

const W = 60, H = 84
const nums = (clip: string) => clip.match(/-?\d+(\.\d+)?/g)!.map(Number)
const EMPTY = 'polygon(0px 0px, 0px 0px, 0px 0px)'

describe('peel geometry (spec 2026-10-08 §3)', () => {
  it('points from the press into the centre, exactly, and from the bottom near the middle', () => {
    expect(peelDirection(0, 40)).toEqual([0, -1])
    const [ux, uy] = peelDirection(30, 40)
    expect(ux).toBeCloseTo(-0.6)
    expect(uy).toBeCloseTo(-0.8)
    expect(peelDirection(5, 5)).toEqual([0, -1])
    expect(peelDirection(-30, 0)).toEqual([1, 0])
  })

  it('measures the card along the peel: the bottom edge runs the height, a corner the diagonal', () => {
    expect(peelExtent([0, -1], W, H)).toEqual({ sMin: -H, sMax: 0, L: H })
    const d = peelExtent([-Math.SQRT1_2, -Math.SQRT1_2], W, H)
    expect(d.L).toBeCloseTo((W + H) * Math.SQRT1_2)
  })

  it('at p = 0 nothing is peeled; at p = ½ the face sits in place over the far half; at p = 1 the face has moved a card length', () => {
    const u = [0, -1] as const
    const closed = peelFrame(u, 0, W, H)
    expect(closed.backClip).toBe('none')
    expect(closed.faceClip).toBe(EMPTY)
    expect(closed.done).toBe(false)

    const half = peelFrame(u, 0.5, W, H)
    expect(half.faceShift).toEqual([0, 0])
    expect(Math.max(...nums(half.backClip).filter((_, i) => i % 2 === 1))).toBeCloseTo(H / 2) // the back keeps the top half
    expect(Math.min(...nums(half.faceClip).filter((_, i) => i % 2 === 1))).toBeCloseTo(0) // the face shows its top half…
    expect(Math.max(...nums(half.faceClip).filter((_, i) => i % 2 === 1))).toBeCloseTo(H / 2)
    expect(half.fold).toMatchObject({ x: W / 2, y: H / 2 })
    expect(half.fold.angle).toBeCloseTo(0)

    const open = peelFrame(u, 1, W, H)
    expect(open.faceShift[1]).toBeCloseTo(-H) // along u, a full length
    expect(open.faceClip).toBe('none')
    expect(open.backClip).toBe(EMPTY)
    expect(open.done).toBe(true)
  })

  it('a corner peel folds along the diagonal', () => {
    const u = [-Math.SQRT1_2, -Math.SQRT1_2] as const // pressed at the bottom-right corner
    const f = peelFrame(u, 0.3, W, H)
    expect(Math.abs(f.fold.angle)).toBeCloseTo(Math.PI / 4)
    expect(f.backClip).toMatch(/^polygon\(/)
    expect(f.faceClip).toMatch(/^polygon\(/)
  })

  // Spec §8: the eight directions and one that is neither an edge nor a corner.
  const R = Math.SQRT1_2
  const DIRECTIONS: Vec[] = [[1, 0], [R, R], [0, 1], [-R, R], [-1, 0], [-R, -R], [0, -1], [R, -R], [0.28, -0.96]]
  it.each(DIRECTIONS.map((u): [string, Vec] => [`(${u[0].toFixed(2)}, ${u[1].toFixed(2)})`, u]))('peeling along %s: the face moves 2pL − L, the fold sits at sMin + pL, and the ends are whole or empty', (_, u) => {
    const { sMin, L } = peelExtent(u, W, H)
    for (const p of [0, 0.2, 0.5, 0.7, 1]) {
      const f = peelFrame(u, p, W, H)
      expect(Math.hypot(...f.faceShift)).toBeCloseTo(Math.abs(2 * p * L - L))
      expect(f.fold.x * u[0] + f.fold.y * u[1]).toBeCloseTo(sMin + p * L)
      // The fold line runs across the peel.
      expect(Math.cos(f.fold.angle) * u[0] + Math.sin(f.fold.angle) * u[1]).toBeCloseTo(0)
      expect(f.faceShift.some((n) => Object.is(n, -0))).toBe(false)
    }
    expect(peelFrame(u, 0, W, H)).toMatchObject({ backClip: 'none', faceClip: EMPTY, done: false })
    expect(peelFrame(u, 1, W, H)).toMatchObject({ backClip: EMPTY, faceClip: 'none', done: true })
  })

  it('travel is the drag projected on the peel, and opening needs half a card or a flick', () => {
    expect(inward([0, -1], 0, -30)).toBe(30)
    expect(inward([0, -1], 30, 0)).toBe(0)
    expect(shouldOpen(0.5, 0)).toBe(true)
    expect(shouldOpen(0.49, 0)).toBe(false)
    expect(shouldOpen(0.2, PEEL.flick)).toBe(true)
    expect(shouldOpen(0.1, 5)).toBe(false) // too early for a flick to count
  })
})
