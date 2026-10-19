/**
 * The player's own surface, against the real `buildApp` on a throwaway PGlite.
 *
 * Every test here goes through `fastify.inject`, which means through the cookie plugin, the CSRF
 * guard, `requireUser` and the error handler — the same path a browser takes. A route tested against
 * a bare Fastify instance would pass while the assembled server answered 403 or 500.
 */
import { ECONOMY } from '@bp/core'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { createTestDb, type TestDb } from '../db/test-db.js'
import { inventory, items, players, users } from '../db/schema.js'
import { buildTestApp, resetDb, XRW, type Account, type Harness } from '../test-harness.js'

/** What a fresh account is wearing (spec §4.1): the female body, her default bob and the one default outfit. */
const DEFAULT_AVATAR = { v: 4, gender: 'f', hairStyle: 'hair_f_bob01', outfit: 'outfit_casual01' }
/** An old account's stored v3 config, and the v4 it reads as (table 4.5, with the eye rule on the shipped bodies). */
const STORED_V3_M02 = { v: 3, base: 'm02', outfit: 'outfit_casual01' }
const READ_V3_M02 = { v: 4, gender: 'm', hairStyle: 'hair_m_neat01', outfit: 'outfit_casual01', skinColor: 'skin_fair01', eyeColor: 'eyecolor_grey01' }
const SECOND = { email: 'mai@example.com', password: 'another good password', displayName: 'Mai Lan' }

let test: TestDb
let db: AppDb
let h: Harness
let me: Account

const code = (res: { json(): unknown }): string => (res.json() as { error: { code: string } }).error.code

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

describe('GET /api/me', () => {
  it('answers the profile, the cosmetics and both reward statuses in one body', async () => {
    const res = await h.app.fastify.inject({ url: '/api/me', headers: { cookie: me.cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      playerId: me.playerId,
      displayName: 'Bình An',
      email: 'binh@example.com',
      balance: ECONOMY.startingBalance,
      avatar: DEFAULT_AVATAR,
      // The Lite-shaped summary: both modes folded together, which is what the shared player bar draws.
      stats: { handsPlayed: 0, handsWon: 0 },
      daily: { claimable: true, day: 1, streak: 1 },
      relief: { eligible: false, reason: 'balance', threshold: ECONOMY.reliefThreshold, target: ECONOMY.reliefTarget },
      // Registration does not sign in through `login`, so there is no last-login stamp yet.
      lastLoginAt: null,
    })
    expect((res.json() as { createdAt: number }).createdAt).toBeGreaterThan(0)
  })

  it('reports the account role, read from the database on each request', async () => {
    expect((await h.app.fastify.inject({ url: '/api/me', headers: { cookie: me.cookie } })).json()).toMatchObject({ role: 'player' })
    await db.update(users).set({ role: 'gm' }).where(eq(users.id, me.playerId))
    expect((await h.app.fastify.inject({ url: '/api/me', headers: { cookie: me.cookie } })).json()).toMatchObject({ role: 'gm' })
  })

  it('refuses a request with no cookie, a stale one, or a cookie for a revoked session', async () => {
    const none = await h.app.fastify.inject('/api/me')
    expect(none.statusCode).toBe(401)
    expect(code(none)).toBe('UNAUTHENTICATED')

    const bogus = await h.app.fastify.inject({ url: '/api/me', headers: { cookie: 'bp_session=not-a-token' } })
    expect(bogus.statusCode).toBe(401)

    await h.app.fastify.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: me.cookie, ...XRW } })
    const revoked = await h.app.fastify.inject({ url: '/api/me', headers: { cookie: me.cookie } })
    expect(revoked.statusCode).toBe(401)
  })

  it('reports the last sign-in once the account has actually signed in', async () => {
    const login = await h.app.fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: XRW,
      payload: { email: 'binh@example.com', password: 'a good password' },
    })
    expect(login.statusCode).toBe(200)
    const res = await h.app.fastify.inject({ url: '/api/me', headers: { cookie: me.cookie } })
    expect((res.json() as { lastLoginAt: number | null }).lastLoginAt).toBeGreaterThan(0)
  })
})

