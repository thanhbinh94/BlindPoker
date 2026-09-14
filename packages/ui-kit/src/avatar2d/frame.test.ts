import { describe, expect, it } from 'vitest'
import { headCropGeometry } from './frame.js'

describe('headCropGeometry', () => {
  it('at outputSize 160 (native crop size), the crop box is the native frame shifted to (-112, -48)', () => {
    expect(headCropGeometry(160)).toEqual({ left: -112, top: -48, width: 384, height: 448 })
  })

  it('scales linearly with outputSize', () => {
    expect(headCropGeometry(40)).toEqual({ left: -28, top: -12, width: 96, height: 112 })
    expect(headCropGeometry(80)).toEqual({ left: -56, top: -24, width: 192, height: 224 })
  })

  it('at outputSize 100, gives the percentage-of-container numbers Chibi uses with no explicit size', () => {
    expect(headCropGeometry(100)).toEqual({ left: -70, top: -30, width: 240, height: 280 })
  })
})
