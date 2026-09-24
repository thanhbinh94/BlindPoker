/**
 * The fixed figures a chibi is built on (design §4.2, §5.1).
 *
 * A base is not an item: a player picks one, they never own it, and it is drawn from three PNG
 * layers — hair-back (`L20`), body (`L30`), hair-front (`L60`) — plus one of six face layers
 * (`L50`) for the current expression. `data/avatar-bases.json` names the asset files; this loader
 * holds every one of them against `data/avatar-manifest.json`, the way `loadItemCatalog` holds
 * `asset.file` — an id here that the asset pipeline never produced would otherwise be a base that
 * renders with a hole in it.
 *
 * 2026-09-17: the registry is also the *list* of bases rather than being checked against one, so
 * adding a figure that shares F01's body with its own head, hair and skin is art plus a JSON entry
 * plus an i18n key, with no type to widen. See `loadBases`.
 *
 * 2026-09-20: every base also declares the body it wears clothes on, `"wear": "f" | "m"`. One inventory
 * item stays one item — ownership, achievements and the outfits table all key on its id — and only the
 * *layer drawn* differs, so what picks between an outfit's cuts is this field on whichever base is
 * wearing it (`asset.variants` in `items.ts`, `toWearRef` in the web app's `avatar/chibi.ts`). The art
 * side says the same thing in `BASE_WEAR` (`apps/normal-web/scripts/avatar-pipeline/manifest.mjs`), and
 * the pipeline's own test holds the two files against each other.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { packageRoot } from '../db/migrate.js'
import type { AvatarManifest } from './manifest.js'
import { loadAvatarManifest } from './manifest.js'
import type { BaseId, BaseIds } from './slots.js'
import { BASE_ID_PATTERN, DEFAULT_BASE } from './slots.js'

/** The six expressions every base and every bot is drawn for (design §4.3). */
export type Expression = 'neutral' | 'happy' | 'sad' | 'surprised' | 'closed' | 'sleep'
export const EXPRESSIONS: readonly Expression[] = ['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep']

const HAIR_BACK_LAYER = 20
const BODY_LAYER = 30
const HAIR_FRONT_LAYER = 60
const FACE_LAYER = 50

/** The body a base wears its clothes on, and so which cut of a gendered item it is drawn in. */
export type Wear = 'f' | 'm'
export const WEARS: readonly Wear[] = ['f', 'm']

export interface BaseDef {
  id: BaseId
  nameKey: string
  /** Which cut of a per-wear item this base wears (`asset.variants` in `items.ts`). */
  wear: Wear
  layers: { hairBack: string; body: string; hairFront: string }
  faces: Record<Expression, string>
  /**
   * Where this base can be recoloured (design §3.1, §4.1, §5.2), derived from the manifest's own
   * `masks` rather than written by hand — a base is never half-tintable by someone editing JSON.
   * Absent entirely until the pipeline has cut masks for it; `hair`/`eyes` independently, since a
   * base could in principle get one before the other.
   */
  tint?: {
    /** `files`: every layer whose mask is non-empty, in the order recolour has to draw them. */
    hair?: { meanL: number; files: string[] }
    eyes?: { meanL: number; files: string[] }
  }
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

  // Required rather than defaulted: a base with no wear would silently be drawn in whichever cut the
  // default happens to be, which for a skirted uniform is a visible mistake on half the roster.
  const wear = r['wear']
  if (typeof wear !== 'string' || !(WEARS as readonly string[]).includes(wear)) {
    fail(path, `${id} has wear ${JSON.stringify(wear)} rather than one of ${WEARS.join(', ')}`)
  }

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

  const tint = deriveTint(manifest, layers, faces)
  return tint === undefined ? { id, nameKey, wear: wear as Wear, layers, faces } : { id, nameKey, wear: wear as Wear, layers, faces, tint }
}

/**
 * `BaseDef.tint` (design §4.1, §5.2): which of this base's layers can be recoloured, read straight
 * off the manifest's `masks` rather than declared in `avatar-bases.json` — a base becomes tintable
 * the moment the pipeline has cut its masks, with no second place to say so.
 *
 * Hair candidates are the body, the hair-front layer (only when it actually carries hair — an empty
 * L60 means the front is bald, e.g. a bun that lives entirely in L20) and all six faces, since every
 * one of them redraws a sliver of hair at the hairline. Eye candidates are the six faces alone. The
 * *whole-base* `meanL` for each kind comes from one canonical layer — L30 for hair, `face_neutral`
 * for eyes — so every layer is tinted against the same reference lightness and no seam shows where a
 * face layer overlaps the body (design §5.2's "mọi lớp của một thân tô theo cùng meanL").
 */
function deriveTint(manifest: AvatarManifest, layers: BaseDef['layers'], faces: Record<Expression, string>): BaseDef['tint'] {
  const hasMask = (file: string, kind: 'hair' | 'eyes'): boolean => {
    const mask = manifest.files[file]?.masks?.[kind]
    return mask !== undefined && mask.empty !== true
  }

  const hairCandidates = [layers.body, layers.hairFront, ...EXPRESSIONS.map((expr) => faces[expr])]
  const hairFiles = hairCandidates.filter((file) => hasMask(file, 'hair'))
  const eyeFiles = EXPRESSIONS.map((expr) => faces[expr]).filter((file) => hasMask(file, 'eyes'))

  const tint: NonNullable<BaseDef['tint']> = {}
  // The body must itself be a hair candidate for `hairFiles` to have a meanL to report — which is
  // also why the filter above and this reference are read off the same layer.
  const bodyHairMeanL = manifest.files[layers.body]?.masks?.hair?.meanL
  if (hairFiles.length > 0 && bodyHairMeanL !== undefined) tint.hair = { meanL: bodyHairMeanL, files: hairFiles }
  const neutralEyeMeanL = manifest.files[faces.neutral]?.masks?.eyes?.meanL
  if (eyeFiles.length > 0 && neutralEyeMeanL !== undefined) tint.eyes = { meanL: neutralEyeMeanL, files: eyeFiles }

  return Object.keys(tint).length > 0 ? tint : undefined
}

/**
 * Reads and validates `data/avatar-bases.json` against the avatar manifest.
 *
 * 2026-09-17: **this file is the list of bases**, rather than a file checked against a list in the code.
 * Whatever ids it names are the bases this server has — every one of them held to naming seven manifest
 * entries that exist at the right layers, so a base is never half a figure. Two rules keep an open list
 * honest: an id has to be spellable as one (`BASE_ID_PATTERN`, because it ends up inside a file name), and
 * `DEFAULT_BASE` has to be among them, since it is what a config with an unreadable base falls back to.
 *
 * The art comes first. A base only gets in here once `BASES` in the pipeline's `manifest.mjs` has drawn or
 * ingested its layers, because an entry naming a file the manifest does not list fails at boot.
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

  const ids = Object.keys(raw)
  for (const id of ids) {
    if (!BASE_ID_PATTERN.test(id)) fail(path, `names ${id}, which is not a legal base id (${String(BASE_ID_PATTERN)})`)
  }
  if (!ids.includes(DEFAULT_BASE)) fail(path, `is missing the base ${DEFAULT_BASE}, which every avatar falls back to`)

  const entries = ids.map((id) => [id, parseBase(path, manifest, id, raw[id])] as const)
  return Object.fromEntries(entries)
}

/** The ids of a loaded registry, as `validateAvatarConfig` and `readAvatarConfig` want them. */
export function baseIdsOf(bases: Record<BaseId, BaseDef>): BaseIds {
  return new Set(Object.keys(bases))
}
