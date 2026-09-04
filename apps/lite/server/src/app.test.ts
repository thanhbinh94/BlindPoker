import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ECONOMY, type RoomConfig } from '@bp/core'
import { silentLogger } from '@bp/server-kit'
import { TestClient } from '@bp/server-kit/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp, type LiteApp } from './app.js'
import { DEFAULT_CONFIG, type LiteConfig } from './config.js'
import { openDatabase } from './db/sqlite.js'
import { assetSourceFromDir, type AssetSource } from './http/assets.js'
import { createSqliteRepositories, type LiteRepositories } from './repos/sqlite-repos.js'
import { RUN_FILE_NAME, type RunFile } from './run-file.js'

const XRW = { 'x-requested-with': 'bind-poker' }
const CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; " +
  "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"

interface Harness {
  app: LiteApp
  repos: LiteRepositories
  setNow(ms: number): void
}

const started: Harness[] = []
const dirs: string[] = []
const clients: TestClient[] = []
const openDatabases: LiteRepositories[] = []

/** A throwaway directory, cleaned up by the `afterEach` below. */
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function publicDir(): string {
  const dir = tempDir('bp-app-')
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Bind Poker</title><div id="root"></div>')
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)')
  return dir
}

function makeApp(opts: { assets?: AssetSource | null; config?: Partial<LiteConfig>; now?: number; runFilePath?: string } = {}): Harness {
  let nowMs = opts.now ?? Date.UTC(2026, 8, 4, 3, 0) // 2026-09-04 10:00 ICT
  const real = createSqliteRepositories(openDatabase(':memory:'), { handLog: false, now: () => nowMs })
  openDatabases.push(real)
  // `close()` is neutered so a test can still read the database after `app.close()` has run its
  // refunds — the drain is the interesting half, and the `afterEach` closes the handle for real.
  const repos: LiteRepositories = { ...real, close: () => {} }
  const config: LiteConfig = { ...DEFAULT_CONFIG, port: 0, host: '127.0.0.1', sqlitePath: ':memory:', ...opts.config }
  const assets = opts.assets === undefined ? assetSourceFromDir(publicDir()) : opts.assets
  const app = buildApp({
    config,
    repos,
    assets,
    log: silentLogger,
    now: () => nowMs,
    gatewayOptions: { heartbeatIntervalMs: 60_000, heartbeatTimeoutMs: 120_000 },
    ...(opts.runFilePath === undefined ? {} : { runFilePath: opts.runFilePath }),
  })
  const harness: Harness = { app, repos, setNow: (ms) => { nowMs = ms } }
  started.push(harness)
  return harness
}

async function createSession(h: Harness, displayName: string): Promise<{ playerId: string; token: string; balance: number }> {
  const res = await h.app.fastify.inject({ method: 'POST', url: '/api/session', headers: XRW, payload: { displayName } })
  expect(res.statusCode).toBe(201)
  return res.json() as { playerId: string; token: string; balance: number }
}

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => {})
  for (const h of started.splice(0)) await h.app.close()
  for (const r of openDatabases.splice(0)) r.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('GET /health', () => {
  it('reports the process, the game server and the database', async () => {
    const h = makeApp()
    const res = await h.app.fastify.inject('/health')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok', uptime: expect.any(Number), connections: 0, rooms: 0, db: 'ok' })
    expect(res.headers['cache-control']).toBe('no-store')
  })
})

describe('GET /api/config', () => {
  it('publishes the client-facing economy parameters', async () => {
    const h = makeApp()
    const res = await h.app.fastify.inject('/api/config')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      edition: 'lite',
      wsPath: '/ws',
      economy: {
        startingBalance: ECONOMY.startingBalance,
        blindWagerTiers: [...ECONOMY.blindWagerTiers],
        holdemBlindTiers: ECONOMY.holdemBlindTiers.map((t) => ({ smallBlind: t.smallBlind, bigBlind: t.bigBlind })),
        reliefThreshold: ECONOMY.reliefThreshold,
        reliefTarget: ECONOMY.reliefTarget,
      },
      languages: ['vi', 'en'],
    })
    expect(res.headers['cache-control']).toBe('no-store')
  })
})

