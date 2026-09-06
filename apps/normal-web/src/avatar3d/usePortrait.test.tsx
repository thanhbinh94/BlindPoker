import { render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AvatarConfigDto } from '../api.js'
import { abortError } from './abort.js'
import { fakeRenderer } from './fake-renderer.js'
import { CONTEXT_LOST } from './gl-context.js'
import { hashConfig } from './hash.js'
import { cachedPortrait, resetPortraitMemory } from './portrait-cache.js'
import {
  setPortraitLoaderForTests,
  setPortraitRendererForTests,
  usePortrait,
  type PortraitRenderer,
} from './usePortrait.js'

const CONFIG: AvatarConfigDto = {
  v: 2,
  body: 'male',
  skin: '#e0ac81',
  eyes: '#3b2415',
  hairColor: '#2b2b2b',
  hair: 'hair_short',
  top: 'top_tee',
  bottom: 'bottom_jeans',
  shoes: 'shoes_sneakers',
}

/** A component that says what the hook told it, so two of them can be mounted side by side. */
function Probe({ config, id }: { config: AvatarConfigDto | null; id: string }) {
  const { url, status } = usePortrait(config)
  return <span data-testid={id} data-status={status} data-url={url ?? ''} />
}

describe('usePortrait', () => {
  beforeEach(() => {
    resetPortraitMemory()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setPortraitRendererForTests(fakeRenderer({ supported: false }))
  })

  it('is idle for no configuration, and never asks anything to draw one', async () => {
    const renderer = fakeRenderer()
    setPortraitRendererForTests(renderer)

    const { result } = renderHook(() => usePortrait(null))

    expect(result.current).toEqual({ url: null, status: 'idle', hash: null })
    await waitFor(() => expect(renderer.rendered).toEqual([]))
  })

  it('goes loading, then ready with a URL for the picture', async () => {
    const renderer = fakeRenderer({ hold: true })
    setPortraitRendererForTests(renderer)

    const { result } = renderHook(() => usePortrait(CONFIG))

    await waitFor(() => expect(result.current.status).toBe('loading'))
    expect(result.current.url).toBeNull()

    renderer.release()

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.url).toContain('blob:')
    expect(renderer.rendered).toEqual([hashConfig(CONFIG)])
  })

  it('ends unsupported, and warns exactly once, when the browser cannot draw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    setPortraitRendererForTests(fakeRenderer({ supported: false }))

    render(
      <>
        <Probe config={CONFIG} id="a" />
        <Probe config={{ ...CONFIG, hair: 'hair_bun' }} id="b" />
      </>,
    )

    await waitFor(() => expect(screen.getByTestId('a')).toHaveAttribute('data-status', 'unsupported'))
    await waitFor(() => expect(screen.getByTestId('b')).toHaveAttribute('data-status', 'unsupported'))
    // Nine seat plates on a machine with no WebGL would otherwise print nine identical lines, per hand.
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('ends unsupported when the render itself fails, rather than throwing into React', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    setPortraitRendererForTests(fakeRenderer({ fails: true }))

    const { result } = renderHook(() => usePortrait(CONFIG))

    await waitFor(() => expect(result.current.status).toBe('unsupported'))
    expect(result.current.url).toBeNull()
  })

  it('draws one configuration once, however many times it is asked for', async () => {
    const renderer = fakeRenderer()
    setPortraitRendererForTests(renderer)

    const first = renderHook(() => usePortrait(CONFIG))
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    first.unmount()

    const second = renderHook(() => usePortrait({ ...CONFIG }))

    // The memory cache answers during render, so the second mount never even passes through `loading`.
    expect(second.result.current).toEqual({ url: first.result.current.url, status: 'ready', hash: hashConfig(CONFIG) })
    expect(renderer.rendered).toEqual([hashConfig(CONFIG)])
  })

  it('draws once for two components mounted at the same instant on the same hash', async () => {
    const renderer = fakeRenderer({ hold: true })
    setPortraitRendererForTests(renderer)

    render(
      <>
        <Probe config={CONFIG} id="a" />
        <Probe config={{ ...CONFIG }} id="b" />
      </>,
    )
    await waitFor(() => expect(screen.getByTestId('a')).toHaveAttribute('data-status', 'loading'))
    renderer.release()

    await waitFor(() => expect(screen.getByTestId('a')).toHaveAttribute('data-status', 'ready'))
    await waitFor(() => expect(screen.getByTestId('b')).toHaveAttribute('data-status', 'ready'))

    // One render, and both components hold the same URL — which is the point: nine seats in the same
    // outfit are one picture, not nine.
    expect(renderer.rendered).toEqual([hashConfig(CONFIG)])
    expect(screen.getByTestId('a').getAttribute('data-url')).toBe(screen.getByTestId('b').getAttribute('data-url'))
  })

  it('draws again when the configuration changes, and not when it merely re-renders', async () => {
    const renderer = fakeRenderer()
    setPortraitRendererForTests(renderer)

    const { result, rerender } = renderHook(({ config }: { config: AvatarConfigDto }) => usePortrait(config), {
      initialProps: { config: CONFIG },
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))

    // A fresh object with the same fields — which is what every caller passes on every render.
    rerender({ config: { ...CONFIG } })
    expect(renderer.rendered).toHaveLength(1)

    rerender({ config: { ...CONFIG, top: 'clothing_aodai' } })
    await waitFor(() => expect(renderer.rendered).toHaveLength(2))
    expect(renderer.rendered[1]).toBe(hashConfig({ ...CONFIG, top: 'clothing_aodai' }))
  })

  /**
   * A lost GPU context, from the hook's side.
   *
   * The renderer's own guard is in `gl-context.ts`; what matters here is the consequence. A lost
   * context draws a blank frame that `toBlob` turns into a perfectly valid transparent image, and the
   * one thing that must never happen is that image being cached — in memory or in IndexedDB — under
   * this configuration's hash, where it would be served in preference to rendering for as long as the
   * player keeps wearing these clothes.
   */
  it('caches nothing when the render fails because the context was lost', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const lost = { yes: false }
    setPortraitRendererForTests({
      supported: () => true,
      render: () => (lost.yes ? Promise.reject(new Error(CONTEXT_LOST)) : Promise.resolve(new Blob(['ok']))),
    })

    lost.yes = true
    const { result, unmount } = renderHook(() => usePortrait(CONFIG))

    await waitFor(() => expect(result.current.status).toBe('unsupported'))
    // No blank picture kept, so the next attempt is a real one rather than a cached emptiness.
    expect(cachedPortrait(hashConfig(CONFIG))).toBeNull()
    unmount()

    // And when the context comes back, the same configuration draws.
    lost.yes = false
    setPortraitRendererForTests({
      supported: () => true,
      render: () => Promise.resolve(new Blob(['ok'])),
    })
    const again = renderHook(() => usePortrait(CONFIG))
    await waitFor(() => expect(again.result.current.status).toBe('ready'))
  })

  /**
   * The failure the controller found in a real browser: a CSP that refuses the chunk's WebAssembly made
   * the module log its fallback warning *and* leak an `Uncaught (in promise)` beside it. The fallback
   * was right; the console said the app was broken.
   */
  it('ends unsupported when the renderer module will not load, with nothing left unhandled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const escaped: unknown[] = []
    const catchAll = (reason: unknown): void => {
      escaped.push(reason)
    }
    process.on('unhandledRejection', catchAll)

    try {
      setPortraitLoaderForTests(() => Promise.reject(new Error('EvalError: refused to compile WebAssembly')))

      const { result } = renderHook(() => usePortrait(CONFIG))

      await waitFor(() => expect(result.current.status).toBe('unsupported'))
      expect(warn).toHaveBeenCalledTimes(1)
      // Node reports an unhandled rejection at the end of the turn it happened in.
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(escaped).toEqual([])
    } finally {
      process.off('unhandledRejection', catchAll)
      setPortraitLoaderForTests(null)
    }
  })
})

