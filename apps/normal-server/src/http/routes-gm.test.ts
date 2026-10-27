/**
 * `/api/gm/*` over HTTP (Plan 25 §5): what this layer adds on top of `gm-service.test.ts` — the guard, the
 * reason checked before any lookup, the status each refusal becomes, and the room routes that reach a live room.
 */
import type { AddressInfo } from 'node:net'
import { ECONOMY, type RoomConfig } from '@bp/core'
import { enumerateRoutes } from '@bp/http-kit/testing'
import { silentLogger } from '@bp/server-kit'
import { TestClient } from '@bp/server-kit/testing'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDb } from '../db/client.js'
import { createTestDb, type TestDb } from '../db/test-db.js'
import { POINTS_CAP } from '../gm/gm-service.js'
import { seedDefaults as seedReputationDefaults } from '../reputation/reputation-service.js'
import { seedConfig as seedShopConfig } from '../shop/shop-prices-seed.js'
import { buildTestApp, GOOD_ACCOUNT, ORIGIN, resetDb, XRW, type Account, type Harness } from '../test-harness.js'

let test: TestDb
let db: AppDb
let h: Harness
let me: Account
let boss: Account
const clients: TestClient[] = []

const code = (res: { json(): unknown }): string => (res.json() as { error: { code: string } }).error.code
const gmReq = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  h.app.fastify.inject({ method, url, headers: h.auth(boss), ...(payload === undefined ? {} : { payload }) })

const PRIVATE_BLIND: RoomConfig = {
  name: 'Phòng riêng', mode: 'blind', maxPlayers: 4, isPrivate: true, password: 'bi-mat', turnTimerSec: 15, autoStart: false,
  blind: { holeCards: 2, decisionMode: 'none', fixedWager: 1_000, botCount: 0 },
}

async function listen(): Promise<string> {
  await h.app.fastify.listen({ port: 0, host: '127.0.0.1' })
  const address = h.app.fastify.server.address() as AddressInfo
  return `ws://127.0.0.1:${String(address.port)}/ws`
}

async function connect(url: string, account: Account): Promise<TestClient> {
  const client = await TestClient.connect(url, { origin: ORIGIN, cookie: account.cookie })
  clients.push(client)
  await client.next('WELCOME')
  return client
}

/** A private blind room with its host seated: the stack has left the balance, so a close has something to give back. */
async function createPrivateBlindAndSit(ws: TestClient): Promise<string> {
  ws.send({ t: 'CREATE_ROOM', config: PRIVATE_BLIND })
  const snapshot = await ws.next('ROOM_SNAPSHOT')
  ws.send({ t: 'SIT_DOWN', seat: 0 })
  await ws.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_SAT')
  return snapshot.room.roomId
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
  boss = await h.register({ email: 'boss@example.com', password: 'a good password', displayName: 'Quản Trị' })
  await db.execute(sql`update users set role = 'gm' where id = ${boss.playerId}`)
})
afterEach(async () => {
  for (const c of clients.splice(0)) c.close()
  await h.app.close()
  await resetDb(db)
})

describe('the guard', () => {
  it('answers 401 to nobody and 403 FORBIDDEN to a player on every /api/gm/ route the app serves', async () => {
    const routes = enumerateRoutes(h.app.fastify).filter((r) => r.path.startsWith('/api/gm/'))
    // The thirty-two `/api/gm/` labels `app.test.ts` pins in the exact surface: a route added there must be guarded here.
    expect(routes).toHaveLength(32)
    for (const route of routes) {
      const url = route.path
        .replace(':id', route.path.startsWith('/api/gm/rooms/') ? 'some-room' : me.playerId)
        .replace(':achievementId', 'login_streak_7')
        .replace(':month', '2026-11')
        .replace(':week', '2026-W40')
      const label = `${route.method} ${route.path}`
      // Every GM route is a GET or a write (`app.test.ts` pins the surface); narrowed for `inject`'s own method type.
      expect(['GET', 'POST', 'PUT', 'DELETE'], label).toContain(route.method)
      const method = route.method as 'GET' | 'POST' | 'PUT' | 'DELETE'
      const write = method !== 'GET'
      // The CSRF header on a write, so the guard — not the CSRF check — is what answers; an empty body is fine,
      // since the guard runs before the handler reads it.
      const anon = await h.app.fastify.inject({ method, url, ...(write ? { headers: XRW, payload: {} } : {}) })
      expect(anon.statusCode, label).toBe(401)
      const res = await h.app.fastify.inject({ method, url, headers: h.auth(me), ...(write ? { payload: {} } : {}) })
      expect(res.statusCode, label).toBe(403)
      expect(code(res), label).toBe('FORBIDDEN')
    }
  })

  it('reports the role on /api/auth/me once promoted', async () => {
    expect((await h.app.fastify.inject({ url: '/api/auth/me', headers: { cookie: me.cookie } })).json()).toMatchObject({ role: 'player' })
    expect((await h.app.fastify.inject({ url: '/api/auth/me', headers: { cookie: boss.cookie } })).json()).toMatchObject({ role: 'gm' })
  })
})

