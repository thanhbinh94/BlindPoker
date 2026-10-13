import { describe, expect, it } from 'vitest'
import { formatMonthKey } from './format.js'

describe('formatMonthKey', () => {
  it('writes a YYYY-MM month key as MM/YYYY', () => {
    expect(formatMonthKey('2026-11')).toBe('11/2026')
    expect(formatMonthKey('2027-02')).toBe('02/2027')
  })
})
