/**
 * The assembled server: `buildApp` on a throwaway PGlite, exercised the way a browser and an
 * orchestrator would exercise it.
 *
 * The parts that only exist once everything is wired together are what is tested here — the health
 * probe, the boot configuration, the CSP, the static fallback, the rate limits, the
 * cookie-authenticated WebSocket upgrade, a whole hand between two registered players, and the
 * shutdown. The per-route bodies live in `http/routes-*.test.ts`.
 *
 * One PGlite for the file, one `buildApp` per test: the migrations are seconds, and the app is
 * milliseconds.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { ECONOMY, type RoomConfig } from '@bp/core'
import { assetSourceFromDir, DEFAULT_CSP, type AssetSource } from '@bp/http-kit'
import { enumerateRoutes, mutatingRoutes } from '@bp/http-kit/testing'
import type { Logger } from '@bp/server-kit'
import { TestClient } from '@bp/server-kit/testing'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { FONTS_FILE_HOST, FONTS_STYLESHEET_HOST, logSettlementFailure, normalCsp, SCRIPT_SRC, SESSION_SWEEP_INTERVAL_MS, UPGRADE_RATE_LIMIT } from './app.js'
import { CONFIG_DEFAULTS } from './config.js'
import { rowsOf, type AppDb } from './db/client.js'
import { ledgerKeys, sessions as sessionsTable, users } from './db/schema.js'
import { createTestDb, type TestDb } from './db/test-db.js'
import { HEALTH_PING_TIMEOUT_MS, OWN_LIMITER, READ_RATE_LIMIT, WRITE_IP_RATE_LIMIT, WRITE_RATE_LIMIT } from './http/routes.js'
import { buildTestApp, ORIGIN, resetDb, START, XRW, type Harness, type HarnessOptions } from './test-harness.js'

/**
 * Two humans, no bots, no decisions: the shortest hand this engine can play. Everything after the
 * deal is a timer, and the timers are shortened to nothing by the room options below — so the hand
 * settles as fast as the event loop allows and the test never sleeps on a real 1.5 s reveal.
 */
const BLIND_ROOM: RoomConfig = {
  name: 'Bàn thử', mode: 'blind', maxPlayers: 4, isPrivate: false, turnTimerSec: 15, autoStart: false,
  blind: { holeCards: 2, decisionMode: 'none', fixedWager: 1_000, botCount: 0 },
}
/**
 * A hand that settles instantly and a table that then sits still.
 *
 * `revealDelayMs` is the only pause inside the hand, so it goes to nothing; `handIntervalMs` is the
 * gap before the *next* hand, and it is pushed out of reach — the room deals again on its own while
 * both seats stay ready, and a second hand landing mid-assertion is exactly the flake this avoids.
 */
const FAST_ROOM = { handIntervalMs: 600_000, revealDelayMs: 10, botDelayMs: [0, 0] as [number, number] }
const SECOND_ACCOUNT = { email: 'mai@example.com', password: 'another good password', displayName: 'Mai Lan' }

/**
 * A UI bundle that throws when it is read — the cheapest honest way to make a handler fail *after*
 * the request has been accepted, which is the one path that produces a real 500. Everything else a
 * test can arrange (a bad body, a missing session, an unreachable database) is answered deliberately
 * with a 4xx or a 503, and would say nothing about what happens when the server is simply wrong.
 */
const EXPLODING_MESSAGE = 'the asset source is on fire'
const EXPLODING_ASSETS: AssetSource = {
  get() { throw new Error(EXPLODING_MESSAGE) },
  has() { return true },
}

let test: TestDb
let db: AppDb
const live: Harness[] = []
const clients: TestClient[] = []
const dirs: string[] = []

const code = (res: { json(): unknown }): string => (res.json() as { error: { code: string } }).error.code

async function harness(opts: HarnessOptions = {}): Promise<Harness> {
  const h = await buildTestApp(db, opts)
  live.push(h)
  return h
}

/** Binds the listener on an ephemeral port and answers with `http://127.0.0.1:<port>`. */
async function listen(h: Harness): Promise<string> {
  await h.app.fastify.listen({ port: 0, host: '127.0.0.1' })
  const address = h.app.fastify.server.address() as AddressInfo
  return `http://127.0.0.1:${String(address.port)}`
}

async function connect(base: string, headers: Record<string, string> = {}): Promise<TestClient> {
  const client = await TestClient.connect(`${base.replace('http://', 'ws://')}/ws`, { origin: ORIGIN, ...headers })
  clients.push(client)
  return client
}

/** A directory that looks like a built `normal-web`. */
function publicDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bp-normal-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Blind Luck Poker</title><div id="root"></div>')
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)')
  return dir
}

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
})
afterAll(async () => {
  await test.close()
})
afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => {})
  for (const h of live.splice(0)) await h.app.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  await resetDb(db)
})

describe('GET /health', () => {
  /**
   * The body is Lite's, plus `edition` and `version`, so one monitoring check serves both editions
   * (`apps/lite/server/src/http/routes.ts`). Asserted exactly rather than loosely: a key quietly
   * renamed here is a check that silently stops meaning anything over there.
   */
  it('answers the Lite-shaped body, plus the edition and version', async () => {
    const h = await harness()
    const res = await h.app.fastify.inject('/health')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      status: 'ok',
      uptime: expect.any(Number),
      connections: 0,
      rooms: 0,
      db: 'ok',
      edition: 'normal',
      version: expect.any(String),
    })
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('answers 503 with db: error when the pool cannot be reached', async () => {
    const h = await harness()
    h.setDbUp(false)
    const res = await h.app.fastify.inject('/health')
    expect(res.statusCode).toBe(503)
    expect(res.json()).toMatchObject({ status: 'degraded', db: 'error' })
  })

  it('counts the live sockets and rooms the way Lite does', async () => {
    const h = await harness()
    const me = await h.register()
    const base = await listen(h)
    await connect(base, { cookie: me.cookie })

    await vi.waitFor(async () => {
      const body = (await h.app.fastify.inject('/health')).json() as { connections: number; rooms: number }
      expect(body).toMatchObject({ connections: 1, rooms: 0 })
    })
  })

  /**
   * The failure the 503 exists for. A pool with every client checked out — or a server that accepted
   * the connection and stopped answering — leaves the probe outstanding forever, and Fastify's
   * `requestTimeout` is 0, so without a deadline of its own `/health` would never answer at all and
   * the orchestrator would learn nothing.
   */
  it('answers 503 rather than hanging when the probe never settles', async () => {
    const h = await harness()
    h.hangDbProbe()
    const startedAt = Date.now()
    const res = await h.app.fastify.inject('/health')
    expect(res.statusCode).toBe(503)
    expect(res.json()).toMatchObject({ status: 'degraded', db: 'error' })
    expect(Date.now() - startedAt).toBeLessThan(HEALTH_PING_TIMEOUT_MS * 3)
  })

  it('answers 503 when the probe rejects outright', async () => {
    const h = await harness()
    h.setDbProbe(() => Promise.reject(new Error('ECONNREFUSED')))
    const res = await h.app.fastify.inject('/health')
    expect(res.statusCode).toBe(503)
    expect(res.json()).toMatchObject({ status: 'degraded', db: 'error' })
  })
})

