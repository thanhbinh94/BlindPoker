/**
 * Schema migrations, newest last. Index `i` is version `i + 1`; `PRAGMA user_version` holds the
 * highest applied version. Migrations are append-only — never edit an entry that has shipped,
 * add a new one.
 */
export const MIGRATIONS: readonly (readonly string[])[] = [
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
]
