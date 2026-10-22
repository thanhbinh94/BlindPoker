/**
 * Reputation (Plan 27, spec §2 A1–A3, A5): a per-account number that only ever grows, and the rank 1..5 it has reached.
 *
 * **Not points.** Reputation never enters `point_transactions`, is never part of `Σ balances + Σ sinks`, is never
 * bought, moved between players or taken away — a GM can only add to it. Its ledger is `reputation_events`, and
 * `players.reputation` is that ledger's materialised total, written in the **same transaction** as the event.
 *
 * **Once per event.** Every grant names `(reason, ref_id)`, and the unique `(player_id, reason, ref_id)` turns a replay —
 * a hand settled twice, a retried claim, an achievement unlocked by a GM after the player earned it — into a no-op:
 * the `INSERT … ON CONFLICT DO NOTHING` returns no row and nothing is added.
 *
 * **Rank is a high-water mark.** `rank = GREATEST(rank, rankOf(reputation))`: a GM raising a threshold above a player's
 * reputation never takes a rank back (spec R15).
 *
 * **Inside a caller's transaction everything is read through `tx`.** PGlite has one connection, so a read on `db` while
 * a transaction holds it waits forever; `grantRuleWithin` reads the rule and the ladder through `tx`. `rules()` and
 * `ranks()` (on `db`, cached for a few seconds) are for views only.
 *
 * **Announced after commit.** `grantWithin` returns `rankUp` and leaves the `RANK_UP` notification to its caller, who
 * knows when the transaction committed; `grant` owns its transaction and announces itself.
 */
import type { HandSummary, Logger } from '@bp/server-kit'
import { asc, eq, sql } from 'drizzle-orm'
import type { AchievementDef } from '../achievements/definitions.js'
import type { AppDb, AppTx } from '../db/client.js'
import { players, reputationEvents, reputationRanks, reputationRules } from '../db/schema.js'
import { ServiceError } from '../errors.js'
import type { AppEvent, AppEventBus } from '../events.js'
import { UnknownPlayerError } from '../repos/index.js'
import { isUuid } from '../repos/util.js'

export type ReputationReason = 'hand_played' | 'hand_won' | 'daily_login' | 'achievement' | 'welcome' | 'newcomer_day' | 'gm_grant' | 'backfill'

export const RULE_KEYS = ['hand_played', 'hand_won', 'daily_login', 'achievement_small', 'achievement_big', 'achievement_item', 'welcome', 'newcomer_day7'] as const
export type RuleKey = (typeof RULE_KEYS)[number]

export interface RankRow {
  rank: 1 | 2 | 3 | 4 | 5
  threshold: number
}

export interface ReputationGrant {
  /** The player's reputation after this call. */
  reputation: number
  /** The player's rank after this call (the high-water mark). */
  rank: number
  /** True when this call raised `players.rank`; the caller announces `RANK_UP` after its commit. */
  rankUp: boolean
  /** False when nothing was written: a replayed `(reason, refId)`, or an amount of 0. */
  applied: boolean
}

export type RankUpMessage = { t: 'NOTIFICATION'; kind: 'RANK_UP'; payload: { rank: number } }

