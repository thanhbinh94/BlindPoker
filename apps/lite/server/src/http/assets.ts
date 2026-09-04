import { readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

export interface Asset {
  body: Buffer
  type: string
  /** True for build output whose file name carries a content hash — safe to cache forever. */
  immutable: boolean
}

export interface AssetSource {
  get(path: string): Asset | null
  has(path: string): boolean
}

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  woff: 'font/woff',
  txt: 'text/plain; charset=utf-8',
  webmanifest: 'application/manifest+json',
}

/** Content type for an asset path. Unknown extensions stay opaque so a browser never sniffs them. */
export function contentType(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return 'application/octet-stream'
  return TYPES[base.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Vite names every emitted chunk `<name>-<hash>.<ext>` under `assets/`, and a new build changes the
 * hash rather than the file, so those — and only those — may be cached forever. Anything at the
 * root (`index.html`, `favicon.ico`) keeps its name across builds and must stay revalidated.
 */
const HASHED = /-[A-Za-z0-9_-]{6,}\.[A-Za-z0-9]+$/
function isImmutable(normalized: string): boolean {
  return normalized.startsWith('assets/') && HASHED.test(normalized)
}

/**
 * Turns a request path into a relative key under the asset root, or `null` if it could escape it.
 *
 * Percent-encoding is decoded first (so `..%2F` cannot smuggle a traversal past the check), then
 * backslashes are folded to `/` (Windows treats both as separators), then any `..` segment rejects
 * the whole path outright. `.` and empty segments are dropped, so `/` normalises to `''`.
 */
function normalizePath(path: string): string | null {
  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return null // malformed percent-encoding — not a path we can reason about
  }
  if (decoded.includes('\0')) return null
  const segments = decoded.replace(/\\/g, '/').split('/')
  const out: string[] = []
  for (const segment of segments) {
    if (segment === '..') return null
    if (segment === '' || segment === '.') continue
    out.push(segment)
  }
  return out.join('/')
}

/** Wraps a loader in a memo that also remembers misses, so a missing file is stat'ed once. */
function cached(load: (key: string) => Asset | null): AssetSource {
  const memo = new Map<string, Asset | null>()
  const get = (path: string): Asset | null => {
    const key = normalizePath(path)
    if (key === null || key === '') return null
    if (memo.has(key)) return memo.get(key) ?? null
    const asset = load(key)
    memo.set(key, asset)
    return asset
  }
  return { get, has: (path) => get(path) !== null }
}

/**
 * Serves the files under `dir` — the development and unpacked-release path.
 *
 * Everything read is held in memory for the life of the process: the Lite bundle is a handful of
 * files totalling a few hundred KB, and a long-lived cache keeps the exe's behaviour identical to
 * the SEA source below. It follows that replacing a file on disk needs a restart.
 */
export function assetSourceFromDir(dir: string): AssetSource {
  const root = resolve(dir)
  return cached((key) => {
    const full = resolve(join(root, key))
    // Belt-and-braces after `normalizePath`: a symlink or a stray separator must not reach outside.
    if (full !== root && !full.startsWith(root + sep)) return null
    try {
      if (!statSync(full).isFile()) return null
      return { body: readFileSync(full), type: contentType(key), immutable: isImmutable(key) }
    } catch {
      return null // missing, unreadable, or a path component that is not a directory
    }
  })
}

/**
 * Serves the files embedded in a Node SEA executable. `manifest` is the list of public paths the
 * build wrote to the `assets.json` SEA asset; a request for anything outside it is a miss, so a
 * traversal cannot reach the exe's other assets (`assets.json` itself included).
 *
 * `read` exists for tests: by default it goes through `process.getBuiltinModule('node:sea')`, which
 * asks Node for the built-in at run time — `node:sea` is not in `module.builtinModules`, so a
 * bundler that resolves imports from that list would otherwise try to load it from disk and fail.
 */
export function assetSourceFromSea(manifest: string[], read?: (key: string) => ArrayBuffer): AssetSource {
  const keys = new Set<string>()
  for (const entry of manifest) {
    const key = normalizePath(entry)
    if (key !== null && key !== '') keys.add(key)
  }
  const getAsset = read ?? ((key: string) => {
    const sea = process.getBuiltinModule('node:sea')
    if (!sea) throw new Error('node:sea is unavailable')
    return sea.getAsset(key)
  })
  return cached((key) => (keys.has(key) ? { body: Buffer.from(getAsset(key)), type: contentType(key), immutable: isImmutable(key) } : null))
}
