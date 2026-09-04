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
})
