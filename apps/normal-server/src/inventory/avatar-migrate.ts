/**
 * Reading an `avatar_config` that was written by an older version of this server (design §5.2).
 *
 * Plan 11 replaced the 3D figure with layered PNGs on a fixed frame, and the shapes do not line up:
 * `body` becomes a chosen `base`, `hair`/`top`/`bottom`/`shoes` collapse into one required `outfit`,
 * and `hat`/`accessory`/`jewelry` become `head`/`face`/`aura` — sometimes several old slots folding
 * into one new one, since an `accessory` used to mean either a face piece or a hat. Rather than
 * rewrite every row in a migration — a jsonb `UPDATE` that has to be right the first time, on data
 * nobody can look at afterwards — the stored value is left alone and repaired on the way out.
 *
 * The repair is deliberately not "v2 only". It runs over anything `validateAvatarConfig` refused,
 * including a v1 config from before Plan 8 (`base`/`face`/`clothing`, no `body` at all) and a v3
 * config that names an item the catalogue has since withdrawn, and answers with the closest valid
 * figure: what still means something is kept — through `data/item-aliases.json`'s old-to-new map —
 * and everything else falls back to the default outfit.
 *
 * Every candidate field is resolved the same way regardless of which old shape it came from:
 * `resolveItemId` turns an old id into its current one (or leaves an id nobody renamed alone), and
 * the *catalogue's own slot* for the resolved id decides which v3 slot it lands in — which is what
 * lets one `accessory` value become a `head` for `hat_crown` and a `face` for `accessory_glasses`
 * without a second list here to keep in step with `items.json`.
 *
 * Writes never come through here. `PUT /api/me/avatar` refuses anything but v3 (`MISSING_LAYER`),
 * so the only way a repaired config becomes the stored one is the player saving it themselves.
 */
import { resolveItemId } from './aliases.js'
import type { AvatarConfigV3 } from './avatar.js'
import { AVATAR_CONFIG_VERSION, DEFAULT_BASE, defaultAvatar, validateAvatarConfig } from './avatar.js'
import type { ItemCatalog } from './items.js'
import type { BaseId, ItemSlot } from './slots.js'
import { isBaseId } from './slots.js'

/** `raw[key]`, resolved through the alias map, if it names a catalogue item that belongs in `slot`. */
function candidateFor(raw: unknown, slot: ItemSlot, catalog: ItemCatalog, aliases: ReadonlyMap<string, string>): string | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined
  const id = resolveItemId(raw, aliases)
  const def = catalog.get(id)
  return def !== undefined && def.slot === slot ? id : undefined
}

/** The first of `candidates` that resolves to a wearable item of `slot`. */
function pick(slot: ItemSlot, catalog: ItemCatalog, aliases: ReadonlyMap<string, string>, ...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    const id = candidateFor(candidate, slot, catalog, aliases)
    if (id !== undefined) return id
  }
  return undefined
}

/** The base a stored config names, however it named it: `base` itself, or v1/v2's `body`. */
function baseOf(raw: Record<string, unknown>): BaseId {
  if (isBaseId(raw['base'])) return raw['base']
  if (raw['body'] === 'female') return 'f01'
  if (raw['body'] === 'male') return 'm01'
  return DEFAULT_BASE
}

/**
 * The closest valid v3 configuration to whatever is stored.
 *
 * `outfit` tries, in order: the config's own `outfit` (a v3 config invalidated by something else),
 * the v2 `top`, and the v1 `clothing` — each resolved through the alias map, so `clothing_suit`
 * lands on `outfit_tuxedo01` and a plain `top_tee` finds nothing and falls through to the default.
 * `head` and `face` both try the v2 `accessory` in addition to their own field and (for `head`) the
 * v2 `hat`, because that one old field used to mean either.
 */
export function migrateAvatarConfig(stored: Record<string, unknown> | null | undefined, catalog: ItemCatalog, aliases: ReadonlyMap<string, string>): AvatarConfigV3 {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return defaultAvatar(catalog)
  const raw = stored as Record<string, unknown>

  const outfit = pick('outfit', catalog, aliases, raw['outfit'], raw['top'], raw['clothing']) ?? defaultAvatar(catalog).outfit
  const config: AvatarConfigV3 = { v: AVATAR_CONFIG_VERSION, base: baseOf(raw), outfit }

  const head = pick('head', catalog, aliases, raw['head'], raw['hat'], raw['accessory'])
  if (head !== undefined) config.head = head
  const face = pick('face', catalog, aliases, raw['face'], raw['accessory'])
  if (face !== undefined) config.face = face
  const aura = pick('aura', catalog, aliases, raw['aura'], raw['jewelry'])
  if (aura !== undefined) config.aura = aura
  const frame = pick('frame', catalog, aliases, raw['frame'])
  if (frame !== undefined) config.frame = frame
  const title = pick('title', catalog, aliases, raw['title'])
  if (title !== undefined) config.title = title
  const badge = pick('badge', catalog, aliases, raw['badge'])
  if (badge !== undefined) config.badge = badge

  // The last word belongs to the validator, not to the repair. Nothing above should be able to
  // produce an invalid figure — but this function's whole job is to be the thing that never hands
  // the client something it cannot draw, and one check is cheaper than that promise is to keep.
  const checked = validateAvatarConfig(config, catalog)
  return checked.ok ? checked.value : defaultAvatar(catalog)
}

/**
 * Reads a stored `avatar_config` back as a v3 configuration, whatever shape it was written in.
 *
 * The column is `jsonb` with a `{}` default, so "an account that predates avatars", "an account
 * written by v1 or v2" and "an account wearing an item Plan 11 withdrew" all have to render as
 * *something*. Answering with a repaired figure is better than answering with a partial one the
 * client would draw with holes.
 *
 * `aliases` is a parameter rather than a hidden default so a caller never pays for a second parse of
 * `item-aliases.json`: `app.ts` loads it once, alongside the catalogue, and passes the same map
 * everywhere a config is read.
 */
export function readAvatarConfig(stored: Record<string, unknown> | null | undefined, catalog: ItemCatalog, aliases: ReadonlyMap<string, string>): AvatarConfigV3 {
  const checked = validateAvatarConfig(stored ?? {}, catalog)
  return checked.ok ? checked.value : migrateAvatarConfig(stored, catalog, aliases)
}
