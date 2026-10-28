import type { ChaosDiceResult, ChaosGodCurse } from '@bp/core'
import type { TFunction } from 'i18next'
import type { AppliedChaosView } from '../client/types.js'
import { cardLabel, formatPoints, type Language } from '../i18n/index.js'

/** How long the dice tumble before they land (spec 2026-10-28 §5: about 1.5 s). `ChaosDice` re-exports it. */
export const DICE_ROLL_MS = 1_500
/** How long a roll stays up in all, from its arrival: the tumble, then the result. `ChaosDice` re-exports it. */
export const DICE_MS = 3_000

/** How dice faces read in a line: "6-6-6". */
export const diceText = (dice: readonly number[]): string => dice.join('-')

/**
 * BP-41 §5: what one Xúc xắc vận may roll gave, in words — "+5 điểm hỗn loạn", "2 thẻ Kim cương", "Mất 1.000", "Nổ hũ 60.000",
 * with "Bộ ba!" first on three alike; "Không trúng gì" for an empty result.
 */
export function rollText(result: ChaosDiceResult, t: TFunction, lang: Language): string {
  const parts: string[] = []
  if (result.triple === true) parts.push(t('chaos.detail.triple'))
  if (result.jackpot !== undefined && result.jackpot > 0) parts.push(t('chaos.detail.jackpot', { amount: formatPoints(result.jackpot, lang) }))
  for (const c of result.cards ?? []) parts.push(t('chaos.detail.cards', { count: c.count, tier: t(`chaos.tier.${c.tier}`) }))
  if (result.points !== undefined && result.points > 0) parts.push(t('chaos.detail.points', { count: result.points }))
  if (result.burned !== undefined && result.burned > 0) parts.push(t('chaos.detail.burned', { amount: formatPoints(result.burned, lang) }))
  if (parts.length === 0 || (parts.length === 1 && result.triple === true)) parts.push(t('chaos.detail.nothing'))
  return parts.join(' · ')
}

/**
 * The short result a round-three card adds to its toast line (spec 2026-10-28 §8: "Bom nổ ở {tên}: −1.000", "Xúc xắc 6-6-6!"),
 * or `null` when it tells nothing beyond the card and its targets: who paid whom (a duel, a bomb, Ép chia thưởng, Thuế thắng), the
 * stake a card multiplied, the die and what it did, the hole cards added or taken, the wild card, the card switched off, a reign,
 * the Thần's curse, a dice roll and a Trộm điểm. `curse` is the reigning Thần's (`ChaosTableView.god.curse`), for its curse line.
 *
 * A dice roll's line keeps its faces and result back until the dice have landed (`rolledAt + DICE_ROLL_MS`, Ruling 22): until
 * then it says "Đang gieo…", as the panel does, so the toast never tells the roll the table is still watching. `now` is the
 * client clock (`Date.now()` by default); a roll line rebuilt without `rolledAt` tells at once.
 */
export function chaosDetail(
  item: AppliedChaosView,
  t: TFunction,
  lang: Language,
  nameOf: (seat: number) => string,
  curse: ChaosGodCurse | null = null,
  now: number = Date.now(),
): string | null {
  if (item.reign !== undefined) return t(`chaos.detail.${item.reign}`)
  if (item.roll !== undefined) {
    if (item.rolledAt !== undefined && now < item.rolledAt + DICE_ROLL_MS) return t('chaos.dice.rolling')
    return `${t('chaos.detail.dice', { dice: diceText(item.dice ?? []) })} · ${rollText(item.roll, t, lang)}`
  }
  if (item.steal !== undefined) {
    const { from, to, amount } = item.steal
    return from === null || to === null || amount <= 0 ? null : t('chaos.detail.steal', { from: nameOf(from), to: nameOf(to), count: amount })
  }
  const parts: string[] = []
  if (item.transfers !== undefined && item.transfers.length > 0) {
    for (const x of item.transfers) parts.push(t('chaos.detail.transfer', { from: nameOf(x.from), to: nameOf(x.to), amount: formatPoints(x.amount, lang) }))
  } else if (item.wagers !== undefined && item.wagers > 0) {
    // Who pays (fix wave 30): a duel's loser — its target, or its user when a mirror or Gậy ông turned it round. The Thần's
    // curse names every seat it reached, each paying or paid by its own result: the wagers are said as due.
    const payer = item.effect === 'duel' && item.targets.length === 1 ? (item.outcome === 'reflected' ? item.seat : item.targets[0]!) : null
    parts.push(payer === null ? t('chaos.detail.wagersDue', { count: item.wagers }) : t('chaos.detail.wagers', { name: nameOf(payer), count: item.wagers }))
  }
  if (item.stake !== undefined && item.stake > 1) parts.push(t('chaos.detail.stake', { stake: item.stake }))
  if (item.dice !== undefined && item.dice.length > 0) parts.push(t('chaos.detail.dice', { dice: diceText(item.dice) }))
  if (item.holeDelta !== undefined && item.outcome === 'applied') {
    const n = item.holeDelta
    parts.push(n > 0 ? t('chaos.detail.holeUp', { count: n }) : n < 0 ? t('chaos.detail.holeDown', { count: -n }) : t('chaos.detail.holeSame'))
  }
  if (item.wild !== undefined) parts.push(t('chaos.detail.wild', { card: cardLabel(item.wild, t) }))
  if (item.off !== undefined) parts.push(t('chaos.detail.off', { card: t(`chaos.cards.${item.off}.name`, { defaultValue: item.off }) }))
  // The Thần's curse is told as Cá chép with no reign: which curse it is — the one the line took when it came (Task 9 M4),
  // else the table's now.
  const told = item.curse ?? curse
  if (item.effect === 'carp' && (item.transfers === undefined || item.transfers.length === 0) && told !== null) {
    parts.push(t('chaos.reign.curse', { curse: t(`chaos.reign.curses.${told}`) }))
  }
  return parts.length === 0 ? null : parts.join(' · ')
}
