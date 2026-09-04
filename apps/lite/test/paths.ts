/** Shared locations for the build-artefact tests, resolved from this file rather than the working directory. */
import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `apps/lite`. */
export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))

export const DIST_DIR = resolve(PACKAGE_ROOT, 'dist')
export const SERVER_BUNDLE = join(DIST_DIR, 'server.cjs')
export const PUBLIC_DIR = join(DIST_DIR, 'public')
export const ASSET_MANIFEST = join(DIST_DIR, 'assets.json')
export const EXE = resolve(PACKAGE_ROOT, 'release/lite/bind-poker-lite.exe')

/** Every file under `dir`, as `/`-separated paths relative to it. Depth-first, so the order is stable. */
export function walk(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel))
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

export function sizeOf(path: string): number {
  return statSync(path).size
}
