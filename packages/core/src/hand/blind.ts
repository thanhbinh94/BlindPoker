import { createDeck } from '../cards/cards.js'
import type { Rng } from '../cards/rng.js'
import { shuffle } from '../cards/shuffle.js'
import { applyDealEffects, applyRevealEffects, chaosSettleHooks, emitPeeks, initialChaosState, isBlindfolded, refundFreeFolds } from '../chaos/engine.js'
import type { ChaosHandPlan } from '../chaos/types.js'
import { ECONOMY } from '../constants/economy.js'
import { cancelHand, carryOverAll, clone, commit, dealCards, getPlayer, revealNext, seatsClockwiseFrom, settle } from './common.js'
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
  /** Poker hỗn loạn: the effects this hand fires (`planHand`). Absent, the hand is a plain Blind hand, event for event. */
  chaos?: ChaosHandPlan
}

/**
 * The most a Blind seat brings to the table: ten wagers (spec 2026-09-29; five until BP-31). A player with less sits
 * down with all of it; a seat plays down to its last point and is stood up at 0 (Plan 27). Takes only the field it
 * reads, so a client can ask it of the room config it was sent.
 */
export function blindTableLimit(rules: Pick<BlindRules, 'fixedWager'>): number {
  return rules.fixedWager * ECONOMY.blindTableLimitMultiplier
}

/**
 * The most a seat may sit down with (BP-39): the table limit at a plain Blind table, `null` (no cap — the whole balance
 * may go on the table) at a chaos table.
 */
export function blindBuyInCap(rules: Pick<BlindRules, 'fixedWager' | 'chaosCycle'>): number | null {
  return rules.chaosCycle === undefined ? blindTableLimit(rules) : null
}

const rulesOf = (state: HandState): BlindRules => {
  if (state.rules.mode !== 'blind') throw new EngineError('INVALID_COMMAND', 'not a blind hand')
  return state.rules
}

