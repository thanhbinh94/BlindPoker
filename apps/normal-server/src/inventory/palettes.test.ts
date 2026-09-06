import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EYE_COLORS, SKIN_TONES } from './avatar.js'
import { EYE_COLOR_COUNT, PALETTES, palettesPath, parsePalettes, SKIN_TONE_COUNT } from './palettes.js'

/**
 * The palettes are a *contract with the client*, so what matters is that the file on disk is what
 * the validator uses — and that a file which is not a palette is refused rather than half-read into
 * a server that then rejects every avatar it holds.
 */
describe('palettes', () => {
  it('is what the avatar validator offers', () => {
    const onDisk = JSON.parse(readFileSync(palettesPath(), 'utf8')) as { skin: string[]; eyes: string[] }
    expect(SKIN_TONES).toEqual(onDisk.skin)
    expect(EYE_COLORS).toEqual(onDisk.eyes)
    expect(PALETTES.skin).toHaveLength(SKIN_TONE_COUNT)
    expect(PALETTES.eyes).toHaveLength(EYE_COLOR_COUNT)
  })

  it.each([
    ['not an object', []],
    ['a palette of the wrong length', { skin: ['#000000'], eyes: PALETTES.eyes }],
    ['a colour that is not a hex triple', { skin: ['red', ...PALETTES.skin.slice(1)], eyes: PALETTES.eyes }],
    // Upper case would survive `HEX_COLOR` but never match a folded stored value, so it is refused here.
    ['an upper-case colour', { skin: ['#F7DCC3', ...PALETTES.skin.slice(1)], eyes: PALETTES.eyes }],
    ['a duplicate', { skin: [PALETTES.skin[1], ...PALETTES.skin.slice(1)], eyes: PALETTES.eyes }],
  ])('refuses %s', (_what, input) => {
    expect(() => parsePalettes(input)).toThrow(/palettes\.json/)
  })
})
