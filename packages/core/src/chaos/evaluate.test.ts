import { describe, expect, it } from 'vitest'
import { parseCards, rankOf } from '../cards/cards.js'
import { seededRng } from '../cards/rng.js'
import { shuffle } from '../cards/shuffle.js'
import { combinations } from '../evaluator/combinations.js'
import { HandCategory, evaluate, evaluate5 } from '../evaluator/evaluator.js'
import { evaluateAny, evaluateWild } from './evaluate.js'

const brute = (cards: number[]): number => Math.max(...combinations(cards, 5).map(evaluate5))
const deal = (seed: number, n: number): number[] => shuffle(Array.from({ length: 52 }, (_, i) => i), seededRng(seed)).slice(0, n)

describe('evaluateAny (BP-41 A9, Ruling 4)', () => {
  it('is evaluate itself up to ten cards: same rank and same best five', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const cards = deal(seed, 5 + (seed % 6))
      expect(evaluateAny(cards)).toEqual(evaluate(cards))
    }
  })
  it('ranks the 12-card maximum the rules aim at (6 hole cards and a sixth board card) as the best five of all', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const cards = deal(seed, 12)
      expect(() => evaluate(cards)).toThrow()
      const ev = evaluateAny(cards)
      expect(ev.rank).toBe(brute(cards))
      expect(ev.best).toHaveLength(5)
      expect(ev.best.every((c) => cards.includes(c))).toBe(true)
    }
  })
  it('ranks 13 cards too (a borrowed card on top of the 12)', () => {
    const cards = deal(99, 13)
    expect(evaluateAny(cards).rank).toBe(brute(cards))
  })
})

describe('evaluateWild (Lá ma)', () => {
  it('turns the wild card into the card that makes the best hand, and shows the real card in the best five', () => {
    const cards = parseCards('Qh 2s Ah Kh Jh 3c 4d')
    const ev = evaluateWild(cards, parseCards('2s')[0]!)
    expect(ev.category).toBe(HandCategory.ROYAL_FLUSH)
    expect(ev.wild).toEqual({ card: parseCards('2s')[0], as: parseCards('Th')[0] })
    expect(ev.best).toContain(parseCards('2s')[0])
    expect(ev.best).not.toContain(parseCards('Th')[0])
  })
  it('never makes five of a kind: it only stands for a card not already in the hand', () => {
    const cards = parseCards('Ac Ad Ah As 2c 7d 9h')
    const ev = evaluateWild(cards, parseCards('2c')[0]!)
    expect(ev.category).toBe(HandCategory.QUADS)
    // Quads of Aces with the best kicker the wild can be: a King.
    expect(ev.wild && rankOf(ev.wild.as)).toBe(11)
  })
  it('reports no wild when the card ranks best as itself, and equals the plain ranking then', () => {
    const cards = parseCards('As Ks Qs Js Ts 2c 3d')
    const ev = evaluateWild(cards, parseCards('As')[0]!)
    expect(ev.wild).toBeUndefined()
    expect(ev).toEqual(evaluate(cards))
  })
  it('works on 12 cards', () => {
    const cards = deal(7, 12)
    const ev = evaluateWild(cards, cards[0]!)
    expect(ev.rank).toBeGreaterThanOrEqual(evaluateAny(cards).rank)
    expect(ev.best).toHaveLength(5)
  })
})
