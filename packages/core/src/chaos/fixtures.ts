import type { ChaosCardDef, ChaosEffectKind, ChaosMode, ChaosTier, ChaosTiming } from './types.js'

const BOTH: readonly ChaosMode[] = ['playOrFold', 'none']
/** ✱ in spec §5: play-or-fold tables only. */
const STAR: readonly ChaosMode[] = ['playOrFold']

function card(
  id: string, tier: ChaosTier, family: string, effect: ChaosEffectKind, params: Record<string, number>, timing: ChaosTiming,
  opts: { modes?: readonly ChaosMode[]; debuff?: boolean; enabled?: boolean } = {},
): ChaosCardDef {
  return { id, tier, family, effect, params, timing, modes: opts.modes ?? BOTH, debuff: opts.debuff ?? false, enabled: opts.enabled ?? true }
}

/**
 * BP-41 (spec 2026-10-28 §4–§6): the 39 round-three cards ship **off** until the engine and the server run them
 * (pre-flight amendment A-churn: Task 7b turns them on). A disabled card has draw weight 0, so no draft, bonus draw,
 * Cấp độ or Tay bạc roll can deal one, and every seeded draw over the 47 stays as it was.
 */
function card3(
  id: string, tier: ChaosTier, family: string, effect: ChaosEffectKind, params: Record<string, number>, timing: ChaosTiming,
  opts: { modes?: readonly ChaosMode[]; debuff?: boolean } = {},
): ChaosCardDef {
  return card(id, tier, family, effect, params, timing, { ...opts, enabled: false })
}

const FORTUNE_SILVER = { m2: 2, m4: 4, c4: 1, t4: 1, m6: 6, c6: 1, t6: 2 }
const FORTUNE_GOLD = { m2: 4, m4: 8, c4: 1, t4: 2, m6: 12, c6: 2, t6: 2 }
const FORTUNE_DIAMOND = { m2: 8, c2: 1, t2: 1, m4: 15, c4: 1, t4: 3, m6: 20, c6: 2, t6: 3 }

/**
 * Xúc xắc vận may (BP-41 spec §5) as bands of the dice total. `dice` dice are rolled and summed; band N covers the
 * totals from `aN` up to `a(N+1) − 1` (the last band runs to `6 × dice`). A band pays any of:
 * - `pN` chaos points; `cN` cards of tier `tN` (1 silver, 2 gold, 3 diamond — as Thần tài);
 * - `lN` wagers lost (the fixed wager; a sink, at most the stack); `jN` a jackpot of `jN` × the fixed wager (new points);
 * - `hN: 1` the loud herald.
 * A band with none of them pays nothing. `triple` (Kim cương only): three equal dice multiply every number of their
 * band by it — points, cards, wagers lost, jackpot — but not the herald (so 1-1-1 loses 4 wagers and 6-6-6 is a 60 ×
 * jackpot, 2 diamonds and the herald, as the spec lists).
 */
const DICE_SILVER = { dice: 1, a1: 1, a2: 3, p2: 2, a3: 5, c3: 1, t3: 1, a4: 6, c4: 1, t4: 2 }
const DICE_GOLD = { dice: 2, a1: 2, l1: 1, a2: 3, p2: 3, a3: 7, c3: 1, t3: 2, a4: 10, c4: 1, t4: 3, a5: 12, j5: 10 }
const DICE_DIAMOND = {
  dice: 3, triple: 2,
  a1: 3, l1: 2, a2: 4, p2: 5, a3: 8, c3: 1, t3: 2, a4: 12, c4: 1, t4: 3, a5: 15, c5: 2, t5: 3, a6: 18, j6: 30, c6: 1, t6: 3, h6: 1,
}

