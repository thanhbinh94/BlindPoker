import { useEffect, useRef, useState } from 'react'
import type { AvatarConfigDto } from '../api.js'
import { hashConfig } from './hash.js'
import { cachedPortrait, lookupPortrait, storePortrait } from './portrait-cache.js'

/**
 * One React hook over the whole portrait pipeline (avatar-3d design §5).
 *
 * `usePortrait(config)` is the *only* thing the app calls. Everything underneath it — the manifest,
 * five `.glb` bundles, three.js itself — is reached through a single dynamic `import()` in
 * `resolveRenderer` below, and that is what keeps `three` out of the entry chunk (design §7, and
 * `test/footprint.test.ts` holds the build to it). A browser that never draws a portrait never
 * downloads a byte of it.
 *
 * The four states are the four things a caller can do about it:
 *
 * | `idle`        | there is no configuration yet — the neutral placeholder |
 * | `loading`     | it is being fetched, assembled or drawn |
 * | `ready`       | `url` is a `blob:` URL for a 128 px image |
 * | `unsupported` | no WebGL, a bundle that would not load, a render that failed — the letter, for good |
 *
 * De-duplication happens at module scope rather than per component, because the callers are nine seat
 * plates and a lobby bar that mount at the same instant and frequently want the *same* face: the
 * memory cache answers the second one synchronously, and `inflight` collapses simultaneous misses into
 * one render.
 */

export type PortraitStatus = 'idle' | 'loading' | 'ready' | 'unsupported'

export interface PortraitState {
  /** A `blob:` URL, or `null` in every state but `ready`. */
  url: string | null
  status: PortraitStatus
}

/** The half of `portraits.ts` this hook uses — and all a test double has to provide. */
export interface PortraitRenderer {
  supported(): boolean
  render(config: AvatarConfigDto): Promise<Blob>
}

let injected: PortraitRenderer | null = null
let loadingRenderer: Promise<PortraitRenderer | null> | null = null
const inflight = new Map<string, Promise<string | null>>()
let warned = false

/**
 * Substitutes a renderer, and forgets what the previous one produced.
 *
 * jsdom has no WebGL and no canvas of any kind, so every unit test of this hook injects
 * `fake-renderer.ts` here. Passing `null` restores the real one. It also clears the in-flight map and
 * the one-warning latch, which is what makes each test start from nothing.
 */
export function setPortraitRendererForTests(renderer: PortraitRenderer | null): void {
  injected = renderer
  loadingRenderer = null
  inflight.clear()
  warned = false
}

async function resolveRenderer(): Promise<PortraitRenderer | null> {
  if (injected !== null) return injected
  // The one import of the three.js graph in the whole application. It is a `.then` rather than an
  // `await` so that the promise itself is the cache: a second caller during the download joins it.
  loadingRenderer ??= import('./portraits.js').then(
    (module) => ({ supported: module.supported, render: module.render }),
    () => null,
  )
  return loadingRenderer
}

/**
 * One warning per page, whatever went wrong.
 *
 * A table with nine seats on a machine with no WebGL would otherwise print nine identical lines, and
 * then nine more on the next hand. The first one says everything the second would.
 */
function warnOnce(cause: unknown): void {
  if (warned) return
  warned = true
  console.warn('[portrait] falling back to initials: portraits cannot be rendered here', cause)
}

async function produce(hash: string, config: AvatarConfigDto): Promise<string | null> {
  try {
    const stored = await lookupPortrait(hash)
    if (stored !== null) return stored
    const renderer = await resolveRenderer()
    if (renderer === null || !renderer.supported()) {
      warnOnce(renderer === null ? 'the portrait renderer failed to load' : 'this browser has no WebGL2')
      return null
    }
    return await storePortrait(hash, await renderer.render(config))
  } catch (cause) {
    warnOnce(cause)
    return null
  }
}

/** The portrait for a hash, rendering it at most once however many components ask at once. */
function ensurePortrait(hash: string, config: AvatarConfigDto): Promise<string | null> {
  const existing = inflight.get(hash)
  if (existing !== undefined) return existing
  const pending = produce(hash, config).finally(() => {
    inflight.delete(hash)
  })
  inflight.set(hash, pending)
  return pending
}

/**
 * What to show before any effect has run.
 *
 * A hash already in memory is served here rather than after a round trip through `useEffect`, so a
 * seat plate that has drawn this face before never flickers back to its letter — which is exactly what
 * a table does on every action, nine plates at a time.
 */
function seed(hash: string | null): PortraitState {
  if (hash === null) return { url: null, status: 'idle' }
  const hot = cachedPortrait(hash)
  return hot === null ? { url: null, status: 'loading' } : { url: hot, status: 'ready' }
}

export function usePortrait(config: AvatarConfigDto | null): PortraitState {
  const hash = config === null ? null : hashConfig(config)
  const [state, setState] = useState<PortraitState>(() => seed(hash))

  // The configuration reaches the effect through a ref because the *hash* is its identity: a caller
  // that spreads a fresh object on every render (every one of them does) would otherwise restart this
  // effect on every render, and re-render the same picture forever.
  const latest = useRef(config)
  latest.current = config

  useEffect(() => {
    if (hash === null) {
      setState({ url: null, status: 'idle' })
      return
    }
    const current = latest.current
    if (current === null) return

    const hot = cachedPortrait(hash)
    if (hot !== null) {
      setState({ url: hot, status: 'ready' })
      return
    }

    let live = true
    setState({ url: null, status: 'loading' })
    void ensurePortrait(hash, current).then((url) => {
      if (!live) return
      setState(url === null ? { url: null, status: 'unsupported' } : { url, status: 'ready' })
    })
    return () => {
      live = false
    }
  }, [hash])

  return state
}
