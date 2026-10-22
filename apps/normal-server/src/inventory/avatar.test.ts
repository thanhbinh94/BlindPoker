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
import type { AvatarConfigV4 } from './avatar.js'
import { loadAliases } from './aliases.js'
import { applyAvatarConfig, defaultAvatar, itemIdsOf, validateAvatarConfig, wearItemWithin } from './avatar.js'
import { loadBodies } from './bodies.js'
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

/** The plainest v4 figure: a woman with the bob, in the default outfit — what a new account is created wearing. */
const V4 = { v: 4, gender: 'f', hairStyle: 'hair_f_bob01', outfit: 'outfit_casual01' } as const
const CASUAL: AvatarConfigV4 = { ...V4 }
const DRESSED: AvatarConfigV4 = {
  v: 4,
  gender: 'm',
  hairStyle: 'hair_m_tousled01',
  outfit: 'outfit_casual01',
  head: 'head_crown_gold01',
  face: 'face_glasses_round_gold01',
  aura: 'aura_gold_cards01',
  frame: 'frame_founder',
  // Rare colours, deliberately not `free`, so `applyAvatarConfig`'s ownership tests below exercise
  // them exactly like every other slot: nothing owns them until `own()` grants them.
  hairColor: 'haircolor_pink01',
  eyeColor: 'eyecolor_violet01',
  skinColor: 'skin_deep01',
  title: 'title_devoted',
  badge: 'badge_monthly',
}

/**
 * Every item id in a config, hairstyle first — what a player has to own to wear it. The hairstyle and the
 * skin colour are `free` in the shipped catalogue, but this file's `inv` is built without a free set, so
 * `own()` grants their rows like any other item's.
 */
const worn = (config: AvatarConfigV4): string[] =>
  [config.hairStyle, config.outfit, config.head, config.face, config.aura, config.frame, config.hairColor, config.eyeColor, config.skinColor, config.title, config.badge].filter(
    (id): id is string => id !== undefined,
  )

describe('defaultAvatar', () => {
  it('dresses a new account as a woman with the bob and the default outfit', () => {
    expect(defaultAvatar(catalog)).toEqual(V4)
  })

  it('is itself a valid configuration', () => {
    expect(validateAvatarConfig(defaultAvatar(catalog), catalog)).toEqual({ ok: true, value: V4 })
  })
})

