import { describe, expect, it } from 'vitest'
import { makeHand, makeSeat } from '../test-fixtures.js'
import { DEAL_SPAN_MS, DEAL_STAGGER_MS, dealOrderOf, dealStaggerMs } from './motion.js'

/** A hand with seats `seats` dealt in and the button on `button`. */
const handAt = (seats: number[], button: number) =>
  makeHand({ button, seats: seats.map((seat) => makeSeat({ seat, playerId: `p${seat}` })) })

// Spec 2026-10-08 §4.1.1: clockwise from the seat after the dealer, wrapping round the table.
describe('dealOrderOf', () => {
  it('starts at the first seat after the button and wraps round', () => {
    expect(dealOrderOf(handAt([0, 1, 2], 0))).toEqual([1, 2, 0])
    expect(dealOrderOf(handAt([5, 0, 3], 3))).toEqual([5, 0, 3])
    expect(dealOrderOf(handAt([0, 3, 5], 5)), 'the button on the last seat').toEqual([0, 3, 5])
    expect(dealOrderOf(handAt([1, 4, 7], 2)), 'a button seat no longer in the hand').toEqual([4, 7, 1])
    expect(dealOrderOf(null)).toEqual([])
  })
})

// Ruling 26: the whole deal leaves the deck within DEAL_SPAN_MS — the hand's timer is running while it plays.
describe('dealStaggerMs', () => {
  it('keeps the full step for a small deal and shortens it so the last card leaves within the span', () => {
    expect(dealStaggerMs(4 * 2), 'four seats of two: 7 steps of 120 fit in a second').toBe(DEAL_STAGGER_MS)
    expect(dealStaggerMs(2 * 2)).toBe(DEAL_STAGGER_MS)
    expect(dealStaggerMs(6 * 2), 'six seats of two').toBe(90)
    expect(dealStaggerMs(8 * 3), 'eight seats of three').toBe(43)
    expect(dealStaggerMs(1), 'one card has no step').toBe(0)
    expect(dealStaggerMs(0)).toBe(0)
    for (const total of [2, 5, 9, 12, 18, 24, 27]) expect((total - 1) * dealStaggerMs(total), `${total} cards`).toBeLessThanOrEqual(DEAL_SPAN_MS)
  })
})