describe('GET /api/config', () => {
  it('publishes the boot configuration a client needs before it has a session', async () => {
    const h = await harness({ config: { reconnectWindowSec: 45 } })
    const res = await h.app.fastify.inject('/api/config')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      edition: 'normal',
      wsPath: '/ws',
      economy: {
        startingBalance: ECONOMY.startingBalance,
        blindWagerTiers: [...ECONOMY.blindWagerTiers],
        holdemBlindTiers: ECONOMY.holdemBlindTiers.map((t) => ({ smallBlind: t.smallBlind, bigBlind: t.bigBlind })),
        reliefThreshold: ECONOMY.reliefThreshold,
        reliefTarget: ECONOMY.reliefTarget,
      },
      languages: ['vi', 'en'],
      reconnectWindowSec: 45,
    })
  })

  it('serves the catalogues without a session, because they are the same for everyone', async () => {
    const h = await harness()
    const items = await h.app.fastify.inject('/api/catalog/items')
    expect(items.statusCode).toBe(200)
    expect((items.json() as { items: unknown[] }).items.length).toBeGreaterThan(0)

    const achievements = await h.app.fastify.inject('/api/catalog/achievements')
    expect(achievements.statusCode).toBe(200)
    expect((achievements.json() as { achievements: unknown[] }).achievements).toHaveLength(h.app.services.defs.length)
  })

  it('serves the named daily gifts beside the catalogue, from the current month on', async () => {
    const h = await harness()
    type Gifts = { dailyGifts: { itemId: string; day: number; month: string | null }[] }
    const before = (await h.app.fastify.inject('/api/catalog/items')).json() as Gifts
    // September 2026 (the harness's START): the pair every month gives, then the six epics, one a month from November.
    expect(before.dailyGifts).toEqual(
      expect.arrayContaining([
        { itemId: 'badge_monthly', day: 28, month: null },
        { itemId: 'title_devoted', day: 28, month: null },
      ]),
    )
    expect(before.dailyGifts.find((g) => g.itemId === 'head_tophat01')).toEqual({ itemId: 'head_tophat01', day: 28, month: '2026-11' })
    expect(before.dailyGifts.find((g) => g.itemId === 'eyecolor_gold01')).toEqual({ itemId: 'eyecolor_gold01', day: 28, month: '2027-04' })

    // December: November's top hat is no longer promised for November (a later month may give it again); the eyepatch
    // is this month's.
    h.setNow(Date.UTC(2026, 11, 2, 3, 0))
    const later = (await h.app.fastify.inject('/api/catalog/items')).json() as Gifts
    expect(later.dailyGifts.find((g) => g.itemId === 'head_tophat01')?.month ?? null).not.toBe('2026-11')
    expect(later.dailyGifts.find((g) => g.itemId === 'face_eyepatch01')).toEqual({ itemId: 'face_eyepatch01', day: 28, month: '2026-12' })
  })

  it('answers the avatar rig: the frame, the crop and the v4 bodies, f then m — and no bases any more', async () => {
    const h = await harness()
    const res = await h.app.fastify.inject('/api/catalog/avatar')
    expect(res.statusCode).toBe(200)
    const answer = res.json() as {
      bodies: { gender: string; body: string; faces: Record<string, string>; naturalEyeColour: string; tint?: { skin?: unknown; eyes?: unknown } }[]
    }
    // Exactly these keys: a v3 client still reading `bases` finds nothing rather than a stale registry (spec §4.3).
    expect(Object.keys(answer).sort()).toEqual(['bodies', 'crop', 'frame', 'manifestVersion'])
    expect(answer.bodies.map((body) => body.gender)).toEqual(['f', 'm'])
    expect(answer.bodies[0]).toMatchObject({ gender: 'f', body: 'body_f_L30', naturalEyeColour: '#2a6492', faces: { neutral: 'body_f_face_neutral_L50' } })
    expect(answer.bodies[1]).toMatchObject({ gender: 'm', body: 'body_m_L30', naturalEyeColour: '#945e26', faces: { sleep: 'body_m_face_sleep_L50' } })
    // The derived tint travels with it (ruling 5): the client never measures a body itself.
    for (const body of answer.bodies) expect(body.tint?.skin, body.gender).toBeDefined()
    expect(h.app.services.bodies.f.gender).toBe('f')
    expect(h.app.services).not.toHaveProperty('bases')
  })
})

