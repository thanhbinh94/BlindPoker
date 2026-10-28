import { describe, expect, it } from 'vitest'
import { parseChaosCatalogue } from './catalogue.js'
import { CHAOS_CARDS_SPEC } from './fixtures.js'
import { CHAOS_DEBUFF_EFFECTS, CHAOS_EFFECT_KINDS, CHAOS_TIERS } from './types.js'

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

/** BP-41 spec 2026-10-28 §6.3 Bạc, §6.2 Vàng, §6.1 Kim cương, in table order: id → effect. */
const ROUND_THREE = {
  silver: {
    s_tier_up: 'tierUp', s_no_fold: 'noFold', s_duel: 'duel', s_hawk_eye: 'hawkEye', s_coin_flip: 'coinFlip',
    s_master: 'master', s_loss_points: 'lossPoints', s_redeal_hole: 'redealHole', s_neighbour_swap: 'neighbourSwap',
    s_spoiler: 'spoiler', s_kindling: 'kindling', s_dice: 'fortuneDice',
  },
  gold: {
    g_aces_charge: 'acesCharge', g_flip_flop: 'flipFlop', g_big_table: 'bigTable', g_duel: 'duel',
    g_steal_points: 'stealPoints', g_scapegoat: 'scapegoat', g_hawk_eye: 'hawkEye', g_swap_hands: 'swapHands',
    g_sixth_board: 'sixthBoard', g_win_tax: 'winTax', g_curse: 'curse', g_fate_die: 'fateDie', g_dice: 'fortuneDice',
  },
  diamond: {
    d_carp: 'carp', d_aces_charge: 'acesCharge', d_risky_hand: 'riskyHand', d_adventurer: 'adventurer',
    d_share_winnings: 'shareWinnings', d_plunder: 'plunder', d_shuffle_holes: 'shuffleHoles', d_swap_leader: 'swapLeader',
    d_backfire: 'backfire', d_deluge: 'deluge', d_eclipse: 'eclipse', d_wild_card: 'wildCard', d_time_bomb: 'timeBomb',
    d_dice: 'fortuneDice',
  },
} as const
const ROUND_THREE_IDS = new Set<string>(Object.values(ROUND_THREE).flatMap((t) => Object.keys(t)))

/** The ✱ cards of spec §5 and BP-41 §6: play-or-fold tables only. */
const STARRED = ['s_peek_1', 's_free_fold', 's_blindfold', 'g_peek_3', 'd_peek_5', 's_no_fold', 's_hawk_eye', 'g_hawk_eye']

const raw = (): Record<string, unknown>[] => JSON.parse(JSON.stringify(CHAOS_CARDS_SPEC)) as Record<string, unknown>[]

