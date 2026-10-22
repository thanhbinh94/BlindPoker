/**
 * The daily check-in and relief, over HTTP.
 *
 * The economy service has its own tests for the rules; what is checked here is the translation: the
 * paths and bodies Lite publishes (§19.3), the 409 that carries `claimed: false` / `granted: false`
 * *outside* the error envelope, and the fact that the money actually moved.
 */
import { ECONOMY } from '@bp/core'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { dailyLogins, newcomerProgress } from '../db/schema.js'
import { createTestDb, type TestDb } from '../db/test-db.js'
import { buildTestApp, resetDb, START, XRW, type Account, type Harness } from '../test-harness.js'

const DAY_MS = 24 * 60 * 60 * 1000
/** Day 1 of a streak is worth 5,000 points and grants no item (§13.2's item column starts at day 7). */
const DAY_1_POINTS = 5_000
/** 10:00 on 28 November 2026 in Asia/Ho_Chi_Minh, the harness's zone: day 28 of the first month with a third gift. */
const NOV_28 = Date.UTC(2026, 10, 28, 3, 0)
/**
 * An account made on the day itself. `me` signed in at `START` (September), and a session lasts 30 days, so after
 * the clock jumps to November only a fresh sign-up still has one.
 */
const LATE = { email: 'late@example.com', password: 'a good password', displayName: 'Khach Thang 11' }

let test: TestDb
let db: AppDb
let h: Harness
let me: Account

const balance = (): Promise<number> => h.app.services.repos.balances.get(me.playerId)
const spend = async (amount: number): Promise<void> => {
  await h.app.services.repos.balances.apply([{ playerId: me.playerId, delta: -amount, reason: 'settlement', refId: `test:${String(amount)}` }])
}

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
})
afterAll(async () => {
  await test.close()
})
beforeEach(async () => {
  h = await buildTestApp(db)
  me = await h.register()
})
afterEach(async () => {
  await h.app.close()
  await resetDb(db)
})

