/**
 * Balances and the points ledger.
 *
 * Two rules make this file the one place points may move:
 *
 * 1. **Netting before judgement.** A batch is grouped by player and the deltas summed *before* the
 *    negativity check, so a hand that first takes a player's stack and then pays their winnings back
 *    is judged on the net effect. Checking intermediates would reject settlements that are perfectly
 *    solvent — see `docs/server-kit.md` → Repositories, and `createMemoryRepositories` for the
 *    reference semantics this must match.
 * 2. **Every movement is written down.** One `point_transactions` row per *original* entry (not per
 *    netted player, and including a `delta` of 0: "this player was in the batch and moved nothing" is
 *    a fact worth keeping), plus a sink row when a fee was taken. `Σ balances + Σ sinks` is then the
 *    invariant §12.5 monitors, and it only holds if nothing ever updates `players.balance` outside
 *    `creditWithin`.
 *
 * The lock is a `SELECT … FOR UPDATE` ordered by id: two settlements touching the same two players
 * from opposite ends would otherwise each hold what the other needs. Ordering the rows makes that
 * deadlock impossible rather than merely unlikely.
 */
import { InsufficientBalanceError, type BalanceEntry, type BalanceRepository, type SettlementMeta } from '@bp/server-kit'
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import type { AppDb, AppTx } from '../db/client.js'
import { rowsOf } from '../db/client.js'
import { players, pointTransactions } from '../db/schema.js'
import { clampLimit, cursorOf, isUuid } from './util.js'

/** A ledger row as stored: `playerId` null means a sink (points that went to no player). */
export interface LedgerRow {
  id: number
  playerId: string | null
  amount: number
  reason: string
  refId: string | null
  kind: string | null
  createdAt: Date
}

export interface LedgerListOptions {
  /** Page size, default 50, capped at 500. */
  limit?: number
  /**
   * Exclusive cursor: the `id` of the last row of the previous page, not a timestamp. Every row of
   * one settlement shares a `created_at` (a single `now()` per transaction), so a time cursor would
   * either repeat or skip rows at a page boundary; the sequence id never ties.
   */
  before?: number
}

export interface LedgerSum {
  reason: string
  total: number
}

/** §12.5's monitoring reads: one player's history, and the flow-by-reason over a window. */
export interface LedgerReader {
  list(playerId: string, opts?: LedgerListOptions): Promise<LedgerRow[]>
  /** Grouped by `reason`, which is also where sinks land: a sink's reason *is* its kind. */
  sums(sinceMs: number): Promise<LedgerSum[]>
}

export interface NormalBalanceRepository extends BalanceRepository {
  /**
   * Opens a transaction of its own, on its own pooled connection. Never call it from inside another
   * transaction on the same `db`: the outer transaction may already hold a lock on a `players` row
   * this one needs, and the two connections would then wait on each other until a timeout. Use
   * `creditWithin(tx, …)` from inside a transaction — that is what it is for.
   */
  apply(entries: BalanceEntry[], meta?: SettlementMeta): Promise<void>
  /**
   * The whole of `apply`, minus the transaction, so a service that already has one — the daily
   * reward stamping a claim day, relief stamping its cooldown, an achievement granting an item —
   * can credit points and write its own half under a single commit.
   */
  creditWithin(tx: AppTx, entries: BalanceEntry[], meta?: SettlementMeta): Promise<void>
}

/** Raised instead of silently skipping: a settlement naming a player who is not there is a bug. */
export class UnknownPlayerError extends Error {
  constructor(public readonly playerId: string) {
    super(`unknown player ${playerId}`)
    this.name = 'UnknownPlayerError'
  }
}

const DEFAULT_LEDGER_LIMIT = 50
const MAX_LEDGER_LIMIT = 500

/** True when there is nothing to write: no entries *and* no fee. */
function isNoop(entries: BalanceEntry[], meta?: SettlementMeta): boolean {
  return entries.length === 0 && !(meta !== undefined && meta.fee > 0)
}

