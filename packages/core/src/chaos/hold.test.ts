import { describe, expect, it } from 'vitest'
import { seededRng } from '../cards/rng.js'
import { CHAOS_CARDS_SPEC } from './fixtures.js'
import { receiveCard, stackHeld, toChaosTableView, toHeld, toHeldCardView } from './hold.js'
import { EMPTY_CHAOS_SEAT, EMPTY_CHAOS_TABLE, type ChaosCardDef, type ChaosSeat, type ChaosTableState } from './types.js'

const card = (id: string): ChaosCardDef => {
  const c = CHAOS_CARDS_SPEC.find((x) => x.id === id)
  if (!c) throw new Error(`no card ${id}`)
  return c
}
const uids = (start = 1) => {
  let n = start
  return () => n++
}
const pool = CHAOS_CARDS_SPEC

function give(seat: ChaosSeat, ids: string[], seed = 1): ChaosSeat {
  const next = uids(100)
  const rng = seededRng(seed)
  return ids.reduce((s, id) => receiveCard(s, card(id), next, pool, 'playOrFold', rng).seat, seat)
}

describe('receiveCard', () => {
  it('holds a card as a numbered copy with its duration, or null for one-shot and wait cards', () => {
    const { seat, received } = receiveCard(EMPTY_CHAOS_SEAT, card('g_luck_3'), uids(7), pool, 'none', seededRng(1))
    expect(received.map((c) => c.id)).toEqual(['g_luck_3'])
    expect(seat.cards).toEqual([
      { uid: 7, cardId: 'g_luck_3', tier: 'gold', effect: 'bestOfN', params: { sets: 2, hands: 3 }, timing: 'deal', debuff: false, handsLeft: 3 },
    ])
    expect(give(EMPTY_CHAOS_SEAT, ['s_steal_one', 's_rescue', 'd_gambler']).cards.map((c) => c.handsLeft)).toEqual([null, null, null])
  })

  it('never changes the seat it was given', () => {
    const before = give(EMPTY_CHAOS_SEAT, ['s_luck_1'])
    const snapshot = JSON.stringify(before)
    receiveCard(before, card('g_luck_3'), uids(), pool, 'none', seededRng(1))
    receiveCard(before, card('s_charge'), uids(), pool, 'none', seededRng(1))
    expect(JSON.stringify(before)).toBe(snapshot)
    expect(EMPTY_CHAOS_SEAT.cards).toEqual([])
  })

  it('a Silver levelUp yields one Gold card and never another levelUp', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { seat, received } = receiveCard(EMPTY_CHAOS_SEAT, card('s_level'), uids(), pool, 'playOrFold', seededRng(seed))
      expect(received[0]!.id).toBe('s_level')
      expect(received).toHaveLength(2)
      expect(received[1]!.tier).toBe('gold')
      expect(received[1]!.effect).not.toBe('levelUp')
      expect(seat.cards).toHaveLength(1)
      expect(seat.cards[0]!.cardId).toBe(received[1]!.id)
    }
  })

  it('a Gold levelUp yields one Diamond card', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { received } = receiveCard(EMPTY_CHAOS_SEAT, card('g_level'), uids(), pool, 'playOrFold', seededRng(seed))
      expect(received.slice(1).map((c) => c.tier)).toEqual(['diamond'])
      expect(received[1]!.effect).not.toBe('levelUp')
    }
  })

  it('a Diamond levelUp yields two cards of any tier, none of them a levelUp', () => {
    const tiers = new Set<string>()
    // One card per effect, so the stacking rule (spec §3.4) never drops the second draw as a lower-tier duplicate of the
    // first — under the 50/35/15 tiers (BP-41) some seeds in this range would draw one.
    const onePerEffect = pool.filter((c, i) => pool.findIndex((x) => x.effect === c.effect) === i)
    for (let seed = 1; seed <= 80; seed++) {
      const { received } = receiveCard(EMPTY_CHAOS_SEAT, card('d_level'), uids(), onePerEffect, 'none', seededRng(seed))
      expect(received[0]!.id).toBe('d_level')
      const got = received.slice(1)
      expect(got).toHaveLength(2)
      for (const c of got) {
        expect(c.effect).not.toBe('levelUp')
        expect(c.modes).toContain('none')
        tiers.add(c.tier)
      }
    }
    expect([...tiers].sort()).toEqual(['diamond', 'gold', 'silver'])
  })

  it('a levelUp draws only cards of weight above 0', () => {
    const weights = new Map(CHAOS_CARDS_SPEC.filter((c) => c.tier === 'gold' && c.id !== 'g_extra_card').map((c) => [c.id, 0]))
    for (let seed = 1; seed <= 20; seed++) {
      const { received } = receiveCard(EMPTY_CHAOS_SEAT, card('s_level'), uids(), pool, 'none', seededRng(seed), weights)
      expect(received.map((c) => c.id)).toEqual(['s_level', 'g_extra_card'])
    }
  })

  it('a Gold bestOfN replaces a Silver one, Gold on Gold adds hands, Silver after Gold is dropped', () => {
    const goldOverSilver = give(EMPTY_CHAOS_SEAT, ['s_luck_1', 'g_luck_3'])
    expect(goldOverSilver.cards.map((c) => [c.cardId, c.handsLeft])).toEqual([['g_luck_3', 3]])

    const goldTwice = give(EMPTY_CHAOS_SEAT, ['g_luck_3', 'g_luck_3'])
    expect(goldTwice.cards.map((c) => [c.cardId, c.handsLeft])).toEqual([['g_luck_3', 6]])

    const { seat, received } = receiveCard(goldTwice, card('s_luck_1'), uids(), pool, 'none', seededRng(1))
    expect(received).toEqual([])
    expect(seat.cards.map((c) => [c.cardId, c.handsLeft])).toEqual([['g_luck_3', 6]])
  })

  it('another card of the same effect and tier replaces the held one with its own params: d_pick_3 then d_luck_5, and back', () => {
    // Plan 37 final wave (ledger ruling): only the same card adds hands. Adding d_luck_5's five hands to d_pick_3's
    // three sets would make a card stronger than either.
    const luckOverPick = give(EMPTY_CHAOS_SEAT, ['d_pick_3', 'd_luck_5'])
    expect(luckOverPick.cards.map((c) => [c.cardId, c.params, c.handsLeft])).toEqual([['d_luck_5', { sets: 2, hands: 5 }, 5]])
    const pickOverLuck = give(EMPTY_CHAOS_SEAT, ['d_luck_5', 'd_pick_3'])
    expect(pickOverLuck.cards.map((c) => [c.cardId, c.params, c.handsLeft])).toEqual([['d_pick_3', { sets: 3, hands: 1 }, 1]])
    expect(pickOverLuck.cards[0]!.uid).toBe(101) // a new copy (the first card was 100), not the old one renamed
  })

  it('keeps every copy of a one-shot card, and cards of different effects side by side', () => {
    const seat = give(EMPTY_CHAOS_SEAT, ['s_steal_one', 's_steal_one', 's_luck_1', 's_crit'])
    expect(seat.cards.map((c) => c.cardId)).toEqual(['s_steal_one', 's_steal_one', 's_luck_1', 's_crit'])
    expect(new Set(seat.cards.map((c) => c.uid)).size).toBe(4)
  })

  it('chaosPoints adds 3 points and holds nothing', () => {
    const { seat, received } = receiveCard({ ...EMPTY_CHAOS_SEAT, points: 4 }, card('s_charge'), uids(), pool, 'none', seededRng(1))
    expect(seat.points).toBe(7)
    expect(seat.cards).toEqual([])
    expect(received.map((c) => c.id)).toEqual(['s_charge'])
  })
})