export interface ReputationService {
  /** What each source pays. Read-through with a cache of at most 5 s — for views; never call it inside a transaction. */
  rules(): Promise<Record<RuleKey, number>>
  /** The ladder, ascending by rank. Same cache and the same warning as `rules()`. */
  ranks(): Promise<RankRow[]>
  /** Drops the cache behind `rules()` and `ranks()` — for a writer that commits outside `setRules`/`setRanks`' reach. */
  invalidate(): void
  /** The highest rank whose threshold `reputation` reaches; 1 when none does. */
  rankOf(reputation: number, ranks: readonly RankRow[]): number
  /** Which rule an unlock pays: an item reward → `achievement_item`; points > 5 000 → `achievement_big`; else small. */
  achievementRuleFor(def: AchievementDef): RuleKey
  /** Adds `delta` inside the caller's transaction — the GM grant and the backfill. A non-positive delta is a no-op. */
  grantWithin(tx: AppTx, playerId: string, delta: number, reason: ReputationReason, refId: string): Promise<ReputationGrant>
  /** Adds what rule `key` pays, read through `tx`. A rule of 0 is a no-op (the event table refuses a zero delta). */
  grantRuleWithin(tx: AppTx, playerId: string, key: RuleKey, reason: ReputationReason, refId: string): Promise<ReputationGrant>
  /** `grantWithin` in a transaction of its own, announcing `RANK_UP` after the commit. */
  grant(playerId: string, delta: number, reason: ReputationReason, refId: string): Promise<ReputationGrant>
  /** Pushes `RANK_UP` to the player — for a caller of `grantWithin`/`grantRuleWithin`, after its commit. */
  announceRankUp(playerId: string, rank: number): void
  /** Writes the given rules (integers ≥ 0, known keys only). Throws `ServiceError('INVALID_RULES')`. */
  setRules(tx: AppTx, patch: Partial<Record<RuleKey, number>>, updatedBy: string): Promise<void>
  /** Replaces the ladder. Throws `RankOrderError` unless ranks 1..5 are all there, rank 1 is 0 and thresholds strictly rise. */
  setRanks(tx: AppTx, ranks: RankRow[], updatedBy: string): Promise<void>
  /** `seedDefaults(db)`: the migration's seeds, never overwriting a row. */
  seedDefaults(): Promise<void>
  /** Subscribes to `HAND_SETTLED`. Returns the unsubscribe function. */
  start(): () => void
}

export interface ReputationServiceDeps {
  db: AppDb
  bus: AppEventBus
  notify: (playerId: string, msg: RankUpMessage) => void
  log: Logger
  now?: () => number
}

/** The seeds of `0006_plan27.sql` (spec A2). */
export const DEFAULT_RULES: Readonly<Record<RuleKey, number>> = {
  hand_played: 1,
  hand_won: 3,
  daily_login: 10,
  achievement_small: 50,
  achievement_big: 150,
  achievement_item: 500,
  welcome: 100,
  newcomer_day7: 200,
}

/** The seeds of `0006_plan27.sql` (spec A3). */
export const DEFAULT_RANKS: readonly RankRow[] = [
  { rank: 1, threshold: 0 },
  { rank: 2, threshold: 100 },
  { rank: 3, threshold: 400 },
  { rank: 4, threshold: 1_800 },
  { rank: 5, threshold: 5_000 },
]

/** Points above this make an achievement "big" (spec A2). */
const SMALL_ACHIEVEMENT_MAX_POINTS = 5_000
const CACHE_MS = 5_000

/** A ladder a GM may not save: a rank missing, rank 1 not at 0, or a threshold that does not rise. */
export class RankOrderError extends ServiceError {
  constructor(message: string) {
    super('INVALID_RANKS', message)
    this.name = 'RankOrderError'
  }
}

/** Inserts the migration's rules and ranks where a row is missing; a GM's edit is never overwritten. Idempotent. */
export async function seedDefaults(db: AppDb | AppTx): Promise<void> {
  await db
    .insert(reputationRules)
    .values(RULE_KEYS.map((key) => ({ key, amount: DEFAULT_RULES[key] })))
    .onConflictDoNothing()
  await db
    .insert(reputationRanks)
    .values(DEFAULT_RANKS.map((r) => ({ ...r })))
    .onConflictDoNothing()
}

/** Which rule an unlock pays (spec A2): an item reward → item; points above 5 000 → big; otherwise small. */
export function achievementRuleFor(def: AchievementDef): RuleKey {
  if (def.reward.itemId !== undefined) return 'achievement_item'
  return (def.reward.points ?? 0) > SMALL_ACHIEVEMENT_MAX_POINTS ? 'achievement_big' : 'achievement_small'
}

export function rankOf(reputation: number, ranks: readonly RankRow[]): number {
  let rank = 1
  for (const r of ranks) if (reputation >= r.threshold && r.rank > rank) rank = r.rank
  return rank
}

const isRuleKey = (key: string): key is RuleKey => (RULE_KEYS as readonly string[]).includes(key)

/** The stored rules, a missing key falling back to its seed (a database that predates a key still pays it). */
async function readRules(q: AppDb | AppTx): Promise<Record<RuleKey, number>> {
  const rows = await q.select({ key: reputationRules.key, amount: reputationRules.amount }).from(reputationRules)
  const out: Record<RuleKey, number> = { ...DEFAULT_RULES }
  for (const row of rows) if (isRuleKey(row.key)) out[row.key] = row.amount
  return out
}

