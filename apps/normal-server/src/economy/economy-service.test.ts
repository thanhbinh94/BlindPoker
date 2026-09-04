import { ECONOMY } from '@bp/core'
import { silentLogger } from '@bp/server-kit'
import { asc, eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { dailyLogins, inventory, players, pointTransactions, users } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import type { AppEvent, AppEventBus } from '../events.js'
import { createEventBus } from '../events.js'
import type { InventoryService } from '../inventory/inventory-service.js'
import { createInventoryService } from '../inventory/inventory-service.js'
import type { ItemCatalog } from '../inventory/items.js'
import { loadItemCatalog } from '../inventory/items.js'
import type { NormalRepositories } from '../repos/index.js'
import { createRepositories } from '../repos/index.js'
import type { EconomyService } from './economy-service.js'
import { createEconomyService } from './economy-service.js'

let test: TestDb
let db: AppDb
let repos: NormalRepositories
let inv: InventoryService
let catalog: ItemCatalog
let bus: AppEventBus
let economy: EconomyService

let published: AppEvent[] = []
let balanceCalls: { playerId: string; balance: number }[] = []
/** Replaced per test to pin which unowned item the random tiers draw. */
let rng = (): number => 0

/** Local noon on a day of October 2026 — a 31-day month, so a full streak fits inside it. */
const OCT = (day: number): number => Date.UTC(2026, 9, day, 12, 0)
const octKey = (day: number): string => `2026-10-${String(day).padStart(2, '0')}`
const HOUR = 60 * 60 * 1000

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
  repos = createRepositories(db)
  inv = createInventoryService(db)
  catalog = loadItemCatalog()
  await catalog.seed(db)
  bus = createEventBus(silentLogger)
  bus.subscribe((e) => {
    published.push(e)
  })
  economy = createEconomyService({
    db,
    repos,
    inventory: inv,
    catalog,
    bus,
    timezone: 'UTC',
    onBalanceChanged: (playerId, balance) => balanceCalls.push({ playerId, balance }),
    rng: () => rng(),
  })
})
afterAll(async () => {
  await test.close()
})
beforeEach(() => {
  published = []
  balanceCalls = []
  rng = () => 0
})
afterEach(async () => {
  await db.execute(sql`truncate table inventory, daily_logins, point_transactions, players, users restart identity cascade`)
})

let seq = 0
/** A registered player: a `players` row with a balance, plus the `daily_logins` row registration writes. */
async function seedPlayer(balance = 0): Promise<string> {
  seq += 1
  const name = `p${seq}`
  const [user] = await db.insert(users).values({ email: `${name}@example.com`, passwordHash: 'argon2' }).returning({ id: users.id })
  const id = user!.id
  await db.insert(players).values({ id, displayName: name, nameKey: name, balance })
  await db.insert(dailyLogins).values({ playerId: id })
  return id
}

/** Fast-forwards the check-in state instead of claiming twenty-seven times to reach day 28. */
async function seedStreak(playerId: string, streak: number, lastClaimDay: number): Promise<void> {
  await db
    .update(dailyLogins)
    .set({ streak, lastClaimDate: octKey(lastClaimDay), month: '2026-10', claimedDays: streak })
    .where(eq(dailyLogins.playerId, playerId))
}

async function own(playerId: string, itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return
  await db.transaction(async (tx) => {
    for (const itemId of itemIds) await inv.grant(tx, playerId, itemId, 'test')
  })
}

async function ledger(playerId: string): Promise<{ amount: number; reason: string; refId: string | null }[]> {
  const rows = await db
    .select({ amount: pointTransactions.amount, reason: pointTransactions.reason, refId: pointTransactions.refId })
    .from(pointTransactions)
    .where(eq(pointTransactions.playerId, playerId))
    .orderBy(asc(pointTransactions.id))
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }))
}

const balanceOf = (playerId: string): Promise<number> => repos.balances.get(playerId)