export function createBlindHand(input: CreateBlindInput, rng: Rng): EngineResult {
  const seats = [...input.seats].sort((a, b) => a.seat - b.seat)
  if (seats.length < 2) throw new EngineError('INVALID_SETUP', 'need at least 2 players')
  // A seat short of a wager is dealt and antes all it has (plan 27 D1): `commit` caps at the stack and sets allIn.
  if (seats.some((s) => s.stack <= 0)) throw new EngineError('INVALID_SETUP', 'every player needs points left')
  if (!seats.some((s) => s.seat === input.button)) throw new EngineError('INVALID_SETUP', 'button must be a seated player')
  if (input.carryOverIn < 0) throw new EngineError('INVALID_SETUP', 'carryOverIn must be >= 0')

  const squeeze = input.rules.squeeze === true
  const state: HandState = {
    handId: input.handId,
    rules: input.rules,
    phase: input.rules.decisionMode === 'playOrFold' ? 'DECISION' : squeeze ? 'SQUEEZE' : 'REVEAL',
    players: seats.map((s) => ({
      seat: s.seat, playerId: s.playerId, isBot: s.isBot, stack: s.stack, holeCards: [], betThisStreet: 0,
      totalCommitted: 0, folded: false, allIn: false, hasActed: false, cannotRaise: false, decision: null, timedOut: false,
      // Squeeze mode waits only on humans: a bot has nothing to turn by hand (spec 2026-10-08 §4.2.3).
      // A blindfolded seat (Poker hỗn loạn) has nothing to turn either: its cards open at the showdown.
      revealed: !squeeze || s.isBot || isBlindfolded(input.chaos, s.seat),
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
  if (input.chaos) state.chaos = initialChaosState(input.chaos)
  const events: GameEvent[] = [
    { type: 'HAND_STARTED', handId: state.handId, mode: 'blind', button: state.button, seats: state.players.map((p) => p.seat), carryOverIn: input.carryOverIn },
  ]
  const posts = state.players.map((p) => ({ seat: p.seat, amount: commit(state, p, input.rules.fixedWager), kind: 'ANTE' as const }))
  events.push({ type: 'BLINDS_POSTED', posts })
  events.push({ type: 'POT_UPDATED', pot: state.pot })

  const order = seatsClockwiseFrom(state, state.button)
  for (let round = 0; round < input.rules.holeCards; round++) for (const p of order) p.holeCards.push(...dealCards(state, 1))
  applyDealEffects(state, events)
  // A blindfolded seat is dealt face down even to itself.
  for (const p of state.players) events.push({ type: 'CARDS_DEALT', seat: p.seat, cards: isBlindfolded(input.chaos, p.seat) ? [] : p.holeCards.slice(), cardCount: p.holeCards.length })

  if (state.phase === 'DECISION') {
    state.turnSeq += 1
    events.push({ type: 'DECISION_PHASE', seats: state.players.map((p) => p.seat), turnSeq: state.turnSeq })
    emitPeeks(state, events)
    autoPlayAllIn(state, events)
  } else if (state.phase === 'SQUEEZE') {
    state.turnSeq += 1
    events.push({ type: 'SQUEEZE_PHASE', seats: state.players.filter((p) => !p.revealed).map((p) => p.seat), turnSeq: state.turnSeq })
    endSqueezeIfDone(state, events) // a table of bots has nobody to wait for
  }
  return { state, events }
}

export function blindLegalActions(state: HandState, seat: number): LegalActions {
  const p = getPlayer(state, seat)
  const none: LegalActions = { seat, kinds: [], callAmount: 0, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 }
  if (state.phase !== 'DECISION' || p.decision !== null || p.allIn) return none
  // A seat short of the wager plays all in for what it has: `resolveDecisions` commits through `commit`, which caps.
  return { ...none, kinds: ['play', 'fold'], callAmount: Math.min(p.stack, rulesOf(state).fixedWager) }
}

/**
 * Play-or-fold, as the decision round opens: a seat the ante emptied has nothing left to put in, and folding would
 * only throw its ante away, so it is never asked (spec plan 27 R14). It is decided `play` on the spot — a bare
 * `DECISION_MADE`, as for any seat — and its `PLAYER_ACTED` (amount 0, all in, not timed out) comes with everyone
 * else's when the round resolves. On a squeeze table it is never asked to turn; its cards open with the reveal. If
 * every seat was emptied, the round resolves here and then.
 */
function autoPlayAllIn(state: HandState, events: GameEvent[]): void {
  for (const p of state.players) {
    if (!p.allIn || p.decision !== null) continue
    p.decision = 'play'
    p.timedOut = false
    p.hasActed = true
    events.push({ type: 'DECISION_MADE', seat: p.seat })
  }
  if (state.players.some((x) => x.decision === null)) return
  resolveDecisions(state, events)
}

export function applyBlindCommand(input: HandState, cmd: HandCommand, rng: Rng): EngineResult {
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
      if (state.revealQueue.length === 0) {
        applyRevealEffects(state, events, rng)
        settle(state, events, { showdown: true, hooks: chaosSettleHooks(state) })
      }
      return { state, events }
    }
    case 'TIMEOUT': {
      // A table-wide timer may fire for seats that already decided: treat those as a no-op so timers stay idempotent.
      const p = getPlayer(state, cmd.seat)
      if (state.phase !== 'DECISION' || p.decision !== null) return { state, events }
      decide(state, events, cmd.seat, { kind: 'fold' }, true)
      return { state, events }
    }
    case 'REVEALED': {
      reveal(state, events, cmd.seat)
      return { state, events }
    }
    case 'ACTION': {
      decide(state, events, cmd.seat, cmd.action)
      return { state, events }
    }
  }
}

/**
 * Records one seat's hidden decision. Nothing but `DECISION_MADE{seat}` is emitted and no chips move while the
 * phase is still `DECISION`: stacks, `totalCommitted` and the pot would otherwise reveal who played. `timedOut` (the
 * `TIMEOUT` command, which folds the seat) is kept on the seat and told with its `PLAYER_ACTED` once every seat has
 * decided — the room counts those towards the three that stand a player up (spec §8.7), exactly as in Hold'em.
 */
function decide(state: HandState, events: GameEvent[], seat: number, action: PlayerAction, timedOut = false): void {
  const p = getPlayer(state, seat)
  const legal = blindLegalActions(state, seat)
  if (legal.kinds.length === 0) throw new EngineError('NOT_YOUR_TURN', `seat ${seat} has nothing to decide`)
  if (!legal.kinds.includes(action.kind)) throw new EngineError('ILLEGAL_ACTION', `${action.kind} is not legal in blind poker`)
  // In a squeeze room a decision shows the cards it was made on: the seat counts as turned from here (§4.2.4).
  if (rulesOf(state).squeeze === true && !p.revealed) {
    p.revealed = true
    events.push({ type: 'PLAYER_REVEALED', seat })
  }
  p.decision = action.kind === 'play' ? 'play' : 'fold'
  p.timedOut = timedOut
  p.hasActed = true
  events.push({ type: 'DECISION_MADE', seat })

  if (state.players.some((x) => x.decision === null)) return
  resolveDecisions(state, events)
}

/**
 * Squeeze mode: `seat` has turned its cards over (by hand, by its "Lật" button, or by the server when the round ran
 * out). Outside squeezing — a plain table, another phase, a seat that had turned already — it is nothing, not an
 * error: a client that sends it late or twice is doing no harm (spec 2026-10-08 §6).
 */
function reveal(state: HandState, events: GameEvent[], seat: number): void {
  const p = getPlayer(state, seat)
  const squeezing = state.phase === 'SQUEEZE' || (state.phase === 'DECISION' && rulesOf(state).squeeze === true)
  if (!squeezing || p.revealed) return
  p.revealed = true
  events.push({ type: 'PLAYER_REVEALED', seat })
  if (state.phase === 'SQUEEZE') endSqueezeIfDone(state, events)
}

/** The squeeze round is over once every seat has turned: on to the community cards, as a pure-luck hand goes. */
function endSqueezeIfDone(state: HandState, events: GameEvent[]): void {
  if (state.phase !== 'SQUEEZE' || state.players.some((p) => !p.revealed)) return
  events.push({ type: 'SQUEEZE_ENDED' })
  state.phase = 'REVEAL'
}

/**
 * A folded seat's ante above everything a live seat put in is money nobody still in the hand matched: it goes back
 * to the folder (spec plan 27 D2, "người tất tay ít chỉ ăn pot chính phần mình"). Without this, `computePots` hands
 * a pot no live seat reached to the live seats, so a short all-in seat whose every coverer folded won the folders'
 * whole antes. One folder alone above the rest is left to `settle`'s `returnUncalled`, which hands back exactly the
 * same and tells it in `SETTLEMENT.uncalledReturned`, so a heads-up hand reads as it always has. Nothing to do when
 * every seat folded: the pot carries over whole.
 */
function returnDeadExcess(state: HandState): void {
  const live = state.players.filter((p) => !p.folded)
  if (live.length === 0) return
  const maxLive = Math.max(...live.map((p) => p.totalCommitted))
  const dead = state.players.filter((p) => p.folded && p.totalCommitted > maxLive)
  if (dead.length < 2) return
  for (const p of dead) {
    const amount = p.totalCommitted - maxLive
    p.totalCommitted -= amount
    p.betThisStreet = Math.max(0, p.betThisStreet - amount)
    p.stack += amount
    state.pot -= amount
    if (p.stack > 0) p.allIn = false
  }
}

/**
 * All seats have decided: apply the wagers in seat order, hand a dead excess back to its folders, reveal, then branch
 * on how many are still playing. The `PLAYER_ACTED`s are told after the refund, so a folder's stack and the
 * `POT_UPDATED` that follows already agree with it; no chips move after this in a Blind hand, so both `settle` paths
 * (here, and the `ADVANCE` that ends the reveal) see the refunded pots.
 */
function resolveDecisions(state: HandState, events: GameEvent[]): void {
  const wager = rulesOf(state).fixedWager
  const played = new Map<number, number>()
  for (const x of state.players) {
    if (x.decision === 'play') played.set(x.seat, commit(state, x, wager))
    else x.folded = true
  }
  const freeFolds = refundFreeFolds(state) // "Bỏ không mất" takes its ante back before the dead excess is worked out
  returnDeadExcess(state)
  for (const x of state.players) {
    const amount = played.get(x.seat)
    const action = amount === undefined ? { kind: 'fold' as const } : { kind: 'play' as const }
    events.push({ type: 'PLAYER_ACTED', seat: x.seat, action, amount: amount ?? 0, stack: x.stack, allIn: x.allIn, timedOut: x.timedOut })
  }
  events.push({ type: 'POT_UPDATED', pot: state.pot })
  events.push({ type: 'DECISIONS_REVEALED', decisions: state.players.map((x) => ({ seat: x.seat, decision: x.decision! })) })
  events.push(...freeFolds)
  const playing = state.players.filter((x) => !x.folded).length
  const hooks = chaosSettleHooks(state)
  if (playing === 0) carryOverAll(state, events, hooks)
  else if (playing === 1) settle(state, events, { showdown: false, hooks })
  else state.phase = 'REVEAL'
}
