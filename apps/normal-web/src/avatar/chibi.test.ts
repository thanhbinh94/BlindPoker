import { describe, expect, it } from 'vitest'
import type { AvatarConfigDto, BaseDto, ItemDto } from '../api.js'
import { chibiFromApi } from './chibi.js'

const FACES = {
  neutral: 'base_f01_face_neutral_L50',
  happy: 'base_f01_face_happy_L50',
  sad: 'base_f01_face_sad_L50',
  surprised: 'base_f01_face_surprised_L50',
  closed: 'base_f01_face_closed_L50',
  sleep: 'base_f01_face_sleep_L50',
}

const BASE_F01: BaseDto = {
  id: 'f01',
  nameKey: 'bases.f01',
  wear: 'f',
  layers: { hairBack: 'base_f01_L20', body: 'base_f01_L30', hairFront: 'base_f01_L60' },
  faces: FACES,
}

const BASE_M01: BaseDto = {
  id: 'm01',
  nameKey: 'bases.m01',
  wear: 'm',
  layers: { hairBack: 'base_m01_L20', body: 'base_m01_L30', hairFront: 'base_m01_L60' },
  faces: { ...FACES, neutral: 'base_m01_face_neutral_L50' },
}

const bases = new Map([
  ['f01', BASE_F01],
  ['m01', BASE_M01],
])

const item = (patch: Partial<ItemDto> & Pick<ItemDto, 'id' | 'slot'>): ItemDto => ({
  rarity: 'common',
  nameKey: `items.${patch.id}`,
  assetKey: `${patch.slot}/${patch.id}`,
  isDefault: false,
  ...patch,
})

const OUTFIT_CASUAL = item({
  id: 'outfit_casual01',
  slot: 'outfit',
  isDefault: true,
  asset: { layer: 40, file: 'item_outfit_casual01_L40', fitsAvatarCrop: false },
})
const OUTFIT_DEALER = item({
  id: 'outfit_dealer01',
  slot: 'outfit',
  asset: { layer: 40, file: 'item_outfit_dealer01_L40', variants: { m: 'item_outfit_dealer01_m_L40' }, fitsAvatarCrop: false },
})
/** The other gendered outfit, still drawn once: no `m` cut exists for it yet. */
const OUTFIT_TET = item({
  id: 'outfit_tet_red01',
  slot: 'outfit',
  asset: { layer: 40, file: 'item_outfit_tet_red01_L40', fitsAvatarCrop: false },
})
const HEAD_HOOD = item({
  id: 'head_hood_black01',
  slot: 'head',
  asset: { layer: 80, file: 'item_head_hood_black01_L80', hidesHairFront: true, hidesHairBack: true, fitsAvatarCrop: true },
})
const FACE_GLASSES = item({
  id: 'face_glasses_round_gold01',
  slot: 'face',
  asset: { layer: 70, file: 'item_face_glasses_round_gold01_L70', fitsAvatarCrop: true },
})
const AURA_FIRE = item({
  id: 'aura_fire01',
  slot: 'aura',
  asset: { layer: 10, file: 'item_aura_fire01_L10', fitsAvatarCrop: true },
})
const FRAME_GOLD = item({
  id: 'frame_gold',
  slot: 'frame',
  asset: { layer: 90, file: 'item_frame_gold_L90', fitsAvatarCrop: true },
})
const TITLE_ROOKIE = item({ id: 'title_rookie', slot: 'title' })

const items = new Map(
  [OUTFIT_CASUAL, OUTFIT_DEALER, OUTFIT_TET, HEAD_HOOD, FACE_GLASSES, AURA_FIRE, FRAME_GOLD, TITLE_ROOKIE].map((i) => [i.id, i]),
)

const config = (patch: Partial<AvatarConfigDto> = {}): AvatarConfigDto => ({
  v: 3,
  base: 'f01',
  outfit: 'outfit_casual01',
  ...patch,
})

