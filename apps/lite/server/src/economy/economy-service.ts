import { ECONOMY } from '@bp/core'
import type { LiteRepositories } from '../repos/sqlite-repos.js'
import { dayKey, evaluateDaily, reliefEligible, type DailyClaimResult } from './daily.js'

export interface EconomyService {
  dailyStatus(playerId: string): DailyClaimResult
  claimDaily(playerId: string): Promise<{ claimed: true; points: number; streak: number; balance: number } | { claimed: false; reason: 'already' }>
  relief(playerId: string): Promise<{ granted: true; amount: number; balance: number } | { granted: false; reason: 'balance' | 'cooldown'; retryAt: number | null }>
}

export function createEconomyService(deps: { repos: LiteRepositories; timezone: string; now?: () => number; onBalanceChanged?: (playerId: string) => Promise<void> | void }): EconomyService {
  const { repos, timezone } = deps
  const now = deps.now ?? Date.now

  function requirePlayer(playerId: string) {
    const player = repos.getLitePlayer(playerId)
    if (!player) throw new Error(`unknown player ${playerId}`)
    return player
  }

  return {
    dailyStatus(playerId) {
      const player = requirePlayer(playerId)
      return evaluateDaily({ streak: player.streak, lastDailyClaim: player.lastDailyClaim }, now(), timezone)
    },

    async claimDaily(playerId) {
      const player = requirePlayer(playerId)
      const nowMs = now()
      const evaluation = evaluateDaily({ streak: player.streak, lastDailyClaim: player.lastDailyClaim }, nowMs, timezone)
      if (!evaluation.allowed) return { claimed: false, reason: 'already' }

      // One transaction: the credit and the "today is spent" stamp are the same fact, and a crash
      // between two separate writes would either pay forever or eat the day.
      const today = dayKey(nowMs, timezone)
      repos.claimDaily(playerId, { points: evaluation.points, streak: evaluation.streak, day: today })
      await deps.onBalanceChanged?.(playerId)

      const balance = await repos.balances.get(playerId)
      return { claimed: true, points: evaluation.points, streak: evaluation.streak, balance }
    },

    async relief(playerId) {
      const player = requirePlayer(playerId)
      const nowMs = now()
      const check = reliefEligible(player.balance, player.lastReliefAt, nowMs)
      if (!check.eligible) return { granted: false, reason: check.reason === 'cooldown' ? 'cooldown' : 'balance', retryAt: check.retryAt }

      const amount = ECONOMY.reliefTarget - player.balance
      repos.grantRelief(playerId, amount, nowMs)
      await deps.onBalanceChanged?.(playerId)

      const balance = await repos.balances.get(playerId)
      return { granted: true, amount, balance }
    },
  }
}
