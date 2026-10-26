import type { BotStrategy, ChaosSeat, ErrorCode, GameMode, PlayerIdentity, Rng, ServerMessage } from '@bp/core'
import type { ChaosPort } from '../chaos-port.js'
import type { DomainEvent } from '../domain-events.js'
import type { Clock } from '../infra/clock.js'
import type { Logger } from '../infra/logger.js'
import type { Repositories } from '../repositories.js'

export interface RoomPlayer {
  identity: PlayerIdentity
  seat: number | null
  /** Points on the table, already deducted from the balance (both modes, spec 2026-09-29). Bots: a virtual stack. */
  stack: number
  ready: boolean
  connected: boolean
  joinedAt: number
  /** Effective: skipped by the next hand. Either asked for (`sitOutRequested`) or forced by a stack too short to play. */
  sittingOut: boolean
  /** Asked for by `SIT_OUT`; survives the per-hand recompute of `sittingOut` until `SIT_IN` or a stand-up clears it. */
  sitOutRequested: boolean
  /** Hands that have started without this player since they asked to sit out; `handsSatOutToStand` of them frees the seat. */
  handsSatOut: number
  consecutiveTimeouts: number
  disconnectDeadline: number | null
  /** Stand up (and cash out) as soon as the current hand ends. */
  standAfterHand: boolean
  /** Remove from the room as soon as the current hand ends (implies standAfterHand). */
  leaveAfterHand: boolean
  /**
   * A new id per sitting, set by `sitDown` and cleared by the stand-up that cashes it out. It names the cash-out's
   * ledger key, `cash_out:<roomId>:<sitId>` — no amount in it — so one sitting is cashed out once, however often the
   * write is retried. `null` while not seated, and always for a bot.
   */
  sitId: string | null
  /**
   * The seat's cash-out was written and not acknowledged, so it may have landed. Until a retry under the same key
   * settles it the seat is frozen: sitting out, never dealt in, its stack untouched — a stack already paid out must
   * not be played again. Neither a rejoin nor Sit In clears it; `onHandComplete`, another Stand Up, Leave, kick or
   * reconnect expiry, and a shutdown all retry it.
   */
  cashOutPending: boolean
  /**
   * A buy-in written and not acknowledged, so it may have landed. The next Sit replays it — the same key
   * `buy_in:<roomId>:<sitId>`, the same amount — rather than debiting again; a removal or a shutdown replays it and
   * gives it back under `buy_in_refund:<roomId>:<sitId>` (`refunding` once that has begun, after which it can no
   * longer pay for a seat).
   */
  pendingBuyIn?: { sitId: string; amount: number; refunding?: boolean }
  cosmetics?: unknown
  /** A chaos table: the seat's cards, points and streak (spec §3.4). Lost when the player leaves the seat. */
  chaos?: ChaosSeat
}

/** A room as the GM screen lists it (Plan 25): what the lobby summary hides, and no cards. */
export interface AdminRoomSummary {
  roomId: string
  code: string
  name: string
  mode: GameMode
  status: 'OPEN' | 'IN_GAME'
  isPrivate: boolean
  hasPassword: boolean
  players: number
  maxPlayers: number
  hostPlayerId: string
  hostDisplayName: string
  carryOverPot: number
  handInProgress: boolean
  createdAt: number
  members: { playerId: string; displayName: string; isBot: boolean; seat: number | null; stack: number; connected: boolean }[]
}

export interface RoomOptions {
  handIntervalMs: number
  revealDelayMs: number
  botDelayMs: [number, number]
  reconnectWindowMs: number
  spectatorGraceMs: number
  emptyRoomCloseMs: number
  /**
   * How long a room may sit unable to start a hand before its carry-over pot is released to the seated humans (and to
   * the ones stood up for a spent table limit while it was carried, if still in the room).
   */
  carryOverReleaseMs: number
  consecutiveTimeoutsToStand: number
  /** Hands started without a player who asked to sit out before the seat is taken back (spec §11.3). */
  handsSatOutToStand: number
  /** Test hook: overrides `config.turnTimerSec * 1000` when set. */
  turnTimerMsOverride?: number
}

export const DEFAULT_ROOM_OPTIONS: RoomOptions = {
  handIntervalMs: 5_000,
  revealDelayMs: 1_500,
  botDelayMs: [1_000, 3_000],
  reconnectWindowMs: 90_000,
  spectatorGraceMs: 300_000,
  emptyRoomCloseMs: 60_000,
  carryOverReleaseMs: 60_000,
  consecutiveTimeoutsToStand: 3,
  handsSatOutToStand: 5,
}

export interface Outbox {
  send(playerId: string, msg: ServerMessage): void
}

export interface RoomDeps {
  clock: Clock
  rng: Rng
  repos: Repositories
  outbox: Outbox
  bot: BotStrategy
  log: Logger
  options: RoomOptions
  onDomainEvent?: (e: DomainEvent) => void
  /** Poker hỗn loạn: without it, a chaos table is refused (`CHAOS_UNAVAILABLE`). */
  chaos?: ChaosPort
}

export class RoomError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'RoomError'
  }
}
