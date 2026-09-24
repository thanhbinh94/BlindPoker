import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { tintKey, useTintedLayer } from './tinted.js'
import type { LayerRef, TintRef } from './types.js'

const HAIR_TINT: TintRef = { mask: 'base_f01_L30_hairmask', colour: '#b3261e', meanL: 0.4 }

describe('tintKey', () => {
  it('differs when the colour differs', () => {
    const a = tintKey('base_f01_L30', 1, [HAIR_TINT])
    const b = tintKey('base_f01_L30', 1, [{ ...HAIR_TINT, colour: '#2f7fd6' }])
    expect(a).not.toBe(b)
  })

  it('differs when the density differs', () => {
    const a = tintKey('base_f01_L30', 1, [HAIR_TINT])
    const b = tintKey('base_f01_L30', 2, [HAIR_TINT])
    expect(a).not.toBe(b)
  })

  it('is stable for the same file, density and tints', () => {
    expect(tintKey('base_f01_L30', 1, [HAIR_TINT])).toBe(tintKey('base_f01_L30', 1, [{ ...HAIR_TINT }]))
  })
})

describe('useTintedLayer', () => {
  it('returns null and never throws when there is no 2D canvas context (jsdom)', async () => {
    const layer: LayerRef = { order: 30, file: 'base_f01_L30', tints: [HAIR_TINT] }
    const { result } = renderHook(() => useTintedLayer('/avatar/', layer))

    expect(result.current).toBeNull()
    // Give the effect's async job a turn to resolve; it must still land on null, not throw.
    await waitFor(() => expect(result.current).toBeNull())
  })

  it('returns null for a layer with no tints', () => {
    const layer: LayerRef = { order: 30, file: 'base_f01_L30' }
    const { result } = renderHook(() => useTintedLayer('/avatar/', layer))
    expect(result.current).toBeNull()
  })
})