describe('the spec catalogue (fixtures)', () => {
  it('carries the 47 cards of spec §5 and the 39 of BP-41 — 18 + 12 silver, 15 + 13 gold, 14 + 14 diamond — with exactly those ids', () => {
    expect(CHAOS_CARDS_SPEC).toHaveLength(47 + 39)
    for (const tier of ['silver', 'gold', 'diamond'] as const) {
      expect(CHAOS_CARDS_SPEC.filter((c) => c.tier === tier).map((c) => c.id)).toEqual([...SPEC_IDS[tier], ...Object.keys(ROUND_THREE[tier])])
    }
    expect(CHAOS_CARDS_SPEC.slice(0, 47).every((c) => !ROUND_THREE_IDS.has(c.id))).toBe(true)
    expect(CHAOS_TIERS.map((tier) => Object.keys(ROUND_THREE[tier]).length)).toEqual([12, 13, 14])
  })

  it('marks only the ✱ cards as play-or-fold only; all 86 are on (the 39 since Task 7b, A-churn)', () => {
    for (const c of CHAOS_CARDS_SPEC) {
      expect(c.modes, c.id).toEqual(STARRED.includes(c.id) ? ['playOrFold'] : ['playOrFold', 'none'])
      expect(c.enabled, c.id).toBe(true)
    }
  })

  it('BP-41: gives each round-three card its kind, and flags a debuff exactly when CHAOS_DEBUFF_EFFECTS names its kind (spec §3)', () => {
    const byId = new Map(CHAOS_CARDS_SPEC.map((c) => [c.id, c]))
    for (const tier of CHAOS_TIERS) {
      for (const [id, effect] of Object.entries(ROUND_THREE[tier])) {
        expect(byId.get(id), id).toMatchObject({ tier, effect })
        expect(byId.get(id)!.debuff, id).toBe(CHAOS_DEBUFF_EFFECTS.has(effect))
      }
    }
    // Every kind Task 1 declared has a card behind it, and no card uses a kind the engine does not know.
    expect(new Set(CHAOS_CARDS_SPEC.map((c) => c.effect))).toEqual(new Set(CHAOS_EFFECT_KINDS))
    const debuffs = CHAOS_CARDS_SPEC.filter((c) => c.debuff && ROUND_THREE_IDS.has(c.id)).map((c) => c.id)
    expect(debuffs).toEqual([
      's_duel', 's_redeal_hole', 's_neighbour_swap', 's_spoiler',
      'g_duel', 'g_steal_points', 'g_swap_hands', 'g_curse',
      'd_plunder', 'd_swap_leader', 'd_time_bomb',
    ])
  })

  it('BP-41: times each round-three card as spec §6 says (chia / chọn / lật / cuối ván / chờ / ngay)', () => {
    const timing = (t: string) => CHAOS_CARDS_SPEC.filter((c) => ROUND_THREE_IDS.has(c.id) && c.timing === t).map((c) => c.id)
    expect(timing('wait')).toEqual(['s_tier_up', 's_master', 'g_scapegoat', 'd_carp'])
    expect(timing('now')).toEqual(['g_steal_points'])
    expect(timing('end')).toEqual(['s_dice', 'g_dice', 'd_dice'])
    expect(timing('decision')).toEqual(['s_hawk_eye', 'g_hawk_eye'])
    expect(timing('reveal')).toEqual([
      's_duel', 's_redeal_hole', 's_neighbour_swap',
      'g_duel', 'g_swap_hands', 'g_win_tax', 'g_fate_die',
      'd_share_winnings', 'd_shuffle_holes', 'd_swap_leader', 'd_backfire', 'd_deluge',
    ])
    expect(timing('deal')).toHaveLength(39 - 4 - 1 - 3 - 2 - 12)
  })

  it('BP-41: pins every number of spec §4–§6 in params', () => {
    const p = (id: string) => CHAOS_CARDS_SPEC.find((c) => c.id === id)!.params
    // §4 Cá chép: energy +5..7 per lost hand from energy0 (0 shipped, A-ops); Thần 5 hands, crit 40/25/10 % for ×2/×3/×4,
    // the curse for the first 3 hands (the duel curse moves 1 wager), 2 Kim cương for each who brings it down; Bán Thần 5
    // hands, best of 3 sets, crit 30/10 % for ×2/×3.
    expect(p('d_carp')).toEqual({
      energy0: 0, stepMin: 5, stepMax: 7, godHands: 5, p2: 40, p3: 25, p4: 10, curseHands: 3, curseWagers: 1, slayCards: 2,
      demigodHands: 5, sets: 3, b2: 30, b3: 10,
    })
    expect(p('d_aces_charge')).toEqual({ stepMin: 5, stepMax: 7, cap: 100, all: 1, hands: 20 })
    expect(p('g_aces_charge')).toEqual({ stepMin: 5, stepMax: 7, cap: 60, aces: 2, hands: 20 })
    expect(p('d_risky_hand')).toEqual({ count: 1, sets: 3, p3: 50, p4: 30, p5: 20, hands: 10 })
    expect(p('d_adventurer')).toEqual({ stake: 2, jackpot: 5, points: 5, hands: 5 })
    expect(p('d_share_winnings')).toEqual({ percent: 50, hands: 2 })
    expect(p('d_plunder')).toEqual({ hands: 2 })
    expect(p('d_deluge')).toEqual({ board: 5 })
    expect(p('d_eclipse')).toEqual({ hands: 1 })
    expect(p('d_wild_card')).toEqual({ count: 1, hands: 1 })
    // The bomb fires once and lives in the table state: `fuse`, not `hands`, so the held card is not a duration card.
    expect(p('d_time_bomb')).toEqual({ fuse: 3, wagers: 1 })
    expect(p('g_flip_flop')).toEqual({ count: 1, hands: 4 })
    expect(p('g_big_table')).toEqual({ stake: 2, sets: 2, hands: 3 })
    expect(p('g_duel')).toEqual({ p2: 30, p3: 10 })
    expect(p('s_duel')).toEqual({ p2: 25, p3: 0 })
    expect(p('g_steal_points')).toEqual({ points: 5 })
    expect(p('g_hawk_eye')).toEqual({ all: 1, hands: 1 })
    expect(p('s_hawk_eye')).toEqual({ count: 1, hands: 1 })
    expect(p('g_sixth_board')).toEqual({ count: 1, hands: 1 })
    expect(p('g_win_tax')).toEqual({ percent: 10, hands: 3 })
    expect(p('g_curse')).toEqual({ toRank: 0, hands: 3 })
    expect(p('g_fate_die')).toEqual({ sides: 6, loseTo: 2, gainFrom: 5, count: 1, multiplier: 2 })
    expect(p('s_tier_up')).toEqual({ steps: 1 })
    expect(p('s_coin_flip')).toEqual({ count: 1, odds: 50, hands: 1 })
    expect(p('s_master')).toEqual({ points: 3 })
    expect(p('s_loss_points')).toEqual({ points: 1, hands: 5 })
    expect(p('s_kindling')).toEqual({ points: 1, hands: 3 })
    expect(p('s_redeal_hole')).toEqual({ count: 1 })
    expect(p('s_neighbour_swap')).toEqual({ count: 1 })
    expect(p('s_spoiler')).toEqual({ count: 1 })
  })

  it('BP-41 §5: encodes the three dice tables as bands of the total, each band paying what the spec lists', () => {
    /** Reads a dice card's params the way fixtures.ts documents them: the band a total falls in, and what it pays. */
    const band = (params: Readonly<Record<string, number>>, total: number): Record<string, number> => {
      let n = 0
      for (let i = 1; params[`a${i}`] !== undefined; i++) if (params[`a${i}`]! <= total) n = i
      const out: Record<string, number> = {}
      for (const k of ['p', 'c', 't', 'l', 'j', 'h']) if (params[`${k}${n}`] !== undefined) out[k] = params[`${k}${n}`]!
      return out
    }
    const table = (id: string) => {
      const params = CHAOS_CARDS_SPEC.find((c) => c.id === id)!.params
      const dice = params.dice!
      return Object.fromEntries(Array.from({ length: 5 * dice + 1 }, (_, i) => [dice + i, band(params, dice + i)]))
    }
    expect(CHAOS_CARDS_SPEC.find((c) => c.id === 's_dice')!.params.dice).toBe(1)
    expect(table('s_dice')).toEqual({ 1: {}, 2: {}, 3: { p: 2 }, 4: { p: 2 }, 5: { c: 1, t: 1 }, 6: { c: 1, t: 2 } })
    const gold = table('g_dice')
    expect(gold[2]).toEqual({ l: 1 })
    for (const t of [3, 4, 5, 6]) expect(gold[t], `${t}`).toEqual({ p: 3 })
    for (const t of [7, 8, 9]) expect(gold[t], `${t}`).toEqual({ c: 1, t: 2 })
    for (const t of [10, 11]) expect(gold[t], `${t}`).toEqual({ c: 1, t: 3 })
    expect(gold[12]).toEqual({ j: 10 })
    const diamond = table('d_dice')
    expect(diamond[3]).toEqual({ l: 2 })
    for (const t of [4, 5, 6, 7]) expect(diamond[t], `${t}`).toEqual({ p: 5 })
    for (const t of [8, 9, 10, 11]) expect(diamond[t], `${t}`).toEqual({ c: 1, t: 2 })
    for (const t of [12, 13, 14]) expect(diamond[t], `${t}`).toEqual({ c: 1, t: 3 })
    for (const t of [15, 16, 17]) expect(diamond[t], `${t}`).toEqual({ c: 2, t: 3 })
    expect(diamond[18]).toEqual({ j: 30, c: 1, t: 3, h: 1 })
    // Three equal dice double their band (but not the herald): 1-1-1 loses 4, 2-2-2 +10, 3-3-3 2 gold, 4-4-4 2 diamonds,
    // 5-5-5 4 diamonds, 6-6-6 a 60 × jackpot, 2 diamonds and the herald.
    expect(CHAOS_CARDS_SPEC.find((c) => c.id === 'd_dice')!.params.triple).toBe(2)
    expect(CHAOS_CARDS_SPEC.find((c) => c.id === 'g_dice')!.params.triple).toBeUndefined()
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
    const debuffs = CHAOS_CARDS_SPEC.slice(0, 47).filter((c) => c.debuff).map((c) => c.id)
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

  it('BP-41: accepts the round-three effect kinds and the end-of-hand timing, and ties debuff to the kind', () => {
    const cards = raw()
    cards.push(
      { id: 'x_dice', tier: 'diamond', family: 'dice', effect: 'fortuneDice', params: { dice: 3 }, timing: 'end', modes: ['playOrFold', 'none'], debuff: false, enabled: false },
      { id: 'x_bomb', tier: 'diamond', family: 'debuff', effect: 'timeBomb', params: { hands: 3 }, timing: 'deal', modes: ['playOrFold', 'none'], debuff: true, enabled: false },
      { id: 'x_carp', tier: 'diamond', family: 'god', effect: 'carp', params: { energy0: 0 }, timing: 'wait', modes: ['playOrFold', 'none'], debuff: false, enabled: false },
    )
    const parsed = parseChaosCatalogue(cards)
    expect(parsed.slice(-3).map((c) => [c.effect, c.timing, c.debuff])).toEqual([['fortuneDice', 'end', false], ['timeBomb', 'deal', true], ['carp', 'wait', false]])
    // Spec §3: aimed at one person = a debuff; a table rule is not.
    for (const kind of ['plunder', 'swapLeader', 'curse', 'neighbourSwap', 'redealHole', 'timeBomb', 'duel', 'spoiler', 'stealPoints', 'swapHands'] as const) {
      expect(CHAOS_DEBUFF_EFFECTS.has(kind), kind).toBe(true)
    }
    for (const kind of ['winTax', 'shareWinnings', 'noFold', 'shuffleHoles', 'deluge', 'eclipse', 'bigTable', 'fortuneDice', 'carp'] as const) {
      expect(CHAOS_DEBUFF_EFFECTS.has(kind), kind).toBe(false)
    }
    const wrong = raw()
    wrong.push({ id: 'x_duel', tier: 'gold', family: 'duel', effect: 'duel', params: { p2: 30, p3: 10 }, timing: 'reveal', modes: ['playOrFold', 'none'], debuff: false, enabled: false })
    expect(() => parseChaosCatalogue(wrong)).toThrow(/invalid chaos catalogue: x_duel debuff must be true for duel/)
    expect(new Set(CHAOS_EFFECT_KINDS).size).toBe(CHAOS_EFFECT_KINDS.length)
  })

  it('refuses anything that is not an array of card objects', () => {
    expect(() => parseChaosCatalogue({ cards: [] })).toThrow(/invalid chaos catalogue/)
    expect(() => parseChaosCatalogue([null])).toThrow(/invalid chaos catalogue/)
  })
})
