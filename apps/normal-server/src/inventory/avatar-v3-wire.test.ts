/**
 * The v3 wire's own tests, moved verbatim from `avatar.test.ts` and `avatar-migrate.test.ts` with the
 * functions they call renamed (Plan 19, A4). Temporary like the module they test: A5's first dispatch
 * switches every route to v4 and deletes both files.
 *
 * Kept so that "the wire still behaves exactly as it did before A4" is checked here, function by function,
 * and not only through the routes. No database: the ownership half (`applyAvatarConfigV3`) is held by the
 * route and outfits-service tests, which are unchanged.
 */
import { describe, expect, it } from 'vitest'
import { loadAliases } from './aliases.js'
import type { AvatarConfigV3 } from './avatar-migrate.js'
import { defaultAvatarV3, itemIdsOfV3, migrateAvatarConfigV3, readAvatarConfigV3, validateAvatarConfigV3 } from './avatar-v3-wire.js'
import { baseIdsOf, loadBases } from './bases.js'
import { loadItemCatalog } from './items.js'
import { DEFAULT_BASE } from './slots.js'

const catalog = loadItemCatalog()
const aliases = loadAliases()

/** The real registry's ids: what `INVALID_BASE` is measured against since the base list became data. */
const baseIds = baseIdsOf(loadBases())

const CASUAL: AvatarConfigV3 = { v: 3, base: 'f01', outfit: 'outfit_casual01' }
const DRESSED: AvatarConfigV3 = {
  ...CASUAL,
  base: 'm01',
  head: 'head_crown_gold01',
  face: 'face_glasses_round_gold01',
  aura: 'aura_gold_cards01',
  frame: 'frame_founder',
  hairColor: 'haircolor_pink01',
  eyeColor: 'eyecolor_violet01',
  title: 'title_devoted',
  badge: 'badge_monthly',
}

/** Every item id in a v3 config — what a player has to own to wear it. */
const worn = (config: AvatarConfigV3): string[] =>
  [config.outfit, config.head, config.face, config.aura, config.frame, config.hairColor, config.eyeColor, config.title, config.badge].filter((id): id is string => id !== undefined)

describe('v3 wire — defaultAvatarV3', () => {
  it('dresses a new account in the f01 base wearing only the default outfit', () => {
    expect(defaultAvatarV3(catalog)).toEqual(CASUAL)
    // …which is still what the catalogue hands registration until A5.
    expect(catalog.defaultAvatar()).toEqual(CASUAL)
  })

  it('is itself a valid configuration', () => {
    expect(validateAvatarConfigV3(defaultAvatarV3(catalog), catalog, baseIds)).toEqual({ ok: true, value: CASUAL })
  })
})

