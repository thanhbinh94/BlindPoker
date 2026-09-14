import { and, eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { avatarOutfits, inventory as inventoryTable, players, users } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import { ServiceError } from '../errors.js'
import type { AvatarConfigV3 } from './avatar.js'
import { itemIdsOf } from './avatar.js'
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
  inv = createInventoryService(db)
  outfits = createOutfitsService(db, inv)
  catalog = loadItemCatalog()
  await catalog.seed(db)
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

const CASUAL: AvatarConfigV3 = { v: 3, base: 'f01', outfit: 'outfit_casual01' }
const DRESSED: AvatarConfigV3 = { v: 3, base: 'm01', outfit: 'outfit_tuxedo01', head: 'head_tophat01' }

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