describe('reasons', () => {
  it('every POST without a reason is exactly 400 INVALID_REASON, whatever else the body or the target is', async () => {
    const urls = [
      `/api/gm/players/${me.playerId}/points`,
      `/api/gm/players/${me.playerId}/items`,
      `/api/gm/players/${me.playerId}/lock`,
      `/api/gm/players/${me.playerId}/unlock`,
      `/api/gm/players/${me.playerId}/role`,
      `/api/gm/players/${me.playerId}/achievements/login_streak_7/unlock`,
      `/api/gm/players/${me.playerId}/checkin/reset`,
      `/api/gm/players/${me.playerId}/reputation`,
      '/api/gm/rooms/nope/kick',
      '/api/gm/rooms/nope/close',
    ]
    for (const url of urls) {
      const res = await gmReq('POST', url, { amount: 1, itemId: 'head_tophat01', role: 'gm', playerId: me.playerId })
      expect(res.statusCode, url).toBe(400)
      expect(code(res), url).toBe('INVALID_REASON')
    }
    // Too short is the same refusal.
    const short = await gmReq('POST', `/api/gm/players/${me.playerId}/lock`, { reason: 'ab' })
    expect(code(short)).toBe('INVALID_REASON')
  })
})

describe('the gift schedule', () => {
  // START is 4 September 2026 in the test economy: October is a later month, September the current one.
  it('the two writes, a PUT and a DELETE, are also 400 INVALID_REASON without a reason, before the month is looked at', async () => {
    for (const method of ['PUT', 'DELETE'] as const) {
      for (const url of ['/api/gm/gifts/2026-10', '/api/gm/gifts/not-a-month']) {
        const res = await gmReq(method, url, { days: {} })
        expect(res.statusCode, `${method} ${url}`).toBe(400)
        expect(code(res), `${method} ${url}`).toBe('INVALID_REASON')
      }
    }
  })

  it('lists the default and thirteen months, sets one, shows it from the database, clears it, and logs both', async () => {
    const before = await gmReq('GET', '/api/gm/gifts')
    expect(before.statusCode).toBe(200)
    const listed = before.json() as { default: Record<string, unknown>; months: { month: string; source: string }[] }
    expect(Object.keys(listed.default)).toEqual(['7', '14', '21', '28'])
    expect(listed.months).toHaveLength(13)
    expect(listed.months[0]).toMatchObject({ month: '2026-09', source: 'file' })

    const days = { '14': { fixed: ['aura_ice01'] } }
    const put = await gmReq('PUT', '/api/gm/gifts/2026-10', { days, reason: 'quà tháng mười' })
    expect(put.statusCode).toBe(200)
    expect(put.json()).toEqual({ actionId: expect.any(Number) })
    const after = (await gmReq('GET', '/api/gm/gifts')).json() as { months: { month: string; source: string; days: unknown }[] }
    expect(after.months.find((m) => m.month === '2026-10')).toMatchObject({ source: 'db', days })

    const del = await gmReq('DELETE', '/api/gm/gifts/2026-10', { reason: 'bỏ quà tháng mười' })
    expect(del.statusCode).toBe(200)
    expect(del.json()).toEqual({ actionId: expect.any(Number) })
    const log = (await gmReq('GET', '/api/gm/actions')).json().actions as { action: string; details: unknown; target: unknown }[]
    expect(log.slice(0, 2)).toMatchObject([
      { action: 'clear_gift_month', target: null, details: { month: '2026-10' } },
      { action: 'set_gift_month', target: null, details: { month: '2026-10', days } },
    ])
  })

  it('answers INVALID_MONTH, INVALID_GIFTS with the parser’s words, MONTH_IN_PAST, TIER_LOCKED and NOTHING_TO_CLEAR with their statuses', async () => {
    const put = (month: string, days: unknown) => gmReq('PUT', `/api/gm/gifts/${month}`, { days, reason: 'thử các lỗi' })
    for (const bad of ['2026-13', '2026-1', '26-10', 'tháng']) {
      const res = await put(bad, {})
      expect([res.statusCode, code(res)], bad).toEqual([400, 'INVALID_MONTH'])
    }
    const gifts = await put('2026-10', { '28': { fixed: ['no_such_item'] } })
    expect([gifts.statusCode, code(gifts)]).toEqual([400, 'INVALID_GIFTS'])
    expect((gifts.json() as { error: { message: string } }).error.message).toContain('no_such_item')
    // Days is a field the body must carry: without it the candidate is not an object.
    expect(code(await gmReq('PUT', '/api/gm/gifts/2026-10', { reason: 'thiếu days' }))).toBe('INVALID_GIFTS')

    const past = await put('2026-08', {})
    expect([past.statusCode, code(past)]).toEqual([409, 'MONTH_IN_PAST'])
    const locked = await put('2026-09', { '3': { draw: 'rare' } })
    expect([locked.statusCode, code(locked)]).toEqual([409, 'TIER_LOCKED'])
    const nothing = await gmReq('DELETE', '/api/gm/gifts/2026-10', { reason: 'không có gì để bỏ' })
    expect([nothing.statusCode, code(nothing)]).toEqual([409, 'NOTHING_TO_CLEAR'])
    const badMonth = await gmReq('DELETE', '/api/gm/gifts/2026-13', { reason: 'tháng sai' })
    expect([badMonth.statusCode, code(badMonth)]).toEqual([400, 'INVALID_MONTH'])

    // None of the refusals wrote a line.
    const log = (await gmReq('GET', '/api/gm/actions')).json().actions as unknown[]
    expect(log).toEqual([])
  })
})

