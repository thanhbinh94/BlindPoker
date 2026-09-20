/**
 * Which avatar files a Lite build ships (`apps/lite/scripts/avatar-files.mjs`, docs/avatar-2d.md §8).
 *
 * Lite has no wardrobe, so the rule is small: every base and bot layer, plus the one default outfit. The
 * part worth a test is what "the default outfit" means since 2026-09-20 — an item may carry a layer per
 * wear, and a base drawn in a cut Lite did not copy renders undressed. The rule is therefore read out of
 * `items.json` rather than written into the build, and these cases are what holds it to that.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultOutfitLayers, isLiteAvatarFile } from '../scripts/avatar-files.mjs'
import { PACKAGE_ROOT } from './paths.js'

const ITEMS_JSON = resolve(PACKAGE_ROOT, '../normal-server/data/items.json')

const outfit = (id: string, isDefault: boolean, asset: unknown): unknown => ({
  id,
  slot: 'outfit',
  rarity: 'common',
  nameKey: `items.${id}`,
  assetKey: `outfit/${id}`,
  isDefault,
  asset,
})

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

describe('isLiteAvatarFile', () => {
  const layers = ['item_outfit_casual01_L40', 'item_outfit_casual01_m_L40']

  it('takes every base and bot file, and both densities of each outfit layer', () => {
    for (const name of [
      'base_f01_L30@1x.png', 'base_m01_face_happy_L50@2x.png', 'bot_3_L30@1x.png',
      'item_outfit_casual01_L40@1x.png', 'item_outfit_casual01_L40@2x.png',
      'item_outfit_casual01_m_L40@1x.png', 'item_outfit_casual01_m_L40@2x.png',
    ]) {
      expect(isLiteAvatarFile(name, layers), name).toBe(true)
    }
  })

  it('leaves every other wardrobe item behind, cuts included', () => {
    for (const name of [
      'item_head_tophat01_L80@2x.png', 'item_outfit_dealer01_L40@2x.png', 'item_outfit_dealer01_m_L40@2x.png',
      'avatar-manifest.json',
    ]) {
      expect(isLiteAvatarFile(name, layers), name).toBe(false)
    }
  })

  it('does not take a longer layer name that merely starts with a copied one', () => {
    // `item_outfit_casual01_L40` and `item_outfit_casual01_m_L40` are different layers; a prefix match
    // without the `@` would sweep the second in behind the first whether the catalogue named it or not.
    expect(isLiteAvatarFile('item_outfit_casual01_m_L40@2x.png', ['item_outfit_casual01_L40'])).toBe(false)
  })
})
