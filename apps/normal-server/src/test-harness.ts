/**
 * One `buildApp` on a throwaway PGlite, plus the two things every integration test needs: a clock it
 * can move and an account it can sign in as.
 *
 * Shared rather than repeated in each test file because the interesting part of these tests is the
 * assertions, not the twelve lines of wiring in front of them — and because "the app under test" has
 * to be the *real* `buildApp`, not a Fastify instance a test assembled to look like it.
 *
 * Excluded from the build (`tsconfig.build.json`) alongside `db/test-db.ts`: it pulls in PGlite,
 * which is a devDependency.
 */
import { REQUESTED_WITH } from '@bp/http-kit'
import { silentLogger } from '@bp/server-kit'
import { sql } from 'drizzle-orm'
import type { LightMyRequestResponse } from 'fastify'
import { buildApp, type AppDeps, type NormalApp } from './app.js'
import { SESSION_COOKIE } from './auth/cookie.js'
import { CONFIG_DEFAULTS, type NormalConfig } from './config.js'
import type { AppDb } from './db/client.js'

/** The CSRF header every mutating request must carry. */
export const XRW = { 'x-requested-with': REQUESTED_WITH }
/** 8 MiB, one pass: `password.test.ts` pins the production cost; these tests are about HTTP. */
export const CHEAP_ARGON2 = { memoryCost: 8_192, timeCost: 1, parallelism: 1 }
export const TEST_SECRET = 'r'.repeat(32)
/** 2026-09-04 10:00 in Asia/Ho_Chi_Minh — mid-morning, so a day boundary is never one test away. */
export const START = Date.UTC(2026, 8, 4, 3, 0)
/** The one origin the gateway accepts in tests; a socket must present it to be let in. */
export const ORIGIN = 'http://poker.test'

export const GOOD_ACCOUNT = { email: 'binh@example.com', password: 'a good password', displayName: 'Bình An' }

export function testConfig(over: Partial<NormalConfig> = {}): NormalConfig {
  return {
    ...CONFIG_DEFAULTS,
    port: 0,
    host: '127.0.0.1',
    databaseUrl: 'postgres://unused/in-tests',
    sessionSecret: TEST_SECRET,
    allowedOrigins: [ORIGIN],
    cookieSecure: true,
    ...over,
  }
}

export interface Account {
  playerId: string
  displayName: string
  balance: number
  /** `bp_session=<token>`, ready to be sent as a `cookie` header. */
  cookie: string
}

export interface Harness {
  app: NormalApp
  db: AppDb
  /** Moves the clock every service and rate limiter reads. */
  setNow(ms: number): void
  /** What `/health` will report until it is changed. */
  setDbUp(up: boolean): void
  /** Replaces the health probe outright: a rejection, a hang, anything a real pool can do. */
  setDbProbe(fn: () => Promise<boolean>): void
  /** Makes the health probe never settle — a pool with every client checked out, or a server gone quiet. */
  hangDbProbe(): void
  /** How many times `buildApp`'s `closeDb` has been called; a shutdown that skipped it leaves this at 0. */
  closeDbCalls(): number
  register(payload?: Record<string, unknown>): Promise<Account>
  /** `{ cookie, ...XRW }` — everything an authenticated mutating request needs. */
  auth(account: Account): Record<string, string>
}

export interface HarnessOptions
  extends Partial<
    Pick<
      AppDeps,
      | 'assets'
      | 'roomOptions'
      | 'gatewayOptions'
      | 'rng'
      | 'writeRateLimit'
      | 'readRateLimit'
      | 'writeIpRateLimit'
      | 'upgradeRateLimit'
      | 'sessionSweepIntervalMs'
      | 'log'
      | 'extraRoutes'
    >
  > {
  config?: Partial<NormalConfig>
}

/**
 * The raw session cookie out of a `Set-Cookie`, as a `cookie` request header.
 *
 * A response may carry several cookies, and `inject` hands them back as a string or an array
 * depending on how many — so both shapes are searched for ours by name.
 */
export function cookieHeader(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie']
  const all = Array.isArray(raw) ? raw : [String(raw ?? '')]
  const line = all.find((l) => l.startsWith(`${SESSION_COOKIE}=`)) ?? ''
  return line.split(';')[0] ?? ''
}

export async function buildTestApp(db: AppDb, opts: HarnessOptions = {}): Promise<Harness> {
  let nowMs = START
  let closeDbCalls = 0
  let probe: () => Promise<boolean> = () => Promise.resolve(true)
  const app = await buildApp({
    config: testConfig(opts.config),
    db,
    // Counted, not closed: the PGlite handle is shared by the whole file, and the suite closes it.
    closeDb: async () => { closeDbCalls += 1 },
    pingDb: () => probe(),
    log: opts.log ?? silentLogger,
    now: () => nowMs,
    argon2Params: CHEAP_ARGON2,
    assets: opts.assets === undefined ? null : opts.assets,
    // Heartbeats are wall-clock timers on a pinned test clock: at the default interval a socket that
    // outlives one would be culled for not answering a PING the test never sees.
    gatewayOptions: { heartbeatIntervalMs: 60_000, heartbeatTimeoutMs: 120_000, ...opts.gatewayOptions },
    ...(opts.roomOptions ? { roomOptions: opts.roomOptions } : {}),
    ...(opts.rng ? { rng: opts.rng } : {}),
    ...(opts.extraRoutes ? { extraRoutes: opts.extraRoutes } : {}),
    ...(opts.writeRateLimit ? { writeRateLimit: opts.writeRateLimit } : {}),
    ...(opts.readRateLimit ? { readRateLimit: opts.readRateLimit } : {}),
    ...(opts.writeIpRateLimit ? { writeIpRateLimit: opts.writeIpRateLimit } : {}),
    ...(opts.upgradeRateLimit ? { upgradeRateLimit: opts.upgradeRateLimit } : {}),
    ...(opts.sessionSweepIntervalMs === undefined ? {} : { sessionSweepIntervalMs: opts.sessionSweepIntervalMs }),
  })

  const harness: Harness = {
    app,
    db,
    setNow: (ms) => { nowMs = ms },
    setDbUp: (up) => { probe = () => Promise.resolve(up) },
    setDbProbe: (fn) => { probe = fn },
    hangDbProbe: () => { probe = () => new Promise<boolean>(() => {}) },
    closeDbCalls: () => closeDbCalls,
    auth: (account) => ({ cookie: account.cookie, ...XRW }),
    async register(payload = GOOD_ACCOUNT) {
      const res = await app.fastify.inject({ method: 'POST', url: '/api/auth/register', headers: XRW, payload })
      if (res.statusCode !== 201) throw new Error(`register failed (${res.statusCode}): ${res.body}`)
      const body = res.json() as { playerId: string; displayName: string; balance: number }
      return { ...body, cookie: cookieHeader(res) }
    },
  }
  return harness
}

/** Everything a test may have written, in foreign-key order. `restart identity` keeps ledger ids comparable across tests. */
export async function resetDb(db: AppDb): Promise<void> {
  await db.execute(
    sql`truncate table sessions, inventory, items, daily_logins, player_stats, player_achievements, gm_actions, ledger_keys, gift_months, point_transactions, game_players, games, players, users restart identity cascade`,
  )
}
