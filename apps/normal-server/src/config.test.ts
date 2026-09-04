import { describe, expect, it } from 'vitest'
import { CONFIG_DEFAULTS, loadConfig } from './config.js'

const SECRET = 'x'.repeat(32)
const VALID = { DATABASE_URL: 'postgres://bp:pw@localhost:5432/bp', SESSION_SECRET: SECRET, ALLOWED_ORIGINS: 'https://poker.example.com' }

describe('loadConfig', () => {
  it('needs only the three required vars, and defaults the rest', () => {
    const c = loadConfig(VALID)
    expect(c.databaseUrl).toBe(VALID.DATABASE_URL)
    expect(c.sessionSecret).toBe(SECRET)
    expect(c.allowedOrigins).toEqual(['https://poker.example.com'])
    expect(c).toMatchObject(CONFIG_DEFAULTS)
  })

  it('reads the optional vars', () => {
    const c = loadConfig({
      ...VALID,
      PORT: '3000',
      HOST: '127.0.0.1',
      LOG_LEVEL: 'debug',
      ECONOMY_TIMEZONE: 'UTC',
      RECONNECT_WINDOW_SEC: '0',
      PUBLIC_DIR: '/srv/web',
      COOKIE_SECURE: 'false',
      TRUST_PROXY: 'uniquelocal',
      MAX_CONNECTIONS: '250',
      ALLOWED_ORIGINS: 'https://a.example.com, http://localhost:5173',
    })
    expect(c).toEqual({
      port: 3000,
      host: '127.0.0.1',
      databaseUrl: VALID.DATABASE_URL,
      sessionSecret: SECRET,
      allowedOrigins: ['https://a.example.com', 'http://localhost:5173'],
      logLevel: 'debug',
      timezone: 'UTC',
      reconnectWindowSec: 0,
      publicDir: '/srv/web',
      cookieSecure: false,
      trustProxy: 'uniquelocal',
      maxConnections: 250,
    })
  })

  it('lists every missing required var in one error', () => {
    let message = ''
    try {
      loadConfig({})
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toMatch(/DATABASE_URL/)
    expect(message).toMatch(/SESSION_SECRET/)
    expect(message).toMatch(/ALLOWED_ORIGINS/)
  })

  it('lists an invalid optional var alongside the missing required ones', () => {
    const message = (() => {
      try {
        loadConfig({ PORT: 'abc', LOG_LEVEL: 'loud' })
        return ''
      } catch (err) {
        return (err as Error).message
      }
    })()
    for (const key of ['DATABASE_URL', 'SESSION_SECRET', 'ALLOWED_ORIGINS', 'PORT', 'LOG_LEVEL']) expect(message).toMatch(key)
  })

  it('treats a blank or whitespace-only value as unset', () => {
    expect(() => loadConfig({ ...VALID, SESSION_SECRET: '   ' })).toThrow(/SESSION_SECRET is required/)
    expect(() => loadConfig({ ...VALID, ALLOWED_ORIGINS: ' , ' })).toThrow(/ALLOWED_ORIGINS is required/)
  })

  it('rejects a short session secret', () => {
    expect(() => loadConfig({ ...VALID, SESSION_SECRET: 'x'.repeat(31) })).toThrow(/SESSION_SECRET must be at least 32/)
    expect(loadConfig({ ...VALID, SESSION_SECRET: 'x'.repeat(32) }).sessionSecret).toHaveLength(32)
  })

  it('rejects a database URL that is not postgres', () => {
    expect(() => loadConfig({ ...VALID, DATABASE_URL: 'mysql://localhost/bp' })).toThrow(/DATABASE_URL must be a postgres/)
    expect(loadConfig({ ...VALID, DATABASE_URL: 'postgresql://localhost/bp' }).databaseUrl).toBe('postgresql://localhost/bp')
  })

  /**
   * The failure the guide used to walk two operators in five straight into: `openssl rand -base64 24`
   * emits `/` about 40 % of the time at that length, the `/` ends the URL's authority section, and
   * `pg` threw `Invalid URL` from inside the driver — no variable named, nothing pointing at the
   * password. The check is `new URL()` now, so the failure is named beside every other one at start-up.
   */
  it('rejects a DATABASE_URL that is not a valid URL, and names the password as the likely cause', () => {
    const message = (() => {
      try {
        loadConfig({ ...VALID, DATABASE_URL: 'postgres://postgres:ab/cd@db:5432/bind_poker' })
        return ''
      } catch (err) {
        return (err as Error).message
      }
    })()
    expect(message).toMatch(/DATABASE_URL is not a valid URL/)
    expect(message).toMatch(/percent-encoded/)
    // The URL carries the password, so it is never echoed back into the message.
    expect(message).not.toContain('ab/cd')

    // A password that only *looks* dangerous is fine: `@` and `+` parse, and `pg` reads the userinfo.
    expect(loadConfig({ ...VALID, DATABASE_URL: 'postgres://postgres:a%2Fb+c@db:5432/bind_poker' }).databaseUrl).toContain('a%2Fb')
  })

  describe('TRUST_PROXY', () => {
    /**
     * The blocker this whole shape exists for: `true` compiles to "trust every hop" in Fastify, so
     * `req.ip` becomes the client-written left-most `X-Forwarded-For` entry and every IP-keyed rate
     * limit is bypassed by varying one header. It is refused with the safe forms named rather than
     * silently accepted.
     */
    it('refuses a bare true, and says what to write instead', () => {
      for (const raw of ['true', 'TRUE', '1', 'yes', 'on']) {
        const message = (() => {
          try {
            loadConfig({ ...VALID, TRUST_PROXY: raw })
            return ''
          } catch (err) {
            return (err as Error).message
          }
        })()
        expect(message, raw).toMatch(/TRUST_PROXY must name the hops to trust/)
        for (const form of ['uniquelocal', 'loopback', 'linklocal', 'comma-separated']) expect(message, `${raw} → ${form}`).toContain(form)
      }
    })

    it('accepts false, the named ranges, and a comma-separated list of addresses and CIDRs', () => {
      expect(loadConfig({ ...VALID }).trustProxy).toBe(false)
      for (const raw of ['false', '0', 'no', 'off']) expect(loadConfig({ ...VALID, TRUST_PROXY: raw }).trustProxy, raw).toBe(false)
      for (const name of ['uniquelocal', 'loopback', 'linklocal']) expect(loadConfig({ ...VALID, TRUST_PROXY: name }).trustProxy, name).toBe(name)
      // Normalised to what Fastify's `proxy-addr` compile step expects: trimmed, comma-joined.
      expect(loadConfig({ ...VALID, TRUST_PROXY: '10.0.0.0/8, 192.168.1.7 ,::1' }).trustProxy).toBe('10.0.0.0/8,192.168.1.7,::1')
      expect(loadConfig({ ...VALID, TRUST_PROXY: 'loopback,172.16.0.0/12' }).trustProxy).toBe('loopback,172.16.0.0/12')
      expect(loadConfig({ ...VALID, TRUST_PROXY: 'fc00::/7' }).trustProxy).toBe('fc00::/7')
    })

    it('names the entries it did not understand', () => {
      expect(() => loadConfig({ ...VALID, TRUST_PROXY: 'uniquelocal,not-an-ip' })).toThrow(/not-an-ip/)
      expect(() => loadConfig({ ...VALID, TRUST_PROXY: '10.0.0.0/33' })).toThrow(/TRUST_PROXY has unrecognised/)
      expect(() => loadConfig({ ...VALID, TRUST_PROXY: 'localhost' })).toThrow(/TRUST_PROXY has unrecognised/)
      // A hop count is not the fix either — Fastify ≥ 5.12 makes a number fail closed.
      expect(() => loadConfig({ ...VALID, TRUST_PROXY: '2' })).toThrow(/TRUST_PROXY has unrecognised/)
    })
  })

  it('requires absolute origins — no paths, no trailing slash, no wildcards', () => {
    for (const bad of ['poker.example.com', 'https://poker.example.com/', 'https://poker.example.com/app', '*', 'ws://poker.example.com']) {
      expect(() => loadConfig({ ...VALID, ALLOWED_ORIGINS: bad }), bad).toThrow(/ALLOWED_ORIGINS entry/)
    }
    expect(loadConfig({ ...VALID, ALLOWED_ORIGINS: 'http://localhost:5173' }).allowedOrigins).toEqual(['http://localhost:5173'])
  })

  it('rejects out-of-range numbers and non-boolean flags', () => {
    expect(() => loadConfig({ ...VALID, PORT: '70000' })).toThrow(/PORT must be an integer/)
    expect(() => loadConfig({ ...VALID, RECONNECT_WINDOW_SEC: '-1' })).toThrow(/RECONNECT_WINDOW_SEC/)
    expect(() => loadConfig({ ...VALID, RECONNECT_WINDOW_SEC: '99999' })).toThrow(/RECONNECT_WINDOW_SEC/)
    expect(() => loadConfig({ ...VALID, COOKIE_SECURE: 'maybe' })).toThrow(/COOKIE_SECURE must be a boolean/)
    expect(() => loadConfig({ ...VALID, ECONOMY_TIMEZONE: 'Mars/Olympus' })).toThrow(/ECONOMY_TIMEZONE/)
  })
})
