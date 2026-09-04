import { dirname } from 'node:path'

export interface LiteConfig { port: number; host: string; sqlitePath: string; handLog: boolean; logLevel: 'debug' | 'info' | 'warn' | 'error'; timezone: string; allowedOrigins: string[] | 'same-host'; publicDir: string | null }

export const DEFAULT_CONFIG: LiteConfig = { port: 8080, host: '0.0.0.0', sqlitePath: './bind-poker.sqlite', handLog: false, logLevel: 'info', timezone: 'Asia/Ho_Chi_Minh', allowedOrigins: 'same-host', publicDir: null }

export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    const quote = value[0]
    if (quote === '"' || quote === "'") {
      const close = value.indexOf(quote, 1)
      value = close > 0 ? value.slice(1, close) : value.slice(1)
    } else {
      const hash = value.indexOf(' #')
      if (hash >= 0) value = value.slice(0, hash).trim()
    }
    out[key] = value
  }
  return out
}

const LEVELS = new Set(['debug', 'info', 'warn', 'error'])
function validTimezone(tz: string): boolean { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false } }

export function loadConfig(env: Record<string, string | undefined>, dotenvText?: string): LiteConfig {
  const file = dotenvText ? parseDotenv(dotenvText) : {}
  const get = (k: string) => env[k] ?? file[k]
  const port = get('PORT') === undefined ? DEFAULT_CONFIG.port : Number(get('PORT'))
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`PORT must be an integer 0–65535, got ${get('PORT')}`)
  const logLevel = (get('LOG_LEVEL') ?? DEFAULT_CONFIG.logLevel) as LiteConfig['logLevel']
  if (!LEVELS.has(logLevel)) throw new Error(`LOG_LEVEL must be one of ${[...LEVELS].join(', ')}`)
  const timezone = get('ECONOMY_TIMEZONE') ?? DEFAULT_CONFIG.timezone
  if (!validTimezone(timezone)) throw new Error(`ECONOMY_TIMEZONE is not a valid IANA zone: ${timezone}`)
  // Unset (or blank) is not "allow anything": Lite serves its own UI, so the page that opens a
  // socket must have come from this host. A list is only needed when a reverse proxy has changed
  // the public origin out from under the `Host` header.
  const origins = (get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return {
    port,
    host: get('HOST') ?? DEFAULT_CONFIG.host,
    sqlitePath: get('SQLITE_PATH') ?? DEFAULT_CONFIG.sqlitePath,
    handLog: ['1', 'true', 'yes'].includes((get('LITE_HAND_LOG') ?? '').toLowerCase()),
    logLevel,
    timezone,
    allowedOrigins: origins.length > 0 ? origins : DEFAULT_CONFIG.allowedOrigins,
    publicDir: get('PUBLIC_DIR') ?? null,
  }
}

export function resolveBaseDir(): string {
  const sea = process.getBuiltinModule('node:sea')
  return sea?.isSea() ? dirname(process.execPath) : process.cwd()
}
