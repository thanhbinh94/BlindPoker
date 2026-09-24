import type { BadgeTone } from '@bp/ui-kit'
import type { TFunction } from 'i18next'
import type { AchievementDefDto, ItemDto, ItemSlot, Rarity } from '../api.js'
import { achievementName } from '../catalog-i18n.js'

/**
 * The catalogue vocabulary two lazily-loaded screens share.
 *
 * It is its own module rather than an export off either of them precisely *because* they are separate
 * chunks: an import across the two would drag the whole wardrobe into the inventory route's download for
 * the sake of a three-entry table.
 */

/** Rarity, as the kit paints it: muted → teal → gold, so rarer reads as warmer. */
export const RARITY_TONE: Record<Rarity, BadgeTone> = { common: 'muted', rare: 'teal', epic: 'gold' }

/**
 * Every slot, in the order the inventory offers its panels: what is drawn first, the words last.
 *
 * `base` is not here — it is chosen, not owned, and has no inventory row of its own. `hairColor`/
 * `eyeColor` (Plan 13) sit right after the drawn slots, matching the wardrobe's own tab order —
 * they draw nothing, but they are owned exactly like everything above them, so a rare dye a player
 * won from the daily draw has to show up here too.
 */
export const SLOT_ORDER: ItemSlot[] = ['head', 'face', 'outfit', 'aura', 'frame', 'hairColor', 'eyeColor', 'title', 'badge']

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
