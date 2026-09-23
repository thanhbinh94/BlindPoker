import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { inventory, items, players, users } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import { ServiceError } from '../errors.js'
import type { AvatarConfigV3 } from './avatar.js'
import { applyAvatarConfig, defaultAvatar, validateAvatarConfig } from './avatar.js'
import { baseIdsOf, loadBases } from './bases.js'
import type { InventoryService } from './inventory-service.js'
import { createInventoryService } from './inventory-service.js'
import type { ItemCatalog } from './items.js'
import { loadItemCatalog } from './items.js'

let test: TestDb
let db: AppDb
let inv: InventoryService
let catalog: ItemCatalog
let scratch: string

/** The real registry's ids: what `INVALID_BASE` is measured against since the base list became data. */
const baseIds = baseIdsOf(loadBases())

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

/**
 * Inserts a v2 item row directly, the way a database that has run `0001_avatar_v2.sql` and its own
 * `catalog.seed()` under the *old* `items.json` would already have one — Plan 11's catalogue does
 * not renew it, so nothing in this server would ever insert it again.
 */
async function ensureLegacyItem(id: string, slot: string, rarity: string): Promise<void> {
  await db
    .insert(items)
    .values({ id, slot, rarity, nameKey: `items.${id}`, assetKey: `${slot}/${id}`, isDefault: false })
    .onConflictDoNothing({ target: items.id })
}

const CASUAL: AvatarConfigV3 = { v: 3, base: 'f01', outfit: 'outfit_casual01' }
const DRESSED: AvatarConfigV3 = {
  ...CASUAL,
  base: 'm01',
  head: 'head_crown_gold01',
  face: 'face_glasses_round_gold01',
  aura: 'aura_gold_cards01',
  frame: 'frame_founder',
  title: 'title_devoted',
  badge: 'badge_monthly',
}

/** Every item id in a config — what a player has to own to wear it. */
const worn = (config: AvatarConfigV3): string[] => [config.outfit, config.head, config.face, config.aura, config.frame, config.title, config.badge].filter((id): id is string => id !== undefined)

describe('defaultAvatar', () => {
  it('dresses a new account in the f01 base wearing only the default outfit', () => {
    expect(defaultAvatar(catalog)).toEqual(CASUAL)
  })

  it('is itself a valid configuration', () => {
    expect(validateAvatarConfig(defaultAvatar(catalog), catalog, baseIds)).toEqual({ ok: true, value: CASUAL })
  })
})

