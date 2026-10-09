export const ECONOMY = {
  startingBalance: 100_000,
  tableFeeRate: 0.02,
  tableFeeCapBB: 1,
  reliefThreshold: 5_000,
  reliefTarget: 5_000,
  reliefCooldownHours: 24,
  blindWagerTiers: [1_000, 2_000, 5_000, 10_000, 20_000, 50_000],
  blindTableLimitMultiplier: 5,
  holdemBlindTiers: [
    { smallBlind: 100, bigBlind: 200 },
    { smallBlind: 250, bigBlind: 500 },
    { smallBlind: 500, bigBlind: 1_000 },
    { smallBlind: 1_000, bigBlind: 2_000 },
    { smallBlind: 2_500, bigBlind: 5_000 },
  ],
  holdemTurnTimers: [15, 30, 45, 60],
  blindTurnTimers: [10, 15, 30],
  /** A squeeze table's round (spec 2026-10-08 §4.2.1): fixed, not one of `blindTurnTimers`. */
  squeezeTurnTimerSec: 20,
  maxPlayersHoldem: 9,
  maxPlayersBlind: 8,
  buyInBBRange: { min: 20, max: 500 },
  defaultMinBuyInBB: 50,
  defaultMaxBuyInBB: 200,
  defaultMaxPlayers: 6,
  handIntervalSec: 5,
  reconnectWindowSec: 90,
  consecutiveTimeoutsToStand: 3,
} as const

/** Index 0 = streak day 1 … index 30 = day 31; days beyond use the last entry. */
export const DAILY_REWARD_POINTS: readonly number[] = [
  5_000, 6_000, 7_000, 8_000, 10_000, 12_000, 15_000,          // 1–7
  10_000, 10_000, 10_000, 10_000, 10_000, 10_000,               // 8–13
  20_000,                                                       // 14
  10_000, 10_000, 10_000, 10_000, 10_000, 10_000,               // 15–20
  25_000,                                                       // 21
  12_000, 12_000, 12_000, 12_000, 12_000, 12_000,               // 22–27
  40_000,                                                       // 28
  12_000, 12_000, 12_000,                                       // 29–31
]

export function dailyRewardPoints(streakDay: number): number {
  const idx = Math.min(Math.max(streakDay, 1), DAILY_REWARD_POINTS.length) - 1
  return DAILY_REWARD_POINTS[idx]!
}
