import { describe, expect, it } from 'vitest'
import type { AvatarConfigDto } from '../api.js'
import { canonicalConfig, hashConfig } from './hash.js'

const CONFIG: AvatarConfigDto = {
  v: 2,
  body: 'male',
  skin: '#e0ac81',
  eyes: '#3b2415',
  hairColor: '#2b2b2b',
  hair: 'hair_short',
  top: 'top_tee',
  bottom: 'bottom_jeans',
  shoes: 'shoes_sneakers',
}

describe('hashConfig', () => {
  it('is eight lower-case hex digits, and the same for the same configuration', () => {
    expect(hashConfig(CONFIG)).toMatch(/^[0-9a-f]{8}$/)
    expect(hashConfig(CONFIG)).toBe(hashConfig({ ...CONFIG }))
  })

  it('does not depend on the order the fields were written in', () => {
    // Two objects with the same fields in the opposite order. `JSON.stringify` would disagree about them,
    // which is the entire reason this module writes the fields out itself.
    const reversed = {} as Record<string, unknown>
    for (const key of Object.keys(CONFIG).reverse()) reversed[key] = CONFIG[key as keyof AvatarConfigDto]

    expect(Object.keys(reversed)).not.toEqual(Object.keys(CONFIG))
    expect(hashConfig(reversed as unknown as AvatarConfigDto)).toBe(hashConfig(CONFIG))
  })

  it('ignores everything that is not a v2 field', () => {
    // A migrated v1 row can still be carrying `base` and `clothing`, and a newer server can send a field
    // this bundle has never heard of. Neither changes the picture, so neither may change the key.
    const noisy = { ...CONFIG, base: 'base_01', clothing: 'clothing_tee', cape: 'cape_01' }

    expect(hashConfig(noisy as unknown as AvatarConfigDto)).toBe(hashConfig(CONFIG))
    expect(canonicalConfig(noisy as unknown as AvatarConfigDto)).not.toContain('base')
  })

  it('treats an absent optional slot, an undefined one and an empty one as the same thing', () => {
    expect(hashConfig({ ...CONFIG, hat: undefined })).toBe(hashConfig(CONFIG))
    expect(hashConfig({ ...CONFIG, hat: '' })).toBe(hashConfig(CONFIG))
    expect(hashConfig({ ...CONFIG, hat: 'hat_crown' })).not.toBe(hashConfig(CONFIG))
  })

  it('changes when anything that is drawn changes', () => {
    const variants: Partial<AvatarConfigDto>[] = [
      { body: 'female' },
      { skin: '#452b1e' },
      { eyes: '#33608c' },
      { hairColor: '#d9a441' },
      { hair: 'hair_bun' },
      { top: 'clothing_aodai' },
      { bottom: 'bottom_skirt' },
      { shoes: 'shoes_boots' },
      { accessory: 'accessory_glasses' },
      { jewelry: 'ring_royal' },
    ]
    const hashes = new Set(variants.map((patch) => hashConfig({ ...CONFIG, ...patch })))

    // Every one of them differs from the base *and* from each other: a hash that collapsed two of these
    // would show one player another player's face.
    expect(hashes.size).toBe(variants.length)
    expect(hashes.has(hashConfig(CONFIG))).toBe(false)
  })

  it('folds the case of a colour, because the server does', () => {
    // The free colour box accepts `#C8323C`; the server lower-cases what it saves. Without the fold the
    // same face is two cache entries and one wasted render on either side of a save.
    const shouted = { ...CONFIG, skin: '#E0AC81', eyes: '#3B2415', hairColor: '#2B2B2B' }

    expect(hashConfig(shouted)).toBe(hashConfig(CONFIG))
    expect(canonicalConfig(shouted)).toBe(canonicalConfig(CONFIG))
    // Item ids are not colours and are not folded: they are matched against the server's own catalogue.
    expect(hashConfig({ ...CONFIG, hair: 'HAIR_SHORT' })).not.toBe(hashConfig(CONFIG))
  })

  it('writes the fields in a fixed order, whatever order they arrive in', () => {
    expect(canonicalConfig(CONFIG)).toBe(
      '{"v":2,"body":"male","skin":"#e0ac81","eyes":"#3b2415","hairColor":"#2b2b2b","hair":"hair_short","top":"top_tee","bottom":"bottom_jeans","shoes":"shoes_sneakers"}',
    )
  })
})
