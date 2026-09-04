import { useCallback, useEffect, useMemo, useState } from 'react'

export interface HashRoute {
  /** Normalised path, always leading-slashed: `'/'`, `'/lobby'`, `'/room/ABC234'`. */
  path: string
  segments: string[]
  query: URLSearchParams
}

const decode = (segment: string): string => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** `'#/room/ABC234?x=1'` → `{ path: '/room/ABC234', segments: ['room', 'ABC234'], query }`. */
export function parseHash(hash: string): HashRoute {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const mark = raw.indexOf('?')
  const pathPart = mark === -1 ? raw : raw.slice(0, mark)
  const query = new URLSearchParams(mark === -1 ? '' : raw.slice(mark + 1))
  const segments = pathPart.split('/').filter((part) => part !== '').map(decode)
  return { path: `/${segments.join('/')}`, segments, query }
}

const currentHash = (): string => (typeof window === 'undefined' ? '' : window.location.hash)

/**
 * The whole router: the fragment is the route. No history stack of our own, no path rewriting — a hash keeps the
 * two web apps deployable as static files under any base path, which is exactly what Lite needs.
 */
export function useHashRoute(): { route: HashRoute; navigate: (path: string) => void } {
  const [hash, setHash] = useState(currentHash)

  useEffect(() => {
    const sync = (): void => setHash(currentHash())
    window.addEventListener('hashchange', sync)
    sync() // the hash may have moved between the first render and this subscription
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  const route = useMemo(() => parseHash(hash), [hash])

  const navigate = useCallback((path: string) => {
    const target = path.startsWith('#') ? path : `#${path.startsWith('/') ? path : `/${path}`}`
    if (window.location.hash === target) return
    window.location.hash = target
    setHash(target) // do not wait for the browser's own `hashchange` task
  }, [])

  return { route, navigate }
}
