/**
 * The vocabulary the wardrobe is written in: the slots an item can fill, and the two bases a figure
 * can be built on (design §4.4, §5.1).
 *
 * A leaf module on purpose. `items.ts` needs the slot list to validate the catalogue and `avatar.ts`
 * needs it to validate a configuration, while `items.ts` already imports `defaultAvatar` from
 * `avatar.ts` at run time; putting these constants in either of those two would close that into an
 * import cycle whose evaluation order decides whether a `const` is initialised or in its temporal
 * dead zone. Nothing here imports anything, so there is no order to get wrong.
 *
 * Plan 11 replaces the 3D figure with layered PNGs on a fixed frame. `hair`/`top`/`bottom`/`shoes`
 * are gone — a body is drawn once, as a fixed base, and its clothing is one indivisible `outfit`
 * rather than three separately worn pieces. `hat`/`accessory`/`jewelry` become `head`/`face`/`aura`,
 * and `frame` (the profile border) is new. `title` and `badge` are unchanged: text beside a name,
 * with nothing to draw.
 */

export type ItemSlot = 'head' | 'face' | 'outfit' | 'aura' | 'frame' | 'title' | 'badge'

/** The one slot an avatar must fill — and the only one `loadItemCatalog` insists on a default for. */
export const REQUIRED_SLOTS = ['outfit'] as const
/** Everything else may be empty: four cosmetic layers and the two name decorations. */
export const OPTIONAL_SLOTS = ['head', 'face', 'aura', 'frame', 'title', 'badge'] as const

export type RequiredSlot = (typeof REQUIRED_SLOTS)[number]
export type OptionalSlot = (typeof OPTIONAL_SLOTS)[number]

/** Every slot, in the order a configuration lists them. */
export const SLOTS: readonly ItemSlot[] = [...REQUIRED_SLOTS, ...OPTIONAL_SLOTS]

/**
 * The slots drawn as a PNG layer, which is exactly the set of items that must carry an `asset`.
 *
 * `title` and `badge` are the other two: text beside a name, with nothing to draw. This is also the
 * baseline the unowned-item draw pool (`inventory-service.ts`) is restricted to — a slot the
 * catalogue no longer defines (a withdrawn v2 slot whose rows still exist for old inventory rows'
 * foreign keys) must never surface as a reward just because its row is still in the `items` table.
 */
export const DRAWN_SLOTS: readonly ItemSlot[] = ['head', 'face', 'outfit', 'aura', 'frame']

/**
 * The slots a daily-reward draw may land on (§13.2, design §5.2).
 *
 * `outfit` is drawable geometry but not a *daily* draw: it is the one required slot, chosen once and
 * changed deliberately, not handed out at random alongside a hat or an aura.
 */
export const DAILY_DRAW_SLOTS: readonly ItemSlot[] = ['head', 'face', 'aura', 'frame']

/** Which fixed figure a chibi is drawn on. Not an item: a player picks it, they do not own it. */
export type BaseId = 'f01' | 'm01'
export const BASES: readonly BaseId[] = ['f01', 'm01']

export function isItemSlot(value: string): value is ItemSlot {
  return (SLOTS as readonly string[]).includes(value)
}

export function isBaseId(value: unknown): value is BaseId {
  return typeof value === 'string' && (BASES as readonly string[]).includes(value)
}

export function isDrawnSlot(slot: ItemSlot): boolean {
  return DRAWN_SLOTS.includes(slot)
}