/**
 * Cancellation.
 *
 * Every wardrobe tile is a portrait of the *whole* current configuration with one item swapped in, so
 * a single click on a hair colour changes the hash of all forty tiles at once. The queue is
 * sequential; without a way to drop work, eight clicks is three hundred and twenty assemblies, each of
 * them geometry clones and skeleton copies, standing between the player and the tile they are looking
 * at now.
 */
describe('usePortrait cancellation', () => {
  beforeEach(() => {
    resetPortraitMemory()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setPortraitRendererForTests(fakeRenderer({ supported: false }))
  })

  it('drops the queued renders of components that have gone away', async () => {
    const renderer = fakeRenderer({ hold: true })
    setPortraitRendererForTests(renderer)

    // Forty tiles, forty distinct configurations, all mounted in the same instant.
    const configs = Array.from({ length: 40 }, (_, at) => ({ ...CONFIG, hat: `hat_${at}` }))
    const views = configs.map((config, at) => render(<Probe config={config} id={`tile-${at}`} />))

    // The first one has the canvas and is being held; the other thirty-nine are queued behind it.
    await waitFor(() => expect(renderer.rendered).toEqual([hashConfig(configs[0]!)]))

    for (const view of views.slice(1)) view.unmount()
    renderer.release()

    await waitFor(() => expect(screen.getByTestId('tile-0')).toHaveAttribute('data-status', 'ready'))
    // Let the whole queue drain — including the thirty-nine jobs that are now nobody's.
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(renderer.rendered).toEqual([hashConfig(configs[0]!)])
  })

  it('keeps drawing a picture another component is still waiting for', async () => {
    const renderer = fakeRenderer({ hold: true })
    setPortraitRendererForTests(renderer)

    // Two seats in the same outfit: one render, two holders. One of them leaving cancels nothing.
    const first = render(<Probe config={CONFIG} id="a" />)
    render(<Probe config={{ ...CONFIG }} id="b" />)
    await waitFor(() => expect(screen.getByTestId('b')).toHaveAttribute('data-status', 'loading'))

    first.unmount()
    renderer.release()

    await waitFor(() => expect(screen.getByTestId('b')).toHaveAttribute('data-status', 'ready'))
    expect(renderer.rendered).toEqual([hashConfig(CONFIG)])
  })

  it('drops a configuration the player has already moved on from', async () => {
    const renderer = fakeRenderer({ hold: true })
    setPortraitRendererForTests(renderer)

    const { rerender, result } = renderHook(({ config }: { config: AvatarConfigDto }) => usePortrait(config), {
      initialProps: { config: CONFIG },
    })
    await waitFor(() => expect(result.current.status).toBe('loading'))

    // Two more clicks while the first render is still held at the head of the queue.
    rerender({ config: { ...CONFIG, hairColor: '#d9a441' } })
    rerender({ config: { ...CONFIG, hairColor: '#452b1e' } })
    renderer.release()

    await waitFor(() => expect(result.current.status).toBe('ready'))
    await new Promise((resolve) => setTimeout(resolve, 10))

    // The first is already at the canvas when the change arrives, so it finishes; the middle one is
    // still queued and evaporates. The last one is the only other picture drawn.
    expect(renderer.rendered).toEqual([hashConfig(CONFIG), hashConfig({ ...CONFIG, hairColor: '#452b1e' })])
    expect(result.current.hash).toBe(hashConfig({ ...CONFIG, hairColor: '#452b1e' }))
  })

  it('treats a cancelled render as nothing-to-show rather than as a failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const cancelling: PortraitRenderer = {
      supported: () => true,
      render: () => Promise.reject(abortError()),
    }
    setPortraitRendererForTests(cancelling)

    const { result } = renderHook(() => usePortrait(CONFIG))

    await waitFor(() => expect(result.current.status).toBe('idle'))
    // `unsupported` is permanent and says "this browser cannot draw faces"; a cancellation says only
    // that nobody wanted this one. It must not latch, and it must not warn.
    expect(result.current.status).not.toBe('unsupported')
    expect(warn).not.toHaveBeenCalled()
  })
})
