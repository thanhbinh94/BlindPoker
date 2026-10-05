import { useEffect, useRef, useState } from 'react'
import { assetUrl } from './AvatarAssets.js'
import { recolour, shade } from './recolour.mjs'
import type { LayerRef, TintRef } from './types.js'

/** How many rendered blob URLs to keep alive at once (spec §5.2). Past this, the oldest *settled* entry is
 * evicted and its object URL revoked — a chibi only ever shows a handful of tinted layers at a time, so a plain
 * insertion-order cap is plenty and needs no recency bookkeeping. A still-pending entry is never evicted: revoking
 * a blob URL the instant it resolves — before the consumer that just received it has had a chance to commit an
 * `<img src>` for it — would flash that layer blank, so eviction only ever touches work that has already finished. */
const CACHE_LIMIT = 96

interface CacheEntry {
  promise: Promise<string | null>
  settled: boolean
  url: string | null
}

/** file|density|mask:colour,mask:colour… → the entry for that exact paint job. Module-level so every `Chibi` on a
 * page — and every re-render of the same one — shares it. */
const cache = new Map<string, CacheEntry>()

/** The cache key for one layer's tinted render: same file, same density, same tints (in order, by colour and by
 * `meanL`) → same key, so two chibis wearing the same coloured hair only ever pay for the canvas work once. `meanL` is
 * in it because one file can be painted against two: a shared outfit's line is shaded at the wearer's body's skin
 * `meanL` (2026-10-05). A tint's `mode` needs no place in it: the mask names it (a `_skinlinemask` is always shaded). */
export function tintKey(file: string, density: 1 | 2, tints: TintRef[]): string {
  return `${file}|${density}|${tints.map((t) => `${t.mask}:${t.colour}:${t.meanL}`).join(',')}`
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image()
  // The avatar asset base can be a CDN origin different from the page's; without this, drawing that
  // image onto the canvas below taints it, and `getImageData`/`toBlob` throw a SecurityError instead
  // of the plain layer's own failure path.
  img.crossOrigin = 'anonymous'
  img.src = src
  return img.decode().then(() => img)
}

/** The outcome of one render attempt: `cacheable` says whether `cachedRender` may keep a `null` result cached
 * for the rest of the session (spec §5.2's "no canvas" fallback, e.g. jsdom) or must drop it so the next mount
 * retries instead (a 2D context existed but something downstream — an image load, a decode — failed once). */
interface RenderOutcome {
  url: string | null
  cacheable: boolean
}

/** Paints every tint in `layer.tints` onto an offscreen canvas and resolves the resulting PNG's blob URL — or
 * `null`, never a throw, whenever a 2D context is unavailable (jsdom, a browser that refuses one) or anything
 * else in the pipeline fails, so the caller's only job is to fall back to the plain layer. */
async function renderTintedLayer(prefix: string, layer: LayerRef, density: 1 | 2): Promise<RenderOutcome> {
  const tints = layer.tints
  if (tints === undefined || tints.length === 0) return { url: null, cacheable: true }

  // Set once a 2D context is actually in hand — everything that can fail after that point (a flaky
  // image load, a decode error, `toBlob` returning null) is a transient failure of *this* attempt, not
  // a fact about the environment, so its `null` must not be cached the way "no canvas at all" is.
  let hadContext = false
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (ctx === null) return { url: null, cacheable: true }
    hadContext = true

    const layerImg = await loadImage(assetUrl(prefix, layer.file, density))
    canvas.width = layerImg.naturalWidth
    canvas.height = layerImg.naturalHeight
    ctx.drawImage(layerImg, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = canvas.width
    maskCanvas.height = canvas.height
    const maskCtx = maskCanvas.getContext('2d')
    if (maskCtx === null) return { url: null, cacheable: true }

    for (const tint of tints) {
      const maskImg = await loadImage(assetUrl(prefix, tint.mask, density))
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
      maskCtx.drawImage(maskImg, 0, 0)
      const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data
      const maskAlpha = new Uint8Array(maskCanvas.width * maskCanvas.height)
      for (let i = 0; i < maskAlpha.length; i++) maskAlpha[i] = maskData[i * 4 + 3] ?? 0
      if (tint.mode === 'shade') shade(imageData.data, maskAlpha, tint.colour, tint.meanL)
      else recolour(imageData.data, maskAlpha, tint.colour, tint.meanL)
    }

    ctx.putImageData(imageData, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve))
    return { url: blob === null ? null : URL.createObjectURL(blob), cacheable: true }
  } catch {
    return { url: null, cacheable: !hadContext }
  }
}

