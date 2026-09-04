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
 *
 * An unrecognised envelope throws rather than yielding `[]`: in the money path "the lock found no
 * rows" and "I could not read the driver's answer" must never look the same.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  const rows = (result as { rows?: unknown } | null)?.rows
  if (Array.isArray(rows)) return rows as T[]
  throw new TypeError(`unrecognised query result shape: ${describe(result)}`)
}

function describe(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  if (typeof value !== 'object') return typeof value
  return `object with keys [${Object.keys(value).join(', ')}]`
}

export interface DbHandle {
  db: AppDb
  close(): Promise<void>
  /** `false` rather than a throw: `/health` wants an answer, not an exception. */
  ping(): Promise<boolean>
}

export interface PgDbOptions {
  /** Pool size, default 10. */
  max?: number
  /**
   * Called for every error the pool raises on an idle connection. Pass the server's logger: without
   * a handler Node kills the process over an event the pool recovers from, but with an empty one a
   * database that is dropping every connection is completely invisible.
   */
  onError?: (err: Error) => void
}

/**
 * Opens a pooled `pg` connection. The pool is lazy — no connection is made until the first query —
 * so this never fails at construction; `ping()` is how you learn the database is reachable.
 */
export function createPgDb(databaseUrl: string, opts: PgDbOptions = {}): DbHandle {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: opts.max ?? 10 })
  pool.on('error', (err) => opts.onError?.(err))
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
