/**
 * The fixed figures a chibi is built on (design §4.2, §5.1).
 *
 * A base is not an item: a player picks `f01` or `m01`, they never own it, and it is drawn from
 * three PNG layers — hair-back (`L20`), body (`L30`), hair-front (`L60`) — plus one of six face
 * layers (`L50`) for the current expression. `data/avatar-bases.json` names the asset files; this
 * loader holds every one of them against `data/avatar-manifest.json`, the way `loadItemCatalog`
 * holds `asset.file` — an id here that the asset pipeline never produced would otherwise be a base
 * that renders with a hole in it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { packageRoot } from '../db/migrate.js'
import type { AvatarManifest } from './manifest.js'
import { loadAvatarManifest } from './manifest.js'
import type { BaseId } from './slots.js'
import { BASES, isBaseId } from './slots.js'

/** The six expressions every base and every bot is drawn for (design §4.3). */
export type Expression = 'neutral' | 'happy' | 'sad' | 'surprised' | 'closed' | 'sleep'
export const EXPRESSIONS: readonly Expression[] = ['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep']

const HAIR_BACK_LAYER = 20
const BODY_LAYER = 30
const HAIR_FRONT_LAYER = 60
const FACE_LAYER = 50

export interface BaseDef {
  id: BaseId
  nameKey: string
  layers: { hairBack: string; body: string; hairFront: string }
  faces: Record<Expression, string>
}

function defaultBasesPath(): string {
  return join(packageRoot(), 'data', 'avatar-bases.json')
}

function fail(path: string, problem: string): never {
  throw new Error(`invalid avatar bases ${path}: ${problem}`)
}

/** Checks `file` names a manifest entry of exactly `layer`, and returns it back for convenience. */
function checkedFile(path: string, manifest: AvatarManifest, id: string, field: string, file: unknown, layer: number): string {
  if (typeof file !== 'string' || file === '') fail(path, `${id}.${field} has no file name`)
  const entry = manifest.files[file]
  if (entry === undefined) fail(path, `${id}.${field} names ${file}, which is not in the avatar manifest`)
  if (entry.layer !== layer) fail(path, `${id}.${field} names ${file}, which is layer ${String(entry.layer)} rather than ${String(layer)}`)
  return file
}

function parseBase(path: string, manifest: AvatarManifest, id: BaseId, raw: unknown): BaseDef {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail(path, `${id} is not an object`)
  const r = raw as Record<string, unknown>

  const nameKey = r['nameKey']
  if (typeof nameKey !== 'string' || nameKey === '') fail(path, `${id} has no nameKey`)
  if (nameKey !== `bases.${id}`) fail(path, `${id} has nameKey ${nameKey} rather than bases.${id}`)

  const layersRaw = r['layers']
  if (typeof layersRaw !== 'object' || layersRaw === null || Array.isArray(layersRaw)) fail(path, `${id}.layers is not an object`)
  const l = layersRaw as Record<string, unknown>
  const layers = {
    hairBack: checkedFile(path, manifest, id, 'layers.hairBack', l['hairBack'], HAIR_BACK_LAYER),
    body: checkedFile(path, manifest, id, 'layers.body', l['body'], BODY_LAYER),
    hairFront: checkedFile(path, manifest, id, 'layers.hairFront', l['hairFront'], HAIR_FRONT_LAYER),
  }

  const facesRaw = r['faces']
  if (typeof facesRaw !== 'object' || facesRaw === null || Array.isArray(facesRaw)) fail(path, `${id}.faces is not an object`)
  const f = facesRaw as Record<string, unknown>
  for (const expr of EXPRESSIONS) {
    if (!(expr in f)) fail(path, `${id}.faces is missing the ${expr} expression`)
  }
  for (const key of Object.keys(f)) {
    if (!(EXPRESSIONS as readonly string[]).includes(key)) fail(path, `${id}.faces names the unknown expression ${key}`)
  }
  const faces = Object.fromEntries(
    EXPRESSIONS.map((expr) => [expr, checkedFile(path, manifest, id, `faces.${expr}`, f[expr], FACE_LAYER)]),
  ) as Record<Expression, string>

  return { id, nameKey, layers, faces }
}

/**
 * Reads and validates `data/avatar-bases.json` against the avatar manifest.
 *
 * Both bases are required: `BASES` (`slots.ts`) names exactly `f01` and `m01`, and a caller missing
 * either would find out only when a player picked the one nobody defined.
 */
export function loadBases(path: string = defaultBasesPath(), manifest: AvatarManifest = loadAvatarManifest()): Record<BaseId, BaseDef> {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`could not read avatar bases ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) fail(path, 'the file is not a JSON object')
  const raw = parsed as Record<string, unknown>

  for (const key of Object.keys(raw)) {
    if (!isBaseId(key)) fail(path, `names the unknown base ${key}`)
  }

  const entries = BASES.map((id) => {
    if (!(id in raw)) fail(path, `is missing the base ${id}`)
    return [id, parseBase(path, manifest, id, raw[id])] as const
  })
  return Object.fromEntries(entries) as Record<BaseId, BaseDef>
}
