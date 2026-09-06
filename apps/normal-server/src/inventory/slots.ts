/**
 * The vocabulary the wardrobe is written in: the slots an item can fill, and the two bodies it can
 * be modelled for (spec §15.1, avatar-3d design §3).
 *
 * A leaf module on purpose. `items.ts` needs the slot list to validate the catalogue and `avatar.ts`
 * needs it to validate a configuration, while `items.ts` already imports `defaultAvatar` from
 * `avatar.ts` at run time; putting these constants in either of those two would close that into an
 * import cycle whose evaluation order decides whether a `const` is initialised or in its temporal
 * dead zone. Nothing here imports anything, so there is no order to get wrong.
 *
 * The v1 slots `base` and `face` are gone: a 3D figure's body is chosen (`male`/`female`) rather
 * than worn, and its face is skin and eye colour rather than a layer. `clothing` became `top` and
 * gained `bottom`/`shoes`, and the headwear that used to sit in `accessory` has a slot of its own.
 */

export type ItemSlot = 'hair' | 'top' | 'bottom' | 'shoes' | 'hat' | 'accessory' | 'jewelry' | 'title' | 'badge'

/** The slots an avatar must fill — and the ones `loadItemCatalog` insists on a default for. */
export const REQUIRED_SLOTS = ['hair', 'top', 'bottom', 'shoes'] as const
/** The slots that may be empty: three optional pieces and the two name decorations. */
export const OPTIONAL_SLOTS = ['hat', 'accessory', 'jewelry', 'title', 'badge'] as const

export type RequiredSlot = (typeof REQUIRED_SLOTS)[number]
export type OptionalSlot = (typeof OPTIONAL_SLOTS)[number]

/** Every slot, in the order a configuration lists them. */
export const SLOTS: readonly ItemSlot[] = [...REQUIRED_SLOTS, ...OPTIONAL_SLOTS]

/**
 * The slots drawn as geometry, which is exactly the set of items that must carry `variants`.
 *
 * `title` and `badge` are the other two: text beside a name, with nothing to attach to a body.
 */
export const GEOMETRIC_SLOTS: readonly ItemSlot[] = [...REQUIRED_SLOTS, 'hat', 'accessory', 'jewelry']

/** Which base mesh a figure is built on. Not an item: a player chooses it, they do not own it. */
export type Body = 'male' | 'female'
export const BODIES: readonly Body[] = ['male', 'female']

export function isItemSlot(value: string): value is ItemSlot {
  return (SLOTS as readonly string[]).includes(value)
}

export function isBody(value: unknown): value is Body {
  return typeof value === 'string' && (BODIES as readonly string[]).includes(value)
}

export function isGeometricSlot(slot: ItemSlot): boolean {
  return GEOMETRIC_SLOTS.includes(slot)
}
