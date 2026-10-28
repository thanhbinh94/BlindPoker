/**
 * `drizzle/0007_chaos.sql` against a database the real migrator already took to 0006.
 *
 * The migration is additive: the GM's per-card rules (`chaos_card_rules`), the chaos settings (`chaos_config`) and the
 * nullable `games.chaos_used`. What is checked here is that the migrator picks 0007 up (its journal `when` must be newer
 * than 0006's, or it is skipped without a word), that every statement is guarded (a second run changes nothing), that an
 * existing hand keeps a null `chaos_used`, and that the weight CHECK and the missing foreign key on `updated_by` are as
 * `schema.ts` says.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrationsFolder, runMigrations } from './migrate.js'
import * as schema from './schema.js'

/** The `when` of `0006_plan27` in the journal: 0007 must be newer, or an upgraded database never runs it. */
const WHEN_0006 = 1792627950919

let client: PGlite
const temps: string[] = []

const db = () => drizzle(client, { schema })

async function rows<T>(query: string): Promise<T[]> {
  const result = await client.query<T>(query)
  return result.rows
}

/** Takes the database to `0006_plan27` with the real migrator, through a copy of the folder whose journal stops there. */
async function migrateTo0006(): Promise<void> {
  const old = mkdtempSync(join(tmpdir(), 'bp-drizzle-0006-'))
  temps.push(old)
  cpSync(migrationsFolder(), old, { recursive: true })
  const journalPath = join(old, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number; tag: string }[] }
  const last = journal.entries.find((e) => e.tag === '0006_plan27')!
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.filter((e) => e.idx <= last.idx) }))
  const { migrate } = await import('drizzle-orm/pglite/migrator')
  await migrate(db(), { migrationsFolder: old })
}

/** Re-runs every statement of the committed 0007 file, the way the migrator splits it: guarded, so a no-op. */
async function reapply0007(): Promise<void> {
  const file = readFileSync(join(migrationsFolder(), '0007_chaos.sql'), 'utf8')
  for (const statement of file.split('--> statement-breakpoint')) {
    const trimmed = statement.trim()
    if (trimmed !== '') await client.exec(trimmed)
  }
}

beforeEach(() => {
  client = new PGlite()
})
afterEach(async () => {
  await client.close()
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('0007_chaos', () => {
  it('journals 0007 after 0006, so an upgraded database runs it', () => {
    const journal = JSON.parse(readFileSync(join(migrationsFolder(), 'meta', '_journal.json'), 'utf8')) as { entries: { when: number; tag: string }[] }
    const added = journal.entries.find((e) => e.tag === '0007_chaos')
    expect(added).toBeDefined()
    expect(added!.when).toBeGreaterThan(WHEN_0006)
  })

  it('applies 0007 on a 0006 database, keeps an existing hand, and a second run changes nothing', async () => {
    await migrateTo0006()
    await client.exec(`INSERT INTO "games" ("id", "room_id", "mode", "config", "started_at", "ended_at") VALUES ('h1', 'r1', 'blind', '{}', now(), now())`)
    expect(await rows(`SELECT 1 FROM information_schema.tables WHERE "table_name" = 'chaos_card_rules'`)).toEqual([])

    await runMigrations(db(), 'pglite')
    expect(await rows(`SELECT "hash" FROM "drizzle"."__drizzle_migrations"`)).toHaveLength(9)

    const tables = await rows<{ table_name: string }>(
      `SELECT "table_name" FROM information_schema.tables WHERE "table_schema" = 'public' AND "table_name" IN ('chaos_card_rules', 'chaos_config') ORDER BY "table_name"`,
    )
    expect(tables.map((t) => t.table_name)).toEqual(['chaos_card_rules', 'chaos_config'])
    const columns = await rows<{ table_name: string; column_name: string; is_nullable: string; column_default: string | null }>(
      `SELECT "table_name", "column_name", "is_nullable", "column_default" FROM information_schema.columns
       WHERE ("table_name", "column_name") IN (('games', 'chaos_used'), ('chaos_card_rules', 'weight'), ('chaos_card_rules', 'starts_at'), ('chaos_card_rules', 'ends_at'), ('chaos_card_rules', 'updated_by'))
       ORDER BY "table_name", "column_name"`,
    )
    expect(columns.map((c) => [c.table_name, c.column_name, c.is_nullable, c.column_default])).toEqual([
      ['chaos_card_rules', 'ends_at', 'YES', null],
      ['chaos_card_rules', 'starts_at', 'YES', null],
      ['chaos_card_rules', 'updated_by', 'YES', null],
      ['chaos_card_rules', 'weight', 'NO', '1'],
      ['games', 'chaos_used', 'YES', null],
    ])
    expect(await rows(`SELECT "id", "chaos_used" FROM "games"`)).toEqual([{ id: 'h1', chaos_used: null }])
    // No seed: a card with no rule follows the file.
    expect(await rows(`SELECT 1 FROM "chaos_card_rules"`)).toEqual([])
    expect(await rows(`SELECT 1 FROM "chaos_config"`)).toEqual([])

    await runMigrations(db(), 'pglite') // nothing left to apply
    await reapply0007() // every statement is guarded
    expect(await rows(`SELECT "id", "chaos_used" FROM "games"`)).toEqual([{ id: 'h1', chaos_used: null }])
    expect(await rows(`SELECT "hash" FROM "drizzle"."__drizzle_migrations"`)).toHaveLength(9)
  })

  it('refuses a weight outside 0..100 and keeps updated_by free of foreign keys', async () => {
    await runMigrations(db(), 'pglite')
    await client.exec(`INSERT INTO "chaos_card_rules" ("card_id", "enabled", "weight") VALUES ('a', true, 0), ('b', false, 100)`)
    await expect(client.exec(`INSERT INTO "chaos_card_rules" ("card_id", "enabled", "weight") VALUES ('c', true, 101)`)).rejects.toThrow()
    await expect(client.exec(`INSERT INTO "chaos_card_rules" ("card_id", "enabled", "weight") VALUES ('d', true, -1)`)).rejects.toThrow()
    // A GM id that is not (or no longer) a user is accepted: the configuration must survive `truncate users … cascade`.
    await client.exec(`INSERT INTO "chaos_card_rules" ("card_id", "enabled", "updated_by") VALUES ('e', true, '99999999-9999-4999-8999-999999999999')`)
    await client.exec(`INSERT INTO "chaos_config" ("key", "value", "updated_by") VALUES ('chaos', '{}'::jsonb, '99999999-9999-4999-8999-999999999999')`)
    const keys = await rows<{ table_name: string }>(
      `SELECT "table_name" FROM information_schema.table_constraints WHERE "constraint_type" = 'FOREIGN KEY' AND "table_name" IN ('chaos_card_rules', 'chaos_config')`,
    )
    expect(keys).toEqual([])
  })
})
