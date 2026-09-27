import type { GameEvent, PlayerAction } from '../hand/types.js'
import type { HandView } from '../hand/view.js'

export type ErrorCode =
  | 'UNAUTHENTICATED' | 'INVALID_MESSAGE' | 'RATE_LIMITED' | 'ROOM_NOT_FOUND' | 'ROOM_FULL' | 'WRONG_PASSWORD'
  | 'INVALID_ROOM_CONFIG' | 'NOT_HOST' | 'SEAT_TAKEN' | 'INSUFFICIENT_BALANCE' | 'NOT_YOUR_TURN' | 'ILLEGAL_ACTION'
  | 'INVALID_AMOUNT' | 'STALE_STATE' | 'DUPLICATE_REQUEST' | 'NOT_IN_HAND' | 'NOT_IN_ROOM' | 'ALREADY_IN_ROOM'
  | 'NOT_SEATED' | 'GAME_IN_PROGRESS' | 'NOT_ENOUGH_PLAYERS' | 'DISPLAY_NAME_TAKEN' | 'SERVER_SHUTDOWN' | 'INTERNAL'

export interface PlayerIdentity {
  playerId: string
  displayName: string
  isBot: boolean
}

export interface HoldemRoomConfig {
  smallBlind: number
  bigBlind: number
  minBuyInBB: number
  maxBuyInBB: number
}

export interface BlindRoomConfig {
  holeCards: 2 | 3
  decisionMode: 'none' | 'playOrFold'
  fixedWager: number
  botCount: number
}

export interface RoomConfig {
  name: string
  mode: 'holdem' | 'blind'
  maxPlayers: number
  isPrivate: boolean
  password?: string
  turnTimerSec: number
  autoStart: boolean
  holdem?: HoldemRoomConfig
  blind?: BlindRoomConfig
}

export type SeatStatus = 'SEATED' | 'READY' | 'IN_HAND' | 'SITTING_OUT' | 'DISCONNECTED'

export interface RoomPlayerView {
  playerId: string
  displayName: string
  isBot: boolean
  isHost: boolean
  connected: boolean
  seat: number | null
  status: SeatStatus | null
  /**
   * The seat is sitting out — the player asked (`SIT_OUT`), or their stack is below the minimum to play.
   * Carried beside `status` rather than inside it because the two are not exclusive: a player who sits out
   * mid-hand still finishes that hand, so `status` reports `IN_HAND` while this is already `true`. A client's
   * sit-out toggle reads this, so it survives a snapshot, a `RESYNC` or a reconnect taken mid-hand.
   */
  sittingOut: boolean
  stack: number
  ready: boolean
  /** Opaque, app-specific cosmetics (e.g. avatar config); core never interprets it. */
  cosmetics?: unknown
}

export interface RoomSummary {
  roomId: string
  code: string
  name: string
  mode: 'holdem' | 'blind'
  config: Omit<RoomConfig, 'password'> & { hasPassword: boolean }
  playerCount: number
  maxPlayers: number
  status: 'OPEN' | 'IN_GAME'
  /**
   * True while nobody is in the room and it is counting down to closing (`emptyRoomCloseMs`, 60 s): the room
   * is kept that long so a player who left by mistake or dropped can come back to it, and the lobby says
   * "closing" meanwhile instead of "waiting" (bug 2). Joining cancels the countdown. Optional so a client
   * built against an older server reads its absence as "not closing".
   */
  closing?: boolean
}

export interface RoomView extends RoomSummary {
  hostPlayerId: string
  players: RoomPlayerView[]
  carryOverPot: number
  nextHandAt: number | null
}

export type RoomEvent =
  | { type: 'PLAYER_JOINED'; player: RoomPlayerView }
  | { type: 'PLAYER_LEFT'; playerId: string }
  | { type: 'PLAYER_SAT'; playerId: string; seat: number; stack: number }
  | { type: 'PLAYER_STOOD'; playerId: string; seat: number }
  | { type: 'PLAYER_READY'; playerId: string; ready: boolean }
  /** The seat's effective sit-out flag changed — asked for by `SIT_OUT`/`SIT_IN`, or forced by a stack too short to play. */
  | { type: 'PLAYER_SIT_OUT'; playerId: string; sittingOut: boolean }
  | { type: 'HOST_CHANGED'; hostPlayerId: string }
  | { type: 'PLAYER_DISCONNECTED'; playerId: string; deadline: number }
  | { type: 'PLAYER_RECONNECTED'; playerId: string }
  | { type: 'ROOM_STATUS'; status: 'OPEN' | 'IN_GAME'; nextHandAt: number | null }
  | { type: 'ROOM_CLOSED'; reason: string }

/** Every client message may carry a `reqId`; the server echoes it on `ACK` / `ERROR`. `ACTION` requires one. */
export type ClientMessage =
  | { t: 'HELLO'; reqId?: string; sessionToken: string }
  | { t: 'LIST_ROOMS'; reqId?: string }
  | { t: 'CREATE_ROOM'; reqId?: string; config: RoomConfig }
  | { t: 'JOIN_ROOM'; reqId?: string; roomId?: string; code?: string; password?: string }
  | { t: 'LEAVE_ROOM'; reqId?: string }
  | { t: 'SIT_DOWN'; reqId?: string; seat: number; buyIn?: number }
  | { t: 'STAND_UP'; reqId?: string }
  /** Keep the seat, but be skipped from the next hand onwards (the current hand is played out). */
  | { t: 'SIT_OUT'; reqId?: string }
  /** Take the seat back from the next hand onwards; a stack below the minimum keeps it `SITTING_OUT`. */
  | { t: 'SIT_IN'; reqId?: string }
  | { t: 'READY'; reqId?: string; ready: boolean }
  | { t: 'START_GAME'; reqId?: string }
  | { t: 'KICK'; reqId?: string; playerId: string }
  | { t: 'ACTION'; reqId: string; baseSeq: number; action: PlayerAction }
  | { t: 'RESYNC'; reqId?: string }
  | { t: 'PONG'; reqId?: string }

export type ServerMessage =
  | { t: 'WELCOME'; playerId: string; displayName: string; balance: number; serverTime: number }
  | { t: 'ROOM_LIST'; rooms: RoomSummary[] }
  | { t: 'ROOM_SNAPSHOT'; seq: number; room: RoomView; hand: HandView | null; deadlineAt: number | null }
  | { t: 'GAME_EVENT'; seq: number; event: GameEvent & { deadlineAt?: number } }
  | { t: 'ROOM_EVENT'; seq: number; event: RoomEvent }
  | { t: 'BALANCE'; balance: number }
  | { t: 'NOTIFICATION'; kind: string; payload: unknown }
  | { t: 'ACK'; reqId: string }
  | { t: 'ERROR'; reqId?: string; code: ErrorCode; message: string }
  | { t: 'SESSION_REPLACED' }
  | { t: 'PING' }

export type ClientMessageType = ClientMessage['t']
export type ServerMessageType = ServerMessage['t']
