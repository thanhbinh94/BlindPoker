import { describe, expect, it } from 'vitest'
import { toChaosTableView } from '../chaos/hold.js'
import { EMPTY_CHAOS_TABLE, type ChaosDebit, type ChaosHandState, type ChaosTableState } from '../chaos/types.js'
import type { GameEvent } from '../hand/types.js'
import type { ChaosSnapshot, RoomEvent, ServerMessage } from './messages.js'

/**
 * BP-41 (chaos round three): the protocol's new shapes, as fixtures the compiler checks. No new client message: the Thần,
 * the dice and the bomb are all the server's to tell.
 */
describe('BP-41 protocol fixtures', () => {
  const table: ChaosTableState = {
    god: { seat: 1, playerId: 'p1', isBot: false, handsLeft: 5, curse: 1, cardId: 'd_carp', uid: 7, params: {} },
    demigods: [{ seat: 3, playerId: 'p3', isBot: true, handsLeft: 2, cardId: 'd_carp', uid: 8, params: {} }],
    bombs: [{ owner: 0, carrier: 2, handsLeft: 1, cardId: 'd_bomb', uid: 4 }],
  }

  it('the herald, the dice, the table state and a ×5 crit are room events', () => {
    const events: RoomEvent[] = [
      { type: 'CHAOS_HERALD', kind: 'god', seat: 1, playerId: 'p1' },
      { type: 'CHAOS_HERALD', kind: 'godslain', seat: 2, playerId: 'p2' },
      { type: 'CHAOS_DICE', seat: 0, cardId: 'd_dice', dice: [6, 6, 6], result: { jackpot: 60_000, cards: [{ tier: 'diamond', count: 2 }], triple: true, herald: true }, stack: 9_000 },
      { type: 'CHAOS_DICE', seat: 0, cardId: 'g_dice', dice: [1, 1], result: { burned: 1_000 }, stack: 8_000 },
      { type: 'CHAOS_STATE', seats: [{ seat: 0, cards: [{ uid: 1, cardId: 'd_carp', tier: 'diamond', handsLeft: null, charge: 35 }], points: 0, bonusCount: 0 }], table: toChaosTableView(table) },
      { type: 'CHAOS_CREDIT', seat: 1, amount: 4_000, stack: 12_000, reason: 'chaos_crit', capped: false, multiplier: 5 },
      { type: 'CHAOS_CREDIT', seat: 0, amount: 30_000, stack: 40_000, reason: 'chaos_jackpot', capped: false },
      { type: 'CHAOS_TABLE', table: toChaosTableView(table) },
      { type: 'CHAOS_STEAL', seat: 2, cardId: 'g_steal_points', outcome: 'reflected', targets: [1], from: 2, to: 1, amount: 5, spent: [{ seat: 1, cardId: 'd_mirror' }] },
    ]
    const frames: ServerMessage[] = events.map((event, seq) => ({ t: 'ROOM_EVENT', seq, event }))
    expect(JSON.parse(JSON.stringify(frames))).toEqual(frames)
    // The public table view never carries a player id.
    expect(JSON.stringify((events[4] as Extract<RoomEvent, { type: 'CHAOS_STATE' }>).table)).not.toContain('playerId')
  })

  it('a reconnect snapshot may carry the table; a hand event may carry dice, the no-fold seats and per-seat calls', () => {
    const snapshot: ChaosSnapshot = { draft: null, table: toChaosTableView(EMPTY_CHAOS_TABLE) }
    expect(snapshot.table).toEqual({ god: null, demigods: [], bombs: [] })
    const events: GameEvent[] = [
      { type: 'CHAOS_APPLIED', seat: 0, cardId: 'g_fate_die', effect: 'fateDie', targets: [], outcome: 'applied', dice: [5] },
      { type: 'DECISION_PHASE', seats: [0, 1], turnSeq: 3, noFold: [1], calls: [{ seat: 0, amount: 4_000 }] },
      { type: 'DECISION_PHASE', seats: [0, 1], turnSeq: 4 },
    ]
    expect(events).toHaveLength(3)
    const debit: ChaosDebit = { seat: 0, amount: 1_000, reason: 'chaos_dice', cardId: 'g_dice', uid: 7 }
    const titles: NonNullable<ChaosHandState['titles']> = [{ seat: 1, ascended: true }, { seat: 2, slew: 1 }]
    const outcomes: NonNullable<ChaosHandState['outcomes']> = { fateCrit: [0], duelWins: [], dethroned: [2], acesDealt: [] }
    expect([debit, titles, outcomes]).toHaveLength(3)
  })
})
