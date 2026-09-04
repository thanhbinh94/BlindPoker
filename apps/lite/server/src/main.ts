/**
 * Lite entry point: composition only. Everything testable lives in `buildApp` and the modules it
 * pulls together — what is left here is reading the environment, wiring the pieces, and the four
 * ways this process can end (`--smoke`, a signal, `--stop` from a second copy of itself, or a
 * startup failure).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { consoleLogger, silentLogger, type Logger } from '@bp/server-kit'
import { buildApp } from './app.js'
import { loadConfig, parseDotenv, resolveBaseDir, type LiteConfig } from './config.js'
import { openDatabase } from './db/sqlite.js'
import { assetSourceFromDir, assetSourceFromSea, type AssetSource } from './http/assets.js'
import { createSqliteRepositories } from './repos/sqlite-repos.js'
import { readRunFile, removeRunFile, resolveRunFilePath, RUN_FILE_NAME, type RunFile } from './run-file.js'

/** Upper bound on a graceful stop; past it the process exits anyway rather than hanging a restart. */
const SHUTDOWN_BUDGET_MS = 10_000
/** How long `--stop` waits for the pid to go away after the server accepted the request. */
const STOP_BUDGET_MS = 15_000
const STOP_POLL_MS = 250
const LEVELS = ['debug', 'info', 'warn', 'error'] as const
/**
 * Signals that mean "stop". `SIGBREAK` (Ctrl+Break) and `SIGHUP` (the console window being closed)
 * are the Windows half: without them the only graceful stop on Windows is Ctrl+C, and everything
 * else — `taskkill`, `sc stop`, the window's X button — is a hard kill that loses in-flight stacks.
 * `process.on` treats an unknown name as a plain event, so the Windows-only ones cost nothing on
 * POSIX; `SIGHUP` is a real signal on both.
 */
const STOP_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGBREAK', 'SIGHUP'] as const

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

  // Everything else Lite reads is resolved against the base directory; the default UI folder is no
  // exception, so `node dist/server.cjs` finds `dist/public` the same way the exe finds its own.
  const dir = config.publicDir
    ? (isAbsolute(config.publicDir) ? config.publicDir : resolve(baseDir, config.publicDir))
    : resolve(baseDir, 'dist/public')
  if (!existsSync(dir)) {
    log.warn('no web assets found — the API is up but there is no UI to serve', { dir })
    return null
  }
  return assetSourceFromDir(dir)
}

// ---------------------------------------------------------------------------- --stop / --status

/** True while the process exists. `EPERM` means it exists but belongs to somebody else. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The run file records the configured listen address; a wildcard bind is reached over the loopback. */
function baseUrl(info: RunFile): string {
  const host = info.host === '0.0.0.0' || info.host === '::' || info.host === '' ? '127.0.0.1' : info.host
  return `http://${host.includes(':') ? `[${host}]` : host}:${info.port}`
}

function reason(err: unknown): string {
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause : null
  return cause ? `${err instanceof Error ? err.message : String(err)} (${cause.message})` : err instanceof Error ? err.message : String(err)
}

/** Shared preamble: a missing run file means nothing is running (or the last stop was a hard kill). */
function locateInstance(runFilePath: string): RunFile | null {
  const info = readRunFile(runFilePath)
  if (info) return info
  console.error(`no running instance found: ${runFilePath} is missing or unreadable.`)
  console.error(`It is written when the server starts and removed when it stops cleanly — a hard kill (taskkill, sc stop, closing the window) can leave a stale one behind.`)
  return null
}

/**
 * `--stop`: the graceful stop Windows cannot deliver on its own. It POSTs the run token to the
 * loopback shutdown endpoint, then waits for the pid to disappear — the request only proves the
 * server accepted the job, and the refunds happen while it drains.
 */
async function runStop(runFilePath: string): Promise<number> {
  const info = locateInstance(runFilePath)
  if (!info) return 1

  let res: Response
  try {
    res = await fetch(`${baseUrl(info)}/api/admin/shutdown`, {
      method: 'POST',
      headers: { 'x-requested-with': 'bind-poker', authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
    })
  } catch (err) {
    if (!pidAlive(info.pid)) {
      removeRunFile(runFilePath)
      console.log(`nothing to stop: pid ${info.pid} is gone. Removed the stale ${RUN_FILE_NAME}.`)
      return 0
    }
    console.error(`could not reach the server at ${baseUrl(info)}: ${reason(err)}`)
    return 1
  }

  if (!res.ok) {
    console.error(`the server refused the stop request (HTTP ${res.status}): ${(await res.text()).trim()}`)
    return 1
  }

  const deadline = Date.now() + STOP_BUDGET_MS
  while (pidAlive(info.pid) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, STOP_POLL_MS))
  }
  if (pidAlive(info.pid)) {
    console.error(`the server accepted the stop but pid ${info.pid} was still running ${STOP_BUDGET_MS / 1000} s later.`)
    return 1
  }
  console.log(`stopped Bind Poker Lite gracefully (pid ${info.pid}, ${baseUrl(info)}).`)
  return 0
}

