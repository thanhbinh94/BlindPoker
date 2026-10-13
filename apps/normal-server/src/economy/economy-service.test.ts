import { ECONOMY } from '@bp/core'
import { silentLogger } from '@bp/server-kit'
import { asc, eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { dailyLogins, inventory, items, players, pointTransactions, users } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import type { AppEvent, AppEventBus } from '../events.js'
import { createEventBus } from '../events.js'
import type { InventoryService } from '../inventory/inventory-service.js'
import { createInventoryService } from '../inventory/inventory-service.js'
import type { ItemCatalog } from '../inventory/items.js'
import { loadItemCatalog } from '../inventory/items.js'
import { DAILY_DRAW_SLOTS } from '../inventory/slots.js'
import { loadAchievements } from '../achievements/definitions.js'
import type { NormalRepositories } from '../repos/index.js'
import { createRepositories } from '../repos/index.js'
import { parseDailyGifts, type DailyGiftSchedule } from './daily-gifts.js'
import type { EconomyService } from './economy-service.js'
import { createEconomyService } from './economy-service.js'

let test: TestDb
let db: AppDb
let repos: NormalRepositories
let inv: InventoryService
let catalog: ItemCatalog
let bus: AppEventBus
let economy: EconomyService
/** Every id the random tiers must not draw: the schedule's named gifts plus every achievement's item reward. */
let reserved: Set<string>
let gifts: DailyGiftSchedule

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
  catalog = loadItemCatalog()
  // Written out here rather than read from `data/daily-gifts.json`, so an operator's edit to the shipped schedule can
  // never move these tests: today's default, and one month whose day 28 adds a third gift (spec 2026-10-12).
  gifts = parseDailyGifts(
    {
      default: { '7': { draw: 'common' }, '14': { draw: 'rare' }, '21': { draw: 'rare' }, '28': { fixed: ['badge_monthly', 'title_devoted'] } },
      months: { '2026-11': { '28': { fixed: ['badge_monthly', 'title_devoted', 'head_tophat01'] } } },
    },
    catalog,
    'economy-service.test',
  )
  // `freeIds` wired the way `app.ts` wires it: a free colour must never surface as a drawable prize.
  inv = createInventoryService(db, undefined, catalog.freeIds())
  await catalog.seed(db)
  // Wired the way Task 6 wires it: the reward ids come from the loaded definitions, so
  // `achievements.json` stays the only place one is written down.
  const rewardItemIds = loadAchievements(catalog)
    .map((d) => d.reward.itemId)
    .filter((id): id is string => id !== undefined)
  reserved = new Set([...gifts.fixedItemIds(), ...rewardItemIds])
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
    reservedItemIds: rewardItemIds,
    gifts,
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

/**
 * What a claim actually *granted* this player — `inv.list` now also reports every free item
 * (design §3.2), which was never a row a draw wrote, so the "what did this draw give me" checks
 * below read this instead of `inv.list` directly.
 */
async function grantedOf(playerId: string): Promise<string[]> {
  return (await inv.list(playerId)).filter((o) => o.source !== 'free').map((o) => o.itemId)
}

/**
 * The items a random draw of `rarity` is actually allowed to reach — `head`/`face`/`aura`/`frame`/
 * `hairColor`/`eyeColor`, minus whatever is reserved, minus every `free` item (design §3.2: a free
 * item is never a prize because nobody has to earn it).
 */
function drawable(rarity: 'common' | 'rare'): string[] {
  return catalog
    .byRarity(rarity)
    .filter((d) => (DAILY_DRAW_SLOTS as readonly string[]).includes(d.slot) && !reserved.has(d.id) && !d.free)
    .map((d) => d.id)
    .sort()
}

/** The rest of that rarity — what must stay unowned however many times the tier is drawn. */
function undrawable(rarity: 'common' | 'rare'): string[] {
  const pool = new Set(drawable(rarity))
  return catalog
    .byRarity(rarity)
    .map((d) => d.id)
    .filter((id) => !pool.has(id))
    .sort()
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
    const unownedCommons = (): string[] => drawable('common').filter((id) => !catalog.defaults().includes(id))

    it('draws one unowned common on day 7, decided by the injected rng', async () => {
      const playerId = await seedPlayer()
      await own(playerId, catalog.defaults())
      await seedStreak(playerId, 6, 6)
      const unowned = unownedCommons()
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
      const unowned = unownedCommons()
      // Exactly 1 would index one past the end; the pick is clamped rather than trusted.
      rng = () => 1

      expect(await economy.claimDaily(playerId, OCT(7))).toMatchObject({ item: unowned[unowned.length - 1] })
    })

    it('credits 10,000 under its own reason when the tier has nothing unowned left', async () => {
      const playerId = await seedPlayer()
      await own(playerId, drawable('common'))
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
      expect((await grantedOf(playerId)).sort()).toEqual(['badge_monthly', 'title_devoted'])

      // A month later — December, whose day 28 is the default's — already owning both: nothing is granted and —
      // unlike the random tiers — nothing is paid in their place.
      await db
        .update(dailyLogins)
        .set({ streak: 27, lastClaimDate: '2026-12-27', month: '2026-12', claimedDays: 27 })
        .where(eq(dailyLogins.playerId, playerId))
      expect(await economy.claimDaily(playerId, Date.UTC(2026, 11, 28, 12, 0))).toMatchObject({
        day: 28,
        points: 40_000,
        item: null,
        items: [],
        fallbackPoints: 0,
      })
      expect(await db.select().from(inventory).where(eq(inventory.playerId, playerId))).toHaveLength(2)
      expect((await ledger(playerId)).every((r) => r.reason === 'daily_login')).toBe(true)
    })

    it('grants the third gift of 11/2026 on day 28, and only the pair on day 28 of 10/2026', async () => {
      const october = await seedPlayer()
      await seedStreak(october, 27, 27)
      expect(await economy.claimDaily(october, OCT(28))).toMatchObject({ day: 28, items: ['badge_monthly', 'title_devoted'], fallbackPoints: 0 })

      // A player whose first full streak is November's gets all three…
      const november = await seedPlayer()
      await db
        .update(dailyLogins)
        .set({ streak: 27, lastClaimDate: '2026-11-27', month: '2026-11', claimedDays: 27 })
        .where(eq(dailyLogins.playerId, november))
      expect(await economy.claimDaily(november, Date.UTC(2026, 10, 28, 12, 0))).toMatchObject({
        day: 28,
        points: 40_000,
        item: 'badge_monthly',
        items: ['badge_monthly', 'title_devoted', 'head_tophat01'],
        fallbackPoints: 0,
      })
      expect((await grantedOf(november)).sort()).toEqual(['badge_monthly', 'head_tophat01', 'title_devoted'])

      // …and October's player, who has the pair already, gets the top hat alone, with nothing paid for the pair.
      await db
        .update(dailyLogins)
        .set({ streak: 27, lastClaimDate: '2026-11-27', month: '2026-11', claimedDays: 27 })
        .where(eq(dailyLogins.playerId, october))
      expect(await economy.claimDaily(october, Date.UTC(2026, 10, 28, 12, 0))).toMatchObject({ items: ['head_tophat01'], fallbackPoints: 0 })
      expect((await ledger(october)).every((r) => r.reason === 'daily_login')).toBe(true)
    })
  })

  describe('what a random tier may draw', () => {
    /** Rewinds the check-in to the eve of `day` so the tier can be drawn again. */
    async function rewindTo(playerId: string, day: number): Promise<void> {
      await seedStreak(playerId, day - 1, day - 1)
    }

    it('hands over the one drawable common left, and leaves the titles and badges alone', async () => {
      const playerId = await seedPlayer()
      const pool = drawable('common')
      const last = pool[pool.length - 1]!
      await own(playerId, pool.slice(0, -1))
      await rewindTo(playerId, 7)

      expect(await economy.claimDaily(playerId, OCT(7))).toMatchObject({ day: 7, item: last, fallbackPoints: 0 })

      const owned = new Set(await grantedOf(playerId))
      for (const id of undrawable('common')) expect(owned.has(id), id).toBe(false)
      // The commons outside `DAILY_DRAW_SLOTS` (outfit/title/badge) are always undrawable…
      for (const id of ['badge_bronze', 'badge_silver', 'outfit_casual01', 'title_regular', 'title_rookie']) {
        expect(undrawable('common'), id).toContain(id)
      }
      // …and so is every free common, colour or otherwise, whatever slot it is in (design §3.2, §3.4).
      for (const id of catalog.all().filter((d) => d.free).map((d) => d.id)) expect(undrawable('common'), id).toContain(id)
    })

    it('includes rare colours and rare head variants in the rare pool, and excludes every free id from the common pool (design §3.4)', () => {
      expect(drawable('rare')).toContain('haircolor_pink01')
      expect(drawable('rare')).toContain('head_beret_blue01')
      for (const id of catalog.freeIds()) expect(drawable('common')).not.toContain(id)
    })

    it('never draws a hairstyle or a skin colour', () => {
      // Not a prize (spec §4.2): neither slot is in the allow-list, whatever rarity a future one has.
      expect(DAILY_DRAW_SLOTS).not.toContain('hairStyle')
      expect(DAILY_DRAW_SLOTS).not.toContain('skinColor')
      // Not vacuous: the catalogue does have both, eight hairstyles and six skin colours.
      const looks = catalog.all().filter((d) => d.slot === 'hairStyle' || d.slot === 'skinColor').map((d) => d.id)
      expect(looks).toHaveLength(14)
      for (const rarity of ['common', 'rare'] as const) {
        for (const id of looks) expect(drawable(rarity), `${rarity} ${id}`).not.toContain(id)
      }
      for (const id of looks) expect(undrawable('common'), id).toContain(id)
    })

    it('never draws an item the catalogue has withdrawn, even though its row stays in `items` (bug 6)', async () => {
      // A withdrawn item keeps its `items` row for the inventory foreign key — the hood did, after it left
      // items.json. Seed one such row as a common head item: once every drawable common is owned, the tier
      // must pay the fallback rather than hand it over.
      await db.insert(items).values({ id: 'head_withdrawn_test01', slot: 'head', rarity: 'common', nameKey: 'items.head_withdrawn_test01', assetKey: 'head/head_withdrawn_test01', isDefault: false }).onConflictDoNothing()
      const playerId = await seedPlayer()
      await own(playerId, drawable('common'))
      await rewindTo(playerId, 7)

      const dry = await economy.claimDaily(playerId, OCT(7))
      expect(dry).toMatchObject({ day: 7, item: null, items: [], fallbackPoints: 10_000 })
      expect(await grantedOf(playerId)).not.toContain('head_withdrawn_test01')
    })
    it('exhausts the rare tier without ever handing out a reserved id, then pays the fallback', async () => {
      const playerId = await seedPlayer()
      const pool = drawable('rare')
      // A deterministic sweep across the pool rather than a fixed index, so the exclusion is proved
      // for every position a draw can land on — and never `Math.random`.
      let tick = 0
      rng = () => {
        tick += 1
        return ((tick * 7) % 11) / 11
      }

      const drawn: string[] = []
      for (let i = 0; i < pool.length; i += 1) {
        await rewindTo(playerId, 14)
        const result = await economy.claimDaily(playerId, OCT(14))
        expect(result).toMatchObject({ day: 14, fallbackPoints: 0 })
        drawn.push((result as { item: string }).item)
      }

      expect([...drawn].sort()).toEqual(pool)
      const owned = new Set(await grantedOf(playerId))
      for (const id of undrawable('rare')) expect(owned.has(id), id).toBe(false)
      // The two the schedule and the achievements have already promised are among them.
      expect(owned.has('badge_monthly')).toBe(false)
      expect(owned.has('title_devoted')).toBe(false)

      // Nothing drawable left: the tier pays 10,000 rather than reaching for a reserved item.
      await rewindTo(playerId, 21)
      const dry = await economy.claimDaily(playerId, OCT(21))
      expect(dry).toMatchObject({ day: 21, item: null, items: [], fallbackPoints: 10_000 })
      expect((await ledger(playerId)).at(-1)).toMatchObject({ amount: 10_000, reason: 'daily_item_fallback' })

      // And day 28 can still keep its own promise, because nothing took it first.
      await rewindTo(playerId, 28)
      expect(await economy.claimDaily(playerId, OCT(28))).toMatchObject({ items: ['badge_monthly', 'title_devoted'] })
    })

    it('never draws an id the caller reserved, even one in a drawable slot', async () => {
      const playerId = await seedPlayer()
      // `aura_ice01` is a rare aura — drawable in every respect but this one.
      const withReservation = createEconomyService({
        db,
        repos,
        inventory: inv,
        catalog,
        bus,
        timezone: 'UTC',
        onBalanceChanged: () => {},
        rng: () => 0,
        reservedItemIds: ['aura_ice01'],
        gifts,
      })
      const pool = drawable('rare').filter((id) => id !== 'aura_ice01')

      for (let i = 0; i < pool.length; i += 1) {
        await seedStreak(playerId, 13, 13)
        await withReservation.claimDaily(playerId, OCT(14))
      }

      const owned = new Set(await grantedOf(playerId))
      expect(owned.has('aura_ice01')).toBe(false)
      expect([...owned].sort()).toEqual(pool)

      await seedStreak(playerId, 13, 13)
      expect(await withReservation.claimDaily(playerId, OCT(14))).toMatchObject({ item: null, fallbackPoints: 10_000 })
    })

    it('never draws an item a later month schedules as a gift, in a month the schedule does not name (Q8)', async () => {
      const playerId = await seedPlayer()
      // `aura_ice01` is a rare aura: drawable in every respect, and named by January 2027's day 28 alone. No
      // `reservedItemIds` here, so the schedule is the only thing keeping it out of the pool.
      const scheduled = parseDailyGifts(
        {
          default: { '7': { draw: 'common' }, '14': { draw: 'rare' }, '21': { draw: 'rare' }, '28': { fixed: ['badge_monthly', 'title_devoted'] } },
          months: { '2027-01': { '28': { fixed: ['aura_ice01'] } } },
        },
        catalog,
        'economy-service.test (later month)',
      )
      const service = createEconomyService({
        db,
        repos,
        inventory: inv,
        catalog,
        bus,
        timezone: 'UTC',
        onBalanceChanged: () => {},
        rng: () => 0,
        gifts: scheduled,
      })
      const pool = catalog
        .byRarity('rare')
        .filter((d) => (DAILY_DRAW_SLOTS as readonly string[]).includes(d.slot) && !d.free && d.id !== 'aura_ice01')
        .map((d) => d.id)
        .sort()
      expect(pool.length).toBeGreaterThan(0)

      // Day 14 of October, a month the schedule does not name: a sweep of the whole pool hands out each of its items…
      for (let i = 0; i < pool.length; i += 1) {
        await seedStreak(playerId, 13, 13)
        await service.claimDaily(playerId, OCT(14))
      }
      const owned = new Set(await grantedOf(playerId))
      expect(owned.has('aura_ice01')).toBe(false)
      expect([...owned].sort()).toEqual(pool)

      // …and then pays the fallback rather than reach for the one item January has promised.
      await seedStreak(playerId, 13, 13)
      expect(await service.claimDaily(playerId, OCT(14))).toMatchObject({ item: null, items: [], fallbackPoints: 10_000 })
    })
  })

  describe('the configured timezone', () => {
    it('draws the day boundary where ECONOMY_TIMEZONE says, not in UTC', async () => {
      const playerId = await seedPlayer()
      const hcm = createEconomyService({
        db,
        repos,
        inventory: inv,
        catalog,
        bus,
        timezone: 'Asia/Ho_Chi_Minh',
        onBalanceChanged: () => {},
        rng: () => 0,
        gifts,
      })

      // 17:30 UTC on the 4th is already 00:30 on the 5th in Ho Chi Minh City.
      const at = Date.UTC(2026, 9, 4, 17, 30)
      expect(await hcm.claimDaily(playerId, at)).toMatchObject({ ok: true, day: 1 })

      // The day key reaches the ledger as the claim's reference and the row as its claim date, so a
      // wrong zone would silently shift the reset for every player.
      expect(await ledger(playerId)).toEqual([{ amount: 5_000, reason: 'daily_login', refId: `daily:${playerId}:2026-10-05` }])
      const [row] = await db.select().from(dailyLogins).where(eq(dailyLogins.playerId, playerId))
      expect(row).toMatchObject({ lastClaimDate: '2026-10-05', month: '2026-10' })

      // Half an hour later is still the 5th there — and still the 4th in the UTC-configured service,
      // which would let the same player claim again.
      const later = Date.UTC(2026, 9, 4, 18, 0)
      expect(await hcm.claimDaily(playerId, later)).toEqual({ ok: false, code: 'ALREADY_CLAIMED' })
      expect(await hcm.dailyStatus(playerId, later)).toMatchObject({ claimable: false })
      expect(await economy.dailyStatus(playerId, later)).toMatchObject({ claimable: true })
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

    // A copy per call: a caller decorating one response must not rewrite every later one.
    const again = await economy.dailyStatus(playerId, OCT(1))
    expect(again.calendar).not.toBe(before.calendar)
    expect(again.calendar[6]).not.toBe(before.calendar[6])
    before.calendar[6]!.points = -1
    expect((await economy.dailyStatus(playerId, OCT(1))).calendar[6]!.points).toBe(15_000)

    await economy.claimDaily(playerId, OCT(1))
    expect(await economy.dailyStatus(playerId, OCT(1))).toMatchObject({ claimable: false, day: 1, streak: 1 })
    expect(await economy.dailyStatus(playerId, OCT(2))).toMatchObject({ claimable: true, day: 2, streak: 2, reward: 6_000 })
  })

  it('describes the calendar of the month it is asked in: October names the pair on day 28, November adds the top hat', async () => {
    const playerId = await seedPlayer()
    const october = await economy.dailyStatus(playerId, OCT(5))
    expect(october.month).toBe('2026-10')
    expect(october.calendar[27]).toEqual({ day: 28, points: 40_000, item: 'badge_monthly', items: ['badge_monthly', 'title_devoted'] })
    expect(october.calendar[6]).toEqual({ day: 7, points: 15_000, item: 'common', items: [] })

    const november = await economy.dailyStatus(playerId, Date.UTC(2026, 10, 5, 12, 0))
    expect(november.month).toBe('2026-11')
    expect(november.calendar[27]).toMatchObject({ item: 'badge_monthly', items: ['badge_monthly', 'title_devoted', 'head_tophat01'] })
    // The month turns at the economy timezone's midnight (UTC in this suite), as the streak does.
    expect((await economy.dailyStatus(playerId, Date.UTC(2026, 9, 31, 23, 59))).month).toBe('2026-10')
    expect((await economy.dailyStatus(playerId, Date.UTC(2026, 10, 1, 0, 0))).month).toBe('2026-11')

    // …and where ECONOMY_TIMEZONE says: 23:59 on 31/10 in Ho Chi Minh City is 16:59 UTC, 00:00 on 01/11 is 17:00 UTC.
    const hcm = createEconomyService({ db, repos, inventory: inv, catalog, bus, timezone: 'Asia/Ho_Chi_Minh', onBalanceChanged: () => {}, gifts })
    expect((await hcm.dailyStatus(playerId, Date.UTC(2026, 9, 31, 16, 59))).month).toBe('2026-10')
    expect((await hcm.dailyStatus(playerId, Date.UTC(2026, 9, 31, 17, 0))).month).toBe('2026-11')
    expect(hcm.dailyGiftNotices(Date.UTC(2026, 10, 30, 16, 59)).find((n) => n.itemId === 'head_tophat01')).toMatchObject({ month: '2026-11' })
    expect(hcm.dailyGiftNotices(Date.UTC(2026, 10, 30, 17, 0)).map((n) => n.itemId)).not.toContain('head_tophat01')
  })

  it('tells the wardrobe which named gifts are still to come, from the month it is asked in', () => {
    expect(economy.dailyGiftNotices(OCT(12))).toEqual([
      { itemId: 'badge_monthly', day: 28, month: null },
      { itemId: 'title_devoted', day: 28, month: null },
      { itemId: 'head_tophat01', day: 28, month: '2026-11' },
    ])
    // Once November is over, no month to come promises the top hat.
    expect(economy.dailyGiftNotices(Date.UTC(2026, 11, 1, 12, 0)).map((n) => n.itemId)).toEqual(['badge_monthly', 'title_devoted'])
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
