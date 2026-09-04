/**
 * One process-local event bus.
 *
 * The progression layer is a chain of reactions — a settled hand moves counters, moved counters
 * unlock achievements, an unlocked achievement credits points and pushes a notification — and each
 * link is a module that has no business knowing about the next one. The bus is what lets `stats`
 * be written without ever naming `achievements`.
 *
 * Three properties are load-bearing, and each of them is a decision rather than an accident:
 *
 * **Sequential, in subscription order.** `stats` must have written the counters before
 * `achievements` reads them, so the wiring in `app.ts` calls `stats.start()` before
 * `achievements.start()` and the bus honours that order. Running subscribers concurrently would
 * make "did the counter land yet" a race with no fix at the call site.
 *
 * **`publish` resolves only after every subscriber has finished.** That is what makes a test able
 * to `await bus.publish(...)` and then assert on the database, and it is why the room actor calls
 * `void bus.publish(e)` — the game loop does not wait for progression bookkeeping.
 *
 * **A failing subscriber is logged, never rethrown.** An achievement that could not be granted must
 * not stop the next subscriber from running, and must not surface as an unhandled rejection inside
 * whatever published the event. The error is the bus's to absorb and record.
 */
import type { DomainEvent } from '@bp/server-kit'
import type { Logger } from '@bp/server-kit'
import type { StatMetric } from './stats/player-stats.js'

/**
 * `server-kit`'s domain events, re-published here, plus the ones this edition raises itself.
 *
 * `DAILY_CLAIMED` carries the day and streak so `stats` never has to re-read the row the economy
 * service just wrote; `STATS_UPDATED` names the metrics that were written so `achievements` can
 * consider a handful of definitions instead of all thirty-two.
 */
export type AppEvent =
  | DomainEvent
  | { type: 'DAILY_CLAIMED'; playerId: string; day: number; streak: number }
  | { type: 'LOGIN'; playerId: string; at: number }
  | { type: 'STATS_UPDATED'; playerId: string; changedMetrics: StatMetric[] }

export type AppEventHandler = (e: AppEvent) => Promise<void> | void

export interface AppEventBus {
  publish(e: AppEvent): Promise<void>
  /** Returns an unsubscribe function. Calling it twice is harmless. */
  subscribe(fn: AppEventHandler): () => void
}

export function createEventBus(log: Logger): AppEventBus {
  const handlers: AppEventHandler[] = []

  return {
    subscribe(fn) {
      handlers.push(fn)
      let removed = false
      return () => {
        if (removed) return
        removed = true
        const at = handlers.indexOf(fn)
        if (at !== -1) handlers.splice(at, 1)
      }
    },

    async publish(e) {
      // A snapshot, because a subscriber is allowed to unsubscribe itself (or another) while the
      // event is in flight — splicing the array under the loop would otherwise skip the next one.
      for (const fn of [...handlers]) {
        try {
          await fn(e)
        } catch (err) {
          log.error('event subscriber failed', { event: e.type, error: err instanceof Error ? err.message : String(err) })
        }
      }
    },
  }
}
