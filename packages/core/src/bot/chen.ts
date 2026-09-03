import { rankOf, suitOf, type Card } from '../cards/cards.js'
import { combinations } from '../evaluator/combinations.js'

const HIGH_CARD_POINTS: Record<number, number> = { 12: 10, 11: 8, 10: 7, 9: 6 }
const cardPoints = (rank: number): number => HIGH_CARD_POINTS[rank] ?? (rank + 2) / 2

function chen2(a: Card, b: Card): number {
  const ra = rankOf(a), rb = rankOf(b)
  const high = Math.max(ra, rb), low = Math.min(ra, rb)
  let score = cardPoints(high)
  if (ra === rb) return Math.max(5, score * 2)
  if (suitOf(a) === suitOf(b)) score += 2
  const gap = high - low - 1
  if (gap === 1) score -= 1
  else if (gap === 2) score -= 2
  else if (gap === 3) score -= 4
  else if (gap >= 4) score -= 5
  if (gap <= 1 && high < 10) score += 1 // both below Q, connected or one-gap
  return Math.round(score)
}

/** Chen formula for two cards; extended heuristic for three. */
export function chenScore(cards: readonly Card[]): number {
  if (cards.length === 2) return chen2(cards[0]!, cards[1]!)
  if (cards.length !== 3) throw new Error('chenScore supports 2 or 3 cards')
  let best = -Infinity
  for (const [a, b] of combinations(cards, 2)) best = Math.max(best, chen2(a!, b!))
  const ranks = cards.map(rankOf)
  const distinct = new Set(ranks).size
  if (distinct === 1) best += 7 // pair (+2) and trips (+5)
  else if (distinct === 2) best += 2
  if (new Set(cards.map(suitOf)).size === 1) best += 1
  return best
}
