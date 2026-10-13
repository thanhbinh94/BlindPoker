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
      // `JSON.stringify` cannot write two equal keys, so this one is raw text.
      writeFileSync(path, '{ "default": { "28": { "fixed": ["badge_monthly"] } }, "months": { "2026-11": {}, "2026-11": {} } }', 'utf8')
      expect(() => loadDailyGifts(catalog, path)).toThrow(/month 2026-11 appears twice/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
