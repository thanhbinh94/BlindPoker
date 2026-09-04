/**
 * Server-side sessions.
 *
 * The cookie carries 32 random bytes; the database stores `hex(HMAC-SHA256(secret, token))` as the
 * primary key and never the token itself. Two properties follow, and both are the point:
 *
 * - A dump of `sessions` is not a set of cookies. An attacker who reads every row still cannot sign
 *   in as anyone, because the rows are one-way images of tokens they do not have.
 * - Lookup is a primary-key hit, not a scan-and-compare. There is no secret comparison to time —
 *   the HMAC is computed from the presented token and the row either exists or does not — so this
 *   file has no `timingSafeEqual` and needs none.
 *
 * HMAC rather than a bare SHA-256 (which is what Lite does with its token) because Normal's session
 * ids are long-lived and this database is on a network: keying the digest with `SESSION_SECRET`
 * means that even an attacker who can *write* rows cannot mint an id for a token of their choosing
 * without also holding the secret from the server's environment.
 *
 * Expiry is sliding. A session that is used stays alive; one that is not dies 30 days after its last
 * use. The extension is throttled to at most once an hour per session (`touchIntervalMs`) so that a
 * player clicking through a lobby writes one row per hour rather than one row per request.
 */
import { createHmac, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { AppDb } from '../db/client.js'
import { sessions } from '../db/schema.js'

export interface SessionService {
  create(userId: string, userAgent: string | undefined): Promise<{ token: string; expiresAt: Date }>
  /** The session behind a cookie value, sliding its expiry along the way; `null` if unknown or expired. */
  resolve(token: string): Promise<{ userId: string; sessionId: string } | null>
  revoke(token: string): Promise<void>
  /** Every session of one account — what a password change or a "sign out everywhere" calls. */
  revokeAll(userId: string): Promise<void>
  /** Extends a session unconditionally. `resolve` calls this at most once per `touchIntervalMs`. */
  touch(sessionId: string): Promise<void>
}

export interface SessionServiceOptions {
  /** `SESSION_SECRET` from the configuration: the HMAC key, not a signing key for the cookie. */
  secret: string
  /** Idle lifetime in days, default 30. */
  ttlDays?: number
  /** How rarely a resolve may write, default one hour. */
  touchIntervalMs?: number
  now?: () => number
}

const DEFAULT_TTL_DAYS = 30
const DEFAULT_TOUCH_INTERVAL_MS = 3_600_000
const DAY_MS = 86_400_000
const TOKEN_BYTES = 32
/** A `User-Agent` is client-controlled and unbounded; it is kept for the "your devices" list, not trusted. */
const MAX_USER_AGENT = 256

export function createSessionService(db: AppDb, opts: SessionServiceOptions): SessionService {
  const now = opts.now ?? Date.now
  const ttlMs = (opts.ttlDays ?? DEFAULT_TTL_DAYS) * DAY_MS
  const touchIntervalMs = opts.touchIntervalMs ?? DEFAULT_TOUCH_INTERVAL_MS

  const idOf = (token: string): string => createHmac('sha256', opts.secret).update(token).digest('hex')

  async function extend(sessionId: string, at: number): Promise<void> {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(at), expiresAt: new Date(at + ttlMs) })
      .where(eq(sessions.id, sessionId))
  }

  return {
    async create(userId, userAgent) {
      const token = randomBytes(TOKEN_BYTES).toString('base64url')
      const at = now()
      const expiresAt = new Date(at + ttlMs)
      await db.insert(sessions).values({
        id: idOf(token),
        userId,
        expiresAt,
        userAgent: userAgent === undefined ? null : userAgent.slice(0, MAX_USER_AGENT),
        createdAt: new Date(at),
        lastSeenAt: new Date(at),
      })
      return { token, expiresAt }
    },

    async resolve(token) {
      if (token === '') return null
      const sessionId = idOf(token)
      const [row] = await db
        .select({ userId: sessions.userId, expiresAt: sessions.expiresAt, lastSeenAt: sessions.lastSeenAt })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
      if (!row) return null
      const at = now()
      if (row.expiresAt.getTime() <= at) {
        // Deleted rather than left to a sweeper: the row is dead the moment it is read, and the read
        // is the only moment anything is guaranteed to look at it.
        await db.delete(sessions).where(eq(sessions.id, sessionId))
        return null
      }
      if (at - row.lastSeenAt.getTime() >= touchIntervalMs) await extend(sessionId, at)
      return { userId: row.userId, sessionId }
    },

    async revoke(token) {
      if (token === '') return
      await db.delete(sessions).where(eq(sessions.id, idOf(token)))
    },

    async revokeAll(userId) {
      await db.delete(sessions).where(eq(sessions.userId, userId))
    },

    async touch(sessionId) {
      await extend(sessionId, now())
    },
  }
}