describe('claimDaily', () => {
  it('pays day 1 through the ledger, advances the streak and announces the claim', async () => {
    const playerId = await seedPlayer()

    const result = await economy.claimDaily(playerId, OCT(1))

    expect(result).toEqual({ ok: true, day: 1, points: 5_000, item: null, items: [], fallbackPoints: 0, balance: 5_000, streak: 1 })
    expect(await ledger(playerId)).toEqual([{ amount: 5_000, reason: 'daily_login', refId: `daily:${playerId}:2026-10-01` }])
    expect(await balanceOf(playerId)).toBe(5_000)

    const [row] = await db.select().from(dailyLogins).where(eq(dailyLogins.playerId, playerId))
    expect(row).toMatchObject({ streak: 1, lastClaimDate: '2026-10-01', month: '2026-10', claimedDays: 1 })

    // Announced only after the commit, so the stats module never counts a login day that rolled back.
    expect(published).toEqual([{ type: 'DAILY_CLAIMED', playerId, day: 1, streak: 1 }])
    expect(balanceCalls).toEqual([{ playerId, balance: 5_000 }])
  })

  it('refuses a second claim the same day and moves nothing', async () => {
    const playerId = await seedPlayer()
    await economy.claimDaily(playerId, OCT(1))
    published = []
    balanceCalls = []

    expect(await economy.claimDaily(playerId, OCT(1) + 6 * HOUR)).toEqual({ ok: false, code: 'ALREADY_CLAIMED' })
    expect(await balanceOf(playerId)).toBe(5_000)
    expect(await ledger(playerId)).toHaveLength(1)
    expect(published).toEqual([])
    expect(balanceCalls).toEqual([])
  })

  it('advances the streak over consecutive days', async () => {
    const playerId = await seedPlayer()
    for (const day of [1, 2, 3]) await economy.claimDaily(playerId, OCT(day))

    expect(await balanceOf(playerId)).toBe(5_000 + 6_000 + 7_000)
    const [row] = await db.select().from(dailyLogins).where(eq(dailyLogins.playerId, playerId))
    expect(row).toMatchObject({ streak: 3, claimedDays: 3 })
  })

  it('restarts at day 1 after a missed day, but keeps counting the month’s claims', async () => {
    const playerId = await seedPlayer()
    await economy.claimDaily(playerId, OCT(1))
    await economy.claimDaily(playerId, OCT(2))

    const result = await economy.claimDaily(playerId, OCT(4))
    expect(result).toMatchObject({ ok: true, day: 1, streak: 1, points: 5_000 })
    const [row] = await db.select().from(dailyLogins).where(eq(dailyLogins.playerId, playerId))
    expect(row).toMatchObject({ streak: 1, claimedDays: 3 })
  })

  it('restarts the streak and the month counter when the month rolls over', async () => {
    const playerId = await seedPlayer()
    await seedStreak(playerId, 5, 31)

    const result = await economy.claimDaily(playerId, Date.UTC(2026, 10, 1, 12, 0))
    expect(result).toMatchObject({ ok: true, day: 1, streak: 1 })
    const [row] = await db.select().from(dailyLogins).where(eq(dailyLogins.playerId, playerId))
    expect(row).toMatchObject({ streak: 1, month: '2026-11', claimedDays: 1, lastClaimDate: '2026-11-01' })
  })

  it('pays days 29–31 what day 29 pays, and caps the streak at 31', async () => {
    const playerId = await seedPlayer()
    await seedStreak(playerId, 28, 28)
    expect(await economy.claimDaily(playerId, OCT(29))).toMatchObject({ day: 29, points: 12_000 })
    expect(await economy.claimDaily(playerId, OCT(30))).toMatchObject({ day: 30, points: 12_000 })
    expect(await economy.claimDaily(playerId, OCT(31))).toMatchObject({ day: 31, streak: 31, points: 12_000 })

    // A stored streak already at the cap does not run past it.
    await seedStreak(playerId, 31, 30)
    await db.update(dailyLogins).set({ lastClaimDate: octKey(30) }).where(eq(dailyLogins.playerId, playerId))
    expect(await economy.claimDaily(playerId, OCT(31))).toMatchObject({ day: 31, streak: 31 })
  })

  describe('the item column', () => {
    const commonsFor = (): string[] => catalog.byRarity('common').map((d) => d.id).sort()

    it('draws one unowned common on day 7, decided by the injected rng', async () => {
      const playerId = await seedPlayer()
      await own(playerId, catalog.defaults())
      await seedStreak(playerId, 6, 6)
      const unowned = commonsFor().filter((id) => !catalog.defaults().includes(id))
      rng = () => 0

      const result = await economy.claimDaily(playerId, OCT(7))

      expect(result).toMatchObject({ ok: true, day: 7, points: 15_000, item: unowned[0], items: [unowned[0]], fallbackPoints: 0 })
      expect((await inv.list(playerId)).find((o) => o.itemId === unowned[0])).toMatchObject({ source: 'daily' })
      expect(await ledger(playerId)).toHaveLength(1)
    })

    it('draws the last of the unowned items when the rng lands at the top of its range', async () => {
      const playerId = await seedPlayer()
      await own(playerId, catalog.defaults())
      await seedStreak(playerId, 6, 6)
      const unowned = commonsFor().filter((id) => !catalog.defaults().includes(id))
      // Exactly 1 would index one past the end; the pick is clamped rather than trusted.
      rng = () => 1

      expect(await economy.claimDaily(playerId, OCT(7))).toMatchObject({ item: unowned[unowned.length - 1] })
    })

    it('credits 10,000 under its own reason when the tier has nothing unowned left', async () => {
      const playerId = await seedPlayer()
      await own(playerId, commonsFor())
      await seedStreak(playerId, 6, 6)

      const result = await economy.claimDaily(playerId, OCT(7))

      expect(result).toMatchObject({ ok: true, points: 15_000, item: null, items: [], fallbackPoints: 10_000, balance: 25_000 })
      const refId = `daily:${playerId}:2026-10-07`
      // Two rows, one claim: the same reference, so reconciliation reads them as one event.
      expect(await ledger(playerId)).toEqual([
        { amount: 15_000, reason: 'daily_login', refId },
        { amount: 10_000, reason: 'daily_item_fallback', refId },
      ])
    })

    it('draws a rare on days 14 and 21', async () => {
      const playerId = await seedPlayer()
      await seedStreak(playerId, 13, 13)
      const first = await economy.claimDaily(playerId, OCT(14))
      expect(first).toMatchObject({ day: 14, points: 20_000, fallbackPoints: 0 })
      expect(catalog.get((first as { item: string }).item)).toMatchObject({ rarity: 'rare' })

      await seedStreak(playerId, 20, 20)
      const second = await economy.claimDaily(playerId, OCT(21))
      expect(second).toMatchObject({ day: 21, points: 25_000 })
      expect(catalog.get((second as { item: string }).item)).toMatchObject({ rarity: 'rare' })
      expect((second as { item: string }).item).not.toBe((first as { item: string }).item)
    })

    it('grants the month badge and the devoted title on day 28, and pays no fallback for a repeat', async () => {
      const playerId = await seedPlayer()
      await seedStreak(playerId, 27, 27)

      expect(await economy.claimDaily(playerId, OCT(28))).toMatchObject({
        day: 28,
        points: 40_000,
        item: 'badge_monthly',
        items: ['badge_monthly', 'title_devoted'],
        fallbackPoints: 0,
      })
      expect((await inv.list(playerId)).map((o) => o.itemId).sort()).toEqual(['badge_monthly', 'title_devoted'])

      // A month later, already owning both: nothing is granted and — unlike the random tiers —
      // nothing is paid in their place.
      await db
        .update(dailyLogins)
        .set({ streak: 27, lastClaimDate: '2026-11-27', month: '2026-11', claimedDays: 27 })
        .where(eq(dailyLogins.playerId, playerId))
      expect(await economy.claimDaily(playerId, Date.UTC(2026, 10, 28, 12, 0))).toMatchObject({
        day: 28,
        points: 40_000,
        item: null,
        items: [],
        fallbackPoints: 0,
      })
      expect(await db.select().from(inventory).where(eq(inventory.playerId, playerId))).toHaveLength(2)
      expect((await ledger(playerId)).every((r) => r.reason === 'daily_login')).toBe(true)
    })
  })

  it('refuses a player who does not exist', async () => {
    await expect(economy.claimDaily('00000000-0000-4000-8000-000000000000', OCT(1))).rejects.toThrow(/unknown player/)
    await expect(economy.claimDaily('not-a-uuid', OCT(1))).rejects.toThrow(/unknown player/)
  })
})

