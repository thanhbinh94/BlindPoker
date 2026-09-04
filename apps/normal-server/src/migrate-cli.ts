/**
 * `pnpm migrate`: apply the committed migrations and exit.
 *
 * The same `runMigrations` the server calls at boot, with nothing else around it — no listener, no
 * game server, no catalogue seed. It is what a Compose init container (Task 7) runs before the
 * server starts, and what an operator running several replicas uses instead of `AUTO_MIGRATE`.
 *
 * It reads the full configuration rather than just `DATABASE_URL` on purpose: a migration job that
 * succeeds against a database the server will then refuse to start against is worse than one that
 * fails immediately with the same list of problems.
 */
import { createJsonLogger, readDotenv } from '@bp/http-kit'
import { loadConfig } from './config.js'
import { createPgDb } from './db/client.js'
import { runMigrations } from './db/migrate.js'

async function main(): Promise<void> {
  const config = loadConfig({ ...readDotenv('.env'), ...process.env })
  const log = createJsonLogger(config.logLevel)
  const handle = createPgDb(config.databaseUrl, { max: 1, onError: (err) => log.error('database pool error', { err: String(err) }) })
  try {
    log.info('applying migrations')
    await runMigrations(handle.db, 'pg')
    log.info('migrations applied')
  } finally {
    // Always: a failed migration that leaves a pooled connection open would hang the exit and the
    // init container with it.
    await handle.close()
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  },
)
