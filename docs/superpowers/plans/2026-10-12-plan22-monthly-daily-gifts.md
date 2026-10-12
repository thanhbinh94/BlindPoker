# Monthly daily-check-in gifts — Implementation Plan (Plan 22)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The check-in's item column becomes data an operator edits month by month — `apps/normal-server/data/daily-gifts.json`, a `default` plus months keyed `YYYY-MM` — and the six epics nobody can earn today become the day-28 gift, one a month from 11/2026 (October 2026 unchanged). The claim reads the month it is made in, the Daily screen names each month's gifts, and the wardrobe's locked tiles name the month an item is handed out.

**Architecture:** A new pure-ish loader, `apps/normal-server/src/economy/daily-gifts.ts`, reads and checks the schedule against the item catalogue at boot and answers three questions: the rule of a tier in a month, every id the schedule names (kept off the random draw), and each named item's first outing from a month on (for the wardrobe). `economy-service.ts` takes the schedule as a dependency; the month-aware calendar rides on `GET /api/rewards/daily` (new `month`, new `items` per entry) and the wardrobe's notices on `GET /api/catalog/items` (new `dailyGifts`). `normal-web` names the gifts from those fields and drops its two hard-coded mirrors. `@bp/core`, server-kit, ui-kit and Lite do not change.

**Tech Stack:** TypeScript, Fastify, drizzle on PGlite for tests, React 18, i18next, vitest + @testing-library/react, Playwright (one assertion, and the throwaway preview). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-12-monthly-daily-gifts-design.md` (read it first; this plan argues from it — its Q-table holds the user's decisions Q1–Q4 and this plan's proposals Q5–Q17). Rules it amends: `docs/superpowers/specs/2026-09-04-bind-poker-design.md` §13.2, §19.2.

## Global Constraints

- The shipped schedule is the user's decision (spec Q1, Q2): October 2026 keeps today's column; day 28 of 11/2026, 12/2026, 01/2027, 02/2027, 03/2027, 04/2027 adds `head_tophat01`, `face_eyepatch01`, `aura_lightning01`, `frame_gold`, `haircolor_lavender01`, `eyecolor_gold01`, in that order. No task changes those months.
- A month's rule for a tier **replaces** the default's (spec Q5): a month's `fixed` list is written out in full.
- Draws are `common` or `rare` only (spec Q6). Every id any `fixed` list names, past months included, stays off the random draw (spec Q8).
- No money path changes (spec §7): points stay `DAILY_REWARD_POINTS` in `@bp/core`; the 10,000 fallback stays the random tiers' alone; a fixed gift already owned pays nothing. No DB migration.
- `@bp/core`, `@bp/server-kit`, `@bp/ui-kit`, `@bp/http-kit` and `apps/lite` are not touched (spec §5.3).
- Every player-facing string exists in both `apps/normal-web/src/locales/vi/normal.json` and `en/normal.json`. Edit the locale files and every Vietnamese doc with the Edit tool, never a scripted splice, and read a Vietnamese heading back afterwards.
- Test titles written here are cited verbatim by Task 4 (`docs/test-matrix.md`, `docs/acceptance-checklist.md`). Do not reword a title without changing both docs in the same commit.
- No new e2e test that registers (10 sign-ups a minute per address, and `pnpm e2e:normal` is close to it). Task 3 adds one assertion to an existing test; the preview spec is throwaway, run on its own and deleted before the commit.
- Commit after every task. Before each commit run `pnpm typecheck` and `pnpm lint`; in the Bash tool start with `export PATH="$PATH:$(npm prefix -g)"`. Stage files by name (`other/` is untracked and must never be committed).

---

## File structure

| File | Responsibility |
|---|---|
| `apps/normal-server/data/daily-gifts.json` (new) | the schedule: `default` and `months` |
| `apps/normal-server/src/economy/daily-gifts.ts` (new) | `parseDailyGifts`, `loadDailyGifts` → `DailyGiftSchedule { itemRuleForDay, fixedItemIds, noticesFrom }`, `DailyGiftNotice` |
| `apps/normal-server/src/economy/daily-rules.ts` | `itemMarker(rule)`, `CalendarEntry.items`, `dailyCalendar(gifts, month)`; `DAILY_FIXED_ITEM_IDS` and `itemRuleForDay` go |
| `apps/normal-server/src/economy/economy-service.ts` | `gifts` dependency, the claim's month, `DailyStatus.month`, `dailyGiftNotices()` |
| `apps/normal-server/src/inventory/items.ts` | the catalogue's own day-28 check goes (the schedule's loader checks every id) |
| `apps/normal-server/src/app.ts`, `src/http/routes.ts`, `src/http/routes-catalog.ts` | load the schedule at boot; `GET /api/catalog/items` carries `dailyGifts` |
| `apps/normal-server/scripts/build.mjs`, `test/build.test.ts` | `data/daily-gifts.json` is a sidecar the run time needs |
| `apps/normal-web/src/api.ts` | `CalendarEntryDto.items`, `DailyStatusDto.month`, `DailyGiftNoticeDto`, `CatalogItemsDto` |
| `apps/normal-web/src/screens/DailyScreen.tsx`, `normal.module.css` | a fixed day named by its gifts; the legend by month |
| `apps/normal-web/src/screens/format.ts` (+ new `format.test.ts`) | `formatMonthKey` |
| `apps/normal-web/src/screens/catalog.ts`, `wardrobe/{WardrobeScreen,ItemTab,ColourTab,HairStyleTab}.tsx` | `hintFor(item, { achievements, gifts }, t)`, the `hints` prop |
| `apps/normal-web/src/locales/{vi,en}/normal.json` | `daily.marker.fixedDay`, `wardrobe.hint.dailyMonth`, `wardrobe.hint.dailyFixed` as a template; `daily.marker.monthly` goes |
| `apps/normal-web/e2e/normal.spec.ts` | one assertion: the legend's day-28 line on the real build |
| `docs/…`, `deploy/normal-windows/README.md`, `tooling/arch/acceptance-links.test.ts`, `CLAUDE.md` | documentation and the citation pins |

Task sizes: Task 1 M, Task 2 L, Task 3 L, Task 4 M.

---

### Task 1: The schedule as data — `daily-gifts.json`, its loader and its checks

Additive: nothing reads the schedule yet, so every commit stays green.

**Files:**
- Create: `apps/normal-server/data/daily-gifts.json`
- Create: `apps/normal-server/src/economy/daily-gifts.ts`
- Test: `apps/normal-server/src/economy/daily-gifts.test.ts` (new)
- Modify: `apps/normal-server/scripts/build.mjs:67` (`SIDECARS`) and `:213` (the sidecar log line)
- Modify: `apps/normal-server/test/build.test.ts:134`

**Interfaces:**
- Consumes: `MAX_STREAK`, `type DailyItemRule` from `./daily-rules.js` (unchanged in this task); `type ItemCatalog` from `../inventory/items.js`; `packageRoot` from `../db/migrate.js`.
- Produces: `interface DailyGiftNotice { itemId: string; day: number; month: string | null }`; `interface DailyGiftSchedule { itemRuleForDay(day: number, month: string): DailyItemRule | null; fixedItemIds(): readonly string[]; noticesFrom(month: string): DailyGiftNotice[] }`; `parseDailyGifts(raw: unknown, catalog: ItemCatalog, source?: string): DailyGiftSchedule`; `loadDailyGifts(catalog: ItemCatalog, path?: string): DailyGiftSchedule`; `defaultDailyGiftsPath(): string`.

- [ ] **Step 1: Write the failing tests**

Create `apps/normal-server/src/economy/daily-gifts.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadItemCatalog } from '../inventory/items.js'
import { loadDailyGifts, parseDailyGifts } from './daily-gifts.js'

const catalog = loadItemCatalog()

/** Today's item column, as the shipped `default` writes it. */
const DEFAULT = {
  '7': { draw: 'common' },
  '14': { draw: 'rare' },
  '21': { draw: 'rare' },
  '28': { fixed: ['badge_monthly', 'title_devoted'] },
}
const PAIR = ['badge_monthly', 'title_devoted']
const COMMON = { kind: 'randomUnowned', rarity: 'common' }
const RARE = { kind: 'randomUnowned', rarity: 'rare' }

const parse = (raw: unknown) => parseDailyGifts(raw, catalog, 'test')
/** The default above, plus the given months. */
const withMonths = (months: Record<string, unknown>) => parse({ default: DEFAULT, months })

describe('the shipped schedule, data/daily-gifts.json', () => {
  // The operator's check before a restart is this file (spec 2026-10-12 §4.5): it loads the real schedule against the
  // real catalogue, so a typo fails here, with the same message the server would stop on.
  const shipped = loadDailyGifts(catalog)

  it('keeps the October 2026 calendar as it was: a common on 7, a rare on 14 and 21, the badge and the title on 28', () => {
    expect(shipped.itemRuleForDay(7, '2026-10')).toEqual(COMMON)
    expect(shipped.itemRuleForDay(14, '2026-10')).toEqual(RARE)
    expect(shipped.itemRuleForDay(21, '2026-10')).toEqual(RARE)
    expect(shipped.itemRuleForDay(28, '2026-10')).toEqual({ kind: 'fixed', itemIds: PAIR })
    for (const day of [1, 6, 8, 13, 15, 20, 22, 27, 29, 31]) expect(shipped.itemRuleForDay(day, '2026-10'), String(day)).toBeNull()
  })

  it('hands out the six epics on day 28, one a month from 11/2026, in the order the user chose', () => {
    const order: [string, string][] = [
      ['2026-11', 'head_tophat01'],
      ['2026-12', 'face_eyepatch01'],
      ['2027-01', 'aura_lightning01'],
      ['2027-02', 'frame_gold'],
      ['2027-03', 'haircolor_lavender01'],
      ['2027-04', 'eyecolor_gold01'],
    ]
    for (const [month, epic] of order) {
      expect(shipped.itemRuleForDay(28, month), month).toEqual({ kind: 'fixed', itemIds: [...PAIR, epic] })
      // Only day 28 changes: the month's draws are the default's.
      expect(shipped.itemRuleForDay(7, month), month).toEqual(COMMON)
      expect(shipped.itemRuleForDay(14, month), month).toEqual(RARE)
      expect(shipped.itemRuleForDay(21, month), month).toEqual(RARE)
      expect(catalog.get(epic), epic).toMatchObject({ rarity: 'epic' })
    }
  })
})

describe('resolving a day', () => {
  it('falls back to the default for a month with no entry, and for a day the month does not name', () => {
    const gifts = withMonths({ '2026-11': { '28': { fixed: [...PAIR, 'head_tophat01'] } } })
    expect(gifts.itemRuleForDay(28, '2026-12')).toEqual({ kind: 'fixed', itemIds: PAIR })
    expect(gifts.itemRuleForDay(7, '2026-11')).toEqual(COMMON)
    expect(gifts.itemRuleForDay(3, '2026-11')).toBeNull()
  })

  it('lets a month replace a day of the default outright: its fixed list is the whole list', () => {
    const gifts = withMonths({ '2026-11': { '7': { draw: 'rare' }, '10': { fixed: ['face_eyepatch01'] }, '28': { fixed: ['head_tophat01'] } } })
    expect(gifts.itemRuleForDay(28, '2026-11')).toEqual({ kind: 'fixed', itemIds: ['head_tophat01'] })
    expect(gifts.itemRuleForDay(7, '2026-11')).toEqual(RARE)
    expect(gifts.itemRuleForDay(10, '2026-11')).toEqual({ kind: 'fixed', itemIds: ['face_eyepatch01'] })
  })

  it('lists every fixed id, default or month, past or future, for the draw to leave alone', () => {
    const gifts = withMonths({
      '2025-01': { '28': { fixed: [...PAIR, 'frame_gold'] } },
      '2026-11': { '28': { fixed: [...PAIR, 'head_tophat01'] } },
    })
    expect([...gifts.fixedItemIds()].sort()).toEqual(['badge_monthly', 'frame_gold', 'head_tophat01', 'title_devoted'])
  })

  it('tells the wardrobe the first month from a given one that gives each named item, the default first', () => {
    const gifts = withMonths({
      '2026-11': { '28': { fixed: [...PAIR, 'head_tophat01'] } },
      '2026-12': { '28': { fixed: [...PAIR, 'face_eyepatch01'] } },
      '2027-03': { '14': { fixed: ['head_tophat01'] } },
    })
    expect(gifts.noticesFrom('2026-10')).toEqual([
      { itemId: 'badge_monthly', day: 28, month: null },
      { itemId: 'title_devoted', day: 28, month: null },
      { itemId: 'head_tophat01', day: 28, month: '2026-11' },
      { itemId: 'face_eyepatch01', day: 28, month: '2026-12' },
    ])
    // November is November until it ends; after it, the top hat's next outing is March, on day 14.
    expect(gifts.noticesFrom('2026-11').find((n) => n.itemId === 'head_tophat01')).toEqual({ itemId: 'head_tophat01', day: 28, month: '2026-11' })
    expect(gifts.noticesFrom('2026-12').find((n) => n.itemId === 'head_tophat01')).toEqual({ itemId: 'head_tophat01', day: 14, month: '2027-03' })
    // Past every dated month, only the default's gifts are left to promise.
    expect(gifts.noticesFrom('2027-04').map((n) => n.itemId)).toEqual(PAIR)
  })
})

