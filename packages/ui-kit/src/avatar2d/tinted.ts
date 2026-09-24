import { useEffect, useState } from 'react'
import { assetUrl } from './AvatarAssets.js'
import { recolour } from './recolour.mjs'
import type { LayerRef, TintRef } from './types.js'

/** How many rendered blob URLs to keep alive at once (spec §5.2). Past this, the oldest *inserted* entry is
 * evicted and its object URL revoked — a chibi only ever shows a handful of tinted layers at a time, so a plain
 * insertion-order cap is plenty and needs no recency bookkeeping. */
const CACHE_LIMIT = 96

/** file|density|mask:colour,mask:colour… → a promise for that exact paint job's blob URL (or `null` if it could
 * not be rendered). Module-level so every `Chibi` on a page — and every re-render of the same one — shares it. */
const cache = new Map<string, Promise<string | null>>()

/** The cache key for one layer's tinted render: same file, same density, same tints (in order and by colour) →
 * same key, so two chibis wearing the same coloured hair only ever pay for the canvas work once. */
export function tintKey(file: string, density: 1 | 2, tints: TintRef[]): string {
  return `${file}|${density}|${tints.map((t) => `${t.mask}:${t.colour}`).join(',')}`
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.src = src
  return img.decode().then(() => img)
}

/** Paints every tint in `layer.tints` onto an offscreen canvas and resolves the resulting PNG's blob URL — or
 * `null`, never a throw, whenever a 2D context is unavailable (jsdom, a browser that refuses one) or anything
 * else in the pipeline fails, so the caller's only job is to fall back to the plain layer. */
async function renderTintedLayer(prefix: string, layer: LayerRef, density: 1 | 2): Promise<string | null> {
  const tints = layer.tints
  if (tints === undefined || tints.length === 0) return null

  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (ctx === null) return null

    const layerImg = await loadImage(assetUrl(prefix, layer.file, density))
    canvas.width = layerImg.naturalWidth
    canvas.height = layerImg.naturalHeight
    ctx.drawImage(layerImg, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = canvas.width
    maskCanvas.height = canvas.height
    const maskCtx = maskCanvas.getContext('2d')
    if (maskCtx === null) return null

    for (const tint of tints) {
      const maskImg = await loadImage(assetUrl(prefix, tint.mask, density))
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
      maskCtx.drawImage(maskImg, 0, 0)
      const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data
      const maskAlpha = new Uint8Array(maskCanvas.width * maskCanvas.height)
      for (let i = 0; i < maskAlpha.length; i++) maskAlpha[i] = maskData[i * 4 + 3] ?? 0
      recolour(imageData.data, maskAlpha, tint.colour, tint.meanL)
    }

    ctx.putImageData(imageData, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve))
    return blob === null ? null : URL.createObjectURL(blob)
  } catch {
    return null
  }
}

/** Runs `factory` for `key` at most once, caching the in-flight/settled promise; evicts the oldest entry (by
 * insertion, not by recency) past `CACHE_LIMIT`, revoking its object URL if it resolved to one. */
function cachedRender(key: string, factory: () => Promise<string | null>): Promise<string | null> {
  const existing = cache.get(key)
  if (existing !== undefined) return existing

  const job = factory()
  cache.set(key, job)

  if (cache.size > CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value as string | undefined
    if (oldestKey !== undefined) {
      const oldest = cache.get(oldestKey)
      cache.delete(oldestKey)
      void oldest?.then((url) => {
        if (url !== null) URL.revokeObjectURL(url)
      })
    }
  }

  return job
}

/**
 * The blob URL for a layer's tinted render, once ready — `null` before it resolves, when the layer has no
 * `tints`, or whenever rendering was not possible (no 2D canvas context, a failed image load). `Chibi` renders
 * the plain, untinted `src` for exactly as long as this returns `null`, so nothing here ever needs to throw into
 * render: every failure path already resolves to `null` instead.
 */
export function useTintedLayer(prefix: string, layer: LayerRef): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const tints = layer.tints
  const density: 1 | 2 = typeof window !== 'undefined' && window.devicePixelRatio > 1 ? 2 : 1
  const key = tints === undefined || tints.length === 0 ? null : tintKey(layer.file, density, tints)

  useEffect(() => {
    if (key === null) {
      setUrl(null)
      return
    }
    let cancelled = false
    cachedRender(key, () => renderTintedLayer(prefix, layer, density)).then((result) => {
      if (!cancelled) setUrl(result)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` already encodes file, density and every tint.
  }, [key, prefix])

  return url
}
