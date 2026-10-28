import { silentLogger } from '@bp/server-kit'
import { asc, eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadAchievements, type AchievementDef } from '../achievements/definitions.js'
import { rowsOf, type AppDb, type AppTx } from '../db/client.js'
import { giftMonths, inventory, items, ledgerKeys, players, pointTransactions, shopConfig, shopFeatured, shopPrices, users } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import { readDailyGiftsRaw } from '../economy/daily-gifts.js'
import { createGiftScheduleStore, type GiftScheduleStore } from '../economy/gift-schedule-store.js'
import { createEventBus } from '../events.js'
import { createInventoryService, type InventoryService } from '../inventory/inventory-service.js'
import { loadItemCatalog, type ItemCatalog } from '../inventory/items.js'
import { createRepositories, type NormalRepositories } from '../repos/index.js'
import { createReputationService, type ReputationService } from '../reputation/reputation-service.js'
import { autoFeatured, createShopService, isoWeekKey, weekStartMs, type ShopService } from './shop-service.js'

let test: TestDb
let db: AppDb
let repos: NormalRepositories
let catalog: ItemCatalog
let defs: AchievementDef[]
let inv: InventoryService
let gifts: GiftScheduleStore
let reputation: ReputationService
let shop: ShopService
let balanceCalls: { playerId: string; balance: number }[] = []

/** Noon UTC on a day of October 2026: the shipped schedule's 2026-11 top hat is still a month ahead. */
const OCT = Date.UTC(2026, 9, 22, 12)
const DEC = Date.UTC(2026, 11, 5, 12)
const ADMIN = '00000000-0000-4000-8000-0000000000aa'
const START = 100_000

function makeShop(over: { inventory?: InventoryService; repos?: NormalRepositories } = {}): ShopService {
  return createShopService({
    db,
    repos: over.repos ?? repos,
    inventory: over.inventory ?? inv,
    catalog,
    defs,
    gifts,
    reputation,
    timezone: 'UTC',
    onBalanceChanged: (playerId, balance) => balanceCalls.push({ playerId, balance }),
    now: () => OCT,
  })
}

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
  repos = createRepositories(db)
  catalog = loadItemCatalog()
  await catalog.seed(db)
  defs = loadAchievements(catalog)
  inv = createInventoryService(db, undefined, catalog.freeIds())
  gifts = await createGiftScheduleStore({ db, catalog, defaults: readDailyGiftsRaw(), timezone: 'UTC', log: silentLogger, now: () => OCT })
  reputation = createReputationService({ db, bus: createEventBus(silentLogger), notify: () => {}, log: silentLogger })
  shop = makeShop()
  await shop.seedPrices()
  await shop.seedConfig()
})
afterAll(async () => {
  await test.close()
})
beforeEach(() => {
  balanceCalls = []
})
afterEach(async () => {
  await db.execute(sql`truncate table inventory, point_transactions, ledger_keys, players, users restart identity cascade`)
  // The configuration tables are not truncated by the harness: tests that edit them put the seeds back.
  await db.delete(shopPrices)
  await db.delete(shopFeatured)
  await db.delete(shopConfig)
  await db.delete(giftMonths)
  await gifts.reload()
  await shop.seedPrices()
  await shop.seedConfig()
})

let seq = 0
async function seedPlayer(balance = START, rank = 1): Promise<string> {
  seq += 1
  const name = `s${seq}`
  const [user] = await db.insert(users).values({ email: `${name}@example.com`, passwordHash: 'argon2' }).returning({ id: users.id })
  const id = user!.id
  await db.insert(players).values({ id, displayName: name, nameKey: name, balance, rank })
  return id
}

async function balanceOf(playerId: string): Promise<number> {
  const [row] = await db.select({ balance: players.balance }).from(players).where(eq(players.id, playerId))
  return row!.balance
}

async function ledgerOf(playerId: string): Promise<{ amount: number; reason: string; refId: string | null }[]> {
  const rows = await db.select({ amount: pointTransactions.amount, reason: pointTransactions.reason, refId: pointTransactions.refId }).from(pointTransactions).where(eq(pointTransactions.playerId, playerId)).orderBy(asc(pointTransactions.id))
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }))
}

async function sinkRows(): Promise<{ amount: number; reason: string; kind: string | null; refId: string | null }[]> {
  const rows = await db.select({ amount: pointTransactions.amount, reason: pointTransactions.reason, kind: pointTransactions.kind, refId: pointTransactions.refId }).from(pointTransactions).where(sql`${pointTransactions.playerId} is null`).orderBy(asc(pointTransactions.id))
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }))
}