describe('PATCH /api/me', () => {
  it('renames the player', async () => {
    const res = await h.app.fastify.inject({ method: 'PATCH', url: '/api/me', headers: h.auth(me), payload: { displayName: 'Bình  An  2' } })
    expect(res.statusCode).toBe(200)
    // Normalized by `@bp/core` before it is stored: runs of whitespace collapse to one space.
    expect(res.json()).toEqual({ playerId: me.playerId, displayName: 'Bình An 2' })
    const after = await h.app.fastify.inject({ url: '/api/me', headers: { cookie: me.cookie } })
    expect((after.json() as { displayName: string }).displayName).toBe('Bình An 2')
  })

  it('refuses a malformed or missing name with INVALID_NAME', async () => {
    for (const displayName of ['x', 'x'.repeat(21), '.Alice', 'Al<b>ice', 42, undefined]) {
      const res = await h.app.fastify.inject({ method: 'PATCH', url: '/api/me', headers: h.auth(me), payload: { displayName } })
      expect(res.statusCode, String(displayName)).toBe(400)
      expect(code(res)).toBe('INVALID_NAME')
    }
  })

  it('refuses a name another player already holds, folded case included', async () => {
    await h.register(SECOND)
    const res = await h.app.fastify.inject({ method: 'PATCH', url: '/api/me', headers: h.auth(me), payload: { displayName: 'mai lan' } })
    expect(res.statusCode).toBe(409)
    expect(code(res)).toBe('DISPLAY_NAME_TAKEN')
  })

  it('refuses a mutating request without X-Requested-With', async () => {
    const res = await h.app.fastify.inject({ method: 'PATCH', url: '/api/me', headers: { cookie: me.cookie }, payload: { displayName: 'Anything' } })
    expect(res.statusCode).toBe(403)
    expect(code(res)).toBe('FORBIDDEN')
  })
})

describe('GET /api/me/stats and /api/me/history', () => {
  it('answer a fresh account with zeroed counters and no hands', async () => {
    const stats = await h.app.fastify.inject({ url: '/api/me/stats', headers: { cookie: me.cookie } })
    expect(stats.statusCode).toBe(200)
    expect(stats.json()).toMatchObject({ handsPlayedHoldem: 0, handsWonBlind: 0, bestWinStreak: 0, totalLoginDays: 0 })

    const history = await h.app.fastify.inject({ url: '/api/me/history?limit=5', headers: { cookie: me.cookie } })
    expect(history.statusCode).toBe(200)
    expect(history.json()).toEqual([])
  })
})

describe('GET /api/me/ledger', () => {
  it('lists the account opening credit and pages on the row id', async () => {
    const res = await h.app.fastify.inject({ url: '/api/me/ledger', headers: { cookie: me.cookie } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { entries: { id: number; amount: number; reason: string; createdAt: number }[]; nextBefore: number | null }
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0]).toMatchObject({ amount: ECONOMY.startingBalance, reason: 'starting_balance' })
    expect(body.entries[0]?.createdAt).toBeGreaterThan(0)
    // A short page is the end of the history, so there is nothing to ask for next.
    expect(body.nextBefore).toBeNull()

    // A full page hands back a cursor, and the page after it is empty.
    const paged = await h.app.fastify.inject({ url: '/api/me/ledger?limit=1', headers: { cookie: me.cookie } })
    const first = paged.json() as { nextBefore: number | null }
    expect(first.nextBefore).toBe(body.entries[0]?.id)
    const next = await h.app.fastify.inject({ url: `/api/me/ledger?limit=1&before=${String(first.nextBefore)}`, headers: { cookie: me.cookie } })
    expect((next.json() as { entries: unknown[] }).entries).toEqual([])
  })

  it('folds a nonsense limit back to the default rather than reaching the driver', async () => {
    const res = await h.app.fastify.inject({ url: '/api/me/ledger?limit=abc&before=xyz', headers: { cookie: me.cookie } })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { entries: unknown[] }).entries).toHaveLength(1)
  })
})

