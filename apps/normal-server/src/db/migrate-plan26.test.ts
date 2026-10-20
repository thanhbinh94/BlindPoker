/**
 * `drizzle/0005_plan26.sql` against a database that already holds players, an inventory and ledger rows.
 *
 * The migration is additive: the `gift_months` table (Plan 26's per-month gift overrides), a nullable `ref` on
 * `inventory` (which claim an item came from) and an index on `point_transactions (created_at)` for the per-day
 * source/sink table. What is checked here is that nothing existing moves, that the statements are guarded (a second
 * run changes nothing), and that the real migrator picks 0005 up on a database it already took to 0004 (its journal
 * `when` must be newer than 0004's, or it is skipped without a word).
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrationsFolder, packageRoot } from './migrate.js'
import * as schema from './schema.js'

const PLAYER_A = '11111111-1111-4111-8111-111111111111'
const BEFORE = ['0000_init', '0001_avatar_v2', '0002_outfits', '0003_ledger_keys', '0004_gm']
/** The `when` of `0004_gm` in the journal: 0005 must be newer, or an upgraded database never runs it. */
const WHEN_0004 = 1792330901284

let client: PGlite
const temps: string[] = []

/** Applies one committed migration the way the drizzle migrator does: split, then statement by statement. */
async function apply(tag: string): Promise<void> {
  const file = readFileSync(join(packageRoot(), 'drizzle', `${tag}.sql`), 'utf8')
  for (const statement of file.split('--> statement-breakpoint')) {
    const trimmed = statement.trim()
    if (trimmed !== '') await client.exec(trimmed)
  }
}

async function rows<T>(query: string): Promise<T[]> {
  const result = await client.query<T>(query)
  return result.rows
}

/** A 0004 database with one player, an owned item and ledger rows. */
async function seed(): Promise<void> {
  await client.exec(`INSERT INTO "users" ("id", "email", "password_hash") VALUES ('${PLAYER_A}', 'a@example.com', 'argon2')`)
  await client.exec(`INSERT INTO "players" ("id", "display_name", "name_key", "balance") VALUES ('${PLAYER_A}', 'Player', 'player-a', 95000)`)
  await client.exec(`INSERT INTO "items" ("id", "category", "rarity", "name_key", "asset_key") VALUES ('hat-1', 'hat', 'common', 'k', 'a')`)
  await client.exec(`INSERT INTO "inventory" ("player_id", "item_id", "source") VALUES ('${PLAYER_A}', 'hat-1', 'daily')`)
  await client.exec(`INSERT INTO "point_transactions" ("player_id", "amount", "reason", "ref_id") VALUES ('${PLAYER_A}', -5000, 'buy_in', 'room-1')`)
}

const snapshot = async () => ({
  players: await rows(`SELECT "id", "balance" FROM "players" ORDER BY "id"`),
  inventory: await rows(`SELECT "player_id", "item_id", "source", "acquired_at" FROM "inventory" ORDER BY "item_id"`),
  ledger: await rows(`SELECT "id", "player_id", "amount", "reason", "ref_id", "kind", "created_at" FROM "point_transactions" ORDER BY "id"`),
})

beforeEach(() => {
  client = new PGlite()
})
afterEach(async () => {
  await client.close()
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('0005_plan26', () => {
  it('adds gift_months, inventory.ref and the created_at index, idempotently, and leaves existing rows alone', async () => {
    for (const tag of BEFORE) await apply(tag)
    await seed()
    const before = await snapshot()

    await apply('0005_plan26')
    await apply('0005_plan26') // guarded: a second run is a no-op

    expect(await snapshot()).toEqual(before)
    expect(await rows(`SELECT "column_name", "is_nullable" FROM information_schema.columns WHERE "table_name" = 'inventory' AND "column_name" = 'ref'`)).toEqual([{ column_name: 'ref', is_nullable: 'YES' }])
    expect(await rows(`SELECT "ref" FROM "inventory"`)).toEqual([{ ref: null }])
    expect(await rows(`SELECT "indexname" FROM pg_indexes WHERE "indexname" = 'point_transactions_created_at_idx'`)).toHaveLength(1)
    expect(await rows(`SELECT 1 FROM information_schema.tables WHERE "table_name" = 'gift_months'`)).toHaveLength(1)
  })

  it('stores one gift month per key, with who set it, and keeps the month when the actor is deleted', async () => {
    for (const tag of [...BEFORE, '0005_plan26']) await apply(tag)
    await client.exec(`INSERT INTO "users" ("id", "email", "password_hash") VALUES ('${PLAYER_A}', 'a@example.com', 'argon2')`)
    await client.exec(`INSERT INTO "gift_months" ("month", "days", "updated_by") VALUES ('2026-11', '{"28":["item-a"]}', '${PLAYER_A}')`)
    await expect(client.exec(`INSERT INTO "gift_months" ("month", "days") VALUES ('2026-11', '{}')`)).rejects.toThrow()
    const [month] = await rows<{ days: unknown; updated_at: Date | string }>(`SELECT "days", "updated_at" FROM "gift_months"`)
    expect(month!.days).toEqual({ 28: ['item-a'] })
    expect(month!.updated_at).toBeTruthy()

    await client.exec(`DELETE FROM "users" WHERE "id" = '${PLAYER_A}'`)
    expect(await rows(`SELECT "month", "updated_by" FROM "gift_months"`)).toEqual([{ month: '2026-11', updated_by: null }])
  })

  it('is applied by the real migrator to a database it had already taken to 0004, and only once', async () => {
    // A copy of the committed folder whose journal stops at 0004: what a database migrated before this change saw.
    const old = mkdtempSync(join(tmpdir(), 'bp-drizzle-0004-'))
    temps.push(old)
    cpSync(migrationsFolder(), old, { recursive: true })
    const journalPath = join(old, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number; when: number; tag: string }[] }
    const last = journal.entries.find((e) => e.tag === '0004_gm')!
    const added = journal.entries.find((e) => e.tag === '0005_plan26')
    expect(last.when).toBe(WHEN_0004)
    expect(added?.when).toBeGreaterThan(WHEN_0004) // otherwise the migrator would skip 0005 on every upgraded database
    writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.filter((e) => e.idx <= last.idx) }))

    const db = drizzle(client, { schema })
    await migrate(db, { migrationsFolder: old })
    expect(await rows(`SELECT 1 FROM information_schema.tables WHERE "table_name" = 'gift_months'`)).toEqual([])
    await seed()
    const before = await snapshot()

    await migrate(db, { migrationsFolder: migrationsFolder() })
    expect(await rows(`SELECT 1 FROM information_schema.tables WHERE "table_name" = 'gift_months'`)).toHaveLength(1)
    expect(await snapshot()).toEqual(before)
    await migrate(db, { migrationsFolder: migrationsFolder() }) // nothing left to apply
    expect(await rows(`SELECT "hash" FROM "drizzle"."__drizzle_migrations"`)).toHaveLength(6)
  })
})
