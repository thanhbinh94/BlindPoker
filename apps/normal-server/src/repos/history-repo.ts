/**
 * Hand history: what happened, for the player's own record and for an operator's reconstruction.
 *
 * This writer only stores. It deliberately does *not* touch `player_stats`: the stats module owns
 * those counters and moves them from the domain event, so a hand that were somehow recorded twice
 * cannot inflate a lifetime total, and the two concerns can be tested apart.
 *
 * Cancelled hands are stored too, with `cancelled = true` — a hand that was abandoned mid-way is
 * exactly the thing an operator later needs to see, and `settlementError` is kept beside it for the
 * case where the hand played out but the points could not move. Consumers that count "hands played"
 * filter on `cancelled` themselves.
 *
 * Bots occupy seats but have no `players` row, so they are written with a null `player_id`,
 * `is_bot = true`, and their engine-side id in `label`. Humans get both: the id in `player_id` for
 * the foreign key, and the same id in `label` so the seat still says who sat there if the account is
 * ever deleted (`game_players.player_id` is `ON DELETE set null`).
 */
import type { GameMode, HandCategory } from '@bp/core'
import type { GameHistoryRepository, HandSummary } from '@bp/server-kit'
import { desc, eq } from 'drizzle-orm'
import type { AppDb } from '../db/client.js'
import { gamePlayers, games } from '../db/schema.js'
import { clampLimit, isUuid } from './util.js'

/** One recorded hand as it looked from a given player's seat. */
export interface GameRow {
  handId: string
  roomId: string
  mode: GameMode
  config: Record<string, unknown>
  startedAt: Date
  endedAt: Date
  fee: number
  cancelled: boolean
  settlementError: string | null
  seat: number
  net: number
  won: boolean
  /** The `HandCategory` rank shown down, or null when this seat never reached a showdown. */
  bestCategory: HandCategory | null
  /** Plan 37: the cards a chaos hand used (`HandSummary.chaosUsed`), or null for any other hand. */
  chaosUsed: { seat: number; cardId: string; outcome: string }[] | null
}

export interface NormalGameHistoryRepository extends GameHistoryRepository {
  /** Newest first. `limit` is clamped to 1…200; anything non-finite falls back to 20. */
  listForPlayer(playerId: string, limit: number): Promise<GameRow[]>
}

const DEFAULT_HISTORY_LIMIT = 20
const MAX_HISTORY_LIMIT = 200

export function createHistoryRepository(db: AppDb): NormalGameHistoryRepository {
  return {
    async recordHand(summary: HandSummary): Promise<void> {
      // One transaction: a `games` row with no seats is a hand nobody played, which is worse than
      // no row at all — the reader cannot tell it from data loss.
      await db.transaction(async (tx) => {
        await tx.insert(games).values({
          id: summary.handId,
          roomId: summary.roomId,
          mode: summary.mode,
          config: summary.config,
          startedAt: new Date(summary.startedAt),
          endedAt: new Date(summary.endedAt),
          fee: summary.fee,
          cancelled: summary.cancelled,
          settlementError: summary.settlementError ?? null,
          chaosUsed: summary.chaosUsed ?? null,
        })
        if (summary.players.length > 0) {
          await tx.insert(gamePlayers).values(
            summary.players.map((p) => ({
              gameId: summary.handId,
              seat: p.seat,
              playerId: p.isBot ? null : p.playerId,
              label: p.playerId,
              isBot: p.isBot,
              net: p.net,
              won: p.won,
              bestCategory: p.bestCategory,
            })),
          )
        }
      })
    },

    async listForPlayer(playerId, limit) {
      if (!isUuid(playerId)) return []
      const rows = await db
        .select({
          handId: games.id,
          roomId: games.roomId,
          mode: games.mode,
          config: games.config,
          startedAt: games.startedAt,
          endedAt: games.endedAt,
          fee: games.fee,
          cancelled: games.cancelled,
          settlementError: games.settlementError,
          chaosUsed: games.chaosUsed,
          seat: gamePlayers.seat,
          net: gamePlayers.net,
          won: gamePlayers.won,
          bestCategory: gamePlayers.bestCategory,
        })
        .from(gamePlayers)
        .innerJoin(games, eq(games.id, gamePlayers.gameId))
        .where(eq(gamePlayers.playerId, playerId))
        .orderBy(desc(games.startedAt), desc(games.id))
        .limit(clampLimit(limit, DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT))
      // `mode` and `best_category` are plain text/integer columns, but `recordHand` is their only
      // writer, so what comes back is what a `GameMode` and a `HandCategory` were on the way in.
      return rows.map((r) => ({
        ...r,
        mode: r.mode as GameMode,
        fee: Number(r.fee),
        net: Number(r.net),
        bestCategory: r.bestCategory as HandCategory | null,
      }))
    },
  }
}