describe('POST /api/session', () => {
  it('creates a player and returns a usable token', async () => {
    const h = makeApp()
    const res = await h.app.fastify.inject({ method: 'POST', url: '/api/session', headers: XRW, payload: { displayName: 'Alice' } })
    expect(res.statusCode).toBe(201)
    const body = res.json() as { playerId: string; displayName: string; token: string; balance: number }
    expect(body).toEqual({ playerId: expect.any(String), displayName: 'Alice', token: expect.any(String), balance: ECONOMY.startingBalance })
    expect(h.repos.getLitePlayer(body.playerId)?.displayName).toBe('Alice')

    const me = await h.app.fastify.inject({ url: '/api/me', headers: { authorization: `Bearer ${body.token}` } })
    expect(me.statusCode).toBe(200)
  })

  it('rejects a malformed display name with INVALID_NAME', async () => {
    const h = makeApp()
    for (const displayName of ['a', ' Alice', 'x'.repeat(21), 'Al<b>ice']) {
      const res = await h.app.fastify.inject({ method: 'POST', url: '/api/session', headers: XRW, payload: { displayName } })
      expect(res.statusCode).toBe(400)
      expect((res.json() as { error: { code: string } }).error.code).toBe('INVALID_NAME')
    }
  })

  it('rejects a missing or non-string display name with INVALID_NAME', async () => {
    const h = makeApp()
    const missing = await h.app.fastify.inject({ method: 'POST', url: '/api/session', headers: XRW, payload: {} })
    expect(missing.statusCode).toBe(400)
    expect((missing.json() as { error: { code: string } }).error.code).toBe('INVALID_NAME')

    const wrongType = await h.app.fastify.inject({ method: 'POST', url: '/api/session', headers: XRW, payload: { displayName: 42 } })
    expect(wrongType.statusCode).toBe(400)
    expect((wrongType.json() as { error: { code: string } }).error.code).toBe('INVALID_NAME')
  })

  it('rejects a name already in use with DISPLAY_NAME_TAKEN', async () => {
    const h = makeApp()
    await createSession(h, 'Alice')
    const res = await h.app.fastify.inject({ method: 'POST', url: '/api/session', headers: XRW, payload: { displayName: 'alice' } })
    expect(res.statusCode).toBe(409)
    expect((res.json() as { error: { code: string } }).error.code).toBe('DISPLAY_NAME_TAKEN')
  })

  it('refuses a POST without X-Requested-With', async () => {
    const h = makeApp()
    const res = await h.app.fastify.inject({ method: 'POST', url: '/api/session', payload: { displayName: 'Alice' } })
    expect(res.statusCode).toBe(403)
    expect((res.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN')
    expect(h.repos.findByName('Alice')).toBeNull()
  })

  it('rate limits to 10 per minute per IP and recovers after the window', async () => {
    const h = makeApp()
    for (let i = 0; i < 10; i += 1) {
      const ok = await h.app.fastify.inject({ method: 'POST', url: '/api/session', headers: XRW, payload: { displayName: `P${i}` } })
      expect(ok.statusCode).toBe(201)
    }
    const limited = await h.app.fastify.inject({ method: 'POST', url: '/api/session', headers: XRW, payload: { displayName: 'P10' } })
    expect(limited.statusCode).toBe(429)
    expect((limited.json() as { error: { code: string } }).error.code).toBe('RATE_LIMITED')
    expect(limited.headers['retry-after']).toBeDefined()

    h.setNow(Date.UTC(2026, 8, 4, 3, 1, 1))
    const after = await h.app.fastify.inject({ method: 'POST', url: '/api/session', headers: XRW, payload: { displayName: 'P11' } })
    expect(after.statusCode).toBe(201)
  })
})

describe('GET /api/me', () => {
  it('returns the profile, stats, daily status and relief eligibility', async () => {
    const h = makeApp()
    const session = await createSession(h, 'Alice')
    const res = await h.app.fastify.inject({ url: '/api/me', headers: { authorization: `Bearer ${session.token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      playerId: session.playerId,
      displayName: 'Alice',
      balance: ECONOMY.startingBalance,
      stats: { handsPlayed: 0, handsWon: 0 },
      daily: expect.objectContaining({ allowed: true, alreadyClaimed: false, day: 1, points: 5_000, streak: 1 }),
      relief: { eligible: false, reason: 'balance', retryAt: null },
    })
  })

  it('rejects a missing, malformed or unknown bearer token with UNAUTHENTICATED', async () => {
    const h = makeApp()
    for (const headers of [{}, { authorization: 'Bearer nope' }, { authorization: 'Basic abc' }, { authorization: 'Bearer' }]) {
      const res = await h.app.fastify.inject({ url: '/api/me', headers })
      expect(res.statusCode).toBe(401)
      expect((res.json() as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED')
    }
  })
})

describe('daily reward', () => {
  it('reports the status, credits the claim once and refuses the second', async () => {
    const h = makeApp()
    const session = await createSession(h, 'Alice')
    const auth = { authorization: `Bearer ${session.token}` }

    const status = await h.app.fastify.inject({ url: '/api/rewards/daily', headers: auth })
    expect(status.statusCode).toBe(200)
    expect(status.json()).toMatchObject({ allowed: true, alreadyClaimed: false, day: 1, points: 5_000 })

    const claim = await h.app.fastify.inject({ method: 'POST', url: '/api/rewards/daily/claim', headers: { ...auth, ...XRW } })
    expect(claim.statusCode).toBe(200)
    expect(claim.json()).toEqual({ claimed: true, points: 5_000, streak: 1, balance: ECONOMY.startingBalance + 5_000 })
    expect(await h.repos.balances.get(session.playerId)).toBe(ECONOMY.startingBalance + 5_000)

    const again = await h.app.fastify.inject({ method: 'POST', url: '/api/rewards/daily/claim', headers: { ...auth, ...XRW } })
    expect(again.statusCode).toBe(409)
    expect(again.json()).toMatchObject({ claimed: false, error: { code: 'ALREADY_CLAIMED' } })
    expect(await h.repos.balances.get(session.playerId)).toBe(ECONOMY.startingBalance + 5_000)
  })

  it('requires a bearer token and X-Requested-With', async () => {
    const h = makeApp()
    const session = await createSession(h, 'Alice')
    const noAuth = await h.app.fastify.inject({ method: 'POST', url: '/api/rewards/daily/claim', headers: XRW })
    expect(noAuth.statusCode).toBe(401)
    const noHeader = await h.app.fastify.inject({ method: 'POST', url: '/api/rewards/daily/claim', headers: { authorization: `Bearer ${session.token}` } })
    expect(noHeader.statusCode).toBe(403)
    expect(await h.repos.balances.get(session.playerId)).toBe(ECONOMY.startingBalance)
  })
})

describe('POST /api/economy/relief', () => {
  it('tops a poor player up to the relief target, then refuses while the cooldown runs', async () => {
    const h = makeApp()
    const session = await createSession(h, 'Alice')
    const auth = { authorization: `Bearer ${session.token}`, ...XRW }
    await h.repos.balances.apply([{ playerId: session.playerId, delta: -(ECONOMY.startingBalance - 4_000), reason: 'settlement', refId: 'test' }])

    const granted = await h.app.fastify.inject({ method: 'POST', url: '/api/economy/relief', headers: auth })
    expect(granted.statusCode).toBe(200)
    expect(granted.json()).toEqual({ granted: true, amount: 1_000, balance: ECONOMY.reliefTarget })
    expect(await h.repos.balances.get(session.playerId)).toBe(ECONOMY.reliefTarget)

    await h.repos.balances.apply([{ playerId: session.playerId, delta: -1_000, reason: 'settlement', refId: 'test2' }])
    const denied = await h.app.fastify.inject({ method: 'POST', url: '/api/economy/relief', headers: auth })
    expect(denied.statusCode).toBe(409)
    expect(denied.json()).toMatchObject({ granted: false, reason: 'cooldown', error: { code: 'NOT_ELIGIBLE' } })
    expect((denied.json() as { retryAt: number }).retryAt).toBeGreaterThan(Date.UTC(2026, 8, 4, 3, 0))
  })

  it('refuses a player who is not poor enough', async () => {
    const h = makeApp()
    const session = await createSession(h, 'Alice')
    const res = await h.app.fastify.inject({ method: 'POST', url: '/api/economy/relief', headers: { authorization: `Bearer ${session.token}`, ...XRW } })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ granted: false, reason: 'balance', error: { code: 'NOT_ELIGIBLE' } })
  })
})

describe('static assets', () => {
  it('serves index.html at the root, uncached', async () => {
    const h = makeApp()
    const res = await h.app.fastify.inject('/')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(res.headers['cache-control']).toBe('no-cache')
    expect(res.body).toContain('<div id="root">')
  })

  it('serves hashed build output immutably and unhashed output revalidated', async () => {
    const h = makeApp()
    const hashed = await h.app.fastify.inject('/assets/app-abc123.js')
    expect(hashed.statusCode).toBe(200)
    expect(hashed.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect(hashed.headers['cache-control']).toBe('public, max-age=31536000, immutable')

    const index = await h.app.fastify.inject('/index.html')
    expect(index.statusCode).toBe(200)
    expect(index.headers['cache-control']).toBe('no-cache')
  })

  it('falls back to index.html for extension-less SPA routes', async () => {
    const h = makeApp()
    for (const url of ['/lobby', '/room', '/settings']) {
      const res = await h.app.fastify.inject(url)
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
      expect(res.body).toContain('<div id="root">')
    }
  })

  it('404s a missing file that has an extension', async () => {
    const h = makeApp()
    const res = await h.app.fastify.inject('/missing.png')
    expect(res.statusCode).toBe(404)
    expect((res.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND')
  })

  it('never falls back for API, ws or traversal paths', async () => {
    const h = makeApp()
    for (const url of ['/api/unknown', '/ws', '/..%2Findex.html']) {
      const res = await h.app.fastify.inject(url)
      expect(res.statusCode).toBe(404)
      expect((res.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND')
    }
  })

  it('404s every path when no asset source is configured', async () => {
    const h = makeApp({ assets: null })
    const res = await h.app.fastify.inject('/')
    expect(res.statusCode).toBe(404)
    expect((res.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND')
  })

  it('404s an unknown method with the error envelope', async () => {
    const h = makeApp()
    const res = await h.app.fastify.inject({ method: 'DELETE', url: '/api/me', headers: XRW })
    expect(res.statusCode).toBe(404)
    expect((res.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND')
  })
})

describe('security headers', () => {
  it('are set on every response', async () => {
    const h = makeApp()
    for (const url of ['/health', '/api/config', '/', '/assets/app-abc123.js', '/missing.png']) {
      const res = await h.app.fastify.inject(url)
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['referrer-policy']).toBe('no-referrer')
      expect(res.headers['content-security-policy']).toBe(CSP)
      expect(res.headers['x-frame-options']).toBe('DENY')
    }
  })

  it('names every directive the spec §19.3 header list requires', async () => {
    const h = makeApp()
    const csp = (await h.app.fastify.inject('/health')).headers['content-security-policy'] as string
    const directives = new Map(csp.split('; ').map((d) => [d.split(' ')[0], d]))
    expect(directives.get('connect-src')).toBe("connect-src 'self'")
    expect(directives.get('frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(directives.get('base-uri')).toBe("base-uri 'self'")
    expect(directives.get('form-action')).toBe("form-action 'self'")
    expect(directives.get('object-src')).toBe("object-src 'none'")
    // M1: the socket is same-origin, so `'self'` already covers it and the scheme sources are gone.
    expect(csp).not.toContain('ws:')
    expect(csp).not.toContain('wss:')
  })
})

describe('request parsing', () => {
  it('accepts a bodyless POST that still declares a JSON content type', async () => {
    const h = makeApp()
    const session = await createSession(h, 'Alice')
    const res = await h.app.fastify.inject({
      method: 'POST',
      url: '/api/rewards/daily/claim',
      headers: { authorization: `Bearer ${session.token}`, ...XRW, 'content-type': 'application/json' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ claimed: true })
  })

  it('still rejects a malformed JSON body with BAD_REQUEST', async () => {
    const h = makeApp()
    const res = await h.app.fastify.inject({
      method: 'POST',
      url: '/api/session',
      headers: { ...XRW, 'content-type': 'application/json' },
      payload: '{"displayName": ',
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: { code: string } }).error.code).toBe('BAD_REQUEST')
  })

  it('matches the Bearer scheme case-insensitively', async () => {
    const h = makeApp()
    const session = await createSession(h, 'Alice')
    for (const scheme of ['Bearer', 'bearer', 'BEARER', 'BeArEr']) {
      const res = await h.app.fastify.inject({ url: '/api/me', headers: { authorization: `${scheme} ${session.token}` } })
      expect(res.statusCode, scheme).toBe(200)
    }
  })
})

describe('the run file', () => {
  it('is written when the listener binds and removed when the app closes', async () => {
    const path = join(tempDir('bp-run-'), RUN_FILE_NAME)
    const h = makeApp({ runFilePath: path })
    expect(existsSync(path)).toBe(false)

    const address = await h.app.listen()
    expect(existsSync(path)).toBe(true)
    const info = JSON.parse(readFileSync(path, 'utf8')) as RunFile
    expect(info).toEqual({ pid: process.pid, port: Number(new URL(address).port), host: '127.0.0.1', token: h.app.runToken })
    // The bound port, not the configured 0 — a run file naming port 0 would be useless to `--stop`.
    expect(info.port).toBeGreaterThan(0)
    expect(info.token).toMatch(/^[0-9a-f]{64}$/)

    await h.app.close()
    expect(existsSync(path)).toBe(false)
  })

  it('is not written at all when no path is configured', async () => {
    const dir = tempDir('bp-run-')
    const h = makeApp()
    await h.app.listen()
    expect(existsSync(join(dir, RUN_FILE_NAME))).toBe(false)
  })
})

describe('POST /api/admin/shutdown', () => {
  const HOLDEM: RoomConfig = {
    name: 'Bàn', mode: 'holdem', maxPlayers: 4, isPrivate: false, turnTimerSec: 30, autoStart: false,
    holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 },
  }

  const auth = (token: string) => ({ authorization: `Bearer ${token}`, ...XRW })

  it('refuses a caller that is not on the loopback with 403, without stopping anything', async () => {
    const h = makeApp()
    const res = await h.app.fastify.inject({ method: 'POST', url: '/api/admin/shutdown', headers: auth(h.app.runToken), remoteAddress: '10.0.0.5' })
    expect(res.statusCode).toBe(403)
    expect((res.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN')
    expect(h.app.isClosing).toBe(false)
  })

  it('refuses a wrong run token with 401, even from the loopback', async () => {
    const h = makeApp()
    for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      const res = await h.app.fastify.inject({ method: 'POST', url: '/api/admin/shutdown', headers: auth('0'.repeat(64)), remoteAddress })
      expect(res.statusCode, remoteAddress).toBe(401)
      expect((res.json() as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED')
    }
    expect(h.app.isClosing).toBe(false)
  })

  it('refuses a request without X-Requested-With before it ever looks at the token', async () => {
    const h = makeApp()
    const res = await h.app.fastify.inject({ method: 'POST', url: '/api/admin/shutdown', headers: { authorization: `Bearer ${h.app.runToken}` } })
    expect(res.statusCode).toBe(403)
    expect(h.app.isClosing).toBe(false)
  })

  it('rate limits to 5 attempts per minute', async () => {
    const h = makeApp()
    for (let i = 0; i < 5; i += 1) {
      const res = await h.app.fastify.inject({ method: 'POST', url: '/api/admin/shutdown', headers: auth('0'.repeat(64)), remoteAddress: '127.0.0.1' })
      expect(res.statusCode).toBe(401)
    }
    const limited = await h.app.fastify.inject({ method: 'POST', url: '/api/admin/shutdown', headers: auth('0'.repeat(64)), remoteAddress: '127.0.0.1' })
    expect(limited.statusCode).toBe(429)
    expect(limited.headers['retry-after']).toBeDefined()
  })

  it('accepts the run token from the loopback, drains the room and gives the buy-in back', async () => {
    const path = join(tempDir('bp-run-'), RUN_FILE_NAME)
    const h = makeApp({ runFilePath: path })
    const session = await createSession(h, 'Alice')
    const address = await h.app.listen()
    const client = await TestClient.connect(`ws://127.0.0.1:${new URL(address).port}/ws`)
    clients.push(client)
    await client.hello(session.token)

    // Money leaves the balance for the stack the moment the player sits down (`reason: 'buy_in'`).
    client.send({ t: 'CREATE_ROOM', config: HOLDEM })
    await client.next('ROOM_SNAPSHOT')
    client.send({ t: 'SIT_DOWN', seat: 0, buyIn: 20_000 })
    await client.next('ROOM_EVENT', (m) => m.event.type === 'PLAYER_SAT')
    expect(await h.repos.balances.get(session.playerId)).toBe(ECONOMY.startingBalance - 20_000)

    const res = await h.app.fastify.inject({ method: 'POST', url: '/api/admin/shutdown', headers: auth(h.app.runToken), remoteAddress: '127.0.0.1' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })

    // The endpoint replies first and drains afterwards; `close()` is memoized, so awaiting it here
    // joins the shutdown the request started rather than beginning a second one.
    await vi.waitFor(() => expect(h.app.isClosing).toBe(true))
    await h.app.close()

    expect(await h.repos.balances.get(session.playerId)).toBe(ECONOMY.startingBalance)
    expect(await client.next('ERROR')).toMatchObject({ code: 'SERVER_SHUTDOWN' })
    expect(existsSync(path)).toBe(false)
  })
})

describe('websocket wiring', () => {
  async function listen(h: Harness): Promise<string> {
    const address = await h.app.listen()
    return `ws://127.0.0.1:${new URL(address).port}/ws`
  }

  async function connect(url: string, headers: Record<string, string> = {}): Promise<TestClient> {
    const client = await TestClient.connect(url, headers)
    clients.push(client)
    return client
  }

  it('authenticates a session token over /ws and answers LIST_ROOMS', async () => {
    const h = makeApp()
    const session = await createSession(h, 'Alice')
    const client = await connect(await listen(h))

    const welcome = await client.hello(session.token)
    expect(welcome).toMatchObject({ playerId: session.playerId, displayName: 'Alice', balance: ECONOMY.startingBalance })

    client.send({ t: 'LIST_ROOMS' })
    expect(await client.next('ROOM_LIST')).toMatchObject({ rooms: [] })
  })

  it('rejects an unknown token and closes the socket', async () => {
    const h = makeApp()
    const client = await connect(await listen(h))
    client.send({ t: 'HELLO', sessionToken: 'not-a-token' })
    expect(await client.next('ERROR')).toMatchObject({ code: 'UNAUTHENTICATED' })
    expect((await client.closed).code).toBe(4001)
  })

  it('refuses an upgrade on any path other than /ws', async () => {
    const h = makeApp()
    const url = await listen(h)
    await expect(TestClient.connect(url.replace('/ws', '/socket'))).rejects.toThrow()
  })

  it('defaults to the same-host origin policy: this host is welcome, another site is not', async () => {
    const h = makeApp()
    expect(h.app.game.gateway).toBeDefined()
    const session = await createSession(h, 'Alice')
    const url = await listen(h)
    const host = new URL(url.replace('ws://', 'http://')).host

    const own = await connect(url, { origin: `http://${host}` })
    expect((await own.hello(session.token)).playerId).toBe(session.playerId)

    await expect(TestClient.connect(url, { origin: 'http://evil.example' })).rejects.toThrow()
  })

  it('honours an explicit ALLOWED_ORIGINS list instead, for a deployment behind a proxy', async () => {
    const h = makeApp({ config: { allowedOrigins: ['https://poker.example.com'] } })
    const session = await createSession(h, 'Alice')
    const url = await listen(h)

    const proxied = await connect(url, { origin: 'https://poker.example.com' })
    expect((await proxied.hello(session.token)).playerId).toBe(session.playerId)

    await expect(TestClient.connect(url, { origin: `http://${new URL(url.replace('ws://', 'http://')).host}` })).rejects.toThrow()
  })

  it('pushes a BALANCE frame when a daily claim changes the balance', async () => {
    const h = makeApp()
    const session = await createSession(h, 'Alice')
    const client = await connect(await listen(h))
    await client.hello(session.token)

    const claim = await h.app.fastify.inject({
      method: 'POST',
      url: '/api/rewards/daily/claim',
      headers: { authorization: `Bearer ${session.token}`, ...XRW },
    })
    expect(claim.statusCode).toBe(200)
    expect(await client.next('BALANCE')).toMatchObject({ balance: ECONOMY.startingBalance + 5_000 })
  })

  it('closes sockets with SERVER_SHUTDOWN and stops the listener', async () => {
    const h = makeApp()
    const session = await createSession(h, 'Alice')
    const url = await listen(h)
    const client = await connect(url)
    await client.hello(session.token)

    await h.app.close()
    expect(await client.next('ERROR')).toMatchObject({ code: 'SERVER_SHUTDOWN' })
    expect((await client.closed).code).toBe(1001)
    await expect(TestClient.connect(url)).rejects.toThrow()
  })
})
