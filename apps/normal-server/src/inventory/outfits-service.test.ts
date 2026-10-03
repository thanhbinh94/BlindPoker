import { and, eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { avatarOutfits, inventory as inventoryTable, players, users } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import { ServiceError } from '../errors.js'
import { loadAliases } from './aliases.js'
import type { AvatarConfigV4 } from './avatar.js'
import { itemIdsOf } from './avatar.js'
import { readAvatarConfig } from './avatar-migrate.js'
import { loadBodies } from './bodies.js'
import type { InventoryService } from './inventory-service.js'
import { createInventoryService } from './inventory-service.js'
import type { ItemCatalog } from './items.js'
import { loadItemCatalog } from './items.js'
import { createOutfitsService, OUTFIT_NAME_MAX, type OutfitsService } from './outfits-service.js'

let test: TestDb
let db: AppDb
let inv: InventoryService
let outfits: OutfitsService
let catalog: ItemCatalog

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
  // The catalogue first: the inventory is built the way `app.ts` builds it, with the free set (every hairstyle
  // and skin colour), so a v4 config's free items are owned without a row — as they are in production.
  catalog = loadItemCatalog()
  await catalog.seed(db)
  const aliases = loadAliases()
  const bodies = loadBodies()
  inv = createInventoryService(db, aliases, catalog.freeIds())
  outfits = createOutfitsService(db, inv, (stored) => readAvatarConfig(stored, catalog, aliases, bodies))
})
afterAll(async () => {
  await test.close()
})
afterEach(async () => {
  await db.execute(sql`truncate table avatar_outfits, inventory, players, users restart identity cascade`)
})

let seq = 0
async function seedPlayer(): Promise<string> {
  seq += 1
  const name = `p${seq}`
  const [user] = await db.insert(users).values({ email: `${name}@example.com`, passwordHash: 'argon2' }).returning({ id: users.id })
  const id = user!.id
  await db.insert(players).values({ id, displayName: name, nameKey: name, balance: 0 })
  return id
}

async function own(playerId: string, ...itemIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const itemId of itemIds) await inv.grant(tx, playerId, itemId, 'test')
  })
}

const CASUAL: AvatarConfigV4 = { v: 4, gender: 'f', hairStyle: 'hair_f_bob01', outfit: 'outfit_casual01' }
const DRESSED: AvatarConfigV4 = { v: 4, gender: 'm', hairStyle: 'hair_m_tousled01', outfit: 'outfit_tuxedo01', head: 'head_tophat01' }
/** A row saved before Plan 19, as the table still holds it, and the v4 it reads as (table 4.5, the shipped bodies' eye rule). */
const STORED_V3_M02 = { v: 3, base: 'm02', outfit: 'outfit_casual01' }
const READ_V3_M02: AvatarConfigV4 = { v: 4, gender: 'm', hairStyle: 'hair_m_neat01', outfit: 'outfit_casual01', skinColor: 'skin_fair01', eyeColor: 'eyecolor_grey01' }

/** Writes a saved outfit straight into the table, the way a row from before Plan 19 is there already. */
async function insertRow(playerId: string, slot: number, config: Record<string, unknown>): Promise<void> {
  await db.insert(avatarOutfits).values({ playerId, slot, name: 'Old', config })
}

