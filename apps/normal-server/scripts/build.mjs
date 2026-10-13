#!/usr/bin/env node
/**
 * The Normal server's build: `node scripts/build.mjs [--no-typecheck]`.
 *
 *   typecheck  `tsc -p tsconfig.build.json` over exactly the files that ship (no tests, no PGlite).
 *   bundle     esbuild → `dist/main.js`, `dist/migrate-cli.js` and `dist/grant-wardrobe-cli.js`, three
 *              self-contained ESM entries.
 *   verify     the sidecars `packageRoot()` resolves at run time are where the image expects them.
 *
 * **Why a bundler and not `tsc --outDir dist`.** The workspace packages publish their *sources*
 * (`"exports": "./src/index.ts"`), so a `tsc` emit leaves `import … from '@bp/core'` in `dist/`, and
 * `node dist/main.js` outside this repository — inside the image, where `packages/` does not exist —
 * cannot resolve it. esbuild inlines those three packages and leaves everything else alone.
 *
 * **What stays external.** Every third-party runtime dependency: `argon2` is a native addon, `pg`
 * probes for the optional `pg-native`, and `fastify`/`drizzle-orm` are large, well-behaved packages
 * with no reason to be flattened. They come from the `node_modules` the runtime image installs, so
 * each one must also be a *direct* dependency of this package — a transitive-only external would
 * resolve under pnpm's `.pnpm` store and not from `/app`. `ws` is in `package.json` for exactly that
 * reason: nothing here imports it, but `@bp/server-kit`'s gateway, which this bundle contains, does.
 *
 * **What is not in `dist/`.** `drizzle/` (the committed migrations) and `data/` (the item and
 * achievement catalogues) are read from disk at run time, found by walking up from `import.meta.url`
 * to the directory whose `package.json` is `@bp/normal-server` (`src/db/migrate.ts`). Bundled to
 * `dist/main.js` that walk lands on this package root, where both already sit — so there is nothing
 * to copy here, and the build's job is to *check* they are there and to state the layout the
 * Dockerfile has to reproduce: `package.json`, `dist/`, `drizzle/` and `data/` as siblings.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = resolve(ROOT, 'dist')

/** The entry points, and the file each becomes. `outdir` derives the names from `src/`. */
const ENTRIES = ['src/main.ts', 'src/migrate-cli.ts', 'src/grant-wardrobe-cli.ts']
const OUTPUTS = ['dist/main.js', 'dist/migrate-cli.js', 'dist/grant-wardrobe-cli.js']

/**
 * Third-party packages left as run-time imports. Every one of them is a direct dependency of
 * `@bp/normal-server` (see the header); `pg-native` is the optional peer `pg` probes for and is
 * deliberately *not* installed — external keeps the probe a run-time failure `pg` already handles.
 */
const EXTERNAL = ['pg', 'pg-native', 'argon2', '@fastify/cookie', 'fastify', 'ws', 'drizzle-orm']

/**
 * The only external the runtime image is allowed *not* to have. `pg` reaches for `pg-native` inside
 * a `try`; leaving it external and uninstalled is how you say "use the JavaScript driver".
 * `@electric-sql/pglite` is deliberately absent from `EXTERNAL`: it is a devDependency for the tests,
 * so an import of it reaching shipped code must fail the build rather than the container.
 */
const OPTIONAL_EXTERNAL = new Set(['pg-native'])

/**
 * `require` for any CJS dependency that reaches for it from inside the ESM output. Nothing in the
 * bundle needs it today; it costs one line and turns a future `require is not defined` at boot into
 * a non-event.
 */
const BANNER = "import { createRequire as __bpCreateRequire } from 'node:module'; const require = __bpCreateRequire(import.meta.url);"

/** Read at run time from `<package root>/…`. Missing any of these is a broken deployment, not a warning. */
const SIDECARS = ['drizzle/meta/_journal.json', 'data/items.json', 'data/achievements.json', 'data/avatar-bodies.json', 'data/daily-gifts.json']

/**
 * Module specifiers in the output, split by *when* the module they name is loaded.
 *
 * `EAGER` is `from '…'`, a bare `import '…'` and `require('…')` from the banner's interop — all
 * resolved and evaluated the moment the entry point loads. `DEFERRED` is `import('…')`, resolved
 * only if that line ever runs. The distinction is the whole point of the PGlite rule below: a
 * migrator behind a branch production never takes is harmless, while the same migrator at module
 * scope is a container that dies on boot.
 *
 * Comments are not matched on purpose — esbuild labels each bundled module with a
 * `// ../../packages/core/src/…` header, and those are exactly what a naive substring search would
 * trip over. (`\bimport\s*["']` cannot match `import("x")`: the quote has to come next, and there a
 * paren does — which is why the deferred form needs a pattern of its own.)
 */
