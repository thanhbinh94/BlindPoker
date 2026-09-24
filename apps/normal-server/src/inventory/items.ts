/**
 * The cosmetic catalogue (design §4.4, §5.2).
 *
 * `data/items.json` is the source of truth and it is read once, at start-up, into an immutable
 * in-memory catalogue; the `items` table is a *projection* of it, upserted by `seed()` so that the
 * database's foreign keys — `inventory.item_id` — have something to point at. Nothing writes items
 * at run time, and no code path decides an item's slot by querying: a JSON edit plus a restart is
 * the whole of "add a hat".
 *
 * Since Plan 11 an item is a PNG layer on a fixed frame rather than a piece of 3D geometry, so a
 * definition carries `asset` — one `{ layer, file, fitsAvatarCrop }` shared by every base, because a
 * head or an outfit is drawn once and worn by both `f01` and `m01` alike (design §4.4: "món dùng
 * chung mọi thân"). `title` and `badge` have no asset at all: text beside a name, nothing to draw.
 *
 * 2026-09-20: `asset.variants` is the one exception, and it is deliberately *not* a second item. Two
 * outfits are gendered (a dealer's skirt, an áo dài), so the asset may name one layer per `wear`; the
 * item is still one row with one id, and the base being drawn picks the cut.
 *
 * `loadItemCatalog` refuses a file rather than degrading, the same reasons as before: a duplicate id
 * silently shadowing an item, a missing default leaving new accounts with nothing to wear, an absent
 * `badge_monthly` turning the day-28 reward into a foreign-key violation on the 28th of the month —
 * and now, an `asset.file` the manifest never produced, which is a catalogue entry the wardrobe would
 * offer and the stage could never draw.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import type { AppDb } from '../db/client.js'
import { packageRoot } from '../db/migrate.js'
import { items } from '../db/schema.js'
import { DAILY_FIXED_ITEM_IDS } from '../economy/daily-rules.js'
import type { AvatarConfigV3 } from './avatar.js'
import { defaultAvatar } from './avatar.js'
import type { Wear } from './bases.js'
import { WEARS } from './bases.js'
import type { AvatarManifest } from './manifest.js'
import { loadAvatarManifest } from './manifest.js'
import type { ItemSlot } from './slots.js'
import { COLOUR_SLOTS, DRAWN_SLOTS, isItemSlot, REQUIRED_SLOTS } from './slots.js'

export type { ItemSlot } from './slots.js'

export type Rarity = 'common' | 'rare' | 'epic'
export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic']

/** The layer a slot's asset must sit on (design §3) — one half of the manifest cross-check. */
const SLOT_LAYER: Partial<Record<ItemSlot, number>> = { head: 80, face: 70, outfit: 40, aura: 10, frame: 90 }

/** One PNG layer, shared by every base. */
export interface AssetRef {
  layer: 10 | 40 | 70 | 80 | 90
  /** A name in `data/avatar-manifest.json`'s `files`, without the `@1x`/`@2x` density suffix. */
  file: string
  /**
   * The layer to draw instead of `file` on a base of a given wear (2026-09-20).
   *
   * A dealer's uniform is a skirt on `f` and trousers on `m`, but it stays **one item**: ownership,
   * achievements, the daily calendar and the outfits table all key on the id, and only the picture
   * differs. A wear with no entry here wears `file`, so this map is added one cut at a time as the
   * art arrives — see `docs/avatar-2d.md` §3.1.
   */
  variants?: Partial<Record<Wear, string>>
  /** A head that hides the base's hair layers (design §3). */
  hidesHairFront?: boolean
  hidesHairBack?: boolean
  /** Whether this layer falls inside the 208×208 avatar crop the portrait is cut from. */
  fitsAvatarCrop: boolean
  /**
   * A colour variant (design §3.3): draw `file`, then tint the `<file>_tintmask` region with this
   * hex. The original item this varies has no `tint` at all — only its variants do.
   */
  tint?: string
  /** `masks.tint.meanL` off the manifest entry for `file`, copied in at load time so the client and
   *  the pipeline's `recolour` never have to re-measure the original artwork's lightness. */
  tintMeanL?: number
}

