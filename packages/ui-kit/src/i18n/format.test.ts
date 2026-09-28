import { describe, expect, it } from 'vitest'
import { formatDay, formatMoment } from './format.js'

// Local-time constructors: the helpers format in the device's zone, so the test builds its dates in it too.
const MOMENT = new Date(2026, 8, 28, 8, 46).getTime()
const NOW = new Date(2026, 10, 2, 12, 0).getTime()

describe('formatMoment', () => {
  it('writes the clock, then the day in the same words formatDay uses (layout audit C2)', () => {
    expect(formatMoment(MOMENT, 'vi', NOW)).toBe('08:46, 28 thg 9')
    expect(formatDay(MOMENT, 'vi')).toBe('28 thg 9, 2026')
    expect(formatMoment(MOMENT, 'en', NOW)).toBe('08:46 AM, Sep 28')
  })

  it('names the year only when it is not this one', () => {
    const lastYear = new Date(2025, 2, 4, 0, 5).getTime()
    expect(formatMoment(lastYear, 'vi', NOW)).toBe('00:05, 4 thg 3, 2025')
    expect(formatMoment(lastYear, 'en', NOW)).toBe('12:05 AM, Mar 4, 2025')
  })
})
