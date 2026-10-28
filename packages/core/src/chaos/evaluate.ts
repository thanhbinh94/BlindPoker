import type { Card } from '../cards/cards.js'
import { combinations } from '../evaluator/combinations.js'
import { categoryOf, evaluate, evaluate5, type HandEvaluation } from '../evaluator/evaluator.js'

/**
 * The chaos hand's ranking (BP-41 A9, Ruling 4), used through `SettleHooks.evaluateSeat`; `evaluator.ts` is never
 * changed. A chaos seat may rank more than ten cards — up to 3 hole cards + 1 (Thêm lá) + 1 (Hên xui) + 1 (Đảo bài), a
 * borrowed card and a sixth board card: 13 — so above ten it walks every 5-card combination itself, in the same order
 * as `evaluate`. Up to ten cards it is `evaluate`, call for call, so every hand without a round-three card ranks
 * exactly as before.
 */
export function evaluateAny(cards: readonly Card[]): HandEvaluation {
  if (cards.length <= 10) return evaluate(cards)
  let bestRank = -1
  let best: Card[] = []
  for (const combo of combinations(cards, 5)) {
    const r = evaluate5(combo)
    if (r > bestRank) {
      bestRank = r
      best = combo
    }
  }
  return { rank: bestRank, category: categoryOf(bestRank), best }
}

/**
 * Lá ma (BP-41): the best hand when `wild` (one of `cards`) may stand for any card of the deck that is not already
 * among `cards` — never a duplicate, so never five of a kind. The card ranked as itself is tried first and a substitute
 * wins only by a strictly better rank, so the result is deterministic and `wild` is reported only when it changed the
 * hand. `best` always shows the real wild card in the slot its substitute filled.
 */
export function evaluateWild(cards: readonly Card[], wild: Card): HandEvaluation & { wild?: { card: Card; as: Card } } {
  const at = cards.indexOf(wild)
  const natural = evaluateAny(cards)
  if (at < 0) return natural
  let top: HandEvaluation = natural
  let as: Card | null = null
  const taken = new Set(cards)
  for (let s = 0; s < 52; s++) {
    if (taken.has(s)) continue
    const trial = cards.slice()
    trial[at] = s
    const ev = evaluateAny(trial)
    if (ev.rank > top.rank) {
      top = ev
      as = s
    }
  }
  if (as === null || !top.best.includes(as)) return natural
  const sub = as
  return { rank: top.rank, category: top.category, best: top.best.map((c) => (c === sub ? wild : c)), wild: { card: wild, as: sub } }
}
