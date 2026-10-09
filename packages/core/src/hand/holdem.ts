import { createDeck } from '../cards/cards.js'
import type { Rng } from '../cards/rng.js'
import { shuffle } from '../cards/shuffle.js'
import { canAct, cancelHand, clone, commit, dealCards, getPlayer, revealNext, seatsClockwiseFrom, settle, unfolded } from './common.js'
import {
  EngineError,
  type ActionKind, type EngineResult, type GameEvent, type HandCommand, type HandPlayer, type HandState,
  type HoldemRules, type LegalActions, type PlayerAction, type SeatInput, type Street,
} from './types.js'

export interface CreateHoldemInput {
  handId: string
  rules: HoldemRules
  seats: SeatInput[]
  button: number
}

const NEXT_STREET: Record<Street, Street | null> = { PREFLOP: 'FLOP', FLOP: 'TURN', TURN: 'RIVER', RIVER: null }

const rulesOf = (state: HandState): HoldemRules => {
  if (state.rules.mode !== 'holdem') throw new EngineError('INVALID_COMMAND', 'not a holdem hand')
  return state.rules
}
const feeCap = (state: HandState): number => rulesOf(state).tableFeeCapBB * rulesOf(state).bigBlind
const needsAction = (state: HandState, p: HandPlayer): boolean => canAct(p) && (!p.hasActed || p.betThisStreet < state.currentBet)

export function createHoldemHand(input: CreateHoldemInput, rng: Rng): EngineResult {
  const seats = [...input.seats].sort((a, b) => a.seat - b.seat)
  if (seats.length < 2) throw new EngineError('INVALID_SETUP', 'need at least 2 players')
  if (seats.some((s) => s.stack <= 0)) throw new EngineError('INVALID_SETUP', 'every player needs chips')
  if (!seats.some((s) => s.seat === input.button)) throw new EngineError('INVALID_SETUP', 'button must be a seated player')

  const state: HandState = {
    handId: input.handId,
    rules: input.rules,
    phase: 'BETTING',
    players: seats.map((s) => ({
      seat: s.seat, playerId: s.playerId, isBot: s.isBot, stack: s.stack, holeCards: [], betThisStreet: 0,
      totalCommitted: 0, folded: false, allIn: false, hasActed: false, cannotRaise: false, decision: null, revealed: true,
    })),
    deck: shuffle(createDeck(), rng),
    deckIndex: 0,
    community: [],
    button: input.button,
    street: 'PREFLOP',
    actingSeat: null,
    turnSeq: 0,
    currentBet: 0,
    minRaise: input.rules.bigBlind,
    pot: 0,
    carryOverIn: 0,
    revealQueue: [],
    result: null,
  }
  const events: GameEvent[] = [
    { type: 'HAND_STARTED', handId: state.handId, mode: 'holdem', button: state.button, seats: state.players.map((p) => p.seat), carryOverIn: 0 },
  ]

  const order = seatsClockwiseFrom(state, state.button)
  for (let round = 0; round < 2; round++) for (const p of order) p.holeCards.push(...dealCards(state, 1))
  for (const p of state.players) events.push({ type: 'CARDS_DEALT', seat: p.seat, cards: p.holeCards.slice(), cardCount: p.holeCards.length })

  const headsUp = state.players.length === 2
  const sb = headsUp ? getPlayer(state, state.button) : order[0]!
  const bb = headsUp ? order[0]! : order[1]!
  events.push({
    type: 'BLINDS_POSTED',
    posts: [
      { seat: sb.seat, amount: commit(state, sb, input.rules.smallBlind), kind: 'SB' },
      { seat: bb.seat, amount: commit(state, bb, input.rules.bigBlind), kind: 'BB' },
    ],
  })
  state.currentBet = input.rules.bigBlind
  events.push({ type: 'POT_UPDATED', pot: state.pot })
  advance(state, events, bb.seat)
  return { state, events }
}

