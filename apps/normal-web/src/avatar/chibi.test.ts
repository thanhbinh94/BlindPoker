import { describe, expect, it } from 'vitest'
import type { AvatarConfigDto, BodyDto, Gender, ItemDto } from '../api.js'
import { chibiFromApi, layerFileFor } from './chibi.js'

const EXPRESSIONS = ['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep'] as const
const facesOf = (g: Gender): Record<string, string> => Object.fromEntries(EXPRESSIONS.map((e) => [e, `body_${g}_face_${e}_L50`]))

const BODY_F: BodyDto = { gender: 'f', body: 'body_f_L30', faces: facesOf('f'), naturalEyeColour: '#2e6a9b' }
const BODY_M: BodyDto = { gender: 'm', body: 'body_m_L30', faces: facesOf('m'), naturalEyeColour: '#cc924c' }

const bodies = new Map([
  ['f', BODY_F],
  ['m', BODY_M],
])

const item = (patch: Partial<ItemDto> & Pick<ItemDto, 'id' | 'slot'>): ItemDto => ({
  rarity: 'common',
  nameKey: `items.${patch.id}`,
  assetKey: `${patch.slot}/${patch.id}`,
  isDefault: false,
  ...patch,
})

/** A hairstyle as the catalogue serves it: its front half is `asset.file` (L60), its back half `asset.back` (L20). */
const hair = (id: string, gender: Gender, patch: Partial<NonNullable<ItemDto['asset']>> = {}): ItemDto =>
  item({
    id,
    slot: 'hairStyle',
    gender,
    free: true,
    asset: { layer: 60, file: `item_${id}_L60`, back: `item_${id}_L20`, fitsAvatarCrop: true, ...patch },
  })

