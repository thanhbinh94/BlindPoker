import { GEOMETRIC_SLOTS, type AvatarConfigDto, type Body, type GeometricSlot, type ItemSlot } from '../api.js'

/**
 * The two closed palettes, in the server's order — `apps/normal-server/data/palettes.json`.
 *
 * They are copied rather than imported because a browser bundle may not reach into the server
 * package. What keeps the copy honest is `palettes.test.ts`, which reads that JSON file (the same
 * way the locale parity test reads `items.json`) and fails the build if these two arrays and it ever
 * disagree — which they otherwise would silently, as a swatch the wardrobe paints and the server
 * answers `INVALID_COLOR` to.
 *
 * The *order* is part of the contract too, not just the set: the names in the locale bundles are
 * indexed by position (`wardrobe.skinTone.0` … `.7`), so a reordering would rename every tone.
 */
export const SKIN_TONES = ['#f7dcc3', '#efc9a4', '#e0ac81', '#c98d62', '#a9714b', '#8a563a', '#66402c', '#452b1e'] as const

/** Dark brown, brown, amber, green, blue, grey — the server's `EYE_COLORS`, in its order. */
export const EYE_COLORS = ['#3b2415', '#6b4a2f', '#8c6239', '#2f5d50', '#33608c', '#5b5b66'] as const

/** The two figures, in the order the wardrobe offers them. */
export const BODIES: readonly Body[] = ['male', 'female']

/**
 * Hair colour: free, unlike skin and eyes.
 *
 * The server accepts any `#rrggbb` here (`HEX_COLOR` in its `avatar.ts`) because hair is dyed on
 * purpose, where a skin tone outside the palette would be a bright green person. These eight are the
 * shortcuts the wardrobe offers — the theme's own ink, three naturals, and four dyes.
 */
export const HAIR_PRESETS = ['#2b2b2b', '#4a2f1d', '#8a5a2b', '#d9a441', '#c8323c', '#3f938a', '#7b4bbd', '#e7e3d8'] as const

/** What hair is coloured before anyone chooses otherwise — the server's `DEFAULT_HAIR_COLOR`. */
export const DEFAULT_HAIR_COLOR = '#2b2b2b'

/** The colour syntax the free field accepts, and the same shape the server demands. */
export const HEX_COLOR = /^#[0-9a-f]{6}$/i

/**
 * Editing one slot of a configuration — the operation the wardrobe, the inventory's previews and every
 * "try this on" in the app are all made of.
 *
 * The obvious `{ ...config, [slot]: itemId }` is a computed key over a union. TypeScript widens that to
 * a string index and loses precisely the distinction this function exists to keep: the four required
 * slots cannot hold `undefined`, and the five optional ones must be able to, because *removing* the key
 * is how a slot is emptied — the server reads a `''` as a malformed item id, not as "nothing".
 */
export function withSlot(config: AvatarConfigDto, slot: ItemSlot, itemId: string): AvatarConfigDto {
  const optional = itemId === '' ? undefined : itemId
  switch (slot) {
    case 'hair':
      return { ...config, hair: itemId }
    case 'top':
      return { ...config, top: itemId }
    case 'bottom':
      return { ...config, bottom: itemId }
    case 'shoes':
      return { ...config, shoes: itemId }
    case 'hat':
      return { ...config, hat: optional }
    case 'accessory':
      return { ...config, accessory: optional }
    case 'jewelry':
      return { ...config, jewelry: optional }
    case 'title':
      return { ...config, title: optional }
    default:
      return { ...config, badge: optional }
  }
}

/**
 * What the wardrobe knows about geometry, narrowed to the two questions changing body asks.
 *
 * A port rather than the catalogue itself, because the answers come from two places at once — the
 * catalogue says which bodies an item was modelled for, the player's inventory says which pieces are
 * theirs to fall back on — and because it makes `switchBody` a function a test can drive without a
 * fixture of `ItemDto`s.
 */
export interface BodyFit {
  /** Whether that item has geometry for that body (`ItemDto.variants[body]`). */
  fits(itemId: string, body: Body): boolean
  /**
   * What to wear instead when the equipped piece has no variant for the new body: the slot's default
   * where there is one, otherwise any owned piece that fits, otherwise nothing — which is a valid
   * answer for the three optional slots and only for those.
   */
  fallback(slot: GeometricSlot, body: Body): string | undefined
}

export interface BodySwitch {
  config: AvatarConfigDto
  /** The slots that had to be changed, in `GEOMETRIC_SLOTS` order. Empty when the outfit came across whole. */
  changed: GeometricSlot[]
}

/**
 * Change the figure, keeping as much of the outfit as has been modelled for it (design §6, §A3).
 *
 * The source packs are not symmetric, so "one item, two bodies" is an aspiration rather than a fact:
 * a hat exists for both, a particular jacket may exist for one. The server *refuses* a configuration
 * that wears an item on a body it has no variant for (`INVALID_ITEM`), so a wardrobe that simply set
 * `body` and left the rest alone would produce a figure that renders with holes in it and then cannot
 * be saved — with the refusal naming an item the player never touched.
 *
 * So the swap is done here, and it reports what it had to change: the screen turns `changed` into a
 * sentence, because a top that silently became the default tee is a top the player will think they
 * lost.
 */
export function switchBody(config: AvatarConfigDto, body: Body, fit: BodyFit): BodySwitch {
  if (config.body === body) return { config, changed: [] }

  let next: AvatarConfigDto = { ...config, body }
  const changed: GeometricSlot[] = []

  for (const slot of GEOMETRIC_SLOTS) {
    const itemId = config[slot]
    // An empty optional slot stays empty: there is nothing to lose and nothing to report.
    if (itemId === undefined || itemId === '') continue
    if (fit.fits(itemId, body)) continue
    changed.push(slot)
    next = withSlot(next, slot, fit.fallback(slot, body) ?? '')
  }

  return { config: next, changed }
}

/**
 * The configuration as it goes on the wire: optional slots *omitted* rather than emptied.
 *
 * `PUT /api/me/avatar` is a full replace, so the body is the whole truth — and a key carrying
 * `undefined` disappears in `JSON.stringify` anyway. Building it explicitly is what makes that
 * deliberate rather than incidental, and it drops anything a spread had picked up along the way.
 */
export function avatarPayload(config: AvatarConfigDto): AvatarConfigDto {
  return {
    v: 2,
    body: config.body,
    skin: config.skin,
    eyes: config.eyes,
    hairColor: config.hairColor,
    hair: config.hair,
    top: config.top,
    bottom: config.bottom,
    shoes: config.shoes,
    ...(config.hat === undefined ? {} : { hat: config.hat }),
    ...(config.accessory === undefined ? {} : { accessory: config.accessory }),
    ...(config.jewelry === undefined ? {} : { jewelry: config.jewelry }),
    ...(config.title === undefined ? {} : { title: config.title }),
    ...(config.badge === undefined ? {} : { badge: config.badge }),
  }
}