describe('security headers', () => {
  it('extends the shared CSP with the two hosts Google Fonts needs and blob: images, and nothing else', async () => {
    const h = await harness()
    const csp = (await h.app.fastify.inject('/health')).headers['content-security-policy'] as string
    expect(csp).toBe(normalCsp())
    // The whole header, written out: a directive that drifts — or one that is quietly widened — is a diff here.
    expect(csp).toBe(
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; " +
        "font-src 'self' https://fonts.gstatic.com; script-src 'self'",
    )
    const directives = new Map(csp.split('; ').map((d) => [d.split(' ')[0], d]))
    expect(directives.get('style-src')).toBe(`style-src 'self' 'unsafe-inline' ${FONTS_STYLESHEET_HOST}`)
    expect(directives.get('font-src')).toBe(`font-src 'self' ${FONTS_FILE_HOST}`)
    // A recoloured avatar layer (Plan 13) is an image the page draws on a canvas and shows through a
    // `blob:` object URL, so `img-src` — and only `img-src` — accepts `blob:`. Without it the browser
    // refuses every tinted layer: a hair colour blanks the head, an eye colour does nothing (No15, No16).
    expect(directives.get('img-src')).toBe("img-src 'self' data: blob:")
    expect(csp.split('blob:')).toHaveLength(2)
    // Scripts stay `'self'`: written out explicitly, and equal to what default-src already said.
    expect(directives.get('script-src')).toBe(SCRIPT_SRC)
    // Everything else the shared default said is still said, word for word.
    for (const directive of DEFAULT_CSP.split('; ')) {
      if (directive.startsWith('style-src ') || directive.startsWith('img-src ')) continue
      expect(csp).toContain(directive)
    }
  })

  it('sets the rest of the header list on every response, handled or not', async () => {
    const h = await harness()
    for (const url of ['/health', '/api/config', '/nope']) {
      const res = await h.app.fastify.inject(url)
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['referrer-policy']).toBe('no-referrer')
      expect(res.headers['x-frame-options']).toBe('DENY')
    }
  })

  /**
   * The two answers a header hook is easiest to lose: a 404, which no handler produced, and a 500,
   * which a handler abandoned halfway. `registerSecurityHeaders` hooks `onRequest` precisely so
   * that neither can escape it — this is the test that says so, and it also pins the other half of
   * §23's "lộ thông tin" row: an unexpected throw answers with a fixed envelope and the detail
   * stays in the log.
   */
  it('sets them on a 404 and on a 500, and lets nothing of the error into the body', async () => {
    const h = await harness({ assets: EXPLODING_ASSETS })
    for (const [what, res] of [
      ['404', await h.app.fastify.inject('/api/unknown')],
      ['500', await h.app.fastify.inject('/anything')],
    ] as const) {
      expect(res.statusCode, what).toBe(what === '404' ? 404 : 500)
      expect(res.headers['x-content-type-options'], what).toBe('nosniff')
      expect(res.headers['referrer-policy'], what).toBe('no-referrer')
      expect(res.headers['x-frame-options'], what).toBe('DENY')
      expect(res.headers['content-security-policy'], what).toBe(normalCsp())
    }
    const failed = await h.app.fastify.inject('/anything')
    expect(failed.json()).toEqual({ error: { code: 'INTERNAL', message: 'internal server error' } })
    expect(failed.body).not.toContain(EXPLODING_MESSAGE)
    expect(failed.body).not.toContain('at ')
  })
})

/**
 * The guards, asserted over the *whole* surface rather than route by route.
 *
 * The failure this is aimed at is not a guard that stopped working — the tests above cover those —
 * but a route added later that never had one. `GET /api/…` is a read; a `POST`, `PUT`, `PATCH` or
 * `DELETE` under `/api` changes something, and §19.2 says every one of them must carry the CSRF
 * header and be metered. Enumerating the routes out of the finished app and then looping over them
 * means the check covers a route the moment it exists, instead of the moment somebody remembers.
 */
describe('every mutating route is guarded', () => {
  /** The general bucket, lowered so the metering loop reaches it in a handful of requests. */
  const TEST_WRITE_LIMIT = { limit: 2, windowMs: 60_000 }
  /**
   * How many requests one route gets before the test gives up looking for a 429 — the loosest
   * limiter any route under test carries, plus the one request that must be refused.
   *
   * Derived rather than written down, because a constant would silently encode "no route has a
   * limiter looser than this": a route added later with a 20/min bucket is perfectly guarded and
   * would fail a fixed budget of 12, and the next person would raise the number instead of thinking.
   */
  const BUDGET = Math.max(TEST_WRITE_LIMIT.limit, ...[...OWN_LIMITER.values()].map((l) => l.limit)) + 1
  /** Long enough that a route's own window never overlaps the previous route's. */
  const WINDOW_MS = 120_000

  /**
   * Mutating routes that are deliberately not metered. Empty, and asserted to be: the enumeration
   * below covers *every* mutating route, not only the ones under `/api`, so a `POST` mounted
   * anywhere else has to be answered for here rather than quietly falling outside the loop.
   */
  const UNMETERED_BY_DESIGN: readonly string[] = []

  /**
   * `POST /api/auth/login` rate-limits in a `preHandler` that reads the email first, so a request
   * without one is a 400 that the limiter never sees. Everything else reaches its limiter on an
   * empty body — and stopping there keeps the 400 in front of argon2 rather than behind it.
   */
  const PAYLOAD: Record<string, unknown> = { '/api/auth/login': { email: 'nobody@example.com' } }

  const label = (r: { method: string; path: string }): string => `${r.method} ${r.path}`

  it('answers exactly the surface §19.2 describes, and nothing else', async () => {
    const h = await harness()
    expect(enumerateRoutes(h.app.fastify).map(label).sort()).toEqual([
      'GET *', // the static fallback: `/*` is printed as a bare `*`
      'GET /api/auth/me',
      'GET /api/catalog/achievements',
      'GET /api/catalog/avatar',
      'GET /api/catalog/items',
      'GET /api/config',
      'GET /api/gm/actions',
      'GET /api/gm/overview',
      'GET /api/gm/players/:id',
      'GET /api/gm/players/:id/history',
      'GET /api/gm/players/:id/ledger',
      'GET /api/gm/rooms',
      'GET /api/gm/rooms/:id',
      'GET /api/me',
      'GET /api/me/achievements',
      'GET /api/me/history',
      'GET /api/me/inventory',
      'GET /api/me/ledger',
      'GET /api/me/outfits',
      'GET /api/me/stats',
      'GET /api/players/:id/avatar',
      'GET /api/rewards/daily',
      'GET /health',
      'PATCH /api/me',
      'POST /api/auth/login',
      'POST /api/auth/logout',
      'POST /api/auth/register',
      'POST /api/economy/relief',
      'POST /api/gm/players/:id/items',
      'POST /api/gm/players/:id/lock',
      'POST /api/gm/players/:id/points',
      'POST /api/gm/players/:id/role',
      'POST /api/gm/players/:id/unlock',
      'POST /api/gm/players/search',
      'POST /api/gm/rooms/:id/close',
      'POST /api/gm/rooms/:id/kick',
      'POST /api/me/outfits/:slot/apply',
      'POST /api/rewards/daily/claim',
      'PUT /api/me/avatar',
      'PUT /api/me/outfits/:slot',
      'DELETE /api/me/outfits/:slot',
    ].sort())
  })

  it('refuses each of them without X-Requested-With, before auth and before the limiter', async () => {
    const h = await harness()
    const routes = mutatingRoutes(h.app.fastify)
    // A list that came back empty would make every assertion below vacuously true.
    expect(routes.length).toBeGreaterThanOrEqual(7)
    for (const route of routes) {
      const res = await h.app.fastify.inject({ method: route.method, url: route.path, payload: {} })
      expect(res.statusCode, label(route)).toBe(403)
      expect(code(res), label(route)).toBe('FORBIDDEN')
    }
  })

  /**
   * One fresh window per route, because the general bucket is shared: without the clock moving, the
   * first route would spend the whole allowance and every route after it would answer 429 without
   * ever having been metered itself — a test that passes for an unguarded route, which is worse
   * than none.
   */
  it('meters each of them, whether by the general bucket or by one of its own', async () => {
    const h = await harness({ writeRateLimit: TEST_WRITE_LIMIT })
    const routes = mutatingRoutes(h.app.fastify).filter((r) => !UNMETERED_BY_DESIGN.includes(label(r)))
    expect(routes.length).toBeGreaterThanOrEqual(7)
    let at = START
    for (const route of routes) {
      at += WINDOW_MS
      h.setNow(at)
      const seen: number[] = []
      for (let i = 0; i < BUDGET && !seen.includes(429); i += 1) {
        const res = await h.app.fastify.inject({ method: route.method, url: route.path, headers: XRW, payload: PAYLOAD[route.path] ?? {} })
        seen.push(res.statusCode)
        if (res.statusCode === 429) {
          expect(code(res), label(route)).toBe('RATE_LIMITED')
          expect(res.headers['retry-after'], label(route)).toBeDefined()
        }
      }
      expect(seen, `${label(route)} was never rate limited in ${String(BUDGET)} requests`).toContain(429)
    }
  })

  /**
   * Which routes step over the general bucket, and what each carries instead — said out loud rather
   * than left to be inferred. The metering loop above does cover a wrongly exempted route, but it
   * fails with "was never rate limited", which points at the route rather than at the exemption
   * that caused it.
   */
  it('leaves sign-in and sign-up to their own, tighter limiters', () => {
    expect(Object.fromEntries(OWN_LIMITER)).toEqual({
      '/api/auth/register': { limit: 10, windowMs: 60_000 },
      '/api/auth/login': { limit: 5, windowMs: 60_000 },
    })
    // Every exemption is tighter than the bucket it steps over; otherwise it would be a loophole.
    for (const [path, own] of OWN_LIMITER) expect(own.limit, path).toBeLessThan(WRITE_RATE_LIMIT.limit)
  })

  /** No mutating route is mounted outside `/api`, which is what the limiter hook keys on. */
  it('mounts every mutating route under /api, where the limiter looks', async () => {
    const h = await harness()
    expect(mutatingRoutes(h.app.fastify).filter((r) => !r.path.startsWith('/api/')).map(label)).toEqual([])
    expect(UNMETERED_BY_DESIGN).toEqual([])
  })
})