export function holdemLegalActions(state: HandState, seat: number): LegalActions {
  const p = getPlayer(state, seat)
  // A seat that is folded, all-in or simply not on turn has nothing it may legally do.
  if (p.folded || p.allIn || state.actingSeat !== seat) return { seat, kinds: [], callAmount: 0, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 }
  const bb = rulesOf(state).bigBlind
  const toCall = Math.max(0, state.currentBet - p.betThisStreet)
  const kinds: ActionKind[] = ['fold']
  let minBet = 0, maxBet = 0, minRaiseTo = 0, maxRaiseTo = 0
  kinds.push(toCall === 0 ? 'check' : 'call')
  if (state.currentBet === 0 && p.stack > 0) {
    kinds.push('bet')
    minBet = Math.min(bb, p.stack)
    maxBet = p.stack
  } else if (state.currentBet > 0 && !p.cannotRaise && p.stack > toCall) {
    kinds.push('raise')
    maxRaiseTo = p.betThisStreet + p.stack
    minRaiseTo = Math.min(state.currentBet + state.minRaise, maxRaiseTo)
  }
  if (p.stack > 0 && !(p.cannotRaise && p.stack > toCall)) kinds.push('allIn')
  return { seat, kinds, callAmount: Math.min(toCall, p.stack), minBet, maxBet, minRaiseTo, maxRaiseTo }
}

export function applyHoldemCommand(input: HandState, cmd: HandCommand, _rng: Rng): EngineResult {
  const state = clone(input)
  const events: GameEvent[] = []
  if (state.phase === 'COMPLETE') throw new EngineError('HAND_COMPLETE')
  switch (cmd.type) {
    case 'CANCEL': {
      cancelHand(state, events, cmd.reason)
      return { state, events }
    }
    case 'ADVANCE': {
      if (state.phase !== 'REVEAL') throw new EngineError('INVALID_COMMAND', 'ADVANCE only during REVEAL')
      revealNext(state, events)
      if (state.revealQueue.length === 0) settle(state, events, { showdown: true, feeCap: feeCap(state) })
      return { state, events }
    }
    // Squeeze mode is a Blind rule: a Hold'em seat is revealed from the deal, so there is nothing to turn.
    case 'REVEALED': {
      return { state, events }
    }
    case 'TIMEOUT': {
      assertTurn(state, cmd.seat)
      const legal = holdemLegalActions(state, cmd.seat)
      applyAction(state, events, cmd.seat, legal.kinds.includes('check') ? { kind: 'check' } : { kind: 'fold' }, true)
      return { state, events }
    }
    case 'ACTION': {
      assertTurn(state, cmd.seat)
      applyAction(state, events, cmd.seat, cmd.action, false)
      return { state, events }
    }
  }
}

function assertTurn(state: HandState, seat: number): void {
  if (state.phase !== 'BETTING' || state.actingSeat !== seat) throw new EngineError('NOT_YOUR_TURN', `seat ${seat} is not acting`)
}

