import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tintKey, useTintedLayer } from './tinted.js'
import type { LayerRef, TintRef } from './types.js'

const SKIN_TINT: TintRef = { mask: 'body_f_L30_skinmask', colour: '#b3261e', meanL: 0.4 }

describe('tintKey', () => {
  it('differs when the colour differs', () => {
    const a = tintKey('body_f_L30', 1, [SKIN_TINT])
    const b = tintKey('body_f_L30', 1, [{ ...SKIN_TINT, colour: '#2f7fd6' }])
    expect(a).not.toBe(b)
  })

  it('differs when the density differs', () => {
    const a = tintKey('body_f_L30', 1, [SKIN_TINT])
    const b = tintKey('body_f_L30', 2, [SKIN_TINT])
    expect(a).not.toBe(b)
  })

  it('differs when the meanL differs: one outfit file shaded against either body’s skin (2026-10-05)', () => {
    const a = tintKey('item_outfit_casual01_L40', 2, [{ mask: 'item_outfit_casual01_L40_skinlinemask', colour: '#643e2b', meanL: 0.8881, mode: 'shade' }])
    const b = tintKey('item_outfit_casual01_L40', 2, [{ mask: 'item_outfit_casual01_L40_skinlinemask', colour: '#643e2b', meanL: 0.8819, mode: 'shade' }])
    expect(a).not.toBe(b)
  })

  it('is stable for the same file, density and tints', () => {
    expect(tintKey('body_f_L30', 1, [SKIN_TINT])).toBe(tintKey('body_f_L30', 1, [{ ...SKIN_TINT }]))
  })
})

describe('useTintedLayer', () => {
  it('returns null and never throws when there is no 2D canvas context (jsdom)', async () => {
    const layer: LayerRef = { order: 30, file: 'body_f_L30', tints: [SKIN_TINT] }
    const { result } = renderHook(() => useTintedLayer('/avatar/', layer))

    expect(result.current).toBeNull()
    // Give the effect's async job a turn to resolve; it must still land on null, not throw.
    await waitFor(() => expect(result.current).toBeNull())
  })

  it('returns null for a layer with no tints', () => {
    const layer: LayerRef = { order: 30, file: 'body_f_L30' }
    const { result } = renderHook(() => useTintedLayer('/avatar/', layer))
    expect(result.current).toBeNull()
  })
})

// The tests below fake the whole canvas/Image pipeline jsdom does not implement, so `renderTintedLayer` can
// actually resolve to a (fake) blob URL instead of bailing out at `getContext('2d') === null` the way every test
// above this line does. That lets these tests exercise the two behaviours spec §5.2 spells out beyond "no
// context, no throw": keeping the previous tint while a same-file colour change renders, and the LRU cache's
// eviction of only *settled* entries.

interface PipelineStubs {
  originalDecode: unknown
  originalCreateObjectURL: unknown
  originalRevokeObjectURL: unknown
}

/** jsdom implements `HTMLCanvasElement.prototype.getContext`/`toBlob` as stubs that throw "not implemented", so
 * `vi.spyOn` can wrap and later restore them; it has no `HTMLImageElement.prototype.decode` or
 * `URL.createObjectURL`/`revokeObjectURL` at all (not even a throwing stub), so those three are plain
 * assignments the caller must restore itself via the returned originals. */
function stubCanvasPipeline(): PipelineStubs {
  let urlCounter = 0

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(2 * 2 * 4).fill(255), width: 2, height: 2 })),
        putImageData: vi.fn(),
        clearRect: vi.fn(),
      }) as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback: BlobCallback) {
    callback(new Blob(['x']))
  })
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(2)
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(2)

  const originalDecode = HTMLImageElement.prototype.decode
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined)
  const originalCreateObjectURL = URL.createObjectURL
  URL.createObjectURL = vi.fn(() => `blob:mock-${urlCounter++}`)
  const originalRevokeObjectURL = URL.revokeObjectURL
  URL.revokeObjectURL = vi.fn()

  return { originalDecode, originalCreateObjectURL, originalRevokeObjectURL }
}

function restoreCanvasPipeline(stubs: PipelineStubs): void {
  vi.restoreAllMocks()
  HTMLImageElement.prototype.decode = stubs.originalDecode as typeof HTMLImageElement.prototype.decode
  URL.createObjectURL = stubs.originalCreateObjectURL as typeof URL.createObjectURL
  URL.revokeObjectURL = stubs.originalRevokeObjectURL as typeof URL.revokeObjectURL
}