describe('the shop and reputation (Plan 27 B4)', () => {
  /** The config tables `resetDb` leaves alone go back to their seeds. */
  afterEach(async () => {
    await db.execute(sql`delete from reputation_rules`)
    await db.execute(sql`delete from reputation_ranks`)
    await db.execute(sql`delete from shop_config where key = 'welcome_choices'`)
    await seedReputationDefaults(db)
    await seedShopConfig(db)
    // The rows went back behind the service's back: drop its few-second cache too, so nothing after reads the old ones.
    h.app.services.reputation.invalidate()
  })

  interface ShopConfigBody {
    prices: { itemId: string; slot: string; lock: unknown; priced: boolean; pricePoints: number }[]
    featured: { weekKey: string; itemIds: string[]; source: string }[]
    welcomeChoices: string[]
    welcomeSlots: string[]
    reputation: { rules: Record<string, number>; ranks: { rank: number; threshold: number }[] }
  }
  const config = async (): Promise<ShopConfigBody> => (await gmReq('GET', '/api/gm/shop')).json() as ShopConfigBody

  it('every write is 400 INVALID_REASON without a reason, before its body or week is looked at', async () => {
    for (const url of ['/api/gm/shop/prices', '/api/gm/shop/featured/2026-W40', '/api/gm/shop/featured/not-a-week', '/api/gm/shop/welcome', '/api/gm/reputation/rules', '/api/gm/reputation/ranks']) {
      const res = await gmReq('PUT', url, { changes: [], itemIds: [], rules: {}, ranks: [] })
      expect([res.statusCode, code(res)], url).toEqual([400, 'INVALID_REASON'])
    }
  })

  it('GET /api/gm/shop: every item, nine weeks of shelves from this one, the welcome choices and both reputation tables', async () => {
    const res = await gmReq('GET', '/api/gm/shop')
    expect(res.statusCode).toBe(200)
    const body = res.json() as ShopConfigBody
    expect(body.prices).toHaveLength(h.app.services.catalog.all().length)
    expect(body.featured).toHaveLength(9)
    expect(body.featured[0]!.weekKey).toBe('2026-W36')
    expect(body.welcomeChoices).toHaveLength(3)
    expect(body.reputation.ranks).toHaveLength(5)
    expect(Object.keys(body.reputation.rules)).toHaveLength(8)
  })

  it('PUT /api/gm/shop/prices changes a row and answers how many', async () => {
    const res = await gmReq('PUT', '/api/gm/shop/prices', { changes: [{ itemId: 'outfit_dealer01', pricePoints: 22_000, minRank: 2 }], reason: 'chỉnh giá' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ actionId: expect.any(Number), changed: 1 })
    expect((await config()).prices.find((p) => p.itemId === 'outfit_dealer01')).toMatchObject({ pricePoints: 22_000, priced: true })
    const bad = await gmReq('PUT', '/api/gm/shop/prices', { changes: [{ itemId: 'no_such_item', pricePoints: 1 }], reason: 'món lạ' })
    expect([bad.statusCode, code(bad)]).toEqual([400, 'INVALID_PRICES'])
  })

  it('PUT /api/gm/shop/featured/:week sets the shelf; a malformed week is 400 INVALID_WEEK, a past one 409', async () => {
    const sellable = (await config()).prices.filter((p) => p.lock === null).map((p) => p.itemId)
    const res = await gmReq('PUT', '/api/gm/shop/featured/2026-W38', { itemIds: sellable.slice(0, 3), reason: 'kệ tuần 38' })
    expect(res.statusCode).toBe(200)
    expect((await config()).featured.find((f) => f.weekKey === '2026-W38')).toEqual({ weekKey: '2026-W38', itemIds: sellable.slice(0, 3), source: 'gm' })
    const malformed = await gmReq('PUT', '/api/gm/shop/featured/2026-38', { itemIds: [], reason: 'tuần sai' })
    expect([malformed.statusCode, code(malformed)]).toEqual([400, 'INVALID_WEEK'])
    const past = await gmReq('PUT', '/api/gm/shop/featured/2026-W30', { itemIds: [], reason: 'tuần cũ' })
    expect([past.statusCode, code(past)]).toEqual([409, 'WEEK_IN_PAST'])
  })

  it('PUT /api/gm/shop/welcome sets the three choices; two are a 400', async () => {
    const wearable = (await config()).prices.filter((p) => p.lock === null && ['outfit', 'head', 'face', 'aura', 'frame'].includes(p.slot)).map((p) => p.itemId)
    const res = await gmReq('PUT', '/api/gm/shop/welcome', { itemIds: wearable.slice(0, 3), reason: 'quà chào mừng mới' })
    expect(res.statusCode).toBe(200)
    expect((await config()).welcomeChoices).toEqual(wearable.slice(0, 3))
    const two = await gmReq('PUT', '/api/gm/shop/welcome', { itemIds: wearable.slice(0, 2), reason: 'thiếu một' })
    expect([two.statusCode, code(two)]).toEqual([400, 'INVALID_WELCOME'])
  })

  it('PUT /api/gm/reputation/rules and /ranks apply at once; a falling ladder is 400 INVALID_RANKS', async () => {
    const rules = await gmReq('PUT', '/api/gm/reputation/rules', { rules: { hand_won: 4 }, reason: 'thắng được hơn' })
    expect(rules.statusCode).toBe(200)
    expect((await config()).reputation.rules.hand_won).toBe(4)
    const ladder = [0, 120, 420, 1_900, 5_100].map((threshold, i) => ({ rank: i + 1, threshold }))
    const ranks = await gmReq('PUT', '/api/gm/reputation/ranks', { ranks: ladder, reason: 'giãn bậc' })
    expect(ranks.statusCode).toBe(200)
    expect((await config()).reputation.ranks).toEqual(ladder)
    const falling = await gmReq('PUT', '/api/gm/reputation/ranks', { ranks: [0, 100, 50, 1_800, 5_000].map((threshold, i) => ({ rank: i + 1, threshold })), reason: 'bậc lùi' })
    expect([falling.statusCode, code(falling)]).toEqual([400, 'INVALID_RANKS'])
    const negative = await gmReq('PUT', '/api/gm/reputation/rules', { rules: { hand_won: -1 }, reason: 'số âm' })
    expect([negative.statusCode, code(negative)]).toEqual([400, 'INVALID_RULES'])
  })

  it('POST /api/gm/players/:id/reputation adds reputation, the detail shows it, and 0 is a 400', async () => {
    const res = await gmReq('POST', `/api/gm/players/${me.playerId}/reputation`, { amount: 150, reason: 'thưởng sự kiện' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ actionId: expect.any(Number), reputation: 150, rank: 2 })
    expect((await gmReq('GET', `/api/gm/players/${me.playerId}`)).json()).toMatchObject({ reputation: 150, rank: 2 })
    const zero = await gmReq('POST', `/api/gm/players/${me.playerId}/reputation`, { amount: 0, reason: 'không cộng' })
    expect([zero.statusCode, code(zero)]).toEqual([400, 'INVALID_AMOUNT'])
    const log = (await gmReq('GET', `/api/gm/actions?player=${me.playerId}`)).json().actions as { action: string; amount: number }[]
    expect(log[0]).toMatchObject({ action: 'grant_reputation', amount: 150 })
  })
})

