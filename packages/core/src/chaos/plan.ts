import type { Rng } from '../cards/rng.js'
import type { BlindRules } from '../hand/types.js'
import { firesFromArmed, returnToBonus } from './bonus.js'
import { pickCard } from './draw.js'
import { farmHandsOf, stackHeld } from './hold.js'
import type { ChaosCardDef, ChaosEffectKind, ChaosHandPlan, ChaosMode, ChaosSeat, HeldCard, PlannedEffect } from './types.js'

/** Spec §5.3 Tay bạc: it rolls any enabled Silver or Gold effect except these. */
const GAMBLER_EXCLUDED: ReadonlySet<ChaosEffectKind> = new Set(['rescue', 'fortune', 'levelUp', 'gambler'])
/** The debuffs that act at the deal and so are aimed here; the reveal debuffs are aimed by the engine at the reveal. */
const DEAL_DEBUFFS: ReadonlySet<ChaosEffectKind> = new Set(['freeze', 'blindfold'])

export interface PlanSeatInput {
  seat: number
  isBot: boolean
  chaos: ChaosSeat
}

type PlanSeat = ChaosHandPlan['seats'][number]
type Firing = Omit<PlannedEffect, 'targets'>

/**
 * Picks the effects that fire this hand (spec §3.4–§3.5) for the seats dealt in. A frozen seat fires nothing, not even
 * its shield (and its armed bonus card waits, untouched). Otherwise a played bonus card fires first (see below), then,
 * in the order the cards were received: duration cards fire while they have hands left; one-shot
 * buffs fire once per effect kind; at most one debuff fires (the oldest); shields and mirrors are exposed as `shield`
 * for the engine; Cấp cứu and Thần tài wait for `afterHand`; a card whose modes exclude the table's never fires. Each
 * Tay bạc then rolls one effect under the same rules. Deal-time debuffs get their targets here (one other seat at
 * random, or every other seat with `all`); reveal debuffs get `targets: []`. The input seats are never changed: the
 * returned map holds each seat as it goes into the hand (a rolled Tích lũy adds its points there).
 */
