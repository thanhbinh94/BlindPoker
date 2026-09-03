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

export interface SettlementMeta {
  refId: string
  fee: number
}

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
  /** Atomic: all entries or none. Throws InsufficientBalanceError when any resulting balance would be negative. */
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
