import type { Card } from '../cards/cards.js'
import { computePots, distributePots, tableFee } from '../betting/pots.js'
import { evaluate } from '../evaluator/evaluator.js'
import { EngineError, type GameEvent, type HandPlayer, type HandState, type ShowdownHand, type Street } from './types.js'

export function clone<T>(s: T): T {
  return structuredClone(s)
}

export function getPlayer(state: HandState, seat: number): HandPlayer {
  const p = state.players.find((x) => x.seat === seat)
  if (!p) throw new EngineError('NOT_IN_HAND', `seat ${seat} is not in this hand`)
  return p
}

export const canAct = (p: HandPlayer): boolean => !p.folded && !p.allIn

export const unfolded = (state: HandState): HandPlayer[] => state.players.filter((p) => !p.folded)

/** Players in clockwise order starting with the first seat strictly after `afterSeat`. */
export function seatsClockwiseFrom(state: HandState, afterSeat: number): HandPlayer[] {
  const idx = state.players.findIndex((p) => p.seat > afterSeat)
  if (idx < 0) return state.players.slice()
  return [...state.players.slice(idx), ...state.players.slice(0, idx)]
}

export function commit(state: HandState, p: HandPlayer, amount: number): number {
  const actual = Math.min(amount, p.stack)
  p.stack -= actual
  p.betThisStreet += actual
  p.totalCommitted += actual
  state.pot += actual
  if (p.stack === 0) p.allIn = true
  return actual
}

export function dealCards(state: HandState, n: number): Card[] {
  const cards = state.deck.slice(state.deckIndex, state.deckIndex + n)
  if (cards.length !== n) throw new EngineError('INVALID_SETUP', 'deck exhausted')
  state.deckIndex += n
  return cards
}

const STREET_CARDS: Record<Street, number> = { PREFLOP: 0, FLOP: 3, TURN: 1, RIVER: 1 }

export function revealNext(state: HandState, events: GameEvent[]): void {
  const street = state.revealQueue.shift()
  if (!street) throw new EngineError('INVALID_COMMAND', 'nothing to reveal')
  const cards = dealCards(state, STREET_CARDS[street])
  state.community.push(...cards)
  state.street = street
  events.push({ type: 'COMMUNITY_REVEALED', street, cards, community: state.community.slice() })
}

/**
 * Gives back the part of a bet nobody could call: if exactly one player committed more than everyone else, the
 * excess goes straight back to their stack before pots and the fee are computed. Returns what was given back.
 */
export function returnUncalled(state: HandState): { seat: number; amount: number } | null {
  let max = 0
  let second = 0
  for (const p of state.players) {
    if (p.totalCommitted > max) {
      second = max
      max = p.totalCommitted
    } else if (p.totalCommitted > second) second = p.totalCommitted
  }
  if (max <= second) return null
  const holders = state.players.filter((p) => p.totalCommitted === max)
  if (holders.length !== 1) return null
  const p = holders[0]!
  const amount = max - second
  p.totalCommitted -= amount
  p.betThisStreet = Math.max(0, p.betThisStreet - amount)
  p.stack += amount
  state.pot -= amount
  if (p.stack > 0) p.allIn = false
  return { seat: p.seat, amount }
}

export function settle(state: HandState, events: GameEvent[], opts: { showdown: boolean; feeCap?: number }): void {
  const uncalledReturned = returnUncalled(state)
  const pots = computePots(state.players.map((p) => ({ seat: p.seat, totalCommitted: p.totalCommitted, folded: p.folded })))
  if (pots.length === 0) throw new EngineError('INVALID_SETUP', 'no pot to settle')
  pots[0]!.amount += state.carryOverIn

  const total = pots.reduce((a, p) => a + p.amount, 0)
  const fee = Math.min(tableFee(total, state.rules.tableFeeRate, opts.feeCap), pots[0]!.amount)
  pots[0]!.amount -= fee

  const live = unfolded(state)
  const rankBySeat = new Map<number, number>()
  let showdown: ShowdownHand[] | null = null
  if (opts.showdown && live.length > 1) {
    showdown = live.map((p) => {
      const cards = [...p.holeCards, ...state.community]
      const ev = evaluate(cards)
      rankBySeat.set(p.seat, ev.rank)
      return { seat: p.seat, cards: p.holeCards.slice(), rank: ev.rank, category: ev.category, best: ev.best }
    })
  } else {
    for (const p of live) rankBySeat.set(p.seat, 1)
  }

  const results = distributePots(pots.filter((p) => p.amount > 0), rankBySeat, state.players.map((p) => p.seat), state.button)
  const payoutBySeat = new Map<number, number>()
  for (const r of results) for (const w of r.winners) payoutBySeat.set(w.seat, (payoutBySeat.get(w.seat) ?? 0) + w.amount)
  for (const [seat, amount] of payoutBySeat) getPlayer(state, seat).stack += amount

  const payouts = [...payoutBySeat].map(([seat, amount]) => ({ seat, amount })).sort((a, b) => a.seat - b.seat)
  const stacks = state.players.map((p) => ({ seat: p.seat, stack: p.stack }))
  state.result = { pots: results, fee, payouts, stacks, showdown, carryOverOut: 0, uncalledReturned }
  state.phase = 'COMPLETE'
  state.actingSeat = null
  if (showdown) events.push({ type: 'SHOWDOWN', hands: showdown })
  events.push({ type: 'SETTLEMENT', payouts, fee, pots: results, carryOverOut: 0, stacks, uncalledReturned })
  events.push({ type: 'HAND_COMPLETE' })
}

export function carryOverAll(state: HandState, events: GameEvent[]): void {
  const stacks = state.players.map((p) => ({ seat: p.seat, stack: p.stack }))
  state.result = { pots: [], fee: 0, payouts: [], stacks, showdown: null, carryOverOut: state.pot, uncalledReturned: null }
  state.phase = 'COMPLETE'
  state.actingSeat = null
  events.push({ type: 'SETTLEMENT', payouts: [], fee: 0, pots: [], carryOverOut: state.pot, stacks, uncalledReturned: null })
  events.push({ type: 'HAND_COMPLETE' })
}
