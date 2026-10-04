/**
 * The vocabulary the wardrobe is written in: the genders a figure can be drawn as, and the slots an
 * item can fill (design §4.4, §5.1; spec `2026-10-03-avatar-v4-design.md` §4).
 *
 * A leaf module on purpose. `items.ts` needs the slot list to validate the catalogue and `avatar.ts`
 * needs it to validate a configuration, while `items.ts` imports `defaultAvatar` from `avatar.ts` at
 * run time (and `avatar.ts` imports `items.ts` back, for types only); putting these constants in either
 * of those two would close that into an import cycle whose evaluation order decides whether a `const`
 * is initialised or in its temporal dead zone. Nothing here imports anything, so there is no order to
 * get wrong.
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
 *
 * 2026-10-03 (Plan 19, avatar v4): a figure is no longer a fixed base. It is a body per **gender**
 * (`data/avatar-bodies.json`, `bodies.ts`), bald, with the hair as an item of its own — `hairStyle`,
 * drawn as two layers (L20 behind the body, L60 in front of the face) — and its skin recoloured by a
 * third colour item, `skinColor`. `hairStyle` is required of a v4 figure but is **not** a
 * `REQUIRED_SLOTS` entry (ruling 3): that list means "exactly one `isDefault` item", while every
 * hairstyle a player starts with is `free` and the default depends on the gender (`DEFAULT_HAIR`).
 * So it is validated on its own, as `HAIR_SLOT`. The HTTP wire speaks v4 since A5, and the switch-over
 * (D1) deleted the old base registry (`bases.ts`, `data/avatar-bases.json`) and the `BaseId` vocabulary
 * that served it: an old account's base is history, read once in `avatar-migrate.ts` (`V3_BASES`), and a
 * v4 configuration that still carries `base` is refused (`INVALID_BASE`, `avatar.ts`).
 */

/** Which body a figure is drawn on (spec §4.3), and which cut of a gendered outfit it wears. */
export type Gender = 'f' | 'm'
export const GENDERS: readonly Gender[] = ['f', 'm']
/** The gender a configuration falls back to when nothing better is known. */
export const DEFAULT_GENDER: Gender = 'f'
/**
 * The hairstyle a gender starts with, and falls back to. `loadItemCatalog` refuses a catalogue in which
 * either is missing, of the other gender or not `free` — a new account must own its own hair.
 */
export const DEFAULT_HAIR: Readonly<Record<Gender, string>> = { f: 'hair_f_bob01', m: 'hair_m_tousled01' }
/** Required of every v4 figure, but validated on its own rather than through `REQUIRED_SLOTS` (ruling 3). */
export const HAIR_SLOT = 'hairStyle' as const

export type ItemSlot = 'hairStyle' | 'head' | 'face' | 'outfit' | 'aura' | 'frame' | 'hairColor' | 'eyeColor' | 'skinColor' | 'title' | 'badge'

/** The one slot with exactly one `isDefault` item — the only one `loadItemCatalog` insists on a default for. */
export const REQUIRED_SLOTS = ['outfit'] as const
/** Everything else may be empty: six cosmetic slots, three colours and the two name decorations. */
export const OPTIONAL_SLOTS = ['head', 'face', 'aura', 'frame', 'hairColor', 'eyeColor', 'skinColor', 'title', 'badge'] as const

/** The three colour slots (design §3.1, spec §4.2) — every id in one names a `colour` item, not a layer. */
export const COLOUR_SLOTS = ['hairColor', 'eyeColor', 'skinColor'] as const

export type RequiredSlot = (typeof REQUIRED_SLOTS)[number]
export type OptionalSlot = (typeof OPTIONAL_SLOTS)[number]

/** Every slot, in the order a configuration lists them: the hairstyle first. */
export const SLOTS: readonly ItemSlot[] = [HAIR_SLOT, ...REQUIRED_SLOTS, ...OPTIONAL_SLOTS]

/**
 * The slots drawn as a PNG layer, which is exactly the set of items that must carry an `asset`.
 *
 * `title` and `badge` are the other two: text beside a name, with nothing to draw. This is also the
 * baseline the unowned-item draw pool (`inventory-service.ts`) is restricted to — a slot the
 * catalogue no longer defines (a withdrawn v2 slot whose rows still exist for old inventory rows'
 * foreign keys) must never surface as a reward just because its row is still in the `items` table.
 * `hairStyle` is drawn (two layers, `asset.file` and `asset.back`); the three colours are not.
 */
export const DRAWN_SLOTS: readonly ItemSlot[] = ['hairStyle', 'head', 'face', 'outfit', 'aura', 'frame']

/**
 * The slots a daily-reward draw may land on (§13.2, design §5.2, §3.4).
 *
 * `outfit` is drawable geometry but not a *daily* draw: it is the one required slot, chosen once and
 * changed deliberately, not handed out at random alongside a hat or an aura. `hairColor`/`eyeColor`
 * are here even though they draw nothing (design §3.4) — a rare colour is exactly as much a prize as
 * a rare hat; `InventoryService.unownedOfRarity` is what keeps every `free` colour out of the pool.
 * `hairStyle` and `skinColor` are not here at all (spec §4.2): a look is chosen, never handed out.
 */
export const DAILY_DRAW_SLOTS: readonly ItemSlot[] = ['head', 'face', 'aura', 'frame', 'hairColor', 'eyeColor']

export function isItemSlot(value: string): value is ItemSlot {
  return (SLOTS as readonly string[]).includes(value)
}

export function isGender(value: unknown): value is Gender {
  return typeof value === 'string' && (GENDERS as readonly string[]).includes(value)
}

export function isDrawnSlot(slot: ItemSlot): boolean {
  return DRAWN_SLOTS.includes(slot)
}
