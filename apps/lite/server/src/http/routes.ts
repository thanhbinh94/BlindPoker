import { ECONOMY, type PlayerIdentity } from '@bp/core'
import { bearerToken, createRateLimiter, HttpError, isLoopbackAddress, secretEquals } from '@bp/http-kit'
import type { GameServer, Logger } from '@bp/server-kit'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { LiteConfig } from '../config.js'
import { reliefEligible } from '../economy/daily.js'
import type { EconomyService } from '../economy/economy-service.js'
import { NameTakenError, type LiteRepositories } from '../repos/sqlite-repos.js'
import { RUN_FILE_NAME } from '../run-file.js'
import { InvalidNameError, type SessionService } from '../session/session-service.js'

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
  now?: () => number
  /** The loopback stop path: the run token this instance published, and the graceful shutdown it triggers. */
  admin: { token: string; requestShutdown: () => void }
}

const SESSION_RATE_LIMIT = { limit: 10, windowMs: 60_000 }
/** The stop endpoint is not a login: five attempts a minute is far more than an operator needs. */
const ADMIN_RATE_LIMIT = { limit: 5, windowMs: 60_000 }
const LANGUAGES = ['vi', 'en']

/**
 * Lite's own endpoints. The generic HTTP plumbing they sit on — the security headers, the CSRF
 * guard, the error envelope, the tolerant JSON parser and the static `/*` route — is `@bp/http-kit`,
 * wired in `buildApp` around this call.
 */
export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const now = deps.now ?? Date.now
  const startedAt = now()
  const sessionLimiter = createRateLimiter({ ...SESSION_RATE_LIMIT, now })
  const adminLimiter = createRateLimiter({ ...ADMIN_RATE_LIMIT, now })

  app.decorateRequest('identity', null)

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
}
