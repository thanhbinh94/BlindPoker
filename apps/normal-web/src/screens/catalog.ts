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
 * Why a locked tile is locked, in one line: how a player would come to own it.
 *
 * An achievement that rewards this exact item wins over the generic line, because it is the more useful
 * answer — "win a royal flush" beats "comes from a daily draw" when both happen to be true. Everything
 * that is never handed out at random (an outfit, a title, a badge) falls back to `unavailable` rather
 * than naming a source that does not exist.
 */
export function hintFor(item: ItemDto, achievements: readonly AchievementDefDto[], t: TFunction<'normal'>): string {
  const rewarding = achievements.find((def) => def.reward.itemId === item.id)
  if (rewarding !== undefined) return achievementName(rewarding.id, t)
  if (DAILY_DRAW_SLOTS.has(item.slot)) return t(`wardrobe.hint.daily.${item.rarity}`)
  return t('wardrobe.hint.unavailable')
}
