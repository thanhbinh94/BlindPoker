import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asc, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { items } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import { DAILY_FIXED_ITEM_IDS } from '../economy/daily-rules.js'
import { REQUIRED_LAYERS } from './avatar.js'
import type { ItemDef } from './items.js'
import { ITEM_CATEGORIES, loadItemCatalog } from './items.js'

let test: TestDb
let db: AppDb
let scratch: string

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
  scratch = mkdtempSync(join(tmpdir(), 'bp-items-'))
})
afterAll(async () => {
  await test.close()
  rmSync(scratch, { recursive: true, force: true })
})

let seq = 0
/** Writes a throwaway `items.json` and returns its path. */
function fixture(defs: unknown): string {
  seq += 1
  const path = join(scratch, `items-${seq}.json`)
  writeFileSync(path, JSON.stringify(defs), 'utf8')
  return path
}

const MINIMAL: ItemDef[] = [
  { id: 'base_01', category: 'base', rarity: 'common', nameKey: 'items.base_01', assetKey: 'base/base_01', isDefault: true },
  { id: 'face_01', category: 'face', rarity: 'common', nameKey: 'items.face_01', assetKey: 'face/face_01', isDefault: true },
  { id: 'clothing_tee', category: 'clothing', rarity: 'common', nameKey: 'items.clothing_tee', assetKey: 'clothing/clothing_tee', isDefault: true },
  { id: 'hair_short', category: 'hair', rarity: 'common', nameKey: 'items.hair_short', assetKey: 'hair/hair_short', isDefault: true },
  { id: 'badge_monthly', category: 'badge', rarity: 'rare', nameKey: 'items.badge_monthly', assetKey: 'badge/badge_monthly', isDefault: false },
  { id: 'title_devoted', category: 'title', rarity: 'rare', nameKey: 'items.title_devoted', assetKey: 'title/title_devoted', isDefault: false },
]

describe('the shipped catalogue', () => {
  const catalog = loadItemCatalog()

  it('has around forty items spread across all eight categories', () => {
    const all = catalog.all()
    expect(all.length).toBeGreaterThanOrEqual(40)
    for (const category of ITEM_CATEGORIES) expect(all.some((d) => d.category === category)).toBe(true)
  })

  it('names its defaults, one per required layer', () => {
    expect(catalog.defaults().sort()).toEqual(['base_01', 'clothing_tee', 'face_01', 'hair_short'])
    for (const layer of REQUIRED_LAYERS) {
      expect(catalog.all().filter((d) => d.category === layer && d.isDefault)).toHaveLength(1)
    }
  })

  it('composes its defaults into the avatar a new account is registered wearing', () => {
    // The method `AuthService` calls through `DefaultItemCatalog`, so it is wired here rather than
    // only through the standalone `defaultAvatar(catalog)` its tests use.
    expect(catalog.defaultAvatar()).toEqual({ base: 'base_01', face: 'face_01', clothing: 'clothing_tee', hair: 'hair_short', hairColor: '#2b2b2b' })
    expect(catalog.defaults()).toContain(catalog.defaultAvatar().hair)
  })

  it('contains every id the daily reward and the achievements promise', () => {
    for (const id of [...DAILY_FIXED_ITEM_IDS, 'hat_crown', 'jacket_champion', 'ring_royal', 'badge_veteran', 'title_devoted', 'title_hot_hand']) {
      expect(catalog.get(id), id).toBeDefined()
    }
    expect(catalog.get('hat_crown')).toMatchObject({ category: 'accessory', rarity: 'epic' })
    expect(catalog.get('jacket_champion')).toMatchObject({ category: 'clothing', rarity: 'epic' })
    expect(catalog.get('ring_royal')).toMatchObject({ category: 'jewelry', rarity: 'epic' })
    expect(catalog.get('badge_veteran')).toMatchObject({ category: 'badge', rarity: 'epic' })
    expect(catalog.get('badge_monthly')).toMatchObject({ category: 'badge', rarity: 'rare' })
  })

  it('keeps the nameKey and assetKey conventions on every row', () => {
    for (const def of catalog.all()) {
      expect(def.nameKey).toBe(`items.${def.id}`)
      expect(def.assetKey).toBe(`${def.category}/${def.id}`)
    }
  })

  it('leaves enough unowned commons and rares for the daily tiers to draw several before running dry', () => {
    // Day 7 draws a common the player does not already own, and four commons are handed out at
    // registration; day 14 and day 21 both draw a rare.
    expect(catalog.byRarity('common').length - catalog.defaults().length).toBeGreaterThanOrEqual(5)
    expect(catalog.byRarity('rare').length).toBeGreaterThanOrEqual(5)
    expect(catalog.byRarity('epic').length).toBeGreaterThanOrEqual(4)
  })
})

describe('loadItemCatalog', () => {
  it('accepts a minimal but complete catalogue', () => {
    expect(loadItemCatalog(fixture(MINIMAL)).all()).toHaveLength(MINIMAL.length)
  })

  it('refuses a duplicate id', () => {
    expect(() => loadItemCatalog(fixture([...MINIMAL, MINIMAL[0]]))).toThrow(/duplicate item id base_01/)
  })

  it('refuses a required layer with no default', () => {
    const noHairDefault = MINIMAL.map((d) => (d.category === 'hair' ? { ...d, isDefault: false } : d))
    expect(() => loadItemCatalog(fixture(noHairDefault))).toThrow(/no default item for the required layer hair/)
  })

  it('refuses a catalogue the day-28 reward could not be paid from', () => {
    expect(() => loadItemCatalog(fixture(MINIMAL.filter((d) => d.id !== 'badge_monthly')))).toThrow(/badge_monthly, which is not in the catalogue/)
  })

  it('refuses an unknown category or rarity', () => {
    expect(() => loadItemCatalog(fixture([...MINIMAL, { ...MINIMAL[0], id: 'x', category: 'cape' }]))).toThrow(/unknown category cape/)
    expect(() => loadItemCatalog(fixture([...MINIMAL, { ...MINIMAL[0], id: 'x', rarity: 'mythic' }]))).toThrow(/unknown rarity mythic/)
  })

  it('refuses a malformed file', () => {
    expect(() => loadItemCatalog(fixture({ items: MINIMAL }))).toThrow(/not a JSON array/)
    expect(() => loadItemCatalog(join(scratch, 'nope.json'))).toThrow(/could not read item catalogue/)
  })
})

describe('seed', () => {
  it('upserts the catalogue, and can be run again on every boot', async () => {
    const catalog = loadItemCatalog(fixture(MINIMAL))
    await catalog.seed(db)
    await catalog.seed(db)

    const rows = await db.select().from(items).orderBy(asc(items.id))
    expect(rows).toHaveLength(MINIMAL.length)
    expect(rows.find((r) => r.id === 'base_01')).toMatchObject({ category: 'base', rarity: 'common', isDefault: true })
  })

  it('carries an edited row into a database that already has the old one', async () => {
    const edited = MINIMAL.map((d) => (d.id === 'badge_monthly' ? { ...d, rarity: 'epic' as const, nameKey: 'items.renamed' } : d))
    await loadItemCatalog(fixture(edited)).seed(db)

    const [row] = await db.select().from(items).where(sql`${items.id} = 'badge_monthly'`)
    expect(row).toMatchObject({ rarity: 'epic', nameKey: 'items.renamed' })
  })
})
