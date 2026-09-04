import { ECONOMY } from '@bp/core'
import { registerCsrfGuard, registerErrorHandler, registerTolerantJsonParser, REQUESTED_WITH } from '@bp/http-kit'
import { silentLogger } from '@bp/server-kit'
import fastifyCookie from '@fastify/cookie'
import { sql } from 'drizzle-orm'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAuthService } from '../auth/auth-service.js'
import { SESSION_COOKIE } from '../auth/cookie.js'
import type { SessionService } from '../auth/session-service.js'
import { createSessionService } from '../auth/session-service.js'
import type { AppDb } from '../db/client.js'
import { items, sessions } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import { createRepositories } from '../repos/index.js'
import { registerAuthRoutes } from './routes-auth.js'

/** 8 MiB, one pass: `password.test.ts` pins the production cost; these tests are about HTTP. */
const CHEAP = { memoryCost: 8_192, timeCost: 1, parallelism: 1 }
const SECRET = 'r'.repeat(32)
const START = Date.UTC(2026, 8, 4, 3, 0)
const XRW = { 'x-requested-with': REQUESTED_WITH }
const GOOD = { email: 'binh@example.com', password: 'a good password', displayName: 'Bình An' }
const DEFAULT_ITEMS = ['avatar_default']

let test: TestDb
let db: AppDb
let sessionService: SessionService
let app: FastifyInstance
let nowMs = START

/**
 * The plumbing `buildApp` will wire in Task 6, and no more: the cookie plugin, the tolerant JSON
 * parser, the CSRF guard and the error handler. Without these, `inject` would see neither the real
 * error envelope nor a real `Set-Cookie`, and the assertions below would be about a fiction.
 */
async function buildTestApp(opts: { cookieSecure?: boolean; loginRateLimit?: { limit: number; windowMs: number } } = {}): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false })
  await instance.register(fastifyCookie)
  registerTolerantJsonParser(instance)
  registerCsrfGuard(instance)
  registerErrorHandler(instance, silentLogger)

  const repos = createRepositories(db)
  sessionService = createSessionService(db, { secret: SECRET, now: () => nowMs })
  registerAuthRoutes(instance, {
    auth: createAuthService({ db, repos, sessions: sessionService, catalog: { defaults: () => DEFAULT_ITEMS }, now: () => nowMs, argon2Params: CHEAP }),
    sessions: sessionService,
    repos,
    cookieSecure: opts.cookieSecure ?? true,
    log: silentLogger,
    now: () => nowMs,
    ...(opts.loginRateLimit === undefined ? {} : { loginRateLimit: opts.loginRateLimit }),
  })
  await instance.ready()
  return instance
}

/** The `Set-Cookie` for our session, as a raw header string. */
function setCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie']
  const all = Array.isArray(raw) ? raw : [String(raw ?? '')]
  return all.find((line) => line.startsWith(`${SESSION_COOKIE}=`)) ?? ''
}

function cookieValue(res: { headers: Record<string, unknown> }): string {
  return setCookie(res).split(';')[0]!.slice(SESSION_COOKIE.length + 1)
}

const register = (payload: Record<string, unknown> = GOOD) => app.inject({ method: 'POST', url: '/api/auth/register', headers: XRW, payload })
const login = (payload: Record<string, unknown>, cookie?: string) =>
  app.inject({ method: 'POST', url: '/api/auth/login', headers: cookie === undefined ? XRW : { ...XRW, cookie }, payload })

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
})
afterAll(async () => {
  await test.close()
})
beforeEach(async () => {
  nowMs = START
  await db.insert(items).values(DEFAULT_ITEMS.map((id) => ({ id, category: 'avatar', rarity: 'common', nameKey: id, assetKey: id, isDefault: true })))
  app = await buildTestApp()
})
afterEach(async () => {
  await app.close()
  await db.execute(sql`truncate table sessions, inventory, items, daily_logins, player_stats, point_transactions, players, users restart identity cascade`)
})

describe('POST /api/auth/register', () => {
  it('creates the account, answers 201 with the profile, and sets a hardened session cookie', async () => {
    const res = await register()
    expect(res.statusCode).toBe(201)
    const body = res.json() as { playerId: string; displayName: string; balance: number }
    expect(body).toEqual({ playerId: expect.any(String), displayName: 'Bình An', balance: ECONOMY.startingBalance })

    const cookie = setCookie(res)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=2592000')
    expect(await sessionService.resolve(cookieValue(res))).toMatchObject({ userId: body.playerId })
  })

  it('omits Secure when the operator is on plain http', async () => {
    await app.close()
    app = await buildTestApp({ cookieSecure: false })
    const cookie = setCookie(await register())
    expect(cookie).toContain('HttpOnly')
    expect(cookie).not.toContain('Secure')
  })

  it('answers 400 with the code for whichever field was refused', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ ...GOOD, email: 'not-an-address' }, 'INVALID_EMAIL'],
      [{ ...GOOD, password: 'short' }, 'INVALID_PASSWORD'],
      [{ ...GOOD, displayName: 'x' }, 'INVALID_NAME'],
      [{ password: GOOD.password, displayName: GOOD.displayName }, 'INVALID_EMAIL'],
      [{ email: GOOD.email, displayName: GOOD.displayName }, 'INVALID_PASSWORD'],
      [{ email: GOOD.email, password: GOOD.password }, 'INVALID_NAME'],
    ]
    for (const [payload, code] of cases) {
      const res = await register(payload)
      expect(res.statusCode).toBe(400)
      expect((res.json() as { error: { code: string } }).error.code).toBe(code)
      expect(setCookie(res)).toBe('')
    }
  })

  it('answers 409 EMAIL_TAKEN and 409 DISPLAY_NAME_TAKEN', async () => {
    expect((await register()).statusCode).toBe(201)

    const email = await register({ ...GOOD, email: 'BINH@example.com', displayName: 'Someone Else' })
    expect(email.statusCode).toBe(409)
    expect((email.json() as { error: { code: string } }).error.code).toBe('EMAIL_TAKEN')

    const name = await register({ ...GOOD, email: 'other@example.com' })
    expect(name.statusCode).toBe(409)
    expect((name.json() as { error: { code: string } }).error.code).toBe('DISPLAY_NAME_TAKEN')
  })

  it('is refused without the CSRF header, before any account is created', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: GOOD })
    expect(res.statusCode).toBe(403)
    expect((res.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN')
  })
})

