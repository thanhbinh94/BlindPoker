import type { BadgeTone } from '@bp/ui-kit'
import { SLOTS, type ItemSlot, type Rarity } from '../api.js'

/**
 * The catalogue vocabulary two lazily-loaded screens share.
 *
 * It is its own module rather than an export off either of them precisely *because* they are separate
 * chunks: an import across the two would drag the whole wardrobe into the inventory route's download for the
 * sake of a three-entry table.
 */

/** Rarity, as the kit paints it: muted → teal → gold, so rarer reads as warmer. */
export const RARITY_TONE: Record<Rarity, BadgeTone> = { common: 'muted', rare: 'teal', epic: 'gold' }

/**
 * Every slot, in the order a player thinks about them: what is worn first, the words last.
 *
 * The order is `api.ts`'s, which is the assembler's, which is the manifest's — one sequence, so the
 * wardrobe's groups, the inventory's panels and the scene graph cannot drift into three orders.
 */
export const SLOT_ORDER: ItemSlot[] = SLOTS
