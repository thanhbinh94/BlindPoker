import { useEffect, useState, type RefObject } from 'react'

/** Whether this browser has `IntersectionObserver` at all (jsdom does not). */
function canObserve(): boolean {
  return typeof IntersectionObserver !== 'undefined'
}

/**
 * Whether `ref`'s element has come within `rootMargin` of the viewport (plan 27 E1) — `true` from then on, even after
 * it scrolls away again: a lazy `Chibi` that has drawn its layers keeps them rather than dropping and re-fetching
 * them on every scroll.
 *
 * `true` at once, on the first render, when the browser has no `IntersectionObserver` (jsdom, a very old browser) —
 * the lazy path then draws exactly what the eager one does. `true` after mount when there is no element to watch. With
 * `enabled` false it never observes anything and is `true`: how a component that is only sometimes lazy calls this
 * hook unconditionally.
 */
export function useInView(ref: RefObject<Element | null>, rootMargin = '200px', enabled = true): boolean {
  const [seen, setSeen] = useState(() => !canObserve())

  useEffect(() => {
    if (!enabled || seen) return
    const el = ref.current
    if (el === null) {
      setSeen(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        setSeen(true)
      },
      { rootMargin },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, rootMargin, enabled, seen])

  return !enabled || seen
}
