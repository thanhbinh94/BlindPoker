import type { Card } from '../cards/cards.js'
import type { PotResult } from '../betting/pots.js'
import type { ChaosEffectKind, ChaosHandState, ChaosOutcome, ChaosUse } from '../chaos/types.js'
import type { HandCategory } from '../evaluator/evaluator.js'

export interface HoldemRules {
  mode: 'holdem'
  smallBlind: number
  bigBlind: number
  tableFeeRate: number
  /** Fee cap expressed in big blinds. */
  tableFeeCapBB: number
}

export interface BlindRules {
  mode: 'blind'
  holeCards: 2 | 3
  decisionMode: 'none' | 'playOrFold'
  fixedWager: number
  tableFeeRate: number
  /**
   * Squeeze mode (spec 2026-10-08): each seat's hole cards stay face down on its own screen until it turns them, and
   * the table waits — a `SQUEEZE` phase in pure luck, the 20 s decision round in play-or-fold. Absent means off.
   */
  squeeze?: boolean
}

export type Ruleset = HoldemRules | BlindRules
export type GameMode = Ruleset['mode']

export interface SeatInput {
  seat: number
  playerId: string
  stack: number
  isBot: boolean
}

export type Street = 'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER'
export type HandPhase = 'BETTING' | 'DECISION' | 'SQUEEZE' | 'REVEAL' | 'COMPLETE'
export type Decision = 'play' | 'fold'

export interface HandPlayer {
  seat: number
  playerId: string
  isBot: boolean
  stack: number
  holeCards: Card[]
  betThisStreet: number
  totalCommitted: number
  folded: boolean
  allIn: boolean
  /** Has acted in the current betting street (reset on every full raise / new street). */
  hasActed: boolean
  /** Set when a short all-in raise happened after this player already acted: may call/fold only. */
  cannotRaise: boolean
  /** Blind mode B decision, hidden from others until DECISIONS_REVEALED. */
  decision: Decision | null
  /**
   * Blind mode B: `decision` was forced by the timer (`TIMEOUT`), not chosen. Server-side only — `playerView` never
   * carries it. It is told with the seat's `PLAYER_ACTED` when the decisions resolve, never earlier: a `DECISION_MADE`
   * that said "the timer folded this seat" would give the fold away before the reveal.
   */
  timedOut: boolean
  /** Squeeze mode: this seat has turned every one of its cards over. Always true outside squeeze mode, and for a bot. */
  revealed: boolean
}

export type ActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn' | 'play'
export type PlayerAction = { kind: 'fold' | 'check' | 'call' | 'allIn' | 'play' } | { kind: 'bet' | 'raise'; amount: number }

export interface LegalActions {
  seat: number
  kinds: ActionKind[]
  /** Chips required to call (already capped at the player's stack). */
  callAmount: number
  /** Valid totals for `bet` (amount put in this street). */
  minBet: number
  maxBet: number
  /** Valid totals for `raise` ("raise to" amount this street). */
  minRaiseTo: number
  maxRaiseTo: number
}

export type HandCommand =
  | { type: 'ACTION'; seat: number; action: PlayerAction }
  | { type: 'TIMEOUT'; seat: number }
  | { type: 'ADVANCE' }
  | { type: 'REVEALED'; seat: number }
  | { type: 'CANCEL'; reason: string }

export interface ShowdownHand {
  seat: number
  cards: Card[]
  rank: number
  category: HandCategory
  best: Card[]
  /** Poker hỗn loạn "Mượn lá": the opponent's card this seat also ranked with (a copy). */
  borrowed?: Card
}

export interface HandResult {
  pots: PotResult[]
  fee: number
  payouts: { seat: number; amount: number }[]
  stacks: { seat: number; stack: number }[]
  showdown: ShowdownHand[] | null
  carryOverOut: number
  /** Excess bet nobody could call, handed back before pots and the fee were computed. */
  uncalledReturned: { seat: number; amount: number } | null
}

