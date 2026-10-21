/**
 * Unlocking achievements (spec §14.1).
 *
 * The module listens for `STATS_UPDATED` — the app event `stats-service.ts` raises after each write
 * — rather than for the domain events themselves. That is deliberate: the counters have to be *in
 * the database* before a threshold is compared against them, and `changedMetrics` narrows thirty-odd
 * definitions down to the two or three a settled hand could possibly have moved.
 *
 * **Unlocking exactly once is the database's job.** The unlock is
 * `UPDATE … SET unlocked_at = $now WHERE … AND unlocked_at IS NULL RETURNING id`: the row that
 * comes back is the proof this call is the one that flipped it, and the reward is paid only on that
 * proof. Re-publishing the same event, replaying a backlog, or two events racing all fold into "no
 * row returned, nothing to pay".
 *
 * **Progress is written even when nothing unlocks**, so `GET /api/me/achievements` can draw a bar
 * rather than a locked padlock with no number on it.
 */
import type { ServerMessage } from '@bp/core'
import type { Logger, TxReason } from '@bp/server-kit'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { AppDb, AppTx } from '../db/client.js'
import { playerAchievements, players } from '../db/schema.js'
import type { AppEvent, AppEventBus } from '../events.js'
import type { InventoryService } from '../inventory/inventory-service.js'
import { creditWithin, type NormalRepositories } from '../repos/index.js'
import { isUuid } from '../repos/util.js'
import type { StatsService } from '../stats/stats-service.js'
import { byMetric, type AchievementDef } from './definitions.js'

export interface AchievementProgress {
  id: string
  progress: number
  target: number
  /** Epoch milliseconds, or null while the achievement is still in progress. */
  unlockedAt: number | null
}

export interface AchievementService {
  /** Every definition, with this player's progress against it — locked ones included. */
  list(playerId: string): Promise<AchievementProgress[]>
  /** Subscribes to the bus. Returns the unsubscribe function. */
  start(): () => void
}

export interface AchievementServiceDeps {
  db: AppDb
  repos: NormalRepositories
  inventory: InventoryService
  stats: StatsService
  bus: AppEventBus
  defs: AchievementDef[]
  log: Logger
  /**
   * Pushes a message to the player's live connection. A plain function rather than the `GameServer`
   * itself, so this module has no idea a WebSocket exists: Task 6 hands it `game.notify`.
   */
  notify: (playerId: string, msg: ServerMessage) => void
  onBalanceChanged: (playerId: string, balance: number) => void
  now?: () => number
}

/** The `source` recorded in `inventory` for an item that came from an achievement. */
const ACHIEVEMENT_SOURCE = 'achievement'

/**
 * Flips one achievement to unlocked and pays its whole reward inside the caller's transaction — the one code path
 * both the earning of an achievement and a GM's unlock of it go through, so the two cannot drift apart.
 *
 * The row is upserted first: a player who never made progress on this metric has no `player_achievements` row, and the
 * guarded UPDATE below would match nothing and report `'already'` for an achievement that was never unlocked.
 * `'already'` means the UPDATE found the row unlocked (nothing was paid); `'unlocked'` means this call flipped it.
 */
export async function unlockWithin(
  tx: AppTx,
  playerId: string,
  def: AchievementDef,
  at: Date,
  pay: { inventory: InventoryService; reason: TxReason; refId: string },
): Promise<'unlocked' | 'already'> {
  await tx.insert(playerAchievements).values({ playerId, achievementId: def.id }).onConflictDoNothing()
  // The `unlocked_at IS NULL` predicate is the whole idempotency argument: a second attempt
  // updates no rows and therefore pays nothing.
  const claimed = await tx
    .update(playerAchievements)
    .set({ unlockedAt: at })
    .where(
      and(
        eq(playerAchievements.playerId, playerId),
        eq(playerAchievements.achievementId, def.id),
        isNull(playerAchievements.unlockedAt),
      ),
    )
    .returning({ id: playerAchievements.achievementId })
  if (claimed.length === 0) return 'already'

  if (def.reward.points !== undefined) {
    await creditWithin(tx, [{ playerId, delta: def.reward.points, reason: pay.reason, refId: pay.refId }])
  }
  if (def.reward.itemId !== undefined) {
    await pay.inventory.grant(tx, playerId, def.reward.itemId, ACHIEVEMENT_SOURCE)
  }
  return 'unlocked'
}

