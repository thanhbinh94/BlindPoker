import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LANDSCAPE_PHONE, useRoomFrame } from './frame.js'

const original = window.matchMedia

/** A `matchMedia` that answers `true` for the queries in `matching` and `false` for any other. */
const stubMatchMedia = (matching: readonly string[]): void => {
  window.matchMedia = ((query: string) => ({
    matches: matching.includes(query),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

afterEach(() => {
  window.matchMedia = original
})

describe('useRoomFrame', () => {
  it('asks for a phone on its side: landscape, at most 500 px tall and at least 700 px wide', () => {
    // A narrower short window (a 640 × 360 phone) keeps the stacked layout: the ring needs the width (ruling 8).
    expect(LANDSCAPE_PHONE).toBe('(orientation: landscape) and (max-height: 500px) and (min-width: 700px)')
  })

  it('returns the override when given', () => {
    stubMatchMedia([LANDSCAPE_PHONE])
    expect(renderHook(() => useRoomFrame('desktop')).result.current).toBe('desktop')
    stubMatchMedia([])
    expect(renderHook(() => useRoomFrame('landscape')).result.current).toBe('landscape')
  })

  it('falls back to desktop where matchMedia is missing', () => {
    // @ts-expect-error — jsdom has no matchMedia; this is the state the tests run in
    window.matchMedia = undefined
    expect(renderHook(() => useRoomFrame()).result.current).toBe('desktop')
  })

  it('reports landscape when the media query matches', () => {
    stubMatchMedia([LANDSCAPE_PHONE])
    expect(renderHook(() => useRoomFrame()).result.current).toBe('landscape')
    stubMatchMedia([])
    expect(renderHook(() => useRoomFrame()).result.current).toBe('desktop')
  })
})
