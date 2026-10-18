import type { AddressInfo } from 'node:net'
import { ECONOMY, type RoomConfig } from '@bp/core'
import { TestClient } from '@bp/server-kit/testing'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { rowsOf, type AppDb } from '../db/client.js'
import { createTestDb, type TestDb } from '../db/test-db.js'
import { ServiceError } from '../errors.js'
import { buildTestApp, ORIGIN, resetDb, type Account, type Harness } from '../test-harness.js'
import { createGmService, GM_ITEM_SOURCE, POINTS_CAP, type GmActor, type GmService, type GmServiceDeps } from './gm-service.js'

/** A Blind room nobody plays in: the lock test only needs the player seated, with a stack on the table. */
const BLIND_ROOM: RoomConfig = {
  name: 'Bàn thử', mode: 'blind', maxPlayers: 4, isPrivate: false, turnTimerSec: 15, autoStart: false,
  blind: { holeCards: 2, decisionMode: 'none', fixedWager: 1_000, botCount: 0 },
}
const BOSS_ACCOUNT = { email: 'boss@example.com', password: 'a boss password', displayName: 'Ông Chủ' }

let test: TestDb
let db: AppDb
let h: Harness
let gm: GmService
let me: Account
let boss: Account
const clients: TestClient[] = []

const actor = (a: Account): GmActor => ({ userId: a.playerId })
const promote = (p: string) => db.execute(sql`update users set role = 'gm' where id = ${p}`)
const actionsOf = async (p: string) =>
  rowsOf<{ action: string; amount: string | number | null; reason: string }>(
    await db.execute(sql`select action, amount, reason from gm_actions where target_player_id = ${p} order by id`),
  )
const deps = (over: Partial<GmServiceDeps> = {}): GmServiceDeps => ({ ...h.app.services, db, game: h.app.game, ...over })

async function listen(): Promise<string> {
  await h.app.fastify.listen({ port: 0, host: '127.0.0.1' })
  const address = h.app.fastify.server.address() as AddressInfo
  return `http://127.0.0.1:${String(address.port)}`
}

async function connect(base: string, cookie: string): Promise<TestClient> {
  const client = await TestClient.connect(`${base.replace('http://', 'ws://')}/ws`, { origin: ORIGIN, cookie })
  clients.push(client)
  return client
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
  boss = await h.register(BOSS_ACCOUNT)
  await promote(boss.playerId)
  // `services.gm` is wired by the app in Task 5; until then the service is built from the app's own parts.
  gm = createGmService(deps())
})
afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => {})
  await h.app.close()
  await resetDb(db)
})

