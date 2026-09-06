/**
 * The cosmetic catalogue (spec §15.1, avatar-3d design §3.2).
 *
 * `data/items.json` is the source of truth and it is read once, at start-up, into an immutable
 * in-memory catalogue; the `items` table is a *projection* of it, upserted by `seed()` so that the
 * database's foreign keys — `inventory.item_id` — have something to point at. Nothing writes items
 * at run time, and no code path decides an item's slot by querying: a JSON edit plus a restart is
 * the whole of "add a hat".
 *
 * Since Plan 8 an item is a piece of 3D geometry rather than an SVG layer, so a definition carries
 * `variants`: one `{ file, node }` per body it has been modelled for. That is what makes "one item,
 * two bodies" (design §A3) expressible — a player switching to the female body keeps everything
 * they are wearing that has a female variant. `assetKey` survives as the manifest node *prefix*
 * (`<slot>/<id>`) so the column keeps meaning something, but the geometry is named by `variants`.
 *
 * `loadItemCatalog` refuses a file rather than degrading. Every failure it checks for is one that
 * would otherwise surface much later and much worse: a duplicate id silently shadowing an item, a
 * missing default leaving new accounts with nothing to wear, an absent `badge_monthly` turning the
 * day-28 reward into a foreign-key violation on the 28th of the month. The node convention is
 * checked here for the same reason — `test/catalog-manifest.test.ts` then holds the catalogue
 * against the manifest the asset build actually produced, which is a file this server never reads.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import type { AppDb } from '../db/client.js'
import { packageRoot } from '../db/migrate.js'
import { items } from '../db/schema.js'
import { DAILY_FIXED_ITEM_IDS } from '../economy/daily-rules.js'
import type { AvatarConfigV2 } from './avatar.js'
import { defaultAvatar } from './avatar.js'
import type { Body, ItemSlot } from './slots.js'
import { BODIES, isGeometricSlot, isItemSlot, REQUIRED_SLOTS } from './slots.js'

export type { Body, ItemSlot } from './slots.js'

export type Rarity = 'common' | 'rare' | 'epic'
export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic']

/** Where one body's version of an item lives inside the built assets (`normal-web/public/avatar3d/`). */
export interface AssetRef {
  /** One of the glb bundles the asset build emits. */
  file: string
  /** The node inside it, by the build's convention `<slot>/<itemId>/<body>`. */
  node: string
  /** A fixed colour for the item's `cloth_primary` material; skin, eyes and hair are the player's. */
  tint?: string
}

export type ItemVariants = { [body in Body]?: AssetRef }

export interface ItemDef {
  id: string
  slot: ItemSlot
  rarity: Rarity
  /** An i18n key (`items.<id>`); the strings themselves live in `normal-web`'s locale bundles. */
  nameKey: string
  /** The manifest node prefix, `<slot>/<id>` — what `variants[body].node` is built from. */
  assetKey: string
  /** Granted to every new account at registration. */
  isDefault: boolean
  /** The geometry per body. Required for a geometric slot, absent for `title` and `badge`. */
  variants?: ItemVariants
}

export interface ItemCatalog {
  all(): ItemDef[]
  get(id: string): ItemDef | undefined
  /** The ids every new account starts with — what `AuthService` grants at register. */
  defaults(): string[]
  byRarity(r: Rarity): ItemDef[]
  /** The one `isDefault` item of a slot, or undefined for a slot that has none. */
  defaultOf(slot: ItemSlot): ItemDef | undefined
  /** The avatar a new account is created wearing, built from the `isDefault` items. */
  defaultAvatar(): AvatarConfigV2
  /** Upserts the catalogue into the `items` table. Idempotent: safe on every boot. */
  seed(db: AppDb): Promise<void>
}

const RARITY_SET = new Set<string>(RARITIES)

/**
 * Which bundle a slot's geometry is packed into — the asset build's own grouping (design §4).
 *
 * A `null` is a slot with no geometry at all, which is how `title` and `badge` are told apart from
 * "a geometric slot whose variants were forgotten".
 */
