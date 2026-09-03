import type { Rng } from '../cards/rng.js'
import { clockwiseFrom } from '../betting/pots.js'
import { applyBlindCommand, blindLegalActions, createBlindHand } from './blind.js'
import { applyHoldemCommand, createHoldemHand, holdemLegalActions } from './holdem.js'
import { EngineError, type EngineResult, type HandCommand, type HandState, type LegalActions, type Ruleset, type SeatInput } from './types.js'

export interface CreateHandInput {
  handId: string
  rules: Ruleset
  seats: SeatInput[]
  button: number
  carryOverIn?: number
}

export function createHand(input: CreateHandInput, rng: Rng): EngineResult {
  if (input.rules.mode === 'holdem') return createHoldemHand({ handId: input.handId, rules: input.rules, seats: input.seats, button: input.button }, rng)
  return createBlindHand({ handId: input.handId, rules: input.rules, seats: input.seats, button: input.button, carryOverIn: input.carryOverIn ?? 0 }, rng)
}

export function applyCommand(state: HandState, cmd: HandCommand, rng: Rng): EngineResult {
  return state.rules.mode === 'holdem' ? applyHoldemCommand(state, cmd, rng) : applyBlindCommand(state, cmd, rng)
}

export function legalActions(state: HandState, seat: number): LegalActions {
  return state.rules.mode === 'holdem' ? holdemLegalActions(state, seat) : blindLegalActions(state, seat)
}

/** Dealer button rotation: random among active seats for the first hand, then the next active seat clockwise. */
export function nextButton(prevButton: number | null, activeSeats: readonly number[], rng: Rng): number {
  if (activeSeats.length === 0) throw new EngineError('INVALID_SETUP', 'no active seats')
  const sorted = [...activeSeats].sort((a, b) => a - b)
  if (prevButton === null) return sorted[rng.int(sorted.length)]!
  return clockwiseFrom(sorted, prevButton)[0]!
}