export function createAchievementService(deps: AchievementServiceDeps): AchievementService {
  const now = deps.now ?? Date.now
  const index = byMetric(deps.defs)

  /**
   * Records progress for every definition in `defs`, then unlocks and pays the ones that have
   * reached their threshold.
   */
  async function evaluate(playerId: string, defs: AchievementDef[]): Promise<void> {
    if (defs.length === 0 || !isUuid(playerId)) return
    const stats = await deps.stats.get(playerId)

    // One upsert for the whole batch: progress is a display value, so there is nothing to gain from
    // a transaction per definition, and a single statement is one round trip instead of five.
    await deps.db
      .insert(playerAchievements)
      .values(defs.map((def) => ({ playerId, achievementId: def.id, progress: stats[def.metric] })))
      .onConflictDoUpdate({
        target: [playerAchievements.playerId, playerAchievements.achievementId],
        set: { progress: sql.raw(`excluded."progress"`) },
      })

    for (const def of defs) {
      if (stats[def.metric] < def.threshold) continue
      await unlock(playerId, def)
    }
  }

  async function unlock(playerId: string, def: AchievementDef): Promise<void> {
    const at = new Date(now())
    const outcome = await deps.db.transaction(async (tx) => {
      const result = await unlockWithin(tx, playerId, def, at, { inventory: deps.inventory, reason: 'achievement', refId: `ach:${playerId}:${def.id}` })
      if (result === 'already') return null
      if (def.reward.points === undefined) return { balance: null }
      // Read through `tx`, not `repos.balances.get`: that opens a connection of its own, which
      // under read-committed would still see the pre-credit balance this transaction has not
      // committed yet — and would announce a number that was never true.
      const [row] = await tx.select({ balance: players.balance }).from(players).where(eq(players.id, playerId))
      return { balance: row === undefined ? null : Number(row.balance) }
    })
    if (outcome === null) return
    deps.log.info('achievement unlocked', { playerId, achievement: def.id })

    // Announced only after the commit — a notification for an unlock that rolled back would be a
    // reward the player saw and never received.
    deps.notify(playerId, { t: 'NOTIFICATION', kind: 'ACHIEVEMENT_UNLOCKED', payload: { id: def.id, reward: def.reward } })
    if (outcome.balance !== null) deps.onBalanceChanged(playerId, outcome.balance)
  }

  const handle = async (e: AppEvent): Promise<void> => {
    if (e.type !== 'STATS_UPDATED') return
    const relevant = new Map<string, AchievementDef>()
    for (const metric of e.changedMetrics) {
      for (const def of index.get(metric) ?? []) relevant.set(def.id, def)
    }
    await evaluate(e.playerId, [...relevant.values()])
  }

  return {
    async list(playerId) {
      const rows = isUuid(playerId)
        ? await deps.db
            .select({
              achievementId: playerAchievements.achievementId,
              progress: playerAchievements.progress,
              unlockedAt: playerAchievements.unlockedAt,
            })
            .from(playerAchievements)
            .where(
              and(
                eq(playerAchievements.playerId, playerId),
                inArray(
                  playerAchievements.achievementId,
                  deps.defs.map((d) => d.id),
                ),
              ),
            )
        : []
      const stored = new Map(rows.map((r) => [r.achievementId, r]))
      // Driven by the definitions, not by the rows: an achievement the player has never made any
      // progress on still has to appear in the list, at zero.
      return deps.defs.map((def) => {
        const row = stored.get(def.id)
        return {
          id: def.id,
          progress: row === undefined ? 0 : Number(row.progress),
          target: def.threshold,
          unlockedAt: row?.unlockedAt?.getTime() ?? null,
        }
      })
    },

    start: () => deps.bus.subscribe(handle),
  }
}
