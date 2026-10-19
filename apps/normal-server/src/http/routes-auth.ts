/**
 * The four authentication endpoints (spec §19.2).
 *
 * The cookie is set here rather than in `AuthService`, and that is the division: the service knows
 * what an account is and what a session is, the routes know that this transport carries sessions in
 * a cookie. The WebSocket upgrade uses the same service without ever touching a `FastifyReply`.
 *
 * Login is rate-limited on `ip|email` rather than on either alone. Per-IP only would let one
 * attacker with a botnet spread a password-spray across addresses; per-email only would let anyone
 * lock a known account out of its own sign-in by failing five times a minute forever. The pair
 * limits the guesses against any one account from any one place without giving a stranger the
 * ability to deny a person their account.
 *
 * Every failure is `@bp/http-kit`'s envelope: the routes throw `HttpError` and the error handler
 * registered by `buildApp` (Task 6) turns it into `{ error: { code, message } }`.
 */
import { createRateLimiter, HttpError, type RateLimiter, type RateLimitVerdict } from '@bp/http-kit'
import type { Logger } from '@bp/server-kit'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { AuthError, MAX_EMAIL_LENGTH, type AuthErrorCode, type AuthService, type SessionGrant } from '../auth/auth-service.js'
import { cookieOptions, readSessionCookie, SESSION_COOKIE } from '../auth/cookie.js'
import type { SessionService } from '../auth/session-service.js'
import type { NormalPlayerRepository } from '../repos/index.js'
import { createRequireUser, currentUser, decorateRequestUser } from './auth-guard.js'
import './types.js'

export interface AuthRouteDeps {
  auth: AuthService
  sessions: SessionService
  repos: { players: NormalPlayerRepository }
  /** `COOKIE_SECURE`: false only for a developer on plain `http://localhost`. */
  cookieSecure: boolean
  log: Logger
  now?: () => number
  /** Overridden by tests that need to reach the limit without sending five real passwords. */
  loginRateLimit?: { limit: number; windowMs: number }
  /** Likewise for registration, whose limit is per address rather than per account. */
  registerRateLimit?: { limit: number; windowMs: number }
}

/** Spec §19.2: five sign-in attempts a minute for one address from one place. */
export const LOGIN_RATE_LIMIT = { limit: 5, windowMs: 60_000 }

/**
 * Registration is the most expensive unauthenticated thing this server does - a 64 MiB argon2 hash
 * and a six-statement transaction, with no password to be wrong first - so it is capped per address
 * too. Ten a minute is far more than a person signs up, and far less than a machine would like.
 */
export const REGISTER_RATE_LIMIT = { limit: 10, windowMs: 60_000 }

/** How an `AuthError` reaches the client. The codes are the client's; only the status is added here. */
const STATUS: Record<AuthErrorCode, number> = {
  INVALID_EMAIL: 400,
  INVALID_PASSWORD: 400,
  INVALID_NAME: 400,
  EMAIL_TAKEN: 409,
  DISPLAY_NAME_TAKEN: 409,
  BAD_CREDENTIALS: 401,
  ACCOUNT_LOCKED: 403,
}

interface AccountBody {
  playerId: string
  displayName: string
  balance: number
  role: 'player' | 'gm'
}

/**
 * `AuthError` is the service's vocabulary; `HttpError` is the transport's. Translating in one place
 * means a new code cannot reach a client as a 500 because some handler forgot to map it.
 */
async function translating<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof AuthError) throw new HttpError(STATUS[err.code], err.code, err.message, err.extra)
    throw err
  }
}

/** A required string field. The code says which field, so the client can put the message where it belongs. */
function stringField(body: unknown, key: string, code: AuthErrorCode): string {
  const value = (body as Record<string, unknown> | null | undefined)?.[key]
  if (typeof value !== 'string') throw new HttpError(STATUS[code], code, `${key} must be a string`)
  return value
}

/**
 * The address as it goes into a rate-limit key: normalized, and *bounded*.
 *
 * The limiter holds one map entry per distinct key for a whole window and only sweeps once it is
 * over a thousand keys, so an unbounded key is a body-sized allocation an unauthenticated caller
 * gets to retain - and one an attacker can vary freely to dilute the limit they are under.
 * Truncating rather than rejecting keeps an over-long address a `401 BAD_CREDENTIALS` like every
 * other address that does not match an account, instead of a 400 that skips the limiter entirely.
 */
function limiterEmail(email: string): string {
  return email.trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH)
}

