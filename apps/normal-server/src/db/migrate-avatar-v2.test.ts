/**
 * `drizzle/0001_avatar_v2.sql` against a database that holds real v1 data.
 *
 * The migrations the rest of the suite runs are applied to an empty database, where a data migration
 * can do nothing wrong because there is nothing to do. This one starts from `0000_init` plus a
 * player who owns `base_01`, `face_01`, `clothing_tee` and `hair_short` and is wearing them — the
 * account Plan 6 shipped — and checks the two things that would hurt: that the withdrawn ids leave
 * both the wardrobe and the catalogue, and that the four new defaults arrive in *existing*
 * wardrobes, since `seed()` grants nothing and `isDefault` only reaches new accounts.
 *
 * It is applied twice on purpose. A data migration that is not idempotent is one that cannot be
 * re-run after a failed deploy, and this one is written to be.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadAliases } from '../inventory/aliases.js'
import { readAvatarConfig } from '../inventory/avatar-migrate.js'
import { loadBodies } from '../inventory/bodies.js'
import { createInventoryService } from '../inventory/inventory-service.js'
import { loadItemCatalog } from '../inventory/items.js'
import type { AppDb } from './client.js'
import { packageRoot } from './migrate.js'
import * as schema from './schema.js'

const PLAYER = '11111111-1111-4111-8111-111111111111'

/** The v1 config that player is wearing — no `v`, six SVG layers. */
const V1_CONFIG = {
  base: 'base_01',
  face: 'face_01',
  clothing: 'clothing_tee',
  hair: 'hair_short',
  hairColor: '#7a3b1f',
  accessory: 'accessory_conical_hat',
  title: 'title_devoted',
}

/** The v1 catalogue, trimmed to what this test needs to see move. */
const V1_ITEMS: [string, string, string][] = [
  ['base_01', 'base', 'common'],
  ['face_01', 'face', 'common'],
  ['clothing_tee', 'clothing', 'common'],
  ['clothing_hoodie', 'clothing', 'common'],
  ['hair_short', 'hair', 'common'],
  ['accessory_conical_hat', 'accessory', 'rare'],
  ['accessory_glasses', 'accessory', 'common'],
  ['hat_crown', 'accessory', 'epic'],
  ['title_devoted', 'title', 'rare'],
  ['badge_monthly', 'badge', 'rare'],
]

let client: PGlite
let db: AppDb

/** Applies one committed migration the way the drizzle migrator does: split, then statement by statement. */
async function apply(tag: string): Promise<void> {
  const file = readFileSync(join(packageRoot(), 'drizzle', `${tag}.sql`), 'utf8')
  for (const statement of file.split('--> statement-breakpoint')) {
    const trimmed = statement.trim()
    if (trimmed !== '') await client.exec(trimmed)
  }
}

async function rows<T>(query: string): Promise<T[]> {
  const result = await client.query<T>(query)
  return result.rows
}

const itemIds = async (): Promise<string[]> => (await rows<{ id: string }>(`SELECT "id" FROM "items" ORDER BY "id"`)).map((r) => r.id)
const ownedIds = async (): Promise<string[]> =>
  (await rows<{ item_id: string }>(`SELECT "item_id" FROM "inventory" WHERE "player_id" = '${PLAYER}' ORDER BY "item_id"`)).map((r) => r.item_id)

beforeEach(async () => {
  client = new PGlite()
  db = drizzle(client, { schema })
  await apply('0000_init')

  const values = V1_ITEMS.map(([id, category, rarity]) => `('${id}', '${category}', '${rarity}', 'items.${id}', '${category}/${id}', ${id === 'base_01' || id === 'face_01' || id === 'clothing_tee' || id === 'hair_short'})`)
  await client.exec(`INSERT INTO "items" ("id", "category", "rarity", "name_key", "asset_key", "is_default") VALUES ${values.join(', ')}`)
  await client.exec(`INSERT INTO "users" ("id", "email", "password_hash") VALUES ('${PLAYER}', 'v1@example.com', 'argon2')`)
  await client.exec(
    `INSERT INTO "players" ("id", "display_name", "name_key", "balance", "avatar_config") VALUES ('${PLAYER}', 'Plan Six', 'plan six', 1000, '${JSON.stringify(V1_CONFIG)}'::jsonb)`,
  )
  await client.exec(
    `INSERT INTO "inventory" ("player_id", "item_id", "source") VALUES ('${PLAYER}', 'base_01', 'default'), ('${PLAYER}', 'face_01', 'default'), ('${PLAYER}', 'clothing_tee', 'default'), ('${PLAYER}', 'hair_short', 'default'), ('${PLAYER}', 'accessory_conical_hat', 'daily'), ('${PLAYER}', 'title_devoted', 'achievement')`,
  )
})
afterEach(async () => {
  await client.close()
})

