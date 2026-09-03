import type { Card } from '../cards/cards.js'
import type { Decision, GameMode, HandPhase, HandResult, HandState, Street } from './types.js'

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
  result: HandResult | null
}

export function playerView(state: HandState, viewerSeat: number | null): HandView {
  const shownAtShowdown = new Set(state.result?.showdown?.map((h) => h.seat) ?? [])
  const decisionsPublic = state.phase !== 'DECISION'
  return {
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
        holeCards: mine || shownAtShowdown.has(p.seat) ? p.holeCards.slice() : null,
        hasDecided: p.decision !== null,
        decision: mine || decisionsPublic ? p.decision : null,
      }
    }),
  }
}
