/**
 * Guards the shape of the release artefacts, which nothing else can check: that the server bundle
 * carries none of the Normal edition's heavy dependencies, that the web bundle stays inside the
 * download budget, and that the exe stays inside its size cap.
 *
 * Every block skips when the artefact it inspects is missing, so `pnpm test` on a fresh checkout —
 * where nothing has been built — stays green and says why it had nothing to measure.
 */
import { existsSync, readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { ASSET_MANIFEST, EXE, PUBLIC_DIR, SERVER_BUNDLE, sizeOf, walk } from './paths.js'

/** Packages the Lite bundle must never pull in: Normal's ORM, hashing, Postgres driver and router. */
const FORBIDDEN = ['drizzle', 'argon2', 'postgres', 'pg-protocol', 'better-sqlite3', 'react-router']

/**
 * Package requires that legitimately survive bundling, all of them unreachable at run time:
 * `bufferutil` and `utf-8-validate` are ws's optional native accelerators, loaded in a try/catch
 * that falls back to its JavaScript implementation; the `ajv` and `fast-json-stringify` paths are
 * emitted by those libraries' standalone code generators, which Fastify does not use.
 */
const INERT_REQUIRE = /^(bufferutil|utf-8-validate|ajv\/dist\/runtime\/|ajv-formats\/dist\/formats|fast-json-stringify\/lib\/)/

const MAX_JS_GZIP = 250 * 1024
const MAX_CSS_GZIP = 40 * 1024
const MAX_EXE = 120 * 1024 * 1024

const hasBundle = existsSync(SERVER_BUNDLE)
const hasPublic = existsSync(PUBLIC_DIR)
const hasExe = existsSync(EXE)

const BUILD_HINT = 'run `pnpm --filter @bp/lite build` first'
if (!hasBundle) console.warn(`[footprint] skipping server-bundle checks: ${SERVER_BUNDLE} is missing — ${BUILD_HINT}`)
if (!hasPublic) console.warn(`[footprint] skipping web-bundle checks: ${PUBLIC_DIR} is missing — ${BUILD_HINT}`)
if (!hasExe) console.warn(`[footprint] skipping executable checks: ${EXE} is missing — ${BUILD_HINT}`)

/** Total gzipped bytes of every file under `dist/public` whose name ends in `ext`. */
function gzipTotal(ext: string): number {
  return walk(PUBLIC_DIR)
    .filter((rel) => rel.endsWith(ext))
    .reduce((sum, rel) => sum + gzipSync(readFileSync(join(PUBLIC_DIR, rel)), { level: 9 }).length, 0)
}

describe.skipIf(!hasBundle)('server bundle', () => {
  it('carries none of the Normal edition dependencies', () => {
    const source = readFileSync(SERVER_BUNDLE, 'utf8')
    expect(FORBIDDEN.filter((name) => source.includes(name))).toEqual([])
  })

  it('requires nothing but built-ins and the known-inert optional paths', () => {
    const source = readFileSync(SERVER_BUNDLE, 'utf8')
    // Inside the exe there is no `node_modules` to resolve against, so a surviving package require
    // is a crash waiting for the code path that reaches it. The exceptions below are reachable only
    // from branches this server never takes; anything new here needs the same kind of proof.
    const required = [...source.matchAll(/require\(["']([^"'.][^"']*)["']\)/g)].map((m) => m[1] ?? '')
    expect([...new Set(required)].filter((id) => !isBuiltin(id) && !INERT_REQUIRE.test(id)).sort()).toEqual([])
    console.log(`[footprint] dist/server.cjs ${(sizeOf(SERVER_BUNDLE) / 1024).toFixed(1)} KB`)
  })
})

describe.skipIf(!hasPublic)('web bundle', () => {
  it('fits the JavaScript download budget', () => {
    const total = gzipTotal('.js')
    console.log(`[footprint] dist/public JS ${(total / 1024).toFixed(1)} KB gzip (budget ${MAX_JS_GZIP / 1024} KB)`)
    expect(total).toBeLessThanOrEqual(MAX_JS_GZIP)
  })

  it('fits the CSS download budget', () => {
    const total = gzipTotal('.css')
    console.log(`[footprint] dist/public CSS ${(total / 1024).toFixed(1)} KB gzip (budget ${MAX_CSS_GZIP / 1024} KB)`)
    expect(total).toBeLessThanOrEqual(MAX_CSS_GZIP)
  })

  it('emits an entry document', () => {
    expect(walk(PUBLIC_DIR)).toContain('index.html')
  })
})

describe.skipIf(!hasExe)('executable', () => {
  it('is accompanied by an asset manifest listing the entry document', () => {
    // The exe serves its UI out of the SEA blob, and `assets.json` is the only list of what is in
    // there — without it every request would 404 even though the files are embedded.
    expect(existsSync(ASSET_MANIFEST)).toBe(true)
    expect(JSON.parse(readFileSync(ASSET_MANIFEST, 'utf8')) as string[]).toContain('index.html')
  })

  it('fits the size cap', () => {
    const size = sizeOf(EXE)
    console.log(`[footprint] bind-poker-lite.exe ${(size / 1024 / 1024).toFixed(1)} MB (cap ${MAX_EXE / 1024 / 1024} MB)`)
    expect(size).toBeLessThanOrEqual(MAX_EXE)
  })

  it('ships the release paperwork beside it', () => {
    for (const name of ['README-lite.md', '.env.example']) {
      expect(existsSync(join(dirname(EXE), name))).toBe(true)
    }
  })
})
