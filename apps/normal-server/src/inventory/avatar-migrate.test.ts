/**
 * Reading v1 configurations back as v2 — the half of the plan that decides whether a player who has
 * not signed in since Plan 6 recognises their own figure.
 *
 * No database: this is a pure function of a stored jsonb value and the catalogue. The other half —
 * that the items a migrated config names are actually *owned*, because the migration granted them —
 * is `db/migrate-avatar-v2.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { defaultAvatar, DEFAULT_EYE_COLOR, DEFAULT_HAIR_COLOR, DEFAULT_SKIN_TONE, SKIN_TONES, validateAvatarConfig } from './avatar.js'
import { migrateAvatarConfig, readAvatarConfig } from './avatar-migrate.js'
import { loadItemCatalog } from './items.js'

const catalog = loadItemCatalog()

/** What a Plan 6 account had in `players.avatar_config`: no `v`, six SVG layers. */
const V1 = {
  base: 'base_01',
  face: 'face_01',
  clothing: 'clothing_tee',
  hair: 'hair_short',
  hairColor: '#7a3b1f',
  accessory: 'accessory_glasses',
  jewelry: 'jewelry_ring',
  title: 'title_devoted',
  badge: 'badge_monthly',
}

const read = (stored: Record<string, unknown>): ReturnType<typeof migrateAvatarConfig> => readAvatarConfig(stored, catalog)

describe('migrateAvatarConfig', () => {
  it('turns a v1 configuration into a valid v2 one, keeping everything that still means something', () => {
    expect(read(V1)).toEqual({
      v: 2,
      // v1 had one body, and it is the one its `base_*` layers were drawn as.
      body: 'male',
      skin: DEFAULT_SKIN_TONE,
      eyes: DEFAULT_EYE_COLOR,
      // The one colour a v1 player actually chose survives.
      hairColor: '#7a3b1f',
      hair: 'hair_short',
      // `clothing_tee` is `top_tee` now — the rename, and the reason the alias exists.
      top: 'top_tee',
      bottom: 'bottom_jeans',
      shoes: 'shoes_sneakers',
      accessory: 'accessory_glasses',
      jewelry: 'jewelry_ring',
      title: 'title_devoted',
      badge: 'badge_monthly',
    })
    expect(validateAvatarConfig(read(V1), catalog)).toMatchObject({ ok: true })
  })

  it('moves the v1 headwear out of `accessory` and into the hat slot', () => {
    for (const id of ['accessory_conical_hat', 'accessory_headband', 'hat_crown']) {
      const moved = read({ ...V1, accessory: id })
      // `hat_crown` was an epic *accessory* in v1 and is the epic hat now; nothing here lists which
      // ids moved — the catalogue's own slot for the id decides.
      expect(moved.hat, id).toBe(id)
      expect(moved.accessory, id).toBeUndefined()
    }
    // …and the ones that really were accessories stay where they are.
    const stayed = read({ ...V1, accessory: 'accessory_sunglasses' })
    expect(stayed.accessory).toBe('accessory_sunglasses')
    expect(stayed.hat).toBeUndefined()
  })

  it('replaces a withdrawn or unknown id with the slot’s default, and drops an optional one', () => {
    // `base_*` and `face_*` are gone from the catalogue; a v1 config full of them still reads.
    expect(read({ ...V1, hair: 'hair_gone', clothing: 'clothing_vanished' })).toMatchObject({ hair: 'hair_none', top: 'top_tee' })
    const dropped = read({ ...V1, jewelry: 'jewelry_vanished', title: 'title_vanished' })
    expect(dropped.jewelry).toBeUndefined()
    expect(dropped.title).toBeUndefined()
    // An id in the wrong slot is no better than an unknown one.
    expect(read({ ...V1, hair: 'jewelry_ring' })).toMatchObject({ hair: 'hair_none' })
  })

  it('keeps a hair colour it can use and replaces one it cannot', () => {
    expect(read({ ...V1, hairColor: '#ABCDEF' })).toMatchObject({ hairColor: '#ABCDEF' })
    for (const hairColor of ['red', '#fff', 42, undefined]) {
      expect(read({ ...V1, hairColor })).toMatchObject({ hairColor: DEFAULT_HAIR_COLOR })
    }
  })

  it('answers an empty, absent or nonsense config with the default avatar', () => {
    expect(readAvatarConfig({}, catalog)).toEqual(defaultAvatar(catalog))
    expect(readAvatarConfig(null, catalog)).toEqual(defaultAvatar(catalog))
    expect(readAvatarConfig(undefined, catalog)).toEqual(defaultAvatar(catalog))
    expect(migrateAvatarConfig([V1] as unknown as Record<string, unknown>, catalog)).toEqual(defaultAvatar(catalog))
    // A single leftover key is not half an avatar: it is an avatar with one thing kept.
    expect(readAvatarConfig({ base: 'base_01' }, catalog)).toEqual(defaultAvatar(catalog))
  })

  it('reads a v2 configuration straight through, without migrating anything', () => {
    const stored = { ...defaultAvatar(catalog), body: 'female' as const, skin: SKIN_TONES[6]!, hat: 'hat_crown' }
    expect(readAvatarConfig(stored, catalog)).toEqual(stored)
  })

  it('repairs a v2 configuration that has gone stale rather than throwing it away', () => {
    // A v2 config naming an item a later catalogue withdrew: everything else is kept.
    const stale = { ...defaultAvatar(catalog), hairColor: '#123456', top: 'top_withdrawn', jewelry: 'jewelry_chain' }
    expect(readAvatarConfig(stale, catalog)).toMatchObject({ v: 2, hairColor: '#123456', top: 'top_tee', jewelry: 'jewelry_chain' })
  })

  it('keeps the chosen body, and only what that body can wear', () => {
    const female = { ...V1, body: 'female' }
    expect(read(female)).toMatchObject({ body: 'female', top: 'top_tee' })
    // A body it has never heard of is not a body; the figure falls back to the one v1 had.
    expect(read({ ...V1, body: 'robot' })).toMatchObject({ body: 'male' })
  })
})