function applyAction(state: HandState, events: GameEvent[], seat: number, action: PlayerAction, timedOut: boolean): void {
  const p = getPlayer(state, seat)
  const legal = holdemLegalActions(state, seat)
  if (!legal.kinds.includes(action.kind)) throw new EngineError('ILLEGAL_ACTION', `${action.kind} is not legal for seat ${seat}`)
  const toCall = Math.max(0, state.currentBet - p.betThisStreet)
  let amount = 0
  switch (action.kind) {
    case 'fold':
      p.folded = true
      p.hasActed = true
      break
    case 'check':
      p.hasActed = true
      break
    case 'call':
      amount = commit(state, p, toCall)
      p.hasActed = true
      break
    case 'bet': {
      const total = action.amount
      if (!Number.isInteger(total) || total <= 0 || total > legal.maxBet || (total < legal.minBet && total !== p.stack))
        throw new EngineError('INVALID_AMOUNT', `bet must be between ${legal.minBet} and ${legal.maxBet}`)
      amount = commit(state, p, total)
      openBet(state, p, total)
      break
    }
    case 'raise': {
      const raiseTo = action.amount
      if (!Number.isInteger(raiseTo) || raiseTo <= state.currentBet || raiseTo > legal.maxRaiseTo || (raiseTo < legal.minRaiseTo && raiseTo !== legal.maxRaiseTo))
        throw new EngineError('INVALID_AMOUNT', `raise must be between ${legal.minRaiseTo} and ${legal.maxRaiseTo}`)
      amount = commit(state, p, raiseTo - p.betThisStreet)
      raise(state, p, raiseTo)
      break
    }
    case 'allIn': {
      const total = p.betThisStreet + p.stack
      amount = commit(state, p, p.stack)
      if (total > state.currentBet) {
        if (state.currentBet === 0) openBet(state, p, total)
        else raise(state, p, total)
      } else p.hasActed = true
      break
    }
    default:
      throw new EngineError('ILLEGAL_ACTION', `${action.kind} is not a holdem action`)
  }
  events.push({ type: 'PLAYER_ACTED', seat, action, amount, stack: p.stack, allIn: p.allIn, timedOut })
  if (amount > 0) events.push({ type: 'POT_UPDATED', pot: state.pot })
  advance(state, events, seat)
}

/** First bet of a street. A bet below the minimum (short all-in) does not reopen raising for players who already acted. */
function openBet(state: HandState, p: HandPlayer, total: number): void {
  const full = total >= state.minRaise
  state.currentBet = total
  p.hasActed = true
  if (full) state.minRaise = total
  for (const o of state.players) {
    if (o === p) continue
    if (full) o.cannotRaise = false
    else if (o.hasActed) o.cannotRaise = true
    o.hasActed = false
  }
}

function raise(state: HandState, p: HandPlayer, raiseTo: number): void {
  const increment = raiseTo - state.currentBet
  const full = increment >= state.minRaise
  state.currentBet = raiseTo
  p.hasActed = true
  if (full) state.minRaise = increment
  for (const o of state.players) {
    if (o === p) continue
    if (full) o.cannotRaise = false
    else if (o.hasActed) o.cannotRaise = true
    o.hasActed = false
  }
}

function setTurn(state: HandState, events: GameEvent[], seat: number): void {
  state.actingSeat = seat
  state.turnSeq += 1
  events.push({ type: 'TURN_CHANGED', seat, turnSeq: state.turnSeq, legal: holdemLegalActions(state, seat) })
}

/** Called after every action: next actor, next street, run-out, or settlement. */
function advance(state: HandState, events: GameEvent[], fromSeat: number): void {
  if (unfolded(state).length === 1) {
    settle(state, events, { showdown: false, feeCap: feeCap(state) })
    return
  }
  const next = seatsClockwiseFrom(state, fromSeat).find((p) => needsAction(state, p))
  if (next) {
    setTurn(state, events, next.seat)
    return
  }
  const nextStreet = NEXT_STREET[state.street]
  if (nextStreet === null) {
    settle(state, events, { showdown: true, feeCap: feeCap(state) })
    return
  }
  const remaining: Street[] = []
  for (let s: Street | null = nextStreet; s !== null; s = NEXT_STREET[s]) remaining.push(s)
  if (state.players.filter(canAct).length <= 1) {
    state.phase = 'REVEAL'
    state.actingSeat = null
    state.revealQueue = remaining
    return
  }
  for (const p of state.players) {
    p.betThisStreet = 0
    p.hasActed = false
    p.cannotRaise = false
  }
  state.currentBet = 0
  state.minRaise = rulesOf(state).bigBlind
  state.revealQueue = [nextStreet]
  revealNext(state, events)
  const first = seatsClockwiseFrom(state, state.button).find(canAct)!
  setTurn(state, events, first.seat)
}
