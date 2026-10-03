/**
 * The bodies a v4 figure is drawn on, one per gender (spec §4.3, Plan 19).
 *
 * A body is not an item: a player picks a gender, they never own one. It is drawn from one PNG layer
 * (`body_<g>_L30`: bald, in neutral underwear, its skin the "cream" tone) plus one of six face layers
 * (`body_<g>_face_<expr>_L50`: the face alone, no hair) for the current expression; the hair is an item of
 * its own now (`hairStyle`, `items.ts`). `data/avatar-bodies.json` names the files and each body's natural
 * eye colour, and this loader holds every file against `data/avatar-manifest.json`, the way `loadBases`
 * did for the bases this replaces — a body naming a file the pipeline never produced would render with a
 * hole in it.
 *
 * Unlike the base registry, the list is closed: exactly `f` and `m` (`GENDERS`), since a gender is a type in
 * the code (the outfit cut it wears, the hairstyles it may wear), not a row of data.
 *
 * Where a body can be recoloured — skin and eyes — is **derived** from the manifest's masks rather than
 * written in the JSON (ruling 5): a body becomes tintable the moment the pipeline has cut its masks, and is
 * never half-tintable by someone editing JSON.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { packageRoot } from '../db/migrate.js'
import type { AvatarManifest, MaskInfo } from './manifest.js'
import { loadAvatarManifest } from './manifest.js'
import type { Gender } from './slots.js'
import { GENDERS } from './slots.js'

/** The six expressions every body and every bot is drawn for (design §4.3). */
export type Expression = 'neutral' | 'happy' | 'sad' | 'surprised' | 'closed' | 'sleep'
export const EXPRESSIONS: readonly Expression[] = ['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep']

/**
 * One recolourable region across a set of layers (design §4.1, §5.2): the layers whose mask of that kind is
 * non-empty, in the order they are drawn, and the one reference lightness every one of them is tinted
 * against, so no seam shows where two of them overlap.
 */
export interface MaskSet {
  meanL: number
  files: string[]
}

export interface BodyDef {
  gender: Gender
  /** `body_<g>_L30`. */
  body: string
  /** `body_<g>_face_<expr>_L50`, one per expression. */
  faces: Record<Expression, string>
  /** The iris colour the face layers were drawn with, a lowercase `#rrggbb` (ruling 6; provisional until C1). */
  naturalEyeColour: string
  /** Derived from the manifest at load (ruling 5); absent until the pipeline has cut a mask. */
  tint?: { skin?: MaskSet; eyes?: MaskSet }
}

export type Bodies = Readonly<Record<Gender, BodyDef>>

const BODY_LAYER = 30
const FACE_LAYER = 50

/** A colour is always a lowercase 6-digit hex (design §3.2), the same rule `items.ts` holds a colour item to. */
const HEX_COLOUR = /^#[0-9a-f]{6}$/

function defaultBodiesPath(): string {
  return join(packageRoot(), 'data', 'avatar-bodies.json')
}

