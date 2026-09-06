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
import type { ItemDef, ItemVariants } from './items.js'
import { loadItemCatalog } from './items.js'
import { BODIES, GEOMETRIC_SLOTS, REQUIRED_SLOTS, SLOTS } from './slots.js'
import type { ItemSlot } from './slots.js'

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

const FILE_OF: Partial<Record<ItemSlot, string>> = { hair: 'hair.glb', top: 'outfits.glb', bottom: 'outfits.glb', shoes: 'outfits.glb' }

function variants(slot: ItemSlot, id: string): ItemVariants {
  const file = FILE_OF[slot]!
  return { male: { file, node: `${slot}/${id}/male` }, female: { file, node: `${slot}/${id}/female` } }
}

function wearable(id: string, slot: ItemSlot, isDefault: boolean): ItemDef {
  return { id, slot, rarity: 'common', nameKey: `items.${id}`, assetKey: `${slot}/${id}`, isDefault, variants: variants(slot, id) }
}

const MINIMAL: ItemDef[] = [
  wearable('hair_none', 'hair', true),
  wearable('top_tee', 'top', true),
  wearable('bottom_jeans', 'bottom', true),
  wearable('shoes_sneakers', 'shoes', true),
  { id: 'badge_monthly', slot: 'badge', rarity: 'rare', nameKey: 'items.badge_monthly', assetKey: 'badge/badge_monthly', isDefault: false },
  { id: 'title_devoted', slot: 'title', rarity: 'rare', nameKey: 'items.title_devoted', assetKey: 'title/title_devoted', isDefault: false },
]

