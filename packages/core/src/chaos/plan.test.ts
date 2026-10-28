import { describe, expect, it } from 'vitest'
import { seededRng } from '../cards/rng.js'
import type { BlindRules } from '../hand/types.js'
import { CHAOS_CARDS_SPEC } from './fixtures.js'
import { receiveCard, toHeld } from './hold.js'
import { GAMBLER_EXCLUDED, planHand } from './plan.js'
import { EMPTY_CHAOS_SEAT, EMPTY_CHAOS_TABLE, type ChaosCardDef, type ChaosSeat, type ChaosTableState } from './types.js'

const card = (id: string): ChaosCardDef => {
  const c = CHAOS_CARDS_SPEC.find((x) => x.id === id)
  if (!c) throw new Error(`no card ${id}`)
  return c
}
const pool = CHAOS_CARDS_SPEC
const counter = (start: number) => {
  let n = start
  return () => n++
}
const RULES: BlindRules = { mode: 'blind', holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1_000, tableFeeRate: 0 }
const LUCK: BlindRules = { ...RULES, decisionMode: 'none' }

let uid = 1
function holding(ids: string[], extra: Partial<ChaosSeat> = {}): ChaosSeat {
  const rng = seededRng(1)
  const next = () => uid++
  const seat = ids.reduce((s, id) => receiveCard(s, card(id), next, pool, 'playOrFold', rng).seat, EMPTY_CHAOS_SEAT)
  return { ...seat, ...extra }
}

function plan(chaos: Record<number, ChaosSeat>, rules = RULES, seed = 1, weights?: ReadonlyMap<string, number>) {
  const seats = Object.entries(chaos).map(([seat, c]) => ({ seat: Number(seat), isBot: false, chaos: c }))
  return planHand({ seats, rules, pool, rng: seededRng(seed), nextUid: counter(1_000), weights })
}
const effectsOf = (r: ReturnType<typeof plan>, seat: number) => r.plan.seats.find((s) => s.seat === seat)!
const ids = (r: ReturnType<typeof plan>, seat: number) => effectsOf(r, seat).effects.map((e) => e.cardId)