describe('validateAvatarConfig', () => {
  it('accepts a full configuration and returns exactly what is to be stored', () => {
    expect(validateAvatarConfig({ ...DRESSED, somethingElse: 'ignored' }, catalog, baseIds)).toEqual({ ok: true, value: DRESSED })
  })

  it('refuses a missing outfit — the one required slot', () => {
    const { outfit: _outfit, ...noOutfit } = CASUAL
    expect(validateAvatarConfig(noOutfit, catalog, baseIds)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfig({ ...CASUAL, outfit: '' }, catalog, baseIds)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfig(null, catalog, baseIds)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfig([CASUAL], catalog, baseIds)).toEqual({ ok: false, code: 'MISSING_LAYER' })
  })

  it('refuses anything that is not v3 — a v1 or v2 config is readable, but not writable', () => {
    const { v: _v, ...noVersion } = CASUAL
    expect(validateAvatarConfig(noVersion, catalog, baseIds)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfig({ ...CASUAL, v: 2 }, catalog, baseIds)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfig({ ...CASUAL, v: '3' }, catalog, baseIds)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfig({ v: 2, body: 'male', hair: 'hair_none', top: 'top_tee', bottom: 'bottom_jeans', shoes: 'shoes_sneakers', skin: '#000', eyes: '#000', hairColor: '#000' }, catalog, baseIds))
      .toEqual({ ok: false, code: 'MISSING_LAYER' })
  })

  it('refuses a missing base with MISSING_LAYER and an unknown one with INVALID_BASE', () => {
    expect(validateAvatarConfig({ ...CASUAL, base: undefined }, catalog, baseIds)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    const { base: _base, ...noBase } = CASUAL
    expect(validateAvatarConfig(noBase, catalog, baseIds)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    for (const base of ['robot', 'f09', 42, null]) {
      expect(validateAvatarConfig({ ...CASUAL, base }, catalog, baseIds), String(base)).toEqual({ ok: false, code: base === null ? 'MISSING_LAYER' : 'INVALID_BASE' })
    }
    expect(validateAvatarConfig({ ...CASUAL, base: 'm01' }, catalog, baseIds)).toMatchObject({ ok: true })
  })

  it('takes the base list from the registry it is handed, not from a union in the code', () => {
    // The point of the open id (2026-09-17): `f02` is refused above because nothing defines it, and
    // accepted here because something does — with no type widened and no constant edited between the two.
    const withF09 = new Set([...baseIds, 'f09'])
    expect(validateAvatarConfig({ ...CASUAL, base: 'f09' }, catalog, withF09)).toEqual({ ok: true, value: { ...CASUAL, base: 'f09' } })
    // …and a base the server has dropped stops being writable the moment its registry entry is gone.
    expect(validateAvatarConfig({ ...CASUAL, base: 'm01' }, catalog, new Set(['f01']))).toEqual({ ok: false, code: 'INVALID_BASE' })
  })

  it('refuses an id that is not in the catalogue', () => {
    expect(validateAvatarConfig({ ...CASUAL, outfit: 'outfit_imaginary' }, catalog, baseIds)).toEqual({ ok: false, code: 'INVALID_ITEM' })
    expect(validateAvatarConfig({ ...CASUAL, title: 42 }, catalog, baseIds)).toEqual({ ok: false, code: 'INVALID_ITEM' })
    // The withdrawn v2 ids are exactly that: not in the catalogue any more.
    expect(validateAvatarConfig({ ...CASUAL, outfit: 'clothing_tee' }, catalog, baseIds)).toEqual({ ok: false, code: 'INVALID_ITEM' })
  })

  it('refuses an id worn in the wrong slot', () => {
    expect(validateAvatarConfig({ ...CASUAL, outfit: 'head_beanie01' }, catalog, baseIds)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
    expect(validateAvatarConfig({ ...DRESSED, badge: 'title_devoted' }, catalog, baseIds)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
    // A face item in the head slot: two slots that used to share `accessory` are not interchangeable now.
    expect(validateAvatarConfig({ ...CASUAL, head: 'face_glasses_round_gold01' }, catalog, baseIds)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
  })

  it('treats an omitted or null optional slot as empty', () => {
    expect(validateAvatarConfig({ ...DRESSED, title: undefined, badge: null }, catalog, baseIds)).toEqual({ ok: true, value: { ...DRESSED, title: undefined, badge: undefined } })
  })
})

describe('applyAvatarConfig', () => {
  it('refuses a configuration referencing an item the player does not own, naming it', async () => {
    const playerId = await seedPlayer()
    await own(playerId, ...worn(CASUAL))

    const err = await applyAvatarConfig(db, inv, playerId, { ...CASUAL, head: 'head_crown_gold01' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ServiceError)
    expect((err as ServiceError).code).toBe('NOT_OWNED')
    expect((err as ServiceError).message).toContain('head_crown_gold01')
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

    await applyAvatarConfig(db, inv, playerId, CASUAL)
    const [row] = await db.select().from(players).where(eq(players.id, playerId))
    expect(row!.avatarConfig).toEqual(CASUAL)
    expect(row).toMatchObject({ equippedTitle: null, equippedBadge: null })
  })

  it('refuses a player who is not there — through ownership, the only check it needs', async () => {
    const err = await applyAvatarConfig(db, inv, '00000000-0000-4000-8000-000000000000', CASUAL).catch((e: unknown) => e)
    expect((err as ServiceError).code).toBe('NOT_OWNED')
    expect(await db.select().from(players)).toHaveLength(0)
  })

  it('is satisfied by an old alias id already owned — an old inventory row was never rewritten', async () => {
    await ensureLegacyItem('hat_crown', 'hat', 'epic')
    const playerId = await seedPlayer()
    await own(playerId, 'outfit_casual01', 'hat_crown')
    // `hat_crown` (v2) aliases to `head_crown_gold01` (v3): owning the old row must satisfy the new id.
    await expect(applyAvatarConfig(db, inv, playerId, { ...CASUAL, head: 'head_crown_gold01' })).resolves.toMatchObject({ config: { head: 'head_crown_gold01' } })
  })
})

describe('InventoryService', () => {
  it('grants once and says so', async () => {
    const playerId = await seedPlayer()
    await db.transaction(async (tx) => {
      expect(await inv.grant(tx, playerId, 'head_crown_gold01', 'achievement')).toBe(true)
      expect(await inv.grant(tx, playerId, 'head_crown_gold01', 'daily')).toBe(false)
    })

    const rows = await db.select().from(inventory).where(eq(inventory.playerId, playerId))
    expect(rows).toHaveLength(1)
    // The first grant's source is kept: how a player *got* an item does not change afterwards.
    expect(rows[0]).toMatchObject({ itemId: 'head_crown_gold01', source: 'achievement' })
  })

  it('lists what a player owns, oldest first', async () => {
    const playerId = await seedPlayer()
    await own(playerId, 'outfit_casual01', 'head_crown_gold01')
    const owned = await inv.list(playerId)
    expect(owned.map((o) => o.itemId).sort()).toEqual(['head_crown_gold01', 'outfit_casual01'])
    expect(owned[0]!.acquiredAt).toBeGreaterThan(0)
    expect(await inv.list('not-a-uuid')).toEqual([])
  })

  it('answers owns and missingOf without tripping over a malformed id', async () => {
    const playerId = await seedPlayer()
    await own(playerId, 'outfit_casual01')
    expect(await inv.owns(playerId, 'outfit_casual01')).toBe(true)
    expect(await inv.owns(playerId, 'head_crown_gold01')).toBe(false)
    expect(await inv.owns('not-a-uuid', 'outfit_casual01')).toBe(false)
    expect(await inv.missingOf(playerId, ['outfit_casual01'])).toEqual([])
    expect(await inv.missingOf(playerId, ['outfit_casual01', 'head_crown_gold01', 'head_crown_gold01'])).toEqual(['head_crown_gold01'])
    expect(await inv.missingOf('not-a-uuid', ['outfit_casual01'])).toEqual(['outfit_casual01'])
    expect(await inv.missingOf(playerId, [])).toEqual([])
  })

  it('resolves aliases both ways: an old row satisfies the new id it aliases to', async () => {
    await ensureLegacyItem('accessory_glasses', 'accessory', 'common')
    const playerId = await seedPlayer()
    await own(playerId, 'accessory_glasses') // v2 id, aliases to face_glasses_round_gold01
    expect(await inv.owns(playerId, 'face_glasses_round_gold01')).toBe(true)
    expect(await inv.missingOf(playerId, ['face_glasses_round_gold01'])).toEqual([])
  })

  it('lists the unowned items of one rarity, in id order — every catalogue slot, unless narrowed', async () => {
    const playerId = await seedPlayer()
    const allCommon = catalog.byRarity('common').map((d) => d.id).sort()
    await own(playerId, allCommon[0]!)

    const unowned = await db.transaction((tx) => inv.unownedOfRarity(tx, playerId, 'common'))
    // A superset check rather than exact equality: other tests in this file plant v2 rows straight
    // into `items` (`ensureLegacyItem`) to exercise the alias path, and this function's whole point
    // is that it does *not* filter those out on its own — see `withinSlots`, below.
    expect(unowned).toEqual(expect.arrayContaining(allCommon.slice(1)))
    expect(unowned).not.toContain(allCommon[0])
    // Nothing is excluded by default: a `title`/`badge` common is still a catalogue item of that
    // rarity, and it is the caller's job (the daily draw) to say it does not want those.
    expect(unowned.some((id) => catalog.get(id)?.slot === 'title')).toBe(true)
    expect(unowned.some((id) => catalog.get(id)?.slot === 'badge')).toBe(true)
    // Ordered, so a seeded rng picks the same item every run.
    expect([...unowned].sort()).toEqual(unowned)
    expect(await db.transaction((tx) => inv.unownedOfRarity(tx, playerId, 'epic'))).toEqual(expect.arrayContaining(catalog.byRarity('epic').map((d) => d.id).sort()))
  })

  it('is alias-aware: owning only the old row keeps the new id out of the pool too', async () => {
    await ensureLegacyItem('hat_crown', 'hat', 'epic')
    const playerId = await seedPlayer()
    await own(playerId, 'hat_crown') // v2 id, aliases to head_crown_gold01 — never re-inserted by Plan 11's catalogue
    const unowned = await db.transaction((tx) => inv.unownedOfRarity(tx, playerId, 'epic'))
    // Without the widening this would still list `head_crown_gold01`: the daily draw would then be
    // able to "grant" a legacy player, under its current id, a cosmetic they already own.
    expect(unowned).not.toContain('head_crown_gold01')
    expect(unowned).toEqual(expect.arrayContaining(catalog.byRarity('epic').map((d) => d.id).filter((id) => id !== 'head_crown_gold01')))
  })

  it('drops the excluded ids and slots from the pool, and an empty exclusion excludes nothing', async () => {
    const playerId = await seedPlayer()
    const allRare = catalog.byRarity('rare').map((d) => d.id).sort()

    const filtered = await db.transaction((tx) =>
      inv.unownedOfRarity(tx, playerId, 'rare', { ids: ['aura_fire01'], slots: ['title', 'badge'] }),
    )
    expect(filtered).not.toContain('aura_fire01')
    expect(filtered.some((id) => catalog.get(id)?.slot === 'title')).toBe(false)
    expect(filtered.some((id) => catalog.get(id)?.slot === 'badge')).toBe(false)
    expect(filtered).toEqual(allRare.filter((id) => id !== 'aura_fire01' && catalog.get(id)!.slot !== 'title' && catalog.get(id)!.slot !== 'badge'))

    // `notInArray(col, [])` is `col <> all('{}')`, which Postgres reads as unknown for every row —
    // an empty exclusion must mean "exclude nothing".
    expect(await db.transaction((tx) => inv.unownedOfRarity(tx, playerId, 'rare', { ids: [], slots: [] }))).toEqual(allRare)
    expect(await db.transaction((tx) => inv.unownedOfRarity(tx, playerId, 'rare', {}))).toEqual(allRare)
  })

  it('restricts to withinSlots as an allow-list, which also keeps out a row a withdrawn v2 slot left behind', async () => {
    // `0001_avatar_v2.sql` always inserts these four v2 rows, whatever `items.json` currently says —
    // and Plan 11's catalogue does not renew them, so they sit in the table as pure FK anchors. A
    // deny-list could never name them (they are not even a current `ItemSlot`); the daily draw's
    // `withinSlots: DAILY_DRAW_SLOTS` keeps them out precisely because it names what *is* allowed.
    const playerId = await seedPlayer()
    const commonPool = await db.transaction((tx) => inv.unownedOfRarity(tx, playerId, 'common', { withinSlots: ['head', 'face', 'aura', 'frame'] }))
    for (const legacy of ['hair_none', 'top_tee', 'bottom_jeans', 'shoes_sneakers']) {
      expect(commonPool, legacy).not.toContain(legacy)
    }
    expect(commonPool.every((id) => ['head', 'face', 'aura', 'frame'].includes(catalog.get(id)!.slot))).toBe(true)
    expect(commonPool.length).toBeGreaterThan(0)

    // An empty or absent `withinSlots` means every slot, the same guard as `slots`/`ids`.
    expect(await db.transaction((tx) => inv.unownedOfRarity(tx, playerId, 'common', { withinSlots: [] }))).toEqual(
      await db.transaction((tx) => inv.unownedOfRarity(tx, playerId, 'common')),
    )
  })
})
