/**
 * `drizzle/0003_ledger_keys.sql` against a database that already holds players and ledger rows.
 *
 * The migration only adds a table — `ledger_keys`, the keys `BalanceRepository.apply` claims so a retried write is
 * applied once — so what is checked here is that nothing that was there before moves, that the key is unique, and
 * that the real migrator picks 0003 up on a database it already took to 0002 (its journal `when` must be newer than
 * 0002's, or the migrator skips it without a word).
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
const PLAYER_B = '22222222-2222-4222-8222-222222222222'

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

/** The players and ledger rows a live 0002 database holds: two balances, a buy-in, a cash-out and a sink. */
async function seed(): Promise<void> {
  for (const [id, balance] of [[PLAYER_A, 95_000], [PLAYER_B, 104_000]] as const) {
    await client.exec(`INSERT INTO "users" ("id", "email", "password_hash") VALUES ('${id}', '${id}@example.com', 'argon2')`)
    await client.exec(`INSERT INTO "players" ("id", "display_name", "name_key", "balance") VALUES ('${id}', 'Player', 'player-${id}', ${balance})`)
  }
  await client.exec(`INSERT INTO "point_transactions" ("player_id", "amount", "reason", "ref_id", "kind") VALUES
    ('${PLAYER_A}', -5000, 'buy_in', 'room-1', NULL),
    ('${PLAYER_B}', 4000, 'cash_out', 'room-1', NULL),
    (NULL, 40, 'table_fee', 'hand-1', 'table_fee')`)
}

const snapshot = async () => ({
  players: await rows(`SELECT "id", "balance" FROM "players" ORDER BY "id"`),
  ledger: await rows(`SELECT "id", "player_id", "amount", "reason", "ref_id", "kind", "created_at" FROM "point_transactions" ORDER BY "id"`),
})

beforeEach(() => {
  client = new PGlite()
})
afterEach(async () => {
  await client.close()
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('0003_ledger_keys', () => {
  it('adds the ledger_keys table and leaves every existing player and ledger row as it was', async () => {
    await apply('0000_init')
    await apply('0001_avatar_v2')
    await apply('0002_outfits')
    await seed()
    const before = await snapshot()

    await apply('0003_ledger_keys')

    expect(await snapshot()).toEqual(before)
    const columns = await rows<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT "column_name", "data_type", "is_nullable" FROM information_schema.columns WHERE "table_name" = 'ledger_keys' ORDER BY "ordinal_position"`,
    )
    expect(columns).toEqual([
      { column_name: 'key', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
    ])
    expect(await rows(`SELECT * FROM "ledger_keys"`)).toEqual([]) // existing rows need no key
  })

  it('keeps a key unique', async () => {
    for (const tag of ['0000_init', '0001_avatar_v2', '0002_outfits', '0003_ledger_keys']) await apply(tag)
    await client.exec(`INSERT INTO "ledger_keys" ("key") VALUES ('cash_out:room-1:s1')`)
    await expect(client.exec(`INSERT INTO "ledger_keys" ("key") VALUES ('cash_out:room-1:s1')`)).rejects.toThrow(/ledger_keys_pkey|duplicate key/)
    const [row] = await rows<{ key: string; created_at: Date }>(`SELECT "key", "created_at" FROM "ledger_keys"`)
    expect(row!.key).toBe('cash_out:room-1:s1')
    expect(row!.created_at).toBeInstanceOf(Date) // defaulted
  })

  it('is guarded by CREATE TABLE IF NOT EXISTS: running it again changes nothing', async () => {
    for (const tag of ['0000_init', '0001_avatar_v2', '0002_outfits', '0003_ledger_keys']) await apply(tag)
    await client.exec(`INSERT INTO "ledger_keys" ("key") VALUES ('buy_in:room-1:s1')`)
    await apply('0003_ledger_keys')
    expect((await rows<{ key: string }>(`SELECT "key" FROM "ledger_keys"`)).map((r) => r.key)).toEqual(['buy_in:room-1:s1'])
  })

  it('is applied by the real migrator to a database it had already taken to 0002, and only once', async () => {
    // A copy of the committed folder whose journal stops at 0002: what a database migrated before this change saw.
    const old = mkdtempSync(join(tmpdir(), 'bp-drizzle-0002-'))
    temps.push(old)
    cpSync(migrationsFolder(), old, { recursive: true })
    const journalPath = join(old, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number; when: number; tag: string }[] }
    const last = journal.entries.find((e) => e.tag === '0002_outfits')!
    const added = journal.entries.find((e) => e.tag === '0003_ledger_keys')
    expect(added?.when).toBeGreaterThan(last.when) // otherwise the migrator would skip 0003 on every upgraded database
    writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.filter((e) => e.idx <= last.idx) }))

    const db = drizzle(client, { schema })
    await migrate(db, { migrationsFolder: old })
    expect(await rows(`SELECT 1 FROM information_schema.tables WHERE "table_name" = 'ledger_keys'`)).toEqual([])
    await seed()
    const before = await snapshot()

    await migrate(db, { migrationsFolder: migrationsFolder() })
    expect(await rows(`SELECT 1 FROM information_schema.tables WHERE "table_name" = 'ledger_keys'`)).toHaveLength(1)
    expect(await snapshot()).toEqual(before)
    await migrate(db, { migrationsFolder: migrationsFolder() }) // nothing left to apply
    expect(await rows(`SELECT "hash" FROM "drizzle"."__drizzle_migrations"`)).toHaveLength(4)
  })
})
