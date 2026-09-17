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
import type { GameServer, Logger } from '@bp/server-kit'
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
import type { BaseDef } from '../inventory/bases.js'
import type { BaseIds } from '../inventory/slots.js'
import type { InventoryService } from '../inventory/inventory-service.js'
import type { ItemCatalog } from '../inventory/items.js'
import type { AvatarManifest } from '../inventory/manifest.js'
import type { OutfitsService } from '../inventory/outfits-service.js'
import type { NormalRepositories } from '../repos/index.js'
import type { StatsService } from '../stats/stats-service.js'
import { createRequireUser, decorateRequestUser } from './auth-guard.js'
import { LOGIN_RATE_LIMIT, REGISTER_RATE_LIMIT, registerAuthRoutes } from './routes-auth.js'
import { registerCatalogRoutes } from './routes-catalog.js'
import { registerMeRoutes } from './routes-me.js'
import { registerOutfitRoutes } from './routes-outfits.js'
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
  outfits: OutfitsService
  history: HistoryService
  catalog: ItemCatalog
  defs: AchievementDef[]
  /** Old wardrobe ids, kept readable — see `inventory/aliases.ts`. */
  aliases: ReadonlyMap<string, string>
  manifest: AvatarManifest
  bases: Record<string, BaseDef>
  /** `bases`' key set, built once — see `baseIdsOf` in `inventory/bases.ts`. */
  baseIds: BaseIds
  log: Logger
  /** Live socket and room counts for `/health` — the same two numbers Lite's probe reports. */
  game: Pick<GameServer, 'connectionCount'> & { rooms: { size: number } }
  /** This package's version, for `/health`. */
  version: string
  /** `false` answers `/health` with a 503 and `db: 'error'`. */
  pingDb: () => Promise<boolean>
  now?: () => number
  /** Lowered by tests that need to reach a limit without sending sixty real requests. */
  writeRateLimit?: { limit: number; windowMs: number }
  readRateLimit?: { limit: number; windowMs: number }
  writeIpRateLimit?: { limit: number; windowMs: number }
}

/** Spec §19.2: sixty writes a minute for one session. */
export const WRITE_RATE_LIMIT = { limit: 60, windowMs: 60_000 }
/** …and 240 reads a minute for one address. */
export const READ_RATE_LIMIT = { limit: 240, windowMs: 60_000 }
/**
 * The ceiling a *place* may write at, whatever cookies it presents.
 *
 * Twice the per-session limit, because two people behind one address are a household, not an
 * attack — but a caller inventing a fresh `bp_session` value per request would otherwise mint a new
 * per-session bucket every time and never be limited at all.
 */
export const WRITE_IP_RATE_LIMIT = { limit: 120, windowMs: 60_000 }

/** How long `/health` waits for the database probe before answering `db: 'error'` on its own. */
export const HEALTH_PING_TIMEOUT_MS = 2_000

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
/**
 * The only two routes with limiters of their own (`registerAuthRoutes`), and they are far tighter
 * than anything here — five sign-ins a minute per address and account, ten sign-ups per address. The
 * exemption is those two requests, not the `/api/auth/` namespace: `GET /api/auth/me` and
 * `POST /api/auth/logout` each cost a session lookup and a query, and nothing else limits them.
 *
 * Exported, and asserted by name in `app.test.ts`, because this set is the one way a route can
 * become unmetered without any test saying so in as many words. Each entry carries the limit that
 * stands in for the general bucket, so the guard test can size its request budget from the loosest
 * limiter actually in play rather than from a constant that happens to be big enough today.
 */
export const OWN_LIMITER: ReadonlyMap<string, { limit: number; windowMs: number }> = new Map([
  ['/api/auth/register', REGISTER_RATE_LIMIT],
  ['/api/auth/login', LOGIN_RATE_LIMIT],
])

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const now = deps.now ?? Date.now
  const startedAt = now()
  const writeLimiter: RateLimiter = createRateLimiter({ ...(deps.writeRateLimit ?? WRITE_RATE_LIMIT), now })
  const writeIpLimiter: RateLimiter = createRateLimiter({ ...(deps.writeIpRateLimit ?? WRITE_IP_RATE_LIMIT), now })
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
    if (!path.startsWith('/api/')) return
    if (req.method === 'POST' && OWN_LIMITER.has(path)) return
    // A write has to satisfy *both* buckets. The session one is the limit that matters for a real
    // client; the address one is what stops a caller from buying a fresh allowance by sending a
    // cookie value nobody has ever issued.
    const verdicts = MUTATING.has(req.method)
      ? [writeLimiter.check(sessionKey(req)), writeIpLimiter.check(`ip:${req.ip}`)]
      : [readLimiter.check(`ip:${req.ip}`)]
    const denied = verdicts.find((v) => !v.allowed)
    if (denied === undefined) return
    deps.log.warn('rate limited', { ip: req.ip, method: req.method, url: req.url })
    reply.header('retry-after', String(denied.retryAfterSec))
    throw new HttpError(429, 'RATE_LIMITED', 'too many requests', { retryAfterSec: denied.retryAfterSec })
  })

  /**
   * The probe (spec §19.1/§19.2). A 503 with `db: 'error'` rather than a throw: an orchestrator
   * reads the status, and a health endpoint that 500s tells it nothing about *what* is unhealthy.
   *
   * **The body is Lite's, plus `edition` and `version`.** `status`, `uptime`, `connections`, `rooms`
   * and `db` are the same keys with the same meanings in both editions, so one monitoring check
   * serves a Lite box on a LAN and this stack behind Caddy. (`status` reads `degraded` rather than
   * Lite's `error` because the process answering is by definition not down; a monitor keys on the
   * status code or on `db`, which are identical.)
   *
   * The probe is raced against its own deadline, because the one failure this endpoint exists for —
   * a pool with every client checked out, or a server that accepted the connection and went quiet —
   * is exactly the one where the query never returns. Fastify's `requestTimeout` is 0, so without
   * the race the orchestrator gets no answer at all rather than the 503 below.
   */
  app.get('/health', async (_req, reply) => {
    const expiry = new Promise<false>((resolve) => setTimeout(() => resolve(false), HEALTH_PING_TIMEOUT_MS).unref())
    const ok = await Promise.race([deps.pingDb().catch(() => false), expiry])
    return reply.code(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'degraded',
      uptime: Math.max(0, Math.round((now() - startedAt) / 1000)),
      connections: deps.game.connectionCount,
      rooms: deps.game.rooms.size,
      db: ok ? 'ok' : 'error',
      edition: 'normal',
      version: deps.version,
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
  registerOutfitRoutes(app, { outfits: deps.outfits, catalog: deps.catalog, baseIds: deps.baseIds, requireUser })
  registerCatalogRoutes(app, { config: deps.config, catalog: deps.catalog, defs: deps.defs, manifest: deps.manifest, bases: deps.bases })
}
