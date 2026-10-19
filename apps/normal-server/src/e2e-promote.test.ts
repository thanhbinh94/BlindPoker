import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { rowsOf, type AppDb } from './db/client.js'
import { createTestDb, type TestDb } from './db/test-db.js'
import { promoteRoute } from './e2e-promote.js'
import { buildTestApp, GOOD_ACCOUNT, resetDb, XRW, type Harness } from './test-harness.js'

let test: TestDb
let db: AppDb
let h: Harness

const roleOf = async (p: string) => rowsOf<{ role: string }>(await db.execute(sql`select role from users where id = ${p}`))[0]?.role

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
})
afterAll(async () => {
  await test.close()
})
beforeEach(async () => {
  h = await buildTestApp(db, { extraRoutes: promoteRoute(db) })
})
afterEach(async () => {
  await h.app.close()
  await resetDb(db)
})

describe('POST /e2e/promote — mounted through AppDeps.extraRoutes', () => {
  it('promotes a registered email from loopback', async () => {
    const me = await h.register()
    const res = await h.app.fastify.inject({ method: 'POST', url: '/e2e/promote', headers: XRW, payload: { email: GOOD_ACCOUNT.email }, remoteAddress: '127.0.0.1' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ role: 'gm' })
    expect(await roleOf(me.playerId)).toBe('gm')
  })

  it('refuses a request that did not come from loopback, and promotes nobody', async () => {
    const me = await h.register()
    const res = await h.app.fastify.inject({ method: 'POST', url: '/e2e/promote', headers: XRW, payload: { email: GOOD_ACCOUNT.email }, remoteAddress: '203.0.113.9' })
    expect(res.statusCode).toBe(403)
    expect(await roleOf(me.playerId)).toBe('player')
  })

  it('wants an email string, and sits behind the CSRF guard', async () => {
    const bad = await h.app.fastify.inject({ method: 'POST', url: '/e2e/promote', headers: XRW, payload: {}, remoteAddress: '127.0.0.1' })
    expect(bad.statusCode).toBe(400)
    const noHeader = await h.app.fastify.inject({ method: 'POST', url: '/e2e/promote', payload: { email: GOOD_ACCOUNT.email }, remoteAddress: '127.0.0.1' })
    expect(noHeader.statusCode).toBe(403)
  })
})

describe('without extraRoutes (production)', () => {
  it('has no /e2e/promote route', async () => {
    const plain = await buildTestApp(db)
    const res = await plain.app.fastify.inject({ method: 'POST', url: '/e2e/promote', headers: XRW, payload: { email: GOOD_ACCOUNT.email }, remoteAddress: '127.0.0.1' })
    expect(res.statusCode).toBe(404)
    await plain.app.close()
  })
})
