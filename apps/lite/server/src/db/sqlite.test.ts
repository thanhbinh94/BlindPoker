import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from './migrations.js'
import { migrate, openDatabase } from './sqlite.js'

const dirs: string[] = []
function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bp-lite-db-'))
  dirs.push(dir)
  return join(dir, 'test.sqlite')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const userVersion = (db: ReturnType<typeof openDatabase>): number => Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
const tableNames = (db: ReturnType<typeof openDatabase>): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name)

describe('MIGRATIONS', () => {
  it('is a non-empty list of statement batches', () => {
    expect(MIGRATIONS.length).toBeGreaterThan(0)
    for (const batch of MIGRATIONS) expect(batch.length).toBeGreaterThan(0)
  })
})

describe('openDatabase / migrate', () => {
  it('creates the schema and stamps user_version to MIGRATIONS.length', () => {
    const db = openDatabase(':memory:')
    expect(userVersion(db)).toBe(MIGRATIONS.length)
    expect(tableNames(db)).toEqual(expect.arrayContaining(['hand_log', 'players', 'sinks']))
    db.close()
  })

  it('creates every column the repositories rely on', () => {
    const db = openDatabase(':memory:')
    const cols = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name)
    expect(cols('players')).toEqual(['id', 'display_name', 'token_hash', 'balance', 'hands_played', 'hands_won', 'streak', 'last_daily_claim', 'last_relief_at', 'created_at'])
    expect(cols('sinks')).toEqual(['id', 'kind', 'ref_id', 'amount', 'created_at'])
    expect(cols('hand_log')).toEqual(['id', 'hand_id', 'room_id', 'mode', 'fee', 'cancelled', 'summary', 'created_at'])
    db.close()
  })

  it('enforces the non-negative balance CHECK', () => {
    const db = openDatabase(':memory:')
    expect(() => db.prepare('INSERT INTO players (id, display_name, token_hash, balance, created_at) VALUES (?, ?, ?, ?, ?)').run('p1', 'Alice', 'h1', -1, 0)).toThrow(/CHECK/i)
    db.close()
  })

  it('migrate is idempotent — a second run applies nothing and returns the same version', () => {
    const db = openDatabase(':memory:')
    const first = userVersion(db)
    expect(migrate(db)).toBe(first)
    expect(migrate(db)).toBe(first)
    expect(userVersion(db)).toBe(first)
    // Re-running the DDL would have thrown "table players already exists"; it did not.
    expect(tableNames(db)).toEqual(expect.arrayContaining(['players']))
    db.close()
  })

  it('migrate returns MIGRATIONS.length and applies the schema on a bare database', () => {
    const db = openDatabase(':memory:')
    db.exec('DROP TABLE players; DROP TABLE sinks; DROP TABLE hand_log; PRAGMA user_version = 0')
    expect(migrate(db)).toBe(MIGRATIONS.length)
    expect(tableNames(db)).toEqual(expect.arrayContaining(['hand_log', 'players', 'sinks']))
    db.close()
  })

  it('sets WAL journal mode, foreign_keys and busy_timeout on a file database', () => {
    const path = tempDbPath()
    const db = openDatabase(path)
    expect(String((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toLowerCase()).toBe('wal')
    expect(Number((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys)).toBe(1)
    expect(Number((db.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout)).toBe(5000)
    db.close()
  })

  it('leaves an in-memory database on its default journal mode (WAL is meaningless there)', () => {
    const db = openDatabase(':memory:')
    expect(String((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toLowerCase()).not.toBe('wal')
    db.close()
  })

  it('re-opening an existing file database does not re-run migrations or lose data', () => {
    const path = tempDbPath()
    const a = openDatabase(path)
    a.prepare('INSERT INTO players (id, display_name, token_hash, balance, created_at) VALUES (?, ?, ?, ?, ?)').run('p1', 'Alice', 'h1', 5000, 1)
    a.close()

    const b = openDatabase(path)
    expect(userVersion(b)).toBe(MIGRATIONS.length)
    expect((b.prepare('SELECT balance FROM players WHERE id = ?').get('p1') as { balance: number }).balance).toBe(5000)
    b.close()
  })
})
