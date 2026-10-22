import type { TFunction } from 'i18next'
import type { ShopLockDto } from '../../api.js'
import { achievementName } from '../../catalog-i18n.js'
import { formatMonthKey } from '../format.js'

/** A rank's name ("Cao thủ"), from the kit's `game` namespace where the seat reads it too. */
export function rankName(rank: number, t: TFunction): string {
  return t(`game:rank.${rank}`, { defaultValue: String(rank) })
}

/** What the price table's status column says: why the item does not sell, or that it does. */
export function lockLabel(lock: ShopLockDto | null, t: TFunction): string {
  if (lock === null) return t('gm.shop.lock.none')
  switch (lock.kind) {
    case 'achievement':
      return t('gm.shop.lock.achievement', { name: achievementName(lock.achievementId, t) })
    case 'gift_month':
      return t('gm.shop.lock.gift_month', { month: formatMonthKey(lock.month) })
    default:
      return t(`gm.shop.lock.${lock.kind}`)
  }
}

/** `2026-W37` → "Tuần 37/2026". */
export function weekLabel(weekKey: string, t: TFunction): string {
  const [year, week] = weekKey.split('-W')
  return t('gm.shop.featured.weekOption', { week: Number(week), year })
}
