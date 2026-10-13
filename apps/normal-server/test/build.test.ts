/**
 * The build is the deployable artefact, so it gets a test.
 *
 * What this guards is the one thing typechecking and the unit suites cannot see: whether
 * `dist/main.js` still runs when the repository around it is gone. The workspace packages publish
 * TypeScript sources, so a `dist/` that merely *compiled* would import `@bp/core` and die on the
 * first line inside the image — this asserts the bundle inlined them, that the two entry points
 * exist, and that both processes fail *fast and legibly* on a bad environment rather than hanging a
 * container start.
 *
 * It runs the real build (about 15 s: `tsc` then esbuild). `CI_SKIP_BUILD=1` skips the whole file
 * for a pipeline that has already built once and only wants the fast suites.
 */
import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DIST = join(ROOT, 'dist')
/** The bundles `scripts/build.mjs` emits: the server, the migrate job, and the wardrobe grant tool. */
const ENTRY_FILES = ['main.js', 'migrate-cli.js', 'grant-wardrobe-cli.js']

/** Long enough for a cold `tsc` on a loaded machine; a build that needs more than this is broken. */
const BUILD_TIMEOUT_MS = 240_000
/** The hard stop: past this the child is killed and the test fails as "did not exit". */
const BOOT_TIMEOUT_MS = 30_000
/**
 * The budget a *failing* start has to stay inside, and a real assertion rather than a restatement of
 * the timeout above. Each of these exits in one to three seconds; ten leaves room for a loaded
 * machine while still failing if a dead database ever turns into a connection retry loop, which
 * under `restart: unless-stopped` is a container that never reports the problem.
 */
const FAIL_FAST_BUDGET_MS = 10_000

const SKIP = Boolean(process.env['CI_SKIP_BUILD'])

/** Exactly 34 characters, over `MIN_SESSION_SECRET_LENGTH` — a valid secret, so the DB is what fails. */
const SECRET = 'test-session-secret-0123456789abcd'
/** Port 1 on loopback: nothing listens there and nothing ever will, so the connection fails at once. */
const DEAD_DATABASE_URL = 'postgres://postgres:pw@127.0.0.1:1/bind_poker'

interface Ran {
  code: number | null
  stdout: string
  stderr: string
}

/**
 * The module specifiers in a built entry point, split by when the module is loaded — the same two
 * patterns `scripts/build.mjs` enforces with. `eager` is `from '…'`, a bare `import '…'` and
 * `require('…')`; `deferred` is `import('…')`, which resolves only if that line runs.
 *
 * Comments are deliberately not matched: esbuild labels each bundled module with a
 * `// ../../packages/core/src/…` header, and a substring search would read those as imports.
 */
