import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LANDSCAPE_PHONE, SHORT_STAGE_PX, stageTier, useRoomFrame, useStageTier } from './frame.js'

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

// BP-28: the landscape frame's short tier, keyed on the stage the room measures, not on the viewport.
describe('stageTier', () => {
  it('is short under 300 px of stage in the landscape frame: 855 × 319 (255 px) and 915 × 355 (291 px), not 915 × 365 (301 px)', () => {
    expect(SHORT_STAGE_PX).toBe(300)
    expect(stageTier('landscape', 255)).toBe('short')
    expect(stageTier('landscape', 291)).toBe('short')
    expect(stageTier('landscape', 299.5)).toBe('short')
    expect(stageTier('landscape', 300)).toBe('normal')
    expect(stageTier('landscape', 301)).toBe('normal')
    expect(stageTier('landscape', 348)).toBe('normal')
  })

  it('is normal for a stage not laid out yet, and always in the desktop frame', () => {
    expect(stageTier('landscape', 0)).toBe('normal')
    expect(stageTier('desktop', 255)).toBe('normal')
  })
})

describe('useStageTier', () => {
  const originalObserver = globalThis.ResizeObserver
  afterEach(() => {
    globalThis.ResizeObserver = originalObserver
  })

  /** A stage whose height the test sets, and a `ResizeObserver` the test fires. */
  const stage = (height: number) => {
    const el = document.createElement('main')
    let h = height
    el.getBoundingClientRect = () => ({ height: h, width: 831, top: 0, left: 0, right: 831, bottom: h, x: 0, y: 0, toJSON: () => ({}) })
    const callbacks: (() => void)[] = []
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        callbacks.push(cb)
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver
    return {
      ref: { current: el },
      resize: (next: number) => {
        h = next
        act(() => callbacks.forEach((cb) => cb()))
      },
    }
  }

  it('measures the stage before the first paint and follows it when it is resized', () => {
    const { ref, resize } = stage(255)
    const { result } = renderHook(() => useStageTier(ref, 'landscape'))
    expect(result.current).toBe('short')
    // full screen gives the phone its 90 px back
    resize(345)
    expect(result.current).toBe('normal')
    resize(291)
    expect(result.current).toBe('short')
  })

  it('stays normal in the desktop frame, and until the stage is mounted', () => {
    const { ref } = stage(255)
    expect(renderHook(() => useStageTier(ref, 'desktop')).result.current).toBe('normal')
    const late = renderHook(({ mounted }) => useStageTier(ref, 'landscape', mounted), { initialProps: { mounted: false } })
    expect(late.result.current).toBe('normal')
    late.rerender({ mounted: true })
    expect(late.result.current).toBe('short')
  })

  it('measures once where there is no ResizeObserver', () => {
    const { ref } = stage(255)
    // @ts-expect-error — jsdom's state: no ResizeObserver at all
    globalThis.ResizeObserver = undefined
    expect(renderHook(() => useStageTier(ref, 'landscape')).result.current).toBe('short')
  })
})
