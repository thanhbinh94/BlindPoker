import { describe, expect, it } from 'vitest'
import { parseChaosCatalogue } from './catalogue.js'
import { CHAOS_CARDS_SPEC } from './fixtures.js'

/** Spec §5.1–§5.3, in table order. */
const SPEC_IDS = {
  silver: [
    's_swap_one', 's_luck_1', 's_high_card', 's_suited', 's_redeal_weak', 's_peek_1', 's_free_fold', 's_insure_half',
    's_shield', 's_rescue', 's_charge', 's_steal_one', 's_lower', 's_blindfold', 's_freeze_one', 's_crit', 's_fortune',
    's_level',
  ],
  gold: [
    'g_swap_all', 'g_luck_3', 'g_extra_card', 'g_peek_3', 'g_borrow', 'g_insure_full', 'g_shield_3', 'g_rescue', 'g_farm',
    'g_steal_all', 'g_redeal_board_1', 'g_freeze_all', 'g_crit', 'g_fortune', 'g_level',
  ],
  diamond: [
    'd_pick_3', 'd_luck_5', 'd_extra_card_3', 'd_peek_5', 'd_insure_2', 'd_mirror', 'd_rescue', 'd_swap_hands', 'd_storm',
    'd_reverse', 'd_crit', 'd_fortune', 'd_gambler', 'd_level',
  ],
} as const

/** The ✱ cards of spec §5: play-or-fold tables only. */
const STARRED = ['s_peek_1', 's_free_fold', 's_blindfold', 'g_peek_3', 'd_peek_5']

const raw = (): Record<string, unknown>[] => JSON.parse(JSON.stringify(CHAOS_CARDS_SPEC)) as Record<string, unknown>[]

describe('the spec catalogue (fixtures)', () => {
  it('carries the 47 cards of spec §5 — 18 silver, 15 gold, 14 diamond — with exactly those ids', () => {
    expect(CHAOS_CARDS_SPEC).toHaveLength(47)
    for (const tier of ['silver', 'gold', 'diamond'] as const) {
      expect(CHAOS_CARDS_SPEC.filter((c) => c.tier === tier).map((c) => c.id)).toEqual([...SPEC_IDS[tier]])
    }
  })

  it('marks only the ✱ cards as play-or-fold only, and every card is on by default', () => {
    for (const c of CHAOS_CARDS_SPEC) {
      expect(c.modes, c.id).toEqual(STARRED.includes(c.id) ? ['playOrFold'] : ['playOrFold', 'none'])
      expect(c.enabled, c.id).toBe(true)
    }
  })

  it('pins the numbers the spec names', () => {
    const byId = new Map(CHAOS_CARDS_SPEC.map((c) => [c.id, c]))
    expect(byId.get('g_luck_3')).toMatchObject({ effect: 'bestOfN', params: { sets: 2, hands: 3 }, timing: 'deal' })
    expect(byId.get('d_pick_3')).toMatchObject({ effect: 'bestOfN', params: { sets: 3, hands: 1 } })
    expect(byId.get('s_crit')).toMatchObject({ effect: 'crit', params: { p2: 20, p3: 0, hands: 3 }, timing: 'reveal' })
    expect(byId.get('g_crit')!.params).toEqual({ p2: 25, p3: 10, hands: 3 })
    expect(byId.get('d_crit')!.params).toEqual({ p2: 30, p3: 15, hands: 3 })
    expect(byId.get('s_rescue')).toMatchObject({ effect: 'rescue', params: { multiplier: 5 }, timing: 'wait' })
    expect(byId.get('g_rescue')!.params).toEqual({ multiplier: 10 })
    expect(byId.get('d_rescue')!.params).toEqual({ multiplier: 20 })
    expect(byId.get('s_charge')).toMatchObject({ effect: 'chaosPoints', params: { points: 3 }, timing: 'now' })
    expect(byId.get('s_level')).toMatchObject({ effect: 'levelUp', params: { count: 1, tier: 2 }, timing: 'now' })
    expect(byId.get('g_level')!.params).toEqual({ count: 1, tier: 3 })
    expect(byId.get('d_level')!.params).toEqual({ count: 2 })
    expect(byId.get('s_insure_half')!.params).toEqual({ percent: 50, hands: 1 })
    expect(byId.get('d_insure_2')!.params).toEqual({ percent: 100, hands: 2 })
    expect(byId.get('g_farm')).toMatchObject({ effect: 'farm', params: { hands: 5 } })
    expect(byId.get('d_storm')).toMatchObject({ effect: 'redealBoard', params: { count: 5 }, debuff: false })
    // Thần tài (spec §5.5): mN = × wager, cN = prize cards, tN = their tier (1 silver, 2 gold, 3 diamond)
    expect(byId.get('s_fortune')!.params).toEqual({ m2: 2, m4: 4, c4: 1, t4: 1, m6: 6, c6: 1, t6: 2 })
    expect(byId.get('g_fortune')!.params).toEqual({ m2: 4, m4: 8, c4: 1, t4: 2, m6: 12, c6: 2, t6: 2 })
    expect(byId.get('d_fortune')!.params).toEqual({ m2: 8, c2: 1, t2: 1, m4: 15, c4: 1, t4: 3, m6: 20, c6: 2, t6: 3 })
    const debuffs = CHAOS_CARDS_SPEC.filter((c) => c.debuff).map((c) => c.id)
    expect(debuffs).toEqual(['s_steal_one', 's_lower', 's_blindfold', 's_freeze_one', 'g_steal_all', 'g_freeze_all', 'd_swap_hands'])
  })
})

