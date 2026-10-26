/**
 * `drizzle/0006_plan27.sql` against a database the real migrator already took to 0005.
 *
 * The migration is additive: reputation (two columns and a claim-once stamp on `players`, an event log, the rules and
 * the rank thresholds a GM edits), the shop's tables (prices, the weekly shelf, a key/value config holding the welcome
 * choices), the newcomer calendar, and `daily_logins.consecutive`. It seeds the rules, the ranks and the welcome
 * choices once, starts `consecutive` from the old `streak` (which was the consecutive run), and lifts a check-in count
 * broken by a missed day this month back to the month's claims (spec G).
 * What is checked here is that the migrator picks 0006 up (its journal `when` must be newer than 0005's, or it is
 * skipped without a word), that every statement is guarded (a second run changes nothing) and that the seeds and the
 * data step land exactly once.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { monthKey } from '../economy/daily-rules.js'
import { migrationsFolder, runMigrations } from './migrate.js'
import * as schema from './schema.js'

/** The economy's default zone (`config.ts`), which the data step names in SQL. */
const ECONOMY_ZONE = 'Asia/Ho_Chi_Minh'

const PLAYER_A = '11111111-1111-4111-8111-111111111111'
const PLAYER_B = '22222222-2222-4222-8222-222222222222'
const PLAYER_C = '33333333-3333-4333-8333-333333333333'
const PLAYER_D = '44444444-4444-4444-8444-444444444444'
/** The `when` of `0005_plan26` in the journal: 0006 must be newer, or an upgraded database never runs it. */
const WHEN_0005 = 1792459114276
const NEW_TABLES = ['newcomer_progress', 'reputation_events', 'reputation_ranks', 'reputation_rules', 'shop_config', 'shop_featured', 'shop_prices']
/** The tables a GM edits, whose `updated_by` must not be a foreign key (see `schema.ts`). */
const CONFIG_TABLES = ['reputation_rules', 'reputation_ranks', 'shop_prices', 'shop_featured', 'shop_config']
/** Every table a second run must leave alone, row for row. */
const COUNTED = ['players', 'daily_logins', ...NEW_TABLES]

let client: PGlite
const temps: string[] = []

const db = () => drizzle(client, { schema })

async function rows<T>(query: string): Promise<T[]> {
  const result = await client.query<T>(query)
  return result.rows
}

/** Takes the database to `0005_plan26` with the real migrator, through a copy of the folder whose journal stops there. */
async function migrateTo0005(): Promise<void> {
  const old = mkdtempSync(join(tmpdir(), 'bp-drizzle-0005-'))
  temps.push(old)
  cpSync(migrationsFolder(), old, { recursive: true })
  const journalPath = join(old, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number; tag: string }[] }
  const last = journal.entries.find((e) => e.tag === '0005_plan26')!
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.filter((e) => e.idx <= last.idx) }))
  const { migrate } = await import('drizzle-orm/pglite/migrator')
  await migrate(db(), { migrationsFolder: old })
}

/** Re-runs every statement of the committed 0006 file, the way the migrator splits it: guarded, so a no-op. */
async function reapply0006(): Promise<void> {
  const file = readFileSync(join(migrationsFolder(), '0006_plan27.sql'), 'utf8')
  for (const statement of file.split('--> statement-breakpoint')) {
    const trimmed = statement.trim()
    if (trimmed !== '') await client.exec(trimmed)
  }
}

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const table of COUNTED) {
    const [row] = await rows<{ n: number }>(`SELECT count(*)::int AS "n" FROM "${table}"`)
    out[table] = row!.n
  }
  return out
}

async function seedPlayer(id: string, key: string): Promise<void> {
  await client.exec(`INSERT INTO "users" ("id", "email", "password_hash") VALUES ('${id}', '${key}@example.com', 'argon2')`)
  await client.exec(`INSERT INTO "players" ("id", "display_name", "name_key", "balance") VALUES ('${id}', 'Player ${key}', '${key}', 95000)`)
}

/** `YYYY-MM` now in the economy's default zone: the month the data step computes from the database's `now()`. */
const economyMonth = () => monthKey(Date.now(), ECONOMY_ZONE)

