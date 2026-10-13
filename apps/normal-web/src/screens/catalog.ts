import type { TFunction } from 'i18next'
import type { AchievementDefDto, DailyGiftNoticeDto, ItemDto, ItemSlot } from '../api.js'
import { achievementName } from '../catalog-i18n.js'
import { formatMonthKey } from './format.js'

/**
 * The catalogue vocabulary the wardrobe needs beyond its own tabs. (The inventory used to share a slot order
 * and a rarity-to-badge table from here; both went when layout audit C3 gave it the wardrobe's own groups and
 * cards, and the screen itself when it folded into the wardrobe — No5.)
 */

/** The slots a daily-reward draw may land on (design §5.2) — mirrors the server's `DAILY_DRAW_SLOTS`. */
const DAILY_DRAW_SLOTS = new Set<ItemSlot>(['head', 'face', 'aura', 'frame', 'hairColor', 'eyeColor'])

/**
 * The rarities a daily draw hands out — mirrors what the server's schedule (`data/daily-gifts.json`) may draw: a
 * `draw` tier is `common` or `rare` (spec 2026-10-12 Q6), and nothing draws an epic. An epic in a draw slot is
 * therefore never promised as a gift of the draw.
 */
const DAILY_DRAW_RARITIES = new Set<ItemDto['rarity']>(['common', 'rare'])

/** Everything a locked tile's hint is worked out from: two lists the wardrobe loads with the catalogue. */
export interface HintSources {
  achievements: readonly AchievementDefDto[]
  /** What the check-in schedule names from this month on — `GET /api/catalog/items`'s `dailyGifts`. */
  gifts: readonly DailyGiftNoticeDto[]
}

/**
 * Why a locked tile is locked, in one line: how a player would come to own it.
 *
 * An achievement that rewards this exact item wins over the rest, because it is the more useful answer — "win a royal
 * flush" beats "comes from a daily draw" when both happen to be true. After it, a gift the check-in schedule names
 * (spec 2026-10-12 §4.4): one of every month reads "Quà điểm danh ngày 28", one of a given month says which —
 * "Quà điểm danh ngày 28 tháng 11/2026". The server lists only what is still to come, so an item whose month has
 * passed falls through. Then only a common or a rare in a draw slot is called a gift of the draw: the server never
 * draws an epic, so promising one would be a hint that can never come true. Everything else (an outfit, a title, a
 * badge, an epic nobody hands out) falls back to `unavailable` rather than naming a source that does not exist.
 *
 * The gifts are as fresh as the wardrobe's last load: a wardrobe left open across midnight on the 1st keeps last
 * month's list, so a gift whose month just ended still reads as coming, until the wardrobe is opened again and
 * refetches it on mount. Accepted: the server is the one that grants, and a stale hint only over-promises a tile.
 */
export function hintFor(item: ItemDto, sources: HintSources, t: TFunction<'normal'>): string {
  const rewarding = sources.achievements.find((def) => def.reward.itemId === item.id)
  if (rewarding !== undefined) return achievementName(rewarding.id, t)
  const gift = sources.gifts.find((g) => g.itemId === item.id)
  if (gift !== undefined) {
    return gift.month === null
      ? t('wardrobe.hint.dailyFixed', { day: gift.day })
      : t('wardrobe.hint.dailyMonth', { day: gift.day, month: formatMonthKey(gift.month) })
  }
  if (DAILY_DRAW_SLOTS.has(item.slot) && DAILY_DRAW_RARITIES.has(item.rarity)) return t(`wardrobe.hint.daily.${item.rarity}`)
  return t('wardrobe.hint.unavailable')
}