describe('the chaos cards (Plan 37)', () => {
  interface ChaosBody {
    cards: { id: string; tier: string; activeNow: boolean; rule: { weight: number } | null }[]
    config: { tierWeights: { silver: number; gold: number; diamond: number }; pointsThreshold: number; draftMs: number; resultMs: number; dailyCapPoints: number; dailyRescues: number }
  }
  const chaos = async (): Promise<ChaosBody> => (await gmReq('GET', '/api/gm/chaos')).json() as ChaosBody
  const rule = (cardId: string, weight: number, enabled = true) => ({ cardId, enabled, weight, startsAt: null, endsAt: null })

  it('GET /api/gm/chaos lists the 47 cards, each on now, with the settings', async () => {
    const res = await gmReq('GET', '/api/gm/chaos')
    expect(res.statusCode).toBe(200)
    const body = res.json() as ChaosBody
    expect(body.cards).toHaveLength(47)
    expect(body.cards.every((c) => c.activeNow && c.rule === null)).toBe(true)
    expect(body.config.tierWeights).toEqual({ silver: 60, gold: 30, diamond: 10 })
  })

  it('a write without a reason is exactly 400 INVALID_REASON, before its body is looked at', async () => {
    for (const url of ['/api/gm/chaos/rules', '/api/gm/chaos/config']) {
      const res = await gmReq('PUT', url, { changes: [], config: {} })
      expect([res.statusCode, code(res)], url).toEqual([400, 'INVALID_REASON'])
    }
    const short = await gmReq('PUT', '/api/gm/chaos/rules', { changes: [], reason: 'ab' })
    expect(code(short)).toBe('INVALID_REASON')
  })

  it('PUT /api/gm/chaos/rules writes the rules and a set_chaos_rules audit row; a clear takes one back', async () => {
    const [a] = (await chaos()).cards.filter((c) => c.tier === 'gold')
    const res = await gmReq('PUT', '/api/gm/chaos/rules', { changes: [rule(a!.id, 25)], reason: 'trọng số mùa Tết' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ actionId: expect.any(Number), changed: 1 })
    expect((await chaos()).cards.find((c) => c.id === a!.id)!.rule).toMatchObject({ weight: 25 })
    const audit = (await gmReq('GET', '/api/gm/actions')).json() as { actions: { action: string; reason: string; details: unknown }[] }
    expect(audit.actions[0]).toMatchObject({ action: 'set_chaos_rules', reason: 'trọng số mùa Tết', details: { changes: [rule(a!.id, 25)] } })

    const cleared = await gmReq('PUT', '/api/gm/chaos/rules', { changes: [{ cardId: a!.id, clear: true }], reason: 'về theo file' })
    expect(cleared.statusCode).toBe(200)
    expect((await chaos()).cards.find((c) => c.id === a!.id)!.rule).toBeNull()
  })

  it('refusing to leave a tier short is 400 INVALID_CHAOS_RULES and writes nothing', async () => {
    const silver = (await chaos()).cards.filter((c) => c.tier === 'silver')
    const res = await gmReq('PUT', '/api/gm/chaos/rules', { changes: silver.map((c) => rule(c.id, 1, false)), reason: 'tắt hết bạc' })
    expect([res.statusCode, code(res)]).toEqual([400, 'INVALID_CHAOS_RULES'])
    expect((await chaos()).cards.every((c) => c.rule === null)).toBe(true)
    const none = await gmReq('PUT', '/api/gm/chaos/rules', { reason: 'không có thay đổi' })
    expect([none.statusCode, code(none)]).toEqual([400, 'INVALID_CHAOS_RULES'])
    const audit = (await gmReq('GET', '/api/gm/actions')).json() as { actions: { action: string }[] }
    expect(audit.actions.some((a) => a.action === 'set_chaos_rules')).toBe(false)
  })

  it('PUT /api/gm/chaos/config saves the five numbers; a bad one is 400 INVALID_CHAOS_CONFIG', async () => {
    const config = { tierWeights: { silver: 50, gold: 35, diamond: 15 }, pointsThreshold: 8, draftMs: 20_000, resultMs: 12_000, dailyCapPoints: 50_000, dailyRescues: 2 }
    const res = await gmReq('PUT', '/api/gm/chaos/config', { config, reason: 'cân lại bậc thẻ' })
    expect(res.statusCode).toBe(200)
    expect((await chaos()).config).toEqual(config)
    const bad = await gmReq('PUT', '/api/gm/chaos/config', { config: { ...config, dailyRescues: 99 }, reason: 'cấp cứu quá nhiều' })
    expect([bad.statusCode, code(bad)]).toEqual([400, 'INVALID_CHAOS_CONFIG'])
    expect((await chaos()).config).toEqual(config)
  })
})

