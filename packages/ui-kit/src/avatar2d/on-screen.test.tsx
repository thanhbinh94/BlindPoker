import { act, renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOnScreen } from './on-screen.js'

/** A hand-driven `IntersectionObserver`: every instance is kept, and `fire` tells each live one whether its targets
 * intersect. Unlike `useInView`'s, `useOnScreen`'s observer must survive its first report. */
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
  static fire(isIntersecting: boolean) {
    for (const o of FakeObserver.instances) {
      if (o.disconnected) continue
      const entries = o.targets.map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry)
      o.callback(entries, o as unknown as IntersectionObserver)
    }
  }
}

/** A ref that stays the same object across renders, as `useRef`'s does. */
const refTo = (el: Element) => ({ current: el })

let visibility: DocumentVisibilityState = 'visible'
function setVisibility(next: DocumentVisibilityState) {
  visibility = next
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useOnScreen', () => {
  beforeEach(() => {
    FakeObserver.instances = []
    visibility = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reports false until the observer sees the element, true after, false again when it leaves', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    const el = document.createElement('div')
    const ref = refTo(el)
    const { result } = renderHook(() => useOnScreen(ref))
    expect(result.current).toBe(false)
    expect(FakeObserver.instances).toHaveLength(1)
    expect(FakeObserver.instances[0]!.targets).toEqual([el])
    expect(FakeObserver.instances[0]!.options?.rootMargin).toBe('0px')

    act(() => FakeObserver.fire(true))
    expect(result.current).toBe(true)
    // Kept alive: the first sighting does not disconnect it.
    expect(FakeObserver.instances[0]!.disconnected).toBe(false)

    act(() => FakeObserver.fire(false))
    expect(result.current).toBe(false)
    act(() => FakeObserver.fire(true))
    expect(result.current).toBe(true)
    expect(FakeObserver.instances).toHaveLength(1)
  })

  it('passes its rootMargin to the observer', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    const ref = refTo(document.createElement('div'))
    renderHook(() => useOnScreen(ref, { rootMargin: '50px' }))
    expect(FakeObserver.instances[0]!.options?.rootMargin).toBe('50px')
  })

  it('follows document.visibilityState', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    const ref = refTo(document.createElement('div'))
    const { result } = renderHook(() => useOnScreen(ref))
    act(() => FakeObserver.fire(true))
    expect(result.current).toBe(true)

    act(() => setVisibility('hidden'))
    expect(result.current).toBe(false)
    act(() => setVisibility('visible'))
    expect(result.current).toBe(true)
  })

  it('starts false in a hidden tab', () => {
    visibility = 'hidden'
    const { result } = renderHook(() => useOnScreen(useRef<HTMLDivElement>(null)))
    expect(result.current).toBe(false)
  })

  it('is true without the API (jsdom), while the tab is visible', () => {
    const { result } = renderHook(() => useOnScreen(useRef<HTMLDivElement>(null)))
    expect(result.current).toBe(true)
    act(() => setVisibility('hidden'))
    expect(result.current).toBe(false)
  })

  it('is false and watches nothing when disabled', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    const add = vi.spyOn(document, 'addEventListener')
    const ref = refTo(document.createElement('div'))
    const { result } = renderHook(() => useOnScreen(ref, { enabled: false }))
    expect(result.current).toBe(false)
    expect(FakeObserver.instances).toHaveLength(0)
    expect(add.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(0)
  })

  it('is false when disabled even without the API', () => {
    const { result } = renderHook(() => useOnScreen(useRef<HTMLDivElement>(null), { enabled: false }))
    expect(result.current).toBe(false)
  })

  it('disconnects on unmount and stops listening to visibilitychange', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    const remove = vi.spyOn(document, 'removeEventListener')
    const ref = refTo(document.createElement('div'))
    const { unmount } = renderHook(() => useOnScreen(ref))
    expect(FakeObserver.instances[0]!.disconnected).toBe(false)
    unmount()
    expect(FakeObserver.instances[0]!.disconnected).toBe(true)
    expect(remove.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(1)
  })
})
