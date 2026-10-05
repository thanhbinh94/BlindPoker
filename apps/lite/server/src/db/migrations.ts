/**
 * Schema migrations, newest last. Index `i` is version `i + 1`; `PRAGMA user_version` holds the
 * highest applied version. Migrations are append-only — never edit an entry that has shipped,
 * add a new one.
 *
 * A step is normally a SQL string. It may also be a function when the change needs a rule that
 * SQLite cannot express: `lower()` folds ASCII only, so a Vietnamese identity key has to be
 * computed in JavaScript from the same `@bp/core` rule the running server uses.
 */
import type { DatabaseSync } from 'node:sqlite'
import { displayNameKey, normalizeDisplayName } from '@bp/core'

export type MigrationStep = string | ((db: DatabaseSync) => void)

/**
 * Fills `name_key` for rows that predate it, using the shared display-name rule.
 *
 * `display_name` is left exactly as it was: re-normalizing it could collide with the v1
 * `UNIQUE COLLATE NOCASE` index and refuse to start a server whose data was fine. Only the key is
 * derived, and where two legacy rows fold to the same key — `Người` and `NGƯỜI` were distinct under
 * a NOCASE index that only knows ASCII — the older row keeps the plain key and the newer ones get a
 * `#<id>` suffix. That suffix contains a character no validated key can hold, so it can never be
 * hit by a future registration; both players keep the name they had, and only the *next* claim on
 * that key is refused.
 */
function backfillNameKeys(db: DatabaseSync): void {
  const rows = db.prepare('SELECT id, display_name FROM players ORDER BY created_at, id').all() as { id: string; display_name: string }[]
  const update = db.prepare('UPDATE players SET name_key = ? WHERE id = ?')
  const taken = new Set<string>()
  for (const row of rows) {
    const key = displayNameKey(normalizeDisplayName(row.display_name))
    const unique = taken.has(key) ? `${key}#${row.id}` : key
    taken.add(unique)
    update.run(unique, row.id)
  }
}

export const MIGRATIONS: readonly (readonly MigrationStep[])[] = [
  [
    `CREATE TABLE players (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      token_hash TEXT NOT NULL UNIQUE,
      balance INTEGER NOT NULL CHECK (balance >= 0),
      hands_played INTEGER NOT NULL DEFAULT 0,
      hands_won INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      last_daily_claim TEXT,
      last_relief_at INTEGER,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE sinks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE hand_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hand_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      fee INTEGER NOT NULL,
      cancelled INTEGER NOT NULL,
      summary TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX idx_sinks_ref ON sinks (ref_id)`,
    `CREATE INDEX idx_hand_log_hand ON hand_log (hand_id)`,
    `CREATE INDEX idx_hand_log_room_created ON hand_log (room_id, created_at)`,
  ],

  // v2 — identity by `name_key`, not by `display_name COLLATE NOCASE`. NOCASE folds ASCII only, so
  // `Người` and `NGƯỜI` were two players; the key is the shared `@bp/core` rule (NFC, Vietnamese
  // case folding), which makes them one. The v1 index stays: it is redundant, not wrong, and
  // dropping it would mean rebuilding the table.
  [
    `ALTER TABLE players ADD COLUMN name_key TEXT NOT NULL DEFAULT ''`,
    backfillNameKeys,
    `CREATE UNIQUE INDEX idx_players_name_key ON players (name_key)`,
  ],

  // v3 — the keys `balances.apply` claims (Plan 20), the same table Normal's `0003_ledger_keys.sql` adds: a write the
  // room may retry carries a key, and a key already here makes the retry a no-op. Purely additive. `IF NOT EXISTS`
  // because a database rewound to an older `user_version` (the migration tests do this) re-runs this step over a
  // table it already has.
  [
    `CREATE TABLE IF NOT EXISTS ledger_keys (
      key TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    )`,
  ],
]
