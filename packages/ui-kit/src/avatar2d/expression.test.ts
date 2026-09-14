import { HandCategory, parseCards } from '@bp/core'
import { describe, expect, it } from 'vitest'
import type { ClientHand, ClientHandResult } from '../client/types.js'
import { makeHand, makePlayer, makeRoom, makeSeat, makeState } from '../test-fixtures.js'
import { advanceExpressionMemory, expressionForSeat, initialExpressionMemory, type ExpressionMemory } from './expression.js'

const T0 = 1_000_000

const result = (patch: Partial<ClientHandResult>): ClientHandResult => ({
  payouts: [],
  pots: [],
  fee: 0,
  showdown: null,
  carryOverOut: 0,
  uncalledReturned: null,
  cancelled: false,
  reason: null,
  ...patch,
})

const showdownHand = (seat: number) => ({ seat, cards: parseCards('Ah Kh'), rank: 0, category: HandCategory.FLUSH, best: parseCards('Ah Kh 9h 5h 2h') })

const room = makeRoom({
  players: [
    makePlayer({ playerId: 'a', displayName: 'Ann', seat: 0, status: 'IN_HAND' }),
    makePlayer({ playerId: 'b', displayName: 'Bob', seat: 1, status: 'IN_HAND' }),
  ],
})

