import { describe, expect, it } from 'vitest'
import { hexToHsl, meanLightness, recolour } from './recolour.mjs'

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
