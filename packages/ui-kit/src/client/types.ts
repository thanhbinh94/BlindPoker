import type {
  Card, ChaosBonusPayload, ChaosCreditReason, ChaosCritMultiplier, ChaosDiceResult, ChaosEffectKind, ChaosOutcome, ChaosReignKind, ChaosTableView, ChaosTier,
  ChaosTransfer, Decision, ErrorCode, GameMode, HeldCardView, LegalActions, PlayerAction, RoomSummary, RoomView, ServerMessage, ShowdownHand,
} from '@bp/core'
import type { PreActionKind } from './preaction.js'

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

/** `HandPhase` plus `DEALING`, the purely visual window before the first betting/decision frame arrives. */
export type ClientPhase = 'DEALING' | 'BETTING' | 'DECISION' | 'SQUEEZE' | 'REVEAL' | 'COMPLETE'

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
  /**
   * Squeeze mode (spec 2026-10-08): whether this seat has turned every card. Present only in a squeeze room — `true`
   * for a bot from the deal — and absent on a plain table, where cards are never anyone's to turn.
   */
  revealed?: boolean
  /** What this seat did last, for action bubbles; the engine's view never carries it. */
  lastAction: PlayerAction | null
  timedOut: boolean
  /**
   * The stack this seat had before `SETTLEMENT` paid the pots out (an uncalled bet handed back already in it — that is
   * not the result), set by the reducer when it settles. The table shows it while the result is held back
   * (`PokerTable`'s `resultPending`, the reveal hold), so the plate does not announce the winner before the cards have
   * turned. Absent before a hand is settled, and on a snapshot.
   */
  stackBeforeResult?: number
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
  /**
   * Poker hỗn loạn: the cards the hand used, in the order they acted ("Thẻ đã dùng"), from the public `CHAOS_SUMMARY`
   * just before `SETTLEMENT`. Absent on a hand that used none and on a table without chaos.
   */
  chaosUsed?: { seat: number; cardId: string; outcome: string; targets: number[] }[]
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
  /** Built from a `ROOM_SNAPSHOT` rather than followed from `HAND_STARTED`: the cards are already on the table, so nothing is dealt in. */
  restored: boolean
  /**
   * When things arrived, in client time (the `now` of the frame that carried them), for the card motion to pace itself
   * by. `null` until the event comes, on every new hand, and on a hand built from a snapshot — a snapshot is no
   * arrival, and the motion must not replay what the player never saw happen. This one is the hand's first `CARDS_DEALT`.
   */
  dealtAt: number | null
  /** The latest `COMMUNITY_REVEALED`; see `dealtAt`. */
  boardAt: number | null
  /** The `SHOWDOWN`; see `dealtAt`. */
  showdownAt: number | null
  /**
   * BP-41 (chaos): what this hand's `DECISION_PHASE` asked of the viewer's seat (`calls`) before its stack capped it — more than
   * the fixed wager when a card multiplied the stake. Absent when the server named no call for it (and on a snapshot).
   */
  myCall?: number
}

/**
 * One `CHAOS_APPLIED` as the viewer received it: deal-time buffs only ever reach their owner, so a seat's own are the only ones it sees early.
 * BP-41 adds what a round-three card tells besides (`dice`, `holeDelta`, `wild`, `off`, `wagers`, `stake`, `transfers`, `reign`, as
 * on the event), and two lines the room tells outside a hand, kept here so the toasts say them like any card: a Xúc xắc vận may
 * rolled at the end of the hand (`roll`, from `CHAOS_DICE`) and a Trộm điểm received (`steal`, from `CHAOS_STEAL`).
 */
export interface AppliedChaosView {
  seat: number
  cardId: string
  effect: ChaosEffectKind
  targets: number[]
  outcome: ChaosOutcome
  community?: Card[]
  amount?: number
  dice?: number[]
  holeDelta?: number
  wild?: Card
  off?: string
  wagers?: number
  stake?: number
  transfers?: ChaosTransfer[]
  reign?: ChaosReignKind
  /** BP-41 §5: what this seat's Xúc xắc vận may gave (the roll itself is `dice`). */
  roll?: ChaosDiceResult
  /** The client clock at the roll's arrival (`roll` lines only): the toast keeps the faces back until the dice land (Ruling 22). */
  rolledAt?: number
  /** BP-41 Trộm điểm: the chaos points it moved (`from`/`to` null and `amount` 0 when blocked or fizzled). */
  steal?: { from: number | null; to: number | null; amount: number }
}

/**
 * BP-41 §4.5 (G7): one table-wide banner as the room told it (`CHAOS_HERALD`), with the seat's name taken when it came — the
 * player may leave before it is read. `id` grows with every herald (and every 6-6-6 roll, `dice`), so the banner tells a new
 * one from one it has shown; `at` is the client clock at its arrival.
 */
export interface ClientHerald {
  id: number
  kind: ChaosReignKind | 'dice'
  seat: number
  name: string
  /** `dice` only: the jackpot the roll is due, and its faces. */
  amount?: number
  dice?: number[]
  at: number
}