describe('useTintedLayer — with a faked canvas pipeline', () => {
  let stubs: PipelineStubs

  beforeEach(() => {
    stubs = stubCanvasPipeline()
  })

  afterEach(() => {
    restoreCanvasPipeline(stubs)
  })

  // Distinct file/mask namespace from every other test in this file (`body_f_L30` + `#b3261e` is already used,
  // unmocked, by the `describe('useTintedLayer', ...)` block above) — `cache` is a module-level singleton shared
  // by the whole test file, so reusing a key that block already resolved to `null` would silently short-circuit
  // these tests through that stale cache entry instead of exercising the mocked canvas pipeline.
  const RED: TintRef = { mask: 'tint_stub_a_hairmask', colour: '#123456', meanL: 0.4 }
  const BLUE: TintRef = { mask: 'tint_stub_a_hairmask', colour: '#654321', meanL: 0.4 }

  it('keeps showing the previous URL while a colour change on the same file renders, then swaps once ready', async () => {
    const layer: LayerRef = { order: 30, file: 'tint_stub_a', tints: [RED] }
    const { result, rerender } = renderHook(({ layer }) => useTintedLayer('/avatar/', layer), { initialProps: { layer } })

    await waitFor(() => expect(result.current).not.toBeNull())
    const firstUrl = result.current

    rerender({ layer: { ...layer, tints: [BLUE] } })
    // Still the first render's URL immediately after the colour change — no flash back to the base colour.
    expect(result.current).toBe(firstUrl)

    await waitFor(() => expect(result.current).not.toBe(firstUrl))
    expect(result.current).not.toBeNull()
  })

  it('returns null immediately when the layer file changes, even though it still has tints', async () => {
    const layerA: LayerRef = { order: 30, file: 'tint_stub_b1', tints: [RED] }
    const { result, rerender } = renderHook(({ layer }) => useTintedLayer('/avatar/', layer), { initialProps: { layer: layerA } })
    await waitFor(() => expect(result.current).not.toBeNull())

    const layerB: LayerRef = { order: 60, file: 'tint_stub_b2', tints: [RED] }
    rerender({ layer: layerB })
    expect(result.current).toBeNull()

    // Let layerB's own render settle before the test ends, so its `setUrl` lands inside this test's `act()`
    // scope rather than firing, unobserved, sometime during the next test.
    await waitFor(() => expect(result.current).not.toBeNull())
  })

  it('shades a `shade` tint’s mask instead of recolouring it (the skin’s line art, 2026-10-05)', async () => {
    // Every faked layer and mask pixel is opaque white; record what each render hands to `putImageData`.
    const written: Uint8ClampedArray[] = []
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(
      () =>
        ({
          drawImage: vi.fn(),
          getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(2 * 2 * 4).fill(255), width: 2, height: 2 })),
          putImageData: vi.fn((data: ImageData) => written.push(data.data)),
          clearRect: vi.fn(),
        }) as unknown as CanvasRenderingContext2D,
    )
    const shadeTint: TintRef = { mask: 'tint_stub_shade_skinlinemask', colour: '#643e2b', meanL: 0.8819, mode: 'shade' }
    const { result } = renderHook(() => useTintedLayer('/avatar/', { order: 30, file: 'tint_stub_shade', tints: [shadeTint] }))
    await waitFor(() => expect(result.current).not.toBeNull())
    // White × (0.2804 / 0.8819): darkened grey with white's own (absent) hue — `recolour` would have given it #643e2b's.
    expect([...written[0]!.slice(0, 4)]).toEqual([81, 81, 81, 255])
  })

  it('returns null immediately when a layer loses its tints', async () => {
    const tinted: LayerRef = { order: 30, file: 'tint_stub_c', tints: [RED] }
    const { result, rerender } = renderHook(({ layer }) => useTintedLayer('/avatar/', layer), { initialProps: { layer: tinted } })
    await waitFor(() => expect(result.current).not.toBeNull())

    rerender({ layer: { order: 30, file: 'tint_stub_c' } })
    expect(result.current).toBeNull()
  })

  it('retries a render whose mask failed to load after a 2D context was available, instead of caching the failure', async () => {
    // Distinct file from every other test in this describe block, so this test's cache entry cannot
    // collide with (or be short-circuited by) one another test already settled.
    const layer: LayerRef = { order: 30, file: 'tint_stub_retry', tints: [RED] }
    const decodeMock = HTMLImageElement.prototype.decode as unknown as ReturnType<typeof vi.fn>
    // First `loadImage` call (the layer file) succeeds; the second (the mask) fails once — a transient
    // error with a 2D context already in hand, the case that must not be cached as if the environment
    // simply has no canvas.
    decodeMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('mask decode failed'))

    const first = renderHook(() => useTintedLayer('/avatar/', layer))
    await waitFor(() => expect(decodeMock).toHaveBeenCalledTimes(2))
    // Let the rejection propagate through `renderTintedLayer`'s catch and `cachedRender`'s `.then`,
    // which drops the (uncacheable) failed entry from the module cache, before mounting again.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(first.result.current).toBeNull()

    const second = renderHook(() => useTintedLayer('/avatar/', layer))
    await waitFor(() => expect(second.result.current).not.toBeNull())
    // A cached failure would have short-circuited this second mount straight to `null` with no further
    // `decode` calls; retrying means the whole pipeline — layer image and mask alike — runs again.
    expect(decodeMock).toHaveBeenCalledTimes(4)
  })
})

