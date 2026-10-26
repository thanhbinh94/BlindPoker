import { rankOf, suitOf, type Card } from '../cards/cards.js'
import { combinations } from './combinations.js'

export const HandCategory = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9,
} as const
export type HandCategory = (typeof HandCategory)[keyof typeof HandCategory]

export const HAND_CATEGORY_KEYS = [
  'hand.highCard', 'hand.pair', 'hand.twoPair', 'hand.trips', 'hand.straight',
  'hand.flush', 'hand.fullHouse', 'hand.quads', 'hand.straightFlush', 'hand.royalFlush',
] as const

export interface HandEvaluation {
  rank: number
  category: HandCategory
  best: Card[]
}

const CATEGORY_BASE = 16 ** 5

function encode(category: HandCategory, kickers: number[]): number {
  let r = category
  for (let i = 0; i < 5; i++) r = r * 16 + (kickers[i] ?? 0)
  return r
}

export function categoryOf(rank: number): HandCategory {
  return Math.floor(rank / CATEGORY_BASE) as HandCategory
}

/** Rank of exactly five cards. Higher is better; equal means a tie. */
export function evaluate5(cards: readonly Card[]): number {
  if (cards.length !== 5) throw new Error('evaluate5 needs exactly 5 cards')
  const ranks = cards.map(rankOf).sort((a, b) => b - a)
  const isFlush = cards.every((c) => suitOf(c) === suitOf(cards[0]!))
  const counts = new Map<number, number>()
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1)
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const uniq = [...counts.keys()].sort((a, b) => b - a)

  let straightHigh = -1
  if (uniq.length === 5) {
    if (uniq[0]! - uniq[4]! === 4) straightHigh = uniq[0]!
    else if (uniq[0] === 12 && uniq[1] === 3 && uniq[4] === 0) straightHigh = 3 // A-2-3-4-5, five high
  }

  const g = (i: number) => groups[i]![0]
  if (straightHigh >= 0 && isFlush) return encode(straightHigh === 12 ? HandCategory.ROYAL_FLUSH : HandCategory.STRAIGHT_FLUSH, [straightHigh])
  if (groups[0]![1] === 4) return encode(HandCategory.QUADS, [g(0), g(1)])
  if (groups[0]![1] === 3 && groups[1]![1] === 2) return encode(HandCategory.FULL_HOUSE, [g(0), g(1)])
  if (isFlush) return encode(HandCategory.FLUSH, ranks)
  if (straightHigh >= 0) return encode(HandCategory.STRAIGHT, [straightHigh])
  if (groups[0]![1] === 3) return encode(HandCategory.TRIPS, [g(0), g(1), g(2)])
  if (groups[0]![1] === 2 && groups[1]![1] === 2) return encode(HandCategory.TWO_PAIR, [g(0), g(1), g(2)])
  if (groups[0]![1] === 2) return encode(HandCategory.PAIR, [g(0), g(1), g(2), g(3)])
  return encode(HandCategory.HIGH_CARD, ranks)
}

/** Best five-card hand from 5..10 cards (10: a chaos hand of 4 hole cards, a borrowed one and the board). */
export function evaluate(cards: readonly Card[]): HandEvaluation {
  if (cards.length < 5 || cards.length > 10) throw new Error(`evaluate needs 5..10 cards, got ${cards.length}`)
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