describe('the CSRF guard', () => {
  it('refuses a mutating request that does not carry X-Requested-With, before it reaches a handler', async () => {
    const h = await harness()
    const res = await h.app.fastify.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'binh@example.com', password: 'a good password', displayName: 'Bình An' },
    })
    expect(res.statusCode).toBe(403)
    expect(code(res)).toBe('FORBIDDEN')
    const counted = rowsOf<{ count: number }>(await db.execute(sql`select count(*)::int as count from users`))
    expect(Number(counted[0]?.count)).toBe(0)
  })
})

describe('static assets', () => {
  it('serves the SPA and falls back to index.html for client routes', async () => {
    const h = await harness({ assets: assetSourceFromDir(publicDir()) })
    const index = await h.app.fastify.inject('/')
    expect(index.statusCode).toBe(200)
    expect(index.body).toContain('<div id="root">')

    const hashed = await h.app.fastify.inject('/assets/app-abc123.js')
    expect(hashed.headers['cache-control']).toBe('public, max-age=31536000, immutable')

    const route = await h.app.fastify.inject('/lobby')
    expect(route.statusCode).toBe(200)
    expect(route.body).toContain('<div id="root">')
  })

  it('never lets the fallback answer for the API, the socket or the probe', async () => {
    const h = await harness({ assets: assetSourceFromDir(publicDir()) })
    for (const url of ['/api/unknown', '/ws', '/health/deep']) {
      const res = await h.app.fastify.inject(url)
      expect(res.statusCode, url).toBe(404)
      expect(code(res)).toBe('NOT_FOUND')
    }
  })

  it('404s every path when there is no UI bundle, which is a valid API-only deployment', async () => {
    const h = await harness()
    const res = await h.app.fastify.inject('/')
    expect(res.statusCode).toBe(404)
  })
})