/**
 * The 47 cards of spec §5.1–§5.3 as data, in table order, then BP-41's 39 (spec 2026-10-28 §6.3 Bạc, §6.2 Vàng, §6.1
 * Kim cương, each in table order, all `enabled: false` for now). `apps/normal-server/data/chaos-cards.json` must
 * deep-equal this list; tests across the packages build their tables from it. See `ChaosCardDef` for what the BP-37
 * params mean. BP-41's params, by card (every number of the spec lives here; percentages are whole numbers):
 * - `hands`, as before, makes a duration card: it fires each hand while it has hands left. "Up to N hands, until a
 *   win" cards (Siêu cộng dồn 20, Liều ăn nhiều 10, Mạo hiểm gia 5) are duration cards the engine ends early.
 * - Siêu cộng dồn (`acesCharge`): the chance grows by a random whole `stepMin`..`stepMax` percent each hand, up to `cap`;
 *   `all: 1` deals all Aces (Kim cương), `aces: 2` a pair of Aces (Vàng).
 * - Cá chép (`carp`): energy starts at `energy0` (A-ops: 0 in production) and grows `stepMin`..`stepMax` per lost hand;
 *   the Thần reigns `godHands` hands with crit odds `p2`/`p3`/`p4` (× 2/3/4), its curse acts the first `curseHands`
 *   hands (the duel curse moves `curseWagers` wagers), its fall gives each winner `slayCards` Kim cương cards; the Bán
 *   Thần reigns `demigodHands` hands with `sets` hole-card sets and crit odds `b2`/`b3` (× 2/3).
 * - Liều ăn nhiều (`riskyHand`): `count` hole cards fewer, `sets` sets, crit odds `p3`/`p4`/`p5` on a win.
 * - Mạo hiểm gia (`adventurer`) and Sới lớn (`bigTable`): the stake is × `stake` per hand (Mạo hiểm gia: × `stake`^k on
 *   its k-th hand, so ×2 … ×32); Mạo hiểm gia's win pays a `jackpot` × wager jackpot and `points` chaos points; Sới
 *   lớn's holder keeps the best of `sets` sets.
 * - `percent`: Ép chia thưởng's share of the winner's profit, Thuế thắng's tax.
 * - Thách đấu (`duel`): `p2`/`p3` the odds the beaten opponent pays 2/3 wagers. Bom nổ chậm: `fuse` hands (not `hands`:
 *   the card fires once, the bomb then lives in the table state), then the carrier pays `wagers` wagers.
 * - Lời nguyền: the highest hole card becomes rank `toRank` (`rankOf` terms, 0 = a 2). Đại hồng thủy redeals `board` board
 *   cards with the holes. Hên xui: `odds` percent for +`count` card, else −`count`. Đảo bài: ±`count`, starting with +.
 *   Lá ma, Lá chung thứ sáu, Xào bài, Đổi lá hàng xóm, Kẻ phá đám, Mắt diều hâu: `count` cards (Mắt diều hâu vàng: `all`).
 * - Xúc xắc định mệnh (`fateDie`): one die of `sides`; up to `loseTo` loses `count` card, from `gainFrom` gains `count`
 *   card and a crit × `multiplier` on a win. Xúc xắc vận may: see `DICE_SILVER` above.
 * - Points: Cao thủ, Tích tiểu thành đại, Mồi lửa pay `points` chaos points; Trộm điểm takes `points`. Nâng tầm uy lực
 *   lifts the next card received by `steps` tiers.
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
  // BP-41 §6.3 Bạc (12)
  card3('s_tier_up', 'silver', 'level', 'tierUp', { steps: 1 }, 'wait'),
  card3('s_no_fold', 'silver', 'rule', 'noFold', {}, 'deal', { modes: STAR }),
  card3('s_duel', 'silver', 'debuff', 'duel', { p2: 25, p3: 0 }, 'reveal', { debuff: true }),
  card3('s_hawk_eye', 'silver', 'peek', 'hawkEye', { count: 1, hands: 1 }, 'decision', { modes: STAR }),
  card3('s_coin_flip', 'silver', 'extra', 'coinFlip', { count: 1, odds: 50, hands: 1 }, 'deal'),
  card3('s_master', 'silver', 'points', 'master', { points: 3 }, 'wait'),
  card3('s_loss_points', 'silver', 'points', 'lossPoints', { points: 1, hands: 5 }, 'deal'),
  card3('s_redeal_hole', 'silver', 'debuff', 'redealHole', { count: 1 }, 'reveal', { debuff: true }),
  card3('s_neighbour_swap', 'silver', 'debuff', 'neighbourSwap', { count: 1 }, 'reveal', { debuff: true }),
  card3('s_spoiler', 'silver', 'debuff', 'spoiler', { count: 1 }, 'deal', { debuff: true }),
  card3('s_kindling', 'silver', 'points', 'kindling', { points: 1, hands: 3 }, 'deal'),
  card3('s_dice', 'silver', 'dice', 'fortuneDice', DICE_SILVER, 'end'),
  // BP-41 §6.2 Vàng (13)
  card3('g_aces_charge', 'gold', 'luck', 'acesCharge', { stepMin: 5, stepMax: 7, cap: 60, aces: 2, hands: 20 }, 'deal'),
  card3('g_flip_flop', 'gold', 'extra', 'flipFlop', { count: 1, hands: 4 }, 'deal'),
  card3('g_big_table', 'gold', 'rule', 'bigTable', { stake: 2, sets: 2, hands: 3 }, 'deal'),
  card3('g_duel', 'gold', 'debuff', 'duel', { p2: 30, p3: 10 }, 'reveal', { debuff: true }),
  card3('g_steal_points', 'gold', 'debuff', 'stealPoints', { points: 5 }, 'now', { debuff: true }),
  card3('g_scapegoat', 'gold', 'shield', 'scapegoat', {}, 'wait'),
  card3('g_hawk_eye', 'gold', 'peek', 'hawkEye', { all: 1, hands: 1 }, 'decision', { modes: STAR }),
  card3('g_swap_hands', 'gold', 'debuff', 'swapHands', {}, 'reveal', { debuff: true }),
  card3('g_sixth_board', 'gold', 'board', 'sixthBoard', { count: 1, hands: 1 }, 'deal'),
  card3('g_win_tax', 'gold', 'rule', 'winTax', { percent: 10, hands: 3 }, 'reveal'),
  card3('g_curse', 'gold', 'debuff', 'curse', { toRank: 0, hands: 3 }, 'deal', { debuff: true }),
  card3('g_fate_die', 'gold', 'dice', 'fateDie', { sides: 6, loseTo: 2, gainFrom: 5, count: 1, multiplier: 2 }, 'reveal'),
  card3('g_dice', 'gold', 'dice', 'fortuneDice', DICE_GOLD, 'end'),
  // BP-41 §6.1 Kim cương (14)
  card3('d_carp', 'diamond', 'god', 'carp', {
    energy0: 0, stepMin: 5, stepMax: 7,
    godHands: 5, p2: 40, p3: 25, p4: 10, curseHands: 3, curseWagers: 1, slayCards: 2,
    demigodHands: 5, sets: 3, b2: 30, b3: 10,
  }, 'wait'),
  card3('d_aces_charge', 'diamond', 'luck', 'acesCharge', { stepMin: 5, stepMax: 7, cap: 100, all: 1, hands: 20 }, 'deal'),
  card3('d_risky_hand', 'diamond', 'luck', 'riskyHand', { count: 1, sets: 3, p3: 50, p4: 30, p5: 20, hands: 10 }, 'deal'),
  card3('d_adventurer', 'diamond', 'rule', 'adventurer', { stake: 2, jackpot: 5, points: 5, hands: 5 }, 'deal'),
  card3('d_share_winnings', 'diamond', 'rule', 'shareWinnings', { percent: 50, hands: 2 }, 'reveal'),
  card3('d_plunder', 'diamond', 'debuff', 'plunder', { hands: 2 }, 'deal', { debuff: true }),
  card3('d_shuffle_holes', 'diamond', 'swap', 'shuffleHoles', {}, 'reveal'),
  card3('d_swap_leader', 'diamond', 'debuff', 'swapLeader', {}, 'reveal', { debuff: true }),
  card3('d_backfire', 'diamond', 'shield', 'backfire', {}, 'reveal'),
  card3('d_deluge', 'diamond', 'board', 'deluge', { board: 5 }, 'reveal'),
  card3('d_eclipse', 'diamond', 'rule', 'eclipse', { hands: 1 }, 'deal'),
  card3('d_wild_card', 'diamond', 'luck', 'wildCard', { count: 1, hands: 1 }, 'deal'),
  card3('d_time_bomb', 'diamond', 'debuff', 'timeBomb', { fuse: 3, wagers: 1 }, 'deal', { debuff: true }),
  card3('d_dice', 'diamond', 'dice', 'fortuneDice', DICE_DIAMOND, 'end'),
]
