/**
 * Avatars: what a configuration must look like, and what it takes to wear one (spec §15.1,
 * avatar-3d design §3.1).
 *
 * Since Plan 8 an avatar is a 3D figure rather than a stack of SVG layers. A configuration names a
 * **body** (`male`/`female`), three colours the player chooses freely — skin and eyes from fixed
 * palettes, hair from any hex — and one item per slot: `hair`, `top`, `bottom` and `shoes` are
 * required, `hat`, `accessory`, `jewelry`, `title` and `badge` are optional. `v: 2` is stored with
 * it so a future shape can tell itself apart from this one, and so `PUT` can refuse a v1 body
 * outright instead of half-reading it.
 *
 * `PUT /api/me/avatar` is a **full replace**, which is the whole reason `validateAvatarConfig`
 * rebuilds the value rather than patching the caller's object: omitting `title` is how a player
 * takes their title off, so the stored config must contain exactly the keys the request named, and
 * unknown keys must not survive into the database to be interpreted by some later version.
 *
 * Reads are forgiving where writes are strict, and that half lives next door in `avatar-migrate.ts`:
 * `readAvatarConfig` repairs anything that does not validate here, so an account whose config was
 * written before Plan 8 renders as a complete v2 figure without a jsonb column being rewritten in
 * place. This module stays the one that decides what *valid* means, and does not import that one.
 *
 * Three checks are deliberately separate. *Validation* is about the catalogue — does this id exist,
 * does it belong in this slot, has it been modelled for this body — and is a 400, the same answer
 * for every player. *Ownership* is about this player's inventory and is a 403; it needs the
 * database, so it lives in `applyAvatarConfig` rather than here.
 */
import { eq } from 'drizzle-orm'
import type { AppDb } from '../db/client.js'
import { ServiceError } from '../errors.js'
import { players } from '../db/schema.js'
import type { InventoryService } from './inventory-service.js'
import type { ItemCatalog } from './items.js'
import { PALETTES } from './palettes.js'
import type { Body, RequiredSlot } from './slots.js'
import { isBody, isGeometricSlot, OPTIONAL_SLOTS, REQUIRED_SLOTS, SLOTS } from './slots.js'

export type { Body, ItemSlot } from './slots.js'
export { OPTIONAL_SLOTS, REQUIRED_SLOTS, SLOTS } from './slots.js'

/** The version stored with every configuration this server writes. */
export const AVATAR_CONFIG_VERSION = 2

/**
 * The eight skin tones a player may pick, light to deep (design §6).
 *
 * A closed palette rather than a free colour: skin is a material on a shared mesh, the eight are
 * lit and named (`normal-web` holds the names), and an arbitrary hex would let a figure be bright
 * green. Hair is the opposite case and stays free — it is dyed on purpose.
 *
 * The values themselves live in `data/palettes.json` rather than here, because the wardrobe has to
 * offer exactly what this module will accept and `normal-web` cannot import this file. See
 * `palettes.ts`.
 */
export const SKIN_TONES: readonly string[] = PALETTES.skin

/** The six eye colours, in the same spirit: dark brown, brown, amber, green, blue, grey. */
export const EYE_COLORS: readonly string[] = PALETTES.eyes

/** `#rrggbb`, and nothing else: the value reaches the client as a material colour. */
export const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** What a player's hair is coloured before they choose otherwise. */
export const DEFAULT_HAIR_COLOR = '#2b2b2b'
/** The middle of the palette, and what a v1 configuration is migrated to. */
export const DEFAULT_SKIN_TONE = SKIN_TONES[2]!
export const DEFAULT_EYE_COLOR = EYE_COLORS[0]!
/** v1 had no body at all; `male` is the figure its `base_*` layers were drawn as. */
export const DEFAULT_BODY: Body = 'male'

