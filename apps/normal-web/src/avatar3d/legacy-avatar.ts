/**
 * The v2 wardrobe vocabulary, frozen here for `avatar3d`'s own sake.
 *
 * Plan 11 replaces the wire format `api.ts` exports — `AvatarConfigDto` is now the v3 chibi shape
 * (design §5.1), and the v2 fields this whole 3D pipeline was built on (`body`, `hair`, `top`,
 * `bottom`, `shoes`, `hat`, `accessory`, `jewelry`) no longer exist there. `avatar3d/` itself is
 * retired in the very next task (Plan 11 removes the 3D pipeline outright) rather than in this one,
 * so until then its ~20 files still need a shape to compile and test against. This module is that
 * shape — copied, not re-derived, from the `api.ts` this replaced — so `avatar3d` keeps working
 * unchanged and disappears whole when its task comes.
 */

/** The slots a v2 item could occupy. */
export type ItemSlot = 'hair' | 'top' | 'bottom' | 'shoes' | 'hat' | 'accessory' | 'jewelry' | 'title' | 'badge'

/** The two figures every geometric item was modelled for. */
export type Body = 'male' | 'female'

/** Every slot that has geometry, in the order the assembler stacks it — `title` and `badge` are words. */
export const GEOMETRIC_SLOTS = ['hair', 'top', 'bottom', 'shoes', 'hat', 'accessory', 'jewelry'] as const

export type GeometricSlot = (typeof GEOMETRIC_SLOTS)[number]

/** The four slots a configuration must fill; a figure with no top is not a figure. */
export const REQUIRED_SLOTS = ['hair', 'top', 'bottom', 'shoes'] as const

/** The three geometric slots that may be left empty, and are empty on a new account. */
export const OPTIONAL_SLOTS = ['hat', 'accessory', 'jewelry'] as const

/** Every slot, in the order the wardrobe and the inventory offered them: worn first, words last. */
export const SLOTS: ItemSlot[] = [...GEOMETRIC_SLOTS, 'title', 'badge']

/**
 * One player's figure, v2 — `AvatarConfigDto` before Plan 11. A body, three colours, and one item id
 * per slot.
 */
export interface AvatarConfigDto {
  v: 2
  body: Body
  skin: string
  eyes: string
  hairColor: string
  hair: string
  top: string
  bottom: string
  shoes: string
  hat?: string
  accessory?: string
  jewelry?: string
  title?: string
  badge?: string
}
