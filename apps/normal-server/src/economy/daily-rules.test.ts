import { DAILY_REWARD_POINTS, ECONOMY } from '@bp/core'
import { describe, expect, it } from 'vitest'
import {
  addDaysKey,
  dailyCalendar,
  daysBetween,
  dayKey,
  dayStartMs,
  itemMarker,
  MAX_STREAK,
  monthKey,
  nextDayStartMs,
  nextStreak,
  NO_ITEM_FALLBACK_POINTS,
  reliefEligible,
  rewardForDay,
  type DailyItemRule,
} from './daily-rules.js'

const HCM = 'Asia/Ho_Chi_Minh'
const HOUR = 60 * 60 * 1000

describe('day keys', () => {
  it('draws the day boundary in the economy timezone, not in UTC', () => {
    // 17:00 UTC is already the 5th in Ho Chi Minh City (+07), and still the 4th in London.
    const at = Date.UTC(2026, 8, 4, 17, 30)
    expect(dayKey(at, HCM)).toBe('2026-09-05')
    expect(dayKey(at, 'UTC')).toBe('2026-09-04')
    expect(monthKey(at, HCM)).toBe('2026-09')
  })

  it('counts calendar days across a month and a leap-year February', () => {
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1)
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2)
    expect(daysBetween('2026-03-01', '2026-02-27')).toBe(-2)
    expect(addDaysKey('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('reports the next local midnight as an instant', () => {
    const at = Date.UTC(2026, 8, 4, 3, 0) // 10:00 on the 4th in HCM
    expect(nextDayStartMs(at, HCM)).toBe(Date.UTC(2026, 8, 4, 17, 0)) // midnight on the 5th, HCM
    expect(nextDayStartMs(at, 'UTC')).toBe(Date.UTC(2026, 8, 5, 0, 0))
  })

  it('reports the start of a given local day as an instant', () => {
    expect(dayStartMs('2026-09-04', HCM)).toBe(Date.UTC(2026, 8, 3, 17, 0)) // midnight at the start of the 4th, HCM
    expect(dayStartMs('2026-09-04', 'UTC')).toBe(Date.UTC(2026, 8, 4, 0, 0))
    // The start of today and the next day's start are one local day apart, in the zone's own days.
    const at = Date.UTC(2026, 8, 4, 3, 0)
    expect(dayStartMs(dayKey(at, HCM), HCM)).toBe(nextDayStartMs(at, HCM) - 24 * HOUR)
    // Europe/London's 29 March is a 23-hour day: it starts at 00:00 UTC, and 30 March starts at 23:00 UTC on the 29th.
    expect(dayStartMs('2026-03-29', 'Europe/London')).toBe(Date.UTC(2026, 2, 29, 0, 0))
    expect(dayStartMs('2026-03-30', 'Europe/London')).toBe(Date.UTC(2026, 2, 29, 23, 0))
  })

  it('places the next midnight correctly across a DST change', () => {
    // Europe/London springs forward at 01:00 UTC on 2026-03-29: the day that starts then is a
    // BST day, so its midnight is 00:00 UTC — one hour earlier than a naive +0 or +1 guess.
    const at = Date.UTC(2026, 2, 28, 12, 0)
    expect(nextDayStartMs(at, 'Europe/London')).toBe(Date.UTC(2026, 2, 29, 0, 0))
  })
})

describe('nextStreak', () => {
  it('starts at day 1 for a player who has never claimed', () => {
    expect(nextStreak({ streak: 0, lastClaimDate: null }, '2026-09-04')).toEqual({ alreadyClaimed: false, streak: 1, day: 1, points: 5_000 })
  })

  it('advances when the previous claim was yesterday', () => {
    expect(nextStreak({ streak: 3, lastClaimDate: '2026-09-03' }, '2026-09-04')).toMatchObject({ alreadyClaimed: false, streak: 4, day: 4 })
  })

  it('reports a claim already made today rather than advancing', () => {
    expect(nextStreak({ streak: 4, lastClaimDate: '2026-09-04' }, '2026-09-04')).toMatchObject({ alreadyClaimed: true, streak: 4, day: 4 })
  })

  it('restarts at 1 after a missed day', () => {
    expect(nextStreak({ streak: 9, lastClaimDate: '2026-09-02' }, '2026-09-04')).toMatchObject({ streak: 1, day: 1 })
  })

  it('restarts at 1 on the first of a month, even when the days are consecutive', () => {
    expect(nextStreak({ streak: 14, lastClaimDate: '2026-08-31' }, '2026-09-01')).toMatchObject({ streak: 1, day: 1, points: 5_000 })
  })

  it('caps the streak at 31', () => {
    expect(nextStreak({ streak: MAX_STREAK, lastClaimDate: '2026-03-30' }, '2026-03-31')).toMatchObject({ streak: 31, day: 31 })
  })
})

