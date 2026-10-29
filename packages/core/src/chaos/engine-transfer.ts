import type { Rng } from '../cards/rng.js'
import { getPlayer, seatsClockwiseFrom } from '../hand/common.js'
import type { GameEvent, HandState } from '../hand/types.js'
import { effectOf, record, resolveDebuff } from './engine-core.js'
import type { ChaosBomb, ChaosEffectKind, ChaosTransfer, PlannedEffect } from './types.js'

/**
 * BP-41 Task 5b: the points cards move between players (spec §3 "chuyển tiền giữa người chơi": no point is created,
 * one stack pays another in the same hand, and no stack goes below 0 — a payment larger than the stack pays the stack).
 * Bom nổ chậm is planted here at the deal (`plantBombs`); everything else moves at the settlement (`payTransfers`,
 * through `SettleHooks.afterPayout`), once the pots are on the stacks. The stacks are on the table, so nothing here
 * writes the ledger: a bot's points and a human's move alike (spec §3, bots). A hand without these cards draws nothing
 * and moves nothing.
 */

/**
 * Bom nổ chậm at the deal (a debuff, spec §6.1): each holder, clockwise from the button, aims it at a random opponent not
 * hit yet, through the debuff resolver — a shield blocks it, Bia đỡ đạn hands it on, a mirror or a Gậy ông turns it
 * round so the seat it was aimed at plants it on its holder. Where it lands, it goes into `outcomes.planted`, and
 * `afterHand` puts it on the table. Its event is private to the two seats (`PRIVATE_AT_DEAL`): the table reads who
 * planted it in `CHAOS_SUMMARY`. Draws from `rng` only when a seat fires one.
 */
export function plantBombs(state: HandState, events: GameEvent[], rng: Rng): void {
  const chaos = state.chaos
  if (!chaos) return
  for (const p of seatsClockwiseFrom(state, state.button)) {
    const e = effectOf(chaos, p.seat, 'timeBomb')
    if (!e) continue
    const fresh = state.players.filter((x) => x.seat !== p.seat && !chaos.hit.includes(x.seat)).map((x) => x.seat)
    if (fresh.length === 0) {
      record(chaos, events, p.seat, e, [], 'fizzled')
      continue
    }
    const target = fresh[rng.int(fresh.length)]!
    resolveDebuff(state, events, p.seat, e, target, (victim, aimed) => {
      const [owner, carrier] = victim === p.seat ? [aimed, p.seat] : [p.seat, victim]
      if (owner === carrier) return false
      const planted = chaos.outcomes?.planted ?? []
      planted.push({ owner, carrier, fuse: e.params.fuse ?? 3, wagers: e.params.wagers ?? 1, cardId: e.cardId, uid: e.uid })
      chaos.outcomes = { ...chaos.outcomes, planted }
      return true
    }, { rng })
  }
}

/**
 * The transfers of one settled hand (BP-41 A5, Ruling 2), after the pots are paid (`payoutBySeat`), in this order:
 * 1. Duels: every Thách đấu that pays (`ChaosHandState.duels`), then every duel of the Thần's curse (`god`, Task 6) —
 *    the loser pays the winner `wagers` × the fixed wager.
 * 2. Ép chia thưởng: each holder clockwise from the button that is still in and won no pot takes `percent` % of every
 *    winner's net win, winner by winner clockwise.
 * 3. Thuế thắng: each holder clockwise takes `percent` % of the net win of every winner but itself, folded or not.
 * 4. Each Bom nổ chậm on its last hand goes off: the carrier pays the owner `wagers` × the fixed wager.
 * A seat's net win is what the hand gave it so far: its payout, minus what it put in (`totalCommitted` and the dead money
 * of a stake card), plus or minus what the steps before moved (so a second Ép chia thưởng takes half of what the first
 * left). A winner is a seat that won a pot and whose net win is still above 0 (a seat ahead only by what a card paid it
 * is none: Ép chia thưởng and Thuế thắng never take from each other's takings). Every payment is floored to a whole point
 * and capped at the payer's stack. Each card that moved points tells it on `CHAOS_APPLIED.transfers` (a duel's own line
 * in the summary was written at the reveal; Ép chia thưởng, Thuế thắng and the bomb add theirs here).
 */
