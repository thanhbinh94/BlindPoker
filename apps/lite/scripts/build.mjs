#!/usr/bin/env node
/**
 * The Lite release pipeline: `node scripts/build.mjs <web|server|exe|all> [--smoke]`.
 *
 *   web     Vite → `dist/public/**` (hashed assets, relative `base`, no source maps).
 *   server  esbuild → `dist/server.cjs`, one CommonJS file with everything but Node's built-ins in it.
 *   exe     Node SEA → `release/lite/bind-poker-lite.exe`, the bundle plus every public file
 *           embedded in a copy of the Node binary, next to the README and `.env.example`.
 *   all     web → server → exe.
 *
 * `--smoke` runs the finished exe with `--smoke`, which boots the whole server on an ephemeral port
 * and prints its `/health` JSON; a non-zero exit fails the build.
 *
 * Everything runs through `process.execPath` on the packages' JS entry points rather than the
 * `node_modules/.bin` shims, which on Windows are `.cmd` files that `execFileSync` cannot start.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isLiteAvatarFile, readDefaultOutfitLayers } from './avatar-files.mjs'

const require = createRequire(import.meta.url)

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = resolve(ROOT, 'dist')
const PUBLIC_DIR = join(DIST, 'public')
const RELEASE_DIR = resolve(ROOT, 'release/lite')
const RELEASE_SRC = resolve(ROOT, 'release-src')
const EXE = join(RELEASE_DIR, 'bind-poker-lite.exe')

/** Normal's placeholder chibi PNGs are the only art Lite ships: T1 generated `base_*` (the two bodies),
 * `bot_*` (the eight bots) and the one default outfit every human chibi wears once, under Normal's public
 * dir, and every edition draws from the same files rather than each carrying its own copy. */
const AVATAR_SRC = resolve(ROOT, '../normal-web/public/avatar')
const AVATAR_DEST = join(PUBLIC_DIR, 'avatar')
/** The catalogue the copy rule reads: which outfit is the default, and which cuts of it exist. */
const ITEMS_JSON = resolve(ROOT, '../normal-server/data/items.json')

/** The exe is a copy of `node.exe` plus our blob; 120 MB leaves headroom over that without hiding a regression. */
const MAX_EXE_BYTES = 120 * 1024 * 1024
/** postject writes the blob at the offset this fuse marks inside the Node binary. Node's own constant — do not change. */
const SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
/** Release paperwork copied verbatim next to the exe. */
const RELEASE_FILES = ['README-lite.md', '.env.example']

const log = (message) => console.log(`[build] ${message}`)
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/**
 * Absolute path to a dependency's CLI entry point, read off its `bin` field.
 *
 * `require.resolve('vite/bin/vite.js')` is not an option: modern packages export only a handful of
 * subpaths and their binaries are not among them. `package.json` is exported by all three, so the
 * manifest is the way in — and it is also the package's own statement of where its CLI lives.
 */
function cli(pkg, name = pkg) {
  const manifest = require.resolve(`${pkg}/package.json`)
  const bin = JSON.parse(readFileSync(manifest, 'utf8')).bin
  const rel = typeof bin === 'string' ? bin : bin?.[name]
  if (!rel) die(`${pkg} declares no "${name}" binary`)
  return resolve(dirname(manifest), rel)
}

/** Runs a Node script as a child process, inheriting stdio so its own output is the build's output. */
function node(args, options = {}) {
  execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', ...options })
}

/** Every file under `dir` as `/`-separated relative paths, sorted, so the manifest is reproducible. */
function walk(dir, prefix = '') {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel))
    else if (entry.isFile()) out.push(rel)
  }
  return out.sort()
}

