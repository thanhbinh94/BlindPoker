import { describe, expect, it } from 'vitest'
import { DAILY_REWARD_POINTS, ECONOMY, dailyRewardPoints } from './economy.js'

describe('economy constants', () => {
  it('matches the spec daily table', () => {
    expect(dailyRewardPoints(1)).toBe(5000)
    expect(dailyRewardPoints(7)).toBe(15000)
    expect(dailyRewardPoints(8)).toBe(10000)
    expect(dailyRewardPoints(14)).toBe(20000)
    expect(dailyRewardPoints(21)).toBe(25000)
    expect(dailyRewardPoints(28)).toBe(40000)
    expect(dailyRewardPoints(29)).toBe(12000)
    expect(dailyRewardPoints(31)).toBe(12000)
    expect(dailyRewardPoints(45)).toBe(12000)
    expect(dailyRewardPoints(0)).toBe(5000)
    expect(DAILY_REWARD_POINTS.reduce((a, b) => a + b, 0)).toBe(376000)
  })
  it('exposes tiers', () => {
    expect(ECONOMY.startingBalance).toBe(100000)
    expect(ECONOMY.blindWagerTiers).toEqual([1000, 2000, 5000, 10000, 20000, 50000])
    expect(ECONOMY.holdemBlindTiers.map((t) => t.bigBlind)).toEqual([200, 500, 1000, 2000, 5000])
    expect(ECONOMY.blindTableLimitMultiplier).toBe(10)
  })
  it('takes no table fee at a Blind table and keeps the Hold’em fee (plan 27 D1)', () => {
    expect(ECONOMY.blindTableFeeRate).toBe(0)
    expect(ECONOMY.tableFeeRate).toBe(0.02)
  })
})
