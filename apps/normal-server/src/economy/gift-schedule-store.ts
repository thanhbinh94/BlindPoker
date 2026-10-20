/**
 * The check-in's gift schedule while the server runs (Plan 26): `data/daily-gifts.json` is the default, and a month a
 * GM edits is a row of `gift_months` that **replaces** that month's entry in the file.
 *
 * Until now the schedule was read once at boot, so a new month meant an edit and a restart. The store keeps the same
 * `DailyGiftSchedule` the economy has always read, rebuilt from the file and the rows. The economy calls `current()`
 * once per operation and keeps that copy (Plan 26 P9), so a claim that began before a change finishes under the schedule
 * it began with and the next claim sees the new one.
 *
 * Three rules a GM's write must meet, all checked inside the caller's transaction so a refusal leaves no trace:
 *
 * - **No past month** (`MONTH_IN_PAST`): a month that is over can no longer give anything.
 * - **No tier already reached** (`TIER_LOCKED`): in the current month, a day up to today's date has been (or can be)
 *   claimed under the schedule that stood then, so what it gives is history. Later days are free to change.
 * - **A schedule the parser accepts** (`INVALID_GIFTS`): the same checks `parseDailyGifts` applies to the file —
 *   catalogue ids, no repeats, no tier a month never reaches — plus one of its own: a fixed item must be of a slot
 *   a check-in can be undone for (`DAILY_DRAW_SLOTS`, `title`, `badge`), because a required slot cannot be revoked.
 *
 * The caller commits and then calls `reload()`; `current()` never changes inside a transaction that may still roll back.
 * Reads of existing rows go through the given `tx`: PGlite serialises transactions, so a read on `db` there would wait on
 * the transaction it belongs to.
 */
import { consoleLogger } from '@bp/server-kit'
import { eq } from 'drizzle-orm'
import type { AppDb, AppTx } from '../db/client.js'
import { giftMonths } from '../db/schema.js'
import { ServiceError } from '../errors.js'
import type { ItemCatalog } from '../inventory/items.js'
import { DAILY_DRAW_SLOTS } from '../inventory/slots.js'
import { parseDailyGifts, type DailyGiftSchedule } from './daily-gifts.js'
import { dayKey, MAX_STREAK, monthKey } from './daily-rules.js'

export interface GiftMonthRow {
  month: string
  /** The month's own tiers, as written: `{ "<day>": { draw } | { fixed } }`. */
  days: Record<string, unknown>
  /** `db` when a GM set it (it replaces the file's entry), `file` when `daily-gifts.json` does. */
  source: 'file' | 'db'
  updatedAt: number | null
  updatedBy: string | null
}

export interface GiftScheduleStore {
  /** The schedule as of the last `reload()`. Call once per operation and keep the result. */
  current(): DailyGiftSchedule
  /** The file's `default`: what a month without its own entry for a tier falls back to. */
  defaults(): Record<string, unknown>
  /** Every month the file or the database names, the database's entry winning, by month. */
  months(): Promise<GiftMonthRow[]>
  /** Replaces `month`'s entry. Throws `ServiceError` (`INVALID_MONTH`, `MONTH_IN_PAST`, `INVALID_GIFTS`, `TIER_LOCKED`). */
  setMonth(tx: AppTx, month: string, days: unknown, actorUserId: string | null): Promise<void>
  /** Drops `month`'s database entry so the file's applies again; `false` when there was none. Throws as `setMonth` does. */
  clearMonth(tx: AppTx, month: string): Promise<boolean>
  /** Rebuilds `current()` from the file and the database. Call after the transaction that changed a row has committed. */
  reload(): Promise<void>
}

export interface GiftScheduleStoreDeps {
  db: AppDb
  catalog: ItemCatalog
  /** `daily-gifts.json` as parsed (`readDailyGiftsRaw`): `{ default, months }`. Refused at creation if it is not valid by itself. */
  defaults: unknown
  /** The economy's zone: "today" and "this month" are read there. */
  timezone: string
  now?: () => number
  log?: { warn(msg: string, data?: object): void }
}

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/
const FILE = 'daily-gifts.json'
const DB_SOURCE = 'gift_months'
/** What a fixed item must be, so that undoing a check-in can take it back. */
const FIXED_SLOTS: readonly string[] = [...DAILY_DRAW_SLOTS, 'title', 'badge']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

type StoredRow = { month: string; days: unknown; updatedAt: Date; updatedBy: string | null }

