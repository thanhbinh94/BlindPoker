import type { Card } from '../cards/cards.js'
import { PRIVATE_AT_DEAL, isBlindfolded } from '../chaos/engine.js'
// Imported directly (not through `engine.js`) to keep `view.ts` free of a circular import.
import { blindLegalActions } from './blind.js'
import { holdemLegalActions } from './holdem.js'
import type { Decision, GameEvent, GameMode, HandPhase, HandResult, HandState, LegalActions, Street } from './types.js'

export interface SeatView {
  seat: number
  playerId: string
  isBot: boolean
  stack: number
  betThisStreet: number
  totalCommitted: number
  folded: boolean
  allIn: boolean
  cardCount: number
  holeCards: Card[] | null
  hasDecided: boolean
  decision: Decision | null
  /** Squeeze mode: this seat has turned every card over (always true outside squeeze mode, and for a bot). */
  revealed: boolean
}

export interface HandView {
  handId: string
  mode: GameMode
  phase: HandPhase
  street: Street
  community: Card[]
  pot: number
  carryOverIn: number
  currentBet: number
  minRaise: number
  button: number
  actingSeat: number | null
  turnSeq: number
  seats: SeatView[]
  mySeat: number | null
  /** What the viewer may do right now, or null when it is not their turn (or there is no viewer). */
  legal: LegalActions | null
  result: HandResult | null
  /**
   * Poker hỗn loạn, on a chaos hand only: the reversed ranking (public from the deal), the board cards the viewer
   * peeked at (theirs only, `[]` otherwise), and whether the viewer is blindfolded (their own cards are then null).
   */
  chaos?: { reverse: boolean; peek: Card[]; blindfolded: boolean }
}

function viewerLegal(state: HandState, viewerSeat: number | null): LegalActions | null {
  if (viewerSeat === null || state.phase === 'COMPLETE') return null
  if (!state.players.some((p) => p.seat === viewerSeat)) return null
  if (state.actingSeat !== viewerSeat && state.phase !== 'DECISION') return null
  return state.rules.mode === 'holdem' ? holdemLegalActions(state, viewerSeat) : blindLegalActions(state, viewerSeat)
}

/**
 * Strips the parts of an event a given viewer must not see, or returns null when the viewer must not get it at all.
 * Hole cards dealt to another seat are blanked (the `cardCount` survives so clients can still render card backs); a
 * chaos peek is blanked the same way; a deal-time chaos card reaches only its owner and its targets (the table reads
 * it in `CHAOS_SUMMARY` at the settlement). Every other event is already viewer-safe.
 */
export function filterEvent(event: GameEvent, viewerSeat: number | null): GameEvent | null {
  if (event.type === 'CARDS_DEALT' && event.seat !== viewerSeat) return { ...event, cards: [] }
  if (event.type === 'CHAOS_PEEK' && event.seat !== viewerSeat) return { ...event, cards: [] }
  if (event.type === 'CHAOS_APPLIED' && PRIVATE_AT_DEAL.has(event.effect)) {
    const party = viewerSeat !== null && (event.seat === viewerSeat || event.targets.includes(viewerSeat))
    if (!party) return null
  }
  return event
}

export function playerView(state: HandState, viewerSeat: number | null): HandView {
  const shownAtShowdown = new Set(state.result?.showdown?.map((h) => h.seat) ?? [])
  const decisionsPublic = state.phase !== 'DECISION'
  const plan = state.chaos?.plan
  const view: HandView = {
    handId: state.handId,
    mode: state.rules.mode,
    phase: state.phase,
    street: state.street,
    community: state.community.slice(),
    pot: state.pot,
    carryOverIn: state.carryOverIn,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    button: state.button,
    actingSeat: state.actingSeat,
    turnSeq: state.turnSeq,
    mySeat: viewerSeat,
    legal: viewerLegal(state, viewerSeat),
    result: state.result ? structuredClone(state.result) : null,
    seats: state.players.map((p) => {
      const mine = p.seat === viewerSeat
      return {
        seat: p.seat,
        playerId: p.playerId,
        isBot: p.isBot,
        stack: p.stack,
        betThisStreet: p.betThisStreet,
        totalCommitted: p.totalCommitted,
        folded: p.folded,
        allIn: p.allIn,
        cardCount: p.holeCards.length,
        holeCards: (mine && !isBlindfolded(plan, p.seat)) || shownAtShowdown.has(p.seat) ? p.holeCards.slice() : null,
        hasDecided: p.decision !== null,
        decision: mine || decisionsPublic ? p.decision : null,
        revealed: p.revealed,
      }
    }),
  }
  if (state.chaos) {
    view.chaos = {
      reverse: state.chaos.plan.reverse,
      peek: state.chaos.peek.find((x) => x.seat === viewerSeat)?.cards.slice() ?? [],
      blindfolded: viewerSeat !== null && isBlindfolded(plan, viewerSeat),
    }
  }
  return view
}
