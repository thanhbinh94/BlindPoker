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

/**
 * One cut-out mask on a layer (design §4.1): how much of the layer it covers, and the original
 * pixels' mean lightness under it, so `recolour` (client and pipeline alike) never has to re-measure
 * a base's own hair or eyes before tinting them.
 */
export interface MaskInfo {
  bytes2x: number
  /** HSL lightness, 0–1, averaged over the masked region of the *undyed* layer. */
  meanL: number
  /** The pipeline cut a mask but found nothing to tint — a closed-eye face, an empty L60. */
  empty?: boolean
  /** A hand-drawn mask (`assets/avatar-src/masks/…`) stands in for the automatic cut. */
  override?: boolean
}

export interface AvatarManifestFile {
  layer: number
  w: number
  h: number
  bytes2x: number
  /** True while the pipeline has not ingested a real asset for this name yet (Task 1's placeholders). */
  placeholder?: boolean
  real?: boolean
  /** The hide rules the pipeline recorded for a head layer (`ingest --hides-hair-front/back`) — the
   *  catalogue's own flags must agree (bug 7). */
  hidesHairFront?: boolean
  hidesHairBack?: boolean
  /**
   * The tint masks this layer carries, if any (design §4.1): at most one of each kind. `skin` is v4's
   * (Plan 19): a body and its faces carry one, for `skinColor` to paint (`bodies.ts`).
   */
  masks?: { hair?: MaskInfo; eyes?: MaskInfo; tint?: MaskInfo; skin?: MaskInfo }
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

/** `meanL` is an HSL lightness fraction — the one field here that is not a byte count or a flag. */
function unitInterval(path: string, value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) fail(path, `${what} must be a number between 0 and 1`)
  return value
}

const MASK_KINDS = ['hair', 'eyes', 'tint', 'skin'] as const
type MaskKind = (typeof MASK_KINDS)[number]

function parseMaskInfo(path: string, name: string, kind: MaskKind, raw: unknown): MaskInfo {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail(path, `files.${name}.masks.${kind} is not an object`)
  const r = raw as Record<string, unknown>
  const info: MaskInfo = {
    bytes2x: positiveInt(path, r['bytes2x'], `files.${name}.masks.${kind}.bytes2x`),
    meanL: unitInterval(path, r['meanL'], `files.${name}.masks.${kind}.meanL`),
  }
  if (r['empty'] !== undefined) {
    if (typeof r['empty'] !== 'boolean') fail(path, `files.${name}.masks.${kind}.empty must be a boolean`)
    info.empty = r['empty']
  }
  if (r['override'] !== undefined) {
    if (typeof r['override'] !== 'boolean') fail(path, `files.${name}.masks.${kind}.override must be a boolean`)
    info.override = r['override']
  }
  return info
}

function parseMasks(path: string, name: string, raw: unknown): AvatarManifestFile['masks'] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail(path, `files.${name}.masks is not an object`)
  const r = raw as Record<string, unknown>
  const masks: NonNullable<AvatarManifestFile['masks']> = {}
  for (const kind of MASK_KINDS) {
    if (r[kind] !== undefined) masks[kind] = parseMaskInfo(path, name, kind, r[kind])
  }
  return masks
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
  for (const flag of ['hidesHairFront', 'hidesHairBack'] as const) {
    if (r[flag] === undefined) continue
    if (typeof r[flag] !== 'boolean') fail(path, `files.${name}.${flag} must be a boolean`)
    file[flag] = r[flag]
  }
  if (r['masks'] !== undefined) {
    file.masks = parseMasks(path, name, r['masks'])
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