function die(message) {
  console.error(`[build] ${message}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------- web

function buildWeb() {
  log('web: vite build')
  node([cli('vite'), 'build', '--config', 'web/vite.config.ts'])
  const files = walk(PUBLIC_DIR)
  const total = files.reduce((sum, rel) => sum + statSync(join(PUBLIC_DIR, rel)).size, 0)
  log(`web: ${files.length} files, ${kb(total)} raw → dist/public`)
  copyAvatarAssets()
}

/**
 * Copies the placeholder chibi bases, bots and default outfit into `dist/public/avatar`, after the web
 * build (which would otherwise wipe `dist/public`) and before the SEA step (which embeds whatever
 * `dist/public` holds). `isLiteAvatarFile` is the whole of what that is — every other wardrobe item is
 * Normal-only for now, Lite ships no store to buy them from.
 *
 * "The default outfit" is read out of `items.json` (`scripts/avatar-files.mjs`), cuts and all: if that
 * outfit ever gains a per-wear variant, Lite's `m` bases must get it too, and that has to follow from
 * the catalogue rather than from somebody remembering this file.
 */
function copyAvatarAssets() {
  if (!existsSync(AVATAR_SRC)) die(`avatar: source directory missing — ${AVATAR_SRC} (build apps/normal-web first)`)
  mkdirSync(AVATAR_DEST, { recursive: true })
  const layers = readDefaultOutfitLayers(ITEMS_JSON)
  const files = readdirSync(AVATAR_SRC).filter((name) => isLiteAvatarFile(name, layers))
  for (const name of files) copyFileSync(join(AVATAR_SRC, name), join(AVATAR_DEST, name))
  log(`avatar: copied ${files.length} files from normal-web (default outfit: ${layers.join(', ')})`)
}

// ---------------------------------------------------------------------------- server

function buildServer() {
  log('server: esbuild bundle')
  // `--external:node:*` keeps the `node:`-prefixed built-ins as runtime requires — nothing else may
  // stay external, because inside the exe there is no `node_modules` left to resolve against.
  node([
    cli('esbuild'),
    'server/src/main.ts',
    '--bundle',
    '--platform=node',
    '--target=node22',
    '--format=cjs',
    '--outfile=dist/server.cjs',
    '--external:node:*',
    '--define:process.env.NODE_ENV="production"',
    '--minify-syntax',
    '--legal-comments=none',
    // No `--sourcemap`: esbuild emits none by default, and a map would be dead weight inside the exe.
  ])
  log(`server: dist/server.cjs ${kb(statSync(join(DIST, 'server.cjs')).size)}`)
}

// ---------------------------------------------------------------------------- exe

/**
 * Writes `dist/assets.json` (the list the server reads back to know what is embedded) and
 * `dist/sea-config.json`, then asks Node to turn them into a SEA blob.
 *
 * Paths in the SEA config are resolved against the working directory, which is why every command
 * here runs with `cwd: ROOT` and the template's paths are written relative to it.
 */
function generateBlob(useCodeCache) {
  const publicFiles = walk(PUBLIC_DIR)
  if (!publicFiles.includes('index.html')) die('dist/public has no index.html — run the web build first')
  writeFileSync(join(DIST, 'assets.json'), `${JSON.stringify(publicFiles, null, 2)}\n`)

  const template = JSON.parse(readFileSync(resolve(ROOT, 'scripts/sea-config.template.json'), 'utf8'))
  const assets = { 'assets.json': 'dist/assets.json' }
  for (const rel of publicFiles) assets[rel] = `dist/public/${rel}`
  writeFileSync(join(DIST, 'sea-config.json'), `${JSON.stringify({ ...template, useCodeCache, assets }, null, 2)}\n`)

  log(`exe: sea blob (${publicFiles.length + 1} assets, useCodeCache=${useCodeCache})`)
  node(['--experimental-sea-config', 'dist/sea-config.json'])
}

/** Copies the Node binary, injects the blob into it, and stages the release directory around it. */
function injectAndStage() {
  mkdirSync(RELEASE_DIR, { recursive: true })
  rmSync(EXE, { force: true }) // a running copy would otherwise be overwritten in place, or lock the file
  copyFileSync(process.execPath, EXE)

  // postject reports "The signature seems corrupted!" here: our copy of node.exe carries Microsoft's
  // Authenticode signature, which appending a section invalidates. Expected, and harmless for an
  // unsigned build — the exe is meant to be signed (or not) after this step, never before it.
  log('exe: postject inject')
  node([cli('postject'), EXE, 'NODE_SEA_BLOB', join(DIST, 'sea-prep.blob'), '--sentinel-fuse', SENTINEL_FUSE])

  for (const name of RELEASE_FILES) {
    const from = join(RELEASE_SRC, name)
    if (!existsSync(from)) die(`release-src/${name} is missing`)
    copyFileSync(from, join(RELEASE_DIR, name))
  }
}

/**
 * Boots the finished exe end to end. Its stdout is the `/health` body, which we echo as the receipt.
 *
 * The database goes to a temporary file: an exe resolves `SQLITE_PATH` against its own directory, so
 * without this the gate would leave a `bind-poker.sqlite` in the directory we are about to ship.
 */
function smokeExe() {
  log('exe: smoke')
  const dbPath = join(mkdtempSync(join(tmpdir(), 'bp-lite-smoke-')), 'smoke.sqlite')
  const started = Date.now()
  try {
    const out = execFileSync(EXE, ['--smoke'], { cwd: RELEASE_DIR, encoding: 'utf8', env: { ...process.env, SQLITE_PATH: dbPath } }).trim()
    if (!out.includes('"status":"ok"')) throw new Error(`smoke returned unhealthy output: ${out}`)
    log(`exe: smoke ok in ${Date.now() - started} ms — ${out}`)
  } finally {
    rmSync(dirname(dbPath), { recursive: true, force: true })
  }
}

function buildExe({ smoke }) {
  if (process.platform !== 'win32') {
    log(`exe: skipped — the release executable is Windows x64 only (this is ${process.platform})`)
    return
  }
  // A SEA blob is only loadable by the exact Node build that produced it, and the release line is
  // Node 22; refusing early beats shipping an exe that crashes on startup.
  if (!process.version.startsWith('v22.')) die(`exe: needs Node 22 to produce a loadable SEA blob, got ${process.version}`)
  // The exe is a copy of *this* `node.exe`, so it inherits this process's architecture — and the
  // release is published as Windows x64. Building on arm64 would produce a file with the right name
  // and the wrong CPU, which nothing downstream could tell apart.
  if (process.arch !== 'x64') die(`exe: the release executable is Windows x64 only, and this Node is ${process.arch}`)
  if (!existsSync(join(DIST, 'server.cjs'))) die('dist/server.cjs is missing — run the server build first')
  if (!existsSync(PUBLIC_DIR)) die('dist/public is missing — run the web build first')

  // `useCodeCache` bakes V8's compilation of the bundle into the blob, which is most of the startup
  // win. It is also the part most likely to break on a given Node build, so a failure at either
  // generation or first boot falls back to a plain blob rather than failing the release.
  for (const useCodeCache of [true, false]) {
    try {
      generateBlob(useCodeCache)
      injectAndStage()
      if (smoke) smokeExe()
    } catch (err) {
      if (!useCodeCache) throw err
      log(`exe: retrying without the V8 code cache — ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    break
  }

  const size = statSync(EXE).size
  // Not a reproducible-build hash: `useCodeCache` bakes this machine's V8 compilation into the blob,
  // and the fallback above can change what went in. It fingerprints *this* released file — copy it
  // to the server and compare — rather than something rebuildable from the same commit.
  const sha256 = createHash('sha256').update(readFileSync(EXE)).digest('hex')
  log(`exe: release/lite/bind-poker-lite.exe ${mb(size)}`)
  log(`exe: sha256 ${sha256} (identifies this build, not reproducible: useCodeCache)`)
  for (const name of RELEASE_FILES) log(`exe: release/lite/${name}`)
  if (size > MAX_EXE_BYTES) die(`exe: ${mb(size)} exceeds the ${mb(MAX_EXE_BYTES)} cap`)
}

// ---------------------------------------------------------------------------- entry

const args = process.argv.slice(2)
const smoke = args.includes('--smoke')
const target = args.find((a) => !a.startsWith('-')) ?? 'all'

mkdirSync(DIST, { recursive: true })
const started = Date.now()
try {
  switch (target) {
    case 'web':
      buildWeb()
      break
    case 'server':
      buildServer()
      break
    case 'exe':
      buildExe({ smoke })
      break
    case 'all':
      buildWeb()
      buildServer()
      buildExe({ smoke })
      break
    default:
      die(`unknown target "${target}" — expected one of web, server, exe, all`)
  }
} catch (err) {
  // A failing child has already printed its own diagnostics to the inherited stdio; re-throwing
  // would bury them under an `execFileSync` stack that says nothing about what went wrong.
  die(`${target}: failed — ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
}
log(`${target}: done in ${((Date.now() - started) / 1000).toFixed(1)} s`)
