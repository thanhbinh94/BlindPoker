import type { Rng } from '../cards/rng.js'
import { tierFromParam } from './hold.js'
import type { ChaosTier } from './types.js'

/**
 * BP-41 §5 Xúc xắc vận may: one roll of a card's dice and the band of the dice table it lands in (the encoding is on
 * `DICE_SILVER` in fixtures.ts). Amounts are in units: `points` chaos points, `cards` prize cards by tier, `lose` and
 * `jackpot` in fixed wagers — the caller turns wagers into points and caps the loss at the stack.
 */
export interface DiceRoll {
  /** The faces, in the order rolled (1–6 each). */
  dice: number[]
  points: number
  cards: { tier: ChaosTier; count: number }[]
  /** Wagers lost to the sink. */
  lose: number
  /** Wagers paid as a jackpot (new points). */
  jackpot: number
  /** Three or more dice alike on a table that has a `triple` multiplier: every number of the band was multiplied. */
  triple: boolean
  herald: boolean
}

/**
 * Rolls `params.dice` six-sided dice (one `rng.int(6)` each, nothing else drawn) and reads the band their total falls in:
 * band N covers `aN` up to `a(N+1) − 1`, the last band up to the highest total. Three or more equal dice multiply the
 * band's points, cards, wagers lost and jackpot by `triple` (when the table has one); the herald is never multiplied.
 * A total under `a1`, or a band with no numbers, gives nothing.
 */
export function rollFortuneDice(params: Readonly<Record<string, number>>, rng: Rng): DiceRoll {
  const n = Math.max(1, params.dice ?? 1)
  const dice = Array.from({ length: n }, () => 1 + rng.int(6))
  const total = dice.reduce((a, b) => a + b, 0)
  let band = 0
  for (let i = 1; params[`a${i}`] !== undefined; i++) if (total >= params[`a${i}`]!) band = i
  const alike = n >= 3 && dice.every((d) => d === dice[0])
  const mult = alike && params.triple !== undefined ? params.triple : 1
  const at = (key: string): number => (band > 0 ? (params[`${key}${band}`] ?? 0) : 0)
  const tier = tierFromParam(at('t'))
  const count = at('c') * mult
  return {
    dice,
    points: at('p') * mult,
    cards: tier && count > 0 ? [{ tier, count }] : [],
    lose: at('l') * mult,
    jackpot: at('j') * mult,
    triple: mult !== 1,
    herald: at('h') > 0,
  }
}
