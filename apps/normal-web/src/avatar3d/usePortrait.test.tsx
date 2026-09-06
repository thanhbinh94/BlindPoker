import { render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AvatarConfigDto } from '../api.js'
import { fakeRenderer } from './fake-renderer.js'
import { hashConfig } from './hash.js'
import { resetPortraitMemory } from './portrait-cache.js'
import { setPortraitRendererForTests, usePortrait } from './usePortrait.js'

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

    expect(result.current).toEqual({ url: null, status: 'idle' })
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
    expect(second.result.current).toEqual({ url: first.result.current.url, status: 'ready' })
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
})