export interface HandState {
  handId: string
  rules: Ruleset
  phase: HandPhase
  /** Sorted by seat. */
  players: HandPlayer[]
  deck: Card[]
  deckIndex: number
  community: Card[]
  button: number
  street: Street
  actingSeat: number | null
  /** Increments on every TURN_CHANGED / DECISION_PHASE / SQUEEZE_PHASE; timers must carry it. */
  turnSeq: number
  currentBet: number
  minRaise: number
  /**
   * Total chips in play for this hand, INCLUDING `carryOverIn` (already folded into `pot` at hand start, e.g. before
   * antes for Blind hands). Contrast with `settle()`, which recomputes pots from per-player contributions and adds
   * `carryOverIn` to the main pot on top of them — do not double count.
   * After COMPLETE this keeps the settled total for display; the SETTLEMENT event carries payouts.
   */
  pot: number
  /** Chips carried over from a prior hand (e.g. an unresolved Blind-mode pot), added to `pot` at hand creation. */
  carryOverIn: number
  revealQueue: Street[]
  result: HandResult | null
  /** Poker hỗn loạn: present only on a chaos table; absent, the hand is exactly a plain Blind hand. */
  chaos?: ChaosHandState
}

export type GameEvent =
  | { type: 'HAND_STARTED'; handId: string; mode: GameMode; button: number; seats: number[]; carryOverIn: number }
  | { type: 'BLINDS_POSTED'; posts: { seat: number; amount: number; kind: 'SB' | 'BB' | 'ANTE' }[] }
  | { type: 'CARDS_DEALT'; seat: number; cards: Card[]; cardCount: number }
  | { type: 'TURN_CHANGED'; seat: number; turnSeq: number; legal: LegalActions }
  | { type: 'PLAYER_ACTED'; seat: number; action: PlayerAction; amount: number; stack: number; allIn: boolean; timedOut: boolean }
  | { type: 'DECISION_PHASE'; seats: number[]; turnSeq: number }
  | { type: 'DECISION_MADE'; seat: number }
  | { type: 'DECISIONS_REVEALED'; decisions: { seat: number; decision: Decision }[] }
  | { type: 'SQUEEZE_PHASE'; seats: number[]; turnSeq: number }
  | { type: 'PLAYER_REVEALED'; seat: number }
  | { type: 'SQUEEZE_ENDED' }
  | { type: 'COMMUNITY_REVEALED'; street: Street; cards: Card[]; community: Card[] }
  | { type: 'POT_UPDATED'; pot: number }
  | { type: 'SHOWDOWN'; hands: ShowdownHand[] }
  | { type: 'SETTLEMENT'; payouts: { seat: number; amount: number }[]; fee: number; pots: PotResult[]; carryOverOut: number; stacks: { seat: number; stack: number }[]; uncalledReturned: { seat: number; amount: number } | null }
  | { type: 'HAND_CANCELLED'; reason: string; refunds: { seat: number; amount: number }[]; carryOverOut: number }
  | { type: 'HAND_COMPLETE' }
  /** A chaos card acted. Deal-time buffs and debuffs reach only their owner and targets (`filterEvent`); `reverseRank` and the rest are public. `amount`: a refund (freeFold, refundStake). */
  | { type: 'CHAOS_APPLIED'; seat: number; cardId: string; effect: ChaosEffectKind; targets: number[]; outcome: ChaosOutcome; community?: Card[]; amount?: number }
  /** "Nhìn trộm": the next board cards, for `seat` only (`filterEvent` blanks them for everyone else). */
  | { type: 'CHAOS_PEEK'; seat: number; cards: Card[] }
  /** Every card the hand used, public, just before `SETTLEMENT`. */
  | { type: 'CHAOS_SUMMARY'; used: ChaosUse[] }

export interface EngineResult {
  state: HandState
  events: GameEvent[]
}

export type EngineErrorCode = 'NOT_YOUR_TURN' | 'ILLEGAL_ACTION' | 'INVALID_AMOUNT' | 'NOT_IN_HAND' | 'HAND_COMPLETE' | 'INVALID_COMMAND' | 'INVALID_SETUP'

export class EngineError extends Error {
  constructor(
    public readonly code: EngineErrorCode,
    message?: string,
  ) {
    super(message === undefined ? code : `${code}: ${message}`)
    this.name = 'EngineError'
  }
}
