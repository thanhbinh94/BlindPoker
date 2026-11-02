import { and, asc, eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AchievementDef } from '../achievements/definitions.js'
import { loadAchievements } from '../achievements/definitions.js'
import type { AppDb } from '../db/client.js'
import { inventory, players, pointTransactions, reputationEvents, users } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import { createInventoryService } from './inventory-service.js'
import { loadItemCatalog } from './items.js'
import { backfillTitleSets, parseTitleSetArgs, TITLE_SET_USAGE } from './title-sets.js'

let test: TestDb
let db: AppDb
let defs: AchievementDef[]

const GOD_SET = ['outfit_card_god01', 'head_ace_crown01', 'aura_card_god01', 'frame_card_god']
const DEMIGOD_SET = ['outfit_demigod01', 'head_laurel_silver01', 'aura_demigod01', 'frame_demigod']
const GODSLAYER_SET = ['outfit_godslayer01', 'head_godslayer_helm01', 'aura_godslayer01', 'frame_godslayer']

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
  const catalog = loadItemCatalog()
  await catalog.seed(db)
  defs = loadAchievements(catalog)
})
afterAll(async () => {
  await test.close()
})
afterEach(async () => {
  await db.execute(sql`truncate table inventory, reputation_events, point_transactions, players, users restart identity cascade`)
})

let seq = 0
async function seedPlayer(balance = 1_000): Promise<string> {
  seq += 1
  const name = `t${seq}`
  const [user] = await db.insert(users).values({ email: `${name}@example.com`, passwordHash: 'argon2' }).returning({ id: users.id })
  const id = user!.id
  await db.insert(players).values({ id, displayName: name, nameKey: name, balance })
  return id
}

/** Owns `ids`, each under `source`, the way the player came by it. */
async function give(playerId: string, ids: readonly string[], source = 'achievement'): Promise<void> {
  const inv = createInventoryService(db)
  await db.transaction(async (tx) => {
    for (const id of ids) await inv.grant(tx, playerId, id, source)
  })
}

async function owned(playerId: string): Promise<string[]> {
  const rows = await db.select({ id: inventory.itemId }).from(inventory).where(eq(inventory.playerId, playerId)).orderBy(asc(inventory.itemId))
  return rows.map((r) => r.id)
}

const sorted = (ids: readonly string[]): string[] => [...ids].sort()

async function counts(): Promise<{ inventory: number; ledger: number; reputation: number; balances: number[] }> {
  const count = async (table: typeof inventory | typeof pointTransactions | typeof reputationEvents): Promise<number> =>
    Number((await db.select({ n: sql<number>`count(*)` }).from(table))[0]!.n)
  const balances = (await db.select({ b: players.balance }).from(players).orderBy(asc(players.id))).map((r) => r.b)
  return { inventory: await count(inventory), ledger: await count(pointTransactions), reputation: await count(reputationEvents), balances }
}

