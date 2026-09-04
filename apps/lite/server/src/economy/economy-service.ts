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

      const today = dayKey(nowMs, timezone)
      await repos.balances.apply([{ playerId, delta: evaluation.points, reason: 'daily_reward', refId: today }])
      repos.updateDaily(playerId, { streak: evaluation.streak, lastDailyClaim: today })
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
      await repos.balances.apply([{ playerId, delta: amount, reason: 'relief', refId: String(nowMs) }])
      repos.updateRelief(playerId, nowMs)
      await deps.onBalanceChanged?.(playerId)

      const balance = await repos.balances.get(playerId)
      return { granted: true, amount, balance }
    },
  }
}
