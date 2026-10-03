/**
 * TEMPORARY — the v3 HTTP contract, kept alive for exactly one commit (Plan 19, A4; A5's first dispatch
 * deletes this file).
 *
 * A4 builds the v4 model (`avatar.ts`, `avatar-migrate.ts`) as a library while every route, the register
 * default, the catalogue's `defaultAvatar()` and `outfits-service.ts` keep speaking v3 through this module,
 * so the deployed behaviour of that commit is master's and the full e2e suite stays green (ruling 10). A5
 * switches all of them to v4 at once, together with the client.
 *
 * Everything below is the pre-A4 code, moved verbatim and renamed: `validateAvatarConfig` →
 * `validateAvatarConfigV3`, `itemIdsOf` → `itemIdsOfV3`, `applyAvatarConfig` → `applyAvatarConfigV3`,
 * `defaultAvatar` → `defaultAvatarV3` (from `avatar.ts`), and `migrateAvatarConfig` →
 * `migrateAvatarConfigV3`, `readAvatarConfig` → `readAvatarConfigV3` (from `avatar-migrate.ts`). A3's change
 * comes with it — `V3_SLOTS` skips the hairstyle, so a v3 config never names one and owning it never means
 * owning one — and so does the pre-A4 repair's known gap: it drops `hairColor` and `eyeColor`, which the v4
 * read (`avatar-migrate.ts`'s `repairV3`) keeps. Nothing here is meant to change before it goes.
 */
import { eq } from 'drizzle-orm'
import type { AppDb } from '../db/client.js'
import { players } from '../db/schema.js'
import { ServiceError } from '../errors.js'
import { resolveItemId } from './aliases.js'
import type { AvatarErrorCode } from './avatar.js'
import { defaultItemId } from './avatar.js'
import type { AvatarConfigV3 } from './avatar-migrate.js'
import type { InventoryService } from './inventory-service.js'
import type { ItemCatalog } from './items.js'
import type { BaseId, BaseIds, ItemSlot } from './slots.js'
import { DEFAULT_BASE, HAIR_SLOT, isBaseId, OPTIONAL_SLOTS, REQUIRED_SLOTS, SLOTS } from './slots.js'

/** The version the v3 wire stores and accepts. */
const AVATAR_CONFIG_VERSION_V3 = 3

/**
 * The slots a v3 configuration has: every slot but the hairstyle (Plan 19, A3). The hair is still baked into
 * a v3 base, so a v3 config never names one and owning it never means owning one.
 */
const V3_SLOTS = SLOTS.filter((slot): slot is Exclude<ItemSlot, typeof HAIR_SLOT> => slot !== HAIR_SLOT)

export interface AvatarViewV3 {
  config: AvatarConfigV3
}

export type AvatarValidationV3 = { ok: true; value: AvatarConfigV3 } | { ok: false; code: AvatarErrorCode }

/**
 * Checks a `PUT` body against the catalogue and returns the exact value to store.
 *
 * The order of the checks is the order a person would want to be told about them: a body that is not
 * v3 is answered before the base, the base before the required slot, and the required slot before
 * the individual items, so the first complaint is always the structural one.
 *
 * `MISSING_LAYER` is a structural refusal — not v3, no base at all, or no `outfit`. `INVALID_BASE` is
 * a base the loaded registry does not define (2026-09-17: `bases` is that registry's id set, passed in
 * rather than compared against a union in the code, so a base added to `data/avatar-bases.json` is
 * writable the moment the server has read it). `INVALID_ITEM` and `WRONG_CATEGORY` are §19.2's,
 * unchanged in meaning: an id the catalogue does not have, or one that belongs to a different slot.
 */
export function validateAvatarConfigV3(input: unknown, catalog: ItemCatalog, bases: BaseIds): AvatarValidationV3 {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, code: 'MISSING_LAYER' }
  const raw = input as Record<string, unknown>

  // v1/v2 are readable (`readAvatarConfigV3`) but not writable: a client that still sends `body` and
  // `hair` is a client that would also *render* the answer wrong, so it is told to update.
  if (raw['v'] !== AVATAR_CONFIG_VERSION_V3) return { ok: false, code: 'MISSING_LAYER' }

  const base = raw['base']
  if (base === undefined || base === null) return { ok: false, code: 'MISSING_LAYER' }
  if (!isBaseId(base, bases)) return { ok: false, code: 'INVALID_BASE' }

  for (const slot of REQUIRED_SLOTS) {
    const value = raw[slot]
    if (typeof value !== 'string' || value === '') return { ok: false, code: 'MISSING_LAYER' }
  }

  const value: AvatarConfigV3 = {
    v: AVATAR_CONFIG_VERSION_V3,
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

  for (const slot of V3_SLOTS) {
    const id = value[slot]
    if (id === undefined) continue
    const def = catalog.get(id)
    if (def === undefined) return { ok: false, code: 'INVALID_ITEM' }
    if (def.slot !== slot) return { ok: false, code: 'WRONG_CATEGORY' }
  }

  return { ok: true, value }
}

