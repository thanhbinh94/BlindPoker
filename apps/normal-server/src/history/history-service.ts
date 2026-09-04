/**
 * Hand history as a player reads it (spec §19.2): my result, and who else was at the table.
 *
 * The repository answers "which hands did this player sit in, and how did they do"; this service
 * adds the other seats. It does that in *two* queries rather than one join — the page of hands
 * first, then every seat of those hands — because a join that widened each hand into one row per
 * seat would make `LIMIT 20` mean twenty rows rather than twenty hands, and paging would have to
 * guess how many rows a page of hands costs.
 *
 * Cancelled hands are returned, flagged. A hand that was abandoned is part of what happened, and
 * hiding it would leave a gap the player cannot account for; the flag is what lets the client show
 * it as an abandoned hand rather than as a loss.
 */
import type { GameMode, HandCategory } from '@bp/core'
import { asc, inArray } from 'drizzle-orm'
import type { AppDb } from '../db/client.js'
import { gamePlayers } from '../db/schema.js'
import { clampLimit, type NormalRepositories } from '../repos/index.js'

/** One seat of a recorded hand, from the outside. */
export interface HistorySeat {
  /** The engine-side id the seat was recorded under: a player id for humans, a bot id for bots. */
  label: string
  seat: number
  isBot: boolean
  net: number
  won: boolean
}

export interface HistoryEntry {
  handId: string
  roomId: string
  mode: GameMode
  startedAt: number
  endedAt: number
  /** The reading player's own net for the hand. */
  net: number
  won: boolean
  bestCategory: HandCategory | null
  cancelled: boolean
  /** Every seat, the reading player's own included, in seat order. */
  players: HistorySeat[]
}

export interface HistoryService {
  /** Newest first. `limit` defaults to 20 and is clamped to 1…50. */
  listForPlayer(playerId: string, limit?: number): Promise<HistoryEntry[]>
}

export interface HistoryServiceDeps {
  db: AppDb
  repos: NormalRepositories
}

const DEFAULT_LIMIT = 20
/** §19.2 asks for the last 20; 50 is the most a single page will serve. */
const MAX_LIMIT = 50

export function createHistoryService(deps: HistoryServiceDeps): HistoryService {
  return {
    async listForPlayer(playerId, limit) {
      const hands = await deps.repos.history.listForPlayer(playerId, clampLimit(limit, DEFAULT_LIMIT, MAX_LIMIT))
      if (hands.length === 0) return []

      const seats = await deps.db
        .select({
          gameId: gamePlayers.gameId,
          seat: gamePlayers.seat,
          label: gamePlayers.label,
          isBot: gamePlayers.isBot,
          net: gamePlayers.net,
          won: gamePlayers.won,
        })
        .from(gamePlayers)
        .where(
          inArray(
            gamePlayers.gameId,
            hands.map((h) => h.handId),
          ),
        )
        .orderBy(asc(gamePlayers.gameId), asc(gamePlayers.seat))

      const byHand = new Map<string, HistorySeat[]>()
      for (const s of seats) {
        const bucket = byHand.get(s.gameId)
        const entry: HistorySeat = { label: s.label, seat: s.seat, isBot: s.isBot, net: Number(s.net), won: s.won }
        if (bucket === undefined) byHand.set(s.gameId, [entry])
        else bucket.push(entry)
      }

      return hands.map((h) => ({
        handId: h.handId,
        roomId: h.roomId,
        mode: h.mode,
        startedAt: h.startedAt.getTime(),
        endedAt: h.endedAt.getTime(),
        net: h.net,
        won: h.won,
        bestCategory: h.bestCategory,
        cancelled: h.cancelled,
        players: byHand.get(h.handId) ?? [],
      }))
    },
  }
}
