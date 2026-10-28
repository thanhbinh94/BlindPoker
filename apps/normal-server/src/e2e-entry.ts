/**
 * The server the Playwright suite drives: the *real* `buildApp`, on a throwaway PGlite, serving the
 * *real* `apps/normal-web/dist` from the same origin the browser talks to.
 *
 * It is `main.ts` with three things swapped and nothing else: PGlite instead of a Postgres pool (so a
 * run needs no container and leaves nothing behind), cheap argon2 (so a suite that registers half a
 * dozen accounts is not an argon2 benchmark), and a fixed loopback origin. Everything the tests
 * actually exercise — the routes, the CSRF guard, the cookie session, the gateway, the economy, the
 * static route — is the code that ships.
 *
 * **Two rules keep this file honest.** It is excluded from the production build
 * (`tsconfig.build.json`, alongside `test-harness.ts` and `db/test-db.ts`) because it imports PGlite,
 * a devDependency; and nothing in `src/` imports it, so it can never reach `dist/main.js`. Its own
 * bundle is written by `scripts/e2e-server.mjs` to `.e2e/server.mjs`, which is gitignored and is not
 * `dist/`.
 *
 * Environment (both optional, both with defaults the Playwright config relies on):
 *
 *   `E2E_PORT`        the loopback port to listen on, and the port in `ALLOWED_ORIGINS` (8091)
 *   `E2E_PUBLIC_DIR`  the web build to serve (`../normal-web/dist`, resolved from this package root)
 *   `E2E_LOG_LEVEL`   the app's log level (`warn`: a passing run should print one line, not a log)
 *   `E2E_READ_LIMIT`  reads a minute per address (unset: the shipped 240). The ops pack sets 2400, because all of
 *                     its browsers share one loopback address (`e2e-options.ts`)
 *   `E2E_CHAOS_CARDS` a JSON file of changes laid over `data/chaos-cards.json` (unset: the shipped cards). The ops
 *                     pack's starts Cá chép hóa rồng at 100 % energy, off by default, so a GM rule can force a Thần
 *                     (BP-41 A-ops, `e2e-options.ts`)
 */
import { resolve } from 'node:path'
import { createJsonLogger } from '@bp/http-kit'
import { buildApp } from './app.js'
import { CONFIG_DEFAULTS, type NormalConfig } from './config.js'
import { packageRoot } from './db/migrate.js'
import { createTestDb } from './db/test-db.js'
import { chaosCardsFromEnv, readRateLimitFromEnv } from './e2e-options.js'
import { promoteRoute } from './e2e-promote.js'
import { CHEAP_ARGON2 } from './test-harness.js'

/** Kept in step with `apps/normal-web/e2e/playwright.config.ts`, which is the only caller. */
export const E2E_PORT = 8091

/**
 * Not a secret, and it does not need to be: this process holds a database that exists for the length
 * of one test run and is thrown away with it. It is long enough to satisfy `MIN_SESSION_SECRET_LENGTH`.
 */
const E2E_SESSION_SECRET = 'e2e-session-secret-e2e-session-secret'

const port = Number(process.env['E2E_PORT'] ?? E2E_PORT)
const publicDir = process.env['E2E_PUBLIC_DIR'] ?? resolve(packageRoot(), '..', 'normal-web', 'dist')

const config: NormalConfig = {
  ...CONFIG_DEFAULTS,
  port,
  host: '127.0.0.1',
  databaseUrl: 'postgres://unused/in-e2e',
  sessionSecret: E2E_SESSION_SECRET,
  // The browser is served from this origin and talks to this origin: same host, same port, one entry.
  allowedOrigins: [`http://127.0.0.1:${port}`],
  // Over plain HTTP a `Secure` cookie is set and then never sent back, so every request after the
  // register would be anonymous. This is the one production default the e2e server may not keep.
  cookieSecure: false,
  // Nothing sits in front of this process, so `X-Forwarded-*` can only have come from the client.
  trustProxy: false,
  timezone: 'Asia/Ho_Chi_Minh',
  logLevel: (process.env['E2E_LOG_LEVEL'] ?? 'warn') as NormalConfig['logLevel'],
  publicDir,
}

const log = createJsonLogger(config.logLevel)
const { db, close: closeDb } = await createTestDb()
const app = await buildApp({
  config,
  db,
  closeDb,
  // PGlite is in this process: if it were down, `buildApp` would not have got this far.
  pingDb: () => Promise.resolve(true),
  log,
  argon2Params: CHEAP_ARGON2,
  ...readRateLimitFromEnv(process.env),
  ...chaosCardsFromEnv(process.env),
  // Test-only (the ops pack has no CLI on the browser side): never part of dist/.
  extraRoutes: promoteRoute(db),
})

const address = await app.fastify.listen({ port: config.port, host: config.host })
// The one line a passing run prints. Playwright pipes it, so it is what an operator sees when the
// suite fails to start — hence the public directory, which is the usual reason.
console.log(`[e2e] normal server on ${address} (pglite, publicDir ${publicDir})`)

let stopping = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    // Playwright sends SIGTERM (SIGINT on a Ctrl-C) and then waits; closing the app drains the rooms
    // and closes PGlite, so a run that is interrupted mid-hand does not leave a WASM heap behind.
    app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1))
  })
}