/** Every item id a v3 config references, in slot order and without the base (and never a hairstyle). */
export function itemIdsOfV3(config: AvatarConfigV3): string[] {
  return V3_SLOTS.map((slot) => config[slot]).filter((id): id is string => id !== undefined)
}

/**
 * Stores a validated config, having first checked that the player owns every item in it.
 *
 * `equipped_title` and `equipped_badge` are written from the same config in the same statement.
 * They are a denormalization — the truth is inside `avatar_config` — and they exist so the table
 * view can read a player's decorations without parsing jsonb; keeping them in one `UPDATE` is what
 * stops the two from ever disagreeing.
 */
export async function applyAvatarConfigV3(
  db: AppDb,
  inventory: InventoryService,
  playerId: string,
  config: AvatarConfigV3,
): Promise<AvatarViewV3> {
  // This is also the existence check. `inventory.player_id` is `ON DELETE cascade`, so owning an
  // item implies the `players` row is there — and every config names at least the required `outfit`,
  // so a player who is not there owns none of them and is refused here. That leaves the `UPDATE`
  // below with nothing to report: a zero-row result is unreachable, not a case to handle.
  const missing = await inventory.missingOf(playerId, itemIdsOfV3(config))
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
 * The avatar a new account is created wearing: `DEFAULT_BASE` and the default outfit.
 *
 * Nothing else is filled in. A new player should look like the plainest possible figure, and
 * anything they are wearing on day one is something they never chose.
 */
export function defaultAvatarV3(catalog: ItemCatalog): AvatarConfigV3 {
  return {
    v: AVATAR_CONFIG_VERSION_V3,
    base: DEFAULT_BASE,
    outfit: defaultItemId(catalog, 'outfit'),
  }
}

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

/**
 * The base a stored config names, however it named it: `base` itself, or v1/v2's `body`.
 *
 * 2026-09-17: "however it named it" now includes *a base this server no longer has*. The registry is
 * data, so an id that was valid when the config was written may not be in `data/avatar-bases.json` any
 * more — that config still has to render, so it falls back to `DEFAULT_BASE` here on the way out while
 * `validateAvatarConfigV3` goes on refusing it on the way in. The v1/v2 `body` words map to the two ids
 * Plan 11 shipped with, and fall back too if either has since been withdrawn.
 */
function baseOf(raw: Record<string, unknown>, bases: BaseIds): BaseId {
  if (isBaseId(raw['base'], bases)) return raw['base']
  const fromBody = raw['body'] === 'female' ? 'f01' : raw['body'] === 'male' ? 'm01' : null
  if (fromBody !== null && bases.has(fromBody)) return fromBody
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
export function migrateAvatarConfigV3(stored: Record<string, unknown> | null | undefined, catalog: ItemCatalog, aliases: ReadonlyMap<string, string>, bases: BaseIds): AvatarConfigV3 {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return defaultAvatarV3(catalog)
  const raw = stored as Record<string, unknown>

  const outfit = pick('outfit', catalog, aliases, raw['outfit'], raw['top'], raw['clothing']) ?? defaultAvatarV3(catalog).outfit
  const config: AvatarConfigV3 = { v: AVATAR_CONFIG_VERSION_V3, base: baseOf(raw, bases), outfit }

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
  const checked = validateAvatarConfigV3(config, catalog, bases)
  return checked.ok ? checked.value : defaultAvatarV3(catalog)
}

/**
 * Reads a stored `avatar_config` back as a v3 configuration, whatever shape it was written in.
 *
 * The column is `jsonb` with a `{}` default, so "an account that predates avatars", "an account
 * written by v1 or v2" and "an account wearing an item Plan 11 withdrew" all have to render as
 * *something*. Answering with a repaired figure is better than answering with a partial one the
 * client would draw with holes.
 *
 * `aliases` and `bases` are parameters rather than hidden defaults so a caller never pays for a second
 * parse of `item-aliases.json` or `avatar-bases.json`: `app.ts` loads both once, alongside the
 * catalogue, and passes the same map and the same id set everywhere a config is read.
 */
export function readAvatarConfigV3(stored: Record<string, unknown> | null | undefined, catalog: ItemCatalog, aliases: ReadonlyMap<string, string>, bases: BaseIds): AvatarConfigV3 {
  const checked = validateAvatarConfigV3(stored ?? {}, catalog, bases)
  return checked.ok ? checked.value : migrateAvatarConfigV3(stored, catalog, aliases, bases)
}
