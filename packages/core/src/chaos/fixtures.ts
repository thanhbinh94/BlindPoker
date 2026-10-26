import type { ChaosCardDef, ChaosEffectKind, ChaosMode, ChaosTier, ChaosTiming } from './types.js'

const BOTH: readonly ChaosMode[] = ['playOrFold', 'none']
/** ✱ in spec §5: play-or-fold tables only. */
const STAR: readonly ChaosMode[] = ['playOrFold']

function card(
  id: string, tier: ChaosTier, family: string, effect: ChaosEffectKind, params: Record<string, number>, timing: ChaosTiming,
  opts: { modes?: readonly ChaosMode[]; debuff?: boolean } = {},
): ChaosCardDef {
  return { id, tier, family, effect, params, timing, modes: opts.modes ?? BOTH, debuff: opts.debuff ?? false, enabled: true }
}

const FORTUNE_SILVER = { m2: 2, m4: 4, c4: 1, t4: 1, m6: 6, c6: 1, t6: 2 }
const FORTUNE_GOLD = { m2: 4, m4: 8, c4: 1, t4: 2, m6: 12, c6: 2, t6: 2 }
const FORTUNE_DIAMOND = { m2: 8, c2: 1, t2: 1, m4: 15, c4: 1, t4: 3, m6: 20, c6: 2, t6: 3 }

/**
 * The 47 cards of spec §5.1–§5.3 as data, in table order. `apps/normal-server/data/chaos-cards.json` must deep-equal
 * this list; tests across the packages build their tables from it. See `ChaosCardDef` for what each param means.
 */
export const CHAOS_CARDS_SPEC: readonly ChaosCardDef[] = [
  // §5.1 Bạc (18)
  card('s_swap_one', 'silver', 'swap', 'swapLowest', { hands: 1 }, 'deal'),
  card('s_luck_1', 'silver', 'luck', 'bestOfN', { sets: 2, hands: 1 }, 'deal'),
  card('s_high_card', 'silver', 'luck', 'highCard', { minRank: 8, hands: 1 }, 'deal'),
  card('s_suited', 'silver', 'luck', 'suited', { hands: 1 }, 'deal'),
  card('s_redeal_weak', 'silver', 'swap', 'redealWeak', { minRank: 9, hands: 1 }, 'deal'),
  card('s_peek_1', 'silver', 'peek', 'peekBoard', { count: 1, hands: 1 }, 'decision', { modes: STAR }),
  card('s_free_fold', 'silver', 'insurance', 'freeFold', { hands: 1 }, 'decision', { modes: STAR }),
  card('s_insure_half', 'silver', 'insurance', 'refundStake', { percent: 50, hands: 1 }, 'reveal'),
  card('s_shield', 'silver', 'shield', 'shield', {}, 'wait'),
  card('s_rescue', 'silver', 'rescue', 'rescue', { multiplier: 5 }, 'wait'),
  card('s_charge', 'silver', 'points', 'chaosPoints', { points: 3 }, 'now'),
  card('s_steal_one', 'silver', 'debuff', 'stealHole', {}, 'reveal', { debuff: true }),
  card('s_lower', 'silver', 'debuff', 'lowerHole', {}, 'reveal', { debuff: true }),
  card('s_blindfold', 'silver', 'debuff', 'blindfold', {}, 'deal', { modes: STAR, debuff: true }),
  card('s_freeze_one', 'silver', 'debuff', 'freeze', {}, 'deal', { debuff: true }),
  card('s_crit', 'silver', 'crit', 'crit', { p2: 20, p3: 0, hands: 3 }, 'reveal'),
  card('s_fortune', 'silver', 'fortune', 'fortune', FORTUNE_SILVER, 'wait'),
  card('s_level', 'silver', 'level', 'levelUp', { count: 1, tier: 2 }, 'now'),
  // §5.2 Vàng (15)
  card('g_swap_all', 'gold', 'swap', 'swapAll', { minRank: 10, hands: 1 }, 'deal'),
  card('g_luck_3', 'gold', 'luck', 'bestOfN', { sets: 2, hands: 3 }, 'deal'),
  card('g_extra_card', 'gold', 'extra', 'extraHole', { count: 1, hands: 1 }, 'deal'),
  card('g_peek_3', 'gold', 'peek', 'peekBoard', { count: 3, hands: 1 }, 'decision', { modes: STAR }),
  card('g_borrow', 'gold', 'extra', 'borrowHole', {}, 'reveal'),
  card('g_insure_full', 'gold', 'insurance', 'refundStake', { percent: 100, hands: 1 }, 'reveal'),
  card('g_shield_3', 'gold', 'shield', 'shield', { hands: 3 }, 'wait'),
  card('g_rescue', 'gold', 'rescue', 'rescue', { multiplier: 10 }, 'wait'),
  card('g_farm', 'gold', 'points', 'farm', { hands: 5 }, 'deal'),
  card('g_steal_all', 'gold', 'debuff', 'stealHole', { all: 1 }, 'reveal', { debuff: true }),
  card('g_redeal_board_1', 'gold', 'board', 'redealBoard', { count: 1 }, 'reveal'),
  card('g_freeze_all', 'gold', 'debuff', 'freeze', { all: 1 }, 'deal', { debuff: true }),
  card('g_crit', 'gold', 'crit', 'crit', { p2: 25, p3: 10, hands: 3 }, 'reveal'),
  card('g_fortune', 'gold', 'fortune', 'fortune', FORTUNE_GOLD, 'wait'),
  card('g_level', 'gold', 'level', 'levelUp', { count: 1, tier: 3 }, 'now'),
  // §5.3 Kim cương (14)
  card('d_pick_3', 'diamond', 'luck', 'bestOfN', { sets: 3, hands: 1 }, 'deal'),
  card('d_luck_5', 'diamond', 'luck', 'bestOfN', { sets: 2, hands: 5 }, 'deal'),
  card('d_extra_card_3', 'diamond', 'extra', 'extraHole', { count: 1, hands: 3 }, 'deal'),
  card('d_peek_5', 'diamond', 'peek', 'peekBoard', { count: 5, hands: 1 }, 'decision', { modes: STAR }),
  card('d_insure_2', 'diamond', 'insurance', 'refundStake', { percent: 100, hands: 2 }, 'reveal'),
  card('d_mirror', 'diamond', 'shield', 'mirror', {}, 'wait'),
  card('d_rescue', 'diamond', 'rescue', 'rescue', { multiplier: 20 }, 'wait'),
  card('d_swap_hands', 'diamond', 'debuff', 'swapHands', {}, 'reveal', { debuff: true }),
  card('d_storm', 'diamond', 'board', 'redealBoard', { count: 5 }, 'reveal'),
  card('d_reverse', 'diamond', 'rule', 'reverseRank', { hands: 1 }, 'deal'),
  card('d_crit', 'diamond', 'crit', 'crit', { p2: 30, p3: 15, hands: 3 }, 'reveal'),
  card('d_fortune', 'diamond', 'fortune', 'fortune', FORTUNE_DIAMOND, 'wait'),
  card('d_gambler', 'diamond', 'gambler', 'gambler', {}, 'deal'),
  card('d_level', 'diamond', 'level', 'levelUp', { count: 2 }, 'now'),
]
