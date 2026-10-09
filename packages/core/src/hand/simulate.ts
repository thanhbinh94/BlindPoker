import type { Rng } from '../cards/rng.js'
import { applyCommand, createHand, legalActions, type CreateHandInput } from './engine.js'
import type { GameEvent, HandState, LegalActions, PlayerAction } from './types.js'
import { playerView, type HandView } from './view.js'

export type Policy = (view: HandView, legal: LegalActions, rng: Rng) => PlayerAction

const between = (rng: Rng, lo: number, hi: number) => lo + rng.int(hi - lo + 1)

/** Uniformly random legal action; bet/raise amounts uniform in their valid range. */
export const randomPolicy: Policy = (_view, legal, rng) => {
  const kind = legal.kinds[rng.int(legal.kinds.length)]!
  if (kind === 'bet') return { kind, amount: between(rng, legal.minBet, legal.maxBet) }
  if (kind === 'raise') return { kind, amount: between(rng, legal.minRaiseTo, legal.maxRaiseTo) }
  return { kind }
}

/** Plays one full hand with the given policy for every seat; enforces the money invariant. */
export function simulateHand(input: CreateHandInput, policy: Policy, rng: Rng): { state: HandState; events: GameEvent[] } {
  const startTotal = input.seats.reduce((a, s) => a + s.stack, 0) + (input.carryOverIn ?? 0)
  let { state, events } = createHand(input, rng)
  const all = [...events]
  let guard = 0
  while (state.phase !== 'COMPLETE') {
    if (++guard > 10_000) throw new Error('simulateHand: hand did not finish')
    if (state.phase === 'REVEAL') {
      ;({ state, events } = applyCommand(state, { type: 'ADVANCE' }, rng))
    } else if (state.phase === 'SQUEEZE') {
      const seat = state.players.find((p) => !p.revealed)!.seat
      ;({ state, events } = applyCommand(state, { type: 'REVEALED', seat }, rng))
    } else if (state.phase === 'DECISION') {
      const seat = state.players.find((p) => p.decision === null)!.seat
      const action = policy(playerView(state, seat), legalActions(state, seat), rng)
      ;({ state, events } = applyCommand(state, { type: 'ACTION', seat, action }, rng))
    } else {
      const seat = state.actingSeat
      if (seat === null) throw new Error('simulateHand: BETTING with no acting seat')
      const action = policy(playerView(state, seat), legalActions(state, seat), rng)
      ;({ state, events } = applyCommand(state, { type: 'ACTION', seat, action }, rng))
    }
    all.push(...events)
  }
  const r = state.result!
  const endTotal = state.players.reduce((a, p) => a + p.stack, 0) + r.fee + r.carryOverOut
  if (endTotal !== startTotal) throw new Error(`money invariant broken: start ${startTotal} end ${endTotal}`)
  return { state, events: all }
}
