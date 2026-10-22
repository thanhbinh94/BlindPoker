import type { AddressInfo } from 'node:net'
import { ECONOMY, type RoomConfig } from '@bp/core'
import { TestClient } from '@bp/server-kit/testing'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { rowsOf, type AppDb } from '../db/client.js'
import { createTestDb, type TestDb } from '../db/test-db.js'
import { ServiceError } from '../errors.js'
import { buildTestApp, ORIGIN, resetDb, START, testConfig, type Account, type Harness } from '../test-harness.js'
import { createGmService, GM_ITEM_SOURCE, POINTS_CAP, type GmActor, type GmService, type GmServiceDeps } from './gm-service.js'

/** A Blind room nobody plays in: the lock test only needs the player seated, with a stack on the table. */
const BLIND_ROOM: RoomConfig = {
  name: 'Bàn thử', mode: 'blind', maxPlayers: 4, isPrivate: false, turnTimerSec: 15, autoStart: false,
  blind: { holeCards: 2, decisionMode: 'none', fixedWager: 1_000, botCount: 0 },
}
const BOSS_ACCOUNT = { email: 'boss@example.com', password: 'a boss password', displayName: 'Ông Chủ' }

let test: TestDb
let db: AppDb
let h: Harness
let gm: GmService
let me: Account
let boss: Account
const clients: TestClient[] = []

const actor = (a: Account): GmActor => ({ userId: a.playerId })
const promote = (p: string) => db.execute(sql`update users set role = 'gm' where id = ${p}`)
const actionsOf = async (p: string) =>
  rowsOf<{ action: string; amount: string | number | null; reason: string }>(
    await db.execute(sql`select action, amount, reason from gm_actions where target_player_id = ${p} order by id`),
  )
const deps = (over: Partial<GmServiceDeps> = {}): GmServiceDeps => ({ ...h.app.services, db, game: h.app.game, timezone: testConfig().timezone, ...over })

async function listen(): Promise<string> {
  await h.app.fastify.listen({ port: 0, host: '127.0.0.1' })
  const address = h.app.fastify.server.address() as AddressInfo
  return `http://127.0.0.1:${String(address.port)}`
}

async function connect(base: string, cookie: string): Promise<TestClient> {
  const client = await TestClient.connect(`${base.replace('http://', 'ws://')}/ws`, { origin: ORIGIN, cookie })
  clients.push(client)
  return client
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
  boss = await h.register(BOSS_ACCOUNT)
  await promote(boss.playerId)
  // `services.gm` is wired by the app in Task 5; until then the service is built from the app's own parts.
  gm = createGmService(deps())
})
afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => {})
  await h.app.close()
  await resetDb(db)
})