const EAGER_SPECIFIERS = /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*)["']([^"'\n]+)["']/g
const DEFERRED_SPECIFIERS = /\bimport\s*\(\s*["']([^"'\n]+)["']/g

/**
 * Anything that pulls PGlite in.
 *
 * `@electric-sql/pglite` is a devDependency and is genuinely absent from the deployed
 * `node_modules`. `drizzle-orm/pglite/*` is a subpath of a *declared* dependency, which is exactly
 * why the "must be a dependencies entry" rule below cannot see it: the specifier reduces to
 * `drizzle-orm` and passes, while the subpath's own needs are nobody's declared business.
 *
 * Eagerly importing either is the failure this guard exists to prevent, and no unit test can catch
 * it — they run inside this repository, where PGlite *is* installed. `runMigrations` therefore
 * loads each of its two migrators with `import()` inside the branch that uses it.
 */
const PGLITE_PREFIXES = ['@electric-sql/pglite', 'drizzle-orm/pglite']

/** True when `specifier` names PGlite itself or one of drizzle's adapters for it. */
function isPglite(specifier) {
  return PGLITE_PREFIXES.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`))
}

/** The npm package a specifier belongs to: `drizzle-orm/pg-core` → `drizzle-orm`, scope included. */
function packageNameOf(specifier) {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/**
 * Why a specifier left in the output would break the deployment, or `null` if it is fine.
 *
 * The third clause is the one that earns its keep: an external the manifest does not *declare* is
 * absent from `pnpm install --prod`, so it turns a green build into a container that dies on its
 * first import. A devDependency drifting into shipped code fails here instead.
 */
function forbiddenReason(specifier, dependencies, eager) {
  if (specifier.startsWith('@bp/')) return 'an unresolved workspace import'
  if (specifier.includes('../../packages/')) return 'a relative path into packages/'
  if (eager && isPglite(specifier)) {
    return 'PGlite at module scope: it is a devDependency and is absent from the production install, so the process would die on its first import — load it with `import()` inside the branch that needs it'
  }
  if (specifier.startsWith('node:') || specifier.startsWith('.') || specifier.startsWith('/')) return null
  const name = packageNameOf(specifier)
  if (OPTIONAL_EXTERNAL.has(name) || dependencies.has(name)) return null
  return `a package that is not a "dependencies" entry of @bp/normal-server, so \`pnpm install --prod\` would not install it`
}

const log = (message) => console.log(`[build] ${message}`)
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`

function die(message) {
  console.error(`[build] ${message}`)
  process.exit(1)
}

/** Absolute path to a dependency's CLI entry point, read off its `bin` field. */
function cli(pkg, name = pkg) {
  const manifest = require.resolve(`${pkg}/package.json`)
  const bin = JSON.parse(readFileSync(manifest, 'utf8')).bin
  const rel = typeof bin === 'string' ? bin : bin?.[name]
  if (!rel) die(`${pkg} declares no "${name}" binary`)
  return resolve(dirname(manifest), rel)
}

/**
 * Runs a Node script as a child process with our stdio, the way Lite's build does — the
 * `node_modules/.bin` shims are `.cmd` files on Windows and `execFileSync` cannot start those.
 */
function node(args) {
  execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' })
}

// ---------------------------------------------------------------------------- typecheck

function typecheck() {
  log('typecheck: tsc -p tsconfig.build.json')
  node([cli('typescript', 'tsc'), '-p', 'tsconfig.build.json'])
}

// ---------------------------------------------------------------------------- bundle

function bundle() {
  rmSync(DIST, { recursive: true, force: true })
  mkdirSync(DIST, { recursive: true })
  log(`bundle: esbuild ${ENTRIES.join(' + ')} → dist/ (external: ${EXTERNAL.join(', ')})`)
  node([
    cli('esbuild'),
    ...ENTRIES,
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--target=node22',
    '--outdir=dist',
    ...EXTERNAL.map((name) => `--external:${name}`),
    `--banner:js=${BANNER}`,
    '--define:process.env.NODE_ENV="production"',
    '--legal-comments=none',
    // No `--minify`: a stack trace out of a production container is worth more than the kilobytes,
    // and nothing about this bundle is downloaded over a network.
  ])

  const dependencies = new Set(Object.keys(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).dependencies ?? {}))
  for (const rel of OUTPUTS) {
    const file = join(ROOT, rel)
    if (!existsSync(file)) die(`${rel} was not produced`)
    const source = readFileSync(file, 'utf8')
    const runtime = new Set()
    const deferred = new Set()
    for (const [eager, pattern] of [[true, EAGER_SPECIFIERS], [false, DEFERRED_SPECIFIERS]]) {
      for (const [, specifier] of source.matchAll(pattern)) {
        const reason = forbiddenReason(specifier, dependencies, eager)
        if (reason) die(`${rel} ${eager ? 'imports' : 'dynamically imports'} "${specifier}" — ${reason}`)
        if (specifier.startsWith('node:')) continue
        if (eager) runtime.add(packageNameOf(specifier))
        else deferred.add(specifier)
      }
    }
    const lazily = deferred.size === 0 ? '' : `, lazily ${[...deferred].sort().join(', ')}`
    log(`bundle: ${rel} ${kb(statSync(file).size)} (needs ${[...runtime].sort().join(', ') || 'nothing but node built-ins'}${lazily})`)
  }
}

// ---------------------------------------------------------------------------- sidecars

function verifySidecars() {
  for (const rel of SIDECARS) {
    if (!existsSync(join(ROOT, rel))) die(`${rel} is missing — the run time resolves it from the package root and would fail at boot`)
  }
  const migrations = readdirSync(join(ROOT, 'drizzle')).filter((name) => name.endsWith('.sql'))
  if (migrations.length === 0) die('drizzle/ holds no .sql migration — run `pnpm db:generate`')
  log(`sidecars: drizzle/ (${migrations.length} migration${migrations.length === 1 ? '' : 's'}), data/items.json, data/achievements.json, data/avatar-bodies.json, data/daily-gifts.json`)
  log('sidecars: ship `package.json`, `dist/`, `drizzle/` and `data/` as siblings — that is what packageRoot() walks up to')
}

// ---------------------------------------------------------------------------- entry

const args = process.argv.slice(2)
const started = Date.now()
try {
  if (!args.includes('--no-typecheck')) typecheck()
  bundle()
  verifySidecars()
} catch (err) {
  // A failing child has already printed its own diagnostics through the inherited stdio; re-throwing
  // would bury them under an `execFileSync` stack that says nothing about what went wrong.
  die(`failed — ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
}
log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`)