const HAIR_F_BOB = hair('hair_f_bob01', 'f')
const HAIR_F_HIME = hair('hair_f_hime01', 'f')
const HAIR_M_TOUSLED = hair('hair_m_tousled01', 'm')
const HAIR_M_NEAT = hair('hair_m_neat01', 'm')

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
/** A hat that covers the crown (2026-10-06): the server reads `clipsHair` off the manifest's hair clip. */
const HEAD_CONICAL = item({
  id: 'head_conical_hat01',
  slot: 'head',
  asset: { layer: 80, file: 'item_head_conical_hat01_L80', clipsHair: true, fitsAvatarCrop: true },
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

// Catalogue order: both female hairstyles first, so "the first hairstyle of that gender" is not simply the first
// hairstyle in the map.
const items = new Map(
  [HAIR_F_BOB, HAIR_F_HIME, HAIR_M_TOUSLED, HAIR_M_NEAT, OUTFIT_CASUAL, OUTFIT_DEALER, OUTFIT_TET, HEAD_HOOD, HEAD_CONICAL, FACE_GLASSES, AURA_FIRE, FRAME_GOLD, TITLE_ROOKIE].map(
    (i) => [i.id, i],
  ),
)

const config = (patch: Partial<AvatarConfigDto> = {}): AvatarConfigDto => ({
  v: 4,
  gender: 'f',
  hairStyle: 'hair_f_bob01',
  outfit: 'outfit_casual01',
  ...patch,
})

describe('chibiFromApi', () => {
  it('maps a v4 config to the body of its gender, its hairstyle and its outfit', () => {
    const chibi = chibiFromApi(config(), items, bodies)

    expect(chibi).toEqual({
      kind: 'human',
      body: { gender: 'f', body: 'body_f_L30', faces: facesOf('f') },
      hair: { id: 'hair_f_bob01', back: 'item_hair_f_bob01_L20', front: 'item_hair_f_bob01_L60' },
      outfit: { id: 'outfit_casual01', order: 40, file: 'item_outfit_casual01_L40' },
    })
  })

  it('maps every optional slot when equipped', () => {
    const chibi = chibiFromApi(
      config({
        gender: 'm',
        hairStyle: 'hair_m_neat01',
        outfit: 'outfit_dealer01',
        head: 'head_hood_black01',
        face: 'face_glasses_round_gold01',
        aura: 'aura_fire01',
        frame: 'frame_gold',
      }),
      items,
      bodies,
    )

    expect(chibi?.body.gender).toBe('m')
    expect(chibi?.body.body).toBe('body_m_L30')
    expect(chibi?.hair).toEqual({ id: 'hair_m_neat01', back: 'item_hair_m_neat01_L20', front: 'item_hair_m_neat01_L60' })
    // dealer01 has an `m` cut, and this figure is `m` — same item id, the other layer.
    expect(chibi?.outfit).toEqual({ id: 'outfit_dealer01', order: 40, file: 'item_outfit_dealer01_m_L40' })
    expect(chibi?.head).toEqual({ id: 'head_hood_black01', order: 80, file: 'item_head_hood_black01_L80', hidesHairFront: true, hidesHairBack: true })
    expect(chibi?.face).toEqual({ id: 'face_glasses_round_gold01', order: 70, file: 'item_face_glasses_round_gold01_L70' })
    expect(chibi?.aura).toEqual({ id: 'aura_fire01', order: 10, file: 'item_aura_fire01_L10' })
    expect(chibi?.frame).toEqual({ id: 'frame_gold', order: 90, file: 'item_frame_gold_L90' })
  })

  it('carries hidesHairFront/hidesHairBack from the asset', () => {
    const chibi = chibiFromApi(config({ head: 'head_hood_black01' }), items, bodies)

    expect(chibi?.head).toEqual(expect.objectContaining({ hidesHairFront: true, hidesHairBack: true }))
  })

  it('carries clipsHair from the asset, and leaves it off a hat without one (2026-10-06)', () => {
    expect(chibiFromApi(config({ head: 'head_conical_hat01' }), items, bodies)?.head).toEqual({ id: 'head_conical_hat01', order: 80, file: 'item_head_conical_hat01_L80', clipsHair: true })
    expect(chibiFromApi(config({ head: 'head_hood_black01' }), items, bodies)?.head).not.toHaveProperty('clipsHair')
  })

  it('returns null for an unknown gender — there is no body to draw it on', () => {
    expect(chibiFromApi(config({ gender: 'x' as Gender }), items, bodies)).toBeNull()
  })

  it('returns null when the body of that gender has not been served', () => {
    expect(chibiFromApi(config({ gender: 'm', hairStyle: 'hair_m_neat01' }), items, new Map([['f', BODY_F]]))).toBeNull()
  })

  /**
   * A browser holding yesterday's bundle can meet a hairstyle id the server has added since. The figure still needs
   * hair — a bald stand-in body is not a look anybody chose — so it wears its gender's first hairstyle in catalogue
   * order rather than nothing.
   */
  describe('a hairstyle the catalogue cannot draw', () => {
    it('falls back to the first hairstyle of that gender for an unknown hairstyle id', () => {
      expect(chibiFromApi(config({ hairStyle: 'hair_f_from_the_future' }), items, bodies)?.hair.id).toBe('hair_f_bob01')
      // Not the first hairstyle in the catalogue: the first of *this* gender.
      expect(chibiFromApi(config({ gender: 'm', hairStyle: 'hair_m_from_the_future' }), items, bodies)?.hair).toEqual({
        id: 'hair_m_tousled01',
        back: 'item_hair_m_tousled01_L20',
        front: 'item_hair_m_tousled01_L60',
      })
    })

    it('falls back the same way for an id that names something other than a hairstyle', () => {
      expect(chibiFromApi(config({ gender: 'm', hairStyle: 'outfit_casual01' }), items, bodies)?.hair.id).toBe('hair_m_tousled01')
    })

    it('returns null when the catalogue has no hairstyle of that gender at all', () => {
      const noMaleHair = new Map([...items].filter(([, i]) => !(i.slot === 'hairStyle' && i.gender === 'm')))
      expect(chibiFromApi(config({ gender: 'm', hairStyle: 'hair_m_neat01' }), noMaleHair, bodies)).toBeNull()
    })
  })

  it('falls back to the default outfit for an unknown outfit id, and drops it entirely if there is no default', () => {
    const fallback = chibiFromApi(config({ outfit: 'outfit_from_the_future' }), items, bodies)
    expect(fallback?.outfit.id).toBe('outfit_casual01')

    const noDefault = new Map([...items].filter(([id]) => id !== 'outfit_casual01'))
    expect(chibiFromApi(config({ outfit: 'outfit_from_the_future' }), noDefault, bodies)).toBeNull()
  })

  it('omits an unknown optional item id rather than throwing', () => {
    const chibi = chibiFromApi(config({ head: 'head_from_the_future', face: 'face_glasses_round_gold01' }), items, bodies)

    expect(chibi?.head).toBeUndefined()
    expect(chibi?.face).toEqual(expect.objectContaining({ id: 'face_glasses_round_gold01' }))
  })

  it('omits an item id that resolves to the wrong slot', () => {
    // A config naming a title id in the `head` field is malformed, not a chibi with a title on its head.
    const chibi = chibiFromApi(config({ head: 'title_rookie' }), items, bodies)

    expect(chibi?.head).toBeUndefined()
  })

  /**
   * One item, two cuts (2026-09-20). The id in the config never changes — ownership, achievements and the outfits
   * table all key on it — so what the variant table decides is only which PNG is stacked, and since v4 the figure's
   * `gender` decides it (it was the base's `wear`).
   */
  describe('a per-gender item', () => {
    it('draws the m cut of a gendered outfit for gender m, and the shared one for f', () => {
      expect(chibiFromApi(config({ gender: 'm', hairStyle: 'hair_m_tousled01', outfit: 'outfit_dealer01' }), items, bodies)?.outfit).toEqual({
        id: 'outfit_dealer01',
        order: 40,
        file: 'item_outfit_dealer01_m_L40',
      })
      expect(chibiFromApi(config({ outfit: 'outfit_dealer01' }), items, bodies)?.outfit).toEqual({
        id: 'outfit_dealer01',
        order: 40,
        file: 'item_outfit_dealer01_L40',
      })
    })

    it('draws the shared layer for gender m when the item has no m cut', () => {
      // tet_red01 is gendered too, and its male picture has not been generated: until it is, a male figure wears the
      // one layer there is rather than nothing at all.
      for (const [gender, hairStyle] of [
        ['f', 'hair_f_bob01'],
        ['m', 'hair_m_tousled01'],
      ] as const) {
        expect(chibiFromApi(config({ gender, hairStyle, outfit: 'outfit_tet_red01' }), items, bodies)?.outfit).toEqual({
          id: 'outfit_tet_red01',
          order: 40,
          file: 'item_outfit_tet_red01_L40',
        })
      }
    })

    it('picks the cut for the fallback default outfit too', () => {
      // An unknown id falls back to the catalogue's default, and that fallback is dressed by the same rule.
      const withVariant = new Map(items)
      withVariant.set('outfit_casual01', {
        ...OUTFIT_CASUAL,
        asset: { ...OUTFIT_CASUAL.asset!, variants: { m: 'item_outfit_casual01_m_L40' } },
      })
      const chibi = chibiFromApi(config({ gender: 'm', hairStyle: 'hair_m_tousled01', outfit: 'outfit_from_the_future' }), withVariant, bodies)
      expect(chibi?.outfit).toEqual({ id: 'outfit_casual01', order: 40, file: 'item_outfit_casual01_m_L40' })
    })
  })

  it('drops title and badge — they are words, not layers', () => {
    const chibi = chibiFromApi(config({ title: 'title_rookie' }), items, bodies)

    expect(chibi).not.toHaveProperty('title')
    expect(chibi).not.toHaveProperty('badge')
  })

  /** Plan 13 (design §5.2), and v4's third colour: `hairColor`/`eyeColor`/`skinColor` name catalogue *items*, not hex
   * strings — this is the one place that turns the id into the colour `ChibiConfig` actually wants. */
  describe('colour', () => {
    const HAIRCOLOR_RED = item({ id: 'haircolor_red01', slot: 'hairColor', colour: '#b3261e' })
    const EYECOLOR_BLUE = item({ id: 'eyecolor_blue01', slot: 'eyeColor', colour: '#2c3e70' })
    const SKIN_DEEP = item({ id: 'skin_deep01', slot: 'skinColor', colour: '#5c3a28' })
    const OUTFIT_CASUAL_RED = item({
      id: 'outfit_casual_red01',
      slot: 'outfit',
      asset: { layer: 40, file: 'item_outfit_casual01_L40', fitsAvatarCrop: false, tint: '#c0392b', tintMeanL: 0.5 },
    })
    const colourItems = new Map([
      ...items,
      [HAIRCOLOR_RED.id, HAIRCOLOR_RED],
      [EYECOLOR_BLUE.id, EYECOLOR_BLUE],
      [SKIN_DEEP.id, SKIN_DEEP],
      [OUTFIT_CASUAL_RED.id, OUTFIT_CASUAL_RED],
    ])

    it('resolves hairColor, eyeColor and skinColor ids through the catalogue', () => {
      const chibi = chibiFromApi(config({ hairColor: 'haircolor_red01', eyeColor: 'eyecolor_blue01', skinColor: 'skin_deep01' }), colourItems, bodies)

      expect(chibi?.hairColor).toBe('#b3261e')
      expect(chibi?.eyeColor).toBe('#2c3e70')
      expect(chibi?.skinColor).toBe('#5c3a28')
    })

    it('omits a colour naming an item of another colour slot', () => {
      const chibi = chibiFromApi(config({ hairColor: 'eyecolor_blue01', skinColor: 'haircolor_red01' }), colourItems, bodies)

      expect(chibi?.hairColor).toBeUndefined()
      expect(chibi?.skinColor).toBeUndefined()
    })

    it('omits colours naming an unknown id, rather than throwing', () => {
      const chibi = chibiFromApi(
        config({ hairColor: 'haircolor_from_the_future', eyeColor: 'eyecolor_from_the_future', skinColor: 'skin_from_the_future' }),
        colourItems,
        bodies,
      )

      expect(chibi?.hairColor).toBeUndefined()
      expect(chibi?.eyeColor).toBeUndefined()
      expect(chibi?.skinColor).toBeUndefined()
    })

    it("copies the body's tint straight from the BodyDto", () => {
      const tint = { skin: { meanL: 0.78, files: ['body_f_L30', 'body_f_face_neutral_L50'] }, eyes: { meanL: 0.41, files: ['body_f_face_neutral_L50'] } }
      const tinted = new Map([
        ['f', { ...BODY_F, tint }],
        ['m', BODY_M],
      ])

      expect(chibiFromApi(config(), colourItems, tinted)?.body.tint).toEqual(tint)
    })

    it('leaves body.tint absent when the BodyDto has none', () => {
      expect(chibiFromApi(config(), colourItems, bodies)?.body).not.toHaveProperty('tint')
    })

    it("copies the hairstyle's hairTint into hair.tint, and leaves it absent when there is none", () => {
      const hairTint = { meanL: 0.31, files: ['item_hair_f_hime01_L20', 'item_hair_f_hime01_L60'] }
      const withMasks = new Map(colourItems)
      withMasks.set('hair_f_hime01', hair('hair_f_hime01', 'f', { hairTint }))

      expect(chibiFromApi(config({ hairStyle: 'hair_f_hime01' }), withMasks, bodies)?.hair.tint).toEqual(hairTint)
      expect(chibiFromApi(config(), withMasks, bodies)?.hair).not.toHaveProperty('tint')
    })

    it("carries an item's asset.tint and asset.tintMeanL into WearRef.tint", () => {
      const chibi = chibiFromApi(config({ outfit: 'outfit_casual_red01' }), colourItems, bodies)

      expect(chibi?.outfit).toEqual({
        id: 'outfit_casual_red01',
        order: 40,
        file: 'item_outfit_casual01_L40',
        tint: { colour: '#c0392b', meanL: 0.5 },
      })
    })
  })
})

describe('layerFileFor', () => {
  it("draws a gender's own cut when the asset has one, and the shared file otherwise", () => {
    expect(layerFileFor(OUTFIT_DEALER.asset, 'm')).toBe('item_outfit_dealer01_m_L40')
    expect(layerFileFor(OUTFIT_DEALER.asset, 'f')).toBe('item_outfit_dealer01_L40')
    expect(layerFileFor(OUTFIT_DEALER.asset, undefined)).toBe('item_outfit_dealer01_L40')
  })

  it('answers undefined for an item with nothing to draw', () => {
    expect(layerFileFor(TITLE_ROOKIE.asset, 'f')).toBeUndefined()
  })
})
