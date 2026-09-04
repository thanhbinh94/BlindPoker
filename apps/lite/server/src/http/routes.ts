import { timingSafeEqual } from 'node:crypto'
import { ECONOMY, type PlayerIdentity } from '@bp/core'
import type { GameServer, Logger } from '@bp/server-kit'
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { LiteConfig } from '../config.js'
import { reliefEligible } from '../economy/daily.js'
import type { EconomyService } from '../economy/economy-service.js'
import { NameTakenError, type LiteRepositories } from '../repos/sqlite-repos.js'
import { RUN_FILE_NAME } from '../run-file.js'
import { InvalidNameError, type SessionService } from '../session/session-service.js'
import type { AssetSource } from './assets.js'
import { createRateLimiter } from './rate-limit.js'

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the `requireSession` pre-handler; `null` on every route that does not use it. */
    identity: PlayerIdentity | null
  }
}

export interface RouteDeps {
  repos: LiteRepositories
  sessions: SessionService
  economy: EconomyService
  game: GameServer
  config: LiteConfig
  log: Logger
  assets?: AssetSource | null
  now?: () => number
  /** The loopback stop path: the run token this instance published, and the graceful shutdown it triggers. */
  admin: { token: string; requestShutdown: () => void }
}

/** Every REST failure is `{ error: { code, message } }` (spec §19); this is how a handler asks for one. */
export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly extra?: Record<string, unknown>) {
    super(message)
    this.name = 'HttpError'
  }
}

/**
 * `connect-src 'self'` alone covers the WebSocket too: a `ws://`/`wss://` URL on the page's own
 * origin matches `'self'` in CSP 3, which every browser Lite targets implements. The four directives
 * after it close what `default-src` does not reach — framing, `<base href>`, form posts and plugins.
 */
const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')
const REQUESTED_WITH = 'bind-poker'
const SESSION_RATE_LIMIT = { limit: 10, windowMs: 60_000 }
/** The stop endpoint is not a login: five attempts a minute is far more than an operator needs. */
const ADMIN_RATE_LIMIT = { limit: 5, windowMs: 60_000 }
const LANGUAGES = ['vi', 'en']
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'
/** Paths the SPA fallback must never answer: a typo under them is a 404, not the index page. */
const RESERVED = ['api', 'ws', 'health']
/** Stable codes for the failures Fastify raises before a handler runs, so clients never see `FST_ERR_*`. */
const FASTIFY_CODES: Record<number, string> = { 400: 'BAD_REQUEST', 404: 'NOT_FOUND', 413: 'PAYLOAD_TOO_LARGE', 415: 'UNSUPPORTED_MEDIA_TYPE', 429: 'RATE_LIMITED' }

function isNoStore(url: string): boolean {
  const path = url.split('?')[0] ?? ''
  return path === '/health' || path === '/api' || path.startsWith('/api/')
}

/**
 * `Authorization: Bearer <token>`, with the scheme matched case-insensitively — RFC 7235 §2.1 makes
 * the scheme a case-insensitive token, and `bearer` from a hand-rolled client is not a 401.
 */
export function bearerToken(header: string | undefined): string {
  if (header === undefined) return ''
  const space = header.indexOf(' ')
  if (space < 0) return ''
  if (header.slice(0, space).toLowerCase() !== 'bearer') return ''
  return header.slice(space + 1).trim()
}

