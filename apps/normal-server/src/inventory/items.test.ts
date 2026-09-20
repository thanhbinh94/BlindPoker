import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asc, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { items } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import { DAILY_FIXED_ITEM_IDS } from '../economy/daily-rules.js'
import type { AvatarManifest } from './manifest.js'
import { loadAvatarManifest } from './manifest.js'
import type { AssetRef, ItemDef } from './items.js'
import { loadItemCatalog } from './items.js'
import { DRAWN_SLOTS, SLOTS } from './slots.js'
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

const LAYER_OF: Partial<Record<ItemSlot, AssetRef['layer']>> = { head: 80, face: 70, outfit: 40, aura: 10, frame: 90 }

/** A tiny manifest that names exactly the files the fixtures below reference. */
const MANIFEST: AvatarManifest = {
  version: 1,
  frame: { w: 384, h: 448 },
  crop: { x: 88, y: 40, size: 208 },
  files: {
    item_outfit_casual01_L40: { layer: 40, w: 1, h: 1, bytes2x: 1 },
    item_outfit_dealer01_L40: { layer: 40, w: 1, h: 1, bytes2x: 1 },
    item_outfit_dealer01_m_L40: { layer: 40, w: 1, h: 1, bytes2x: 1 },
    item_head_beanie01_L80: { layer: 80, w: 1, h: 1, bytes2x: 1 },
    item_head_wrong_layer: { layer: 70, w: 1, h: 1, bytes2x: 1 },
  },
}

function asset(slot: ItemSlot, file: string, extra: Partial<AssetRef> = {}): AssetRef {
  return { layer: LAYER_OF[slot]!, file, fitsAvatarCrop: true, ...extra }
}

function drawable(id: string, slot: ItemSlot, isDefault: boolean, file: string): ItemDef {
  return { id, slot, rarity: 'common', nameKey: `items.${id}`, assetKey: `${slot}/${id}`, isDefault, asset: asset(slot, file) }
}

const MINIMAL: ItemDef[] = [
  drawable('outfit_casual01', 'outfit', true, 'item_outfit_casual01_L40'),
  { id: 'badge_monthly', slot: 'badge', rarity: 'rare', nameKey: 'items.badge_monthly', assetKey: 'badge/badge_monthly', isDefault: false },
  { id: 'title_devoted', slot: 'title', rarity: 'rare', nameKey: 'items.title_devoted', assetKey: 'title/title_devoted', isDefault: false },
]

function fixtureWith(...defs: ItemDef[]): string {
  return fixture([...MINIMAL, ...defs])
}

