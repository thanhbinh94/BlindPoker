import type { AvatarConfigDto, ItemSlot } from '../api.js'

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