describe('the reward table', () => {
  it('matches §13.2 at the tiers the item column depends on', () => {
    expect(rewardForDay(1)).toBe(5_000)
    expect(rewardForDay(7)).toBe(15_000)
    expect(rewardForDay(14)).toBe(20_000)
    expect(rewardForDay(21)).toBe(25_000)
    expect(rewardForDay(28)).toBe(40_000)
  })

  it('pays days 29–31 what day 29 pays', () => {
    expect(rewardForDay(30)).toBe(rewardForDay(29))
    expect(rewardForDay(31)).toBe(rewardForDay(29))
    expect(rewardForDay(29)).toBe(12_000)
  })

  it('totals §13.2’s 376,000 points over a full month', () => {
    expect(DAILY_REWARD_POINTS.reduce((a, b) => a + b, 0)).toBe(376_000)
  })

  it('builds the 31-day calendar of a month: the rarity on a draw day, the first id and the whole list on a fixed day', () => {
    const rules: Record<number, DailyItemRule> = {
      7: { kind: 'randomUnowned', rarity: 'common' },
      14: { kind: 'randomUnowned', rarity: 'rare' },
      28: { kind: 'fixed', itemIds: ['badge_monthly', 'title_devoted', 'head_tophat01'] },
    }
    const asked = new Set<string>()
    const calendar = dailyCalendar(
      {
        itemRuleForDay: (day, month) => {
          asked.add(month)
          return rules[day] ?? null
        },
      },
      '2026-11',
    )
    expect(calendar).toHaveLength(31)
    // Every tier is read from the one month asked for.
    expect([...asked]).toEqual(['2026-11'])
    expect(calendar[0]).toEqual({ day: 1, points: 5_000, item: null, items: [] })
    expect(calendar[6]).toEqual({ day: 7, points: 15_000, item: 'common', items: [] })
    expect(calendar[13]).toMatchObject({ day: 14, item: 'rare', items: [] })
    expect(calendar[27]).toEqual({ day: 28, points: 40_000, item: 'badge_monthly', items: ['badge_monthly', 'title_devoted', 'head_tophat01'] })
    expect(calendar.filter((d) => d.item !== null).map((d) => d.day)).toEqual([7, 14, 28])
  })

  it('labels a tier by its rule: the rarity a draw will draw, the first id a fixed list grants, nothing for none', () => {
    expect(itemMarker({ kind: 'randomUnowned', rarity: 'rare' })).toBe('rare')
    expect(itemMarker({ kind: 'fixed', itemIds: ['badge_monthly', 'title_devoted'] })).toBe('badge_monthly')
    expect(itemMarker(null)).toBeNull()
  })

  it('substitutes 10,000 points when a tier has nothing left', () => {
    expect(NO_ITEM_FALLBACK_POINTS).toBe(10_000)
  })
})

describe('reliefEligible', () => {
  const NOW = Date.UTC(2026, 8, 4, 12, 0)

  it('refuses a player who still has points', () => {
    expect(reliefEligible(ECONOMY.reliefThreshold, null, NOW)).toEqual({ eligible: false, reason: 'balance', retryAt: null })
  })

  it('allows a broke player who has never claimed', () => {
    expect(reliefEligible(0, null, NOW)).toEqual({ eligible: true, reason: null, retryAt: null })
  })

  it('holds a broke player to the 24-hour cooldown and says when it lifts', () => {
    const lastRelief = NOW - 5 * HOUR
    expect(reliefEligible(100, lastRelief, NOW)).toEqual({ eligible: false, reason: 'cooldown', retryAt: lastRelief + 24 * HOUR })
    expect(reliefEligible(100, NOW - 24 * HOUR, NOW)).toMatchObject({ eligible: true })
  })
})