const SLOT_FILE: Record<ItemSlot, string | null> = {
  hair: 'hair.glb',
  top: 'outfits.glb',
  bottom: 'outfits.glb',
  shoes: 'outfits.glb',
  hat: 'accessories.glb',
  accessory: 'accessories.glb',
  jewelry: 'accessories.glb',
  title: null,
  badge: null,
}

/** `#rrggbb` — the only colour syntax the client's material tinting understands. */
const TINT = /^#[0-9a-f]{6}$/i

/** `excluded.<column>` — the row the insert would have written, for an `ON CONFLICT DO UPDATE`. */
function sqlExcluded(column: string): ReturnType<typeof sql.raw> {
  return sql.raw(`excluded."${column}"`)
}

function defaultItemsPath(): string {
  return join(packageRoot(), 'data', 'items.json')
}

function fail(path: string, problem: string): never {
  throw new Error(`invalid item catalogue ${path}: ${problem}`)
}

/** The node a variant *must* name, so the catalogue and the asset build cannot drift apart. */
export function variantNode(slot: ItemSlot, id: string, body: Body): string {
  return `${slot}/${id}/${body}`
}

function parseVariants(path: string, id: string, slot: ItemSlot, raw: unknown): ItemVariants | undefined {
  const geometric = isGeometricSlot(slot)
  if (raw === undefined || raw === null) {
    // A `title` has nothing to model; a hat that forgot its geometry would be an item the wardrobe
    // offers and the stage cannot draw, which is the failure this catches at boot.
    if (geometric) fail(path, `item ${id} is in the geometric slot ${slot} but has no variants`)
    return undefined
  }
  if (!geometric) fail(path, `item ${id} is in the slot ${slot}, which has no geometry, but has variants`)
  if (typeof raw !== 'object' || Array.isArray(raw)) fail(path, `item ${id} has malformed variants`)
  const expectedFile = SLOT_FILE[slot]
  // `GEOMETRIC_SLOTS` and `SLOT_FILE` are two halves of one table; this is the line that would fire
  // if somebody added a slot to the first and forgot the second.
  if (expectedFile === null) fail(path, `the geometric slot ${slot} names no asset bundle`)

  const variants: ItemVariants = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(BODIES as readonly string[]).includes(key)) fail(path, `item ${id} has a variant for the unknown body ${key}`)
    const body = key as Body
    if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, `item ${id} has a malformed ${body} variant`)
    const ref = value as Record<string, unknown>
    if (ref['file'] !== expectedFile) fail(path, `item ${id}'s ${body} variant is in ${String(ref['file'])} rather than ${String(expectedFile)}`)
    const node = variantNode(slot, id, body)
    if (ref['node'] !== node) fail(path, `item ${id}'s ${body} variant names the node ${String(ref['node'])} rather than ${node}`)
    const tint = ref['tint']
    if (tint !== undefined && (typeof tint !== 'string' || !TINT.test(tint))) fail(path, `item ${id}'s ${body} variant has a tint that is not #rrggbb`)
    variants[body] = tint === undefined ? { file: expectedFile, node } : { file: expectedFile, node, tint }
  }
  // One body is enough to be wearable — the wardrobe hides an item the chosen body cannot wear and
  // `validateAvatarConfig` refuses it — but zero is a definition that means nothing.
  if (Object.keys(variants).length === 0) fail(path, `item ${id} has variants for no body at all`)
  return variants
}