describe('dailyStatus', () => {
  it('describes today’s claim and the month’s calendar', async () => {
    const playerId = await seedPlayer()

    const before = await economy.dailyStatus(playerId, OCT(1))
    expect(before).toMatchObject({ claimable: true, day: 1, streak: 1, reward: 5_000, item: null, nextResetAt: Date.UTC(2026, 9, 2) })
    expect(before.calendar).toHaveLength(31)
    expect(before.calendar.filter((d) => d.item !== null).map((d) => d.day)).toEqual([7, 14, 21, 28])
    expect(before.calendar.reduce((sum, d) => sum + d.points, 0)).toBe(376_000)

    await economy.claimDaily(playerId, OCT(1))
    expect(await economy.dailyStatus(playerId, OCT(1))).toMatchObject({ claimable: false, day: 1, streak: 1 })
    expect(await economy.dailyStatus(playerId, OCT(2))).toMatchObject({ claimable: true, day: 2, streak: 2, reward: 6_000 })
  })

  it('marks the item day it is about to reach', async () => {
    const playerId = await seedPlayer()
    await seedStreak(playerId, 6, 6)
    expect(await economy.dailyStatus(playerId, OCT(7))).toMatchObject({ claimable: true, day: 7, item: 'common' })
  })

  it('answers for a player with no row at all rather than throwing', async () => {
    expect(await economy.dailyStatus('not-a-uuid', OCT(1))).toMatchObject({ claimable: true, day: 1, streak: 1 })
  })
})

