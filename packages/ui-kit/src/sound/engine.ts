import type * as Stingers from './stingers.js'
import type { StingerId } from './stingers.js'

/**
 * The sound engine (BP-42 spec §5.3): one channel, a mute remembered on the device, silence in a hidden tab, and never
 * a sound outside a gesture's unlock. Nothing is ever queued for later replay: a stinger that cannot sound now is gone.
 *
 * The stingers themselves (`stingers.ts`) are loaded by `import()` on the first `unlock()` (Ruling 6: Normal's entry
 * chunk is close to its gzip budget); until they have loaded, `play` answers `'blocked'`. Only types are imported from
 * that module here, so it stays out of the static graph.
 */

export type SoundOutcome = 'played' | 'muted' | 'hidden' | 'blocked' | 'unsupported' | 'busy'

export interface PlayOptions {
  /** Stop what is sounding (and what waits) and start now: the BP-41 moments cut an entrance short. */
  preempt?: boolean
}

export interface SoundEngine {
  readonly muted: boolean
  /** Ready to sound: the context exists and runs (unlocked, not suspended by the browser) and the stingers have loaded. */
  readonly running: boolean
  setMuted(muted: boolean): void
  subscribe(listener: () => void): () => void
  /** A user gesture: creates the AudioContext the first time, resumes it when suspended, loads the stingers once. */
  unlock(): void
  play(id: StingerId, opts?: PlayOptions): SoundOutcome
}

export type StingerModule = typeof Stingers

export interface SoundEngineDeps {
  /** Default: `new (window.AudioContext ?? webkitAudioContext)()`, null when the browser has neither. */
  createContext?: () => AudioContext | null
  /** Default: `localStorage`; every read and write is in try/catch. */
  storage?: Storage | null
  /** Default: `() => document.hidden`. */
  isHidden?: () => boolean
  /** Default: `window.dispatchEvent(new CustomEvent(SOUND_EVENT, { detail: { id, outcome } }))`. */
  emit?: (id: StingerId, outcome: SoundOutcome) => void
  /** Default: `() => import('./stingers.js')`. */
  loadStingers?: () => Promise<StingerModule>
}

export const SOUND_MUTED_KEY = 'bp.sound.muted'
export const SOUND_EVENT = 'bp:sound'
/** How far ahead a stinger may wait for the one channel; further than this, it is dropped (`'busy'`). */
export const MAX_SOUND_WAIT_S = 4

export interface SoundEventDetail {
  id: StingerId
  outcome: SoundOutcome
}

type ContextCtor = new () => AudioContext

function contextCtor(): ContextCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { AudioContext?: ContextCtor; webkitAudioContext?: ContextCtor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function defaultEmit(id: StingerId, outcome: SoundOutcome): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<SoundEventDetail>(SOUND_EVENT, { detail: { id, outcome } }))
}

export function createSoundEngine(deps: SoundEngineDeps = {}): SoundEngine {
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage
  const isHidden = deps.isHidden ?? (() => typeof document !== 'undefined' && document.hidden)
  const emit = deps.emit ?? defaultEmit
  const loadStingers = deps.loadStingers ?? (() => import('./stingers.js'))
  const createContext =
    deps.createContext ??
    (() => {
      const Ctor = contextCtor()
      return Ctor === null ? null : new Ctor()
    })
  // Known without making a context: an injected factory is trusted until it returns null; the default one asks the page.
  const canCreate = deps.createContext === undefined ? () => contextCtor() !== null : () => true

  let muted = false
  try {
    muted = storage?.getItem(SOUND_MUTED_KEY) === '1'
  } catch {
    muted = false
  }

  const listeners = new Set<() => void>()
  let ctx: AudioContext | null = null
  let failed = false
  let stingers: StingerModule | null = null
  let loading = false
  let master: AudioNode | null = null
  let channel: GainNode | null = null
  let busyUntil = 0

  /** Silences what sounds and what waits: the channel is cut from the master and a fresh one takes its place. */
  const stopSounding = (): void => {
    busyUntil = 0
    if (ctx === null || channel === null || master === null) return
    try {
      channel.disconnect()
    } catch {
      // already disconnected
    }
    channel = ctx.createGain()
    channel.connect(master)
  }

  const load = (): void => {
    if (stingers !== null || loading) return
    loading = true
    loadStingers().then(
      (module) => {
        stingers = module
        loading = false
      },
      () => {
        loading = false // the next gesture tries again
      },
    )
  }

  const outcome = (id: StingerId, result: SoundOutcome): SoundOutcome => {
    emit(id, result)
    return result
  }

  return {
    get muted() {
      return muted
    },
    get running() {
      return ctx !== null && ctx.state === 'running' && stingers !== null
    },
    setMuted(next: boolean): void {
      muted = next
      try {
        if (next) storage?.setItem(SOUND_MUTED_KEY, '1')
        else storage?.removeItem(SOUND_MUTED_KEY)
      } catch {
        // storage blocked: the choice lasts for this page only
      }
      if (next) stopSounding()
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    unlock(): void {
      if (ctx === null && !failed) {
        try {
          ctx = createContext()
        } catch {
          ctx = null
        }
        if (ctx === null) failed = true
      }
      if (ctx === null) return
      if (ctx.state !== 'running') {
        try {
          void Promise.resolve(ctx.resume()).catch(() => {})
        } catch {
          // an old browser without a promise, or one that refuses: the next gesture tries again
        }
      }
      load()
    },
    play(id: StingerId, opts: PlayOptions = {}): SoundOutcome {
      if (muted) return outcome(id, 'muted')
      if (isHidden()) return outcome(id, 'hidden')
      if (failed || !canCreate()) return outcome(id, 'unsupported')
      if (ctx === null || ctx.state !== 'running' || stingers === null) return outcome(id, 'blocked')
      if (master === null || channel === null) {
        master = stingers.createMaster(ctx)
        channel = ctx.createGain()
        channel.connect(master)
      }
      if (opts.preempt === true) stopSounding()
      const now = ctx.currentTime
      const start = Math.max(now, busyUntil)
      if (start - now > MAX_SOUND_WAIT_S) return outcome(id, 'busy')
      busyUntil = start + stingers.scheduleStinger(ctx, channel!, id, start)
      return outcome(id, 'played')
    },
  }
}

/** The gestures that let a page start audio (a touch's activation comes on `pointerup`, a mouse's on `pointerdown`). */
const GESTURES = ['pointerdown', 'pointerup', 'keydown'] as const

/**
 * Listens for gestures on `target` (default: the window) and calls `engine.unlock()` on each one while the context is
 * not running — a phone suspends it again when the screen locks, so this stays attached (Ruling 8). Returns a remover.
 */
export function attachGestureUnlock(engine: SoundEngine, target?: EventTarget): () => void {
  const on: EventTarget | undefined = target ?? (typeof window === 'undefined' ? undefined : window)
  if (on === undefined) return () => {}
  const handler = (): void => {
    if (!engine.running) engine.unlock()
  }
  const options: AddEventListenerOptions = { capture: true, passive: true }
  for (const type of GESTURES) on.addEventListener(type, handler, options)
  return () => {
    for (const type of GESTURES) on.removeEventListener(type, handler, options)
  }
}