function parseItem(path: string, raw: unknown, at: number): ItemDef {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail(path, `entry ${at} is not an object`)
  const r = raw as Record<string, unknown>
  const str = (key: string): string => {
    const value = r[key]
    if (typeof value !== 'string' || value === '') fail(path, `entry ${at} has no ${key}`)
    return value
  }
  const id = str('id')
  const slot = str('slot')
  const rarity = str('rarity')
  if (!isItemSlot(slot)) fail(path, `item ${id} has unknown slot ${slot}`)
  if (!RARITY_SET.has(rarity)) fail(path, `item ${id} has unknown rarity ${rarity}`)
  const isDefault = r['isDefault']
  if (typeof isDefault !== 'boolean') fail(path, `item ${id} has no boolean isDefault`)
  const variants = parseVariants(path, id, slot, r['variants'])
  const def: ItemDef = { id, slot, rarity: rarity as Rarity, nameKey: str('nameKey'), assetKey: str('assetKey'), isDefault }
  return variants === undefined ? def : { ...def, variants }
}

export function loadItemCatalog(path: string = defaultItemsPath()): ItemCatalog {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`could not read item catalogue ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!Array.isArray(parsed)) fail(path, 'the file is not a JSON array')

  const defs = parsed.map((raw, at) => parseItem(path, raw, at))

  const byId = new Map<string, ItemDef>()
  for (const def of defs) {
    if (byId.has(def.id)) fail(path, `duplicate item id ${def.id}`)
    byId.set(def.id, def)
  }

  // A required slot with no default is an account that cannot be given a complete avatar at
  // registration — a failure that would first show up as a broken profile screen, days later. Two
  // defaults in one slot is the same failure wearing a coin flip: `defaultAvatar` would pick
  // whichever came first in the file.
  for (const slot of REQUIRED_SLOTS) {
    const defaults = defs.filter((d) => d.slot === slot && d.isDefault)
    if (defaults.length === 0) fail(path, `no default item for the required slot ${slot}`)
    if (defaults.length > 1) fail(path, `the required slot ${slot} has ${defaults.length} defaults: ${defaults.map((d) => d.id).join(', ')}`)
  }
  for (const def of defs) {
    // A default in an optional slot would be granted to every new account and worn by none of them:
    // `defaultAvatar` fills the required slots only, on purpose (§15.1).
    if (def.isDefault && !(REQUIRED_SLOTS as readonly string[]).includes(def.slot)) fail(path, `item ${def.id} is a default in the optional slot ${def.slot}`)
  }
  for (const id of DAILY_FIXED_ITEM_IDS) {
    if (!byId.has(id)) fail(path, `the day-28 daily reward grants ${id}, which is not in the catalogue`)
  }

  const catalog: ItemCatalog = {
    all: () => [...defs],
    get: (id) => byId.get(id),
    defaults: () => defs.filter((d) => d.isDefault).map((d) => d.id),
    byRarity: (r) => defs.filter((d) => d.rarity === r),
    defaultOf: (slot) => defs.find((d) => d.slot === slot && d.isDefault),
    defaultAvatar: () => defaultAvatar(catalog),
    async seed(db) {
      if (defs.length === 0) return
      // An upsert rather than an insert: `seed` runs on every boot, and an edit to `nameKey` or a
      // re-tiered rarity has to reach a database that already holds the old row. Nothing is ever
      // deleted here — an item withdrawn from the JSON is still owned by whoever owns it, and its
      // row has to stay for `inventory.item_id` to remain valid. (`0001_avatar_v2.sql` is where the
      // v1 slots were deleted, inventory rows first, deliberately and once.)
      //
      // `variants` is not among the columns: the geometry is content the client resolves through
      // `/api/catalog/items`, and a jsonb copy of it in the database would be a second truth that
      // only `seed` ever wrote and nothing ever read.
      await db
        .insert(items)
        .values(defs.map((d) => ({ id: d.id, slot: d.slot, rarity: d.rarity, nameKey: d.nameKey, assetKey: d.assetKey, isDefault: d.isDefault })))
        .onConflictDoUpdate({
          target: items.id,
          set: {
            slot: sqlExcluded('category'),
            rarity: sqlExcluded('rarity'),
            nameKey: sqlExcluded('name_key'),
            assetKey: sqlExcluded('asset_key'),
            isDefault: sqlExcluded('is_default'),
          },
        })
    },
  }
  return catalog
}