describe('players', () => {
  it('grants points over HTTP, the ledger and the log agree, the cap is a 400, an overdraft a 409', async () => {
    const res = await gmReq('POST', `/api/gm/players/${me.playerId}/points`, { amount: 12_345, reason: 'thưởng' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ balance: ECONOMY.startingBalance + 12_345 })
    const cap = await gmReq('POST', `/api/gm/players/${me.playerId}/points`, { amount: POINTS_CAP + 1, reason: 'quá tay' })
    expect(cap.statusCode).toBe(400)
    expect(code(cap)).toBe('INVALID_AMOUNT')
    expect((await gmReq('POST', `/api/gm/players/${me.playerId}/points`, { amount: -(10 ** 7), reason: 'trừ quá tay' })).statusCode).toBe(409)

    const ledger = (await gmReq('GET', `/api/gm/players/${me.playerId}/ledger`)).json() as { entries: { amount: number; reason: string }[] }
    expect(ledger.entries[0]).toMatchObject({ amount: 12_345, reason: 'gm_grant' })
    const log = (await gmReq('GET', `/api/gm/actions?player=${me.playerId}`)).json() as { actions: { action: string; amount: number; reason: string }[] }
    expect(log.actions[0]).toMatchObject({ action: 'grant_points', amount: 12_345, reason: 'thưởng' })
  })

  it('searches by POST and masks emails; the detail shows the full one; a player gets 403', async () => {
    const found = (await gmReq('POST', '/api/gm/players/search', { q: 'binh' })).json()
    expect(found.players).toHaveLength(1)
    expect(JSON.stringify(found)).not.toContain('binh@example.com')
    expect((await gmReq('GET', `/api/gm/players/${me.playerId}`)).json()).toMatchObject({ email: GOOD_ACCOUNT.email, role: 'player', locked: null })
    expect((await h.app.fastify.inject({ method: 'POST', url: '/api/gm/players/search', headers: h.auth(me), payload: { q: 'x' } })).statusCode).toBe(403)
    // An empty query lists every account, paged.
    const all = (await gmReq('POST', '/api/gm/players/search', { q: '', limit: 1 })).json()
    expect(all.players).toHaveLength(1)
    expect(all.nextBefore).toBe(all.players[0].playerId)
  })

  it('answers 404 NOT_FOUND for an unknown or malformed player id', async () => {
    const res = await gmReq('GET', '/api/gm/players/not-a-uuid')
    expect(res.statusCode).toBe(404)
    expect(code(res)).toBe('NOT_FOUND')
    const grant = await gmReq('POST', '/api/gm/players/00000000-0000-4000-8000-000000000000/points', { amount: 5, reason: 'không có' })
    expect(grant.statusCode).toBe(404)
  })

  it('grants an item or the whole wardrobe, refuses a free or unknown item', async () => {
    const one = await gmReq('POST', `/api/gm/players/${me.playerId}/items`, { itemId: 'outfit_dealer01', reason: 'tặng' })
    expect(one.statusCode).toBe(200)
    expect(one.json()).toMatchObject({ granted: ['outfit_dealer01'], alreadyOwned: 0 })
    expect((await gmReq('POST', `/api/gm/players/${me.playerId}/items`, { itemId: 'no_such_item', reason: 'tặng' })).json().error.code).toBe('INVALID_ITEM')
    const all = await gmReq('POST', `/api/gm/players/${me.playerId}/items`, { all: true, reason: 'tặng cả tủ' })
    expect(all.statusCode).toBe(200)
    expect(all.json().granted.length).toBeGreaterThan(0)
  })

  it('unlocks an achievement over HTTP: the reward is paid, a repeat is 409, an unknown id 400, a locked account 409', async () => {
    const url = (id: string) => `/api/gm/players/${me.playerId}/achievements/${id}/unlock`
    const done = await gmReq('POST', url('login_streak_7'), { reason: 'quên điểm danh' })
    expect(done.statusCode).toBe(200)
    expect(done.json()).toEqual({ actionId: expect.any(Number), reward: { points: 5_000 }, balance: ECONOMY.startingBalance + 5_000 })
    const again = await gmReq('POST', url('login_streak_7'), { reason: 'lần nữa' })
    expect(again.statusCode).toBe(409)
    expect(code(again)).toBe('ALREADY_UNLOCKED')
    const unknown = await gmReq('POST', url('no_such_achievement'), { reason: 'không có' })
    expect(unknown.statusCode).toBe(400)
    expect(code(unknown)).toBe('INVALID_ACHIEVEMENT')
    expect((await gmReq('POST', `/api/gm/players/${me.playerId}/lock`, { reason: 'gian lận' })).statusCode).toBe(200)
    const locked = await gmReq('POST', url('login_streak_28'), { reason: 'đang khóa' })
    expect(locked.statusCode).toBe(409)
    expect(code(locked)).toBe('TARGET_IS_LOCKED')
    expect(code(await gmReq('POST', `/api/gm/players/not-a-uuid/achievements/login_streak_7/unlock`, { reason: 'sai id' }))).toBe('NOT_FOUND')
  })

  it('previews and undoes today\'s check-in over HTTP: 409 NOT_CLAIMED_TODAY before a claim, then the points come back and the player can claim again', async () => {
    const preview = `/api/gm/players/${me.playerId}/checkin`
    const reset = `${preview}/reset`
    expect((await gmReq('GET', preview)).json()).toEqual({ claimedToday: false, day: 1, streak: 0, points: 0, itemIds: [] })
    const none = await gmReq('POST', reset, { reason: 'chưa điểm danh' })
    expect(none.statusCode).toBe(409)
    expect(code(none)).toBe('NOT_CLAIMED_TODAY')

    const claim = await h.app.services.economy.claimDaily(me.playerId)
    if (!claim.ok) throw new Error('the claim was refused')
    expect((await gmReq('GET', preview)).json()).toEqual({ claimedToday: true, day: 1, streak: 1, points: claim.points, itemIds: claim.items })
    const done = await gmReq('POST', reset, { reason: 'nhầm tài khoản' })
    expect(done.statusCode).toBe(200)
    expect(done.json()).toEqual({ actionId: expect.any(Number), undone: { points: claim.points, itemIds: claim.items }, balance: ECONOMY.startingBalance })
    expect((await h.app.services.economy.claimDaily(me.playerId)).ok).toBe(true)

    // The reason comes first, an unknown id is a 404, and spent points are a 409.
    expect(code(await gmReq('GET', `/api/gm/players/not-a-uuid/checkin`))).toBe('NOT_FOUND')
    expect(code(await gmReq('POST', `/api/gm/players/not-a-uuid/checkin/reset`, { reason: 'sai id' }))).toBe('NOT_FOUND')
    await gmReq('POST', `/api/gm/players/${me.playerId}/points`, { amount: -(ECONOMY.startingBalance + claim.points), reason: 'tiêu hết' })
    const spent = await gmReq('POST', reset, { reason: 'không đủ điểm' })
    expect(spent.statusCode).toBe(409)
    expect(code(spent)).toBe('INSUFFICIENT_BALANCE')
  })

  it('locks and unlocks, signs the player out, and refuses the self, a gm, a double lock', async () => {
    const locked = await gmReq('POST', `/api/gm/players/${me.playerId}/lock`, { reason: 'gian lận' })
    expect(locked.statusCode).toBe(200)
    expect(locked.json()).toEqual({ locked: true })
    expect((await h.app.fastify.inject({ url: '/api/auth/me', headers: { cookie: me.cookie } })).statusCode).toBe(401)
    expect(code(await gmReq('POST', `/api/gm/players/${me.playerId}/lock`, { reason: 'lần nữa' }))).toBe('ALREADY_LOCKED')
    expect((await gmReq('POST', `/api/gm/players/${me.playerId}/unlock`, { reason: 'xin lỗi' })).json()).toEqual({ locked: false })
    expect(code(await gmReq('POST', `/api/gm/players/${me.playerId}/unlock`, { reason: 'lần nữa' }))).toBe('NOT_LOCKED')

    const self = await gmReq('POST', `/api/gm/players/${boss.playerId}/lock`, { reason: 'tự khóa' })
    expect(self.statusCode).toBe(403)
    expect(code(self)).toBe('SELF_TARGET')
  })

  it('promotes and demotes; the last gm and the self cannot be demoted; a bad role is 400', async () => {
    const promoted = await gmReq('POST', `/api/gm/players/${me.playerId}/role`, { role: 'gm', reason: 'đồng quản trị' })
    expect(promoted.json()).toEqual({ role: 'gm' })
    // `me` is a gm now, so locking them is refused with TARGET_IS_GM.
    const lockGm = await gmReq('POST', `/api/gm/players/${me.playerId}/lock`, { reason: 'thử khóa' })
    expect(lockGm.statusCode).toBe(403)
    expect(code(lockGm)).toBe('TARGET_IS_GM')
    expect(code(await gmReq('POST', `/api/gm/players/${boss.playerId}/role`, { role: 'player', reason: 'tự hạ' }))).toBe('SELF_TARGET')
    expect(code(await gmReq('POST', `/api/gm/players/${me.playerId}/role`, { role: 'king', reason: 'vai lạ' }))).toBe('INVALID_ROLE')
    expect((await gmReq('POST', `/api/gm/players/${me.playerId}/role`, { role: 'player', reason: 'hạ lại' })).json()).toEqual({ role: 'player' })
  })

  it('reads a player’s history', async () => {
    const res = await gmReq('GET', `/api/gm/players/${me.playerId}/history?limit=5`)
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json())).toBe(true)
  })

  it('reports the overview', async () => {
    const res = await gmReq('GET', '/api/gm/overview')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ online: 0, rooms: 0, accounts: 2, locked: 0, gms: 1, points24h: { sources: 2 * ECONOMY.startingBalance } })
  })

  it('reports the sources and sinks per day for 7 or 30 days, and refuses any other span', async () => {
    await db.execute(sql`update point_transactions set created_at = '2026-09-04T03:00:00Z'::timestamptz`)
    for (const days of [7, 30]) {
      const res = await gmReq('GET', `/api/gm/stats/daily?days=${String(days)}`)
      expect(res.statusCode).toBe(200)
      const body = res.json() as { day: string; sources: Record<string, number>; sinks: Record<string, number>; net: number }[]
      expect(body).toHaveLength(days)
      expect(body.map((d) => d.day)).toEqual([...body.map((d) => d.day)].sort())
      // The harness clock stands at 2026-09-04: the starting balances are stamped onto that day.
      expect(body[days - 1]).toMatchObject({ sources: { starting_balance: 2 * ECONOMY.startingBalance }, sinks: {}, net: 2 * ECONOMY.startingBalance })
    }
    for (const query of ['days=10', 'days=', 'days=7.5', '']) {
      const res = await gmReq('GET', `/api/gm/stats/daily${query === '' ? '' : `?${query}`}`)
      expect(res.statusCode, query).toBe(400)
      expect(code(res), query).toBe('INVALID_DAYS')
    }
  })
})

