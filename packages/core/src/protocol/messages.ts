import type { ChaosCreditReason, ChaosCritMultiplier, ChaosDiceResult, ChaosOutcome, ChaosTableView, ChaosTier, HeldCardView } from '../chaos/types.js'
import type { GameEvent, PlayerAction } from '../hand/types.js'
import type { HandView } from '../hand/view.js'

/**
 * `CHAOS_UNAVAILABLE`: a chaos table asked of a server that has no chaos port (Lite). `CHAOS_NO_OFFER`: a pick for an
 * offer that is not open (already picked, gone with the draft, or never this player's). `CHAOS_CANNOT_USE`: a bonus card
 * pressed when it cannot be played (no such card, one already armed, frozen, a weaker duplicate, or not a moment to play).
 */
export type ErrorCode =
  | 'UNAUTHENTICATED' | 'INVALID_MESSAGE' | 'RATE_LIMITED' | 'ROOM_NOT_FOUND' | 'ROOM_FULL' | 'WRONG_PASSWORD'
  | 'INVALID_ROOM_CONFIG' | 'NOT_HOST' | 'SEAT_TAKEN' | 'INSUFFICIENT_BALANCE' | 'NOT_YOUR_TURN' | 'ILLEGAL_ACTION'
  | 'INVALID_AMOUNT' | 'STALE_STATE' | 'DUPLICATE_REQUEST' | 'NOT_IN_HAND' | 'NOT_IN_ROOM' | 'ALREADY_IN_ROOM'
  | 'NOT_SEATED' | 'GAME_IN_PROGRESS' | 'NOT_ENOUGH_PLAYERS' | 'DISPLAY_NAME_TAKEN' | 'SERVER_SHUTDOWN' | 'INTERNAL'
  | 'CHAOS_UNAVAILABLE' | 'CHAOS_NO_OFFER' | 'CHAOS_CANNOT_USE'

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
  /** Squeeze mode (spec 2026-10-08): hole cards are turned by hand inside a 20 s round. A validated config always sets it. */
  squeeze?: boolean
  /** Poker hỗn loạn (spec 2026-10-26 §3.2): a draft every this many hands. Absent means a plain Blind table. */
  chaosCycle?: 5 | 10
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
  /**
   * A chaos table only, on a seated player: the cards the seat holds and its chaos points (public, spec §3.4), and how
   * many bonus cards wait in its hand (armed one included; which cards they are stays private to the owner).
   */
  chaos?: { cards: HeldCardView[]; points: number; bonusCount: number }
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
  /**
   * A chaos draft opened (spec §3.2): `seats` are drafting a card of `tier` before the next hand, until `deadlineAt`.
   * `draftMs` is the window's whole length (the GM sets it, 5–60 s): a client draws its timer's full circle from it.
   */
  | { type: 'CHAOS_DRAFT'; tier: ChaosTier; deadlineAt: number; draftMs: number; seats: number[] }
  /** The draft is over: what each seat received (every card, a Cấp độ's results included). */
  | { type: 'CHAOS_PICKED'; seat: number; cardIds: string[] }
  /**
   * Every seat's held cards and chaos points, after a draft and after each hand. `table` (BP-41): the Thần, the Bán Thần
   * and the bombs, public; absent = none of them.
   */
  | { type: 'CHAOS_STATE'; seats: { seat: number; cards: HeldCardView[]; points: number; bonusCount: number }[]; table?: ChaosTableView }
  /**
   * New points a card paid onto the seat's stack (`amount` as credited; `capped` when the daily cap cut it). `stack` is
   * the seat's stack after the credit, absolute, so a client never has to add it up (a seat at 0 rescued between hands).
   * `multiplier`: Bạo kích only, ×2…×5 (BP-41).
   */
  | { type: 'CHAOS_CREDIT'; seat: number; amount: number; stack: number; reason: ChaosCreditReason; capped: boolean; multiplier?: ChaosCritMultiplier }
  /**
   * BP-41 §4.5 (G7): the table-wide banner, to everyone in the room — `god`: the seat became the Thần Bài; `demigod`: a
   * Bán Thần; `godslain`: the seat beat the Thần (one event per winner). Sent at the deal (god, demigod) or at the
   * settlement (godslain).
   */
  | { type: 'CHAOS_HERALD'; kind: 'god' | 'demigod' | 'godslain'; seat: number; playerId: string }
  /**
   * BP-41 §5: a Xúc xắc vận may rolled at the end of the hand, public — the faces, what they gave, and the seat's stack
   * after any loss (absolute, like `CHAOS_CREDIT`). Prize cards are named by tier and count only (A7).
   */
  | { type: 'CHAOS_DICE'; seat: number; cardId: string; dice: number[]; result: ChaosDiceResult; stack: number }
  /**
   * BP-41: the table's public chaos state alone (the Thần, the Bán Thần, the bombs; empty lists and a null `god` = none),
   * told when it changes outside a `CHAOS_STATE` — before a hand is dealt (an ascension, a bomb passed on) and when a
   * seat that reigned or owned a bomb leaves. Never the seats' held cards, so it may go out while a hand is live.
   */
  | { type: 'CHAOS_TABLE'; table: ChaosTableView }
  /**
   * BP-41 Trộm điểm, public: `seat` received it (a draft pick, a prize or bonus card) and it was aimed at `targets` (after
   * any Bia đỡ đạn; empty when nobody had a point). `amount` chaos points went `from` → `to` (a mirror turns it round;
   * 0 and nulls when blocked or fizzled). `spent`: the shield, mirror or Bia đỡ đạn cards it used up on the way.
   */
  | {
    type: 'CHAOS_STEAL'; seat: number; cardId: string; outcome: ChaosOutcome; targets: number[]; from: number | null; to: number | null
    amount: number; spent: { seat: number; cardId: string; passedTo?: number }[]
  }
  /** Bonus or prize cards the seat received at the end of a hand. */
  | { type: 'CHAOS_AWARDED'; seat: number; cardIds: string[] }
  /** A chaos table's result wait: how many humans pressed "Bỏ qua" out of how many are waited for (BP-39). */
  | { type: 'RESULT_SKIPS'; skipped: number; total: number }

