import { describe, expect, it } from 'vitest'
import { hexToHsl, meanLightness, ratio, recolour, shade } from './recolour.mjs'

const px = (...rgba: number[][]) => new Uint8ClampedArray(rgba.flat())

describe('hexToHsl', () => {
  it('reads pure red and a grey', () => {
    expect(hexToHsl('#ff0000')).toEqual([0, 1, 0.5])
    const [, s, l] = hexToHsl('#808080')
    expect(s).toBe(0)
    expect(l).toBeCloseTo(0.502, 2)
  })
})

describe('meanLightness', () => {
  it('weights by the mask and ignores unmasked pixels', () => {
    const pixels = px([0, 0, 0, 255], [255, 255, 255, 255], [255, 255, 255, 255])
    expect(meanLightness(pixels, [255, 255, 0])).toBeCloseTo(0.5, 5)
    expect(meanLightness(pixels, [0, 0, 0])).toBe(0)
  })
})

describe('recolour', () => {
  it('leaves unmasked pixels and every alpha untouched', () => {
    const pixels = px([10, 20, 30, 200], [40, 50, 60, 90])
    recolour(pixels, [0, 255], '#00ff00', 0.2)
    expect([...pixels.slice(0, 4)]).toEqual([10, 20, 30, 200])
    expect(pixels[7]).toBe(90)
  })

  it('takes the hue of the colour and moves the mean lightness onto it', () => {
    // two greys around l = 0.3 and 0.5, mean 0.4; target red, l 0.5 → both shift by +0.1
    const pixels = px([77, 77, 77, 255], [128, 128, 128, 255])
    const mask = [255, 255]
    recolour(pixels, mask, '#ff0000', meanLightness(pixels, mask))
    expect(pixels[0]).toBeGreaterThan(pixels[1]! + 50) // red dominates
    expect(pixels[1]).toBe(pixels[2]) // g == b for pure red hue
    expect(meanLightness(pixels, mask)).toBeCloseTo(0.5, 1)
  })

  it('blends by the mask at a soft edge', () => {
    const full = px([100, 100, 100, 255])
    const half = px([100, 100, 100, 255])
    recolour(full, [255], '#0000ff', 0.39)
    recolour(half, [128], '#0000ff', 0.39)
    expect(half[2]).toBeGreaterThan(100)
    expect(half[2]).toBeLessThan(full[2]!)
  })
})

describe('shade', () => {
  // The skin's line art under a skin colour (2026-10-05): darkened by the colour's lightness over the skin's own
  // meanL, its own hue kept, and never lightened.
  const OUTLINE = [131, 46, 19, 243] // the v4 body's red-brown outline, #832e13

  it('darkens by the colour lightness over meanL, keeping the hue, and leaves alpha and unmasked pixels alone', () => {
    const pixels = px(OUTLINE, [40, 50, 60, 90])
    // #643e2b has HSL l = 0.2804; over a cream meanL of 0.8819 that is k = 0.318.
    shade(pixels, [255, 0], '#643e2b', 0.8819)
    expect([...pixels.slice(0, 4)]).toEqual([42, 15, 6, 243])
    expect([...pixels.slice(4)]).toEqual([40, 50, 60, 90])
  })

  it('never lightens: a colour as light as the skin or lighter leaves the line as drawn', () => {
    for (const colour of ['#fcf0e9', '#f9e6da', '#ffffff']) {
      const pixels = px(OUTLINE)
      shade(pixels, [255], colour, 0.8819)
      expect([...pixels], colour).toEqual(OUTLINE)
    }
  })

  it('blends by the mask at a soft edge', () => {
    const full = px(OUTLINE)
    const half = px(OUTLINE)
    shade(full, [255], '#643e2b', 0.8819)
    shade(half, [128], '#643e2b', 0.8819)
    expect(half[0]).toBeLessThan(131)
    expect(half[0]).toBeGreaterThan(full[0]!)
  })

  it('does nothing against a meanL of 0 rather than divide by it', () => {
    const pixels = px(OUTLINE)
    shade(pixels, [255], '#643e2b', 0)
    expect([...pixels]).toEqual(OUTLINE)
  })
})

describe('ratio', () => {
  // The skin a hair or outfit picture redrew (2026-10-05): the colour's hue and saturation, and the pixel's own lightness
  // scaled by the colour's over the skin's `meanL` — so a pixel exactly as light as `meanL` becomes the colour, and its
  // shading keeps its proportion on any tone.
  const COLOUR = '#643e2b' // (100, 62, 43): HSL l = 0.2804
  const near = (got: Uint8ClampedArray, want: number[], label: string) => {
    for (const [c, value] of want.entries()) expect(Math.abs(got[c]! - value), `${label} channel ${c}: ${[...got]} vs ${want}`).toBeLessThanOrEqual(2)
  }

  it('paints a pixel as light as meanL exactly the colour, whatever its own hue, and leaves alpha alone', () => {
    // A grey and a warm pixel, both HSL l = 0.4 (102 + 102, 140 + 64 over 510).
    const pixels = px([102, 102, 102, 255], [140, 90, 64, 200])
    ratio(pixels, [255, 255], COLOUR, 0.4)
    near(pixels.slice(0, 3), [100, 62, 43], 'grey')
    near(pixels.slice(4, 7), [100, 62, 43], 'warm')
    expect([pixels[3], pixels[7]]).toEqual([255, 200])
  })

  it('paints a pixel at half meanL the colour’s hue at half its lightness', () => {
    const pixels = px([51, 51, 51, 255]) // l = 0.2
    ratio(pixels, [255], COLOUR, 0.4)
    // #643e2b at l 0.1402: under 0.5, so halving every channel halves the lightness and keeps the hue and saturation.
    near(pixels, [50, 31, 21.5], 'half')
    const [hue, sat] = hexToHsl(`#${[...pixels.slice(0, 3)].map((v) => v.toString(16).padStart(2, '0')).join('')}`)
    const [hueC, satC] = hexToHsl(COLOUR)
    expect(Math.abs(hue - hueC)).toBeLessThan(3)
    expect(Math.abs(sat - satC)).toBeLessThan(0.05)
  })

  it('blends by the mask: alpha 128 lands halfway', () => {
    const pixels = px([102, 102, 102, 255])
    ratio(pixels, [128], COLOUR, 0.4)
    near(pixels, [101, 82, 72.5], 'halfway')
  })

  it('leaves unmasked pixels alone, and does nothing against a meanL of 0', () => {
    const pixels = px([102, 102, 102, 255], [40, 50, 60, 90])
    ratio(pixels, [255, 0], COLOUR, 0)
    expect([...pixels]).toEqual([102, 102, 102, 255, 40, 50, 60, 90])
    ratio(pixels, [0, 0], COLOUR, 0.4)
    expect([...pixels]).toEqual([102, 102, 102, 255, 40, 50, 60, 90])
  })

  it('keeps shaded skin a shade of a deep tone, where recolour’s shift clamps it to black', () => {
    // Skin in a hair's shadow, l = 0.5, on a cream of meanL 0.88: recolour shifts it by 0.28 − 0.88 to below 0.
    const additive = px([150, 105, 105, 255])
    recolour(additive, [255], COLOUR, 0.88)
    expect([...additive.slice(0, 3)]).toEqual([0, 0, 0])
    const scaled = px([150, 105, 105, 255])
    ratio(scaled, [255], COLOUR, 0.88)
    // l × 0.2804 / 0.88 = 0.159: the colour scaled by 0.159 / 0.2804.
    near(scaled, [57, 35, 24], 'scaled')
  })
})