function fail(path: string, problem: string): never {
  throw new Error(`invalid avatar bodies ${path}: ${problem}`)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Checks `file` names a manifest entry of exactly `layer`, and returns it back for convenience. */
function checkedFile(path: string, manifest: AvatarManifest, field: string, file: unknown, layer: number): string {
  if (typeof file !== 'string' || file === '') fail(path, `${field} has no file name`)
  const entry = manifest.files[file]
  if (entry === undefined) fail(path, `${field} names ${file}, which is not in the avatar manifest`)
  if (entry.layer !== layer) fail(path, `${field} names ${file}, which is layer ${String(entry.layer)} rather than ${String(layer)}`)
  return file
}

function parseBody(path: string, manifest: AvatarManifest, gender: Gender, raw: unknown): BodyDef {
  if (!isObject(raw)) fail(path, `${gender} is not an object`)

  const body = checkedFile(path, manifest, `${gender}.body`, raw['body'], BODY_LAYER)

  const facesRaw = raw['faces']
  if (!isObject(facesRaw)) fail(path, `${gender}.faces is not an object`)
  for (const expr of EXPRESSIONS) {
    if (!(expr in facesRaw)) fail(path, `${gender}.faces is missing the ${expr} expression`)
  }
  for (const key of Object.keys(facesRaw)) {
    if (!(EXPRESSIONS as readonly string[]).includes(key)) fail(path, `${gender}.faces names the unknown expression ${key}`)
  }
  const faces = Object.fromEntries(
    EXPRESSIONS.map((expr) => [expr, checkedFile(path, manifest, `${gender}.faces.${expr}`, facesRaw[expr], FACE_LAYER)]),
  ) as Record<Expression, string>

  const naturalEyeColour = raw['naturalEyeColour']
  if (typeof naturalEyeColour !== 'string' || !HEX_COLOUR.test(naturalEyeColour)) {
    fail(path, `${gender} has the naturalEyeColour ${JSON.stringify(naturalEyeColour)} rather than a lowercase #rrggbb`)
  }

  const def: BodyDef = { gender, body, faces, naturalEyeColour }
  const tint = deriveTint(manifest, body, faces)
  if (tint !== undefined) def.tint = tint
  return def
}

/**
 * `BodyDef.tint` (ruling 5), read off the manifest's `masks` the way `bases.ts`'s `deriveTint` reads a base's.
 *
 * Skin candidates are the body and all six faces, in that order; eye candidates are the six faces alone. A
 * layer is in `files` when its mask of that kind is non-empty — a shut-eyed face has no iris to paint. The
 * *whole-body* `meanL` comes from one canonical layer per kind — the body L30 for skin, `face_neutral` for
 * eyes — so every layer of the body is tinted against the same reference lightness and no seam shows where a
 * face overlaps the body. The canonical layer has to carry a non-empty mask itself for there to be a
 * reference at all; without one the kind is left out rather than tinted against an empty region's 0.
 */
function deriveTint(manifest: AvatarManifest, body: string, faces: Record<Expression, string>): BodyDef['tint'] {
  const maskOf = (file: string, kind: 'skin' | 'eyes'): MaskInfo | undefined => {
    const mask = manifest.files[file]?.masks?.[kind]
    return mask !== undefined && mask.empty !== true ? mask : undefined
  }
  const faceFiles = EXPRESSIONS.map((expr) => faces[expr])

  const tint: NonNullable<BodyDef['tint']> = {}
  const bodySkin = maskOf(body, 'skin')
  if (bodySkin !== undefined) tint.skin = { meanL: bodySkin.meanL, files: [body, ...faceFiles].filter((file) => maskOf(file, 'skin') !== undefined) }
  const neutralEyes = maskOf(faces.neutral, 'eyes')
  if (neutralEyes !== undefined) tint.eyes = { meanL: neutralEyes.meanL, files: faceFiles.filter((file) => maskOf(file, 'eyes') !== undefined) }

  return Object.keys(tint).length > 0 ? tint : undefined
}

/**
 * Reads and validates `data/avatar-bodies.json` against the avatar manifest.
 *
 * Refuses rather than degrades, at boot: the file must name exactly the genders `GENDERS` lists, each with a
 * body at layer 30, all six expressions (and no others) at layer 50, and a lowercase 6-digit natural eye
 * colour. The answer is keyed in `GENDERS` order — f, then m — whatever order the file is written in, since
 * `/api/catalog/avatar` lists the bodies in it.
 */
export function loadBodies(path: string = defaultBodiesPath(), manifest: AvatarManifest = loadAvatarManifest()): Bodies {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`could not read avatar bodies ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!isObject(parsed)) fail(path, 'the file is not a JSON object')
  const raw = parsed

  for (const key of Object.keys(raw)) {
    if (!(GENDERS as readonly string[]).includes(key)) fail(path, `names ${key}, which is not a gender (${GENDERS.join(', ')})`)
  }
  for (const gender of GENDERS) {
    if (!(gender in raw)) fail(path, `is missing the gender ${gender}`)
  }

  return Object.fromEntries(GENDERS.map((gender) => [gender, parseBody(path, manifest, gender, raw[gender])])) as Record<Gender, BodyDef>
}
