/**
 * Avatars: what a configuration must look like, and what it takes to wear one (design §5.1, spec §4.1).
 *
 * Since Plan 19 (avatar v4) a figure is a **gender** — which body it is drawn on (`bodies.ts`), chosen
 * rather than owned — plus items: a required `hairStyle` of that gender, the one required `outfit`, and up
 * to nine optional slots — `head`, `face`, `aura`, `frame`, the three colours `hairColor`, `eyeColor` and
 * `skinColor`, and the two name decorations `title` and `badge`. There is no `base` any more: what a base
 * used to fix — a hairstyle, a skin tone, a pair of eyes — is each an item of its own, so two players who
 * share a gender no longer have to share a face. `v: 4` is stored with it so a future shape can tell itself
 * apart from this one, and so `PUT` can refuse an older body outright instead of half-reading it.
 *
 * A colour (`hairColor`, `eyeColor`, `skinColor`) is an ordinary optional slot — an id a player owns,
 * validated and stored exactly the way `head` or `aura` are — that happens to draw no layer of its own
 * (`slots.ts`'s `DRAWN_SLOTS` leaves them out); its `colour` hex is what the client tints the body's own
 * pixels with. Every hairstyle and skin colour a player starts with is `free`, so wearing one is never an
 * ownership question in practice — but it is still asked, the same way as for a hat.
 *
 * `PUT /api/me/avatar` is a **full replace**, which is the whole reason `validateAvatarConfig` rebuilds the
 * value rather than patching the caller's object: omitting `title` is how a player takes their title off, so
 * the stored config must contain exactly the keys the request named, and unknown keys must not survive into
 * the database to be interpreted by some later version.
 *
 * Reads are forgiving where writes are strict, and that half lives next door in `avatar-migrate.ts`:
 * `readAvatarConfig` repairs anything that does not validate here — a v1, v2 or v3 config, or a v4 one an
 * edit to the catalogue has left stale — so an old account renders as a complete v4 figure without a jsonb
 * column being rewritten in place. This module stays the one that decides what *valid* means, and does not
 * import that one.
 *
 * This is the HTTP wire (Plan 19, A5): `PUT /api/me/avatar` and `PUT /api/me/outfits/:slot` validate with
 * `validateAvatarConfig`, a new account is registered wearing `defaultAvatar`, and every read answers v4.
 *
 * Three checks are deliberately separate. *Validation* is about the catalogue — does this id exist, does it
 * belong in this slot, is this hairstyle drawn for this body — and is a 400, the same answer for every
 * player. *Ownership* is about this player's inventory and is a 403; it needs the database, so it lives in
 * `applyAvatarConfig` rather than here.
 */
import { eq } from 'drizzle-orm'
import type { AppDb } from '../db/client.js'
import { ServiceError } from '../errors.js'
import { players } from '../db/schema.js'
import type { InventoryService } from './inventory-service.js'
import type { ItemCatalog } from './items.js'
import type { Gender, RequiredSlot } from './slots.js'
import { DEFAULT_GENDER, DEFAULT_HAIR, HAIR_SLOT, isGender, OPTIONAL_SLOTS, SLOTS } from './slots.js'

export type { Gender, ItemSlot } from './slots.js'
export { OPTIONAL_SLOTS, REQUIRED_SLOTS, SLOTS } from './slots.js'

/** The version stored with every configuration this server writes. */
export const AVATAR_CONFIG_VERSION = 4

export interface AvatarConfigV4 {
  v: typeof AVATAR_CONFIG_VERSION
  /** Chosen, not owned: which body the figure is drawn on (spec §4.3). */
  gender: Gender
  /** Required, and drawn for `gender` — a `hairStyle` item whose own `gender` matches. */
  hairStyle: string
  outfit: string
  head?: string
  face?: string
  aura?: string
  frame?: string
  /** Absent means the hairstyle's own colour (`ItemDef.naturalColour`). */
  hairColor?: string
  /** Absent means the body's own eyes (`BodyDef.naturalEyeColour`). */
  eyeColor?: string
  /** Absent means the body as drawn: the "cream" tone, "Tự nhiên" in the wardrobe. */
  skinColor?: string
  title?: string
  badge?: string
}

