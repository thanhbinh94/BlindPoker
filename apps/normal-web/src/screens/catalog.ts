import type { BadgeTone } from '@bp/ui-kit'
import { GEOMETRIC_SLOTS, SLOTS, type GeometricSlot, type ItemSlot, type Rarity } from '../api.js'

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

/**
 * The slots the wardrobe offers as tiles: everything with geometry, in the order it is worn.
 *
 * Hair leads because it is the piece that is never absent and the one the colour box beside it dyes;
 * the three optional slots (hat, accessory, jewelry) come last, which is also where their "none" tile
 * belongs. It is `GEOMETRIC_SLOTS` unchanged, and named here so the screen reads as a list of groups
 * rather than as an import from `api.ts` that happens to be in the right order.
 */
export const WARDROBE_SLOTS: readonly GeometricSlot[] = GEOMETRIC_SLOTS

/** The two slots that are words rather than geometry, and are therefore chosen from a menu. */
export const WORD_SLOTS = ['title', 'badge'] as const