export function planHand(input: {
  seats: readonly PlanSeatInput[]
  rules: BlindRules
  pool: readonly ChaosCardDef[]
  rng: Rng
  nextUid: () => number
  weights?: ReadonlyMap<string, number>
}): { plan: ChaosHandPlan; seats: Map<number, ChaosSeat> } {
  const { rules, pool, rng, nextUid, weights } = input
  const mode: ChaosMode = rules.decisionMode
  const defs = new Map(pool.map((c) => [c.id, c]))
  /** A card the GM took out of the pool since it was drawn still runs (spec §6.2): it was valid when received. */
  const validHere = (cardId: string): boolean => defs.get(cardId)?.modes.includes(mode) ?? true

  const planSeats: PlanSeat[] = []
  const seats = new Map<number, ChaosSeat>()
  for (const { seat, chaos: given } of input.seats) {
    let chaos = given
    // What a hand that never settled (cancelled) left behind: a card armed for it goes back to the bonus hand unfired
    // (spec §3.4), and its "played" marker is cleared.
    if (chaos.armed?.hand === 'this') chaos = { ...chaos, bonus: returnToBonus(chaos.bonus, chaos.armed.card), armed: null }
    if (chaos.bonusPlayedThisHand) chaos = { ...chaos, bonusPlayedThisHand: false }
    const out: PlanSeat = { seat, effects: [], shield: null, blindfolded: chaos.blindfoldedNextHand }
    planSeats.push(out)
    seats.set(seat, chaos)
    if (chaos.frozenNextHand) continue

    // A bonus card played for this hand (BP-39) fires first, and marks the hand as having had its one bonus card. A
    // one-shot reveal or decision card fires from `armed`, which now names this hand, so `afterHand` can see whether it
    // was used (and nobody learns it was played before it fires). Any other card joins `cards` and fires under the rules
    // below: a duration card by the stacking rule (back to the bonus hand, unplayed, if a stronger held card would drop
    // it), a one-shot deal card (freeze, blindfold, Tay bạc) at the front, so a pressed debuff fires before a held draft
    // debuff (spec §3.4). A card this table's mode excludes does not fire: it waits as `this`, to go back to the bonus hand.
    let lead: HeldCard | null = null
    if (chaos.armed) {
      const card = chaos.armed.card
      if (!validHere(card.cardId)) chaos = { ...chaos, armed: { card, hand: 'this' } }
      else if (firesFromArmed(card)) {
        lead = card
        chaos = { ...chaos, armed: { card, hand: 'this' }, bonusPlayedThisHand: true }
      } else {
        const cards = card.handsLeft === null ? [card, ...chaos.cards] : stackHeld(chaos.cards, card)
        chaos = cards
          ? { ...chaos, cards, armed: null, farmHandsLeft: farmHandsOf(cards), bonusPlayedThisHand: true }
          : { ...chaos, bonus: returnToBonus(chaos.bonus, card), armed: null }
      }
      seats.set(seat, chaos)
    }

    const opponents = input.seats.filter((s) => s.seat !== seat).map((s) => s.seat)
    const kinds = new Set<ChaosEffectKind>()
    let debuffFired = false
    const fire = (f: Firing): void => {
      let targets: number[] = []
      if (DEAL_DEBUFFS.has(f.effect)) {
        if (f.params.all) targets = opponents.slice()
        else if (opponents.length > 0) targets = [opponents[rng.int(opponents.length)]!]
      }
      out.effects.push({ uid: f.uid, cardId: f.cardId, effect: f.effect, params: f.params, timing: f.timing, debuff: f.debuff, targets })
      kinds.add(f.effect)
      if (f.debuff) debuffFired = true
    }

    if (lead) fire(lead)
    let gamblers = 0
    for (const card of chaos.cards) {
      if (!validHere(card.cardId)) continue
      if (card.handsLeft !== null && card.handsLeft <= 0) continue
      if (card.effect === 'gambler') {
        gamblers++
      } else if (card.effect === 'shield' || card.effect === 'mirror') {
        // One shield stands up per hand. A lasting one (a duration card) is preferred to a one-shot: it is not used up by
        // what it stops, so the one-shot is kept for a later hand (Plan 37 final wave, M1). Otherwise the oldest held.
        const lasting = card.handsLeft !== null
        if (out.shield === null || (lasting && out.shield.lasting !== true)) {
          out.shield = { uid: card.uid, cardId: card.cardId, kind: card.effect, ...(lasting ? { lasting: true as const } : {}) }
        }
      } else if (card.timing !== 'wait' && card.timing !== 'now' && !(card.debuff && debuffFired) && !kinds.has(card.effect)) {
        fire(card)
      }
    }

    let points = chaos.points
    for (let g = 0; g < gamblers; g++) {
      const candidates = pool.filter((c) =>
        (c.tier === 'silver' || c.tier === 'gold') && !GAMBLER_EXCLUDED.has(c.effect) && c.modes.includes(mode)
        && !kinds.has(c.effect) && !(c.debuff && debuffFired)
        && !((c.effect === 'shield' || c.effect === 'mirror') && out.shield))
      const rolled = pickCard(candidates, rng, weights)
      if (!rolled) continue
      const uid = nextUid()
      if (rolled.effect === 'shield' || rolled.effect === 'mirror') {
        out.shield = { uid, cardId: rolled.id, kind: rolled.effect, ...(rolled.params.hands ? { lasting: true as const } : {}) }
        continue
      }
      if (rolled.effect === 'chaosPoints') points += rolled.params.points ?? 0
      fire({ ...rolled, uid, cardId: rolled.id })
    }
    if (points !== chaos.points) seats.set(seat, { ...chaos, points })
  }

  return { plan: { seats: planSeats, reverse: planSeats.some((s) => s.effects.some((e) => e.effect === 'reverseRank')) }, seats }
}