// A dedicated module instance (`vi.resetModules()` + a fresh dynamic `import`), rather than the file's shared
// top-level import: `cache` is module-private state, and every other test in this file already leaves entries in
// the one shared instance. Reusing it here would mean this test's 97 distinct keys land on top of however many
// real, revocable URLs the earlier tests happened to leave behind — pending on execution order, and multiplying
// the number of evictions this test would need to account for. Its own private `cache`, empty at the point this
// test's first mount runs, is what makes "the 97th key" a meaningful, order-independent boundary to assert on.
describe('useTintedLayer / cachedRender — LRU eviction, in an isolated module instance', () => {
  let stubs: PipelineStubs

  beforeEach(() => {
    vi.resetModules()
    stubs = stubCanvasPipeline()
  })

  afterEach(() => {
    restoreCanvasPipeline(stubs)
  })

  it('evicts the oldest settled cache entry once a 97th distinct key is inserted, and never evicts a still-pending one', async () => {
    const fresh = await import('./tinted.js')

    // Entry #1's image load is held open forever in this test, so it never settles — eviction must skip it.
    let holdFirstDecode = true
    let releaseFirst: (() => void) | undefined
    ;(HTMLImageElement.prototype.decode as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      if (holdFirstDecode) {
        holdFirstDecode = false
        return new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
      }
      return Promise.resolve()
    })

    const layerFor = (i: number): LayerRef => ({
      order: 30,
      file: 'tint_stub_evict',
      tints: [{ mask: 'tint_stub_evict_hairmask', colour: `#${i.toString(16).padStart(6, '0')}`, meanL: 0.4 }],
    })

    const first = renderHook(() => fresh.useTintedLayer('/avatar/', layerFor(1)))
    expect(first.result.current).toBeNull() // still loading, forever, in this test

    // Entries #2..#97 (96 distinct keys): mount and await each in turn, so every one of them is fully settled
    // before the next is inserted — otherwise nothing would be evictable yet when #97 lands.
    const settled: ReturnType<typeof renderHook<string | null, unknown>>[] = []
    for (let i = 2; i <= 97; i++) {
      const hook = renderHook(() => fresh.useTintedLayer('/avatar/', layerFor(i)))
      await waitFor(() => expect(hook.result.current).not.toBeNull())
      settled.push(hook)
    }

    // Cache holds #1 (pending) + #2..#97 (95 settled + #97 itself) = 97 keys, one over the 96 cap. #1 must have
    // been skipped (still pending); #2, the oldest *settled* entry, must be the one evicted and revoked.
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(settled[0]!.result.current)

    // #1 is still cached, not evicted: re-mounting the same key reuses the still-pending job instead of starting
    // a fresh render, so no additional `decode` call is made for it.
    const decodeCallsBefore = (HTMLImageElement.prototype.decode as unknown as ReturnType<typeof vi.fn>).mock.calls.length
    const firstAgain = renderHook(() => fresh.useTintedLayer('/avatar/', layerFor(1)))
    expect(firstAgain.result.current).toBeNull()
    expect((HTMLImageElement.prototype.decode as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(decodeCallsBefore)

    // Let entry #1 settle before the test ends, so its (now two) consumers' `setUrl` calls land inside this
    // test's `act()` scope instead of firing, unobserved, sometime after it.
    releaseFirst?.()
    await waitFor(() => expect(first.result.current).not.toBeNull())
    await waitFor(() => expect(firstAgain.result.current).not.toBeNull())
  }, 20000)
})
