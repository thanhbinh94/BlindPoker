/**
 * The database handle the rest of the server is written against.
 *
 * Repositories and services take `AppDb`, never `NodePgDatabase`: `AppDb` is drizzle's driver-neutral
 * `PgDatabase`, so the very same query code runs against the `pg` pool in production and against the
 * in-process PGlite of the tests. `AppTx` is its transaction counterpart, for the "do this inside the
 * caller's transaction" methods (`creditWithin`, `grant`, …).
 */
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core'
import pg from 'pg'
import * as schema from './schema.js'

export type AppDb = PgDatabase<PgQueryResultHKT, typeof schema>
export type AppTx = PgTransaction<PgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>

/**
 * Rows out of a raw `db.execute(sql\`…\`)`.
 *
 * The price of the driver-neutral `AppDb` is that `execute` cannot say what it returns: the two
 * drivers disagree (`pg` hands back a `QueryResult`, PGlite an object of its own), so drizzle types
 * the generic case as `unknown`. Raw SQL — the `SELECT … FOR UPDATE` of settlement, an aggregate the
 * query builder cannot express — goes through here rather than through a cast at each call site.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  const rows = (result as { rows?: unknown }).rows
  return Array.isArray(rows) ? (rows as T[]) : []
}

export interface DbHandle {
  db: AppDb
  close(): Promise<void>
  /** `false` rather than a throw: `/health` wants an answer, not an exception. */
  ping(): Promise<boolean>
}

/**
 * Opens a pooled `pg` connection. The pool is lazy — no connection is made until the first query —
 * so this never fails at construction; `ping()` is how you learn the database is reachable.
 */
export function createPgDb(databaseUrl: string, opts: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: opts.max ?? 10 })
  // A pool error (server restarted, network dropped) is emitted on the pool itself; without a
  // listener Node would take the process down for an event the pool recovers from on its own.
  pool.on('error', () => {})
  const db = drizzle(pool, { schema })
  return {
    db,
    async close() {
      await pool.end()
    },
    async ping() {
      try {
        const res = await pool.query('SELECT 1 AS ok')
        return res.rows.length === 1
      } catch {
        return false
      }
    },
  }
}
