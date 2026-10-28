import type { Card } from '../cards/cards.js'
import { computePots, distributePots, tableFee, type Pot } from '../betting/pots.js'
import { deadMoneyOf } from '../chaos/engine-stake.js'
import { evaluate, type HandEvaluation } from '../evaluator/evaluator.js'
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
  // BP-41 Lá chung thứ sáu: on a chaos hand that set it, the river deals two cards.
  const cards = dealCards(state, STREET_CARDS[street] + (street === 'RIVER' && state.chaos?.sixthBoard ? 1 : 0))
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

/**
 * What a chaos hand changes in the settlement (Poker hỗn loạn; built by `chaos/engine.ts`, absent for a plain hand):
 * a borrowed card a seat ranks with, the reversed ranking, a step after the ranks are known and before the pots are
 * paid (insurance, which may move points from `pots` to stacks — its events follow `SHOWDOWN`), and events told just
 * before `SETTLEMENT` (the summary). `evaluateSeat` (BP-41 A9) ranks a seat's cards in place of `evaluate`: more than
 * ten cards (a sixth board card, extra hole cards) and Lá ma's wild card; the plain evaluator is never changed.
 */
export interface SettleHooks {
  reverse: boolean
  borrowed(seat: number): Card | null
  evaluateSeat?(seat: number, cards: readonly Card[]): HandEvaluation & { wild?: { card: Card; as: Card } }
  beforePayout(pots: Pot[], winners: ReadonlySet<number>): GameEvent[]
  beforeSettlement(): GameEvent[]
}

export function settle(state: HandState, events: GameEvent[], opts: { showdown: boolean; feeCap?: number; hooks?: SettleHooks }): void {
  const hooks = opts.hooks
  const uncalledReturned = returnUncalled(state)
  const pots = computePots(state.players.map((p) => ({ seat: p.seat, totalCommitted: p.totalCommitted, folded: p.folded })))
  if (pots.length === 0) {
    // Only a chaos hand gets here: every folder took its ante back ("Bỏ không mất") and the lone player's own points went
    // back to it as uncalled, so all that is left to win is what carried in.
    if (!hooks) throw new EngineError('INVALID_SETUP', 'no pot to settle')
    pots.push({ amount: 0, eligibleSeats: unfolded(state).map((p) => p.seat) })
  }
  // BP-41 A1: a stake card's dead money goes with what carried in, to whoever wins the main pot.
  pots[0]!.amount += state.carryOverIn + deadMoneyOf(state)

  const total = pots.reduce((a, p) => a + p.amount, 0)
  const fee = Math.min(tableFee(total, state.rules.tableFeeRate, opts.feeCap), pots[0]!.amount)
  pots[0]!.amount -= fee

  const live = unfolded(state)
  const rankBySeat = new Map<number, number>()
  let showdown: ShowdownHand[] | null = null
  if (opts.showdown && live.length > 1) {
    showdown = live.map((p) => {
      const borrowed = hooks?.borrowed(p.seat) ?? null
      const cards = borrowed === null ? [...p.holeCards, ...state.community] : [...p.holeCards, ...state.community, borrowed]
      const ev: HandEvaluation & { wild?: { card: Card; as: Card } } = hooks?.evaluateSeat ? hooks.evaluateSeat(p.seat, cards) : evaluate(cards)
      // "Thế giới đảo ngược": the weakest hand wins every pot it is in; the shown ranks stay the real ones.
      rankBySeat.set(p.seat, hooks?.reverse ? -ev.rank : ev.rank)
      const hand: ShowdownHand = { seat: p.seat, cards: p.holeCards.slice(), rank: ev.rank, category: ev.category, best: ev.best }
      if (borrowed !== null) hand.borrowed = borrowed
      if (ev.wild) hand.wild = ev.wild
      return hand
    })
  } else {
    for (const p of live) rankBySeat.set(p.seat, 1)
  }

  const seatOrder = state.players.map((p) => p.seat)
  let chaosEvents: GameEvent[] = []
  if (hooks && showdown) {
    const ranked = distributePots(pots.filter((p) => p.amount > 0), rankBySeat, seatOrder, state.button)
    chaosEvents = hooks.beforePayout(pots, new Set(ranked.flatMap((r) => r.winners.map((w) => w.seat))))
  }
  const results = distributePots(pots.filter((p) => p.amount > 0), rankBySeat, seatOrder, state.button)
  if (results.some((r) => r.winners.length === 0)) throw new EngineError('INVALID_SETUP', 'no winners for a pot')
  const payoutBySeat = new Map<number, number>()
  for (const r of results) for (const w of r.winners) payoutBySeat.set(w.seat, (payoutBySeat.get(w.seat) ?? 0) + w.amount)
  for (const [seat, amount] of payoutBySeat) getPlayer(state, seat).stack += amount

  const payouts = [...payoutBySeat].map(([seat, amount]) => ({ seat, amount })).sort((a, b) => a.seat - b.seat)
  const stacks = state.players.map((p) => ({ seat: p.seat, stack: p.stack }))
  state.result = { pots: results, fee, payouts, stacks, showdown, carryOverOut: 0, uncalledReturned }
  state.phase = 'COMPLETE'
  state.actingSeat = null
  if (showdown) events.push({ type: 'SHOWDOWN', hands: showdown })
  if (hooks) events.push(...chaosEvents, ...hooks.beforeSettlement())
  events.push({ type: 'SETTLEMENT', payouts, fee, pots: results, carryOverOut: 0, stacks, uncalledReturned })
  events.push({ type: 'HAND_COMPLETE' })
}

/**
 * Aborts the hand: every chip committed this hand goes back to its owner and anything carried in stays carried out,
 * so no money is created or destroyed and no fee is charged. A stake card's dead money (BP-41 A1) goes back with it.
 */
export function cancelHand(state: HandState, events: GameEvent[], reason: string): void {
  const refunds: { seat: number; amount: number }[] = []
  for (const p of state.players) {
    const back = p.totalCommitted + (state.chaos?.deadMoney?.find((d) => d.seat === p.seat)?.amount ?? 0)
    if (back > 0) {
      p.stack += back
      refunds.push({ seat: p.seat, amount: back })
    }
    p.totalCommitted = 0
    p.betThisStreet = 0
    p.allIn = false
  }
  if (state.chaos?.deadMoney) delete state.chaos.deadMoney
  const carryOverOut = state.carryOverIn
  state.pot = 0
  const stacks = state.players.map((p) => ({ seat: p.seat, stack: p.stack }))
  state.result = { pots: [], fee: 0, payouts: [], stacks, showdown: null, carryOverOut, uncalledReturned: null }
  state.phase = 'COMPLETE'
  state.actingSeat = null
  events.push({ type: 'HAND_CANCELLED', reason, refunds, carryOverOut })
  events.push({ type: 'HAND_COMPLETE' })
}

export function carryOverAll(state: HandState, events: GameEvent[], hooks?: SettleHooks): void {
  const stacks = state.players.map((p) => ({ seat: p.seat, stack: p.stack }))
  state.result = { pots: [], fee: 0, payouts: [], stacks, showdown: null, carryOverOut: state.pot, uncalledReturned: null }
  state.phase = 'COMPLETE'
  state.actingSeat = null
  if (hooks) events.push(...hooks.beforeSettlement())
  events.push({ type: 'SETTLEMENT', payouts: [], fee: 0, pots: [], carryOverOut: state.pot, stacks, uncalledReturned: null })
  events.push({ type: 'HAND_COMPLETE' })
}