async function itemRows(playerId: string): Promise<{ itemId: string; source: string; ref: string | null }[]> {
  return db.select({ itemId: inventory.itemId, source: inventory.source, ref: inventory.ref }).from(inventory).where(eq(inventory.playerId, playerId)).orderBy(asc(inventory.itemId))
}

const entryOf = async (playerId: string, itemId: string, now = OCT) => (await shop.view(playerId, now)).entries.find((e) => e.itemId === itemId)

describe('ShopService', () => {
  it('seeds a price per catalogue item once', async () => {
    await db.delete(shopPrices)
    expect(await shop.seedPrices()).toBe(130)
    const prices = new Map((await shop.prices()).map((p) => [p.itemId, p]))
    expect(prices.size).toBe(130)
    // BP-41: the three chaos titles are achievements' rewards, so they are seeded off sale.
    for (const id of ['title_god', 'title_demigod', 'title_godslayer']) expect(prices.get(id), id).toMatchObject({ enabled: false })
    expect(prices.get('outfit_casual01')).toMatchObject({ enabled: false })
    expect(prices.get('outfit_casual_red01')).toMatchObject({ enabled: false })
    expect(prices.get('outfit_champion01')).toMatchObject({ enabled: false })
    expect(prices.get('outfit_tuxedo01')).toEqual({ itemId: 'outfit_tuxedo01', pricePoints: 150_000, minRank: 4, enabled: true, salePrice: null })
    expect(prices.get('head_beanie01')).toEqual({ itemId: 'head_beanie01', pricePoints: 10_000, minRank: 1, enabled: true, salePrice: null })
    expect(prices.get('outfit_dealer01')).toMatchObject({ pricePoints: 30_000, minRank: 3, enabled: true })
    // BP-33: a sold piece takes its rarity's seed; a piece an achievement gives is off sale.
    expect(prices.get('outfit_bomber_neon01')).toEqual({ itemId: 'outfit_bomber_neon01', pricePoints: 30_000, minRank: 3, enabled: true, salePrice: null })
    expect(prices.get('face_bandaid01')).toEqual({ itemId: 'face_bandaid01', pricePoints: 10_000, minRank: 1, enabled: true, salePrice: null })
    for (const id of ['outfit_denim01', 'outfit_trench01', 'outfit_brocade_red01', 'head_fedora01', 'face_monocle_gold01']) expect(prices.get(id), id).toMatchObject({ enabled: false })
    // BP-35: an epic piece on sale takes the epic seed; its five achievement pieces (two of them epic) are off sale.
    expect(prices.get('outfit_vampire01')).toEqual({ itemId: 'outfit_vampire01', pricePoints: 150_000, minRank: 4, enabled: true, salePrice: null })
    expect(prices.get('head_witch_hat01')).toEqual({ itemId: 'head_witch_hat01', pricePoints: 30_000, minRank: 3, enabled: true, salePrice: null })
    expect(prices.get('face_red_nose01')).toEqual({ itemId: 'face_red_nose01', pricePoints: 10_000, minRank: 1, enabled: true, salePrice: null })
    for (const id of ['outfit_santa01', 'outfit_sailor01', 'head_pumpkin01', 'head_reindeer01', 'head_crab01']) expect(prices.get(id), id).toMatchObject({ enabled: false })
    // A gift of the schedule is not frozen into the seed: the live lock covers it (B1).
    expect(prices.get('head_tophat01')).toMatchObject({ enabled: true })
    expect(await shop.seedPrices()).toBe(0)
  })

  it('locks follow the live gift schedule', async () => {
    const me = await seedPlayer()
    expect(await entryOf(me, 'head_tophat01')).toMatchObject({ lock: { kind: 'gift_month', month: '2026-11' }, purchasable: false })
    expect(await entryOf(me, 'head_tophat01', DEC)).toMatchObject({ lock: null, purchasable: true, price: 150_000, minRank: 4, rarity: 'epic', slot: 'head' })
    expect(await entryOf(me, 'badge_monthly')).toMatchObject({ lock: { kind: 'gift_default' }, purchasable: false })
    expect(await entryOf(me, 'outfit_casual01')).toMatchObject({ lock: { kind: 'default' } })
    expect(await entryOf(me, 'outfit_casual_red01')).toMatchObject({ lock: { kind: 'free' }, owned: true })
    expect(await entryOf(me, 'outfit_champion01')).toMatchObject({ lock: { kind: 'achievement', achievementId: 'holdem_wins_500' } })
    // `title_devoted` is both an achievement's reward and a default gift: the achievement wins.
    expect(await entryOf(me, 'title_devoted')).toMatchObject({ lock: { kind: 'achievement', achievementId: 'login_streak_28' } })

    expect(await entryOf(me, 'outfit_tuxedo01')).toMatchObject({ lock: null, purchasable: true })
    await db.insert(giftMonths).values({ month: '2027-05', days: { '28': { fixed: ['badge_monthly', 'title_devoted', 'outfit_tuxedo01'] } } })
    await gifts.reload()
    expect(await entryOf(me, 'outfit_tuxedo01')).toMatchObject({ lock: { kind: 'gift_month', month: '2027-05' }, purchasable: false })
    const r = await shop.buy(me, 'outfit_tuxedo01', 'p-gift', OCT)
    expect(r).toEqual({ ok: false, code: 'SHOP_DISABLED' })
  })

  it('shows an unpriced and a disabled item locked, and the player\'s standing', async () => {
    const me = await seedPlayer(42_000, 3)
    await db.delete(shopPrices).where(eq(shopPrices.itemId, 'head_beanie01'))
    await db.update(shopPrices).set({ enabled: false }).where(eq(shopPrices.itemId, 'outfit_dealer01'))
    const view = await shop.view(me, OCT)
    expect(view.entries).toHaveLength(130)
    // BP-41: a chaos title is an achievement's, never for sale.
    expect(view.entries.find((e) => e.itemId === 'title_godslayer')).toMatchObject({ lock: { kind: 'achievement', achievementId: 'chaos_godslayer' }, purchasable: false })
    expect(view.entries.find((e) => e.itemId === 'head_beanie01')).toMatchObject({ lock: { kind: 'unpriced' }, purchasable: false })
    expect(view.entries.find((e) => e.itemId === 'outfit_dealer01')).toMatchObject({ lock: { kind: 'disabled' }, purchasable: false })
    expect(view.me).toMatchObject({ balance: 42_000, reputation: 0, rank: 3 })
    expect(view.me.ranks).toHaveLength(5)
    expect(view.weekKey).toBe('2026-W43')
    expect(view.featuredSource).toBe('auto')
    expect(view.featured).toHaveLength(6)
    expect(await shop.buy(me, 'head_beanie01', 'p-unpriced', OCT)).toEqual({ ok: false, code: 'SHOP_DISABLED' })
    expect(await shop.buy(me, 'outfit_dealer01', 'p-disabled', OCT)).toEqual({ ok: false, code: 'SHOP_DISABLED' })
  })

  it('buys once for a repeated purchaseId', async () => {
    const me = await seedPlayer()
    const first = await shop.buy(me, 'head_beanie01', 'retry-1', OCT)
    expect(first).toEqual({ ok: true, balance: START - 10_000, itemId: 'head_beanie01', repeated: false })
    const second = await shop.buy(me, 'head_beanie01', 'retry-1', OCT)
    expect(second).toEqual({ ok: true, balance: START - 10_000, itemId: 'head_beanie01', repeated: true })
    expect(await ledgerOf(me)).toEqual([{ amount: -10_000, reason: 'shop_purchase', refId: 'head_beanie01' }])
    expect(await sinkRows()).toEqual([{ amount: 10_000, reason: 'shop', kind: 'shop', refId: 'head_beanie01' }])
    expect(await itemRows(me)).toEqual([{ itemId: 'head_beanie01', source: 'shop', ref: `shop:${me}:retry-1` }])
    expect(balanceCalls).toEqual([{ playerId: me, balance: START - 10_000 }])
    expect(await entryOf(me, 'head_beanie01')).toMatchObject({ owned: true, purchasable: false, lock: null })
  })

  it('a repeated purchaseId after a simulated ledger_keys prune still returns repeated and charges once', async () => {
    const me = await seedPlayer()
    expect(await shop.buy(me, 'head_beanie01', 'retry-2', OCT)).toMatchObject({ ok: true, repeated: false })
    // `pruneLedgerKeys` empties the table at every boot: the key alone is no guard.
    await db.delete(ledgerKeys)
    expect(await shop.buy(me, 'head_beanie01', 'retry-2', OCT)).toEqual({ ok: true, balance: START - 10_000, itemId: 'head_beanie01', repeated: true })
    expect(await balanceOf(me)).toBe(START - 10_000)
    expect(await ledgerOf(me)).toHaveLength(1)
    expect(await itemRows(me)).toHaveLength(1)
  })

  it('a new purchaseId for an owned item is refused, and a revoked item can be bought again', async () => {
    const me = await seedPlayer()
    expect(await shop.buy(me, 'head_beanie01', 'a', OCT)).toMatchObject({ ok: true })
    expect(await shop.buy(me, 'head_beanie01', 'b', OCT)).toEqual({ ok: false, code: 'ALREADY_OWNED' })
    await db.transaction((tx) => inv.revoke(tx, me, 'head_beanie01'))
    expect(await shop.buy(me, 'head_beanie01', 'c', OCT)).toMatchObject({ ok: true, repeated: false, balance: START - 20_000 })
  })

  it('refuses below rank, when owned, when disabled, when poor', async () => {
    const me = await seedPlayer(20_000, 1)
    // Owned under an old id (`item-aliases.json`): alias-aware.
    await db.insert(items).values({ id: 'accessory_conical_hat', slot: 'accessory', rarity: 'rare', nameKey: 'items.accessory_conical_hat', assetKey: 'accessory/accessory_conical_hat', isDefault: false }).onConflictDoNothing()
    await db.insert(inventory).values({ playerId: me, itemId: 'accessory_conical_hat', source: 'daily' })
    await db.update(players).set({ rank: 3 }).where(eq(players.id, me))
    expect(await shop.buy(me, 'head_conical_hat01', 'owned-alias', OCT)).toEqual({ ok: false, code: 'ALREADY_OWNED' })
    await db.update(players).set({ rank: 1 }).where(eq(players.id, me))

    expect(await shop.buy(me, 'outfit_dealer01', 'rank', OCT)).toEqual({ ok: false, code: 'RANK_TOO_LOW' })
    expect(await shop.buy(me, 'outfit_champion01', 'disabled', OCT)).toEqual({ ok: false, code: 'SHOP_DISABLED' })
    expect(await shop.buy(me, 'outfit_casual01', 'default', OCT)).toEqual({ ok: false, code: 'SHOP_DISABLED' })
    expect(await shop.buy(me, 'no_such_item', 'unknown', OCT)).toEqual({ ok: false, code: 'UNKNOWN_ITEM' })

    await db.update(players).set({ rank: 3 }).where(eq(players.id, me))
    expect(await shop.buy(me, 'outfit_dealer01', 'poor', OCT)).toEqual({ ok: false, code: 'INSUFFICIENT_POINTS' })

    expect(await balanceOf(me)).toBe(20_000)
    expect(await ledgerOf(me)).toEqual([])
    expect(await sinkRows()).toEqual([])
    expect(await db.select().from(ledgerKeys)).toEqual([])
    expect(balanceCalls).toEqual([])

    // The refused purchaseId is free again: the same id buys once the player can afford it.
    await db.update(players).set({ balance: 30_000 }).where(eq(players.id, me))
    expect(await shop.buy(me, 'outfit_dealer01', 'poor', OCT)).toEqual({ ok: true, balance: 0, itemId: 'outfit_dealer01', repeated: false })
  })

  it('a GM raising min_rank above the player\'s rank refuses, and a threshold change never does (rank is the stored high-water mark)', async () => {
    const me = await seedPlayer(START, 3)
    const before = (await reputation.ranks()).map((r) => ({ rank: r.rank, threshold: r.threshold }))
    try {
      await db.transaction((tx) => reputation.setRanks(tx, [{ rank: 1, threshold: 0 }, { rank: 2, threshold: 10_000 }, { rank: 3, threshold: 20_000 }, { rank: 4, threshold: 30_000 }, { rank: 5, threshold: 40_000 }], ADMIN))
      expect(await shop.buy(me, 'outfit_dealer01', 'hwm', OCT)).toMatchObject({ ok: true })
      await db.transaction((tx) => shop.setPrices(tx, [{ itemId: 'outfit_tet_red01', minRank: 4 }], ADMIN))
      expect(await shop.buy(me, 'outfit_tet_red01', 'raised', OCT)).toEqual({ ok: false, code: 'RANK_TOO_LOW' })
    } finally {
      // `reputation_ranks` is not truncated by the harness: put the thresholds back even when an expectation failed.
      await db.transaction((tx) => reputation.setRanks(tx, before, ADMIN))
    }
  })

  it('two buys of one item racing under two purchase ids charge once: the loser is ALREADY_OWNED and its key rolls back', async () => {
    const me = await seedPlayer()
    const results = await Promise.all([shop.buy(me, 'head_beanie01', 'x1', OCT), shop.buy(me, 'head_beanie01', 'x2', OCT)])
    expect(results.filter((r) => r.ok)).toEqual([{ ok: true, balance: START - 10_000, itemId: 'head_beanie01', repeated: false }])
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, code: 'ALREADY_OWNED' }])
    expect(await balanceOf(me)).toBe(START - 10_000)
    expect(await ledgerOf(me)).toEqual([{ amount: -10_000, reason: 'shop_purchase', refId: 'head_beanie01' }])
    expect(await sinkRows()).toEqual([{ amount: 10_000, reason: 'shop', kind: 'shop', refId: 'head_beanie01' }])
    expect(await itemRows(me)).toHaveLength(1)
    const winner = results[0]!.ok ? 'x1' : 'x2'
    expect(await db.select({ key: ledgerKeys.key }).from(ledgerKeys)).toEqual([{ key: `shop:${me}:${winner}` }])
    expect(balanceCalls).toEqual([{ playerId: me, balance: START - 10_000 }])
  })

  it('an empty or overlong purchaseId throws INVALID_PURCHASE_ID before any write', async () => {
    const me = await seedPlayer()
    await expect(shop.buy(me, 'head_beanie01', '', OCT)).rejects.toMatchObject({ code: 'INVALID_PURCHASE_ID' })
    await expect(shop.buy(me, 'head_beanie01', 'x'.repeat(101), OCT)).rejects.toMatchObject({ code: 'INVALID_PURCHASE_ID' })
    expect(await db.select().from(ledgerKeys)).toEqual([])
    expect(await balanceOf(me)).toBe(START)
    expect(await ledgerOf(me)).toEqual([])
    expect(await itemRows(me)).toEqual([])
    // A hundred characters is still an id.
    expect(await shop.buy(me, 'head_beanie01', 'x'.repeat(100), OCT)).toMatchObject({ ok: true, repeated: false })
  })

  it('a purchaseId reused after a GM revoked its item answers PURCHASE_UNDONE and charges nothing', async () => {
    const me = await seedPlayer()
    expect(await shop.buy(me, 'head_beanie01', 'undone', OCT)).toMatchObject({ ok: true, repeated: false })
    await db.transaction((tx) => inv.revoke(tx, me, 'head_beanie01'))
    expect(await shop.buy(me, 'head_beanie01', 'undone', OCT)).toEqual({ ok: false, code: 'PURCHASE_UNDONE' })
    expect(await balanceOf(me)).toBe(START - 10_000)
    expect(await ledgerOf(me)).toHaveLength(1)
    expect(await itemRows(me)).toEqual([])
    expect(balanceCalls).toHaveLength(1)
    // The key still stands, so the refusal repeats; a fresh id buys the item back.
    expect(await shop.buy(me, 'head_beanie01', 'undone', OCT)).toEqual({ ok: false, code: 'PURCHASE_UNDONE' })
    expect(await shop.buy(me, 'head_beanie01', 'again', OCT)).toMatchObject({ ok: true, repeated: false, balance: START - 20_000 })
  })

  it('buy debits before it grants', async () => {
    const me = await seedPlayer()
    const order: string[] = []
    const credit = vi.fn(async (tx: AppTx, ...rest: Parameters<NormalRepositories['balances']['creditWithin']> extends [AppTx, ...infer R] ? R : never) => {
      order.push('debit')
      return repos.balances.creditWithin(tx, ...rest)
    })
    const spiedRepos: NormalRepositories = { ...repos, balances: { ...repos.balances, creditWithin: credit } }
    let debitedAtGrant: number | null = null
    const spiedInventory: InventoryService = {
      ...inv,
      async grant(tx, playerId, itemId, source, ref) {
        order.push('grant')
        const [row] = rowsOf<{ balance: string | number }>(await tx.execute(sql`select balance from players where id = ${playerId}::uuid`))
        debitedAtGrant = Number(row!.balance)
        return inv.grant(tx, playerId, itemId, source, ref)
      },
    }
    const spied = makeShop({ inventory: spiedInventory, repos: spiedRepos })
    expect(await spied.buy(me, 'head_beanie01', 'order', OCT)).toMatchObject({ ok: true })
    expect(order).toEqual(['debit', 'grant'])
    expect(debitedAtGrant).toBe(START - 10_000)
    expect(credit).toHaveBeenCalledWith(expect.anything(), [{ playerId: me, delta: -10_000, reason: 'shop_purchase', refId: 'head_beanie01' }], { refId: 'head_beanie01', fee: 10_000, kind: 'shop' })
  })

  it('conservation: 40 random buys across 3 players keep Σ balances + Σ sinks, and the shop sink equals what was paid', async () => {
    const ids = [await seedPlayer(START, 5), await seedPlayer(START, 3), await seedPlayer(START, 1)]
    const prices = new Map((await shop.prices()).map((p) => [p.itemId, p.pricePoints]))
    const pool = (await shop.view(ids[0]!, OCT)).entries.filter((e) => e.lock === null).map((e) => e.itemId)
    expect(pool.length).toBeGreaterThan(20)
    // A small seeded LCG: the run is the same every time.
    let state = 20261022
    const rand = (n: number): number => {
      state = (state * 1103515245 + 12345) % 2147483648
      return state % n
    }
    const used: string[][] = [[], [], []]
    let paid = 0
    let repeats = 0
    for (let i = 0; i < 40; i += 1) {
      const who = rand(3)
      const pid = ids[who]!
      const reuse = used[who]!.length > 0 && rand(4) === 0
      const purchaseId = reuse ? used[who]![rand(used[who]!.length)]! : `buy-${String(i)}`
      const itemId = pool[rand(pool.length)]!
      const r = await shop.buy(pid, itemId, purchaseId, OCT)
      if (r.ok && !r.repeated) paid += prices.get(itemId)!
      if (r.ok && r.repeated) repeats += 1
      if (!reuse) used[who]!.push(purchaseId)
    }
    expect(repeats).toBeGreaterThan(0)
    expect(paid).toBeGreaterThan(0)

    const [bal] = rowsOf<{ n: string | number }>(await db.execute(sql`select coalesce(sum(balance), 0) as n from players`))
    const [sinks] = rowsOf<{ n: string | number }>(await db.execute(sql`select coalesce(sum(amount), 0) as n from point_transactions where player_id is null`))
    const [shopSink] = rowsOf<{ n: string | number }>(await db.execute(sql`select coalesce(sum(amount), 0) as n from point_transactions where player_id is null and reason = 'shop'`))
    const [playerRows] = rowsOf<{ n: string | number }>(await db.execute(sql`select coalesce(sum(amount), 0) as n from point_transactions where player_id is not null and reason = 'shop_purchase'`))
    expect(Number(bal!.n) + Number(sinks!.n)).toBe(3 * START)
    expect(Number(shopSink!.n)).toBe(paid)
    expect(Number(playerRows!.n)).toBe(-paid)
    const reasons = rowsOf<{ reason: string; kind: string | null; playerless: boolean }>(await db.execute(sql`select distinct reason, kind, (player_id is null) as playerless from point_transactions order by 1`))
    expect(reasons).toEqual([
      { reason: 'shop', kind: 'shop', playerless: true },
      { reason: 'shop_purchase', kind: null, playerless: false },
    ])
    // Every purchase is one inventory row whose ref names it.
    const [owned] = rowsOf<{ n: string | number }>(await db.execute(sql`select count(*) as n from inventory where source = 'shop'`))
    const [pairs] = rowsOf<{ n: string | number }>(await db.execute(sql`select count(*) as n from point_transactions where reason = 'shop_purchase'`))
    expect(Number(owned!.n)).toBe(Number(pairs!.n))
  })

  it('autoFeatured is stable within a week and ≤ 6', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `item_${String(i).padStart(2, '0')}`)
    const a = autoFeatured(ids, '2026-W43')
    expect(a).toHaveLength(6)
    expect(new Set(a).size).toBe(6)
    expect(autoFeatured([...ids].reverse(), '2026-W43')).toEqual(a)
    expect(autoFeatured(ids, '2026-W44')).not.toEqual(a)
    expect(autoFeatured(ids.slice(0, 4), '2026-W43')).toHaveLength(4)
    expect(autoFeatured([], '2026-W43')).toEqual([])
    // Monday to Sunday of one ISO week is one key, in the zone asked for.
    expect(isoWeekKey(Date.UTC(2026, 9, 19, 0, 30), 'UTC')).toBe('2026-W43')
    expect(isoWeekKey(Date.UTC(2026, 9, 25, 23, 30), 'UTC')).toBe('2026-W43')
    expect(isoWeekKey(Date.UTC(2026, 9, 25, 18, 0), 'Asia/Ho_Chi_Minh')).toBe('2026-W44')
    expect(isoWeekKey(Date.UTC(2027, 0, 1, 12), 'UTC')).toBe('2026-W53')
    expect(isoWeekKey(Date.UTC(2024, 11, 30, 12), 'UTC')).toBe('2025-W01')
  })

  it('weekStartMs is the Monday 00:00 of an ISO week in the zone asked for', () => {
    expect(weekStartMs('2026-W43', 'UTC')).toBe(Date.UTC(2026, 9, 19))
    expect(weekStartMs('2026-W49', 'UTC')).toBe(Date.UTC(2026, 10, 30))
    expect(weekStartMs('2026-W53', 'UTC')).toBe(Date.UTC(2026, 11, 28))
    expect(weekStartMs('2025-W01', 'UTC')).toBe(Date.UTC(2024, 11, 30))
    expect(weekStartMs('2026-W01', 'UTC')).toBe(Date.UTC(2025, 11, 29))
    // Ho Chi Minh is UTC+7: its Monday begins at 17:00 UTC on the Sunday.
    expect(weekStartMs('2026-W44', 'Asia/Ho_Chi_Minh')).toBe(Date.UTC(2026, 9, 25, 17))
    for (const key of ['2026-W43', '2026-W49', '2026-W53', '2025-W01', '2027-W10']) {
      expect(isoWeekKey(weekStartMs(key, 'Asia/Ho_Chi_Minh'), 'Asia/Ho_Chi_Minh')).toBe(key)
      expect(isoWeekKey(weekStartMs(key, 'Asia/Ho_Chi_Minh') - 1, 'Asia/Ho_Chi_Minh')).not.toBe(key)
    }
  })

  it('the automatic shelf holds all week: a gift-month lock lifting on Tuesday does not reshuffle it', async () => {
    const me = await seedPlayer()
    const MON = Date.UTC(2026, 10, 30, 12) // 2026-W49 opens in November, while the November top hat is still a gift
    const THU = Date.UTC(2026, 11, 3, 12) // December: the top hat is on sale now
    expect(await entryOf(me, 'head_tophat01', MON)).toMatchObject({ lock: { kind: 'gift_month', month: '2026-11' } })
    expect(await entryOf(me, 'head_tophat01', THU)).toMatchObject({ lock: null })
    const monday = await shop.view(me, MON)
    const thursday = await shop.view(me, THU)
    expect(monday.weekKey).toBe('2026-W49')
    expect(thursday.weekKey).toBe('2026-W49')
    expect(monday.featuredSource).toBe('auto')
    expect(thursday.featured).toEqual(monday.featured)
    // `featuredFor` judges the week as of its Monday, whatever the clock says (B4's preview of later weeks).
    expect(await shop.featuredFor('2026-W49')).toEqual({ itemIds: monday.featured, source: 'auto' })
    expect((await shop.view(me, Date.UTC(2026, 11, 7, 12))).featured).toEqual((await shop.featuredFor('2026-W50')).itemIds)
  })

  it('featuredFor prefers a GM row', async () => {
    const auto = await shop.featuredFor('2026-W43')
    expect(auto.source).toBe('auto')
    expect(auto.itemIds).toHaveLength(6)
    expect(await shop.featuredFor('2026-W43')).toEqual(auto)
    await db.transaction((tx) => shop.setFeatured(tx, '2026-W43', ['outfit_tuxedo01', 'head_beanie01'], ADMIN))
    expect(await shop.featuredFor('2026-W43')).toEqual({ itemIds: ['outfit_tuxedo01', 'head_beanie01'], source: 'gm' })
    const view = await shop.view(await seedPlayer(), OCT)
    expect(view.featured).toEqual(['outfit_tuxedo01', 'head_beanie01'])
    expect(view.featuredSource).toBe('gm')
    // Refusals: more than six, a disabled item, a repeat, a malformed week.
    await expect(db.transaction((tx) => shop.setFeatured(tx, '2026-W43', ['head_beanie01', 'outfit_casual01'], ADMIN))).rejects.toMatchObject({ code: 'INVALID_FEATURED' })
    const seven = view.entries.filter((e) => e.lock === null).map((e) => e.itemId).slice(0, 7)
    expect(seven).toHaveLength(7)
    await expect(db.transaction((tx) => shop.setFeatured(tx, '2026-W43', seven, ADMIN))).rejects.toMatchObject({ code: 'INVALID_FEATURED' })
    await expect(db.transaction((tx) => shop.setFeatured(tx, '2026-W43', ['head_beanie01', 'head_beanie01'], ADMIN))).rejects.toMatchObject({ code: 'INVALID_FEATURED' })
    await expect(db.transaction((tx) => shop.setFeatured(tx, '2026-43', ['head_beanie01'], ADMIN))).rejects.toMatchObject({ code: 'INVALID_FEATURED' })
    // An empty list hands the week back to the rotation.
    await db.transaction((tx) => shop.setFeatured(tx, '2026-W43', [], ADMIN))
    expect(await shop.featuredFor('2026-W43')).toEqual(auto)
  })

  it('edits prices and welcome choices inside the caller\'s transaction, refusing bad rows', async () => {
    await db.transaction((tx) => shop.setPrices(tx, [{ itemId: 'head_beanie01', pricePoints: 12_000, enabled: false }], ADMIN))
    expect((await shop.prices()).find((p) => p.itemId === 'head_beanie01')).toEqual({ itemId: 'head_beanie01', pricePoints: 12_000, minRank: 1, enabled: false, salePrice: null })
    await expect(db.transaction((tx) => shop.setPrices(tx, [{ itemId: 'head_beanie01', minRank: 6 }], ADMIN))).rejects.toMatchObject({ code: 'INVALID_PRICES' })
    await expect(db.transaction((tx) => shop.setPrices(tx, [{ itemId: 'head_beanie01', pricePoints: -1 }], ADMIN))).rejects.toMatchObject({ code: 'INVALID_PRICES' })
    await expect(db.transaction((tx) => shop.setPrices(tx, [{ itemId: 'nope', pricePoints: 1 }], ADMIN))).rejects.toMatchObject({ code: 'INVALID_PRICES' })

    expect(await shop.welcomeChoices()).toEqual(['outfit_dealer01', 'outfit_tet_red01', 'head_conical_hat01'])
    await db.transaction((tx) => shop.setWelcomeChoices(tx, ['outfit_tuxedo01', 'outfit_dealer01', 'head_conical_hat01'], ADMIN))
    expect(await shop.welcomeChoices()).toEqual(['outfit_tuxedo01', 'outfit_dealer01', 'head_conical_hat01'])
    await expect(db.transaction((tx) => shop.setWelcomeChoices(tx, ['outfit_dealer01', 'head_conical_hat01'], ADMIN))).rejects.toMatchObject({ code: 'INVALID_WELCOME' })
    await expect(db.transaction((tx) => shop.setWelcomeChoices(tx, ['outfit_dealer01', 'outfit_dealer01', 'head_conical_hat01'], ADMIN))).rejects.toMatchObject({ code: 'INVALID_WELCOME' })
    await expect(db.transaction((tx) => shop.setWelcomeChoices(tx, ['outfit_champion01', 'outfit_dealer01', 'head_conical_hat01'], ADMIN))).rejects.toMatchObject({ code: 'INVALID_WELCOME' })
    // `seedConfig` never overwrites a GM's choice.
    await shop.seedConfig()
    expect(await shop.welcomeChoices()).toEqual(['outfit_tuxedo01', 'outfit_dealer01', 'head_conical_hat01'])
  })

  it('setPrices refuses a price above a billion and, this round, any sale price (R5)', async () => {
    const edit = (change: Parameters<ShopService['setPrices']>[1][number]) => db.transaction((tx) => shop.setPrices(tx, [change], ADMIN))
    await expect(edit({ itemId: 'head_beanie01', pricePoints: 1_000_000_001 })).rejects.toMatchObject({ code: 'INVALID_PRICES' })
    await expect(edit({ itemId: 'head_beanie01', salePrice: 5_000 })).rejects.toMatchObject({ code: 'INVALID_PRICES' })
    await expect(edit({ itemId: 'head_beanie01', salePrice: 0 })).rejects.toMatchObject({ code: 'INVALID_PRICES' })
    await expect(edit({ itemId: 'head_beanie01', salePrice: 2_000_000_000 })).rejects.toMatchObject({ code: 'INVALID_PRICES' })
    expect((await shop.prices()).find((p) => p.itemId === 'head_beanie01')).toMatchObject({ pricePoints: 10_000, salePrice: null })
    await edit({ itemId: 'head_beanie01', pricePoints: 1_000_000_000, salePrice: null })
    expect((await shop.prices()).find((p) => p.itemId === 'head_beanie01')).toMatchObject({ pricePoints: 1_000_000_000, salePrice: null })
  })

  it('refuses a locked gift as a welcome choice, and a shelf item locked on the week\'s Monday', async () => {
    const welcome = (ids: string[]) => db.transaction((tx) => shop.setWelcomeChoices(tx, ids, ADMIN))
    // The November top hat is a gift a month ahead of OCT; the monthly badge is a default gift.
    await expect(welcome(['head_tophat01', 'outfit_dealer01', 'head_conical_hat01'])).rejects.toMatchObject({ code: 'INVALID_WELCOME' })
    await expect(welcome(['badge_monthly', 'outfit_dealer01', 'head_conical_hat01'])).rejects.toMatchObject({ code: 'INVALID_WELCOME' })
    await expect(welcome(['outfit_casual_red01', 'outfit_dealer01', 'head_conical_hat01'])).rejects.toMatchObject({ code: 'INVALID_WELCOME' })
    expect(await shop.welcomeChoices()).toEqual(['outfit_dealer01', 'outfit_tet_red01', 'head_conical_hat01'])

    const shelf = (week: string, ids: string[]) => db.transaction((tx) => shop.setFeatured(tx, week, ids, ADMIN))
    await expect(shelf('2026-W43', ['head_tophat01'])).rejects.toMatchObject({ code: 'INVALID_FEATURED' })
    // 2026-W49 opens on Monday 30 November, while the top hat is still November's gift.
    await expect(shelf('2026-W49', ['head_tophat01'])).rejects.toMatchObject({ code: 'INVALID_FEATURED' })
    await expect(shelf('2026-W43', ['badge_monthly'])).rejects.toMatchObject({ code: 'INVALID_FEATURED' })
    // 2026-W50 opens in December: the top hat sells then, so a GM may put it on that shelf now.
    await shelf('2026-W50', ['head_tophat01', 'head_beanie01'])
    expect(await shop.featuredFor('2026-W50')).toEqual({ itemIds: ['head_tophat01', 'head_beanie01'], source: 'gm' })
  })
})
