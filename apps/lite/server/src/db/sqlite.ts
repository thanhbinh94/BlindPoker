import type { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './migrations.js'

/**
 * `node:sqlite` is still experimental, so Node keeps it out of `module.builtinModules`. Bundlers
 * and loaders that decide "is this a built-in?" from that list (vite-node, esbuild) therefore try
 * to resolve a `sqlite` package from disk and fail. `process.getBuiltinModule` asks Node directly
 * at run time, which no bundler can misread, and it is typed by `@types/node`.
 */
const { DatabaseSync: Database } = process.getBuiltinModule('node:sqlite')

/**
 * Opens (creating if needed) the Lite SQLite database and brings it up to the current schema.
 *
 * `':memory:'` is accepted for tests. File databases get WAL — one writer alongside many readers,
 * and a crash-safe journal — which is meaningless for an in-memory database (SQLite silently keeps
 * `memory` journal mode there), so we only ask for it when there is a file behind the handle.
 */
export function openDatabase(path: string): DatabaseSync {
  const db = new Database(path)
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  migrate(db)
  return db
}

function userVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
  return Number(row?.user_version ?? 0)
}

/**
 * Applies every migration beyond `PRAGMA user_version` and returns the resulting version.
 *
 * Each migration is its own transaction, so a failing one leaves the database at the last version
 * that fully applied rather than half-migrated. Idempotent: with nothing to do it touches nothing.
 */
export function migrate(db: DatabaseSync): number {
  let version = userVersion(db)
  for (let i = version; i < MIGRATIONS.length; i += 1) {
    const steps = MIGRATIONS[i] ?? []
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const step of steps) {
        if (typeof step === 'string') db.exec(step)
        else step(db) // a data migration that needs a rule SQLite cannot express
      }
      // `user_version` takes no bind parameters; `i` is a loop index, never user input.
      db.exec(`PRAGMA user_version = ${i + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      try {
        db.exec('ROLLBACK')
      } catch {
        /* the failure already aborted the transaction — keep the original error */
      }
      throw err
    }
    version = i + 1
  }
  return version
}
