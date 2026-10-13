import { describe, expect, it } from 'vitest'
import { parseCards } from '../cards/cards.js'
import { HandCategory } from '../evaluator/evaluator.js'
import { canAct, carryOverAll, commit, dealCards, revealNext, seatsClockwiseFrom, settle } from './common.js'
import type { GameEvent, HandPlayer, HandState } from './types.js'

function player(seat: number, stack: number, extra: Partial<HandPlayer> = {}): HandPlayer {
  return {
    seat, playerId: `p${seat}`, isBot: false, stack, holeCards: [], betThisStreet: 0, totalCommitted: 0,
    folded: false, allIn: false, hasActed: false, cannotRaise: false, decision: null, timedOut: false, revealed: true, ...extra,
  }
}

function baseState(players: HandPlayer[], extra: Partial<HandState> = {}): HandState {
  return {
    handId: 'h1', rules: { mode: 'holdem', smallBlind: 50, bigBlind: 100, tableFeeRate: 0.02, tableFeeCapBB: 1 },
    phase: 'BETTING', players, deck: parseCards('2c 3c 4c 5c 6c 7c 8c 9c Tc Jc Qc Kc Ac 2d 3d'), deckIndex: 0,
    community: [], button: 0, street: 'PREFLOP', actingSeat: null, turnSeq: 0, currentBet: 0, minRaise: 100,
    pot: 0, carryOverIn: 0, revealQueue: [], result: null, ...extra,
  }
}

describe('commit', () => {
  it('moves chips and flags all-in', () => {
    const p = player(0, 100)
    const s = baseState([p])
    expect(commit(s, p, 30)).toBe(30)
    expect(p.stack).toBe(70)
    expect(p.betThisStreet).toBe(30)
    expect(p.totalCommitted).toBe(30)
    expect(s.pot).toBe(30)
    expect(commit(s, p, 500)).toBe(70)
    expect(p.allIn).toBe(true)
    expect(canAct(p)).toBe(false)
  })
})

describe('dealCards / revealNext', () => {
  it('deals from deckIndex and reveals streets in order', () => {
    const s = baseState([player(0, 100)], { revealQueue: ['FLOP', 'TURN', 'RIVER'], phase: 'REVEAL' })
    expect(dealCards(s, 2)).toEqual(parseCards('2c 3c'))
    const events: GameEvent[] = []
    revealNext(s, events)
    expect(s.community).toEqual(parseCards('4c 5c 6c'))
    expect(s.street).toBe('FLOP')
    revealNext(s, events)
    revealNext(s, events)
    expect(s.community).toHaveLength(5)
    expect(s.street).toBe('RIVER')
    expect(s.revealQueue).toEqual([])
    expect(events.map((e) => e.type)).toEqual(['COMMUNITY_REVEALED', 'COMMUNITY_REVEALED', 'COMMUNITY_REVEALED'])
  })
})

describe('seatsClockwiseFrom', () => {
  it('wraps around the table', () => {
    const s = baseState([player(1, 1), player(4, 1), player(7, 1)])
    expect(seatsClockwiseFrom(s, 4).map((p) => p.seat)).toEqual([7, 1, 4])
  })
})

describe('settle', () => {
  it('pays the single unfolded player without showdown and takes the fee', () => {
    const a = player(0, 900, { totalCommitted: 100 })
    const b = player(1, 800, { totalCommitted: 200, folded: true })
    const s = baseState([a, b], { pot: 300 })
    const events: GameEvent[] = []
    settle(s, events, { showdown: false, feeCap: 100 })
    expect(s.phase).toBe('COMPLETE')
    // b holds the single highest commitment (200 vs 100) so 100 is uncalled and goes back — money is conserved
    // even for this synthetic setup. Pot 200, fee floor(200 × 0.02) = 4, a takes 196.
    expect(s.result!.uncalledReturned).toEqual({ seat: 1, amount: 100 })
    expect(s.result!.fee).toBe(4)
    expect(a.stack).toBe(900 + 196) // 1096
    expect(b.stack).toBe(900)
    expect(s.result!.showdown).toBeNull()
    expect(events.map((e) => e.type)).toEqual(['SETTLEMENT', 'HAND_COMPLETE'])
  })
  it('runs a showdown, splits ties, and includes carry-over in the main pot', () => {
    const a = player(0, 0, { totalCommitted: 100, holeCards: parseCards('Ah Kh') })
    const b = player(1, 0, { totalCommitted: 100, holeCards: parseCards('Ad Kd') })
    const c = player(2, 0, { totalCommitted: 100, holeCards: parseCards('2h 3d') })
    const s = baseState([a, b, c], { pot: 300 + 100, carryOverIn: 100, community: parseCards('Qc Jc 7s 8d 9s') })
    s.rules = { mode: 'blind', holeCards: 2, decisionMode: 'playOrFold', fixedWager: 100, tableFeeRate: 0.02 }
    const events: GameEvent[] = []
    settle(s, events, { showdown: true })
    // total 400, fee 8, 392 split between a and b: 196 each
    expect(s.result!.fee).toBe(8)
    expect(a.stack).toBe(196)
    expect(b.stack).toBe(196)
    expect(c.stack).toBe(0)
    expect(s.result!.showdown!.map((h) => h.category)).toEqual([HandCategory.HIGH_CARD, HandCategory.HIGH_CARD, HandCategory.HIGH_CARD])
    expect(events.map((e) => e.type)).toEqual(['SHOWDOWN', 'SETTLEMENT', 'HAND_COMPLETE'])
  })
})

describe('carryOverAll', () => {
  it('moves the whole pot to carryOverOut with no fee', () => {
    const a = player(0, 900, { totalCommitted: 100 })
    const s = baseState([a], { pot: 250, carryOverIn: 150 })
    const events: GameEvent[] = []
    carryOverAll(s, events)
    expect(s.result!.carryOverOut).toBe(250)
    expect(s.result!.fee).toBe(0)
    expect(a.stack).toBe(900)
    expect(s.phase).toBe('COMPLETE')
  })
})
