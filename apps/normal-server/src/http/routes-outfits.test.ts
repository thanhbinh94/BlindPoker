/**
 * Five saved outfits per player, over HTTP.
 *
 * `outfits-service.test.ts` covers the rules against PGlite directly; what is checked here is the
 * translation this route layer does on top — auth, the CSRF guard, `validateAvatarConfig` running
 * before the service ever sees a body, and the status/code each `ServiceError` becomes — the same
 * split `routes-rewards.test.ts` draws for the economy service.
 */
import { and, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { createTestDb, type TestDb } from '../db/test-db.js'
import { avatarOutfits, inventory as inventoryTable, players } from '../db/schema.js'
import { buildTestApp, resetDb, XRW, type Account, type Harness } from '../test-harness.js'

let test: TestDb
let db: AppDb
let h: Harness
let me: Account

const code = (res: { json(): unknown }): string => (res.json() as { error: { code: string } }).error.code

/** `outfit_casual01` is the one item every fresh account already owns; the bob is free. */
const CASUAL = { v: 4, gender: 'f', hairStyle: 'hair_f_bob01', outfit: 'outfit_casual01' }
/** Owned by nobody at registration — the item `save`/`apply` must refuse. */
const DRESSED = { v: 4, gender: 'm', hairStyle: 'hair_m_neat01', outfit: 'outfit_dealer01', head: 'head_beret_red01' }
/** A saved outfit from before Plan 19, as the table still holds it, and the v4 it reads as (table 4.5). */
const STORED_V3_M02 = { v: 3, base: 'm02', outfit: 'outfit_casual01' }
const READ_V3_M02 = { v: 4, gender: 'm', hairStyle: 'hair_m_neat01', outfit: 'outfit_casual01', skinColor: 'skin_fair01', eyeColor: 'eyecolor_grey01' }

async function own(...itemIds: string[]): Promise<void> {
  await h.db.transaction(async (tx) => {
    for (const itemId of itemIds) await h.app.services.inventory.grant(tx, me.playerId, itemId, 'test')
  })
}

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
})
afterAll(async () => {
  await test.close()
})
beforeEach(async () => {
  h = await buildTestApp(db)
  me = await h.register()
})
afterEach(async () => {
  await h.app.close()
  await resetDb(db)
})

describe('GET /api/me/outfits', () => {
  it('answers a fresh account with five empty slots', async () => {
    const res = await h.app.fastify.inject({ url: '/api/me/outfits', headers: { cookie: me.cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ outfits: [null, null, null, null, null] })
  })

  it('401s a caller with no session', async () => {
    const res = await h.app.fastify.inject('/api/me/outfits')
    expect(res.statusCode).toBe(401)
    expect(code(res)).toBe('UNAUTHENTICATED')
  })

  it('lists an outfit saved before Plan 19 as the v4 it reads as, without rewriting the row (spec §4.5, R6)', async () => {
    await db.insert(avatarOutfits).values({ playerId: me.playerId, slot: 2, name: 'Old', config: STORED_V3_M02 })

    const res = await h.app.fastify.inject({ url: '/api/me/outfits', headers: { cookie: me.cookie } })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { outfits: unknown[] }).outfits[1]).toMatchObject({ slot: 2, name: 'Old', config: READ_V3_M02 })

    const [row] = await db.select({ config: avatarOutfits.config }).from(avatarOutfits).where(eq(avatarOutfits.playerId, me.playerId))
    expect(row!.config).toEqual(STORED_V3_M02)
  })
})

describe('PUT /api/me/outfits/:slot', () => {
  it('saves a config the player owns and lists it back at the right slot', async () => {
    const res = await h.app.fastify.inject({ method: 'PUT', url: '/api/me/outfits/2', headers: h.auth(me), payload: { name: 'Weekend', config: CASUAL } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ slot: 2, name: 'Weekend', config: CASUAL })

    const list = await h.app.fastify.inject({ url: '/api/me/outfits', headers: { cookie: me.cookie } })
    const outfits = (list.json() as { outfits: (unknown | null)[] }).outfits
    expect(outfits[0]).toBeNull()
    expect(outfits[1]).toMatchObject({ slot: 2, name: 'Weekend' })
  })

  it('400s a slot outside 1..5, without touching the database', async () => {
    const res = await h.app.fastify.inject({ method: 'PUT', url: '/api/me/outfits/0', headers: h.auth(me), payload: { name: 'x', config: CASUAL } })
    expect(res.statusCode).toBe(400)
    expect(code(res)).toBe('INVALID_SLOT')
  })

  it('400s an empty or over-long name with INVALID_NAME', async () => {
    for (const name of ['', '   ', 'x'.repeat(25)]) {
      const res = await h.app.fastify.inject({ method: 'PUT', url: '/api/me/outfits/1', headers: h.auth(me), payload: { name, config: CASUAL } })
      expect(res.statusCode, JSON.stringify(name)).toBe(400)
      expect(code(res), JSON.stringify(name)).toBe('INVALID_NAME')
    }
  })

  it('runs the same avatar validation PUT /api/me/avatar does, before the service ever sees the body', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ v: 3, base: 'f01', outfit: 'outfit_casual01' }, 'MISSING_LAYER'],
      [{ ...CASUAL, base: 'robot' }, 'INVALID_BASE'],
      [{ ...CASUAL, hairStyle: 'hair_m_neat01' }, 'WRONG_GENDER'],
    ]
    for (const [config, expected] of cases) {
      const res = await h.app.fastify.inject({ method: 'PUT', url: '/api/me/outfits/1', headers: h.auth(me), payload: { name: 'Broken', config } })
      expect(res.statusCode, expected).toBe(400)
      expect(code(res), expected).toBe(expected)
    }
    const list = await h.app.fastify.inject({ url: '/api/me/outfits', headers: { cookie: me.cookie } })
    expect(list.json()).toEqual({ outfits: [null, null, null, null, null] })
  })

  it('403s a config naming an item the player does not own', async () => {
    const res = await h.app.fastify.inject({ method: 'PUT', url: '/api/me/outfits/1', headers: h.auth(me), payload: { name: 'Fancy', config: DRESSED } })
    expect(res.statusCode).toBe(403)
    expect(code(res)).toBe('ITEM_NOT_OWNED')
  })

  it('401s a caller with no session and 403s one without the CSRF header', async () => {
    const noSession = await h.app.fastify.inject({ method: 'PUT', url: '/api/me/outfits/1', headers: XRW, payload: { name: 'x', config: CASUAL } })
    expect(noSession.statusCode).toBe(401)
    const noHeader = await h.app.fastify.inject({ method: 'PUT', url: '/api/me/outfits/1', headers: { cookie: me.cookie }, payload: { name: 'x', config: CASUAL } })
    expect(noHeader.statusCode).toBe(403)
    expect(code(noHeader)).toBe('FORBIDDEN')
  })
})

