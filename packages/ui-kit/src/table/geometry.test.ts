import { describe, expect, it } from 'vitest'
import { ringPositions } from './geometry.js'

describe('ringPositions', () => {
  it('puts the anchor seat at the bottom centre and keeps clockwise order', () => {
    const pos = ringPositions([0, 1, 2, 3], 2)
    expect(pos.get(2)!.x).toBeCloseTo(50, 0)
    expect(pos.get(2)!.y).toBeGreaterThan(80)
    expect(pos.get(0)!.y).toBeLessThan(20) // opposite seat on top
    expect(pos.get(3)!.x).toBeLessThan(50) // next clockwise after anchor sits to the left
    expect(pos.get(1)!.x).toBeGreaterThan(50)
  })
  it('uses seat 0-first order for spectators and handles 2 and 9 seats', () => {
    const two = ringPositions([4, 7], null)
    expect(two.get(4)!.y).toBeGreaterThan(80)
    expect(two.get(7)!.y).toBeLessThan(20)
    const nine = ringPositions([0, 1, 2, 3, 4, 5, 6, 7, 8], 0)
    expect(nine.size).toBe(9)
    for (const p of nine.values()) {
      expect(p.x).toBeGreaterThanOrEqual(5)
      expect(p.x).toBeLessThanOrEqual(95)
      expect(p.y).toBeGreaterThanOrEqual(5)
      expect(p.y).toBeLessThanOrEqual(95)
    }
  })
  it('spaces a full table evenly around the rim, not evenly in angle', () => {
    const order = [0, 1, 2, 3, 4, 5, 6, 7, 8]
    const pos = ringPositions(order, 0)
    // distances in the table box's own pixels: it is twice as wide as it is tall
    const points = order.map((seat) => pos.get(seat)!)
    const gaps = points.map((p, i) => {
      const next = points[(i + 1) % points.length]!
      return Math.hypot((next.x - p.x) * 2, next.y - p.y)
    })
    const min = Math.min(...gaps)
    const max = Math.max(...gaps)
    // arcs are equal by construction; chords still vary a little with the curvature, but nowhere near the 2.4x
    // spread an even sweep of angle produced on this box
    expect(max / min).toBeLessThan(1.25)
    // even angles would have crowded the flanks: the two seats beside the bottom one stay well apart vertically
    expect(Math.abs(pos.get(2)!.y - pos.get(3)!.y)).toBeGreaterThan(10)
  })
  it('spaces seats by equal arc length for the given box ratio, so a 2.5:1 box gives different angles than 2:1 and equal pixel gaps', () => {
    const order = [0, 1, 2, 3, 4, 5, 6, 7]
    const box = { w: 2.5, h: 1 }
    const wide = ringPositions(order, 0, box)
    const base = ringPositions(order, 0)
    // still on the same 50 ± 42 / 50 ± 38 ellipse, in percentages of the box
    for (const p of wide.values()) expect(((p.x - 50) / 42) ** 2 + ((p.y - 50) / 38) ** 2).toBeCloseTo(1, 6)
    // a box 250 px tall and 625 px wide: the gaps between neighbours, measured along the rim in pixels, are equal — and
    // on a wide box that also makes the chords between the seats beside the bottom one equal within a pixel
    const px = (p: { x: number; y: number }) => ({ x: (p.x / 100) * 625, y: (p.y / 100) * 250 })
    const points = order.map((seat) => px(wide.get(seat)!))
    const arc = (from: { x: number; y: number }, to: { x: number; y: number }): number => {
      // walk the ellipse between the two points' angles in fine steps
      const a0 = Math.atan2((from.y - 125) / (0.38 * 250), (from.x - 312.5) / (0.42 * 625))
      let a1 = Math.atan2((to.y - 125) / (0.38 * 250), (to.x - 312.5) / (0.42 * 625))
      while (a1 <= a0) a1 += 2 * Math.PI
      let sum = 0
      const steps = 2000
      for (let k = 0; k < steps; k++) {
        const t0 = a0 + ((a1 - a0) * k) / steps
        const t1 = a0 + ((a1 - a0) * (k + 1)) / steps
        sum += Math.hypot(0.42 * 625 * (Math.cos(t1) - Math.cos(t0)), 0.38 * 250 * (Math.sin(t1) - Math.sin(t0)))
      }
      return sum
    }
    const arcs = points.map((p, i) => arc(p, points[(i + 1) % points.length]!))
    for (const a of arcs) expect(Math.abs(a - arcs[0]!)).toBeLessThan(1)
    // mirror pairs around the bottom seat sit at equal chord lengths from it
    const chord = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)
    expect(Math.abs(chord(points[0]!, points[1]!) - chord(points[0]!, points[7]!))).toBeLessThan(1)
    expect(Math.abs(chord(points[1]!, points[2]!) - chord(points[7]!, points[6]!))).toBeLessThan(1)
    // the angles are the box's own: the seat beside the bottom one moves along the rim when the box widens
    expect(Math.abs(wide.get(1)!.x - base.get(1)!.x)).toBeGreaterThan(0.5)
    // and the 2:1 default is what an explicit 2:1 box gives
    expect(ringPositions(order, 0, { w: 500, h: 250 })).toEqual(base)
  })
})
