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
import { assetSourceFromDir, DEFAULT_CSP } from '@bp/http-kit'
import { TestClient } from '@bp/server-kit/testing'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { FONTS_FILE_HOST, FONTS_STYLESHEET_HOST, normalCsp } from './app.js'
import { rowsOf, type AppDb } from './db/client.js'
import { createTestDb, type TestDb } from './db/test-db.js'
import { buildTestApp, ORIGIN, resetDb, XRW, type Harness, type HarnessOptions } from './test-harness.js'

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
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Bind Poker</title><div id="root"></div>')
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
  it('reports the edition, the version and a reachable database', async () => {
    const h = await harness()
    const res = await h.app.fastify.inject('/health')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, edition: 'normal', version: expect.any(String), db: 'ok', uptimeSec: expect.any(Number) })
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('answers 503 with db: down when the pool cannot be reached', async () => {
    const h = await harness()
    h.setDbUp(false)
    const res = await h.app.fastify.inject('/health')
    expect(res.statusCode).toBe(503)
    expect(res.json()).toMatchObject({ ok: false, db: 'down' })
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
})

describe('security headers', () => {
  it('extends the shared CSP with the two hosts Google Fonts needs, and nothing else', async () => {
    const h = await harness()
    const csp = (await h.app.fastify.inject('/health')).headers['content-security-policy'] as string
    expect(csp).toBe(normalCsp())
    const directives = new Map(csp.split('; ').map((d) => [d.split(' ')[0], d]))
    expect(directives.get('style-src')).toBe(`style-src 'self' 'unsafe-inline' ${FONTS_STYLESHEET_HOST}`)
    expect(directives.get('font-src')).toBe(`font-src 'self' ${FONTS_FILE_HOST}`)
    // Everything the shared default said is still said.
    for (const directive of DEFAULT_CSP.split('; ')) {
      if (directive.startsWith('style-src ')) continue
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

  it('leaves sign-in to its own, tighter limiter', async () => {
    const h = await harness({ writeRateLimit: { limit: 1, windowMs: 60_000 } })
    await h.register()
    for (let i = 0; i < 3; i += 1) {
      const res = await h.app.fastify.inject({ method: 'POST', url: '/api/auth/login', headers: XRW, payload: { email: 'binh@example.com', password: 'wrong password' } })
      expect(res.statusCode, `attempt ${String(i)}`).toBe(401)
    }
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

describe('a whole hand between two registered players', () => {
  it('settles through the ledger, records a table_fee sink and moves both players’ counters', async () => {
    const h = await harness({ roomOptions: FAST_ROOM })
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
      expect(hands[0]?.players).toHaveLength(2)

      const sinks = rowsOf<{ amount: string | number }>(await db.execute(sql`select amount from point_transactions where player_id is null and kind = 'table_fee'`))
      expect(sinks.length).toBeGreaterThan(0)
      expect(Number(sinks[0]?.amount)).toBeGreaterThan(0)

      // The settlement conserves points exactly: what the seats gained and lost, plus the fee that
      // left for the sink, is zero. Stated over the settlement rows rather than over the balances
      // because the winner may also have unlocked an achievement on the way — a real credit, and
      // one whose size depends on which hand they happened to show down.
      const settled = rowsOf<{ amount: string | number }>(
        await db.execute(sql`select amount from point_transactions where reason in ('settlement', 'table_fee')`),
      )
      expect(settled.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(0)

      // …and the balances are the whole ledger, read back: what they started with, less the fee,
      // plus anything an achievement paid out on the way.
      const credited = rowsOf<{ amount: string | number }>(await db.execute(sql`select amount from point_transactions where reason = 'achievement'`))
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
    const winners = await Promise.all([alice, mai].map(async (p) => (await h.app.services.stats.get(p.playerId)).handsWonBlind))
    expect(winners[0]! + winners[1]!).toBeGreaterThanOrEqual(1)
  }, 40_000)
})

describe('a real boot', () => {
  it('listens, answers over HTTP, refuses an anonymous upgrade, and closes twice without complaint', async () => {
    const h = await harness()
    const base = await listen(h)

    const health = await fetch(`${base}/health`)
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ ok: true, edition: 'normal', db: 'ok' })

    const config = await fetch(`${base}/api/config`)
    expect(config.status).toBe(200)
    expect(await config.json()).toMatchObject({ edition: 'normal', wsPath: '/ws' })

    await expect(TestClient.connect(`${base.replace('http://', 'ws://')}/ws`, { origin: ORIGIN })).rejects.toThrow('unexpected response 401')

    // Memoized: the second call joins the first rather than tearing anything down twice.
    await h.app.close()
    await h.app.close()
    await expect(fetch(`${base}/health`)).rejects.toThrow()
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