describe('DELETE /api/me/outfits/:slot', () => {
  it('answers true once and false the second time', async () => {
    await h.app.fastify.inject({ method: 'PUT', url: '/api/me/outfits/3', headers: h.auth(me), payload: { name: 'Gone soon', config: CASUAL } })

    const first = await h.app.fastify.inject({ method: 'DELETE', url: '/api/me/outfits/3', headers: h.auth(me) })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toEqual({ removed: true })

    const second = await h.app.fastify.inject({ method: 'DELETE', url: '/api/me/outfits/3', headers: h.auth(me) })
    expect(second.json()).toEqual({ removed: false })
  })

  it('400s a slot outside 1..5', async () => {
    const res = await h.app.fastify.inject({ method: 'DELETE', url: '/api/me/outfits/6', headers: h.auth(me) })
    expect(res.statusCode).toBe(400)
    expect(code(res)).toBe('INVALID_SLOT')
  })
})

describe('POST /api/me/outfits/:slot/apply', () => {
  it('applies the saved config as the avatar and returns it', async () => {
    await own('outfit_dealer01', 'head_beret_red01')
    await h.app.fastify.inject({ method: 'PUT', url: '/api/me/outfits/4', headers: h.auth(me), payload: { name: 'Gala', config: DRESSED } })

    const res = await h.app.fastify.inject({ method: 'POST', url: '/api/me/outfits/4/apply', headers: h.auth(me) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ config: DRESSED })

    const me2 = await h.app.fastify.inject({ url: '/api/me', headers: { cookie: me.cookie } })
    expect((me2.json() as { avatar: unknown }).avatar).toEqual(DRESSED)
  })

  it('applies an outfit saved before Plan 19 as the v4 it reads as, and stores that v4 (R6)', async () => {
    await db.insert(avatarOutfits).values({ playerId: me.playerId, slot: 3, name: 'Old', config: STORED_V3_M02 })

    const res = await h.app.fastify.inject({ method: 'POST', url: '/api/me/outfits/3/apply', headers: h.auth(me) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ config: READ_V3_M02 })

    // The player's own column receives v4 — never the old base the saved row still names.
    const [row] = await db.select({ config: players.avatarConfig }).from(players).where(eq(players.id, me.playerId))
    expect(row!.config).toEqual(READ_V3_M02)
  })

  it('404s an empty slot', async () => {
    const res = await h.app.fastify.inject({ method: 'POST', url: '/api/me/outfits/1/apply', headers: h.auth(me) })
    expect(res.statusCode).toBe(404)
    expect(code(res)).toBe('NOT_FOUND')
  })

  it('re-checks ownership rather than trusting the save', async () => {
    await own('outfit_dealer01', 'head_beret_red01')
    await h.app.fastify.inject({ method: 'PUT', url: '/api/me/outfits/4', headers: h.auth(me), payload: { name: 'Gala', config: DRESSED } })

    // Nothing in this server actually removes an owned item today, but the route must not assume
    // that stays true: the check happens again at apply time, not only at save time.
    await db.delete(inventoryTable).where(and(eq(inventoryTable.playerId, me.playerId), eq(inventoryTable.itemId, 'outfit_dealer01')))

    const res = await h.app.fastify.inject({ method: 'POST', url: '/api/me/outfits/4/apply', headers: h.auth(me) })
    expect(res.statusCode).toBe(403)
    expect(code(res)).toBe('ITEM_NOT_OWNED')
  })
})

describe('round trip', () => {
  it('saves, lists, applies and deletes one outfit end to end', async () => {
    const save = await h.app.fastify.inject({ method: 'PUT', url: '/api/me/outfits/1', headers: h.auth(me), payload: { name: '  Everyday  ', config: CASUAL } })
    expect(save.statusCode).toBe(200)
    expect(save.json()).toMatchObject({ slot: 1, name: 'Everyday', config: CASUAL })

    const list = await h.app.fastify.inject({ url: '/api/me/outfits', headers: { cookie: me.cookie } })
    expect((list.json() as { outfits: unknown[] }).outfits[0]).toMatchObject({ name: 'Everyday' })

    const apply = await h.app.fastify.inject({ method: 'POST', url: '/api/me/outfits/1/apply', headers: h.auth(me) })
    expect(apply.json()).toEqual({ config: CASUAL })

    const remove = await h.app.fastify.inject({ method: 'DELETE', url: '/api/me/outfits/1', headers: h.auth(me) })
    expect(remove.json()).toEqual({ removed: true })
  })
})