/** The stored ladder, ascending; the seeds when the table is empty. */
async function readRanks(q: AppDb | AppTx): Promise<RankRow[]> {
  const rows = await q.select({ rank: reputationRanks.rank, threshold: reputationRanks.threshold }).from(reputationRanks).orderBy(asc(reputationRanks.rank))
  if (rows.length === 0) return DEFAULT_RANKS.map((r) => ({ ...r }))
  return rows.map((r) => ({ rank: r.rank as RankRow['rank'], threshold: r.threshold }))
}

function checkLadder(ranks: readonly RankRow[]): RankRow[] {
  const sorted = [...ranks].sort((a, b) => a.rank - b.rank)
  if (sorted.length !== 5 || sorted.some((r, i) => r.rank !== i + 1)) throw new RankOrderError('the ladder must name ranks 1 to 5 once each')
  for (const r of sorted) {
    if (!Number.isInteger(r.threshold) || r.threshold < 0) throw new RankOrderError(`rank ${String(r.rank)} needs a whole threshold of 0 or more`)
  }
  if (sorted[0]!.threshold !== 0) throw new RankOrderError('rank 1 starts at 0')
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]!.threshold <= sorted[i - 1]!.threshold) throw new RankOrderError(`rank ${String(sorted[i]!.rank)} must start above rank ${String(sorted[i - 1]!.rank)}`)
  }
  return sorted
}

