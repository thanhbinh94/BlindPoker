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
 * `DAILY_CLAIMED` carries the day, streak and consecutive run so `stats` never has to re-read the row the economy
 * service just wrote; `STATS_UPDATED` names the metrics that were written so `achievements` can
 * consider a handful of definitions instead of all thirty-two.
 *
 * There is deliberately no `LOGIN` event. A "login day" is the daily check-in (§10.3 ruling), not a
 * sign-in, so nothing subscribed to one — and an event with no subscriber is wiring that looks like
 * a contract. `auth-service` still takes an optional `onLogin` hook; `app.ts` passes none.
 */
export type AppEvent =
  | DomainEvent
  /** `streak` is the month's claim count, `consecutive` the run of calendar days (§13.1 as amended by Plan 27 Part G). */
  | { type: 'DAILY_CLAIMED'; playerId: string; day: number; streak: number; consecutive: number }
  | { type: 'STATS_UPDATED'; playerId: string; changedMetrics: StatMetric[] }

export type AppEventHandler = (e: AppEvent) => Promise<void> | void

export interface AppEventBus {
  publish(e: AppEvent): Promise<void>
  /** Returns an unsubscribe function. Calling it twice is harmless. */
  subscribe(fn: AppEventHandler): () => void
  /**
   * Resolves once every publish that has already started has finished.
   *
   * The point of a fire-and-forget publish is that the game loop does not wait for bookkeeping —
   * but *shutdown* must, or the `player_stats` update and the achievement evaluation for the last
   * hand of the drain land on a pool that is already closing, and a subscriber failure is only ever
   * logged. `close()` awaits this between shutting the listener and closing the database.
   *
   * Loops rather than awaiting one snapshot: a subscriber may publish an event of its own (a stats
   * write raises `STATS_UPDATED`), and that publish is in flight only after the first one resolves.
   */
  idle(): Promise<void>
}

export function createEventBus(log: Logger): AppEventBus {
  const handlers: AppEventHandler[] = []
  const inFlight = new Set<Promise<void>>()

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

    publish(e) {
      const running = (async () => {
        // A snapshot, because a subscriber is allowed to unsubscribe itself (or another) while the
        // event is in flight — splicing the array under the loop would otherwise skip the next one.
        for (const fn of [...handlers]) {
          try {
            await fn(e)
          } catch (err) {
            log.error('event subscriber failed', { event: e.type, error: err instanceof Error ? err.message : String(err) })
          }
        }
      })()
      // Registered synchronously, so a caller that never awaits the returned promise — which is
      // every `void bus.publish(e)` in the room path — is still visible to `idle()`.
      inFlight.add(running)
      void running.finally(() => inFlight.delete(running))
      return running
    },

    async idle() {
      // `publish` never rejects (every subscriber error is caught above), so there is nothing here
      // to guard against; the loop exists for publishes a subscriber started.
      while (inFlight.size > 0) await Promise.all([...inFlight])
    },
  }
}
