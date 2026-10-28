import { describe, expect, it } from 'vitest'
import { armBonus, canInsertThisHand, clearUnsettledHand, MID_HAND_EFFECTS, needsNoPress, returnToBonus } from './bonus.js'
import { CHAOS_CARDS_SPEC } from './fixtures.js'
import { toHeld } from './hold.js'
import { EMPTY_CHAOS_SEAT, type ChaosCardDef, type ChaosHandPlan, type ChaosSeat, type HeldCard } from './types.js'

const card = (id: string): ChaosCardDef => {
  const c = CHAOS_CARDS_SPEC.find((x) => x.id === id)
  if (!c) throw new Error(`no card ${id}`)
  return c
}
let uid = 1
const held = (id: string): HeldCard => toHeld(card(id), uid++)
const withBonus = (ids: string[], extra: Partial<ChaosSeat> = {}): ChaosSeat => ({ ...EMPTY_CHAOS_SEAT, bonus: ids.map(held), ...extra })
const planSeat = (ids: string[]): ChaosHandPlan['seats'][number] => ({
  seat: 0,
  effects: ids.map((id) => {
    const h = held(id)
    return { uid: h.uid, cardId: h.cardId, effect: h.effect, params: h.params, timing: h.timing, debuff: h.debuff, targets: [] }
  }),
  shield: null,
  blindfolded: false,
})
const DECISION = { phase: 'decision', frozen: false } as const

describe('armBonus', () => {
  it('between hands arms any card for the next hand and takes it out of the bonus hand', () => {
    const seat = withBonus(['s_steal_one', 's_luck_1'])
    const [steal, luck] = seat.bonus
    const r = armBonus(seat, steal!.uid, { phase: 'between' })
    expect(r).toEqual({ seat: { ...seat, bonus: [luck], armed: { card: steal, hand: 'next' } }, armed: { card: steal, hand: 'next' } })
  })

  it('during the choice a one-shot reveal card applies to this hand, a deal card to the next', () => {
    for (const id of ['s_steal_one', 's_lower', 'd_swap_hands', 'g_redeal_board_1', 'd_storm', 'g_borrow', 'g_steal_all']) {
      const seat = withBonus([id])
      expect(armBonus(seat, seat.bonus[0]!.uid, DECISION), id).toMatchObject({ armed: { hand: 'this' } })
    }
    for (const id of ['s_luck_1', 's_freeze_one', 'd_reverse', 'g_farm']) {
      const seat = withBonus([id])
      expect(armBonus(seat, seat.bonus[0]!.uid, DECISION), id).toMatchObject({ armed: { hand: 'next' } })
    }
  })

  it('Bảo hiểm, Bạo kích and the decision cards pressed mid-hand apply next hand (Ruling 3)', () => {
    for (const id of ['g_insure_full', 'g_crit', 's_peek_1', 's_free_fold']) {
      const seat = withBonus([id])
      expect(armBonus(seat, seat.bonus[0]!.uid, DECISION), id).toMatchObject({ armed: { hand: 'next' } })
    }
    expect([...MID_HAND_EFFECTS].sort()).toEqual(['borrowHole', 'lowerHole', 'redealBoard', 'stealHole', 'swapHands'])
  })

  it('applies next hand when the live plan seat fired a deal-time debuff or plans the same effect (A2)', () => {
    const seat = withBonus(['s_steal_one'])
    const steal = seat.bonus[0]!.uid
    expect(armBonus(seat, steal, { ...DECISION, planSeat: planSeat(['s_freeze_one']) })).toMatchObject({ armed: { hand: 'next' } })
    expect(armBonus(seat, steal, { ...DECISION, planSeat: planSeat(['s_blindfold']) })).toMatchObject({ armed: { hand: 'next' } })
    expect(armBonus(seat, steal, { ...DECISION, planSeat: planSeat(['g_steal_all']) })).toMatchObject({ armed: { hand: 'next' } })
    // another reveal debuff is replaced at insertion, so the pressed one still applies this hand
    expect(armBonus(seat, steal, { ...DECISION, planSeat: planSeat(['s_lower', 'g_luck_3']) })).toMatchObject({ armed: { hand: 'this' } })
  })

  it('once a bonus card was played into this hand, a second pressed during its choice waits for the next hand', () => {
    const seat = withBonus(['s_steal_one'], { bonusPlayedThisHand: true })
    expect(armBonus(seat, seat.bonus[0]!.uid, DECISION)).toMatchObject({ armed: { hand: 'next' } })
    expect(armBonus(seat, seat.bonus[0]!.uid, { phase: 'between' })).toMatchObject({ armed: { hand: 'next' } })
  })

  it('canInsertThisHand: a one-shot reveal card, no deal-time debuff fired, no same effect planned', () => {
    expect(canInsertThisHand(undefined, 'stealHole')).toBe(true)
    expect(canInsertThisHand(planSeat(['s_lower', 'g_crit']), 'stealHole')).toBe(true)
    expect(canInsertThisHand(planSeat(['s_freeze_one']), 'redealBoard')).toBe(false)
    expect(canInsertThisHand(planSeat(['g_borrow']), 'borrowHole')).toBe(false)
    expect(canInsertThisHand(undefined, 'refundStake')).toBe(false)
    expect(canInsertThisHand(undefined, 'peekBoard')).toBe(false)
  })

  it('one armed card at a time', () => {
    const seat = withBonus(['s_steal_one', 's_lower'])
    const first = armBonus(seat, seat.bonus[0]!.uid, { phase: 'between' })
    if ('error' in first) throw new Error(first.error)
    expect(armBonus(first.seat, seat.bonus[1]!.uid, { phase: 'between' })).toEqual({ error: 'ALREADY_ARMED' })
    expect(armBonus(first.seat, seat.bonus[1]!.uid, DECISION)).toEqual({ error: 'ALREADY_ARMED' })
  })

  it('refuses a uid not in the bonus hand, including a held or armed card', () => {
    const seat = withBonus(['s_steal_one'], { cards: [held('s_lower')] })
    expect(armBonus(seat, 99_999, { phase: 'between' })).toEqual({ error: 'NO_CARD' })
    expect(armBonus(seat, seat.cards[0]!.uid, { phase: 'between' })).toEqual({ error: 'NO_CARD' })
  })

  it('a seat frozen this hand cannot play a card during the choice', () => {
    const seat = withBonus(['s_steal_one'])
    expect(armBonus(seat, seat.bonus[0]!.uid, { phase: 'decision', frozen: true })).toEqual({ error: 'FROZEN' })
  })

  it('refuses a duration card weaker than the held one of the same effect (Ruling 2)', () => {
    const seat = withBonus(['s_luck_1', 'd_luck_5', 'g_luck_3'], { cards: [held('g_luck_3')] })
    const [silver, diamond, gold] = seat.bonus
    expect(armBonus(seat, silver!.uid, { phase: 'between' })).toEqual({ error: 'WEAKER_HELD' })
    expect(armBonus(seat, diamond!.uid, { phase: 'between' })).toMatchObject({ armed: { card: diamond } })
    expect(armBonus(seat, gold!.uid, { phase: 'between' })).toMatchObject({ armed: { card: gold } })
  })

  it('never changes its input', () => {
    const seat = withBonus(['s_steal_one', 's_lower'])
    const snapshot = JSON.stringify(seat)
    armBonus(seat, seat.bonus[0]!.uid, DECISION)
    expect(JSON.stringify(seat)).toBe(snapshot)
  })
})

