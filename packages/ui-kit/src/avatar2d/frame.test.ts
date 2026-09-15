import { describe, expect, it } from 'vitest'
import { headCropGeometry } from './frame.js'

describe('headCropGeometry', () => {
  it('at outputSize 208 (native crop size), the crop box is the native frame shifted to (-88, -40)', () => {
    expect(headCropGeometry(208)).toEqual({ left: -88, top: -40, width: 384, height: 448 })
  })

  it('scales linearly with outputSize', () => {
    expect(headCropGeometry(52)).toEqual({ left: -22, top: -10, width: 96, height: 112 })
    expect(headCropGeometry(104)).toEqual({ left: -44, top: -20, width: 192, height: 224 })
  })

  it('at outputSize 100, gives the percentage-of-container numbers Chibi uses with no explicit size', () => {
    expect(headCropGeometry(100)).toEqual({
      left: -42.30769230769231,
      top: -19.23076923076923,
      width: 184.6153846153846,
      height: 215.3846153846154,
    })
  })

  // 96 (the playground's item-grid tile size) does not divide 208 (= 16 × 13) into a binary float that
  // round-trips: naively computing `outputSize / 208` as its own ratio first prints `left: -40.61538461538462`
  // where multiplying by the integer crop numbers before dividing once prints the shorter
  // `-40.61538461538461`. 208 no longer has the 160 crop's nice powers-of-two factors, so this no longer lands
  // on a clean one-decimal number the way `-67.2` used to — the guarantee this test protects is precision
  // order, not a tidy result.
  it('at outputSize 96, the multiply-first order avoids the extra floating-point noise the naive order adds', () => {
    expect(headCropGeometry(96)).toEqual({
      left: -40.61538461538461,
      top: -18.46153846153846,
      width: 177.23076923076923,
      height: 206.76923076923077,
    })
  })
})
