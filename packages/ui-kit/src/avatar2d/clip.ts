import { useEffect, useReducer } from 'react'

/**
 * A hat's hair clip, loaded before it is used as a CSS mask (2026-10-06, review fix round 1). A `mask-image` that is
 * still loading draws its element as nothing, and one that fails to load draws it as nothing for good (CSS Masking: a
 * mask image that cannot be shown is a transparent black one) — so masking the hair with a clip not yet in hand would
 * blink the hair out each time a covering hat is put on, and a missing clip would leave a bald head under the hat. Until
 * the clip has loaded, and if it never does, the hair is drawn unclipped: the worst case is the hair as it was before
 * hats clipped it, never no hair at all.
 *
 * Module-level, like `useTintedLayer`'s cache, so every chibi on a page shares one load per clip and a clip loaded once
 * masks every later mount from its first render. A failed load is forgotten, so the next mount tries again.
 */
const loaded = new Set<string>()
const pending = new Map<string, Set<() => void>>()

function load(url: string, onSettled: () => void): () => void {
  let waiting = pending.get(url)
  if (waiting === undefined) {
    waiting = new Set()
    pending.set(url, waiting)
    const img = new Image()
    // The mask is fetched in CORS mode; loading it the same way lets the browser reuse this fetch for the mask.
    img.crossOrigin = 'anonymous'
    const settle = (ok: boolean) => {
      if (ok) loaded.add(url)
      const done = pending.get(url)
      pending.delete(url)
      for (const notify of done ?? []) notify()
    }
    img.onload = () => settle(true)
    img.onerror = () => settle(false)
    img.src = url
  }
  waiting.add(onSettled)
  return () => {
    pending.get(url)?.delete(onSettled)
  }
}

/** `url` once the clip there has loaded; `null` while it loads, if it failed, or when there is no clip (`url` null). */
export function useLoadedClip(url: string | null): string | null {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const shown = url !== null && loaded.has(url)
  useEffect(() => {
    if (url === null || shown) return
    // Loaded by another chibi between this render and this effect: draw it now rather than wait for a load that is over.
    if (loaded.has(url)) {
      rerender()
      return
    }
    return load(url, rerender)
  }, [url, shown])
  return shown ? url : null
}

/** Test seam: forget every clip loaded so far, so each test starts cold. */
export function resetLoadedClips(): void {
  loaded.clear()
  pending.clear()
}
