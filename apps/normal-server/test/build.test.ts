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

/** Long enough for a cold `tsc` on a loaded machine; a build that needs more than this is broken. */
const BUILD_TIMEOUT_MS = 240_000
/** A misconfigured process must be dead well inside this — it is a container restart loop otherwise. */
const BOOT_TIMEOUT_MS = 30_000

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

  it('produces both entry points', async () => {
    for (const name of ['main.js', 'migrate-cli.js']) {
      const info = await stat(join(DIST, name))
      expect(info.isFile(), `dist/${name}`).toBe(true)
      expect(info.size).toBeGreaterThan(1024)
    }
  })

  it('inlines the workspace packages instead of importing them', async () => {
    for (const name of ['main.js', 'migrate-cli.js']) {
      const source = await readFile(join(DIST, name), 'utf8')
      // Module specifiers only. esbuild labels each bundled module with a `// ../../packages/…`
      // comment, which is a record of what went *in* — not a path anything resolves at run time.
      const specifiers = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*)["']([^"'\n]+)["']/g)].map((m) => m[1] ?? '')
      expect(specifiers.filter((s) => s.startsWith('@bp/')), `${name} @bp imports`).toEqual([])
      expect(specifiers.filter((s) => s.includes('../../packages/')), `${name} packages/ imports`).toEqual([])
      // The externals are the deployment contract: they must come from `node_modules` at /app.
      expect(specifiers).toContain('pg')
    }
  })

  it('ships the migrations and the catalogues beside dist/', async () => {
    for (const rel of ['drizzle/0000_init.sql', 'drizzle/meta/_journal.json', 'data/items.json', 'data/achievements.json', 'package.json']) {
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
    // It got past configuration — the boot log is on stdout — and died on the database. The message
    // itself is the driver's: `pg` raises an `AggregateError` whose own `message` is empty, so what
    // reaches stderr today is drizzle's failing statement. Either shape satisfies this.
    expect(ran.stderr).toMatch(/connect|ECONNREFUSED|failed query|database|password|role/i)
    expect(Date.now() - started).toBeLessThan(BOOT_TIMEOUT_MS)
  })

  it('runs the migrate CLI as its own process and fails the same way', async () => {
    const ran = await run('migrate-cli.js', { DATABASE_URL: DEAD_DATABASE_URL, SESSION_SECRET: SECRET, ALLOWED_ORIGINS: 'http://localhost' })
    expect(ran.code).not.toBe(0)
    expect(ran.stdout).toContain('applying migrations')
  })
})
