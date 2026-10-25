import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asc, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { items } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import type { AvatarManifest } from './manifest.js'
import { loadAvatarManifest } from './manifest.js'
import type { AssetRef, ItemDef } from './items.js'
import { loadItemCatalog } from './items.js'
import { DEFAULT_HAIR, DRAWN_SLOTS, SLOTS } from './slots.js'
import type { Gender, ItemSlot } from './slots.js'

/** A `hairColor`/`eyeColor`/`skinColor` item: no `asset`, a required `colour`. */
function colourItem(id: string, slot: 'hairColor' | 'eyeColor' | 'skinColor', colour: string, extra: Partial<ItemDef> = {}): ItemDef {
  return { id, slot, rarity: 'common', nameKey: `items.${id}`, assetKey: `${slot}/${id}`, isDefault: false, colour, ...extra }
}

/** A free common hairstyle drawn from `item_<id>_L60` in front and `item_<id>_L20` behind (A3). */
function hairStyle(id: string, gender: Gender, counterpart: string, extra: Partial<ItemDef> = {}): ItemDef {
  return {
    id, slot: 'hairStyle', rarity: 'common', nameKey: `items.${id}`, assetKey: `hairStyle/${id}`, isDefault: false, free: true,
    gender, counterpart, naturalColour: '#5e3e6f',
    asset: { layer: 60, file: `item_${id}_L60`, back: `item_${id}_L20`, fitsAvatarCrop: true },
    ...extra,
  }
}

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

const LAYER_OF: Partial<Record<ItemSlot, AssetRef['layer']>> = { hairStyle: 60, head: 80, face: 70, outfit: 40, aura: 10, frame: 90 }

/** A tiny manifest that names exactly the files the fixtures below reference. */
const MANIFEST: AvatarManifest = {
  version: 1,
  frame: { w: 384, h: 448 },
  crop: { x: 88, y: 40, size: 208 },
  files: {
    item_outfit_casual01_L40: { layer: 40, w: 1, h: 1, bytes2x: 1 },
    item_outfit_dealer01_L40: { layer: 40, w: 1, h: 1, bytes2x: 1 },
    item_outfit_dealer01_m_L40: { layer: 40, w: 1, h: 1, bytes2x: 1 },
    // Carries a tint mask, unlike `item_head_beret_red01_L80` below — the deliberate asymmetry the
    // `asset.tint` tests need: one file that has what a variant requires, one that does not.
    item_head_beanie01_L80: { layer: 80, w: 1, h: 1, bytes2x: 1, masks: { tint: { bytes2x: 1, meanL: 0.5 } } },
    item_head_beret_red01_L80: { layer: 80, w: 1, h: 1, bytes2x: 1 },
    item_head_wrong_layer: { layer: 70, w: 1, h: 1, bytes2x: 1 },
    // A tintable outfit's own `file`, plus one per-wear cut that carries a tint mask and one that
    // doesn't — the asymmetry the `asset.tint` + `asset.variants` test below needs.
    item_outfit_dealer01_tinted_L40: { layer: 40, w: 1, h: 1, bytes2x: 1, masks: { tint: { bytes2x: 1, meanL: 0.5 } } },
    item_outfit_dealer01_tinted_m_L40: { layer: 40, w: 1, h: 1, bytes2x: 1 },
    item_outfit_dealer01_tinted_m_masked_L40: { layer: 40, w: 1, h: 1, bytes2x: 1, masks: { tint: { bytes2x: 1, meanL: 0.4 } } },
    // The two default hairstyles every catalogue needs (pre-flight #6). The bob's layers carry hair masks
    // and the tousled cut's do not — the asymmetry the `hairTint` tests need.
    item_hair_f_bob01_L20: { layer: 20, w: 1, h: 1, bytes2x: 1, masks: { hair: { bytes2x: 1, meanL: 0.35 } } },
    item_hair_f_bob01_L60: { layer: 60, w: 1, h: 1, bytes2x: 1, masks: { hair: { bytes2x: 1, meanL: 0.31 } } },
    item_hair_m_tousled01_L20: { layer: 20, w: 1, h: 1, bytes2x: 1 },
    item_hair_m_tousled01_L60: { layer: 60, w: 1, h: 1, bytes2x: 1 },
    // A bun: every strand behind the head, so its front layer's hair mask is empty.
    item_hair_f_bun01_L20: { layer: 20, w: 1, h: 1, bytes2x: 1, masks: { hair: { bytes2x: 1, meanL: 0.4 } } },
    item_hair_f_bun01_L60: { layer: 60, w: 1, h: 1, bytes2x: 1, masks: { hair: { bytes2x: 1, meanL: 0, empty: true } } },
    item_hair_m_neat01_L20: { layer: 20, w: 1, h: 1, bytes2x: 1 },
    item_hair_m_neat01_L60: { layer: 60, w: 1, h: 1, bytes2x: 1 },
  },
}

