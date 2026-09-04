import { dailyRewardPoints, ECONOMY } from '@bp/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../db/sqlite.js'
import { createSqliteRepositories, type LiteRepositories } from '../repos/sqlite-repos.js'
import { createEconomyService, type EconomyService } from './economy-service.js'

const TZ = 'Asia/Ho_Chi_Minh'

const open: LiteRepositories[] = []
function repos(now?: () => number): LiteRepositories {
  const r = createSqliteRepositories(openDatabase(':memory:'), { handLog: false, now })
  open.push(r)
  return r
}

afterEach(() => {
  for (const r of open.splice(0)) r.close()
})

describe('claimDaily', () => {
  it('adds the day-1 reward, persists the streak and claim day, and calls onBalanceChanged', async () => {
    const r = repos()
    const a = r.createPlayer('Alice', 'ha', 100_000).playerId
    const nowMs = Date.UTC(2026, 8, 4, 3, 0) // 2026-09-04 10:00 ICT
    const onBalanceChanged = vi.fn()
    const svc: EconomyService = createEconomyService({ repos: r, timezone: TZ, now: () => nowMs, onBalanceChanged })

    const result = await svc.claimDaily(a)
    expect(result).toEqual({ claimed: true, points: 5_000, streak: 1, balance: 105_000 })
    expect(r.getLitePlayer(a)).toMatchObject({ streak: 1, lastDailyClaim: '2026-09-04', balance: 105_000 })
    expect(onBalanceChanged).toHaveBeenCalledWith(a)
  })

  it('refuses a second claim the same local day', async () => {
    const r = repos()
    const a = r.createPlayer('Alice', 'ha', 100_000).playerId
    const nowMs = Date.UTC(2026, 8, 4, 3, 0)
    const svc = createEconomyService({ repos: r, timezone: TZ, now: () => nowMs })

    await svc.claimDaily(a)
    const second = await svc.claimDaily(a)
    expect(second).toEqual({ claimed: false, reason: 'already' })
    expect(r.getLitePlayer(a)).toMatchObject({ streak: 1, balance: 105_000 })
  })

  it('continues the streak on the next local day', async () => {
    const r = repos()
    const a = r.createPlayer('Alice', 'ha', 100_000).playerId
    let nowMs = Date.UTC(2026, 8, 4, 3, 0)
    const svc = createEconomyService({ repos: r, timezone: TZ, now: () => nowMs })
    await svc.claimDaily(a)

    nowMs = Date.UTC(2026, 8, 5, 3, 0)
    const result = await svc.claimDaily(a)
    expect(result).toEqual({ claimed: true, points: dailyRewardPoints(2), streak: 2, balance: 100_000 + 5_000 + dailyRewardPoints(2) })
  })

  it('reflects the pending claim through dailyStatus without mutating state', () => {
    const r = repos()
    const a = r.createPlayer('Alice', 'ha', 100_000).playerId
    const nowMs = Date.UTC(2026, 8, 4, 3, 0)
    const svc = createEconomyService({ repos: r, timezone: TZ, now: () => nowMs })

    const status = svc.dailyStatus(a)
    expect(status).toMatchObject({ allowed: true, alreadyClaimed: false, day: 1, points: 5_000 })
    expect(r.getLitePlayer(a)).toMatchObject({ streak: 0, lastDailyClaim: null })
  })
})

describe('relief', () => {
  it('tops up a balance below the threshold to the relief target', async () => {
    const r = repos()
    const a = r.createPlayer('Alice', 'ha', 4_000).playerId
    const nowMs = 1_800_000_000_000
    const onBalanceChanged = vi.fn()
    const svc = createEconomyService({ repos: r, timezone: TZ, now: () => nowMs, onBalanceChanged })

    const result = await svc.relief(a)
    expect(result).toEqual({ granted: true, amount: 1_000, balance: ECONOMY.reliefTarget })
    expect(r.getLitePlayer(a)).toMatchObject({ balance: ECONOMY.reliefTarget, lastReliefAt: nowMs })
    expect(onBalanceChanged).toHaveBeenCalledWith(a)
  })

  it('blocks a second relief within the 24h cooldown', async () => {
    const r = repos()
    const a = r.createPlayer('Alice', 'ha', 4_000).playerId
    let nowMs = 1_800_000_000_000
    const svc = createEconomyService({ repos: r, timezone: TZ, now: () => nowMs })

    await svc.relief(a)
    // Balance drops back under the threshold, but the cooldown has not elapsed yet.
    await r.balances.apply([{ playerId: a, delta: -1_000, reason: 'settlement' }])
    nowMs += 1_000
    const result = await svc.relief(a)
    expect(result).toEqual({ granted: false, reason: 'cooldown', retryAt: 1_800_000_000_000 + 24 * 60 * 60 * 1000 })
  })

  it('is not eligible when the balance already meets the threshold', async () => {
    const r = repos()
    const a = r.createPlayer('Alice', 'ha', 6_000).playerId
    const svc = createEconomyService({ repos: r, timezone: TZ, now: () => 1_800_000_000_000 })

    const result = await svc.relief(a)
    expect(result).toEqual({ granted: false, reason: 'balance', retryAt: null })
    expect(r.getLitePlayer(a)).toMatchObject({ balance: 6_000, lastReliefAt: null })
  })
})
