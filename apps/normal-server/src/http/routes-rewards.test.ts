/**
 * The daily check-in and relief, over HTTP.
 *
 * The economy service has its own tests for the rules; what is checked here is the translation: the
 * paths and bodies Lite publishes (§19.3), the 409 that carries `claimed: false` / `granted: false`
 * *outside* the error envelope, and the fact that the money actually moved.
 */
import { ECONOMY } from '@bp/core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { createTestDb, type TestDb } from '../db/test-db.js'
import { buildTestApp, resetDb, START, XRW, type Account, type Harness } from '../test-harness.js'

const DAY_MS = 24 * 60 * 60 * 1000
/** Day 1 of a streak is worth 5,000 points and grants no item (§13.2's item column starts at day 7). */
const DAY_1_POINTS = 5_000

let test: TestDb
let db: AppDb
let h: Harness
let me: Account

const balance = (): Promise<number> => h.app.services.repos.balances.get(me.playerId)
const spend = (amount: number): Promise<void> =>
  h.app.services.repos.balances.apply([{ playerId: me.playerId, delta: -amount, reason: 'settlement', refId: `test:${String(amount)}` }])

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