describe('relief', () => {
  const NOW = Date.UTC(2026, 9, 4, 12, 0)

  it('refuses a player who still has points', async () => {
    const playerId = await seedPlayer(ECONOMY.reliefThreshold)

    expect(await economy.reliefStatus(playerId, NOW)).toEqual({
      eligible: false,
      reason: 'balance',
      retryAt: null,
      threshold: ECONOMY.reliefThreshold,
      target: ECONOMY.reliefTarget,
    })
    expect(await economy.claimRelief(playerId, NOW)).toEqual({ ok: false, reason: 'balance', retryAt: null })
    expect(await ledger(playerId)).toEqual([])
  })

  it('tops a broke player up to the target and stamps the cooldown in the same transaction', async () => {
    const playerId = await seedPlayer(1_200)
    expect(await economy.reliefStatus(playerId, NOW)).toMatchObject({ eligible: true, reason: null })

    expect(await economy.claimRelief(playerId, NOW)).toEqual({ ok: true, amount: 3_800, balance: ECONOMY.reliefTarget })
    expect(await balanceOf(playerId)).toBe(ECONOMY.reliefTarget)
    expect(await ledger(playerId)).toEqual([{ amount: 3_800, reason: 'relief', refId: `relief:${playerId}:${NOW}` }])
    const [row] = await db.select().from(players).where(eq(players.id, playerId))
    expect(row!.lastReliefAt?.getTime()).toBe(NOW)
    expect(balanceCalls).toEqual([{ playerId, balance: ECONOMY.reliefTarget }])
  })

  it('holds the player to a 24-hour cooldown and says when it lifts', async () => {
    const playerId = await seedPlayer(0)
    await economy.claimRelief(playerId, NOW)
    // Spend it all again: only the cooldown should be standing between them and a second top-up.
    await db.update(players).set({ balance: 0 }).where(eq(players.id, playerId))

    const retryAt = NOW + ECONOMY.reliefCooldownHours * HOUR
    expect(await economy.reliefStatus(playerId, NOW + HOUR)).toMatchObject({ eligible: false, reason: 'cooldown', retryAt })
    expect(await economy.claimRelief(playerId, NOW + HOUR)).toEqual({ ok: false, reason: 'cooldown', retryAt })
    expect(await ledger(playerId)).toHaveLength(1)

    expect(await economy.claimRelief(playerId, retryAt)).toMatchObject({ ok: true, amount: ECONOMY.reliefTarget })
    expect(await ledger(playerId)).toHaveLength(2)
  })

  it('credits exactly once when the claim is repeated immediately', async () => {
    const playerId = await seedPlayer(0)

    // The eligibility read happens on the `FOR UPDATE` row inside the transaction, so the second
    // call reads the cooldown the first one wrote rather than the state it started from.
    const first = await economy.claimRelief(playerId, NOW)
    const second = await economy.claimRelief(playerId, NOW)

    expect(first).toMatchObject({ ok: true })
    expect(second).toMatchObject({ ok: false })
    expect(await ledger(playerId)).toHaveLength(1)
    expect(await balanceOf(playerId)).toBe(ECONOMY.reliefTarget)
  })

  // PGlite is a single connection: two overlapping transactions on it deadlock rather than
  // serialise, so the concurrent form of the test above only means something against a real server.
  const concurrent = process.env.TEST_DATABASE_URL === undefined ? it.skip : it
  concurrent('credits exactly once when two claims race (real Postgres only)', async () => {
    const playerId = await seedPlayer(0)

    const results = await Promise.all([economy.claimRelief(playerId, NOW), economy.claimRelief(playerId, NOW)])

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(await ledger(playerId)).toHaveLength(1)
    expect(await balanceOf(playerId)).toBe(ECONOMY.reliefTarget)
  })

  it('refuses a player who does not exist', async () => {
    await expect(economy.claimRelief('00000000-0000-4000-8000-000000000000', NOW)).rejects.toThrow(/unknown player/)
    expect(await economy.reliefStatus('00000000-0000-4000-8000-000000000000', NOW)).toMatchObject({ eligible: false, reason: 'balance' })
  })
})