/** `NOTIFICATION { kind: 'CHAOS_OFFER' }`'s payload: the three cards offered privately to one player in a draft. */
export interface ChaosOfferPayload {
  offerId: string
  /**
   * The tier of this player's own offer: the draft's (`CHAOS_DRAFT.tier`), or higher when the seat held a Nâng tầm uy
   * lực (BP-41; the snapshot's `draft.tier` says the viewer's own tier too).
   */
  tier: ChaosTier
  cardIds: string[]
  deadlineAt: number
  /** The draft window's whole length, as in `CHAOS_DRAFT`. */
  draftMs: number
}

/**
 * `NOTIFICATION { kind: 'CHAOS_BONUS' }`'s payload, sent to the owner only: the bonus hand and the card pressed and
 * waiting (`armed`), with the hand it will fire in.
 */
export interface ChaosBonusPayload {
  cards: HeldCardView[]
  armed: { uid: number; cardId: string; hand: 'this' | 'next' } | null
}

/**
 * `ROOM_SNAPSHOT.chaos`: the draft as the viewer sees it — its own offer (none for a spectator) and whether it picked —
 * and, for a seated viewer, its own bonus hand (`bonus`; never another seat's).
 */
export interface ChaosSnapshot {
  draft: { tier: ChaosTier; deadlineAt: number; draftMs: number; offer: { offerId: string; cardIds: string[] } | null; picked: boolean } | null
  bonus?: ChaosBonusPayload
  /**
   * BP-41: the table's public chaos state, as `CHAOS_STATE.table` / `CHAOS_TABLE` say it, so a reconnect sees the reign
   * and the bombs; absent = none of them.
   */
  table?: ChaosTableView
}

/**
 * `ROOM_SNAPSHOT.resultSkips`, present only while a chaos table's result wait runs: the "Bỏ qua" tally as `RESULT_SKIPS`
 * says it, plus whether the viewer has pressed it (so a reconnect or a late joiner does not lose the count).
 */
export interface ResultSkipsSnapshot {
  skipped: number
  total: number
  mine?: boolean
}

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
  /** Squeeze mode: the sender has turned every one of its cards (spec 2026-10-08 §5.2). Harmless anywhere else. */
  | { t: 'REVEAL'; reqId?: string }
  | { t: 'READY'; reqId?: string; ready: boolean }
  | { t: 'START_GAME'; reqId?: string }
  | { t: 'KICK'; reqId?: string; playerId: string }
  | { t: 'ACTION'; reqId: string; baseSeq: number; action: PlayerAction }
  | { t: 'RESYNC'; reqId?: string }
  | { t: 'PONG'; reqId?: string }
  /** Poker hỗn loạn: take one card of the offer this player was sent in the open draft. */
  | { t: 'CHAOS_PICK'; reqId?: string; offerId: string; cardId: string }
  /** Poker hỗn loạn: play the bonus card `uid` from this player's bonus hand (BP-39). */
  | { t: 'CHAOS_USE'; reqId?: string; uid: number }
  /** Poker hỗn loạn: skip the rest of the hand-result wait; the next hand deals when every human has (BP-39). */
  | { t: 'RESULT_SKIP'; reqId?: string }

export type ServerMessage =
  | { t: 'WELCOME'; playerId: string; displayName: string; balance: number; serverTime: number }
  | { t: 'ROOM_LIST'; rooms: RoomSummary[] }
  | { t: 'ROOM_SNAPSHOT'; seq: number; room: RoomView; hand: HandView | null; deadlineAt: number | null; chaos?: ChaosSnapshot; resultSkips?: ResultSkipsSnapshot }
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
