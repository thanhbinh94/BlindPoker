import { describe, expect, it } from 'vitest'
import { makeHand, makeSeat } from '../test-fixtures.js'
import { dealOrderOf } from './motion.js'

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
