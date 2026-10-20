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
import { and, count, desc, eq, gt, like, lt, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { SessionService } from '../auth/session-service.js'
import { rowsOf, type AppDb, type AppTx } from '../db/client.js'
import { gmActions, inventory as inventoryTable, players, users, type GmActionKind } from '../db/schema.js'
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

export interface GmGrantResult { granted: string[]; alreadyOwned: number; actionId: number }

export interface GmService {
  search(q: string, opts?: { limit?: number; before?: string }): Promise<{ players: GmPlayerSummary[]; nextBefore: string | null }>
  get(playerId: string): Promise<GmPlayerDetail | null>
  adjustPoints(actor: GmActor, playerId: string, amount: number, reason: string): Promise<{ balance: number; actionId: number }>
  grantItem(actor: GmActor, playerId: string, itemId: string, reason: string): Promise<GmGrantResult>
  grantWardrobe(actor: GmActor, playerId: string, reason: string): Promise<GmGrantResult>
  lock(actor: GmActor, playerId: string, reason: string): Promise<{ actionId: number }>
  unlock(actor: GmActor, playerId: string, reason: string): Promise<{ actionId: number }>
  setRole(actor: GmActor, playerId: string, role: GmRole, reason: string): Promise<{ role: GmRole; actionId: number }>
  recordRoomAction(actor: GmActor, action: 'kick' | 'close_room', roomId: string, targetPlayerId: string | null, reason: string, details?: Record<string, unknown>): Promise<number>
  actions(opts?: { limit?: number; before?: number; playerId?: string; roomId?: string }): Promise<{ actions: GmActionRow[]; nextBefore: number | null }>
  overview(): Promise<GmOverview>
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
  history: HistoryService
  stats: StatsService
  game: Pick<GameServer, 'notify' | 'balanceChanged' | 'connectionCount'> & {
    rooms: { readonly size: number; roomOf(playerId: string): GmRoomHandle | undefined }
    gateway: { disconnect(playerId: string): number }
  }
  log?: Pick<Logger, 'warn'>
  now?: () => number
}

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
  }
}