function asset(slot: ItemSlot, file: string, extra: Partial<AssetRef> = {}): AssetRef {
  return { layer: LAYER_OF[slot]!, file, fitsAvatarCrop: true, ...extra }
}

function drawable(id: string, slot: ItemSlot, isDefault: boolean, file: string): ItemDef {
  return { id, slot, rarity: 'common', nameKey: `items.${id}`, assetKey: `${slot}/${id}`, isDefault, asset: asset(slot, file) }
}

/**
 * The smallest catalogue `loadItemCatalog` accepts: the default outfit, the day-28 pair (kept so the fixture reads
 * like `items.json`; the catalogue no longer insists on it — `loadDailyGifts` does), and the two `DEFAULT_HAIR`
 * styles, each the other's counterpart (pre-flight #6). The hairstyles come last so that
 * `MINIMAL[0..2]` keep the meaning every case below was written against.
 */
const MINIMAL: ItemDef[] = [
  drawable('outfit_casual01', 'outfit', true, 'item_outfit_casual01_L40'),
  { id: 'badge_monthly', slot: 'badge', rarity: 'rare', nameKey: 'items.badge_monthly', assetKey: 'badge/badge_monthly', isDefault: false },
  { id: 'title_devoted', slot: 'title', rarity: 'rare', nameKey: 'items.title_devoted', assetKey: 'title/title_devoted', isDefault: false },
  hairStyle('hair_f_bob01', 'f', 'hair_m_tousled01'),
  hairStyle('hair_m_tousled01', 'm', 'hair_f_bob01'),
]
/** `MINIMAL` without its two hairstyles: what every catalogue was before A3. */
const NO_HAIR = MINIMAL.filter((d) => d.slot !== 'hairStyle')

function fixtureWith(...defs: ItemDef[]): string {
  return fixture([...MINIMAL, ...defs])
}