describe('the shipped catalogue', () => {
  const catalog = loadItemCatalog()

  it('has forty-two items spread across all seven slots', () => {
    const all = catalog.all()
    expect(all.length).toBe(42)
    for (const slot of SLOTS) expect(all.some((d) => d.slot === slot), slot).toBe(true)
    // The v2 slots are gone: a wardrobe piece is one PNG layer now, not a body part it dresses.
    expect(all.some((d) => ['hair', 'top', 'bottom', 'shoes', 'hat', 'accessory', 'jewelry'].includes(d.slot))).toBe(false)
  })

  it('names its one default — the only required slot', () => {
    expect(catalog.defaults()).toEqual(['outfit_casual01'])
    expect(catalog.defaultOf('outfit')).toMatchObject({ id: 'outfit_casual01' })
    // Nothing is a default in an optional slot: a new account wears the plainest figure there is.
    expect(catalog.defaultOf('head')).toBeUndefined()
  })

  it('composes its default into the avatar a new account is registered wearing', () => {
    // The method `AuthService` calls through `DefaultItemCatalog`, so it is wired here rather than
    // only through the standalone `defaultAvatar(catalog)` its tests use.
    expect(catalog.defaultAvatar()).toEqual({ v: 3, base: 'f01', outfit: 'outfit_casual01' })
  })

  it('contains every id the daily reward and the achievements promise, in its v3 slot', () => {
    for (const id of [...DAILY_FIXED_ITEM_IDS, 'head_crown_gold01', 'outfit_champion01', 'aura_gold_cards01', 'badge_veteran', 'title_devoted', 'title_hot_hand', 'frame_founder', 'frame_veteran']) {
      expect(catalog.get(id), id).toBeDefined()
    }
    expect(catalog.get('head_crown_gold01')).toMatchObject({ slot: 'head', rarity: 'epic' })
    expect(catalog.get('outfit_champion01')).toMatchObject({ slot: 'outfit', rarity: 'epic' })
    expect(catalog.get('aura_gold_cards01')).toMatchObject({ slot: 'aura', rarity: 'epic' })
    expect(catalog.get('badge_veteran')).toMatchObject({ slot: 'badge', rarity: 'epic' })
    expect(catalog.get('badge_monthly')).toMatchObject({ slot: 'badge', rarity: 'rare' })
    // The v2 ids: gone from the catalogue outright. `item-aliases.json` is what keeps them readable.
    expect(catalog.get('hat_crown')).toBeUndefined()
    expect(catalog.get('accessory_glasses')).toBeUndefined()
    expect(catalog.get('outfit_casual01')).toMatchObject({ slot: 'outfit', isDefault: true })
  })

  it('keeps the nameKey and assetKey conventions on every row', () => {
    for (const def of catalog.all()) {
      expect(def.nameKey).toBe(`items.${def.id}`)
      expect(def.assetKey).toBe(`${def.slot}/${def.id}`)
    }
  })

  it('gives every drawn-slot item an asset on the slot’s canonical layer, and nothing else one at all', () => {
    const layerOf: Partial<Record<ItemSlot, number>> = { head: 80, face: 70, outfit: 40, aura: 10, frame: 90 }
    for (const def of catalog.all()) {
      if (!DRAWN_SLOTS.includes(def.slot)) {
        expect(def.asset, def.id).toBeUndefined()
        continue
      }
      expect(def.asset, def.id).toBeDefined()
      expect(def.asset!.layer, def.id).toBe(layerOf[def.slot])
      expect(typeof def.asset!.fitsAvatarCrop, def.id).toBe('boolean')
    }
  })

  it('names, for every drawn item, a file the manifest actually built', () => {
    const manifest = loadAvatarManifest()
    for (const def of catalog.all()) {
      if (def.asset === undefined) continue
      const entry = manifest.files[def.asset.file]
      expect(entry, `${def.id}: ${def.asset.file}`).toBeDefined()
      expect(entry!.layer, def.id).toBe(def.asset.layer)
    }
  })

  it('marks the one head item that hides the base’s hair', () => {
    expect(catalog.get('head_hood_black01')?.asset).toMatchObject({ hidesHairFront: true, hidesHairBack: true })
    expect(catalog.get('head_beanie01')?.asset?.hidesHairFront).toBeUndefined()
  })

  it('leaves enough unowned commons and rares for the daily tiers to draw several before running dry', () => {
    expect(catalog.byRarity('common').length).toBeGreaterThanOrEqual(5)
    expect(catalog.byRarity('rare').length).toBeGreaterThanOrEqual(5)
    expect(catalog.byRarity('epic').length).toBeGreaterThanOrEqual(4)
  })
})