describe('toHeldCardView', () => {
  it('shows only what the table may see', () => {
    const held = give(EMPTY_CHAOS_SEAT, ['g_crit']).cards[0]!
    expect(toHeldCardView(held)).toEqual({ uid: held.uid, cardId: 'g_crit', tier: 'gold', handsLeft: 3 })
  })

  it('BP-41: carries the card’s charge when it keeps one (Cá chép’s energy), and no charge field otherwise', () => {
    const held = give(EMPTY_CHAOS_SEAT, ['g_crit']).cards[0]!
    expect(toHeldCardView({ ...held, charge: 42 })).toEqual({ uid: held.uid, cardId: 'g_crit', tier: 'gold', handsLeft: 3, charge: 42 })
    expect('charge' in toHeldCardView(held)).toBe(false)
  })
})

describe('toChaosTableView (BP-41)', () => {
  it('shows the reign, the curse and the bombs by seat, never a player id', () => {
    const table: ChaosTableState = {
      god: { seat: 2, playerId: 'p2', isBot: false, handsLeft: 4, curse: 3 },
      demigods: [{ seat: 0, playerId: 'p0', isBot: true, handsLeft: 5 }],
      bombs: [{ owner: 1, carrier: 3, handsLeft: 2, cardId: 'd_bomb', uid: 9 }],
    }
    const view = toChaosTableView(table)
    expect(view).toEqual({
      god: { seat: 2, handsLeft: 4, curse: 3 },
      demigods: [{ seat: 0, handsLeft: 5 }],
      bombs: [{ owner: 1, carrier: 3, handsLeft: 2 }],
    })
    expect(JSON.stringify(view)).not.toMatch(/p[0-3]|playerId|uid/)
    expect(toChaosTableView(EMPTY_CHAOS_TABLE)).toEqual({ god: null, demigods: [], bombs: [] })
  })
})

describe('stackHeld — a played bonus card joins the held cards (BP-39)', () => {
  it('follows receiveCard: push, the same card adds its hands, a peer or higher tier replaces under its own uid, a lower tier is dropped', () => {
    const held = [toHeld(card('s_crit'), 1), toHeld(card('g_luck_3'), 2)]
    expect(stackHeld(held, toHeld(card('g_farm'), 9))!.map((c) => [c.uid, c.cardId, c.handsLeft])).toEqual([[1, 's_crit', 3], [2, 'g_luck_3', 3], [9, 'g_farm', 5]])
    expect(stackHeld(held, toHeld(card('g_luck_3'), 9))!.map((c) => [c.uid, c.cardId, c.handsLeft])).toEqual([[1, 's_crit', 3], [2, 'g_luck_3', 6]])
    expect(stackHeld(held, toHeld(card('d_luck_5'), 9))!.map((c) => [c.uid, c.cardId, c.handsLeft])).toEqual([[1, 's_crit', 3], [9, 'd_luck_5', 5]])
    expect(stackHeld(held, toHeld(card('g_crit'), 9))!.map((c) => [c.uid, c.cardId])).toEqual([[9, 'g_crit'], [2, 'g_luck_3']])
    expect(stackHeld(held, toHeld(card('s_luck_1'), 9))).toBeNull()
    expect(held.map((c) => c.uid)).toEqual([1, 2])
  })
})
