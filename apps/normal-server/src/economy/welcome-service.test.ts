/**
 * The welcome gift (Plan 27, spec §4 C1, R6, R8, R17): one of three rare items, worn at once, with the first hundred
 * reputation and day 1 of the newcomer calendar — once per account, all in one transaction.
 */
import { silentLogger } from '@bp/server-kit'
import { asc, eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppDb, AppTx } from '../db/client.js'
import { inventory, newcomerProgress, players, reputationEvents, shopConfig, users } from '../db/schema.js'
import { createTestDb, type TestDb } from '../db/test-db.js'
import { createEventBus } from '../events.js'
import { loadAliases } from '../inventory/aliases.js'
import { readAvatarConfig } from '../inventory/avatar-migrate.js'
import { defaultAvatar, wearItemWithin } from '../inventory/avatar.js'
import { loadBodies, type Bodies } from '../inventory/bodies.js'
import { createInventoryService, type InventoryService } from '../inventory/inventory-service.js'
import { loadItemCatalog, type ItemCatalog } from '../inventory/items.js'
import { createReputationService, seedDefaults, type ReputationService } from '../reputation/reputation-service.js'
import { DEFAULT_WELCOME_CHOICES, WELCOME_CHOICES_KEY } from '../shop/shop-prices-seed.js'
import { dayKey } from './daily-rules.js'
import { createWelcomeService, type WelcomeService, type WelcomeServiceDeps } from './welcome-service.js'

let test: TestDb
let db: AppDb
let catalog: ItemCatalog
let aliases: ReadonlyMap<string, string>
let bodies: Bodies
let inv: InventoryService
let reputation: ReputationService
let announced: { playerId: string; rank: number }[] = []

/** 23:30 UTC on 2026-10-22 — already the 23rd in Ho Chi Minh City, so the day key must follow the economy's zone. */
const NOW = Date.UTC(2026, 9, 22, 23, 30)
const TZ = 'Asia/Ho_Chi_Minh'
const [HAT_CHOICE] = DEFAULT_WELCOME_CHOICES.filter((id) => id.startsWith('head_'))
const [OUTFIT_CHOICE] = DEFAULT_WELCOME_CHOICES.filter((id) => id.startsWith('outfit_'))

function makeWelcome(overrides: Partial<WelcomeServiceDeps> = {}): WelcomeService {
  return createWelcomeService({
    db,
    inventory: inv,
    catalog,
    shop: { welcomeChoices: async () => [...DEFAULT_WELCOME_CHOICES] },
    reputation: {
      rules: () => reputation.rules(),
      grantRuleWithin: (tx, playerId, key, reason, refId) => reputation.grantRuleWithin(tx, playerId, key, reason, refId),
      announceRankUp: (playerId, rank) => announced.push({ playerId, rank }),
    },
    avatars: { wearWithin: (tx: AppTx, playerId: string, itemId: string) => wearItemWithin(tx, catalog, aliases, bodies, playerId, itemId) },
    timezone: TZ,
    now: () => NOW,
    ...overrides,
  })
}

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
  catalog = loadItemCatalog()
  await catalog.seed(db)
  aliases = loadAliases()
  bodies = loadBodies()
  inv = createInventoryService(db, aliases, catalog.freeIds())
  reputation = createReputationService({ db, bus: createEventBus(silentLogger), notify: () => {}, log: silentLogger })
  await seedDefaults(db)
})
afterAll(async () => {
  await test.close()
})
afterEach(async () => {
  announced = []
  await db.execute(sql`truncate table inventory, reputation_events, newcomer_progress, players, users restart identity cascade`)
  await db.delete(shopConfig).where(eq(shopConfig.key, WELCOME_CHOICES_KEY))
})

let seq = 0
async function seedPlayer(): Promise<string> {
  seq += 1
  const name = `w${seq}`
  const [user] = await db.insert(users).values({ email: `${name}@example.com`, passwordHash: 'argon2' }).returning({ id: users.id })
  const id = user!.id
  await db.insert(players).values({ id, displayName: name, nameKey: name, balance: 100_000, avatarConfig: defaultAvatar(catalog) as unknown as Record<string, unknown> })
  return id
}

async function own(playerId: string, ...itemIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const itemId of itemIds) await inv.grant(tx, playerId, itemId, 'test')
  })
}