/** BP-41 §5: one Xúc xắc vận may roll the table watches (`CHAOS_DICE`), with the roller's name; `id` and `at` as on `ClientHerald`. */
export interface ClientDiceRoll {
  id: number
  seat: number
  name: string
  cardId: string
  dice: number[]
  result: ChaosDiceResult
  at: number
}

/**
 * A chaos draft as this viewer sees it: `offer` is the three cards sent to this player alone (`null` for a spectator,
 * and for a seat drafted with nothing to choose from), `picked` once its choice is made.
 */
export interface ClientChaosDraft {
  tier: ChaosTier
  deadlineAt: number
  /** The window's whole length (the GM's `draftMs`, 5–60 s): the timer ring's full circle. */
  totalMs: number
  offer: { offerId: string; cardIds: string[] } | null
  picked: boolean
}

export interface ClientChaosCredit {
  seat: number
  amount: number
  reason: ChaosCreditReason
  /** The daily cap cut the credit (`amount` is what was actually paid). */
  capped: boolean
  /** Bạo kích only (×2…×5, BP-41). */
  multiplier?: ChaosCritMultiplier
}

/** Poker hỗn loạn (spec 2026-10-26): everything the client keeps about the chaos cards. Empty on a table without them. */
export interface ClientChaos {
  draft: ClientChaosDraft | null
  /** Every seat's held cards, chaos points and how many bonus cards wait in its hand (public; which cards stays the owner's). */
  seats: Record<number, { cards: HeldCardView[]; points: number; bonusCount: number }>
  /** This hand's `CHAOS_APPLIED`, in order; cleared when the next hand starts. */
  applied: AppliedChaosView[]
  /** The credits cards paid after the last hand; cleared when the next hand starts. */
  credits: ClientChaosCredit[]
  /** Bonus or prize cards seats received after the last hand; cleared when the next hand starts. */
  awarded: { seat: number; cardIds: string[] }[]
  /** "Nhìn trộm": the next board cards, for this viewer only; cleared when the next hand starts. */
  peek: { seat: number; cards: Card[] } | null
  /**
   * "Thế giới đảo ngược" is on this hand: the weakest hand wins. Set by its public `CHAOS_APPLIED` or by a snapshot's hand
   * view (`chaos.reverse`), so a reconnect still says so; cleared when the next hand starts.
   */
  reverse: boolean
  /**
   * Whether the viewer's own cards are down under a blindfold this hand, as a snapshot's hand view says (`chaos.blindfolded`).
   * `null` when no snapshot said: no event announces a blindfold, so the table reads it off the deal (a seat holding cards it
   * was shown none of). Cleared to `null` when the next hand starts.
   */
  blindfolded: boolean | null
  /**
   * The viewer's own bonus hand (BP-39): the cards waiting to be played, and the one pressed and not yet fired. From the
   * owner's `CHAOS_BONUS` notification and a snapshot; empty for a spectator and on every other table.
   */
  bonus: ChaosBonusPayload
  /**
   * BP-41: the table's own chaos state, public — the Thần Bài, the Bán Thần and the bombs (`CHAOS_TABLE`, `CHAOS_STATE.table`, a
   * snapshot's `chaos.table`). `null`: none of them.
   */
  table: ChaosTableView | null
  /** BP-41 §4.5: the latest heralds, oldest first (a few at most); the banner shows the ones that arrived in its last 3 s. */
  heralds: ClientHerald[]
  /** BP-41 §5: the latest dice rolls, oldest first (a few at most); the dice show the ones that arrived in their last 3 s. */
  rolls: ClientDiceRoll[]
  /**
   * BP-41 Lá ma: the viewer's own hole card that ranks as wild this hand (its owner's `CHAOS_APPLIED.wild`, or a snapshot's hand
   * view); `null` otherwise. Cleared when the next hand starts.
   */
  wild: Card | null
  /**
   * BP-41 Mắt diều hâu: the hole cards of `target` the viewer saw (`CHAOS_HAWK` with cards is the viewer's own, or a snapshot's
   * hand view); `null` otherwise. Cleared when the next hand starts.
   */
  hawk: { target: number; cards: Card[] } | null
}

export const initialChaos: ClientChaos = {
  draft: null, seats: {}, applied: [], credits: [], awarded: [], peek: null, reverse: false, blindfolded: null, bonus: { cards: [], armed: null },
  table: null, heralds: [], rolls: [], wild: null, hawk: null,
}

/**
 * A chaos table's result wait, as "Bỏ qua" counts it: how many of the `total` voters pressed it, and whether I did.
 * `null` outside a wait (cleared when a hand or a draft starts, and on leaving).
 */
export interface ClientResultSkips {
  skipped: number
  total: number
  mine: boolean
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
  chaos: ClientChaos
  /** Poker hỗn loạn: the "Bỏ qua" count of the running result wait, or `null` when none runs. */
  resultSkips: ClientResultSkips | null
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
  /** The server acknowledged my `CHAOS_PICK`: the offer is picked now, not only when the draft ends. */
  | { type: 'chaosPicked'; offerId: string }
  /** The server acknowledged my `RESULT_SKIP`: the count shows I pressed it. */
  | { type: 'resultSkipped' }
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
  chaos: initialChaos,
  resultSkips: null,
}