describe('advanceExpressionMemory / expressionForSeat', () => {
  it('defaults to neutral', () => {
    const memory = initialExpressionMemory(T0)
    const state = makeState({ room, hand: null })
    expect(expressionForSeat(memory, state, 0, T0)).toBe('neutral')
  })

  it('happy for 4 s on a won hand, then neutral', () => {
    const hand: ClientHand = makeHand({
      handId: 'h1',
      phase: 'COMPLETE',
      seats: [makeSeat({ seat: 0, playerId: 'a' }), makeSeat({ seat: 1, playerId: 'b' })],
      result: result({ payouts: [{ seat: 0, amount: 500 }] }),
    })
    const state = makeState({ room, hand })
    const memory = advanceExpressionMemory(initialExpressionMemory(T0), state, T0)
    expect(expressionForSeat(memory, state, 0, T0)).toBe('happy')
    expect(expressionForSeat(memory, state, 0, T0 + 3999)).toBe('happy')
    expect(expressionForSeat(memory, state, 0, T0 + 4001)).toBe('neutral')
    // The seat that did not win gets no timed reaction from a plain win (it did not reach showdown either).
    expect(expressionForSeat(memory, state, 1, T0)).toBe('neutral')
  })

  it('sad for 3 s on a showdown loss, then neutral', () => {
    const hand: ClientHand = makeHand({
      handId: 'h1',
      phase: 'COMPLETE',
      seats: [makeSeat({ seat: 0, playerId: 'a' }), makeSeat({ seat: 1, playerId: 'b' })],
      result: result({ payouts: [{ seat: 0, amount: 500 }], showdown: [showdownHand(0), showdownHand(1)] }),
    })
    const state = makeState({ room, hand })
    const memory = advanceExpressionMemory(initialExpressionMemory(T0), state, T0)
    expect(expressionForSeat(memory, state, 1, T0)).toBe('sad')
    expect(expressionForSeat(memory, state, 1, T0 + 2999)).toBe('sad')
    expect(expressionForSeat(memory, state, 1, T0 + 3001)).toBe('neutral')
    expect(expressionForSeat(memory, state, 0, T0)).toBe('happy')
  })

  it('a hand result is only reacted to once — advancing again on the same handId does not re-arm the timer', () => {
    const hand: ClientHand = makeHand({
      handId: 'h1',
      phase: 'COMPLETE',
      seats: [makeSeat({ seat: 0, playerId: 'a' })],
      result: result({ payouts: [{ seat: 0, amount: 500 }] }),
    })
    const state = makeState({ room, hand })
    let memory = advanceExpressionMemory(initialExpressionMemory(T0), state, T0)
    // Re-advance well after the reaction should have expired: since the handId has already been recorded, the
    // still-`COMPLETE` snapshot must not re-arm it.
    memory = advanceExpressionMemory(memory, state, T0 + 10_000)
    expect(expressionForSeat(memory, state, 0, T0 + 10_000)).toBe('neutral')
  })

  it('surprised for 2 s on any seat going all-in, table-wide, then neutral', () => {
    const hand: ClientHand = makeHand({
      handId: 'h1',
      phase: 'BETTING',
      seats: [makeSeat({ seat: 0, playerId: 'a', allIn: true }), makeSeat({ seat: 1, playerId: 'b' })],
    })
    const state = makeState({ room, hand })
    const memory = advanceExpressionMemory(initialExpressionMemory(T0), state, T0)
    // Both the seat that shoved and the seat that did not react — the trigger is table-wide.
    expect(expressionForSeat(memory, state, 0, T0)).toBe('surprised')
    expect(expressionForSeat(memory, state, 1, T0)).toBe('surprised')
    expect(expressionForSeat(memory, state, 1, T0 + 1999)).toBe('surprised')
    expect(expressionForSeat(memory, state, 1, T0 + 2001)).toBe('neutral')
  })

  it('does not re-fire surprised for a seat that was already all-in', () => {
    const allInHand = (allIn: boolean): ClientHand =>
      makeHand({
        handId: 'h1',
        phase: 'BETTING',
        seats: [makeSeat({ seat: 0, playerId: 'a', allIn }), makeSeat({ seat: 1, playerId: 'b' })],
      })
    let memory = initialExpressionMemory(T0)
    memory = advanceExpressionMemory(memory, makeState({ room, hand: allInHand(true) }), T0)
    // Time passes well past the 2 s reaction, seat 0 is still all-in (nothing new happened).
    memory = advanceExpressionMemory(memory, makeState({ room, hand: allInHand(true) }), T0 + 5000)
    const state = makeState({ room, hand: allInHand(true) })
    expect(expressionForSeat(memory, state, 1, T0 + 5000)).toBe('neutral')
  })

  it('closed while folded, regardless of any timed reaction, until the hand ends', () => {
    const hand: ClientHand = makeHand({
      handId: 'h1',
      phase: 'BETTING',
      seats: [makeSeat({ seat: 0, playerId: 'a', folded: true, allIn: false }), makeSeat({ seat: 1, playerId: 'b', allIn: true })],
    })
    const state = makeState({ room, hand })
    const memory = advanceExpressionMemory(initialExpressionMemory(T0), state, T0)
    // Seat 0 is folded: even though the all-in just armed a table-wide `surprised`, closed wins.
    expect(expressionForSeat(memory, state, 0, T0)).toBe('closed')
    expect(expressionForSeat(memory, state, 1, T0)).toBe('surprised')
  })

  it('sleep while sitting out or disconnected', () => {
    const sittingOutRoom = makeRoom({
      players: [
        makePlayer({ playerId: 'a', displayName: 'Ann', seat: 0, sittingOut: true }),
        makePlayer({ playerId: 'b', displayName: 'Bob', seat: 1, connected: false }),
        makePlayer({ playerId: 'c', displayName: 'Cúc', seat: 2 }),
      ],
    })
    const state = makeState({ room: sittingOutRoom, hand: null })
    const memory = initialExpressionMemory(T0)
    expect(expressionForSeat(memory, state, 0, T0)).toBe('sleep')
    expect(expressionForSeat(memory, state, 1, T0)).toBe('sleep')
    expect(expressionForSeat(memory, state, 2, T0)).toBe('neutral')
  })

  it('sleep once the room has gone 60 s with no hand, measured from room entry', () => {
    const state = makeState({ room, hand: null })
    const memory = initialExpressionMemory(T0)
    expect(expressionForSeat(memory, state, 0, T0 + 59_999)).toBe('neutral')
    expect(expressionForSeat(memory, state, 0, T0 + 60_001)).toBe('sleep')
  })

  it('the idle clock restarts on the last hand completion, not room entry', () => {
    const hand: ClientHand = makeHand({
      handId: 'h1',
      phase: 'COMPLETE',
      seats: [makeSeat({ seat: 0, playerId: 'a' })],
      result: result({}),
    })
    let memory = initialExpressionMemory(T0)
    memory = advanceExpressionMemory(memory, makeState({ room, hand }), T0 + 30_000)
    const afterHand = makeState({ room, hand: null })
    // 59 s after the hand completed (not 60 s after room entry, which has long since passed) — still awake.
    expect(expressionForSeat(memory, afterHand, 0, T0 + 30_000 + 59_000)).toBe('neutral')
    expect(expressionForSeat(memory, afterHand, 0, T0 + 30_000 + 61_000)).toBe('sleep')
  })

  it('sleep outranks a timed reaction', () => {
    const sittingOutRoom = makeRoom({ players: [makePlayer({ playerId: 'a', displayName: 'Ann', seat: 0, sittingOut: true })] })
    const hand: ClientHand = makeHand({
      handId: 'h1',
      phase: 'COMPLETE',
      seats: [makeSeat({ seat: 0, playerId: 'a' })],
      result: result({ payouts: [{ seat: 0, amount: 500 }] }),
    })
    const state = makeState({ room: sittingOutRoom, hand })
    const memory = advanceExpressionMemory(initialExpressionMemory(T0), state, T0)
    expect(expressionForSeat(memory, state, 0, T0)).toBe('sleep')
  })
})

describe('ExpressionMemory shape', () => {
  it('starts empty, anchored at the given time', () => {
    const memory: ExpressionMemory = initialExpressionMemory(T0)
    expect(memory).toEqual({ handId: null, timed: new Map(), allIn: new Set(), idleSince: T0 })
  })
})
