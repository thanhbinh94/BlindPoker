import { describe, expect, it } from 'vitest'
// The palettes the server actually validates against, read straight from its data directory — the same
// arrangement as the locale parity test and `items.json`. This app may not import the server's *code*, and
// this is a test, so nothing here reaches the bundle.
import palettes from '../../../normal-server/data/palettes.json'
import viNormal from '../locales/vi/normal.json'
import enNormal from '../locales/en/normal.json'
import { EYE_COLORS, SKIN_TONES } from './config.js'

/**
 * The wardrobe paints one swatch per entry and the server refuses anything outside them, so a copy that
 * drifted would be a colour a player can pick and cannot save — `INVALID_COLOR`, on a screen where they
 * changed nothing else. Order matters as much as membership: the names are indexed by position.
 */
describe('avatar palettes', () => {
  it('mirrors the server’s skin tones exactly, in order', () => {
    expect([...SKIN_TONES]).toEqual(palettes.skin)
  })

  it('mirrors the server’s eye colours exactly, in order', () => {
    expect([...EYE_COLORS]).toEqual(palettes.eyes)
  })

  it.each([
    ['vi', viNormal],
    ['en', enNormal],
  ])('names every tone in %s', (_lang, bundle) => {
    const wardrobe = bundle.wardrobe as { skinTone: Record<string, string>; eyeColor: Record<string, string> }
    expect(Object.keys(wardrobe.skinTone)).toHaveLength(SKIN_TONES.length)
    expect(Object.keys(wardrobe.eyeColor)).toHaveLength(EYE_COLORS.length)
    SKIN_TONES.forEach((_hex, at) => expect(wardrobe.skinTone[String(at)], `wardrobe.skinTone.${at}`).toBeTypeOf('string'))
    EYE_COLORS.forEach((_hex, at) => expect(wardrobe.eyeColor[String(at)], `wardrobe.eyeColor.${at}`).toBeTypeOf('string'))
  })
})
