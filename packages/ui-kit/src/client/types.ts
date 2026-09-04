import type {
  Card, Decision, ErrorCode, GameMode, LegalActions, PlayerAction, RoomSummary, RoomView, ServerMessage, ShowdownHand,
} from '@bp/core'

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
  hand: ClientHand | null
  seq: number
  deadlineAt: number | null
  lastError: ClientError | null
  notifications: ClientNotification[]
  resyncNeeded: boolean
  replaced: boolean
}

export type ClientAction =
  | { type: 'status'; status: ConnectionStatus; reason?: string }
  | { type: 'server'; msg: ServerMessage; now: number }
  | { type: 'clearError' }
  | { type: 'dismissNotification'; id: number }
  | { type: 'resyncSent' }
  | { type: 'leftRoom' }

export const initialClientState: ClientState = {
  status: 'idle',
  closeReason: null,
  me: null,
  balance: 0,
  serverTimeOffset: 0,
  lobby: [],
  room: null,
  hand: null,
  seq: 0,
  deadlineAt: null,
  lastError: null,
  notifications: [],
  resyncNeeded: false,
  replaced: false,
}
