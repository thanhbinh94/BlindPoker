import { describe, expect, it } from 'vitest'
import { cardToString, createDeck, makeCard, parseCard, parseCards, rankOf, suitOf } from './cards.js'
import { seededRng } from './rng.js'
import { shuffle } from './shuffle.js'

describe('cards', () => {
  it('encodes rank and suit', () => {
    const c = makeCard(12, 3) // As
    expect(rankOf(c)).toBe(12)
    expect(suitOf(c)).toBe(3)
    expect(cardToString(c)).toBe('As')
  })
  it('parses and formats round-trip for all 52 cards', () => {
    for (const c of createDeck()) expect(parseCard(cardToString(c))).toBe(c)
  })
  it('parses a space separated list', () => {
    expect(parseCards('2c Td As')).toEqual([makeCard(0, 0), makeCard(8, 1), makeCard(12, 3)])
  })
  it('rejects bad cards', () => {
    expect(() => parseCard('Xz')).toThrow()
  })
  it('creates 52 unique cards', () => {
    const d = createDeck()
    expect(d).toHaveLength(52)
    expect(new Set(d).size).toBe(52)
  })
})

describe('shuffle', () => {
  it('is deterministic for a seed and keeps all cards', () => {
    const a = shuffle(createDeck(), seededRng(42))
    const b = shuffle(createDeck(), seededRng(42))
    expect(a).toEqual(b)
    expect([...a].sort((x, y) => x - y)).toEqual(createDeck())
    expect(a).not.toEqual(createDeck())
  })
  it('does not mutate the input', () => {
    const d = createDeck()
    shuffle(d, seededRng(1))
    expect(d).toEqual(createDeck())
  })
  it('spreads the first card roughly uniformly', () => {
    const counts = new Array<number>(52).fill(0)
    const rng = seededRng(7)
    for (let i = 0; i < 5200; i++) counts[shuffle(createDeck(), rng)[0]!]!++
    for (const n of counts) expect(n).toBeGreaterThan(50) // expected 100 each
  })
})
