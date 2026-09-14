/**
 * Avatars: what a configuration must look like, and what it takes to wear one (design §5.1).
 *
 * Since Plan 11 an avatar is a fixed base (`f01`/`m01`, chosen rather than owned) with PNG layers
 * stacked on it: one required `outfit` and up to five optional slots — `head`, `face`, `aura`,
 * `frame`, plus the two name decorations `title` and `badge`. There is no colour to choose any more;
 * every layer is either worn or it is not. `v: 3` is stored with it so a future shape can tell itself
 * apart from this one, and so `PUT` can refuse a v1 or v2 body outright instead of half-reading it.
 *
 * `PUT /api/me/avatar` is a **full replace**, which is the whole reason `validateAvatarConfig`
 * rebuilds the value rather than patching the caller's object: omitting `title` is how a player
 * takes their title off, so the stored config must contain exactly the keys the request named, and
 * unknown keys must not survive into the database to be interpreted by some later version.
 *
 * Reads are forgiving where writes are strict, and that half lives next door in `avatar-migrate.ts`:
 * `readAvatarConfig` repairs anything that does not validate here, so an account whose config was
 * written before Plan 11 renders as a complete v3 figure without a jsonb column being rewritten in
 * place. This module stays the one that decides what *valid* means, and does not import that one.
 *
 * Three checks are deliberately separate. *Validation* is about the catalogue — does this id exist,
 * does it belong in this slot, is the base one of the two that exist — and is a 400, the same answer
 * for every player. *Ownership* is about this player's inventory and is a 403; it needs the
 * database, so it lives in `applyAvatarConfig` rather than here.
 */
import { eq } from 'drizzle-orm'
import type { AppDb } from '../db/client.js'
import { ServiceError } from '../errors.js'
import { players } from '../db/schema.js'
import type { InventoryService } from './inventory-service.js'
import type { ItemCatalog } from './items.js'
import type { BaseId, RequiredSlot } from './slots.js'
import { isBaseId, OPTIONAL_SLOTS, REQUIRED_SLOTS, SLOTS } from './slots.js'

export type { BaseId, ItemSlot } from './slots.js'
export { OPTIONAL_SLOTS, REQUIRED_SLOTS, SLOTS } from './slots.js'

/** The version stored with every configuration this server writes. */
export const AVATAR_CONFIG_VERSION = 3

/** The base a v3 config falls back to when nothing better is known — `defaultAvatar`'s own choice. */
export const DEFAULT_BASE: BaseId = 'f01'

export interface AvatarConfigV3 {
  v: typeof AVATAR_CONFIG_VERSION
  /** Chosen, not owned — see `slots.ts`. */
  base: BaseId
  outfit: string
  head?: string
  face?: string
  aura?: string
  frame?: string
  title?: string
  badge?: string
}

export interface AvatarView {
  config: AvatarConfigV3
}

export type AvatarErrorCode = 'INVALID_ITEM' | 'WRONG_CATEGORY' | 'MISSING_LAYER' | 'INVALID_BASE'

export type AvatarValidation = { ok: true; value: AvatarConfigV3 } | { ok: false; code: AvatarErrorCode }

/**
 * Checks a `PUT` body against the catalogue and returns the exact value to store.
 *
 * The order of the checks is the order a person would want to be told about them: a body that is not
 * v3 is answered before the base, the base before the required slot, and the required slot before
 * the individual items, so the first complaint is always the structural one.
 *
 * `MISSING_LAYER` is a structural refusal — not v3, no base at all, or no `outfit`. `INVALID_BASE` is
 * a base that is neither `f01` nor `m01`. `INVALID_ITEM` and `WRONG_CATEGORY` are §19.2's, unchanged
 * in meaning: an id the catalogue does not have, or one that belongs to a different slot.
 */
export function validateAvatarConfig(input: unknown, catalog: ItemCatalog): AvatarValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, code: 'MISSING_LAYER' }
  const raw = input as Record<string, unknown>

  // v1/v2 are readable (`readAvatarConfig`) but not writable: a client that still sends `body` and
  // `hair` is a client that would also *render* the answer wrong, so it is told to update.
  if (raw['v'] !== AVATAR_CONFIG_VERSION) return { ok: false, code: 'MISSING_LAYER' }

  const base = raw['base']
  if (base === undefined || base === null) return { ok: false, code: 'MISSING_LAYER' }
  if (!isBaseId(base)) return { ok: false, code: 'INVALID_BASE' }

  for (const slot of REQUIRED_SLOTS) {
    const value = raw[slot]
    if (typeof value !== 'string' || value === '') return { ok: false, code: 'MISSING_LAYER' }
  }

  const value: AvatarConfigV3 = {
    v: AVATAR_CONFIG_VERSION,
    base,
    outfit: raw['outfit'] as string,
  }

  for (const slot of OPTIONAL_SLOTS) {
    const id = raw[slot]
    // `undefined` and `null` both mean "empty this slot"; anything else that is not a string is a
    // malformed id rather than an omission, and gets the item complaint.
    if (id === undefined || id === null) continue
    if (typeof id !== 'string' || id === '') return { ok: false, code: 'INVALID_ITEM' }
    value[slot] = id
  }

  for (const slot of SLOTS) {
    const id = value[slot]
    if (id === undefined) continue
    const def = catalog.get(id)
    if (def === undefined) return { ok: false, code: 'INVALID_ITEM' }
    if (def.slot !== slot) return { ok: false, code: 'WRONG_CATEGORY' }
  }

  return { ok: true, value }
}

/** Every item id a config references, in slot order and without the base. */
export function itemIdsOf(config: AvatarConfigV3): string[] {
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
  config: AvatarConfigV3,
): Promise<AvatarView> {
  // This is also the existence check. `inventory.player_id` is `ON DELETE cascade`, so owning an
  // item implies the `players` row is there — and every config names at least the required `outfit`,
  // so a player who is not there owns none of them and is refused here. That leaves the `UPDATE`
  // below with nothing to report: a zero-row result is unreachable, not a case to handle.
  const missing = await inventory.missingOf(playerId, itemIdsOf(config))
  if (missing.length > 0) throw new ServiceError('NOT_OWNED', `not owned: ${missing.join(', ')}`)

  await db
    .update(players)
    .set({
      avatarConfig: config as unknown as Record<string, unknown>,
      equippedTitle: config.title ?? null,
      equippedBadge: config.badge ?? null,
    })
    .where(eq(players.id, playerId))

  return { config }
}

/**
 * The default item of a slot, by id.
 *
 * `loadItemCatalog` refuses a catalogue with a required slot that has no default, so a miss here
 * means someone built an `ItemCatalog` by hand and skipped that guarantee.
 */
export function defaultItemId(catalog: ItemCatalog, slot: RequiredSlot): string {
  const def = catalog.defaultOf(slot)
  if (def === undefined) throw new Error(`the item catalogue has no default for the required slot ${slot}`)
  return def.id
}

/**
 * The avatar a new account is created wearing: the `f01` base and the default outfit.
 *
 * Nothing else is filled in. A new player should look like the plainest possible figure, and
 * anything they are wearing on day one is something they never chose.
 */
export function defaultAvatar(catalog: ItemCatalog): AvatarConfigV3 {
  return {
    v: AVATAR_CONFIG_VERSION,
    base: DEFAULT_BASE,
    outfit: defaultItemId(catalog, 'outfit'),
  }
}
