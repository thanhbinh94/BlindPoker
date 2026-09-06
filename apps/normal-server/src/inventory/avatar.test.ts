import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { inventory, players, users } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import { ServiceError } from '../errors.js'
import type { AvatarConfigV2 } from './avatar.js'
import { applyAvatarConfig, defaultAvatar, DEFAULT_EYE_COLOR, DEFAULT_SKIN_TONE, EYE_COLORS, SKIN_TONES, validateAvatarConfig } from './avatar.js'
import type { InventoryService } from './inventory-service.js'
import { createInventoryService } from './inventory-service.js'
import type { ItemCatalog } from './items.js'
import { loadItemCatalog } from './items.js'

let test: TestDb
let db: AppDb
let inv: InventoryService
let catalog: ItemCatalog
let scratch: string

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
  inv = createInventoryService(db)
  catalog = loadItemCatalog()
  await catalog.seed(db)
  scratch = mkdtempSync(join(tmpdir(), 'bp-avatar-'))
})
afterAll(async () => {
  await test.close()
  rmSync(scratch, { recursive: true, force: true })
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

const BASIC: AvatarConfigV2 = {
  v: 2,
  body: 'male',
  skin: DEFAULT_SKIN_TONE,
  eyes: DEFAULT_EYE_COLOR,
  hairColor: '#2b2b2b',
  hair: 'hair_none',
  top: 'top_tee',
  bottom: 'bottom_jeans',
  shoes: 'shoes_sneakers',
}
const DRESSED: AvatarConfigV2 = {
  ...BASIC,
  hat: 'hat_crown',
  accessory: 'accessory_glasses',
  jewelry: 'jewelry_ring',
  title: 'title_devoted',
  badge: 'badge_monthly',
}

/** Every item id in a config — what a player has to own to wear it. */
const worn = (config: AvatarConfigV2): string[] => [config.hair, config.top, config.bottom, config.shoes, config.hat, config.accessory, config.jewelry, config.title, config.badge].filter((id): id is string => id !== undefined)

describe('defaultAvatar', () => {
  it('dresses a new account in the catalogue’s default of each required slot, and nothing else', () => {
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

  it('refuses a missing required slot', () => {
    const { hair: _hair, ...noHair } = BASIC
    expect(validateAvatarConfig(noHair, catalog)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfig({ ...BASIC, top: '' }, catalog)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfig(null, catalog)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfig([BASIC], catalog)).toEqual({ ok: false, code: 'MISSING_LAYER' })
  })

  it('refuses anything that is not v2 — a v1 config is readable, but not writable', () => {
    const { v: _v, ...noVersion } = BASIC
    expect(validateAvatarConfig(noVersion, catalog)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfig({ ...BASIC, v: 1 }, catalog)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfig({ ...BASIC, v: '2' }, catalog)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfig({ base: 'base_01', face: 'face_01', clothing: 'clothing_tee', hair: 'hair_short', hairColor: '#2b2b2b' }, catalog))
      .toEqual({ ok: false, code: 'MISSING_LAYER' })
  })

  it('refuses a body that is not one of the two', () => {
    for (const body of [undefined, null, 'other', 42]) {
      expect(validateAvatarConfig({ ...BASIC, body }, catalog), String(body)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    }
    expect(validateAvatarConfig({ ...BASIC, body: 'female' }, catalog)).toMatchObject({ ok: true })
  })

  it('refuses a hair colour that is not #rrggbb, and folds the case of one that is', () => {
    for (const hairColor of ['2b2b2b', '#2b2b2', '#2b2b2bff', 'red', '']) {
      expect(validateAvatarConfig({ ...BASIC, hairColor }, catalog), hairColor).toEqual({ ok: false, code: 'INVALID_COLOR' })
    }
    // Stored folded, like skin and eyes, so the client's config hash — the portrait cache key — is
    // stable: `#ABCDEF` and `#abcdef` are the same figure and must be the same stored value.
    expect(validateAvatarConfig({ ...BASIC, hairColor: '#AABBCC' }, catalog)).toEqual({ ok: true, value: { ...BASIC, hairColor: '#aabbcc' } })
  })

  it('refuses a skin or eye colour outside its palette, and folds the case of one inside it', () => {
    expect(validateAvatarConfig({ ...BASIC, skin: '#00ff00' }, catalog)).toEqual({ ok: false, code: 'INVALID_COLOR' })
    expect(validateAvatarConfig({ ...BASIC, eyes: '#00ff00' }, catalog)).toEqual({ ok: false, code: 'INVALID_COLOR' })
    expect(validateAvatarConfig({ ...BASIC, skin: undefined }, catalog)).toEqual({ ok: false, code: 'INVALID_COLOR' })
    expect(SKIN_TONES).toHaveLength(8)
    expect(EYE_COLORS).toHaveLength(6)
    for (const skin of SKIN_TONES) expect(validateAvatarConfig({ ...BASIC, skin }, catalog), skin).toMatchObject({ ok: true })
    for (const eyes of EYE_COLORS) expect(validateAvatarConfig({ ...BASIC, eyes }, catalog), eyes).toMatchObject({ ok: true })
    // Stored folded, so the client's config hash — the portrait cache key — is stable.
    expect(validateAvatarConfig({ ...BASIC, skin: SKIN_TONES[4]!.toUpperCase() }, catalog)).toEqual({ ok: true, value: { ...BASIC, skin: SKIN_TONES[4] } })
  })

  it('refuses an id that is not in the catalogue', () => {
    expect(validateAvatarConfig({ ...BASIC, hair: 'hair_imaginary' }, catalog)).toEqual({ ok: false, code: 'INVALID_ITEM' })
    expect(validateAvatarConfig({ ...BASIC, title: 42 }, catalog)).toEqual({ ok: false, code: 'INVALID_ITEM' })
    // The withdrawn v1 ids are exactly that: not in the catalogue any more.
    expect(validateAvatarConfig({ ...BASIC, top: 'clothing_tee' }, catalog)).toEqual({ ok: false, code: 'INVALID_ITEM' })
  })

  it('refuses an id worn in the wrong slot', () => {
    expect(validateAvatarConfig({ ...BASIC, hair: 'top_tee' }, catalog)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
    expect(validateAvatarConfig({ ...DRESSED, badge: 'title_devoted' }, catalog)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
    // A hat is its own slot now: the v1 configs that carried it under `accessory` are migrated, not accepted.
    expect(validateAvatarConfig({ ...BASIC, accessory: 'hat_crown' }, catalog)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
  })

  it('refuses an item that has not been modelled for the chosen body', () => {
    // The shipped catalogue models everything for both bodies, so this needs one that does not.
    const path = join(scratch, 'one-body.json')
    writeFileSync(path, JSON.stringify([
      { id: 'hair_none', slot: 'hair', rarity: 'common', nameKey: 'items.hair_none', assetKey: 'hair/hair_none', isDefault: true,
        variants: { male: { file: 'hair.glb', node: 'hair/hair_none/male' }, female: { file: 'hair.glb', node: 'hair/hair_none/female' } } },
      // Modelled for the male body only — a real case: the source sets are not symmetric.
      { id: 'top_tee', slot: 'top', rarity: 'common', nameKey: 'items.top_tee', assetKey: 'top/top_tee', isDefault: true,
        variants: { male: { file: 'outfits.glb', node: 'top/top_tee/male' } } },
      { id: 'bottom_jeans', slot: 'bottom', rarity: 'common', nameKey: 'items.bottom_jeans', assetKey: 'bottom/bottom_jeans', isDefault: true,
        variants: { male: { file: 'outfits.glb', node: 'bottom/bottom_jeans/male' }, female: { file: 'outfits.glb', node: 'bottom/bottom_jeans/female' } } },
      { id: 'shoes_sneakers', slot: 'shoes', rarity: 'common', nameKey: 'items.shoes_sneakers', assetKey: 'shoes/shoes_sneakers', isDefault: true,
        variants: { male: { file: 'outfits.glb', node: 'shoes/shoes_sneakers/male' }, female: { file: 'outfits.glb', node: 'shoes/shoes_sneakers/female' } } },
      { id: 'badge_monthly', slot: 'badge', rarity: 'rare', nameKey: 'items.badge_monthly', assetKey: 'badge/badge_monthly', isDefault: false },
      { id: 'title_devoted', slot: 'title', rarity: 'rare', nameKey: 'items.title_devoted', assetKey: 'title/title_devoted', isDefault: false },
    ]), 'utf8')
    const lopsided = loadItemCatalog(path)

    expect(validateAvatarConfig(BASIC, lopsided)).toMatchObject({ ok: true })
    expect(validateAvatarConfig({ ...BASIC, body: 'female' }, lopsided)).toEqual({ ok: false, code: 'INVALID_ITEM' })
    // A title has no geometry to be missing, so it stays wearable whichever body is chosen.
    expect(validateAvatarConfig({ ...BASIC, title: 'title_devoted' }, lopsided)).toMatchObject({ ok: true })
  })

  it('treats an omitted or null optional slot as empty', () => {
    expect(validateAvatarConfig({ ...DRESSED, title: undefined, badge: null }, catalog)).toEqual({ ok: true, value: { ...DRESSED, title: undefined, badge: undefined } })
  })
})

describe('applyAvatarConfig', () => {
  it('refuses a configuration referencing an item the player does not own, naming it', async () => {
    const playerId = await seedPlayer()
    await own(playerId, ...worn(BASIC))

    const err = await applyAvatarConfig(db, inv, playerId, { ...BASIC, hat: 'hat_crown' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ServiceError)
    expect((err as ServiceError).code).toBe('NOT_OWNED')
    expect((err as ServiceError).message).toContain('hat_crown')
  })

  it('stores the config and mirrors the title and badge into their own columns', async () => {
    const playerId = await seedPlayer()
    await own(playerId, ...worn(DRESSED))

    expect(await applyAvatarConfig(db, inv, playerId, DRESSED)).toEqual({ config: DRESSED })
    const [row] = await db.select().from(players).where(eq(players.id, playerId))
    expect(row!.avatarConfig).toEqual(DRESSED)
    expect(row).toMatchObject({ equippedTitle: 'title_devoted', equippedBadge: 'badge_monthly' })
  })

  it('unequips a title by omitting it — a PUT is a full replace', async () => {
    const playerId = await seedPlayer()
    await own(playerId, ...worn(DRESSED))
    await applyAvatarConfig(db, inv, playerId, DRESSED)

    await applyAvatarConfig(db, inv, playerId, BASIC)
    const [row] = await db.select().from(players).where(eq(players.id, playerId))
    expect(row!.avatarConfig).toEqual(BASIC)
    expect(row).toMatchObject({ equippedTitle: null, equippedBadge: null })
  })

  it('refuses a player who is not there — through ownership, the only check it needs', async () => {
    // Owning an item implies the `players` row exists (`inventory.player_id` cascades on delete),
    // and every config names at least four items, so a missing player is refused before the write.
    // There is no second, separate "no such player" answer to give.
    const err = await applyAvatarConfig(db, inv, '00000000-0000-4000-8000-000000000000', BASIC).catch((e: unknown) => e)
    expect((err as ServiceError).code).toBe('NOT_OWNED')
    expect(await db.select().from(players)).toHaveLength(0)
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
    await own(playerId, 'top_tee', 'hat_crown')
    const owned = await inv.list(playerId)
    expect(owned.map((o) => o.itemId).sort()).toEqual(['hat_crown', 'top_tee'])
    expect(owned[0]!.acquiredAt).toBeGreaterThan(0)
    expect(await inv.list('not-a-uuid')).toEqual([])
  })

  it('answers owns and missingOf without tripping over a malformed id', async () => {
    const playerId = await seedPlayer()
    await own(playerId, 'top_tee')
    expect(await inv.owns(playerId, 'top_tee')).toBe(true)
    expect(await inv.owns(playerId, 'hat_crown')).toBe(false)
    expect(await inv.owns('not-a-uuid', 'top_tee')).toBe(false)
    expect(await inv.missingOf(playerId, ['top_tee'])).toEqual([])
    expect(await inv.missingOf(playerId, ['top_tee', 'hat_crown', 'hat_crown'])).toEqual(['hat_crown'])
    expect(await inv.missingOf('not-a-uuid', ['top_tee'])).toEqual(['top_tee'])
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

  it('drops the excluded ids and slots from the pool, and an empty exclusion excludes nothing', async () => {
    const playerId = await seedPlayer()
    const allRare = catalog.byRarity('rare').map((d) => d.id).sort()

    const filtered = await db.transaction((tx) =>
      inv.unownedOfRarity(tx, playerId, 'rare', { ids: ['jewelry_chain'], slots: ['title', 'badge'] }),
    )
    expect(filtered).not.toContain('jewelry_chain')
    expect(filtered).not.toContain('badge_monthly')
    expect(filtered).not.toContain('title_devoted')
    expect(filtered).toEqual(
      allRare.filter((id) => id !== 'jewelry_chain' && catalog.get(id)!.slot !== 'title' && catalog.get(id)!.slot !== 'badge'),
    )

    // `notInArray(col, [])` is `col <> all('{}')`, which Postgres reads as unknown for every row —
    // an empty exclusion must mean "exclude nothing", not "exclude everything".
    expect(await db.transaction((tx) => inv.unownedOfRarity(tx, playerId, 'rare', { ids: [], slots: [] }))).toEqual(allRare)
    expect(await db.transaction((tx) => inv.unownedOfRarity(tx, playerId, 'rare', {}))).toEqual(allRare)
  })
})
