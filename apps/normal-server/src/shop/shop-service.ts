/**
 * The shop (Plan 27, spec §3 B1–B2): catalogue cosmetics sold for **points** behind a rank. Points only — nothing here
 * takes money, converts anything or lets players trade (requirement.txt §3, SRS §33).
 *
 * **One money path.** A purchase is `creditWithin` with the player's row (`shop_purchase`, −price, a transfer) and a
 * sink row (`shop`, +price, `player_id` null), so `Σ balances + Σ sink rows` holds and §12.5's overview counts the sink
 * once (`SINK_REASONS` in `gm-service.ts`). Nothing else here moves a balance.
 *
 * **Once per click.** The client names each click with a `purchaseId`. `ledger_keys` alone cannot guard it —
 * `pruneLedgerKeys` empties that table at every boot — so the purchase's own inventory row, whose `ref` is
 * `shop:<pid>:<purchaseId>`, is looked up first and the key second (P15). A refusal throws inside the transaction, so
 * the key it claimed rolls back with it and the same id can buy later.
 *
 * **Lock order.** `creditWithin` locks the `players` row `FOR UPDATE` before `inventory.grant`, whose foreign-key check
 * takes a `KEY SHARE` on the same row: debit first, never grant first. A grant that finds the item already there (a
 * second purchase of the same item racing this one) throws, so the debit rolls back and the answer is `ALREADY_OWNED`.
 *
 * **Inside the transaction everything is read through `tx`** (PGlite has one connection). Alias-aware ownership
 * (`inventory.owns`, on `db`) is asked before the transaction opens and only judged after the repeat checks, so a
 * retried purchase is answered "repeated", never "already owned".
 *
 * **Locks are live.** Whether a gift of the check-in schedule sells depends on the schedule and the month (R20): the
 * shop asks `gifts.current().noticesFrom(<this month>)` at every read and every purchase rather than freezing it into
 * the price list. The rank a purchase is judged on is `players.rank`, the high-water mark (R15). The week's shelf is the
 * one exception: the rotation judges gift locks as of the week's Monday (`weekStartMs`), so a lock lifting mid-week
 * does not reshuffle the shelf (R4). Gift locks only ever lift as months pass, so a Monday shelf never shows an item a
 * later day of the week locks.
 *
 * **An undone purchase.** A purchase id whose key still stands but whose inventory row is gone was revoked by a GM:
 * the answer is `PURCHASE_UNDONE` — neither "repeated" (the item is not there) nor a second charge. Once a boot has
 * pruned the key, the same id is a new purchase again.
 */
import { InsufficientBalanceError } from '@bp/server-kit'
import { asc, eq, inArray } from 'drizzle-orm'
import type { AchievementDef } from '../achievements/definitions.js'
import type { AppDb, AppTx } from '../db/client.js'
import { ledgerKeys, players, shopConfig, shopFeatured, shopPrices } from '../db/schema.js'
import { dayKey, dayStartMs, monthKey } from '../economy/daily-rules.js'
import type { DailyGiftNotice } from '../economy/daily-gifts.js'
import type { GiftScheduleStore } from '../economy/gift-schedule-store.js'
import { ServiceError } from '../errors.js'
import type { InventoryService } from '../inventory/inventory-service.js'
import type { ItemCatalog, ItemDef, Rarity } from '../inventory/items.js'
import { UnknownPlayerError, type NormalRepositories } from '../repos/index.js'
import { isUuid } from '../repos/util.js'
import type { RankRow, ReputationService } from '../reputation/reputation-service.js'
import { DEFAULT_WELCOME_CHOICES, SEED_PRICES, seedConfig, seedPrices, WELCOME_CHOICES_KEY } from './shop-prices-seed.js'

export interface ShopPrice {
  itemId: string
  pricePoints: number
  minRank: number
  enabled: boolean
  salePrice: number | null
}

/** Why an item is not for sale, in precedence order (spec B1): the source label the card shows instead of "Mua". */
export type ShopLock =
  | { kind: 'achievement'; achievementId: string }
  | { kind: 'gift_month'; month: string }
  | { kind: 'gift_default' }
  | { kind: 'free' }
  | { kind: 'default' }
  | { kind: 'disabled' }
  | { kind: 'unpriced' }

