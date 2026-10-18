/**
 * `/api/gm/*` over HTTP (Plan 25 §5): what this layer adds on top of `gm-service.test.ts` — the guard, the
 * reason checked before any lookup, the status each refusal becomes, and the room routes that reach a live room.
 */
import type { AddressInfo } from 'node:net'
import { ECONOMY, type RoomConfig } from '@bp/core'
import { TestClient } from '@bp/server-kit/testing'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { createTestDb, type TestDb } from '../db/test-db.js'
import { POINTS_CAP } from '../gm/gm-service.js'
import { buildTestApp, GOOD_ACCOUNT, ORIGIN, resetDb, type Account, type Harness } from '../test-harness.js'

let test: TestDb
let db: AppDb
let h: Harness
let me: Account
let boss: Account
const clients: TestClient[] = []

const code = (res: { json(): unknown }): string => (res.json() as { error: { code: string } }).error.code
const gmReq = (method: 'GET' | 'POST', url: string, payload?: object) =>
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
  it('answers 401 to nobody and 403 FORBIDDEN to a player on every route', async () => {
    for (const [method, url] of [['GET', '/api/gm/overview'], ['GET', '/api/gm/rooms'], ['GET', '/api/gm/actions'], ['GET', `/api/gm/players/${me.playerId}`]] as const) {
      expect((await h.app.fastify.inject({ method, url })).statusCode, url).toBe(401)
      const res = await h.app.fastify.inject({ method, url, headers: h.auth(me) })
      expect(res.statusCode, url).toBe(403)
      expect(code(res), url).toBe('FORBIDDEN')
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
})