export interface AvatarView {
  config: AvatarConfigV4
}

export type AvatarErrorCode = 'INVALID_ITEM' | 'WRONG_CATEGORY' | 'MISSING_LAYER' | 'INVALID_BASE' | 'WRONG_GENDER'

export type AvatarValidation = { ok: true; value: AvatarConfigV4 } | { ok: false; code: AvatarErrorCode }

/**
 * Checks a `PUT` body against the catalogue and returns the exact value to store (spec §4.1, ruling 9).
 *
 * The order of the checks is the order a person would want to be told about them, structural first: a body
 * that is not v4 is answered before anything in it, a leftover `base` before the gender, the gender before
 * the two required slots, those before the individual items, and the items before `WRONG_GENDER` — which
 * only means something once the hairstyle is known to be a hairstyle.
 *
 * `MISSING_LAYER` is the structural refusal — not v4 (a v3 body included: a client that still sends `base`
 * would also *render* the answer wrong, so it is told to update), no gender a body exists for, or no
 * `hairStyle` or `outfit`. `INVALID_BASE` is a v4 body that still carries `base` at all (ruling 9): there is
 * no such field any more, so any value in it is a stale client rather than an id to look up. `INVALID_ITEM`
 * and `WRONG_CATEGORY` are §19.2's, unchanged in meaning: an id the catalogue does not have, or one that
 * belongs to a different slot. `WRONG_GENDER` is a hairstyle drawn for the other body.
 */
export function validateAvatarConfig(input: unknown, catalog: ItemCatalog): AvatarValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, code: 'MISSING_LAYER' }
  const raw = input as Record<string, unknown>

  if (raw['v'] !== AVATAR_CONFIG_VERSION) return { ok: false, code: 'MISSING_LAYER' }
  if (raw['base'] !== undefined) return { ok: false, code: 'INVALID_BASE' }

  const gender = raw['gender']
  if (!isGender(gender)) return { ok: false, code: 'MISSING_LAYER' }
  const hairStyle = raw[HAIR_SLOT]
  const outfit = raw['outfit']
  if (typeof hairStyle !== 'string' || hairStyle === '' || typeof outfit !== 'string' || outfit === '') return { ok: false, code: 'MISSING_LAYER' }

  const value: AvatarConfigV4 = { v: AVATAR_CONFIG_VERSION, gender, hairStyle, outfit }

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

  // The loop above has proved this is a hairstyle; `loadItemCatalog` guarantees every hairstyle has a gender.
  if (catalog.get(hairStyle)?.gender !== gender) return { ok: false, code: 'WRONG_GENDER' }

  return { ok: true, value }
}

/** Every item id a config references, in slot order — the hairstyle first — and without the gender, which is not an item. */
export function itemIdsOf(config: AvatarConfigV4): string[] {
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
  config: AvatarConfigV4,
): Promise<AvatarView> {
  // This is also the existence check. `inventory.player_id` is `ON DELETE cascade`, so owning an
  // item implies the `players` row is there — so a player who is not there owns none of a config's
  // non-`free` items and is refused here. A config made of free items alone (a free hairstyle and one
  // of the free casual outfits) is owned by anyone, the absent included, and would reach the `UPDATE`
  // below to change no row; every caller sits behind `requireUser`, which has already proved the
  // player exists, so a zero-row result is still not a case to handle here.
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
 * The avatar a new account is created wearing (spec §4.1): `DEFAULT_GENDER`, that gender's `DEFAULT_HAIR`,
 * and the default outfit.
 *
 * Nothing else is filled in. A new player should look like the plainest possible figure — the body's own
 * skin, eyes and hair colour — and anything they are wearing on day one is something they never chose.
 * `loadItemCatalog` refuses a catalogue whose `DEFAULT_HAIR` is missing, of the other gender or not free,
 * so this is always valid, and always owned.
 */
export function defaultAvatar(catalog: ItemCatalog): AvatarConfigV4 {
  return {
    v: AVATAR_CONFIG_VERSION,
    gender: DEFAULT_GENDER,
    hairStyle: DEFAULT_HAIR[DEFAULT_GENDER],
    outfit: defaultItemId(catalog, 'outfit'),
  }
}