export interface ShopEntry {
  itemId: string
  slot: string
  rarity: Rarity
  /** `price_points`; 0 for an item without a price row (it is `unpriced`, not free). */
  price: number
  minRank: number
  /** `lock === null && !owned` — rank and balance are the client's to show, the server's to judge. */
  purchasable: boolean
  owned: boolean
  lock: ShopLock | null
}

export interface ShopView {
  weekKey: string
  featured: string[]
  featuredSource: 'gm' | 'auto'
  entries: ShopEntry[]
  me: { balance: number; reputation: number; rank: number; ranks: RankRow[] }
}

export type BuyResult =
  | { ok: true; balance: number; itemId: string; repeated: boolean }
  | { ok: false; code: 'SHOP_DISABLED' | 'RANK_TOO_LOW' | 'ALREADY_OWNED' | 'INSUFFICIENT_POINTS' | 'UNKNOWN_ITEM' | 'PURCHASE_UNDONE' }

/** One GM edit of a price row: the item, and only the fields that change. */
export type ShopPriceChange = Partial<ShopPrice> & { itemId: string }

export interface ShopService {
  /** Every catalogue item with its price, lock and ownership, the week's shelf and the player's standing. */
  view(playerId: string, now?: number): Promise<ShopView>
  /** Buys `itemId` once for `purchaseId`. Throws `ServiceError('INVALID_PURCHASE_ID')` for an empty or overlong id. */
  buy(playerId: string, itemId: string, purchaseId: string, now?: number): Promise<BuyResult>
  /** The price list as stored, by item id. */
  prices(): Promise<ShopPrice[]>
  /** Writes a GM's edits in the caller's transaction. Throws `ServiceError('INVALID_PRICES')`. */
  setPrices(tx: AppTx, changes: ShopPriceChange[], updatedBy: string): Promise<void>
  /** The GM's shelf for `weekKey` when there is one, else the rotation over what sells on that week's Monday. */
  featuredFor(weekKey: string): Promise<{ itemIds: string[]; source: 'gm' | 'auto' }>
  /**
   * ≤ 6 distinct ids that sell on the week's Monday (no lock); `[]` hands the week back to the rotation.
   * Throws `ServiceError('INVALID_FEATURED')`.
   */
  setFeatured(tx: AppTx, weekKey: string, itemIds: string[], updatedBy: string): Promise<void>
  /** The three welcome outfits (spec C1). */
  welcomeChoices(): Promise<string[]>
  /** Exactly three distinct items that sell now (no lock: not a gift, not an achievement's). Throws `ServiceError('INVALID_WELCOME')`. */
  setWelcomeChoices(tx: AppTx, itemIds: string[], updatedBy: string): Promise<void>
  /** Inserts a price row per catalogue item missing one (spec B1); resolves how many. Never overwrites. */
  seedPrices(): Promise<number>
  /** Puts `welcome_choices` back where it is missing. Never overwrites. */
  seedConfig(): Promise<void>
}

export interface ShopServiceDeps {
  db: AppDb
  repos: NormalRepositories
  inventory: InventoryService
  catalog: ItemCatalog
  defs: AchievementDef[]
  gifts: GiftScheduleStore
  reputation: ReputationService
  /** The economy's zone: "this month" (the gift lock) and "this week" (the shelf) are read there. */
  timezone: string
  /** Called after a purchase commits, with the new balance — wired to `game.balanceChanged` like the economy's. */
  onBalanceChanged: (playerId: string, balance: number) => void
  now?: () => number
}

const FEATURED_MAX = 6
const WELCOME_COUNT = 3
const PURCHASE_ID_MAX = 100
/** The highest price a GM may set: well inside the `integer` column. */
const PRICE_MAX = 1_000_000_000
const WEEK_KEY = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/
const DAY_MS = 24 * 60 * 60 * 1000

/** A refusal decided inside the purchase transaction: thrown so the key it claimed rolls back, then answered. */
class Refusal extends Error {
  constructor(readonly code: Extract<BuyResult, { ok: false }>['code']) {
    super(code)
    this.name = 'ShopRefusal'
  }
}