describe('chibiFromApi', () => {
  it('maps the required base and outfit', () => {
    const chibi = chibiFromApi(config(), items, bases)

    expect(chibi).toEqual({
      kind: 'human',
      base: { id: 'f01', hairBack: 'base_f01_L20', body: 'base_f01_L30', hairFront: 'base_f01_L60', faces: FACES },
      outfit: { id: 'outfit_casual01', order: 40, file: 'item_outfit_casual01_L40' },
    })
  })

  it('maps every optional slot when equipped', () => {
    const chibi = chibiFromApi(
      config({
        base: 'm01',
        outfit: 'outfit_dealer01',
        head: 'head_hood_black01',
        face: 'face_glasses_round_gold01',
        aura: 'aura_fire01',
        frame: 'frame_gold',
      }),
      items,
      bases,
    )

    expect(chibi?.base.id).toBe('m01')
    // dealer01 has an `m` cut, and m01 wears `m` — same item id, the other layer.
    expect(chibi?.outfit).toEqual({ id: 'outfit_dealer01', order: 40, file: 'item_outfit_dealer01_m_L40' })
    expect(chibi?.head).toEqual({ id: 'head_hood_black01', order: 80, file: 'item_head_hood_black01_L80', hidesHairFront: true, hidesHairBack: true })
    expect(chibi?.face).toEqual({ id: 'face_glasses_round_gold01', order: 70, file: 'item_face_glasses_round_gold01_L70' })
    expect(chibi?.aura).toEqual({ id: 'aura_fire01', order: 10, file: 'item_aura_fire01_L10' })
    expect(chibi?.frame).toEqual({ id: 'frame_gold', order: 90, file: 'item_frame_gold_L90' })
  })

  it('carries hidesHairFront/hidesHairBack from the asset', () => {
    const chibi = chibiFromApi(config({ head: 'head_hood_black01' }), items, bases)

    expect(chibi?.head).toEqual(
      expect.objectContaining({ hidesHairFront: true, hidesHairBack: true }),
    )
  })

  it('returns null for an unknown base', () => {
    expect(chibiFromApi(config({ base: 'x99' as AvatarConfigDto['base'] }), items, bases)).toBeNull()
  })

  it('falls back to the default outfit for an unknown outfit id, and drops it entirely if there is no default', () => {
    const fallback = chibiFromApi(config({ outfit: 'outfit_from_the_future' }), items, bases)
    expect(fallback?.outfit.id).toBe('outfit_casual01')

    const noDefault = new Map([...items].filter(([id]) => id !== 'outfit_casual01'))
    expect(chibiFromApi(config({ outfit: 'outfit_from_the_future' }), noDefault, bases)).toBeNull()
  })

  it('omits an unknown optional item id rather than throwing', () => {
    const chibi = chibiFromApi(config({ head: 'head_from_the_future', face: 'face_glasses_round_gold01' }), items, bases)

    expect(chibi?.head).toBeUndefined()
    expect(chibi?.face).toEqual(expect.objectContaining({ id: 'face_glasses_round_gold01' }))
  })

  it('omits an item id that resolves to the wrong slot', () => {
    // A config naming a title id in the `head` field is malformed, not a chibi with a title on its head.
    const chibi = chibiFromApi(config({ head: 'title_rookie' }), items, bases)

    expect(chibi?.head).toBeUndefined()
  })

  /**
   * One item, two cuts (2026-09-20). The id in the config never changes — ownership, achievements and
   * the outfits table all key on it — so what the variant table decides is only which PNG is stacked.
   */
  describe('a per-wear item', () => {
    it('draws the m cut on an m base and the shared one on an f base', () => {
      expect(chibiFromApi(config({ base: 'm01', outfit: 'outfit_dealer01' }), items, bases)?.outfit)
        .toEqual({ id: 'outfit_dealer01', order: 40, file: 'item_outfit_dealer01_m_L40' })
      expect(chibiFromApi(config({ base: 'f01', outfit: 'outfit_dealer01' }), items, bases)?.outfit)
        .toEqual({ id: 'outfit_dealer01', order: 40, file: 'item_outfit_dealer01_L40' })
    })

    it('draws the shared layer on an m base when the item has no m cut', () => {
      // tet_red01 is gendered too, and its male picture has not been generated: until it is, m01 wears
      // the one layer there is rather than nothing at all.
      for (const base of ['f01', 'm01']) {
        expect(chibiFromApi(config({ base, outfit: 'outfit_tet_red01' }), items, bases)?.outfit)
          .toEqual({ id: 'outfit_tet_red01', order: 40, file: 'item_outfit_tet_red01_L40' })
      }
    })

    it('picks the cut for the fallback default outfit too', () => {
      // An unknown id falls back to the catalogue's default, and that fallback is dressed by the same rule.
      const withVariant = new Map(items)
      withVariant.set('outfit_casual01', {
        ...OUTFIT_CASUAL,
        asset: { ...OUTFIT_CASUAL.asset!, variants: { m: 'item_outfit_casual01_m_L40' } },
      })
      const chibi = chibiFromApi(config({ base: 'm01', outfit: 'outfit_from_the_future' }), withVariant, bases)
      expect(chibi?.outfit).toEqual({ id: 'outfit_casual01', order: 40, file: 'item_outfit_casual01_m_L40' })
    })
  })

  it('drops title and badge — they are words, not layers', () => {
    const chibi = chibiFromApi(config({ title: 'title_rookie' }), items, bases)

    expect(chibi).not.toHaveProperty('title')
    expect(chibi).not.toHaveProperty('badge')
  })

  /** Plan 13 (design §5.2): `hairColor`/`eyeColor` name catalogue *items*, not hex strings — this is the
   * one place that turns the id into the colour `ChibiConfig` actually wants. */
  describe('colour', () => {
    const HAIRCOLOR_RED = item({ id: 'haircolor_red01', slot: 'hairColor', colour: '#b3261e' })
    const EYECOLOR_BLUE = item({ id: 'eyecolor_blue01', slot: 'eyeColor', colour: '#2c3e70' })
    const OUTFIT_CASUAL_RED = item({
      id: 'outfit_casual_red01',
      slot: 'outfit',
      asset: { layer: 40, file: 'item_outfit_casual01_L40', fitsAvatarCrop: false, tint: '#c0392b', tintMeanL: 0.5 },
    })
    const colourItems = new Map([
      ...items,
      [HAIRCOLOR_RED.id, HAIRCOLOR_RED],
      [EYECOLOR_BLUE.id, EYECOLOR_BLUE],
      [OUTFIT_CASUAL_RED.id, OUTFIT_CASUAL_RED],
    ])

    it('resolves hairColor and eyeColor ids through the catalogue', () => {
      const chibi = chibiFromApi(config({ hairColor: 'haircolor_red01', eyeColor: 'eyecolor_blue01' }), colourItems, bases)

      expect(chibi?.hairColor).toBe('#b3261e')
      expect(chibi?.eyeColor).toBe('#2c3e70')
    })

    it('omits hairColor naming an eye colour item — the wrong slot', () => {
      const chibi = chibiFromApi(config({ hairColor: 'eyecolor_blue01' }), colourItems, bases)

      expect(chibi?.hairColor).toBeUndefined()
    })

    it('omits hairColor and eyeColor naming an unknown id, rather than throwing', () => {
      const chibi = chibiFromApi(config({ hairColor: 'haircolor_from_the_future', eyeColor: 'eyecolor_from_the_future' }), colourItems, bases)

      expect(chibi?.hairColor).toBeUndefined()
      expect(chibi?.eyeColor).toBeUndefined()
    })

    it("copies the base's tint straight from the BaseDto", () => {
      const tintedBase = {
        ...BASE_F01,
        tint: { hair: { meanL: 0.42, files: ['base_f01_L30'] }, eyes: { meanL: 0.55, files: ['base_f01_face_neutral_L50'] } },
      }
      const tintedBases = new Map([['f01', tintedBase], ['m01', BASE_M01]])

      const chibi = chibiFromApi(config(), colourItems, tintedBases)

      expect(chibi?.base.tint).toEqual({
        hair: { meanL: 0.42, files: ['base_f01_L30'] },
        eyes: { meanL: 0.55, files: ['base_f01_face_neutral_L50'] },
      })
    })

    it('leaves base.tint absent when the BaseDto has none', () => {
      const chibi = chibiFromApi(config(), colourItems, bases)

      expect(chibi?.base).not.toHaveProperty('tint')
    })

    it("carries an item's asset.tint and asset.tintMeanL into WearRef.tint", () => {
      const chibi = chibiFromApi(config({ outfit: 'outfit_casual_red01' }), colourItems, bases)

      expect(chibi?.outfit).toEqual({
        id: 'outfit_casual_red01',
        order: 40,
        file: 'item_outfit_casual01_L40',
        tint: { colour: '#c0392b', meanL: 0.5 },
      })
    })
  })
})
