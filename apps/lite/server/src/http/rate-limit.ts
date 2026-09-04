export interface RateLimitVerdict {
  allowed: boolean
  /** Seconds until the caller's window rolls over; 0 while they are under the limit. */
  retryAfterSec: number
}

export interface RateLimiter {
  check(key: string): RateLimitVerdict
}

interface Window {
  count: number
  resetAt: number
}

/** Above this many tracked keys a `check` also sweeps expired windows, so a scan of many IPs cannot grow the map without bound. */
const SWEEP_ABOVE = 1_000

/**
 * A fixed-window counter, per key, held in memory.
 *
 * Lite is a single process on one host, so there is nothing to share the state with; a fixed window
 * is a few lines and its worst case (2 × `limit` across a window boundary) is irrelevant for the
 * one thing this guards — `POST /api/session` creating players in bulk.
 */
export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? Date.now
  const windows = new Map<string, Window>()

  return {
    check(key) {
      const at = now()
      if (windows.size > SWEEP_ABOVE) {
        for (const [k, w] of windows) if (w.resetAt <= at) windows.delete(k)
      }
      const current = windows.get(key)
      const window = current && current.resetAt > at ? current : { count: 0, resetAt: at + opts.windowMs }
      windows.set(key, window)
      if (window.count >= opts.limit) return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((window.resetAt - at) / 1000)) }
      window.count += 1
      return { allowed: true, retryAfterSec: 0 }
    },
  }
}