beforeEach(() => {
  client = new PGlite()
})
afterEach(async () => {
  await client.close()
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('0006_plan27', () => {
  it('applies 0006 on a 0005 database and a second run changes nothing', async () => {
    await migrateTo0005()
    await seedPlayer(PLAYER_A, 'a')
    expect(await rows(`SELECT 1 FROM information_schema.tables WHERE "table_name" = 'reputation_events'`)).toEqual([])

    await runMigrations(db(), 'pglite')
    expect(await rows(`SELECT "hash" FROM "drizzle"."__drizzle_migrations"`)).toHaveLength(8)

    const columns = await rows<{ table_name: string; column_name: string; is_nullable: string; column_default: string | null }>(
      `SELECT "table_name", "column_name", "is_nullable", "column_default" FROM information_schema.columns
       WHERE ("table_name", "column_name") IN (('players', 'reputation'), ('players', 'rank'), ('players', 'welcome_claimed_at'), ('daily_logins', 'consecutive'), ('newcomer_progress', 'last_day_key'))
       ORDER BY "table_name", "column_name"`,
    )
    expect(columns.map((c) => [c.table_name, c.column_name, c.is_nullable, c.column_default])).toEqual([
      ['daily_logins', 'consecutive', 'NO', '0'],
      ['newcomer_progress', 'last_day_key', 'YES', null],
      ['players', 'rank', 'NO', '1'],
      ['players', 'reputation', 'NO', '0'],
      ['players', 'welcome_claimed_at', 'YES', null],
    ])
    const tables = await rows<{ table_name: string }>(`SELECT "table_name" FROM information_schema.tables WHERE "table_schema" = 'public' AND "table_name" = ANY('{${NEW_TABLES.join(',')}}') ORDER BY "table_name"`)
    expect(tables.map((t) => t.table_name)).toEqual(NEW_TABLES)
    // The existing player gets the defaults: no reputation, rank 1, no welcome claimed.
    expect(await rows(`SELECT "reputation", "rank", "welcome_claimed_at" FROM "players"`)).toEqual([{ reputation: 0, rank: 1, welcome_claimed_at: null }])

    const before = await counts()
    await runMigrations(db(), 'pglite') // nothing left to apply
    await reapply0006() // every statement is guarded
    expect(await counts()).toEqual(before)
    expect(await rows(`SELECT "hash" FROM "drizzle"."__drizzle_migrations"`)).toHaveLength(8)
  })

  it('seeds rules, ranks and welcome choices once', async () => {
    await migrateTo0005()
    await runMigrations(db(), 'pglite')
    await reapply0006()

    const rules = await rows<{ key: string; amount: number }>(`SELECT "key", "amount" FROM "reputation_rules" ORDER BY "key"`)
    expect(rules).toHaveLength(8)
    expect(Object.fromEntries(rules.map((r) => [r.key, r.amount]))).toEqual({
      achievement_big: 150,
      achievement_item: 500,
      achievement_small: 50,
      daily_login: 10,
      hand_played: 1,
      hand_won: 3,
      newcomer_day7: 200,
      welcome: 100,
    })
    const ranks = await rows<{ rank: number; threshold: number }>(`SELECT "rank", "threshold" FROM "reputation_ranks" ORDER BY "rank"`)
    expect(ranks).toEqual([
      { rank: 1, threshold: 0 },
      { rank: 2, threshold: 100 },
      { rank: 3, threshold: 400 },
      { rank: 4, threshold: 1800 },
      { rank: 5, threshold: 5000 },
    ])
    expect(await rows(`SELECT "key", "value" FROM "shop_config"`)).toEqual([
      { key: 'welcome_choices', value: ['outfit_dealer01', 'outfit_tet_red01', 'head_conical_hat01'] },
    ])
    // The catalogue's prices are seeded by code at boot (Task B1): the migration leaves the table empty.
    expect(await rows(`SELECT 1 FROM "shop_prices"`)).toEqual([])
  })

  it('keeps a GM-edited seed row on a second run', async () => {
    await migrateTo0005()
    await runMigrations(db(), 'pglite')
    await client.exec(`UPDATE "reputation_rules" SET "amount" = 7 WHERE "key" = 'hand_won'`)
    await client.exec(`UPDATE "shop_config" SET "value" = '["outfit_tuxedo01"]' WHERE "key" = 'welcome_choices'`)
    await reapply0006()
    expect(await rows(`SELECT "amount" FROM "reputation_rules" WHERE "key" = 'hand_won'`)).toEqual([{ amount: 7 }])
    expect(await rows(`SELECT "value" FROM "shop_config" WHERE "key" = 'welcome_choices'`)).toEqual([{ value: ['outfit_tuxedo01'] }])
  })

  it('lifts a broken streak to the month\'s claim count', async () => {
    await migrateTo0005()
    await seedPlayer(PLAYER_A, 'a')
    await seedPlayer(PLAYER_B, 'b')
    await seedPlayer(PLAYER_C, 'c')
    await seedPlayer(PLAYER_D, 'd')
    const monthBefore = economyMonth()
    await client.exec(`INSERT INTO "daily_logins" ("player_id", "streak", "claimed_days", "month") VALUES ('${PLAYER_A}', 2, 9, '${monthBefore}')`)
    await client.exec(`INSERT INTO "daily_logins" ("player_id", "streak", "claimed_days", "month") VALUES ('${PLAYER_B}', 1, 5, '2026-01')`)
    // Already above the month's claims (never lowered), and a row with no month yet (never matched).
    await client.exec(`INSERT INTO "daily_logins" ("player_id", "streak", "claimed_days", "month") VALUES ('${PLAYER_C}', 5, 3, '${monthBefore}')`)
    await client.exec(`INSERT INTO "daily_logins" ("player_id", "streak", "claimed_days", "month") VALUES ('${PLAYER_D}', 2, 4, '')`)

    await runMigrations(db(), 'pglite')
    await reapply0006()
    const monthAfter = economyMonth()

    const after = await rows<{ player_id: string; streak: number; claimed_days: number; month: string; consecutive: number }>(
      `SELECT "player_id", "streak", "claimed_days", "month", "consecutive" FROM "daily_logins" ORDER BY "player_id"`,
    )
    expect(after.map((r) => r.player_id)).toEqual([PLAYER_A, PLAYER_B, PLAYER_C, PLAYER_D])
    // A run that straddles the economy's month boundary may have migrated under either month; only then is A's row allowed to stay at 2.
    const expectedA = monthBefore === monthAfter ? [9] : [2, 9]
    expect(expectedA).toContain(after[0]!.streak)
    // Every row's old `streak` was its run of consecutive days, so that is where `consecutive` starts.
    expect(after[0]!.consecutive).toBe(2)
    expect(after[1]).toEqual({ player_id: PLAYER_B, streak: 1, claimed_days: 5, month: '2026-01', consecutive: 1 })
    expect(after[2]).toEqual({ player_id: PLAYER_C, streak: 5, claimed_days: 3, month: monthBefore, consecutive: 5 })
    expect(after[3]).toEqual({ player_id: PLAYER_D, streak: 2, claimed_days: 4, month: '', consecutive: 2 })
  })

  it('keeps a player\'s consecutive run when the streak is lifted, and a second run changes nothing', async () => {
    await migrateTo0005()
    await seedPlayer(PLAYER_A, 'a')
    await seedPlayer(PLAYER_B, 'b')
    const monthBefore = economyMonth()
    // Six days in a row so far, nine claims this month: the run must survive the lift.
    await client.exec(`INSERT INTO "daily_logins" ("player_id", "streak", "claimed_days", "month") VALUES ('${PLAYER_A}', 6, 9, '${monthBefore}')`)
    // Never claimed: stays at zero.
    await client.exec(`INSERT INTO "daily_logins" ("player_id") VALUES ('${PLAYER_B}')`)

    await runMigrations(db(), 'pglite')
    const monthAfter = economyMonth()
    const read = () => rows<{ player_id: string; streak: number; consecutive: number }>(`SELECT "player_id", "streak", "consecutive" FROM "daily_logins" ORDER BY "player_id"`)
    const once = await read()
    expect(once[0]!.consecutive).toBe(6)
    expect(monthBefore === monthAfter ? [9] : [6, 9]).toContain(once[0]!.streak)
    expect(once[1]).toEqual({ player_id: PLAYER_B, streak: 0, consecutive: 0 })

    await reapply0006()
    expect(await read()).toEqual(once)
  })

  it('refuses a non-positive reputation delta, a repeated event, a rank outside 1..5, a negative price and a negative rule amount or threshold', async () => {
    await migrateTo0005()
    await runMigrations(db(), 'pglite')
    await seedPlayer(PLAYER_A, 'a')

    await client.exec(`INSERT INTO "reputation_events" ("player_id", "delta", "reason", "ref_id") VALUES ('${PLAYER_A}', 3, 'hand_won', 'hand-1')`)
    await expect(client.exec(`INSERT INTO "reputation_events" ("player_id", "delta", "reason", "ref_id") VALUES ('${PLAYER_A}', 3, 'hand_won', 'hand-1')`)).rejects.toThrow()
    await expect(client.exec(`INSERT INTO "reputation_events" ("player_id", "delta", "reason", "ref_id") VALUES ('${PLAYER_A}', 0, 'hand_won', 'hand-2')`)).rejects.toThrow()
    await expect(client.exec(`INSERT INTO "reputation_ranks" ("rank", "threshold") VALUES (6, 9000)`)).rejects.toThrow()
    await expect(client.exec(`INSERT INTO "shop_prices" ("item_id", "price_points", "min_rank", "enabled") VALUES ('x', 10, 0, true)`)).rejects.toThrow()
    await expect(client.exec(`INSERT INTO "shop_prices" ("item_id", "price_points", "min_rank", "enabled") VALUES ('x', -1, 1, true)`)).rejects.toThrow()
    await client.exec(`INSERT INTO "shop_prices" ("item_id", "price_points", "min_rank", "enabled") VALUES ('x', 10000, 1, true)`)
    await expect(client.exec(`UPDATE "reputation_rules" SET "amount" = -1 WHERE "key" = 'hand_won'`)).rejects.toThrow()
    await expect(client.exec(`INSERT INTO "reputation_rules" ("key", "amount") VALUES ('custom', -5)`)).rejects.toThrow()
    await expect(client.exec(`UPDATE "reputation_ranks" SET "threshold" = -1 WHERE "rank" = 2`)).rejects.toThrow()
    // Zero is allowed: a GM may switch a source off, and rank 1 starts at 0.
    await client.exec(`UPDATE "reputation_rules" SET "amount" = 0 WHERE "key" = 'hand_played'`)

    await client.exec(`INSERT INTO "newcomer_progress" ("player_id") VALUES ('${PLAYER_A}')`)
    expect(await rows(`SELECT "day", "claimed_days", "finished_at", "last_day_key" FROM "newcomer_progress"`)).toEqual([
      { day: 1, claimed_days: [], finished_at: null, last_day_key: null },
    ])
    // A deleted account takes its reputation log and newcomer calendar with it.
    await client.exec(`DELETE FROM "users" WHERE "id" = '${PLAYER_A}'`)
    expect(await rows(`SELECT 1 FROM "reputation_events"`)).toEqual([])
    expect(await rows(`SELECT 1 FROM "newcomer_progress"`)).toEqual([])
  })

  it('the configuration tables carry no owner key, so deleting the GM who edited a row keeps the row', async () => {
    await migrateTo0005()
    await runMigrations(db(), 'pglite')
    await reapply0006()
    const keys = await rows<{ table_name: string; constraint_name: string }>(
      `SELECT "table_name", "constraint_name" FROM information_schema.table_constraints
       WHERE "constraint_type" = 'FOREIGN KEY' AND "table_name" = ANY('{${CONFIG_TABLES.join(',')}}')`,
    )
    expect(keys).toEqual([])

    await seedPlayer(PLAYER_A, 'a')
    await client.exec(`UPDATE "reputation_rules" SET "amount" = 4, "updated_by" = '${PLAYER_A}' WHERE "key" = 'hand_won'`)
    await client.exec(`DELETE FROM "users" WHERE "id" = '${PLAYER_A}'`)
    expect(await rows(`SELECT "amount", "updated_by" FROM "reputation_rules" WHERE "key" = 'hand_won'`)).toEqual([{ amount: 4, updated_by: PLAYER_A }])
    expect(await rows(`SELECT 1 FROM "reputation_rules"`)).toHaveLength(8)
  })

  it('the journal entry is newer than 0005', () => {
    const journal = JSON.parse(readFileSync(join(migrationsFolder(), 'meta', '_journal.json'), 'utf8')) as { entries: { idx: number; when: number; tag: string }[] }
    const entry = journal.entries.find((e) => e.tag === '0006_plan27')
    expect(entry?.idx).toBe(6)
    expect(entry?.when).toBeGreaterThan(WHEN_0005) // otherwise the migrator would skip 0006 on every upgraded database
  })
})