describe('needsNoPress and returnToBonus', () => {
  it('the wait and on-receipt cards need no press; every other card does', () => {
    const noPress = CHAOS_CARDS_SPEC.filter(needsNoPress).map((c) => c.effect)
    expect([...new Set(noPress)].sort()).toEqual([
      'carp', 'chaosPoints', 'fortune', 'fortuneDice', 'levelUp', 'master', 'mirror', 'rescue', 'scapegoat', 'shield', 'stealPoints', 'tierUp',
    ])
  })

  it('BP-41 Ruling 5: an end-of-hand card (the dice) needs no press either', () => {
    expect(needsNoPress({ timing: 'end' })).toBe(true)
    expect(needsNoPress({ timing: 'deal' })).toBe(false)
  })

  it('puts a card back at its old place, by uid', () => {
    const [a, b, c] = [held('s_lower'), held('s_steal_one'), held('g_borrow')]
    expect(returnToBonus([a!, c!], b!)).toEqual([a, b, c])
    expect(returnToBonus([b!, c!], a!)).toEqual([a, b, c])
    expect(returnToBonus([a!, b!], c!)).toEqual([a, b, c])
    expect(returnToBonus([], a!)).toEqual([a])
  })
})

describe('clearUnsettledHand (a cancelled hand, M4)', () => {
  it('a card armed for the cancelled hand goes back where it was, and the played marker clears', () => {
    const [a, b, c] = [held('s_lower'), held('s_steal_one'), held('g_borrow')]
    const seat = { ...EMPTY_CHAOS_SEAT, bonus: [a!, c!], armed: { card: b!, hand: 'this' as const }, bonusPlayedThisHand: true }
    expect(clearUnsettledHand(seat)).toMatchObject({ bonus: [a, b, c], armed: null, bonusPlayedThisHand: false })
  })

  it('a card the table was told of is spent, not returned (I1)', () => {
    const [a, b] = [held('s_lower'), held('d_storm')]
    const seat = { ...EMPTY_CHAOS_SEAT, bonus: [a!], armed: { card: b!, hand: 'this' as const } }
    expect(clearUnsettledHand(seat, new Set([b!.uid]))).toMatchObject({ bonus: [a], armed: null })
  })

  it('leaves a card armed for the next hand, and returns the same seat when nothing changes', () => {
    const seat = { ...EMPTY_CHAOS_SEAT, armed: { card: held('s_lower'), hand: 'next' as const } }
    expect(clearUnsettledHand(seat)).toBe(seat)
  })
})