/** The ISO week (`YYYY-Www`) of `nowMs`'s calendar day in `timeZone`. Monday starts a week; week 1 holds a Thursday. */
export function isoWeekKey(nowMs: number, timeZone: string): string {
  const [y, m, d] = dayKey(nowMs, timeZone).split('-').map(Number) as [number, number, number]
  const day = Date.UTC(y, m - 1, d)
  const weekday = (new Date(day).getUTCDay() + 6) % 7
  const thursday = new Date(day + (3 - weekday) * DAY_MS)
  const year = thursday.getUTCFullYear()
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * DAY_MS))
  return `${String(year)}-W${String(week).padStart(2, '0')}`
}

/**
 * The instant `weekKey` (`YYYY-Www`) begins: its Monday at 00:00 in `timeZone`. Week 1's Monday is the one on or before
 * 4 January. Throws a `RangeError` for a malformed key.
 */
export function weekStartMs(weekKey: string, timeZone: string): number {
  const match = WEEK_KEY.exec(weekKey)
  if (match === null) throw new RangeError(`${weekKey} is not an ISO week, YYYY-Www`)
  const jan4 = Date.UTC(Number(match[1]), 0, 4)
  const firstMonday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS
  const monday = new Date(firstMonday + (Number(match[2]) - 1) * 7 * DAY_MS)
  return dayStartMs(monday.toISOString().slice(0, 10), timeZone)
}

/**
 * Six of `enabledIds` for `weekKey`, rotating by week (R4): the ids sorted, a window of six starting six further on each
 * week, wrapping. The same inputs give the same shelf all week, whatever order the ids come in; fewer than six give all.
 */