export async function createGiftScheduleStore(deps: GiftScheduleStoreDeps): Promise<GiftScheduleStore> {
  const now = deps.now ?? Date.now
  const log = deps.log ?? consoleLogger
  const raw = isRecord(deps.defaults) ? deps.defaults : {}
  const fileDefault = isRecord(raw['default']) ? raw['default'] : {}
  const fileMonths = isRecord(raw['months']) ? raw['months'] : {}

  // The file alone must be a schedule: a bad file stops the boot, as it always has.
  let schedule: DailyGiftSchedule = parseDailyGifts(deps.defaults, deps.catalog, FILE)

  const readRows = (from: AppDb | AppTx): Promise<StoredRow[]> => from.select().from(giftMonths).orderBy(giftMonths.month)

  /** The schedule of the file with these rows over it. A row that no longer validates is warned about and skipped (P8). */
  function build(rows: readonly StoredRow[]): { schedule: DailyGiftSchedule; valid: Record<string, unknown> } {
    const valid: Record<string, unknown> = {}
    for (const row of rows) {
      try {
        parseDailyGifts({ default: fileDefault, months: { [row.month]: row.days } }, deps.catalog, DB_SOURCE)
        valid[row.month] = row.days
      } catch (err) {
        log.warn('gift month skipped: it no longer validates against the catalogue', { month: row.month, error: messageOf(err) })
      }
    }
    return { schedule: parseDailyGifts({ default: fileDefault, months: { ...fileMonths, ...valid } }, deps.catalog, FILE), valid }
  }

  const sameRule = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

  /** The first tier already reached this month whose rule would differ, or `null`. Only the current month has any. */
  function lockedTier(before: DailyGiftSchedule, after: DailyGiftSchedule, month: string): number | null {
    const at = now()
    if (month !== monthKey(at, deps.timezone)) return null
    const today = Number(dayKey(at, deps.timezone).slice(8, 10))
    for (let day = 1; day <= Math.min(today, MAX_STREAK); day += 1) {
      if (!sameRule(before.itemRuleForDay(day, month), after.itemRuleForDay(day, month))) return day
    }
    return null
  }

  function checkMonth(month: string): void {
    if (typeof month !== 'string' || !MONTH_KEY.test(month)) throw new ServiceError('INVALID_MONTH', `${String(month)} is not a month, YYYY-MM`)
    if (month < monthKey(now(), deps.timezone)) throw new ServiceError('MONTH_IN_PAST', `${month} is over; a past month cannot be changed`)
  }

  function refuseLocked(before: DailyGiftSchedule, after: DailyGiftSchedule, month: string): void {
    const day = lockedTier(before, after, month)
    if (day !== null) throw new ServiceError('TIER_LOCKED', `day ${String(day)} of ${month} has been reached; only later days can change`)
  }

  /** Every fixed item of `days` must be of a slot a check-in undo can strip. `days` has already passed the parser. */
  function refuseUnrevocable(month: string, days: Record<string, unknown>): void {
    for (const [day, rule] of Object.entries(days)) {
      const fixed = isRecord(rule) ? rule['fixed'] : undefined
      if (!Array.isArray(fixed)) continue
      for (const id of fixed as string[]) {
        const slot = deps.catalog.get(id)?.slot
        if (slot !== undefined && !FIXED_SLOTS.includes(slot)) {
          throw new ServiceError('INVALID_GIFTS', `invalid daily gift schedule ${DB_SOURCE}: month ${month} day ${day} grants ${id}, a ${slot} item, which a check-in undo cannot take back`)
        }
      }
    }
  }

  const store: GiftScheduleStore = {
    current: () => schedule,

    defaults: () => fileDefault,

    async months() {
      const rows = await readRows(deps.db)
      const byMonth = new Map<string, GiftMonthRow>()
      for (const [month, days] of Object.entries(fileMonths)) {
        byMonth.set(month, { month, days: isRecord(days) ? days : {}, source: 'file', updatedAt: null, updatedBy: null })
      }
      for (const row of rows) {
        byMonth.set(row.month, { month: row.month, days: isRecord(row.days) ? row.days : {}, source: 'db', updatedAt: row.updatedAt.getTime(), updatedBy: row.updatedBy })
      }
      return [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1))
    },

    async setMonth(tx, month, days, actorUserId) {
      checkMonth(month)
      const { schedule: before, valid } = build(await readRows(tx))
      let after: DailyGiftSchedule
      try {
        after = parseDailyGifts({ default: fileDefault, months: { ...fileMonths, ...valid, [month]: days } }, deps.catalog, DB_SOURCE)
      } catch (err) {
        throw new ServiceError('INVALID_GIFTS', messageOf(err))
      }
      // The parser has accepted `days`, so it is a record.
      refuseUnrevocable(month, days as Record<string, unknown>)
      refuseLocked(before, after, month)
      const at = new Date(now())
      await tx
        .insert(giftMonths)
        .values({ month, days, updatedAt: at, updatedBy: actorUserId })
        .onConflictDoUpdate({ target: giftMonths.month, set: { days, updatedAt: at, updatedBy: actorUserId } })
    },

    async clearMonth(tx, month) {
      checkMonth(month)
      const rows = await readRows(tx)
      if (!rows.some((row) => row.month === month)) return false
      const { schedule: before } = build(rows)
      const { schedule: after } = build(rows.filter((row) => row.month !== month))
      refuseLocked(before, after, month)
      await tx.delete(giftMonths).where(eq(giftMonths.month, month))
      return true
    },

    async reload() {
      schedule = build(await readRows(deps.db)).schedule
    },
  }
  // The rows already in the database apply from the first request on.
  await store.reload()
  return store
}