export interface ItemDef {
  id: string
  slot: ItemSlot
  rarity: Rarity
  /** An i18n key (`items.<id>`); the strings themselves live in `normal-web`'s locale bundles. */
  nameKey: string
  /** The manifest node prefix, `<slot>/<id>` — kept as a stable identifier for the item, even though
   *  the actual drawable file now lives in `asset.file`. */
  assetKey: string
  /** Granted to every new account at registration. */
  isDefault: boolean
  /** The PNG layer to draw. Required for `DRAWN_SLOTS`, absent for `title` and `badge`. */
  asset?: AssetRef
  /** The hex a `hairColor`/`eyeColor` item paints with (design §3.2). Required there, forbidden elsewhere. */
  colour?: string
  /**
   * Owned by every player without an `inventory` row (design §3.2) — `owns`/`missingOf` say so, and
   * `/api/me/inventory` reports it with `source: "free"`. Only ever `true`: a catalogue never writes
   * `free: false`, the same way it never writes `isDefault: false` for most items. Restricted to a
   * `common`, non-default item — a free rare would make "rare" a lie, and a free default is simply
   * what `isDefault` already means.
   */
  free?: true
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
  defaultAvatar(): AvatarConfigV3
  /** Every `free` item's id (design §3.2) — what `InventoryService` and the daily draw are built from. */
  freeIds(): ReadonlySet<string>
  /** Upserts the catalogue into the `items` table. Idempotent: safe on every boot. */
  seed(db: AppDb): Promise<void>
}

const RARITY_SET = new Set<string>(RARITIES)

/** A colour is always a lowercase 6-digit hex (design §3.2, §3.3) — never `#FFF`, never uppercase. */
const HEX_COLOUR = /^#[0-9a-f]{6}$/

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

function parseAsset(path: string, id: string, slot: ItemSlot, manifest: AvatarManifest, raw: unknown): AssetRef | undefined {
  const drawn = (DRAWN_SLOTS as readonly ItemSlot[]).includes(slot)
  if (raw === undefined || raw === null) {
    // A `title` has nothing to draw; a hat that forgot its asset would be an item the wardrobe
    // offers and the stage cannot draw, which is the failure this catches at boot.
    if (drawn) fail(path, `item ${id} is in the drawn slot ${slot} but has no asset`)
    return undefined
  }
  if (!drawn) fail(path, `item ${id} is in the slot ${slot}, which is never drawn, but has an asset`)
  if (typeof raw !== 'object' || Array.isArray(raw)) fail(path, `item ${id} has a malformed asset`)
  const r = raw as Record<string, unknown>

  const expectedLayer = SLOT_LAYER[slot]
  // `DRAWN_SLOTS` and `SLOT_LAYER` are two halves of one table; this is the line that would fire if
  // somebody added a slot to the first and forgot the second.
  if (expectedLayer === undefined) fail(path, `the drawn slot ${slot} names no canonical layer`)

  const layer = r['layer']
  if (layer !== expectedLayer) fail(path, `item ${id} has layer ${JSON.stringify(layer)} rather than ${String(expectedLayer)}`)

  const file = r['file']
  if (typeof file !== 'string' || file === '') fail(path, `item ${id} has no asset file`)
  const manifestEntry = manifest.files[file]
  if (manifestEntry === undefined) fail(path, `item ${id} names the asset file ${file}, which is not in the avatar manifest`)
  if (manifestEntry.layer !== expectedLayer) {
    fail(path, `item ${id}'s asset file ${file} is manifest layer ${String(manifestEntry.layer)} rather than ${String(expectedLayer)}`)
  }

  const fitsAvatarCrop = r['fitsAvatarCrop']
  if (typeof fitsAvatarCrop !== 'boolean') fail(path, `item ${id} has no boolean fitsAvatarCrop`)

  const asset: AssetRef = { layer: expectedLayer as AssetRef['layer'], file, fitsAvatarCrop }

  // A colour variant (design §3.3): the manifest has to carry a non-empty `masks.tint` for `file`,
  // or there is no region for `recolour` to paint — a variant whose art has no tint mask is a rare
  // hat that would silently render as its own original colour.
  const tintRaw = r['tint']
  if (tintRaw !== undefined) {
    if (typeof tintRaw !== 'string' || !HEX_COLOUR.test(tintRaw)) fail(path, `item ${id} has a malformed asset.tint`)
    const tintMask = manifestEntry.masks?.tint
    if (tintMask === undefined || tintMask.empty === true) fail(path, `item ${id}'s asset file ${file} has no tint mask to paint`)
    asset.tint = tintRaw
    asset.tintMeanL = tintMask.meanL
  }

  // Per-wear cuts (2026-09-20). Each one is held to exactly what `file` is held to — in the manifest,
  // at the slot's own layer — because a variant that resolves to nothing is a base that renders a hole
  // where its outfit should be, and only for the half of the roster that wears that cut.
  const variantsRaw = r['variants']
  if (variantsRaw !== undefined) {
    if (typeof variantsRaw !== 'object' || variantsRaw === null || Array.isArray(variantsRaw)) fail(path, `item ${id} has a malformed asset.variants`)
    const variants: Partial<Record<Wear, string>> = {}
    for (const [wear, name] of Object.entries(variantsRaw as Record<string, unknown>)) {
      if (!(WEARS as readonly string[]).includes(wear)) fail(path, `item ${id} has the asset variant ${wear}, which is not one of ${WEARS.join(', ')}`)
      if (typeof name !== 'string' || name === '') fail(path, `item ${id}'s ${wear} asset variant has no file name`)
      const entry = manifest.files[name]
      if (entry === undefined) fail(path, `item ${id} names the ${wear} asset variant ${name}, which is not in the avatar manifest`)
      if (entry.layer !== expectedLayer) {
        fail(path, `item ${id}'s ${wear} asset variant ${name} is manifest layer ${String(entry.layer)} rather than ${String(expectedLayer)}`)
      }
      variants[wear as Wear] = name
    }
    if (Object.keys(variants).length > 0) asset.variants = variants
  }

  if (r['hidesHairFront'] !== undefined) {
    if (typeof r['hidesHairFront'] !== 'boolean') fail(path, `item ${id} has a non-boolean hidesHairFront`)
    asset.hidesHairFront = r['hidesHairFront']
  }
  if (r['hidesHairBack'] !== undefined) {
    if (typeof r['hidesHairBack'] !== 'boolean') fail(path, `item ${id} has a non-boolean hidesHairBack`)
    asset.hidesHairBack = r['hidesHairBack']
  }
  return asset
}

