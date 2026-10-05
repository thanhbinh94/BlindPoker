import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { displayNameKey, normalizeDisplayName } from '@bp/core'
import { InsufficientBalanceError, type ApplyOptions, type ApplyResult, type BalanceEntry, type HandSummary, type PlayerRecord, type Repositories, type SettlementMeta } from '@bp/server-kit'

/** The full `players` row — everything Lite stores about a player, not just what `server-kit` needs. */
export interface LitePlayerRecord {
  playerId: string
  displayName: string
  /** The identity `display_name` folds to (`@bp/core`'s `displayNameKey`); uniqueness is decided on this. */
  nameKey: string
  balance: number
  handsPlayed: number
  handsWon: number
  streak: number
  lastDailyClaim: string | null
  lastReliefAt: number | null
  createdAt: number
}

export interface LiteSinkRow {
  id: number
  kind: string
  refId: string
  amount: number
  createdAt: number
}

export interface LiteRepositories extends Repositories {
  db: DatabaseSync
  /** Normalizes `displayName` to NFC and derives its `name_key`; throws `NameTakenError` if the key is in use. */
  createPlayer(displayName: string, tokenHash: string, startingBalance: number): LitePlayerRecord
  findByTokenHash(hash: string): LitePlayerRecord | null
  /** By identity key, so case and Unicode composition do not matter — `NGƯỜI` finds `Người`. */
  findByName(displayName: string): LitePlayerRecord | null
  getLitePlayer(playerId: string): LitePlayerRecord | null
  /**
   * Credits the daily reward and stamps the streak and claim day **in one transaction**. Two
   * separate writes could be interrupted between them, and either half alone is a bug that pays
   * out: a credit without the stamp is an unlimited reward, a stamp without the credit is a day
   * silently lost.
   */
  claimDaily(playerId: string, claim: { points: number; streak: number; day: string }): void
  /** Credits the relief top-up and stamps the cooldown in one transaction, for the same reason. */
  grantRelief(playerId: string, amount: number, at: number): void
  updateDaily(playerId: string, patch: { streak: number; lastDailyClaim: string }): void
  updateRelief(playerId: string, at: number): void
  sinks(): LiteSinkRow[]
  /**
   * Empties `ledger_keys` and returns how many keys went. The instance that owns the data directory runs it once,
   * before it listens: a key is only ever replayed by the room that claimed it, and rooms live in the memory of the
   * process that ran them, so no key claimed before this start can be retried.
   */
  pruneLedgerKeys(): number
  close(): void
}

export class NameTakenError extends Error {
  constructor(public readonly displayName: string) {
    super(`display name already taken: ${displayName}`)
    this.name = 'NameTakenError'
  }
}

interface PlayerRow {
  id: string
  display_name: string
  name_key: string
  balance: number
  hands_played: number
  hands_won: number
  streak: number
  last_daily_claim: string | null
  last_relief_at: number | null
  created_at: number
}

function toRecord(row: PlayerRow): LitePlayerRecord {
  return {
    playerId: row.id,
    displayName: row.display_name,
    nameKey: row.name_key,
    balance: Number(row.balance),
    handsPlayed: Number(row.hands_played),
    handsWon: Number(row.hands_won),
    streak: Number(row.streak),
    lastDailyClaim: row.last_daily_claim ?? null,
    lastReliefAt: row.last_relief_at === null || row.last_relief_at === undefined ? null : Number(row.last_relief_at),
    createdAt: Number(row.created_at),
  }
}

const PLAYER_COLUMNS = 'id, display_name, name_key, balance, hands_played, hands_won, streak, last_daily_claim, last_relief_at, created_at'

