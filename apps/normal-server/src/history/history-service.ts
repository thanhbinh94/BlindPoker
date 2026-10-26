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
import { asc, eq, inArray } from 'drizzle-orm'
import type { AppDb } from '../db/client.js'
import { gamePlayers, players } from '../db/schema.js'
import { clampLimit, type NormalRepositories } from '../repos/index.js'

/** One seat of a recorded hand, from the outside. */
export interface HistorySeat {
  /**
   * The account that sat here, or `null` for a bot (and for a human whose account has since been deleted —
   * `game_players.player_id` is `ON DELETE SET NULL`). This is the join key: a reader filtering their own
   * seat out of the list must compare *this*, never `label`, which two accounts may legitimately share.
   */
  playerId: string | null
  /**
   * What to print: the account's current display name for a human, "Bot n" for a bot (the name the room
   * gave it — see {@link botLabel}), and the recorded label when neither is available.
   */
  label: string
  seat: number
  isBot: boolean
  net: number
  won: boolean
}

export interface HistoryEntry {
  handId: string
  roomId: string
  /**
   * What the table was called when the hand was dealt, from the config stored with the hand. `null` for a
   * hand stored without one, which the client shows as no table line rather than as a made-up name.
   */
  roomName: string | null
  mode: GameMode
  startedAt: number
  endedAt: number
  /** The reading player's own net for the hand. */
  net: number
  won: boolean
  bestCategory: HandCategory | null
  cancelled: boolean
  /** Plan 37: the cards a chaos hand used ("Thẻ đã dùng"); absent for any other hand. */
  chaosUsed?: { seat: number; cardId: string; outcome: string }[]
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

/** `bot:<roomId>:<i>` — the id the room gives a bot (`Room`'s constructor); `i` counts from zero. */
const BOT_ENGINE_ID = /^bot:.+:(\d+)$/

/**
 * The name a bot answers to in the room (`Bot ${i + 1}`), recovered from the id it was recorded under.
 *
 * A bot has no account, so the seat's recorded label is its engine id — `bot:<roomId>:<i>` — and that is
 * what the listing used to print. A label that is not in that shape is returned as it is: an id from some
 * other era is still a truer answer than a guess. Callers apply this to bot seats only; a human may call
 * themselves anything, including something that looks like an engine id.
 */
export function botLabel(label: string): string {
  const match = BOT_ENGINE_ID.exec(label)
  return match === null ? label : `Bot ${Number(match[1]) + 1}`
}

/** The room's name out of the config stored with a hand, or `null` when the row has none to give. */
function roomNameOf(config: Record<string, unknown>): string | null {
  const name = config.name
  return typeof name === 'string' && name !== '' ? name : null
}

export function createHistoryService(deps: HistoryServiceDeps): HistoryService {
  return {
    async listForPlayer(playerId, limit) {
      const hands = await deps.repos.history.listForPlayer(playerId, clampLimit(limit, DEFAULT_LIMIT, MAX_LIMIT))
      if (hands.length === 0) return []

      // The join is a left join and the fallback below is not decoration: `player_id` is null for every bot,
      // and null again for a human whose account was deleted after the hand. Both keep the recorded `label` —
      // an id — because a seat that printed nothing would read as a hand played against a ghost. A bot's id is
      // then read back as the name the room gave it; a deleted human's is left alone.
      const seats = await deps.db
        .select({
          gameId: gamePlayers.gameId,
          seat: gamePlayers.seat,
          playerId: gamePlayers.playerId,
          label: gamePlayers.label,
          displayName: players.displayName,
          isBot: gamePlayers.isBot,
          net: gamePlayers.net,
          won: gamePlayers.won,
        })
        .from(gamePlayers)
        .leftJoin(players, eq(players.id, gamePlayers.playerId))
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
        const entry: HistorySeat = {
          playerId: s.playerId,
          label: s.displayName ?? (s.isBot ? botLabel(s.label) : s.label),
          seat: s.seat,
          isBot: s.isBot,
          net: Number(s.net),
          won: s.won,
        }
        if (bucket === undefined) byHand.set(s.gameId, [entry])
        else bucket.push(entry)
      }

      return hands.map((h) => ({
        handId: h.handId,
        roomId: h.roomId,
        roomName: roomNameOf(h.config),
        mode: h.mode,
        startedAt: h.startedAt.getTime(),
        endedAt: h.endedAt.getTime(),
        net: h.net,
        won: h.won,
        bestCategory: h.bestCategory,
        cancelled: h.cancelled,
        ...(h.chaosUsed === null ? {} : { chaosUsed: h.chaosUsed }),
        players: byHand.get(h.handId) ?? [],
      }))
    },
  }
}
