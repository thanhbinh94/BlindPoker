import { silentLogger } from '@bp/server-kit'
import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDb } from '../db/client.js'
import { createTestDb, type TestDb } from '../db/test-db.js'
import { dailyLogins, giftMonths, inventory, players, users } from '../db/schema.js'
import { ServiceError } from '../errors.js'
import { createEventBus } from '../events.js'
import { createInventoryService, type InventoryService } from '../inventory/inventory-service.js'
import { loadItemCatalog, type ItemCatalog } from '../inventory/items.js'
import { createRepositories } from '../repos/index.js'
import { parseDailyGifts, type DailyGiftSchedule } from './daily-gifts.js'
import { createEconomyService } from './economy-service.js'
import { createGiftScheduleStore, type GiftScheduleStore } from './gift-schedule-store.js'

let test: TestDb
let db: AppDb
let catalog: ItemCatalog
let inv: InventoryService
let store: GiftScheduleStore
let clock = 0

/** Local noon on a day of October 2026 — the "current month" of every case below. */
const OCT = (day: number): number => Date.UTC(2026, 9, day, 12, 0)

/** Written out, not read from `data/daily-gifts.json`, so an operator's edit to the shipped file cannot move these tests. */
const FILE = {
  default: { '7': { draw: 'common' }, '14': { draw: 'rare' }, '21': { draw: 'rare' }, '28': { fixed: ['badge_monthly', 'title_devoted'] } },
  months: { '2026-11': { '28': { fixed: ['badge_monthly', 'title_devoted', 'head_tophat01'] } } },
}

const makeStore = (over: { log?: { warn: (msg: string, data?: object) => void } } = {}): Promise<GiftScheduleStore> =>
  createGiftScheduleStore({ db, catalog, defaults: FILE, timezone: 'UTC', now: () => clock, ...over })

/** The way the GM service commits it: one transaction for the write, `reload()` once it has committed. */
async function set(month: string, days: unknown, actor: string | null = null): Promise<void> {
  await db.transaction((tx) => store.setMonth(tx, month, days, actor))
  await store.reload()
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (err) {
    if (err instanceof ServiceError) return err.code
    throw err
  }
  return 'NO_ERROR'
}

const messageOf = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run()
  } catch (err) {
    return (err as Error).message
  }
  return ''
}

const rowCount = async (): Promise<number> => (await db.select().from(giftMonths)).length

let seq = 0
async function seedPlayer(): Promise<string> {
  seq += 1
  const [user] = await db.insert(users).values({ email: `g${String(seq)}@example.com`, passwordHash: 'argon2' }).returning({ id: users.id })
  await db.insert(players).values({ id: user!.id, displayName: `g${String(seq)}`, nameKey: `g${String(seq)}`, balance: 0 })
  await db.insert(dailyLogins).values({ playerId: user!.id })
  return user!.id
}

/** Streak 27 with yesterday claimed: the next claim, on `OCT(10)`, is day 28. */
async function aboutToClaim28(playerId: string): Promise<void> {
  await db.update(dailyLogins).set({ streak: 27, lastClaimDate: '2026-10-09', month: '2026-10', claimedDays: 27 }).where(eq(dailyLogins.playerId, playerId))
}

const grantedOf = async (playerId: string): Promise<string[]> =>
  (await db.select({ itemId: inventory.itemId }).from(inventory).where(eq(inventory.playerId, playerId))).map((r) => r.itemId).sort()

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
  catalog = loadItemCatalog()
  await catalog.seed(db)
  inv = createInventoryService(db, undefined, catalog.freeIds())
})
afterAll(async () => {
  await test.close()
})
beforeEach(async () => {
  clock = OCT(10)
  store = await makeStore()
})
afterEach(async () => {
  await db.execute(sql`truncate table gift_months, inventory, daily_logins, point_transactions, players, users restart identity cascade`)
})