describe('the shipped catalogue', () => {
  const catalog = loadItemCatalog()

  it('has a hundred and twenty-seven items spread across all eleven slots', () => {
    const all = catalog.all()
    expect(all.length).toBe(127)
    expect(SLOTS).toHaveLength(11)
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
    expect(catalog.defaultAvatar()).toEqual({ v: 4, gender: 'f', hairStyle: 'hair_f_bob01', outfit: 'outfit_casual01' })
  })

  it('contains every id the daily reward and the achievements promise, in its v3 slot', () => {
    for (const id of ['badge_monthly', 'title_devoted', 'head_crown_gold01', 'outfit_champion01', 'aura_gold_cards01', 'badge_veteran', 'title_hot_hand', 'frame_founder', 'frame_veteran']) {
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
    const layerOf: Partial<Record<ItemSlot, number>> = { hairStyle: 60, head: 80, face: 70, outfit: 40, aura: 10, frame: 90 }
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
      // A hairstyle's back half, behind the body (pre-flight #41).
      if (def.asset.back === undefined) continue
      const back = manifest.files[def.asset.back]
      expect(back, `${def.id}: ${def.asset.back}`).toBeDefined()
      expect(back!.layer, def.id).toBe(20)
    }
  })

  it('ships eight free hairstyles, four per gender, each pointing at the other gender’s counterpart', () => {
    const hairs = catalog.all().filter((d) => d.slot === 'hairStyle')
    expect(hairs.map((d) => d.id)).toEqual(['hair_f_bob01', 'hair_f_hime01', 'hair_f_wavy01', 'hair_f_ponytail01', 'hair_m_tousled01', 'hair_m_neat01', 'hair_m_curly01', 'hair_m_spiky01'])
    for (const hair of hairs) {
      expect(hair).toMatchObject({ rarity: 'common', free: true, asset: { layer: 60, file: `item_${hair.id}_L60`, back: `item_${hair.id}_L20` } })
      expect(catalog.get(hair.counterpart!)?.gender).not.toBe(hair.gender)
    }
    expect(catalog.get(DEFAULT_HAIR.f)).toMatchObject({ gender: 'f', free: true })
    expect(catalog.get(DEFAULT_HAIR.m)).toMatchObject({ gender: 'm', free: true })
  })

  it('pairs each hairstyle with its counterpart both ways, and gives it the old base’s hair as its natural colour', () => {
    const natural: Record<string, [Gender, string, string]> = {
      hair_f_bob01: ['f', 'hair_m_tousled01', '#5e3e6f'],
      hair_f_hime01: ['f', 'hair_m_neat01', '#302c39'],
      hair_f_wavy01: ['f', 'hair_m_curly01', '#e0c9b3'],
      hair_f_ponytail01: ['f', 'hair_m_spiky01', '#874a2f'],
      hair_m_tousled01: ['m', 'hair_f_bob01', '#684136'],
      hair_m_neat01: ['m', 'hair_f_hime01', '#2c282d'],
      hair_m_curly01: ['m', 'hair_f_wavy01', '#2a1f1e'],
      hair_m_spiky01: ['m', 'hair_f_ponytail01', '#5d3627'],
    }
    for (const [id, [gender, counterpart, naturalColour]] of Object.entries(natural)) {
      expect(catalog.get(id), id).toMatchObject({ gender, counterpart, naturalColour, asset: { fitsAvatarCrop: true } })
    }
  })

  it('tints every shipped hairstyle from its own hair masks, back layer first', () => {
    const manifest = loadAvatarManifest()
    for (const hair of catalog.all().filter((d) => d.slot === 'hairStyle')) {
      expect(hair.asset?.hairTint, hair.id).toEqual({ meanL: manifest.files[hair.asset!.file]?.masks?.hair?.meanL, files: [hair.asset!.back, hair.asset!.file] })
    }
  })

  it('ships six free skin colours with lowercase hex colours', () => {
    const skins = catalog.all().filter((d) => d.slot === 'skinColor')
    expect(skins.map((d) => [d.id, d.colour])).toEqual([
      ['skin_porcelain01', '#fcf0e9'],
      ['skin_fair01', '#f9e6da'],
      ['skin_lighttan01', '#e5bd9e'],
      ['skin_tan01', '#c7916b'],
      ['skin_brown01', '#9c6140'],
      ['skin_deep01', '#643e2b'],
    ])
    for (const skin of skins) {
      expect(skin, skin.id).toMatchObject({ rarity: 'common', free: true, isDefault: false })
      expect(skin.asset, skin.id).toBeUndefined()
    }
  })

  it('no longer ships the hood, the one item that hid the back hair (bug 6)', () => {
    // `head_hood_black01` was withdrawn in Plan 12 (a hood cannot erase hair baked into the base) and left
    // the catalogue on 2026-09-26; nothing in it hides the back hair (layer 20) any more.
    expect(catalog.get('head_hood_black01')).toBeUndefined()
    for (const def of catalog.all()) expect(def.asset?.hidesHairBack, def.id).toBeUndefined()
  })

  it('hides the front hair only under the hats the fit check chose', () => {
    // Plan 19 C5: a v4 hairstyle's L60 is the whole crown and fringe, not the old bases' one strand, so hiding it
    // left a bald head under every hat. The fit check chose to keep the hair under all of them; the hat sits over it.
    const hidesFront = (id: string): boolean => catalog.get(id)?.asset?.hidesHairFront === true
    // BP-33's six hats and BP-35's nine head items sit over the hair the same way.
    for (const id of [
      'head_tophat01', 'head_beret_red01', 'head_crown_gold01', 'head_conical_hat01', 'head_beanie01', 'head_party_cone01', 'head_beret_blue01', 'head_beanie_grey01', 'head_party_cone_green01', 'head_dealer_visor01',
      'head_cap_navy01', 'head_bucket_khaki01', 'head_headband_red01', 'head_cat_ears01', 'head_lotus_pin01', 'head_fedora01',
      'head_witch_hat01', 'head_pumpkin01', 'head_devil_horns01', 'head_santa_hat01', 'head_earmuffs01', 'head_reindeer01', 'head_straw_hat01', 'head_flower_crown01', 'head_crab01',
    ]) {
      expect(hidesFront(id), id).toBe(false)
    }
  })

  it('clips the hair under the hats that cover the crown, colour variants included, and under no other (2026-10-06)', () => {
    // The beret, the beanie and the nón lá: a ponytail's tie, the spiky cut's spikes and the tousled cut's tuft
    // rose through them. Read off the manifest's `masks.hairClip` of the hat's layer, which its colours share.
    // BP-33's cap, bucket hat and fedora cover the crown too: the ingest of their real pictures cut their clips.
    // BP-35's witch hat, pumpkin, Santa hat and straw hat as well, cut the same way when their pictures were ingested.
    const clipping = catalog.all().filter((def) => def.asset?.clipsHair === true).map((def) => def.id).sort()
    expect(clipping).toEqual([
      'head_beanie01',
      'head_beanie_grey01',
      'head_beanie_mustard01',
      'head_beanie_red01',
      'head_beret_black01',
      'head_beret_blue01',
      'head_beret_green01',
      'head_beret_red01',
      'head_bucket_khaki01',
      'head_cap_navy01',
      'head_conical_hat01',
      'head_fedora01',
      'head_pumpkin01',
      'head_santa_hat01',
      'head_straw_hat01',
      'head_witch_hat01',
    ])
    for (const def of catalog.all()) if (def.asset?.clipsHair !== true) expect(def.asset?.clipsHair, def.id).toBeUndefined()
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

  it('refuses a hide flag that disagrees with the manifest entry of its layer (bug 7)', () => {
    // The fixture manifest records no hide rule for the beanie, so a catalogue saying it hides the strand lies.
    const hides = fixtureWith(drawable('head_hides', 'head', false, 'item_head_beanie01_L80'))
    const parsed = JSON.parse(readFileSync(hides, 'utf8')) as Record<string, unknown>[]
    const withHide = parsed.map((d) => (d['id'] === 'head_hides' ? { ...d, asset: { ...(d['asset'] as object), hidesHairFront: true } } : d))
    expect(() => loadItemCatalog(fixture(withHide), MANIFEST)).toThrow(/head_hides has hidesHairFront true but its layer item_head_beanie01_L80 has false in the avatar manifest/)

    // …and the other way round: a manifest that hides, a catalogue that forgot to say so.
    const manifest = { ...MANIFEST, files: { ...MANIFEST.files, item_head_beanie01_L80: { ...MANIFEST.files['item_head_beanie01_L80']!, hidesHairFront: true } } }
    expect(() => loadItemCatalog(hides, manifest)).toThrow(/head_hides has hidesHairFront false but its layer item_head_beanie01_L80 has true/)
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

/**
 * Colour items (design §3.2) and `free` (design §3.2), plus `asset.tint` on a variant (design §3.3).
 */
describe('colour items, free items and asset.tint', () => {
  it('requires colour on a colour slot, and refuses it everywhere else', () => {
    const noColour = fixtureWith({ ...colourItem('haircolor_red01', 'hairColor', '#b3261e'), colour: undefined })
    expect(() => loadItemCatalog(noColour, MANIFEST)).toThrow(/haircolor_red01 .*colour/)

    const wrongSlot = fixtureWith(colourItem('haircolor_red01', 'hairColor', '#b3261e', { slot: 'head' as 'hairColor' }))
    expect(() => loadItemCatalog(wrongSlot, MANIFEST)).toThrow(/haircolor_red01 .*colour/)
  })

  it('refuses a colour that is not a lowercase 6-digit hex', () => {
    for (const bad of ['red', '#FFF', '#zzzzzz', '#12345', 'b3261e']) {
      const bogus = fixtureWith(colourItem('haircolor_red01', 'hairColor', bad))
      expect(() => loadItemCatalog(bogus, MANIFEST), bad).toThrow(/haircolor_red01 .*colour/)
    }
  })

  it('accepts a valid colour item and exposes it, with no asset at all', () => {
    const catalog = loadItemCatalog(fixtureWith(colourItem('haircolor_red01', 'hairColor', '#b3261e', { free: true })), MANIFEST)
    expect(catalog.get('haircolor_red01')).toEqual({
      id: 'haircolor_red01', slot: 'hairColor', rarity: 'common', nameKey: 'items.haircolor_red01',
      assetKey: 'hairColor/haircolor_red01', isDefault: false, colour: '#b3261e', free: true,
    })
  })

  it('refuses free on anything but a common item, and free together with isDefault', () => {
    const rareFree = fixtureWith(colourItem('haircolor_pink01', 'hairColor', '#f08bb4', { rarity: 'rare', free: true }))
    expect(() => loadItemCatalog(rareFree, MANIFEST)).toThrow(/haircolor_pink01 .*free/)

    const defaultFree = fixtureWith(colourItem('haircolor_red01', 'hairColor', '#b3261e', { free: true, isDefault: true }))
    expect(() => loadItemCatalog(defaultFree, MANIFEST)).toThrow(/haircolor_red01 .*free/)

    // `free: false` is not a shape the catalogue writes, but nothing here says it must be `true` or
    // absent only by convention — the loader itself refuses anything but those two.
    const falseFree = fixtureWith({ ...colourItem('haircolor_red01', 'hairColor', '#b3261e'), free: false as unknown as true })
    expect(() => loadItemCatalog(falseFree, MANIFEST)).toThrow(/haircolor_red01 .*free/)
  })

  it('refuses asset.tint on a file with no tint mask, and accepts it where one exists', () => {
    const noMask = fixtureWith(drawable('head_beret_blue01', 'head', false, 'item_head_beret_red01_L80'))
    // Swap in a `tint` after the fact: `drawable` builds a plain asset, and the manifest entry for
    // this file (`item_head_beret_red01_L80`) carries no `masks.tint` at all.
    const parsed = JSON.parse(readFileSync(noMask, 'utf8')) as Record<string, unknown>[]
    const withTint = parsed.map((d) => (d['id'] === 'head_beret_blue01' ? { ...d, asset: { ...(d['asset'] as object), tint: '#3f6fd8' } } : d))
    expect(() => loadItemCatalog(fixture(withTint), MANIFEST)).toThrow(/head_beret_blue01.*tint/)

    const withMask = drawable('head_beanie_red01', 'head', false, 'item_head_beanie01_L80')
    const catalog = loadItemCatalog(fixtureWith({ ...withMask, asset: { ...withMask.asset!, tint: '#b83a32' } }), MANIFEST)
    expect(catalog.get('head_beanie_red01')?.asset).toEqual({
      layer: 80, file: 'item_head_beanie01_L80', fitsAvatarCrop: true, tint: '#b83a32', tintMeanL: 0.5,
    })
  })

  it('requires a tint mask on every per-wear variant too, not only on file', () => {
    // `file` itself carries a tint mask (`item_outfit_dealer01_tinted_L40`); the `m` cut a male base
    // would actually draw does not — a future tintable item with a variant this shape would 404 its
    // tint mask on every male base, and the loader has to refuse it at boot instead.
    const tintedWithVariant = (variantFile: string): string =>
      fixtureWith({
        ...drawable('outfit_dealer_tinted01', 'outfit', false, 'item_outfit_dealer01_tinted_L40'),
        asset: { ...asset('outfit', 'item_outfit_dealer01_tinted_L40'), tint: '#b83a32', variants: { m: variantFile } },
      })

    expect(() => loadItemCatalog(tintedWithVariant('item_outfit_dealer01_tinted_m_L40'), MANIFEST))
      .toThrow(/outfit_dealer_tinted01's m asset variant item_outfit_dealer01_tinted_m_L40 has no tint mask to paint/)

    const catalog = loadItemCatalog(tintedWithVariant('item_outfit_dealer01_tinted_m_masked_L40'), MANIFEST)
    expect(catalog.get('outfit_dealer_tinted01')?.asset).toEqual({
      layer: 40,
      file: 'item_outfit_dealer01_tinted_L40',
      fitsAvatarCrop: true,
      tint: '#b83a32',
      tintMeanL: 0.5,
      variants: { m: 'item_outfit_dealer01_tinted_m_masked_L40' },
    })
  })

  it('lists exactly the free ids through freeIds()', () => {
    const catalog = loadItemCatalog(
      fixtureWith(
        colourItem('haircolor_red01', 'hairColor', '#b3261e', { free: true }),
        colourItem('haircolor_pink01', 'hairColor', '#f08bb4', { rarity: 'rare' }),
      ),
      MANIFEST,
    )
    // `MINIMAL`'s two default hairstyles are free too, as every catalogue's must be.
    expect(catalog.freeIds()).toEqual(new Set(['hair_f_bob01', 'hair_m_tousled01', 'haircolor_red01']))
  })
})

/**
 * Hairstyles (A3, spec §4.2): an item in `hairStyle`, drawn as two layers — `asset.file` at 60 in front of the
 * face, `asset.back` at 20 behind the body — with a gender, a counterpart of the other gender and a natural
 * colour. `DEFAULT_HAIR` names one per gender, and every catalogue must have both.
 */
describe('hairStyle items', () => {
  /** `MINIMAL` (plus `extra`) with the row `id` rewritten in raw JSON, so a field can be dropped or misspelt. */
  function editing(id: string, edit: (row: Record<string, unknown>) => Record<string, unknown>, extra: ItemDef[] = []): string {
    const rows = [...MINIMAL, ...extra].map((d) => JSON.parse(JSON.stringify(d)) as Record<string, unknown>)
    return fixture(rows.map((row) => (row['id'] === id ? edit(row) : row)))
  }
  const assetOf = (row: Record<string, unknown>): Record<string, unknown> => row['asset'] as Record<string, unknown>

  it('passes a hairstyle through with both layers, its gender, its counterpart and its natural colour', () => {
    const catalog = loadItemCatalog(fixtureWith(), MANIFEST)
    expect(catalog.get('hair_m_tousled01')).toEqual({
      id: 'hair_m_tousled01', slot: 'hairStyle', rarity: 'common', nameKey: 'items.hair_m_tousled01', assetKey: 'hairStyle/hair_m_tousled01',
      isDefault: false, free: true, gender: 'm', counterpart: 'hair_f_bob01', naturalColour: '#5e3e6f',
      asset: { layer: 60, file: 'item_hair_m_tousled01_L60', back: 'item_hair_m_tousled01_L20', fitsAvatarCrop: true },
    })
    // Nothing else gains the hairstyle fields.
    expect(catalog.get('outfit_casual01')).not.toHaveProperty('gender')
    expect(catalog.get('outfit_casual01')?.asset).not.toHaveProperty('back')
  })

  it('derives hairTint from the hair layers’ masks', () => {
    const catalog = loadItemCatalog(fixtureWith(hairStyle('hair_f_bun01', 'f', 'hair_m_tousled01')), MANIFEST)
    // Both layers masked: the front layer's lightness, and both files, back to front.
    expect(catalog.get('hair_f_bob01')?.asset?.hairTint).toEqual({ meanL: 0.31, files: ['item_hair_f_bob01_L20', 'item_hair_f_bob01_L60'] })
    // An empty front mask (a bun): the back layer's lightness, and only the back layer to paint.
    expect(catalog.get('hair_f_bun01')?.asset?.hairTint).toEqual({ meanL: 0.4, files: ['item_hair_f_bun01_L20'] })
    // No mask on either layer: nothing to tint, and no key at all.
    expect(catalog.get('hair_m_tousled01')?.asset).not.toHaveProperty('hairTint')
  })

  it('refuses gender, counterpart or naturalColour outside hairStyle, and a hairStyle without them', () => {
    for (const [field, value] of [['gender', 'f'], ['counterpart', 'hair_f_bob01'], ['naturalColour', '#5e3e6f']] as const) {
      expect(() => loadItemCatalog(editing('outfit_casual01', (row) => ({ ...row, [field]: value })), MANIFEST), field)
        .toThrow(new RegExp(`outfit_casual01 has a ${field} but is not in the hairStyle slot \\(outfit\\)`))
      const without = editing('hair_f_bob01', (row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== field)))
      expect(() => loadItemCatalog(without, MANIFEST), field).toThrow(new RegExp(`hair_f_bob01 needs a .*\\b${field}\\b.*\\(slot hairStyle\\)`))
    }
    expect(() => loadItemCatalog(editing('hair_f_bob01', (row) => ({ ...row, gender: 'x' })), MANIFEST)).toThrow(/hair_f_bob01 needs a gender, one of f, m \(slot hairStyle\)/)
    for (const bad of ['#5E3E6F', '5e3e6f', '#5e3e6', 42]) {
      expect(() => loadItemCatalog(editing('hair_f_bob01', (row) => ({ ...row, naturalColour: bad })), MANIFEST), String(bad)).toThrow(/hair_f_bob01 needs a 6-digit hex naturalColour/)
    }
  })

  it('refuses a hairstyle with no back layer, a back layer on any other slot, and the variants and tint a hairstyle never has', () => {
    const noBack = editing('hair_f_bob01', (row) => ({ ...row, asset: Object.fromEntries(Object.entries(assetOf(row)).filter(([key]) => key !== 'back')) }))
    expect(() => loadItemCatalog(noBack, MANIFEST)).toThrow(/hair_f_bob01 has no asset\.back \(slot hairStyle\)/)
    const outfitBack = editing('outfit_casual01', (row) => ({ ...row, asset: { ...assetOf(row), back: 'item_hair_f_bob01_L20' } }))
    expect(() => loadItemCatalog(outfitBack, MANIFEST)).toThrow(/outfit_casual01 has an asset\.back but is not in the hairStyle slot \(outfit\)/)
    const ghostBack = editing('hair_f_bob01', (row) => ({ ...row, asset: { ...assetOf(row), back: 'item_hair_f_ghost01_L20' } }))
    expect(() => loadItemCatalog(ghostBack, MANIFEST)).toThrow(/hair_f_bob01 names the back layer item_hair_f_ghost01_L20, which is not in the avatar manifest/)
    const variants = editing('hair_f_bob01', (row) => ({ ...row, asset: { ...assetOf(row), variants: { m: 'item_hair_m_tousled01_L60' } } }))
    expect(() => loadItemCatalog(variants, MANIFEST)).toThrow(/hair_f_bob01 is a hairstyle, which never has asset\.variants/)
    const tinted = editing('hair_f_bob01', (row) => ({ ...row, asset: { ...assetOf(row), tint: '#b3261e' } }))
    expect(() => loadItemCatalog(tinted, MANIFEST)).toThrow(/hair_f_bob01 is a hairstyle, which never has asset\.tint/)
    const wrongFront = editing('hair_f_bob01', (row) => ({ ...row, asset: { ...assetOf(row), file: 'item_hair_f_bob01_L20' } }))
    expect(() => loadItemCatalog(wrongFront, MANIFEST)).toThrow(/hair_f_bob01's asset file item_hair_f_bob01_L20 is manifest layer 20 rather than 60/)
  })

  it('refuses a counterpart of the same gender, and a back layer on the wrong layer', () => {
    const sameGender = editing('hair_f_bob01', (row) => ({ ...row, counterpart: 'hair_f_bun01' }), [hairStyle('hair_f_bun01', 'f', 'hair_m_tousled01')])
    expect(() => loadItemCatalog(sameGender, MANIFEST)).toThrow(/hair_f_bob01 has the counterpart hair_f_bun01, which is not a hairStyle item of the other gender/)
    const ghost = editing('hair_f_bob01', (row) => ({ ...row, counterpart: 'hair_m_ghost01' }))
    expect(() => loadItemCatalog(ghost, MANIFEST)).toThrow(/hair_f_bob01 has the counterpart hair_m_ghost01, which is not a hairStyle item of the other gender/)
    const notHair = editing('hair_f_bob01', (row) => ({ ...row, counterpart: 'outfit_casual01' }))
    expect(() => loadItemCatalog(notHair, MANIFEST)).toThrow(/hair_f_bob01 has the counterpart outfit_casual01, which is not a hairStyle item of the other gender/)

    const wrongBack = editing('hair_f_bob01', (row) => ({ ...row, asset: { ...assetOf(row), back: 'item_hair_f_bob01_L60' } }))
    expect(() => loadItemCatalog(wrongBack, MANIFEST)).toThrow(/hair_f_bob01's back layer item_hair_f_bob01_L60 is manifest layer 60 rather than 20/)
  })

  it('does not require the pairing to be symmetric', () => {
    // A future rare style may point at a free one, which keeps its own partner.
    const rare = { ...hairStyle('hair_m_neat01', 'm', 'hair_f_bob01'), rarity: 'rare' as const, free: undefined }
    expect(loadItemCatalog(fixtureWith(rare), MANIFEST).get('hair_m_neat01')).toMatchObject({ rarity: 'rare', counterpart: 'hair_f_bob01' })
  })

  it('refuses a catalogue whose default hairstyle is missing, of the wrong gender or not free', () => {
    const noBob = fixture(MINIMAL.filter((d) => d.id !== DEFAULT_HAIR.f))
    expect(() => loadItemCatalog(noBob, MANIFEST)).toThrow(/DEFAULT_HAIR\.f names hair_f_bob01, which is not in the catalogue/)
    const male = editing('hair_f_bob01', (row) => ({ ...row, gender: 'm' }))
    expect(() => loadItemCatalog(male, MANIFEST)).toThrow(/DEFAULT_HAIR\.f names hair_f_bob01, which is a hairstyle of gender m/)
    const rare = editing('hair_m_tousled01', (row) => ({ ...Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'free')), rarity: 'rare' }))
    expect(() => loadItemCatalog(rare, MANIFEST)).toThrow(/DEFAULT_HAIR\.m names hair_m_tousled01, which is not free/)
  })

  it('runs every hairstyle check after the checks that exist today (pre-flight #6)', () => {
    // A catalogue with no hairstyle at all still hears about its older problem first…
    expect(() => loadItemCatalog(fixture([{ ...NO_HAIR[0]!, isDefault: false }, ...NO_HAIR.slice(1)]), MANIFEST)).toThrow(/no default item for the required slot outfit/)
    expect(() => loadItemCatalog(fixture([...NO_HAIR, drawable('outfit_other', 'outfit', true, 'item_outfit_casual01_L40')]), MANIFEST)).toThrow(/the required slot outfit has 2 defaults/)
    expect(() => loadItemCatalog(fixture([...NO_HAIR, drawable('head_default', 'head', true, 'item_head_beanie01_L80')]), MANIFEST)).toThrow(/head_default is a default in the optional slot head/)
    // …and once those are fixed, the missing hairstyles are what it names.
    expect(() => loadItemCatalog(fixture(NO_HAIR), MANIFEST)).toThrow(/DEFAULT_HAIR\.f names hair_f_bob01, which is not in the catalogue/)
  })
})

/** Skin colours (A3, spec §4.2): a third colour slot, exactly like `hairColor` and `eyeColor`. */
describe('skinColor items', () => {
  it('reads a skin colour as a colour item: a colour, and nothing to draw', () => {
    const catalog = loadItemCatalog(fixtureWith(colourItem('skin_deep01', 'skinColor', '#5c3a28', { free: true })), MANIFEST)
    expect(catalog.get('skin_deep01')).toEqual({
      id: 'skin_deep01', slot: 'skinColor', rarity: 'common', nameKey: 'items.skin_deep01',
      assetKey: 'skinColor/skin_deep01', isDefault: false, colour: '#5c3a28', free: true,
    })
  })

  it('refuses a skin colour without a lowercase hex, or with a layer to draw', () => {
    const noColour = fixtureWith({ ...colourItem('skin_deep01', 'skinColor', '#5c3a28'), colour: undefined })
    expect(() => loadItemCatalog(noColour, MANIFEST)).toThrow(/skin_deep01 needs a 6-digit hex colour \(slot skinColor\)/)
    expect(() => loadItemCatalog(fixtureWith(colourItem('skin_deep01', 'skinColor', '#5C3A28')), MANIFEST)).toThrow(/skin_deep01 needs a 6-digit hex colour/)
    const drawn = fixtureWith(colourItem('skin_deep01', 'skinColor', '#5c3a28', { asset: asset('outfit', 'item_outfit_casual01_L40') }))
    expect(() => loadItemCatalog(drawn, MANIFEST)).toThrow(/skin_deep01 is in the slot skinColor, which is never drawn, but has an asset/)
  })
})

describe('the shipped catalogue’s free items and tints', () => {
  const catalog = loadItemCatalog()

  it('freeIds() names exactly the free ids (32: 8 hair colours + 6 eye colours + 4 casual variants + 8 hairstyles + 6 skin colours)', () => {
    const ids = catalog.freeIds()
    expect(ids.size).toBe(32)
    const count = (slot: ItemSlot): number => [...ids].filter((id) => catalog.get(id)?.slot === slot).length
    expect({ hairColor: count('hairColor'), eyeColor: count('eyeColor'), outfit: count('outfit'), hairStyle: count('hairStyle'), skinColor: count('skinColor') })
      .toEqual({ hairColor: 8, eyeColor: 6, outfit: 4, hairStyle: 8, skinColor: 6 })
    for (const id of ['haircolor_black01', 'eyecolor_brown01', 'outfit_casual_red01', 'hair_m_spiky01', 'skin_deep01']) expect(ids.has(id), id).toBe(true)
    for (const id of ['haircolor_pink01', 'head_beret_blue01', 'head_party_cone_blue01']) expect(ids.has(id), id).toBe(false)
    for (const id of ids) expect(catalog.get(id)?.rarity, id).toBe('common')
  })

  it('gives every variant an asset.tint and a tintMeanL taken from the manifest', () => {
    for (const id of ['outfit_casual_red01', 'head_beret_blue01', 'head_beanie_red01', 'head_party_cone_blue01']) {
      const def = catalog.get(id)
      expect(def?.asset?.tint, id).toMatch(/^#[0-9a-f]{6}$/)
      expect(def?.asset?.tintMeanL, id).toBeGreaterThanOrEqual(0)
      expect(def?.asset?.tintMeanL, id).toBeLessThanOrEqual(1)
    }
  })
})

describe('seed', () => {
  it('upserts the catalogue into the column the slot is stored in, and can be run again on every boot', async () => {
    const catalog = loadItemCatalog(fixtureWith(), MANIFEST)
    await catalog.seed(db)
    await catalog.seed(db)

    const rows = await db.select().from(items).where(sql`${items.id} in ('outfit_casual01', 'badge_monthly', 'title_devoted', 'hair_f_bob01', 'hair_m_tousled01')`).orderBy(asc(items.id))
    expect(rows).toHaveLength(MINIMAL.length)
    expect(rows.find((r) => r.id === 'outfit_casual01')).toMatchObject({ slot: 'outfit', rarity: 'common', isDefault: true, assetKey: 'outfit/outfit_casual01' })
    // A hairstyle is an ordinary row: the slot lands in the same column as every other one.
    expect(rows.find((r) => r.id === 'hair_f_bob01')).toMatchObject({ slot: 'hairStyle', rarity: 'common', isDefault: false, assetKey: 'hairStyle/hair_f_bob01' })
  })

  it('carries an edited row into a database that already has the old one', async () => {
    const edited = [MINIMAL[0]!, { ...MINIMAL[1]!, rarity: 'epic' as const, nameKey: 'items.renamed' }, ...MINIMAL.slice(2)]
    await loadItemCatalog(fixture(edited), MANIFEST).seed(db)

    const [row] = await db.select().from(items).where(sql`${items.id} = 'badge_monthly'`)
    expect(row).toMatchObject({ rarity: 'epic', nameKey: 'items.renamed' })
  })
})
