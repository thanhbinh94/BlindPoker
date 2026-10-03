import { describe, expect, it } from 'vitest'
import type { AvatarConfigDto, Gender, ItemDto } from '../../api.js'
import { swapGender } from './gender.js'

/** The catalogue's eight hairstyles (spec §4.2, `items.json`), each naming its counterpart of the other gender. */
const PAIRS: readonly [string, string][] = [
  ['hair_f_bob01', 'hair_m_tousled01'],
  ['hair_f_hime01', 'hair_m_neat01'],
  ['hair_f_wavy01', 'hair_m_curly01'],
  ['hair_f_ponytail01', 'hair_m_spiky01'],
]

const hairStyle = (id: string, gender: Gender, counterpart: string): ItemDto => ({
  id,
  slot: 'hairStyle',
  rarity: 'common',
  nameKey: `items.${id}`,
  assetKey: `hairStyle/${id}`,
  isDefault: false,
  free: true,
  gender,
  counterpart,
  asset: { layer: 60, file: `item_${id}_L60`, back: `item_${id}_L20`, fitsAvatarCrop: true },
})

const HAIRS: ItemDto[] = [
  ...PAIRS.map(([f, m]) => hairStyle(f, 'f', m)),
  ...PAIRS.map(([f, m]) => hairStyle(m, 'm', f)),
]
const OTHERS: ItemDto[] = [
  { id: 'outfit_dealer01', slot: 'outfit', rarity: 'rare', nameKey: 'items.outfit_dealer01', assetKey: 'outfit/outfit_dealer01', isDefault: false },
  { id: 'haircolor_red01', slot: 'hairColor', rarity: 'common', nameKey: 'items.haircolor_red01', assetKey: 'hairColor/haircolor_red01', isDefault: false, colour: '#b3261e' },
  { id: 'skin_tan01', slot: 'skinColor', rarity: 'common', nameKey: 'items.skin_tan01', assetKey: 'skinColor/skin_tan01', isDefault: false, colour: '#b9835a' },
  { id: 'head_beanie01', slot: 'head', rarity: 'common', nameKey: 'items.head_beanie01', assetKey: 'head/head_beanie01', isDefault: false },
]
const ITEMS: ReadonlyMap<string, ItemDto> = new Map([...OTHERS, ...HAIRS].map((item) => [item.id, item]))
const OWNED: ReadonlySet<string> = new Set(ITEMS.keys())

const genderOf = (id: string): Gender | undefined => ITEMS.get(id)?.gender

describe('swapGender', () => {
  it('swaps the hairstyle to its counterpart and keeps everything else', () => {
    const next = swapGender(
      { v: 4, gender: 'f', hairStyle: 'hair_f_wavy01', outfit: 'outfit_dealer01', hairColor: 'haircolor_red01', skinColor: 'skin_tan01', head: 'head_beanie01' },
      'm',
      ITEMS,
      OWNED,
    )
    expect(next).toEqual({ v: 4, gender: 'm', hairStyle: 'hair_m_curly01', outfit: 'outfit_dealer01', hairColor: 'haircolor_red01', skinColor: 'skin_tan01', head: 'head_beanie01' })
  })

  it('falls back to the first owned hairstyle of that gender when the counterpart is not owned', () => {
    // The ponytail's counterpart (spiky) and the first male style in catalogue order (tousled) are not owned.
    const owned = new Set([...OWNED].filter((id) => id !== 'hair_m_spiky01' && id !== 'hair_m_tousled01'))
    const next = swapGender({ v: 4, gender: 'f', hairStyle: 'hair_f_ponytail01', outfit: 'outfit_dealer01' }, 'm', ITEMS, owned)
    expect(next).toEqual({ v: 4, gender: 'm', hairStyle: 'hair_m_neat01', outfit: 'outfit_dealer01' })
  })

  it('changes nothing when the gender is already that one', () => {
    const config: AvatarConfigDto = { v: 4, gender: 'm', hairStyle: 'hair_m_spiky01', outfit: 'outfit_dealer01' }
    expect(swapGender(config, 'm', ITEMS, OWNED)).toBe(config)
  })

  it('changes nothing when no hairstyle of the new gender is owned', () => {
    const owned = new Set([...OWNED].filter((id) => genderOf(id) !== 'm'))
    const config: AvatarConfigDto = { v: 4, gender: 'f', hairStyle: 'hair_f_bob01', outfit: 'outfit_dealer01' }
    expect(swapGender(config, 'm', ITEMS, owned)).toBe(config)
  })

  it('takes a hairstyle of the new gender even when the old one is unknown to the catalogue', () => {
    const next = swapGender({ v: 4, gender: 'f', hairStyle: 'hair_f_gone01', outfit: 'outfit_dealer01' }, 'm', ITEMS, OWNED)
    expect(next).toEqual({ v: 4, gender: 'm', hairStyle: 'hair_m_tousled01', outfit: 'outfit_dealer01' })
  })

  // A5 review: `chibiFromApi` draws whatever hairstyle the draft names, of either gender. The switch is the only control
  // that changes the gender, so it alone must keep a figure from ever wearing the other gender's hairstyle.
  it('never reaches a draft that pairs a gender with the other gender’s hairstyle', () => {
    const ownings: ReadonlySet<string>[] = [
      OWNED,
      new Set([...OWNED].filter((id) => !id.endsWith('spiky01') && !id.endsWith('bob01'))),
      new Set([...OWNED].filter((id) => genderOf(id) !== 'f')),
    ]
    for (const owned of ownings) {
      for (const start of HAIRS) {
        let config: AvatarConfigDto = { v: 4, gender: start.gender!, hairStyle: start.id, outfit: 'outfit_dealer01' }
        for (const gender of ['m', 'f', 'f', 'm', 'm', 'f'] as const) {
          config = swapGender(config, gender, ITEMS, owned)
          expect(genderOf(config.hairStyle), `${start.id} → ${gender}`).toBe(config.gender)
        }
      }
    }
  })
})
