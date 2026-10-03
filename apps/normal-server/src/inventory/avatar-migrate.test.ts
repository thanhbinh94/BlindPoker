/**
 * Reading old configurations back as v4 — the half of the plan that decides whether a player who has not
 * signed in since before Plan 19 (or Plan 11, or Plan 8) recognises their own figure (spec §4.5, R5).
 *
 * No database: this is a pure function of a stored jsonb value, the catalogue, the alias map and the bodies.
 * The table 4.5 cases run on fixture bodies whose natural eye colours are pinned here (ruling 6), so they
 * keep meaning the same thing when C1 measures the real art; one test runs the same rule on the shipped
 * bodies, whatever they say.
 */
import { describe, expect, it } from 'vitest'
import { loadAliases } from './aliases.js'
import type { AvatarConfigV4 } from './avatar.js'
import { defaultAvatar, validateAvatarConfig } from './avatar.js'
import { EYE_KEEP_DELTA_E, nearestFreeEyeColour, readAvatarConfig, V3_BASES } from './avatar-migrate.js'
import type { Bodies } from './bodies.js'
import { loadBodies } from './bodies.js'
import { deltaE } from './colour.js'
import type { ItemCatalog, ItemDef } from './items.js'
import { loadItemCatalog } from './items.js'
import type { Gender } from './slots.js'

const catalog = loadItemCatalog()
const aliases = loadAliases()

/** The bodies' natural eye colours, pinned for the table 4.5 cases (ruling 6) — the shipped provisional values. */
const BODIES_FIXTURE = { f: { naturalEyeColour: '#2e6a9b' }, m: { naturalEyeColour: '#cc924c' } } as unknown as Bodies

const read = (stored: Record<string, unknown>): AvatarConfigV4 => readAvatarConfig(stored, catalog, aliases, BODIES_FIXTURE)
const v3 = (base: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ v: 3, base, outfit: 'outfit_casual01', ...extra })

/** One `V3_BASES` row, read through the widest shape — the `as const` rows differ in which keys they carry. */
interface V3BaseRow {
  gender: Gender
  hairStyle: string
  skinColor?: string
  naturalEye: string
  eyeColor?: string
  keepEyes?: true
}

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

