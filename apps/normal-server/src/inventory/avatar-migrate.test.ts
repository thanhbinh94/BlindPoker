/**
 * Reading old configurations back as v3 — the half of the plan that decides whether a player who has
 * not signed in since before Plan 11 recognises their own figure.
 *
 * No database: this is a pure function of a stored jsonb value, the catalogue and the alias map.
 */
import { describe, expect, it } from 'vitest'
import { loadAliases } from './aliases.js'
import { defaultAvatar, validateAvatarConfig } from './avatar.js'
import { migrateAvatarConfig, readAvatarConfig } from './avatar-migrate.js'
import { loadItemCatalog } from './items.js'

const catalog = loadItemCatalog()
const aliases = loadAliases()

const read = (stored: Record<string, unknown>): ReturnType<typeof migrateAvatarConfig> => readAvatarConfig(stored, catalog, aliases)

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

describe('migrateAvatarConfig — v1 to v3', () => {
  it('falls back to the default base — v1 never named a body at all — and the default outfit', () => {
    expect(read(V1)).toMatchObject({ v: 3, base: defaultAvatar(catalog).base, outfit: 'outfit_casual01' })
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
    expect(validateAvatarConfig(read(V1), catalog)).toMatchObject({ ok: true })
  })
})

describe('migrateAvatarConfig — v2 to v3', () => {
  it('reads the base from `body`: female to f01, male to m01', () => {
    expect(read(V2)).toMatchObject({ base: 'm01' })
    expect(read({ ...V2, body: 'female' })).toMatchObject({ base: 'f01' })
    // A body it has never heard of falls back to the default base, not to a guess.
    expect(read({ ...V2, body: 'robot' })).toMatchObject({ base: defaultAvatar(catalog).base })
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
    expect(validateAvatarConfig(migrated, catalog)).toMatchObject({ ok: true })
    expect(migrated).not.toHaveProperty('body')
    expect(migrated).not.toHaveProperty('hair')
    expect(migrated).not.toHaveProperty('top')
    expect(migrated).not.toHaveProperty('skin')
  })
})

describe('readAvatarConfig', () => {
  it('answers an empty, absent or nonsense config with the default avatar', () => {
    expect(readAvatarConfig({}, catalog, aliases)).toEqual(defaultAvatar(catalog))
    expect(readAvatarConfig(null, catalog, aliases)).toEqual(defaultAvatar(catalog))
    expect(readAvatarConfig(undefined, catalog, aliases)).toEqual(defaultAvatar(catalog))
    expect(migrateAvatarConfig([V1] as unknown as Record<string, unknown>, catalog, aliases)).toEqual(defaultAvatar(catalog))
    // A single leftover key is not half an avatar: it is an avatar with one thing kept.
    expect(readAvatarConfig({ base: 'base_01' }, catalog, aliases)).toEqual(defaultAvatar(catalog))
  })

  it('reads a v3 configuration straight through, without migrating anything', () => {
    const stored = { ...defaultAvatar(catalog), base: 'm01' as const, head: 'head_crown_gold01' }
    expect(readAvatarConfig(stored, catalog, aliases)).toEqual(stored)
  })

  it('repairs a v3 configuration that has gone stale rather than throwing it away', () => {
    // A v3 config naming an item a later catalogue withdrew: everything else is kept, and the
    // invalidated slot is treated as v3's own candidate — resolving to nothing, since `outfit_gone`
    // aliases to nothing and is not itself in the catalogue.
    const stale = { ...defaultAvatar(catalog), outfit: 'outfit_gone', head: 'head_crown_gold01' }
    expect(readAvatarConfig(stale, catalog, aliases)).toMatchObject({ v: 3, outfit: 'outfit_casual01', head: 'head_crown_gold01' })
  })

  it('reads a v1 config all the way through readAvatarConfig, exactly as migrateAvatarConfig would', () => {
    expect(readAvatarConfig(V1, catalog, aliases)).toEqual(migrateAvatarConfig(V1, catalog, aliases))
  })

  it('reads a v2 config all the way through readAvatarConfig, exactly as migrateAvatarConfig would', () => {
    expect(readAvatarConfig(V2, catalog, aliases)).toEqual(migrateAvatarConfig(V2, catalog, aliases))
  })
})