describe('backfillTitleSets', () => {
  it('hands the owners of each title exactly the set items they lack, a GM-granted title included', async () => {
    const god = await seedPlayer()
    const demigod = await seedPlayer()
    const slayer = await seedPlayer()
    const gmGranted = await seedPlayer()
    const nobody = await seedPlayer()
    await give(god, ['title_god'])
    await give(demigod, ['title_demigod'])
    await give(slayer, ['title_godslayer'])
    await give(gmGranted, ['title_god'], 'gm')
    await give(nobody, ['title_devoted'])

    const result = await backfillTitleSets(db, { dryRun: false, defs })

    expect(result).toEqual({ players: 4, granted: 16 })
    expect(await owned(god)).toEqual(sorted(['title_god', ...GOD_SET]))
    expect(await owned(demigod)).toEqual(sorted(['title_demigod', ...DEMIGOD_SET]))
    expect(await owned(slayer)).toEqual(sorted(['title_godslayer', ...GODSLAYER_SET]))
    expect(await owned(gmGranted)).toEqual(sorted(['title_god', ...GOD_SET]))
    expect(await owned(nobody)).toEqual(['title_devoted'])
    // The source is the unlock's own, as a fresh unlock would have written it.
    const [row] = await db.select({ source: inventory.source }).from(inventory).where(and(eq(inventory.playerId, god), eq(inventory.itemId, 'frame_card_god')))
    expect(row!.source).toBe('achievement')
  })

  it('counts a player who holds two titles once and hands over both sets', async () => {
    const both = await seedPlayer()
    await give(both, ['title_god', 'title_demigod'])
    expect(await backfillTitleSets(db, { dryRun: false, defs })).toEqual({ players: 1, granted: 8 })
    expect(await owned(both)).toEqual(sorted(['title_god', 'title_demigod', ...GOD_SET, ...DEMIGOD_SET]))
  })

  it('tops up a holder who already owns two of the four', async () => {
    const half = await seedPlayer()
    await give(half, ['title_god', GOD_SET[0]!, GOD_SET[3]!])
    const result = await backfillTitleSets(db, { dryRun: false, defs })
    expect(result).toEqual({ players: 1, granted: 2 })
    expect(await owned(half)).toEqual(sorted(['title_god', ...GOD_SET]))
  })

  it('grants nothing on a second run', async () => {
    const a = await seedPlayer()
    const b = await seedPlayer()
    await give(a, ['title_god'])
    await give(b, ['title_godslayer'])
    expect((await backfillTitleSets(db, { dryRun: false, defs })).granted).toBe(8)
    const before = await counts()
    expect(await backfillTitleSets(db, { dryRun: false, defs })).toEqual({ players: 2, granted: 0 })
    expect(await counts()).toEqual(before)
  })

  it('writes nothing in a dry run and reports what the real run grants', async () => {
    const a = await seedPlayer()
    const b = await seedPlayer()
    await give(a, ['title_demigod'])
    await give(b, ['title_god', GOD_SET[1]!])
    const before = await counts()

    const dry = await backfillTitleSets(db, { dryRun: true, defs })

    expect(dry).toEqual({ players: 2, granted: 7 })
    expect(await counts()).toEqual(before)
    expect(await backfillTitleSets(db, { dryRun: false, defs })).toEqual(dry)
  })

  it('moves no points and writes no ledger or reputation row', async () => {
    const a = await seedPlayer(1_234)
    const b = await seedPlayer(0)
    await give(a, ['title_god'])
    await give(b, ['title_godslayer'])
    const before = await counts()

    await backfillTitleSets(db, { dryRun: false, defs })

    const after = await counts()
    expect(after.inventory).toBe(before.inventory + 8)
    expect(after.ledger).toBe(0)
    expect(after.reputation).toBe(0)
    expect(after.balances).toEqual(before.balances)
    expect([...after.balances].sort((x, y) => x - y)).toEqual([0, 1_234])
  })

  it('does nothing for a catalogue with no set-bearing title', async () => {
    const a = await seedPlayer()
    await give(a, ['title_god'])
    const plain = defs.map(({ reward: { setItems: _setItems, ...reward }, ...def }) => ({ ...def, reward }))
    expect(await backfillTitleSets(db, { dryRun: false, defs: plain })).toEqual({ players: 0, granted: 0 })
    expect(await owned(a)).toEqual(['title_god'])
  })
})

describe('parseTitleSetArgs', () => {
  it('reads no argument as the real run and --dry-run as a dry run', () => {
    expect(parseTitleSetArgs([])).toEqual({ dryRun: false })
    expect(parseTitleSetArgs(['--dry-run'])).toEqual({ dryRun: true })
  })

  it('refuses anything else, so a mistyped flag cannot run the real grant', () => {
    expect(parseTitleSetArgs(['--dryrun'])).toBeNull()
    expect(parseTitleSetArgs(['--dry-run', 'x'])).toBeNull()
    expect(TITLE_SET_USAGE).toContain('title-set-backfill-cli.js')
  })
})