describe('0001_avatar_v2', () => {
  it('grants the four new defaults to a player who registered before Plan 8', async () => {
    await apply('0001_avatar_v2')

    const owned = await ownedIds()
    expect(owned).toEqual(['accessory_conical_hat', 'bottom_jeans', 'hair_none', 'hair_short', 'shoes_sneakers', 'title_devoted', 'top_tee'])
    const sources = await rows<{ item_id: string; source: string }>(`SELECT "item_id", "source" FROM "inventory" WHERE "item_id" = 'top_tee'`)
    expect(sources[0]).toMatchObject({ source: 'default' })
  })

  it('takes the withdrawn ids out of every wardrobe and then out of the catalogue', async () => {
    await apply('0001_avatar_v2')

    expect(await ownedIds()).not.toContain('base_01')
    const ids = await itemIds()
    for (const gone of ['base_01', 'face_01', 'clothing_tee']) expect(ids, gone).not.toContain(gone)
    // The rename is a new row rather than an `UPDATE`: `inventory.item_id` has no `ON UPDATE`, so
    // moving the id would have been a foreign-key violation on every wardrobe that held it.
    expect(ids).toContain('top_tee')
  })

  it('re-slots the surviving rows and rewrites their asset keys', async () => {
    await apply('0001_avatar_v2')

    const items = await rows<{ id: string; category: string; asset_key: string }>(`SELECT "id", "category", "asset_key" FROM "items" ORDER BY "id"`)
    const slotOf = (id: string): string | undefined => items.find((r) => r.id === id)?.category
    expect(slotOf('clothing_hoodie')).toBe('top')
    expect(slotOf('accessory_conical_hat')).toBe('hat')
    expect(slotOf('hat_crown')).toBe('hat')
    // The accessories that really are accessories stay where they were.
    expect(slotOf('accessory_glasses')).toBe('accessory')
    expect(slotOf('title_devoted')).toBe('title')
    for (const row of items) expect(row.asset_key, row.id).toBe(`${row.category}/${row.id}`)
  })

  it('changes nothing the second time it is applied', async () => {
    await apply('0001_avatar_v2')
    const before = { items: await rows(`SELECT * FROM "items" ORDER BY "id"`), owned: await rows(`SELECT * FROM "inventory" ORDER BY "item_id"`) }

    await apply('0001_avatar_v2')
    expect(await rows(`SELECT * FROM "items" ORDER BY "id"`)).toEqual(before.items)
    expect(await rows(`SELECT * FROM "inventory" ORDER BY "item_id"`)).toEqual(before.owned)
  })

  it('leaves the player wearing a v4 avatar built from what they still own, once the boot seed has run', async () => {
    await apply('0001_avatar_v2')
    // What `app.ts` does next on every boot: upsert the shipped catalogue over whatever is there.
    const catalog = loadItemCatalog()
    await catalog.seed(db)
    const aliases = loadAliases()
    const inventory = createInventoryService(db, aliases)

    const [player] = await db.select({ config: schema.players.avatarConfig }).from(schema.players)
    const avatar = readAvatarConfig(player!.config, catalog, aliases, loadBodies())
    // The v1 layers, migrated all the way to v4: no body at all (falls to the default figure, a woman
    // with the bob and her own eyes), the conical hat resolved through its alias into `head`, the title
    // kept, the old hex hair colour dropped (never an item), and the outfit — nothing v1 wore maps to
    // one — at its default.
    expect(avatar).toEqual({ v: 4, gender: 'f', hairStyle: 'hair_f_bob01', outfit: 'outfit_casual01', head: 'head_conical_hat01', title: 'title_devoted' })

    // …and every *item* slot in it is one this player owns — through the alias, since their
    // inventory row is still the v2 id `0001` never rewrote. `outfit` is the one exception: `0002`,
    // not `0001`, is what backfills every existing player into the new required slot's default, and
    // this test applies only `0001`.
    const { head, face, aura, frame, title, badge } = avatar
    for (const id of [head, face, aura, frame, title, badge].filter((x): x is string => x !== undefined)) {
      expect(await inventory.owns(PLAYER, id), id).toBe(true)
    }
    // The stored jsonb is untouched: the migration is on the read path, not in the column.
    expect(player!.config).toMatchObject({ clothing: 'clothing_tee' })
  })
})
