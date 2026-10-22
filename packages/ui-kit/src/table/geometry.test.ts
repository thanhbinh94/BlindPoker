import { describe, expect, it } from 'vitest'
import { SHORT_DEFAULT_BOX, SHORT_SEAT, ringPositions, shortRingPositions } from './geometry.js'

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

// BP-28: the landscape frame's short tier — the stage under 300 px tall, a stadium as wide as the stage.
describe('shortRingPositions', () => {
  const order = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

  it('puts the viewer at the bottom centre, the seats beside them at the two ends, the rest on the top line in clockwise order', () => {
    const pos = shortRingPositions(order(6), 2)
    expect(pos.get(2)).toEqual({ x: 50, y: 100 })
    // clockwise from the viewer: the left end, the top line left to right, the right end
    expect(pos.get(3)!.y).toBe(50)
    expect(pos.get(3)!.x).toBeLessThan(15)
    expect(pos.get(1)!.y).toBe(50)
    expect(pos.get(1)!.x).toBeGreaterThan(85)
    const top = [4, 5, 0].map((seat) => pos.get(seat)!)
    for (const p of top) expect(p.y).toBe(0)
    expect(top.map((p) => p.x)).toEqual([...top.map((p) => p.x)].sort((a, b) => a - b))
    // the top line is centred, and its seats are not data-edge seats (15 % / 85 % is `Seat`'s cut)
    expect(top[1]!.x).toBeCloseTo(50, 6)
    for (const p of top) expect(p.x > 15 && p.x < 85).toBe(true)
  })

  it('seats a spectator with the first seat in the viewer’s place, and two or three seats with no end seats', () => {
    expect(shortRingPositions(order(4), null).get(0)).toEqual({ x: 50, y: 100 })
    expect(shortRingPositions(order(2), 0).get(1)).toEqual({ x: 50, y: 0 })
    const three = shortRingPositions(order(3), 0)
    expect([three.get(1)!, three.get(2)!].map((p) => p.y)).toEqual([0, 0])
    expect(three.get(1)!.x).toBeCloseTo(37.5, 6)
    expect(three.get(2)!.x).toBeCloseTo(62.5, 6)
    expect(shortRingPositions([], null).size).toBe(0)
  })

  it('keeps the top line clear of the end seats across, and falls back to the whole width when it cannot fit between them', () => {
    const seatW = (w: number): number => Math.max(SHORT_SEAT.share * w, SHORT_SEAT.minPx)
    for (const n of [5, 6, 7, 8, 9]) {
      const w = SHORT_DEFAULT_BOX.w
      const pos = shortRingPositions(order(n), 0, SHORT_DEFAULT_BOX)
      const endRight = (pos.get(1)!.x / 100) * w + seatW(w) / 2
      const tops = [...pos.values()].filter((p) => p.y === 0).map((p) => (p.x / 100) * w)
      expect(Math.min(...tops) - seatW(w) / 2, `${n} seats: the top line starts right of the left end seat`).toBeGreaterThan(endRight)
    }
    // nine seats on a 716 px stage (740 × 300): six seats of 92 px do not fit between the ends, so the line spans the width
    const narrow = shortRingPositions(order(9), 0, { w: 716, h: 236 })
    const xs = [...narrow.values()].filter((p) => p.y === 0).map((p) => p.x)
    expect(Math.min(...xs)).toBeCloseTo(narrow.get(1)!.x, 6)
  })

  it('gives every seat count from 1 to 9 a finite spot of its own, for any anchor and any box width', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      for (const anchor of [null, 0, n - 1]) {
        for (const w of [0, 500, 716, 831, 1000]) {
          const pos = shortRingPositions(order(n), anchor, { w, h: 236 })
          expect(pos.size, `${n} seats, anchor ${String(anchor)}, ${w} px`).toBe(n)
          const spots = new Set<string>()
          for (const p of pos.values()) {
            expect(Number.isFinite(p.x) && Number.isFinite(p.y), `${n} seats, anchor ${String(anchor)}, ${w} px`).toBe(true)
            spots.add(`${p.x.toFixed(3)},${p.y.toFixed(3)}`)
          }
          expect(spots.size, `${n} seats, anchor ${String(anchor)}, ${w} px: no two seats on one spot`).toBe(n)
        }
      }
    }
  })

  /**
   * The short tier's blocks as `table.module.css` lays them out, in the stage's pixels (measured in the playground on
   * 2026-10-22, `#worst/blindP/<n>/vi/short` and `/landscape` at 915 × 355): a top-line seat hangs 6 px under the stage's
   * top, 80 px tall in a hand (a 36 px plate, 22 px cards, an 18 px line, gaps); an end seat is centred at
   * max(130 px, half the stage + 6 px), as tall; the viewer's block is at most 30 % of the width, its cards beside the
   * plate and its line under them, standing 2 px above the stage's foot; the board row (deck, board, pot) is centred at
   * half the stage + 3 px, as tall as a board card; the tray's two corners take 35 % of the room each, 44 px up from the
   * stage's foot.
   */
  const SIZES = [
    { name: '855 × 319', w: 831, h: 255, boardRow: 335, ownCard: 40 },
    { name: '915 × 355', w: 891, h: 291, boardRow: 355, ownCard: 46.6 },
  ]
  interface Rect {
    label: string
    l: number
    r: number
    t: number
    b: number
  }
  const meets = (p: Rect, q: Rect): boolean => p.l < q.r && q.l < p.r && p.t < q.b && q.t < p.b
  for (const size of SIZES) {
    for (const n of [6, 8]) {
      it(`at ${size.name}, ${n} seats: no two seat blocks meet, and none meets the board row or the tray's corners`, () => {
        const { w, h } = size
        const seatW = Math.max(SHORT_SEAT.share * w, SHORT_SEAT.minPx)
        const pos = shortRingPositions(order(n), 0, { w, h })
        const blocks: Rect[] = [...pos.entries()].map(([seat, p]) => {
          const x = (p.x / 100) * w
          if (seat === 0) {
            const ownH = size.ownCard * 1.4 + 2 + 18
            return { label: 'me', l: x - 0.15 * w, r: x + 0.15 * w, t: h - 2 - ownH, b: h - 2 }
          }
          if (p.y === 0) return { label: `top ${seat}`, l: x - seatW / 2, r: x + seatW / 2, t: 6, b: 86 }
          const c = Math.max(130, h / 2 + 6)
          return { label: `end ${seat}`, l: x - seatW / 2, r: x + seatW / 2, t: c - 40, b: c + 40 }
        })
        const cardH = 1.4 * Math.min(34, Math.max(26, 0.11 * h))
        const board: Rect = { label: 'board', l: w / 2 - size.boardRow / 2, r: w / 2 + size.boardRow / 2, t: h / 2 + 3 - cardH / 2, b: h / 2 + 3 + cardH / 2 }
        const corner = 0.35 * (w + 24) - 8 - 12
        const corners: Rect[] = [
          { label: 'left corner', l: 0, r: corner, t: h - 44, b: h + 4 },
          { label: 'right corner', l: w - corner, r: w, t: h - 44, b: h + 4 },
        ]
        const problems: string[] = []
        for (let i = 0; i < blocks.length; i++) {
          const a = blocks[i]!
          if (a.l < 0 || a.r > w || a.t < 0 || a.b > h) problems.push(`${a.label} leaves the stage`)
          for (let j = i + 1; j < blocks.length; j++) if (meets(a, blocks[j]!)) problems.push(`${a.label} meets ${blocks[j]!.label}`)
          for (const other of [board, ...corners]) if (meets(a, other)) problems.push(`${a.label} meets the ${other.label}`)
        }
        expect(problems).toEqual([])
      })
    }
  }
})
