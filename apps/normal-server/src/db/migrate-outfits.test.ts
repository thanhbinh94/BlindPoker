/**
 * `drizzle/0002_outfits.sql` against a database that holds real pre-Plan-11 data.
 *
 * Two things this migration does, both checked here: it creates `avatar_outfits` (the CHECK on
 * `slot` and the cascade on player delete), and it backfills `outfit_casual01` — v3's one required
 * slot's default — into `items` and into every *existing* player's inventory, the same reason
 * `0001_avatar_v2.sql` backfilled its four defaults.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppDb } from './client.js'
import { packageRoot } from './migrate.js'
import * as schema from './schema.js'

const PLAYER_A = '11111111-1111-4111-8111-111111111111'
const PLAYER_B = '22222222-2222-4222-8222-222222222222'

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

beforeEach(async () => {
  client = new PGlite()
  db = drizzle(client, { schema })
  await apply('0000_init')
  await apply('0001_avatar_v2')

  for (const id of [PLAYER_A, PLAYER_B]) {
    await client.exec(`INSERT INTO "users" ("id", "email", "password_hash") VALUES ('${id}', '${id}@example.com', 'argon2')`)
    await client.exec(`INSERT INTO "players" ("id", "display_name", "name_key", "balance") VALUES ('${id}', 'Player', 'player-${id}', 1000)`)
  }
})
afterEach(async () => {
  await client.close()
})

describe('0002_outfits', () => {
  it('creates the avatar_outfits table, enforces the slot range, and cascades on player delete', async () => {
    await apply('0002_outfits')

    await client.exec(`INSERT INTO "avatar_outfits" ("player_id", "slot", "name", "config") VALUES ('${PLAYER_A}', 1, 'Everyday', '{"v":3,"base":"f01","outfit":"outfit_casual01"}'::jsonb)`)
    await expect(client.exec(`INSERT INTO "avatar_outfits" ("player_id", "slot", "name", "config") VALUES ('${PLAYER_A}', 6, 'Bad', '{}'::jsonb)`)).rejects.toThrow(/avatar_outfits_slot_range/)

    await client.exec(`DELETE FROM "users" WHERE "id" = '${PLAYER_A}'`)
    expect(await rows(`SELECT * FROM "avatar_outfits" WHERE "player_id" = '${PLAYER_A}'`)).toEqual([])
  })

  it('backfills outfit_casual01 into items and grants it to every existing player', async () => {
    await apply('0002_outfits')

    const item = await rows<{ id: string; category: string; is_default: boolean }>(`SELECT "id", "category", "is_default" FROM "items" WHERE "id" = 'outfit_casual01'`)
    expect(item[0]).toMatchObject({ category: 'outfit', is_default: true })

    for (const id of [PLAYER_A, PLAYER_B]) {
      const owned = await rows<{ item_id: string; source: string }>(`SELECT "item_id", "source" FROM "inventory" WHERE "player_id" = '${id}' AND "item_id" = 'outfit_casual01'`)
      expect(owned[0], id).toMatchObject({ source: 'default' })
    }
  })

  it('does not re-grant outfit_casual01 to a player who already owns it from somewhere else', async () => {
    await client.exec(`INSERT INTO "items" ("id", "category", "rarity", "name_key", "asset_key", "is_default") VALUES ('outfit_casual01', 'outfit', 'common', 'items.outfit_casual01', 'outfit/outfit_casual01', true)`)
    await client.exec(`INSERT INTO "inventory" ("player_id", "item_id", "source") VALUES ('${PLAYER_A}', 'outfit_casual01', 'achievement')`)

    await apply('0002_outfits')

    const [row] = await db.select({ source: schema.inventory.source }).from(schema.inventory).where(eq(schema.inventory.playerId, PLAYER_A))
    expect(row).toMatchObject({ source: 'achievement' })
  })

  it('changes nothing when its data statements run again — the shape is guarded by CREATE TABLE IF NOT EXISTS', async () => {
    await apply('0002_outfits')
    const before = { items: await rows(`SELECT * FROM "items" ORDER BY "id"`), owned: await rows(`SELECT * FROM "inventory" ORDER BY "player_id", "item_id"`) }

    // Only the backfill half, the way a real re-run through drizzle's own migrator would only ever
    // attempt this file once as a whole — this isolates the part of it that *is* meant to be safe
    // to repeat, the same guarantee `0001_avatar_v2.sql`'s test holds its pure-data migration to.
    const file = readFileSync(join(packageRoot(), 'drizzle', '0002_outfits.sql'), 'utf8')
    const dataStatements = file.split('--> statement-breakpoint').slice(-2)
    for (const statement of dataStatements) await client.exec(statement.trim())

    expect(await rows(`SELECT * FROM "items" ORDER BY "id"`)).toEqual(before.items)
    expect(await rows(`SELECT * FROM "inventory" ORDER BY "player_id", "item_id"`)).toEqual(before.owned)
  })
})
