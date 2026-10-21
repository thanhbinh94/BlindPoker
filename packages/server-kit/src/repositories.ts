import type { IncomingMessage } from 'node:http'
import type { GameMode, HandCategory, PlayerIdentity, RoomConfig } from '@bp/core'

export interface PlayerRecord {
  playerId: string
  displayName: string
  balance: number
}

/**
 * Why points moved. `daily_login` is the check-in reward itself and `daily_item_fallback` the
 * 10,000-point substitute paid when the day's random cosmetic tier has nothing left to give
 * (spec §13.2) — a separate reason rather than a larger `daily_login`, so §12.5's flow-by-reason
 * report can tell "the reward table paid this" from "the catalogue ran dry".
 */
export type TxReason =
  | 'starting_balance'
  | 'settlement'
  | 'buy_in'
  | 'cash_out'
  | 'refund'
  | 'daily_reward'
  | 'daily_login'
  | 'daily_item_fallback'
  | 'relief'
  | 'achievement'
  /** Plan 25: points a GM gave (`gm_grant`, positive) or took back (`gm_adjust`, negative). Sources, not sinks: a player row each. */
  | 'gm_grant'
  | 'gm_adjust'
  /** Plan 26: points a GM paid for unlocking an achievement (positive), or took back when undoing a check-in (`gm_checkin_undo`, negative). Both sources, signed, a player row each. */
  | 'gm_achievement'
  | 'gm_checkin_undo'

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

/**
 * `key` makes a write idempotent: the first batch that commits under a key claims it, and every later
 * call with that key is a no-op. The room names each write it may have to retry — `cash_out:<room>:<sitting>`,
 * `buy_in:<room>:<sitting>`, `buy_in_refund:<room>:<sitting>`, `carry_over:<room>:<release>` — so a write
 * that committed but whose acknowledgement was lost (a dropped connection after `COMMIT`) is not applied
 * a second time when it is retried.
 */
export interface ApplyOptions {
  key?: string
}

export interface ApplyResult {
  /**
   * `false` only when `key` had already been claimed: nothing was checked and nothing was written,
   * because the batch that claimed it already did. A batch with nothing to write is `true`.
   */
  applied: boolean
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
   *
   * Keys (`opts.key`): the key is claimed first, inside the same transaction as the batch. A key that
   * is already claimed makes the call a no-op that resolves `{ applied: false }` — no balance check,
   * no write — so a retry of a write that committed but reported an error cannot apply it twice. A
   * batch that is rejected (insufficient balance, any error) rolls back with its claim, leaving the
   * key free for the next attempt. Without a key every call behaves as it always has. A batch with
   * nothing to write (no entries, no fee) claims nothing and resolves `{ applied: true }`.
   */
  apply(entries: BalanceEntry[], meta?: SettlementMeta, opts?: ApplyOptions): Promise<ApplyResult>
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
  /** Never carries the room password — see `PublicRoomConfig`. */
  config: PublicRoomConfig
  startedAt: number
  endedAt: number
  fee: number
  cancelled: boolean
  /** Set when `BalanceRepository.apply` rejected: the hand is recorded anyway so operators can reconcile. */
  settlementError?: string
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
