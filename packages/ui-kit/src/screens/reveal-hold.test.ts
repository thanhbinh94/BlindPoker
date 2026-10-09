import { HandCategory, parseCards } from '@bp/core'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientHand } from '../client/types.js'
import { DEAL_MS, FLIP_MS, LIFT_MS, SHOWDOWN_STAGGER_MS } from '../table/motion.js'
import { makeHand } from '../test-fixtures.js'
import { REVEAL_HOLD_AFTER_BOARD_MS, REVEAL_HOLD_MS, useRevealHold } from './reveal-hold.js'

describe('REVEAL_HOLD_MS', () => {
  it('covers a lift, two more lifts’ stagger and the settle margin', () => {
    expect(REVEAL_HOLD_MS).toBe(LIFT_MS + 2 * SHOWDOWN_STAGGER_MS + 150)
    expect(REVEAL_HOLD_MS).toBe(1270)
  })

  // Pre-flight 2026-10-09: the river and the showdown come in one batch, and the lift waits for the river to land and turn.
  it('grows by the river’s slide and turn when the showdown came with it', () => {
    expect(REVEAL_HOLD_AFTER_BOARD_MS).toBe(DEAL_MS + FLIP_MS)
    expect(REVEAL_HOLD_MS + REVEAL_HOLD_AFTER_BOARD_MS).toBe(2230)
  })
})

describe('useRevealHold', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  /** Bob (seat 2) drawn face down on the flop; the viewer is Ann (seat 0). */
  const live = makeHand({ restored: false })
  /** The hand shown down, its `SHOWDOWN` landing `gap` ms after the last board card. */
  const shownDown = (gap: number): ClientHand => ({
    ...live,
    phase: 'COMPLETE',
    actingSeat: null,
    community: parseCards('Ah Kd 2c 9s 5s'),
    boardAt: 10_000,
    showdownAt: 10_000 + gap,
    seats: live.seats.map((seat) => (seat.seat === 2 ? { ...seat, holeCards: parseCards('Jc Td') } : seat)),
    result: {
      payouts: [{ seat: 0, amount: 600 }],
      pots: [],
      fee: 0,
      showdown: [
        { seat: 0, cards: parseCards('Qs Qd'), rank: 2, category: HandCategory.PAIR, best: parseCards('Qs Qd Ah Kd 9s') },
        { seat: 2, cards: parseCards('Jc Td'), rank: 1, category: HandCategory.HIGH_CARD, best: parseCards('Ah Kd Jc Td 9s') },
      ],
      carryOverOut: 0,
      uncalledReturned: null,
      cancelled: false,
      reason: null,
    },
  })
  /** How long the hook holds once the hand ends as `end`. */
  const holdFor = (end: ClientHand): number => {
    const view = renderHook(({ hand }) => useRevealHold(hand), { initialProps: { hand: live } })
    view.rerender({ hand: end })
    let waited = 0
    while (view.result.current && waited < 10_000) {
      act(() => vi.advanceTimersByTime(10))
      waited += 10
    }
    view.unmount()
    return waited
  }

  it('holds REVEAL_HOLD_MS after a showdown alone, and the river’s slide and turn longer after one that came with it', () => {
    expect(holdFor(shownDown(30_000))).toBe(REVEAL_HOLD_MS)
    expect(holdFor(shownDown(0))).toBe(REVEAL_HOLD_MS + REVEAL_HOLD_AFTER_BOARD_MS)
  })
})
