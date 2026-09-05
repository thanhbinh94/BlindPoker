import type { BadgeTone } from '@bp/ui-kit'
import type { ItemCategory, Rarity } from '../api.js'

/**
 * The catalogue vocabulary two lazily-loaded screens share.
 *
 * It is its own module rather than an export off either of them precisely *because* they are separate
 * chunks: an import across the two would drag the whole wardrobe into the inventory route's download for the
 * sake of a three-entry table.
 */

/** Rarity, as the kit paints it: muted → teal → gold, so rarer reads as warmer. */
export const RARITY_TONE: Record<Rarity, BadgeTone> = { common: 'muted', rare: 'teal', epic: 'gold' }

/** Every category the catalogue has, in the order a player thinks about them: the face first, the words last. */
export const CATEGORIES: ItemCategory[] = ['base', 'face', 'clothing', 'hair', 'accessory', 'jewelry', 'title', 'badge']
