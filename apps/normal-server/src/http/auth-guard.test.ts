/**
 * The session guard and the GM guard, on a bare Fastify with two probe routes.
 *
 * Standalone on purpose: the guard's behaviour is the subject, not any route behind it, so the
 * 200 path is proven by a probe rather than by a `/api/gm/*` route that a later task owns.
 */
import { registerErrorHandler } from '@bp/http-kit'
import { silentLogger } from '@bp/server-kit'
import fastifyCookie from '@fastify/cookie'
import { sql } from 'drizzle-orm'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SESSION_COOKIE } from '../auth/cookie.js'
import { createSessionService } from '../auth/session-service.js'
import type { AppDb } from '../db/client.js'
import { players, users } from '../db/schema.js'
import { createTestDb, type TestDb } from '../db/test-db.js'
import { createRepositories } from '../repos/index.js'
import { createRequireGm, createRequireUser, currentUser, decorateRequestUser } from './auth-guard.js'

let test: TestDb
let db: AppDb
let app: FastifyInstance
let playerId: string
let cookie: string

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
})
afterAll(async () => {
  await test.close()
})
beforeEach(async () => {
  const sessions = createSessionService(db, { secret: 'g'.repeat(32) })
  const repos = createRepositories(db)
  const [user] = await db.insert(users).values({ email: 'gm@example.com', passwordHash: 'x' }).returning({ id: users.id })
  playerId = user!.id
  await db.insert(players).values({ id: playerId, displayName: 'Quản Trị', nameKey: 'quan tri', balance: 0 })
  cookie = `${SESSION_COOKIE}=${(await sessions.create(playerId, undefined)).token}`

  app = Fastify({ logger: false })
  await app.register(fastifyCookie)
  registerErrorHandler(app, silentLogger)
  decorateRequestUser(app)
  const requireUser = createRequireUser({ sessions, repos })
  const requireGm = createRequireGm(requireUser)
  app.get('/probe-user', { preHandler: requireUser }, async (req) => ({ role: currentUser(req).role }))
  app.get('/probe-gm', { preHandler: requireGm }, async () => ({ ok: true }))
  await app.ready()
})
afterEach(async () => {
  await app.close()
  await db.execute(sql`truncate table sessions, players, users restart identity cascade`)
})

const setRole = (role: 'player' | 'gm') => db.execute(sql`update users set role = ${role} where id = ${playerId}`)
const lock = () => db.execute(sql`update users set locked_at = now(), locked_reason = 'test' where id = ${playerId}`)
const get = (url: string) => app.inject({ url, headers: { cookie } })

describe('requireUser', () => {
  it('puts the account role on the request, read from the database each time', async () => {
    expect((await get('/probe-user')).json()).toEqual({ role: 'player' })
    await setRole('gm')
    expect((await get('/probe-user')).json()).toEqual({ role: 'gm' })
  })
})

describe('requireGm', () => {
  it('answers 403 FORBIDDEN to a player and 200 to a gm, reading the role on every request', async () => {
    const denied = await get('/probe-gm')
    expect(denied.statusCode).toBe(403)
    expect(denied.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
    await setRole('gm')
    expect((await get('/probe-gm')).statusCode).toBe(200)
    await setRole('player')
    expect((await get('/probe-gm')).statusCode).toBe(403)
  })

  it('treats a locked account as signed out, whatever cookie it still holds', async () => {
    await setRole('gm')
    await lock()
    expect((await get('/probe-gm')).statusCode).toBe(401)
    const user = await get('/probe-user')
    expect(user.statusCode).toBe(401)
    expect(user.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } })
  })

  it('answers 401 to a request with no cookie, before the role is ever asked', async () => {
    expect((await app.inject('/probe-gm')).statusCode).toBe(401)
  })
})