describe('POST /api/auth/login', () => {
  it('answers 200 with the profile and a fresh cookie', async () => {
    const registered = await register()
    nowMs += 60_000
    const res = await login({ email: 'BINH@example.com ', password: GOOD.password })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ playerId: (registered.json() as { playerId: string }).playerId, displayName: 'Bình An', balance: ECONOMY.startingBalance })
    expect(cookieValue(res)).not.toBe(cookieValue(registered))
    expect(setCookie(res)).toContain('HttpOnly')
  })

  it('rotates the session the caller arrived with', async () => {
    const registered = await register()
    const old = cookieValue(registered)
    const res = await login({ email: GOOD.email, password: GOOD.password }, `${SESSION_COOKIE}=${old}`)
    expect(res.statusCode).toBe(200)
    expect(await sessionService.resolve(old)).toBeNull()
    expect(await sessionService.resolve(cookieValue(res))).not.toBeNull()
    expect(await db.select().from(sessions)).toHaveLength(1)
  })

  it('answers 401 BAD_CREDENTIALS for a wrong password and for an address with no account', async () => {
    await register()
    for (const payload of [{ email: GOOD.email, password: 'wrong password' }, { email: 'nobody@example.com', password: 'wrong password' }]) {
      const res = await login(payload)
      expect(res.statusCode).toBe(401)
      expect(res.json()).toEqual({ error: { code: 'BAD_CREDENTIALS', message: expect.any(String) } })
      expect(setCookie(res)).toBe('')
    }
  })

  it('rate limits five attempts a minute per address and place, with Retry-After', async () => {
    await app.close()
    app = await buildTestApp({ loginRateLimit: { limit: 2, windowMs: 60_000 } })
    await register()

    expect((await login({ email: GOOD.email, password: 'wrong password' })).statusCode).toBe(401)
    expect((await login({ email: GOOD.email, password: 'wrong password' })).statusCode).toBe(401)

    const limited = await login({ email: GOOD.email, password: GOOD.password })
    expect(limited.statusCode).toBe(429)
    expect(limited.json()).toEqual({ error: { code: 'RATE_LIMITED', message: expect.any(String) }, retryAfterSec: 60 })
    expect(limited.headers['retry-after']).toBe('60')

    // The limit is per address: a different one from the same place is unaffected.
    expect((await login({ email: 'someone@example.com', password: 'wrong password' })).statusCode).toBe(401)

    // And the window rolls over.
    nowMs += 60_000
    expect((await login({ email: GOOD.email, password: GOOD.password })).statusCode).toBe(200)
  })
})

describe('POST /api/auth/logout', () => {
  it('revokes the session, clears the cookie, and answers 204', async () => {
    const registered = await register()
    const token = cookieValue(registered)
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...XRW, cookie: `${SESSION_COOKIE}=${token}` } })
    expect(res.statusCode).toBe(204)
    expect(setCookie(res)).toContain('Max-Age=0')
    expect(await sessionService.resolve(token)).toBeNull()
  })

  it('answers 204 and clears the cookie even with no session at all', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: XRW })
    expect(res.statusCode).toBe(204)
    expect(setCookie(res)).toContain('Max-Age=0')
  })
})

describe('GET /api/auth/me', () => {
  it('answers the profile behind a live cookie', async () => {
    const registered = await register()
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: `${SESSION_COOKIE}=${cookieValue(registered)}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ playerId: (registered.json() as { playerId: string }).playerId, displayName: 'Bình An', balance: ECONOMY.startingBalance })
  })

  it('answers 401 UNAUTHENTICATED with no cookie, a nonsense cookie, or one that has been logged out', async () => {
    const registered = await register()
    const token = cookieValue(registered)
    const me = (cookie?: string) => app.inject({ method: 'GET', url: '/api/auth/me', ...(cookie === undefined ? {} : { headers: { cookie } }) })

    expect((await me()).statusCode).toBe(401)
    expect((await me(`${SESSION_COOKIE}=made-up`)).statusCode).toBe(401)
    expect((await me('lang=vi')).statusCode).toBe(401)

    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...XRW, cookie: `${SESSION_COOKIE}=${token}` } })
    const after = await me(`${SESSION_COOKIE}=${token}`)
    expect(after.statusCode).toBe(401)
    expect(after.json()).toEqual({ error: { code: 'UNAUTHENTICATED', message: expect.any(String) } })
  })

  it('answers 401 once the session has expired rather than resurrecting it', async () => {
    const registered = await register()
    nowMs += 31 * 86_400_000
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: `${SESSION_COOKIE}=${cookieValue(registered)}` } })
    expect(res.statusCode).toBe(401)
  })
})