describe('GmService — points', () => {
  it('grants points: one ledger row reason gm_grant with ref gm:<id>, one action row, BALANCE pushed', async () => {
    const pushed = vi.spyOn(h.app.game, 'balanceChanged')
    const r = await gm.adjustPoints(actor(boss), me.playerId, 25_000, 'thưởng sự kiện')
    expect(r.balance).toBe(ECONOMY.startingBalance + 25_000)
    const ledger = await h.app.services.repos.ledger.list(me.playerId, { limit: 1 })
    expect(ledger[0]).toMatchObject({ amount: 25_000, reason: 'gm_grant', refId: `gm:${String(r.actionId)}` })
    expect(await actionsOf(me.playerId)).toEqual([{ action: 'grant_points', amount: expect.anything(), reason: 'thưởng sự kiện' }])
    expect(pushed).toHaveBeenCalledWith(me.playerId)
  })

  it('takes points back with reason gm_adjust, and refuses all of it when the balance is short — no action row either', async () => {
    await expect(gm.adjustPoints(actor(boss), me.playerId, -ECONOMY.startingBalance - 1, 'test')).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' })
    expect(await actionsOf(me.playerId)).toEqual([])
    expect(await h.app.services.repos.balances.get(me.playerId)).toBe(ECONOMY.startingBalance)
    const r = await gm.adjustPoints(actor(boss), me.playerId, -1_000, 'sửa lỗi')
    expect(r.balance).toBe(ECONOMY.startingBalance - 1_000)
    const ledger = await h.app.services.repos.ledger.list(me.playerId, { limit: 1 })
    expect(ledger[0]).toMatchObject({ amount: -1_000, reason: 'gm_adjust', refId: `gm:${String(r.actionId)}` })
  })

  it('refuses amount 0, a non-integer, |amount| over the cap, and a reason shorter than 3 characters', async () => {
    for (const [amount, reason] of [[0, 'ok ok'], [1.5, 'ok ok'], [POINTS_CAP + 1, 'ok ok'], [-POINTS_CAP - 1, 'ok ok'], [100, 'no'], [100, '   no   ']] as const) {
      await expect(gm.adjustPoints(actor(boss), me.playerId, amount, reason)).rejects.toBeInstanceOf(ServiceError)
    }
    await expect(gm.adjustPoints(actor(boss), me.playerId, 100, 'x'.repeat(201))).rejects.toMatchObject({ code: 'INVALID_REASON' })
    await expect(gm.adjustPoints(actor(boss), me.playerId, 0, 'ok ok')).rejects.toMatchObject({ code: 'INVALID_AMOUNT' })
    await expect(gm.adjustPoints(actor(boss), 'not-a-uuid', 100, 'ok ok')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(gm.adjustPoints(actor(boss), '00000000-0000-4000-8000-000000000000', 100, 'ok ok')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await actionsOf(me.playerId)).toEqual([])
  })
})

describe('GmService — items', () => {
  it('grants one item once and the whole wardrobe with source gm-grant', async () => {
    const one = await gm.grantItem(actor(boss), me.playerId, 'head_tophat01', 'quà')
    expect(one.granted).toEqual(['head_tophat01'])
    expect((await gm.grantItem(actor(boss), me.playerId, 'head_tophat01', 'quà')).alreadyOwned).toBe(1)
    await expect(gm.grantItem(actor(boss), me.playerId, 'haircolor_black01', 'free one')).rejects.toMatchObject({ code: 'INVALID_ITEM' })
    await expect(gm.grantItem(actor(boss), me.playerId, 'no_such_item', 'unknown')).rejects.toMatchObject({ code: 'INVALID_ITEM' })
    const all = await gm.grantWardrobe(actor(boss), me.playerId, 'full')
    expect(all.granted.length + all.alreadyOwned).toBe(h.app.services.catalog.all().filter((d) => !d.free).length)
    expect(all.granted).not.toContain('head_tophat01')
    const sources = rowsOf<{ source: string }>(await db.execute(sql`select distinct source from inventory where player_id = ${me.playerId} and item_id = 'head_tophat01'`))
    expect(sources).toEqual([{ source: GM_ITEM_SOURCE }])
    expect((await actionsOf(me.playerId)).map((a) => a.action)).toEqual(['grant_item', 'grant_item', 'grant_wardrobe'])
    // A second full grant has nothing left to give.
    expect((await gm.grantWardrobe(actor(boss), me.playerId, 'again')).granted).toEqual([])
  })
})

describe('GmService — achievements', () => {
  it('unlockAchievement pays the full reward under gm_achievement, logs unlock_achievement, refuses a second time and refuses a locked target', async () => {
    const pointsDef = h.app.services.defs.find((d) => d.id === 'login_streak_7')!
    const itemDef = h.app.services.defs.find((d) => d.id === 'login_days_100')!
    const pushed = vi.spyOn(h.app.game, 'balanceChanged')
    const notified = vi.spyOn(h.app.game, 'notify')
    expect((await gm.get(me.playerId))?.unlockedAchievementIds).toEqual([])

    const r = await gm.unlockAchievement(actor(boss), me.playerId, pointsDef.id, 'quên điểm danh')
    expect(r).toEqual({ actionId: expect.any(Number), reward: pointsDef.reward, balance: ECONOMY.startingBalance + pointsDef.reward.points! })
    const ledger = await h.app.services.repos.ledger.list(me.playerId, { limit: 1 })
    expect(ledger[0]).toMatchObject({ amount: pointsDef.reward.points, reason: 'gm_achievement', refId: `gm:${String(r.actionId)}` })
    expect(pushed).toHaveBeenCalledWith(me.playerId)
    expect(notified).toHaveBeenCalledWith(me.playerId, { t: 'NOTIFICATION', kind: 'GM_NOTICE', payload: { action: 'unlock_achievement', achievementId: pointsDef.id, reason: 'quên điểm danh' } })
    const [log] = rowsOf<{ action: string; item_id: string | null; amount: string | number | null; reason: string }>(
      await db.execute(sql`select action, item_id, amount, reason from gm_actions where id = ${r.actionId}`),
    )
    expect(log).toMatchObject({ action: 'unlock_achievement', item_id: pointsDef.id, reason: 'quên điểm danh' })
    expect(Number(log?.amount)).toBe(pointsDef.reward.points)

    // An item reward: the inventory row is there, no ledger row, and the log's amount is null.
    pushed.mockClear()
    const item = await gm.unlockAchievement(actor(boss), me.playerId, itemDef.id, 'quà dài hạn')
    expect(item.reward).toEqual(itemDef.reward)
    expect(item.balance).toBe(ECONOMY.startingBalance + pointsDef.reward.points!)
    expect(pushed).not.toHaveBeenCalled()
    expect(rowsOf<{ item_id: string }>(await db.execute(sql`select item_id from inventory where player_id = ${me.playerId} and item_id = ${itemDef.reward.itemId!}`))).toHaveLength(1)
    const [itemLog] = rowsOf<{ amount: string | null }>(await db.execute(sql`select amount from gm_actions where id = ${item.actionId}`))
    expect(itemLog?.amount).toBeNull()

    // Both show on the player's detail, and a repeat is refused without paying or logging again.
    expect((await gm.get(me.playerId))?.unlockedAchievementIds.sort()).toEqual([itemDef.id, pointsDef.id].sort())
    const before = (await actionsOf(me.playerId)).length
    await expect(gm.unlockAchievement(actor(boss), me.playerId, pointsDef.id, 'lần hai')).rejects.toMatchObject({ code: 'ALREADY_UNLOCKED' })
    expect(await actionsOf(me.playerId)).toHaveLength(before)
    expect(await h.app.services.repos.balances.get(me.playerId)).toBe(ECONOMY.startingBalance + pointsDef.reward.points!)

    await expect(gm.unlockAchievement(actor(boss), me.playerId, 'no_such_achievement', 'không có')).rejects.toMatchObject({ code: 'INVALID_ACHIEVEMENT' })
    await expect(gm.unlockAchievement(actor(boss), me.playerId, pointsDef.id, 'ab')).rejects.toMatchObject({ code: 'INVALID_REASON' })
    await expect(gm.unlockAchievement(actor(boss), '00000000-0000-4000-8000-000000000000', itemDef.id, 'ai đó')).rejects.toMatchObject({ code: 'NOT_FOUND' })

    // A locked account is refused before anything is paid.
    const other = h.app.services.defs.find((d) => d.id === 'login_streak_28')!
    await gm.lock(actor(boss), me.playerId, 'spam')
    await expect(gm.unlockAchievement(actor(boss), me.playerId, other.id, 'đang khóa')).rejects.toMatchObject({ code: 'TARGET_IS_LOCKED' })
    expect((await gm.get(me.playerId))?.unlockedAchievementIds).not.toContain(other.id)
  })

  it('a GM unlock adds reputation too', async () => {
    const notified = vi.spyOn(h.app.game, 'notify')
    await gm.unlockAchievement(actor(boss), me.playerId, 'login_days_100', 'quà dài hạn')

    // The earning path's ref, not the GM action's: a GM unlock and a later earning of the same achievement are one event.
    const events = rowsOf<{ delta: number; reason: string; ref_id: string }>(
      await db.execute(sql`select delta, reason, ref_id from reputation_events where player_id = ${me.playerId} order by id`),
    )
    expect(events).toEqual([{ delta: 500, reason: 'achievement', ref_id: `ach:${me.playerId}:login_days_100` }])
    const [row] = rowsOf<{ reputation: number; rank: number }>(await db.execute(sql`select reputation, rank from players where id = ${me.playerId}`))
    expect(row).toEqual({ reputation: 500, rank: 3 })
    expect(notified).toHaveBeenCalledWith(me.playerId, { t: 'NOTIFICATION', kind: 'RANK_UP', payload: { rank: 3 } })
  })
})

describe('GmService — check-in', () => {
  /** The harness clock sits on 2026-09-04 10:00 in Asia/Ho_Chi_Minh; the GM service under test must read the same one. */
  let clock = START
  let gmAt: GmService
  const TODAY = '2026-09-04'
  const YESTERDAY = '2026-09-03'
  beforeEach(() => {
    clock = START
    h.setNow(START)
    gmAt = createGmService(deps({ now: () => clock }))
  })

  /** Day 7 of a streak: points 15,000 and a random common, so one claim moves points, an item and the counters. */
  async function seedStreak(playerId: string, streak: number, lastClaimDate: string, consecutive = streak): Promise<void> {
    await db.execute(
      sql`update daily_logins set streak = ${streak}, consecutive = ${consecutive}, last_claim_date = ${lastClaimDate}, month = '2026-09', claimed_days = ${streak} where player_id = ${playerId}`,
    )
  }
  const consecutiveOf = async (playerId: string) =>
    Number((rowsOf<{ n: number | string }>(await db.execute(sql`select consecutive as n from daily_logins where player_id = ${playerId}`)))[0]?.n)
  const loginStreakOf = async (playerId: string) =>
    Number((rowsOf<{ n: number | string }>(await db.execute(sql`select login_streak as n from player_stats where player_id = ${playerId}`)))[0]?.n)
  const loginRow = async (playerId: string) =>
    (rowsOf<{ streak: number; last: string | null; days: number }>(await db.execute(sql`select streak, to_char(last_claim_date, 'YYYY-MM-DD') as last, claimed_days as days from daily_logins where player_id = ${playerId}`)))[0]
  const loginDays = async (playerId: string) =>
    Number((rowsOf<{ n: number | string }>(await db.execute(sql`select total_login_days as n from player_stats where player_id = ${playerId}`)))[0]?.n)
  const itemRows = async (playerId: string) =>
    rowsOf<{ item_id: string; ref: string | null }>(await db.execute(sql`select item_id, ref from inventory where player_id = ${playerId} and source = 'daily'`))
  /**
   * Streak 7 also earns the `login_streak_7` achievement, whose 5,000 points a check-in undo deliberately leaves alone
   * (it is the player's by another rule). Unlocking it first keeps these tests about the check-in; returns the balance.
   */
  const settle = async (): Promise<number> => {
    await gmAt.unlockAchievement(actor(boss), me.playerId, 'login_streak_7', 'chuẩn bị')
    return h.app.services.repos.balances.get(me.playerId)
  }
  const totals = async () => {
    const [b] = rowsOf<{ n: string | number }>(await db.execute(sql`select coalesce(sum(balance), 0) as n from players`))
    const [l] = rowsOf<{ n: string | number }>(await db.execute(sql`select coalesce(sum(amount), 0) as n from point_transactions where player_id is not null`))
    const [s] = rowsOf<{ n: string | number }>(await db.execute(sql`select coalesce(sum(amount), 0) as n from point_transactions where player_id is null`))
    return { balances: Number(b?.n), ledger: Number(l?.n), sinks: Number(s?.n) }
  }

  it('resetCheckin undoes today\'s points and item, steps the streak back, and a reclaim restores it with a fresh draw', async () => {
    await seedStreak(me.playerId, 6, YESTERDAY)
    const base = await settle()
    const before = await totals()
    const days0 = await loginDays(me.playerId)
    const pushed = vi.spyOn(h.app.game, 'balanceChanged')
    const notified = vi.spyOn(h.app.game, 'notify')

    const claim = await h.app.services.economy.claimDaily(me.playerId, clock)
    if (!claim.ok) throw new Error('the claim was refused')
    expect(claim).toMatchObject({ day: 7, streak: 7, points: 15_000 })
    expect(claim.items).toHaveLength(1)
    expect(await loginDays(me.playerId)).toBe(days0 + 1)
    const afterClaim = await totals()
    expect(afterClaim.balances - before.balances).toBe(15_000)

    const preview = await gmAt.checkinPreview(me.playerId)
    expect(preview).toEqual({ claimedToday: true, day: 7, streak: 7, points: 15_000, itemIds: claim.items })

    pushed.mockClear()
    const r = await gmAt.resetCheckin(actor(boss), me.playerId, 'điểm danh nhầm tài khoản')
    expect(r).toEqual({ actionId: expect.any(Number), undone: { points: 15_000, itemIds: claim.items }, balance: base })
    expect(await h.app.services.repos.balances.get(me.playerId)).toBe(base)
    expect(await itemRows(me.playerId)).toEqual([])
    expect(await loginRow(me.playerId)).toEqual({ streak: 6, last: YESTERDAY, days: 6 })
    expect(await loginDays(me.playerId)).toBe(days0)
    const ledger = await h.app.services.repos.ledger.list(me.playerId, { limit: 1 })
    expect(ledger[0]).toMatchObject({ amount: -15_000, reason: 'gm_checkin_undo', refId: `gm:${String(r.actionId)}` })
    const [log] = rowsOf<{ action: string; amount: string | number | null; reason: string; details: Record<string, unknown> }>(
      await db.execute(sql`select action, amount, reason, details from gm_actions where id = ${r.actionId}`),
    )
    expect(log).toMatchObject({ action: 'reset_checkin', reason: 'điểm danh nhầm tài khoản', details: { previousStreak: 7, previousLastClaimDate: TODAY, undone: { points: 15_000, itemIds: claim.items } } })
    expect(Number(log?.amount)).toBe(15_000)
    expect(pushed).toHaveBeenCalledWith(me.playerId)
    expect(notified).toHaveBeenCalledWith(me.playerId, { t: 'NOTIFICATION', kind: 'GM_NOTICE', payload: { action: 'reset_checkin', amount: 15_000, reason: 'điểm danh nhầm tài khoản' } })
    // Undone, the whole sequence leaves the books exactly as they were before the claim.
    const afterReset = await totals()
    expect(afterReset).toEqual(before)
    expect(afterReset.balances).toBe(afterReset.ledger)
    expect((await gmAt.checkinPreview(me.playerId)).claimedToday).toBe(false)

    // The player can claim again: the same streak and points, a fresh draw, and the books move by the same 15,000.
    const again = await h.app.services.economy.claimDaily(me.playerId, clock)
    if (!again.ok) throw new Error('the reclaim was refused')
    expect(again).toMatchObject({ day: 7, streak: 7, points: 15_000 })
    expect(again.items).toHaveLength(1)
    expect(await loginRow(me.playerId)).toEqual({ streak: 7, last: TODAY, days: 7 })
    expect(await loginDays(me.playerId)).toBe(days0 + 1)
    const afterReclaim = await totals()
    expect(afterReclaim.balances - before.balances).toBe(15_000)
    expect(afterReclaim.balances).toBe(afterReclaim.ledger)
    expect(afterReclaim.sinks).toBe(before.sinks)
  })

  it('resetCheckin takes back both the tier points and the fallback points of a claim that drew nothing, and the reclaim conserves', async () => {
    await seedStreak(me.playerId, 6, YESTERDAY)
    // Day 7 draws a random common: owning every common first leaves the draw nothing, so the claim pays 10,000 under
    // `daily_item_fallback` beside its 15,000 `daily_login`, both under the claim's one ref.
    await db.execute(sql`insert into inventory (player_id, item_id, source) select ${me.playerId}, id, 'gm' from items where rarity = 'common' on conflict do nothing`)
    const base = await settle()
    const before = await totals()
    const notified = vi.spyOn(h.app.game, 'notify')

    const claim = await h.app.services.economy.claimDaily(me.playerId, clock)
    if (!claim.ok) throw new Error('the claim was refused')
    expect(claim).toMatchObject({ day: 7, points: 15_000, items: [], fallbackPoints: 10_000 })
    expect((await totals()).balances - before.balances).toBe(25_000)
    expect((await gmAt.checkinPreview(me.playerId)).points).toBe(25_000)

    const r = await gmAt.resetCheckin(actor(boss), me.playerId, 'rút lại cả tiền bù')
    expect(r.undone).toEqual({ points: 25_000, itemIds: [] })
    expect(r.balance).toBe(base)
    const ledger = await h.app.services.repos.ledger.list(me.playerId, { limit: 1 })
    expect(ledger[0]).toMatchObject({ amount: -25_000, reason: 'gm_checkin_undo', refId: `gm:${String(r.actionId)}` })
    expect(notified).toHaveBeenCalledWith(me.playerId, { t: 'NOTIFICATION', kind: 'GM_NOTICE', payload: { action: 'reset_checkin', amount: 25_000, reason: 'rút lại cả tiền bù' } })
    const afterReset = await totals()
    expect(afterReset).toEqual(before)
    expect(afterReset.balances).toBe(afterReset.ledger)

    // The reclaim pays the same 25,000 again, and only the latest claim's rows count for a later undo.
    clock += 60_000
    h.setNow(clock)
    const again = await h.app.services.economy.claimDaily(me.playerId, clock)
    if (!again.ok) throw new Error('the reclaim was refused')
    expect(again).toMatchObject({ points: 15_000, items: [], fallbackPoints: 10_000 })
    expect((await gmAt.checkinPreview(me.playerId)).points).toBe(25_000)
    const afterReclaim = await totals()
    expect(afterReclaim.balances - before.balances).toBe(25_000)
    expect(afterReclaim.balances).toBe(afterReclaim.ledger)
    expect(afterReclaim.sinks).toBe(before.sinks)
  })

  it('resetCheckin refuses NOT_CLAIMED_TODAY and INSUFFICIENT_BALANCE and writes no log row in either case', async () => {
    const resets = async () => (await actionsOf(me.playerId)).filter((a) => a.action === 'reset_checkin')

    // Never claimed, and claimed yesterday: neither is "today's claim".
    await expect(gmAt.resetCheckin(actor(boss), me.playerId, 'chưa điểm danh')).rejects.toMatchObject({ code: 'NOT_CLAIMED_TODAY' })
    await seedStreak(me.playerId, 3, YESTERDAY)
    await expect(gmAt.resetCheckin(actor(boss), me.playerId, 'hôm qua thôi')).rejects.toMatchObject({ code: 'NOT_CLAIMED_TODAY' })
    expect(await gmAt.checkinPreview(me.playerId)).toMatchObject({ claimedToday: false, points: 0, itemIds: [] })
    expect(await resets()).toEqual([])

    // Claim, then spend the points: the undo would overdraw the balance, so it is refused whole.
    await seedStreak(me.playerId, 6, YESTERDAY)
    await settle()
    const claim = await h.app.services.economy.claimDaily(me.playerId, clock)
    if (!claim.ok) throw new Error('the claim was refused')
    await gmAt.adjustPoints(actor(boss), me.playerId, -claim.balance, 'tiêu hết')
    const actionsBefore = (await actionsOf(me.playerId)).length
    await expect(gmAt.resetCheckin(actor(boss), me.playerId, 'không đủ điểm')).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' })
    expect(await actionsOf(me.playerId)).toHaveLength(actionsBefore)
    expect(await resets()).toEqual([])
    // Nothing else moved either: the item, the streak and the counters are still the claim's.
    expect(await itemRows(me.playerId)).toHaveLength(1)
    expect(await loginRow(me.playerId)).toEqual({ streak: 7, last: TODAY, days: 7 })
    expect(await h.app.services.repos.balances.get(me.playerId)).toBe(0)

    // Validation and lookups.
    await expect(gmAt.resetCheckin(actor(boss), me.playerId, 'ab')).rejects.toMatchObject({ code: 'INVALID_REASON' })
    await expect(gmAt.resetCheckin(actor(boss), '00000000-0000-4000-8000-000000000000', 'ai đó')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(gmAt.checkinPreview('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await gmAt.adjustPoints(actor(boss), me.playerId, 20_000, 'trả lại')
    await gmAt.lock(actor(boss), me.playerId, 'spam')
    await expect(gmAt.resetCheckin(actor(boss), me.playerId, 'đang khóa')).rejects.toMatchObject({ code: 'TARGET_IS_LOCKED' })
    expect(await resets()).toEqual([])
  })

  it('a second reset after a reclaim takes back one claim, not two', async () => {
    await seedStreak(me.playerId, 6, YESTERDAY)
    const base = await settle()
    const before = await totals()
    const first = await h.app.services.economy.claimDaily(me.playerId, clock)
    if (!first.ok) throw new Error('the claim was refused')
    // The reclaim happens later in the same day, so its rows are newer than the undone claim's.
    await gmAt.resetCheckin(actor(boss), me.playerId, 'lần một')
    clock += 60_000
    h.setNow(clock)
    const second = await h.app.services.economy.claimDaily(me.playerId, clock)
    if (!second.ok) throw new Error('the reclaim was refused')
    const preview = await gmAt.checkinPreview(me.playerId)
    expect(preview).toMatchObject({ claimedToday: true, points: 15_000, itemIds: second.items })

    const r = await gmAt.resetCheckin(actor(boss), me.playerId, 'lần hai')
    expect(r.undone).toEqual({ points: 15_000, itemIds: second.items })
    expect(await totals()).toEqual(before)
    expect(await h.app.services.repos.balances.get(me.playerId)).toBe(base)
    expect(await itemRows(me.playerId)).toEqual([])
    expect(await loginRow(me.playerId)).toEqual({ streak: 6, last: YESTERDAY, days: 6 })
  })

  it('resetCheckin steps the consecutive run back with the month count and logs it, so a reclaim counts the run once', async () => {
    // Day 7 of the month after eleven days in a row (the run began last month).
    await seedStreak(me.playerId, 6, YESTERDAY, 11)
    await settle()
    const claim = await h.app.services.economy.claimDaily(me.playerId, clock)
    if (!claim.ok) throw new Error('the claim was refused')
    expect(claim).toMatchObject({ day: 7, streak: 7, consecutive: 12 })
    expect(await consecutiveOf(me.playerId)).toBe(12)

    const r = await gmAt.resetCheckin(actor(boss), me.playerId, 'điểm danh nhầm tài khoản')
    expect(await consecutiveOf(me.playerId)).toBe(11)
    expect(await loginRow(me.playerId)).toEqual({ streak: 6, last: YESTERDAY, days: 6 })
    const [log] = rowsOf<{ details: Record<string, unknown> }>(await db.execute(sql`select details from gm_actions where id = ${r.actionId}`))
    expect(log?.details).toMatchObject({ previousStreak: 7, previousConsecutive: 12, previousLastClaimDate: TODAY })

    clock += 60_000
    h.setNow(clock)
    const again = await h.app.services.economy.claimDaily(me.playerId, clock)
    expect(again).toMatchObject({ ok: true, day: 7, streak: 7, consecutive: 12 })
    expect(await consecutiveOf(me.playerId)).toBe(12)
    expect(await loginStreakOf(me.playerId)).toBe(12)
  })

  it('resetCheckin never steps a run of one below zero, and the reclaim starts the run at one again', async () => {
    // Claimed on the 1st, missed the 2nd and 3rd: today's claim is day 7 of the month but day 1 of a run.
    await seedStreak(me.playerId, 6, '2026-09-01', 4)
    await settle()
    const claim = await h.app.services.economy.claimDaily(me.playerId, clock)
    expect(claim).toMatchObject({ ok: true, day: 7, consecutive: 1 })

    const r = await gmAt.resetCheckin(actor(boss), me.playerId, 'điểm danh nhầm tài khoản')
    expect(await consecutiveOf(me.playerId)).toBe(0)
    const [log] = rowsOf<{ details: Record<string, unknown> }>(await db.execute(sql`select details from gm_actions where id = ${r.actionId}`))
    expect(log?.details).toMatchObject({ previousConsecutive: 1 })

    clock += 60_000
    h.setNow(clock)
    expect(await h.app.services.economy.claimDaily(me.playerId, clock)).toMatchObject({ ok: true, day: 7, consecutive: 1 })
    expect(await consecutiveOf(me.playerId)).toBe(1)
  })
})

describe('GmService — lock and role', () => {
  it('locks: columns set, sessions revoked, socket closed, kicked from the room; unlock clears; double lock refused', async () => {
    const ws = await connect(await listen(), me.cookie)
    await ws.next('WELCOME')
    ws.send({ t: 'CREATE_ROOM', config: BLIND_ROOM })
    await ws.next('ROOM_SNAPSHOT')
    ws.send({ t: 'SIT_DOWN', seat: 0 })
    await ws.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_SAT' && m.event.playerId === me.playerId)

    await gm.lock(actor(boss), me.playerId, 'spam')
    expect((await ws.closed).code).toBe(4003)
    const [row] = rowsOf<{ locked_at: unknown; locked_reason: string | null }>(await db.execute(sql`select locked_at, locked_reason from users where id = ${me.playerId}`))
    expect(row?.locked_at).not.toBeNull()
    expect(row?.locked_reason).toBe('spam')
    expect((await h.app.fastify.inject({ url: '/api/me', headers: { cookie: me.cookie } })).statusCode).toBe(401)
    expect(h.app.game.rooms.roomOf(me.playerId)).toBeUndefined()
    expect(await h.app.services.repos.balances.get(me.playerId)).toBe(ECONOMY.startingBalance) // the stack came home
    await expect(gm.lock(actor(boss), me.playerId, 'again')).rejects.toMatchObject({ code: 'ALREADY_LOCKED' })

    await gm.unlock(actor(boss), me.playerId, 'ok now')
    const [after] = rowsOf<{ locked_at: unknown; locked_reason: string | null }>(await db.execute(sql`select locked_at, locked_reason from users where id = ${me.playerId}`))
    expect(after).toEqual({ locked_at: null, locked_reason: null })
    await expect(gm.unlock(actor(boss), me.playerId, 'twice')).rejects.toMatchObject({ code: 'NOT_LOCKED' })
    expect((await actionsOf(me.playerId)).map((a) => a.action)).toEqual(['lock', 'unlock'])
  })

  it('locks in order after the commit — sessions revoked, then the room kick, then the notice, then the socket closed', async () => {
    const calls: string[] = []
    const room = {
      adminKick: (id: string) => { calls.push(`adminKick:${id}`); return Promise.resolve('now' as const) },
      adminSummary: () => ({ roomId: 'r1', code: 'ABC123', name: 'Bàn', members: [] }),
    }
    const game: GmServiceDeps['game'] = {
      connectionCount: 0,
      notify: (id, msg) => { calls.push(`notify:${id}:${(msg as { kind?: string }).kind ?? ''}`) },
      balanceChanged: () => Promise.resolve(),
      rooms: { size: 1, roomOf: () => room },
      gateway: { disconnect: (id) => { calls.push(`disconnect:${id}`); return 1 } },
    }
    const sessions = { ...h.app.services.sessions, revokeAll: async (id: string) => { calls.push(`revokeAll:${id}`); await h.app.services.sessions.revokeAll(id) } }
    const stubbed = createGmService(deps({ game, sessions }))
    await stubbed.lock(actor(boss), me.playerId, 'spam')
    const id = me.playerId
    expect(calls).toEqual([`revokeAll:${id}`, `adminKick:${id}`, `notify:${id}:GM_NOTICE`, `disconnect:${id}`])
  })

  it('logs a room kick that failed during a lock, and still sends the notice and closes the socket', async () => {
    const calls: string[] = []
    const warn = vi.fn()
    const game: GmServiceDeps['game'] = {
      connectionCount: 0,
      notify: () => { calls.push('notify') },
      balanceChanged: () => Promise.resolve(),
      rooms: { size: 1, roomOf: () => ({ adminKick: () => Promise.reject(new Error('room on fire')), adminSummary: () => ({ roomId: 'r1', code: 'ABC123', name: 'Bàn', members: [] }) }) },
      gateway: { disconnect: () => { calls.push('disconnect'); return 1 } },
    }
    await createGmService(deps({ game, log: { warn } })).lock(actor(boss), me.playerId, 'spam')
    expect(warn).toHaveBeenCalledWith('gm lock: the room kick failed', expect.objectContaining({ playerId: me.playerId, error: 'room on fire' }))
    expect(calls).toEqual(['notify', 'disconnect'])
  })

  it('warns a revocation that failed during a lock, and still kicks, notifies and closes the socket, in order', async () => {
    const calls: string[] = []
    const warn = vi.fn()
    const room = {
      adminKick: (id: string) => { calls.push(`adminKick:${id}`); return Promise.resolve('now' as const) },
      adminSummary: () => ({ roomId: 'r1', code: 'ABC123', name: 'Bàn', members: [] }),
    }
    const game: GmServiceDeps['game'] = {
      connectionCount: 0,
      notify: (id) => { calls.push(`notify:${id}`) },
      balanceChanged: () => Promise.resolve(),
      rooms: { size: 1, roomOf: () => room },
      gateway: { disconnect: (id) => { calls.push(`disconnect:${id}`); return 1 } },
    }
    const sessions = { ...h.app.services.sessions, revokeAll: () => Promise.reject(new Error('sessions down')) }
    await createGmService(deps({ game, sessions, log: { warn } })).lock(actor(boss), me.playerId, 'spam')
    expect(warn).toHaveBeenCalledWith('gm lock: revoking the sessions failed', expect.objectContaining({ playerId: me.playerId, error: 'sessions down' }))
    const id = me.playerId
    expect(calls).toEqual([`adminKick:${id}`, `notify:${id}`, `disconnect:${id}`])
    expect((await actionsOf(id)).map((a) => a.action)).toEqual(['lock'])
  })

  it('never locks a gm, and never lets a gm change their own role', async () => {
    await expect(gm.lock(actor(boss), boss.playerId, 'myself')).rejects.toMatchObject({ code: 'SELF_TARGET' })
    await promote(me.playerId)
    await expect(gm.lock(actor(boss), me.playerId, 'a gm')).rejects.toMatchObject({ code: 'TARGET_IS_GM' })
    await expect(gm.setRole(actor(boss), boss.playerId, 'player', 'bye')).rejects.toMatchObject({ code: 'SELF_TARGET' })
    expect(await actionsOf(me.playerId)).toEqual([])
    expect(await actionsOf(boss.playerId)).toEqual([])
  })

  it('promotes and demotes with a log line, and refuses to demote the last gm', async () => {
    expect((await gm.setRole(actor(boss), me.playerId, 'gm', 'help wanted')).role).toBe('gm')
    expect((await gm.setRole(actor(boss), me.playerId, 'player', 'done')).role).toBe('player')
    await expect(gm.setRole(actor(me), boss.playerId, 'player', 'coup')).rejects.toMatchObject({ code: 'LAST_GM' })
    expect((await actionsOf(me.playerId)).map((a) => a.action)).toEqual(['promote', 'demote'])
    const [still] = rowsOf<{ role: string }>(await db.execute(sql`select role from users where id = ${boss.playerId}`))
    expect(still?.role).toBe('gm')
    await expect(gm.setRole(actor(boss), me.playerId, 'admin' as 'gm', 'bad role')).rejects.toMatchObject({ code: 'INVALID_ROLE' })
  })

  it('two gms demoting each other — the gm set locked before the target — one wins and the other answers LAST_GM', async () => {
    await gm.setRole(actor(boss), me.playerId, 'gm', 'help wanted')
    const results = await Promise.allSettled([
      gm.setRole(actor(me), boss.playerId, 'player', 'coup'),
      gm.setRole(actor(boss), me.playerId, 'player', 'counter-coup'),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const refused = results.find((r) => r.status === 'rejected')
    expect(refused?.reason).toMatchObject({ code: 'LAST_GM' })
    const gms = rowsOf<{ id: string }>(await db.execute(sql`select id from users where role = 'gm'`))
    expect(gms).toHaveLength(1)
  })

  it('refuses to promote a locked account (TARGET_IS_LOCKED) and writes no log line; after the unlock it promotes', async () => {
    await gm.lock(actor(boss), me.playerId, 'spam')
    await expect(gm.setRole(actor(boss), me.playerId, 'gm', 'help wanted')).rejects.toMatchObject({ code: 'TARGET_IS_LOCKED' })
    expect((await actionsOf(me.playerId)).map((a) => a.action)).toEqual(['lock'])
    await gm.unlock(actor(boss), me.playerId, 'ok now')
    expect((await gm.setRole(actor(boss), me.playerId, 'gm', 'help wanted')).role).toBe('gm')
  })
})

describe('GmService — reads', () => {
  it('searches by email prefix or by name, masks the email, pages by playerId', async () => {
    const found = await gm.search('binh')
    expect(found.players.map((p) => p.emailMasked)).toContain('b***@example.com')
    expect(JSON.stringify(found)).not.toContain('binh@example.com')
    expect((await gm.get(me.playerId))?.email).toBe('binh@example.com')

    // By name: the folded key, so case and the input's own form do not matter.
    expect((await gm.search('CHỦ')).players.map((p) => p.playerId)).toEqual([boss.playerId])
    // A LIKE wildcard is a character to look for, not a pattern.
    expect((await gm.search('%')).players).toEqual([])

    const first = await gm.search('', { limit: 1 })
    expect(first.players).toHaveLength(1)
    expect(first.nextBefore).toBe(first.players[0]!.playerId)
    const second = await gm.search('', { limit: 1, before: first.nextBefore! })
    expect(second.players).toHaveLength(1)
    expect(second.players[0]!.playerId > first.players[0]!.playerId).toBe(true)
    expect((await gm.search('', { limit: 1, before: second.players[0]!.playerId })).players).toEqual([])
  })

  it('reads one player in full: the real email, the lock, stats, the room and the inventory count', async () => {
    expect(await gm.get('not-a-uuid')).toBeNull()
    expect(await gm.get('00000000-0000-4000-8000-000000000000')).toBeNull()
    await gm.lock(actor(boss), me.playerId, 'spam')
    const detail = await gm.get(me.playerId)
    expect(detail).toMatchObject({
      playerId: me.playerId,
      displayName: me.displayName,
      email: 'binh@example.com',
      role: 'player',
      balance: ECONOMY.startingBalance,
      locked: { at: expect.any(Number), reason: 'spam' },
      room: null,
      stats: expect.objectContaining({ handsPlayedBlind: 0 }),
    })
    expect(detail?.inventoryCount).toBeGreaterThan(0)
  })

  it('lists actions newest first with actor and target names, filtered by player', async () => {
    await gm.adjustPoints(actor(boss), me.playerId, 1_000, 'một')
    await gm.adjustPoints(actor(boss), me.playerId, 2_000, 'hai')
    await gm.adjustPoints({ userId: null }, boss.playerId, 3_000, 'cli')
    const page = await gm.actions({ playerId: me.playerId, limit: 1 })
    expect(page.actions[0]).toMatchObject({ action: 'grant_points', amount: 2_000, actor: { displayName: boss.displayName }, target: { displayName: me.displayName } })
    expect(page.nextBefore).toBe(page.actions[0]!.id)
    const next = await gm.actions({ playerId: me.playerId, limit: 1, before: page.nextBefore! })
    expect(next.actions[0]).toMatchObject({ amount: 1_000, reason: 'một' })
    const all = await gm.actions()
    expect(all.actions.map((a) => a.reason)).toEqual(['cli', 'hai', 'một'])
    expect(all.actions[0]!.actor).toBeNull()
    expect(all.nextBefore).toBeNull()
  })

  it('records a room action without a transaction of its own, and filters the log by room', async () => {
    const id = await gm.recordRoomAction(actor(boss), 'close_room', 'room-1', null, 'đóng bàn', { refunded: 2 })
    await gm.recordRoomAction(actor(boss), 'kick', 'room-2', me.playerId, 'quậy')
    const page = await gm.actions({ roomId: 'room-1' })
    expect(page.actions).toHaveLength(1)
    expect(page.actions[0]).toMatchObject({ id, action: 'close_room', roomId: 'room-1', target: null, details: { refunded: 2 } })
    await expect(gm.recordRoomAction(actor(boss), 'kick', 'room-2', null, '')).rejects.toMatchObject({ code: 'INVALID_REASON' })
  })

  it('overview counts accounts, locked, gms, live sockets and rooms, and sums the last 24 h by reason', async () => {
    await gm.adjustPoints(actor(boss), me.playerId, 5_000, 'thưởng')
    const o = await gm.overview()
    expect(o).toMatchObject({ accounts: 2, locked: 0, gms: 1, rooms: 0, online: 0 })
    expect(o.points24h.byReason.find((s) => s.reason === 'starting_balance')?.total).toBe(2 * ECONOMY.startingBalance)
    expect(o.points24h.sources).toBe(2 * ECONOMY.startingBalance + 5_000)
    expect(o.points24h.sinks).toBe(0)
  })
})

describe('GmService — daily stats', () => {
  /** Moves every ledger row of one reason to an exact instant, so the days the test reads are not "whenever it ran". */
  const stamp = (reason: string, iso: string) => db.execute(sql`update point_transactions set created_at = ${iso}::timestamptz where reason = ${reason}`)

  it('dailyStats fills 7 zero days and counts gm_checkin_undo against the sources', async () => {
    const gmAt = createGmService(deps({ now: () => START })) // 2026-09-04 10:00 in Ho Chi Minh
    await gm.adjustPoints(actor(boss), me.playerId, 5_000, 'thưởng')
    await gm.adjustPoints(actor(boss), me.playerId, -2_000, 'thu hồi')
    await db.execute(sql`insert into point_transactions (player_id, amount, reason, ref_id) values (${me.playerId}, -1500, 'gm_checkin_undo', 'daily:x')`)
    await db.execute(sql`insert into point_transactions (player_id, amount, reason, ref_id, kind) values (null, 300, 'table_fee', 'room-1', 'table_fee')`)
    await db.execute(sql`insert into point_transactions (player_id, amount, reason, ref_id) values (${me.playerId}, 700, 'cash_out', 'room-1')`)
    // The two accounts' starting balances land before the window; the rest are spread over the three latest days.
    await stamp('starting_balance', '2026-08-28T10:00:00Z')
    await stamp('gm_grant', '2026-09-04T03:00:00Z')
    await stamp('gm_adjust', '2026-09-03T05:00:00Z')
    await stamp('gm_checkin_undo', '2026-09-03T06:00:00Z')
    await stamp('cash_out', '2026-09-04T04:00:00Z') // a transfer: it moves points, so it is in neither column
    await stamp('table_fee', '2026-09-02T16:59:00Z') // 23:59 on the 2nd in Ho Chi Minh

    const days = await gmAt.dailyStats(7)

    expect(days.map((d) => d.day)).toEqual(['2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'])
    expect(days.slice(0, 4)).toEqual(days.slice(0, 4).map((d) => ({ day: d.day, sources: {}, sinks: {}, net: 0 })))
    expect(days[4]).toEqual({ day: '2026-09-02', sources: {}, sinks: { table_fee: 300 }, net: -300 })
    // The undo and the negative adjustment are signed sources: they pull the day's sources below zero, not its sinks up.
    expect(days[5]).toEqual({ day: '2026-09-03', sources: { gm_adjust: -2_000, gm_checkin_undo: -1_500 }, sinks: {}, net: -3_500 })
    expect(days[6]).toEqual({ day: '2026-09-04', sources: { gm_grant: 5_000 }, sinks: {}, net: 5_000 })
    expect(await gmAt.dailyStats(30)).toHaveLength(30)
  })
})

describe('GmService — gift schedule', () => {
  const logged = async () =>
    rowsOf<{ action: string; target_player_id: string | null; reason: string; details: Record<string, unknown> | null }>(
      await db.execute(sql`select action, target_player_id, reason, details from gm_actions where action in ('set_gift_month', 'clear_gift_month') order by id`),
    )

  it('setGiftMonth and clearGiftMonth log with the month in details', async () => {
    // START is 4 September 2026: October is a later month, free to set.
    const days = { '7': { fixed: ['aura_ice01'] } }
    const set = await gm.setGiftMonth(actor(boss), '2026-10', days, 'quà tháng mười')
    expect(set.actionId).toBeGreaterThan(0)
    // Effective at once, with no restart: the schedule the economy reads has it.
    expect(h.app.services.gifts.current().itemRuleForDay(7, '2026-10')).toEqual({ kind: 'fixed', itemIds: ['aura_ice01'] })
    // The view reads the service's own clock: pinned to the app's, so the window starts in the month the store calls current.
    const shown = await createGmService(deps({ now: () => START })).giftMonths()
    expect(shown.months).toHaveLength(13)
    expect(shown.months[0]).toMatchObject({ month: '2026-09', source: 'file' })
    expect(shown.months[1]).toMatchObject({ month: '2026-10', source: 'db', days, updatedBy: boss.playerId })
    expect(shown.default).toHaveProperty('28')

    const cleared = await gm.clearGiftMonth(actor(boss), '2026-10', 'bỏ quà tháng mười')
    expect(cleared.actionId).toBeGreaterThan(set.actionId)
    expect(h.app.services.gifts.current().itemRuleForDay(7, '2026-10')).toEqual({ kind: 'randomUnowned', rarity: 'common' })

    const rows = await logged()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ action: 'set_gift_month', target_player_id: null, reason: 'quà tháng mười', details: { month: '2026-10', days } })
    expect(rows[1]).toMatchObject({ action: 'clear_gift_month', target_player_id: null, reason: 'bỏ quà tháng mười', details: { month: '2026-10' } })
  })

  it('writes no log line for a month it refuses, and NOTHING_TO_CLEAR for a month with no entry of its own', async () => {
    const refused = async (run: () => Promise<unknown>): Promise<string> => {
      try {
        await run()
      } catch (err) {
        return (err as ServiceError).code
      }
      return 'NO_ERROR'
    }
    expect(await refused(() => gm.setGiftMonth(actor(boss), '2026-08', {}, 'tháng đã qua'))).toBe('MONTH_IN_PAST')
    expect(await refused(() => gm.setGiftMonth(actor(boss), '2026-09', { '3': { draw: 'rare' } }, 'tầng đã qua'))).toBe('TIER_LOCKED')
    expect(await refused(() => gm.setGiftMonth(actor(boss), '2026-10', { '3': { fixed: ['nope'] } }, 'sai vật phẩm'))).toBe('INVALID_GIFTS')
    expect(await refused(() => gm.setGiftMonth(actor(boss), '2026-10', {}, 'ab'))).toBe('INVALID_REASON')
    expect(await refused(() => gm.clearGiftMonth(actor(boss), '2026-10', 'không có gì để bỏ'))).toBe('NOTHING_TO_CLEAR')
    expect(await logged()).toEqual([])
    // Nothing reached the table either.
    expect(rowsOf(await db.execute(sql`select 1 from gift_months`))).toEqual([])
  })
})
