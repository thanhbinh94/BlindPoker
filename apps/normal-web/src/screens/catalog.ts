import type { TFunction } from 'i18next'
import type { AchievementDefDto, ItemDto, ItemSlot } from '../api.js'
import { achievementName } from '../catalog-i18n.js'

/**
 * The catalogue vocabulary the wardrobe needs beyond its own tabs. (The inventory used to share a slot order
 * and a rarity-to-badge table from here; both went when layout audit C3 gave it the wardrobe's own groups and
 * cards, and the screen itself when it folded into the wardrobe — No5.)
 */

/** The slots a daily-reward draw may land on (design §5.2) — mirrors the server's `DAILY_DRAW_SLOTS`. */
const DAILY_DRAW_SLOTS = new Set<ItemSlot>(['head', 'face', 'aura', 'frame', 'hairColor', 'eyeColor'])

/**
 * The rarities a daily draw hands out — mirrors the server's item column (`itemRuleForDay` in
 * `apps/normal-server/src/economy/daily-rules.ts`): day 7 draws a common, days 14 and 21 a rare, and nothing
 * draws an epic. An epic in a draw slot is therefore never promised as a gift.
 */
const DAILY_DRAW_RARITIES = new Set<ItemDto['rarity']>(['common', 'rare'])

/**
 * The items the day-28 check-in grants outright — mirrors the server's `DAILY_FIXED_ITEM_IDS` (and day 28 is the
 * `fixed` rule in `itemRuleForDay`), the one tier that names its items instead of drawing them.
 */
const DAILY_FIXED_ITEM_IDS = new Set<string>(['badge_monthly', 'title_devoted'])

/**
 * Why a locked tile is locked, in one line: how a player would come to own it.
 *
 * An achievement that rewards this exact item wins over the generic lines, because it is the more useful
 * answer — "win a royal flush" beats "comes from a daily draw" when both happen to be true. After it, the
 * day-28 gift names itself, and only a common or a rare in a draw slot is called a gift of the draw: the
 * server never draws an epic, so promising one would be a hint that can never come true. Everything else
 * (an outfit, a title, a badge, an epic) falls back to `unavailable` rather than naming a source that does
 * not exist.
 */
export function hintFor(item: ItemDto, achievements: readonly AchievementDefDto[], t: TFunction<'normal'>): string {
  const rewarding = achievements.find((def) => def.reward.itemId === item.id)
  if (rewarding !== undefined) return achievementName(rewarding.id, t)
  if (DAILY_FIXED_ITEM_IDS.has(item.id)) return t('wardrobe.hint.dailyFixed')
  if (DAILY_DRAW_SLOTS.has(item.slot) && DAILY_DRAW_RARITIES.has(item.rarity)) return t(`wardrobe.hint.daily.${item.rarity}`)
  return t('wardrobe.hint.unavailable')
}
