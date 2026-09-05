#!/usr/bin/env node
/**
 * Builds and runs the end-to-end server: `node apps/normal-server/scripts/e2e-server.mjs`.
 *
 * `apps/normal-web/e2e/playwright.config.ts` names this file as its `webServer.command`, and it is
 * usable by hand for exactly the same reason — one command that puts the real API and the real web
 * build on `http://127.0.0.1:8091` with a database that exists for as long as the process does.
 *
 * **Why a bundle and not `tsx`/`node --experimental-strip-types`.** `src/e2e-entry.ts` imports three
 * workspace packages whose `exports` point at TypeScript sources; stripping types file by file would
 * still leave `import … from '@bp/core'` for Node to resolve. esbuild inlines those the same way
 * `build.mjs` does, so this runs through the identical code path the image ships.
 *
 * **Why not `dist/`.** `build.mjs` guards `dist/main.js` against any eager import of PGlite — it is a
 * devDependency and is genuinely absent from the deployed `node_modules`. This bundle imports PGlite
 * on purpose, so it must never share a directory with the shipped artefacts, let alone be mistaken
 * for one: it goes to `.e2e/`, which is gitignored and is not `dist`.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT_DIR = resolve(ROOT, '.e2e')
const OUT = join(OUT_DIR, 'server.mjs')
const ENTRY = 'src/e2e-entry.ts'

/**
 * `build.mjs`'s externals, plus the one it deliberately refuses: PGlite is what makes this server a
 * throwaway database rather than a deployment, and it is installed here as a devDependency.
 */
const EXTERNAL = ['pg', 'pg-native', 'argon2', '@fastify/cookie', 'fastify', 'ws', 'drizzle-orm', '@electric-sql/pglite']

const BANNER = "import { createRequire as __bpCreateRequire } from 'node:module'; const require = __bpCreateRequire(import.meta.url);"

const PORT = process.env.E2E_PORT ?? '8091'
const PUBLIC_DIR = process.env.E2E_PUBLIC_DIR ?? resolve(ROOT, '..', 'normal-web', 'dist')

function die(message) {
  console.error(`[e2e] ${message}`)
  process.exit(1)
}

/** Absolute path to a dependency's CLI entry point — `node_modules/.bin` holds `.cmd` shims on Windows. */
function cli(pkg, name = pkg) {
  const manifest = require.resolve(`${pkg}/package.json`)
  const bin = JSON.parse(readFileSync(manifest, 'utf8')).bin
  const rel = typeof bin === 'string' ? bin : bin?.[name]
  if (!rel) die(`${pkg} declares no "${name}" binary`)
  return resolve(dirname(manifest), rel)
}

// The suite drives a browser against the *web build*, so a missing one is not a warning to be found
// later in twenty failed selectors. `buildApp` would happily start API-only and answer /health.
if (!existsSync(PUBLIC_DIR)) {
  die(`no web build at ${PUBLIC_DIR} — run \`pnpm build:normal\` (or \`pnpm --filter @bp/normal-web build\`) first`)
}

rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })
try {
  execFileSync(
    process.execPath,
    [
      cli('esbuild'),
      ENTRY,
      '--bundle',
      '--platform=node',
      '--format=esm',
      '--target=node22',
      `--outfile=${OUT}`,
      ...EXTERNAL.map((name) => `--external:${name}`),
      `--banner:js=${BANNER}`,
      '--legal-comments=none',
    ],
    { cwd: ROOT, stdio: 'inherit' },
  )
} catch {
  // esbuild has already printed the file, the line and the reason through the inherited stdio.
  // Re-throwing would bury all of that under an `execFileSync` stack that says nothing about it —
  // the same reason `scripts/build.mjs` ends in a `catch` that only names the step. Playwright shows
  // this as the last line of `[WebServer]` output before it gives up on the URL.
  die(`esbuild failed to bundle ${ENTRY} — see the diagnostics above`)
}

const child = spawn(process.execPath, [OUT], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, E2E_PORT: String(PORT), E2E_PUBLIC_DIR: PUBLIC_DIR },
})

// Playwright stops its `webServer` by signalling *this* process; without the relay the child would
// keep the port — and the PGlite heap — until the run's own timeout killed the tree.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code, signal) => process.exit(signal === null ? (code ?? 0) : 0))
