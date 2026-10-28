/**
 * `drizzle/0008_chaos_titles.sql` against a database the real migrator already took to 0007.
 *
 * BP-41 (spec 2026-10-28 §4.4): three integer counters on `player_stats` — `chaos_ascensions`, `chaos_demigods`,
 * `chaos_gods_slain` — for the chaos titles. What is checked here is that the migrator picks 0008 up (its journal `when`
 * must be newer than 0007's), that an existing player's row gets 0 in all three, that every statement is guarded (a second
 * run changes nothing), and that the columns are what `schema.ts` says.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrationsFolder, runMigrations } from './migrate.js'
import * as schema from './schema.js'

/** The `when` of `0007_chaos` in the journal: 0008 must be newer, or an upgraded database never runs it. */
const WHEN_0007 = 1792977164664
const PLAYER = '11111111-1111-4111-8111-111111111111'

let client: PGlite
const temps: string[] = []

const db = () => drizzle(client, { schema })

async function rows<T>(query: string): Promise<T[]> {
  const result = await client.query<T>(query)
  return result.rows
}

/** Takes the database to `0007_chaos` with the real migrator, through a copy of the folder whose journal stops there. */
async function migrateTo0007(): Promise<void> {
  const old = mkdtempSync(join(tmpdir(), 'bp-drizzle-0007-'))
  temps.push(old)
  cpSync(migrationsFolder(), old, { recursive: true })
  const journalPath = join(old, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number; tag: string }[] }
  const last = journal.entries.find((e) => e.tag === '0007_chaos')!
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.filter((e) => e.idx <= last.idx) }))
  const { migrate } = await import('drizzle-orm/pglite/migrator')
  await migrate(db(), { migrationsFolder: old })
}

/** Re-runs every statement of the committed 0008 file, the way the migrator splits it: guarded, so a no-op. */
async function reapply0008(): Promise<void> {
  const file = readFileSync(join(migrationsFolder(), '0008_chaos_titles.sql'), 'utf8')
  for (const statement of file.split('--> statement-breakpoint')) {
    const trimmed = statement.trim()
    if (trimmed !== '') await client.exec(trimmed)
  }
}

const TITLES = `SELECT "player_id", "games_completed", "chaos_ascensions", "chaos_demigods", "chaos_gods_slain" FROM "player_stats"`

beforeEach(() => {
  client = new PGlite()
})
afterEach(async () => {
  await client.close()
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('0008_chaos_titles', () => {
  it('journals 0008 after 0007, so an upgraded database runs it', () => {
    const journal = JSON.parse(readFileSync(join(migrationsFolder(), 'meta', '_journal.json'), 'utf8')) as { entries: { when: number; tag: string }[] }
    const added = journal.entries.find((e) => e.tag === '0008_chaos_titles')
    expect(added).toBeDefined()
    expect(added!.when).toBeGreaterThan(WHEN_0007)
  })

  it('applies 0008 on a 0007 database, gives an existing player 0 in each title counter, and a second run changes nothing', async () => {
    await migrateTo0007()
    await client.exec(`INSERT INTO "users" ("id", "email", "password_hash") VALUES ('${PLAYER}', 'a@example.com', 'argon2')`)
    await client.exec(`INSERT INTO "players" ("id", "display_name", "name_key") VALUES ('${PLAYER}', 'a', 'a')`)
    await client.exec(`INSERT INTO "player_stats" ("player_id", "games_completed") VALUES ('${PLAYER}', 12)`)
    expect(await rows(`SELECT 1 FROM information_schema.columns WHERE "table_name" = 'player_stats' AND "column_name" = 'chaos_ascensions'`)).toEqual([])

    await runMigrations(db(), 'pglite')
    expect(await rows(`SELECT "hash" FROM "drizzle"."__drizzle_migrations"`)).toHaveLength(9)

    const columns = await rows<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT "column_name", "data_type", "is_nullable", "column_default" FROM information_schema.columns
       WHERE "table_name" = 'player_stats' AND "column_name" LIKE 'chaos_%' ORDER BY "column_name"`,
    )
    expect(columns).toEqual([
      { column_name: 'chaos_ascensions', data_type: 'integer', is_nullable: 'NO', column_default: '0' },
      { column_name: 'chaos_demigods', data_type: 'integer', is_nullable: 'NO', column_default: '0' },
      { column_name: 'chaos_gods_slain', data_type: 'integer', is_nullable: 'NO', column_default: '0' },
    ])
    const expected = [{ player_id: PLAYER, games_completed: 12, chaos_ascensions: 0, chaos_demigods: 0, chaos_gods_slain: 0 }]
    expect(await rows(TITLES)).toEqual(expected)

    await runMigrations(db(), 'pglite') // nothing left to apply
    await reapply0008() // every statement is guarded
    expect(await rows(TITLES)).toEqual(expected)
    expect(await rows(`SELECT "hash" FROM "drizzle"."__drizzle_migrations"`)).toHaveLength(9)
  })
})
