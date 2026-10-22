import { act, render, renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AvatarAssets } from './AvatarAssets.js'
import { Chibi } from './Chibi.js'
import { resetLoadedClips } from './clip.js'
import { defaultChibi } from './defaults.js'
import { hashChibi, layersFor } from './layers.js'
import { useInView } from './lazy.js'
import type { ChibiConfig, WearRef } from './types.js'

const SUBJECT = defaultChibi('ann')
const CONICAL: WearRef = { id: 'head_conical_hat01', order: 80, file: 'item_head_conical_hat01_L80', clipsHair: true }
const HATTED: ChibiConfig = { ...SUBJECT, head: CONICAL }

/** A hand-driven `IntersectionObserver`: every instance is kept, and `fire` tells each one its targets intersect. */
class FakeObserver {
  static instances: FakeObserver[] = []
  readonly targets: Element[] = []
  disconnected = false
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeObserver.instances.push(this)
  }
  observe(target: Element) {
    this.targets.push(target)
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true
  }
  takeRecords() {
    return []
  }
  static fire(isIntersecting = true) {
    for (const o of FakeObserver.instances) {
      if (o.disconnected) continue
      const entries = o.targets.map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry)
      o.callback(entries, o as unknown as IntersectionObserver)
    }
  }
}

/** Counts every `new Image()` — a clip preload or a tint render's image load would each make one. */
let images = 0
class CountingImage {
  crossOrigin: string | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  src = ''
  constructor() {
    images++
  }
}

describe('useInView', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is true at once when the browser has no IntersectionObserver (jsdom)', () => {
    const { result } = renderHook(() => useInView(useRef<HTMLDivElement>(null)))
    expect(result.current).toBe(true)
  })

  it('is true once mounted when there is no element to observe', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    FakeObserver.instances = []
    const { result } = renderHook(() => useInView(useRef<HTMLDivElement>(null)))
    expect(result.current).toBe(true)
    expect(FakeObserver.instances).toHaveLength(0)
  })

  it('observes with a 200 px margin by default; turned off, it observes nothing and is true', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    FakeObserver.instances = []
    const el = document.createElement('div')
    const { result } = renderHook(() => useInView({ current: el }))
    expect(result.current).toBe(false)
    expect(FakeObserver.instances[0]!.options?.rootMargin).toBe('200px')

    const off = renderHook(() => useInView({ current: el }, '200px', false))
    expect(off.result.current).toBe(true)
    expect(FakeObserver.instances).toHaveLength(1)
  })
})

describe('Chibi lazy', () => {
  beforeEach(() => {
    FakeObserver.instances = []
    images = 0
    resetLoadedClips()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('draws no layer, preloads no clip and starts no tint until it scrolls into view, then draws every layer', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    vi.stubGlobal('Image', CountingImage)
    // A tint render's first step is a canvas context; jsdom has none, so it then falls back to the plain layer.
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const subject: ChibiConfig = { ...HATTED, hairColor: '#b3261e', hair: { ...HATTED.hair, tint: { meanL: 0.4, files: [HATTED.hair.front] } } }
    const { container } = render(
      <AvatarAssets base="https://cdn.example/avatar/">
        <Chibi subject={subject} size={96} lazy />
      </AvatarAssets>,
    )
    const root = container.firstElementChild as HTMLElement

    // Waiting: the root holds its place at its own size, with its identity, and nothing inside it.
    expect(root).toHaveAttribute('data-chibi-hash', hashChibi(subject))
    expect(root.style.width).toBe('96px')
    expect(container.querySelectorAll('img')).toHaveLength(0)
    expect(images).toBe(0)
    expect(getContext).not.toHaveBeenCalled()
    expect(FakeObserver.instances).toHaveLength(1)
    expect(FakeObserver.instances[0]!.targets).toEqual([root])

    // Seen: every layer at once, and the clip's preload starts.
    act(() => FakeObserver.fire())
    expect(container.querySelectorAll('img')).toHaveLength(layersFor(subject, 'neutral', 'full').length)
    expect(images).toBe(1) // the hat's hair clip
    expect(getContext).toHaveBeenCalled()
    expect(FakeObserver.instances[0]!.disconnected).toBe(true)
  })

  it('ignores an observer report that the chibi is still off screen', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    const { container } = render(<Chibi subject={SUBJECT} lazy />)
    act(() => FakeObserver.fire(false))
    expect(container.querySelectorAll('img')).toHaveLength(0)
    act(() => FakeObserver.fire(true))
    expect(container.querySelectorAll('img')).toHaveLength(layersFor(SUBJECT, 'neutral', 'full').length)
  })

  it('keeps its layers once seen, even when it scrolls away again', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    const { container, rerender } = render(<Chibi subject={SUBJECT} lazy />)
    act(() => FakeObserver.fire(true))
    act(() => FakeObserver.fire(false))
    rerender(<Chibi subject={SUBJECT} lazy />)
    expect(container.querySelectorAll('img')).toHaveLength(layersFor(SUBJECT, 'neutral', 'full').length)
  })

  it('a head-crop placeholder keeps the head frame', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    const { container } = render(<Chibi subject={SUBJECT} frame="head" size={40} lazy />)
    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveAttribute('data-frame', 'head')
    expect(root.style.height).toBe('40px')
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })

  it('draws at once when the browser has no IntersectionObserver', () => {
    const { container } = render(<Chibi subject={SUBJECT} lazy />)
    expect(container.querySelectorAll('img')).toHaveLength(layersFor(SUBJECT, 'neutral', 'full').length)
  })

  it('a chibi that is not lazy never asks the observer and draws at once', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    const { container } = render(<Chibi subject={SUBJECT} />)
    expect(FakeObserver.instances).toHaveLength(0)
    expect(container.querySelectorAll('img')).toHaveLength(layersFor(SUBJECT, 'neutral', 'full').length)
  })
})
