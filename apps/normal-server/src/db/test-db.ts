/**
 * A migrated, throwaway database for tests.
 *
 * By default it is PGlite: real Postgres compiled to WASM, running in this process, with nothing to
 * install and no container to wait for. Set `TEST_DATABASE_URL` and the same tests run against a real
 * server instead, each `createTestDb()` in a database of its own that is dropped on close — which is
 * how anything PGlite cannot answer for (concurrent `FOR UPDATE` settlement, above all) gets checked
 * before release.
 */
import { randomBytes } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import type { AppDb } from './client.js'
import { createPgDb } from './client.js'
import { runMigrations } from './migrate.js'
import * as schema from './schema.js'

export interface TestDb {
  db: AppDb
  close(): Promise<void>
}

export async function createTestDb(): Promise<TestDb> {
  const url = process.env.TEST_DATABASE_URL
  return url ? createFreshPgTestDb(url) : createPgliteTestDb()
}

async function createPgliteTestDb(): Promise<TestDb> {
  const client = new PGlite()
  const db = drizzlePglite(client, { schema })
  await runMigrations(db, 'pglite')
  return {
    db,
    async close() {
      await client.close()
    },
  }
}

/**
 * Isolation is a whole database rather than the `CREATE SCHEMA test_<rand>` + `search_path` the plan
 * sketched, because the generated migration writes its foreign keys as `REFERENCES "public"."players"`:
 * under a different `search_path` those tables would be created in the throwaway schema while every
 * foreign key still pointed at `public`, which either fails outright or — worse, in a database that
 * already has the schema — quietly binds the test's rows to the shared tables. A fresh database has a
 * `public` of its own, so the committed SQL means what it says.
 */
async function createFreshPgTestDb(url: string): Promise<TestDb> {
  const name = `bp_test_${randomBytes(6).toString('hex')}`
  await withAdmin(url, (db) => db.execute(sql.raw(`CREATE DATABASE "${name}"`)))

  const scoped = new URL(url)
  scoped.pathname = `/${name}`
  const handle = createPgDb(scoped.toString(), { max: 4 })
  await runMigrations(handle.db, 'pg')

  return {
    db: handle.db,
    async close() {
      await handle.close()
      // FORCE terminates anything still connected: a test that leaked a connection should not leave
      // an undroppable database behind for the next run to trip over.
      await withAdmin(url, (db) => db.execute(sql.raw(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)))
    },
  }
}

async function withAdmin(url: string, fn: (db: AppDb) => Promise<unknown>): Promise<void> {
  const admin = createPgDb(url, { max: 1 })
  try {
    await fn(admin.db)
  } finally {
    await admin.close()
  }
}
