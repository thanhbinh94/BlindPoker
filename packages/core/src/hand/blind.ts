import { createDeck } from '../cards/cards.js'
import type { Rng } from '../cards/rng.js'
import { shuffle } from '../cards/shuffle.js'
import { carryOverAll, clone, commit, dealCards, getPlayer, revealNext, seatsClockwiseFrom, settle } from './common.js'
import {
  EngineError,
  type BlindRules, type EngineResult, type GameEvent, type HandCommand, type HandState, type LegalActions, type PlayerAction, type SeatInput,
} from './types.js'

export interface CreateBlindInput {
  handId: string
  rules: BlindRules
  seats: SeatInput[]
  button: number
  carryOverIn: number
}

export function blindRequiredStack(rules: BlindRules): number {
  return rules.decisionMode === 'playOrFold' ? rules.fixedWager * 2 : rules.fixedWager
}

const rulesOf = (state: HandState): BlindRules => {
  if (state.rules.mode !== 'blind') throw new EngineError('INVALID_COMMAND', 'not a blind hand')
  return state.rules
}

export function createBlindHand(input: CreateBlindInput, rng: Rng): EngineResult {
  const seats = [...input.seats].sort((a, b) => a.seat - b.seat)
  const required = blindRequiredStack(input.rules)
  if (seats.length < 2) throw new EngineError('INVALID_SETUP', 'need at least 2 players')
  if (seats.some((s) => s.stack < required)) throw new EngineError('INVALID_SETUP', `every player needs at least ${required}`)
  if (!seats.some((s) => s.seat === input.button)) throw new EngineError('INVALID_SETUP', 'button must be a seated player')
  if (input.carryOverIn < 0) throw new EngineError('INVALID_SETUP', 'carryOverIn must be >= 0')

  const state: HandState = {
    handId: input.handId,
    rules: input.rules,
    phase: input.rules.decisionMode === 'playOrFold' ? 'DECISION' : 'REVEAL',
    players: seats.map((s) => ({
      seat: s.seat, playerId: s.playerId, isBot: s.isBot, stack: s.stack, holeCards: [], betThisStreet: 0,
      totalCommitted: 0, folded: false, allIn: false, hasActed: false, cannotRaise: false, decision: null,
    })),
    deck: shuffle(createDeck(), rng),
    deckIndex: 0,
    community: [],
    button: input.button,
    street: 'PREFLOP',
    actingSeat: null,
    turnSeq: 0,
    currentBet: 0,
    minRaise: 0,
    pot: input.carryOverIn,
    carryOverIn: input.carryOverIn,
    revealQueue: ['FLOP', 'TURN', 'RIVER'],
    result: null,
  }
  const events: GameEvent[] = [
    { type: 'HAND_STARTED', handId: state.handId, mode: 'blind', button: state.button, seats: state.players.map((p) => p.seat), carryOverIn: input.carryOverIn },
  ]
  const posts = state.players.map((p) => ({ seat: p.seat, amount: commit(state, p, input.rules.fixedWager), kind: 'ANTE' as const }))
  events.push({ type: 'BLINDS_POSTED', posts })
  events.push({ type: 'POT_UPDATED', pot: state.pot })

  const order = seatsClockwiseFrom(state, state.button)
  for (let round = 0; round < input.rules.holeCards; round++) for (const p of order) p.holeCards.push(...dealCards(state, 1))
  for (const p of state.players) events.push({ type: 'CARDS_DEALT', seat: p.seat, cards: p.holeCards.slice() })

  if (state.phase === 'DECISION') {
    state.turnSeq += 1
    events.push({ type: 'DECISION_PHASE', seats: state.players.map((p) => p.seat), turnSeq: state.turnSeq })
  }
  return { state, events }
}

export function blindLegalActions(state: HandState, seat: number): LegalActions {
  const p = getPlayer(state, seat)
  const none: LegalActions = { seat, kinds: [], callAmount: 0, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 }
  if (state.phase !== 'DECISION' || p.decision !== null) return none
  return { ...none, kinds: ['play', 'fold'], callAmount: rulesOf(state).fixedWager }
}

export function applyBlindCommand(input: HandState, cmd: HandCommand, _rng: Rng): EngineResult {
  const state = clone(input)
  const events: GameEvent[] = []
  if (state.phase === 'COMPLETE') throw new EngineError('HAND_COMPLETE')
  switch (cmd.type) {
    case 'ADVANCE': {
      if (state.phase !== 'REVEAL') throw new EngineError('INVALID_COMMAND', 'ADVANCE only during REVEAL')
      revealNext(state, events)
      if (state.revealQueue.length === 0) settle(state, events, { showdown: true })
      return { state, events }
    }
    case 'TIMEOUT': {
      decide(state, events, cmd.seat, { kind: 'fold' }, true)
      return { state, events }
    }
    case 'ACTION': {
      decide(state, events, cmd.seat, cmd.action, false)
      return { state, events }
    }
  }
}

function decide(state: HandState, events: GameEvent[], seat: number, action: PlayerAction, timedOut: boolean): void {
  const p = getPlayer(state, seat)
  const legal = blindLegalActions(state, seat)
  if (legal.kinds.length === 0) throw new EngineError('NOT_YOUR_TURN', `seat ${seat} has nothing to decide`)
  if (!legal.kinds.includes(action.kind)) throw new EngineError('ILLEGAL_ACTION', `${action.kind} is not legal in blind poker`)
  let amount = 0
  if (action.kind === 'play') {
    amount = commit(state, p, rulesOf(state).fixedWager)
    p.decision = 'play'
  } else {
    p.decision = 'fold'
  }
  p.hasActed = true
  events.push({ type: 'PLAYER_ACTED', seat, action, amount, stack: p.stack, allIn: p.allIn, timedOut })
  events.push({ type: 'DECISION_MADE', seat })
  if (amount > 0) events.push({ type: 'POT_UPDATED', pot: state.pot })

  if (state.players.some((x) => x.decision === null)) return

  for (const x of state.players) if (x.decision === 'fold') x.folded = true
  events.push({ type: 'DECISIONS_REVEALED', decisions: state.players.map((x) => ({ seat: x.seat, decision: x.decision! })) })
  const playing = state.players.filter((x) => !x.folded).length
  if (playing === 0) carryOverAll(state, events)
  else if (playing === 1) settle(state, events, { showdown: false })
  else state.phase = 'REVEAL'
}