describe('loadItemCatalog', () => {
  it('accepts a minimal but complete catalogue', () => {
    expect(loadItemCatalog(fixtureWith(), MANIFEST).all()).toHaveLength(MINIMAL.length)
  })

  it('refuses a duplicate id', () => {
    expect(() => loadItemCatalog(fixtureWith(MINIMAL[0]!), MANIFEST)).toThrow(/duplicate item id outfit_casual01/)
  })

  it('refuses a required slot with no default, and one with two', () => {
    const noDefault = [{ ...MINIMAL[0]!, isDefault: false }, MINIMAL[1]!, MINIMAL[2]!]
    expect(() => loadItemCatalog(fixture(noDefault), MANIFEST)).toThrow(/no default item for the required slot outfit/)

    const twoDefaults = fixtureWith(drawable('outfit_other', 'outfit', true, 'item_outfit_casual01_L40'))
    expect(() => loadItemCatalog(twoDefaults, MANIFEST)).toThrow(/the required slot outfit has 2 defaults/)
  })

  it('refuses a default in an optional slot, which nothing would ever wear', () => {
    const def = drawable('head_default', 'head', true, 'item_head_beanie01_L80')
    expect(() => loadItemCatalog(fixtureWith(def), MANIFEST)).toThrow(/head_default is a default in the optional slot head/)
  })

  it('refuses a catalogue the day-28 reward could not be paid from', () => {
    expect(() => loadItemCatalog(fixture(MINIMAL.filter((d) => d.id !== 'badge_monthly')), MANIFEST)).toThrow(/badge_monthly, which is not in the catalogue/)
  })

  it('refuses an unknown slot or rarity', () => {
    expect(() => loadItemCatalog(fixtureWith({ ...MINIMAL[0]!, id: 'x', slot: 'cape' as ItemSlot }), MANIFEST)).toThrow(/unknown slot cape/)
    expect(() => loadItemCatalog(fixtureWith({ ...MINIMAL[1]!, id: 'x', rarity: 'mythic' as never }), MANIFEST)).toThrow(/unknown rarity mythic/)
  })

  it('refuses an assetKey that does not follow the <slot>/<id> convention', () => {
    const wrongAssetKey = [{ ...MINIMAL[0]!, assetKey: 'outfit/shirt' }, MINIMAL[1]!, MINIMAL[2]!]
    expect(() => loadItemCatalog(fixture(wrongAssetKey), MANIFEST)).toThrow(/outfit_casual01 has assetKey outfit\/shirt rather than outfit\/outfit_casual01/)
  })

  it('refuses an asset where there is nothing to draw, and a drawn slot with no asset', () => {
    const bare = [{ ...MINIMAL[0]!, asset: undefined }, MINIMAL[1]!, MINIMAL[2]!]
    expect(() => loadItemCatalog(fixture(bare), MANIFEST)).toThrow(/outfit_casual01 is in the drawn slot outfit but has no asset/)

    const dressedTitle = [MINIMAL[0]!, MINIMAL[1]!, { ...MINIMAL[2]!, asset: asset('outfit', 'item_outfit_casual01_L40') }]
    expect(() => loadItemCatalog(fixture(dressedTitle), MANIFEST)).toThrow(/title_devoted is in the slot title, which is never drawn, but has an asset/)
  })

  it('refuses an asset whose layer is not the slot’s canonical one', () => {
    const wrongLayer = [{ ...MINIMAL[0]!, asset: { ...MINIMAL[0]!.asset!, layer: 80 as AssetRef['layer'] } }, MINIMAL[1]!, MINIMAL[2]!]
    expect(() => loadItemCatalog(fixture(wrongLayer), MANIFEST)).toThrow(/outfit_casual01 has layer 80 rather than 40/)
  })

  it('refuses an asset file the manifest never built, and one built on the wrong layer', () => {
    const missingFile = [{ ...MINIMAL[0]!, asset: { ...MINIMAL[0]!.asset!, file: 'item_outfit_ghost_L40' } }, MINIMAL[1]!, MINIMAL[2]!]
    expect(() => loadItemCatalog(fixture(missingFile), MANIFEST)).toThrow(/item_outfit_ghost_L40, which is not in the avatar manifest/)

    const head = fixtureWith(drawable('head_wrong', 'head', false, 'item_head_wrong_layer'))
    expect(() => loadItemCatalog(head, MANIFEST)).toThrow(/item_head_wrong_layer is manifest layer 70 rather than 80/)
  })

  it('refuses a non-boolean fitsAvatarCrop, or a non-boolean hide flag', () => {
    const noCrop = [{ ...MINIMAL[0]!, asset: { layer: 40 as AssetRef['layer'], file: 'item_outfit_casual01_L40' } }, MINIMAL[1]!, MINIMAL[2]!]
    expect(() => loadItemCatalog(fixture(noCrop), MANIFEST)).toThrow(/outfit_casual01 has no boolean fitsAvatarCrop/)

    const badHide = fixtureWith(drawable('head_bad_hide', 'head', false, 'item_head_beanie01_L80'))
    const parsed = JSON.parse(readFileSync(badHide, 'utf8')) as Record<string, unknown>[]
    const withBadHide = parsed.map((d) => (d['id'] === 'head_bad_hide' ? { ...d, asset: { ...(d['asset'] as object), hidesHairFront: 'yes' } } : d))
    expect(() => loadItemCatalog(fixture(withBadHide), MANIFEST)).toThrow(/head_bad_hide has a non-boolean hidesHairFront/)
  })

  it('refuses a malformed file', () => {
    expect(() => loadItemCatalog(fixture({ items: MINIMAL }), MANIFEST)).toThrow(/not a JSON array/)
    expect(() => loadItemCatalog(join(scratch, 'nope.json'), MANIFEST)).toThrow(/could not read item catalogue/)
  })
})

