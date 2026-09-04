/**
 * Lite entry point: composition only. Everything testable lives in `buildApp` and the modules it
 * pulls together — what is left here is reading the environment, wiring the pieces, and the two
 * ways this process can end (`--smoke`, or a signal).
 */
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { consoleLogger, silentLogger, type Logger } from '@bp/server-kit'
import { buildApp } from './app.js'
import { loadConfig, resolveBaseDir, type LiteConfig } from './config.js'
import { openDatabase } from './db/sqlite.js'
import { assetSourceFromDir, assetSourceFromSea, type AssetSource } from './http/assets.js'
import { createSqliteRepositories } from './repos/sqlite-repos.js'

/** Upper bound on a graceful stop; past it the process exits anyway rather than hanging a restart. */
const SHUTDOWN_BUDGET_MS = 10_000
const LEVELS = ['debug', 'info', 'warn', 'error'] as const

/**
 * `node:sqlite` announces itself with an `ExperimentalWarning` on first load. It says nothing an
 * operator can act on and it would be the first line of the exe's output, so drop exactly that one
 * and re-dispatch everything else to the handlers Node installed — a swallow-all listener would
 * silence deprecations and unhandled-rejection warnings too.
 */
function filterSqliteWarning(): void {
  const defaults = process.listeners('warning') as ((warning: Error) => void)[]
  for (const handler of defaults) process.removeListener('warning', handler)
  process.on('warning', (warning) => {
    if (warning.name === 'ExperimentalWarning' && warning.message.includes('SQLite is an experimental feature')) return
    for (const handler of defaults) handler(warning)
  })
}

/** `consoleLogger` with everything below `level` dropped. */
function levelLogger(level: LiteConfig['logLevel']): Logger {
  const min = LEVELS.indexOf(level)
  const at = (n: number, fn: Logger['info']): Logger['info'] => (n >= min ? fn : silentLogger.info)
  return {
    debug: at(0, (msg, data) => console.log(JSON.stringify({ level: 'debug', time: new Date().toISOString(), msg, ...(data ?? {}) }))),
    info: at(1, consoleLogger.info),
    warn: at(2, consoleLogger.warn),
    error: at(3, consoleLogger.error),
  }
}

function loadAssets(baseDir: string, config: LiteConfig, log: Logger): AssetSource | null {
  const sea = process.getBuiltinModule('node:sea')
  if (sea?.isSea()) return assetSourceFromSea(JSON.parse(sea.getAsset('assets.json', 'utf8')) as string[])

  const dir = config.publicDir
    ? (isAbsolute(config.publicDir) ? config.publicDir : resolve(baseDir, config.publicDir))
    : resolve(process.cwd(), 'dist/public')
  if (!existsSync(dir)) {
    log.warn('no web assets found — the API is up but there is no UI to serve', { dir })
    return null
  }
  return assetSourceFromDir(dir)
}

async function main(): Promise<void> {
  filterSqliteWarning()
  const smoke = process.argv.includes('--smoke')
  const baseDir = resolveBaseDir()
  const envFile = resolve(baseDir, '.env')
  const config = loadConfig(process.env, existsSync(envFile) ? readFileSync(envFile, 'utf8') : undefined)
  // Smoke mode's only output is the health JSON, so nothing else may reach the console.
  const log = smoke ? silentLogger : levelLogger(config.logLevel)

  const dbPath = config.sqlitePath === ':memory:' ? ':memory:' : resolve(baseDir, config.sqlitePath)
  const repos = createSqliteRepositories(openDatabase(dbPath), { handLog: config.handLog })
  const assets = loadAssets(baseDir, config, log)

  // Smoke mode proves the whole composition boots: an ephemeral port on the loopback, one request
  // through the real routing stack, then a clean shutdown. It is the release pipeline's gate.
  const app = buildApp({
    config: smoke ? { ...config, port: 0, host: '127.0.0.1' } : config,
    repos,
    assets,
    log,
  })

  if (smoke) {
    const address = await app.listen()
    const res = await fetch(`${address}/health`)
    const body = (await res.text()).trim()
    await app.close()
    if (!res.ok) throw new Error(`health check returned ${res.status}: ${body}`)
    console.log(body)
    return
  }

  const address = await app.listen()
  log.info(`Listening on ${address}`, { db: dbPath, assets: assets ? 'yes' : 'none' })

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void (async () => {
        log.info('shutting down', { signal })
        await Promise.race([app.close(), new Promise((r) => setTimeout(r, SHUTDOWN_BUDGET_MS))])
        process.exit(0)
      })()
    })
  }
}

// No explicit exit on success: `--smoke` closes everything it opened, so the loop drains and the
// process exits 0 on its own with stdout fully flushed; the server mode stays alive on its listener.
main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
