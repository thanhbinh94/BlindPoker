import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppDb } from './client.js'
import { rowsOf } from './client.js'
import { sqlstate } from './pg-errors.js'
import * as schema from './schema.js'
import type { TestDb } from './test-db.js'
import { createTestDb } from './test-db.js'

/**
 * Drizzle wraps a driver error in a `Failed query: …` of its own, so what a constraint actually said
 * is one or two `cause` links down. This flattens the chain to the SQLSTATE plus every message, which
 * is what the tests below assert on — `23514` (check), `23505` (unique) and `23503` (foreign key) mean
 * the same thing on PGlite and on a real server, where the wording need not.
 */
async function failureOf(run: () => Promise<unknown>): Promise<{ code: string | undefined; text: string }> {
  try {
    await run()
  } catch (err) {
    const messages: string[] = []
    for (let e: unknown = err; e instanceof Error; e = (e as { cause?: unknown }).cause) messages.push(e.message)
    return { code: sqlstate(err), text: messages.join(' | ') }
  }
  throw new Error('expected the query to be rejected, but it succeeded')
}

/** Creates the account + profile pair every game-side table hangs off. */
async function seedPlayer(db: AppDb, opts: { email: string; nameKey: string; balance?: number }): Promise<string> {
  const [user] = await db.insert(schema.users).values({ email: opts.email, passwordHash: 'argon2-hash' }).returning({ id: schema.users.id })
  const id = user!.id
  await db.insert(schema.players).values({ id, displayName: opts.nameKey.slice(0, 20), nameKey: opts.nameKey, balance: opts.balance ?? 0 })
  return id
}

