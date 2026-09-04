/**
 * The player profile.
 *
 * `server-kit` only ever asks for `PlayerRecord` — id, name, balance — because that is all the game
 * loop needs. Everything else a Normal profile carries (cosmetics, relief cooldown, join date) is
 * for this edition's HTTP surface, so it comes out of `findByIdFull` rather than widening the
 * interface the engine is written against.
 *
 * Uniqueness of a display name is decided on `name_key`, the folded form from `@bp/core` that the
 * client-side validator also uses — so "NGƯỜI" and "Người" collide here exactly as the UI said they
 * would. The collision is detected by letting the database refuse the write rather than by a
 * `SELECT` first: between the check and the update, another request can take the name.
 */
import { displayNameKey, normalizeDisplayName } from '@bp/core'
import type { PlayerRecord, PlayerRepository } from '@bp/server-kit'
import { eq } from 'drizzle-orm'
import type { AppDb } from '../db/client.js'
import { isUniqueViolation } from '../db/pg-errors.js'
import { players } from '../db/schema.js'
import { UnknownPlayerError } from './balance-repo.js'
import { isUuid } from './util.js'

/** The whole `players` row, as the profile and cosmetics endpoints want it. */
export interface PlayerRow {
  playerId: string
  displayName: string
  /** The folded, unique form of `displayName` — what "name taken" is decided on. */
  nameKey: string
  balance: number
  avatarConfig: Record<string, unknown>
  equippedTitle: string | null
  equippedBadge: string | null
  lastReliefAt: Date | null
  createdAt: Date
}

export interface NormalPlayerRepository extends PlayerRepository {
  findByIdFull(playerId: string): Promise<PlayerRow | null>
  /**
   * Renames a player, keeping `name_key` in step. Throws `DisplayNameTakenError` on a collision.
   *
   * Uniqueness is the only rule enforced here, because it is the only one that cannot be decided
   * before the write. Shape — the 2–20 code-point length, the allowed characters, the edge rule — is
   * `validateDisplayName`'s job at the HTTP boundary, and a caller that skips it will get the
   * database's raw `22001` from `varchar(20)` rather than a typed refusal.
   */
  updateProfile(playerId: string, patch: { displayName?: string }): Promise<void>
  /** Stamps the relief cooldown. The credit itself goes through `balances.creditWithin`. */
  setLastRelief(playerId: string, at: Date): Promise<void>
}

export class DisplayNameTakenError extends Error {
  constructor(public readonly displayName: string) {
    super(`display name already taken: ${displayName}`)
    this.name = 'DisplayNameTakenError'
  }
}

const NAME_KEY_CONSTRAINT = 'players_name_key_unique'

const COLUMNS = {
  playerId: players.id,
  displayName: players.displayName,
  nameKey: players.nameKey,
  balance: players.balance,
  avatarConfig: players.avatarConfig,
  equippedTitle: players.equippedTitle,
  equippedBadge: players.equippedBadge,
  lastReliefAt: players.lastReliefAt,
  createdAt: players.createdAt,
}

export function createPlayerRepository(db: AppDb): NormalPlayerRepository {
  async function fullRow(playerId: string): Promise<PlayerRow | null> {
    if (!isUuid(playerId)) return null
    const [row] = await db.select(COLUMNS).from(players).where(eq(players.id, playerId))
    return row ? { ...row, balance: Number(row.balance) } : null
  }

  return {
    async findById(playerId): Promise<PlayerRecord | null> {
      const row = await fullRow(playerId)
      return row ? { playerId: row.playerId, displayName: row.displayName, balance: row.balance } : null
    },

    findByIdFull: fullRow,

    async updateProfile(playerId, patch) {
      if (patch.displayName === undefined) return
      if (!isUuid(playerId)) throw new UnknownPlayerError(playerId)
      // Normalizing here rather than trusting the caller keeps the stored name and its key derived
      // from the same string: a name that arrived decomposed would otherwise fold to a key that no
      // later lookup of the composed form could reproduce.
      const displayName = normalizeDisplayName(patch.displayName)
      let updated: { id: string }[]
      try {
        updated = await db
          .update(players)
          .set({ displayName, nameKey: displayNameKey(displayName) })
          .where(eq(players.id, playerId))
          .returning({ id: players.id })
      } catch (err) {
        if (isUniqueViolation(err, NAME_KEY_CONSTRAINT)) throw new DisplayNameTakenError(displayName)
        throw err
      }
      if (updated.length === 0) throw new UnknownPlayerError(playerId)
    },

    async setLastRelief(playerId, at) {
      if (!isUuid(playerId)) throw new UnknownPlayerError(playerId)
      const updated = await db.update(players).set({ lastReliefAt: at }).where(eq(players.id, playerId)).returning({ id: players.id })
      if (updated.length === 0) throw new UnknownPlayerError(playerId)
    },
  }
}
