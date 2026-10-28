import type { Rng } from '../cards/rng.js'
import { seatsClockwiseFrom } from '../hand/common.js'
import type { GameEvent, HandState } from '../hand/types.js'
import { addUid, blockForSeat, isImmune, markTitle, record, showdownScore } from './engine-core.js'
import { reignEffect } from './god.js'
import type { ChaosGodCurse } from './types.js'

/**
 * BP-41 §4.2 (Task 6): the engine's half of the Thần Bài — the curse at the reveal and, at the settlement, a Bán Thần
 * made and a Thần dethroned. The Aces are claimed in `dealChaosHand`, the protection is `isImmune`, the no-fold rule is
 * `plan.noFoldSeats`. Every function here does nothing on a hand whose plan has no reign, and draws from `rng` only in
 * the curses that pick at random (rút bài, tráo bài).
 */

/**
 * The Thần's curse `curse` at its place in the reveal (`applyRevealEffects`): 1 rút bài after the hand debuffs, 3 tráo bài
 * before Hoán vị định mệnh, 2 thách đấu after the cards' duels. It acts on every other seat still in, once per hand, while
 * the reign's first `curseHands` hands last (`plan.god.curse` is set) and the Thần itself is still in. It is a rule of
 * the hand, not a card's debuff (spec §4.2): it counts toward no seat's one debuff, ignores who was hit, and no Bia đỡ đạn
 * or Gậy ông moves it. A Khiên or a Gương standing on a seat only blocks it for that seat — no reflection (A16; a one-shot
 * one is spent, its own `blocked` line). Immune seats keep their cards (rút bài, tráo bài). Told as one public `carp` line
 * naming the seats it reached (`fizzled` when it reached none).
 * 1. Rút bài: each such seat with two cards or more loses one at random (never the last).
 * 2. Thách đấu (🔓): the Thần's hand against each seat's, ranked as the showdown will: the loser owes the winner
 *    `curseWagers` fixed wagers (a tie owes nothing), pushed into `ChaosHandState.duels` marked `god` and paid at the
 *    settlement after every card's duel, stack to stack (`payTransfers`); each winner joins `outcomes.duelWins`.
 * 3. Tráo bài: the hole hands of those seats are dealt round among them at random (each hand moves whole); fewer than two
 *    to move and it fizzles.
 */
export function applyGodCurse(state: HandState, events: GameEvent[], rng: Rng, curse: ChaosGodCurse): void {
  const chaos = state.chaos
  const god = chaos?.plan.god
  if (!chaos || !god || god.curse !== curse) return
  const me = state.players.find((p) => p.seat === god.seat)
  if (!me || me.folded) return
  const e = reignEffect(god)
  const others = seatsClockwiseFrom(state, god.seat).filter((p) => !p.folded && p.seat !== god.seat)
  const blocked = (seat: number): boolean => blockForSeat(chaos, events, god.seat, e, seat)
  const tell = (reached: number[], extra: { wagers?: number } = {}): void =>
    record(chaos, events, god.seat, e, reached, reached.length > 0 ? 'applied' : 'fizzled', extra)

  if (curse === 1) {
    const reached: number[] = []
    for (const p of others) {
      if (p.holeCards.length <= 1 || isImmune(chaos, p.seat) || blocked(p.seat)) continue
      p.holeCards.splice(rng.int(p.holeCards.length), 1)
      reached.push(p.seat)
    }
    tell(reached)
    return
  }

  if (curse === 2) {
    const wagers = god.params.curseWagers ?? 1
    const mine = showdownScore(state, god.seat)
    const reached: number[] = []
    for (const p of others) {
      if (blocked(p.seat)) continue
      reached.push(p.seat)
      const theirs = showdownScore(state, p.seat)
      if (mine === theirs || wagers <= 0) continue
      const [winner, payer] = mine > theirs ? [god.seat, p.seat] : [p.seat, god.seat]
      ;(chaos.duels ??= []).push({ winner, payer, wagers, cardId: god.cardId, uid: god.uid, god: true })
      const wins = chaos.outcomes?.duelWins ?? []
      addUid(wins, winner)
      chaos.outcomes = { ...chaos.outcomes, duelWins: wins }
    }
    tell(reached, { wagers })
    return
  }

  const reach = others.filter((p) => !isImmune(chaos, p.seat))
  if (reach.length < 2) {
    tell([])
    return
  }
  const moved = reach.filter((p) => !blocked(p.seat))
  if (moved.length < 2) {
    tell([])
    return
  }
  const hands = moved.map((p) => p.holeCards)
  for (let i = hands.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    const tmp = hands[i]!
    hands[i] = hands[j]!
    hands[j] = tmp
  }
  moved.forEach((p, k) => {
    p.holeCards = hands[k]!
  })
  tell(moved.map((p) => p.seat))
}

/**
 * At the settlement, once the pots are paid (`SettleHooks.afterPayout`, after the transfers), BP-41 §4.1–§4.2:
 * - each live Cá chép (`plan.carps`) whose seat won a pot makes a Bán Thần: the title mark `demigod` (A12) and a public
 *   `carp` line (`reign: 'demigod'`); the card is spent (its uid joins `applied`), and `afterHand` starts the reign;
 * - a Thần whose powers acted this hand, that did not fold and won no pot, is beaten by every seat that won one ("hạ
 *   Thần"; a split pot counts each): `outcomes.dethroned`, a `slew` mark each (A12) and a public `carp` line naming them
 *   (`reign: 'godslain'`). `afterHand` takes the throne away from the next hand and hands each slayer its Kim cương
 *   cards. Nobody won a pot (everyone folded): nobody beat it.
 * The ≥ 2 humans and the bot-Thần rules of the titles (G12) are the server's: `plan.god.isBot` and the seat kinds say.
 */
export function settleReigns(state: HandState, payoutBySeat: ReadonlyMap<number, number>): GameEvent[] {
  const chaos = state.chaos
  const events: GameEvent[] = []
  if (!chaos) return events
  const won = (seat: number): boolean => (payoutBySeat.get(seat) ?? 0) > 0
  for (const c of chaos.plan.carps ?? []) {
    if (!won(c.seat)) continue
    markTitle(chaos, c.seat, { demigod: true })
    record(chaos, events, c.seat, reignEffect({ seat: c.seat, isBot: false, cardId: c.cardId, uid: c.uid, params: {} }), [], 'applied', { reign: 'demigod' })
  }
  const god = chaos.plan.god
  const p = god ? state.players.find((x) => x.seat === god.seat) : undefined
  if (god && p && !p.folded && !won(god.seat)) {
    const slayers = state.players.filter((x) => won(x.seat)).map((x) => x.seat)
    if (slayers.length > 0) {
      chaos.outcomes = { ...chaos.outcomes, dethroned: slayers }
      for (const s of slayers) markTitle(chaos, s, { slew: 1 })
      record(chaos, events, god.seat, reignEffect(god), slayers, 'applied', { reign: 'godslain' })
    }
  }
  return events
}
