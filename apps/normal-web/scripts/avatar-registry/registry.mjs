/**
 * The avatar asset registry (Plan 12, spec `2026-09-24-avatar-asset-registry-design.md` §3): the file, its
 * schema, and the few lookups every command needs.
 *
 * `assets/avatar-src/registry.json` is the queue of pictures still to generate *and* the history of every
 * attempt at them. It never repeats what another file already owns — rarity, achievements, frame geometry
 * and catalogue names stay in `items.json`, `avatar-bases.json` and the pipeline — and points at them by
 * `catalog` id instead (spec §2). The pictures it names sit beside it and stay out of git; the registry
 * itself is committed (`assets/avatar-src/.gitignore` carries `!registry.json`).
 *
 * An asset:
 *
 *   id         the layer name without `_L<n>` (`item_head_beret_red01`, `f02`, `bot_3`); an expression or
 *              a bot's second face is `<owner>:<expression>` (`f02:happy`, `bot_3:happy`)
 *   kind       base | expression | item | aura | frame | bot
 *   slot       item: head | face | outfit; aura/frame: their own kind; otherwise null
 *   wear       base: f | m; an item's per-wear cut: f | m; otherwise null
 *   catalog    the id in avatar-bases.json / items.json (bot: bot_<n>)
 *   look       what the template's `{{look.<key>}}` placeholders read
 *   reference  the picture attached when generating: a file in assets/avatar-src/, `@<id>` of another
 *              asset (its `file`, once that asset is ok or approved), or null (aura, frame)
 *   prompt     null → rendered from `templates[kind|slot]` + `look` on every read; a string → a manual override
 *   file       the generated picture's name in assets/avatar-src/
 *   ingest     { as, base, variant, flags } — the pipeline's `--as`, `--base`, `--variant` and extra flags
 *   status     todo | generated | ok | ng | rework-<n> | approved | blocked
 *   attempts   [{ n, at, chat, file, measure, verdict, reason, by? }], one per generated picture
 *   ingested   true once `ingest` has put it into public/avatar/ (absent before)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { PACKAGE_ROOT } from '../avatar-pipeline/manifest.mjs'

/** Where the generated pictures — and the registry that lists them — live. */
export const SRC_DIR = resolve(PACKAGE_ROOT, '../../assets/avatar-src')
export const REGISTRY_FILE = join(SRC_DIR, 'registry.json')
export const REGISTRY_VERSION = 1

export const KINDS = ['base', 'expression', 'item', 'aura', 'frame', 'bot']
export const ITEM_SLOTS = ['head', 'face', 'outfit']
/** Spec §3: after the third failed attempt an asset is `blocked` and the loop leaves it to the user. */
export const MAX_ATTEMPTS = 3
const STATUS = /^(?:todo|generated|ok|ng|approved|blocked|rework-[1-9][0-9]*)$/

export const isRework = (status) => /^rework-[1-9][0-9]*$/.test(status)

/** A reference that is a plain picture name — no directory, a PNG. */
const PICTURE_NAME = /^[^/\\]+\.png$/i

/**
 * Throws, naming the offending asset, unless `registry` is a registry this module can work with.
 * @param {any} registry
 */
export function validateRegistry(registry) {
  if (!registry || typeof registry !== 'object') throw new Error('the registry is not an object')
  if (registry.version !== REGISTRY_VERSION) throw new Error(`registry version ${registry.version} — this script reads version ${REGISTRY_VERSION}`)
  if (!registry.templates || typeof registry.templates !== 'object') throw new Error('the registry has no templates')
  if (!Array.isArray(registry.assets)) throw new Error('the registry has no assets array')
  const ids = new Set()
  for (const asset of registry.assets) {
    const id = asset?.id
    const fail = (why) => {
      throw new Error(`asset ${id ?? '(no id)'}: ${why}`)
    }
    if (typeof id !== 'string' || id === '') fail('needs an id')
    if (ids.has(id)) fail('the id is used twice')
    ids.add(id)
    if (!KINDS.includes(asset.kind)) fail(`kind ${asset.kind} is not one of ${KINDS.join(', ')}`)
    if (asset.kind === 'item' && !ITEM_SLOTS.includes(asset.slot)) fail(`an item needs a slot, one of ${ITEM_SLOTS.join(', ')} (has ${asset.slot})`)
    if (typeof asset.file !== 'string' || !PICTURE_NAME.test(asset.file)) fail(`file ${asset.file} is not a picture name`)
    if (!asset.look || typeof asset.look !== 'object') fail('needs a look')
    if (asset.prompt !== null && typeof asset.prompt !== 'string') fail('prompt is neither null nor a string')
    if (typeof asset.ingest?.as !== 'string' || asset.ingest.as === '') fail('ingest.as is empty')
    if (asset.ingest.flags !== undefined && !Array.isArray(asset.ingest.flags)) fail('ingest.flags is not an array')
    if (typeof asset.status !== 'string' || !STATUS.test(asset.status)) fail(`status ${asset.status} is not one of todo, generated, ok, ng, rework-<n>, approved, blocked`)
    if (!Array.isArray(asset.attempts)) fail('attempts is not an array')
  }
  for (const asset of registry.assets) {
    const { reference } = asset
    if (reference === null || reference === undefined) continue
    if (typeof reference !== 'string') throw new Error(`asset ${asset.id}: reference is not a string`)
    if (reference.startsWith('@')) {
      if (!ids.has(reference.slice(1))) throw new Error(`asset ${asset.id}: reference ${reference} names no asset in the registry`)
      if (reference.slice(1) === asset.id) throw new Error(`asset ${asset.id}: references itself`)
    } else if (!PICTURE_NAME.test(reference)) {
      throw new Error(`asset ${asset.id}: reference ${reference} is neither a picture name nor @<id>`)
    }
  }
  return registry
}

