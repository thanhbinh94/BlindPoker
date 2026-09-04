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
      TRUST_PROXY: '1',
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
      trustProxy: true,
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
