/**
 * What a GM may do to an account (spec 2026-10-18 §4–§5): points, items, the lock, the role — and the append-only
 * log that says who did it and why.
 *
 * Every write has the same shape, and the shape is the point of the file:
 *
 * 1. **Validate before any lookup.** A reason of 3–200 characters, an amount within the cap, a known non-free item:
 *    a refusal that needs no database costs none.
 * 2. **One transaction holds the effect and its `gm_actions` row.** A grant without its log line, or a log line for a
 *    grant that rolled back, are both lies the log would tell forever. Inside that transaction only `tx` is used: PGlite
 *    runs `query()` and `transaction()` through one lock, so a plain-`db` read there waits on itself (Plan 25 A7) —
 *    anything that must read on `db` (the wardrobe's missing items) is read before the transaction opens.
 * 3. **Points move through `creditWithin`.** The ledger row carries `ref_id = gm:<action id>`, so the log and the
 *    ledger point at each other, and `Σ balances + Σ sinks` stays true (`gm_grant`/`gm_adjust` are sources).
 * 4. **Side effects only after the commit.** `BALANCE`, the `GM_NOTICE`, the session revocation, the room kick and
 *    the socket close all follow the transaction, so a rolled-back write never announces anything.
 */
import { displayNameKey } from '@bp/core'
import { consoleLogger, InsufficientBalanceError, type AdminRoomSummary, type GameServer, type Logger } from '@bp/server-kit'
import { and, count, desc, eq, gt, isNotNull, like, lt, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { unlockWithin } from '../achievements/achievement-service.js'
import type { AchievementDef, AchievementReward } from '../achievements/definitions.js'
import type { SessionService } from '../auth/session-service.js'
import { rowsOf, type AppDb, type AppTx } from '../db/client.js'
import { dailyLogins, gmActions, inventory as inventoryTable, playerAchievements, playerStats, players, users, type GmActionKind } from '../db/schema.js'
import { addDaysKey, dayKey, dayStartMs, MAX_STREAK, monthKey } from '../economy/daily-rules.js'
import type { GiftMonthRow, GiftScheduleStore } from '../economy/gift-schedule-store.js'
import { ServiceError } from '../errors.js'
import type { HistoryService } from '../history/history-service.js'
import { missingWardrobe } from '../inventory/grant-wardrobe.js'
import type { InventoryService } from '../inventory/inventory-service.js'
import type { ItemCatalog } from '../inventory/items.js'
import { clampLimit, creditWithin, cursorOf, isUuid, type NormalRepositories } from '../repos/index.js'
import type { PlayerStats } from '../stats/player-stats.js'
import type { StatsService } from '../stats/stats-service.js'
import { maskEmail } from './mask-email.js'

/** Spec Q5: the most one adjustment may move, either way. */
export const POINTS_CAP = 10_000_000
export const REASON_MIN = 3
export const REASON_MAX = 200
/** The `inventory.source` of anything a GM hands out, so a report can tell it from an earned item. */
export const GM_ITEM_SOURCE = 'gm-grant'

/** Who acted: a GM's account, or `null` for the server's own CLI. */
export interface GmActor { userId: string | null }
export type GmRole = 'player' | 'gm'

export interface GmPlayerSummary {
  playerId: string
  displayName: string
  emailMasked: string
  role: GmRole
  locked: boolean
  balance: number
  createdAt: number
  lastLoginAt: number | null
}

export interface GmPlayerDetail extends Omit<GmPlayerSummary, 'emailMasked' | 'locked'> {
  email: string
  locked: { at: number; reason: string } | null
  stats: PlayerStats
  room: { roomId: string; code: string; name: string; seat: number | null } | null
  inventoryCount: number
  /** Every achievement this player has unlocked, so the GM's picker can grey those out. */
  unlockedAchievementIds: string[]
}

export interface GmActionRow {
  id: number
  at: number
  actor: { userId: string; displayName: string } | null
  action: GmActionKind
  target: { playerId: string; displayName: string } | null
  roomId: string | null
  amount: number | null
  itemId: string | null
  reason: string
  details: Record<string, unknown> | null
}

export interface GmOverview {
  online: number
  rooms: number
  accounts: number
  locked: number
  gms: number
  /** The ledger over the last 24 h: points created, points sunk, and every reason's total. */
  points24h: { sources: number; sinks: number; byReason: { reason: string; total: number }[] }
}

/** One economy day of the ledger: the points created by reason (signed), the points sunk by reason, and what is left. */
export interface DaySums {
  /** `YYYY-MM-DD` in the economy time zone. */
  day: string
  sources: Record<string, number>
  sinks: Record<string, number>
  /** Σ sources − Σ sinks. */
  net: number
}

export interface GmGrantResult { granted: string[]; alreadyOwned: number; actionId: number }

/** What undoing today's check-in would take back: the latest claim's points and items, and where the streak stands. */
export interface GmCheckinPreview { claimedToday: boolean; day: number; streak: number; points: number; itemIds: string[] }

/** What the Quà tháng tab shows: the default tiers every month falls back to, and the months from this one on. */
export interface GmGiftSchedule { default: Record<string, unknown>; months: GiftMonthRow[] }

export interface GmService {
  search(q: string, opts?: { limit?: number; before?: string }): Promise<{ players: GmPlayerSummary[]; nextBefore: string | null }>
  get(playerId: string): Promise<GmPlayerDetail | null>
  adjustPoints(actor: GmActor, playerId: string, amount: number, reason: string): Promise<{ balance: number; actionId: number }>
  grantItem(actor: GmActor, playerId: string, itemId: string, reason: string): Promise<GmGrantResult>
  grantWardrobe(actor: GmActor, playerId: string, reason: string): Promise<GmGrantResult>
  /** Unlocks one achievement with its whole reward, through the code path that earning it uses. */
  unlockAchievement(actor: GmActor, playerId: string, achievementId: string, reason: string): Promise<{ actionId: number; reward: AchievementReward; balance: number }>
  /** What today's check-in granted (the latest claim only), for the GM to see before undoing it. */
  checkinPreview(playerId: string): Promise<GmCheckinPreview>
  /**
   * Takes today's check-in back — its points, its items — and steps the streak back so the player can claim again
   * (and draw afresh). Refused whole when the player has already spent the points.
   */
  resetCheckin(actor: GmActor, playerId: string, reason: string): Promise<{ actionId: number; undone: { points: number; itemIds: string[] }; balance: number }>
  /** The gift schedule: the file's default, and one row per month from this one on (13 of them, plus any later month the file or a GM names). */
  giftMonths(): Promise<GmGiftSchedule>
  /** Replaces a month's entry of the schedule; effective for the next claim, no restart. Logged with the month and its tiers. */
  setGiftMonth(actor: GmActor, month: string, days: unknown, reason: string): Promise<{ actionId: number }>
  /** Drops a GM's entry for a month so the file's applies again. `NOTHING_TO_CLEAR` when the month has none (and nothing is logged). */
  clearGiftMonth(actor: GmActor, month: string, reason: string): Promise<{ actionId: number }>
  lock(actor: GmActor, playerId: string, reason: string): Promise<{ actionId: number }>
  unlock(actor: GmActor, playerId: string, reason: string): Promise<{ actionId: number }>
  setRole(actor: GmActor, playerId: string, role: GmRole, reason: string): Promise<{ role: GmRole; actionId: number }>
  recordRoomAction(actor: GmActor, action: 'kick' | 'close_room', roomId: string, targetPlayerId: string | null, reason: string, details?: Record<string, unknown>): Promise<number>
  actions(opts?: { limit?: number; before?: number; playerId?: string; roomId?: string }): Promise<{ actions: GmActionRow[]; nextBefore: number | null }>
  overview(): Promise<GmOverview>
  /** The ledger's sources and sinks per economy day: exactly `days` entries ascending, the last one today, empty days as zeros. */
  dailyStats(days: 7 | 30): Promise<DaySums[]>
}

/** The part of a live `Room` the service touches — narrow, so a test can hand in a stub. */
export interface GmRoomHandle {
  adminKick(targetId: string): Promise<'now' | 'after_hand'>
  adminSummary(): Pick<AdminRoomSummary, 'roomId' | 'code' | 'name'> & { members: Pick<AdminRoomSummary['members'][number], 'playerId' | 'seat'>[] }
}

export interface GmServiceDeps {
  db: AppDb
  repos: NormalRepositories
  sessions: SessionService
  inventory: InventoryService
  catalog: ItemCatalog
  /** The loaded achievement catalogue: the only ids `unlockAchievement` accepts. */
  defs: AchievementDef[]
  history: HistoryService
  stats: StatsService
  game: Pick<GameServer, 'notify' | 'balanceChanged' | 'connectionCount'> & {
    rooms: { readonly size: number; roomOf(playerId: string): GmRoomHandle | undefined }
    gateway: { disconnect(playerId: string): number }
  }
  /** The monthly gift schedule: the file's default with the months a GM has set over it. */
  gifts: GiftScheduleStore
  /** The economy's time zone: "today" for a check-in is a calendar day there. */
  timezone: string
  log?: Pick<Logger, 'warn'>
  now?: () => number
}

/** The ledger reasons one daily claim writes, under the claim's shared `ref_id`. */
const CLAIM_REASONS = sql`('daily_login', 'daily_item_fallback')`

/** Sources: the reasons that create points. Transfers (buy-in, cash-out, settlement, refund) only move them. */
const SOURCE_REASONS: ReadonlySet<string> = new Set(['starting_balance', 'daily_reward', 'daily_login', 'daily_item_fallback', 'relief', 'achievement', 'gm_grant', 'gm_adjust', 'gm_achievement', 'gm_checkin_undo'])
/** Sinks: a sink row's reason is its kind (`SettlementMeta.kind`). */
const SINK_REASONS: ReadonlySet<string> = new Set(['table_fee', 'carry_over'])
const DAY_MS = 24 * 60 * 60 * 1000
const SEARCH_LIMIT = { def: 20, max: 100 }
const ACTIONS_LIMIT = { def: 50, max: 200 }

export function checkReason(reason: unknown): string {
  if (typeof reason !== 'string') throw new ServiceError('INVALID_REASON', 'reason must be a string')
  const trimmed = reason.trim()
  if (trimmed.length < REASON_MIN || trimmed.length > REASON_MAX) throw new ServiceError('INVALID_REASON', `reason must be ${String(REASON_MIN)}–${String(REASON_MAX)} characters`)
  return trimmed
}

/** `%`, `_` and the escape itself as plain characters in a `LIKE` pattern (Postgres's default escape is `\`). */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

interface ActionInsert {
  actorUserId: string | null
  action: GmActionKind
  targetPlayerId?: string | null
  targetRoomId?: string | null
  amount?: number | null
  itemId?: string | null
  reason: string
  details?: Record<string, unknown> | null
}

async function logAction(tx: AppTx | AppDb, row: ActionInsert): Promise<number> {
  const [inserted] = await tx.insert(gmActions).values(row).returning({ id: gmActions.id })
  return Number(inserted!.id)
}

export function createGmService(deps: GmServiceDeps): GmService {
  const now = deps.now ?? Date.now
  const log = deps.log ?? consoleLogger

  /** The target account inside the caller's transaction; `lock` takes the row lock a concurrent change must wait on. */
  async function target(tx: AppTx, playerId: string, opts: { lock?: boolean } = {}) {
    if (!isUuid(playerId)) throw new ServiceError('NOT_FOUND')
    const query = tx
      .select({ id: users.id, role: users.role, lockedAt: users.lockedAt })
      .from(users)
      .innerJoin(players, eq(players.id, users.id))
      .where(eq(users.id, playerId))
    const [row] = opts.lock === true ? await query.for('update', { of: users }) : await query
    if (row === undefined) throw new ServiceError('NOT_FOUND')
    return row
  }

  function notice(playerId: string, payload: Record<string, unknown>): void {
    deps.game.notify(playerId, { t: 'NOTIFICATION', kind: 'GM_NOTICE', payload })
  }

  /**
   * Today's claim: the points and items of the **latest** claim under `daily:<player>:<day>`. A reclaim after an undo
   * reuses that ref, so summing every row under it would count the undone claim again; the rows of one claim share
   * the claim transaction's timestamp, and the newest timestamp is the claim that is standing.
   */
  async function latestClaim(tx: AppTx, playerId: string, day: string): Promise<{ points: number; itemIds: string[] }> {
    const refId = `daily:${playerId}:${day}`
    const [row] = rowsOf<{ points: string | number }>(
      await tx.execute(sql`
        select coalesce(sum(amount), 0) as points from point_transactions
        where ref_id = ${refId} and reason in ${CLAIM_REASONS}
          and created_at = (select max(created_at) from point_transactions where ref_id = ${refId} and reason in ${CLAIM_REASONS})`),
    )
    return { points: Number(row?.points ?? 0), itemIds: await deps.inventory.findByRef(tx, playerId, refId) }
  }

  return {
    async search(q, opts) {
      const limit = clampLimit(opts?.limit, SEARCH_LIMIT.def, SEARCH_LIMIT.max)
      const term = q.trim()
      const filters: SQL[] = []
      if (term !== '') {
        filters.push(or(like(users.email, `${escapeLike(term.toLowerCase())}%`), like(players.nameKey, `%${escapeLike(displayNameKey(term))}%`))!)
      }
      if (opts?.before !== undefined) {
        if (!isUuid(opts.before)) return { players: [], nextBefore: null }
        filters.push(gt(players.id, opts.before))
      }
      const rows = await deps.db
        .select({
          playerId: players.id,
          displayName: players.displayName,
          email: users.email,
          role: users.role,
          lockedAt: users.lockedAt,
          balance: players.balance,
          createdAt: users.createdAt,
          lastLoginAt: users.lastLoginAt,
        })
        .from(players)
        .innerJoin(users, eq(users.id, players.id))
        .where(filters.length === 0 ? undefined : and(...filters))
        .orderBy(players.id)
        .limit(limit)
      const found = rows.map((r) => ({
        playerId: r.playerId,
        displayName: r.displayName,
        emailMasked: maskEmail(r.email),
        role: r.role,
        locked: r.lockedAt !== null,
        balance: Number(r.balance),
        createdAt: r.createdAt.getTime(),
        lastLoginAt: r.lastLoginAt?.getTime() ?? null,
      }))
      return { players: found, nextBefore: found.length === limit ? found[found.length - 1]!.playerId : null }
    },

    async get(playerId) {
      if (!isUuid(playerId)) return null
      const [row] = await deps.db
        .select({
          playerId: players.id,
          displayName: players.displayName,
          email: users.email,
          role: users.role,
          lockedAt: users.lockedAt,
          lockedReason: users.lockedReason,
          balance: players.balance,
          createdAt: users.createdAt,
          lastLoginAt: users.lastLoginAt,
        })
        .from(users)
        .innerJoin(players, eq(players.id, users.id))
        .where(eq(users.id, playerId))
      if (row === undefined) return null
      const [owned] = await deps.db.select({ n: count() }).from(inventoryTable).where(eq(inventoryTable.playerId, playerId))
      const unlocked = await deps.db
        .select({ id: playerAchievements.achievementId })
        .from(playerAchievements)
        .where(and(eq(playerAchievements.playerId, playerId), isNotNull(playerAchievements.unlockedAt)))
        .orderBy(playerAchievements.achievementId)
      const stats = await deps.stats.get(playerId)
      const live = deps.game.rooms.roomOf(playerId)?.adminSummary()
      return {
        playerId: row.playerId,
        displayName: row.displayName,
        email: row.email,
        role: row.role,
        locked: row.lockedAt === null ? null : { at: row.lockedAt.getTime(), reason: row.lockedReason ?? '' },
        balance: Number(row.balance),
        createdAt: row.createdAt.getTime(),
        lastLoginAt: row.lastLoginAt?.getTime() ?? null,
        stats,
        room: live === undefined ? null : { roomId: live.roomId, code: live.code, name: live.name, seat: live.members.find((m) => m.playerId === playerId)?.seat ?? null },
        inventoryCount: Number(owned?.n ?? 0),
        unlockedAchievementIds: unlocked.map((u) => u.id),
      }
    },

    async adjustPoints(actor, playerId, amount, reason) {
      const why = checkReason(reason)
      if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > POINTS_CAP) {
        throw new ServiceError('INVALID_AMOUNT', `amount must be a non-zero integer within ±${String(POINTS_CAP)}`)
      }
      const action: GmActionKind = amount > 0 ? 'grant_points' : 'adjust_points'
      let result: { balance: number; actionId: number }
      try {
        result = await deps.db.transaction(async (tx) => {
          const t = await target(tx, playerId)
          const actionId = await logAction(tx, { actorUserId: actor.userId, action, targetPlayerId: t.id, amount, reason: why })
          // `creditWithin` locks the player row and refuses a negative balance: the whole transaction, this log line
          // included, rolls back. Only the balance is debited — a stack on a table is never touched.
          await creditWithin(tx, [{ playerId: t.id, delta: amount, reason: amount > 0 ? 'gm_grant' : 'gm_adjust', refId: `gm:${String(actionId)}` }])
          const [after] = await tx.select({ balance: players.balance }).from(players).where(eq(players.id, t.id))
          return { balance: Number(after!.balance), actionId }
        })
      } catch (err) {
        if (err instanceof InsufficientBalanceError) throw new ServiceError('INSUFFICIENT_BALANCE', 'the balance is short of the amount')
        throw err
      }
      void deps.game.balanceChanged(playerId)
      notice(playerId, { action, amount, reason: why })
      return result
    },

    async grantItem(actor, playerId, itemId, reason) {
      const why = checkReason(reason)
      const def = deps.catalog.get(itemId)
      // A free item is everyone's already (design §3.2) and never gets a row: granting one is a mistake, not a no-op.
      if (def === undefined || def.free === true) throw new ServiceError('INVALID_ITEM', `not a grantable item: ${itemId}`)
      const result = await deps.db.transaction(async (tx) => {
        const t = await target(tx, playerId)
        const granted = await deps.inventory.grant(tx, t.id, def.id, GM_ITEM_SOURCE)
        const actionId = await logAction(tx, { actorUserId: actor.userId, action: 'grant_item', targetPlayerId: t.id, itemId: def.id, reason: why, details: granted ? null : { alreadyOwned: true } })
        return { granted: granted ? [def.id] : [], alreadyOwned: granted ? 0 : 1, actionId }
      })
      if (result.granted.length > 0) notice(playerId, { action: 'grant_item', itemId: def.id, reason: why })
      return result
    },

    async grantWardrobe(actor, playerId, reason) {
      const why = checkReason(reason)
      if (!isUuid(playerId)) throw new ServiceError('NOT_FOUND')
      // Read on `db` before the transaction opens (A7); a grant racing this one is harmless — `grant` skips a row
      // that already exists and reports it, so `granted` stays exactly what this call wrote.
      const { all, missing } = await missingWardrobe(deps.db, deps.catalog, playerId)
      const result = await deps.db.transaction(async (tx) => {
        const t = await target(tx, playerId)
        const granted: string[] = []
        for (const id of missing) if (await deps.inventory.grant(tx, t.id, id, GM_ITEM_SOURCE)) granted.push(id)
        const actionId = await logAction(tx, { actorUserId: actor.userId, action: 'grant_wardrobe', targetPlayerId: t.id, reason: why, details: { granted: granted.length } })
        return { granted, alreadyOwned: all.length - granted.length, actionId }
      })
      if (result.granted.length > 0) notice(playerId, { action: 'grant_wardrobe', reason: why })
      return result
    },

    async unlockAchievement(actor, playerId, achievementId, reason) {
      const why = checkReason(reason)
      const def = deps.defs.find((d) => d.id === achievementId)
      if (def === undefined) throw new ServiceError('INVALID_ACHIEVEMENT', `not an achievement: ${achievementId}`)
      const result = await deps.db.transaction(async (tx) => {
        const t = await target(tx, playerId)
        // A locked account earns nothing and is handed nothing: unlock the account first.
        if (t.lockedAt !== null) throw new ServiceError('TARGET_IS_LOCKED', 'a locked account cannot be given an achievement; unlock first')
        const actionId = await logAction(tx, { actorUserId: actor.userId, action: 'unlock_achievement', targetPlayerId: t.id, itemId: def.id, amount: def.reward.points ?? null, reason: why })
        // The same code path as earning it, so the reward is the full one; a second unlock rolls the log line back too.
        const outcome = await unlockWithin(tx, t.id, def, new Date(now()), { inventory: deps.inventory, reason: 'gm_achievement', refId: `gm:${String(actionId)}` })
        if (outcome === 'already') throw new ServiceError('ALREADY_UNLOCKED', 'the achievement is already unlocked')
        const [after] = await tx.select({ balance: players.balance }).from(players).where(eq(players.id, t.id))
        return { actionId, reward: def.reward, balance: Number(after!.balance) }
      })
      if (def.reward.points !== undefined) void deps.game.balanceChanged(playerId)
      notice(playerId, { action: 'unlock_achievement', achievementId: def.id, reason: why })
      return result
    },

    async checkinPreview(playerId) {
      if (!isUuid(playerId)) throw new ServiceError('NOT_FOUND')
      const today = dayKey(now(), deps.timezone)
      return deps.db.transaction(async (tx): Promise<GmCheckinPreview> => {
        await target(tx, playerId)
        const [login] = await tx.select({ streak: dailyLogins.streak, lastClaimDate: dailyLogins.lastClaimDate }).from(dailyLogins).where(eq(dailyLogins.playerId, playerId))
        const streak = login?.streak ?? 0
        const claimedToday = login?.lastClaimDate === today
        const claim = claimedToday ? await latestClaim(tx, playerId, today) : { points: 0, itemIds: [] }
        return { claimedToday, day: Math.min(Math.max(streak, 1), MAX_STREAK), streak, ...claim }
      })
    },

    async resetCheckin(actor, playerId, reason) {
      const why = checkReason(reason)
      const today = dayKey(now(), deps.timezone)
      let result: { actionId: number; undone: { points: number; itemIds: string[] }; balance: number }
      try {
        result = await deps.db.transaction(async (tx) => {
          const t = await target(tx, playerId)
          // A locked account is handed nothing and has nothing undone: unlock it first.
          if (t.lockedAt !== null) throw new ServiceError('TARGET_IS_LOCKED', 'a locked account cannot have its check-in undone; unlock first')
          // The row a concurrent claim would lock: the claim and this undo cannot interleave.
          const [login] = await tx.select().from(dailyLogins).where(eq(dailyLogins.playerId, t.id)).for('update')
          if (login === undefined || login.lastClaimDate !== today) throw new ServiceError('NOT_CLAIMED_TODAY', 'the player has not checked in today')
          const undone = await latestClaim(tx, t.id, today)
          const actionId = await logAction(tx, {
            actorUserId: actor.userId,
            action: 'reset_checkin',
            targetPlayerId: t.id,
            amount: undone.points,
            reason: why,
            details: { previousStreak: login.streak, previousConsecutive: login.consecutive, previousLastClaimDate: login.lastClaimDate, undone },
          })
          // The debit is the first thing that can fail: points already spent roll back the log line with it.
          if (undone.points > 0) await creditWithin(tx, [{ playerId: t.id, delta: -undone.points, reason: 'gm_checkin_undo', refId: `gm:${String(actionId)}` }])
          for (const itemId of undone.itemIds) await deps.inventory.revoke(tx, t.id, itemId)
          // Yesterday and one step back: the next claim is then exactly the one just undone (same day, same points).
          // The consecutive run steps back too, or the reclaim — "yesterday" now — would count today twice
          // (§13.1 as amended by Plan 27 Part G).
          await tx
            .update(dailyLogins)
            .set({
              lastClaimDate: addDaysKey(today, -1),
              streak: Math.max(login.streak - 1, 0),
              consecutive: Math.max(login.consecutive - 1, 0),
              claimedDays: Math.max(login.claimedDays - 1, 0),
            })
            .where(eq(dailyLogins.playerId, t.id))
          await tx.update(playerStats).set({ totalLoginDays: sql`greatest(${playerStats.totalLoginDays} - 1, 0)` }).where(eq(playerStats.playerId, t.id))
          const [after] = await tx.select({ balance: players.balance }).from(players).where(eq(players.id, t.id))
          return { actionId, undone, balance: Number(after!.balance) }
        })
      } catch (err) {
        if (err instanceof InsufficientBalanceError) throw new ServiceError('INSUFFICIENT_BALANCE', 'the player has spent the points of this check-in')
        throw err
      }
      void deps.game.balanceChanged(playerId)
      // The amount taken back rides along, so the player's toast can say it (Ruling 11).
      notice(playerId, { action: 'reset_checkin', amount: result.undone.points, reason: why })
      return result
    },

    async giftMonths() {
      const stored = await deps.gifts.months()
      const [year, mon] = monthKey(now(), deps.timezone).split('-').map(Number) as [number, number]
      const window = Array.from({ length: 13 }, (_, i) => {
        const at = new Date(Date.UTC(year, mon - 1 + i, 1))
        return `${String(at.getUTCFullYear())}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`
      })
      const byMonth = new Map(stored.map((row) => [row.month, row]))
      // A month with neither entry is shown empty, as the file's: it falls back to the default tier by tier.
      const months = window.map((month) => byMonth.get(month) ?? { month, days: {}, source: 'file' as const, updatedAt: null, updatedBy: null })
      // Past the window, a month the file or a GM already names is still the GM's to see.
      for (const row of stored) if (row.month > window[12]!) months.push(row)
      return { default: deps.gifts.defaults(), months }
    },

    async setGiftMonth(actor, month, days, reason) {
      const why = checkReason(reason)
      const actionId = await deps.db.transaction(async (tx) => {
        // The store validates first (and reads through `tx`): a refused month leaves no log line behind.
        await deps.gifts.setMonth(tx, month, days, actor.userId)
        return logAction(tx, { actorUserId: actor.userId, action: 'set_gift_month', targetPlayerId: null, reason: why, details: { month, days } })
      })
      // After the commit, so a rolled-back write never changes what the next claim reads.
      await deps.gifts.reload()
      return { actionId }
    },

    async clearGiftMonth(actor, month, reason) {
      const why = checkReason(reason)
      const actionId = await deps.db.transaction(async (tx) => {
        if (!(await deps.gifts.clearMonth(tx, month))) throw new ServiceError('NOTHING_TO_CLEAR', `${month} has no entry of its own to clear`)
        return logAction(tx, { actorUserId: actor.userId, action: 'clear_gift_month', targetPlayerId: null, reason: why, details: { month } })
      })
      await deps.gifts.reload()
      return { actionId }
    },

    async lock(actor, playerId, reason) {
      const why = checkReason(reason)
      const actionId = await deps.db.transaction(async (tx) => {
        const t = await target(tx, playerId, { lock: true })
        if (actor.userId === t.id) throw new ServiceError('SELF_TARGET', 'a gm cannot lock their own account')
        if (t.role === 'gm') throw new ServiceError('TARGET_IS_GM', 'a gm cannot be locked; demote first')
        if (t.lockedAt !== null) throw new ServiceError('ALREADY_LOCKED')
        await tx.update(users).set({ lockedAt: new Date(now()), lockedReason: why }).where(eq(users.id, t.id))
        return logAction(tx, { actorUserId: actor.userId, action: 'lock', targetPlayerId: t.id, reason: why })
      })
      // Spec §4, in this order: no new request gets through, the seat goes home, the player is told, the socket closes.
      // A failing revocation is warned, not thrown: the lock is committed, and the auth guard refuses a locked account
      // on every request anyway, so the kick and the disconnect must still run.
      await deps.sessions.revokeAll(playerId).catch((err: unknown) => { log.warn('gm lock: revoking the sessions failed', { playerId, error: messageOf(err) }) })
      const room = deps.game.rooms.roomOf(playerId)
      if (room !== undefined) {
        // The lock is committed whatever the room says; a failed kick is an operator's to look at, not the GM's to retry.
        // The room is not touched again: kicking the last human may have closed it.
        await room.adminKick(playerId).catch((err: unknown) => { log.warn('gm lock: the room kick failed', { playerId, error: messageOf(err) }) })
      }
      notice(playerId, { action: 'lock', reason: why })
      deps.game.gateway.disconnect(playerId)
      return { actionId }
    },

    async unlock(actor, playerId, reason) {
      const why = checkReason(reason)
      const actionId = await deps.db.transaction(async (tx) => {
        const t = await target(tx, playerId, { lock: true })
        if (t.lockedAt === null) throw new ServiceError('NOT_LOCKED')
        await tx.update(users).set({ lockedAt: null, lockedReason: null }).where(eq(users.id, t.id))
        return logAction(tx, { actorUserId: actor.userId, action: 'unlock', targetPlayerId: t.id, reason: why })
      })
      return { actionId }
    },

    async setRole(actor, playerId, role, reason) {
      const why = checkReason(reason)
      if (role !== 'player' && role !== 'gm') throw new ServiceError('INVALID_ROLE', 'role must be player or gm')
      const actionId = await deps.db.transaction(async (tx) => {
        // Lock order, the same as `grantGm`: a demotion first locks every gm row in id order, and only then the
        // target's row (already held when the target is a gm — locking it again is a no-op). Every demotion takes
        // its locks in that one global order, so two mutual demotions serialise on the gm set — the second sees only
        // one gm left and answers LAST_GM — instead of each holding a row the other waits on.
        const gms = role === 'player' ? rowsOf<{ id: string }>(await tx.execute(sql`select id from users where role = 'gm' order by id for update`)) : []
        const t = await target(tx, playerId, { lock: true })
        if (actor.userId === t.id) throw new ServiceError('SELF_TARGET', 'a gm cannot change their own role')
        if (role === 'gm' && t.role !== 'gm' && t.lockedAt !== null) throw new ServiceError('TARGET_IS_LOCKED', 'a locked account cannot be promoted; unlock first')
        if (role === 'player' && t.role === 'gm' && gms.every((g) => g.id === t.id)) throw new ServiceError('LAST_GM', 'the last gm cannot be demoted')
        await tx.update(users).set({ role }).where(eq(users.id, t.id))
        return logAction(tx, { actorUserId: actor.userId, action: role === 'gm' ? 'promote' : 'demote', targetPlayerId: t.id, reason: why, details: { from: t.role } })
      })
      notice(playerId, { action: role === 'gm' ? 'promote' : 'demote', reason: why })
      return { role, actionId }
    },

    async recordRoomAction(actor, action, roomId, targetPlayerId, reason, details) {
      const why = checkReason(reason)
      // A bot's id is no `players` row: kept in the details so the foreign key never refuses the log line.
      const playerTarget = targetPlayerId !== null && isUuid(targetPlayerId) ? targetPlayerId : null
      const extra = targetPlayerId !== null && playerTarget === null ? { ...details, targetId: targetPlayerId } : details
      // One insert, no other write: the room lives in memory, and the spec logs before acting (§5).
      return logAction(deps.db, { actorUserId: actor.userId, action, targetPlayerId: playerTarget, targetRoomId: roomId, reason: why, details: extra ?? null })
    },

    async actions(opts) {
      const limit = clampLimit(opts?.limit, ACTIONS_LIMIT.def, ACTIONS_LIMIT.max)
      const filters: SQL[] = []
      const before = cursorOf(opts?.before)
      if (before !== undefined) filters.push(lt(gmActions.id, before))
      if (opts?.playerId !== undefined) {
        if (!isUuid(opts.playerId)) return { actions: [], nextBefore: null }
        filters.push(eq(gmActions.targetPlayerId, opts.playerId))
      }
      if (opts?.roomId !== undefined) filters.push(eq(gmActions.targetRoomId, opts.roomId))
      const actorP = alias(players, 'actor_player')
      const targetP = alias(players, 'target_player')
      const rows = await deps.db
        .select({
          id: gmActions.id,
          createdAt: gmActions.createdAt,
          actorUserId: gmActions.actorUserId,
          actorName: actorP.displayName,
          action: gmActions.action,
          targetPlayerId: gmActions.targetPlayerId,
          targetName: targetP.displayName,
          roomId: gmActions.targetRoomId,
          amount: gmActions.amount,
          itemId: gmActions.itemId,
          reason: gmActions.reason,
          details: gmActions.details,
        })
        .from(gmActions)
        .leftJoin(actorP, eq(actorP.id, gmActions.actorUserId))
        .leftJoin(targetP, eq(targetP.id, gmActions.targetPlayerId))
        .where(filters.length === 0 ? undefined : and(...filters))
        .orderBy(desc(gmActions.id))
        .limit(limit)
      const actions = rows.map((r) => ({
        id: Number(r.id),
        at: r.createdAt.getTime(),
        actor: r.actorUserId === null ? null : { userId: r.actorUserId, displayName: r.actorName ?? '' },
        action: r.action,
        target: r.targetPlayerId === null ? null : { playerId: r.targetPlayerId, displayName: r.targetName ?? '' },
        roomId: r.roomId,
        amount: r.amount === null ? null : Number(r.amount),
        itemId: r.itemId,
        reason: r.reason,
        details: r.details,
      }))
      return { actions, nextBefore: actions.length === limit ? actions[actions.length - 1]!.id : null }
    },

    async overview() {
      const [counts] = await deps.db
        .select({
          accounts: count(),
          locked: count(users.lockedAt),
          gms: sql<string | number>`count(*) filter (where ${users.role} = 'gm')`,
        })
        .from(users)
      const byReason = await deps.repos.ledger.sums(now() - DAY_MS)
      const total = (set: ReadonlySet<string>) => byReason.filter((r) => set.has(r.reason)).reduce((sum, r) => sum + r.total, 0)
      return {
        online: deps.game.connectionCount,
        rooms: deps.game.rooms.size,
        accounts: Number(counts?.accounts ?? 0),
        locked: Number(counts?.locked ?? 0),
        gms: Number(counts?.gms ?? 0),
        points24h: { sources: total(SOURCE_REASONS), sinks: total(SINK_REASONS), byReason },
      }
    },

    async dailyStats(days) {
      const today = dayKey(now(), deps.timezone)
      const keys = Array.from({ length: days }, (_, i) => addDaysKey(today, i - (days - 1)))
      const byDay = new Map<string, DaySums>(keys.map((day) => [day, { day, sources: {}, sinks: {}, net: 0 }]))
      const rows = await deps.repos.ledger.sumsByDay(dayStartMs(keys[0]!, deps.timezone), deps.timezone)
      for (const row of rows) {
        const sums = byDay.get(row.day)
        if (!sums) continue // a row dated after "today", which only a clock set back can leave
        if (row.playerless || SINK_REASONS.has(row.reason)) {
          const sunk = Math.abs(row.total)
          sums.sinks[row.reason] = (sums.sinks[row.reason] ?? 0) + sunk
          sums.net -= sunk
        } else if (SOURCE_REASONS.has(row.reason)) {
          // Signed: a negative adjustment or a check-in undo is points taken back, and lowers the day's sources.
          sums.sources[row.reason] = (sums.sources[row.reason] ?? 0) + row.total
          sums.net += row.total
        } // else a transfer (buy-in, cash-out, settlement, refund): it moves points, it neither makes nor sinks them
      }
      return keys.map((day) => byDay.get(day)!)
    },
  }
}
