import type { Rng } from '../cards/rng.js'
import type { ChaosOutcome, ChaosSeat, HeldCard } from './types.js'

/**
 * What one Trộm điểm did (BP-41 §6.2), for the room to tell: `seat` is its holder; `targets` the seat it was finally
 * aimed at (after any Bia đỡ đạn; empty when no other seat had a chaos point). `amount` chaos points went `from` → `to`
 * (a mirror or a Gậy ông has the target take from the holder; 0 and nulls when blocked or fizzled). `spent` lists the
 * cards it used up on the way: a one-shot shield or mirror, and each Bia đỡ đạn that passed it on (`passedTo`).
 */
export interface ChaosSteal {
  seat: number
  cardId: string
  uid: number
  outcome: ChaosOutcome
  targets: number[]
  from: number | null
  to: number | null
  amount: number
  spent: { seat: number; uid: number; cardId: string; passedTo?: number }[]
}

/**
 * The shield a seat holds up against a debuff outside a hand, by `planHand`'s rule exactly: among the shields and mirrors
 * with hands left that the table's mode allows (`validHere`, default all), the oldest, unless a lasting one (a duration
 * card, shield or mirror) comes later — a lasting one is preferred, as it is not used up by what it stops. Null when none.
 */
export function standingShield(cards: readonly HeldCard[], validHere: (cardId: string) => boolean = () => true): HeldCard | null {
  let up: HeldCard | null = null
  for (const c of cards) {
    if ((c.effect !== 'shield' && c.effect !== 'mirror') || !validHere(c.cardId)) continue
    if (c.handsLeft !== null && c.handsLeft <= 0) continue
    if (up === null || (c.handsLeft !== null && up.handsLeft === null)) up = c
  }
  return up
}

/**
 * BP-41 Trộm điểm, a "now" debuff, as the room resolves it when a seat receives one (a draft pick, a bonus or prize card):
 * it takes `points` chaos points from the seat with the most of them (not its holder; a tie goes to the first clockwise
 * from the holder). It follows `resolveDebuff`'s order, outside a hand (no "one debuff per seat"):
 * 1. a Gậy ông standing for another seat (`backfire`, only while a hand is live) turns it back: the target takes from the
 *    holder (`reflected`);
 * 2. the target's standing shield blocks it (a one-shot one is spent); a mirror turns it back the same way;
 * 3. the target's oldest Bia đỡ đạn hands it to another seat at random (not the holder, not a seat it already passed
 *    through; the card is spent), which resolves it from step 2; with nobody to take it, it lands and the card waits;
 * 4. it lands: the target gives up to `points` (never more than it has).
 * No seat with a point: `fizzled`. Draws from `rng` only for a Bia đỡ đạn. The input map is never changed; the returned
 * one holds every seat, the changed ones replaced.
 */
export function stealPoints(input: {
  seats: ReadonlyMap<number, ChaosSeat>
  holder: number
  card: { cardId: string; uid: number; params: Readonly<Record<string, number>> }
  rng: Rng
  backfire?: readonly number[]
  /** Whether the table's mode allows a held card (a shield the GM took out of this mode does not stand). Default all. */
  validHere?: (cardId: string) => boolean
}): { seats: Map<number, ChaosSeat>; steal: ChaosSteal } {
  const { holder, card, rng } = input
  const seats = new Map(input.seats)
  const want = Math.max(0, card.params.points ?? 0)
  const steal: ChaosSteal = { seat: holder, cardId: card.cardId, uid: card.uid, outcome: 'fizzled', targets: [], from: null, to: null, amount: 0, spent: [] }
  const points = (seat: number): number => seats.get(seat)?.points ?? 0
  const move = (from: number, to: number): void => {
    const amount = Math.min(want, points(from))
    steal.from = from
    steal.to = to
    steal.amount = amount
    if (amount === 0) return
    seats.set(from, { ...seats.get(from)!, points: points(from) - amount })
    seats.set(to, { ...seats.get(to)!, points: points(to) + amount })
  }
  const drop = (seat: number, c: HeldCard): void => {
    seats.set(seat, { ...seats.get(seat)!, cards: seats.get(seat)!.cards.filter((x) => x.uid !== c.uid) })
  }

  const clockwise = (s: number): number => (s - holder + 1_000) % 1_000
  const others = [...seats.keys()].filter((s) => s !== holder && points(s) > 0).sort((a, b) => points(b) - points(a) || clockwise(a) - clockwise(b))
  const top = others[0]
  if (top === undefined || !seats.has(holder)) return { seats, steal }
  let target: number = top

  if (input.backfire?.some((s) => s !== holder)) {
    steal.outcome = 'reflected'
    steal.targets = [target]
    move(holder, target)
    return { seats, steal }
  }

  const passed: number[] = []
  for (;;) {
    steal.targets = [target]
    const shield = standingShield(seats.get(target)!.cards, input.validHere)
    if (shield) {
      if (shield.handsLeft === null) {
        drop(target, shield)
        steal.spent.push({ seat: target, uid: shield.uid, cardId: shield.cardId })
      }
      if (shield.effect === 'mirror') {
        steal.outcome = 'reflected'
        move(holder, target)
      } else steal.outcome = 'blocked'
      return { seats, steal }
    }
    const goat = seats.get(target)!.cards.find((c) => c.effect === 'scapegoat')
    if (goat) {
      const through: number[] = [...passed, target]
      const to: number[] = [...seats.keys()].filter((s) => s !== holder && !through.includes(s))
      if (to.length > 0) {
        const next: number = to[rng.int(to.length)]!
        drop(target, goat)
        steal.spent.push({ seat: target, uid: goat.uid, cardId: goat.cardId, passedTo: next })
        passed.push(target)
        target = next
        continue
      }
    }
    steal.outcome = 'applied'
    move(target, holder)
    return { seats, steal }
  }
}
