/**
 * Normal-edition configuration.
 *
 * Unlike Lite — a double-clicked executable that must run with no configuration at all — the Normal
 * server is deployed behind a proxy against a database an operator provisioned. Three things
 * therefore have no defensible default and are required: the database URL, the session secret, and
 * the origins allowed to talk to this server. A wrong guess at any of them is either a server that
 * cannot start or, worse, one that starts insecure.
 *
 * `loadConfig` reports *every* problem at once. An operator filling in a fresh `.env` should learn
 * about all of the missing variables in one run, not one per restart.
 */

export interface NormalConfig {
  port: number
  host: string
  databaseUrl: string
  sessionSecret: string
  allowedOrigins: string[]
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  timezone: string
  reconnectWindowSec: number
  publicDir: string | null
  cookieSecure: boolean
  trustProxy: boolean
}

/** The optional half of the configuration: what you get when you set nothing but the required vars. */
export const CONFIG_DEFAULTS = {
  port: 8080,
  host: '0.0.0.0',
  logLevel: 'info',
  timezone: 'Asia/Ho_Chi_Minh',
  reconnectWindowSec: 90,
  publicDir: null,
  cookieSecure: true,
  trustProxy: false,
} satisfies Omit<NormalConfig, 'databaseUrl' | 'sessionSecret' | 'allowedOrigins'>

/** A session secret shorter than this is not a secret, it is a formality. */
export const MIN_SESSION_SECRET_LENGTH = 32

const LEVELS = new Set(['debug', 'info', 'warn', 'error'])
const TRUE = new Set(['1', 'true', 'yes', 'on'])
const FALSE = new Set(['0', 'false', 'no', 'off'])

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** `http(s)://host[:port]` and nothing else — no path, no trailing slash, no wildcard. */
function isAbsoluteOrigin(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value
}

export function loadConfig(env: Record<string, string | undefined>): NormalConfig {
  const problems: string[] = []
  const trimmed = (key: string): string | undefined => {
    const raw = env[key]
    if (raw === undefined) return undefined
    const value = raw.trim()
    return value === '' ? undefined : value
  }

  const required = (key: string, hint: string): string => {
    const value = trimmed(key)
    if (value === undefined) problems.push(`${key} is required (${hint})`)
    return value ?? ''
  }

  const integer = (key: string, fallback: number, min: number, max: number): number => {
    const raw = trimmed(key)
    if (raw === undefined) return fallback
    const value = Number(raw)
    if (!Number.isInteger(value) || value < min || value > max) {
      problems.push(`${key} must be an integer ${min}–${max}, got ${raw}`)
      return fallback
    }
    return value
  }

  const flag = (key: string, fallback: boolean): boolean => {
    const raw = trimmed(key)?.toLowerCase()
    if (raw === undefined) return fallback
    if (TRUE.has(raw)) return true
    if (FALSE.has(raw)) return false
    problems.push(`${key} must be a boolean (true/false, 1/0, yes/no), got ${raw}`)
    return fallback
  }

  const databaseUrl = required('DATABASE_URL', 'postgres://user:password@host:5432/database')
  if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl)) {
    problems.push(`DATABASE_URL must be a postgres:// or postgresql:// URL, got ${databaseUrl}`)
  }

  const sessionSecret = required('SESSION_SECRET', `at least ${MIN_SESSION_SECRET_LENGTH} random characters`)
  if (sessionSecret && sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    problems.push(`SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters, got ${sessionSecret.length}`)
  }

  // No "same-host" fallback here, unlike Lite: the Normal web client is served from its own origin
  // and reaches this server across it, so the operator has to name that origin.
  const originsRaw = trimmed('ALLOWED_ORIGINS')
  const allowedOrigins = (originsRaw ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (allowedOrigins.length === 0) {
    problems.push('ALLOWED_ORIGINS is required (comma-separated list of origins, e.g. https://poker.example.com)')
  }
  for (const origin of allowedOrigins) {
    if (!isAbsoluteOrigin(origin)) problems.push(`ALLOWED_ORIGINS entry must be an absolute origin like https://poker.example.com, got ${origin}`)
  }

  const logLevel = (trimmed('LOG_LEVEL') ?? CONFIG_DEFAULTS.logLevel) as NormalConfig['logLevel']
  if (!LEVELS.has(logLevel)) problems.push(`LOG_LEVEL must be one of ${[...LEVELS].join(', ')}, got ${logLevel}`)

  const timezone = trimmed('ECONOMY_TIMEZONE') ?? CONFIG_DEFAULTS.timezone
  if (!validTimezone(timezone)) problems.push(`ECONOMY_TIMEZONE is not a valid IANA zone: ${timezone}`)

  const port = integer('PORT', CONFIG_DEFAULTS.port, 0, 65535)
  // Spec §22.5: how long a disconnected seated player is held before the table folds for them.
  const reconnectWindowSec = integer('RECONNECT_WINDOW_SEC', CONFIG_DEFAULTS.reconnectWindowSec, 0, 3600)
  const cookieSecure = flag('COOKIE_SECURE', CONFIG_DEFAULTS.cookieSecure)
  const trustProxy = flag('TRUST_PROXY', CONFIG_DEFAULTS.trustProxy)

  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  }

  return {
    port,
    host: trimmed('HOST') ?? CONFIG_DEFAULTS.host,
    databaseUrl,
    sessionSecret,
    allowedOrigins,
    logLevel,
    timezone,
    reconnectWindowSec,
    publicDir: trimmed('PUBLIC_DIR') ?? CONFIG_DEFAULTS.publicDir,
    cookieSecure,
    trustProxy,
  }
}
