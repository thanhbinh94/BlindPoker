import type {
  Card, Decision, ErrorCode, GameMode, LegalActions, PlayerAction, RoomSummary, RoomView, ServerMessage, ShowdownHand,
} from '@bp/core'
import type { PreActionKind } from './preaction.js'

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

/** `HandPhase` plus `DEALING`, the purely visual window before the first betting/decision frame arrives. */
export type ClientPhase = 'DEALING' | 'BETTING' | 'DECISION' | 'REVEAL' | 'COMPLETE'

export interface ClientSeat {
  seat: number
  playerId: string
  displayName: string
  isBot: boolean
  stack: number
  betThisStreet: number
  folded: boolean
  allIn: boolean
  cardCount: number
  holeCards: Card[] | null
  hasDecided: boolean
  decision: Decision | null
  /** What this seat did last, for action bubbles; the engine's view never carries it. */
  lastAction: PlayerAction | null
  timedOut: boolean
}

export interface ClientHandResult {
  payouts: { seat: number; amount: number }[]
  /**
   * The layered pots the engine settled, main pot first, straight from `SETTLEMENT.pots`. `payouts` is the same
   * money summed per seat, which is all a single-pot hand needs; this is what lets a hand with a short all-in show
   * who was eligible for what. Empty for a cancelled hand — nothing was settled.
   */
  pots: { amount: number; eligibleSeats: number[]; winners: { seat: number; amount: number }[] }[]
  fee: number
  showdown: ShowdownHand[] | null
  carryOverOut: number
  uncalledReturned: { seat: number; amount: number } | null
  cancelled: boolean
  reason: string | null
}

export interface ClientHand {
  handId: string
  mode: GameMode
  phase: ClientPhase
  community: Card[]
  pot: number
  carryOverIn: number
  button: number
  actingSeat: number | null
  seats: ClientSeat[]
  mySeat: number | null
  legal: LegalActions | null
  result: ClientHandResult | null
  /** Bumped on every `POT_UPDATED` so views can fire a chips-to-pot animation without diffing amounts. */
  potPulse: number
}

export interface ClientError {
  code: ErrorCode
  message: string
  reqId: string | null
  at: number
}

export interface ClientNotification {
  id: number
  kind: string
  payload: unknown
  at: number
}

export interface ClientState {
  status: ConnectionStatus
  closeReason: string | null
  me: { playerId: string; displayName: string } | null
  balance: number
  /** `serverTime − Date.now()` at `WELCOME`; add it to a local clock to compare against server deadlines. */
  serverTimeOffset: number
  lobby: RoomSummary[]
  room: RoomView | null
  /**
   * `true` while `room` has not been confirmed by the server on *this* session. It starts `true`, goes `true`
   * again on every `WELCOME` (the socket may have been away long enough to be thrown out of the room), and only
   * clears when the answer to the follow-up `RESYNC` arrives — a `ROOM_SNAPSHOT`, or `ERROR{NOT_IN_ROOM}`. A
   * screen that acts on `room === null` must wait for this to be `false`, or a page refresh bounces the player
   * out of the room they are still sitting in.
   */
  roomStale: boolean
  /**
   * How many times this session's server has answered a (re)connect with "you are still in a room": bumped by
   * the `ROOM_SNAPSHOT` that clears `roomStale`. A counter rather than a flag so an app can react to each one
   * (`useRoomReturn`) — the player who closed the tab mid-game and came back through the lobby is taken to the
   * room the server is still holding them in, instead of being refused every other room with `ALREADY_IN_ROOM`
   * and no word about which (finding T5 of the 2026-09-28 run). Back to 0 with `reset`.
   */
  roomReturns: number
  hand: ClientHand | null
  seq: number
  deadlineAt: number | null
  lastError: ClientError | null
  notifications: ClientNotification[]
  resyncNeeded: boolean
  replaced: boolean
  /**
   * What the player ticked while waiting for their turn, pinned to the hand it was ticked in. The reducer clears
   * it the moment it stops applying — a new street, the player's own action, the end of the hand, leaving the
   * room — so a stale tick can never fire into a spot the player did not see.
   */
  preAction: { kind: PreActionKind; handId: string } | null
  /**
   * Blind Poker: answer every play-or-fold decision with "play" until the player stands, sits out or leaves.
   * A standing preference rather than a one-hand tick, because a Blind hand asks exactly one question.
   */
  autoPlay: boolean
}

export type ClientAction =
  | { type: 'status'; status: ConnectionStatus; reason?: string }
  | { type: 'server'; msg: ServerMessage; now: number }
  | { type: 'clearError' }
  | { type: 'dismissNotification'; id: number }
  | { type: 'resyncSent' }
  | { type: 'leftRoom' }
  | { type: 'preAction'; kind: PreActionKind | null }
  | { type: 'autoPlay'; on: boolean }
  /**
   * The account's display name changed (the app's own rename succeeded): `me` takes the new name at once. `me`
   * came from `WELCOME` and would otherwise keep the old name until the next one, and the lobby bar reads it.
   */
  | { type: 'renamed'; displayName: string }
  /**
   * Forget everything: back to `initialClientState`.
   *
   * The one thing that needs it is a session ending. The reducer is created once per app mount and outlives
   * any number of sessions, so without this a sign-out leaves `me`, `balance`, `room` and the notification
   * stack behind — and on a shared machine the next player is greeted by name with the previous player's
   * points until a `WELCOME` overwrites them.
   */
  | { type: 'reset' }

export const initialClientState: ClientState = {
  status: 'idle',
  closeReason: null,
  me: null,
  balance: 0,
  serverTimeOffset: 0,
  lobby: [],
  room: null,
  roomStale: true,
  roomReturns: 0,
  hand: null,
  seq: 0,
  deadlineAt: null,
  lastError: null,
  notifications: [],
  resyncNeeded: false,
  replaced: false,
  preAction: null,
  autoPlay: false,
}
