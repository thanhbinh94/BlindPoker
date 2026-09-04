import type { IncomingMessage } from 'node:http'
import type { GameMode, HandCategory, PlayerIdentity, RoomConfig } from '@bp/core'

export interface PlayerRecord {
  playerId: string
  displayName: string
  balance: number
}

export type TxReason = 'settlement' | 'buy_in' | 'cash_out' | 'refund' | 'daily_reward' | 'relief' | 'achievement'

export interface BalanceEntry {
  playerId: string
  delta: number
  reason: TxReason
  refId?: string
}

/**
 * Describes the sink that accompanies a batch of balance entries.
 *
 * - `table_fee` — the rake taken out of a settled hand (`refId` = handId).
 * - `carry_over` — an undistributable remainder of a released carry-over pot, or the whole
 *   pot when nobody was seated to receive it (`refId` = roomId).
 */
export interface SettlementMeta {
  refId: string
  fee: number
  kind: 'table_fee' | 'carry_over'
}

/** A `RoomConfig` safe to hand to clients, history and analytics: the password is replaced by a flag. */
export type PublicRoomConfig = Omit<RoomConfig, 'password'> & { hasPassword: boolean }

export class InsufficientBalanceError extends Error {
  constructor(public readonly playerId: string) {
    super(`insufficient balance for ${playerId}`)
    this.name = 'InsufficientBalanceError'
  }
}

export interface PlayerRepository {
  findById(playerId: string): Promise<PlayerRecord | null>
}

export interface BalanceRepository {
  get(playerId: string): Promise<number>
  /**
   * Atomic: all entries or none.
   *
   * Netting: entries are grouped by player and their deltas summed *before* the negativity
   * check, so a batch that first debits and then credits the same player is judged on the net
   * effect (`balance + net >= 0`), not on the intermediate values. Throws
   * `InsufficientBalanceError` when any player's net would take their balance below zero, and
   * writes nothing in that case.
   *
   * Sinks: when `meta` is present and `meta.fee > 0` the implementation must also record a sink
   * row of `meta.kind` in the same transaction — points that left player balances but went to no
   * player (Normal: a `point_transactions` row with a null `player_id`; the in-memory repositories
   * push the meta onto `sinks`). This is what keeps
   * `Σ balances + Σ sinks (+ live table stacks and carry-over pots)` constant.
   */
  apply(entries: BalanceEntry[], meta?: SettlementMeta): Promise<void>
}

export interface HandSummaryPlayer {
  playerId: string
  seat: number
  isBot: boolean
  net: number
  won: boolean
  bestCategory: HandCategory | null
}

export interface HandSummary {
  handId: string
  roomId: string
  mode: GameMode
  config: RoomConfig
  startedAt: number
  endedAt: number
  fee: number
  cancelled: boolean
  players: HandSummaryPlayer[]
}

export interface GameHistoryRepository {
  recordHand(summary: HandSummary): Promise<void>
}

/** Supplied by the edition: turns an HTTP upgrade (cookie) and/or a HELLO token into a player identity. */
export interface SessionResolver {
  fromUpgrade?(req: IncomingMessage): Promise<PlayerIdentity | null>
  fromToken?(token: string): Promise<PlayerIdentity | null>
}

export interface Repositories {
  players: PlayerRepository
  balances: BalanceRepository
  history: GameHistoryRepository
}
