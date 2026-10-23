import { useEffect, useState, type RefObject } from 'react'

/** Whether this browser has `IntersectionObserver` at all (jsdom does not). */
function canObserve(): boolean {
  return typeof IntersectionObserver !== 'undefined'
}

/** Whether the page is the one being looked at: `true` where there is no document to ask. */
function pageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

export interface UseOnScreenOptions {
  /** How far outside the viewport still counts as on screen. `'0px'` by default: the element itself must show. */
  rootMargin?: string
  /** Off, the hook watches nothing — no observer, no `visibilitychange` listener — and reports `false`. */
  enabled?: boolean
}

/**
 * Whether `ref`'s element is on screen right now (BP-30): inside the viewport (within `rootMargin`) **and** in a tab
 * the player is looking at (`document.visibilityState === 'visible'`). Unlike `useInView` (plan 27 E1), which reports
 * `true` once and stops watching, this one keeps its observer for as long as it is mounted and goes back to `false`
 * when the element scrolls away or the tab is hidden, so a live chibi stops breathing and blinking while nobody can
 * see it and starts again when it is back.
 *
 * Where the browser has no `IntersectionObserver` (jsdom, a very old browser) the element counts as inside the
 * viewport, and only the tab's visibility decides. With `enabled` false it is always `false` and watches nothing:
 * how a component that only sometimes lives calls this hook unconditionally.
 */
export function useOnScreen(ref: RefObject<Element | null>, { rootMargin = '0px', enabled = true }: UseOnScreenOptions = {}): boolean {
  const [intersecting, setIntersecting] = useState(() => !canObserve())
  const [visible, setVisible] = useState(pageVisible)

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return
    const onChange = () => setVisible(pageVisible())
    onChange()
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [enabled])

  useEffect(() => {
    if (!enabled || !canObserve()) return
    const el = ref.current
    if (el === null) return
    const observer = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1]
        if (last !== undefined) setIntersecting(last.isIntersecting)
      },
      { rootMargin },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, rootMargin, enabled])

  return enabled && intersecting && visible
}
