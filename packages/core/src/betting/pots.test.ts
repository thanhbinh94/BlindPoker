import { describe, expect, it } from 'vitest'
import { clockwiseFrom, computePots, distributePots, tableFee } from './pots.js'

describe('computePots', () => {
  it('single pot when everyone committed equally', () => {
    const pots = computePots([
      { seat: 0, totalCommitted: 100, folded: false },
      { seat: 1, totalCommitted: 100, folded: false },
      { seat: 2, totalCommitted: 100, folded: true },
    ])
    expect(pots).toEqual([{ amount: 300, eligibleSeats: [0, 1] }])
  })
  it('creates side pots for uneven all-ins', () => {
    const pots = computePots([
      { seat: 0, totalCommitted: 50, folded: false },   // short all-in
      { seat: 1, totalCommitted: 200, folded: false },
      { seat: 2, totalCommitted: 200, folded: false },
      { seat: 3, totalCommitted: 120, folded: true },   // folded after committing 120
    ])
    expect(pots).toEqual([
      { amount: 200, eligibleSeats: [0, 1, 2] },           // 50 × 4
      { amount: 370, eligibleSeats: [1, 2] },              // (120-50)×3 + (200-120)×2 = 210 + 160, merged (same eligible set)
    ])
  })
  it('ignores zero contributions', () => {
    expect(computePots([{ seat: 0, totalCommitted: 0, folded: false }])).toEqual([])
  })
  it('falls back to all unfolded seats when a layer has no eligible player', () => {
    const pots = computePots([
      { seat: 0, totalCommitted: 100, folded: false },
      { seat: 1, totalCommitted: 300, folded: true },
    ])
    expect(pots).toEqual([{ amount: 400, eligibleSeats: [0] }])
  })
})

describe('distributePots', () => {
  const ranks = new Map<number, number>([[0, 10], [1, 20], [2, 20], [3, 5]])
  it('gives the pot to the single best eligible seat', () => {
    const res = distributePots([{ amount: 300, eligibleSeats: [0, 3] }], ranks, [0, 1, 2, 3], 3)
    expect(res[0]!.winners).toEqual([{ seat: 0, amount: 300 }])
  })
  it('splits ties and hands odd chips clockwise from the button', () => {
    const res = distributePots([{ amount: 301, eligibleSeats: [0, 1, 2] }], ranks, [0, 1, 2, 3], 1)
    // winners 1 and 2 tie; first seat after button(1) is 2 → gets the odd chip
    expect(res[0]!.winners).toEqual([{ seat: 2, amount: 151 }, { seat: 1, amount: 150 }])
  })
  it('handles several pots with different eligibility', () => {
    const res = distributePots(
      [{ amount: 200, eligibleSeats: [0, 1, 2] }, { amount: 370, eligibleSeats: [1, 2] }],
      new Map([[0, 99], [1, 20], [2, 20]]), [0, 1, 2, 3], 0)
    expect(res[0]!.winners).toEqual([{ seat: 0, amount: 200 }])
    expect(res[1]!.winners).toEqual([{ seat: 1, amount: 185 }, { seat: 2, amount: 185 }])
  })
  it('splits a pot among all eligible seats when none of them has a rank (uncontested pot)', () => {
    const res = distributePots([{ amount: 301, eligibleSeats: [2, 4] }], new Map(), [0, 2, 4], 0)
    expect(res[0]!.winners).toEqual([{ seat: 2, amount: 151 }, { seat: 4, amount: 150 }])
    expect(res[0]!.winners.reduce((a, w) => a + w.amount, 0)).toBe(301)
  })
})

describe('tableFee', () => {
  it('rounds down and applies the cap', () => {
    expect(tableFee(15000, 0.02)).toBe(300)
    expect(tableFee(15001, 0.02)).toBe(300)
    expect(tableFee(15000, 0.02, 200)).toBe(200)
    expect(tableFee(10, 0.02)).toBe(0)
  })
})

describe('clockwiseFrom', () => {
  it('starts after the given seat and wraps', () => {
    expect(clockwiseFrom([0, 2, 5, 7], 5)).toEqual([7, 0, 2, 5])
    expect(clockwiseFrom([0, 2, 5, 7], 7)).toEqual([0, 2, 5, 7])
    expect(clockwiseFrom([0, 2, 5, 7], 3)).toEqual([5, 7, 0, 2]) // afterSeat not present: next higher seat
  })
})
