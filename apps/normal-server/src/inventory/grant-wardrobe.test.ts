import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { inventory, players, users } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import { GRANT_SOURCE, grantWardrobe, UnknownAccountError } from './grant-wardrobe.js'
import { createInventoryService } from './inventory-service.js'
import { loadItemCatalog } from './items.js'

let test: TestDb
let db: AppDb
const catalog = loadItemCatalog()
/** What `grantWardrobe` actually grants rows for: `free` items never get one (design §3.2). */
const nonFreeCount = catalog.all().filter((d) => !d.free).length

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
})
afterAll(async () => {
  await test.close()
})

async function account(email: string, name: string): Promise<string> {
  const [user] = await db.insert(users).values({ email, passwordHash: 'argon2' }).returning({ id: users.id })
  const id = user!.id
  await db.insert(players).values({ id, displayName: name, nameKey: name.toLowerCase(), balance: 0 })
  return id
}

const owned = async (playerId: string) => db.select({ itemId: inventory.itemId, source: inventory.source }).from(inventory).where(eq(inventory.playerId, playerId))

describe('grantWardrobe', () => {
  it('gives the account every catalogue item, marked as a dev grant, and is idempotent', async () => {
    const id = await account('full@example.com', 'Full')
    // A default item the account already earned the normal way keeps its own source.
    await catalog.seed(db)
    await db.transaction((tx) => createInventoryService(db).grant(tx, id, catalog.defaults()[0]!, 'default'))

    const first = await grantWardrobe(db, catalog, 'Full@Example.com')
    expect(first).toMatchObject({ playerId: id, displayName: 'Full', total: nonFreeCount, alreadyOwned: 1 })
    expect(first.granted).toHaveLength(nonFreeCount - 1)

    const rows = await owned(id)
    // Free items are never in `granted` and never get a row — `total`/`rows` both count non-free only.
    expect(rows).toHaveLength(nonFreeCount)
    expect(rows.every((r) => !catalog.get(r.itemId)?.free)).toBe(true)
    expect(rows.filter((r) => r.source === GRANT_SOURCE)).toHaveLength(nonFreeCount - 1)
    expect(rows.find((r) => r.itemId === catalog.defaults()[0])?.source).toBe('default')

    const second = await grantWardrobe(db, catalog, 'full@example.com')
    expect(second.granted).toEqual([])
    expect(second.alreadyOwned).toBe(nonFreeCount)
  })

  it('reports without writing on a dry run', async () => {
    const id = await account('dry@example.com', 'Dry')
    const result = await grantWardrobe(db, catalog, 'dry@example.com', { dryRun: true })
    expect(result.granted).toHaveLength(nonFreeCount)
    expect(await owned(id)).toHaveLength(0)
  })

  it('refuses an email nobody registered', async () => {
    await expect(grantWardrobe(db, catalog, 'nobody@example.com')).rejects.toBeInstanceOf(UnknownAccountError)
  })
})