function parseItem(path: string, manifest: AvatarManifest, raw: unknown, at: number): ItemDef {
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

  // `colour` (design §3.2): mandatory hex on the two colour slots, forbidden everywhere else — a
  // `head` item with a stray `colour` field would be dead data nothing ever reads, and a colour item
  // without one would have nothing for the wardrobe's swatch to paint.
  const colourSlot = (COLOUR_SLOTS as readonly string[]).includes(slot)
  const colourRaw = r['colour']
  if (colourSlot) {
    if (typeof colourRaw !== 'string' || !HEX_COLOUR.test(colourRaw)) fail(path, `item ${id} needs a 6-digit hex colour (slot ${slot})`)
  } else if (colourRaw !== undefined) {
    fail(path, `item ${id} has a colour but is not in a colour slot (${slot})`)
  }

  // `free` (design §3.2): only ever the literal `true`, and only on a common, non-default item —
  // "free" and "rare" contradict each other, and a default is already granted to everyone another way.
  const freeRaw = r['free']
  if (freeRaw !== undefined && freeRaw !== true) fail(path, `item ${id} has a non-true free`)
  if (freeRaw === true && (rarity !== 'common' || isDefault)) fail(path, `item ${id} is free but is not a plain common item`)

  const asset = parseAsset(path, id, slot, manifest, r['asset'])
  const assetKey = str('assetKey')
  // The manifest node prefix is derived from `slot`/`id`, not free text: a hand-built catalogue
  // should not be able to drift from that convention.
  if (assetKey !== `${slot}/${id}`) fail(path, `item ${id} has assetKey ${assetKey} rather than ${slot}/${id}`)
  const def: ItemDef = { id, slot, rarity: rarity as Rarity, nameKey: str('nameKey'), assetKey, isDefault }
  if (colourSlot) def.colour = colourRaw as string
  if (freeRaw === true) def.free = true
  return asset === undefined ? def : { ...def, asset }
}

export function loadItemCatalog(path: string = defaultItemsPath(), manifest: AvatarManifest = loadAvatarManifest()): ItemCatalog {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`could not read item catalogue ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!Array.isArray(parsed)) fail(path, 'the file is not a JSON array')

  const defs = parsed.map((raw, at) => parseItem(path, manifest, raw, at))

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
    // `defaultAvatar` fills the required slot only, on purpose.
    if (def.isDefault && !(REQUIRED_SLOTS as readonly string[]).includes(def.slot)) fail(path, `item ${def.id} is a default in the optional slot ${def.slot}`)
  }
  for (const id of DAILY_FIXED_ITEM_IDS) {
    if (!byId.has(id)) fail(path, `the day-28 daily reward grants ${id}, which is not in the catalogue`)
  }

  const freeIds = new Set(defs.filter((d) => d.free).map((d) => d.id))

  const catalog: ItemCatalog = {
    all: () => [...defs],
    get: (id) => byId.get(id),
    defaults: () => defs.filter((d) => d.isDefault).map((d) => d.id),
    byRarity: (r) => defs.filter((d) => d.rarity === r),
    defaultOf: (slot) => defs.find((d) => d.slot === slot && d.isDefault),
    defaultAvatar: () => defaultAvatar(catalog),
    freeIds: () => freeIds,
    async seed(db) {
      if (defs.length === 0) return
      // An upsert rather than an insert: `seed` runs on every boot, and an edit to `nameKey` or a
      // re-tiered rarity has to reach a database that already holds the old row. Nothing is ever
      // deleted here — an item withdrawn from the JSON is still owned by whoever owns it, and its
      // row has to stay for `inventory.item_id` to remain valid.
      //
      // `asset` is not among the columns: the layer is content the client resolves through
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
