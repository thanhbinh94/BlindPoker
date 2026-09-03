import type { BotStrategy, ErrorCode, PlayerIdentity, Rng, ServerMessage } from '@bp/core'
import type { DomainEvent } from '../domain-events.js'
import type { Clock } from '../infra/clock.js'
import type { Logger } from '../infra/logger.js'
import type { Repositories } from '../repositories.js'

export interface RoomPlayer {
  identity: PlayerIdentity
  seat: number | null
  /** Hold'em: chips on the table (already deducted from the balance). Blind: last known balance (bots: virtual balance). */
  stack: number
  ready: boolean
  connected: boolean
  joinedAt: number
  sittingOut: boolean
  consecutiveTimeouts: number
  disconnectDeadline: number | null
  /** Stand up (Hold'em: cash out) as soon as the current hand ends. */
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
  consecutiveTimeoutsToStand: number
  botStartingBalance: number
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
  consecutiveTimeoutsToStand: 3,
  botStartingBalance: 1_000_000,
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
