import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, loadConfig, parseDotenv } from './config.js'

describe('parseDotenv', () => {
  it('parses keys, quotes, comments and blanks', () => {
    expect(parseDotenv('# c\nPORT=9000\nHOST="127.0.0.1"\nSQLITE_PATH=\'./x.sqlite\'\n\nLOG_LEVEL=debug # trailing\n')).toEqual({ PORT: '9000', HOST: '127.0.0.1', SQLITE_PATH: './x.sqlite', LOG_LEVEL: 'debug' })
  })
  it('strips a trailing comment after a quoted value, and only comment-strips unquoted values', () => {
    expect(parseDotenv('HOST="127.0.0.1" # note')).toEqual({ HOST: '127.0.0.1' })
    expect(parseDotenv("A='x=y' # c")).toEqual({ A: 'x=y' })
    expect(parseDotenv('B=plain#nohash')).toEqual({ B: 'plain#nohash' })
    expect(parseDotenv('C="has # inside"')).toEqual({ C: 'has # inside' })
  })
})

describe('loadConfig', () => {
  it('uses defaults', () => {
    expect(loadConfig({})).toEqual(DEFAULT_CONFIG)
  })
  it('lets process env override the .env file', () => {
    const c = loadConfig({ PORT: '8081', ALLOWED_ORIGINS: 'http://a, http://b' }, 'PORT=9000\nLITE_HAND_LOG=1\nECONOMY_TIMEZONE=UTC')
    expect(c.port).toBe(8081)
    expect(c.handLog).toBe(true)
    expect(c.timezone).toBe('UTC')
    expect(c.allowedOrigins).toEqual(['http://a', 'http://b'])
  })
  it("defaults ALLOWED_ORIGINS to the same-host policy, and treats a blank value as unset", () => {
    expect(loadConfig({}).allowedOrigins).toBe('same-host')
    expect(loadConfig({ ALLOWED_ORIGINS: '' }).allowedOrigins).toBe('same-host')
    expect(loadConfig({ ALLOWED_ORIGINS: ' , ' }).allowedOrigins).toBe('same-host')
  })
  it('reads RECONNECT_WINDOW_SEC, defaulting to the 90 s of spec §22.5', () => {
    expect(loadConfig({}).reconnectWindowSec).toBe(90)
    expect(loadConfig({ RECONNECT_WINDOW_SEC: '30' }).reconnectWindowSec).toBe(30)
    expect(loadConfig({ RECONNECT_WINDOW_SEC: '0' }).reconnectWindowSec).toBe(0)
  })
  it('rejects invalid values', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/)
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/)
    expect(() => loadConfig({ ECONOMY_TIMEZONE: 'Mars/Olympus' })).toThrow(/ECONOMY_TIMEZONE/)
    expect(() => loadConfig({ RECONNECT_WINDOW_SEC: 'soon' })).toThrow(/RECONNECT_WINDOW_SEC/)
    expect(() => loadConfig({ RECONNECT_WINDOW_SEC: '-1' })).toThrow(/RECONNECT_WINDOW_SEC/)
    expect(() => loadConfig({ RECONNECT_WINDOW_SEC: '99999' })).toThrow(/RECONNECT_WINDOW_SEC/)
  })
})
