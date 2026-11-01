import type { HeraldHold } from './useHeldWindow.js'

/** How long an entrance band stays up (BP-42 spec §4). */
export const ENTRANCE_MS = 3_000
/** At most this many entrances showing or waiting together — the one on screen counts (Ruling 2); one more is dropped. */
export const ENTRANCE_QUEUE_MAX = 3
/** An entrance that would start later than this after its arrival is dropped: it is old news by then. */
export const ENTRANCE_STALE_MS = 10_000
/** A moment older than this when it first shows makes no sound (a snapshot, a reconnect, a remount, a long wait). */
export const FRESH_MS = 1_000

/** A stretch of client time, `[from, until)`. */
export interface Span {
  from: number
  until: number
}

/** Where an entrance falls: its span on the band, `'waiting'` behind an open hold, or `'dropped'`. */
export type EntranceSlot = Span | 'dropped' | 'waiting'

/** Where an entrance blocked by `blockers` from `from` on is cut short: at the first one that overlaps it (at `from` itself if one already runs). */
function cutAt(span: Span, blockers: readonly Span[]): number {
  let until = span.until
  for (const b of blockers) if (b.from < until && span.from < b.until) until = Math.max(span.from, Math.min(until, b.from))
  return until
}

/** The earliest `t ≥ from` such that `[t, t + ENTRANCE_MS)` meets no blocker; `Infinity` when an open blocker stands in the way. */
function firstFree(from: number, blockers: readonly Span[]): number {
  let t = from
  for (let moved = true; moved && Number.isFinite(t); ) {
    moved = false
    for (const b of blockers) {
      if (b.from < t + ENTRANCE_MS && t < b.until) {
        t = b.until
        moved = true
      }
    }
  }
  return t
}

/**
 * Pure: where each entrance falls, given what else holds the band (spec 2026-11-01 §4).
 *
 * - In arrival order (`id`), one at a time, each for `ENTRANCE_MS`, in the first stretch that long free of every `busy` span (the
 *   BP-41 heralds' windows, the dice windows) and of the reveal `hold` (open: until it ends).
 * - One arriving while `ENTRANCE_QUEUE_MAX` others are showing or waiting is `'dropped'` (the one on screen counts, Ruling 2).
 * - One whose start would be later than `at + ENTRANCE_STALE_MS` is `'dropped'`; an open hold leaves it `'waiting'` until then.
 * - One already on screen (`started`: id → when it first showed) keeps its `from`, and is cut short when a busy span or the hold
 *   begins inside it — the BP-41 band wins (Ruling 3).
 * - One put away (`ended`: id → when it was dismissed) ends then: it frees the band and leaves the queue (A8).
 *
 * An entrance dropped as stale still counted as waiting until it went stale, so a later arrival's fate does not flip as time runs.
 */
export function scheduleEntrances(
  entrances: readonly { id: number; at: number }[],
  busy: readonly Span[],
  hold: HeraldHold | null,
  started: ReadonlyMap<number, number>,
  ended: ReadonlyMap<number, number>,
  now: number,
): Map<number, EntranceSlot> {
  const blockers: Span[] = hold === null ? [...busy] : [...busy, { from: hold.since, until: hold.until ?? Number.POSITIVE_INFINITY }]
  const slots = new Map<number, EntranceSlot>()
  /** Until when each entrance placed so far holds a place in the queue. */
  const queued: number[] = []
  let free = Number.NEGATIVE_INFINITY
  for (const e of [...entrances].sort((a, b) => a.id - b.id)) {
    const from = started.get(e.id)
    const end = ended.get(e.id)
    if (from !== undefined) {
      const until = Math.min(cutAt({ from, until: from + ENTRANCE_MS }, blockers), end ?? Number.POSITIVE_INFINITY)
      slots.set(e.id, { from, until })
      queued.push(until)
      free = Math.max(free, until)
      continue
    }
    if (end !== undefined || queued.filter((until) => until > e.at).length >= ENTRANCE_QUEUE_MAX) {
      slots.set(e.id, 'dropped')
      continue
    }
    const start = firstFree(Math.max(e.at, free), blockers)
    const stale = e.at + ENTRANCE_STALE_MS
    if (!Number.isFinite(start)) {
      slots.set(e.id, now > stale ? 'dropped' : 'waiting')
      queued.push(now > stale ? stale : Number.POSITIVE_INFINITY)
      if (now <= stale) free = Number.POSITIVE_INFINITY
      continue
    }
    if (start > stale) {
      slots.set(e.id, 'dropped')
      queued.push(stale)
      continue
    }
    slots.set(e.id, { from: start, until: start + ENTRANCE_MS })
    queued.push(start + ENTRANCE_MS)
    free = start + ENTRANCE_MS
  }
  return slots
}
