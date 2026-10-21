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
 *
 * A keyed `apply` claims its key in `ledger_keys` before anything else in the transaction. Two calls
 * with one key serialise on that primary key — the second insert waits for the first transaction and,
 * once it commits, finds the key taken — and each transaction claims a single key while holding no
 * other lock yet, so the claim cannot deadlock with the player-row lock either.
 */
import { InsufficientBalanceError, type ApplyOptions, type ApplyResult, type BalanceEntry, type BalanceRepository, type SettlementMeta } from '@bp/server-kit'
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import type { AppDb, AppTx } from '../db/client.js'
import { rowsOf } from '../db/client.js'
import { ledgerKeys, players, pointTransactions } from '../db/schema.js'
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
  /**
   * The same flow cut by economy day: one row per day, reason and side (`playerless` is a sink row, `player_id IS NULL`),
   * ascending. A day is the calendar day in `timeZone` — the one a check-in is judged on — not the UTC one.
   * Days without rows are absent; the caller fills them.
   */
  sumsByDay(sinceMs: number, timeZone: string): Promise<DayReasonRow[]>
}

export interface DayReasonRow {
  /** `YYYY-MM-DD` in the zone asked for. */
  day: string
  reason: string
  playerless: boolean
  total: number
}

export interface NormalBalanceRepository extends BalanceRepository {
  /**
   * Opens a transaction of its own, on its own pooled connection. Never call it from inside another
   * transaction on the same `db`: the outer transaction may already hold a lock on a `players` row
   * this one needs, and the two connections would then wait on each other until a timeout. Use
   * `creditWithin(tx, …)` from inside a transaction — that is what it is for.
   *
   * `opts.key` is claimed in `ledger_keys` first, in the same transaction: a key already claimed
   * resolves `{ applied: false }` with nothing checked or written, and a rejected batch rolls its
   * claim back with it (`docs/server-kit.md` → Repositories).
   */
  apply(entries: BalanceEntry[], meta?: SettlementMeta, opts?: ApplyOptions): Promise<ApplyResult>
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

    async apply(entries, meta, opts) {
      // No transaction for a batch that writes nothing — `apply([])` is a normal outcome of a hand
      // where every seat broke even and no fee was due. It claims no key either: there is nothing to
      // apply twice.
      if (isNoop(entries, meta)) return { applied: true }
      const key = opts?.key
      return db.transaction(async (tx) => {
        if (key !== undefined) {
          const claimed = await tx.insert(ledgerKeys).values({ key }).onConflictDoNothing().returning({ key: ledgerKeys.key })
          if (claimed.length === 0) return { applied: false }
        }
        await creditWithin(tx, entries, meta)
        return { applied: true }
      })
    },

    creditWithin,
  }
}

/**
 * Empties `ledger_keys` and resolves how many keys went. Called once at boot, before any room exists.
 *
 * A key is only ever replayed by the room that claimed it — the pending buy-in, cash-out or release lives in that
 * room, in this process's memory — so once the process that claimed a key is gone, nothing can retry it. Normal
 * runs as one process (`docs/known-limitations.md`): at boot every key in the table belongs to a process that has
 * ended. A second server on the same database would lose its keys to this one's boot.
 */
export async function pruneLedgerKeys(db: AppDb): Promise<number> {
  const [row] = rowsOf<{ n: number | string }>(await db.execute(sql`with gone as (delete from ${ledgerKeys} returning 1) select count(*) as n from gone`))
  return Number(row?.n ?? 0)
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

    async sumsByDay(sinceMs, timeZone) {
      // Raw SQL, not the builder: the builder binds the zone once in the select and once in the `groupBy`, and
      // Postgres will not accept two parameters as the same expression. `group by 1, 2, 3` names the select list instead.
      const rows = rowsOf<{ day: string; reason: string; playerless: boolean; total: string | number }>(
        await db.execute(sql`
          select (created_at at time zone ${timeZone})::date::text as day,
                 reason,
                 (player_id is null) as playerless,
                 sum(amount)::bigint as total
          from ${pointTransactions}
          where created_at >= ${new Date(sinceMs)}
          group by 1, 2, 3
          order by 1, 2, 3`),
      )
      // `bigint` comes back from `pg` as a string, as `sum()` does above.
      return rows.map((r) => ({ day: r.day, reason: r.reason, playerless: r.playerless, total: Number(r.total) }))
    },
  }
}