describe('rate limits', () => {
  it('meters writes per session and reads per address, and lets an unmetered session through', async () => {
    const h = await harness({ writeRateLimit: { limit: 2, windowMs: 60_000 }, readRateLimit: { limit: 3, windowMs: 60_000 } })
    const me = await h.register()
    const other = await h.register(SECOND_ACCOUNT)

    for (let i = 0; i < 2; i += 1) {
      const ok = await h.app.fastify.inject({ method: 'POST', url: '/api/economy/relief', headers: h.auth(me) })
      expect(ok.statusCode).toBe(409) // not eligible, but it reached the handler
    }
    const limited = await h.app.fastify.inject({ method: 'POST', url: '/api/economy/relief', headers: h.auth(me) })
    expect(limited.statusCode).toBe(429)
    expect(code(limited)).toBe('RATE_LIMITED')
    expect(limited.headers['retry-after']).toBeDefined()

    // A different session has its own bucket: the limit is per session, not per server.
    const elsewhere = await h.app.fastify.inject({ method: 'POST', url: '/api/economy/relief', headers: h.auth(other) })
    expect(elsewhere.statusCode).toBe(409)

    for (let i = 0; i < 3; i += 1) expect((await h.app.fastify.inject('/api/config')).statusCode).toBe(200)
    expect((await h.app.fastify.inject('/api/config')).statusCode).toBe(429)
    // The probe is what a load balancer polls; it is never metered.
    expect((await h.app.fastify.inject('/health')).statusCode).toBe(200)
  })

  it('leaves sign-in and sign-up to their own, tighter limiters', async () => {
    const h = await harness({ writeRateLimit: { limit: 1, windowMs: 60_000 }, writeIpRateLimit: { limit: 1, windowMs: 60_000 } })
    await h.register()
    for (let i = 0; i < 3; i += 1) {
      const res = await h.app.fastify.inject({ method: 'POST', url: '/api/auth/login', headers: XRW, payload: { email: 'binh@example.com', password: 'wrong password' } })
      expect(res.statusCode, `attempt ${String(i)}`).toBe(401)
    }
  })

  /**
   * The exemption is those two requests, not the namespace they live in. `GET /api/auth/me` costs a
   * session lookup and a player select, `POST /api/auth/logout` a delete, and `registerAuthRoutes`
   * limits neither — so exempting the whole prefix would leave a free authenticated load path.
   */
  it('meters the auth routes that have no limiter of their own', async () => {
    const h = await harness({ writeRateLimit: { limit: 1, windowMs: 60_000 }, readRateLimit: { limit: 1, windowMs: 60_000 } })
    const me = await h.register()

    expect((await h.app.fastify.inject({ url: '/api/auth/me', headers: { cookie: me.cookie } })).statusCode).toBe(200)
    const read = await h.app.fastify.inject({ url: '/api/auth/me', headers: { cookie: me.cookie } })
    expect(read.statusCode).toBe(429)
    expect(code(read)).toBe('RATE_LIMITED')

    expect((await h.app.fastify.inject({ method: 'POST', url: '/api/auth/logout', headers: h.auth(me) })).statusCode).toBe(204)
    expect((await h.app.fastify.inject({ method: 'POST', url: '/api/auth/logout', headers: h.auth(me) })).statusCode).toBe(429)
  })

  /**
   * A caller that invents a fresh `bp_session` per request gets a fresh per-session bucket every
   * time, so the session limit alone can never bind on that traffic. The address bucket is what
   * does — and the request is still refused before `requireUser` looks anything up.
   */
  it('meters a caller that rotates its cookie, because a write must satisfy the address bucket too', async () => {
    const h = await harness({ writeIpRateLimit: { limit: 3, windowMs: 60_000 } })
    const bogus = (i: number) => ({ cookie: `bp_session=made-up-${String(i)}`, ...XRW })

    for (let i = 0; i < 3; i += 1) {
      // Each one is a brand-new session bucket, and each is refused by `requireUser` — but counted.
      expect((await h.app.fastify.inject({ method: 'POST', url: '/api/economy/relief', headers: bogus(i) })).statusCode).toBe(401)
    }
    const limited = await h.app.fastify.inject({ method: 'POST', url: '/api/economy/relief', headers: bogus(99) })
    expect(limited.statusCode).toBe(429)
    expect(code(limited)).toBe('RATE_LIMITED')
  })

  it('caps a place at twice what it caps a session at, by default', async () => {
    expect(WRITE_RATE_LIMIT).toEqual({ limit: 60, windowMs: 60_000 })
    expect(WRITE_IP_RATE_LIMIT).toEqual({ limit: 120, windowMs: 60_000 })
    expect(READ_RATE_LIMIT).toEqual({ limit: 240, windowMs: 60_000 })
  })
})

/**
 * The regression for the blocker: with the deployment's own trust setting, an injected
 * `X-Forwarded-For` must not buy a caller a fresh rate-limit bucket.
 *
 * `TRUST_PROXY=true` used to compile to "trust every hop", which made `req.ip` the *left-most*
 * `X-Forwarded-For` entry — the one the client wrote, because Caddy appends rather than replaces —
 * so every IP-keyed limiter in this edition (registration, login, the address bucket that exists
 * precisely to stop a caller rotating its cookie) was bypassed by varying one header per request.
 * `loadConfig` now refuses `true`; Compose sets `uniquelocal`, which is what is exercised here.
 */
describe('trusted proxies', () => {
  const DEPLOYED = { config: { trustProxy: 'uniquelocal' }, readRateLimit: { limit: 1, windowMs: 60_000 } }
  /** Every `ip` the app logged, in order — `warn('rate limited', { ip })` is `req.ip` verbatim. */
  function ipRecorder(): { log: Logger; ips: string[] } {
    const ips: string[] = []
    const note = (_msg: string, data?: object): void => {
      const ip = (data as { ip?: unknown } | undefined)?.ip
      if (typeof ip === 'string') ips.push(ip)
    }
    return { ips, log: { debug: () => {}, info: () => {}, warn: note, error: note } }
  }

  it('ignores a spoofed X-Forwarded-For from an address that is not a trusted proxy', async () => {
    const { log, ips } = ipRecorder()
    const h = await harness({ ...DEPLOYED, log })
    const get = (xff: string) =>
      h.app.fastify.inject({ url: '/api/config', remoteAddress: '203.0.113.9', headers: { 'x-forwarded-for': xff } })

    expect((await get('1.2.3.4')).statusCode).toBe(200)
    // A different header, and — before the fix — a brand-new bucket. It is the same caller.
    expect((await get('5.6.7.8')).statusCode).toBe(429)
    expect((await get('9.9.9.9')).statusCode).toBe(429)
    // …and `req.ip`, as the limiter saw it, was the socket peer every time.
    expect(ips).toEqual(['203.0.113.9', '203.0.113.9'])
  })

  it('reads the forwarded address when the proxy really is one of the trusted hops', async () => {
    const { log, ips } = ipRecorder()
    const h = await harness({ ...DEPLOYED, log })
    // 10.0.0.5 is inside `uniquelocal`: this is Caddy on the Compose bridge network.
    const get = (xff: string) =>
      h.app.fastify.inject({ url: '/api/config', remoteAddress: '10.0.0.5', headers: { 'x-forwarded-for': xff } })

    // Two different real clients behind the one proxy: each gets its own bucket, as it must.
    expect((await get('198.51.100.1')).statusCode).toBe(200)
    expect((await get('198.51.100.2')).statusCode).toBe(200)
    expect((await get('198.51.100.1')).statusCode).toBe(429)
    expect(ips).toEqual(['198.51.100.1'])
  })

  it('ignores the header entirely when nothing is trusted, which is the default', async () => {
    const h = await harness({ readRateLimit: { limit: 1, windowMs: 60_000 } })
    expect(CONFIG_DEFAULTS.trustProxy).toBe(false)
    const get = (xff: string) => h.app.fastify.inject({ url: '/api/config', remoteAddress: '203.0.113.9', headers: { 'x-forwarded-for': xff } })
    expect((await get('1.2.3.4')).statusCode).toBe(200)
    expect((await get('5.6.7.8')).statusCode).toBe(429)
  })
})