describe('readAvatarConfig — v3 to v4 (table 4.5)', () => {
  it.each([
    ['f01', { gender: 'f', hairStyle: 'hair_f_bob01' }],
    ['f02', { gender: 'f', hairStyle: 'hair_f_hime01', skinColor: 'skin_porcelain01', eyeColor: 'eyecolor_grey01' }],
    ['f03', { gender: 'f', hairStyle: 'hair_f_wavy01', skinColor: 'skin_tan01', eyeColor: 'eyecolor_green01' }],
    ['m01', { gender: 'm', hairStyle: 'hair_m_tousled01', skinColor: 'skin_lighttan01' }],
    ['m02', { gender: 'm', hairStyle: 'hair_m_neat01', skinColor: 'skin_fair01', eyeColor: 'eyecolor_grey01' }],
    ['m03', { gender: 'm', hairStyle: 'hair_m_curly01', skinColor: 'skin_deep01', eyeColor: 'eyecolor_brown01' }],
    ['robot', { gender: 'f', hairStyle: 'hair_f_bob01' }],
  ])('reads the old base %s as table 4.5 says', (base, expected) => {
    expect(read(v3(base))).toEqual({ v: 4, outfit: 'outfit_casual01', ...expected })
  })

  it('never tints f01 or m01 eyes, whatever the bodies’ natural eye colours are (keepEyes)', () => {
    const far = { f: { naturalEyeColour: '#ff0000' }, m: { naturalEyeColour: '#00ff00' } } as unknown as Bodies
    expect(readAvatarConfig(v3('f01'), catalog, aliases, far).eyeColor).toBeUndefined()
    expect(readAvatarConfig(v3('m01'), catalog, aliases, far).eyeColor).toBeUndefined()
  })

  it('gives no eye colour when the new body’s eyes are within EYE_KEEP_DELTA_E of the old base’s', () => {
    // m03's iris drawn on a body whose own eyes are that colour: nothing to correct.
    const same = { f: { naturalEyeColour: '#6b5771' }, m: { naturalEyeColour: '#ad6f4a' } } as unknown as Bodies
    expect(readAvatarConfig(v3('m03'), catalog, aliases, same).eyeColor).toBeUndefined()
    expect(readAvatarConfig(v3('f02'), catalog, aliases, same).eyeColor).toBeUndefined()
    // …and f03's pinned green is a pick for when the eyes differ, not a colour forced on every f03.
    const greenish = { f: { naturalEyeColour: '#a9a564' }, m: { naturalEyeColour: '#cc924c' } } as unknown as Bodies
    expect(readAvatarConfig(v3('f03'), catalog, aliases, greenish).eyeColor).toBeUndefined()
  })

  it('keeps the old hair and eye colours, and never overrides a chosen eye colour', () => {
    expect(read(v3('m03', { hairColor: 'haircolor_red01', eyeColor: 'eyecolor_blue01' }))).toMatchObject({ hairColor: 'haircolor_red01', eyeColor: 'eyecolor_blue01' })
    // A rare eye colour the player owns is kept too, on a base whose eyes the rule would otherwise correct.
    expect(read(v3('f02', { eyeColor: 'eyecolor_violet01' })).eyeColor).toBe('eyecolor_violet01')
    expect(read(v3('f03', { eyeColor: 'eyecolor_amber01' })).eyeColor).toBe('eyecolor_amber01')
  })

  it('keeps every wardrobe slot across the move', () => {
    const worn = {
      head: 'head_crown_gold01',
      face: 'face_glasses_round_gold01',
      aura: 'aura_gold_cards01',
      frame: 'frame_founder',
      title: 'title_devoted',
      badge: 'badge_monthly',
    }
    expect(read(v3('m02', { outfit: 'outfit_tuxedo01', ...worn }))).toEqual({
      v: 4,
      gender: 'm',
      hairStyle: 'hair_m_neat01',
      skinColor: 'skin_fair01',
      eyeColor: 'eyecolor_grey01',
      outfit: 'outfit_tuxedo01',
      ...worn,
    })
  })

  it('takes the skin from the old base, not from a v3 body that named one', () => {
    // A3 let a v3 PUT carry `skinColor`; no client ever sent one. The base is the old figure's skin.
    expect(read(v3('m03', { skinColor: 'skin_porcelain01' })).skinColor).toBe('skin_deep01')
    expect(read(v3('f01', { skinColor: 'skin_porcelain01' }))).not.toHaveProperty('skinColor')
  })

  it('repairs a stale v3 (a withdrawn outfit) and still keeps its colours', () => {
    expect(read(v3('f01', { outfit: 'outfit_gone', head: 'head_crown_gold01', hairColor: 'haircolor_red01', eyeColor: 'eyecolor_blue01' }))).toEqual({
      v: 4,
      gender: 'f',
      hairStyle: 'hair_f_bob01',
      outfit: 'outfit_casual01',
      head: 'head_crown_gold01',
      hairColor: 'haircolor_red01',
      eyeColor: 'eyecolor_blue01',
    })
    // A colour id the catalogue no longer has is dropped like any other withdrawn item — and then the eye rule applies.
    expect(read(v3('m03', { hairColor: 'haircolor_gone', eyeColor: 'eyecolor_gone' }))).toEqual({
      v: 4,
      gender: 'm',
      hairStyle: 'hair_m_curly01',
      skinColor: 'skin_deep01',
      eyeColor: 'eyecolor_brown01',
      outfit: 'outfit_casual01',
    })
  })

  it('pins the old bases’ natural eye colours (measured from the committed art, ruling 6)', () => {
    expect(V3_BASES.f01.naturalEye).toBe('#2e6a9b')
    expect(V3_BASES.f02.naturalEye).toBe('#6b5771')
    expect(V3_BASES.f03.naturalEye).toBe('#a9a564')
    expect(V3_BASES.m01.naturalEye).toBe('#cc924c')
    expect(V3_BASES.m02.naturalEye).toBe('#998c91')
    expect(V3_BASES.m03.naturalEye).toBe('#ad6f4a')
    // f01 and m01 are the two the bodies are drawn from: their eyes are the bodies' own, so never tinted (R25).
    expect(Object.entries(V3_BASES).filter(([, row]) => 'keepEyes' in row).map(([base]) => base)).toEqual(['f01', 'm01'])
    expect(EYE_KEEP_DELTA_E).toBe(12)
  })

  it('maps every old base onto a free hairstyle of its gender, and a free skin colour or none', () => {
    for (const [base, row] of Object.entries(V3_BASES) as [string, V3BaseRow][]) {
      expect(catalog.get(row.hairStyle), base).toMatchObject({ slot: 'hairStyle', gender: row.gender, free: true })
      if (row.skinColor !== undefined) expect(catalog.get(row.skinColor), base).toMatchObject({ slot: 'skinColor', free: true })
      if (row.eyeColor !== undefined) expect(catalog.get(row.eyeColor), base).toMatchObject({ slot: 'eyeColor', free: true })
    }
  })

  it('with the shipped bodies, every old base keeps its eyes, gets its pinned pick, or gets the nearest free eye colour', () => {
    const bodies = loadBodies()
    for (const [base, row] of Object.entries(V3_BASES) as [string, V3BaseRow][]) {
      const far = deltaE(row.naturalEye, bodies[row.gender].naturalEyeColour) > EYE_KEEP_DELTA_E
      const expected = row.keepEyes === true || !far ? undefined : (row.eyeColor ?? nearestFreeEyeColour(row.naturalEye, catalog))
      const migrated = readAvatarConfig(v3(base), catalog, aliases, bodies)
      expect(migrated.eyeColor, base).toBe(expected)
      expect(migrated, base).toMatchObject({ v: 4, gender: row.gender, hairStyle: row.hairStyle })
      expect(validateAvatarConfig(migrated, catalog), base).toEqual({ ok: true, value: migrated })
    }
  })
})