async function playerRow(playerId: string) {
  const [row] = await db
    .select({ welcomeClaimedAt: players.welcomeClaimedAt, reputation: players.reputation, rank: players.rank, avatarConfig: players.avatarConfig })
    .from(players)
    .where(eq(players.id, playerId))
  return row!
}

const itemsOf = async (playerId: string) =>
  db.select({ itemId: inventory.itemId, source: inventory.source, ref: inventory.ref }).from(inventory).where(eq(inventory.playerId, playerId)).orderBy(asc(inventory.itemId))

const newcomerOf = async (playerId: string) => (await db.select().from(newcomerProgress).where(eq(newcomerProgress.playerId, playerId)))[0]

describe('WelcomeService', () => {
  it('claims once: item, worn, +100 reputation, newcomer day 1 with last_day_key', async () => {
    const pid = await seedPlayer()
    const welcome = makeWelcome()
    expect(await welcome.status(pid)).toEqual({
      claimed: false,
      choices: DEFAULT_WELCOME_CHOICES.map((itemId) => ({ itemId, owned: false })),
      reputation: 100,
    })

    const result = await welcome.claim(pid, HAT_CHOICE!)
    expect(result).toEqual({ ok: true, itemId: HAT_CHOICE, reputation: 100, rank: 2, rankUp: true })

    expect(await itemsOf(pid)).toEqual([{ itemId: HAT_CHOICE, source: 'welcome', ref: 'welcome' }])
    const row = await playerRow(pid)
    expect(row.welcomeClaimedAt?.getTime()).toBe(NOW)
    expect(row.reputation).toBe(100)
    expect(row.rank).toBe(2)
    // Worn at once, and nothing else on the figure moved.
    const worn = readAvatarConfig(row.avatarConfig, catalog, aliases, bodies)
    expect(worn).toEqual({ ...defaultAvatar(catalog), head: HAT_CHOICE })

    const events = await db.select({ delta: reputationEvents.delta, reason: reputationEvents.reason, refId: reputationEvents.refId }).from(reputationEvents).where(eq(reputationEvents.playerId, pid))
    expect(events).toEqual([{ delta: 100, reason: 'welcome', refId: 'welcome' }])

    expect(await newcomerOf(pid)).toMatchObject({ day: 1, claimedDays: [1], lastDayKey: dayKey(NOW, TZ), finishedAt: null })
    expect(dayKey(NOW, TZ)).toBe('2026-10-23')

    // The rank-up is announced, after the commit.
    expect(announced).toEqual([{ playerId: pid, rank: 2 }])
    expect((await welcome.status(pid)).claimed).toBe(true)
  })

  it('a second claim is WELCOME_CLAIMED', async () => {
    const pid = await seedPlayer()
    const welcome = makeWelcome()
    expect((await welcome.claim(pid, OUTFIT_CHOICE!)).ok).toBe(true)
    announced = []

    expect(await welcome.claim(pid, HAT_CHOICE!)).toEqual({ ok: false, code: 'WELCOME_CLAIMED' })
    expect(await welcome.claim(pid, null)).toEqual({ ok: false, code: 'WELCOME_CLAIMED' })
    // Refused before any grant: still the one item, the one hundred, the outfit still worn.
    expect((await itemsOf(pid)).map((r) => r.itemId)).toEqual([OUTFIT_CHOICE])
    const row = await playerRow(pid)
    expect(row.reputation).toBe(100)
    expect(readAvatarConfig(row.avatarConfig, catalog, aliases, bodies).outfit).toBe(OUTFIT_CHOICE)
    expect(row.avatarConfig['head']).toBeUndefined()
    expect(announced).toEqual([])
  })

  it('an owned choice is ALREADY_OWNED and status marks it owned', async () => {
    const pid = await seedPlayer()
    await own(pid, HAT_CHOICE!)
    const welcome = makeWelcome()

    const status = await welcome.status(pid)
    expect(status.claimed).toBe(false)
    expect(status.choices).toEqual(DEFAULT_WELCOME_CHOICES.map((itemId) => ({ itemId, owned: itemId === HAT_CHOICE })))

    expect(await welcome.claim(pid, HAT_CHOICE!)).toEqual({ ok: false, code: 'ALREADY_OWNED' })
    // Not every choice is owned, so taking only the reputation is not on offer.
    expect(await welcome.claim(pid, null)).toEqual({ ok: false, code: 'NOT_A_CHOICE' })
    expect((await welcome.claim(pid, OUTFIT_CHOICE!)).ok).toBe(true)
  })

  it('all three owned: claim(null) grants reputation only', async () => {
    const pid = await seedPlayer()
    await own(pid, ...DEFAULT_WELCOME_CHOICES)
    const before = (await playerRow(pid)).avatarConfig
    const welcome = makeWelcome()
    expect((await welcome.status(pid)).choices.every((c) => c.owned)).toBe(true)

    expect(await welcome.claim(pid, null)).toEqual({ ok: true, itemId: null, reputation: 100, rank: 2, rankUp: true })
    expect((await itemsOf(pid)).map((r) => r.source)).toEqual(['test', 'test', 'test'])
    const row = await playerRow(pid)
    expect(row.avatarConfig).toEqual(before)
    expect(row.welcomeClaimedAt).not.toBeNull()
    expect(await newcomerOf(pid)).toMatchObject({ day: 1, claimedDays: [1] })
  })

  it('a non-choice is NOT_A_CHOICE', async () => {
    const pid = await seedPlayer()
    const welcome = makeWelcome()
    expect(await welcome.claim(pid, 'head_crown_gold01')).toEqual({ ok: false, code: 'NOT_A_CHOICE' })
    expect(await welcome.claim(pid, 'hat_that_never_was')).toEqual({ ok: false, code: 'NOT_A_CHOICE' })
    expect(await itemsOf(pid)).toEqual([])
  })

  it('a refused claim leaves welcome_claimed_at null', async () => {
    const pid = await seedPlayer()
    await own(pid, HAT_CHOICE!)
    const welcome = makeWelcome()
    const spy = vi.spyOn(reputation, 'grantRuleWithin')
    try {
      expect((await welcome.claim(pid, HAT_CHOICE!)).ok).toBe(false)
      expect((await welcome.claim(pid, 'head_crown_gold01')).ok).toBe(false)
      expect((await welcome.claim(pid, null)).ok).toBe(false)
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
    const row = await playerRow(pid)
    expect(row.welcomeClaimedAt).toBeNull()
    expect(row.reputation).toBe(0)
    expect(await newcomerOf(pid)).toBeUndefined()
    expect((await welcome.status(pid)).claimed).toBe(false)
  })

  it('status says what the welcome rule pays now, so a GM’s change reaches the dialog before the claim', async () => {
    const pid = await seedPlayer()
    const rules = { ...(await reputation.rules()), welcome: 250 }
    const welcome = makeWelcome({ reputation: { rules: async () => rules, grantRuleWithin: (...args) => reputation.grantRuleWithin(...args), announceRankUp: () => {} } })
    expect((await welcome.status(pid)).reputation).toBe(250)
  })

  it('a grant that loses a race inside the transaction is ALREADY_OWNED, and the guard stays null', async () => {
    const pid = await seedPlayer()
    // `missingOf` (read before the transaction) says unowned; the grant inside it finds the row a racing draw just wrote.
    const welcome = makeWelcome({ inventory: { missingOf: inv.missingOf, grant: async () => false } })
    expect(await welcome.claim(pid, HAT_CHOICE!)).toEqual({ ok: false, code: 'ALREADY_OWNED' })
    const row = await playerRow(pid)
    expect(row.welcomeClaimedAt).toBeNull()
    expect(row.reputation).toBe(0)
    expect(await newcomerOf(pid)).toBeUndefined()
  })

  it('a throw after the grant rolls back the item, what was worn and the guard', async () => {
    const pid = await seedPlayer()
    const failing = makeWelcome({
      reputation: {
        rules: () => reputation.rules(),
        grantRuleWithin: () => Promise.reject(new Error('reputation down')),
        announceRankUp: () => announced.push({ playerId: pid, rank: 0 }),
      },
    })
    await expect(failing.claim(pid, HAT_CHOICE!)).rejects.toThrow('reputation down')

    expect(await itemsOf(pid)).toEqual([])
    const row = await playerRow(pid)
    expect(readAvatarConfig(row.avatarConfig, catalog, aliases, bodies)).toEqual(defaultAvatar(catalog))
    expect(row.welcomeClaimedAt).toBeNull()
    expect(await newcomerOf(pid)).toBeUndefined()
    expect(announced).toEqual([])
    // And the gift is still there to take.
    expect((await makeWelcome().claim(pid, HAT_CHOICE!)).ok).toBe(true)
  })
})