describe('logSettlementFailure', () => {
  const summary = {
    handId: 'h-42', roomId: 'room-7', mode: 'holdem' as const, startedAt: 0, endedAt: 1, fee: 150, cancelled: false, players: [],
    config: { name: 'Bàn 1', mode: 'holdem' as const, maxPlayers: 6, isPrivate: false, hasPassword: false, turnTimerSec: 30, autoStart: true },
  }

  it('raises an error line for a hand that was recorded but never paid', () => {
    const lines: { msg: string; data?: object }[] = []
    const log: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: (msg, data) => lines.push({ msg, ...(data === undefined ? {} : { data }) }) }

    logSettlementFailure(log, { type: 'HAND_SETTLED', summary: { ...summary, settlementError: 'pool timeout' } })
    expect(lines).toEqual([{ msg: 'hand settlement failed', data: { handId: 'h-42', roomId: 'room-7', fee: 150, err: 'pool timeout' } }])

    // A hand that settled, and an event that is not a settlement, say nothing.
    logSettlementFailure(log, { type: 'HAND_SETTLED', summary })
    logSettlementFailure(log, { type: 'ROOM_JOINED', roomId: 'room-7', playerId: 'p1' })
    expect(lines).toHaveLength(1)
  })
})

/**
 * The upgrade was the one internet-facing entry point nothing metered. Every refused one still cost
 * a `sessions` primary-key lookup on a pool of ten connections, so an unauthenticated flood turned
 * into sustained database work; and a signed-in caller could open sockets without bound.
 */
describe('websocket upgrade metering', () => {
  it('refuses past the limit with a 429 before it ever looks a session up', async () => {
    let lookups = 0
    const h = await harness({ upgradeRateLimit: { limit: 2, windowMs: 60_000 } })
    const me = await h.register()
    const base = await listen(h)
    // Counted through the service the resolver calls: a metered refusal must not reach it.
    const real = h.app.services.auth.identityForToken.bind(h.app.services.auth)
    h.app.services.auth.identityForToken = async (token) => {
      lookups += 1
      return real(token)
    }

    await connect(base, { cookie: me.cookie })
    await connect(base, { cookie: me.cookie })
    await expect(connect(base, { cookie: me.cookie })).rejects.toThrow('unexpected response 429')
    expect(lookups).toBe(2)
  })

  it('answers 503 once it is holding as many connections as it is configured for', async () => {
    const h = await harness({ config: { maxConnections: 1 } })
    const me = await h.register()
    const base = await listen(h)

    const first = await connect(base, { cookie: me.cookie })
    await first.next('WELCOME')
    await expect(connect(base, { cookie: me.cookie })).rejects.toThrow('unexpected response 503')
  })

  it('meters thirty upgrades a minute per address by default', () => {
    expect(UPGRADE_RATE_LIMIT).toEqual({ limit: 30, windowMs: 60_000 })
  })
})

/**
 * `session-service` deletes an expired row only when its token is presented, which never happens for
 * a player who does not come back — so without this their rows sit in the table for the life of the
 * database. The interval is injectable purely so the test does not wait an hour.
 */
describe('the expired-session sweep', () => {
  it('deletes rows past their expiry and leaves the live ones alone', async () => {
    const h = await harness({ sessionSweepIntervalMs: 5 })
    const me = await h.register()
    await db.insert(sessionsTable).values({
      id: 'dead-session-of-a-player-who-never-came-back',
      userId: (await db.select({ id: users.id }).from(users))[0]!.id,
      expiresAt: new Date(START - 1),
      createdAt: new Date(START - 100),
      lastSeenAt: new Date(START - 100),
    })
    expect(await db.select({ id: sessionsTable.id }).from(sessionsTable)).toHaveLength(2)

    await vi.waitFor(async () => {
      expect(await db.select({ id: sessionsTable.id }).from(sessionsTable)).toHaveLength(1)
    })
    // The live session still resolves: the sweep is about expiry, not about signing anyone out.
    expect((await h.app.fastify.inject({ url: '/api/auth/me', headers: { cookie: me.cookie } })).statusCode).toBe(200)
  })

  it('stops sweeping once the app is closed', async () => {
    const h = await harness({ sessionSweepIntervalMs: 5 })
    await h.app.close()
    live.length = 0
    // Nothing to assert but the absence of a timer holding the process open or writing to a closed
    // pool; the run itself is the assertion, and `SESSION_SWEEP_INTERVAL_MS` is the production value.
    expect(SESSION_SWEEP_INTERVAL_MS).toBe(3_600_000)
  })
})

describe('the websocket, authenticated by the session cookie', () => {
  it('binds the player at the upgrade — no HELLO, no token in a query string', async () => {
    const h = await harness()
    const me = await h.register()
    const base = await listen(h)
    const client = await connect(base, { cookie: me.cookie })

    const welcome = await client.next('WELCOME')
    expect(welcome).toMatchObject({ playerId: me.playerId, displayName: 'Bình An', balance: ECONOMY.startingBalance })

    client.send({ t: 'LIST_ROOMS' })
    expect(await client.next('ROOM_LIST')).toMatchObject({ rooms: [] })
  })

  it('refuses the upgrade outright when there is no cookie, an unknown one, or a revoked session', async () => {
    const h = await harness()
    const me = await h.register()
    const base = await listen(h)

    await expect(connect(base)).rejects.toThrow('unexpected response 401')
    await expect(connect(base, { cookie: 'bp_session=not-a-token' })).rejects.toThrow('unexpected response 401')

    await h.app.fastify.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: me.cookie, ...XRW } })
    await expect(connect(base, { cookie: me.cookie })).rejects.toThrow('unexpected response 401')
  })

  it('refuses an origin that is not in ALLOWED_ORIGINS, and any path but /ws', async () => {
    const h = await harness()
    const me = await h.register()
    const base = await listen(h)
    await expect(TestClient.connect(`${base.replace('http://', 'ws://')}/ws`, { origin: 'http://evil.example', cookie: me.cookie })).rejects.toThrow()
    await expect(TestClient.connect(`${base.replace('http://', 'ws://')}/socket`, { origin: ORIGIN, cookie: me.cookie })).rejects.toThrow()
  })

  it('pushes a BALANCE frame when a REST claim moves the balance', async () => {
    const h = await harness()
    const me = await h.register()
    const client = await connect(await listen(h), { cookie: me.cookie })
    await client.next('WELCOME')

    const claim = await h.app.fastify.inject({ method: 'POST', url: '/api/rewards/daily/claim', headers: h.auth(me) })
    expect(claim.statusCode).toBe(200)
    expect(await client.next('BALANCE')).toMatchObject({ balance: ECONOMY.startingBalance + 5_000 })
  })
})