export function createSqliteRepositories(db: DatabaseSync, opts: { handLog: boolean; now?: () => number }): LiteRepositories {
  const now = opts.now ?? Date.now
  const handLog = opts.handLog

  // Prepared once and reused for the process's lifetime: SQLite reuses the compiled plan, and
  // `StatementSync` resets itself between runs, so a single instance per statement is safe here
  // (everything below runs synchronously — no two callers can be mid-statement at the same time).
  const insertPlayer = db.prepare('INSERT INTO players (id, display_name, name_key, token_hash, balance, created_at) VALUES (?, ?, ?, ?, ?, ?)')
  const selectById = db.prepare(`SELECT ${PLAYER_COLUMNS} FROM players WHERE id = ?`)
  const selectByTokenHash = db.prepare(`SELECT ${PLAYER_COLUMNS} FROM players WHERE token_hash = ?`)
  const selectByKey = db.prepare(`SELECT ${PLAYER_COLUMNS} FROM players WHERE name_key = ?`)
  const selectBalance = db.prepare('SELECT balance FROM players WHERE id = ?')
  const addBalance = db.prepare('UPDATE players SET balance = balance + ? WHERE id = ?')
  const insertSink = db.prepare('INSERT INTO sinks (kind, ref_id, amount, created_at) VALUES (?, ?, ?, ?)')
  const claimKey = db.prepare('INSERT OR IGNORE INTO ledger_keys (key, created_at) VALUES (?, ?)')
  const deleteKeys = db.prepare('DELETE FROM ledger_keys')
  const selectSinks = db.prepare('SELECT id, kind, ref_id, amount, created_at FROM sinks ORDER BY id')
  const bumpHands = db.prepare('UPDATE players SET hands_played = hands_played + 1, hands_won = hands_won + ? WHERE id = ?')
  const insertHandLog = db.prepare('INSERT INTO hand_log (hand_id, room_id, mode, fee, cancelled, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  const updateDailyStmt = db.prepare('UPDATE players SET streak = ?, last_daily_claim = ? WHERE id = ?')
  const updateReliefStmt = db.prepare('UPDATE players SET last_relief_at = ? WHERE id = ?')

  const getRow = (playerId: string): PlayerRow | null => (selectById.get(playerId) as PlayerRow | undefined) ?? null

  /**
   * Runs `fn` inside a single `BEGIN IMMEDIATE … COMMIT`. `IMMEDIATE` takes the write lock up
   * front, so a concurrent writer fails at `BEGIN` (where nothing has been read yet) instead of
   * at `COMMIT` with a stale read behind it. `fn` must be synchronous: an `await` inside would let
   * another caller interleave statements into this transaction.
   */
  function transact<T>(fn: () => T): T {
    db.exec('BEGIN IMMEDIATE')
    let result: T
    try {
      result = fn()
      db.exec('COMMIT')
    } catch (err) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // Either the statement failure already aborted the transaction, or COMMIT itself failed
        // and SQLite rolled back. Swallow so the original error is the one that propagates.
      }
      throw err
    }
    return result
  }

  /**
   * The balance half of a write that has a second half. Must be called inside `transact`, so the
   * caller's other statement commits or rolls back with it.
   *
   * `reason` and `refId` travel with the entry the way `balances.apply` takes them; Lite has no
   * ledger table to put them in yet, so today they name the movement for the reader.
   */
  function creditWithin(entry: BalanceEntry): void {
    const row = selectBalance.get(entry.playerId) as { balance: number } | undefined
    if (!row) throw new Error(`unknown player ${entry.playerId}`)
    if (Number(row.balance) + entry.delta < 0) throw new InsufficientBalanceError(entry.playerId)
    if (entry.delta !== 0) addBalance.run(entry.delta, entry.playerId)
  }

  const balances = {
    async get(playerId: string): Promise<number> {
      const row = selectBalance.get(playerId) as { balance: number } | undefined
      if (!row) throw new Error(`unknown player ${playerId}`)
      return Number(row.balance)
    },

    /**
     * Contract (`docs/server-kit.md` → Repositories): all entries commit or none do; deltas are
     * netted per player *before* the negativity check; a `meta.fee > 0` sink row lands in the same
     * transaction — including for an empty batch, which is how Hold'em's table fee arrives.
     *
     * `opts.key` is claimed first, inside the same transaction: a key already in `ledger_keys` makes
     * the call a no-op (`{ applied: false }`, nothing checked or written), and a rejected batch rolls
     * its claim back with everything else.
     */
    async apply(entries: BalanceEntry[], meta?: SettlementMeta, opts?: ApplyOptions): Promise<ApplyResult> {
      const nets = new Map<string, number>()
      for (const e of entries) nets.set(e.playerId, (nets.get(e.playerId) ?? 0) + e.delta)
      const writesSink = meta !== undefined && meta.fee > 0
      if (nets.size === 0 && !writesSink) return { applied: true }
      const key = opts?.key

      return transact(() => {
        if (key !== undefined && Number(claimKey.run(key, now()).changes) === 0) return { applied: false }
        for (const [playerId, net] of nets) {
          const row = selectBalance.get(playerId) as { balance: number } | undefined
          if (!row) throw new Error(`unknown player ${playerId}`)
          if (Number(row.balance) + net < 0) throw new InsufficientBalanceError(playerId)
        }
        for (const [playerId, net] of nets) {
          if (net !== 0) addBalance.run(net, playerId)
        }
        if (meta && writesSink) insertSink.run(meta.kind, meta.refId, meta.fee, now())
        return { applied: true }
      })
    },
  }

  return {
    db,

    players: {
      async findById(playerId: string): Promise<PlayerRecord | null> {
        const row = getRow(playerId)
        return row ? { playerId: row.id, displayName: row.display_name, balance: Number(row.balance) } : null
      },
    },

    balances,

    history: {
      /**
       * Counters move for every human in the hand regardless of `handLog` — they are player-facing
       * stats, not diagnostics. The `hand_log` row is the diagnostic, and it is opt-in.
       *
       * A cancelled hand never bumps counters (spec §18.2 "không ghi ván bị hủy" — cancelled hands
       * are not recorded as played). The `hand_log` row is still written when enabled: it is a raw
       * diagnostic trace, not the player-facing stat.
       */
      async recordHand(summary: HandSummary): Promise<void> {
        transact(() => {
          if (!summary.cancelled) {
            for (const p of summary.players) {
              if (p.isBot) continue
              bumpHands.run(p.won ? 1 : 0, p.playerId)
            }
          }
          if (handLog) {
            insertHandLog.run(summary.handId, summary.roomId, summary.mode, summary.fee, summary.cancelled ? 1 : 0, JSON.stringify(summary), now())
          }
        })
      },
    },

    createPlayer(displayName, tokenHash, startingBalance) {
      const id = randomUUID()
      const createdAt = now()
      // The stored name is the normalized one, and the key beside it is what uniqueness is decided
      // on. Both come from `@bp/core`, so the database agrees with the validator that let this in.
      const name = normalizeDisplayName(displayName)
      try {
        insertPlayer.run(id, name, displayNameKey(name), tokenHash, startingBalance, createdAt)
      } catch (err) {
        if (err instanceof Error && /UNIQUE constraint failed: players\.(display_name|name_key)/.test(err.message)) throw new NameTakenError(name)
        throw err
      }
      const row = getRow(id)
      if (!row) throw new Error(`player ${id} vanished immediately after insert`)
      return toRecord(row)
    },

    findByTokenHash(hash) {
      const row = (selectByTokenHash.get(hash) as PlayerRow | undefined) ?? null
      return row ? toRecord(row) : null
    },

    findByName(displayName) {
      const row = (selectByKey.get(displayNameKey(normalizeDisplayName(displayName))) as PlayerRow | undefined) ?? null
      return row ? toRecord(row) : null
    },

    getLitePlayer(playerId) {
      const row = getRow(playerId)
      return row ? toRecord(row) : null
    },

    claimDaily(playerId, claim) {
      transact(() => {
        creditWithin({ playerId, delta: claim.points, reason: 'daily_reward', refId: claim.day })
        updateDailyStmt.run(claim.streak, claim.day, playerId)
      })
    },

    grantRelief(playerId, amount, at) {
      transact(() => {
        creditWithin({ playerId, delta: amount, reason: 'relief', refId: String(at) })
        updateReliefStmt.run(at, playerId)
      })
    },

    updateDaily(playerId, patch) {
      updateDailyStmt.run(patch.streak, patch.lastDailyClaim, playerId)
    },

    updateRelief(playerId, at) {
      updateReliefStmt.run(at, playerId)
    },

    sinks() {
      const rows = selectSinks.all() as { id: number; kind: string; ref_id: string; amount: number; created_at: number }[]
      return rows.map((r) => ({ id: Number(r.id), kind: r.kind, refId: r.ref_id, amount: Number(r.amount), createdAt: Number(r.created_at) }))
    },

    pruneLedgerKeys() {
      return Number(deleteKeys.run().changes)
    },

    close() {
      db.close()
    },
  }
}
