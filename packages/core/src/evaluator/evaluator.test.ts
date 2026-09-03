import { describe, expect, it } from 'vitest'
import { createDeck, parseCards } from '../cards/cards.js'
import { seededRng } from '../cards/rng.js'
import { shuffle } from '../cards/shuffle.js'
import { combinations } from './combinations.js'
import { HandCategory, categoryOf, evaluate, evaluate5 } from './evaluator.js'

const cat = (s: string) => evaluate(parseCards(s)).category
const rank = (s: string) => evaluate(parseCards(s)).rank

describe('combinations', () => {
  it('C(7,5) = 21 and C(8,5) = 56', () => {
    expect(combinations([1, 2, 3, 4, 5, 6, 7], 5)).toHaveLength(21)
    expect(combinations([1, 2, 3, 4, 5, 6, 7, 8], 5)).toHaveLength(56)
    expect(combinations([1, 2, 3], 3)).toEqual([[1, 2, 3]])
  })
})

describe('categories', () => {
  it.each([
    ['As Ks Qs Js Ts', HandCategory.ROYAL_FLUSH],
    ['9h 8h 7h 6h 5h', HandCategory.STRAIGHT_FLUSH],
    ['Ah 2h 3h 4h 5h', HandCategory.STRAIGHT_FLUSH],
    ['Kc Kd Kh Ks 2d', HandCategory.QUADS],
    ['Qc Qd Qh 5s 5d', HandCategory.FULL_HOUSE],
    ['2c 7c 9c Jc Kc', HandCategory.FLUSH],
    ['Ac 2d 3h 4s 5c', HandCategory.STRAIGHT],
    ['Tc Jd Qh Ks Ac', HandCategory.STRAIGHT],
    ['7c 7d 7h 2s 9d', HandCategory.TRIPS],
    ['7c 7d 9h 9s 2d', HandCategory.TWO_PAIR],
    ['7c 7d 3h 9s 2d', HandCategory.PAIR],
    ['2c 5d 8h Js Kd', HandCategory.HIGH_CARD],
  ])('%s is category %i', (hand, expected) => {
    expect(cat(hand)).toBe(expected)
  })

  it('does not wrap around K-A-2-3-4', () => {
    expect(cat('Kc Ad 2h 3s 4c')).toBe(HandCategory.HIGH_CARD)
  })
})

describe('ordering and kickers', () => {
  it('orders categories', () => {
    const hands = [
      '2c 5d 8h Js Kd', '7c 7d 3h 9s 2d', '7c 7d 9h 9s 2d', '7c 7d 7h 2s 9d', 'Ac 2d 3h 4s 5c',
      '2c 7c 9c Jc Kc', 'Qc Qd Qh 5s 5d', 'Kc Kd Kh Ks 2d', '9h 8h 7h 6h 5h', 'As Ks Qs Js Ts',
    ]
    for (let i = 1; i < hands.length; i++) expect(rank(hands[i]!)).toBeGreaterThan(rank(hands[i - 1]!))
  })
  it('wheel is the lowest straight', () => {
    expect(rank('Ac 2d 3h 4s 5c')).toBeLessThan(rank('2c 3d 4h 5s 6c'))
    expect(rank('Tc Jd Qh Ks Ac')).toBeGreaterThan(rank('9c Td Jh Qs Kc'))
  })
  it('compares pairs by pair rank then kickers', () => {
    expect(rank('9c 9d Ah 3s 2d')).toBeGreaterThan(rank('8c 8d Ah Ks Qd'))
    expect(rank('9c 9d Ah 3s 2d')).toBeGreaterThan(rank('9h 9s Kh 3c 2c'))
    expect(rank('9c 9d Ah 3s 2d')).toBe(rank('9h 9s Ad 3c 2c'))
  })
  it('two pair: high pair, low pair, kicker', () => {
    expect(rank('Ac Ad 2h 2s 3d')).toBeGreaterThan(rank('Kc Kd Qh Qs Jd'))
    expect(rank('Kc Kd Qh Qs Jd')).toBeGreaterThan(rank('Kh Ks Jh Js Ad'))
    expect(rank('Kc Kd Qh Qs Ad')).toBeGreaterThan(rank('Kh Ks Jh Js Ad'))
  })
  it('flush compares all five cards', () => {
    expect(rank('Ac Kc 9c 5c 2c')).toBeGreaterThan(rank('Ad Kd 8d 7d 6d'))
  })
  it('full house compares trips first', () => {
    expect(rank('3c 3d 3h As Ad')).toBeGreaterThan(rank('2c 2d 2h Ks Kd'))
  })
  it('quads compare quad rank then kicker', () => {
    expect(rank('5c 5d 5h 5s Ad')).toBeGreaterThan(rank('5c 5d 5h 5s Kd'))
  })
})

describe('evaluate with 7 and 8 cards', () => {
  it('picks the best 5 of 7', () => {
    const r = evaluate(parseCards('Ah Kh 2c 3d Qh Jh Th'))
    expect(r.category).toBe(HandCategory.ROYAL_FLUSH)
    expect(r.best).toHaveLength(5)
  })
  it('picks the best 5 of 8', () => {
    const r = evaluate(parseCards('2c 2d 2h 9s 9d 4c 7h Kd'))
    expect(r.category).toBe(HandCategory.FULL_HOUSE)
  })
  it('rejects fewer than 5 or more than 8 cards', () => {
    expect(() => evaluate(parseCards('Ah Kh 2c 3d'))).toThrow()
    expect(() => evaluate(parseCards('Ah Kh 2c 3d 4d 5d 6d 7d 8d'))).toThrow()
  })
  it('matches brute-force maximum over all 5-card subsets for random 7 and 8 card hands', () => {
    const rng = seededRng(99)
    for (let i = 0; i < 2000; i++) {
      const deck = shuffle(createDeck(), rng)
      for (const n of [7, 8]) {
        const cards = deck.slice(0, n)
        const brute = Math.max(...combinations(cards, 5).map(evaluate5))
        const r = evaluate(cards)
        expect(r.rank).toBe(brute)
        expect(categoryOf(r.rank)).toBe(r.category)
        expect(evaluate5(r.best)).toBe(r.rank)
      }
    }
  })
})
