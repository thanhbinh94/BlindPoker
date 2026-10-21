import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { avatarOutfits, inventory, players, users } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import type { AvatarConfigV4 } from './avatar.js'
import { applyAvatarConfig } from './avatar.js'
import type { InventoryService } from './inventory-service.js'
import { createInventoryService } from './inventory-service.js'
import { loadItemCatalog } from './items.js'

let test: TestDb
let db: AppDb
let inv: InventoryService

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
  inv = createInventoryService(db)
  await loadItemCatalog().seed(db)
})
afterAll(async () => {
  await test.close()
})
afterEach(async () => {
  await db.execute(sql`truncate table inventory, avatar_outfits, players, users restart identity cascade`)
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

const grant = (playerId: string, itemId: string, ref?: string): Promise<boolean> =>
  db.transaction((tx) => inv.grant(tx, playerId, itemId, 'test', ref))

const DRESSED: AvatarConfigV4 = {
  v: 4,
  gender: 'm',
  hairStyle: 'hair_m_tousled01',
  outfit: 'outfit_casual01',
  head: 'head_crown_gold01',
  aura: 'aura_gold_cards01',
  title: 'title_devoted',
  badge: 'badge_monthly',
}

describe('InventoryService.revoke', () => {
  it('revoke clears the slot and the equipped title before deleting the row', async () => {
    const id = await seedPlayer()
    for (const item of ['hair_m_tousled01', 'outfit_casual01', 'head_crown_gold01', 'aura_gold_cards01', 'title_devoted', 'badge_monthly']) await grant(id, item)
    await applyAvatarConfig(db, inv, id, DRESSED)
    // A saved outfit that wears the same title and the same head, and one that wears neither.
    await db.insert(avatarOutfits).values([
      { playerId: id, slot: 1, name: 'Có tước hiệu', config: { ...DRESSED } },
      { playerId: id, slot: 2, name: 'Trơn', config: { v: 4, gender: 'm', hairStyle: 'hair_m_tousled01', outfit: 'outfit_casual01' } },
    ])

    expect(await db.transaction((tx) => inv.revoke(tx, id, 'title_devoted'))).toBe(true)
    expect(await db.transaction((tx) => inv.revoke(tx, id, 'head_crown_gold01'))).toBe(true)

    const [row] = await db.select({ config: players.avatarConfig, title: players.equippedTitle, badge: players.equippedBadge }).from(players).where(eq(players.id, id))
    expect(row?.config).toEqual({ v: 4, gender: 'm', hairStyle: 'hair_m_tousled01', outfit: 'outfit_casual01', aura: 'aura_gold_cards01', badge: 'badge_monthly' })
    expect(row?.title).toBeNull()
    expect(row?.badge).toBe('badge_monthly')
    const owned = (await db.select({ itemId: inventory.itemId }).from(inventory).where(eq(inventory.playerId, id))).map((r) => r.itemId)
    expect(owned).not.toContain('title_devoted')
    expect(owned).not.toContain('head_crown_gold01')
    expect(owned).toContain('badge_monthly')

    const outfits = await db.select({ slot: avatarOutfits.slot, config: avatarOutfits.config }).from(avatarOutfits).where(eq(avatarOutfits.playerId, id)).orderBy(avatarOutfits.slot)
    expect(outfits[0]?.config).toEqual({ v: 4, gender: 'm', hairStyle: 'hair_m_tousled01', outfit: 'outfit_casual01', aura: 'aura_gold_cards01', badge: 'badge_monthly' })
    expect(outfits[1]?.config).toEqual({ v: 4, gender: 'm', hairStyle: 'hair_m_tousled01', outfit: 'outfit_casual01' })
  })

  it('answers false for an item the player does not own and for a malformed id', async () => {
    const id = await seedPlayer()
    expect(await db.transaction((tx) => inv.revoke(tx, id, 'title_devoted'))).toBe(false)
    expect(await db.transaction((tx) => inv.revoke(tx, 'not-a-uuid', 'title_devoted'))).toBe(false)
  })
})

describe('InventoryService.findByRef', () => {
  it('findByRef returns the items a daily claim granted', async () => {
    const id = await seedPlayer()
    // One claim is one transaction, so its rows share `acquired_at`.
    await db.transaction(async (tx) => {
      await inv.grant(tx, id, 'title_devoted', 'test', `daily:${id}:2026-09-04`)
      await inv.grant(tx, id, 'badge_monthly', 'test', `daily:${id}:2026-09-04`)
    })
    await grant(id, 'head_crown_gold01', `daily:${id}:2026-09-03`)
    await grant(id, 'aura_gold_cards01')
    expect((await db.transaction((tx) => inv.findByRef(tx, id, `daily:${id}:2026-09-04`))).sort()).toEqual(['badge_monthly', 'title_devoted'])
    expect(await db.transaction((tx) => inv.findByRef(tx, id, `daily:${id}:2026-09-05`))).toEqual([])
  })

  it('returns only the latest claim when the same ref was granted twice (a reclaim)', async () => {
    const id = await seedPlayer()
    const ref = `daily:${id}:2026-09-04`
    await grant(id, 'title_devoted', ref)
    await db.execute(sql`update inventory set acquired_at = acquired_at - interval '1 hour' where player_id = ${id}`)
    await grant(id, 'badge_monthly', ref)
    expect(await db.transaction((tx) => inv.findByRef(tx, id, ref))).toEqual(['badge_monthly'])
  })
})
