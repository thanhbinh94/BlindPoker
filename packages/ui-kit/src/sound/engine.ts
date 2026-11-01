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
  /**
   * Cut an entrance's stinger (sounding or waiting) and start now: the BP-41 moments cut an entrance short (A9, Ruling 3). A
   * moment never cuts a moment: while one sounds or waits, this play queues behind it like any other (spec §5.2, the later waits).
   */
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
  /**
   * Fades out an entrance's stinger, sounding or waiting (its band put away or cut short). While a BP-41 moment sounds or waits,
   * it does nothing: a moment is never stopped, nor what is queued with it.
   */
  stop(): void
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
/** A stinger starts this far after `currentTime`, so its first attack never lands in the past (Ruling 9). */
export const SOUND_LEAD_S = 0.02
/** Mute, preempt and stop fade the old channel out over this long, then drop it after `STOP_DROP_MS`. */
const STOP_FADE_S = 0.015
const STOP_DROP_MS = 60
/** A lazy load of the stingers that fails is tried again on later gestures, this many times in all. */
export const MAX_LOAD_ATTEMPTS = 3

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
  let loadFailures = 0
  let master: AudioNode | null = null
  let channel: GainNode | null = null
  let busyUntil = 0
  /** Until when (ctx seconds) a BP-41 moment sounds or waits: before then, neither a preempt nor `stop()` cuts the channel. */
  let momentUntil = 0

  /**
   * Silences what sounds and what waits: the channel fades to 0 in `STOP_FADE_S` (a cut would click), is dropped from
   * the master a moment later, and a fresh channel takes its place at once.
   */
  const stopSounding = (): void => {
    busyUntil = 0
    momentUntil = 0
    if (ctx === null || channel === null || master === null) return
    const old = channel
    channel = null
    try {
      const now = ctx.currentTime
      old.gain.cancelScheduledValues(now)
      old.gain.setValueAtTime(old.gain.value, now)
      old.gain.linearRampToValueAtTime(0, now + STOP_FADE_S)
    } catch {
      // a context that refuses automation: the disconnect below still silences it
    }
    setTimeout(() => {
      try {
        old.disconnect()
      } catch {
        // already disconnected
      }
    }, STOP_DROP_MS)
    try {
      const fresh = ctx.createGain()
      fresh.connect(master)
      channel = fresh
    } catch {
      // the next play builds the channel again
    }
  }

  const load = (): void => {
    if (stingers !== null || loading || loadFailures >= MAX_LOAD_ATTEMPTS) return
    loading = true
    loadStingers().then(
      (module) => {
        loading = false
        // a chunk that resolves to nothing counts as a failed load: kept, it would throw on the first play
        if (module) stingers = module
        else loadFailures += 1
      },
      () => {
        loading = false
        loadFailures += 1 // the next gesture tries again, up to MAX_LOAD_ATTEMPTS in all
      },
    )
  }

  /** A BP-41 moment sounds or waits on the channel now. */
  const momentAhead = (): boolean => ctx !== null && ctx.currentTime < momentUntil

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
      if (failed || loadFailures >= MAX_LOAD_ATTEMPTS || !canCreate()) return outcome(id, 'unsupported')
      if (ctx === null || ctx.state !== 'running' || stingers === null) return outcome(id, 'blocked')
      // A browser that lacks a node the stingers use (old Safari's webkitAudioContext has no StereoPanner) throws while
      // scheduling: that throw must never reach React. What was half built fades out with the channel.
      try {
        if (master === null) master = stingers.createMaster(ctx)
        if (channel === null) {
          const fresh = ctx.createGain()
          fresh.connect(master)
          channel = fresh
        }
        if (opts.preempt === true && !momentAhead()) stopSounding()
        const now = ctx.currentTime
        const start = Math.max(now + SOUND_LEAD_S, busyUntil)
        if (start - now > MAX_SOUND_WAIT_S) return outcome(id, 'busy')
        busyUntil = start + stingers.scheduleStinger(ctx, channel!, id, start)
        if (!id.startsWith('entrance.')) momentUntil = busyUntil
        return outcome(id, 'played')
      } catch {
        stopSounding()
        return outcome(id, 'unsupported')
      }
    },
    stop(): void {
      if (!momentAhead()) stopSounding()
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