describe('GiftScheduleStore', () => {
  it("merges file months under db months and refuses a past month, a locked tier and an invalid candidate with the parser's message", async () => {
    // The file alone, to begin with: November's day 28 names the top hat.
    expect(store.current().itemRuleForDay(28, '2026-11')).toEqual({ kind: 'fixed', itemIds: ['badge_monthly', 'title_devoted', 'head_tophat01'] })
    expect(store.defaults()).toEqual(FILE.default)

    // A month the file does not name, and one it does: the row replaces the file's entry, and shows after `reload()` only.
    const actor = await seedPlayer()
    await db.transaction((tx) => store.setMonth(tx, '2026-12', { '7': { fixed: ['aura_ice01'] } }, actor))
    expect(store.current().itemRuleForDay(7, '2026-12')).toEqual({ kind: 'randomUnowned', rarity: 'common' })
    await store.reload()
    expect(store.current().itemRuleForDay(7, '2026-12')).toEqual({ kind: 'fixed', itemIds: ['aura_ice01'] })
    await set('2026-11', { '28': { fixed: ['head_tophat01'] } })
    expect(store.current().itemRuleForDay(28, '2026-11')).toEqual({ kind: 'fixed', itemIds: ['head_tophat01'] })
    // Other months keep the default.
    expect(store.current().itemRuleForDay(28, '2027-02')).toEqual({ kind: 'fixed', itemIds: ['badge_monthly', 'title_devoted'] })

    const months = await store.months()
    expect(months.map((m) => [m.month, m.source])).toEqual([['2026-11', 'db'], ['2026-12', 'db']])
    expect(months[1]).toMatchObject({ days: { '7': { fixed: ['aura_ice01'] } }, updatedBy: actor })
    expect(months[1]!.updatedAt).toBe(OCT(10))

    // Clearing the row brings the file's entry back; there is nothing left to clear after that.
    expect(await db.transaction((tx) => store.clearMonth(tx, '2026-11'))).toBe(true)
    await store.reload()
    expect(store.current().itemRuleForDay(28, '2026-11')).toEqual({ kind: 'fixed', itemIds: ['badge_monthly', 'title_devoted', 'head_tophat01'] })
    expect((await store.months()).find((m) => m.month === '2026-11')).toMatchObject({ source: 'file' })
    expect(await db.transaction((tx) => store.clearMonth(tx, '2026-11'))).toBe(false)

    // A month that is over.
    expect(await codeOf(() => db.transaction((tx) => store.setMonth(tx, '2026-09', {}, null)))).toBe('MONTH_IN_PAST')
    // A month that is not one.
    expect(await codeOf(() => db.transaction((tx) => store.setMonth(tx, '2026-13', {}, null)))).toBe('INVALID_MONTH')

    // The current month on the 10th: tiers 1–10 are history, 11 and later are free. Saying what is already so is no change.
    expect(await codeOf(() => db.transaction((tx) => store.setMonth(tx, '2026-10', { '7': { draw: 'rare' } }, null)))).toBe('TIER_LOCKED')
    expect(await codeOf(() => db.transaction((tx) => store.setMonth(tx, '2026-10', { '10': { draw: 'rare' } }, null)))).toBe('TIER_LOCKED')
    await set('2026-10', { '7': { draw: 'common' }, '11': { draw: 'rare' } })
    expect(store.current().itemRuleForDay(11, '2026-10')).toEqual({ kind: 'randomUnowned', rarity: 'rare' })
    // Clearing it would change tier 7 only if it had changed it; here it changes nothing already reached, so it goes.
    expect(await db.transaction((tx) => store.clearMonth(tx, '2026-10'))).toBe(true)
    // …but a row that did change a reached tier cannot be cleared once that tier is reached.
    await set('2026-10', { '12': { draw: 'rare' } })
    clock = OCT(12)
    expect(await codeOf(() => db.transaction((tx) => store.clearMonth(tx, '2026-10')))).toBe('TIER_LOCKED')
    clock = OCT(10)

    // An invalid candidate carries the parser's own words, and writes nothing.
    const before = await rowCount()
    const unknown = await messageOf(() => db.transaction((tx) => store.setMonth(tx, '2026-12', { '28': { fixed: ['no_such_item'] } }, null)))
    expect(unknown).toContain('no_such_item')
    expect(unknown).toContain('not in the item catalogue')
    expect(await codeOf(() => db.transaction((tx) => store.setMonth(tx, '2026-12', { '28': { fixed: ['no_such_item'] } }, null)))).toBe('INVALID_GIFTS')
    expect(await codeOf(() => db.transaction((tx) => store.setMonth(tx, '2026-12', { '32': { draw: 'rare' } }, null)))).toBe('INVALID_GIFTS')
    expect(await codeOf(() => db.transaction((tx) => store.setMonth(tx, '2026-12', 'nope', null)))).toBe('INVALID_GIFTS')
    // A tier a month never reaches, an epic draw, and the same item twice in a month.
    expect(await codeOf(() => db.transaction((tx) => store.setMonth(tx, '2027-02', { '30': { draw: 'rare' } }, null)))).toBe('INVALID_GIFTS')
    expect(await codeOf(() => db.transaction((tx) => store.setMonth(tx, '2026-12', { '3': { draw: 'epic' } }, null)))).toBe('INVALID_GIFTS')
    expect(await codeOf(() => db.transaction((tx) => store.setMonth(tx, '2026-12', { '3': { fixed: ['badge_monthly'] } }, null)))).toBe('INVALID_GIFTS')
    expect(await rowCount()).toBe(before)

    // A required slot cannot be revoked by a check-in undo, so it cannot be a gift (P7).
    const outfit = catalog.all().find((d) => d.slot === 'outfit' && !d.isDefault && d.free !== true)
    expect(outfit).toBeDefined()
    const slotMessage = await messageOf(() => db.transaction((tx) => store.setMonth(tx, '2026-12', { '3': { fixed: [outfit!.id] } }, null)))
    expect(slotMessage).toContain(outfit!.id)
    expect(await codeOf(() => db.transaction((tx) => store.setMonth(tx, '2026-12', { '3': { fixed: [outfit!.id] } }, null)))).toBe('INVALID_GIFTS')
    expect(await rowCount()).toBe(before)
  })

  it('skips a stored month that no longer validates, warns once, and keeps the rest (P8)', async () => {
    await db.insert(giftMonths).values([
      { month: '2026-12', days: { '7': { fixed: ['aura_ice01'] } } },
      { month: '2027-01', days: { '28': { fixed: ['an_item_since_withdrawn'] } } },
    ])
    const warn = vi.fn()
    const booted = await makeStore({ log: { warn } })
    expect(booted.current().itemRuleForDay(7, '2026-12')).toEqual({ kind: 'fixed', itemIds: ['aura_ice01'] })
    // The broken month falls back to the default, here the file's day 28.
    expect(booted.current().itemRuleForDay(28, '2027-01')).toEqual({ kind: 'fixed', itemIds: ['badge_monthly', 'title_devoted'] })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![1]).toMatchObject({ month: '2027-01' })
    // It is still listed, so a GM can see it and clear it.
    expect((await booted.months()).map((m) => [m.month, m.source])).toEqual([['2026-11', 'file'], ['2026-12', 'db'], ['2027-01', 'db']])
    expect(await db.transaction((tx) => booted.clearMonth(tx, '2027-01'))).toBe(true)
  })

  it('refuses a file that is not a schedule by itself, as before', async () => {
    await expect(createGiftScheduleStore({ db, catalog, defaults: { default: { '7': { fixed: ['no_such_item'] } } }, timezone: 'UTC' })).rejects.toThrow('no_such_item')
  })

  it('a claim that began before setMonth keeps its schedule; the next claim sees the new fixed item; the item is granted once', async () => {
    const economyBus = createEventBus(silentLogger)
    // `gifts` is read through a spy: the economy must take it once per claim, and the claim keeps what it took.
    const gifts = vi.fn((): DailyGiftSchedule => store.current())
    const economy = createEconomyService({
      db,
      repos: createRepositories(db),
      inventory: inv,
      catalog,
      bus: economyBus,
      timezone: 'UTC',
      onBalanceChanged: () => {},
      now: () => clock,
      rng: () => 0,
      gifts,
    })
    const first = await seedPlayer()
    const second = await seedPlayer()
    await aboutToClaim28(first)
    await aboutToClaim28(second)

    // Both are about to claim day 28 on the 10th. The first does so under the file's gift: the badge and the title.
    expect(await economy.claimDaily(first)).toMatchObject({ ok: true, day: 28, items: ['badge_monthly', 'title_devoted'] })
    expect(gifts).toHaveBeenCalledTimes(1)

    // A GM then changes tier 28 of this month (a later day than the 10th, so it is free to change).
    await set('2026-10', { '28': { fixed: ['head_tophat01'] } })

    // The next claim, by another player, sees the new schedule: the top hat, and only that.
    expect(await economy.claimDaily(second)).toMatchObject({ ok: true, day: 28, items: ['head_tophat01'] })
    expect(gifts).toHaveBeenCalledTimes(2)
    expect(await grantedOf(first)).toEqual(expect.arrayContaining(['badge_monthly', 'title_devoted']))
    expect(await grantedOf(first)).not.toContain('head_tophat01')
    expect(await grantedOf(second)).toContain('head_tophat01')
    expect(await grantedOf(second)).not.toContain('badge_monthly')

    // The item was handed out once: a repeat claim on the same day grants nothing more, and reading the status takes one copy.
    expect(await economy.claimDaily(second)).toMatchObject({ ok: false, code: 'ALREADY_CLAIMED' })
    expect((await grantedOf(second)).filter((id) => id === 'head_tophat01')).toHaveLength(1)
    await economy.dailyStatus(second)
    expect(gifts).toHaveBeenCalledTimes(4)
  })

  it('one claim takes the schedule once, even if the getter would answer differently the second time', async () => {
    const withBadge = parseDailyGifts(FILE, catalog, 'a')
    const withHat = parseDailyGifts({ default: { '7': { fixed: ['head_tophat01'] }, '28': { draw: 'rare' } } }, catalog, 'b')
    const gifts = vi.fn<() => DailyGiftSchedule>().mockReturnValueOnce(withBadge).mockReturnValue(withHat)
    const economy = createEconomyService({
      db,
      repos: createRepositories(db),
      inventory: inv,
      catalog,
      bus: createEventBus(silentLogger),
      timezone: 'UTC',
      onBalanceChanged: () => {},
      now: () => clock,
      gifts,
    })
    const player = await seedPlayer()
    await aboutToClaim28(player)
    // Schedule A (the first call) grants the badge and title; had the claim asked again it would have drawn from B.
    expect(await economy.claimDaily(player)).toMatchObject({ ok: true, items: ['badge_monthly', 'title_devoted'] })
    expect(gifts).toHaveBeenCalledTimes(1)
  })
})
