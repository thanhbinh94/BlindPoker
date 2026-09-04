/**
 * The Normal server's entry point: composition, and the two ways this process can end.
 *
 * Everything testable lives in `buildApp`; what is left here is reading the environment, opening the
 * pool, applying the migrations, listening, and stopping cleanly when the orchestrator says so.
 *
 * **Migrations run at boot by default** (`AUTO_MIGRATE`). A single-container deployment has nowhere
 * else to put them, and running them from the process that is about to use the schema is what makes
 * "the image started" mean "the schema matches the code". An operator running several replicas — or
 * one who applies migrations from a job — sets `AUTO_MIGRATE=false` and uses `migrate-cli.ts`.
 *
 * **The startup line names no secret.** `DATABASE_URL` carries a password and `SESSION_SECRET` is
 * the session-signing key; neither belongs in a log an operator will paste into an issue.
 */
import { createJsonLogger, readDotenv } from '@bp/http-kit'
import type { Logger } from '@bp/server-kit'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { createPgDb } from './db/client.js'
import { runMigrations } from './db/migrate.js'

/** Past this a stop stops being graceful: the process exits non-zero rather than hanging a deploy. */
const SHUTDOWN_BUDGET_MS = 15_000
const STOP_SIGNALS = ['SIGTERM', 'SIGINT'] as const

const TRUE = new Set(['1', 'true', 'yes', 'on'])
const FALSE = new Set(['0', 'false', 'no', 'off'])

/**
 * `AUTO_MIGRATE`, read here rather than in `loadConfig`.
 *
 * It is not a property of the server — `buildApp` neither knows nor could use it — but a choice
 * about how *this* process starts, so it belongs beside the other startup steps. An unrecognised
 * value is refused rather than folded to the default: `AUTO_MIGRATE=maybe` silently meaning "yes" is
 * exactly the kind of surprise a schema change should never come with.
 */
export function readAutoMigrate(env: Record<string, string | undefined>): boolean {
  const raw = env['AUTO_MIGRATE']?.trim().toLowerCase()
  if (raw === undefined || raw === '') return true
  if (TRUE.has(raw)) return true
  if (FALSE.has(raw)) return false
  throw new Error(`AUTO_MIGRATE must be a boolean (true/false, 1/0, yes/no), got ${raw}`)
}

/** `.env` for a developer, the real environment for a deployment — which always wins. */
export function environment(): Record<string, string | undefined> {
  return { ...readDotenv('.env'), ...process.env }
}

async function main(): Promise<void> {
  const env = environment()
  const config = loadConfig(env)
  const autoMigrate = readAutoMigrate(env)
  const log: Logger = createJsonLogger(config.logLevel)

  const handle = createPgDb(config.databaseUrl, { onError: (err) => log.error('database pool error', { err: String(err) }) })

  if (autoMigrate) {
    log.info('applying migrations')
    await runMigrations(handle.db, 'pg')
  }

  const app = await buildApp({
    config,
    db: handle.db,
    closeDb: () => handle.close(),
    pingDb: () => handle.ping(),
    log,
  })

  const address = await app.fastify.listen({ port: config.port, host: config.host })
  log.info('bind poker normal server listening', {
    address,
    edition: 'normal',
    timezone: config.timezone,
    publicDir: config.publicDir ?? '(none)',
    allowedOrigins: config.allowedOrigins,
    autoMigrate,
    trustProxy: config.trustProxy,
  })

  let stopping = false
  const stop = (signal: string): void => {
    if (stopping) return
    stopping = true
    log.info('shutting down', { signal })
    // A hard deadline around the graceful path: a wedged room or a database that has stopped
    // answering must not keep the container alive past the orchestrator's own patience.
    //
    // Deliberately *not* `unref()`ed. If `close()` wedges on something that keeps no handle of its
    // own, an unref'd timer would let the loop empty and Node exit 0 — reporting a clean stop for a
    // shutdown that never finished. The success path clears it, so a ref'd timer costs nothing.
    const deadline = setTimeout(() => {
      log.error('graceful shutdown timed out', { budgetMs: SHUTDOWN_BUDGET_MS })
      process.exit(1)
    }, SHUTDOWN_BUDGET_MS)
    app
      .close()
      .then(() => {
        clearTimeout(deadline)
        process.exit(0)
      })
      .catch((err: unknown) => {
        log.error('graceful shutdown failed', { err: String(err) })
        process.exit(1)
      })
  }

  for (const signal of STOP_SIGNALS) process.on(signal, () => stop(signal))
}

main().catch((err: unknown) => {
  // No logger yet on the configuration path, and a configuration error is a wall of text an operator
  // has to read — so it goes to stderr as it is, not wrapped in a JSON line.
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
