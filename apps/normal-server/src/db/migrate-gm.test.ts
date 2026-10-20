/**
 * `drizzle/0004_gm.sql` against a database that already holds players and ledger rows.
 *
 * The migration is additive: a role and a lock on `users`, and the `gm_actions` log. What is checked here is that
 * every existing account becomes a `player`, unlocked, that nothing else moves, that the CHECK and the foreign keys
 * hold, that the statements are guarded (a second run changes nothing), and that the real migrator picks 0004 up on
 * a database it already took to 0003 (its journal `when` must be newer than 0003's, or it is skipped without a word).
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
const BEFORE = ['0000_init', '0001_avatar_v2', '0002_outfits', '0003_ledger_keys']

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

/** The accounts and ledger rows a live 0003 database holds. */
async function seed(): Promise<void> {
  for (const [id, balance] of [[PLAYER_A, 95_000], [PLAYER_B, 104_000]] as const) {
    await client.exec(`INSERT INTO "users" ("id", "email", "password_hash") VALUES ('${id}', '${id}@example.com', 'argon2')`)
    await client.exec(`INSERT INTO "players" ("id", "display_name", "name_key", "balance") VALUES ('${id}', 'Player', 'player-${id}', ${balance})`)
  }
  await client.exec(`INSERT INTO "point_transactions" ("player_id", "amount", "reason", "ref_id", "kind") VALUES
    ('${PLAYER_A}', -5000, 'buy_in', 'room-1', NULL),
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

describe('0004_gm', () => {
  it('makes every existing account an unlocked player and leaves everything else as it was', async () => {
    for (const tag of BEFORE) await apply(tag)
    await seed()
    const before = await snapshot()

    await apply('0004_gm')

    expect(await snapshot()).toEqual(before)
    expect(await rows(`SELECT "role", "locked_at", "locked_reason" FROM "users"`)).toEqual([
      { role: 'player', locked_at: null, locked_reason: null },
      { role: 'player', locked_at: null, locked_reason: null },
    ])
    expect(await rows(`SELECT 1 FROM "gm_actions"`)).toEqual([])
  })

  it('knows only the two roles', async () => {
    for (const tag of [...BEFORE, '0004_gm']) await apply(tag)
    await client.exec(`INSERT INTO "users" ("email", "password_hash", "role") VALUES ('gm@example.com', 'h', 'gm')`)
    await expect(client.exec(`INSERT INTO "users" ("email", "password_hash", "role") VALUES ('king@example.com', 'h', 'king')`)).rejects.toThrow(/users_role_known/)
  })

  it('logs an action, keeps it when the actor or the target is deleted, and numbers rows in order', async () => {
    for (const tag of [...BEFORE, '0004_gm']) await apply(tag)
    for (const id of [PLAYER_A, PLAYER_B]) { // no ledger rows, so the account can be deleted
      await client.exec(`INSERT INTO "users" ("id", "email", "password_hash") VALUES ('${id}', '${id}@example.com', 'argon2')`)
      await client.exec(`INSERT INTO "players" ("id", "display_name", "name_key", "balance") VALUES ('${id}', 'Player', 'player-${id}', 0)`)
    }
    await client.exec(`INSERT INTO "gm_actions" ("actor_user_id", "action", "target_player_id", "amount", "reason", "details") VALUES
      ('${PLAYER_A}', 'grant_points', '${PLAYER_B}', 5000, 'compensation', '{"before":104000,"after":109000}'),
      (NULL, 'promote', '${PLAYER_A}', NULL, 'server CLI', NULL)`)
    const [first, second] = await rows<{ id: number; actor_user_id: string | null; amount: string | null; details: unknown }>(`SELECT * FROM "gm_actions" ORDER BY "id"`)
    expect(Number(second!.id)).toBeGreaterThan(Number(first!.id))
    expect(first!.details).toEqual({ before: 104000, after: 109000 })

    await client.exec(`DELETE FROM "users" WHERE "id" = '${PLAYER_A}'`) // cascades to players
    const kept = await rows<{ actor_user_id: string | null; target_player_id: string | null }>(`SELECT "actor_user_id", "target_player_id" FROM "gm_actions" ORDER BY "id"`)
    expect(kept).toEqual([
      { actor_user_id: null, target_player_id: PLAYER_B },
      { actor_user_id: null, target_player_id: null },
    ])
  })

  it('is guarded: running it again changes nothing', async () => {
    for (const tag of [...BEFORE, '0004_gm']) await apply(tag)
    await seed()
    await client.exec(`UPDATE "users" SET "role" = 'gm', "locked_reason" = 'x' WHERE "id" = '${PLAYER_A}'`)
    await client.exec(`INSERT INTO "gm_actions" ("action", "reason") VALUES ('lock', 'r')`)
    await apply('0004_gm')
    expect(await rows(`SELECT "role", "locked_reason" FROM "users" WHERE "id" = '${PLAYER_A}'`)).toEqual([{ role: 'gm', locked_reason: 'x' }])
    expect(await rows(`SELECT 1 FROM "gm_actions"`)).toHaveLength(1)
  })

  it('is applied by the real migrator to a database it had already taken to 0003, and only once', async () => {
    // A copy of the committed folder whose journal stops at 0003: what a database migrated before this change saw.
    const old = mkdtempSync(join(tmpdir(), 'bp-drizzle-0003-'))
    temps.push(old)
    cpSync(migrationsFolder(), old, { recursive: true })
    const journalPath = join(old, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number; when: number; tag: string }[] }
    const last = journal.entries.find((e) => e.tag === '0003_ledger_keys')!
    const added = journal.entries.find((e) => e.tag === '0004_gm')
    expect(added?.when).toBeGreaterThan(last.when) // otherwise the migrator would skip 0004 on every upgraded database
    writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.filter((e) => e.idx <= last.idx) }))

    const db = drizzle(client, { schema })
    await migrate(db, { migrationsFolder: old })
    expect(await rows(`SELECT 1 FROM information_schema.tables WHERE "table_name" = 'gm_actions'`)).toEqual([])
    await seed()
    const before = await snapshot()

    await migrate(db, { migrationsFolder: migrationsFolder() })
    expect(await rows(`SELECT 1 FROM information_schema.tables WHERE "table_name" = 'gm_actions'`)).toHaveLength(1)
    expect(await snapshot()).toEqual(before)
    expect(await rows(`SELECT "role" FROM "users" ORDER BY "id"`)).toEqual([{ role: 'player' }, { role: 'player' }])
    await migrate(db, { migrationsFolder: migrationsFolder() }) // nothing left to apply
    expect(await rows(`SELECT "hash" FROM "drizzle"."__drizzle_migrations"`)).toHaveLength(6)
  })
})