describe('a rename, and the next room', () => {
  it('seats the new name in the next room the player creates, without a reconnect (T7)', async () => {
    const h = await harness()
    const me = await h.register()
    const client = await connect(await listen(h), { cookie: me.cookie })
    const welcome = await client.next('WELCOME')

    const renamed = await h.app.fastify.inject({ method: 'PATCH', url: '/api/me', headers: h.auth(me), payload: { displayName: 'Tên Mới' } })
    expect(renamed.statusCode).toBe(200)
    expect(welcome.displayName).not.toBe('Tên Mới')

    client.send({ t: 'CREATE_ROOM', config: BLIND_ROOM })
    const snapshot = await client.next('ROOM_SNAPSHOT')
    expect(snapshot.room.players.find((p) => p.playerId === me.playerId)?.displayName).toBe('Tên Mới')
  })
})

describe('rooms joined', () => {
  it('counts the room a player creates as well as the one a player walks into — once each (T6)', async () => {
    const h = await harness()
    const alice = await h.register()
    const mai = await h.register(SECOND_ACCOUNT)
    const base = await listen(h)
    const a = await connect(base, { cookie: alice.cookie })
    const b = await connect(base, { cookie: mai.cookie })
    await a.next('WELCOME')
    await b.next('WELCOME')

    a.send({ t: 'CREATE_ROOM', config: BLIND_ROOM })
    const room = await a.next('ROOM_SNAPSHOT')
    b.send({ t: 'JOIN_ROOM', code: room.room.code })
    await b.next('ROOM_SNAPSHOT')

    // The counters move through the bus, a tick after the frames.
    await vi.waitFor(async () => {
      expect((await h.app.services.stats.get(alice.playerId)).roomsJoined).toBe(1)
      expect((await h.app.services.stats.get(mai.playerId)).roomsJoined).toBe(1)
    }, { timeout: 10_000 })
  })
})

