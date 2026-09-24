/**
 * The vocabulary the wardrobe is written in: the slots an item can fill, and what a base id is
 * (design §4.4, §5.1).
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
 *
 * 2026-09-24 (Plan 13): `hairColor` and `eyeColor` are two more optional slots, but unlike every
 * other one they draw nothing of their own — recolouring the base's own hair or eye pixels is not a
 * PNG layer, so neither belongs in `DRAWN_SLOTS`. A colour is still an item (an id a player owns or
 * doesn't), which is what buys it validation, ownership and a place in the daily draw for free.
 */

export type ItemSlot = 'head' | 'face' | 'outfit' | 'aura' | 'frame' | 'hairColor' | 'eyeColor' | 'title' | 'badge'

/** The one slot an avatar must fill — and the only one `loadItemCatalog` insists on a default for. */
export const REQUIRED_SLOTS = ['outfit'] as const
/** Everything else may be empty: six cosmetic slots and the two name decorations. */
export const OPTIONAL_SLOTS = ['head', 'face', 'aura', 'frame', 'hairColor', 'eyeColor', 'title', 'badge'] as const

/** The two colour slots (design §3.1) — every id in either one names a `colour` item, not a layer. */
export const COLOUR_SLOTS = ['hairColor', 'eyeColor'] as const

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
 * The slots a daily-reward draw may land on (§13.2, design §5.2, §3.4).
 *
 * `outfit` is drawable geometry but not a *daily* draw: it is the one required slot, chosen once and
 * changed deliberately, not handed out at random alongside a hat or an aura. `hairColor`/`eyeColor`
 * are here even though they draw nothing (design §3.4) — a rare colour is exactly as much a prize as
 * a rare hat; `InventoryService.unownedOfRarity` is what keeps every `free` colour out of the pool.
 */
export const DAILY_DRAW_SLOTS: readonly ItemSlot[] = ['head', 'face', 'aura', 'frame', 'hairColor', 'eyeColor']

/**
 * Which fixed figure a chibi is drawn on. Not an item: a player picks it, they do not own it.
 *
 * 2026-09-17: an **open** id, not a union of the two that happen to exist. More bases are coming — they
 * share F01's body and pose and differ in head, hair and skin tone — and the list of them is data:
 * `data/avatar-bases.json`, which `loadBases` reads and validates against the asset manifest. A union
 * here would have made every new base a code change in three packages, so the type is `string` and the
 * *registry* is what says whether a given string is a base (`isBaseId`, below, takes one).
 */
export type BaseId = string

/** The ids a loaded registry defines — `new Set(Object.keys(bases))`, `BaseRegistry`'s own key set. */
export type BaseIds = ReadonlySet<BaseId>

/** The base a config falls back to when nothing better is known; the registry must define it. */
export const DEFAULT_BASE: BaseId = 'f01'

/** How a base id may be spelled at all, before any registry is consulted: D01 §9.1's `base_<id>_L30`. */
export const BASE_ID_PATTERN = /^[a-z][a-z0-9]*$/

export function isItemSlot(value: string): value is ItemSlot {
  return (SLOTS as readonly string[]).includes(value)
}

/** Whether `value` is a base **this server has**: a string the loaded registry defines. */
export function isBaseId(value: unknown, bases: BaseIds): value is BaseId {
  return typeof value === 'string' && bases.has(value)
}

export function isDrawnSlot(slot: ItemSlot): boolean {
  return DRAWN_SLOTS.includes(slot)
}