/** Read and validate the registry. `meta` is always present (`{}` when the file has none). */
export function readRegistry(path = REGISTRY_FILE) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  validateRegistry(parsed)
  return { version: parsed.version, meta: parsed.meta ?? {}, templates: parsed.templates, assets: parsed.assets }
}

/** Pretty JSON, two spaces, LF, one trailing newline — so a diff of the file reads as the change it is. */
export function writeRegistry(path, registry) {
  validateRegistry(registry)
  writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`)
}

export function findAsset(registry, id) {
  return registry.assets.find((asset) => asset.id === id) ?? null
}

export function requireAsset(registry, id) {
  const asset = findAsset(registry, id)
  if (!asset) throw new Error(`no asset ${id} in the registry`)
  return asset
}

/**
 * What an asset's reference points at: the picture's name (`file`, or null for none), and the asset it
 * came from when the reference is `@<id>`.
 */
export function referenceOf(asset, registry) {
  const { reference } = asset
  if (reference === null || reference === undefined) return { file: null, asset: null }
  if (!reference.startsWith('@')) return { file: basename(reference), asset: null }
  const other = requireAsset(registry, reference.slice(1))
  return { file: other.file, asset: other }
}

/** The absolute path of an asset's reference picture, or null when it has none. Exists or not. */
export function referencePath(asset, registry, srcDir = SRC_DIR) {
  const { file } = referenceOf(asset, registry)
  return file === null ? null : join(srcDir, file)
}

export const pictureExists = (srcDir, file) => existsSync(join(srcDir, file))

/**
 * The pipeline target an `ingest.as` names: `base:f02`, `expr:f02:happy`, `item:head:beret_red01`,
 * `bot:3`, `bot:3:happy`. Mirrors `parseTarget` in `avatar-pipeline.mjs`, which is private to that CLI
 * and exits the process on a bad spec; this one throws.
 */
export function parseSpec(spec) {
  const [kind, first, second] = String(spec).split(':')
  if (kind === 'base' && first) return { kind: 'base', base: first }
  if (kind === 'expr' && first && second) return { kind: 'expr', base: first, expr: second }
  if (kind === 'item' && first && second) return { kind: 'item', slot: first, code: second }
  if (kind === 'bot' && first !== undefined && first !== '') return { kind: 'bot', bot: Number(first), expr: second ?? 'neutral' }
  throw new Error(`cannot read the ingest target ${spec}`)
}

/**
 * `ingest.flags` → the pipeline's `ingest()` options. Booleans are `--hides-hair-front`,
 * `--hides-hair-back` and `--white`; `--color-tol`, `--min-region`, `--max-hole`, `--tolerance` and
 * `--lock-scale` take the next entry (or `--name=value`).
 */
export function parseFlags(flags = []) {
  const hides = {}
  const diff = {}
  const options = {}
  const list = [...flags]
  for (let at = 0; at < list.length; at++) {
    let [name, value] = String(list[at]).split('=')
    const takeValue = () => {
      if (value === undefined) value = list[++at]
      if (value === undefined || Number.isNaN(Number(value))) throw new Error(`ingest flag ${name} needs a number`)
      return Number(value)
    }
    if (name === '--hides-hair-front') hides.hidesHairFront = true
    else if (name === '--hides-hair-back') hides.hidesHairBack = true
    else if (name === '--white') options.white = true
    else if (name === '--color-tol') diff.colorTol = takeValue()
    else if (name === '--min-region') diff.minRegion = takeValue()
    else if (name === '--max-hole') diff.maxHole = takeValue()
    else if (name === '--tolerance') options.tolerance = takeValue()
    else if (name === '--lock-scale') options.lockScale = takeValue()
    else throw new Error(`unknown ingest flag ${name}`)
  }
  return { hides, diff, ...options }
}