export function autoFeatured(enabledIds: string[], weekKey: string): string[] {
  const ids = [...new Set(enabledIds)].sort()
  if (ids.length <= FEATURED_MAX) return ids
  const match = WEEK_KEY.exec(weekKey)
  const index = match === null ? 0 : Number(match[1]) * 53 + Number(match[2])
  const start = (index * FEATURED_MAX) % ids.length
  return Array.from({ length: FEATURED_MAX }, (_, i) => ids[(start + i) % ids.length]!)
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

export function createShopService(deps: ShopServiceDeps): ShopService {
  const clock = deps.now ?? Date.now
  /** Item → the achievement that rewards it (the first, if two ever did). */
  const rewardOwner = new Map<string, string>()
  for (const def of deps.defs) if (def.reward.itemId !== undefined && !rewardOwner.has(def.reward.itemId)) rewardOwner.set(def.reward.itemId, def.id)

  const toPrice = (r: typeof shopPrices.$inferSelect): ShopPrice => ({ itemId: r.itemId, pricePoints: r.pricePoints, minRank: r.minRank, enabled: r.enabled, salePrice: r.salePrice })

  async function readPrices(q: AppDb | AppTx): Promise<Map<string, ShopPrice>> {
    const rows = await q.select().from(shopPrices).orderBy(asc(shopPrices.itemId))
    return new Map(rows.map((r) => [r.itemId, toPrice(r)]))
  }

  /** Every fixed gift of the live schedule from this month on, by item: `month: null` is the default's. */
  function giftNotices(nowMs: number): Map<string, DailyGiftNotice> {
    return new Map(deps.gifts.current().noticesFrom(monthKey(nowMs, deps.timezone)).map((n) => [n.itemId, n]))
  }

  function lockOf(def: ItemDef, price: ShopPrice | undefined, notices: ReadonlyMap<string, DailyGiftNotice>): ShopLock | null {
    if (def.isDefault) return { kind: 'default' }
    if (def.free === true) return { kind: 'free' }
    const achievementId = rewardOwner.get(def.id)
    if (achievementId !== undefined) return { kind: 'achievement', achievementId }
    const gift = notices.get(def.id)
    if (gift !== undefined) return gift.month === null ? { kind: 'gift_default' } : { kind: 'gift_month', month: gift.month }
    if (price === undefined) return { kind: 'unpriced' }
    if (!price.enabled) return { kind: 'disabled' }
    return null
  }

  /** The ids that sell right now (no lock), whoever is asking. */
  function sellable(prices: ReadonlyMap<string, ShopPrice>, nowMs: number): string[] {
    const notices = giftNotices(nowMs)
    return deps.catalog.all().filter((def) => lockOf(def, prices.get(def.id), notices) === null).map((def) => def.id)
  }

  /** The GM's row, else the rotation over what sold on the week's Monday — the same shelf every day of the week (R4). */
  async function featuredAt(weekKey: string, prices: ReadonlyMap<string, ShopPrice>): Promise<{ itemIds: string[]; source: 'gm' | 'auto' }> {
    const [row] = await deps.db.select({ itemIds: shopFeatured.itemIds }).from(shopFeatured).where(eq(shopFeatured.weekKey, weekKey))
    if (row !== undefined && Array.isArray(row.itemIds) && row.itemIds.length > 0) return { itemIds: [...row.itemIds], source: 'gm' }
    return { itemIds: autoFeatured(sellable(prices, weekStartMs(weekKey, deps.timezone)), weekKey), source: 'auto' }
  }

  /** Reads a player's balance through `tx`, for an answer given inside the purchase transaction. */
  async function balanceWithin(tx: AppTx, playerId: string): Promise<number> {
    const [row] = await tx.select({ balance: players.balance }).from(players).where(eq(players.id, playerId))
    if (row === undefined) throw new UnknownPlayerError(playerId)
    return row.balance
  }

  /**
   * Every id must be a catalogue item that sells at `atMs` — no lock of any kind, judged on the price rows read through
   * `tx` and the gift schedule from `atMs`'s month on. `code` names the refusal.
   */
  async function requireSellable(tx: AppTx, itemIds: readonly string[], code: string, atMs: number): Promise<void> {
    if (itemIds.length === 0) return
    const rows = await tx.select().from(shopPrices).where(inArray(shopPrices.itemId, [...itemIds]))
    const prices = new Map(rows.map((r) => [r.itemId, toPrice(r)]))
    const notices = giftNotices(atMs)
    for (const id of itemIds) {
      const def = deps.catalog.get(id)
      if (def === undefined) throw new ServiceError(code, `${id} is not in the item catalogue`)
      const lock = lockOf(def, prices.get(id), notices)
      if (lock !== null) throw new ServiceError(code, `${id} is not on sale (${lock.kind})`)
    }
  }

  function distinctStrings(value: unknown, code: string): string[] {
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v === '')) throw new ServiceError(code, 'a list of item ids is expected')
    const ids = value as string[]
    if (new Set(ids).size !== ids.length) throw new ServiceError(code, 'an item is named twice')
    return ids
  }

  return {
    async view(playerId, now) {
      const nowMs = now ?? clock()
      if (!isUuid(playerId)) throw new UnknownPlayerError(playerId)
      const [me] = await deps.db.select({ balance: players.balance, reputation: players.reputation, rank: players.rank }).from(players).where(eq(players.id, playerId))
      if (me === undefined) throw new UnknownPlayerError(playerId)
      const all = deps.catalog.all()
      const [prices, missing, ranks] = await Promise.all([readPrices(deps.db), deps.inventory.missingOf(playerId, all.map((d) => d.id)), deps.reputation.ranks()])
      const missingSet = new Set(missing)
      const notices = giftNotices(nowMs)
      const entries = all.map((def): ShopEntry => {
        const price = prices.get(def.id)
        const lock = lockOf(def, price, notices)
        const owned = !missingSet.has(def.id)
        return { itemId: def.id, slot: def.slot, rarity: def.rarity, price: price?.pricePoints ?? 0, minRank: price?.minRank ?? 1, purchasable: lock === null && !owned, owned, lock }
      })
      const weekKey = isoWeekKey(nowMs, deps.timezone)
      const featured = await featuredAt(weekKey, prices)
      return { weekKey, featured: featured.itemIds, featuredSource: featured.source, entries, me: { balance: me.balance, reputation: me.reputation, rank: me.rank, ranks } }
    },

    async buy(playerId, itemId, purchaseId, now) {
      if (typeof purchaseId !== 'string' || purchaseId === '' || purchaseId.length > PURCHASE_ID_MAX) {
        throw new ServiceError('INVALID_PURCHASE_ID', `a purchase id is 1–${String(PURCHASE_ID_MAX)} characters`)
      }
      if (!isUuid(playerId)) throw new UnknownPlayerError(playerId)
      const nowMs = now ?? clock()
      const def = deps.catalog.get(itemId)
      const ref = `shop:${playerId}:${purchaseId}`
      // On `db`, so before the transaction; judged only after the repeat checks below (P15).
      const ownedBefore = def === undefined ? false : await deps.inventory.owns(playerId, itemId)
      const notices = giftNotices(nowMs)

      let result: Extract<BuyResult, { ok: true }>
      try {
        result = await deps.db.transaction(async (tx) => {
          // (1) The purchase itself, which survives a boot's key prune.
          const earlier = await deps.inventory.findByRef(tx, playerId, ref)
          if (earlier.length > 0) return { ok: true as const, balance: await balanceWithin(tx, playerId), itemId: earlier[0]!, repeated: true }
          // (2) The key: a purchase with this id that committed since this process booted, or (on Postgres) a twin
          // that was in flight and has just committed — the insert waits for it. Its inventory row, read again by a
          // fresh statement, says what was bought; no row means a GM has taken the item back since.
          const claimed = await tx.insert(ledgerKeys).values({ key: ref }).onConflictDoNothing().returning({ key: ledgerKeys.key })
          if (claimed.length === 0) {
            const committed = await deps.inventory.findByRef(tx, playerId, ref)
            if (committed.length === 0) throw new Refusal('PURCHASE_UNDONE')
            return { ok: true as const, balance: await balanceWithin(tx, playerId), itemId: committed[0]!, repeated: true }
          }

          // (3) The checks, against the price list and schedule as they are now (no cache).
          if (def === undefined) throw new Refusal('UNKNOWN_ITEM')
          const [priceRow] = await tx.select().from(shopPrices).where(eq(shopPrices.itemId, itemId))
          const price = priceRow === undefined ? undefined : toPrice(priceRow)
          if (price === undefined || lockOf(def, price, notices) !== null) throw new Refusal('SHOP_DISABLED')
          const [standing] = await tx.select({ rank: players.rank }).from(players).where(eq(players.id, playerId))
          if (standing === undefined) throw new UnknownPlayerError(playerId)
          if (standing.rank < price.minRank) throw new Refusal('RANK_TOO_LOW')
          if (ownedBefore) throw new Refusal('ALREADY_OWNED')

          // (4) Debit, then grant — the lock order.
          try {
            await deps.repos.balances.creditWithin(tx, [{ playerId, delta: -price.pricePoints, reason: 'shop_purchase', refId: itemId }], { refId: itemId, fee: price.pricePoints, kind: 'shop' })
          } catch (err) {
            if (err instanceof InsufficientBalanceError) throw new Refusal('INSUFFICIENT_POINTS')
            throw err
          }
          if (!(await deps.inventory.grant(tx, playerId, itemId, 'shop', ref))) throw new Refusal('ALREADY_OWNED')
          return { ok: true as const, balance: await balanceWithin(tx, playerId), itemId, repeated: false }
        })
      } catch (err) {
        if (err instanceof Refusal) return { ok: false, code: err.code }
        throw err
      }
      if (!result.repeated) deps.onBalanceChanged(playerId, result.balance)
      return result
    },

    async prices() {
      return [...(await readPrices(deps.db)).values()]
    },

    async setPrices(tx, changes, updatedBy) {
      const code = 'INVALID_PRICES'
      if (!Array.isArray(changes)) throw new ServiceError(code, 'a list of price changes is expected')
      const seen = new Set<string>()
      for (const c of changes) {
        if (typeof c !== 'object' || c === null || typeof c.itemId !== 'string') throw new ServiceError(code, 'every change names an item')
        if (deps.catalog.get(c.itemId) === undefined) throw new ServiceError(code, `${c.itemId} is not in the item catalogue`)
        if (seen.has(c.itemId)) throw new ServiceError(code, `${c.itemId} is changed twice`)
        seen.add(c.itemId)
        if (c.pricePoints !== undefined && (!isInt(c.pricePoints) || c.pricePoints < 0 || c.pricePoints > PRICE_MAX)) {
          throw new ServiceError(code, `${c.itemId}: a price is a whole number from 0 to ${String(PRICE_MAX)}`)
        }
        if (c.minRank !== undefined && (!isInt(c.minRank) || c.minRank < 1 || c.minRank > 5)) throw new ServiceError(code, `${c.itemId}: a rank is 1 to 5`)
        if (c.enabled !== undefined && typeof c.enabled !== 'boolean') throw new ServiceError(code, `${c.itemId}: enabled is true or false`)
        // R5: the column is there, sales are not — nothing reads `sale_price` this round, so none may be set.
        if (c.salePrice !== undefined && c.salePrice !== null) throw new ServiceError(code, `${c.itemId}: sale prices are not offered yet`)
      }
      const at = new Date(clock())
      for (const c of changes) {
        const def = deps.catalog.get(c.itemId)!
        const set: Partial<typeof shopPrices.$inferInsert> = { updatedBy, updatedAt: at }
        if (c.pricePoints !== undefined) set.pricePoints = c.pricePoints
        if (c.minRank !== undefined) set.minRank = c.minRank
        if (c.enabled !== undefined) set.enabled = c.enabled
        if (c.salePrice !== undefined) set.salePrice = c.salePrice
        // An item without a row ("chưa định giá") gets one: the rarity's seed for what the change leaves out, off sale
        // unless the change says otherwise.
        await tx
          .insert(shopPrices)
          .values({
            itemId: c.itemId,
            pricePoints: c.pricePoints ?? SEED_PRICES[def.rarity].pricePoints,
            minRank: c.minRank ?? SEED_PRICES[def.rarity].minRank,
            enabled: c.enabled ?? false,
            salePrice: c.salePrice ?? null,
            updatedBy,
            updatedAt: at,
          })
          .onConflictDoUpdate({ target: shopPrices.itemId, set })
      }
    },

    async featuredFor(weekKey) {
      return featuredAt(weekKey, await readPrices(deps.db))
    },

    async setFeatured(tx, weekKey, itemIds, updatedBy) {
      const code = 'INVALID_FEATURED'
      if (typeof weekKey !== 'string' || !WEEK_KEY.test(weekKey)) throw new ServiceError(code, `${String(weekKey)} is not an ISO week, YYYY-Www`)
      const ids = distinctStrings(itemIds, code)
      if (ids.length > FEATURED_MAX) throw new ServiceError(code, `the shelf holds at most ${String(FEATURED_MAX)} items`)
      if (ids.length === 0) {
        await tx.delete(shopFeatured).where(eq(shopFeatured.weekKey, weekKey))
        return
      }
      await requireSellable(tx, ids, code, weekStartMs(weekKey, deps.timezone))
      const at = new Date(clock())
      await tx
        .insert(shopFeatured)
        .values({ weekKey, itemIds: ids, updatedBy, updatedAt: at })
        .onConflictDoUpdate({ target: shopFeatured.weekKey, set: { itemIds: ids, updatedBy, updatedAt: at } })
    },

    async welcomeChoices() {
      const [row] = await deps.db.select({ value: shopConfig.value }).from(shopConfig).where(eq(shopConfig.key, WELCOME_CHOICES_KEY))
      const value = row?.value
      if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return [...(value as string[])]
      return [...DEFAULT_WELCOME_CHOICES]
    },

    async setWelcomeChoices(tx, itemIds, updatedBy) {
      const code = 'INVALID_WELCOME'
      const ids = distinctStrings(itemIds, code)
      if (ids.length !== WELCOME_COUNT) throw new ServiceError(code, `the welcome gift offers exactly ${String(WELCOME_COUNT)} items`)
      // A default, a free item, an achievement's reward and a gift of the schedule (this month's or a later one's) all
      // carry a lock: none is the shop's to give away.
      await requireSellable(tx, ids, code, clock())
      const at = new Date(clock())
      await tx
        .insert(shopConfig)
        .values({ key: WELCOME_CHOICES_KEY, value: ids, updatedBy, updatedAt: at })
        .onConflictDoUpdate({ target: shopConfig.key, set: { value: ids, updatedBy, updatedAt: at } })
    },

    seedPrices: () => seedPrices(deps.db, deps.catalog, deps.defs),

    seedConfig: () => seedConfig(deps.db),
  }
}
