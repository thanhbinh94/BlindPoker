/**
 * The lifetime counters of spec §10.3, moved by events rather than by whoever wrote the row.
 *
 * The history repository stores hands; this module counts them. Keeping the two apart is what makes
 * `games` re-playable into a fresh database without inflating anyone's totals, and it is why the
 * only input here is the bus.
 *
 * **Every hand is one `UPDATE`.** The counters are computed by Postgres from the row's own previous
 * values (`greatest(best_win_streak, current_win_streak + 1)`), not read into JavaScript and written
 * back, so two hands settling at once cannot interleave a read with a write and lose one of them.
 * The `RETURNING` clause is then the post-update truth, which is exactly what the achievement
 * module needs to hear about.
 *
 * **Bots have no counters.** They have no `players` row at all, so they are skipped as subjects —
 * but their presence at the table is what `bot_hands` counts, which is a fact about the humans.
 *
 * **A hand nobody was paid for is not a hand played.** A cancelled hand moves no counter, and
 * neither does one whose settlement failed (`summary.settlementError`) — see `onHandSettled`.
 */
import type { HandSummary } from '@bp/server-kit'
import { eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AppDb } from '../db/client.js'
import { playerStats } from '../db/schema.js'
import type { AppEvent, AppEventBus } from '../events.js'
import { isUuid } from '../repos/util.js'
import { isChaosHand } from './chaos-hand.js'
import { zeroStats, type PlayerStats, type StatMetric } from './player-stats.js'

export interface StatsService {
  get(playerId: string): Promise<PlayerStats>
  /** Subscribes to the bus. Returns the unsubscribe function. */
  start(): () => void
}

export interface StatsServiceDeps {
  db: AppDb
  bus: AppEventBus
}

/** The columns of one `player_stats` update, keyed by the metric name they belong to. */
type Patch = Partial<Record<StatMetric, SQL | number>>

const COLUMNS = {
  handsPlayedHoldem: playerStats.handsPlayedHoldem,
  handsWonHoldem: playerStats.handsWonHoldem,
  handsPlayedBlind: playerStats.handsPlayedBlind,
  handsWonBlind: playerStats.handsWonBlind,
  botHands: playerStats.botHands,
  currentWinStreak: playerStats.currentWinStreak,
  bestWinStreak: playerStats.bestWinStreak,
  currentLoseStreak: playerStats.currentLoseStreak,
  bestLoseStreak: playerStats.bestLoseStreak,
  bestHandRank: playerStats.bestHandRank,
  biggestWin: playerStats.biggestWin,
  roomsJoined: playerStats.roomsJoined,
  gamesCompleted: playerStats.gamesCompleted,
  totalLoginDays: playerStats.totalLoginDays,
  loginStreak: playerStats.loginStreak,
  bestLoginStreak: playerStats.bestLoginStreak,
} as const satisfies Record<StatMetric, unknown>

/** `column + n`, evaluated against the row's pre-update value. */
function inc(metric: StatMetric, by = 1): SQL {
  return sql`${COLUMNS[metric]} + ${by}`
}

/** `greatest(column, value)` — a high-water mark that can only ever move up. */
function atLeast(metric: StatMetric, value: number): SQL {
  return sql`greatest(${COLUMNS[metric]}, ${value})`
}

/**
 * What one seat in one settled hand does to that player's counters.
 *
 * Pure, and returned as a patch rather than applied, so the whole rule set of §10.3 is readable in
 * one place and testable without a database.
 */