describe('GmService — points', () => {
  it('grants points: one ledger row reason gm_grant with ref gm:<id>, one action row, BALANCE pushed', async () => {
    const pushed = vi.spyOn(h.app.game, 'balanceChanged')
    const r = await gm.adjustPoints(actor(boss), me.playerId, 25_000, 'thưởng sự kiện')
    expect(r.balance).toBe(ECONOMY.startingBalance + 25_000)
    const ledger = await h.app.services.repos.ledger.list(me.playerId, { limit: 1 })
    expect(ledger[0]).toMatchObject({ amount: 25_000, reason: 'gm_grant', refId: `gm:${String(r.actionId)}` })
    expect(await actionsOf(me.playerId)).toEqual([{ action: 'grant_points', amount: expect.anything(), reason: 'thưởng sự kiện' }])
    expect(pushed).toHaveBeenCalledWith(me.playerId)
  })

  it('takes points back with reason gm_adjust, and refuses all of it when the balance is short — no action row either', async () => {
    await expect(gm.adjustPoints(actor(boss), me.playerId, -ECONOMY.startingBalance - 1, 'test')).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' })
    expect(await actionsOf(me.playerId)).toEqual([])
    expect(await h.app.services.repos.balances.get(me.playerId)).toBe(ECONOMY.startingBalance)
    const r = await gm.adjustPoints(actor(boss), me.playerId, -1_000, 'sửa lỗi')
    expect(r.balance).toBe(ECONOMY.startingBalance - 1_000)
    const ledger = await h.app.services.repos.ledger.list(me.playerId, { limit: 1 })
    expect(ledger[0]).toMatchObject({ amount: -1_000, reason: 'gm_adjust', refId: `gm:${String(r.actionId)}` })
  })

  it('refuses amount 0, a non-integer, |amount| over the cap, and a reason shorter than 3 characters', async () => {
    for (const [amount, reason] of [[0, 'ok ok'], [1.5, 'ok ok'], [POINTS_CAP + 1, 'ok ok'], [-POINTS_CAP - 1, 'ok ok'], [100, 'no'], [100, '   no   ']] as const) {
      await expect(gm.adjustPoints(actor(boss), me.playerId, amount, reason)).rejects.toBeInstanceOf(ServiceError)
    }
    await expect(gm.adjustPoints(actor(boss), me.playerId, 100, 'x'.repeat(201))).rejects.toMatchObject({ code: 'INVALID_REASON' })
    await expect(gm.adjustPoints(actor(boss), me.playerId, 0, 'ok ok')).rejects.toMatchObject({ code: 'INVALID_AMOUNT' })
    await expect(gm.adjustPoints(actor(boss), 'not-a-uuid', 100, 'ok ok')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(gm.adjustPoints(actor(boss), '00000000-0000-4000-8000-000000000000', 100, 'ok ok')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await actionsOf(me.playerId)).toEqual([])
  })
})

describe('GmService — items', () => {
  it('grants one item once and the whole wardrobe with source gm-grant', async () => {
    const one = await gm.grantItem(actor(boss), me.playerId, 'head_tophat01', 'quà')
    expect(one.granted).toEqual(['head_tophat01'])
    expect((await gm.grantItem(actor(boss), me.playerId, 'head_tophat01', 'quà')).alreadyOwned).toBe(1)
    await expect(gm.grantItem(actor(boss), me.playerId, 'haircolor_black01', 'free one')).rejects.toMatchObject({ code: 'INVALID_ITEM' })
    await expect(gm.grantItem(actor(boss), me.playerId, 'no_such_item', 'unknown')).rejects.toMatchObject({ code: 'INVALID_ITEM' })
    const all = await gm.grantWardrobe(actor(boss), me.playerId, 'full')
    expect(all.granted.length + all.alreadyOwned).toBe(h.app.services.catalog.all().filter((d) => !d.free).length)
    expect(all.granted).not.toContain('head_tophat01')
    const sources = rowsOf<{ source: string }>(await db.execute(sql`select distinct source from inventory where player_id = ${me.playerId} and item_id = 'head_tophat01'`))
    expect(sources).toEqual([{ source: GM_ITEM_SOURCE }])
    expect((await actionsOf(me.playerId)).map((a) => a.action)).toEqual(['grant_item', 'grant_item', 'grant_wardrobe'])
    // A second full grant has nothing left to give.
    expect((await gm.grantWardrobe(actor(boss), me.playerId, 'again')).granted).toEqual([])
  })
})

describe('GmService — lock and role', () => {
  it('locks: columns set, sessions revoked, socket closed, kicked from the room; unlock clears; double lock refused', async () => {
    const ws = await connect(await listen(), me.cookie)
    await ws.next('WELCOME')
    ws.send({ t: 'CREATE_ROOM', config: BLIND_ROOM })
    await ws.next('ROOM_SNAPSHOT')
    ws.send({ t: 'SIT_DOWN', seat: 0 })
    await ws.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_SAT' && m.event.playerId === me.playerId)

    await gm.lock(actor(boss), me.playerId, 'spam')
    expect((await ws.closed).code).toBe(4003)
    const [row] = rowsOf<{ locked_at: unknown; locked_reason: string | null }>(await db.execute(sql`select locked_at, locked_reason from users where id = ${me.playerId}`))
    expect(row?.locked_at).not.toBeNull()
    expect(row?.locked_reason).toBe('spam')
    expect((await h.app.fastify.inject({ url: '/api/me', headers: { cookie: me.cookie } })).statusCode).toBe(401)
    expect(h.app.game.rooms.roomOf(me.playerId)).toBeUndefined()
    expect(await h.app.services.repos.balances.get(me.playerId)).toBe(ECONOMY.startingBalance) // the stack came home
    await expect(gm.lock(actor(boss), me.playerId, 'again')).rejects.toMatchObject({ code: 'ALREADY_LOCKED' })

    await gm.unlock(actor(boss), me.playerId, 'ok now')
    const [after] = rowsOf<{ locked_at: unknown; locked_reason: string | null }>(await db.execute(sql`select locked_at, locked_reason from users where id = ${me.playerId}`))
    expect(after).toEqual({ locked_at: null, locked_reason: null })
    await expect(gm.unlock(actor(boss), me.playerId, 'twice')).rejects.toMatchObject({ code: 'NOT_LOCKED' })
    expect((await actionsOf(me.playerId)).map((a) => a.action)).toEqual(['lock', 'unlock'])
  })

  it('locks in order after the commit — sessions revoked, then the room kick, then the notice, then the socket closed', async () => {
    const calls: string[] = []
    const room = {
      adminKick: (id: string) => { calls.push(`adminKick:${id}`); return Promise.resolve('now' as const) },
      adminSummary: () => ({ roomId: 'r1', code: 'ABC123', name: 'Bàn', members: [] }),
    }
    const game: GmServiceDeps['game'] = {
      connectionCount: 0,
      notify: (id, msg) => { calls.push(`notify:${id}:${(msg as { kind?: string }).kind ?? ''}`) },
      balanceChanged: () => Promise.resolve(),
      rooms: { size: 1, roomOf: () => room },
      gateway: { disconnect: (id) => { calls.push(`disconnect:${id}`); return 1 } },
    }
    const sessions = { ...h.app.services.sessions, revokeAll: async (id: string) => { calls.push(`revokeAll:${id}`); await h.app.services.sessions.revokeAll(id) } }
    const stubbed = createGmService(deps({ game, sessions }))
    await stubbed.lock(actor(boss), me.playerId, 'spam')
    const id = me.playerId
    expect(calls).toEqual([`revokeAll:${id}`, `adminKick:${id}`, `notify:${id}:GM_NOTICE`, `disconnect:${id}`])
  })

  it('logs a room kick that failed during a lock, and still sends the notice and closes the socket', async () => {
    const calls: string[] = []
    const warn = vi.fn()
    const game: GmServiceDeps['game'] = {
      connectionCount: 0,
      notify: () => { calls.push('notify') },
      balanceChanged: () => Promise.resolve(),
      rooms: { size: 1, roomOf: () => ({ adminKick: () => Promise.reject(new Error('room on fire')), adminSummary: () => ({ roomId: 'r1', code: 'ABC123', name: 'Bàn', members: [] }) }) },
      gateway: { disconnect: () => { calls.push('disconnect'); return 1 } },
    }
    await createGmService(deps({ game, log: { warn } })).lock(actor(boss), me.playerId, 'spam')
    expect(warn).toHaveBeenCalledWith('gm lock: the room kick failed', expect.objectContaining({ playerId: me.playerId, error: 'room on fire' }))
    expect(calls).toEqual(['notify', 'disconnect'])
  })

  it('warns a revocation that failed during a lock, and still kicks, notifies and closes the socket, in order', async () => {
    const calls: string[] = []
    const warn = vi.fn()
    const room = {
      adminKick: (id: string) => { calls.push(`adminKick:${id}`); return Promise.resolve('now' as const) },
      adminSummary: () => ({ roomId: 'r1', code: 'ABC123', name: 'Bàn', members: [] }),
    }
    const game: GmServiceDeps['game'] = {
      connectionCount: 0,
      notify: (id) => { calls.push(`notify:${id}`) },
      balanceChanged: () => Promise.resolve(),
      rooms: { size: 1, roomOf: () => room },
      gateway: { disconnect: (id) => { calls.push(`disconnect:${id}`); return 1 } },
    }
    const sessions = { ...h.app.services.sessions, revokeAll: () => Promise.reject(new Error('sessions down')) }
    await createGmService(deps({ game, sessions, log: { warn } })).lock(actor(boss), me.playerId, 'spam')
    expect(warn).toHaveBeenCalledWith('gm lock: revoking the sessions failed', expect.objectContaining({ playerId: me.playerId, error: 'sessions down' }))
    const id = me.playerId
    expect(calls).toEqual([`adminKick:${id}`, `notify:${id}`, `disconnect:${id}`])
    expect((await actionsOf(id)).map((a) => a.action)).toEqual(['lock'])
  })

  it('never locks a gm, and never lets a gm change their own role', async () => {
    await expect(gm.lock(actor(boss), boss.playerId, 'myself')).rejects.toMatchObject({ code: 'SELF_TARGET' })
    await promote(me.playerId)
    await expect(gm.lock(actor(boss), me.playerId, 'a gm')).rejects.toMatchObject({ code: 'TARGET_IS_GM' })
    await expect(gm.setRole(actor(boss), boss.playerId, 'player', 'bye')).rejects.toMatchObject({ code: 'SELF_TARGET' })
    expect(await actionsOf(me.playerId)).toEqual([])
    expect(await actionsOf(boss.playerId)).toEqual([])
  })

  it('promotes and demotes with a log line, and refuses to demote the last gm', async () => {
    expect((await gm.setRole(actor(boss), me.playerId, 'gm', 'help wanted')).role).toBe('gm')
    expect((await gm.setRole(actor(boss), me.playerId, 'player', 'done')).role).toBe('player')
    await expect(gm.setRole(actor(me), boss.playerId, 'player', 'coup')).rejects.toMatchObject({ code: 'LAST_GM' })
    expect((await actionsOf(me.playerId)).map((a) => a.action)).toEqual(['promote', 'demote'])
    const [still] = rowsOf<{ role: string }>(await db.execute(sql`select role from users where id = ${boss.playerId}`))
    expect(still?.role).toBe('gm')
    await expect(gm.setRole(actor(boss), me.playerId, 'admin' as 'gm', 'bad role')).rejects.toMatchObject({ code: 'INVALID_ROLE' })
  })

  it('two gms demoting each other — the gm set locked before the target — one wins and the other answers LAST_GM', async () => {
    await gm.setRole(actor(boss), me.playerId, 'gm', 'help wanted')
    const results = await Promise.allSettled([
      gm.setRole(actor(me), boss.playerId, 'player', 'coup'),
      gm.setRole(actor(boss), me.playerId, 'player', 'counter-coup'),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const refused = results.find((r) => r.status === 'rejected')
    expect(refused?.reason).toMatchObject({ code: 'LAST_GM' })
    const gms = rowsOf<{ id: string }>(await db.execute(sql`select id from users where role = 'gm'`))
    expect(gms).toHaveLength(1)
  })

  it('refuses to promote a locked account (TARGET_IS_LOCKED) and writes no log line; after the unlock it promotes', async () => {
    await gm.lock(actor(boss), me.playerId, 'spam')
    await expect(gm.setRole(actor(boss), me.playerId, 'gm', 'help wanted')).rejects.toMatchObject({ code: 'TARGET_IS_LOCKED' })
    expect((await actionsOf(me.playerId)).map((a) => a.action)).toEqual(['lock'])
    await gm.unlock(actor(boss), me.playerId, 'ok now')
    expect((await gm.setRole(actor(boss), me.playerId, 'gm', 'help wanted')).role).toBe('gm')
  })
})

describe('GmService — reads', () => {
  it('searches by email prefix or by name, masks the email, pages by playerId', async () => {
    const found = await gm.search('binh')
    expect(found.players.map((p) => p.emailMasked)).toContain('b***@example.com')
    expect(JSON.stringify(found)).not.toContain('binh@example.com')
    expect((await gm.get(me.playerId))?.email).toBe('binh@example.com')

    // By name: the folded key, so case and the input's own form do not matter.
    expect((await gm.search('CHỦ')).players.map((p) => p.playerId)).toEqual([boss.playerId])
    // A LIKE wildcard is a character to look for, not a pattern.
    expect((await gm.search('%')).players).toEqual([])

    const first = await gm.search('', { limit: 1 })
    expect(first.players).toHaveLength(1)
    expect(first.nextBefore).toBe(first.players[0]!.playerId)
    const second = await gm.search('', { limit: 1, before: first.nextBefore! })
    expect(second.players).toHaveLength(1)
    expect(second.players[0]!.playerId > first.players[0]!.playerId).toBe(true)
    expect((await gm.search('', { limit: 1, before: second.players[0]!.playerId })).players).toEqual([])
  })

  it('reads one player in full: the real email, the lock, stats, the room and the inventory count', async () => {
    expect(await gm.get('not-a-uuid')).toBeNull()
    expect(await gm.get('00000000-0000-4000-8000-000000000000')).toBeNull()
    await gm.lock(actor(boss), me.playerId, 'spam')
    const detail = await gm.get(me.playerId)
    expect(detail).toMatchObject({
      playerId: me.playerId,
      displayName: me.displayName,
      email: 'binh@example.com',
      role: 'player',
      balance: ECONOMY.startingBalance,
      locked: { at: expect.any(Number), reason: 'spam' },
      room: null,
      stats: expect.objectContaining({ handsPlayedBlind: 0 }),
    })
    expect(detail?.inventoryCount).toBeGreaterThan(0)
  })

  it('lists actions newest first with actor and target names, filtered by player', async () => {
    await gm.adjustPoints(actor(boss), me.playerId, 1_000, 'một')
    await gm.adjustPoints(actor(boss), me.playerId, 2_000, 'hai')
    await gm.adjustPoints({ userId: null }, boss.playerId, 3_000, 'cli')
    const page = await gm.actions({ playerId: me.playerId, limit: 1 })
    expect(page.actions[0]).toMatchObject({ action: 'grant_points', amount: 2_000, actor: { displayName: boss.displayName }, target: { displayName: me.displayName } })
    expect(page.nextBefore).toBe(page.actions[0]!.id)
    const next = await gm.actions({ playerId: me.playerId, limit: 1, before: page.nextBefore! })
    expect(next.actions[0]).toMatchObject({ amount: 1_000, reason: 'một' })
    const all = await gm.actions()
    expect(all.actions.map((a) => a.reason)).toEqual(['cli', 'hai', 'một'])
    expect(all.actions[0]!.actor).toBeNull()
    expect(all.nextBefore).toBeNull()
  })

  it('records a room action without a transaction of its own, and filters the log by room', async () => {
    const id = await gm.recordRoomAction(actor(boss), 'close_room', 'room-1', null, 'đóng bàn', { refunded: 2 })
    await gm.recordRoomAction(actor(boss), 'kick', 'room-2', me.playerId, 'quậy')
    const page = await gm.actions({ roomId: 'room-1' })
    expect(page.actions).toHaveLength(1)
    expect(page.actions[0]).toMatchObject({ id, action: 'close_room', roomId: 'room-1', target: null, details: { refunded: 2 } })
    await expect(gm.recordRoomAction(actor(boss), 'kick', 'room-2', null, '')).rejects.toMatchObject({ code: 'INVALID_REASON' })
  })

  it('overview counts accounts, locked, gms, live sockets and rooms, and sums the last 24 h by reason', async () => {
    await gm.adjustPoints(actor(boss), me.playerId, 5_000, 'thưởng')
    const o = await gm.overview()
    expect(o).toMatchObject({ accounts: 2, locked: 0, gms: 1, rooms: 0, online: 0 })
    expect(o.points24h.byReason.find((s) => s.reason === 'starting_balance')?.total).toBe(2 * ECONOMY.startingBalance)
    expect(o.points24h.sources).toBe(2 * ECONOMY.startingBalance + 5_000)
    expect(o.points24h.sinks).toBe(0)
  })
})
