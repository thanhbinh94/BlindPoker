/**
 * Avatars: what a configuration must look like, and what it takes to wear one (spec §15.1).
 *
 * An avatar is a stack of SVG layers drawn `base → face → clothing → hair → accessory → jewelry`,
 * plus a `title` and a `badge` shown beside the name at the table. Four of those layers are
 * required — a figure with no face is not a figure — and the rest are optional slots.
 *
 * `PUT /api/me/avatar` is a **full replace**, which is the whole reason `validateAvatarConfig`
 * rebuilds the value rather than patching the caller's object: omitting `title` is how a player
 * takes their title off, so the stored config must contain exactly the keys the request named, and
 * unknown keys must not survive into the database to be interpreted by some later version.
 *
 * Two checks are deliberately separate. *Validation* is about the catalogue — does this id exist,
 * does it belong in this slot — and is a 400, the same answer for every player. *Ownership* is
 * about this player's inventory and is a 403; it needs the database, so it lives in
 * `applyAvatarConfig` rather than here.
 */
import { eq } from 'drizzle-orm'
import type { AppDb } from '../db/client.js'
import { ServiceError } from '../errors.js'
import { players } from '../db/schema.js'
import type { InventoryService } from './inventory-service.js'
import type { ItemCatalog, ItemCategory } from './items.js'

/** The layers every avatar must have. Also what `loadItemCatalog` insists on a default for. */
export const REQUIRED_LAYERS = ['base', 'face', 'clothing', 'hair'] as const
/** The slots that may be empty: the two cosmetic overlays and the two name decorations. */
export const OPTIONAL_LAYERS = ['accessory', 'jewelry', 'title', 'badge'] as const

export type RequiredLayer = (typeof REQUIRED_LAYERS)[number]
export type OptionalLayer = (typeof OPTIONAL_LAYERS)[number]

/** Every avatar slot is named after the item category that fills it — the slot *is* the category. */
const SLOTS: readonly ItemCategory[] = [...REQUIRED_LAYERS, ...OPTIONAL_LAYERS]

/** `#rrggbb`, and nothing else: the value is interpolated into a CSS variable by `normal-web`. */
const HAIR_COLOR = /^#[0-9a-f]{6}$/i

/** What a player's hair is coloured before they choose otherwise. */
export const DEFAULT_HAIR_COLOR = '#2b2b2b'

export interface AvatarConfig {
  base: string
  face: string
  clothing: string
  hair: string
  /** A hex colour applied to the hair layer, not an item id. */
  hairColor: string
  accessory?: string
  jewelry?: string
  title?: string
  badge?: string
}

export interface AvatarView {
  config: AvatarConfig
}

export type AvatarErrorCode = 'INVALID_ITEM' | 'WRONG_CATEGORY' | 'INVALID_COLOR' | 'MISSING_LAYER'

export type AvatarValidation = { ok: true; value: AvatarConfig } | { ok: false; code: AvatarErrorCode }

/**
 * Checks a `PUT` body against the catalogue and returns the exact value to store.
 *
 * The order of the checks is the order a person would want to be told about them: a body missing a
 * layer entirely is answered before the colour, and the colour before the individual items, so the
 * first complaint is always the structural one.
 */
export function validateAvatarConfig(input: unknown, catalog: ItemCatalog): AvatarValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, code: 'MISSING_LAYER' }
  const raw = input as Record<string, unknown>

  for (const layer of REQUIRED_LAYERS) {
    const value = raw[layer]
    if (typeof value !== 'string' || value === '') return { ok: false, code: 'MISSING_LAYER' }
  }

  const hairColor = raw['hairColor']
  if (typeof hairColor !== 'string' || !HAIR_COLOR.test(hairColor)) return { ok: false, code: 'INVALID_COLOR' }

  const value: AvatarConfig = {
    base: raw['base'] as string,
    face: raw['face'] as string,
    clothing: raw['clothing'] as string,
    hair: raw['hair'] as string,
    hairColor,
  }

  for (const layer of OPTIONAL_LAYERS) {
    const slot = raw[layer]
    // `undefined` and `null` both mean "empty this slot"; anything else that is not a string is a
    // malformed id rather than an omission, and gets the item complaint.
    if (slot === undefined || slot === null) continue
    if (typeof slot !== 'string' || slot === '') return { ok: false, code: 'INVALID_ITEM' }
    value[layer] = slot
  }

  for (const slot of SLOTS) {
    const id = value[slot]
    if (id === undefined) continue
    const def = catalog.get(id)
    if (def === undefined) return { ok: false, code: 'INVALID_ITEM' }
    if (def.category !== slot) return { ok: false, code: 'WRONG_CATEGORY' }
  }

  return { ok: true, value }
}

/** Every item id a config references, in slot order and without the colour. */
export function itemIdsOf(config: AvatarConfig): string[] {
  return SLOTS.map((slot) => config[slot]).filter((id): id is string => id !== undefined)
}

/**
 * Stores a validated config, having first checked that the player owns every item in it.
 *
 * `equipped_title` and `equipped_badge` are written from the same config in the same statement.
 * They are a denormalization — the truth is inside `avatar_config` — and they exist so the table
 * view can read a player's decorations without parsing jsonb; keeping them in one `UPDATE` is what
 * stops the two from ever disagreeing.
 */
export async function applyAvatarConfig(
  db: AppDb,
  inventory: InventoryService,
  playerId: string,
  config: AvatarConfig,
): Promise<AvatarView> {
  const missing = await inventory.missingOf(playerId, itemIdsOf(config))
  if (missing.length > 0) throw new ServiceError('NOT_OWNED', `not owned: ${missing.join(', ')}`)

  const updated = await db
    .update(players)
    .set({
      avatarConfig: config as unknown as Record<string, unknown>,
      equippedTitle: config.title ?? null,
      equippedBadge: config.badge ?? null,
    })
    .where(eq(players.id, playerId))
    .returning({ id: players.id })
  if (updated.length === 0) throw new ServiceError('UNKNOWN_PLAYER', `no such player: ${playerId}`)

  return { config }
}

/**
 * The avatar a new account is created wearing: the first `isDefault` item of each required layer.
 *
 * Only the required layers are filled. The optional slots start empty on purpose — a new player
 * should look like the plainest possible figure, and anything they are wearing on day one is
 * something they never chose.
 */
export function defaultAvatar(catalog: ItemCatalog): AvatarConfig {
  const all = catalog.all()
  const pick = (layer: RequiredLayer): string => {
    const def = all.find((d) => d.category === layer && d.isDefault)
    // `loadItemCatalog` refuses a catalogue with a required layer that has no default, so reaching
    // here means someone built an `ItemCatalog` by hand and skipped that guarantee.
    if (def === undefined) throw new Error(`the item catalogue has no default for the required layer ${layer}`)
    return def.id
  }
  return { base: pick('base'), face: pick('face'), clothing: pick('clothing'), hair: pick('hair'), hairColor: DEFAULT_HAIR_COLOR }
}

/**
 * Reads a stored `avatar_config` back, falling back to the catalogue's default for anything the row
 * cannot supply.
 *
 * The column is `jsonb` with a `{}` default, so "an account that predates avatars" and "an account
 * whose config was written by an older shape" both have to render as *something*. Answering with
 * the default avatar is better than answering with a partial one the client would draw with holes.
 */
export function readAvatarConfig(stored: Record<string, unknown> | null | undefined, catalog: ItemCatalog): AvatarConfig {
  const checked = validateAvatarConfig(stored ?? {}, catalog)
  return checked.ok ? checked.value : defaultAvatar(catalog)
}