describe('the shipped catalogue', () => {
  const catalog = loadItemCatalog()

  it('has exactly forty-two items spread across all nine slots', () => {
    const all = catalog.all()
    expect(all.length).toBe(42)
    for (const slot of SLOTS) expect(all.some((d) => d.slot === slot), slot).toBe(true)
    // The v1 slots are gone, ids included: a body is chosen rather than worn, and a face is colour.
    expect(all.some((d) => d.id.startsWith('base_') || d.id.startsWith('face_'))).toBe(false)
  })

  it('names its defaults, exactly one per required slot', () => {
    expect(catalog.defaults().sort()).toEqual(['bottom_jeans', 'hair_none', 'shoes_sneakers', 'top_tee'])
    for (const slot of REQUIRED_SLOTS) {
      expect(catalog.all().filter((d) => d.slot === slot && d.isDefault), slot).toHaveLength(1)
      expect(catalog.defaultOf(slot)?.slot).toBe(slot)
    }
    // Nothing is a default in an optional slot: a new account wears the plainest figure there is.
    expect(catalog.defaultOf('hat')).toBeUndefined()
  })

  it('composes its defaults into the avatar a new account is registered wearing', () => {
    // The method `AuthService` calls through `DefaultItemCatalog`, so it is wired here rather than
    // only through the standalone `defaultAvatar(catalog)` its tests use.
    expect(catalog.defaultAvatar()).toMatchObject({ v: 2, body: 'male', hair: 'hair_none', top: 'top_tee', bottom: 'bottom_jeans', shoes: 'shoes_sneakers' })
    expect(catalog.defaults()).toContain(catalog.defaultAvatar().hair)
  })

  it('contains every id the daily reward and the achievements promise, in its v2 slot', () => {
    for (const id of [...DAILY_FIXED_ITEM_IDS, 'hat_crown', 'jacket_champion', 'ring_royal', 'badge_veteran', 'title_devoted', 'title_hot_hand']) {
      expect(catalog.get(id), id).toBeDefined()
    }
    // `hat_crown` was an `accessory` in v1 and is a hat now; the ids themselves never moved, which
    // is what keeps `achievements.json` and the day-28 pair untouched by this plan.
    expect(catalog.get('hat_crown')).toMatchObject({ slot: 'hat', rarity: 'epic' })
    expect(catalog.get('jacket_champion')).toMatchObject({ slot: 'top', rarity: 'epic' })
    expect(catalog.get('ring_royal')).toMatchObject({ slot: 'jewelry', rarity: 'epic' })
    expect(catalog.get('badge_veteran')).toMatchObject({ slot: 'badge', rarity: 'epic' })
    expect(catalog.get('badge_monthly')).toMatchObject({ slot: 'badge', rarity: 'rare' })
    // The v1 shirt, renamed. `avatar-migrate.ts` is what keeps the old id readable.
    expect(catalog.get('clothing_tee')).toBeUndefined()
    expect(catalog.get('top_tee')).toMatchObject({ slot: 'top', isDefault: true })
    expect(catalog.get('accessory_conical_hat')).toMatchObject({ slot: 'hat' })
    expect(catalog.get('accessory_glasses')).toMatchObject({ slot: 'accessory' })
  })

  it('keeps the nameKey and assetKey conventions on every row', () => {
    for (const def of catalog.all()) {
      expect(def.nameKey).toBe(`items.${def.id}`)
      expect(def.assetKey).toBe(`${def.slot}/${def.id}`)
    }
  })

  it('models every geometric item for both bodies, and nothing else at all', () => {
    for (const def of catalog.all()) {
      if (!GEOMETRIC_SLOTS.includes(def.slot)) {
        expect(def.variants, def.id).toBeUndefined()
        continue
      }
      for (const body of BODIES) {
        const ref = def.variants?.[body]
        expect(ref, `${def.id}/${body}`).toBeDefined()
        // The convention the asset build names its nodes by; `test/catalog-manifest.test.ts` holds
        // the same values against the manifest that build actually produced.
        expect(ref!.node).toBe(`${def.slot}/${def.id}/${body}`)
        expect(ref!.file).toMatch(/^(hair|outfits|accessories)\.glb$/)
      }
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
    expect(() => loadItemCatalog(fixture([...MINIMAL, MINIMAL[0]]))).toThrow(/duplicate item id hair_none/)
  })

  it('refuses a required slot with no default, and one with two', () => {
    const noHairDefault = MINIMAL.map((d) => (d.slot === 'hair' ? { ...d, isDefault: false } : d))
    expect(() => loadItemCatalog(fixture(noHairDefault))).toThrow(/no default item for the required slot hair/)
    // Two defaults would make the avatar a new account is registered wearing depend on file order.
    expect(() => loadItemCatalog(fixture([...MINIMAL, wearable('hair_short', 'hair', true)]))).toThrow(/the required slot hair has 2 defaults/)
  })

  it('refuses a default in an optional slot, which nothing would ever wear', () => {
    const def = { id: 'hat_crown', slot: 'hat', rarity: 'epic', nameKey: 'items.hat_crown', assetKey: 'hat/hat_crown', isDefault: true,
      variants: { male: { file: 'accessories.glb', node: 'hat/hat_crown/male' } } }
    expect(() => loadItemCatalog(fixture([...MINIMAL, def]))).toThrow(/hat_crown is a default in the optional slot hat/)
  })

  it('refuses a catalogue the day-28 reward could not be paid from', () => {
    expect(() => loadItemCatalog(fixture(MINIMAL.filter((d) => d.id !== 'badge_monthly')))).toThrow(/badge_monthly, which is not in the catalogue/)
  })

  it('refuses an unknown slot or rarity', () => {
    expect(() => loadItemCatalog(fixture([...MINIMAL, { ...MINIMAL[0], id: 'x', slot: 'cape' }]))).toThrow(/unknown slot cape/)
    expect(() => loadItemCatalog(fixture([...MINIMAL, { ...MINIMAL[0], id: 'x', rarity: 'mythic' }]))).toThrow(/unknown rarity mythic/)
  })

  it('refuses an assetKey that does not follow the <slot>/<id> convention', () => {
    const wrongAssetKey = MINIMAL.map((d) => (d.id === 'top_tee' ? { ...d, assetKey: 'top/shirt' } : d))
    expect(() => loadItemCatalog(fixture(wrongAssetKey))).toThrow(/top_tee has assetKey top\/shirt rather than top\/top_tee/)
  })

  it('refuses geometry that does not exist, and geometry where there is nothing to model', () => {
    const bare = MINIMAL.map((d) => (d.id === 'top_tee' ? { ...d, variants: undefined } : d))
    expect(() => loadItemCatalog(fixture(bare))).toThrow(/top_tee is in the geometric slot top but has no variants/)

    const dressedTitle = MINIMAL.map((d) => (d.id === 'title_devoted' ? { ...d, variants: variants('top', 'title_devoted') } : d))
    expect(() => loadItemCatalog(fixture(dressedTitle))).toThrow(/title_devoted is in the slot title, which has no geometry/)

    const empty = MINIMAL.map((d) => (d.id === 'top_tee' ? { ...d, variants: {} } : d))
    expect(() => loadItemCatalog(fixture(empty))).toThrow(/top_tee has variants for no body at all/)

    const alien = MINIMAL.map((d) => (d.id === 'top_tee' ? { ...d, variants: { robot: { file: 'outfits.glb', node: 'top/top_tee/robot' } } } : d))
    expect(() => loadItemCatalog(fixture(alien))).toThrow(/top_tee has a variant for the unknown body robot/)
  })

  it('refuses geometry that breaks the file or node convention the asset build follows', () => {
    const wrongFile = MINIMAL.map((d) => (d.id === 'hair_none' ? { ...d, variants: { male: { file: 'outfits.glb', node: 'hair/hair_none/male' } } } : d))
    expect(() => loadItemCatalog(fixture(wrongFile))).toThrow(/hair_none's male variant is in outfits.glb rather than hair.glb/)

    const wrongNode = MINIMAL.map((d) => (d.id === 'hair_none' ? { ...d, variants: { male: { file: 'hair.glb', node: 'hair/hair_none' } } } : d))
    expect(() => loadItemCatalog(fixture(wrongNode))).toThrow(/names the node hair\/hair_none rather than hair\/hair_none\/male/)

    const badTint = MINIMAL.map((d) => (d.id === 'hair_none' ? { ...d, variants: { male: { file: 'hair.glb', node: 'hair/hair_none/male', tint: 'gold' } } } : d))
    expect(() => loadItemCatalog(fixture(badTint))).toThrow(/tint that is not #rrggbb/)
  })

  it('refuses a malformed file', () => {
    expect(() => loadItemCatalog(fixture({ items: MINIMAL }))).toThrow(/not a JSON array/)
    expect(() => loadItemCatalog(join(scratch, 'nope.json'))).toThrow(/could not read item catalogue/)
  })
})

describe('seed', () => {
  it('upserts the catalogue into the column the slot is stored in, and can be run again on every boot', async () => {
    const catalog = loadItemCatalog(fixture(MINIMAL))
    await catalog.seed(db)
    await catalog.seed(db)

    const rows = await db.select().from(items).orderBy(asc(items.id))
    expect(rows).toHaveLength(MINIMAL.length)
    // `slot` is the TS field; `category` is still the column, which is why this reads it back
    // through the schema rather than trusting the insert.
    expect(rows.find((r) => r.id === 'top_tee')).toMatchObject({ slot: 'top', rarity: 'common', isDefault: true, assetKey: 'top/top_tee' })
  })

  it('carries an edited row into a database that already has the old one', async () => {
    const edited = MINIMAL.map((d) => (d.id === 'badge_monthly' ? { ...d, rarity: 'epic' as const, nameKey: 'items.renamed' } : d))
    await loadItemCatalog(fixture(edited)).seed(db)

    const [row] = await db.select().from(items).where(sql`${items.id} = 'badge_monthly'`)
    expect(row).toMatchObject({ rarity: 'epic', nameKey: 'items.renamed' })
  })
})
