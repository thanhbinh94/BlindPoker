/**
 * The one-shot reputation backfill (Plan 27, spec §2 A6, R18; amendment P34): every account that played before
 * Plan 27 shipped gets the reputation its history already earned.
 *
 * For each player without a `backfill` event:
 *
 * ```
 * formula = (hands_played_holdem + hands_played_blind) × hand_played
 *         + (hands_won_holdem + hands_won_blind) × hand_won
 *         + total_login_days × daily_login
 *         + Σ over unlocked achievements of rules[achievementRuleFor(def)]
 * delta   = max(0, formula − Σ live deltas whose reason mirrors those counters)
 * ```
 *
 * **Only the mirroring reasons are subtracted** (P34): `hand_played`, `hand_won`, `daily_login`, `achievement` — the
 * events the live server wrote between `compose up` and this run, each standing for one rise of the counters the
 * formula reads. `welcome`, `newcomer_day` and `gm_grant` are not history the formula counts; subtracting them would
 * take a player's welcome gift back (a deviation from R18's wording, Ruling 9).
 *
 * **Idempotent.** A credited player gets one `reputation_events` row `('backfill', 'plan27')`, and a rerun skips them
 * (the unique `(player_id, reason, ref_id)` refuses a second one even if two runs race). A player whose live events
 * already reach the formula gets no row — the event table refuses a zero delta — and a rerun computes 0 again.
 *
 * Rules are read as stored (a missing key falls back to its seed); an achievement no longer in the catalogue pays
 * nothing. Rank is a high-water mark, as for every grant. No `RANK_UP` is sent (spec A3: the backfill does not
 * announce).
 */
import { silentLogger } from '@bp/server-kit'
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { AchievementDef } from '../achievements/definitions.js'
import type { AppDb, AppTx } from '../db/client.js'
import { playerAchievements, players, playerStats, reputationEvents } from '../db/schema.js'
import { createEventBus } from '../events.js'
import { createReputationService, type RuleKey } from './reputation-service.js'

export interface BackfillOptions {
  /** Compute and report, write nothing. */
  dryRun: boolean
  /** The reputation service's clock; only its view cache reads it. */
  now?: Date
  /** The achievement catalogue, which decides what each unlocked achievement pays. */
  defs: readonly AchievementDef[]
}

export interface BackfillResult {
  /** Accounts examined: every player without a `backfill` event when the run started. */
  players: number
  /** Reputation added in total (or that would be, in a dry run). */
  applied: number
  /** Players per rank 1..5 after the run (projected, in a dry run). */
  byRank: number[]
}

/** The live reasons that mirror `player_stats` / `player_achievements` — the only ones subtracted (P34). */
export const MIRRORED_REASONS = ['hand_played', 'hand_won', 'daily_login', 'achievement'] as const

const REF_ID = 'plan27'

export async function backfillReputation(db: AppDb, opts: BackfillOptions): Promise<BackfillResult> {
  const reputation = createReputationService({
    db,
    bus: createEventBus(silentLogger),
    notify: () => undefined,
    log: silentLogger,
    ...(opts.now ? { now: () => opts.now!.getTime() } : {}),
  })
  const rules = await reputation.rules()
  const ladder = await reputation.ranks()
  const payOf = new Map<string, number>(opts.defs.map((def) => [def.id, rules[reputation.achievementRuleFor(def)]]))

  /** What `playerId`'s history earns, minus what the live server already paid for it; read through `q`. */
  async function deltaOf(q: AppDb | AppTx, playerId: string): Promise<number> {
    const [stats] = await q
      .select({
        played: sql<number>`${playerStats.handsPlayedHoldem} + ${playerStats.handsPlayedBlind}`.mapWith(Number),
        won: sql<number>`${playerStats.handsWonHoldem} + ${playerStats.handsWonBlind}`.mapWith(Number),
        loginDays: playerStats.totalLoginDays,
      })
      .from(playerStats)
      .where(eq(playerStats.playerId, playerId))
    const unlocked = await q
      .select({ id: playerAchievements.achievementId })
      .from(playerAchievements)
      .where(and(eq(playerAchievements.playerId, playerId), isNotNull(playerAchievements.unlockedAt)))
    const [live] = await q
      .select({ total: sql<number>`coalesce(sum(${reputationEvents.delta}), 0)`.mapWith(Number) })
      .from(reputationEvents)
      .where(and(eq(reputationEvents.playerId, playerId), inArray(reputationEvents.reason, [...MIRRORED_REASONS])))

    const rule = (key: RuleKey): number => rules[key]
    let formula = 0
    if (stats !== undefined) formula += stats.played * rule('hand_played') + stats.won * rule('hand_won') + stats.loginDays * rule('daily_login')
    for (const a of unlocked) formula += payOf.get(a.id) ?? 0
    return Math.max(0, formula - (live?.total ?? 0))
  }

  const everyone = await db.select({ id: players.id, reputation: players.reputation, rank: players.rank }).from(players).orderBy(asc(players.id))
  const marked = new Set(
    (await db.select({ id: reputationEvents.playerId }).from(reputationEvents).where(and(eq(reputationEvents.reason, 'backfill'), eq(reputationEvents.refId, REF_ID)))).map(
      (r) => r.id,
    ),
  )
  const todo = everyone.filter((p) => !marked.has(p.id))

  let applied = 0
  const projected = new Map(everyone.map((p) => [p.id, p.rank]))
  for (const p of todo) {
    if (opts.dryRun) {
      const delta = await deltaOf(db, p.id)
      applied += delta
      if (delta > 0) projected.set(p.id, Math.max(p.rank, reputation.rankOf(p.reputation + delta, ladder)))
      continue
    }
    // One transaction per player, the row locked first: the live server's grants for this player wait, so the
    // subtraction and the credit see the same events.
    applied += await db.transaction(async (tx) => {
      await tx.select({ id: players.id }).from(players).where(eq(players.id, p.id)).for('update')
      const delta = await deltaOf(tx, p.id)
      if (delta === 0) return 0
      const grant = await reputation.grantWithin(tx, p.id, delta, 'backfill', REF_ID)
      return grant.applied ? delta : 0
    })
  }

  const byRank = [0, 0, 0, 0, 0]
  if (opts.dryRun) {
    for (const rank of projected.values()) byRank[Math.min(5, Math.max(1, rank)) - 1]! += 1
  } else {
    const rows = await db.select({ rank: players.rank, n: sql<number>`count(*)`.mapWith(Number) }).from(players).groupBy(players.rank)
    for (const row of rows) byRank[Math.min(5, Math.max(1, row.rank)) - 1]! += row.n
  }
  return { players: todo.length, applied, byRank }
}