describe('refusing a bad file', () => {
  it('refuses an item the catalogue does not hold', () => {
    expect(() => withMonths({ '2026-11': { '28': { fixed: [...PAIR, 'head_nonexistent01'] } } })).toThrow(
      /invalid daily gift schedule test: month 2026-11 day 28 grants head_nonexistent01, which is not in the item catalogue/,
    )
  })

  it('refuses an item every player already owns', () => {
    // The default outfit (`isDefault`) and a free hairstyle (`free`): granting either would be a gift of nothing.
    expect(() => withMonths({ '2026-11': { '28': { fixed: ['outfit_casual01'] } } })).toThrow(/grants outfit_casual01, which every player already owns/)
    expect(() => withMonths({ '2026-11': { '28': { fixed: ['hair_f_bob01'] } } })).toThrow(/grants hair_f_bob01, which every player already owns/)
  })

  it('refuses a day outside 1 to 31, and a day the month never reaches', () => {
    for (const day of ['0', '32', '07', 'x']) {
      expect(() => withMonths({ '2026-11': { [day]: { draw: 'common' } } }), day).toThrow(new RegExp(`month 2026-11 has day ${day}; a day is 1 to 31`))
    }
    expect(() => withMonths({ '2027-02': { '29': { fixed: ['frame_gold'] } } })).toThrow(/month 2027-02 has day 29, which the month never reaches \(it has 28 days\)/)
    expect(() => withMonths({ '2026-11': { '31': { fixed: ['frame_gold'] } } })).toThrow(/month 2026-11 has day 31, which the month never reaches \(it has 30 days\)/)
    // The default may name 29 to 31: a long month reaches them.
    expect(() => parse({ default: { ...DEFAULT, '31': { draw: 'common' } } })).not.toThrow()
  })

  it('refuses the same item twice in a day, or on two days of one month', () => {
    expect(() => withMonths({ '2026-11': { '28': { fixed: ['frame_gold', 'frame_gold'] } } })).toThrow(/month 2026-11 day 28 names frame_gold twice/)
    // Day 14 of the month and day 28 of the default it keeps: one month, the badge twice.
    expect(() => withMonths({ '2026-11': { '14': { fixed: ['badge_monthly'] } } })).toThrow(/month 2026-11 gives badge_monthly on day 14 and day 28/)
    expect(() => parse({ default: { ...DEFAULT, '7': { fixed: ['title_devoted'] } } })).toThrow(/default gives title_devoted on day 7 and day 28/)
  })

  it('refuses a draw that is not common or rare, and a rule that is neither a draw nor a list', () => {
    expect(() => withMonths({ '2026-11': { '7': { draw: 'epic' } } })).toThrow(/month 2026-11 day 7 draws epic; a draw is "common" or "rare"/)
    expect(() => withMonths({ '2026-11': { '7': { draw: 'common', fixed: ['frame_gold'] } } })).toThrow(/must have exactly one of "draw" or "fixed", not draw and fixed/)
    expect(() => withMonths({ '2026-11': { '7': {} } })).toThrow(/must have exactly one of "draw" or "fixed", not neither/)
    expect(() => withMonths({ '2026-11': { '28': { gift: ['frame_gold'] } } })).toThrow(/must have exactly one of "draw" or "fixed", not gift/)
    expect(() => withMonths({ '2026-11': { '28': { fixed: [] } } })).toThrow(/month 2026-11 day 28 has an empty or malformed "fixed" list/)
  })

  it('refuses a malformed month key, an unknown top-level key and a missing default', () => {
    for (const month of ['2026-13', '2026-1', '26-11', 'november']) {
      expect(() => withMonths({ [month]: { '28': { fixed: ['frame_gold'] } } }), month).toThrow(new RegExp(`month ${month} is not YYYY-MM`))
    }
    expect(() => parse({ default: DEFAULT, month: {} })).toThrow(/unknown key month; the file has "default" and "months"/)
    expect(() => parse({ months: {} })).toThrow(/there is no "default"/)
    expect(() => parse([])).toThrow(/the file is not a JSON object/)
  })

  it('says which file could not be read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bp-gifts-'))
    try {
      const path = join(dir, 'daily-gifts.json')
      writeFileSync(path, '{ "default": ', 'utf8')
      expect(() => loadDailyGifts(catalog, path)).toThrow(/could not read daily gift schedule .*daily-gifts\.json/)
      writeFileSync(path, JSON.stringify({ default: DEFAULT, months: { '2026-11': { '28': { fixed: ['nope01'] } } } }), 'utf8')
      expect(() => loadDailyGifts(catalog, path)).toThrow(/invalid daily gift schedule .*daily-gifts\.json: month 2026-11 day 28 grants nope01/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @bp/normal-server exec vitest run src/economy/daily-gifts.test.ts`
Expected: FAIL — `Failed to resolve import "./daily-gifts.js"`.

- [ ] **Step 3: The data file**

Create `apps/normal-server/data/daily-gifts.json` (spec §4.1.1, verbatim):

```json
{
  "default": {
    "7": { "draw": "common" },
    "14": { "draw": "rare" },
    "21": { "draw": "rare" },
    "28": { "fixed": ["badge_monthly", "title_devoted"] }
  },
  "months": {
    "2026-11": { "28": { "fixed": ["badge_monthly", "title_devoted", "head_tophat01"] } },
    "2026-12": { "28": { "fixed": ["badge_monthly", "title_devoted", "face_eyepatch01"] } },
    "2027-01": { "28": { "fixed": ["badge_monthly", "title_devoted", "aura_lightning01"] } },
    "2027-02": { "28": { "fixed": ["badge_monthly", "title_devoted", "frame_gold"] } },
    "2027-03": { "28": { "fixed": ["badge_monthly", "title_devoted", "haircolor_lavender01"] } },
    "2027-04": { "28": { "fixed": ["badge_monthly", "title_devoted", "eyecolor_gold01"] } }
  }
}
```

- [ ] **Step 4: The loader**

Create `apps/normal-server/src/economy/daily-gifts.ts`:

```ts
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

/** Builds and checks a schedule from parsed JSON. `source` names it in every refusal. */
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
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`could not read daily gift schedule ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
  return parseDailyGifts(parsed, catalog, path)
}
```

If `tsc` refuses `return { kind: 'randomUnowned', rarity }` (a `'common' | 'rare'` property against the two-member union `DailyItemRule`), write the two literals out: `return rarity === 'common' ? { kind: 'randomUnowned', rarity: 'common' } : { kind: 'randomUnowned', rarity: 'rare' }`.

- [ ] **Step 5: The build ships the file**

In `apps/normal-server/scripts/build.mjs`, line 67:

```js
const SIDECARS = ['drizzle/meta/_journal.json', 'data/items.json', 'data/achievements.json', 'data/avatar-bodies.json', 'data/daily-gifts.json']
```

and the log line in `verifySidecars` (line 213):

```js
  log(`sidecars: drizzle/ (${migrations.length} migration${migrations.length === 1 ? '' : 's'}), data/items.json, data/achievements.json, data/avatar-bodies.json, data/daily-gifts.json`)
```

In `apps/normal-server/test/build.test.ts`, line 134, add `'data/daily-gifts.json'` after `'data/avatar-bodies.json'`.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @bp/normal-server exec vitest run src/economy/daily-gifts.test.ts test/build.test.ts`
Expected: PASS (the build test takes about 15 s: it runs the real build).
Then `pnpm typecheck` and `pnpm lint`. Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/normal-server/data/daily-gifts.json apps/normal-server/src/economy/daily-gifts.ts apps/normal-server/src/economy/daily-gifts.test.ts apps/normal-server/scripts/build.mjs apps/normal-server/test/build.test.ts
git commit -m "feat(normal-server): the daily gift schedule as data — data/daily-gifts.json, checked against the catalogue at load, the six epics on day 28 from 11/2026 (spec 2026-10-12)"
```

---

### Task 2: The server reads it — the claim, the month's calendar, the wardrobe's notices

**Files:**
- Modify: `apps/normal-server/src/economy/daily-rules.ts`, test `daily-rules.test.ts`
- Modify: `apps/normal-server/src/economy/economy-service.ts`, test `economy-service.test.ts`
- Modify: `apps/normal-server/src/inventory/items.ts:19-23,36,404-406`, test `items.test.ts`
- Modify: `apps/normal-server/src/app.ts`, `apps/normal-server/src/http/routes.ts:188`, `apps/normal-server/src/http/routes-catalog.ts`
- Test: `apps/normal-server/src/http/routes-rewards.test.ts`, `apps/normal-server/src/app.test.ts`

**Interfaces:**
- Consumes: Task 1's `DailyGiftSchedule`, `DailyGiftNotice`, `loadDailyGifts`, `parseDailyGifts`.
- Produces: `itemMarker(rule: DailyItemRule | null): string | null`; `CalendarEntry { day; points; item: string | null; items: string[] }`; `dailyCalendar(gifts: Pick<DailyGiftSchedule, 'itemRuleForDay'>, month: string): CalendarEntry[]`; `EconomyServiceDeps.gifts: DailyGiftSchedule` (required); `DailyStatus.month: string`; `EconomyService.dailyGiftNotices(now?: number): DailyGiftNotice[]`; `AppServices.gifts`; `CatalogRouteDeps.dailyGifts: () => DailyGiftNotice[]`; `GET /api/catalog/items` → `{ items, dailyGifts }`. Removed: `DAILY_FIXED_ITEM_IDS`, `itemRuleForDay(day)`, `itemMarkerForDay(day)`, `dailyCalendar()` with no arguments.

- [ ] **Step 1: Write the failing tests**

(a) `apps/normal-server/src/economy/daily-rules.test.ts`. In the import list drop `DAILY_FIXED_ITEM_IDS`, `itemMarkerForDay`, `itemRuleForDay`; add `itemMarker` and `type DailyItemRule`. Delete the test `hands out a common on day 7, a rare on 14 and 21, and the fixed pair on 28` (Task 1's `daily-gifts.test.ts` holds that rule now), and replace `builds a 31-day calendar whose item column marks exactly the four item days` with:

```ts
  it('builds the 31-day calendar of a month: the rarity on a draw day, the first id and the whole list on a fixed day', () => {
    const rules: Record<number, DailyItemRule> = {
      7: { kind: 'randomUnowned', rarity: 'common' },
      14: { kind: 'randomUnowned', rarity: 'rare' },
      28: { kind: 'fixed', itemIds: ['badge_monthly', 'title_devoted', 'head_tophat01'] },
    }
    const asked = new Set<string>()
    const calendar = dailyCalendar(
      {
        itemRuleForDay: (day, month) => {
          asked.add(month)
          return rules[day] ?? null
        },
      },
      '2026-11',
    )
    expect(calendar).toHaveLength(31)
    // Every tier is read from the one month asked for.
    expect([...asked]).toEqual(['2026-11'])
    expect(calendar[0]).toEqual({ day: 1, points: 5_000, item: null, items: [] })
    expect(calendar[6]).toEqual({ day: 7, points: 15_000, item: 'common', items: [] })
    expect(calendar[13]).toMatchObject({ day: 14, item: 'rare', items: [] })
    expect(calendar[27]).toEqual({ day: 28, points: 40_000, item: 'badge_monthly', items: ['badge_monthly', 'title_devoted', 'head_tophat01'] })
    expect(calendar.filter((d) => d.item !== null).map((d) => d.day)).toEqual([7, 14, 28])
  })

  it('labels a tier by its rule: the rarity a draw will draw, the first id a fixed list grants, nothing for none', () => {
    expect(itemMarker({ kind: 'randomUnowned', rarity: 'rare' })).toBe('rare')
    expect(itemMarker({ kind: 'fixed', itemIds: ['badge_monthly', 'title_devoted'] })).toBe('badge_monthly')
    expect(itemMarker(null)).toBeNull()
  })
```

(b) `apps/normal-server/src/economy/economy-service.test.ts`.

Replace `import { DAILY_FIXED_ITEM_IDS } from './daily-rules.js'` with `import { parseDailyGifts, type DailyGiftSchedule } from './daily-gifts.js'`. Change the `reserved` doc comment to `/** Every id the random tiers must not draw: the schedule's named gifts plus every achievement's item reward. */`, and declare `let gifts: DailyGiftSchedule` beside it. In `beforeAll`, right after `catalog = loadItemCatalog()`:

```ts
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
```

then `reserved = new Set([...gifts.fixedItemIds(), ...rewardItemIds])`, and add `gifts,` to all three `createEconomyService({ … })` calls in the file (the shared `economy`, `withReservation` and `hcm`).

In `grants the month badge and the devoted title on day 28, and pays no fallback for a repeat` (title unchanged), move the repeat from November — which now has a third gift — to December:

```ts
      // A month later — December, whose day 28 is the default's — already owning both: nothing is granted and —
      // unlike the random tiers — nothing is paid in their place.
      await db
        .update(dailyLogins)
        .set({ streak: 27, lastClaimDate: '2026-12-27', month: '2026-12', claimedDays: 27 })
        .where(eq(dailyLogins.playerId, playerId))
      expect(await economy.claimDaily(playerId, Date.UTC(2026, 11, 28, 12, 0))).toMatchObject({
```

(the rest of that test unchanged). Add right after it, inside `describe('the item column')`:

```ts
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
```

Add to `describe('dailyStatus')`:

```ts
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
```

(c) `apps/normal-server/src/http/routes-rewards.test.ts`. Add the imports `import { eq } from 'drizzle-orm'` and `import { dailyLogins } from '../db/schema.js'`, and below `DAY_1_POINTS`:

```ts
/** 10:00 on 28 November 2026 in Asia/Ho_Chi_Minh, the harness's zone: day 28 of the first month with a third gift. */
const NOV_28 = Date.UTC(2026, 10, 28, 3, 0)
/**
 * An account made on the day itself. `me` signed in at `START` (September), and a session lasts 30 days, so after
 * the clock jumps to November only a fresh sign-up still has one.
 */
const LATE = { email: 'late@example.com', password: 'a good password', displayName: 'Khach Thang 11' }
```

and inside `describe('the daily reward')`:

```ts
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
```

(d) `apps/normal-server/src/app.test.ts`, in `describe('GET /api/config')`, right after the test `serves the catalogues without a session, because they are the same for everyone`:

```ts
  it('serves the named daily gifts beside the catalogue, from the current month on', async () => {
    const h = await harness()
    type Gifts = { dailyGifts: { itemId: string; day: number; month: string | null }[] }
    const before = (await h.app.fastify.inject('/api/catalog/items')).json() as Gifts
    // September 2026 (the harness's START): the pair every month gives, then the six epics, one a month from November.
    expect(before.dailyGifts.slice(0, 2)).toEqual([
      { itemId: 'badge_monthly', day: 28, month: null },
      { itemId: 'title_devoted', day: 28, month: null },
    ])
    expect(before.dailyGifts.find((g) => g.itemId === 'head_tophat01')).toEqual({ itemId: 'head_tophat01', day: 28, month: '2026-11' })
    expect(before.dailyGifts.find((g) => g.itemId === 'eyecolor_gold01')).toEqual({ itemId: 'eyecolor_gold01', day: 28, month: '2027-04' })

    // December: November's top hat is no longer promised; the eyepatch is this month's.
    h.setNow(Date.UTC(2026, 11, 2, 3, 0))
    const later = (await h.app.fastify.inject('/api/catalog/items')).json() as Gifts
    expect(later.dailyGifts.map((g) => g.itemId)).not.toContain('head_tophat01')
    expect(later.dailyGifts.find((g) => g.itemId === 'face_eyepatch01')).toEqual({ itemId: 'face_eyepatch01', day: 28, month: '2026-12' })
  })
```

(e) `apps/normal-server/src/inventory/items.test.ts`. Drop the `DAILY_FIXED_ITEM_IDS` import. In `contains every id the daily reward and the achievements promise, in its v3 slot` (title unchanged — `docs/acceptance-checklist.md` row 66.19 cites it), replace `...DAILY_FIXED_ITEM_IDS,` with `'badge_monthly', 'title_devoted',`. Delete the test `refuses a catalogue the day-28 reward could not be paid from` (Task 1's `refuses an item the catalogue does not hold` is its successor), and in `runs every hairstyle check after the checks that exist today (pre-flight #6)` delete the line `expect(() => loadItemCatalog(fixture(NO_HAIR.filter((d) => d.id !== 'badge_monthly')), MANIFEST)).toThrow(/badge_monthly, which is not in the catalogue/)`. In the `MINIMAL` doc comment, change "the default outfit, what the day-28 reward pays, and the two `DEFAULT_HAIR` styles" to "the default outfit, the day-28 pair (kept so the fixture reads like `items.json`; the catalogue no longer insists on it — `loadDailyGifts` does), and the two `DEFAULT_HAIR` styles".

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @bp/normal-server exec vitest run src/economy src/inventory/items.test.ts src/http/routes-rewards.test.ts src/app.test.ts`
Expected: FAIL — `itemMarker` is not exported, `createEconomyService` knows no `gifts`, `month` and `items` are undefined, `dailyGifts` is undefined, `dailyGiftNotices` is not a function.

- [ ] **Step 3: `daily-rules.ts`**

Delete `DAILY_FIXED_ITEM_IDS` (lines 23–24), `itemRuleForDay` (lines 147–153) and `itemMarkerForDay` (lines 155–166). Keep `DailyItemRule`. Add `import type { DailyGiftSchedule } from './daily-gifts.js'` below the `@bp/core` import (type-only, so the two modules do not import each other at run time). Replace `CalendarEntry` and `dailyCalendar` with:

```ts
/**
 * A tier's item column as a label (spec 2026-10-12 §4.3): the *rarity* a draw will draw — the item itself is decided
 * against the player's inventory at the moment of the claim — or the first id a fixed list grants. A client reads a
 * fixed tier's whole list from `CalendarEntry.items`; `item` stays for a client that predates it.
 */
export function itemMarker(rule: DailyItemRule | null): string | null {
  if (rule === null) return null
  return rule.kind === 'fixed' ? (rule.itemIds[0] ?? null) : rule.rarity
}

export interface CalendarEntry {
  day: number
  points: number
  /** The marker: a rarity on a draw day, the first id on a fixed day, null on a points-only day. */
  item: string | null
  /** Every item a fixed day grants, in the schedule's order; empty on any other day. */
  items: string[]
}

/** The schedule of `month` (`YYYY-MM`), days 1…31 — the same for every player, and a fresh array on every call. */
export function dailyCalendar(gifts: Pick<DailyGiftSchedule, 'itemRuleForDay'>, month: string): CalendarEntry[] {
  return Array.from({ length: MAX_STREAK }, (_, i) => {
    const day = i + 1
    const rule = gifts.itemRuleForDay(day, month)
    return { day, points: rewardForDay(day), item: itemMarker(rule), items: rule?.kind === 'fixed' ? [...rule.itemIds] : [] }
  })
}
```

- [ ] **Step 4: `economy-service.ts`**

Imports from `./daily-rules.js`: drop `DAILY_FIXED_ITEM_IDS`, `itemMarkerForDay` and `itemRuleForDay`; add `itemMarker`; keep the rest (`dailyCalendar`, `dayKey`, `monthKey`, `nextDayStartMs`, `nextStreak`, `NO_ITEM_FALLBACK_POINTS`, `reliefEligible`, `rewardForDay`, `type CalendarEntry`, `type ReliefRefusal`). Add `import type { DailyGiftNotice, DailyGiftSchedule } from './daily-gifts.js'`.

`DailyStatus`: replace the `item` doc and add `month` before `calendar`:

```ts
  /** The tier's item column as a marker — a rarity for a draw, the first id for a fixed gift (its calendar row's `items` has them all). */
  item: string | null
  /** The instant the next local day begins, so the client can count down to it. */
  nextResetAt: number
  /** `YYYY-MM` in the economy timezone: the month `calendar` describes, and the one a claim made now is paid from. */
  month: string
  calendar: CalendarEntry[]
```

`EconomyService`: add

```ts
  /** The items the gift schedule names from this month on, for the wardrobe's hint (spec 2026-10-12 §4.4). The same for everyone. */
  dailyGiftNotices(now?: number): DailyGiftNotice[]
```

`EconomyServiceDeps`: change the last paragraph of the `reservedItemIds` doc to `Every id the gift schedule names is excluded regardless: it is this module's own promise to keep.`, and add

```ts
  /**
   * The check-in's item column — `data/daily-gifts.json` through `loadDailyGifts` (spec 2026-10-12): what each tier
   * draws or grants, month by month.
   */
  gifts: DailyGiftSchedule
```

In `createEconomyService`: delete `const calendar = dailyCalendar()`. Replace the `excludedIds` comment and line with:

```ts
  /**
   * What the random tiers may not draw, settled once at wiring time.
   *
   * Every id the gift schedule names first — in any month, past or future (spec Q8): a day-14 draw that took
   * `badge_monthly` would leave day 28 with nothing to grant and — correctly, since the fallback belongs to the random
   * tiers only — nothing to pay in its place, so a full 28-day streak would quietly be worth less than the schedule
   * says. The same argument covers every achievement reward: an item handed out by chance is one a player can no
   * longer earn.
   */
  const excludedIds: readonly string[] = [...new Set([...deps.gifts.fixedItemIds(), ...(deps.reservedItemIds ?? [])])]
```

`applyItemRule` gains the claim's month, after `day`:

```ts
  async function applyItemRule(
    tx: AppTx,
    playerId: string,
    day: number,
    month: string,
    refId: string,
    entries: BalanceEntry[],
  ): Promise<{ items: string[]; fallbackPoints: number }> {
    // The month of the claim, not of whatever calendar the player last looked at (spec 2026-10-12 §4.2).
    const rule = deps.gifts.itemRuleForDay(day, month)
```

and in its fixed branch change the guard's comment to `Guard rather than trust: \`loadDailyGifts\` already refuses a schedule naming an id the catalogue lacks, so this only fires for a hand-built catalog, and a missing row would be a foreign-key error.` Its doc comment's "Day 28 grants two named items" becomes "A fixed tier grants its named items".

`dailyStatus`: compute `const month = monthKey(nowMs, deps.timezone)` after `today`, and return

```ts
      return {
        claimable: !outcome.alreadyClaimed,
        day: outcome.day,
        streak: outcome.streak,
        reward: outcome.points,
        item: itemMarker(deps.gifts.itemRuleForDay(outcome.day, month)),
        nextResetAt: nextDayStartMs(nowMs, deps.timezone),
        month,
        // Built per call, for this month: the schedule may differ month to month, and a fresh array also means one
        // caller decorating an entry can never rewrite the calendar another response carries.
        calendar: dailyCalendar(deps.gifts, month),
      }
```

`claimDaily`: `await applyItemRule(tx, playerId, outcome.day, month, refId, entries)` (`month` is already computed there).

Add after `claimDaily`:

```ts
    dailyGiftNotices(at) {
      return deps.gifts.noticesFrom(monthKey(at ?? now(), deps.timezone))
    },
```

- [ ] **Step 5: `items.ts`**

Delete `import { DAILY_FIXED_ITEM_IDS } from '../economy/daily-rules.js'` and the loop

```ts
  for (const id of DAILY_FIXED_ITEM_IDS) {
    if (!byId.has(id)) fail(path, `the day-28 daily reward grants ${id}, which is not in the catalogue`)
  }
```

In the header comment, replace the sentence running from "`loadItemCatalog` refuses a file rather than degrading" to "offer and the stage could never draw." with:

```ts
 * `loadItemCatalog` refuses a file rather than degrading, the same reasons as before: a duplicate id
 * silently shadowing an item, a missing default leaving new accounts with nothing to wear — and now, an
 * `asset.file` the manifest never produced, which is a catalogue entry the wardrobe would offer and the
 * stage could never draw. (Whether the check-in's gifts exist is `loadDailyGifts`' question since Plan 22:
 * the schedule names them, so the schedule's loader checks them, every month's.)
```

- [ ] **Step 6: Wiring — `app.ts`, `routes.ts`, `routes-catalog.ts`**

`app.ts`: import `import { loadDailyGifts, type DailyGiftSchedule } from './economy/daily-gifts.js'`. After `const defs = loadAchievements(catalog)`:

```ts
  // Checked against the catalogue it names, before anything is seeded: a bad schedule stops the boot here, with its
  // file and its problem in the message (spec 2026-10-12 §6).
  const gifts = loadDailyGifts(catalog)
```

Pass `gifts,` to `createEconomyService({ … })` (after `catalog,`). Add `gifts: DailyGiftSchedule` to `AppServices` (after `defs`, doc `/** The check-in's gift schedule — \`data/daily-gifts.json\`, checked at boot. */`) and `gifts` to the `services: { … }` object (after `defs`). In the file's header comment, point 3 gains a last sentence: "The gift schedule's named items are kept off it too — the economy reads them from the schedule itself."

`routes-catalog.ts`: import `import type { DailyGiftNotice } from '../economy/daily-gifts.js'`; add to `CatalogRouteDeps`:

```ts
  /**
   * What the check-in schedule names from the current month on (spec 2026-10-12 §4.4) — the economy service's, which
   * owns the timezone the month is read in. The same for every player, so it rides on the catalogue.
   */
  dailyGifts: () => DailyGiftNotice[]
```

and replace the items route with:

```ts
  /**
   * The catalogue, and beside it what the check-in will hand out by name from this month on (spec 2026-10-12 §4.4):
   * the wardrobe's locked tiles read their "Quà điểm danh ngày 28 tháng 11/2026" from it. It rides on this response
   * rather than a route of its own because the wardrobe already asks for exactly this, and it is the same for everyone.
   */
  app.get('/api/catalog/items', async (_req, reply) => reply.send({ items: deps.catalog.all(), dailyGifts: deps.dailyGifts() }))
```

`routes.ts` line 188:

```ts
  registerCatalogRoutes(app, {
    config: deps.config,
    catalog: deps.catalog,
    defs: deps.defs,
    manifest: deps.manifest,
    bodies: deps.bodies,
    dailyGifts: () => deps.economy.dailyGiftNotices(),
  })
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @bp/normal-server exec vitest run src/economy src/inventory/items.test.ts src/http src/app.test.ts`
Expected: PASS. Then `pnpm --filter @bp/normal-server test` (the whole package, build test included) — PASS — and `pnpm typecheck`, `pnpm lint` — clean (`normal-web` has not changed yet and does not import the server).

- [ ] **Step 8: Commit**

```bash
git add apps/normal-server/src/economy apps/normal-server/src/inventory/items.ts apps/normal-server/src/inventory/items.test.ts apps/normal-server/src/app.ts apps/normal-server/src/app.test.ts apps/normal-server/src/http/routes.ts apps/normal-server/src/http/routes-catalog.ts apps/normal-server/src/http/routes-rewards.test.ts
git commit -m "feat(normal-server): the check-in reads the month's gifts — day 28 of 11/2026 grants the top hat too, /api/rewards/daily serves the month's calendar with each fixed day's items, /api/catalog/items says what the schedule still names (spec 2026-10-12)"
```

---

### Task 3: The screens — the Daily calendar names its gifts, the wardrobe names the month

**Files:**
- Modify: `apps/normal-web/src/api.ts:225-243` (the daily DTOs), `:439` and `:555` (`catalogItems`)
- Modify: `apps/normal-web/src/screens/format.ts`; Test: `apps/normal-web/src/screens/format.test.ts` (new)
- Modify: `apps/normal-web/src/screens/DailyScreen.tsx`, `apps/normal-web/src/screens/normal.module.css:1068`; Test: `DailyScreen.test.tsx`
- Modify: `apps/normal-web/src/screens/catalog.ts`; Test: `catalog.test.ts`
- Modify: `apps/normal-web/src/screens/wardrobe/{WardrobeScreen,ItemTab,ColourTab,HairStyleTab}.tsx`; Test: `WardrobeScreen.test.tsx`
- Modify: `apps/normal-web/src/locales/vi/normal.json`, `apps/normal-web/src/locales/en/normal.json`
- Modify: `apps/normal-web/e2e/normal.spec.ts` (one assertion)
- Throwaway: `apps/normal-web/e2e/zz-preview.spec.ts`

**Interfaces:**
- Consumes: Task 2's wire shapes — `GET /api/rewards/daily` `{ …, month, calendar: [{ day, points, item, items }] }`; `GET /api/catalog/items` `{ items, dailyGifts: [{ itemId, day, month }] }`.
- Produces: `CalendarEntryDto.items: string[]`; `DailyStatusDto.month: string`; `DailyGiftNoticeDto`; `CatalogItemsDto { items: ItemDto[]; dailyGifts?: DailyGiftNoticeDto[] }`; `formatMonthKey(key: string): string`; `MarkerKind = 'common' | 'rare' | 'fixed'`; `markerOf(entry, t): { kind: MarkerKind; label: string } | null`; `giftNames(itemIds, t): string`; `HintSources { achievements; gifts }`; `hintFor(item, sources: HintSources, t)`; the tabs' `hints: HintSources` prop (was `achievements`).

- [ ] **Step 1: The DTOs**

In `apps/normal-web/src/api.ts` replace `CalendarEntryDto` and `DailyStatusDto` with:

```ts
/** One day of a month's check-in schedule; the same 31 rows for every player (spec 2026-10-12 §4.3). */
export interface CalendarEntryDto {
  day: number
  points: number
  /** A rarity label for a draw day, the first item id for a fixed day, `null` for a points-only day. */
  item: string | null
  /** Every item a fixed day grants, in the schedule's order — what the calendar names; empty on any other day. */
  items: string[]
}

/** `GET /api/rewards/daily`, and the `daily` block of `GET /api/me`. */
export interface DailyStatusDto {
  claimable: boolean
  day: number
  streak: number
  reward: number
  item: string | null
  /** The instant the next local day begins, so the client can count down to it. */
  nextResetAt: number
  /** `YYYY-MM` in the server's economy timezone: the month `calendar` describes. */
  month: string
  calendar: CalendarEntryDto[]
}

/**
 * An item the check-in schedule names, at its first tier and month from this month on (spec 2026-10-12 §4.4) —
 * `apps/normal-server/src/economy/daily-gifts.ts`'s `DailyGiftNotice`, verbatim.
 */
export interface DailyGiftNoticeDto {
  itemId: string
  /** The streak tier whose claim grants it, 1–31. */
  day: number
  /** `YYYY-MM` of the first month, this one or later, that names it; `null` for a gift of every month (the default). */
  month: string | null
}

/** `GET /api/catalog/items`. `dailyGifts` is absent from a server older than Plan 22: read it as none. */
export interface CatalogItemsDto {
  items: ItemDto[]
  dailyGifts?: DailyGiftNoticeDto[]
}
```

and type `catalogItems` with it in both places: `catalogItems(): Promise<CatalogItemsDto>` (the `NormalApi` interface, line 439) and `catalogItems: () => call<CatalogItemsDto>({ method: 'GET', path: '/api/catalog/items' })` (line 555).

- [ ] **Step 2: Write the failing tests**

(a) Create `apps/normal-web/src/screens/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatMonthKey } from './format.js'

describe('formatMonthKey', () => {
  it('writes a YYYY-MM month key as MM/YYYY', () => {
    expect(formatMonthKey('2026-11')).toBe('11/2026')
    expect(formatMonthKey('2027-02')).toBe('02/2027')
  })
})
```

(b) `apps/normal-web/src/screens/catalog.test.ts`. Change the imports to `import type { AchievementDefDto, DailyGiftNoticeDto, ItemDto } from '../api.js'` and `import { hintFor, type HintSources } from './catalog.js'`; change the fixtures' comment to "What the server's data holds: the six epics a daily draw can never hand out, a common and a rare it can, and the day-28 pair." Add below `ACHIEVEMENTS`:

```ts
/** What `GET /api/catalog/items` says the check-in names from October 2026 on: the pair every month, the top hat in November. */
const GIFTS: readonly DailyGiftNoticeDto[] = [
  { itemId: 'badge_monthly', day: 28, month: null },
  { itemId: 'title_devoted', day: 28, month: null },
  { itemId: 'head_tophat01', day: 28, month: '2026-11' },
]
const sources = (achievements: readonly AchievementDefDto[], gifts: readonly DailyGiftNoticeDto[] = GIFTS): HintSources => ({ achievements, gifts })
const HEAD_TOPHAT = UNDRAWABLE_EPICS[0]!
```

Then replace the `describe('hintFor')` body with:

```ts
describe('hintFor', () => {
  it.each(UNDRAWABLE_EPICS.map((i) => [i.id, i] as const))('does not promise %s from the daily draw, which never draws an epic', (_id, epic) => {
    // Named by no schedule (or by a month gone by, which the server reports the same way: by not listing it).
    expect(hintFor(epic, sources(ACHIEVEMENTS, []), tVi)).toBe(viNormal.wardrobe.hint.unavailable)
    expect(hintFor(epic, sources(ACHIEVEMENTS, []), tEn)).toBe(enNormal.wardrobe.hint.unavailable)
  })

  it('names the day-28 check-in as the way to the month badge', () => {
    expect(hintFor(BADGE_MONTHLY, sources(ACHIEVEMENTS), tVi)).toBe('Quà điểm danh ngày 28')
    expect(hintFor(BADGE_MONTHLY, sources(ACHIEVEMENTS), tEn)).toBe('The day-28 check-in gift')
  })

  it('names the month of a scheduled epic, as the server gives it', () => {
    expect(hintFor(HEAD_TOPHAT, sources([]), tVi)).toBe('Quà điểm danh ngày 28 tháng 11/2026')
    expect(hintFor(HEAD_TOPHAT, sources([]), tEn)).toBe('The day-28 check-in gift of 11/2026')
  })

  it('says "no way to earn this" for an epic whose month has passed, which the server no longer lists', () => {
    const afterNovember = GIFTS.filter((g) => g.itemId !== 'head_tophat01')
    expect(hintFor(HEAD_TOPHAT, sources([], afterNovember), tVi)).toBe(viNormal.wardrobe.hint.unavailable)
  })

  it('names the day-28 gift for the month badge even when no achievement list has loaded', () => {
    expect(hintFor(BADGE_MONTHLY, sources([]), tVi)).toBe('Quà điểm danh ngày 28')
  })

  it('keeps naming the achievement for the day-28 title, which a 28-day streak also earns', () => {
    expect(hintFor(TITLE_DEVOTED, sources(ACHIEVEMENTS), tVi)).toBe(viNormal.achievements.login_streak_28.name)
    // …and without the achievement list the title is still the day-28 gift, not "no way to earn this".
    expect(hintFor(TITLE_DEVOTED, sources([]), tVi)).toBe('Quà điểm danh ngày 28')
  })

  it('still calls a common in a draw slot a gift of the daily draw', () => {
    expect(hintFor(COMMON_HAT, sources(ACHIEVEMENTS), tVi)).toBe(viNormal.wardrobe.hint.daily.common)
    expect(hintFor(COMMON_HAT, sources(ACHIEVEMENTS), tEn)).toBe(enNormal.wardrobe.hint.daily.common)
  })

  it('still calls a rare in a draw slot a gift of the daily draw', () => {
    expect(hintFor(RARE_COLOUR, sources(ACHIEVEMENTS), tVi)).toBe(viNormal.wardrobe.hint.daily.rare)
  })

  it('names the achievement that rewards the item, even for an epic in a draw slot', () => {
    const crown = item({ id: 'head_crown_gold01', slot: 'head', rarity: 'epic' })

    expect(hintFor(crown, sources(ACHIEVEMENTS), tVi)).toBe(viNormal.achievements.login_days_100.name)
    expect(hintFor(crown, sources(ACHIEVEMENTS), tEn)).toBe(enNormal.achievements.login_days_100.name)
  })

  it('says "no way to earn this" for what nothing hands out: an outfit, or an item outside the draw slots', () => {
    expect(hintFor(OUTFIT, sources([]), tVi)).toBe(viNormal.wardrobe.hint.unavailable)
    expect(hintFor(item({ id: 'title_rookie', slot: 'title', rarity: 'common' }), sources(ACHIEVEMENTS), tVi)).toBe(viNormal.wardrobe.hint.unavailable)
  })
})
```

(c) `apps/normal-web/src/screens/DailyScreen.test.tsx`. Replace the `CALENDAR` fixture and add `month` to `STATUS`:

```ts
/** The server's own schedule for October 2026: a common on 7, a rare on 14 and 21, the badge and the title on 28. */
const CALENDAR: CalendarEntryDto[] = Array.from({ length: 31 }, (_, i) => {
  const day = i + 1
  const item = day === 7 ? 'common' : day === 14 || day === 21 ? 'rare' : day === 28 ? 'badge_monthly' : null
  return { day, points: day * 1_000, item, items: day === 28 ? ['badge_monthly', 'title_devoted'] : [] }
})
```

(`STATUS` gains `month: '2026-10',` after `nextResetAt`.) Below `FALLBACK_PREFIX` add:

```ts
/** Day 28 of October, by name: what its cell says, and what the legend's line for it ends with. */
const PAIR_LABEL = `${viNormal.items.badge_monthly} + ${viNormal.items.title_devoted}`
```

In `draws all thirty-one tiers, with an item marker on exactly four of them`, replace `expect(calendar().getAllByText(viNormal.daily.marker.monthly)).toHaveLength(1)` with `expect(calendar().getAllByText(PAIR_LABEL)).toHaveLength(1)`; in `draws no marker for an item tier this bundle has no words for`, replace `expect(calendar().queryAllByText(viNormal.daily.marker.monthly)).toHaveLength(1)` with `expect(calendar().queryAllByText(PAIR_LABEL)).toHaveLength(1)`. Add at the end of `describe('DailyScreen — the calendar')`:

```ts
  it('names every gift of a fixed day in its cell and in the legend, with the month', async () => {
    const november = {
      ...STATUS,
      month: '2026-11',
      calendar: CALENDAR.map((e) => (e.day === 28 ? { ...e, items: ['badge_monthly', 'title_devoted', 'head_tophat01'] } : e)),
    }
    renderScreen(stubApi({ daily: vi.fn().mockResolvedValue(november) }))
    await screen.findByRole('list', { name: viNormal.daily.calendarTitle })

    const names = `${PAIR_LABEL} + ${viNormal.items.head_tophat01}`
    expect(names).toBe('Huy hiệu tháng + Chuyên cần + Mũ chóp quý ông')
    const gift = calendar().getByText(names).closest('[title]') as HTMLElement
    expect(gift).toHaveAttribute('title', names)
    expect(gift).toHaveAttribute('data-kind', 'fixed')
    // The legend is what a phone reads, having no tooltip: the day, the month and the names.
    expect(screen.getByText(`Ngày 28 tháng 11/2026: ${names}`)).toBeInTheDocument()
  })

  it('names a fixed gift on any day the schedule puts one, and lists in the legend only the draws the month has', async () => {
    const odd = {
      ...STATUS,
      calendar: CALENDAR.map((e) =>
        e.day === 14 ? { ...e, item: 'frame_gold', items: ['frame_gold'] } : e.day === 21 ? { ...e, item: 'common' } : e,
      ),
    }
    renderScreen(stubApi({ daily: vi.fn().mockResolvedValue(odd) }))
    await screen.findByRole('list', { name: viNormal.daily.calendarTitle })

    expect(calendar().getByText(viNormal.items.frame_gold)).toBeInTheDocument()
    expect(screen.getByText(`Ngày 14 tháng 10/2026: ${viNormal.items.frame_gold}`)).toBeInTheDocument()
    // No rare day is left this month, so the legend explains none; the common one is days 7 and 21, and the legend.
    expect(screen.queryByText(viNormal.daily.marker.rare)).toBeNull()
    expect(screen.getAllByText(viNormal.daily.marker.common)).toHaveLength(3)
  })
```

(d) `apps/normal-web/src/screens/wardrobe/WardrobeScreen.test.tsx`, right after `locks an unowned tile, and a click on it does not equip anything`:

```ts
  it('names the check-in month on a locked tile the schedule hands out', async () => {
    // No achievement here rewards the top hat, so the schedule's line is the one that shows (spec 2026-10-12 §4.4).
    const user = userEvent.setup()
    renderScreen(
      stubApi({
        catalogItems: vi.fn().mockResolvedValue({ items: CATALOG, dailyGifts: [{ itemId: 'head_tophat01', day: 28, month: '2026-11' }] }),
        catalogAchievements: vi.fn().mockResolvedValue({ achievements: [] }),
      }),
    )
    await opened()
    await goTo(user, 'wear', viNormal.wardrobe.tabs.head)
    await user.click(showLockedBox())

    const locked = screen.getByText(viNormal.items.head_tophat01).closest('button') as HTMLElement
    expect(locked).toHaveAttribute('aria-disabled', 'true')
    expect(within(locked).getByText('Quà điểm danh ngày 28 tháng 11/2026')).toBeInTheDocument()
  })
```

(Every other test's `catalogItems` mock answers `{ items: CATALOG }` with no `dailyGifts`: that is the "older server" case, read as none.)

- [ ] **Step 3: Run the tests to see them fail**

Run: `pnpm --filter @bp/normal-web exec vitest run src/screens/format.test.ts src/screens/catalog.test.ts src/screens/DailyScreen.test.tsx src/screens/wardrobe/WardrobeScreen.test.tsx`
Expected: FAIL — `formatMonthKey` is not exported, `hintFor` reads `.find` of an object, the cells still say "Huy hiệu + danh hiệu tháng", the tile still says the generic line.

- [ ] **Step 4: The locales**

With the Edit tool, in `apps/normal-web/src/locales/vi/normal.json`:

```json
    "marker": {
      "common": "Vật phẩm thường",
      "rare": "Vật phẩm hiếm",
      "fixedDay": "Ngày {{day}} tháng {{month}}: {{items}}"
    },
```

(replacing the `marker` block, whose `"monthly": "Huy hiệu + danh hiệu tháng"` goes), and in `wardrobe.hint`:

```json
      "dailyFixed": "Quà điểm danh ngày {{day}}",
      "dailyMonth": "Quà điểm danh ngày {{day}} tháng {{month}}",
      "unavailable": "Chưa có cách nhận món này"
```

In `apps/normal-web/src/locales/en/normal.json`:

```json
    "marker": {
      "common": "Common item",
      "rare": "Rare item",
      "fixedDay": "Day {{day}} of {{month}}: {{items}}"
    },
```

and

```json
      "dailyFixed": "The day-{{day}} check-in gift",
      "dailyMonth": "The day-{{day}} check-in gift of {{month}}",
      "unavailable": "No way to earn this yet"
```

Read `"title": "Điểm danh hằng ngày"` back from the vi file afterwards (encoding check).

- [ ] **Step 5: `formatMonthKey`**

Append to `apps/normal-web/src/screens/format.ts`:

```ts
/**
 * A month key from the server (`YYYY-MM`, the economy timezone's month) as a player reads it: `11/2026`. Not `Intl`:
 * there is no instant to format, only a label, and both languages write it the same way (spec 2026-10-12 §5.2).
 */
export function formatMonthKey(key: string): string {
  const [year, month] = key.split('-')
  return `${month ?? ''}/${year ?? ''}`
}
```

and change the file's doc comment "The two things every account screen has to print: a date, and a signed amount." to "What the account screens print: a date, a signed amount, and a month the server names."

- [ ] **Step 6: The Daily screen**

In `apps/normal-web/src/screens/DailyScreen.tsx`, import `formatMonthKey` beside `formatMoment` (`import { formatMoment, formatMonthKey } from './format.js'`). Replace everything from the comment that begins "The calendar's item column, as something to draw." down to the closing brace of `markerOf` (lines 37–61 at `840f22d`) with:

```ts
/** What an item tier pays, as the colour of its gift icon (`.calGift[data-kind]`). */
export type MarkerKind = 'common' | 'rare' | 'fixed'

/** The draws a tier can advertise, and the words for them. A fixed day names its items instead (`markerOf`). */
const DRAW_MARKERS: Record<string, { kind: MarkerKind; key: string }> = {
  common: { kind: 'common', key: 'daily.marker.common' },
  rare: { kind: 'rare', key: 'daily.marker.rare' },
}

/** The draw kinds, in the legend's order. */
const DRAW_KINDS = ['common', 'rare'] as const

/** Between two gift names — "Huy hiệu tháng + Chuyên cần + Mũ chóp quý ông" — the same in both languages. */
const GIFT_JOIN = ' + '

/** A fixed day's gifts, by name, in the schedule's order. */
export function giftNames(itemIds: readonly string[], t: TFunction): string {
  return itemIds.map((id) => itemName(id, t)).join(GIFT_JOIN)
}

/**
 * The calendar's item column, as something to draw (spec 2026-10-12 §4.3).
 *
 * A fixed day names what it grants, from `items` — the month's own list, so day 28 of 11/2026 reads "Huy hiệu tháng
 * + Chuyên cần + Mũ chóp quý ông" and day 28 of 10/2026 the pair alone. A random tier cannot name its item in
 * advance — the server picks it against the inventory at the moment of the claim — so days 7, 14 and 21 advertise a
 * *rarity* and get the wardrobe's own tone for it.
 *
 * The draws are exhaustive rather than open-ended: a marker this bundle predates draws nothing at all, which is
 * honest, where a catch-all would confidently promise a prize the tier does not give. The points on that day still
 * show — only the promise this app cannot keep is withheld.
 */
export function markerOf(entry: CalendarEntryDto, t: TFunction): { kind: MarkerKind; label: string } | null {
  if (entry.items.length > 0) return { kind: 'fixed', label: giftNames(entry.items, t) }
  const draw = entry.item === null ? undefined : DRAW_MARKERS[entry.item]
  return draw === undefined ? null : { kind: draw.kind, label: t(draw.key) }
}
```

In the calendar cell, `const marker = markerOf(entry)` becomes `const marker = markerOf(entry, t)`, and the gift span reads its label directly:

```tsx
                      <span className={s.calGift} data-kind={marker.kind} title={marker.label}>
                        <GiftIcon />
                        <span className="visually-hidden">{marker.label}</span>
                      </span>
```

Replace the legend (the comment "What the gifts mean, once…" and its `<ul className={s.calLegend}>`) with:

```tsx
            {/* What the gifts mean, once, instead of a two-line pill in four cells: the draws this month has, then each
                fixed day by its day, its month and its gifts' names — the one place a phone, which has no tooltip,
                reads them (spec 2026-10-12 §4.3). */}
            <ul className={s.calLegend}>
              {DRAW_KINDS.filter((kind) => status.calendar.some((entry) => entry.items.length === 0 && entry.item === kind)).map((kind) => (
                <li key={kind}>
                  <span className={s.calGift} data-kind={kind}>
                    <GiftIcon />
                  </span>
                  {t(`daily.marker.${kind}`)}
                </li>
              ))}
              {status.calendar
                .filter((entry) => entry.items.length > 0)
                .map((entry) => (
                  <li key={`day-${entry.day}`}>
                    <span className={s.calGift} data-kind="fixed">
                      <GiftIcon />
                    </span>
                    {t('daily.marker.fixedDay', { day: entry.day, month: formatMonthKey(status.month), items: giftNames(entry.items, t) })}
                  </li>
                ))}
            </ul>
```

In `apps/normal-web/src/screens/normal.module.css` line 1068, `.calGift[data-kind='monthly']` becomes `.calGift[data-kind='fixed']` (still `color: var(--gold)`).

- [ ] **Step 7: The wardrobe hint**

`apps/normal-web/src/screens/catalog.ts`: imports become `import type { AchievementDefDto, DailyGiftNoticeDto, ItemDto, ItemSlot } from '../api.js'`, `import { achievementName } from '../catalog-i18n.js'`, `import { formatMonthKey } from './format.js'`. Change `DAILY_DRAW_RARITIES`' doc to say the rarities mirror what `data/daily-gifts.json` may draw (`draw` is `common` or `rare`, spec Q6). Delete the `DAILY_FIXED_ITEM_IDS` constant and its doc. Replace `hintFor` and its doc with:

```ts
/** Everything a locked tile's hint is worked out from: two lists the wardrobe loads with the catalogue. */
export interface HintSources {
  achievements: readonly AchievementDefDto[]
  /** What the check-in schedule names from this month on — `GET /api/catalog/items`'s `dailyGifts`. */
  gifts: readonly DailyGiftNoticeDto[]
}

/**
 * Why a locked tile is locked, in one line: how a player would come to own it.
 *
 * An achievement that rewards this exact item wins over the rest, because it is the more useful answer — "win a royal
 * flush" beats "comes from a daily draw" when both happen to be true. After it, a gift the check-in schedule names
 * (spec 2026-10-12 §4.4): one of every month reads "Quà điểm danh ngày 28", one of a given month says which —
 * "Quà điểm danh ngày 28 tháng 11/2026". The server lists only what is still to come, so an item whose month has
 * passed falls through. Then only a common or a rare in a draw slot is called a gift of the draw: the server never
 * draws an epic, so promising one would be a hint that can never come true. Everything else (an outfit, a title, a
 * badge, an epic nobody hands out) falls back to `unavailable` rather than naming a source that does not exist.
 */
export function hintFor(item: ItemDto, sources: HintSources, t: TFunction<'normal'>): string {
  const rewarding = sources.achievements.find((def) => def.reward.itemId === item.id)
  if (rewarding !== undefined) return achievementName(rewarding.id, t)
  const gift = sources.gifts.find((g) => g.itemId === item.id)
  if (gift !== undefined) {
    return gift.month === null
      ? t('wardrobe.hint.dailyFixed', { day: gift.day })
      : t('wardrobe.hint.dailyMonth', { day: gift.day, month: formatMonthKey(gift.month) })
  }
  if (DAILY_DRAW_SLOTS.has(item.slot) && DAILY_DRAW_RARITIES.has(item.rarity)) return t(`wardrobe.hint.daily.${item.rarity}`)
  return t('wardrobe.hint.unavailable')
}
```

The three tabs, `ColourTab.tsx`, `HairStyleTab.tsx`, `ItemTab.tsx`: drop `AchievementDefDto` from the `../../api.js` type import; `import { hintFor } from '../catalog.js'` becomes `import { hintFor, type HintSources } from '../catalog.js'`; the prop `achievements: readonly AchievementDefDto[]` becomes

```ts
  /** What a locked card's hint is worked out from (`hintFor`): the achievements and the check-in's named gifts. */
  hints: HintSources
```

`achievements` becomes `hints` in each destructuring, and every `hintFor(<x>, achievements, t)` becomes `hintFor(<x>, hints, t)` (one call in `ColourTab`, one in `HairStyleTab`, three in `ItemTab`).

`WardrobeScreen.tsx`: add `type DailyGiftNoticeDto,` to the `../../api.js` import and `import type { HintSources } from '../catalog.js'`. `WardrobeData` gains

```ts
  /** What the check-in schedule names from this month on — absent from an older server, read as none. */
  gifts: DailyGiftNoticeDto[]
```

the loader's return gains `gifts: catalogAnswer.dailyGifts ?? [],` after `achievements`, and after the `owned` memo:

```ts
  /** What a locked card's hint is worked out from (`hintFor`): the achievements, and the check-in's named gifts. */
  const hints = useMemo<HintSources>(() => ({ achievements: loaded?.achievements ?? [], gifts: loaded?.gifts ?? [] }), [loaded])
```

Each of the five `achievements={loaded.achievements}` props becomes `hints={hints}`.

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @bp/normal-web test`
Expected: PASS — the four files above, `locales.test.ts` (`declares every key in both languages`), and the rest unchanged. Then `pnpm typecheck` and `pnpm lint` — clean.

- [ ] **Step 9: The e2e line on the real build**

In `apps/normal-web/e2e/normal.spec.ts`, test `điểm danh hằng ngày`, right after `await expect(claim).toBeEnabled()`:

```ts
    // Spec 2026-10-12 §4.3: under the calendar, day 28 is named with its month and its gifts. The badge and the title
    // are in every month's list of the shipped schedule, so this holds whichever month the run falls in.
    await expect(page.getByText(/^Ngày 28 tháng \d{2}\/\d{4}: Huy hiệu tháng \+ Chuyên cần/), 'the legend names day 28 and its gifts').toBeVisible()
```

No account is added: the test already has one. Run:

```bash
pnpm build:normal
pnpm --filter @bp/normal-web exec playwright test -c e2e/playwright.config.ts -g "điểm danh hằng ngày"
```

Expected: PASS (its two `expectNoTextOverlapAt` passes now also cover the longer legend at 1920×940 and 1366×768).

- [ ] **Step 10: The screenshots (throwaway)**

Create `apps/normal-web/e2e/zz-preview.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { account, register, shot } from './support.js'

/** Throwaway (Plan 22, Task 3): the Daily screen as November will show it, and the locked top hat, at the three sizes. */
const SIZES = [
  ['1920x940', { width: 1920, height: 940 }],
  ['1366x768', { width: 1366, height: 768 }],
  ['375x812', { width: 375, height: 812 }],
] as const

test('zz-preview: Plan 22, the month-named calendar and the wardrobe hint', async ({ page }) => {
  await register(page, account('Preview'))
  // November as the server will answer it from 01/11: the real body, with the month and day 28 rewritten.
  await page.route('**/api/rewards/daily', async (route) => {
    const response = await route.fetch()
    const body = (await response.json()) as { month: string; calendar: { day: number; items: string[] }[] }
    body.month = '2026-11'
    body.calendar[27]!.items = ['badge_monthly', 'title_devoted', 'head_tophat01']
    await route.fulfill({ response, json: body })
  })
  for (const [name, size] of SIZES) {
    await page.setViewportSize(size)
    await page.goto('/#/daily')
    const legendLine = page.getByText(/^Ngày 28 tháng 11\/2026: /)
    await expect(legendLine).toHaveText('Ngày 28 tháng 11/2026: Huy hiệu tháng + Chuyên cần + Mũ chóp quý ông')
    await legendLine.scrollIntoViewIfNeeded()
    await shot(page, `p22-daily-${name}`)

    // The real server's own answer: today (October 2026) the top hat is November's.
    await page.goto('/#/avatar')
    await page.getByRole('tablist', { name: 'Phòng thay đồ' }).getByRole('tab', { name: 'Trang phục' }).click()
    await page.getByRole('tablist', { name: 'Trang phục' }).getByRole('tab', { name: /^Mũ/ }).click()
    await page.getByRole('checkbox', { name: 'Hiện cả món chưa có' }).check()
    const hat = page.getByRole('button', { name: /^Mũ chóp quý ông, / })
    await expect(hat).toContainText('Quà điểm danh ngày 28 tháng 11/2026')
    await hat.scrollIntoViewIfNeeded()
    await shot(page, `p22-wardrobe-${name}`)
  }
})
```

Run it on its own after `pnpm build:normal`: `pnpm --filter @bp/normal-web exec playwright test -c e2e/playwright.config.ts zz-preview`. Open the six PNGs in `apps/normal-web/e2e/screenshots/` (`p22-daily-*`, `p22-wardrobe-*`): the legend line wraps inside the page at 375 px with its icon beside the first line, no text sits on other text, and the top hat's lock line reads the month. If the legend's icon centres on a wrapped two-line row, add `align-items: flex-start` to `.calLegend li` in `normal.module.css` and retake. Hand the PNG paths to the reviewer, then **delete `zz-preview.spec.ts`** (its sign-up counts toward the limit; it must not reach the gate or the commit). The wardrobe step reads the live month: run before 01/12/2026, or the hat's line is the next month's or "Chưa có cách nhận món này".

- [ ] **Step 11: Commit**

```bash
git add apps/normal-web/src/api.ts apps/normal-web/src/screens/format.ts apps/normal-web/src/screens/format.test.ts apps/normal-web/src/screens/DailyScreen.tsx apps/normal-web/src/screens/DailyScreen.test.tsx apps/normal-web/src/screens/normal.module.css apps/normal-web/src/screens/catalog.ts apps/normal-web/src/screens/catalog.test.ts apps/normal-web/src/screens/wardrobe/WardrobeScreen.tsx apps/normal-web/src/screens/wardrobe/WardrobeScreen.test.tsx apps/normal-web/src/screens/wardrobe/ItemTab.tsx apps/normal-web/src/screens/wardrobe/ColourTab.tsx apps/normal-web/src/screens/wardrobe/HairStyleTab.tsx apps/normal-web/src/locales/vi/normal.json apps/normal-web/src/locales/en/normal.json apps/normal-web/e2e/normal.spec.ts
git commit -m "feat(normal-web): the Daily calendar names each month's gifts — 'Ngày 28 tháng 11/2026: Huy hiệu tháng + Chuyên cần + Mũ chóp quý ông' — and a locked tile names its check-in month, both from the server's schedule (spec 2026-10-12)"
```

---

### Task 4: Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-09-04-bind-poker-design.md` §13.2, §19.2
- Modify: `docs/normal-server.md`, `docs/normal-web.md`
- Modify: `docs/player-guide.md`, `docs/operation-test-plan.md`, `deploy/normal-windows/README.md`, `docs/deployment-normal.md`, `docs/copy-review-2026-10-10.md` (Vietnamese — Edit tool only)
- Modify: `docs/known-limitations.md`, `docs/test-matrix.md`, `docs/acceptance-checklist.md`, `tooling/arch/acceptance-links.test.ts`, `CLAUDE.md`

The CHANGELOG section is the controller's, at the merge (CLAUDE.md §6).

- [ ] **Step 1: The SRS, §13.2 and §19.2**

In §13.2's table, row 28 becomes:

```
| 28 | 40.000 | Badge tháng (`badge_monthly`) + title `title_devoted` nếu chưa có; từ 11/2026 mỗi tháng thêm một món cực hiếm (2026-10-12, spec monthly-daily-gifts — xem "Lịch quà theo tháng" dưới bảng) |
```

After "Tổng tối đa 376.000/tháng." insert a paragraph:

```
**Lịch quà theo tháng (2026-10-12, spec monthly-daily-gifts).** Cột Item của Normal không còn nằm trong code mà là file `apps/normal-server/data/daily-gifts.json`, gồm `default` — đúng cột Item của bảng trên (7 rút `common`, 14 và 21 rút `rare`, 28 tặng `badge_monthly` + `title_devoted`) — và `months` theo khóa `YYYY-MM`, mỗi tháng ghi đè từng bậc bằng `{ "draw": "common" | "rare" }` hoặc `{ "fixed": [itemId, …] }`. Luật của tháng cho một bậc **thay hẳn** luật mặc định của bậc đó (danh sách `fixed` của tháng là danh sách đầy đủ). Lần nhận dùng tháng của chính nó (theo `ECONOMY_TIMEZONE`). File được kiểm tra lúc khởi động: id có trong catalogue và không phải món ai cũng có sẵn; bậc từ 1 đến 31 và không vượt số ngày của tháng; không trùng id trong một ngày hay trong một tháng; mức rút hợp lệ. File sai thì server không khởi động. Lịch giao kèm giữ tháng 10/2026 như cũ và thêm vào ngày 28: 11/2026 `head_tophat01`, 12/2026 `face_eyepatch01`, 01/2027 `aura_lightning01`, 02/2027 `frame_gold`, 03/2027 `haircolor_lavender01`, 04/2027 `eyecolor_gold01`. Đổi lịch là sửa file rồi khởi động lại, không cần migration (`docs/normal-server.md`, mục "Changing the daily gifts").
```

In the fallback paragraph, "Ngày 28 là bậc **cố định**: nó cấp `badge_monthly` + `title_devoted`, và nếu" becomes "Ngày 28 là bậc **cố định**: nó cấp `badge_monthly` + `title_devoted` (từ 11/2026 cộng món của tháng; mọi bậc `fixed` của lịch quà theo cùng luật này — 2026-10-12, spec monthly-daily-gifts), và nếu". In the second bullet below it, "**mọi item nằm trong `reward.itemId` của `achievements.json`, cộng `badge_monthly` và `title_devoted`**" becomes "**mọi item nằm trong `reward.itemId` của `achievements.json`, cộng mọi id nằm trong một danh sách `fixed` của lịch quà** (tháng đã qua hay chưa tới; 2026-10-12, spec monthly-daily-gifts — trước đó là `badge_monthly` và `title_devoted`)".

In §19.2's table:

```
| GET | `/api/catalog/items` | — | `200 {items: ItemDef[], dailyGifts: [{itemId, day, month}]}` (`dailyGifts`, 2026-10-12, spec monthly-daily-gifts: lần tặng đầu tiên của mỗi quà có tên trong lịch, tính từ tháng hiện tại; `month` là `null` = mọi tháng) | `429` |
| GET | `/api/rewards/daily` | ✔ | `200 DailyStatus {claimable, day, streak, reward, item, nextResetAt, month, calendar[31]: {day, points, item, items}}` (`month`, `items`: 2026-10-12, spec monthly-daily-gifts — lịch của tháng hiện tại; `items` là các món của bậc có quà định sẵn) | `401` · `429` |
```

- [ ] **Step 2: `docs/normal-server.md`**

Module map: `economy/           daily-rules.ts (pure) · daily-gifts.ts (the gift schedule, loaded and checked) · economy-service.ts (daily claim, relief)`, and `data/` lists `daily-gifts.json` after `achievements.json`.

"The wiring order in `buildApp`", point 3 becomes: "**`economy` is constructed with `reservedItemIds` = every `reward.itemId` in the achievement definitions, and with `gifts` = `loadDailyGifts(catalog)`.** Both are kept off the daily random draw: an item somebody was supposed to earn, or one the schedule promises for a month. `loadDailyGifts` runs right after `loadAchievements` and before `seed`, so a bad schedule stops the boot before anything is written."

"Adding a cosmetic item", step 3: replace "a default in an optional slot, or an absent `badge_monthly` / `title_devoted` — each of those would otherwise surface much later and much worse (a day-28 claim failing on a foreign key, on the 28th)." with "or a default in an optional slot — each of those would otherwise surface much later and much worse. (Whether the gifts the check-in names exist is `loadDailyGifts`' to check since Plan 22 — see \"Changing the daily gifts\".)". In "Things worth knowing", the daily-draw bullet's "excluding every item named as an achievement reward and every `free` item" becomes "excluding every item named as an achievement reward, every item the gift schedule names, and every `free` item", and "(days 7, 14, 21)" becomes "(the tiers `data/daily-gifts.json` makes draws — days 7, 14 and 21 by default)".

Add a section before "## Adding an achievement":

````markdown
## Changing the daily gifts

The check-in's item column is data: `data/daily-gifts.json` (spec `docs/superpowers/specs/2026-10-12-monthly-daily-gifts-design.md`).
The points column is not — it is `DAILY_REWARD_POINTS` in `@bp/core`, shared with Lite, which has no item column at all
(§13.3).

```json
{
  "default": { "7": { "draw": "common" }, "14": { "draw": "rare" }, "21": { "draw": "rare" },
               "28": { "fixed": ["badge_monthly", "title_devoted"] } },
  "months": {
    "2026-11": { "28": { "fixed": ["badge_monthly", "title_devoted", "head_tophat01"] } }
  }
}
```

- A key under `default` or a month is a **streak tier** (1–31), not a calendar date. The streak restarts every month,
  so tier 28 is claimed on the 28th to the 31st, depending on when the streak began.
- A rule is `{ "draw": "common" | "rare" }` — an unowned item of that rarity from `DAILY_DRAW_SLOTS`, minus every
  reserved id, or `NO_ITEM_FALLBACK_POINTS` under `daily_item_fallback` when none is left — or `{ "fixed": [ids] }`,
  exactly those items, skipping any the player owns and never paid for.
- A month's rule for a tier **replaces** the default's for that tier. Write a `fixed` list in full: to add a gift to
  day 28, list `badge_monthly` and `title_devoted` again.
- The claim reads the month it is made in (`monthKey` in `ECONOMY_TIMEZONE`). `GET /api/rewards/daily` serves the
  current month's calendar (`month`, and each fixed tier's `items`). `GET /api/catalog/items` carries `dailyGifts`:
  each named item's first tier and month from the current month on, `month: null` for the default's — what the
  wardrobe's locked tiles say.
- Every id in any `fixed` list, past months included, is kept off the random draw, like the achievements' rewards.

To add or change a month:

1. Edit the file. An item new to the catalogue goes in first (`items.json` and both locales — "Adding a cosmetic item").
2. Check it: `pnpm --filter @bp/normal-server exec vitest run src/economy/daily-gifts.test.ts`. That suite loads this
   very file against the real catalogue. It also pins the user's six months (11/2026 to 04/2027); change those only on
   the user's word, together with the two tests that read the shipped file over HTTP (`src/http/routes-rewards.test.ts`,
   `src/app.test.ts`).
3. Merge as usual, then restart. The file is read at boot, not built in: on the LAN host check `/health` for
   `"rooms":0` (`stop.ps1` is a hard kill), then `stop.ps1` and `run.ps1 -NoMigrate` — no `build:normal` is needed for
   a change to this file alone. In Docker `data/` is inside the image, so `up -d --build`. No migration either way.

`loadDailyGifts` **refuses to start** — `invalid daily gift schedule <path>: <problem>` — on: an id the catalogue does
not hold, or one every player already owns (`isDefault`, `free`); a tier outside 1–31, written with a leading zero, or
past the end of its month (`2027-02` has no tier 29); the same id twice in a tier, or on two tiers of one month (the
default's tiers included); a draw that is not `common` or `rare`, or a rule that is not exactly one of `draw` and
`fixed`; a month key that is not `YYYY-MM`; a top-level key other than `default` and `months`; no `default`. A file that
is not JSON is `could not read daily gift schedule <path>: …`.
````

- [ ] **Step 3: `docs/normal-web.md`**

Module map: `catalog.ts        hintFor — how a locked card is won (achievements, the check-in's named gifts, the draw)` and `format.ts         dates, moments, signed amounts and the server's month keys`. In "The wardrobe", the `ItemTab` bullet's "(`aria-disabled`, with a hint: the achievement that grants it, or a daily-calendar rarity, or "chưa mở")" becomes "(`aria-disabled`, with a hint — `hintFor` in `screens/catalog.ts`: the achievement that grants it; else the check-in gift that names it, "Quà điểm danh ngày 28" or, for one month's, "Quà điểm danh ngày 28 tháng 11/2026", read from `GET /api/catalog/items`'s `dailyGifts`; else a daily-draw rarity; else "Chưa có cách nhận món này")". In "Adding an item, end to end", step 4 becomes:

```markdown
4. **How it is won.** A grant in `data/achievements.json`; a `fixed` gift in `apps/normal-server/data/daily-gifts.json`
   (any slot, one month or every month — `normal-server.md`, "Changing the daily gifts"); the daily draw (a common or a
   rare in `head`/`face`/`aura`/`frame`/`hairColor`/`eyeColor`); or nothing — an item nobody owns is an item nobody
   sees, because the wardrobe lists the inventory and not the catalogue.
```

Add a section before "## i18n":

```markdown
## The Daily screen

`screens/DailyScreen.tsx` draws `GET /api/rewards/daily`: today's card and its claim, the receipt, and the month's 31
tiers. The calendar is the **current month's**: the server sends `month` (`YYYY-MM`, the economy timezone) with it,
because the gift schedule may differ month to month (spec 2026-10-12). A tier's gift icon (`markerOf`) is coloured by
kind. A draw day carries `item` = `common` / `rare` and says "Vật phẩm thường" / "Vật phẩm hiếm"; a day with named gifts
carries `items` and says their names joined by " + " (`giftNames`, through `itemName`) — "Huy hiệu tháng + Chuyên cần +
Mũ chóp quý ông". A marker this bundle has no words for draws nothing. The icon's words are a tooltip and a visually
hidden span, so the legend under the calendar repeats them where a phone can read them: the draw kinds this month has,
then one line per named-gift day, "Ngày 28 tháng 11/2026: …" (`daily.marker.fixedDay`, the month through
`formatMonthKey`). The relief panel underneath is fed by `GET /api/me`.
```

- [ ] **Step 4: `docs/player-guide.md` §2 and "Cách nhận đồ" (Edit tool)**

Table row 28: `| 28 | 40.000 | "Huy hiệu tháng" và danh hiệu "Chuyên cần"; từ tháng 11/2026 thêm một món cực hiếm mỗi tháng (xem dưới) |`.

In the paragraph after the table, replace "Ở bản Normal, "Lịch điểm danh" đánh dấu trước các ngày có quà: "Vật phẩm thường", "Vật phẩm hiếm", "Huy hiệu + danh hiệu tháng"." with "Ở bản Normal, "Lịch điểm danh" là lịch của tháng hiện tại và đánh dấu trước các ngày có quà: "Vật phẩm thường", "Vật phẩm hiếm"; ngày có quà định sẵn thì ghi tên từng món. Dòng chú thích dưới lịch ghi lại quà định sẵn kèm tháng, ví dụ "Ngày 28 tháng 11/2026: Huy hiệu tháng + Chuyên cần + Mũ chóp quý ông"."

After the paragraph that begins "Món ngẫu nhiên ngày 7, 14 và 21", insert:

```markdown
**Quà ngày 28 theo tháng (bản Normal).** Quà ngày 28 có thể khác nhau giữa các tháng. Từ tháng 11/2026, ngoài "Huy hiệu tháng" và "Chuyên cần", mỗi tháng tặng thêm một món cực hiếm mà trước đây chưa có cách nhận:

| Tháng | Món thêm |
|---|---|
| 11/2026 | "Mũ chóp quý ông" |
| 12/2026 | "Bịt mắt cướp biển" |
| 01/2027 | "Hào quang sấm sét" |
| 02/2027 | "Khung vàng" |
| 03/2027 | "Tóc tím pastel" |
| 04/2027 | "Mắt vàng kim" |

Quà được tính theo tháng của ngày bạn bấm nhận. Tháng 2/2027 có 28 ngày, nên muốn có "Khung vàng" bạn phải điểm danh từ ngày 1/2 và không bỏ ngày nào. Nếu bạn đã có "Huy hiệu tháng" và "Chuyên cần", ngày 28 bạn chỉ nhận thêm món của tháng đó. Quà của những tháng sau sẽ được ghi trên lịch điểm danh của từng tháng.
```

In "Cách nhận đồ", the bullet "**Quà điểm danh**: …, ngày 28 ("Huy hiệu tháng" và "Chuyên cần"), xem mục 2." becomes "…, ngày 28 ("Huy hiệu tháng" và "Chuyên cần", từ 11/2026 thêm một món cực hiếm mỗi tháng), xem mục 2.", and the sentence "Thẻ của món còn khóa ghi cách nhận: tên thành tựu, hoặc "Có thể nhận từ quà điểm danh" kèm độ hiếm. Một số món hiện chưa có cách nhận, thẻ ghi "Chưa có cách nhận món này"." becomes "Thẻ của món còn khóa ghi cách nhận: tên thành tựu; "Quà điểm danh ngày 28", hoặc kèm tháng như "Quà điểm danh ngày 28 tháng 11/2026"; hoặc "Có thể nhận từ quà điểm danh" kèm độ hiếm. Món chưa có cách nhận, kể cả món chỉ được tặng ở một tháng đã qua, ghi "Chưa có cách nhận món này"."

- [ ] **Step 5: Operator docs (Edit tool)**

`docs/operation-test-plan.md` — after I-04:

```
| I-05 | Trang Điểm danh: đọc dòng chú thích dưới lịch, rồi rê chuột lên biểu tượng quà ở ô Ngày 28 | Có dòng "Ngày 28 tháng <tháng này>: Huy hiệu tháng + Chuyên cần" (tháng 10/2026); từ 01/11/2026 dòng đó có thêm "+ Mũ chóp quý ông", từ 01/12/2026 "+ Bịt mắt cướp biển"…; tooltip của ô Ngày 28 ghi đúng chuỗi tên ấy. Trên điện thoại dòng chú thích xuống dòng gọn trong trang | P2 |
```

after J-09:

```
| J-10 | Tủ đồ → Trang phục → Mũ, tích "Hiện cả món chưa có"; rồi Trang trí → Khung | Thẻ "Mũ chóp quý ông" ghi "Quà điểm danh ngày 28 tháng 11/2026", "Khung vàng" ghi "… tháng 02/2027", "Huy hiệu tháng" ghi "Quà điểm danh ngày 28". Khi tháng của một món đã qua, thẻ của món đó ghi "Chưa có cách nhận món này" | P2 |
```

after N-05:

```
| N-06 | Đổi quà của một tháng: sửa `apps/normal-server/data/daily-gifts.json` ở bản checkout chính (ví dụ chép mục `2027-04` thành `2027-05`), chạy `pnpm --filter @bp/normal-server exec vitest run src/economy/daily-gifts.test.ts`, rồi khi `/health` báo `"rooms":0` thì `stop.ps1` và `run.ps1 -NoMigrate`. Thử thêm một bản nháp có id sai | Test xanh; server chạy lại, `/health` báo ok; lịch điểm danh của tháng đó ghi quà mới. Với bản nháp id sai: test báo đúng id sai; nếu vẫn khởi động thì server từ chối chạy và `normal.err.log` ghi `invalid daily gift schedule … grants …, which is not in the item catalogue`. Khôi phục file đúng rồi chạy lại | P2 |
```

`deploy/normal-windows/README.md` — after "## 9b. Tài khoản test có đầy đủ tủ đồ" and its `---`, add:

````markdown
## 9c. Đổi quà điểm danh theo tháng

Quà vật phẩm của điểm danh (ngày 7, 14, 21, 28 của chuỗi) nằm trong `apps/normal-server/data/daily-gifts.json`: phần
`default` là quà của mọi tháng, phần `months` ghi đè từng ngày cho một tháng `YYYY-MM`. Ví dụ, tặng lại "Khung vàng" vào
ngày 28 tháng 05/2027:

```json
"2027-05": { "28": { "fixed": ["badge_monthly", "title_devoted", "frame_gold"] } }
```

Danh sách `fixed` của một tháng là danh sách **đầy đủ**: muốn giữ "Huy hiệu tháng" và "Chuyên cần" thì phải ghi lại cả
hai.

1. Sửa file ở bản checkout chính (làm trên một nhánh rồi gộp như mọi thay đổi khác).
2. Kiểm tra: `pnpm --filter @bp/normal-server exec vitest run src/economy/daily-gifts.test.ts`. Test đọc đúng file này
   cùng catalogue thật và chỉ ra chỗ sai.
3. Đợi `/health` báo `"rooms":0`, rồi chạy `.\stop.ps1` và `.\run.ps1 -NoMigrate`. Nếu chỉ sửa file này thì không cần
   `pnpm build:normal` (server đọc thư mục `data/` lúc khởi động), và không cần migration.
4. Nếu file sai mà vẫn khởi động, server dừng ngay và `normal.err.log` ghi `invalid daily gift schedule …: …`. Sửa
   file rồi chạy lại.

Chi tiết (tiếng Anh): `docs/normal-server.md`, mục "Changing the daily gifts".

---
````

`docs/deployment-normal.md` §5, before "### Vài truy vấn kinh tế hữu ích":

```markdown
**Đổi quà điểm danh theo tháng.** Lịch quà là `apps/normal-server/data/daily-gifts.json` và nằm trong image: sửa file,
kiểm tra bằng `pnpm --filter @bp/normal-server exec vitest run src/economy/daily-gifts.test.ts`, rồi `docker compose up -d
--build` như mục 7. Cách viết file: `docs/normal-server.md`, mục "Changing the daily gifts".
```

`docs/copy-review-2026-10-10.md` — append:

```markdown
## 8. Bổ sung 2026-10-12, Plan 22 — quà điểm danh theo tháng

`DAILY_FIXED_ITEM_IDS` không còn nữa: cặp quà ngày 28 nay nằm trong lịch quà `apps/normal-server/data/daily-gifts.json`
(spec `docs/superpowers/specs/2026-10-12-monthly-daily-gifts-design.md`). Các khóa thay đổi:

| khóa | trước | sau |
|---|---|---|
| wardrobe.hint.dailyFixed | Quà điểm danh ngày 28 (en: The day-28 check-in gift) | Quà điểm danh ngày {{day}} (en: The day-{{day}} check-in gift). Với ngày 28, chữ hiện ra không đổi |
| wardrobe.hint.dailyMonth (khóa mới) | không có | Quà điểm danh ngày {{day}} tháng {{month}} (en: The day-{{day}} check-in gift of {{month}}); tháng viết `MM/YYYY` |
| daily.marker.fixedDay (khóa mới) | không có | Ngày {{day}} tháng {{month}}: {{items}} (en: Day {{day}} of {{month}}: {{items}}), là dòng chú thích dưới lịch |
| daily.marker.monthly (bỏ) | Huy hiệu + danh hiệu tháng (en: Monthly badge + title) | không còn: ô ngày có quà định sẵn ghi tên từng món, nối bằng " + " |

Sáu món cực hiếm ở mục 7.2 nay đã có cách nhận: quà ngày 28, mỗi tháng một món từ 11/2026. Thẻ khóa của chúng ghi "Quà
điểm danh ngày 28 tháng 11/2026"…, rồi trở lại "Chưa có cách nhận món này" khi tháng của món đã qua.
```

Read a Vietnamese heading back from each of the five files after editing.

`docs/known-limitations.md`, section "## Operations", a new entry:

```markdown
**Changing the daily gifts needs a restart.** `data/daily-gifts.json` is read once, at boot (`loadDailyGifts`), like
`items.json` and `achievements.json`; there is no reload and no admin screen. On the Windows LAN host a restart is
`stop.ps1`, a hard kill that loses every stack on a table, so a schedule change waits for an empty host (`/health`
`"rooms":0`).
*Why:* the schedule changes a few times a year, and a reload path would be a second way for a bad file to reach a
running server; the boot check is what keeps a wrong id from failing on the 28th.
*What to do:* edit, run `daily-gifts.test.ts`, restart when the host is empty — `docs/normal-server.md`, "Changing the
daily gifts".
*Tracked:* spec `2026-10-12-monthly-daily-gifts-design.md` §10.
```

- [ ] **Step 6: The test matrix, the checklist and their pins**

`docs/test-matrix.md` — a section after the Plan 21 section, before "## Ruling recorded: the `reqId` cache is per connection":

```markdown
## Plan 22 — the monthly daily-check-in gifts (spec 2026-10-12)

Not rows of §29.2, §29.3 or §30: the user asked (12/10) for the six epics nobody could earn to become the day-28 gift,
one a month from 11/2026, and for a check-in whose item gifts can change month by month. The spec amends §13.2 and
§19.2 of the main design. The schedule is data (`apps/normal-server/data/daily-gifts.json`), so the rows hold the
loader, the claim that reads it, the two endpoints that carry it and the two screens that name it. The e2e harness
cannot move the server's clock, so a claim on 28/11/2026 is held at the service and HTTP layers; the one e2e line
checks the Daily screen's legend on the real build, outside `pnpm test`.

| Rule | Test file | Test name | Status |
|---|---|---|---|
| §13.2 (spec §4.1): the item column is `data/daily-gifts.json` — a `default`, and months keyed `YYYY-MM` whose rule for a tier replaces the default's; the shipped file keeps October 2026 and adds the six epics to day 28, one a month from 11/2026, in the user's order; a month's calendar carries each fixed tier's items | `apps/normal-server/src/economy/daily-gifts.test.ts`, `apps/normal-server/src/economy/daily-rules.test.ts` | the shipped schedule › keeps the October 2026 calendar as it was · hands out the six epics on day 28, one a month from 11/2026, in the order the user chose · resolving a day › falls back to the default for a month with no entry, and for a day the month does not name · lets a month replace a day of the default outright · lists every fixed id, default or month, past or future · builds the 31-day calendar of a month | added in Plan 22 |
| Spec §4.1.3, §6: a bad schedule stops the boot, naming the file and the problem | `apps/normal-server/src/economy/daily-gifts.test.ts` | refusing a bad file › refuses an item the catalogue does not hold · refuses an item every player already owns · refuses a day outside 1 to 31, and a day the month never reaches · refuses the same item twice in a day, or on two days of one month · refuses a draw that is not common or rare · refuses a malformed month key, an unknown top-level key and a missing default · says which file could not be read | added in Plan 22 |
| §13.2 and §19.2, the claim and the endpoints (spec §4.2–§4.4): the claim reads the month it is made in — day 28 of 11/2026 grants the badge, the title and the top hat, of 10/2026 the pair, and a gift already owned grants nothing and pays nothing; every named id stays off the draw; `GET /api/rewards/daily` serves the current month with `month` and a fixed day's `items`; `GET /api/catalog/items` carries `dailyGifts` from the current month on | `apps/normal-server/src/economy/economy-service.test.ts`, `apps/normal-server/src/http/routes-rewards.test.ts`, `apps/normal-server/src/app.test.ts` | grants the third gift of 11/2026 on day 28, and only the pair on day 28 of 10/2026 · grants the month badge and the devoted title on day 28, and pays no fallback for a repeat · exhausts the rare tier without ever handing out a reserved id · describes the calendar of the month it is asked in · tells the wardrobe which named gifts are still to come · grants the shipped November gift over HTTP · serves the calendar of the current month, with the item ids of a fixed day · serves the named daily gifts beside the catalogue, from the current month on | added in Plan 22 |
| Spec §4.3, §4.4, the screens: a named-gift day's cell says its gifts by name, and the legend repeats them with the day and the month; the legend explains only the draws the month has; a locked tile says the check-in month of a scheduled item, the day alone for a gift of every month, and "no way to earn this" once the month has gone; the month as MM/YYYY; every key in both languages; the legend on the real build | `apps/normal-web/src/screens/DailyScreen.test.tsx`, `apps/normal-web/src/screens/catalog.test.ts`, `apps/normal-web/src/screens/wardrobe/WardrobeScreen.test.tsx`, `apps/normal-web/src/screens/format.test.ts`, `apps/normal-web/src/locales/locales.test.ts`, `apps/normal-web/e2e/normal.spec.ts` | names every gift of a fixed day in its cell and in the legend, with the month · names a fixed gift on any day the schedule puts one · names the month of a scheduled epic, as the server gives it · names the day-28 check-in as the way to the month badge · for an epic whose month has passed · names the check-in month on a locked tile the schedule hands out · writes a YYYY-MM month key as MM/YYYY · declares every key in both languages · điểm danh hằng ngày (the legend's day-28 line) | added in Plan 22 — the e2e line runs outside `pnpm test` |
```

`docs/acceptance-checklist.md` — in the summary paragraph, after "…không tính vào 64 mục trên." add " Plan 22 (2026-10-12) thêm hai dòng nữa, P22.1 và P22.2, cũng ở cuối bảng: 2 ✓." After the P21 table (before the `---` above "## Những gì bảng này **không** khẳng định") add:

```markdown
Hai dòng dưới đây cũng **không** thuộc mục 40 hay mục 66: người dùng yêu cầu ngày 12/10 (sáu món cực hiếm chưa có cách
nhận trở thành quà ngày 28 theo tháng, và lịch quà điểm danh có thể đổi theo tháng). Thiết kế:
`docs/superpowers/specs/2026-10-12-monthly-daily-gifts-design.md`; ma trận kiểm thử ở cuối `docs/test-matrix.md`.

| # | Yêu cầu | Bằng chứng (evidence) | Trạng thái |
|---|---|---|---|
| P22.1 | Sáu món cực hiếm chưa có cách nhận trở thành quà ngày 28, mỗi tháng một món từ 11/2026 (11/2026 "Mũ chóp quý ông", 12/2026 "Bịt mắt cướp biển", 01/2027 "Hào quang sấm sét", 02/2027 "Khung vàng", 03/2027 "Tóc tím pastel", 04/2027 "Mắt vàng kim"); tháng 10/2026 giữ như cũ; lịch điểm danh và thẻ khóa trong tủ đồ gọi tên quà kèm tháng.<br>_The six epics nobody could earn become the day-28 gift, one a month from 11/2026; October 2026 is unchanged; the calendar and the wardrobe's locked tiles name the gift and its month._ | The shipped schedule: `apps/normal-server/src/economy/daily-gifts.test.ts` → `hands out the six epics on day 28, one a month from 11/2026, in the order the user chose`, and October as it was: `apps/normal-server/src/economy/daily-gifts.test.ts` → `keeps the October 2026 calendar as it was`. The claim: `apps/normal-server/src/economy/economy-service.test.ts` → `grants the third gift of 11/2026 on day 28, and only the pair on day 28 of 10/2026`; over HTTP, with the shipped file: `apps/normal-server/src/http/routes-rewards.test.ts` → `grants the shipped November gift over HTTP`. The screens: `apps/normal-web/src/screens/DailyScreen.test.tsx` → `names every gift of a fixed day in its cell and in the legend, with the month`; `apps/normal-web/src/screens/catalog.test.ts` → `names the month of a scheduled epic, as the server gives it`. Manual: from 01/11/2026 the Daily screen's legend reads "Ngày 28 tháng 11/2026: Huy hiệu tháng + Chuyên cần + Mũ chóp quý ông" (operation test plan I-05, J-10). | ✓ |
| P22.2 | Lịch quà điểm danh là dữ liệu: người vận hành thêm hay đổi quà của một tháng trong `apps/normal-server/data/daily-gifts.json` rồi khởi động lại, không sửa code, không đụng database; file sai thì server không khởi động và nói rõ sai ở đâu.<br>_The check-in's gift schedule is data an operator edits and restarts on, with no code or database change; a bad file stops the boot and says what is wrong._ | Months over a default: `apps/normal-server/src/economy/daily-gifts.test.ts` → `lets a month replace a day of the default outright`; `apps/normal-server/src/economy/daily-gifts.test.ts` → `falls back to the default for a month with no entry`. The refusals: `apps/normal-server/src/economy/daily-gifts.test.ts` → `refuses an item the catalogue does not hold`; `apps/normal-server/src/economy/daily-gifts.test.ts` → `says which file could not be read`. What the wardrobe is told, month by month: `apps/normal-server/src/app.test.ts` → `serves the named daily gifts beside the catalogue, from the current month on`. Manual: `docs/normal-server.md`, "Changing the daily gifts"; operation test plan N-06. | ✓ |
```

`tooling/arch/acceptance-links.test.ts`:

```ts
    // 21 items in §40, 43 in §66, the three rows of Plan 21 (P21.1–P21.3) and the two of Plan 22 (P22.1, P22.2), which
    // are not requirement.txt's — a row that stops parsing is a row that stops being checked
    expect(rows).toHaveLength(64 + 3 + 2)
```

and

```ts
    // 16 rows of §29.2, 1 of §29.3, 25 of §30 — the counts the document's own summary gives — the text-overlap
    // rule of the 2026-09-29 review (No11b), the one row of Plan 16 that is not the spec's, the ten rows of Plan 21's
    // section (the squeeze round and the card motion, spec 2026-10-08), and the four of Plan 22's (the monthly daily
    // gifts, spec 2026-10-12)
    expect(rows).toBe(43 + 10 + 4)
```

`CLAUDE.md` §3, the doc-citation rule: "today the checklist is `64 + 3` and the matrix `43 + 10`" becomes "today the checklist is `64 + 3 + 2` and the matrix `43 + 10 + 4`".

- [ ] **Step 7: Check the citations**

Run: `pnpm exec vitest run --root . tooling/arch`
Expected: PASS — every checklist title occurs in its file, every matrix fragment in one of its row's files, and the row counts match the new pins. A failure names the line: fix the doc (never the test title) unless the title itself is wrong in the doc.

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/specs/2026-09-04-bind-poker-design.md docs/normal-server.md docs/normal-web.md docs/player-guide.md docs/operation-test-plan.md deploy/normal-windows/README.md docs/deployment-normal.md docs/copy-review-2026-10-10.md docs/known-limitations.md docs/test-matrix.md docs/acceptance-checklist.md tooling/arch/acceptance-links.test.ts CLAUDE.md
git commit -m "docs: the monthly daily gifts — SRS §13.2/§19.2 amendments, how an operator changes a month (normal-server.md, the LAN README), the player guide's month table, ops rows I-05/J-10/N-06, the matrix and checklist rows with their pins"
```

---

## Self-review

**Spec coverage.** §1 goals → Tasks 1–3. §2 Q1/Q2 (the six months, October unchanged) → Task 1's data file and `the shipped schedule` tests; Q3/Q4 (data, the shape) → Task 1; Q5 (replace) → Task 1 `parseDailyGifts` and `lets a month replace a day of the default outright`; Q6 (draw common/rare) → Task 1 `parseRule`; Q7 (the checks) → Task 1 `refusing a bad file`; Q8 (named ids off the draw) → Task 1 `fixedItemIds`, Task 2 `excludedIds`; Q9 (the month) → Task 2 `dailyStatus` and its boundary assertions; Q10/Q11 (names, the legend) → Task 3 Step 6; Q12/Q14 (`dailyGifts` on the catalogue, the default first) → Task 1 `noticesFrom`, Task 2 Step 6; Q13 (the hint's words) → Task 3 Steps 4 and 7; Q15 (Lite) → untouched; Q16 (the operator's check) → Task 1's test file and Task 4's docs; Q17 (e2e) → Task 3 Step 9. §4.1–§4.5 → Tasks 1, 2, 3, 4 in that order. §5 → the File structure. §6: boot failure → Task 2 Step 6 (`loadDailyGifts` before `seed`); old bundle → `item` keeps its old meaning (Task 2 Step 3); new bundle against an old server → `dailyGifts ?? []` (Task 3 Step 7). §7 → no money path is edited; `credits 10,000 under its own reason when the tier has nothing unowned left` and `exhausts the rare tier…` still pass. §8 → each task's tests. §9 → Task 4.

**Producer → consumer pairs.** Task 1's `DailyGiftSchedule.itemRuleForDay(day, month)` is what Task 2's `dailyCalendar` (as a `Pick`), `applyItemRule` and `dailyStatus` call; `fixedItemIds()` feeds `excludedIds`; `noticesFrom(month)` feeds `dailyGiftNotices`, which `routes.ts` hands to `registerCatalogRoutes` as `dailyGifts`. Task 2's wire fields — `month`, `calendar[].items`, `dailyGifts[]: { itemId, day, month }` — are exactly Task 3's `DailyStatusDto.month`, `CalendarEntryDto.items`, `DailyGiftNoticeDto`. Task 3's test titles are the ones Task 4 cites; Task 4 Step 7 checks them mechanically.

**Type consistency.** `DailyItemRule` stays in `daily-rules.ts` (Task 1 imports it; Task 2 keeps it). `daily-rules.ts` imports `DailyGiftSchedule` as a type only, so there is no run-time cycle. `CalendarEntry.items` is required on the server and on `CalendarEntryDto`; `CatalogItemsDto.dailyGifts` is optional on the client only (the older-server case and the existing test mocks), required on the server. `MarkerKind` drops `'monthly'` for `'fixed'`, and the one CSS selector follows. `hintFor`'s second argument changes from an array to `HintSources` in every caller (three tabs, five props in `WardrobeScreen`, the tests).

**Watch for (to ledger if they bite):** `tsc` and the `{ kind: 'randomUnowned', rarity }` literal (the fallback is written under Task 1 Step 4); the existing `grants the month badge … for a repeat` test moves its repeat to December because November gains a gift — its title stays, so no doc changes; two server tests (`routes-rewards.test.ts`, `app.test.ts`) read the shipped file on purpose and pin the user's months, which `docs/normal-server.md` tells an operator before they edit those months.
