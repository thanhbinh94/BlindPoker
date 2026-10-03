/**
 * The one colour distance the server needs: which free eye colour an old base's iris is nearest to (spec §4.5).
 *
 * The formula is fixed by the plan, not chosen here, and the migration's pinned outcomes were computed with it —
 * so these tests hold the exact constants, not just "something Lab-like".
 */
import { describe, expect, it } from 'vitest'
import { deltaE, labOf } from './colour.js'

describe('labOf', () => {
  it('puts white at L 100 and black at 0, both without colour', () => {
    const [wl, wa, wb] = labOf('#ffffff')
    expect(wl).toBeCloseTo(100, 2)
    expect(wa).toBeCloseTo(0, 1)
    expect(wb).toBeCloseTo(0, 1)
    expect(labOf('#000000')).toEqual([0, 0, 0])
  })

  it('reads pure red where CIE Lab puts it, through the sRGB matrix and the D65 white', () => {
    const [l, a, b] = labOf('#ff0000')
    expect(l).toBeCloseTo(53.24, 1)
    expect(a).toBeCloseTo(80.09, 0)
    expect(b).toBeCloseTo(67.2, 0)
  })

  it('takes the linear branch near black, on both sides of the curve', () => {
    // 1/255 is below 0.04045 (sRGB's linear segment) and its Y is below 216/24389 (Lab's linear segment):
    // L is then 24389/27 · Y, about 0.274.
    expect(labOf('#010101')[0]).toBeCloseTo(0.274, 2)
  })

  it('refuses anything but a lowercase #rrggbb', () => {
    for (const bad of ['#FFFFFF', '#fff', 'red', '', '#gg0000']) expect(() => labOf(bad), bad).toThrow(/#rrggbb/)
  })
})

describe('deltaE', () => {
  it('is zero for one colour and the same both ways round', () => {
    expect(deltaE('#2e6a9b', '#2e6a9b')).toBe(0)
    expect(deltaE('#2e6a9b', '#cc924c')).toBe(deltaE('#cc924c', '#2e6a9b'))
    expect(deltaE('#000000', '#ffffff')).toBeCloseTo(100, 2)
  })

  it('measures f03’s iris nearer amber01 than green01, by the formula the plan fixes (green is pinned anyway, ruling 6)', () => {
    expect(deltaE('#a9a564', '#d08a1c')).toBeCloseTo(39.7, 0)
    expect(deltaE('#a9a564', '#2f9e55')).toBeCloseTo(40.5, 0)
  })
})
