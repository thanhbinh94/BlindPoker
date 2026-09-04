import { describe, expect, it } from 'vitest'
import { cookieOptions, readCookie, readSessionCookie, SESSION_COOKIE, SESSION_COOKIE_MAX_AGE_SEC } from './cookie.js'

const carrier = (cookie?: string): { headers: { cookie?: string } } => ({ headers: cookie === undefined ? {} : { cookie } })

describe('cookieOptions', () => {
  it('is HttpOnly, Lax, rooted at / and thirty days long', () => {
    expect(cookieOptions(true)).toEqual({ httpOnly: true, sameSite: 'lax', path: '/', secure: true, maxAge: SESSION_COOKIE_MAX_AGE_SEC })
    expect(SESSION_COOKIE_MAX_AGE_SEC).toBe(2_592_000)
  })

  it('takes Secure from the caller, so a developer on http://localhost still receives it', () => {
    expect(cookieOptions(false).secure).toBe(false)
    expect(cookieOptions(true).secure).toBe(true)
  })

  it('accepts a shorter lifetime, for matching the session that was just issued', () => {
    expect(cookieOptions(true, 60).maxAge).toBe(60)
  })
})

describe('readSessionCookie', () => {
  it('finds the session cookie among others', () => {
    expect(readSessionCookie(carrier(`lang=vi; ${SESSION_COOKIE}=abc123; theme=dark`))).toBe('abc123')
    expect(readSessionCookie(carrier(`${SESSION_COOKIE}=abc123`))).toBe('abc123')
  })

  it('returns null when there is no cookie header, no such cookie, or nothing but noise', () => {
    expect(readSessionCookie(carrier())).toBeNull()
    expect(readSessionCookie(carrier(''))).toBeNull()
    expect(readSessionCookie(carrier('lang=vi'))).toBeNull()
    expect(readSessionCookie(carrier('nonsense'))).toBeNull()
  })

  it('does not match a cookie whose name merely ends with ours', () => {
    expect(readSessionCookie(carrier(`not_${SESSION_COOKIE}=abc123`))).toBeNull()
    expect(readSessionCookie(carrier(`${SESSION_COOKIE}_old=abc123`))).toBeNull()
  })

  it('takes the first of two, so a cookie planted at / cannot shadow the one set for this path', () => {
    expect(readSessionCookie(carrier(`${SESSION_COOKIE}=mine; ${SESSION_COOKIE}=planted`))).toBe('mine')
  })

  it('percent-decodes, and hands back a malformed value rather than throwing', () => {
    expect(readCookie(carrier('x=a%20b'), 'x')).toBe('a b')
    expect(readCookie(carrier('x=%E0%A4%A'), 'x')).toBe('%E0%A4%A')
  })

  it('reads the same header off a raw upgrade request, which is not a Fastify request at all', () => {
    // The shape server-kit's `SessionResolver.fromUpgrade` is handed: `IncomingMessage`, no plugins.
    const upgrade = { headers: { cookie: `${SESSION_COOKIE}=from-upgrade`, upgrade: 'websocket' } }
    expect(readSessionCookie(upgrade)).toBe('from-upgrade')
  })
})