describe('inventory and avatars', () => {
  it('lists what a new account owns, joined against the catalogue, with the avatar it is wearing', async () => {
    const res = await h.app.fastify.inject({ url: '/api/me/inventory', headers: { cookie: me.cookie } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { items: { itemId: string; slot: string; source: string }[]; avatar: unknown }
    // A fresh account: the one granted default plus every `free` colour, variant, hairstyle and skin colour
    // (design §3.2, A3) — owned by everyone without a row, and always listed.
    const granted = body.items.filter((i) => i.source !== 'free')
    expect(granted.map((i) => i.itemId)).toEqual(['outfit_casual01'])
    const free = body.items.filter((i) => i.source === 'free')
    expect(free.length).toBe(32)
    expect(free.map((i) => i.itemId)).toContain('haircolor_black01')
    expect(body.items.find((i) => i.itemId === 'hair_f_bob01')).toMatchObject({ slot: 'hairStyle', source: 'free' })
    expect(body.items.find((i) => i.itemId === 'skin_deep01')).toMatchObject({ slot: 'skinColor', source: 'free' })
    // Joined against the catalogue.
    expect(body.items.find((i) => i.itemId === 'outfit_casual01')).toMatchObject({ slot: 'outfit', rarity: 'common', assetKey: 'outfit/outfit_casual01' })
    expect(body.items.find((i) => i.itemId === 'haircolor_black01')).toMatchObject({ slot: 'hairColor', rarity: 'common', source: 'free' })
    expect(body.avatar).toEqual(DEFAULT_AVATAR)
  })

  it('resolves a legacy row through the alias map, joins the catalogue against its current id, and keeps the old id as acquiredAs', async () => {
    // `inventory.item_id` rows are never rewritten — a player who owns this from before Plan 11 is
    // exactly as real as one who owns `head_crown_gold01` outright, and the route must say so. `hat_crown`
    // is no longer in `items.json` (nothing seeds it), so a legacy row like this only exists because the
    // `items` row itself already existed before Plan 11 dropped the id from the catalogue — reproduced
    // here by inserting it directly, the way a pre-existing production row would already be there.
    await db.insert(items).values({ id: 'hat_crown', slot: 'hat', rarity: 'epic', nameKey: 'items.hat_crown', assetKey: 'hat/hat_crown' })
    await db.insert(inventory).values({ playerId: me.playerId, itemId: 'hat_crown', source: 'grant' })
    const res = await h.app.fastify.inject({ url: '/api/me/inventory', headers: { cookie: me.cookie } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { items: { itemId: string; acquiredAs: string; slot: string | null; rarity: string | null }[] }
    const row = body.items.find((i) => i.acquiredAs === 'hat_crown')
    expect(row).toMatchObject({ itemId: 'head_crown_gold01', slot: 'head', rarity: 'epic' })
    // Not left under the raw, un-resolved id — a wardrobe joining on `itemId` alone must find it.
    expect(body.items.find((i) => i.itemId === 'hat_crown')).toBeUndefined()
  })

  it('collapses a player who owns both the old and the new id into one entry', async () => {
    await db.insert(items).values({ id: 'hat_crown', slot: 'hat', rarity: 'epic', nameKey: 'items.hat_crown', assetKey: 'hat/hat_crown' })
    await db.insert(inventory).values([
      { playerId: me.playerId, itemId: 'hat_crown', source: 'grant' },
      { playerId: me.playerId, itemId: 'head_crown_gold01', source: 'grant' },
    ])
    const res = await h.app.fastify.inject({ url: '/api/me/inventory', headers: { cookie: me.cookie } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { items: { itemId: string }[] }
    expect(body.items.filter((i) => i.itemId === 'head_crown_gold01')).toHaveLength(1)
  })

  it('stores a full replacement and reads it back', async () => {
    // The gender is chosen, not owned, and every hairstyle and skin colour is free (spec §4.1–4.3), so
    // switching all three needs no grant — a real change the player can always make, which is what
    // distinguishes "stored" from "nothing moved".
    const config = { ...DEFAULT_AVATAR, gender: 'm', hairStyle: 'hair_m_tousled01', skinColor: 'skin_deep01' }
    const res = await h.app.fastify.inject({ method: 'PUT', url: '/api/me/avatar', headers: h.auth(me), payload: config })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ config })
    const me2 = await h.app.fastify.inject({ url: '/api/me', headers: { cookie: me.cookie } })
    expect((me2.json() as { avatar: unknown }).avatar).toEqual(config)
  })

  it('reads an old account’s stored v3 config as the v4 of table 4.5, on every route that answers an avatar, without rewriting it', async () => {
    await db.update(players).set({ avatarConfig: STORED_V3_M02 }).where(eq(players.id, me.playerId))

    const profile = await h.app.fastify.inject({ url: '/api/me', headers: { cookie: me.cookie } })
    expect((profile.json() as { avatar: unknown }).avatar).toEqual(READ_V3_M02)
    const wardrobe = await h.app.fastify.inject({ url: '/api/me/inventory', headers: { cookie: me.cookie } })
    expect((wardrobe.json() as { avatar: unknown }).avatar).toEqual(READ_V3_M02)
    const seat = await h.app.fastify.inject({ url: `/api/players/${me.playerId}/avatar`, headers: { cookie: me.cookie } })
    expect((seat.json() as { avatar: unknown }).avatar).toEqual(READ_V3_M02)

    // Repaired on the way out only: the column is rewritten when the player saves, never by a read (spec §4.5).
    const [row] = await db.select({ config: players.avatarConfig }).from(players).where(eq(players.id, me.playerId))
    expect(row!.config).toEqual(STORED_V3_M02)
  })

  it('refuses a malformed configuration with the code that says what was wrong', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ ...DEFAULT_AVATAR, outfit: undefined }, 'MISSING_LAYER'],
      // A v1/v2 body: the shapes this route used to accept and now refuses outright.
      [{ base: 'base_01', face: 'face_01', clothing: 'clothing_tee', hair: 'hair_short', hairColor: '#2b2b2b' }, 'MISSING_LAYER'],
      // A v3 body — what the wire spoke until Plan 19 — is refused the same way: a client still sending it is stale.
      [{ v: 3, base: 'f01', outfit: 'outfit_casual01' }, 'MISSING_LAYER'],
      [{ ...DEFAULT_AVATAR, gender: undefined }, 'MISSING_LAYER'],
      [{ ...DEFAULT_AVATAR, hairStyle: undefined }, 'MISSING_LAYER'],
      [{ ...DEFAULT_AVATAR, base: 'robot' }, 'INVALID_BASE'],
      [{ ...DEFAULT_AVATAR, outfit: 'no_such_item' }, 'INVALID_ITEM'],
      [{ ...DEFAULT_AVATAR, outfit: 'title_rookie' }, 'WRONG_CATEGORY'],
      [{ ...DEFAULT_AVATAR, hairStyle: 'hair_m_neat01' }, 'WRONG_GENDER'],
    ]
    for (const [payload, expected] of cases) {
      const res = await h.app.fastify.inject({ method: 'PUT', url: '/api/me/avatar', headers: h.auth(me), payload })
      expect(res.statusCode, expected).toBe(400)
      expect(code(res)).toBe(expected)
    }
  })

  it('refuses an item the player does not own with 403 NOT_OWNED', async () => {
    const res = await h.app.fastify.inject({ method: 'PUT', url: '/api/me/avatar', headers: h.auth(me), payload: { ...DEFAULT_AVATAR, outfit: 'outfit_dealer01' } })
    expect(res.statusCode).toBe(403)
    expect(code(res)).toBe('NOT_OWNED')
    const after = await h.app.fastify.inject({ url: '/api/me', headers: { cookie: me.cookie } })
    expect((after.json() as { avatar: { outfit: string } }).avatar.outfit).toBe('outfit_casual01')
  })

  it('wears a free colour on a fresh account with no grant needed (design §3.2)', async () => {
    const config = { ...DEFAULT_AVATAR, hairColor: 'haircolor_black01', eyeColor: 'eyecolor_brown01' }
    const res = await h.app.fastify.inject({ method: 'PUT', url: '/api/me/avatar', headers: h.auth(me), payload: config })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ config })
  })

  it('refuses a rare colour the player does not own with 403 NOT_OWNED', async () => {
    const res = await h.app.fastify.inject({ method: 'PUT', url: '/api/me/avatar', headers: h.auth(me), payload: { ...DEFAULT_AVATAR, hairColor: 'haircolor_pink01' } })
    expect(res.statusCode).toBe(403)
    expect(code(res)).toBe('NOT_OWNED')
  })
})