/**
 * True for an address that can only belong to this machine: IPv6 `::1`, anything in `127.0.0.0/8`,
 * and the IPv4-mapped form Node reports on a dual-stack Windows listener (`::ffff:127.0.0.1`).
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined || address === '') return false
  const addr = address.startsWith('::ffff:') ? address.slice(7) : address
  return addr === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr)
}

/** Constant-time comparison that does not leak the expected length through an early return. */
function secretEquals(given: string, expected: string): boolean {
  const a = Buffer.from(given, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const now = deps.now ?? Date.now
  const startedAt = now()
  const assets = deps.assets ?? null
  const sessionLimiter = createRateLimiter({ ...SESSION_RATE_LIMIT, now })
  const adminLimiter = createRateLimiter({ ...ADMIN_RATE_LIMIT, now })

  app.decorateRequest('identity', null)

  // Headers first, so they are present on error and 404 responses too, not just on handled routes.
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff')
    reply.header('referrer-policy', 'no-referrer')
    reply.header('content-security-policy', CSP)
    // `frame-ancestors` already says this, but it is CSP 3: the legacy header covers the browsers
    // (and the embedded webviews on a LAN kiosk) that only understand X-Frame-Options.
    reply.header('x-frame-options', 'DENY')
    if (isNoStore(req.url)) reply.header('cache-control', 'no-store')
  })

  /**
   * CSRF guard (spec §19): a mutating request must carry `X-Requested-With: bind-poker`. Only
   * fetch/XHR can set a custom header, and doing so on a cross-origin request forces a preflight
   * that this server never answers — so a form or an image tag on another site cannot reach these.
   */
  app.addHook('preHandler', async (req) => {
    if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH' && req.method !== 'DELETE') return
    if (req.headers['x-requested-with'] !== REQUESTED_WITH) {
      throw new HttpError(403, 'FORBIDDEN', `mutating requests require the X-Requested-With: ${REQUESTED_WITH} header`)
    }
  })

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ ...(err.extra ?? {}), error: { code: err.code, message: err.message } })
    }
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500
    if (status >= 500) {
      deps.log.error('request failed', { method: req.method, url: req.url, err: String(err) })
      return reply.code(500).send({ error: { code: 'INTERNAL', message: 'internal server error' } })
    }
    // Fastify's own 4xx: unparseable JSON, an oversized body, an unsupported content type.
    return reply.code(status).send({ error: { code: FASTIFY_CODES[status] ?? 'BAD_REQUEST', message: err.message } })
  })

  app.setNotFoundHandler((req, reply) => {
    void reply.code(404).send({ error: { code: 'NOT_FOUND', message: `no route for ${req.method} ${req.url}` } })
  })

  /** Resolves `Authorization: Bearer <token>` into `req.identity`, or fails the request with 401. */
  const requireSession = async (req: FastifyRequest): Promise<void> => {
    const token = bearerToken(req.headers.authorization)
    const identity = token ? deps.sessions.resolve(token) : null
    if (!identity) throw new HttpError(401, 'UNAUTHENTICATED', 'a valid session token is required')
    req.identity = identity
  }

  const authed = { preHandler: requireSession }
  const playerIdOf = (req: FastifyRequest): string => {
    if (!req.identity) throw new HttpError(401, 'UNAUTHENTICATED', 'a valid session token is required')
    return req.identity.playerId
  }

  app.get('/health', async (_req, reply) => {
    let db: 'ok' | 'error' = 'ok'
    try {
      deps.repos.db.prepare('SELECT 1').get()
    } catch (err) {
      db = 'error'
      deps.log.error('health check: database unreachable', { err: String(err) })
    }
    const body = {
      status: db === 'ok' ? 'ok' : 'error',
      uptime: Math.max(0, Math.round((now() - startedAt) / 1000)),
      connections: deps.game.connectionCount,
      rooms: deps.game.rooms.size,
      db,
    }
    return reply.code(db === 'ok' ? 200 : 503).send(body)
  })

  app.get('/api/config', async (_req, reply) =>
    reply.send({
      edition: 'lite',
      wsPath: '/ws',
      economy: {
        startingBalance: ECONOMY.startingBalance,
        blindWagerTiers: [...ECONOMY.blindWagerTiers],
        holdemBlindTiers: ECONOMY.holdemBlindTiers.map((t) => ({ smallBlind: t.smallBlind, bigBlind: t.bigBlind })),
        reliefThreshold: ECONOMY.reliefThreshold,
        reliefTarget: ECONOMY.reliefTarget,
      },
      languages: LANGUAGES,
    }))

  app.post('/api/session', {
    preHandler: async (req, reply) => {
      const verdict = sessionLimiter.check(req.ip)
      if (verdict.allowed) return
      reply.header('retry-after', String(verdict.retryAfterSec))
      throw new HttpError(429, 'RATE_LIMITED', 'too many sessions from this address', { retryAfterSec: verdict.retryAfterSec })
    },
  }, async (req, reply) => {
    const body = req.body as { displayName?: unknown } | undefined
    const displayName = body?.displayName
    if (typeof displayName !== 'string') throw new HttpError(400, 'INVALID_NAME', 'displayName must be a string')
    try {
      const session = deps.sessions.create(displayName)
      deps.log.info('session created', { playerId: session.playerId })
      return await reply.code(201).send(session)
    } catch (err) {
      if (err instanceof InvalidNameError) throw new HttpError(400, 'INVALID_NAME', err.message)
      if (err instanceof NameTakenError) throw new HttpError(409, 'DISPLAY_NAME_TAKEN', err.message)
      throw err
    }
  })

  app.get('/api/me', authed, async (req, reply) => {
    const playerId = playerIdOf(req)
    const player = deps.repos.getLitePlayer(playerId)
    if (!player) throw new HttpError(401, 'UNAUTHENTICATED', 'a valid session token is required')
    return reply.send({
      playerId: player.playerId,
      displayName: player.displayName,
      balance: player.balance,
      stats: { handsPlayed: player.handsPlayed, handsWon: player.handsWon },
      daily: deps.economy.dailyStatus(playerId),
      relief: reliefEligible(player.balance, player.lastReliefAt, now()),
    })
  })

  app.get('/api/rewards/daily', authed, async (req, reply) => reply.send(deps.economy.dailyStatus(playerIdOf(req))))

  app.post('/api/rewards/daily/claim', authed, async (req, reply) => {
    const result = await deps.economy.claimDaily(playerIdOf(req))
    if (!result.claimed) throw new HttpError(409, 'ALREADY_CLAIMED', 'the daily reward has already been claimed today', { claimed: false })
    return reply.send(result)
  })

  app.post('/api/economy/relief', authed, async (req, reply) => {
    const result = await deps.economy.relief(playerIdOf(req))
    if (!result.granted) {
      const message = result.reason === 'cooldown' ? 'relief is still on cooldown' : 'relief is only granted below the threshold'
      throw new HttpError(409, 'NOT_ELIGIBLE', message, { granted: false, reason: result.reason, retryAt: result.retryAt })
    }
    return reply.send(result)
  })

  /**
   * The only graceful stop Windows can offer from outside the console (spec §28.2). Three
   * independent guards, in the order a refusal is cheapest:
   *
   * 1. a fixed-window rate limit, so a local process cannot grind at the token;
   * 2. the peer must be on the loopback — a run token that leaked off the machine is still useless;
   * 3. the run token itself, compared in constant time.
   *
   * The reply goes out first and the drain starts when the socket has flushed it: `close()` tears
   * down the very listener this response is travelling on, so the two must not overlap.
   */
  app.post('/api/admin/shutdown', {
    preHandler: async (req, reply) => {
      const verdict = adminLimiter.check(req.ip)
      if (!verdict.allowed) {
        reply.header('retry-after', String(verdict.retryAfterSec))
        throw new HttpError(429, 'RATE_LIMITED', 'too many shutdown attempts', { retryAfterSec: verdict.retryAfterSec })
      }
      const remote = req.socket.remoteAddress
      if (!isLoopbackAddress(remote)) {
        deps.log.warn('admin shutdown refused: the caller is not on the loopback', { remote: remote ?? 'unknown' })
        throw new HttpError(403, 'FORBIDDEN', 'the shutdown endpoint only answers the local machine')
      }
      if (!secretEquals(bearerToken(req.headers.authorization), deps.admin.token)) {
        deps.log.warn('admin shutdown refused: wrong run token', { remote: remote ?? 'unknown' })
        throw new HttpError(401, 'UNAUTHENTICATED', `the run token from ${RUN_FILE_NAME} is required`)
      }
    },
  }, async (_req, reply) => {
    deps.log.info('shutdown requested through the loopback admin endpoint')
    // Whichever of the two fires first wins; `requestShutdown` is idempotent.
    reply.raw.once('finish', deps.admin.requestShutdown)
    reply.raw.once('close', deps.admin.requestShutdown)
    return reply.send({ ok: true })
  })

  // Registered last: `/*` matches everything the routes above did not claim.
  app.get('/*', async (req, reply) => {
    const requested = (req.params as { '*'?: string })['*'] ?? ''
    const notFound = (): FastifyReply => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } })
    if (!assets) return notFound()

    const first = requested.split('/')[0] ?? ''
    if (RESERVED.includes(first)) return notFound()

    const direct = requested === '' ? null : assets.get(requested)
    if (direct) {
      // Only content-hashed names may be cached: everything else (index.html, favicon.ico) keeps
      // its name when the exe is replaced, so it has to be revalidated on every load.
      reply.header('cache-control', direct.immutable ? IMMUTABLE_CACHE : 'no-cache')
      return reply.type(direct.type).send(direct.body)
    }

    // SPA fallback: the client routes on the hash, but a hand-typed `/lobby` must still boot the app.
    // A path with a file extension is a real asset request, so a miss there stays a miss.
    const base = requested.slice(requested.lastIndexOf('/') + 1)
    if (base.includes('.')) return notFound()

    const index = assets.get('index.html')
    if (!index) return notFound()
    reply.header('cache-control', 'no-cache')
    return reply.type(index.type).send(index.body)
  })
}
