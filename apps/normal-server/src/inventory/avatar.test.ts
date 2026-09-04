import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { inventory, players, users } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import { ServiceError } from '../errors.js'
import type { AvatarConfig } from './avatar.js'
import { applyAvatarConfig, defaultAvatar, readAvatarConfig, validateAvatarConfig } from './avatar.js'
import type { InventoryService } from './inventory-service.js'
import { createInventoryService } from './inventory-service.js'
import type { ItemCatalog } from './items.js'
import { loadItemCatalog } from './items.js'

let test: TestDb
let db: AppDb
let inv: InventoryService
let catalog: ItemCatalog

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
  inv = createInventoryService(db)
  catalog = loadItemCatalog()
  await catalog.seed(db)
})
afterAll(async () => {
  await test.close()
})
afterEach(async () => {
  await db.execute(sql`truncate table inventory, players, users restart identity cascade`)
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

/** Grants outside a service transaction — a test fixture, not a production path. */
async function own(playerId: string, ...itemIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const itemId of itemIds) await inv.grant(tx, playerId, itemId, 'test')
  })
}

const BASIC: AvatarConfig = { base: 'base_01', face: 'face_01', clothing: 'clothing_tee', hair: 'hair_short', hairColor: '#2b2b2b' }
const DRESSED: AvatarConfig = { ...BASIC, accessory: 'accessory_glasses', jewelry: 'jewelry_ring', title: 'title_devoted', badge: 'badge_monthly' }

describe('defaultAvatar', () => {
  it('dresses a new account in the catalogue’s default of each required layer, and nothing else', () => {
    expect(defaultAvatar(catalog)).toEqual(BASIC)
  })

  it('is itself a valid configuration', () => {
    expect(validateAvatarConfig(defaultAvatar(catalog), catalog)).toEqual({ ok: true, value: BASIC })
  })
})