describe('GET /api/players/:id/avatar', () => {
  it('answers another player, privately cacheable', async () => {
    const other = await h.register(SECOND)
    const res = await h.app.fastify.inject({ url: `/api/players/${other.playerId}/avatar`, headers: { cookie: me.cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ playerId: other.playerId, displayName: 'Mai Lan', avatar: DEFAULT_AVATAR })
    expect(res.headers['cache-control']).toBe('private, max-age=60')
  })

  it('404s an unknown id — a malformed one included — and 401s a caller with no session', async () => {
    for (const id of ['11111111-1111-4111-8111-111111111111', 'not-a-uuid']) {
      const res = await h.app.fastify.inject({ url: `/api/players/${id}/avatar`, headers: { cookie: me.cookie } })
      expect(res.statusCode, id).toBe(404)
      expect(code(res)).toBe('NOT_FOUND')
    }
    const anon = await h.app.fastify.inject(`/api/players/${me.playerId}/avatar`)
    expect(anon.statusCode).toBe(401)
  })
})

describe('GET /api/me/achievements', () => {
  it('lists every definition with this player at zero, locked', async () => {
    const res = await h.app.fastify.inject({ url: '/api/me/achievements', headers: { cookie: me.cookie } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { id: string; category: string; metric: string; threshold: number; reward: object; progress: number; unlockedAt: number | null }[]
    expect(body.length).toBe(h.app.services.defs.length)
    expect(body[0]).toMatchObject({ id: expect.any(String), category: expect.any(String), metric: expect.any(String), progress: 0, unlockedAt: null })
    expect(body.every((a) => a.threshold > 0)).toBe(true)
  })
})