/** Evicts the oldest *settled* cache entry once the cache is over `CACHE_LIMIT`, revoking its blob URL. Walking
 * the map in insertion order and skipping anything not yet settled means a run of unlucky-timed pending jobs
 * never gets evicted out from under itself — if nothing has settled yet, the cache is simply allowed to grow past
 * the cap until the next distinct key's insertion finds something it can evict. */
function evictIfNeeded(): void {
  if (cache.size <= CACHE_LIMIT) return
  for (const [key, entry] of cache) {
    if (!entry.settled) continue
    cache.delete(key)
    if (entry.url !== null) URL.revokeObjectURL(entry.url)
    return
  }
}

/** Runs `factory` for `key` at most once, caching its entry until it settles (and after) — unless the outcome
 * says `cacheable: false`, in which case the entry is dropped the moment it settles so the next caller for the
 * same key gets a fresh attempt instead of the one transient failure replayed for the rest of the session. */
function cachedRender(key: string, factory: () => Promise<RenderOutcome>): Promise<string | null> {
  const existing = cache.get(key)
  if (existing !== undefined) return existing.promise

  const outcome = factory()
  const promise = outcome.then((result) => result.url)
  const entry: CacheEntry = { promise, settled: false, url: null }
  cache.set(key, entry)
  evictIfNeeded()

  outcome.then(({ url, cacheable }) => {
    entry.settled = true
    entry.url = url
    if (!cacheable) cache.delete(key)
  })

  return promise
}

/**
 * The blob URL for a layer's tinted render — `null` before the first one resolves, when the layer has no
 * `tints`, or whenever rendering was not possible (no 2D canvas context, a failed image load); `Chibi` renders
 * the plain, untinted `src` for exactly as long as this returns `null`, so nothing here ever needs to throw into
 * render — every failure path already resolves to `null` instead.
 *
 * A *colour* change on the same layer file keeps returning the previous render's URL until the new one is ready
 * (spec §5.2) — a wardrobe click swaps hair colours one tap at a time, and flashing back to the base colour
 * between each tap would read as broken rather than as loading. A *file* change (a different layer altogether)
 * gets no such grace: it drops straight back to `null` so a stale render from the old file is never shown under
 * the new one's name.
 */
export function useTintedLayer(prefix: string, layer: LayerRef): string | null {
  const [url, setUrl] = useState<string | null>(null)
  // Identifies the file (and asset prefix) the currently-shown `url`, if any, was rendered from — not necessarily
  // this render's `layer.file`, which may already have moved on to a new colour or a wholly different layer.
  const shownRef = useRef<string | null>(null)
  const tints = layer.tints
  const density: 1 | 2 = typeof window !== 'undefined' && window.devicePixelRatio > 1 ? 2 : 1
  const key = tints === undefined || tints.length === 0 ? null : tintKey(layer.file, density, tints)
  const identity = `${prefix}|${layer.file}`

  useEffect(() => {
    if (key === null) {
      shownRef.current = null
      setUrl(null)
      return
    }

    if (shownRef.current !== identity) setUrl(null)

    let cancelled = false
    cachedRender(key, () => renderTintedLayer(prefix, layer, density)).then((result) => {
      if (cancelled) return
      shownRef.current = result === null ? null : identity
      setUrl(result)
    })
    return () => {
      cancelled = true
    }
    // `key` already encodes file, density and every tint; `identity` and `density` are both derived from
    // `prefix`/`layer.file`, already listed — re-running on `layer`'s own (fresh-every-render) object identity
    // or on those derived values would defeat the point of the cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, prefix, layer.file])

  return url
}