describe('schema', () => {
  let test: TestDb
  let db: AppDb

  beforeAll(async () => {
    test = await createTestDb()
    db = test.db
  })
  afterAll(async () => {
    await test.close()
  })

  it('applies the committed migrations, creating every table', async () => {
    const rows = rowsOf<{ table_name: string }>(await db.execute(sql`select table_name from information_schema.tables where table_schema = current_schema()`))
    const names = rows.map((r) => r.table_name)
    for (const table of ['users', 'players', 'sessions', 'point_transactions', 'games', 'game_players', 'items', 'inventory', 'player_achievements', 'daily_logins', 'player_stats']) {
      expect(names, table).toContain(table)
    }
  })

  it('is idempotent: running the migrations again applies nothing', async () => {
    const { runMigrations } = await import('./migrate.js')
    await expect(runMigrations(db, process.env.TEST_DATABASE_URL ? 'pg' : 'pglite')).resolves.toBeUndefined()
  })

  it('refuses a negative balance', async () => {
    const id = await seedPlayer(db, { email: 'check@example.com', nameKey: 'check', balance: 100 })
    const failure = await failureOf(() => db.update(schema.players).set({ balance: -1 }).where(sql`${schema.players.id} = ${id}`))
    expect(failure.code).toBe('23514')
    expect(failure.text).toMatch(/players_balance_non_negative/)
    const [row] = await db.select({ balance: schema.players.balance }).from(schema.players).where(sql`${schema.players.id} = ${id}`)
    expect(row!.balance).toBe(100)
  })

  it('rejects a balance below zero at insert time as well', async () => {
    const [user] = await db.insert(schema.users).values({ email: 'neg@example.com', passwordHash: 'h' }).returning({ id: schema.users.id })
    const failure = await failureOf(() => db.insert(schema.players).values({ id: user!.id, displayName: 'neg', nameKey: 'neg', balance: -5 }))
    expect(failure.code).toBe('23514')
    expect(failure.text).toMatch(/players_balance_non_negative/)
  })

  it('keeps email unique', async () => {
    await db.insert(schema.users).values({ email: 'dup@example.com', passwordHash: 'h' })
    const failure = await failureOf(() => db.insert(schema.users).values({ email: 'dup@example.com', passwordHash: 'h' }))
    expect(failure.code).toBe('23505')
    expect(failure.text).toMatch(/users_email_unique/)
  })

  it('keeps name_key unique', async () => {
    await seedPlayer(db, { email: 'one@example.com', nameKey: 'taken' })
    const failure = await failureOf(() => seedPlayer(db, { email: 'two@example.com', nameKey: 'taken' }))
    expect(failure.code).toBe('23505')
    expect(failure.text).toMatch(/players_name_key_unique/)
  })

  it('accepts a ledger row with no player — that is what a sink is', async () => {
    await db.insert(schema.pointTransactions).values({ playerId: null, amount: 250, reason: 'table_fee', refId: 'hand-1', kind: 'table_fee' })
    const [row] = await db.select().from(schema.pointTransactions).where(sql`${schema.pointTransactions.refId} = 'hand-1'`)
    expect(row!.playerId).toBeNull()
    expect(row!.amount).toBe(250)
    // bigint mapped to `mode: 'number'`: the ledger must read back as a number, not a string or a BigInt.
    expect(typeof row!.amount).toBe('number')
  })

  it('refuses a player-less ledger row that does not say which sink it is', async () => {
    const failure = await failureOf(() => db.insert(schema.pointTransactions).values({ playerId: null, amount: 10, reason: 'settlement', refId: 'hand-x' }))
    expect(failure.code).toBe('23514')
    expect(failure.text).toMatch(/point_transactions_sink_has_kind/)
  })

  it('seats bots in a recorded hand, where a player-keyed table could not', async () => {
    const human = await seedPlayer(db, { email: 'seat@example.com', nameKey: 'seat' })
    await db.insert(schema.games).values({
      id: 'hand-2',
      roomId: 'room-1',
      mode: 'holdem',
      config: { maxPlayers: 6, hasPassword: false },
      startedAt: new Date(1_700_000_000_000),
      endedAt: new Date(1_700_000_060_000),
      fee: 100,
    })
    await db.insert(schema.gamePlayers).values([
      { gameId: 'hand-2', seat: 0, playerId: human, label: human, isBot: false, net: 500, won: true, bestCategory: 4 },
      { gameId: 'hand-2', seat: 1, playerId: null, label: 'bot-easy-1', isBot: true, net: -500, won: false, bestCategory: null },
    ])
    const seats = await db.select().from(schema.gamePlayers).where(sql`${schema.gamePlayers.gameId} = 'hand-2'`)
    expect(seats).toHaveLength(2)
    expect(seats.find((s) => s.isBot)!.playerId).toBeNull()
    // Two bots at one table share a null player id: only `(game_id, seat)` can key this row.
    const failure = await failureOf(() => db.insert(schema.gamePlayers).values({ gameId: 'hand-2', seat: 1, playerId: null, label: 'bot-easy-2', isBot: true, net: 0, won: false }))
    expect(failure.code).toBe('23505')
    expect(failure.text).toMatch(/game_players_game_id_seat_pk/)
    // …while a second bot in a free seat is perfectly fine.
    await db.insert(schema.gamePlayers).values({ gameId: 'hand-2', seat: 2, playerId: null, label: 'bot-easy-2', isBot: true, net: 0, won: false })
  })

  it('defaults the profile columns a fresh registration does not set', async () => {
    const id = await seedPlayer(db, { email: 'fresh@example.com', nameKey: 'fresh' })
    const [row] = await db.select().from(schema.players).where(sql`${schema.players.id} = ${id}`)
    expect(row!.avatarConfig).toEqual({})
    expect(row!.equippedTitle).toBeNull()
    expect(row!.lastReliefAt).toBeNull()
    expect(row!.createdAt).toBeInstanceOf(Date)
  })

  it('gives users a generated uuid', async () => {
    const [row] = await db.insert(schema.users).values({ email: 'uuid@example.com', passwordHash: 'h' }).returning({ id: schema.users.id })
    expect(row!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('cascades a deleted account through the profile and its dependent rows', async () => {
    const id = await seedPlayer(db, { email: 'gone@example.com', nameKey: 'gone' })
    await db.insert(schema.playerStats).values({ playerId: id })
    await db.delete(schema.users).where(sql`${schema.users.id} = ${id}`)

    expect(await db.select().from(schema.players).where(sql`${schema.players.id} = ${id}`)).toHaveLength(0)
    expect(await db.select().from(schema.playerStats).where(sql`${schema.playerStats.playerId} = ${id}`)).toHaveLength(0)
  })

  it('refuses to delete an account that still has ledger history', async () => {
    const id = await seedPlayer(db, { email: 'ledger@example.com', nameKey: 'ledger' })
    await db.insert(schema.pointTransactions).values({ playerId: id, amount: 10, reason: 'daily_reward' })

    // Deleting the account cascades to the profile, which the ledger's RESTRICT refuses: a delete
    // would otherwise rewrite this player's whole history into player-less rows — i.e. into sinks —
    // and drop their balance out of the economy with nothing recording where it went.
    const failure = await failureOf(() => db.delete(schema.users).where(sql`${schema.users.id} = ${id}`))
    // Postgres reports a blocked RESTRICT as `23001 restrict_violation`, keeping `23503` for the
    // NO ACTION form; either way the row is refused by name.
    expect(['23001', '23503']).toContain(failure.code)
    expect(failure.text).toMatch(/point_transactions_player_id_players_id_fk/)

    const ledger = await db.select().from(schema.pointTransactions).where(sql`${schema.pointTransactions.playerId} = ${id}`)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]!.playerId).toBe(id)
    expect(await db.select().from(schema.players).where(sql`${schema.players.id} = ${id}`)).toHaveLength(1)
  })

  it('keeps email lowercase in the database, not merely by convention', async () => {
    const failure = await failureOf(() => db.insert(schema.users).values({ email: 'Mixed@Example.com', passwordHash: 'h' }))
    expect(failure.code).toBe('23514')
    expect(failure.text).toMatch(/users_email_lowercase/)
    await db.insert(schema.users).values({ email: 'mixed@example.com', passwordHash: 'h' })
  })

  it('rejects a profile with no account behind it', async () => {
    const failure = await failureOf(() => db.insert(schema.players).values({ id: randomUUID(), displayName: 'ghost', nameKey: 'ghost' }))
    expect(failure.code).toBe('23503')
    expect(failure.text).toMatch(/players_id_users_id_fk/)
  })
})
