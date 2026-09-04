import { useCallback, useSyncExternalStore } from 'react'

const NOOP = (): void => {}

const list = (query: string): MediaQueryList | null =>
  typeof window === 'undefined' || typeof window.matchMedia !== 'function' ? null : window.matchMedia(query)

/** `matchMedia` as a React value. Returns `false` where `matchMedia` is missing (SSR, older jsdom). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = list(query)
      if (mql === null) return NOOP
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', onChange)
        return () => mql.removeEventListener('change', onChange)
      }
      mql.addListener(onChange)
      return () => mql.removeListener(onChange)
    },
    [query],
  )
  const getSnapshot = useCallback(() => list(query)?.matches ?? false, [query])
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
