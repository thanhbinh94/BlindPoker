import { describe, expect, it } from 'vitest'
import { ENTRANCE_MS, ENTRANCE_QUEUE_MAX, ENTRANCE_STALE_MS, FRESH_MS, scheduleEntrances, type Span } from './entrance-schedule.js'
import type { HeraldHold } from './useHeldWindow.js'

const NONE = new Map<number, number>()

const plan = (
  arrivals: readonly (readonly [id: number, at: number])[],
  o: { busy?: Span[]; hold?: HeraldHold | null; started?: Map<number, number>; ended?: Map<number, number>; now?: number } = {},
) =>
  scheduleEntrances(
    arrivals.map(([id, at]) => ({ id, at })),
    o.busy ?? [],
    o.hold ?? null,
    o.started ?? NONE,
    o.ended ?? NONE,
    o.now ?? 0,
  )

describe('scheduleEntrances (BP-42 spec §4)', () => {
  it('pins the plan’s numbers', () => {
    expect([ENTRANCE_MS, ENTRANCE_QUEUE_MAX, ENTRANCE_STALE_MS, FRESH_MS]).toEqual([3_000, 3, 10_000, 1_000])
  })

  it('one entrance shows at once for 3 s', () => {
    expect(plan([[1, 0]]).get(1)).toEqual({ from: 0, until: 3000 })
  })

  it('a second waits for the first', () => {
    const slots = plan([
      [1, 0],
      [2, 100],
    ])
    expect(slots.get(2)).toEqual({ from: 3000, until: 6000 })
  })

  it('a fourth at once is dropped', () => {
    const slots = plan([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ])
    expect(slots.get(1)).toEqual({ from: 0, until: 3000 })
    expect(slots.get(2)).toEqual({ from: 3000, until: 6000 })
    expect(slots.get(3)).toEqual({ from: 6000, until: 9000 })
    expect(slots.get(4)).toBe('dropped')
  })

  it('the queue counts the one on screen, and a place frees when one ends (Ruling 2)', () => {
    const slots = plan([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 3000],
    ])
    // At 3000 the first has gone: two wait or show, so the fourth has a place, after the third.
    expect(slots.get(4)).toEqual({ from: 9000, until: 12000 })
  })

  it('it waits for the BP-41 herald', () => {
    expect(plan([[1, 500]], { busy: [{ from: 0, until: 3000 }] }).get(1)).toEqual({ from: 3000, until: 6000 })
  })

  it('it waits for a gap as long as itself between two busy spans', () => {
    const busy = [
      { from: 0, until: 1000 },
      { from: 2000, until: 5000 },
    ]
    expect(plan([[1, 0]], { busy }).get(1)).toEqual({ from: 5000, until: 8000 })
  })

  it('it never shows during the hold', () => {
    expect(plan([[1, 100]], { hold: { since: 0, until: null }, now: 5000 }).get(1)).toBe('waiting')
    expect(plan([[1, 100]], { hold: { since: 0, until: 4000 }, now: 5000 }).get(1)).toEqual({ from: 4000, until: 7000 })
  })

  it('ones behind a waiting one wait too, and the band stays one at a time when the hold ends', () => {
    const arrivals = [
      [1, 100],
      [2, 200],
    ] as const
    const open = plan(arrivals, { hold: { since: 0, until: null }, now: 1000 })
    expect(open.get(2)).toBe('waiting')
    const closed = plan(arrivals, { hold: { since: 0, until: 2000 }, now: 2000 })
    expect(closed.get(1)).toEqual({ from: 2000, until: 5000 })
    expect(closed.get(2)).toEqual({ from: 5000, until: 8000 })
  })

  it('ten seconds waiting drops it', () => {
    expect(plan([[1, 1000]], { busy: [{ from: 0, until: 12000 }] }).get(1)).toBe('dropped')
    expect(plan([[1, 1000]], { hold: { since: 0, until: null }, now: 11_000 }).get(1)).toBe('waiting')
    expect(plan([[1, 1000]], { hold: { since: 0, until: null }, now: 11_001 }).get(1)).toBe('dropped')
  })

  it('one dropped as stale held its place until then: a later one dropped for a full queue stays dropped', () => {
    const arrivals = [
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 100],
    ] as const
    const hold = { since: 0, until: null }
    expect(plan(arrivals, { hold, now: 5000 }).get(4)).toBe('dropped')
    const later = plan(arrivals, { hold, now: 10_050 })
    expect([1, 2, 3].map((id) => later.get(id))).toEqual(['dropped', 'dropped', 'dropped'])
    expect(later.get(4)).toBe('dropped')
  })

  it('one already on screen is cut by a herald that comes', () => {
    const started = new Map([[1, 0]])
    expect(plan([[1, 0]], { started, busy: [{ from: 1000, until: 4000 }], now: 1000 }).get(1)).toEqual({ from: 0, until: 1000 })
  })

  it('one already on screen keeps its start, and the next waits for the herald that cut it', () => {
    const started = new Map([[1, 0]])
    const slots = plan(
      [
        [1, 0],
        [2, 500],
      ],
      { started, busy: [{ from: 1000, until: 4000 }], now: 1000 },
    )
    expect(slots.get(1)).toEqual({ from: 0, until: 1000 })
    expect(slots.get(2)).toEqual({ from: 4000, until: 7000 })
  })

  it('one on screen is cut by the reveal hold too', () => {
    const started = new Map([[1, 0]])
    expect(plan([[1, 0]], { started, hold: { since: 2000, until: null }, now: 2000 }).get(1)).toEqual({ from: 0, until: 2000 })
  })

  it('a dismissed one ends then, and the next starts at once (A8)', () => {
    const slots = plan(
      [
        [1, 0],
        [2, 100],
      ],
      { started: new Map([[1, 0]]), ended: new Map([[1, 1000]]), now: 1000 },
    )
    expect(slots.get(1)).toEqual({ from: 0, until: 1000 })
    expect(slots.get(2)).toEqual({ from: 1000, until: 4000 })
  })

  it('a dismissed one leaves the queue', () => {
    const slots = plan(
      [
        [1, 0],
        [2, 0],
        [3, 0],
        [4, 1500],
      ],
      { started: new Map([[1, 0]]), ended: new Map([[1, 1000]]), now: 1500 },
    )
    expect(slots.get(4)).toEqual({ from: 7000, until: 10000 })
  })

  it('takes the entrances in arrival order whatever order they come in', () => {
    const slots = plan([
      [2, 100],
      [1, 0],
    ])
    expect(slots.get(1)).toEqual({ from: 0, until: 3000 })
    expect(slots.get(2)).toEqual({ from: 3000, until: 6000 })
  })
})
