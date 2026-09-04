/**
 * Every route this server answers, in one place, plus the two things that are true of all of them:
 * the health probe and the rate limits.
 *
 * `buildApp` wires the generic plumbing around this call — the security headers, the CSRF guard, the
 * tolerant JSON parser, the error envelope and the static `/*` fallback, all from `@bp/http-kit`.
 * What is here is the edition's own surface.
 *
 * **Rate limits (spec §19.2).** One hook, two buckets. A mutating `/api/*` request is limited per
 * session — sixty a minute is far more than a person clicking, and far less than a script — while a
 * read is limited per address at 240, because reads are shared by every tab a household has open
 * behind one NAT. `/api/auth/*` is skipped: `registerAuthRoutes` limits sign-in and sign-up far more
 * tightly than this would, and applying both would only make the looser one invisible.
 *
 * The session bucket is keyed on a *hash* of the cookie, not on the player id: this hook is
 * instance-wide, so it runs before any route's `requireUser` has resolved a session, and hashing is
 * what lets the key be per-session without holding a live session token in a map for a minute.
 */
import { createHash } from 'node:crypto'
import { createRateLimiter, HttpError, type RateLimiter } from '@bp/http-kit'
import type { Logger } from '@bp/server-kit'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { AchievementService } from '../achievements/achievement-service.js'
import type { AchievementDef } from '../achievements/definitions.js'
import type { AuthService } from '../auth/auth-service.js'
import { readSessionCookie } from '../auth/cookie.js'
import type { SessionService } from '../auth/session-service.js'
import type { NormalConfig } from '../config.js'
import type { AppDb } from '../db/client.js'
import type { EconomyService } from '../economy/economy-service.js'
import type { HistoryService } from '../history/history-service.js'
import type { InventoryService } from '../inventory/inventory-service.js'
import type { ItemCatalog } from '../inventory/items.js'
import type { NormalRepositories } from '../repos/index.js'
import type { StatsService } from '../stats/stats-service.js'
import { createRequireUser, decorateRequestUser } from './auth-guard.js'
import { registerAuthRoutes } from './routes-auth.js'
import { registerCatalogRoutes } from './routes-catalog.js'
import { registerMeRoutes } from './routes-me.js'
import { registerRewardRoutes } from './routes-rewards.js'
import './types.js'

export interface RouteDeps {
  config: NormalConfig
  db: AppDb
  repos: NormalRepositories
  auth: AuthService
  sessions: SessionService
  economy: EconomyService
  stats: StatsService
  achievements: AchievementService
  inventory: InventoryService
  history: HistoryService
  catalog: ItemCatalog
  defs: AchievementDef[]
  log: Logger
  /** This package's version, for `/health`. */
  version: string
  /** `false` answers `/health` with a 503 and `db: 'down'`. */
  pingDb: () => Promise<boolean>
  now?: () => number
  /** Lowered by tests that need to reach a limit without sending sixty real requests. */
  writeRateLimit?: { limit: number; windowMs: number }
  readRateLimit?: { limit: number; windowMs: number }
}

/** Spec §19.2: sixty writes a minute for one session. */
const WRITE_RATE_LIMIT = { limit: 60, windowMs: 60_000 }
/** …and 240 reads a minute for one address. */
const READ_RATE_LIMIT = { limit: 240, windowMs: 60_000 }

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
/** Sign-in and sign-up carry their own, much tighter limits; a second one here would never bind. */
const UNLIMITED_PREFIX = '/api/auth/'

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const now = deps.now ?? Date.now
  const startedAt = now()
  const writeLimiter: RateLimiter = createRateLimiter({ ...(deps.writeRateLimit ?? WRITE_RATE_LIMIT), now })
  const readLimiter: RateLimiter = createRateLimiter({ ...(deps.readRateLimit ?? READ_RATE_LIMIT), now })

  decorateRequestUser(app)
  const requireUser = createRequireUser(deps)

  /** A stable, non-secret handle on one session; an anonymous caller falls back to their address. */
  const sessionKey = (req: FastifyRequest): string => {
    const token = readSessionCookie(req)
    return token === null ? `ip:${req.ip}` : `s:${createHash('sha256').update(token).digest('hex')}`
  }

  app.addHook('preHandler', async (req, reply) => {
    const path = req.url.split('?')[0] ?? ''
    // `/health` is what a load balancer polls every few seconds, and the static SPA is files: only
    // the API is metered.
    if (!path.startsWith('/api/') || path.startsWith(UNLIMITED_PREFIX)) return
    const mutating = MUTATING.has(req.method)
    const verdict = (mutating ? writeLimiter : readLimiter).check(mutating ? sessionKey(req) : `ip:${req.ip}`)
    if (verdict.allowed) return
    deps.log.warn('rate limited', { ip: req.ip, method: req.method, url: req.url })
    reply.header('retry-after', String(verdict.retryAfterSec))
    throw new HttpError(429, 'RATE_LIMITED', 'too many requests', { retryAfterSec: verdict.retryAfterSec })
  })

  /**
   * The probe (spec §19.2). A 503 with `db: 'down'` rather than a throw: an orchestrator reads the
   * status, and a health endpoint that 500s tells it nothing about *what* is unhealthy.
   */
  app.get('/health', async (_req, reply) => {
    const ok = await deps.pingDb()
    return reply.code(ok ? 200 : 503).send({
      ok,
      edition: 'normal',
      version: deps.version,
      db: ok ? 'ok' : 'down',
      uptimeSec: Math.max(0, Math.round((now() - startedAt) / 1000)),
    })
  })

  registerAuthRoutes(app, {
    auth: deps.auth,
    sessions: deps.sessions,
    repos: deps.repos,
    cookieSecure: deps.config.cookieSecure,
    log: deps.log,
    ...(deps.now ? { now: deps.now } : {}),
  })
  registerMeRoutes(app, { ...deps, requireUser })
  registerRewardRoutes(app, { economy: deps.economy, requireUser })
  registerCatalogRoutes(app, { config: deps.config, catalog: deps.catalog, defs: deps.defs })
}