describe('validateAvatarConfig', () => {
  it('accepts a full configuration and returns exactly what is to be stored', () => {
    expect(validateAvatarConfig({ ...DRESSED, somethingElse: 'ignored' }, catalog)).toEqual({ ok: true, value: DRESSED })
  })

  it('refuses a missing required layer', () => {
    const { hair: _hair, ...noHair } = BASIC
    expect(validateAvatarConfig(noHair, catalog)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfig({ ...BASIC, base: '' }, catalog)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfig(null, catalog)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfig([BASIC], catalog)).toEqual({ ok: false, code: 'MISSING_LAYER' })
  })

  it('refuses a hair colour that is not #rrggbb', () => {
    for (const hairColor of ['2b2b2b', '#2b2b2', '#2b2b2bff', 'red', '']) {
      expect(validateAvatarConfig({ ...BASIC, hairColor }, catalog), hairColor).toEqual({ ok: false, code: 'INVALID_COLOR' })
    }
    expect(validateAvatarConfig({ ...BASIC, hairColor: '#AABBCC' }, catalog)).toMatchObject({ ok: true })
  })

  it('refuses an id that is not in the catalogue', () => {
    expect(validateAvatarConfig({ ...BASIC, hair: 'hair_imaginary' }, catalog)).toEqual({ ok: false, code: 'INVALID_ITEM' })
    expect(validateAvatarConfig({ ...BASIC, title: 42 }, catalog)).toEqual({ ok: false, code: 'INVALID_ITEM' })
  })

  it('refuses an id worn in the wrong slot', () => {
    expect(validateAvatarConfig({ ...BASIC, hair: 'clothing_tee' }, catalog)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
    expect(validateAvatarConfig({ ...DRESSED, badge: 'title_devoted' }, catalog)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
  })

  it('treats an omitted or null optional slot as empty', () => {
    expect(validateAvatarConfig({ ...DRESSED, title: undefined, badge: null }, catalog)).toEqual({ ok: true, value: { ...DRESSED, title: undefined, badge: undefined } })
  })
})

describe('applyAvatarConfig', () => {
  it('refuses a configuration referencing an item the player does not own, naming it', async () => {
    const playerId = await seedPlayer()
    await own(playerId, 'base_01', 'face_01', 'clothing_tee', 'hair_short')

    const err = await applyAvatarConfig(db, inv, playerId, { ...BASIC, accessory: 'hat_crown' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ServiceError)
    expect((err as ServiceError).code).toBe('NOT_OWNED')
    expect((err as ServiceError).message).toContain('hat_crown')
  })

  it('stores the config and mirrors the title and badge into their own columns', async () => {
    const playerId = await seedPlayer()
    await own(playerId, ...Object.values(DRESSED).filter((v) => !v.startsWith('#')))

    expect(await applyAvatarConfig(db, inv, playerId, DRESSED)).toEqual({ config: DRESSED })
    const [row] = await db.select().from(players).where(eq(players.id, playerId))
    expect(row!.avatarConfig).toEqual(DRESSED)
    expect(row).toMatchObject({ equippedTitle: 'title_devoted', equippedBadge: 'badge_monthly' })
  })

  it('unequips a title by omitting it — a PUT is a full replace', async () => {
    const playerId = await seedPlayer()
    await own(playerId, ...Object.values(DRESSED).filter((v) => !v.startsWith('#')))
    await applyAvatarConfig(db, inv, playerId, DRESSED)

    await applyAvatarConfig(db, inv, playerId, BASIC)
    const [row] = await db.select().from(players).where(eq(players.id, playerId))
    expect(row!.avatarConfig).toEqual(BASIC)
    expect(row).toMatchObject({ equippedTitle: null, equippedBadge: null })
  })

  it('refuses a player who is not there', async () => {
    const err = await applyAvatarConfig(db, inv, '00000000-0000-4000-8000-000000000000', BASIC).catch((e: unknown) => e)
    expect((err as ServiceError).code).toBe('NOT_OWNED')
  })
})

describe('readAvatarConfig', () => {
  it('reads a stored config back', () => {
    expect(readAvatarConfig(DRESSED as unknown as Record<string, unknown>, catalog)).toEqual(DRESSED)
  })

  it('falls back to the default rather than handing the client a half-drawn figure', () => {
    expect(readAvatarConfig({}, catalog)).toEqual(defaultAvatar(catalog))
    expect(readAvatarConfig(null, catalog)).toEqual(defaultAvatar(catalog))
    expect(readAvatarConfig({ base: 'base_01' }, catalog)).toEqual(defaultAvatar(catalog))
  })
})

describe('InventoryService', () => {
  it('grants once and says so', async () => {
    const playerId = await seedPlayer()
    await db.transaction(async (tx) => {
      expect(await inv.grant(tx, playerId, 'hat_crown', 'achievement')).toBe(true)
      expect(await inv.grant(tx, playerId, 'hat_crown', 'daily')).toBe(false)
    })

    const rows = await db.select().from(inventory).where(eq(inventory.playerId, playerId))
    expect(rows).toHaveLength(1)
    // The first grant's source is kept: how a player *got* an item does not change afterwards.
    expect(rows[0]).toMatchObject({ itemId: 'hat_crown', source: 'achievement' })
  })

  it('lists what a player owns, oldest first', async () => {
    const playerId = await seedPlayer()
    await own(playerId, 'base_01', 'hat_crown')
    const owned = await inv.list(playerId)
    expect(owned.map((o) => o.itemId).sort()).toEqual(['base_01', 'hat_crown'])
    expect(owned[0]!.acquiredAt).toBeGreaterThan(0)
    expect(await inv.list('not-a-uuid')).toEqual([])
  })

  it('answers owns and missingOf without tripping over a malformed id', async () => {
    const playerId = await seedPlayer()
    await own(playerId, 'base_01')
    expect(await inv.owns(playerId, 'base_01')).toBe(true)
    expect(await inv.owns(playerId, 'hat_crown')).toBe(false)
    expect(await inv.owns('not-a-uuid', 'base_01')).toBe(false)
    expect(await inv.missingOf(playerId, ['base_01'])).toEqual([])
    expect(await inv.missingOf(playerId, ['base_01', 'hat_crown', 'hat_crown'])).toEqual(['hat_crown'])
    expect(await inv.missingOf('not-a-uuid', ['base_01'])).toEqual(['base_01'])
    expect(await inv.missingOf(playerId, [])).toEqual([])
  })

  it('lists the unowned items of one rarity, in id order', async () => {
    const playerId = await seedPlayer()
    const allCommon = catalog.byRarity('common').map((d) => d.id).sort()
    await own(playerId, allCommon[0]!)

    const unowned = await db.transaction((tx) => inv.unownedOfRarity(tx, playerId, 'common'))
    expect(unowned).toEqual(allCommon.slice(1))
    // Ordered, so a seeded rng picks the same item every run.
    expect([...unowned].sort()).toEqual(unowned)
    expect(await db.transaction((tx) => inv.unownedOfRarity(tx, playerId, 'epic'))).toEqual(catalog.byRarity('epic').map((d) => d.id).sort())
  })
})