async function specifiersOf(name: string): Promise<{ eager: string[]; deferred: string[] }> {
  const source = await readFile(join(DIST, name), 'utf8')
  const all = (pattern: RegExp): string[] => [...source.matchAll(pattern)].map((m) => m[1] ?? '')
  return {
    eager: all(/(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*)["']([^"'\n]+)["']/g),
    deferred: all(/\bimport\s*\(\s*["']([^"'\n]+)["']/g),
  }
}

/** PGlite itself, or one of drizzle's adapters for it. */
function isPglite(specifier: string): boolean {
  return ['@electric-sql/pglite', 'drizzle-orm/pglite'].some((p) => specifier === p || specifier.startsWith(`${p}/`))
}

/** Runs a built entry point to completion and reports how it ended — a non-zero exit is not a throw here. */
async function run(entry: string, env: Record<string, string>): Promise<Ran> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [join(DIST, entry)], {
      cwd: ROOT,
      timeout: BOOT_TIMEOUT_MS,
      // A clean environment plus what the case supplies: an operator's stray `DATABASE_URL` (or the
      // `.env` a developer keeps in this directory) must not decide what this test observes.
      env: { PATH: process.env['PATH'] ?? '', SystemRoot: process.env['SystemRoot'] ?? '', ...env },
      maxBuffer: 8 * 1024 * 1024,
    })
    return { code: 0, stdout, stderr }
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean }
    if (e.killed) throw new Error(`${entry} did not exit within ${BOOT_TIMEOUT_MS} ms`)
    return { code: typeof e.code === 'number' ? e.code : null, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

describe.skipIf(SKIP)('the production build', () => {
  beforeAll(async () => {
    await execFileAsync(process.execPath, [join(ROOT, 'scripts', 'build.mjs')], { cwd: ROOT, timeout: BUILD_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 })
  }, BUILD_TIMEOUT_MS)

  it('produces every entry point', async () => {
    for (const name of ENTRY_FILES) {
      const info = await stat(join(DIST, name))
      expect(info.isFile(), `dist/${name}`).toBe(true)
      expect(info.size).toBeGreaterThan(1024)
    }
  })

  it('inlines the workspace packages instead of importing them', async () => {
    for (const name of ENTRY_FILES) {
      const { eager, deferred } = await specifiersOf(name)
      for (const list of [eager, deferred]) {
        expect(list.filter((s) => s.startsWith('@bp/')), `${name} @bp imports`).toEqual([])
        expect(list.filter((s) => s.includes('../../packages/')), `${name} packages/ imports`).toEqual([])
      }
      // The externals are the deployment contract: they must come from `node_modules` at /app.
      expect(eager).toContain('pg')
    }
  })

  it('never loads PGlite at module scope', async () => {
    for (const name of ENTRY_FILES) {
      const { eager } = await specifiersOf(name)
      // PGlite is a devDependency and is genuinely absent from the production install, and
      // `drizzle-orm/pglite/*` is a subpath of a declared dependency whose own needs are not
      // declared here — so an import of either at module scope is a container that dies on boot.
      // `runMigrations` loads both migrators with `import()` inside their branches, which is why
      // this can only ever be an assertion about the *eager* half.
      expect(eager.filter(isPglite), `${name} eager PGlite imports`).toEqual([])
    }
    // The pg migrator is the one production actually runs, and it must still be reachable.
    expect((await specifiersOf('main.js')).deferred).toContain('drizzle-orm/node-postgres/migrator')
  })

  it('ships the migrations and the catalogues beside dist/', async () => {
    for (const rel of ['drizzle/0000_init.sql', 'drizzle/meta/_journal.json', 'data/items.json', 'data/achievements.json', 'data/avatar-bodies.json', 'data/daily-gifts.json', 'package.json']) {
      expect((await stat(join(ROOT, rel))).isFile(), rel).toBe(true)
    }
    // `packageRoot()` walks up from `import.meta.url` to the manifest with this name; `dist/main.js`
    // must land on the one carrying `drizzle/` and `data/`.
    const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as { name: string }
    expect(manifest.name).toBe('@bp/normal-server')
  })

  it('refuses a missing SESSION_SECRET by name, with no stack trace', async () => {
    const ran = await run('main.js', { DATABASE_URL: DEAD_DATABASE_URL, ALLOWED_ORIGINS: 'http://localhost' })
    expect(ran.code).not.toBe(0)
    expect(ran.stderr).toContain('SESSION_SECRET')
    // A configuration error is a list an operator reads, not an incident: no frames, no `Error:`.
    expect(ran.stderr).not.toMatch(/\n\s+at /)
  })

  it('reports every missing variable at once', async () => {
    const ran = await run('main.js', {})
    expect(ran.code).not.toBe(0)
    for (const key of ['DATABASE_URL', 'SESSION_SECRET', 'ALLOWED_ORIGINS']) expect(ran.stderr, key).toContain(key)
    expect(ran.stderr).not.toMatch(/\n\s+at /)
  })

  it('fails fast when the database is unreachable', async () => {
    const started = Date.now()
    const ran = await run('main.js', { DATABASE_URL: DEAD_DATABASE_URL, SESSION_SECRET: SECRET, ALLOWED_ORIGINS: 'http://localhost' })
    expect(ran.code).not.toBe(0)
    /**
     * It got past configuration — the boot log is on stdout — and died on the database, and it says
     * so. `pg` raises an `AggregateError` whose own `message` is the empty string when no address of
     * the host answers, so `console.error(err.message)` used to print a blank line: the operator's
     * whole diagnosis was "it failed". `describeError` unpacks `errors[]`, and this assertion is now
     * on the text rather than on "either shape", so it cannot go on accepting the empty one.
     */
    expect(ran.stderr).toMatch(/ECONNREFUSED|connect/i)
    expect(ran.stderr.trim()).not.toBe('')
    expect(Date.now() - started).toBeLessThan(FAIL_FAST_BUDGET_MS)
  })

  it('runs the migrate CLI as its own process and fails the same way', async () => {
    const ran = await run('migrate-cli.js', { DATABASE_URL: DEAD_DATABASE_URL, SESSION_SECRET: SECRET, ALLOWED_ORIGINS: 'http://localhost' })
    expect(ran.code).not.toBe(0)
    expect(ran.stdout).toContain('applying migrations')
    // The init container's whole output on a bad `DATABASE_URL`: it has to name something.
    expect(ran.stderr).toMatch(/ECONNREFUSED|connect/i)
  })
})