describe('parseChaosCatalogue', () => {
  it('accepts the spec catalogue as data', () => {
    expect(parseChaosCatalogue(raw())).toEqual(CHAOS_CARDS_SPEC)
  })

  it('refuses a duplicate id', () => {
    const cards = raw()
    cards[1] = { ...cards[1], id: cards[0]!.id }
    expect(() => parseChaosCatalogue(cards)).toThrow(/invalid chaos catalogue: .*duplicate id s_swap_one/)
  })

  it('refuses an unknown effect', () => {
    const cards = raw()
    cards[0] = { ...cards[0], effect: 'teleport' }
    expect(() => parseChaosCatalogue(cards)).toThrow(/invalid chaos catalogue: .*effect/)
  })

  it('refuses a tier with only 2 cards enabled for a pure-luck table', () => {
    // Leave s_swap_one and s_luck_1 plus the ✱ silver cards: 2 usable on a `none` table, 5 on play-or-fold.
    const keep = new Set(['s_swap_one', 's_luck_1', 's_peek_1', 's_free_fold', 's_blindfold'])
    const cards = raw().map((c) => (c.tier === 'silver' && !keep.has(c.id as string) ? { ...c, enabled: false } : c))
    expect(() => parseChaosCatalogue(cards)).toThrow(/invalid chaos catalogue: .*silver.*none/)
  })

  it('refuses tiers, timings, modes, params and flags outside the rules', () => {
    const broken: [string, Record<string, unknown>][] = [
      ['tier', { tier: 'bronze' }],
      ['timing', { timing: 'later' }],
      ['modes', { modes: ['holdem'] }],
      ['modes', { modes: [] }],
      ['params', { params: { hands: 1.5 } }],
      ['params', { params: { hands: '1' } }],
      ['debuff', { debuff: 'no' }],
      ['debuff', { debuff: true }], // s_swap_one is a buff
      ['enabled', { enabled: 1 }],
      ['id', { id: '' }],
      ['family', { family: 3 }],
    ]
    for (const [field, patch] of broken) {
      const cards = raw()
      cards[0] = { ...cards[0], ...patch }
      expect(() => parseChaosCatalogue(cards), field).toThrow(new RegExp(`invalid chaos catalogue: .*${field}`))
    }
  })

  it('refuses anything that is not an array of card objects', () => {
    expect(() => parseChaosCatalogue({ cards: [] })).toThrow(/invalid chaos catalogue/)
    expect(() => parseChaosCatalogue([null])).toThrow(/invalid chaos catalogue/)
  })
})
