/**
 * The check-in's item column, as data (spec 2026-10-12): `data/daily-gifts.json`.
 *
 * Until Plan 22 the column was code — `itemRuleForDay` in `daily-rules.ts`, with the day-28 pair a constant — so a
 * month with a different gift meant a commit and a deploy. It is a schedule now: a `default` that every month falls
 * back to, and `months`, keyed `YYYY-MM`, each overriding single tiers. An operator adds a month by editing the JSON and
 * restarting; no code and no database row changes (`docs/normal-server.md`, "Changing the daily gifts").
 *
 * A month's rule for a tier **replaces** the default's (spec Q5). A `fixed` list there is the whole list, written out in
 * full — `2026-11` names the badge and the title again beside the top hat — so what a tier gives is readable in one
 * place, and a month could drop the pair if it ever wanted to.
 *
 * `loadDailyGifts` refuses a file rather than degrading, as `loadAchievements` does: an id the catalogue does not hold
 * is a foreign-key violation on the 28th of some month, long after the edit; a tier the month never reaches, or a
 * misspelt month key, is a gift nobody will ever receive. All of them are cheap at boot and silent afterwards.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { packageRoot } from '../db/migrate.js'
import type { ItemCatalog } from '../inventory/items.js'
import { MAX_STREAK, type DailyItemRule } from './daily-rules.js'

/** One item the check-in hands out by name, and the first time it does so from a given month on (spec §4.4). */
export interface DailyGiftNotice {
  itemId: string
  /** The streak tier whose claim grants it, 1–31. */
  day: number
  /** `YYYY-MM` of the first month, the given one or later, whose own entry names it; `null` when the default names it. */
  month: string | null
}

export interface DailyGiftSchedule {
  /** Tier `day`'s rule in `month` (`YYYY-MM`): the month's own entry for that tier, else the default's, else none. */
  itemRuleForDay(day: number, month: string): DailyItemRule | null
  /** Every id a `fixed` list names — default or month, past or future: what the random tiers must never draw (Q8). */
  fixedItemIds(): readonly string[]
  /** Each item a `fixed` list names from `month` on, at its first tier and month; the default's come first, `month: null`. */
  noticesFrom(month: string): DailyGiftNotice[]
}

type Days = ReadonlyMap<number, DailyItemRule>

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/
/** 1–99 with no leading zero; the range is checked against `MAX_STREAK` separately, so the message can name it. */
const DAY_KEY = /^[1-9]\d?$/

export function defaultDailyGiftsPath(): string {
  return join(packageRoot(), 'data', 'daily-gifts.json')
}