describe('rooms', () => {
  it('lists every room including private ones, kicks, closes with refunds, and logs both', async () => {
    const url = await listen()
    const ws = await connect(url, me)
    const roomId = await createPrivateBlindAndSit(ws)

    const rooms = (await gmReq('GET', '/api/gm/rooms')).json().rooms as { roomId: string; isPrivate: boolean; players: number }[]
    expect(rooms.find((r) => r.roomId === roomId)).toMatchObject({ isPrivate: true, players: 1 })
    const one = (await gmReq('GET', `/api/gm/rooms/${roomId}`)).json()
    expect(one).toMatchObject({ roomId, members: [{ playerId: me.playerId, seat: 0 }] })
    expect(code(await gmReq('GET', '/api/gm/rooms/nope'))).toBe('ROOM_NOT_FOUND')

    expect(code(await gmReq('POST', `/api/gm/rooms/${roomId}/kick`, { playerId: boss.playerId, reason: 'không ở đây' }))).toBe('NOT_IN_ROOM')
    expect(code(await gmReq('POST', '/api/gm/rooms/nope/close', { reason: 'không có' }))).toBe('ROOM_NOT_FOUND')

    const notice = ws.next('NOTIFICATION', (m) => m.kind === 'GM_NOTICE')
    const closed = await gmReq('POST', `/api/gm/rooms/${roomId}/close`, { reason: 'bảo trì' })
    expect(closed.json()).toMatchObject({ closed: true, refunded: 1 })
    expect(await notice).toMatchObject({ kind: 'GM_NOTICE', payload: { action: 'close_room', reason: 'bảo trì' } })
    expect(await h.app.services.repos.balances.get(me.playerId)).toBe(ECONOMY.startingBalance)

    const log = (await gmReq('GET', `/api/gm/actions?room=${roomId}`)).json().actions as { action: string; roomId: string; reason: string }[]
    expect(log[0]).toMatchObject({ action: 'close_room', roomId, reason: 'bảo trì' })
    // A closed room is gone from the list.
    const after = (await gmReq('GET', '/api/gm/rooms')).json().rooms as { roomId: string }[]
    expect(after.find((r) => r.roomId === roomId)).toBeUndefined()
  })

  it('kicks a seated player now, tells them, and logs how the kick took effect', async () => {
    const url = await listen()
    const ws = await connect(url, me)
    const roomId = await createPrivateBlindAndSit(ws)

    const notice = ws.next('NOTIFICATION', (m) => m.kind === 'GM_NOTICE')
    const res = await gmReq('POST', `/api/gm/rooms/${roomId}/kick`, { playerId: me.playerId, reason: 'phá bàn' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ effective: 'now' })
    expect(await notice).toMatchObject({ payload: { action: 'kick', reason: 'phá bàn' } })
    expect(await h.app.services.repos.balances.get(me.playerId)).toBe(ECONOMY.startingBalance)

    const log = (await gmReq('GET', `/api/gm/actions?player=${me.playerId}`)).json().actions as { action: string; roomId: string; details: unknown }[]
    expect(log[0]).toMatchObject({ action: 'kick', roomId, details: { effective: 'now' } })
  })

  it('a kick whose log write fails is still a 200 with how it took effect, and the failure is warned', async () => {
    // The same database and accounts, on an app whose logger the test can read.
    const warn = vi.fn()
    await h.app.close()
    h = await buildTestApp(db, { log: { ...silentLogger, warn } })
    const url = await listen()
    const ws = await connect(url, me)
    const roomId = await createPrivateBlindAndSit(ws)

    vi.spyOn(h.app.services.gm, 'recordRoomAction').mockRejectedValueOnce(new Error('log table gone'))
    const res = await gmReq('POST', `/api/gm/rooms/${roomId}/kick`, { playerId: me.playerId, reason: 'phá bàn' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ effective: 'now' })
    expect(warn).toHaveBeenCalledWith('gm kick not logged', expect.objectContaining({ roomId, playerId: me.playerId, effective: 'now', error: 'log table gone' }))
    expect(h.app.game.rooms.roomOf(me.playerId)).toBeUndefined()
    expect(await h.app.services.repos.balances.get(me.playerId)).toBe(ECONOMY.startingBalance)
  })
})
