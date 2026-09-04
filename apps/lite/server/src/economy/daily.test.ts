import { describe, expect, it } from 'vitest'
import { dayKey, daysBetween, evaluateDaily, reliefEligible } from './daily.js'

describe('dayKey', () => {
  it('renders the calendar day in the given IANA zone', () => {
    // 2026-01-31 23:30 UTC is already 2026-02-01 06:30 in Asia/Ho_Chi_Minh (UTC+7, no DST).
    const nowMs = Date.UTC(2026, 0, 31, 23, 30)
    expect(dayKey(nowMs, 'UTC')).toBe('2026-01-31')
    expect(dayKey(nowMs, 'Asia/Ho_Chi_Minh')).toBe('2026-02-01')
  })

  it('agrees with UTC away from a midnight boundary', () => {
    const nowMs = Date.UTC(2026, 8, 4, 3, 0)
    expect(dayKey(nowMs, 'UTC')).toBe('2026-09-04')
    expect(dayKey(nowMs, 'Asia/Ho_Chi_Minh')).toBe('2026-09-04')
  })
})

describe('daysBetween', () => {
  it('counts calendar days from a to b, using UTC arithmetic on the keys', () => {
    expect(daysBetween('2026-01-01', '2026-01-02')).toBe(1)
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0)
    expect(daysBetween('2026-01-02', '2026-01-01')).toBe(-1)
  })

  it('crosses a month boundary correctly', () => {
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1)
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1)
  })
})

describe('evaluateDaily', () => {
  const tz = 'UTC'
  // 2026-09-04, well clear of any midnight boundary in UTC.
  const today = Date.UTC(2026, 8, 4, 3, 0)

  it('allows a first-ever claim (no lastDailyClaim) and starts the streak at 1', () => {
    const r = evaluateDaily({ streak: 0, lastDailyClaim: null }, today, tz)
    expect(r).toMatchObject({ allowed: true, alreadyClaimed: false, day: 1, points: 5_000, streak: 1, lastClaim: null })
  })

  it('increments the streak on a consecutive calendar day within the same month', () => {
    const r = evaluateDaily({ streak: 3, lastDailyClaim: '2026-09-03' }, today, tz)
    expect(r).toMatchObject({ allowed: true, alreadyClaimed: false, day: 4, points: 8_000, streak: 4 })
  })

  it('resets the streak to 1 after a skipped day', () => {
    const r = evaluateDaily({ streak: 5, lastDailyClaim: '2026-09-01' }, today, tz)
    expect(r).toMatchObject({ allowed: true, alreadyClaimed: false, day: 1, points: 5_000, streak: 1 })
  })

  it('resets to 1 on the 1st of a new month even though the claim is on a consecutive day', () => {
    const nowMs = Date.UTC(2026, 1, 1, 3, 0) // 2026-02-01
    const r = evaluateDaily({ streak: 5, lastDailyClaim: '2026-01-31' }, nowMs, tz)
    expect(r).toMatchObject({ allowed: true, alreadyClaimed: false, day: 1, points: 5_000, streak: 1 })
  })

  it('pays 40,000 on streak day 28', () => {
    const nowMs = Date.UTC(2026, 8, 28, 3, 0) // 2026-09-28
    const r = evaluateDaily({ streak: 27, lastDailyClaim: '2026-09-27' }, nowMs, tz)
    expect(r).toMatchObject({ day: 28, points: 40_000, streak: 28 })
  })

  it('pays 12,000 on streak day 31', () => {
    const nowMs = Date.UTC(2026, 0, 31, 3, 0) // 2026-01-31, January has 31 days
    const r = evaluateDaily({ streak: 30, lastDailyClaim: '2026-01-30' }, nowMs, tz)
    expect(r).toMatchObject({ day: 31, points: 12_000, streak: 31 })
  })

  it('clamps the reward day at 31 even when the raw streak counter has grown past it', () => {
    const nowMs = Date.UTC(2026, 0, 31, 3, 0) // 2026-01-31
    const r = evaluateDaily({ streak: 40, lastDailyClaim: '2026-01-30' }, nowMs, tz)
    expect(r).toMatchObject({ day: 31, points: 12_000, streak: 41 })
  })

  it('reports alreadyClaimed with no points for a second claim the same day', () => {
    const r = evaluateDaily({ streak: 5, lastDailyClaim: '2026-09-04' }, today, tz)
    expect(r).toMatchObject({ allowed: false, alreadyClaimed: true, day: 5, points: 0, streak: 5, lastClaim: '2026-09-04' })
  })

  it('previews the next claim (nextDay/nextPoints) for tomorrow, resetting across a month boundary', () => {
    // Claiming day 30 of January previews day 31 tomorrow (still January).
    const withinMonth = evaluateDaily({ streak: 29, lastDailyClaim: '2026-01-29' }, Date.UTC(2026, 0, 30, 3, 0), tz)
    expect(withinMonth).toMatchObject({ day: 30, nextDay: 31, nextPoints: 12_000 })

    // Claiming day 31 of January previews day 1 tomorrow (February starts).
    const acrossMonth = evaluateDaily({ streak: 30, lastDailyClaim: '2026-01-30' }, Date.UTC(2026, 0, 31, 3, 0), tz)
    expect(acrossMonth).toMatchObject({ day: 31, nextDay: 1, nextPoints: 5_000 })
  })
})

describe('reliefEligible', () => {
  const nowMs = 1_800_000_000_000
  const cooldownMs = 24 * 60 * 60 * 1000

  it('is eligible below the threshold with no prior relief', () => {
    expect(reliefEligible(4_000, null, nowMs)).toEqual({ eligible: true, reason: 'ok', retryAt: null })
  })

  it('is ineligible at or above the threshold', () => {
    expect(reliefEligible(6_000, null, nowMs)).toEqual({ eligible: false, reason: 'balance', retryAt: null })
    expect(reliefEligible(5_000, null, nowMs)).toEqual({ eligible: false, reason: 'balance', retryAt: null })
  })

  it('is ineligible within the 24h cooldown, and reports the retry time', () => {
    const lastReliefAt = nowMs - 60 * 60 * 1000 // 1h ago
    expect(reliefEligible(4_000, lastReliefAt, nowMs)).toEqual({ eligible: false, reason: 'cooldown', retryAt: lastReliefAt + cooldownMs })
  })

  it('is eligible again once the cooldown has fully elapsed', () => {
    const lastReliefAt = nowMs - cooldownMs
    expect(reliefEligible(4_000, lastReliefAt, nowMs)).toEqual({ eligible: true, reason: 'ok', retryAt: null })
  })

  it('is still ineligible one millisecond before the cooldown elapses', () => {
    const lastReliefAt = nowMs - cooldownMs + 1
    expect(reliefEligible(4_000, lastReliefAt, nowMs).eligible).toBe(false)
  })
})