describe('OutfitsService', () => {
  describe('list', () => {
    it('answers a fresh player with five empty slots', async () => {
      const playerId = await seedPlayer()
      expect(await outfits.list(playerId)).toEqual([null, null, null, null, null])
    })

    it('puts a saved outfit at its own index — slot 2 lands at index 1', async () => {
      const playerId = await seedPlayer()
      await own(playerId, ...itemIdsOf(CASUAL))
      await outfits.save(playerId, 2, 'Weekend', CASUAL)

      const list = await outfits.list(playerId)
      expect(list[0]).toBeNull()
      expect(list[1]).toMatchObject({ slot: 2, name: 'Weekend', config: CASUAL })
      expect(list[2]).toBeNull()
    })

    it('lists a saved v3 outfit as the v4 it reads as', async () => {
      const playerId = await seedPlayer()
      await insertRow(playerId, 1, STORED_V3_M02)

      const list = await outfits.list(playerId)
      expect(list[0]).toMatchObject({ slot: 1, name: 'Old' })
      expect(list[0]!.config).toEqual(READ_V3_M02)
      // Read, not rewritten: the row changes only when the player saves over it (spec §4.5).
      const [row] = await db.select({ config: avatarOutfits.config }).from(avatarOutfits).where(eq(avatarOutfits.playerId, playerId))
      expect(row!.config).toEqual(STORED_V3_M02)
    })

    it('lists a stale v4 outfit repaired — a hairstyle of the other gender becomes that gender’s default', async () => {
      const playerId = await seedPlayer()
      await insertRow(playerId, 1, { ...CASUAL, hairStyle: 'hair_m_neat01' })
      expect((await outfits.list(playerId))[0]!.config).toEqual(CASUAL)
    })
  })

  describe('save', () => {
    it('trims the name and stores the config', async () => {
      const playerId = await seedPlayer()
      await own(playerId, ...itemIdsOf(CASUAL))
      const view = await outfits.save(playerId, 1, '  Everyday  ', CASUAL)
      expect(view).toMatchObject({ slot: 1, name: 'Everyday', config: CASUAL })
      expect(view.updatedAt).toBeGreaterThan(0)
    })

    it('refuses a slot outside 1..5', async () => {
      const playerId = await seedPlayer()
      for (const slot of [0, 6, -1, 1.5]) {
        const err = await outfits.save(playerId, slot, 'x', CASUAL).catch((e: unknown) => e)
        expect(err, String(slot)).toBeInstanceOf(ServiceError)
        expect((err as ServiceError).code, String(slot)).toBe('INVALID_SLOT')
      }
    })

    it('refuses an empty or over-long name', async () => {
      const playerId = await seedPlayer()
      await own(playerId, ...itemIdsOf(CASUAL))
      for (const name of ['', '   ', 'x'.repeat(OUTFIT_NAME_MAX + 1)]) {
        const err = await outfits.save(playerId, 1, name, CASUAL).catch((e: unknown) => e)
        expect(err, JSON.stringify(name)).toBeInstanceOf(ServiceError)
        expect((err as ServiceError).code, JSON.stringify(name)).toBe('INVALID_NAME')
      }
      // Exactly the limit is fine.
      await expect(outfits.save(playerId, 1, 'x'.repeat(OUTFIT_NAME_MAX), CASUAL)).resolves.toMatchObject({ name: 'x'.repeat(OUTFIT_NAME_MAX) })
    })

    it('refuses a config naming an item the player does not own', async () => {
      const playerId = await seedPlayer()
      const err = await outfits.save(playerId, 1, 'Fancy', DRESSED).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ServiceError)
      expect((err as ServiceError).code).toBe('ITEM_NOT_OWNED')
      expect((err as ServiceError).message).toContain('outfit_tuxedo01')
    })

    it('overwrites whatever was already in the slot', async () => {
      const playerId = await seedPlayer()
      await own(playerId, ...itemIdsOf(CASUAL), ...itemIdsOf(DRESSED))
      await outfits.save(playerId, 1, 'First', CASUAL)
      const second = await outfits.save(playerId, 1, 'Second', DRESSED)
      expect(second).toMatchObject({ slot: 1, name: 'Second', config: DRESSED })
      expect(await outfits.list(playerId)).toMatchObject([{ name: 'Second' }, null, null, null, null])
    })
  })

  describe('remove', () => {
    it('answers true once and false the second time', async () => {
      const playerId = await seedPlayer()
      await own(playerId, ...itemIdsOf(CASUAL))
      await outfits.save(playerId, 3, 'Gone soon', CASUAL)
      expect(await outfits.remove(playerId, 3)).toBe(true)
      expect(await outfits.remove(playerId, 3)).toBe(false)
      expect(await outfits.list(playerId)).toEqual([null, null, null, null, null])
    })

    it('refuses a slot outside 1..5', async () => {
      const playerId = await seedPlayer()
      const err = await outfits.remove(playerId, 7).catch((e: unknown) => e)
      expect((err as ServiceError).code).toBe('INVALID_SLOT')
    })
  })

  describe('apply', () => {
    it('writes the saved config as the player’s avatar and returns it', async () => {
      const playerId = await seedPlayer()
      await own(playerId, ...itemIdsOf(DRESSED))
      await outfits.save(playerId, 4, 'Gala', DRESSED)

      const view = await outfits.apply(playerId, 4)
      expect(view).toEqual({ config: DRESSED })
      const [row] = await db.select({ config: players.avatarConfig }).from(players).where(eq(players.id, playerId))
      expect(row!.config).toEqual(DRESSED)
    })

    it('answers NOT_FOUND on an empty slot', async () => {
      const playerId = await seedPlayer()
      const err = await outfits.apply(playerId, 1).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ServiceError)
      expect((err as ServiceError).code).toBe('NOT_FOUND')
    })

    it('re-checks ownership rather than trusting the save', async () => {
      const playerId = await seedPlayer()
      await own(playerId, ...itemIdsOf(DRESSED))
      await outfits.save(playerId, 4, 'Gala', DRESSED)
      // The item leaves the wardrobe after the save — nothing in this server actually does this
      // today, but `apply` must not assume it never will.
      await db.delete(inventoryTable).where(and(eq(inventoryTable.playerId, playerId), eq(inventoryTable.itemId, 'outfit_tuxedo01')))

      const err = await outfits.apply(playerId, 4).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ServiceError)
      expect((err as ServiceError).code).toBe('ITEM_NOT_OWNED')
    })

    it('applies a saved v3 outfit as v4, and stores v4', async () => {
      const playerId = await seedPlayer()
      await own(playerId, 'outfit_casual01')
      await insertRow(playerId, 2, STORED_V3_M02)

      expect(await outfits.apply(playerId, 2)).toEqual({ config: READ_V3_M02 })
      // The player's own column receives the v4 — never the old base the saved row still names (R6).
      const [row] = await db.select({ config: players.avatarConfig }).from(players).where(eq(players.id, playerId))
      expect(row!.config).toEqual(READ_V3_M02)
      expect(row!.config).toMatchObject({ v: 4 })
    })

    it('refuses to apply a repaired outfit naming an item the player no longer owns', async () => {
      const playerId = await seedPlayer()
      // f03 reads as the wavy hair, tan skin and green eyes — all free — in a tuxedo the player does not own.
      await insertRow(playerId, 1, { v: 3, base: 'f03', outfit: 'outfit_tuxedo01' })

      const err = await outfits.apply(playerId, 1).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ServiceError)
      expect((err as ServiceError).code).toBe('ITEM_NOT_OWNED')
      // Ownership is asked of the v4 it reads as: the free items it gained are owned, the tuxedo is not.
      expect((err as ServiceError).message).toBe('not owned: outfit_tuxedo01')
      const [row] = await db.select({ config: players.avatarConfig }).from(players).where(eq(players.id, playerId))
      expect(row!.config).toEqual({})
    })

    it('refuses a slot outside 1..5', async () => {
      const playerId = await seedPlayer()
      const err = await outfits.apply(playerId, 0).catch((e: unknown) => e)
      expect((err as ServiceError).code).toBe('INVALID_SLOT')
    })
  })

  describe('cascade', () => {
    it('deletes a player’s saved outfits when the account is deleted', async () => {
      const playerId = await seedPlayer()
      await own(playerId, ...itemIdsOf(CASUAL))
      await outfits.save(playerId, 1, 'Bye', CASUAL)

      await db.delete(users).where(eq(users.id, playerId))
      const rows = await db.select().from(avatarOutfits).where(eq(avatarOutfits.playerId, playerId))
      expect(rows).toEqual([])
    })
  })
})