export function createReputationService(deps: ReputationServiceDeps): ReputationService {
  const now = deps.now ?? Date.now
  let rulesCache: { at: number; value: Record<RuleKey, number> } | null = null
  let ranksCache: { at: number; value: RankRow[] } | null = null

  /** The player's standing, locked for the caller's transaction so the rank computed from it stays true. */
  async function lockStanding(tx: AppTx, playerId: string): Promise<{ reputation: number; rank: number }> {
    if (!isUuid(playerId)) throw new UnknownPlayerError(playerId)
    const [row] = await tx.select({ reputation: players.reputation, rank: players.rank }).from(players).where(eq(players.id, playerId)).for('update')
    if (row === undefined) throw new UnknownPlayerError(playerId)
    return row
  }

  async function applyWithin(tx: AppTx, playerId: string, delta: number, reason: ReputationReason, refId: string): Promise<ReputationGrant> {
    if (!Number.isFinite(delta)) throw new ServiceError('INVALID_AMOUNT', 'reputation is added in whole numbers')
    const before = await lockStanding(tx, playerId)
    // `reputation_events.delta > 0`: a zero (a source a GM switched off) writes nothing rather than rolling the
    // caller's transaction back.
    if (delta <= 0) return { ...before, rankUp: false, applied: false }
    if (!Number.isInteger(delta)) throw new ServiceError('INVALID_AMOUNT', 'reputation is added in whole numbers')

    const inserted = await tx.insert(reputationEvents).values({ playerId, delta, reason, refId }).onConflictDoNothing().returning({ id: reputationEvents.id })
    if (inserted.length === 0) return { ...before, rankUp: false, applied: false }

    const ladder = await readRanks(tx)
    const target = Math.max(before.rank, rankOf(before.reputation + delta, ladder))
    const [after] = await tx
      .update(players)
      .set({ reputation: sql`${players.reputation} + ${delta}`, rank: sql`greatest(${players.rank}, ${target})` })
      .where(eq(players.id, playerId))
      .returning({ reputation: players.reputation, rank: players.rank })
    return { reputation: after!.reputation, rank: after!.rank, rankUp: after!.rank > before.rank, applied: true }
  }

  async function ruleWithin(tx: AppTx, key: RuleKey): Promise<number> {
    const [row] = await tx.select({ amount: reputationRules.amount }).from(reputationRules).where(eq(reputationRules.key, key))
    return row?.amount ?? DEFAULT_RULES[key]
  }

  const grantRuleWithin: ReputationService['grantRuleWithin'] = async (tx, playerId, key, reason, refId) =>
    applyWithin(tx, playerId, await ruleWithin(tx, key), reason, refId)

  const announceRankUp = (playerId: string, rank: number): void => {
    deps.notify(playerId, { t: 'NOTIFICATION', kind: 'RANK_UP', payload: { rank } })
  }

  /**
   * One seat of one settled hand: `hand_played`, plus `hand_won` for a winner, in one transaction of its own — a seat
   * per transaction, so it only ever locks one `players` row and cannot deadlock against a settlement.
   */
  async function paySeat(playerId: string, won: boolean, handId: string): Promise<void> {
    let last: ReputationGrant
    try {
      last = await deps.db.transaction(async (tx) => {
        let grant = await grantRuleWithin(tx, playerId, 'hand_played', 'hand_played', handId)
        let rankUp = grant.rankUp
        if (won) {
          grant = await grantRuleWithin(tx, playerId, 'hand_won', 'hand_won', handId)
          rankUp ||= grant.rankUp
        }
        return { ...grant, rankUp }
      })
    } catch (err) {
      // An account erased between the hand and its bookkeeping: nothing to add to, nothing to announce.
      if (err instanceof UnknownPlayerError) return
      throw err
    }
    if (last.rankUp) announceRankUp(playerId, last.rank)
  }

  async function onHandSettled(summary: HandSummary): Promise<void> {
    // The rule of `stats-service.ts`: a cancelled hand, or one nobody was paid for, is not a hand played.
    if (summary.cancelled || summary.settlementError !== undefined) return
    for (const seat of summary.players) {
      // Bots have no reputation (and no `players` row).
      if (seat.isBot || !isUuid(seat.playerId)) continue
      // One seat's failure (a dropped connection, a lock timeout) must not starve the seats after it: nothing retries
      // a settled hand, so each seat is paid or logged on its own.
      try {
        await paySeat(seat.playerId, seat.won, summary.handId)
      } catch (err) {
        deps.log.warn('reputation for a hand failed', { handId: summary.handId, playerId: seat.playerId, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  const handle = async (e: AppEvent): Promise<void> => {
    if (e.type === 'HAND_SETTLED') await onHandSettled(e.summary)
  }

  return {
    async rules() {
      if (rulesCache !== null && now() - rulesCache.at < CACHE_MS) return { ...rulesCache.value }
      const value = await readRules(deps.db)
      rulesCache = { at: now(), value }
      return { ...value }
    },

    async ranks() {
      if (ranksCache !== null && now() - ranksCache.at < CACHE_MS) return ranksCache.value.map((r) => ({ ...r }))
      const value = await readRanks(deps.db)
      ranksCache = { at: now(), value }
      return value.map((r) => ({ ...r }))
    },

    invalidate() {
      rulesCache = null
      ranksCache = null
    },

    rankOf,
    achievementRuleFor,

    grantWithin: applyWithin,
    grantRuleWithin,

    async grant(playerId, delta, reason, refId) {
      const result = await deps.db.transaction((tx) => applyWithin(tx, playerId, delta, reason, refId))
      if (result.rankUp) announceRankUp(playerId, result.rank)
      return result
    },

    announceRankUp,

    async setRules(tx, patch, updatedBy) {
      const entries = Object.entries(patch)
      for (const [key, amount] of entries) {
        if (!isRuleKey(key)) throw new ServiceError('INVALID_RULES', `not a reputation rule: ${key}`)
        if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) throw new ServiceError('INVALID_RULES', `${key} must be a whole number of 0 or more`)
      }
      const at = new Date(now())
      for (const [key, amount] of entries) {
        await tx
          .insert(reputationRules)
          .values({ key, amount: amount as number, updatedBy, updatedAt: at })
          .onConflictDoUpdate({ target: reputationRules.key, set: { amount: amount as number, updatedBy, updatedAt: at } })
      }
      rulesCache = null
    },

    async setRanks(tx, ranks, updatedBy) {
      const ladder = checkLadder(ranks)
      const at = new Date(now())
      for (const r of ladder) {
        await tx
          .insert(reputationRanks)
          .values({ rank: r.rank, threshold: r.threshold, updatedBy, updatedAt: at })
          .onConflictDoUpdate({ target: reputationRanks.rank, set: { threshold: r.threshold, updatedBy, updatedAt: at } })
      }
      ranksCache = null
    },

    seedDefaults: () => seedDefaults(deps.db),

    start: () => deps.bus.subscribe(handle),
  }
}