function fail(source: string, problem: string): never {
  throw new Error(`invalid daily gift schedule ${source}: ${problem}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** How many days `YYYY-MM` has: a tier past it is one the streak can never reach that month. */
function daysInMonth(month: string): number {
  const [year, mon] = month.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(year, mon, 0)).getUTCDate()
}

function parseRule(source: string, where: string, raw: unknown, catalog: ItemCatalog): DailyItemRule {
  if (!isRecord(raw)) fail(source, `${where} is not an object`)
  const keys = Object.keys(raw)
  if (keys.length !== 1 || (keys[0] !== 'draw' && keys[0] !== 'fixed')) {
    fail(source, `${where} must have exactly one of "draw" or "fixed", not ${keys.length === 0 ? 'neither' : keys.join(' and ')}`)
  }
  if (keys[0] === 'draw') {
    const rarity = raw['draw']
    // No `epic` draw (spec Q6): every epic is promised by an achievement or by this schedule, so the pool would be
    // empty and the tier would pay the 10,000 fallback every time.
    if (rarity !== 'common' && rarity !== 'rare') fail(source, `${where} draws ${String(rarity)}; a draw is "common" or "rare"`)
    return { kind: 'randomUnowned', rarity }
  }
  const ids = raw['fixed']
  if (!Array.isArray(ids) || ids.length === 0) fail(source, `${where} has an empty or malformed "fixed" list`)
  const seen = new Set<string>()
  for (const id of ids) {
    if (typeof id !== 'string' || id === '') fail(source, `${where} has a malformed item id ${JSON.stringify(id)}`)
    if (seen.has(id)) fail(source, `${where} names ${id} twice`)
    const def = catalog.get(id)
    if (def === undefined) fail(source, `${where} grants ${id}, which is not in the item catalogue`)
    // A default or a free item is owned by every account already: the gift would be nothing.
    if (def.isDefault || def.free === true) fail(source, `${where} grants ${id}, which every player already owns`)
    seen.add(id)
  }
  return { kind: 'fixed', itemIds: [...seen] }
}

function parseDays(source: string, where: string, raw: unknown, catalog: ItemCatalog, lastDay: number): Days {
  if (!isRecord(raw)) fail(source, `${where} is not an object keyed by day`)
  const days = new Map<number, DailyItemRule>()
  for (const [key, value] of Object.entries(raw)) {
    const day = Number(key)
    if (!DAY_KEY.test(key) || day > MAX_STREAK) fail(source, `${where} has day ${key}; a day is 1 to ${MAX_STREAK}`)
    if (day > lastDay) fail(source, `${where} has day ${key}, which the month never reaches (it has ${lastDay} days)`)
    days.set(day, parseRule(source, `${where} day ${key}`, value, catalog))
  }
  return days
}

/** One item twice in a month — on two tiers, or on a tier of the month and one it keeps from the default — is a typo. */
function refuseRepeats(source: string, where: string, days: Days): void {
  const dayOf = new Map<string, number>()
  for (const [day, rule] of [...days].sort(([a], [b]) => a - b)) {
    if (rule.kind !== 'fixed') continue
    for (const id of rule.itemIds) {
      const earlier = dayOf.get(id)
      if (earlier !== undefined) fail(source, `${where} gives ${id} on day ${earlier} and day ${day}`)
      dayOf.set(id, day)
    }
  }
}

/**
 * Builds and checks a schedule from parsed JSON. `source` names it in every refusal. Duplicate month keys are not seen
 * here (JSON.parse has already dropped all but the last): only `loadDailyGifts`, which has the raw text, detects them.
 */
export function parseDailyGifts(raw: unknown, catalog: ItemCatalog, source = 'daily-gifts.json'): DailyGiftSchedule {
  if (!isRecord(raw)) fail(source, 'the file is not a JSON object')
  for (const key of Object.keys(raw)) {
    if (key !== 'default' && key !== 'months') fail(source, `unknown key ${key}; the file has "default" and "months"`)
  }
  if (raw['default'] === undefined) fail(source, 'there is no "default"')
  const base = parseDays(source, 'default', raw['default'], catalog, MAX_STREAK)
  refuseRepeats(source, 'default', base)

  const monthsRaw = raw['months'] ?? {}
  if (!isRecord(monthsRaw)) fail(source, '"months" is not an object keyed YYYY-MM')
  const months = new Map<string, Days>()
  for (const [month, days] of Object.entries(monthsRaw)) {
    if (!MONTH_KEY.test(month)) fail(source, `month ${month} is not YYYY-MM`)
    const own = parseDays(source, `month ${month}`, days, catalog, daysInMonth(month))
    // What the month really gives: the default, with the month's own tiers laid over it.
    refuseRepeats(source, `month ${month}`, new Map([...base, ...own]))
    months.set(month, own)
  }

  const fixedIds = new Set<string>()
  for (const days of [base, ...months.values()]) {
    for (const rule of days.values()) if (rule.kind === 'fixed') for (const id of rule.itemIds) fixedIds.add(id)
  }
  const monthOrder = [...months.keys()].sort()

  return {
    itemRuleForDay: (day, month) => months.get(month)?.get(day) ?? base.get(day) ?? null,
    fixedItemIds: () => [...fixedIds],
    noticesFrom(month) {
      const first = new Map<string, DailyGiftNotice>()
      const note = (days: Days, at: string | null): void => {
        for (const [day, rule] of [...days].sort(([a], [b]) => a - b)) {
          if (rule.kind !== 'fixed') continue
          for (const itemId of rule.itemIds) if (!first.has(itemId)) first.set(itemId, { itemId, day, month: at })
        }
      }
      // The default first (spec Q14): a gift of every month without an entry of its own is tied to none of them.
      note(base, null)
      for (const at of monthOrder) if (at >= month) note(months.get(at)!, at)
      return [...first.values()]
    },
  }
}

/** Reads and checks `data/daily-gifts.json` against the item catalogue. Throws, naming the file, on anything wrong. */
export function loadDailyGifts(catalog: ItemCatalog, path: string = defaultDailyGiftsPath()): DailyGiftSchedule {
  let text: string
  let parsed: unknown
  try {
    text = readFileSync(path, 'utf8')
    parsed = JSON.parse(text)
  } catch (err) {
    throw new Error(`could not read daily gift schedule ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
  // JSON.parse keeps the last of two equal keys without a word: a month copied and not renamed would replace the first.
  const keys = [...text.matchAll(/"(\d{4}-\d{2})"\s*:/g)].map((m) => m[1]!)
  const twice = keys.find((key, i) => keys.indexOf(key) !== i)
  if (twice !== undefined) throw new Error(`invalid daily gift schedule ${path}: month ${twice} appears twice`)
  return parseDailyGifts(parsed, catalog, path)
}
