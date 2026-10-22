/**
 * The shop over HTTP (Plan 27, spec §3 B2).
 *
 * The shop service has its own tests for the rules — the locks, the rank, the once-per-click key, conservation. What
 * is checked here is the translation: the session gate, the `purchaseId` shape refused before the service is asked,
 * and each refusal's status (`UNKNOWN_ITEM` a 404, the other five a 409 carrying the code in the error envelope, with a
 * message of its own).
 */
import { ECONOMY } from '@bp/core'
import { and, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { inventory, players, shopPrices } from '../db/schema.js'
import { createTestDb, type TestDb } from '../db/test-db.js'
import type { ShopEntry, ShopView } from '../shop/shop-service.js'
import { buildTestApp, resetDb, type Account, type Harness } from '../test-harness.js'

let test: TestDb
let db: AppDb
let h: Harness
let me: Account

const PURCHASE_A = '0f8b6c1e-6a52-4d43-9b8e-2f1f4c0f5a11'
const PURCHASE_B = '7d2a3e44-1b0c-4f9e-8a65-c3b2d1e0f9a8'

const view = async (): Promise<ShopView> => {
  const res = await h.app.fastify.inject({ url: '/api/shop', headers: { cookie: me.cookie } })
  expect(res.statusCode).toBe(200)
  return res.json() as ShopView
}

/** The first entry that sells right now (no lock, not owned) and passes `ok`; fails the test if there is none. */
const pick = (shop: ShopView, ok: (e: ShopEntry) => boolean): ShopEntry => {
  const entry = shop.entries.find((e) => e.lock === null && !e.owned && ok(e))
  expect(entry, 'a seeded shop entry the test can use').toBeDefined()
  return entry!
}

const buy = (itemId: unknown, purchaseId: unknown) =>
  h.app.fastify.inject({ method: 'POST', url: '/api/shop/buy', headers: h.auth(me), payload: { itemId, purchaseId } })

const errorCode = (res: { json: () => unknown }): unknown => (res.json() as { error?: { code?: unknown } }).error?.code

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
})
afterAll(async () => {
  await test.close()
})
// `resetDb` truncates `items` and `shop_prices`; a fresh app re-seeds both at boot (`app.ts`), so each test starts priced.
beforeEach(async () => {
  h = await buildTestApp(db)
  me = await h.register()
})
afterEach(async () => {
  await h.app.close()
  await resetDb(db)
})

describe('the shop routes', () => {
  it('GET /api/shop needs a session', async () => {
    const anonymous = await h.app.fastify.inject({ url: '/api/shop' })
    expect(anonymous.statusCode).toBe(401)

    const shop = await view()
    expect(shop.entries.length).toBeGreaterThan(0)
    expect(shop.featured.length).toBeLessThanOrEqual(6)
    expect(shop.me.balance).toBe(ECONOMY.startingBalance)
    expect(shop.me.ranks.length).toBeGreaterThan(0)
  })

  it('a buy returns the new balance and a second identical buy is repeated', async () => {
    const shop = await view()
    const item = pick(shop, (e) => e.minRank <= shop.me.rank && e.price > 0 && e.price <= shop.me.balance)

    const first = await buy(item.itemId, PURCHASE_A)
    expect(first.statusCode).toBe(200)
    expect(first.json()).toEqual({ balance: ECONOMY.startingBalance - item.price, itemId: item.itemId, repeated: false })

    const again = await buy(item.itemId, PURCHASE_A)
    expect(again.statusCode).toBe(200)
    expect(again.json()).toEqual({ balance: ECONOMY.startingBalance - item.price, itemId: item.itemId, repeated: true })
    expect(await h.app.services.repos.balances.get(me.playerId)).toBe(ECONOMY.startingBalance - item.price)

    // A new click on what is now owned is the ALREADY_OWNED refusal, not another charge.
    const owned = await buy(item.itemId, PURCHASE_B)
    expect(owned.statusCode).toBe(409)
    expect(errorCode(owned)).toBe('ALREADY_OWNED')
  })

  it('a bad purchaseId is 400', async () => {
    const shop = await view()
    const item = pick(shop, (e) => e.minRank <= shop.me.rank && e.price <= shop.me.balance)
    for (const purchaseId of ['', 'click-1', PURCHASE_A.toUpperCase(), `${PURCHASE_A}0`, 42, null, undefined]) {
      const res = await buy(item.itemId, purchaseId)
      expect(res.statusCode, String(purchaseId)).toBe(400)
      expect(errorCode(res), String(purchaseId)).toBe('BAD_REQUEST')
    }
    const noItem = await buy(42, PURCHASE_A)
    expect(noItem.statusCode).toBe(400)
    expect(errorCode(noItem)).toBe('BAD_REQUEST')
    expect(await h.app.services.repos.balances.get(me.playerId)).toBe(ECONOMY.startingBalance)
  })

  it('a refusal is 409 with its code', async () => {
    const shop = await view()
    const item = pick(shop, (e) => e.minRank > shop.me.rank)
    const res = await buy(item.itemId, PURCHASE_A)
    expect(res.statusCode).toBe(409)
    expect(errorCode(res)).toBe('RANK_TOO_LOW')
    expect(await h.app.services.repos.balances.get(me.playerId)).toBe(ECONOMY.startingBalance)
  })

  it('an item off sale is 409 SHOP_DISABLED', async () => {
    const shop = await view()
    const item = pick(shop, (e) => e.minRank <= shop.me.rank && e.price <= shop.me.balance)
    await db.update(shopPrices).set({ enabled: false }).where(eq(shopPrices.itemId, item.itemId))
    const res = await buy(item.itemId, PURCHASE_A)
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: { code: 'SHOP_DISABLED', message: 'this item is not on sale' } })
    expect(await h.app.services.repos.balances.get(me.playerId)).toBe(ECONOMY.startingBalance)
  })

  it('a price above the balance is 409 INSUFFICIENT_POINTS', async () => {
    const shop = await view()
    const item = pick(shop, (e) => e.minRank <= shop.me.rank && e.price > 0)
    await db.update(players).set({ balance: item.price - 1 }).where(eq(players.id, me.playerId))
    const res = await buy(item.itemId, PURCHASE_A)
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: { code: 'INSUFFICIENT_POINTS', message: 'not enough points for this item' } })
    expect(await h.app.services.repos.balances.get(me.playerId)).toBe(item.price - 1)
  })

  it('a purchaseId replayed after its item was taken back is 409 PURCHASE_UNDONE, with its own message', async () => {
    const shop = await view()
    const item = pick(shop, (e) => e.minRank <= shop.me.rank && e.price > 0 && e.price <= shop.me.balance)
    expect((await buy(item.itemId, PURCHASE_A)).statusCode).toBe(200)
    await db.delete(inventory).where(and(eq(inventory.playerId, me.playerId), eq(inventory.itemId, item.itemId)))
    const res = await buy(item.itemId, PURCHASE_A)
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: { code: 'PURCHASE_UNDONE', message: 'this purchase was undone; a new purchase buys the item again' } })
    expect(await h.app.services.repos.balances.get(me.playerId)).toBe(ECONOMY.startingBalance - item.price)
  })

  it('an unknown item is 404', async () => {
    const res = await buy('hat_that_never_was', PURCHASE_A)
    expect(res.statusCode).toBe(404)
    expect(errorCode(res)).toBe('UNKNOWN_ITEM')
  })
})