export async function creditWithin(tx: AppTx, entries: BalanceEntry[], meta?: SettlementMeta): Promise<void> {
  if (isNoop(entries, meta)) return

  const nets = new Map<string, number>()
  for (const e of entries) nets.set(e.playerId, (nets.get(e.playerId) ?? 0) + e.delta)

  if (nets.size > 0) {
    for (const id of nets.keys()) {
      if (!isUuid(id)) throw new UnknownPlayerError(id)
    }
    const ids = [...nets.keys()].sort()
    // Raw SQL because the lock is the point: the query builder has no `FOR UPDATE` that reads as
    // plainly, and `rowsOf` is what makes one statement work on both `pg` and PGlite.
    const idList = sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )
    const locked = rowsOf<{ id: string; balance: string | number }>(
      await tx.execute(sql`select id, balance from players where id = any(array[${idList}]) order by id for update`),
    )
    const balances = new Map(locked.map((row) => [row.id, Number(row.balance)]))

    // Check everyone before moving anyone: `apply` is all-or-nothing, and while the transaction
    // would roll back a partial write anyway, a rejection should not have written to begin with.
    //
    // The lock was taken in `id` order — that is what makes two settlements over an overlapping pair
    // deadlock-free — but the *checking* walks the batch's own order, so that when more than one
    // player is insolvent the id named on the error is the same one `createMemoryRepositories` would
    // name. A service or test that pins that id then behaves the same against either implementation.
    for (const [id, net] of nets) {
      const balance = balances.get(id)
      if (balance === undefined) throw new UnknownPlayerError(id)
      if (balance + net < 0) throw new InsufficientBalanceError(id)
    }
    for (const [id, net] of nets) {
      if (net !== 0) {
        await tx
          .update(players)
          .set({ balance: sql`${players.balance} + ${net}` })
          .where(eq(players.id, id))
      }
    }
  }

  if (entries.length > 0) {
    await tx.insert(pointTransactions).values(
      entries.map((e) => ({
        playerId: e.playerId,
        amount: e.delta,
        reason: e.reason,
        refId: e.refId ?? null,
        kind: null,
      })),
    )
  }

  // The sink is recorded positively — "this many points left player balances" — with the kind in
  // both `reason` and `kind`: `reason` so §12.5's `group by reason` sees fees beside every other
  // flow, `kind` so the row satisfies "a null player must say what kind of sink it is".
  if (meta !== undefined && meta.fee > 0) {
    await tx.insert(pointTransactions).values({
      playerId: null,
      amount: meta.fee,
      reason: meta.kind,
      refId: meta.refId,
      kind: meta.kind,
    })
  }
}

export function createBalanceRepository(db: AppDb): NormalBalanceRepository {
  return {
    async get(playerId) {
      if (!isUuid(playerId)) throw new UnknownPlayerError(playerId)
      const [row] = await db.select({ balance: players.balance }).from(players).where(eq(players.id, playerId))
      if (!row) throw new UnknownPlayerError(playerId)
      return row.balance
    },

    async apply(entries, meta) {
      // No transaction for a batch that writes nothing — `apply([])` is a normal outcome of a hand
      // where every seat broke even and no fee was due.
      if (isNoop(entries, meta)) return
      await db.transaction(async (tx) => {
        await creditWithin(tx, entries, meta)
      })
    },

    creditWithin,
  }
}

export function createLedgerReader(db: AppDb): LedgerReader {
  return {
    async list(playerId, opts) {
      if (!isUuid(playerId)) return []
      const limit = clampLimit(opts?.limit, DEFAULT_LEDGER_LIMIT, MAX_LEDGER_LIMIT)
      const before = cursorOf(opts?.before)
      const where = before === undefined
        ? eq(pointTransactions.playerId, playerId)
        : and(eq(pointTransactions.playerId, playerId), lt(pointTransactions.id, before))
      const rows = await db
        .select({
          id: pointTransactions.id,
          playerId: pointTransactions.playerId,
          amount: pointTransactions.amount,
          reason: pointTransactions.reason,
          refId: pointTransactions.refId,
          kind: pointTransactions.kind,
          createdAt: pointTransactions.createdAt,
        })
        .from(pointTransactions)
        .where(where)
        .orderBy(desc(pointTransactions.id))
        .limit(limit)
      return rows.map((r) => ({ ...r, id: Number(r.id), amount: Number(r.amount) }))
    },

    async sums(sinceMs) {
      const rows = await db
        .select({ reason: pointTransactions.reason, total: sql<string | number>`sum(${pointTransactions.amount})` })
        .from(pointTransactions)
        .where(gte(pointTransactions.createdAt, new Date(sinceMs)))
        .groupBy(pointTransactions.reason)
        .orderBy(pointTransactions.reason)
      // `sum()` is `numeric`, which `pg` hands back as a string to protect precision it does not know
      // is unnecessary here — the economy's totals are integers well inside `Number.MAX_SAFE_INTEGER`.
      return rows.map((r) => ({ reason: r.reason, total: Number(r.total) }))
    },
  }
}
