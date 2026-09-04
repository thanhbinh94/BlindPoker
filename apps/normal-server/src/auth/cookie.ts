/**
 * The session cookie: its name, its attributes, and how to read it back.
 *
 * `HttpOnly` keeps it out of JavaScript, so an XSS that gets a script onto the page still cannot
 * exfiltrate the session. `SameSite=Lax` means the browser does not attach it to cross-site POSTs —
 * which, together with the `X-Requested-With` guard in `@bp/http-kit`, is the CSRF story. `Secure`
 * is a parameter rather than a constant because a developer on `http://localhost` would otherwise
 * never receive the cookie at all; production sets `COOKIE_SECURE=true` (its default).
 *
 * The read side deliberately does not go through `@fastify/cookie`'s `req.cookies`. The WebSocket
 * upgrade is not a Fastify request — server-kit's `SessionResolver.fromUpgrade` is handed a raw
 * `IncomingMessage`, before any plugin has touched it — and the cookie has to be read the same way
 * on both paths. So `readSessionCookie` asks only for something with `headers.cookie`, which a
 * `FastifyRequest` and an `IncomingMessage` both are.
 */
import type { CookieSerializeOptions } from '@fastify/cookie'

export const SESSION_COOKIE = 'bp_session'

/** Thirty days, in seconds: the same idle lifetime the session rows are given. */
export const SESSION_COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60

/** Anything with request headers: a `FastifyRequest`, or the `IncomingMessage` of a WebSocket upgrade. */
export interface CookieCarrier {
  headers: { cookie?: string | undefined }
}

/**
 * `maxAgeSec` lets a caller match the cookie to the session it just issued; it defaults to the same
 * thirty days. The two never have to agree for correctness — the server-side row decides what is
 * still a session — but a cookie that outlives every session it could name is a 401 waiting to
 * confuse someone.
 */
export function cookieOptions(secure: boolean, maxAgeSec: number = SESSION_COOKIE_MAX_AGE_SEC): CookieSerializeOptions {
  return { httpOnly: true, sameSite: 'lax', path: '/', secure, maxAge: maxAgeSec }
}

/**
 * One name out of a `Cookie` header (RFC 6265 §4.2.1: `name=value` pairs separated by `; `).
 *
 * The first match wins, as the RFC's ordering intends — a cookie set on a deeper path is sent first,
 * and picking the last would let a `/` cookie planted by a sibling application shadow ours. A value
 * that is not valid percent-encoding is returned as it arrived rather than throwing: the caller's
 * next step is a session lookup that will simply fail to find it.
 */
export function readCookie(req: CookieCarrier, name: string): string | null {
  const header = req.headers.cookie
  if (header === undefined || header === '') return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() !== name) continue
    const raw = part.slice(eq + 1).trim()
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  return null
}

export function readSessionCookie(req: CookieCarrier): string | null {
  return readCookie(req, SESSION_COOKIE)
}