describe('validateAvatarConfig', () => {
  it('accepts a full v4 configuration and returns exactly what is to be stored', () => {
    const full = { ...V4, skinColor: 'skin_deep01', hairColor: 'haircolor_red01', eyeColor: 'eyecolor_blue01', head: 'head_tophat01', title: 'title_rookie' }
    expect(validateAvatarConfig({ ...full, junk: 1 }, catalog)).toEqual({ ok: true, value: full })
    expect(validateAvatarConfig({ ...DRESSED, somethingElse: 'ignored' }, catalog)).toEqual({ ok: true, value: DRESSED })
  })

  it('refuses v3 outright, and a v4 body that still names a base', () => {
    expect(validateAvatarConfig({ v: 3, base: 'f01', outfit: 'outfit_casual01' }, catalog)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfig({ ...V4, base: 'f01' }, catalog)).toEqual({ ok: false, code: 'INVALID_BASE' })
    // Any base at all: v4 has no such field, so a value there is a stale client, not an id to look up.
    for (const base of ['robot', null, 42]) expect(validateAvatarConfig({ ...V4, base }, catalog), String(base)).toEqual({ ok: false, code: 'INVALID_BASE' })
  })

  it('refuses anything that is not v4 — older configs are readable, but not writable', () => {
    const { v: _v, ...noVersion } = CASUAL
    expect(validateAvatarConfig(noVersion, catalog)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    for (const v of [2, 3, '4', 5]) expect(validateAvatarConfig({ ...CASUAL, v }, catalog), String(v)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfig({ v: 2, body: 'male', hair: 'hair_none', top: 'top_tee', bottom: 'bottom_jeans', shoes: 'shoes_sneakers', skin: '#000', eyes: '#000', hairColor: '#000' }, catalog))
      .toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfig(null, catalog)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfig([CASUAL], catalog)).toEqual({ ok: false, code: 'MISSING_LAYER' })
  })

  it('refuses a missing or unknown gender and a missing hairstyle with MISSING_LAYER', () => {
    const { gender: _gender, ...noGender } = CASUAL
    expect(validateAvatarConfig(noGender, catalog)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    for (const gender of ['x', 'F', 'female', '', null, 1]) {
      expect(validateAvatarConfig({ ...CASUAL, gender }, catalog), String(gender)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    }
    const { hairStyle: _hairStyle, ...noHair } = CASUAL
    expect(validateAvatarConfig(noHair, catalog)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    for (const hairStyle of ['', null, 42]) {
      expect(validateAvatarConfig({ ...CASUAL, hairStyle }, catalog), String(hairStyle)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    }
  })

  it('refuses a missing outfit — the one required slot', () => {
    const { outfit: _outfit, ...noOutfit } = CASUAL
    expect(validateAvatarConfig(noOutfit, catalog)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    expect(validateAvatarConfig({ ...CASUAL, outfit: '' }, catalog)).toEqual({ ok: false, code: 'MISSING_LAYER' })
  })

  it('refuses a hairstyle of the other gender with WRONG_GENDER', () => {
    expect(validateAvatarConfig({ ...V4, hairStyle: 'hair_m_spiky01' }, catalog)).toEqual({ ok: false, code: 'WRONG_GENDER' })
    expect(validateAvatarConfig({ ...DRESSED, hairStyle: 'hair_f_wavy01' }, catalog)).toEqual({ ok: false, code: 'WRONG_GENDER' })
    // …and the same hairstyle is fine on the gender it is drawn for.
    expect(validateAvatarConfig({ ...V4, gender: 'm', hairStyle: 'hair_m_spiky01' }, catalog)).toEqual({ ok: true, value: { ...V4, gender: 'm', hairStyle: 'hair_m_spiky01' } })
  })

  it('refuses a skin colour in the hair slot with WRONG_CATEGORY, and an unknown skin colour with INVALID_ITEM', () => {
    expect(validateAvatarConfig({ ...V4, hairStyle: 'skin_deep01' }, catalog)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
    expect(validateAvatarConfig({ ...V4, hairColor: 'skin_deep01' }, catalog)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
    expect(validateAvatarConfig({ ...V4, skinColor: 'haircolor_red01' }, catalog)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
    expect(validateAvatarConfig({ ...V4, skinColor: 'skin_green01' }, catalog)).toEqual({ ok: false, code: 'INVALID_ITEM' })
    expect(validateAvatarConfig({ ...V4, skinColor: '' }, catalog)).toEqual({ ok: false, code: 'INVALID_ITEM' })
    expect(validateAvatarConfig({ ...V4, hairStyle: 'hair_f_mohawk01' }, catalog)).toEqual({ ok: false, code: 'INVALID_ITEM' })
  })

  it('refuses an id that is not in the catalogue', () => {
    expect(validateAvatarConfig({ ...CASUAL, outfit: 'outfit_imaginary' }, catalog)).toEqual({ ok: false, code: 'INVALID_ITEM' })
    expect(validateAvatarConfig({ ...CASUAL, title: 42 }, catalog)).toEqual({ ok: false, code: 'INVALID_ITEM' })
    // The withdrawn v2 ids are exactly that: not in the catalogue any more.
    expect(validateAvatarConfig({ ...CASUAL, outfit: 'clothing_tee' }, catalog)).toEqual({ ok: false, code: 'INVALID_ITEM' })
  })

  it('refuses an id worn in the wrong slot', () => {
    expect(validateAvatarConfig({ ...CASUAL, outfit: 'head_beanie01' }, catalog)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
    expect(validateAvatarConfig({ ...DRESSED, badge: 'title_devoted' }, catalog)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
    // A face item in the head slot: two slots that used to share `accessory` are not interchangeable now.
    expect(validateAvatarConfig({ ...CASUAL, head: 'face_glasses_round_gold01' }, catalog)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
    // A hat is not a hairstyle, and a hairstyle is not a hat.
    expect(validateAvatarConfig({ ...CASUAL, hairStyle: 'head_beanie01' }, catalog)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
    expect(validateAvatarConfig({ ...CASUAL, head: 'hair_f_bob01' }, catalog)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
  })

  it('answers the structural complaint first, and the gender last (spec §4.1, ruling 9)', () => {
    // base before gender, gender before the hairstyle's own checks…
    expect(validateAvatarConfig({ v: 4, base: 'f01', gender: 'x' }, catalog)).toEqual({ ok: false, code: 'INVALID_BASE' })
    expect(validateAvatarConfig({ ...V4, gender: 'x', hairStyle: 'hair_m_spiky01' }, catalog)).toEqual({ ok: false, code: 'MISSING_LAYER' })
    // …and every item complaint before WRONG_GENDER, which is only meaningful once the hairstyle is known to exist.
    expect(validateAvatarConfig({ ...V4, hairStyle: 'hair_m_spiky01', title: 42 }, catalog)).toEqual({ ok: false, code: 'INVALID_ITEM' })
    expect(validateAvatarConfig({ ...V4, hairStyle: 'hair_m_spiky01', head: 'head_nope' }, catalog)).toEqual({ ok: false, code: 'INVALID_ITEM' })
    expect(validateAvatarConfig({ ...V4, hairStyle: 'hair_m_spiky01', head: 'face_glasses_round_gold01' }, catalog)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
  })

  it('treats an omitted or null optional slot as empty', () => {
    expect(validateAvatarConfig({ ...DRESSED, title: undefined, badge: null }, catalog)).toEqual({ ok: true, value: { ...DRESSED, title: undefined, badge: undefined } })
  })

  it('validates hairColor, eyeColor and skinColor exactly like any other optional slot (design §3.1)', () => {
    for (const [slot, id] of [['hairColor', 'haircolor_red01'], ['eyeColor', 'eyecolor_green01'], ['skinColor', 'skin_porcelain01']] as const) {
      expect(validateAvatarConfig({ ...CASUAL, [slot]: id }, catalog), slot).toEqual({ ok: true, value: { ...CASUAL, [slot]: id } })
    }
    // An eye colour worn in the hair slot is the wrong category, not an unknown item.
    expect(validateAvatarConfig({ ...CASUAL, hairColor: 'eyecolor_green01' }, catalog)).toEqual({ ok: false, code: 'WRONG_CATEGORY' })
    expect(validateAvatarConfig({ ...CASUAL, hairColor: 'nope' }, catalog)).toEqual({ ok: false, code: 'INVALID_ITEM' })
  })
})

describe('itemIdsOf', () => {
  it('lists every worn item in slot order: the hairstyle first, the skin colour with the other colours', () => {
    expect(itemIdsOf(CASUAL)).toEqual(['hair_f_bob01', 'outfit_casual01'])
    expect(itemIdsOf(DRESSED)).toEqual(worn(DRESSED))
    expect(itemIdsOf(DRESSED)).toContain('haircolor_pink01')
    expect(itemIdsOf(DRESSED)).toContain('eyecolor_violet01')
    expect(itemIdsOf(DRESSED)).toContain('skin_deep01')
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
    await own(playerId, ...worn(DRESSED), ...worn(CASUAL))
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
    await own(playerId, 'hair_f_bob01', 'outfit_casual01', 'hat_crown')
    // `hat_crown` (v2) aliases to `head_crown_gold01` (v3): owning the old row must satisfy the new id.
    await expect(applyAvatarConfig(db, inv, playerId, { ...CASUAL, head: 'head_crown_gold01' })).resolves.toMatchObject({ config: { head: 'head_crown_gold01' } })
  })

  it('holds the hairstyle and the skin colour to ownership like any other item — which every player has, since both are free', async () => {
    const playerId = await seedPlayer()
    await own(playerId, 'outfit_casual01')
    // Without a free set, a hairstyle is an item like a hat: not owned, refused, named.
    const err = await applyAvatarConfig(db, inv, playerId, { ...CASUAL, skinColor: 'skin_tan01' }).catch((e: unknown) => e)
    expect((err as ServiceError).code).toBe('NOT_OWNED')
    expect((err as ServiceError).message).toContain('hair_f_bob01')
    expect((err as ServiceError).message).toContain('skin_tan01')
    // With the shipped catalogue's free ids — what `app.ts` builds the service with — nothing needs a row.
    const withFree = createInventoryService(db, undefined, catalog.freeIds())
    await expect(applyAvatarConfig(db, withFree, playerId, { ...CASUAL, skinColor: 'skin_tan01' })).resolves.toEqual({ config: { ...CASUAL, skinColor: 'skin_tan01' } })
  })
})

describe('wearItemWithin', () => {
  const aliases = loadAliases()
  const bodies = loadBodies()

  async function dress(playerId: string, config: AvatarConfigV4): Promise<void> {
    await db
      .update(players)
      .set({ avatarConfig: config as unknown as Record<string, unknown>, equippedTitle: config.title ?? null, equippedBadge: config.badge ?? null })
      .where(eq(players.id, playerId))
  }
  const wear = (playerId: string, itemId: string): Promise<boolean> => db.transaction((tx) => wearItemWithin(tx, catalog, aliases, bodies, playerId, itemId))
  const rowOf = async (playerId: string) => (await db.select().from(players).where(eq(players.id, playerId)))[0]!

  it('puts a head item in the head slot and keeps the rest of the figure', async () => {
    const playerId = await seedPlayer()
    await dress(playerId, DRESSED)

    expect(await wear(playerId, 'head_conical_hat01')).toBe(true)
    const row = await rowOf(playerId)
    expect(row.avatarConfig).toEqual({ ...DRESSED, head: 'head_conical_hat01' })
    expect(row).toMatchObject({ equippedTitle: 'title_devoted', equippedBadge: 'badge_monthly' })
  })

  it('a title sets equipped_title as well as the config', async () => {
    const playerId = await seedPlayer()
    await dress(playerId, CASUAL)

    expect(await wear(playerId, 'title_rookie')).toBe(true)
    const row = await rowOf(playerId)
    expect(row.avatarConfig).toEqual({ ...CASUAL, title: 'title_rookie' })
    expect(row).toMatchObject({ equippedTitle: 'title_rookie', equippedBadge: null })
  })

  it('an outfit replaces the required outfit; an item the figure cannot wear changes nothing', async () => {
    const playerId = await seedPlayer()
    await dress(playerId, CASUAL)

    expect(await wear(playerId, 'outfit_dealer01')).toBe(true)
    expect((await rowOf(playerId)).avatarConfig).toEqual({ ...CASUAL, outfit: 'outfit_dealer01' })

    // A man's hairstyle on a woman's figure would not validate, and an unknown id is no slot at all.
    expect(await wear(playerId, 'hair_m_tousled01')).toBe(false)
    expect(await wear(playerId, 'hat_that_never_was')).toBe(false)
    expect((await rowOf(playerId)).avatarConfig).toEqual({ ...CASUAL, outfit: 'outfit_dealer01' })
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

  describe('free items (design §3.2)', () => {
    // A second service over the same database, told that one real catalogue id is free — the point
    // being that nothing here ever grants it a row, and every query still has to say "owned". Built
    // in `beforeAll` rather than at describe-body time: `db` is not assigned until the outer suite's
    // own `beforeAll` has run.
    const FREE_ID = 'haircolor_red01'
    let freeInv: InventoryService
    beforeAll(() => {
      freeInv = createInventoryService(db, undefined, new Set([FREE_ID]))
    })

    it('owns a free item without any inventory row', async () => {
      const playerId = await seedPlayer()
      expect(await freeInv.owns(playerId, FREE_ID)).toBe(true)
    })

    it('omits a free item from missingOf, whatever else is asked for', async () => {
      const playerId = await seedPlayer()
      await own(playerId, 'outfit_casual01')
      expect(await freeInv.missingOf(playerId, ['outfit_casual01', FREE_ID])).toEqual([])
      // A player owning nothing else still isn't missing the free id.
      const bare = await seedPlayer()
      expect(await freeInv.missingOf(bare, [FREE_ID])).toEqual([])
    })

    it('lists a free item after the owned rows, with source free and acquiredAt 0', async () => {
      const playerId = await seedPlayer()
      await own(playerId, 'outfit_casual01')
      const owned = await freeInv.list(playerId)
      expect(owned.map((o) => o.itemId)).toEqual(['outfit_casual01', FREE_ID])
      expect(owned[1]).toEqual({ itemId: FREE_ID, source: 'free', acquiredAt: 0 })
    })

    it('never offers a free item out of unownedOfRarity', async () => {
      const playerId = await seedPlayer()
      const unowned = await db.transaction((tx) => freeInv.unownedOfRarity(tx, playerId, 'common'))
      expect(unowned).not.toContain(FREE_ID)
    })
  })
})