describe('v3 wire — validateAvatarConfigV3', () => {
  it('accepts a full configuration and returns exactly what is to be stored', () => {
    expect(validateAvatarConfigV3({ ...DRESSED, somethingElse: 'ignored' }, catalog, baseIds)).toEqual({ ok: true, value: DRESSED })
  })

  it('refuses a missing outfit — the one required slot', () => {
    const { outfit: _outfit, ...noOutfit } = CASUAL
    expect(validateAvatarConfigV3(noOutfit, catalog, baseIds)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfigV3({ ...CASUAL, outfit: '' }, catalog, baseIds)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfigV3(null, catalog, baseIds)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfigV3([CASUAL], catalog, baseIds)).toEqual({ ok: false, code: 'MISSING_LAYER' })
  })

  it('refuses anything that is not v3 — a v1 or v2 config is readable, but not writable', () => {
    const { v: _v, ...noVersion } = CASUAL
    expect(validateAvatarConfigV3(noVersion, catalog, baseIds)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfigV3({ ...CASUAL, v: 2 }, catalog, baseIds)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfigV3({ ...CASUAL, v: '3' }, catalog, baseIds)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfigV3({ v: 2, body: 'male', hair: 'hair_none', top: 'top_tee', bottom: 'bottom_jeans', shoes: 'shoes_sneakers', skin: '#000', eyes: '#000', hairColor: '#000' }, catalog, baseIds))
      .toEqual({ ok: false, code: 'MISSING_LAYER' })
    // …and a v4 body is refused the same way: the wire is v3 until A5.
    expect(validateAvatarConfigV3({ v: 4, gender: 'f', hairStyle: 'hair_f_bob01', outfit: 'outfit_casual01' }, catalog, baseIds)).toEqual({ ok: false, code: 'MISSING_LAYER' })
  })

  it('refuses a missing base with MISSING_LAYER and an unknown one with INVALID_BASE', () => {
    expect(validateAvatarConfigV3({ ...CASUAL, base: undefined }, catalog, baseIds)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    const { base: _base, ...noBase } = CASUAL
    expect(validateAvatarConfigV3(noBase, catalog, baseIds)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    for (const base of ['robot', 'f09', 42, null]) {
      expect(validateAvatarConfigV3({ ...CASUAL, base }, catalog, baseIds), String(base)).toEqual({ ok: false, code: base === null ? 'MISSING_LAYER' : 'INVALID_BASE' })
    }
    expect(validateAvatarConfigV3({ ...CASUAL, base: 'm01' }, catalog, baseIds)).toMatchObject({ ok: true })
  })

  it('takes the base list from the registry it is handed, not from a union in the code', () => {
    const withF09 = new Set([...baseIds, 'f09'])
    expect(validateAvatarConfigV3({ ...CASUAL, base: 'f09' }, catalog, withF09)).toEqual({ ok: true, value: { ...CASUAL, base: 'f09' } })
    expect(validateAvatarConfigV3({ ...CASUAL, base: 'm01' }, catalog, new Set(['f01']))).toEqual({ ok: false, code: 'INVALID_BASE' })
  })

  it('refuses an id that is not in the catalogue', () => {
    expect(validateAvatarConfigV3({ ...CASUAL, outfit: 'outfit_imaginary' }, catalog, baseIds)).toEqual({ ok: false, code: 'INVALID_ITEM' })
    expect(validateAvatarConfigV3({ ...CASUAL, title: 42 }, catalog, baseIds)).toEqual({ ok: false, code: 'INVALID_ITEM' })
    expect(validateAvatarConfigV3({ ...CASUAL, outfit: 'clothing_tee' }, catalog, baseIds)).toEqual({ ok: false, code: 'INVALID_ITEM' })
  })

  it('refuses an id worn in the wrong slot', () => {
    expect(validateAvatarConfigV3({ ...CASUAL, outfit: 'head_beanie01' }, catalog, baseIds)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
    expect(validateAvatarConfigV3({ ...DRESSED, badge: 'title_devoted' }, catalog, baseIds)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
    expect(validateAvatarConfigV3({ ...CASUAL, head: 'face_glasses_round_gold01' }, catalog, baseIds)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
  })

  it('treats an omitted or null optional slot as empty', () => {
    expect(validateAvatarConfigV3({ ...DRESSED, title: undefined, badge: null }, catalog, baseIds)).toEqual({ ok: true, value: { ...DRESSED, title: undefined, badge: undefined } })
  })

  it('validates hairColor and eyeColor exactly like any other optional slot (design §3.1)', () => {
    expect(validateAvatarConfigV3({ ...CASUAL, hairColor: 'haircolor_red01' }, catalog, baseIds)).toEqual({ ok: true, value: { ...CASUAL, hairColor: 'haircolor_red01' } })
    expect(validateAvatarConfigV3({ ...CASUAL, hairColor: 'eyecolor_green01' }, catalog, baseIds)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
    expect(validateAvatarConfigV3({ ...CASUAL, hairColor: 'nope' }, catalog, baseIds)).toEqual({ ok: false, code: 'INVALID_ITEM' })
  })

  it('still validates a v3 configuration exactly as before the new slots existed', () => {
    expect(validateAvatarConfigV3(DRESSED, catalog, baseIds)).toEqual({ ok: true, value: DRESSED })
    expect(itemIdsOfV3(DRESSED)).toEqual(worn(DRESSED))
    // A hairstyle is not part of the v3 contract: dropped like any other unknown key, never stored, never owned.
    expect(validateAvatarConfigV3({ ...DRESSED, hairStyle: 'hair_f_bob01' }, catalog, baseIds)).toEqual({ ok: true, value: DRESSED })
    expect(itemIdsOfV3({ ...DRESSED, hairStyle: 'hair_f_bob01' } as AvatarConfigV3)).not.toContain('hair_f_bob01')
    // skinColor is an optional slot since A3 — never sent by today's client, validated like hairColor when it is.
    expect(validateAvatarConfigV3({ ...CASUAL, skinColor: 'skin_deep01' }, catalog, baseIds)).toEqual({ ok: true, value: { ...CASUAL, skinColor: 'skin_deep01' } })
    expect(validateAvatarConfigV3({ ...CASUAL, skinColor: 'haircolor_red01' }, catalog, baseIds)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
    expect(itemIdsOfV3({ ...CASUAL, skinColor: 'skin_deep01' })).toEqual(['outfit_casual01', 'skin_deep01'])
  })
})

describe('v3 wire — itemIdsOfV3', () => {
  it('includes both colour slots alongside every other worn item', () => {
    expect(itemIdsOfV3(DRESSED)).toEqual(worn(DRESSED))
    expect(itemIdsOfV3(DRESSED)).toContain('haircolor_pink01')
    expect(itemIdsOfV3(DRESSED)).toContain('eyecolor_violet01')
  })
})

/** What a Plan 6 account had in `players.avatar_config`: no `v`, six SVG layers (pre-Plan 8, v1). */
const V1 = {
  base: 'base_01',
  face: 'face_01',
  clothing: 'clothing_tee',
  hair: 'hair_short',
  hairColor: '#7a3b1f',
  accessory: 'accessory_glasses',
  title: 'title_devoted',
  badge: 'badge_monthly',
}

/** A Plan 8–10 account: `body`, and `hair`/`top`/`bottom`/`shoes`/`hat`/`accessory`/`jewelry` (v2). */
const V2 = {
  v: 2,
  body: 'male',
  skin: '#e0ac81',
  eyes: '#3b2415',
  hairColor: '#2b2b2b',
  hair: 'hair_none',
  top: 'top_tee',
  bottom: 'bottom_jeans',
  shoes: 'shoes_sneakers',
  hat: 'hat_crown',
  accessory: 'accessory_glasses',
  jewelry: 'ring_royal',
  title: 'title_devoted',
  badge: 'badge_monthly',
}

const read = (stored: Record<string, unknown>): AvatarConfigV3 => readAvatarConfigV3(stored, catalog, aliases, baseIds)

describe('v3 wire — migrateAvatarConfigV3, v1 to v3', () => {
  it('falls back to the default base — v1 never named a body at all — and the default outfit', () => {
    expect(read(V1)).toMatchObject({ v: 3, base: defaultAvatarV3(catalog).base, outfit: 'outfit_casual01' })
  })

  it('moves the v1 `accessory` into whichever new slot the alias names — a face piece here', () => {
    expect(read(V1)).toMatchObject({ face: 'face_glasses_round_gold01' })
    expect(read(V1).head).toBeUndefined()
  })

  it('moves a v1 accessory that aliases to a head piece into `head` instead', () => {
    expect(read({ ...V1, accessory: 'accessory_conical_hat' })).toMatchObject({ head: 'head_conical_hat01' })
    expect(read({ ...V1, accessory: 'accessory_conical_hat' }).face).toBeUndefined()
  })

  it('drops a v1 accessory the new wardrobe no longer offers at all', () => {
    const dropped = read({ ...V1, accessory: 'accessory_headband' })
    expect(dropped.head).toBeUndefined()
    expect(dropped.face).toBeUndefined()
  })

  it('keeps title and badge — their ids never changed', () => {
    expect(read(V1)).toMatchObject({ title: 'title_devoted', badge: 'badge_monthly' })
  })

  it('is itself a valid v3 configuration', () => {
    expect(validateAvatarConfigV3(read(V1), catalog, baseIds)).toMatchObject({ ok: true })
  })
})

describe('v3 wire — migrateAvatarConfigV3, v2 to v3', () => {
  it('reads the base from `body`: female to f01, male to m01', () => {
    expect(read(V2)).toMatchObject({ base: 'm01' })
    expect(read({ ...V2, body: 'female' })).toMatchObject({ base: 'f01' })
    expect(read({ ...V2, body: 'robot' })).toMatchObject({ base: defaultAvatarV3(catalog).base })
  })

  it('maps `hat` through its alias into `head`', () => {
    expect(read(V2)).toMatchObject({ head: 'head_crown_gold01' })
  })

  it('maps `accessory` into whichever slot its alias resolves to — a face piece for glasses', () => {
    expect(read(V2)).toMatchObject({ face: 'face_glasses_round_gold01' })
  })

  it('maps `jewelry` through its alias into `aura` — only `ring_royal` survives at all', () => {
    expect(read(V2)).toMatchObject({ aura: 'aura_gold_cards01' })
    expect(read({ ...V2, jewelry: 'jewelry_chain' }).aura).toBeUndefined()
  })

  it.each([
    ['clothing_suit', 'outfit_tuxedo01'],
    ['clothing_aodai', 'outfit_tet_red01'],
    ['clothing_kimono', 'outfit_royal_robe01'],
    ['jacket_champion', 'outfit_champion01'],
  ])('maps the named v2 top %s to %s', (top, outfit) => {
    expect(read({ ...V2, top })).toMatchObject({ outfit })
  })

  it('falls every other v2 top, bottom and shoes back to the default outfit', () => {
    for (const top of ['top_tee', 'clothing_hoodie', 'clothing_polo', undefined]) {
      expect(read({ ...V2, top })).toMatchObject({ outfit: 'outfit_casual01' })
    }
  })

  it('keeps title and badge unchanged', () => {
    expect(read(V2)).toMatchObject({ title: 'title_devoted', badge: 'badge_monthly' })
  })

  it('is itself a valid v3 configuration, with nothing left from v2 at all', () => {
    const migrated = read(V2)
    expect(validateAvatarConfigV3(migrated, catalog, baseIds)).toMatchObject({ ok: true })
    expect(migrated).not.toHaveProperty('body')
    expect(migrated).not.toHaveProperty('hair')
    expect(migrated).not.toHaveProperty('top')
    expect(migrated).not.toHaveProperty('skin')
  })
})

describe('v3 wire — readAvatarConfigV3', () => {
  it('answers an empty, absent or nonsense config with the default avatar', () => {
    expect(readAvatarConfigV3({}, catalog, aliases, baseIds)).toEqual(defaultAvatarV3(catalog))
    expect(readAvatarConfigV3(null, catalog, aliases, baseIds)).toEqual(defaultAvatarV3(catalog))
    expect(readAvatarConfigV3(undefined, catalog, aliases, baseIds)).toEqual(defaultAvatarV3(catalog))
    expect(migrateAvatarConfigV3([V1] as unknown as Record<string, unknown>, catalog, aliases, baseIds)).toEqual(defaultAvatarV3(catalog))
    expect(readAvatarConfigV3({ base: 'base_01' }, catalog, aliases, baseIds)).toEqual(defaultAvatarV3(catalog))
  })

  it('reads a v3 configuration straight through, without migrating anything', () => {
    const stored = { ...defaultAvatarV3(catalog), base: 'm01' as const, head: 'head_crown_gold01' }
    expect(readAvatarConfigV3(stored, catalog, aliases, baseIds)).toEqual(stored)
  })

  it('repairs a v3 configuration that has gone stale rather than throwing it away', () => {
    const stale = { ...defaultAvatarV3(catalog), outfit: 'outfit_gone', head: 'head_crown_gold01' }
    expect(readAvatarConfigV3(stale, catalog, aliases, baseIds)).toMatchObject({ v: 3, outfit: 'outfit_casual01', head: 'head_crown_gold01' })
  })

  it('reads a v1 config all the way through readAvatarConfigV3, exactly as migrateAvatarConfigV3 would', () => {
    expect(readAvatarConfigV3(V1, catalog, aliases, baseIds)).toEqual(migrateAvatarConfigV3(V1, catalog, aliases, baseIds))
  })

  it('reads a v2 config all the way through readAvatarConfigV3, exactly as migrateAvatarConfigV3 would', () => {
    expect(readAvatarConfigV3(V2, catalog, aliases, baseIds)).toEqual(migrateAvatarConfigV3(V2, catalog, aliases, baseIds))
  })

  it('falls back to the default base when the registry no longer defines the stored one', () => {
    const stored = { ...defaultAvatarV3(catalog), base: 'm01' as const, head: 'head_crown_gold01' }
    const withoutM01 = new Set(['f01'])
    expect(readAvatarConfigV3(stored, catalog, aliases, withoutM01)).toEqual({ ...stored, base: DEFAULT_BASE })
    const f09 = { ...defaultAvatarV3(catalog), base: 'f09' }
    expect(readAvatarConfigV3(f09, catalog, aliases, new Set([...baseIds, 'f09']))).toEqual(f09)
  })

  it('still drops the old colours, as it did before A4 — the v4 read is where they are kept', () => {
    // The v3 wire is today's contract, bug included (spec §4.5): a repaired v3 loses hairColor and eyeColor.
    const stale = { ...defaultAvatarV3(catalog), outfit: 'outfit_gone', hairColor: 'haircolor_red01', eyeColor: 'eyecolor_blue01' }
    expect(readAvatarConfigV3(stale, catalog, aliases, baseIds)).toEqual(defaultAvatarV3(catalog))
  })
})
