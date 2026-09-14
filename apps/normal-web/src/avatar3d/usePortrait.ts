import { useEffect, useRef, useState } from 'react'
import type { AvatarConfigDto } from './legacy-avatar.js'
import { isAbortError } from './abort.js'
import type { PortraitFrame } from './framing.js'
import { hashConfig } from './hash.js'
import { cachedPortrait, lookupPortrait, peekPortrait, storePortrait } from './portrait-cache.js'

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
  /** The hash `url` is the picture of — the same one the cache and `data-hash` are keyed by. */
  hash: string | null
}

/** The half of `portraits.ts` this hook uses — and all a test double has to provide. */
export interface PortraitRenderer {
  supported(): boolean
  render(config: AvatarConfigDto, options?: { signal?: AbortSignal; frame?: PortraitFrame }): Promise<Blob>
}

/** What a caller may ask of a portrait beyond the configuration itself. */
export interface PortraitOptions {
  /**
   * The crop: head and shoulders by default, or the whole figure for the two slots that crop cannot
   * contain. It is part of the cache key — see `hashConfig` — because it is part of the picture.
   */
  frame?: PortraitFrame
}

/** How the real renderer is fetched. A parameter only so that a test can make the fetch fail. */
export type PortraitRendererLoader = () => Promise<PortraitRenderer>

/**
 * The one import of the three.js graph in the whole application.
 *
 * A dynamic `import()` and nothing else — `test/footprint.test.ts` holds the built entry chunk to the
 * consequence. Note that its rejection is handled where it is *used*, not here: a module that fails to
 * evaluate (a chunk that 404s after a deploy, a CSP that refuses its WebAssembly) must end as the
 * initial letter and a single warning, never as an unhandled rejection in the console.
 */
const importPortraits: PortraitRendererLoader = () =>
  import('./portraits.js').then((module) => ({ supported: module.supported, render: module.render }))

let injected: PortraitRenderer | null = null
let load: PortraitRendererLoader = importPortraits
let loadingRenderer: Promise<PortraitRenderer | null> | null = null
let warned = false

/**
 * One entry per hash being drawn right now.
 *
 * `waiting` counts the mounted components that asked for it, and the controller is aborted only when
 * that reaches zero — nine seat plates in the same outfit share one render, and one of them unmounting
 * must not cancel the picture the other eight are waiting for.
 */
interface Inflight {
  promise: Promise<Outcome>
  controller: AbortController
  waiting: number
}

const inflight = new Map<string, Inflight>()

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

/**
 * Substitutes *how* the real renderer is loaded, so a test can watch the module fail to arrive.
 *
 * The failure path is the one that matters here: a browser that refuses to evaluate the chunk has to
 * end at `unsupported`, quietly, with nothing escaping into the console as an unhandled rejection.
 * Passing `null` restores the real dynamic import.
 */
export function setPortraitLoaderForTests(loader: PortraitRendererLoader | null): void {
  load = loader ?? importPortraits
  injected = null
  loadingRenderer = null
  inflight.clear()
  warned = false
}

