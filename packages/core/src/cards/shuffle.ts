import type { Card } from './cards.js'
import type { Rng } from './rng.js'

/** Fisher–Yates; returns a new array, input untouched. */
export function shuffle(deck: readonly Card[], rng: Rng): Card[] {
  const d = deck.slice()
  for (let i = d.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    const tmp = d[i]!
    d[i] = d[j]!
    d[j] = tmp
  }
  return d
}