/** `--status`: the running instance's own `/health`, printed verbatim. */
async function runStatus(runFilePath: string): Promise<number> {
  const info = locateInstance(runFilePath)
  if (!info) return 1
  try {
    const res = await fetch(`${baseUrl(info)}/health`)
    console.log((await res.text()).trim())
    return res.ok ? 0 : 1
  } catch (err) {
    console.error(`could not reach the server at ${baseUrl(info)}: ${reason(err)}`)
    if (!pidAlive(info.pid)) console.error(`pid ${info.pid} is gone — the ${RUN_FILE_NAME} beside the data file is stale.`)
    return 1
  }
}

// ---------------------------------------------------------------------------- startup failures

/**
 * One line an operator can act on, for the failures that actually happen. A double-clicked window
 * closes the instant the process exits, so the hint is worthless without the pause below it.
 */
function startupHint(err: unknown, config: LiteConfig | null): string | null {
  const code = (err as NodeJS.ErrnoException | null)?.code ?? ''
  const message = err instanceof Error ? err.message : String(err)
  if (code === 'EADDRINUSE') {
    return `port ${config?.port ?? '?'} is already in use — stop the other instance (bind-poker-lite.exe --stop) or set PORT to a free port in .env`
  }
  if (code === 'EACCES' || code === 'EPERM') return 'permission denied — run from a folder this account may write to, or pick a port above 1024'
  if (code.startsWith('SQLITE_') || message.includes('SQLITE_CANTOPEN')) {
    return 'the data file could not be opened — the folder holding the exe must be writable, or set SQLITE_PATH to one that is'
  }
  if (/^(PORT|LOG_LEVEL|ECONOMY_TIMEZONE)\b/.test(message)) return 'fix the value in the .env file next to the executable, then start again'
  return null
}

/**
 * Holds a double-clicked console window open so the error above stays readable. Only when stdin is
 * a TTY: under Task Scheduler, a service wrapper or a pipe there is nobody to press a key.
 */
async function pauseForOperator(): Promise<void> {
  if (!process.stdin.isTTY) return
  console.error('')
  console.error('Press any key to close this window…')
  try {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    await new Promise<void>((done) => process.stdin.once('data', () => done()))
    process.stdin.setRawMode(false)
  } catch {
    // A console that refuses raw mode is still a console: better to exit than to hang.
  }
  process.stdin.pause()
}

// ---------------------------------------------------------------------------- main

async function main(): Promise<void> {
  filterSqliteWarning()
  const smoke = process.argv.includes('--smoke')
  const baseDir = resolveBaseDir()
  const envFile = resolve(baseDir, '.env')
  const envText = existsSync(envFile) ? readFileSync(envFile, 'utf8') : undefined
  const config = loadConfig(process.env, envText)

  if (process.argv.includes('--stop') || process.argv.includes('--status')) {
    const runFilePath = resolveRunFilePath(baseDir, config.sqlitePath)
    process.exitCode = process.argv.includes('--stop') ? await runStop(runFilePath) : await runStatus(runFilePath)
    return
  }

  // Smoke mode's only output is the health JSON, so nothing else may reach the console.
  const log = smoke ? silentLogger : levelLogger(config.logLevel)

  // A smoke run must not touch — or create — the database the operator actually runs on, so unless
  // `SQLITE_PATH` was configured on purpose it gets a throwaway file that is deleted on the way out.
  const sqliteConfigured = process.env.SQLITE_PATH !== undefined || (envText !== undefined && parseDotenv(envText).SQLITE_PATH !== undefined)
  const scratchDir = smoke && !sqliteConfigured ? mkdtempSync(join(tmpdir(), 'bp-lite-smoke-')) : null
  const sqlitePath = scratchDir ? join(scratchDir, 'smoke.sqlite') : config.sqlitePath

  const dbPath = sqlitePath === ':memory:' ? ':memory:' : resolve(baseDir, sqlitePath)
  const repos = createSqliteRepositories(openDatabase(dbPath), { handLog: config.handLog })
  const assets = loadAssets(baseDir, config, log)

  // Smoke mode proves the whole composition boots: an ephemeral port on the loopback, one request
  // through the real routing stack, then a clean shutdown. It is the release pipeline's gate.
  const app = buildApp({
    config: smoke ? { ...config, port: 0, host: '127.0.0.1' } : config,
    repos,
    assets,
    log,
    runFilePath: resolveRunFilePath(baseDir, sqlitePath),
  })

  if (smoke) {
    try {
      const address = await app.listen()
      const res = await fetch(`${address}/health`)
      const body = (await res.text()).trim()
      await app.close()
      if (!res.ok) throw new Error(`health check returned ${res.status}: ${body}`)
      console.log(body)
    } finally {
      if (scratchDir) rmSync(scratchDir, { recursive: true, force: true })
    }
    return
  }

  const address = await app.listen()
  log.info(`Listening on ${address}`, { db: dbPath, assets: assets ? 'yes' : 'none' })

  for (const signal of STOP_SIGNALS) {
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
  void (async () => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
    let hint: string | null = null
    try {
      hint = startupHint(err, loadConfig(process.env))
    } catch {
      hint = startupHint(err, null)
    }
    if (hint) console.error(`\n→ ${hint}`)
    await pauseForOperator()
    process.exit(1)
  })()
})