/**
 * Per-wear cuts (2026-09-20). Two stage-1 outfits are gendered — a dealer's skirt, an áo dài — and the
 * ruling is that they stay **one item**: ownership, achievements, the daily calendar and the outfits
 * table all key on the id, and only the drawn layer differs. `items.json` carries no variant yet (no art),
 * so the shape is proved on fixtures; adding one later has to be data and nothing else.
 */
describe('asset.variants', () => {
  const withVariants = (variants: unknown): string =>
    fixtureWith({ ...drawable('outfit_dealer01', 'outfit', false, 'item_outfit_dealer01_L40'), asset: { ...asset('outfit', 'item_outfit_dealer01_L40'), variants } as unknown as AssetRef })

  it('passes a per-wear cut through to the item, beside the file every other base wears', () => {
    const catalog = loadItemCatalog(withVariants({ m: 'item_outfit_dealer01_m_L40' }), MANIFEST)
    expect(catalog.get('outfit_dealer01')?.asset).toEqual({
      layer: 40,
      file: 'item_outfit_dealer01_L40',
      fitsAvatarCrop: true,
      variants: { m: 'item_outfit_dealer01_m_L40' },
    })
    // One item, not two: nothing about ownership or the catalogue's shape has gained a row.
    expect(catalog.all().filter((def) => def.id.startsWith('outfit_dealer01'))).toHaveLength(1)
  })

  it('leaves an asset with no variants exactly as it was', () => {
    const catalog = loadItemCatalog(fixtureWith(), MANIFEST)
    expect(catalog.get('outfit_casual01')?.asset).toEqual({ layer: 40, file: 'item_outfit_casual01_L40', fitsAvatarCrop: true })
    expect(catalog.get('outfit_casual01')?.asset?.variants).toBeUndefined()
  })

  it('holds every cut to the manifest and the slot’s layer, exactly as it holds `file`', () => {
    expect(() => loadItemCatalog(withVariants({ m: 'item_outfit_ghost_m_L40' }), MANIFEST))
      .toThrow(/the m asset variant item_outfit_ghost_m_L40, which is not in the avatar manifest/)
    expect(() => loadItemCatalog(withVariants({ m: 'item_head_beanie01_L80' }), MANIFEST))
      .toThrow(/m asset variant item_head_beanie01_L80 is manifest layer 80 rather than 40/)
  })

  it('refuses a wear nobody has, and a malformed map', () => {
    expect(() => loadItemCatalog(withVariants({ x: 'item_outfit_dealer01_m_L40' }), MANIFEST)).toThrow(/the asset variant x, which is not one of f, m/)
    expect(() => loadItemCatalog(withVariants({ m: '' }), MANIFEST)).toThrow(/m asset variant has no file name/)
    expect(() => loadItemCatalog(withVariants(['item_outfit_dealer01_m_L40']), MANIFEST)).toThrow(/malformed asset.variants/)
  })
})

describe('seed', () => {
  it('upserts the catalogue into the column the slot is stored in, and can be run again on every boot', async () => {
    const catalog = loadItemCatalog(fixtureWith(), MANIFEST)
    await catalog.seed(db)
    await catalog.seed(db)

    const rows = await db.select().from(items).where(sql`${items.id} in ('outfit_casual01', 'badge_monthly', 'title_devoted')`).orderBy(asc(items.id))
    expect(rows).toHaveLength(MINIMAL.length)
    expect(rows.find((r) => r.id === 'outfit_casual01')).toMatchObject({ slot: 'outfit', rarity: 'common', isDefault: true, assetKey: 'outfit/outfit_casual01' })
  })

  it('carries an edited row into a database that already has the old one', async () => {
    const edited = [MINIMAL[0]!, { ...MINIMAL[1]!, rarity: 'epic' as const, nameKey: 'items.renamed' }, MINIMAL[2]!]
    await loadItemCatalog(fixture(edited), MANIFEST).seed(db)

    const [row] = await db.select().from(items).where(sql`${items.id} = 'badge_monthly'`)
    expect(row).toMatchObject({ rarity: 'epic', nameKey: 'items.renamed' })
  })
})