export interface AvatarConfigV2 {
  v: typeof AVATAR_CONFIG_VERSION
  body: Body
  /** One of `SKIN_TONES`. */
  skin: string
  /** One of `EYE_COLORS`. */
  eyes: string
  /** Any `#rrggbb`, stored lower-cased; applied to the hair material, not an item id. */
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

export interface AvatarView {
  config: AvatarConfigV2
}

export type AvatarErrorCode = 'INVALID_ITEM' | 'WRONG_CATEGORY' | 'INVALID_COLOR' | 'MISSING_LAYER'

export type AvatarValidation = { ok: true; value: AvatarConfigV2 } | { ok: false; code: AvatarErrorCode }

/** The palette entry `value` is, case folded — or undefined when it is not in the palette at all. */
export function paletteEntry(palette: readonly string[], value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const folded = value.toLowerCase()
  return palette.find((entry) => entry === folded)
}

/**
 * Checks a `PUT` body against the catalogue and returns the exact value to store.
 *
 * The order of the checks is the order a person would want to be told about them: a body that is
 * not v2, or is missing a slot entirely, is answered before the colours, and the colours before the
 * individual items, so the first complaint is always the structural one.
 *
 * The four codes are §19.2's and did not change with the shape. A missing or unknown `body` is a
 * `MISSING_LAYER` — it is the one structural field a figure cannot be built without — and a skin or
 * eye colour outside its palette is an `INVALID_COLOR`, the same as a malformed hair colour.
 */
export function validateAvatarConfig(input: unknown, catalog: ItemCatalog): AvatarValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, code: 'MISSING_LAYER' }
  const raw = input as Record<string, unknown>

  // v1 is readable (`migrateAvatarConfig`) but not writable: a client that still sends `base` and
  // `clothing` is a client that would also *render* the answer wrong, so it is told to update.
  if (raw['v'] !== AVATAR_CONFIG_VERSION) return { ok: false, code: 'MISSING_LAYER' }
  const body = raw['body']
  if (!isBody(body)) return { ok: false, code: 'MISSING_LAYER' }

  for (const slot of REQUIRED_SLOTS) {
    const value = raw[slot]
    if (typeof value !== 'string' || value === '') return { ok: false, code: 'MISSING_LAYER' }
  }

  const skin = paletteEntry(SKIN_TONES, raw['skin'])
  if (skin === undefined) return { ok: false, code: 'INVALID_COLOR' }
  const eyes = paletteEntry(EYE_COLORS, raw['eyes'])
  if (eyes === undefined) return { ok: false, code: 'INVALID_COLOR' }
  const hairColorRaw = raw['hairColor']
  if (typeof hairColorRaw !== 'string' || !HEX_COLOR.test(hairColorRaw)) return { ok: false, code: 'INVALID_COLOR' }
  // Folded like skin and eyes, so the client's config hash — the portrait cache key — is stable.
  const hairColor = hairColorRaw.toLowerCase()

  const value: AvatarConfigV2 = {
    v: AVATAR_CONFIG_VERSION,
    body,
    skin,
    eyes,
    hairColor,
    hair: raw['hair'] as string,
    top: raw['top'] as string,
    bottom: raw['bottom'] as string,
    shoes: raw['shoes'] as string,
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
    // An item modelled for one body only: real, because the source sets are not symmetric. Wearing
    // it on the other body would draw nothing at all, so it is refused here rather than silently.
    if (isGeometricSlot(slot) && def.variants?.[body] === undefined) return { ok: false, code: 'INVALID_ITEM' }
  }

  return { ok: true, value }
}

/** Every item id a config references, in slot order and without the colours or the body. */
export function itemIdsOf(config: AvatarConfigV2): string[] {
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
  config: AvatarConfigV2,
): Promise<AvatarView> {
  // This is also the existence check. `inventory.player_id` is `ON DELETE cascade`, so owning an
  // item implies the `players` row is there — and every config names at least the four required
  // slots, so a player who is not there owns none of them and is refused here. That leaves the
  // `UPDATE` below with nothing to report: a zero-row result is unreachable, not a case to handle.
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
 * The avatar a new account is created wearing: the male body, the middle skin tone, and the default
 * item of each required slot.
 *
 * Only the required slots are filled. The optional ones start empty on purpose — a new player
 * should look like the plainest possible figure, and anything they are wearing on day one is
 * something they never chose. (The plainest hair is `hair_none`, which is why the catalogue has it.)
 */
export function defaultAvatar(catalog: ItemCatalog): AvatarConfigV2 {
  return {
    v: AVATAR_CONFIG_VERSION,
    body: DEFAULT_BODY,
    skin: DEFAULT_SKIN_TONE,
    eyes: DEFAULT_EYE_COLOR,
    hairColor: DEFAULT_HAIR_COLOR,
    hair: defaultItemId(catalog, 'hair'),
    top: defaultItemId(catalog, 'top'),
    bottom: defaultItemId(catalog, 'bottom'),
    shoes: defaultItemId(catalog, 'shoes'),
  }
}
