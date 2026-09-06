/**
 * Reading an `avatar_config` that was written by an older version of this server (design §3.3).
 *
 * Plan 8 replaced the six SVG layers with a 3D figure, and the two shapes do not line up: `base` and
 * `face` are gone (a body is chosen, a face is colour), `clothing` became `top` and brought
 * `bottom` and `shoes` with it, and the headwear that lived in `accessory` moved to `hat`. Rather
 * than rewrite every row in a migration — a jsonb `UPDATE` that has to be right the first time, on
 * data nobody can look at afterwards — the stored value is left alone and repaired on the way out.
 *
 * The repair is deliberately not "v1 only". It runs over anything `validateAvatarConfig` refused,
 * including a v2 config that names an item the catalogue has since withdrawn, and answers with the
 * closest valid figure: what still means something is kept, everything else falls back to the slot's
 * default. Those defaults are the four items `0001_avatar_v2.sql` granted to every existing player,
 * so the result is always something its owner can actually wear.
 *
 * Writes never come through here. `PUT /api/me/avatar` refuses anything but v2 (`MISSING_LAYER`),
 * so the only way a repaired config becomes the stored one is the player saving it themselves.
 */
import type { AvatarConfigV2 } from './avatar.js'
import {
  AVATAR_CONFIG_VERSION,
  DEFAULT_BODY,
  DEFAULT_EYE_COLOR,
  DEFAULT_HAIR_COLOR,
  DEFAULT_SKIN_TONE,
  defaultAvatar,
  defaultItemId,
  EYE_COLORS,
  HEX_COLOR,
  paletteEntry,
  SKIN_TONES,
  validateAvatarConfig,
} from './avatar.js'
import type { ItemCatalog } from './items.js'
import type { Body, ItemSlot } from './slots.js'
import { isBody, isGeometricSlot } from './slots.js'

/**
 * v1 ids that were renamed rather than withdrawn.
 *
 * `clothing_tee` was the default shirt every account was registered wearing, so it is the one id
 * whose disappearance would have been visible to everybody; it is `top_tee` now, which every
 * account owns for the same reason.
 */
const RENAMED: Record<string, string> = { clothing_tee: 'top_tee' }

/**
 * The id `raw` holds, if it is a string naming a catalogue item that belongs in `slot` and has been
 * modelled for `body`.
 *
 * The variant check is here rather than only in the validator so that an item the chosen body
 * cannot wear costs its own slot and not the whole figure.
 */
function itemFor(raw: unknown, slot: ItemSlot, body: Body, catalog: ItemCatalog): string | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined
  const id = RENAMED[raw] ?? raw
  const def = catalog.get(id)
  if (def === undefined || def.slot !== slot) return undefined
  return isGeometricSlot(slot) && def.variants?.[body] === undefined ? undefined : id
}

/** The first of `candidates` that names a wearable item of `slot`. */
function pick(slot: ItemSlot, body: Body, catalog: ItemCatalog, ...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    const id = itemFor(candidate, slot, body, catalog)
    if (id !== undefined) return id
  }
  return undefined
}

/**
 * The closest valid v2 configuration to whatever is stored.
 *
 * Every slot is resolved the same way: take the value that is already in it, fall back to the v1
 * key that used to hold it, and fall back again to the slot's default (for a required slot) or to
 * nothing (for an optional one). A v1 `accessory` therefore lands in `hat` or in `accessory`
 * according to the *catalogue's* own slot for that id — which is what makes `accessory_conical_hat`
 * and `hat_crown` become hats while `accessory_glasses` stays an accessory, without a second list
 * here to keep in step with `items.json`.
 */
export function migrateAvatarConfig(stored: Record<string, unknown> | null | undefined, catalog: ItemCatalog): AvatarConfigV2 {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return defaultAvatar(catalog)
  const raw = stored as Record<string, unknown>

  const body: Body = isBody(raw['body']) ? raw['body'] : DEFAULT_BODY
  const hairColorRaw = raw['hairColor']
  // Folded like `validateAvatarConfig` folds it, so a v1 config's upper-case hex does not mint a
  // second cache key for the same figure the moment it is re-saved.
  const hairColor = typeof hairColorRaw === 'string' && HEX_COLOR.test(hairColorRaw) ? hairColorRaw.toLowerCase() : DEFAULT_HAIR_COLOR

  const config: AvatarConfigV2 = {
    v: AVATAR_CONFIG_VERSION,
    body,
    skin: paletteEntry(SKIN_TONES, raw['skin']) ?? DEFAULT_SKIN_TONE,
    eyes: paletteEntry(EYE_COLORS, raw['eyes']) ?? DEFAULT_EYE_COLOR,
    hairColor,
    hair: pick('hair', body, catalog, raw['hair']) ?? defaultItemId(catalog, 'hair'),
    // v1's `clothing` is v2's `top`; `bottom` and `shoes` did not exist and start at their defaults.
    top: pick('top', body, catalog, raw['top'], raw['clothing']) ?? defaultItemId(catalog, 'top'),
    bottom: pick('bottom', body, catalog, raw['bottom']) ?? defaultItemId(catalog, 'bottom'),
    shoes: pick('shoes', body, catalog, raw['shoes']) ?? defaultItemId(catalog, 'shoes'),
  }

  const hat = pick('hat', body, catalog, raw['hat'], raw['accessory'])
  if (hat !== undefined) config.hat = hat
  const accessory = pick('accessory', body, catalog, raw['accessory'])
  if (accessory !== undefined) config.accessory = accessory
  const jewelry = pick('jewelry', body, catalog, raw['jewelry'])
  if (jewelry !== undefined) config.jewelry = jewelry
  const title = pick('title', body, catalog, raw['title'])
  if (title !== undefined) config.title = title
  const badge = pick('badge', body, catalog, raw['badge'])
  if (badge !== undefined) config.badge = badge

  // The last word belongs to the validator, not to the repair. Nothing above should be able to
  // produce an invalid figure — but this function's whole job is to be the thing that never hands
  // the client something it cannot draw, and one check is cheaper than that promise is to keep.
  const checked = validateAvatarConfig(config, catalog)
  return checked.ok ? checked.value : defaultAvatar(catalog)
}

/**
 * Reads a stored `avatar_config` back as a v2 configuration, whatever shape it was written in.
 *
 * The column is `jsonb` with a `{}` default, so "an account that predates avatars", "an account
 * written by v1" and "an account wearing an item Plan 8 withdrew" all have to render as *something*.
 * Answering with a repaired figure is better than answering with a partial one the client would
 * draw with holes.
 */
export function readAvatarConfig(stored: Record<string, unknown> | null | undefined, catalog: ItemCatalog): AvatarConfigV2 {
  const checked = validateAvatarConfig(stored ?? {}, catalog)
  return checked.ok ? checked.value : migrateAvatarConfig(stored, catalog)
}