describe('readAvatarConfig — v1 and v2, on through v3 to v4', () => {
  it('takes v1 and v2 on through v3 to v4', () => {
    // v1 never named a body: the default figure, with the default outfit.
    expect(read(V1)).toMatchObject({ v: 4, gender: 'f', hairStyle: 'hair_f_bob01', outfit: 'outfit_casual01' })
    expect(read(V1)).not.toHaveProperty('skinColor')
    // v2's `body: 'male'` was m01: the tousled hair and the light tan skin, with the hat through its alias.
    expect(read(V2)).toMatchObject({ v: 4, gender: 'm', hairStyle: 'hair_m_tousled01', skinColor: 'skin_lighttan01', head: 'head_crown_gold01' })
    expect(read({ ...V2, body: 'female' })).toMatchObject({ gender: 'f', hairStyle: 'hair_f_bob01' })
    // A body it has never heard of falls back to the default figure, not to a guess.
    expect(read({ ...V2, body: 'robot' })).toMatchObject({ gender: 'f', hairStyle: 'hair_f_bob01' })
    // Their hex colours were never items: nothing to keep, and f01/m01 keep their eyes.
    expect(read(V1)).not.toHaveProperty('hairColor')
    expect(read(V2)).not.toHaveProperty('eyeColor')
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

  it('keeps title and badge — their ids never changed', () => {
    expect(read(V1)).toMatchObject({ title: 'title_devoted', badge: 'badge_monthly' })
    expect(read(V2)).toMatchObject({ title: 'title_devoted', badge: 'badge_monthly' })
  })

  it('is itself a valid v4 configuration, with nothing left from v1, v2 or v3 at all', () => {
    for (const old of [V1, V2, v3('f02')]) {
      const migrated = read(old)
      expect(validateAvatarConfig(migrated, catalog)).toEqual({ ok: true, value: migrated })
      for (const gone of ['base', 'body', 'hair', 'top', 'skin', 'clothing']) expect(migrated).not.toHaveProperty(gone)
    }
  })
})

describe('readAvatarConfig — v4', () => {
  it('reads a valid v4 straight through, and answers nonsense with the default', () => {
    const stored = { v: 4, gender: 'm', hairStyle: 'hair_m_spiky01', outfit: 'outfit_tuxedo01', head: 'head_crown_gold01', skinColor: 'skin_brown01', eyeColor: 'eyecolor_violet01' }
    expect(read(stored)).toEqual(stored)
    // A valid v4 is never run through the eye rule, even on bodies far from anything.
    const far = { f: { naturalEyeColour: '#ff0000' }, m: { naturalEyeColour: '#00ff00' } } as unknown as Bodies
    expect(readAvatarConfig({ ...defaultAvatar(catalog) }, catalog, aliases, far)).toEqual(defaultAvatar(catalog))

    expect(readAvatarConfig({}, catalog, aliases, BODIES_FIXTURE)).toEqual(defaultAvatar(catalog))
    expect(readAvatarConfig(null, catalog, aliases, BODIES_FIXTURE)).toEqual(defaultAvatar(catalog))
    expect(readAvatarConfig(undefined, catalog, aliases, BODIES_FIXTURE)).toEqual(defaultAvatar(catalog))
    expect(readAvatarConfig([V1] as unknown as Record<string, unknown>, catalog, aliases, BODIES_FIXTURE)).toEqual(defaultAvatar(catalog))
    // A single leftover key is not half an avatar: it is an avatar with one thing kept.
    expect(read({ base: 'base_01' })).toEqual(defaultAvatar(catalog))
    expect(read({ v: 4 })).toEqual(defaultAvatar(catalog))
  })

  it('repairs a stale v4 whose hairstyle is the other gender’s to that gender’s default', () => {
    expect(read({ v: 4, gender: 'm', hairStyle: 'hair_f_bob01', outfit: 'outfit_casual01' })).toEqual({ v: 4, gender: 'm', hairStyle: 'hair_m_tousled01', outfit: 'outfit_casual01' })
    expect(read({ v: 4, gender: 'f', hairStyle: 'hair_m_curly01', outfit: 'outfit_casual01', head: 'head_tophat01' })).toEqual({
      v: 4,
      gender: 'f',
      hairStyle: 'hair_f_bob01',
      outfit: 'outfit_casual01',
      head: 'head_tophat01',
    })
  })

  it('repairs a stale v4 slot by slot: a lost gender to f, a lost hairstyle or outfit to the default, every withdrawn item dropped', () => {
    expect(read({ v: 4, gender: 'x', hairStyle: 'hair_f_wavy01', outfit: 'outfit_tuxedo01' })).toEqual({ v: 4, gender: 'f', hairStyle: 'hair_f_wavy01', outfit: 'outfit_tuxedo01' })
    // A male hairstyle with no gender at all: the gender falls to f, so the hairstyle goes with it.
    expect(read({ v: 4, hairStyle: 'hair_m_neat01', outfit: 'outfit_casual01' })).toEqual(defaultAvatar(catalog))
    expect(read({ v: 4, gender: 'm', hairStyle: 'hair_m_gone', outfit: 'outfit_gone', skinColor: 'skin_tan01', eyeColor: 'eyecolor_gone', title: 'title_devoted' })).toEqual({
      v: 4,
      gender: 'm',
      hairStyle: 'hair_m_tousled01',
      outfit: 'outfit_casual01',
      skinColor: 'skin_tan01',
      title: 'title_devoted',
    })
    // A v4 that grew a base is still a v4: the base goes, the rest stays — and no eye rule, since it was never a v3.
    expect(read({ v: 4, base: 'm03', gender: 'm', hairStyle: 'hair_m_curly01', outfit: 'outfit_casual01' })).toEqual({ v: 4, gender: 'm', hairStyle: 'hair_m_curly01', outfit: 'outfit_casual01' })
    // An item in the wrong slot is dropped, not moved to the right one: v4 slots mean what they say.
    expect(read({ v: 4, gender: 'm', hairStyle: 'hair_m_neat01', outfit: 'outfit_casual01', head: 'face_glasses_round_gold01' })).toEqual({
      v: 4,
      gender: 'm',
      hairStyle: 'hair_m_neat01',
      outfit: 'outfit_casual01',
    })
  })
})

describe('nearestFreeEyeColour', () => {
  it('answers the free eye colour nearest in Lab, and never a rare one', () => {
    expect(nearestFreeEyeColour('#2f7fd6', catalog)).toBe('eyecolor_blue01')
    expect(nearestFreeEyeColour('#6b5771', catalog)).toBe('eyecolor_grey01')
    // violet01's own hex: the nearest *free* colour wins, however exact the rare match is.
    expect(nearestFreeEyeColour('#8b56d6', catalog)).not.toBe('eyecolor_violet01')
    expect(catalog.get(nearestFreeEyeColour('#8b56d6', catalog)!)).toMatchObject({ slot: 'eyeColor', free: true })
  })

  it('breaks a tie by catalogue order, and answers undefined when there is no free eye colour', () => {
    const eye = (id: string, colour: string, free?: true): ItemDef => ({ id, slot: 'eyeColor', rarity: 'common', nameKey: id, assetKey: id, isDefault: false, colour, ...(free ? { free } : {}) })
    const tied = { all: () => [eye('first', '#000000', true), eye('second', '#000000', true), eye('rare', '#ffffff')] } as unknown as ItemCatalog
    expect(nearestFreeEyeColour('#ffffff', tied)).toBe('first')
    const none = { all: () => [eye('rare', '#ffffff')] } as unknown as ItemCatalog
    expect(nearestFreeEyeColour('#ffffff', none)).toBeUndefined()
  })
})
