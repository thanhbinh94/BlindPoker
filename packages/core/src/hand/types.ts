import type { Card } from '../cards/cards.js'
import type { PotResult } from '../betting/pots.js'
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
export type HandPhase = 'BETTING' | 'DECISION' | 'REVEAL' | 'COMPLETE'
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

export interface ShowdownHand {
  seat: number
  cards: Card[]
  rank: number
  category: HandCategory
  best: Card[]
}

export interface HandResult {
  pots: PotResult[]
  fee: number
  payouts: { seat: number; amount: number }[]
  stacks: { seat: number; stack: number }[]
  showdown: ShowdownHand[] | null
  carryOverOut: number
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
  /** Increments on every TURN_CHANGED / DECISION_PHASE; timers must carry it. */
  turnSeq: number
  currentBet: number
  minRaise: number
  /** Total chips in play for this hand, INCLUDING `carryOverIn` (already folded into `pot` at hand start, e.g. before antes for Blind hands). Contrast with `settle()`, which recomputes pots from per-player contributions and adds `carryOverIn` to the main pot on top of them — do not double count. */
  pot: number
  /** Chips carried over from a prior hand (e.g. an unresolved Blind-mode pot), added to `pot` at hand creation. */
  carryOverIn: number
  revealQueue: Street[]
  result: HandResult | null
}

export type GameEvent =
  | { type: 'HAND_STARTED'; handId: string; mode: GameMode; button: number; seats: number[]; carryOverIn: number }
  | { type: 'BLINDS_POSTED'; posts: { seat: number; amount: number; kind: 'SB' | 'BB' | 'ANTE' }[] }
  | { type: 'CARDS_DEALT'; seat: number; cards: Card[] }
  | { type: 'TURN_CHANGED'; seat: number; turnSeq: number; legal: LegalActions }
  | { type: 'PLAYER_ACTED'; seat: number; action: PlayerAction; amount: number; stack: number; allIn: boolean; timedOut: boolean }
  | { type: 'DECISION_PHASE'; seats: number[]; turnSeq: number }
  | { type: 'DECISION_MADE'; seat: number }
  | { type: 'DECISIONS_REVEALED'; decisions: { seat: number; decision: Decision }[] }
  | { type: 'COMMUNITY_REVEALED'; street: Street; cards: Card[]; community: Card[] }
  | { type: 'POT_UPDATED'; pot: number }
  | { type: 'SHOWDOWN'; hands: ShowdownHand[] }
  | { type: 'SETTLEMENT'; payouts: { seat: number; amount: number }[]; fee: number; pots: PotResult[]; carryOverOut: number; stacks: { seat: number; stack: number }[] }
  | { type: 'HAND_COMPLETE' }

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
