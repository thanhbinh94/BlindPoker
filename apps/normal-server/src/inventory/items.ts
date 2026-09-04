/**
 * The cosmetic catalogue (spec §15.1).
 *
 * `data/items.json` is the source of truth and it is read once, at start-up, into an immutable
 * in-memory catalogue; the `items` table is a *projection* of it, upserted by `seed()` so that the
 * database's foreign keys — `inventory.item_id` — have something to point at. Nothing writes items
 * at run time, and no code path decides an item's category by querying: a JSON edit plus a restart
 * is the whole of "add a hat".
 *
 * `loadItemCatalog` refuses a file rather than degrading. Every failure it checks for is one that
 * would otherwise surface much later and much worse: a duplicate id silently shadowing an item, a
 * missing default leaving new accounts with no hair to wear, an absent `badge_monthly` turning the
 * day-28 reward into a foreign-key violation on the 28th of the month.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import type { AppDb } from '../db/client.js'
import { packageRoot } from '../db/migrate.js'
import { items } from '../db/schema.js'
import { DAILY_FIXED_ITEM_IDS } from '../economy/daily-rules.js'
import type { AvatarConfig } from './avatar.js'
import { defaultAvatar, REQUIRED_LAYERS } from './avatar.js'

export type ItemCategory = 'base' | 'face' | 'clothing' | 'hair' | 'accessory' | 'jewelry' | 'title' | 'badge'
export type Rarity = 'common' | 'rare' | 'epic'

export const ITEM_CATEGORIES: readonly ItemCategory[] = ['base', 'face', 'clothing', 'hair', 'accessory', 'jewelry', 'title', 'badge']
export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic']

export interface ItemDef {
  id: string
  category: ItemCategory
  rarity: Rarity
  /** An i18n key (`items.<id>`); the strings themselves land with `normal-web` in Plan 6. */
  nameKey: string
  /** Where the SVG layer lives (`<category>/<id>`). */
  assetKey: string
  /** Granted to every new account at registration. */
  isDefault: boolean
}

export interface ItemCatalog {
  all(): ItemDef[]
  get(id: string): ItemDef | undefined
  /** The ids every new account starts with — what `AuthService` grants at register. */
  defaults(): string[]
  byRarity(r: Rarity): ItemDef[]
  /** The avatar a new account is created wearing, built from the `isDefault` items. */
  defaultAvatar(): AvatarConfig
  /** Upserts the catalogue into the `items` table. Idempotent: safe on every boot. */
  seed(db: AppDb): Promise<void>
}

const CATEGORY_SET = new Set<string>(ITEM_CATEGORIES)
const RARITY_SET = new Set<string>(RARITIES)

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

function parseItem(path: string, raw: unknown, at: number): ItemDef {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail(path, `entry ${at} is not an object`)
  const r = raw as Record<string, unknown>
  const str = (key: string): string => {
    const value = r[key]
    if (typeof value !== 'string' || value === '') fail(path, `entry ${at} has no ${key}`)
    return value
  }
  const id = str('id')
  const category = str('category')
  const rarity = str('rarity')
  if (!CATEGORY_SET.has(category)) fail(path, `item ${id} has unknown category ${category}`)
  if (!RARITY_SET.has(rarity)) fail(path, `item ${id} has unknown rarity ${rarity}`)
  const isDefault = r['isDefault']
  if (typeof isDefault !== 'boolean') fail(path, `item ${id} has no boolean isDefault`)
  return { id, category: category as ItemCategory, rarity: rarity as Rarity, nameKey: str('nameKey'), assetKey: str('assetKey'), isDefault }
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

  // A required layer with no default is an account that cannot be given a complete avatar at
  // registration — a failure that would first show up as a broken profile screen, days later.
  for (const layer of REQUIRED_LAYERS) {
    if (!defs.some((d) => d.category === layer && d.isDefault)) fail(path, `no default item for the required layer ${layer}`)
  }
  for (const id of DAILY_FIXED_ITEM_IDS) {
    if (!byId.has(id)) fail(path, `the day-28 daily reward grants ${id}, which is not in the catalogue`)
  }

  const catalog: ItemCatalog = {
    all: () => [...defs],
    get: (id) => byId.get(id),
    defaults: () => defs.filter((d) => d.isDefault).map((d) => d.id),
    byRarity: (r) => defs.filter((d) => d.rarity === r),
    defaultAvatar: () => defaultAvatar(catalog),
    async seed(db) {
      if (defs.length === 0) return
      // An upsert rather than an insert: `seed` runs on every boot, and an edit to `nameKey` or a
      // re-tiered rarity has to reach a database that already holds the old row. Nothing is ever
      // deleted here — an item withdrawn from the JSON is still owned by whoever owns it, and its
      // row has to stay for `inventory.item_id` to remain valid.
      await db
        .insert(items)
        .values(defs)
        .onConflictDoUpdate({
          target: items.id,
          set: {
            category: sqlExcluded('category'),
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
