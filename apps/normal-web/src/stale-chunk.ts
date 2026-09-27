import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

/**
 * Bug 4 (2026-09-08, fixed 2026-09-27): a tab opened before a deploy still runs the old entry bundle, which
 * asks for the old hashed chunk of a lazy screen (`ProfileScreen-<old hash>.js`). The deploy replaced `dist/`,
 * so that file is a 404 and React rendered nothing — a blank page under the rail.
 *
 * The cure is the new `index.html`, i.e. a reload. This module does it once, automatically, and remembers when
 * in `sessionStorage` so a chunk that is missing for any other reason cannot put the tab in a reload loop; if
 * the reload did not help, the error reaches `UpdateBoundary`, which says so and offers the button.
 */

/** When the tab last reloaded itself for a missing chunk (epoch ms), per tab. */
export const RELOAD_KEY = 'bp.chunkReloadAt'
/** A second failure inside this window is not reloaded again: it goes to the boundary instead. */
export const RELOAD_WINDOW_MS = 30_000

/**
 * The browsers' own words for "that dynamically imported file is not there": Chromium, Safari, Firefox, and
 * Vite's preload helper for the CSS that travels with a chunk.
 */
const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError/i

export function isChunkLoadError(err: unknown): boolean {
  if (err instanceof Error) return CHUNK_ERROR.test(`${err.name} ${err.message}`)
  return typeof err === 'string' && CHUNK_ERROR.test(err)
}

function sessionStore(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null // storage disabled: no way to guard a loop, so no automatic reload
  }
}

/**
 * Set once this page has asked the browser to reload. Vite's preload helper and the dynamic import usually fail
 * together for one missing chunk: the first reloads, and the second must wait for the navigation rather than
 * take the "already reloaded" path and flash the boundary's message just before the page goes away.
 */
let reloadInFlight = false

/** Whether this page already asked for a reload that has not happened yet. Tests reset it. */
export function reloading(): boolean {
  return reloadInFlight
}

export function resetReloadingForTests(): void {
  reloadInFlight = false
}

export interface ReloadDeps {
  now?: number
  storage?: Storage | null
  reload?: () => void
}

/**
 * Reloads the page unless it already did so in the last `RELOAD_WINDOW_MS`. Answers whether it reloaded.
 * Without storage it never reloads: a guard it cannot write is a loop it cannot stop.
 */
export function reloadForNewVersion({ now = Date.now(), storage = sessionStore(), reload = () => window.location.reload() }: ReloadDeps = {}): boolean {
  if (storage === null) return false
  try {
    // No mark at all means the tab never reloaded itself — not "reloaded at epoch 0".
    const mark = storage.getItem(RELOAD_KEY)
    if (mark !== null && now - Number(mark) < RELOAD_WINDOW_MS) return false
    storage.setItem(RELOAD_KEY, String(now))
  } catch {
    return false
  }
  reloadInFlight = true
  reload()
  return true
}

/**
 * `React.lazy` for an account screen, with the stale-chunk cure: a missing chunk reloads the page once (and the
 * lazy component simply never resolves while the browser navigates away); anything else — including a second
 * miss inside the window — rejects as before and reaches `UpdateBoundary`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the same constraint `React.lazy` itself declares
export function lazyScreen<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  reload: () => boolean = () => reloadForNewVersion(),
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await factory()
    } catch (err) {
      if (isChunkLoadError(err) && (reloading() || reload())) return new Promise<never>(() => {})
      throw err
    }
  })
}