describe('the daily reward', () => {
  it('reports the status with the whole 31-day calendar', async () => {
    const res = await h.app.fastify.inject({ url: '/api/rewards/daily', headers: { cookie: me.cookie } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { claimable: boolean; day: number; streak: number; reward: number; item: string | null; nextResetAt: number; calendar: unknown[] }
    expect(body).toMatchObject({ claimable: true, day: 1, streak: 1, reward: DAY_1_POINTS, item: null })
    expect(body.calendar).toHaveLength(31)
    expect(body.nextResetAt).toBeGreaterThan(START)
  })

  it('serves the calendar of the current month, with the item ids of a fixed day', async () => {
    const res = await h.app.fastify.inject({ url: '/api/rewards/daily', headers: { cookie: me.cookie } })
    const body = res.json() as { month: string; calendar: { day: number; item: string | null; items: string[] }[] }
    expect(body.month).toBe('2026-09')
    expect(body.calendar[27]).toMatchObject({ day: 28, item: 'badge_monthly', items: ['badge_monthly', 'title_devoted'] })
    expect(body.calendar[6]).toMatchObject({ day: 7, item: 'common', items: [] })

    h.setNow(NOV_28)
    const late = await h.register(LATE)
    const november = (await h.app.fastify.inject({ url: '/api/rewards/daily', headers: { cookie: late.cookie } })).json() as typeof body
    expect(november.month).toBe('2026-11')
    expect(november.calendar[27]!.items).toEqual(['badge_monthly', 'title_devoted', 'head_tophat01'])
  })

  it('grants the shipped November gift over HTTP: day 28 of 11/2026 pays the badge, the title and the top hat', async () => {
    h.setNow(NOV_28)
    const late = await h.register(LATE)
    await db
      .update(dailyLogins)
      .set({ streak: 27, lastClaimDate: '2026-11-27', month: '2026-11', claimedDays: 27 })
      .where(eq(dailyLogins.playerId, late.playerId))

    const claim = await h.app.fastify.inject({ method: 'POST', url: '/api/rewards/daily/claim', headers: h.auth(late) })
    expect(claim.statusCode).toBe(200)
    expect(claim.json()).toMatchObject({
      claimed: true,
      day: 28,
      points: 40_000,
      items: ['badge_monthly', 'title_devoted', 'head_tophat01'],
      fallbackPoints: 0,
    })
    const inventory = (await h.app.fastify.inject({ url: '/api/me/inventory', headers: { cookie: late.cookie } })).json() as {
      items: { itemId: string; source: string }[]
    }
    expect(inventory.items.filter((i) => i.source === 'daily').map((i) => i.itemId).sort()).toEqual(['badge_monthly', 'head_tophat01', 'title_devoted'])
  })

  it('credits the claim once and answers the second with 409 ALREADY_CLAIMED', async () => {
    const claim = await h.app.fastify.inject({ method: 'POST', url: '/api/rewards/daily/claim', headers: h.auth(me) })
    expect(claim.statusCode).toBe(200)
    expect(claim.json()).toMatchObject({
      claimed: true,
      day: 1,
      points: DAY_1_POINTS,
      item: null,
      items: [],
      fallbackPoints: 0,
      streak: 1,
      balance: ECONOMY.startingBalance + DAY_1_POINTS,
    })
    expect(await balance()).toBe(ECONOMY.startingBalance + DAY_1_POINTS)

    const again = await h.app.fastify.inject({ method: 'POST', url: '/api/rewards/daily/claim', headers: h.auth(me) })
    expect(again.statusCode).toBe(409)
    // The refusal's own field sits beside the envelope, not inside it: a client that asked to claim
    // needs to know it did not, and why.
    expect(again.json()).toMatchObject({ claimed: false, error: { code: 'ALREADY_CLAIMED' } })
    expect(await balance()).toBe(ECONOMY.startingBalance + DAY_1_POINTS)
  })

  it('moves the login counters through the event bus, which is what unlocks the login achievements', async () => {
    await h.app.fastify.inject({ method: 'POST', url: '/api/rewards/daily/claim', headers: h.auth(me) })
    h.setNow(START + DAY_MS)
    await h.app.fastify.inject({ method: 'POST', url: '/api/rewards/daily/claim', headers: h.auth(me) })

    const stats = await h.app.fastify.inject({ url: '/api/me/stats', headers: { cookie: me.cookie } })
    expect(stats.json()).toMatchObject({ totalLoginDays: 2, loginStreak: 2, bestLoginStreak: 2 })
  })

  it('carries the newcomer day on the claim and the newcomer calendar on the status', async () => {
    // Newcomer day 2 was counted yesterday (START is 2026-09-04), so today's claim advances the calendar to day 3.
    await db.insert(newcomerProgress).values({ playerId: me.playerId, day: 2, claimedDays: [1, 2], lastDayKey: '2026-09-03' })

    const claim = await h.app.fastify.inject({ method: 'POST', url: '/api/rewards/daily/claim', headers: h.auth(me) })
    expect(claim.statusCode).toBe(200)
    expect((claim.json() as { newcomer?: { day: number; finished: boolean } }).newcomer).toMatchObject({ day: 3, finished: false })

    const status = await h.app.fastify.inject({ url: '/api/rewards/daily', headers: { cookie: me.cookie } })
    expect(status.statusCode).toBe(200)
    expect((status.json() as { newcomer?: unknown }).newcomer).toEqual({ day: 3, claimedDays: [1, 2, 3], finished: false, day7Reputation: 200 })
  })

  it('requires a session and the CSRF header', async () => {
    const noSession = await h.app.fastify.inject({ method: 'POST', url: '/api/rewards/daily/claim', headers: XRW })
    expect(noSession.statusCode).toBe(401)
    const noHeader = await h.app.fastify.inject({ method: 'POST', url: '/api/rewards/daily/claim', headers: { cookie: me.cookie } })
    expect(noHeader.statusCode).toBe(403)
    expect(await balance()).toBe(ECONOMY.startingBalance)
  })
})

describe('POST /api/economy/relief', () => {
  it('tops a poor player up to the target, then refuses while the cooldown runs', async () => {
    await spend(ECONOMY.startingBalance - 4_000)

    const granted = await h.app.fastify.inject({ method: 'POST', url: '/api/economy/relief', headers: h.auth(me) })
    expect(granted.statusCode).toBe(200)
    expect(granted.json()).toEqual({ granted: true, amount: 1_000, balance: ECONOMY.reliefTarget })
    expect(await balance()).toBe(ECONOMY.reliefTarget)

    await spend(1_000)
    const denied = await h.app.fastify.inject({ method: 'POST', url: '/api/economy/relief', headers: h.auth(me) })
    expect(denied.statusCode).toBe(409)
    expect(denied.json()).toMatchObject({ granted: false, reason: 'cooldown', error: { code: 'NOT_ELIGIBLE' } })
    expect((denied.json() as { retryAt: number }).retryAt).toBe(START + ECONOMY.reliefCooldownHours * 60 * 60 * 1000)
  })

  it('refuses a player who is not poor enough, with no cooldown to report', async () => {
    const res = await h.app.fastify.inject({ method: 'POST', url: '/api/economy/relief', headers: h.auth(me) })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ granted: false, reason: 'balance', retryAt: null, error: { code: 'NOT_ELIGIBLE' } })
    expect(await balance()).toBe(ECONOMY.startingBalance)
  })

  it('grants again once the cooldown has passed', async () => {
    await spend(ECONOMY.startingBalance - 4_000)
    await h.app.fastify.inject({ method: 'POST', url: '/api/economy/relief', headers: h.auth(me) })
    await spend(2_000)
    h.setNow(START + ECONOMY.reliefCooldownHours * 60 * 60 * 1000)

    const res = await h.app.fastify.inject({ method: 'POST', url: '/api/economy/relief', headers: h.auth(me) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ granted: true, amount: 2_000, balance: ECONOMY.reliefTarget })
  })
})
