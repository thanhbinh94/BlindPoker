import type { BotStrategy, ErrorCode, PlayerIdentity, Rng, ServerMessage } from '@bp/core'
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
  cosmetics?: unknown
}

export interface RoomOptions {
  handIntervalMs: number
  revealDelayMs: number
  botDelayMs: [number, number]
  reconnectWindowMs: number
  spectatorGraceMs: number
  emptyRoomCloseMs: number
  /** How long a room may sit unable to start a hand before its carry-over pot is released to the seated humans. */
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