describe('planHand', () => {
  it('lists every seat of the hand, even one holding nothing', () => {
    const r = plan({ 0: EMPTY_CHAOS_SEAT, 3: EMPTY_CHAOS_SEAT })
    expect(r.plan).toEqual({
      seats: [
        { seat: 0, effects: [], shield: null, blindfolded: false },
        { seat: 3, effects: [], shield: null, blindfolded: false },
      ],
      reverse: false,
    })
    expect([...r.seats.keys()]).toEqual([0, 3])
  })

  it('a frozen seat fires nothing, not even its shield', () => {
    const r = plan({ 0: holding(['g_luck_3', 's_steal_one', 's_shield', 'd_reverse'], { frozenNextHand: true }), 1: EMPTY_CHAOS_SEAT })
    expect(effectsOf(r, 0)).toEqual({ seat: 0, effects: [], shield: null, blindfolded: false })
    expect(r.plan.reverse).toBe(false)
  })

  it('a seat holding two debuffs fires only the older', () => {
    const r = plan({ 0: holding(['s_lower', 's_steal_one', 's_freeze_one']), 1: EMPTY_CHAOS_SEAT, 2: EMPTY_CHAOS_SEAT })
    expect(ids(r, 0)).toEqual(['s_lower'])
  })

  it('fires one-shot buffs of different kinds together, and only the first of a kind', () => {
    const r = plan({ 0: holding(['g_borrow', 'g_redeal_board_1', 'g_borrow', 'g_luck_3', 's_crit']), 1: EMPTY_CHAOS_SEAT })
    expect(ids(r, 0)).toEqual(['g_borrow', 'g_redeal_board_1', 'g_luck_3', 's_crit'])
  })

  it('carries each fired card as it is held, with its uid', () => {
    const chaos = holding(['g_luck_3'])
    const r = plan({ 0: chaos, 1: EMPTY_CHAOS_SEAT })
    expect(effectsOf(r, 0).effects).toEqual([
      { uid: chaos.cards[0]!.uid, cardId: 'g_luck_3', effect: 'bestOfN', params: { sets: 2, hands: 3 }, timing: 'deal', debuff: false, targets: [] },
    ])
  })

  it('a duration card stops firing at 0 hands left', () => {
    const chaos = holding(['g_luck_3'])
    const spent = { ...chaos, cards: chaos.cards.map((c) => ({ ...c, handsLeft: 0 })) }
    expect(ids(plan({ 0: spent, 1: EMPTY_CHAOS_SEAT }), 0)).toEqual([])
  })

  it('freeze targets are other seats: one at random, or every opponent', () => {
    const seen = new Set<number>()
    for (let seed = 1; seed <= 40; seed++) {
      const r = plan({ 2: holding(['s_freeze_one']), 0: EMPTY_CHAOS_SEAT, 5: EMPTY_CHAOS_SEAT, 7: EMPTY_CHAOS_SEAT }, RULES, seed)
      const targets = effectsOf(r, 2).effects[0]!.targets
      expect(targets).toHaveLength(1)
      expect(targets).not.toContain(2)
      seen.add(targets[0]!)
    }
    expect([...seen].sort()).toEqual([0, 5, 7])
    const all = plan({ 2: holding(['g_freeze_all']), 0: EMPTY_CHAOS_SEAT, 5: EMPTY_CHAOS_SEAT, 7: EMPTY_CHAOS_SEAT })
    expect(effectsOf(all, 2).effects[0]!.targets).toEqual([0, 5, 7])
    const blind = plan({ 2: holding(['s_blindfold']), 4: EMPTY_CHAOS_SEAT })
    expect(effectsOf(blind, 2).effects[0]!.targets).toEqual([4])
  })

  it('leaves reveal debuffs and board cards without targets: the engine picks at reveal', () => {
    for (const id of ['s_steal_one', 's_lower', 'g_steal_all', 'd_swap_hands', 'g_borrow', 'd_storm']) {
      const r = plan({ 0: holding([id]), 1: EMPTY_CHAOS_SEAT, 2: EMPTY_CHAOS_SEAT })
      expect(effectsOf(r, 0).effects.map((e) => [e.cardId, e.targets]), id).toEqual([[id, []]])
    }
  })

  it('a play-or-fold-only card never fires on a pure-luck table', () => {
    const chaos = holding(['s_blindfold', 'g_peek_3', 's_free_fold', 's_lower'])
    expect(ids(plan({ 0: chaos, 1: EMPTY_CHAOS_SEAT }, LUCK), 0)).toEqual(['s_lower'])
    expect(ids(plan({ 0: chaos, 1: EMPTY_CHAOS_SEAT }, RULES), 0)).toEqual(['s_blindfold', 'g_peek_3', 's_free_fold'])
  })

  it('exposes a shield or mirror for the engine and never fires a wait card', () => {
    const r = plan({ 0: holding(['s_rescue', 'g_fortune', 'd_mirror', 's_shield']), 1: EMPTY_CHAOS_SEAT })
    const s = effectsOf(r, 0)
    expect(s.effects).toEqual([])
    expect(s.shield).toMatchObject({ cardId: 'd_mirror', kind: 'mirror' })
    expect(effectsOf(plan({ 0: holding(['g_shield_3']), 1: EMPTY_CHAOS_SEAT }), 0).shield).toMatchObject({ cardId: 'g_shield_3', kind: 'shield' })
  })

  it('prefers a lasting shield to an older one-shot, so the one-shot is kept for later (M1)', () => {
    const lastingSecond = effectsOf(plan({ 0: holding(['s_shield', 'g_shield_3']), 1: EMPTY_CHAOS_SEAT }), 0).shield
    expect(lastingSecond).toMatchObject({ cardId: 'g_shield_3', kind: 'shield', lasting: true })
    const lastingFirst = effectsOf(plan({ 0: holding(['g_shield_3', 'd_mirror']), 1: EMPTY_CHAOS_SEAT }), 0).shield
    expect(lastingFirst).toMatchObject({ cardId: 'g_shield_3', lasting: true })
    // two one-shots: still the oldest
    expect(effectsOf(plan({ 0: holding(['s_shield', 'd_mirror']), 1: EMPTY_CHAOS_SEAT }), 0).shield).toMatchObject({ cardId: 's_shield' })
  })

  it('tells the table about a reversed hand and a blindfolded seat', () => {
    const r = plan({ 0: holding(['d_reverse']), 1: { ...EMPTY_CHAOS_SEAT, blindfoldedNextHand: true } })
    expect(r.plan.reverse).toBe(true)
    expect(effectsOf(r, 1).blindfolded).toBe(true)
    expect(effectsOf(r, 0).blindfolded).toBe(false)
  })

  it('the gambler rolls one Silver or Gold effect per hand from the allowed set, under a fresh uid', () => {
    const banned = new Set(['rescue', 'fortune', 'levelUp', 'gambler'])
    const rolled = new Set<string>()
    for (let seed = 1; seed <= 300; seed++) {
      const chaos = holding(['d_gambler'])
      const r = plan({ 0: chaos, 1: EMPTY_CHAOS_SEAT }, LUCK, seed)
      const s = effectsOf(r, 0)
      const fired = [...s.effects, ...(s.shield ? [s.shield] : [])]
      expect(fired).toHaveLength(1)
      const def = card(fired[0]!.cardId)
      expect(['silver', 'gold']).toContain(def.tier)
      expect(banned.has(def.effect)).toBe(false)
      expect(def.modes).toContain('none')
      expect(fired[0]!.uid).toBeGreaterThanOrEqual(1_000)
      expect(r.seats.get(0)!.cards.map((c) => c.cardId)).toContain('d_gambler')
      rolled.add(def.id)
    }
    expect(rolled.size).toBeGreaterThan(15)
  })

  it('BP-41: the gambler never rolls a round-three card that waits, acts on receipt or at the end, carries a charge, or is a Kim cương rule', () => {
    // Every round-three card switched on (as Task 7b will ship them), and every card but the excluded ones weighted 0:
    // the roll finds nothing to fire.
    const allOn = CHAOS_CARDS_SPEC.map((c) => ({ ...c, enabled: true }))
    const excluded = allOn.filter((c) => GAMBLER_EXCLUDED.has(c.effect))
    expect(excluded.filter((c) => c.tier !== 'diamond').map((c) => c.id)).toEqual([
      's_rescue', 's_fortune', 's_level', 'g_rescue', 'g_fortune', 'g_level',
      's_tier_up', 's_master', 's_dice', 'g_aces_charge', 'g_flip_flop', 'g_steal_points', 'g_scapegoat', 'g_dice',
    ])
    for (const kind of ['carp', 'riskyHand', 'adventurer', 'shareWinnings', 'plunder', 'shuffleHoles', 'swapLeader', 'backfire', 'deluge', 'eclipse', 'wildCard', 'timeBomb'] as const) {
      expect(GAMBLER_EXCLUDED.has(kind), kind).toBe(true)
    }
    const onlyExcluded = new Map(allOn.filter((c) => !GAMBLER_EXCLUDED.has(c.effect)).map((c) => [c.id, 0]))
    for (const decisionMode of ['playOrFold', 'none'] as const) {
      for (let seed = 1; seed <= 30; seed++) {
        const seats = [{ seat: 0, isBot: false, chaos: holding(['d_gambler']) }, { seat: 1, isBot: false, chaos: EMPTY_CHAOS_SEAT }]
        const r = planHand({ seats, rules: { ...RULES, decisionMode }, pool: allOn, rng: seededRng(seed), nextUid: counter(1_000), weights: onlyExcluded })
        expect(effectsOf(r, 0)).toMatchObject({ effects: [], shield: null })
      }
    }
    // With the round-three cards on and nothing weighted out, a roll can land on one the gambler may use.
    const rolled = new Set<string>()
    for (let seed = 1; seed <= 400; seed++) {
      const seats = [{ seat: 0, isBot: false, chaos: holding(['d_gambler']) }, { seat: 1, isBot: false, chaos: EMPTY_CHAOS_SEAT }]
      const r = planHand({ seats, rules: RULES, pool: allOn, rng: seededRng(seed), nextUid: counter(1_000) })
      for (const e of effectsOf(r, 0).effects) {
        expect(GAMBLER_EXCLUDED.has(e.effect), e.cardId).toBe(false)
        rolled.add(e.cardId)
      }
    }
    expect([...rolled].some((id) => ['s_duel', 's_coin_flip', 'g_big_table', 'g_curse', 'g_win_tax'].includes(id))).toBe(true)
  })

  it("the gambler's roll respects the one-debuff rule and the weights", () => {
    const debuffOnly = new Map(CHAOS_CARDS_SPEC.filter((c) => !c.debuff).map((c) => [c.id, 0]))
    for (let seed = 1; seed <= 30; seed++) {
      const r = plan({ 0: holding(['s_lower', 'd_gambler']), 1: EMPTY_CHAOS_SEAT }, RULES, seed, debuffOnly)
      expect(ids(r, 0)).toEqual(['s_lower'])
    }
    const onlyCrit = new Map(CHAOS_CARDS_SPEC.filter((c) => c.id !== 'g_crit').map((c) => [c.id, 0]))
    expect(ids(plan({ 0: holding(['d_gambler']), 1: EMPTY_CHAOS_SEAT }, RULES, 3, onlyCrit), 0)).toEqual(['g_crit'])
  })

  it("adds a rolled chaosPoints card to the seat's points", () => {
    const onlyCharge = new Map(CHAOS_CARDS_SPEC.filter((c) => c.id !== 's_charge').map((c) => [c.id, 0]))
    const r = plan({ 0: holding(['d_gambler'], { points: 2 }), 1: EMPTY_CHAOS_SEAT }, RULES, 1, onlyCharge)
    expect(ids(r, 0)).toEqual(['s_charge'])
    expect(r.seats.get(0)!.points).toBe(5)
  })

  describe('a played bonus card (BP-39)', () => {
    const armedNext = (id: string, extra: Partial<ChaosSeat> = {}): ChaosSeat =>
      ({ ...holding([], extra), armed: { card: toHeld(card(id), uid++), hand: 'next' } })

    it('an armed debuff fires first, stays armed for this hand, and a held draft debuff waits', () => {
      const chaos = { ...armedNext('s_lower'), cards: holding(['s_steal_one', 'g_luck_3']).cards }
      const r = plan({ 0: chaos, 1: EMPTY_CHAOS_SEAT })
      expect(ids(r, 0)).toEqual(['s_lower', 'g_luck_3'])
      expect(effectsOf(r, 0).effects[0]!.uid).toBe(chaos.armed!.card.uid)
      expect(r.seats.get(0)).toEqual({ ...chaos, armed: { card: chaos.armed!.card, hand: 'this' }, bonusPlayedThisHand: true })
    })

    it('marks the hand as having had its bonus card on both paths, and not when the card does not play', () => {
      expect(plan({ 0: armedNext('g_borrow'), 1: EMPTY_CHAOS_SEAT }).seats.get(0)!.bonusPlayedThisHand).toBe(true)
      expect(plan({ 0: armedNext('g_luck_3'), 1: EMPTY_CHAOS_SEAT }).seats.get(0)!.bonusPlayedThisHand).toBe(true)
      expect(plan({ 0: armedNext('s_freeze_one'), 1: EMPTY_CHAOS_SEAT }).seats.get(0)!.bonusPlayedThisHand).toBe(true)
      expect(plan({ 0: armedNext('g_peek_3'), 1: EMPTY_CHAOS_SEAT }, LUCK).seats.get(0)!.bonusPlayedThisHand).toBe(false)
      const dropped = { ...armedNext('s_luck_1'), cards: holding(['d_luck_5']).cards }
      expect(plan({ 0: dropped, 1: EMPTY_CHAOS_SEAT }).seats.get(0)!.bonusPlayedThisHand).toBe(false)
      expect(plan({ 0: holding(['g_luck_3']), 1: EMPTY_CHAOS_SEAT }).seats.get(0)!.bonusPlayedThisHand).toBe(false)
    })

    it('a card armed for a hand that never settled goes back to the bonus hand unfired, and the marker clears', () => {
      const lower = toHeld(card('s_lower'), 0)
      const steal = toHeld(card('s_steal_one'), uid++)
      const leftover: ChaosSeat = { ...holding([]), bonus: [lower], armed: { card: steal, hand: 'this' }, bonusPlayedThisHand: true }
      const r = plan({ 0: leftover, 1: EMPTY_CHAOS_SEAT })
      expect(ids(r, 0)).toEqual([])
      expect(r.seats.get(0)).toMatchObject({ armed: null, bonus: [lower, steal], bonusPlayedThisHand: false })
      // also on a frozen seat
      const frozen = plan({ 0: { ...leftover, frozenNextHand: true }, 1: EMPTY_CHAOS_SEAT })
      expect(frozen.seats.get(0)).toMatchObject({ armed: null, bonus: [lower, steal], bonusPlayedThisHand: false })
    })

    it('an armed decision card fires from armed too', () => {
      const chaos = armedNext('g_peek_3')
      const r = plan({ 0: chaos, 1: EMPTY_CHAOS_SEAT })
      expect(ids(r, 0)).toEqual(['g_peek_3'])
      expect(r.seats.get(0)!.armed).toEqual({ card: chaos.armed!.card, hand: 'this' })
    })

    it('an armed duration card joins the held cards under the stacking rule and fires from there', () => {
      const r = plan({ 0: armedNext('g_luck_3'), 1: EMPTY_CHAOS_SEAT })
      expect(ids(r, 0)).toEqual(['g_luck_3'])
      expect(r.seats.get(0)!.armed).toBeNull()
      expect(r.seats.get(0)!.cards.map((c) => [c.cardId, c.handsLeft])).toEqual([['g_luck_3', 3]])

      const stacked = plan({ 0: { ...armedNext('g_luck_3'), cards: holding(['g_luck_3']).cards }, 1: EMPTY_CHAOS_SEAT })
      expect(stacked.seats.get(0)!.cards.map((c) => [c.cardId, c.handsLeft])).toEqual([['g_luck_3', 6]])

      const farm = plan({ 0: armedNext('g_farm'), 1: EMPTY_CHAOS_SEAT })
      expect(farm.seats.get(0)!.farmHandsLeft).toBe(5)
    })

    it('an armed deal-time debuff joins the front of the held cards, so it fires before a held draft debuff', () => {
      const chaos = { ...armedNext('s_freeze_one'), cards: holding(['s_steal_one']).cards }
      const r = plan({ 0: chaos, 1: EMPTY_CHAOS_SEAT })
      expect(effectsOf(r, 0).effects.map((e) => [e.cardId, e.targets])).toEqual([['s_freeze_one', [1]]])
      expect(r.seats.get(0)!.cards.map((c) => c.cardId)).toEqual(['s_freeze_one', 's_steal_one'])
      expect(r.seats.get(0)!.armed).toBeNull()
    })

    it('an armed duration card that a stronger held card would drop goes back to the bonus hand', () => {
      const chaos = { ...armedNext('s_luck_1'), cards: holding(['d_luck_5']).cards, bonus: [toHeld(card('s_lower'), 0)] }
      const r = plan({ 0: chaos, 1: EMPTY_CHAOS_SEAT })
      expect(ids(r, 0)).toEqual(['d_luck_5'])
      expect(r.seats.get(0)!.armed).toBeNull()
      expect(r.seats.get(0)!.bonus.map((c) => c.cardId)).toEqual(['s_lower', 's_luck_1'])
    })

    it('a frozen seat leaves its armed card untouched', () => {
      const chaos = armedNext('s_lower', { frozenNextHand: true })
      const r = plan({ 0: chaos, 1: EMPTY_CHAOS_SEAT })
      expect(ids(r, 0)).toEqual([])
      expect(r.seats.get(0)).toBe(chaos)
    })

    it('an armed card the table mode excludes does not fire and waits as this hand, to go back to the bonus hand', () => {
      const chaos = armedNext('g_peek_3')
      const r = plan({ 0: chaos, 1: EMPTY_CHAOS_SEAT }, LUCK)
      expect(ids(r, 0)).toEqual([])
      expect(r.seats.get(0)!.armed).toEqual({ card: chaos.armed!.card, hand: 'this' })
    })
  })

  it('draws the same plan from the same seed and never changes its input', () => {
    const chaos = { 0: holding(['s_freeze_one', 'd_gambler']), 1: EMPTY_CHAOS_SEAT, 2: EMPTY_CHAOS_SEAT }
    const snapshot = JSON.stringify(chaos)
    expect(plan(chaos, RULES, 9).plan).toEqual(plan(chaos, RULES, 9).plan)
    expect(JSON.stringify(chaos)).toBe(snapshot)
  })

  describe('BP-41 plumbing', () => {
    const DICE: ChaosCardDef = {
      id: 'x_dice', tier: 'silver', family: 'dice', effect: 'fortuneDice', params: { dice: 1 }, timing: 'end',
      modes: ['playOrFold', 'none'], debuff: false, enabled: true,
    }

    it('an end-of-hand card (the dice) never fires at the plan, like a wait card (A10)', () => {
      const chaos = { ...holding(['g_luck_3']), cards: [toHeld(DICE, 77), ...holding(['g_luck_3']).cards] }
      const r = planHand({ seats: [{ seat: 0, isBot: false, chaos }, { seat: 1, isBot: false, chaos: EMPTY_CHAOS_SEAT }], rules: RULES, pool: [...pool, DICE], rng: seededRng(1), nextUid: counter(1_000) })
      expect(ids(r, 0)).toEqual(['g_luck_3'])
    })

    it('takes the table state in and gives it back (A3); absent, the table is empty', () => {
      expect(plan({ 0: EMPTY_CHAOS_SEAT, 1: EMPTY_CHAOS_SEAT }).table).toEqual(EMPTY_CHAOS_TABLE)
      const table: ChaosTableState = {
        god: { seat: 1, playerId: 'p1', isBot: false, handsLeft: 5, curse: 2 },
        demigods: [],
        bombs: [{ owner: 0, carrier: 1, handsLeft: 3, cardId: 'x_bomb', uid: 5 }],
      }
      const r = planHand({ seats: [{ seat: 0, isBot: false, chaos: EMPTY_CHAOS_SEAT }, { seat: 1, isBot: false, chaos: EMPTY_CHAOS_SEAT }], rules: RULES, pool, rng: seededRng(1), nextUid: counter(1), table })
      expect(r.table).toEqual(table)
      expect(r.plan.noFoldSeats).toBeUndefined()
    })
  })
})