function credentials(req: FastifyRequest): { email: string; password: string } {
  return {
    email: stringField(req.body, 'email', 'INVALID_EMAIL'),
    password: stringField(req.body, 'password', 'INVALID_PASSWORD'),
  }
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  const now = deps.now ?? Date.now
  const loginLimiter: RateLimiter = createRateLimiter({ ...(deps.loginRateLimit ?? LOGIN_RATE_LIMIT), now })
  const registerLimiter: RateLimiter = createRateLimiter({ ...(deps.registerRateLimit ?? REGISTER_RATE_LIMIT), now })
  const requireUser = createRequireUser(deps)
  decorateRequestUser(app)

  /** One shape for "you have had enough": the `Retry-After` header and the same code in the envelope. */
  function limit(req: FastifyRequest, reply: FastifyReply, verdict: RateLimitVerdict, message: string): void {
    if (verdict.allowed) return
    deps.log.warn('rate limited', { ip: req.ip, url: req.url })
    reply.header('retry-after', String(verdict.retryAfterSec))
    throw new HttpError(429, 'RATE_LIMITED', message, { retryAfterSec: verdict.retryAfterSec })
  }

  /** Sets the cookie for a freshly issued session, giving it exactly that session's remaining life. */
  function grant(reply: FastifyReply, session: SessionGrant): void {
    const maxAgeSec = Math.max(0, Math.round((session.expiresAt.getTime() - now()) / 1000))
    reply.setCookie(SESSION_COOKIE, session.token, cookieOptions(deps.cookieSecure, maxAgeSec))
  }

  async function accountBody(userId: string): Promise<AccountBody> {
    const player = await deps.repos.players.findAuth(userId)
    // The profile was written in the same transaction as the account; its absence here is a bug in
    // this server, not a bad request.
    if (player === null) throw new HttpError(500, 'INTERNAL', 'the account has no player profile')
    return { playerId: player.playerId, displayName: player.displayName, balance: player.balance, role: player.role }
  }

  app.post('/api/auth/register', {
    preHandler: async (req, reply) => {
      limit(req, reply, registerLimiter.check(req.ip), 'too many sign-ups from this address')
    },
  }, async (req, reply) => {
    const { email, password } = credentials(req)
    const displayName = stringField(req.body, 'displayName', 'INVALID_NAME')
    const session = await translating(() => deps.auth.register({ email, password, displayName, userAgent: req.headers['user-agent'] }))
    deps.log.info('account registered', { playerId: session.userId })
    // The body first, the cookie second: `@fastify/cookie` writes reply cookies on `onSend` whatever
    // the status, so setting it before this line could hand a client a 500 *and* a live session.
    const body = await accountBody(session.userId)
    grant(reply, session)
    return reply.code(201).send(body)
  })

  app.post('/api/auth/login', {
    // A pre-handler, not a check inside the body: `preHandler` runs after the body is parsed, so the
    // email is available, and a rate-limited attempt then never reaches argon2 at all.
    //
    // A missing `email` field is a 400 while an `email` that is merely not an address is a 401: the
    // first is a malformed request, the second is a credential that matches no account - and
    // answering the second with a 400 would tell a caller which addresses this server considers
    // registerable.
    preHandler: async (req, reply) => {
      const email = stringField(req.body, 'email', 'INVALID_EMAIL')
      limit(req, reply, loginLimiter.check(`${req.ip}|${limiterEmail(email)}`), 'too many sign-in attempts for this account')
    },
  }, async (req, reply) => {
    const { email, password } = credentials(req)
    const session = await translating(() =>
      deps.auth.login({ email, password, userAgent: req.headers['user-agent'], currentToken: readSessionCookie(req) }),
    )
    deps.log.info('signed in', { playerId: session.userId })
    const body = await accountBody(session.userId)
    grant(reply, session)
    return reply.code(200).send(body)
  })

  app.post('/api/auth/logout', async (req, reply) => {
    const token = readSessionCookie(req)
    if (token !== null) await deps.auth.logout(token)
    // Cleared unconditionally: a cookie naming a session that no longer exists is a 401 on every
    // request until the browser is told to forget it.
    reply.clearCookie(SESSION_COOKIE, cookieOptions(deps.cookieSecure))
    return reply.code(204).send()
  })

  app.get('/api/auth/me', { preHandler: requireUser }, async (req, reply) => {
    return reply.code(200).send(await accountBody(currentUser(req).userId))
  })
}