async function resolveRenderer(): Promise<PortraitRenderer | null> {
  if (injected !== null) return injected
  // A `.then` rather than an `await` so that the promise itself is the cache: a second caller during
  // the download joins it. The rejection handler is what keeps a chunk that will not load — the CSP
  // case, and the deploy-during-a-session case — out of the console as `Uncaught (in promise)`.
  loadingRenderer ??= load().then(
    (renderer) => renderer,
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

/**
 * How one attempt ended.
 *
 * `cancelled` is the third answer and it is not a failure: the tile scrolled out of the wardrobe, or
 * the player changed a colour, before this job's turn in the render queue came up. It warns nothing and
 * latches nothing — the difference between "this browser cannot draw faces" and "nobody wanted that
 * one" is the difference between a permanent letter and a picture that is simply never asked for.
 */
type Outcome = { status: 'ready'; url: string } | { status: 'unsupported' } | { status: 'cancelled' }

const CANCELLED: Outcome = { status: 'cancelled' }
const UNSUPPORTED: Outcome = { status: 'unsupported' }

/**
 * One attempt, from cache to storage, and **it never rejects**.
 *
 * Everything under here is allowed to fail — a chunk that will not evaluate, a bundle that 404s, a lost
 * GPU context, a `toBlob` that returns nothing — and every one of those has the same answer for the
 * player: the initial letter. Catching all of it in one place is also what keeps the console honest,
 * because a rejection nobody handles is reported by the browser as a bug even when the fallback worked
 * perfectly.
 */
async function produce(hash: string, config: AvatarConfigDto, frame: PortraitFrame, signal: AbortSignal): Promise<Outcome> {
  try {
    const stored = await lookupPortrait(hash)
    if (stored !== null) return { status: 'ready', url: stored }
    if (signal.aborted) return CANCELLED
    const renderer = await resolveRenderer()
    if (renderer === null || !renderer.supported()) {
      warnOnce(renderer === null ? 'the portrait renderer failed to load' : 'this browser has no WebGL2')
      return UNSUPPORTED
    }
    const blob = await renderer.render(config, { signal, frame })
    return { status: 'ready', url: await storePortrait(hash, blob) }
  } catch (cause) {
    if (isAbortError(cause)) return CANCELLED
    warnOnce(cause)
    return UNSUPPORTED
  }
}

/** A subscription to one hash's render: the outcome, and a way to stop waiting for it. */
interface Held {
  promise: Promise<Outcome>
  release(): void
}

/**
 * The portrait for a hash, rendering it at most once however many components ask at once.
 *
 * The refcount is the whole of the cancellation policy. A component that unmounts releases its hold;
 * when the last holder lets go the render is aborted, which drops it out of the queue if it has not
 * started yet. A wardrobe where one colour click re-hashes forty tiles therefore queues forty renders
 * and then quietly discards the thirty-nine that the next click made stale, instead of drawing all
 * eighty pictures in turn.
 */
function ensurePortrait(hash: string, config: AvatarConfigDto, frame: PortraitFrame): Held {
  let entry = inflight.get(hash)
  if (entry === undefined) {
    const controller = new AbortController()
    const created: Inflight = { controller, waiting: 0, promise: Promise.resolve(CANCELLED) }
    created.promise = produce(hash, config, frame, controller.signal).finally(() => {
      // Only if it is still *this* entry: an aborted one is replaced the moment somebody asks again.
      if (inflight.get(hash) === created) inflight.delete(hash)
    })
    inflight.set(hash, created)
    entry = created
  }

  const held = entry
  held.waiting += 1
  let released = false

  return {
    promise: held.promise,
    release() {
      if (released) return
      released = true
      held.waiting -= 1
      if (held.waiting > 0 || inflight.get(hash) !== held) return
      inflight.delete(hash)
      held.controller.abort()
    },
  }
}

/**
 * What to show before any effect has run.
 *
 * A hash already in memory is served here rather than after a round trip through `useEffect`, so a
 * seat plate that has drawn this face before never flickers back to its letter — which is exactly what
 * a table does on every action, nine plates at a time. `peekPortrait` rather than `cachedPortrait`
 * because this runs while React is rendering: it may run twice, or be discarded, and a render pass may
 * not leave a mark on the LRU. The effect below records the use.
 */
function seed(hash: string | null): PortraitState {
  if (hash === null) return { url: null, status: 'idle', hash: null }
  const hot = peekPortrait(hash)
  return hot === null ? { url: null, status: 'loading', hash } : { url: hot, status: 'ready', hash }
}

export function usePortrait(config: AvatarConfigDto | null, options: PortraitOptions = {}): PortraitState {
  const frame = options.frame ?? 'portrait'
  // The crop is part of the identity, not a detail of the drawing: two crops of one outfit are two
  // keys, two cache entries and two renders, which is what they are.
  const hash = config === null ? null : hashConfig(config, frame)
  const [state, setState] = useState<PortraitState>(() => seed(hash))

  // The configuration reaches the render effect through a ref because the *hash* is its identity: a
  // caller that spreads a fresh object on every render (every one of them does) would otherwise restart
  // that effect on every render, and re-draw the same picture forever. The ref is written in an effect
  // of its own rather than during render — effects run in the order they are declared, so this one has
  // always updated the ref by the time the effect below reads it.
  const latest = useRef(config)
  useEffect(() => {
    latest.current = config
  })

  useEffect(() => {
    if (hash === null) {
      setState({ url: null, status: 'idle', hash: null })
      return
    }
    const current = latest.current
    if (current === null) return

    const hot = cachedPortrait(hash)
    if (hot !== null) {
      setState({ url: hot, status: 'ready', hash })
      return
    }

    let live = true
    setState({ url: null, status: 'loading', hash })
    const held = ensurePortrait(hash, current, frame)
    void held.promise.then((outcome) => {
      if (!live) return
      // A cancelled render is one nobody is waiting for any more, so this branch is all but
      // unreachable — and if it is reached (a sibling let go of a shared render at the wrong instant)
      // the honest state is `idle`: nothing is being drawn and nothing has failed.
      if (outcome.status === 'cancelled') return setState({ url: null, status: 'idle', hash })
      setState(
        outcome.status === 'ready'
          ? { url: outcome.url, status: 'ready', hash }
          : { url: null, status: 'unsupported', hash },
      )
    })
    return () => {
      live = false
      // Unmounting, or moving to another configuration, is the caller saying it no longer wants this
      // picture. If the render has not started, it never will.
      held.release()
    }
    // `frame` is declared alongside `hash` and can never move on its own: it is one of the things
    // `hash` is computed from, so a change of crop is already a change of key.
  }, [hash, frame])

  return state
}
