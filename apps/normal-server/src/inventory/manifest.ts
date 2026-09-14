/**
 * The build output Task 1's asset pipeline emits: the list of every PNG layer that actually exists,
 * by name, with its layer number and pixel size (design §3, §4.4).
 *
 * `loadItemCatalog` (`items.ts`) and `loadBases` (`bases.ts`) both hold their own `asset.file`
 * references against this — an item or a base that names a file the pipeline never produced would
 * otherwise be an invisible layer on somebody's chibi, caught only by looking. Loaded once, at boot,
 * the same way `items.json` is: refused loudly rather than degraded, because every avatar this
 * server renders is built from what this file says exists.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { packageRoot } from '../db/migrate.js'

export interface AvatarManifestFile {
  layer: number
  w: number
  h: number
  bytes2x: number
  /** True while the pipeline has not ingested a real asset for this name yet (Task 1's placeholders). */
  placeholder?: boolean
  real?: boolean
}

export interface AvatarManifest {
  version: 1
  frame: { w: number; h: number }
  crop: { x: number; y: number; size: number }
  files: Record<string, AvatarManifestFile>
}

function defaultManifestPath(): string {
  return join(packageRoot(), 'data', 'avatar-manifest.json')
}

function fail(path: string, problem: string): never {
  throw new Error(`invalid avatar manifest ${path}: ${problem}`)
}

function positiveInt(path: string, value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail(path, `${what} must be a positive number`)
  return value
}

/** Like `positiveInt`, but zero is a legitimate pixel coordinate — only `crop.x`/`crop.y` use this. */
function nonNegativeInt(path: string, value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(path, `${what} must be a non-negative number`)
  return value
}

function parseFile(path: string, name: string, raw: unknown): AvatarManifestFile {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail(path, `files.${name} is not an object`)
  const r = raw as Record<string, unknown>
  const layer = r['layer']
  if (typeof layer !== 'number' || !Number.isFinite(layer) || layer <= 0) fail(path, `files.${name} has no positive layer`)
  const file: AvatarManifestFile = {
    layer,
    w: positiveInt(path, r['w'], `files.${name}.w`),
    h: positiveInt(path, r['h'], `files.${name}.h`),
    bytes2x: positiveInt(path, r['bytes2x'], `files.${name}.bytes2x`),
  }
  if (r['placeholder'] !== undefined) {
    if (typeof r['placeholder'] !== 'boolean') fail(path, `files.${name}.placeholder must be a boolean`)
    file.placeholder = r['placeholder']
  }
  if (r['real'] !== undefined) {
    if (typeof r['real'] !== 'boolean') fail(path, `files.${name}.real must be a boolean`)
    file.real = r['real']
  }
  return file
}

/**
 * Reads and validates `data/avatar-manifest.json`.
 *
 * Refuses rather than defaults: a manifest that failed to parse would otherwise let every
 * `asset.file` check in `items.ts`/`bases.ts` pass vacuously (nothing to compare against), which is
 * a worse failure than a container that will not boot.
 */
export function loadAvatarManifest(path: string = defaultManifestPath()): AvatarManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`could not read avatar manifest ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) fail(path, 'the file is not a JSON object')
  const raw = parsed as Record<string, unknown>

  if (raw['version'] !== 1) fail(path, `unknown version ${JSON.stringify(raw['version'])}`)

  const frameRaw = raw['frame']
  if (typeof frameRaw !== 'object' || frameRaw === null || Array.isArray(frameRaw)) fail(path, 'frame is not an object')
  const frame = frameRaw as Record<string, unknown>
  const frameSize = { w: positiveInt(path, frame['w'], 'frame.w'), h: positiveInt(path, frame['h'], 'frame.h') }

  const cropRaw = raw['crop']
  if (typeof cropRaw !== 'object' || cropRaw === null || Array.isArray(cropRaw)) fail(path, 'crop is not an object')
  const cropIn = cropRaw as Record<string, unknown>
  const crop = {
    x: nonNegativeInt(path, cropIn['x'], 'crop.x'),
    y: nonNegativeInt(path, cropIn['y'], 'crop.y'),
    size: positiveInt(path, cropIn['size'], 'crop.size'),
  }

  const filesRaw = raw['files']
  if (typeof filesRaw !== 'object' || filesRaw === null || Array.isArray(filesRaw)) fail(path, 'files is not an object')
  const files: Record<string, AvatarManifestFile> = {}
  for (const [name, entry] of Object.entries(filesRaw as Record<string, unknown>)) {
    files[name] = parseFile(path, name, entry)
  }

  return { version: 1, frame: frameSize, crop, files }
}