export function payTransfers(state: HandState, payoutBySeat: ReadonlyMap<number, number>): GameEvent[] {
  const chaos = state.chaos
  const events: GameEvent[] = []
  if (!chaos || state.rules.mode !== 'blind') return events
  const wager = state.rules.fixedWager
  const dead = (seat: number): number => chaos.deadMoney?.find((d) => d.seat === seat)?.amount ?? 0
  const net = new Map(state.players.map((p) => [p.seat, (payoutBySeat.get(p.seat) ?? 0) - p.totalCommitted - dead(p.seat)]))
  const move = (from: number, to: number, due: number): ChaosTransfer => {
    const payer = getPlayer(state, from)
    const amount = Math.max(0, Math.min(Math.floor(due), payer.stack))
    payer.stack -= amount
    getPlayer(state, to).stack += amount
    net.set(from, net.get(from)! - amount)
    net.set(to, net.get(to)! + amount)
    return { from, to, amount }
  }
  const order = seatsClockwiseFrom(state, state.button)
  const inHand = (seat: number): boolean => state.players.some((p) => p.seat === seat)

  // 1. Duels: the cards' first, the Thần's after (Ruling 2). The reveal already told each duel and its line.
  const duels = (chaos.duels ?? []).filter((d) => !d.god).concat((chaos.duels ?? []).filter((d) => d.god))
  for (const d of duels) {
    if (!inHand(d.winner) || !inHand(d.payer)) continue
    const t = move(d.payer, d.winner, d.wagers * wager)
    const effect: ChaosEffectKind = d.god ? 'carp' : 'duel'
    events.push({ type: 'CHAOS_APPLIED', seat: d.winner, cardId: d.cardId, effect, targets: [d.payer], outcome: 'applied', amount: t.amount, transfers: [t] })
  }

  // "Người thắng": a seat that won a pot and is still ahead — a seat ahead only by what a card paid it is not taxed.
  const winners = (but: number): number[] => order.map((p) => p.seat).filter((s) => s !== but && (payoutBySeat.get(s) ?? 0) > 0 && net.get(s)! > 0)
  const share = (holder: number, e: PlannedEffect): void => {
    const transfers = winners(holder).map((w) => move(w, holder, (net.get(w)! * (e.params.percent ?? 0)) / 100))
    const paid = transfers.filter((t) => t.amount > 0)
    if (paid.length === 0) return
    record(chaos, events, holder, e, paid.map((t) => t.from), 'applied', { transfers: paid, amount: paid.reduce((a, t) => a + t.amount, 0) })
  }

  // 2. Ép chia thưởng: only a holder still in that won no pot ("còn trong ván, thua").
  for (const p of order) {
    const e = effectOf(chaos, p.seat, 'shareWinnings')
    if (e && !p.folded && (payoutBySeat.get(p.seat) ?? 0) === 0) share(p.seat, e)
  }
  // 3. Thuế thắng: every winner but the holder.
  for (const p of order) {
    const e = effectOf(chaos, p.seat, 'winTax')
    if (e) share(p.seat, e)
  }

  // 4. The bombs on their last hand (a fuse of 1 goes off in the hand it was planted).
  const fresh: ChaosBomb[] = (chaos.outcomes?.planted ?? []).map((b) => ({ owner: b.owner, carrier: b.carrier, handsLeft: b.fuse, cardId: b.cardId, uid: b.uid, wagers: b.wagers }))
  for (const b of [...(chaos.plan.bombs ?? []), ...fresh]) {
    if (b.handsLeft > 1 || !inHand(b.owner) || !inHand(b.carrier)) continue
    const t = move(b.carrier, b.owner, (b.wagers ?? 1) * wager)
    const e: PlannedEffect = { uid: b.uid, cardId: b.cardId, effect: 'timeBomb', params: {}, timing: 'deal', debuff: true, targets: [] }
    record(chaos, events, b.owner, e, [b.carrier], 'applied', { transfers: [t], amount: t.amount })
  }
  return events
}
