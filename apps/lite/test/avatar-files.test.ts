/**
 * Which avatar files a Lite build ships (`apps/lite/scripts/avatar-files.mjs`, docs/avatar-2d.md §8).
 *
 * Lite has no wardrobe, so the rule is small: the two bodies and their faces, the eight bots, the two default
 * hairstyles (both halves each) and the one default outfit — exactly what `defaultChibi` and `botChibi` draw, and no
 * mask. The part worth a test is what "the default outfit" and "the default hairs" mean: both are read out of
 * `items.json` rather than written into the build, because an item may carry a cut per wear and a hairstyle is two
 * layers, and a figure drawn from a layer Lite did not copy renders undressed or bald. These cases hold the rule to that.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// The kit's own naming rules, read from the four pure files that hold them: `@bp/ui-kit`'s index would pull React, the
// DOM and the CSS modules into this Node-typed test project (`test/tsconfig.json` has no DOM lib and no `jsx`).
import { BOT_FACE_COUNT, botChibi } from '../../../packages/ui-kit/src/avatar2d/bot.js'
import { defaultChibi, DEFAULT_HAIR } from '../../../packages/ui-kit/src/avatar2d/defaults.js'
import { layersFor } from '../../../packages/ui-kit/src/avatar2d/layers.js'
import type { ChibiSubject, Expression } from '../../../packages/ui-kit/src/avatar2d/types.js'
import { defaultHairLayers, defaultOutfitLayers, isLiteAvatarFile, LITE_DEFAULT_HAIRS, readDefaultHairLayers, readDefaultOutfitLayers } from '../scripts/avatar-files.mjs'
import { PACKAGE_ROOT } from './paths.js'

const ITEMS_JSON = resolve(PACKAGE_ROOT, '../normal-server/data/items.json')
const AVATAR_SRC = resolve(PACKAGE_ROOT, '../normal-web/public/avatar')

const outfit = (id: string, isDefault: boolean, asset: unknown): unknown => ({
  id,
  slot: 'outfit',
  rarity: 'common',
  nameKey: `items.${id}`,
  assetKey: `outfit/${id}`,
  isDefault,
  asset,
})

const hair = (id: string, asset: unknown, slot = 'hairStyle'): unknown => ({
  id,
  slot,
  rarity: 'common',
  nameKey: `items.${id}`,
  assetKey: `${slot}/${id}`,
  isDefault: false,
  free: true,
  asset,
})

const hairAsset = (code: string): unknown => ({ layer: 60, file: `item_hair_${code}_L60`, back: `item_hair_${code}_L20`, fitsAvatarCrop: true })

const CASUAL = { layer: 40, file: 'item_outfit_casual01_L40', fitsAvatarCrop: false }

describe('defaultOutfitLayers', () => {
  it('is the default outfit’s own file when it has no per-wear cuts', () => {
    expect(defaultOutfitLayers([outfit('outfit_casual01', true, CASUAL), outfit('outfit_tuxedo01', false, { ...CASUAL, file: 'item_outfit_tuxedo01_L40' })]))
      .toEqual(['item_outfit_casual01_L40'])
  })

  it('is that file *and every variant of it* once the default outfit gains one', () => {
    // The rule the 2026-09-20 ruling asks for: adding a male cut to the default outfit is one line of
    // `items.json`, and Lite must ship it without a second line anywhere in this build script.
    const layers = defaultOutfitLayers([
      outfit('outfit_casual01', true, { ...CASUAL, variants: { m: 'item_outfit_casual01_m_L40' } }),
      // A *non*-default outfit's variants are still Lite's business never: there is no store to buy it from.
      outfit('outfit_dealer01', false, { layer: 40, file: 'item_outfit_dealer01_L40', variants: { m: 'item_outfit_dealer01_m_L40' }, fitsAvatarCrop: false }),
    ])
    expect(layers).toEqual(['item_outfit_casual01_L40', 'item_outfit_casual01_m_L40'])
  })

  it('refuses a catalogue with no single default outfit rather than shipping an undressed table', () => {
    expect(() => defaultOutfitLayers([outfit('outfit_casual01', false, CASUAL)])).toThrow(/0 default outfits/)
    expect(() => defaultOutfitLayers([outfit('a', true, CASUAL), outfit('b', true, CASUAL)])).toThrow(/2 default outfits/)
    expect(() => defaultOutfitLayers([outfit('outfit_casual01', true, null)])).toThrow(/has no asset file/)
    expect(() => defaultOutfitLayers({ items: [] })).toThrow(/not a JSON array/)
  })

  it('reads the shipped catalogue, whatever it currently holds', () => {
    const layers = defaultOutfitLayers(JSON.parse(readFileSync(ITEMS_JSON, 'utf8')))
    expect(layers[0]).toBe('item_outfit_casual01_L40')
    // Every name is a real layer name, so the filter below can only ever match real files.
    for (const layer of layers) expect(layer).toMatch(/^item_outfit_[a-z0-9_]+_L40$/)
  })
})

describe('LITE_DEFAULT_HAIRS', () => {
  it('is the kit’s and the server’s pair', () => {
    // Pinned: `kit-defaults.test.ts` (normal-web) holds the kit's and the server's pair against `items.json`; this holds
    // Lite's own copy against the same two names. The runtime check is the Lite e2e, where every layer of a human seat
    // must decode in a real browser.
    expect(LITE_DEFAULT_HAIRS).toEqual(['hair_f_bob01', 'hair_m_tousled01'])
    expect([...LITE_DEFAULT_HAIRS].sort()).toEqual([DEFAULT_HAIR.f, DEFAULT_HAIR.m].sort())
  })
})

describe('defaultHairLayers', () => {
  const catalogue = [
    hair('hair_f_bob01', hairAsset('f_bob01')),
    hair('hair_f_wavy01', hairAsset('f_wavy01')),
    hair('hair_m_tousled01', hairAsset('m_tousled01')),
    hair('hair_m_curly01', hairAsset('m_curly01')),
  ]

  it('reads the default hairs out of the catalogue, both layers each', () => {
    // Back half (L20) first, then the front (L60), per hair, in `LITE_DEFAULT_HAIRS` order — and no other hairstyle.
    expect(defaultHairLayers(catalogue)).toEqual([
      'item_hair_f_bob01_L20',
      'item_hair_f_bob01_L60',
      'item_hair_m_tousled01_L20',
      'item_hair_m_tousled01_L60',
    ])
  })

  it('takes the layer names from the catalogue row, not from the naming rule', () => {
    const odd = [hair('hair_f_bob01', { layer: 60, file: 'item_hair_f_bob02_L60', back: 'item_hair_f_bob02_L20', fitsAvatarCrop: true }), hair('hair_m_tousled01', hairAsset('m_tousled01'))]
    expect(defaultHairLayers(odd).slice(0, 2)).toEqual(['item_hair_f_bob02_L20', 'item_hair_f_bob02_L60'])
  })

  it('refuses a default hair that is missing, is not a hairStyle, or has no back layer', () => {
    const bob = hair('hair_f_bob01', hairAsset('f_bob01'))
    const tousled = hair('hair_m_tousled01', hairAsset('m_tousled01'))
    expect(() => defaultHairLayers([bob])).toThrow(/hair_m_tousled01.*not in the item catalogue/)
    expect(() => defaultHairLayers([tousled])).toThrow(/hair_f_bob01.*not in the item catalogue/)
    expect(() => defaultHairLayers([hair('hair_f_bob01', hairAsset('f_bob01'), 'head'), tousled])).toThrow(/hair_f_bob01 is not a hairStyle/)
    expect(() => defaultHairLayers([bob, hair('hair_m_tousled01', { layer: 60, file: 'item_hair_m_tousled01_L60', fitsAvatarCrop: true })])).toThrow(/hair_m_tousled01 has no back layer/)
    expect(() => defaultHairLayers([bob, hair('hair_m_tousled01', null)])).toThrow(/hair_m_tousled01 has no front layer/)
    expect(() => defaultHairLayers({ items: [] })).toThrow(/not a JSON array/)
  })

  it('reads the shipped catalogue: both layers of both default hairs', () => {
    expect(readDefaultHairLayers(ITEMS_JSON)).toEqual([
      'item_hair_f_bob01_L20',
      'item_hair_f_bob01_L60',
      'item_hair_m_tousled01_L20',
      'item_hair_m_tousled01_L60',
    ])
  })
})

describe('isLiteAvatarFile', () => {
  const layers = ['item_outfit_casual01_L40', 'item_outfit_casual01_m_L40', 'item_hair_f_bob01_L20', 'item_hair_f_bob01_L60', 'item_hair_m_tousled01_L20', 'item_hair_m_tousled01_L60']

  it('takes the bodies, the bots, the two default hairs and the default outfit, and no mask or old base', () => {
    for (const name of [
      'body_f_L30@1x.png', 'body_m_L30@2x.png', 'body_f_face_neutral_L50@1x.png', 'body_m_face_sleep_L50@2x.png',
      'bot_3_L30@1x.png', 'bot_7_face_happy_L50@2x.png',
      'item_hair_f_bob01_L20@1x.png', 'item_hair_f_bob01_L60@2x.png', 'item_hair_m_tousled01_L20@2x.png', 'item_hair_m_tousled01_L60@1x.png',
      'item_outfit_casual01_L40@1x.png', 'item_outfit_casual01_L40@2x.png',
      'item_outfit_casual01_m_L40@1x.png', 'item_outfit_casual01_m_L40@2x.png',
    ]) {
      expect(isLiteAvatarFile(name, layers), name).toBe(true)
    }
    for (const name of [
      'base_f01_L30@1x.png', 'base_m01_face_happy_L50@2x.png', 'base_f01_L30_hairmask@1x.png', 'base_f02_L20@2x.png',
      'body_f_L30_skinmask@2x.png', 'body_f_face_neutral_L50_eyemask@2x.png',
      'item_hair_f_bob01_L60_hairmask@2x.png', 'item_hair_f_bob01_L20_hairmask@1x.png',
      'item_outfit_casual01_L40_tintmask@2x.png',
    ]) {
      expect(isLiteAvatarFile(name, layers), name).toBe(false)
    }
  })

  it('leaves every other wardrobe item behind, cuts included', () => {
    for (const name of [
      'item_head_tophat01_L80@2x.png', 'item_outfit_dealer01_L40@2x.png', 'item_outfit_dealer01_m_L40@2x.png',
      'item_hair_f_wavy01_L20@2x.png', 'item_hair_f_wavy01_L60@2x.png', 'item_hair_m_curly01_L60@1x.png',
      'avatar-manifest.json',
    ]) {
      expect(isLiteAvatarFile(name, layers), name).toBe(false)
    }
  })

  it('does not take a longer layer name that merely starts with a copied one', () => {
    // `item_outfit_casual01_L40` and `item_outfit_casual01_m_L40` are different layers; a prefix match
    // without the `@` would sweep the second in behind the first whether the catalogue named it or not.
    expect(isLiteAvatarFile('item_outfit_casual01_m_L40@2x.png', ['item_outfit_casual01_L40'])).toBe(false)
    expect(isLiteAvatarFile('item_hair_f_bob01_L60_hairmask@2x.png', ['item_hair_f_bob01_L60'])).toBe(false)
  })

  it('takes a body, a face or a bot only at its own density, as a whole name', () => {
    for (const name of ['body_f_L30.png', 'body_f_L30@3x.png', 'body_f_L30@1x.webp', 'body_x_L30@1x.png', 'body_f_face_neutral_L50_eyemask@1x.png', 'bot_L30@1x.png', 'bot_1_L30_extra@1x.png', 'xbody_f_L30@1x.png']) {
      expect(isLiteAvatarFile(name, layers), name).toBe(false)
    }
  })
})

describe('what the shipped catalogue and the kit draw', () => {
  const EXPRESSIONS: Expression[] = ['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep']
  const layers = [...readDefaultOutfitLayers(ITEMS_JSON), ...readDefaultHairLayers(ITEMS_JSON)]

  /** Every subject Lite can put on a seat: a default chibi of each gender, and each of the eight bots. */
  function subjects(): ChibiSubject[] {
    const humans = new Map<string, ChibiSubject>()
    for (let i = 0; humans.size < 2 && i < 200; i++) {
      const chibi = defaultChibi(`seat-${i}`)
      humans.set(chibi.body.gender, chibi)
    }
    const bots = Array.from({ length: BOT_FACE_COUNT }, (_, index) => botChibi(`bot-${index}`)).map((bot, index) => ({ ...bot, index }))
    return [...humans.values(), ...bots]
  }

  /** Every PNG the kit asks for, at both densities, across every expression and both crop modes. */
  function drawn(): Set<string> {
    const names = new Set<string>()
    for (const subject of subjects()) {
      for (const expression of EXPRESSIONS) {
        for (const frame of ['full', 'head'] as const) {
          for (const { file } of layersFor(subject, expression, frame)) {
            names.add(`${file}@1x.png`)
            names.add(`${file}@2x.png`)
          }
        }
      }
    }
    return names
  }

  it('covers both genders and every bot, so the next cases mean something', () => {
    const kinds = subjects().map((subject) => (subject.kind === 'bot' ? `bot_${subject.index}` : subject.body.gender))
    expect(kinds).toEqual(expect.arrayContaining(['f', 'm', ...Array.from({ length: BOT_FACE_COUNT }, (_, index) => `bot_${index}`)]))
  })

  it('ships every file the default chibis and the bots draw, and each exists in Normal’s public folder', () => {
    for (const name of drawn()) {
      expect(isLiteAvatarFile(name, layers), `${name} is drawn but Lite would not copy it`).toBe(true)
      expect(existsSync(resolve(AVATAR_SRC, name)), `${name} is drawn but missing from normal-web/public/avatar`).toBe(true)
    }
  })

  it('ships nothing else: the copy is exactly the drawn set', () => {
    const copied = readdirSync(AVATAR_SRC).filter((name) => isLiteAvatarFile(name, layers)).sort()
    expect(copied).toEqual([...drawn()].sort())
  })
})