export function patchForHand(summary: HandSummary, seat: { net: number; won: boolean; bestCategory: number | null }): Patch {
  const patch: Patch = { gamesCompleted: inc('gamesCompleted') }
  // Plan 37: a Poker hỗn loạn hand is played, not won. Cards bend its result, so it feeds no win count, record or streak,
  // and a chaos hand neither extends a streak nor breaks one: the streaks simply skip it.
  const chaos = isChaosHand(summary)

  if (summary.mode === 'holdem') {
    patch.handsPlayedHoldem = inc('handsPlayedHoldem')
    if (seat.won) patch.handsWonHoldem = inc('handsWonHoldem')
  } else {
    patch.handsPlayedBlind = inc('handsPlayedBlind')
    if (seat.won && !chaos) patch.handsWonBlind = inc('handsWonBlind')
  }

  // "Played against a bot", counted once per hand however many bots were at the table.
  if (summary.players.some((p) => p.isBot)) patch.botHands = inc('botHands')
  if (chaos) return patch

  if (seat.net > 0) patch.biggestWin = atLeast('biggestWin', seat.net)
  // §10.3: the best category ever *won* with. A monster hand that lost to a better one is not a
  // record of anything, and counting it would let a player unlock `hand_royal` by folding into one.
  if (seat.won && seat.bestCategory !== null) patch.bestHandRank = atLeast('bestHandRank', seat.bestCategory)

  if (seat.won) {
    patch.currentWinStreak = inc('currentWinStreak')
    patch.bestWinStreak = sql`greatest(${COLUMNS.bestWinStreak}, ${COLUMNS.currentWinStreak} + 1)`
    patch.currentLoseStreak = 0
  } else {
    patch.currentLoseStreak = inc('currentLoseStreak')
    patch.bestLoseStreak = sql`greatest(${COLUMNS.bestLoseStreak}, ${COLUMNS.currentLoseStreak} + 1)`
    patch.currentWinStreak = 0
  }

  return patch
}

export function createStatsService(deps: StatsServiceDeps): StatsService {
  /**
   * Applies a patch and announces it.
   *
   * `changedMetrics` is the set of columns the statement *wrote*, not the set whose value actually
   * moved — a `greatest()` that changed nothing is still reported. Over-reporting costs the
   * achievement module one comparison against a threshold it has already passed or not reached;
   * under-reporting would lose an unlock, which is not recoverable without a backfill.
   */
  async function apply(playerId: string, patch: Patch): Promise<void> {
    if (!isUuid(playerId)) return
    const metrics = Object.keys(patch) as StatMetric[]
    if (metrics.length === 0) return

    const updated = await deps.db
      .update(playerStats)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(playerStats.playerId, playerId))
      .returning({ playerId: playerStats.playerId })
    // No row means no such player — an account erased between the hand and its bookkeeping. There
    // is nothing to count and nothing to announce.
    if (updated.length === 0) return

    await deps.bus.publish({ type: 'STATS_UPDATED', playerId, changedMetrics: metrics })
  }

  async function onHandSettled(summary: HandSummary): Promise<void> {
    // A cancelled hand is stored for an operator to look at, but nobody played it to a conclusion:
    // it is not a game completed, a hand played, or a streak broken.
    //
    // A hand whose settlement *failed* is the same thing for the same reason: `balances.apply`
    // threw, so no point moved, and counting it would move `hands_won_*`, `biggest_win` and the
    // streaks for a hand nobody was paid for — and an achievement evaluated on those counters can
    // then pay a real, ledgered credit (`big_win_500k` is 30,000 points) for a win the ledger says
    // never happened. A hand nobody was paid for is not a hand played. The row is still in `games`
    // with its `settlement_error`, and `app.ts` logs it, so the operator reconciles from there.
    if (summary.cancelled || summary.settlementError !== undefined) return
    for (const seat of summary.players) {
      if (seat.isBot) continue
      await apply(seat.playerId, patchForHand(summary, seat))
    }
  }

  const handle = async (e: AppEvent): Promise<void> => {
    switch (e.type) {
      case 'HAND_SETTLED':
        await onHandSettled(e.summary)
        return
      case 'ROOM_JOINED':
        await apply(e.playerId, { roomsJoined: inc('roomsJoined') })
        return
      case 'DAILY_CLAIMED':
        // The check-in is what a "login day" means (ruling for §10.3): signing in twice in one day
        // is not two days, and the claim is the once-a-day event that already knows the streak. The streak is the
        // run of consecutive days, not the month's claim count (§13.1 as amended by Plan 27 Part G): a missed day no
        // longer sets the calendar back, but it still breaks the run `login_streak_7` and `login_streak_28` count.
        await apply(e.playerId, {
          totalLoginDays: inc('totalLoginDays'),
          loginStreak: e.consecutive,
          bestLoginStreak: atLeast('bestLoginStreak', e.consecutive),
        })
        return
      default:
        return
    }
  }

  return {
    async get(playerId) {
      if (!isUuid(playerId)) return zeroStats()
      const [row] = await deps.db.select(COLUMNS).from(playerStats).where(eq(playerStats.playerId, playerId))
      if (row === undefined) return zeroStats()
      // `biggest_win` is a bigint; every other counter is an integer. `Number` over the lot keeps
      // one shape rather than one type per column.
      return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)])) as unknown as PlayerStats
    },

    start: () => deps.bus.subscribe(handle),
  }
}