describe('a whole hand between two registered players', () => {
  it('settles through the ledger, records a table_fee sink and moves both players’ counters', async () => {
    const h = await harness({ roomOptions: FAST_ROOM })
    const alice = await h.register()
    const mai = await h.register(SECOND_ACCOUNT)
    // The GM's hand on the books (Plan 25): both movements are ledger sources, counted in the sum further down.
    await h.app.services.gm.adjustPoints({ userId: null }, alice.playerId, 5_000, 'test credit')
    await h.app.services.gm.adjustPoints({ userId: null }, mai.playerId, -2_000, 'test debit')
    const base = await listen(h)

    const a = await connect(base, { cookie: alice.cookie })
    const b = await connect(base, { cookie: mai.cookie })
    await a.next('WELCOME')
    await b.next('WELCOME')

    a.send({ t: 'CREATE_ROOM', config: BLIND_ROOM })
    const room = await a.next('ROOM_SNAPSHOT')
    b.send({ t: 'JOIN_ROOM', code: room.room.code })
    await b.next('ROOM_SNAPSHOT')

    // Seated and readied one step at a time: `START_GAME` is refused until the room has actually
    // processed both, and firing all four messages at once makes that a race.
    for (const [client, player, seat] of [[a, alice, 0], [b, mai, 1]] as const) {
      client.send({ t: 'SIT_DOWN', seat })
      await a.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_SAT' && m.event.playerId === player.playerId)
      client.send({ t: 'READY', ready: true })
      await a.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_READY' && m.event.playerId === player.playerId)
    }
    // Started by hand rather than by `autoStart`, so exactly one hand plays: with the room dealing
    // on its own the table would still be running while the assertions below read the ledger.
    expect(await a.request({ t: 'START_GAME', reqId: 'start' })).toMatchObject({ t: 'ACK' })

    // `decisionMode: 'none'` means nobody acts: the hand deals, reveals and settles on its own.
    const complete = await a.next('GAME_EVENT', (m) => m.event.type === 'HAND_COMPLETE', 20_000)
    expect(complete.event.type).toBe('HAND_COMPLETE')
    // Spec 2026-09-29 (table limit): the stacks go home when the players stand; only then do the balances show the hand.
    expect(await a.request({ t: 'STAND_UP', reqId: 'stand-a' })).toMatchObject({ t: 'ACK' })
    expect(await b.request({ t: 'STAND_UP', reqId: 'stand-b' })).toMatchObject({ t: 'ACK' })

    /**
     * The hand is recorded, and every point the engine took as a fee is a sink row — which is what
     * keeps `Σ balances + Σ sinks` constant (§12.5).
     *
     * All of it inside one `waitFor` because settlement, the `games` rows and the counters are
     * separate writes that follow the frame the socket has already seen.
     */
    await vi.waitFor(async () => {
      const hands = await h.app.services.history.listForPlayer(alice.playerId, 10)
      expect(hands).toHaveLength(1)
      expect(hands[0]?.mode).toBe('blind')
      // The room's own name travels with the hand, from the config the room stored (No4).
      expect(hands[0]?.roomName).toBe(BLIND_ROOM.name)
      expect(hands[0]?.players).toHaveLength(2)

      const sinks = rowsOf<{ amount: string | number }>(await db.execute(sql`select amount from point_transactions where player_id is null and kind = 'table_fee'`))
      expect(sinks.length).toBeGreaterThan(0)
      expect(Number(sinks[0]?.amount)).toBeGreaterThan(0)

      // The table conserves points exactly: what the seats brought, what they took home and the fee
      // that left for the sink cancel to zero. Stated over those rows rather than over the balances
      // because the winner may also have unlocked an achievement on the way — a real credit, and
      // one whose size depends on which hand they happened to show down.
      const settled = rowsOf<{ amount: string | number }>(
        await db.execute(sql`select amount from point_transactions where reason in ('buy_in', 'cash_out', 'table_fee')`),
      )
      expect(settled.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(0)

      // …and the balances are the whole ledger, read back: what they started with, less the fee,
      // plus anything an achievement or a GM paid out (or took) on the way.
      const credited = rowsOf<{ amount: string | number }>(await db.execute(sql`select amount from point_transactions where reason in ('achievement', 'gm_grant', 'gm_adjust')`))
      const fees = sinks.reduce((sum, row) => sum + Number(row.amount), 0)
      const rewards = credited.reduce((sum, row) => sum + Number(row.amount), 0)
      const balances = await Promise.all([alice, mai].map((p) => h.app.services.repos.balances.get(p.playerId)))
      expect(balances[0]! + balances[1]!).toBe(2 * ECONOMY.startingBalance - fees + rewards)
    }, { timeout: 10_000 })

    // The counters move through the bus, so they land a tick after the socket saw the hand end.
    await vi.waitFor(async () => {
      for (const player of [alice, mai]) {
        const stats = await h.app.services.stats.get(player.playerId)
        expect(stats.handsPlayedBlind).toBe(1)
        expect(stats.gamesCompleted).toBe(1)
      }
    }, { timeout: 10_000 })
    // A tied showdown has no winner at all (`won` is `net > 0`), so the counters are checked against
    // what the history recorded for this hand rather than against "someone must have won".
    const winners = await Promise.all([alice, mai].map(async (p) => (await h.app.services.stats.get(p.playerId)).handsWonBlind))
    const recorded = rowsOf<{ n: string | number }>(await db.execute(sql`select count(*) as n from game_players where won = true`))
    expect(winners[0]! + winners[1]!).toBe(Number(recorded[0]?.n ?? 0))
    expect(winners[0]! + winners[1]!).toBeLessThanOrEqual(1)
  }, 40_000)
})

describe('a real boot', () => {
  /**
   * Rooms live in this process's memory, and only a room retries a keyed write, so no key claimed before a start can
   * ever be replayed after it: the boot empties `ledger_keys` rather than let it grow by a row or two per sitting.
   */
  it('starts with ledger_keys empty: no key outlives the process that claimed it', async () => {
    await db.insert(ledgerKeys).values([{ key: 'buy_in:room-1:s1' }, { key: 'cash_out:room-1:s1' }, { key: 'carry_over:room-2:x' }])
    await harness()
    expect(await db.select().from(ledgerKeys)).toEqual([])
  })

  it('listens, answers over HTTP, refuses an anonymous upgrade, and closes twice without complaint', async () => {
    const h = await harness()
    const base = await listen(h)

    const health = await fetch(`${base}/health`)
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ status: 'ok', edition: 'normal', db: 'ok' })

    const config = await fetch(`${base}/api/config`)
    expect(config.status).toBe(200)
    expect(await config.json()).toMatchObject({ edition: 'normal', wsPath: '/ws' })

    await expect(TestClient.connect(`${base.replace('http://', 'ws://')}/ws`, { origin: ORIGIN })).rejects.toThrow('unexpected response 401')

    // Memoized: the second call joins the first rather than tearing anything down twice.
    await h.app.close()
    await h.app.close()
    await expect(fetch(`${base}/health`)).rejects.toThrow()
  })

  /**
   * The steps of `close()` are best-effort for a reason: `game.shutdown()` re-raises a drain failure
   * that happens *before* its own budget expires, and an unguarded chain would then leave the
   * listener up, the subscriptions attached and the pool open — for good, because the memoized
   * promise means no later caller can finish the job.
   */
  it('finishes the shutdown even when a step rejects, and never memoizes the rejection', async () => {
    const h = await harness()
    await listen(h)
    // Rejects *after* the real drain, so the step under test genuinely fails while the gateway's
    // sockets and timers are still torn down — a stubbed-out shutdown would leak both into the run.
    const drain = h.app.game.shutdown.bind(h.app.game)
    h.app.game.shutdown = async (reason) => {
      await drain(reason)
      throw new Error('drain exploded')
    }

    await expect(h.app.close()).resolves.toBeUndefined()
    expect(h.closeDbCalls()).toBe(1)
    // The listener was still shut, and the memo resolves for every later caller rather than
    // re-raising — and does not close the database a second time.
    await expect(h.app.close()).resolves.toBeUndefined()
    expect(h.closeDbCalls()).toBe(1)
  })

  /**
   * Domain events are published fire-and-forget so the game loop never waits for bookkeeping — which
   * means the `player_stats` write for the last hand of the drain is still running when the listener
   * closes. Closing the pool under it would lose the counters with nothing but an `error` line.
   */
  it('drains the progression writes still in flight before closing the database', async () => {
    const h = await harness()
    let landed = false
    let release = (): void => {}
    const arrived = new Promise<void>((resolve) => { release = resolve })
    h.app.services.bus.subscribe(async () => {
      await arrived
      landed = true
    })

    // Nobody holds this promise, exactly as `onDomainEvent` publishes it.
    void h.app.services.bus.publish({ type: 'DAILY_CLAIMED', playerId: 'p1', day: 1, streak: 1 })
    const closed = h.app.close().then(() => {
      // Read inside the continuation: the assertion is about ordering, not about a later poll.
      expect(landed).toBe(true)
      expect(h.closeDbCalls()).toBe(1)
    })

    setTimeout(release, 50)
    await closed
  })

  it('closes live sockets with SERVER_SHUTDOWN', async () => {
    const h = await harness()
    const me = await h.register()
    const client = await connect(await listen(h), { cookie: me.cookie })
    await client.next('WELCOME')

    await h.app.close()
    expect(await client.next('ERROR')).toMatchObject({ code: 'SERVER_SHUTDOWN' })
    expect((await client.closed).code).toBe(1001)
  })
})
