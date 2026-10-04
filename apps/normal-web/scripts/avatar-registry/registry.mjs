/**
 * The avatar asset registry (Plan 12, spec `2026-09-24-avatar-asset-registry-design.md` §3): the file, its
 * schema, and the few lookups every command needs.
 *
 * `assets/avatar-src/registry.json` is the queue of pictures still to generate *and* the history of every
 * attempt at them. It never repeats what another file already owns — rarity, achievements, frame geometry
 * and catalogue names stay in `items.json` and the pipeline — and points at them by `catalog` id instead (spec §2). The pictures it names sit beside it and stay out of git; the registry
 * itself is committed (`assets/avatar-src/.gitignore` carries `!registry.json`).
 *
 * An asset:
 *
 *   id         the layer name without `_L<n>` (`item_head_beret_red01`, `f02`, `bot_3`, `body_f`,
 *              `item_hair_f_bob01`); an expression or a bot's second face is `<owner>:<expression>` (`f02:happy`,
 *              `bot_3:happy`, `body_f:happy`); a v4 redraw of a Plan 12 asset is `v4/<old id>` (Plan 19)
 *   kind       item | aura | frame | bot, and since Plan 19 (v4) body | bodyExpression | hair; base | expression are
 *              Plan 12's flat bases and their faces — history only since the switch-over (D1)
 *   slot       item: head | face | outfit; aura/frame: their own kind; otherwise null
 *   wear       body, body expression, hairstyle (and a retired base): f | m; an item's per-wear cut: f | m; otherwise null
 *   catalog    the id in items.json (bot: bot_<n>; body: its gender; hairstyle: hair_<code>; a retired base: its id)
 *   look       what the template's `{{look.<key>}}` placeholders read
 *   reference  the picture attached when generating: a file in assets/avatar-src/, `@<id>` of another
 *              asset (its `file`, once that asset is ok or approved), or null (aura, frame)
 *   prompt     null → rendered from `templates[kind|slot]` + `look` on every read; a string → a manual override
 *   file       the generated picture's name in assets/avatar-src/
 *   ingest     { as, base, variant, flags } — the pipeline's `--as`, `--base`, `--variant` and extra flags
 *   status     todo | generated | ok | ng | rework-<n> | approved | blocked
 *   attempts   [{ n, at, chat, file, measure, verdict, reason, by? }], one per generated picture
 *   ingested   true once `ingest` has put it into public/avatar/ (absent before)
 *   superseded (Plan 19 final review) the id of the asset that replaced it (`'v4/bot_0'`), or `true` when nothing did — a
 *              Plan 12 picture drawn and cut on the retired flat base f01, kept as history: `ingest` and `verify` refuse it
 *              up front, and `next` never hands it out (`refuseSuperseded`, `isSuperseded`)
 *   note       a sentence for a human reading the file — why an asset is superseded, say (absent when there is none)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { BOT_TRANSFORM_FROM } from '../avatar-pipeline/extract.mjs'
import { HAIR_CODES, PACKAGE_ROOT, hairGender } from '../avatar-pipeline/manifest.mjs'

/** Where the generated pictures — and the registry that lists them — live. */
export const SRC_DIR = resolve(PACKAGE_ROOT, '../../assets/avatar-src')
export const REGISTRY_FILE = join(SRC_DIR, 'registry.json')
export const REGISTRY_VERSION = 1

/**
 * Plan 12's six kinds, and Plan 19's three (v4): a `body` (`body:<g>`, its picture drawn from F01's), a
 * `bodyExpression` (`face:<g>:<expr>`, drawn on the body's picture) and a `hair`style (`hair:<code>`, drawn on its
 * gender's bald body). A v4 outfit, bot, hat or glasses stays an `item` or a `bot`, cut on a body.
 *
 * `base` and `expression` are **retired** (Plan 19 D1): the flat bases and their faces are gone from the pipeline and
 * the app. The kinds stay so the committed registry keeps Plan 12's history of them (its four bases, twenty faces and
 * the two templates they render from), but nothing new is made of them — `parseSpec` refuses their `base:`/`expr:`
 * targets, so neither `verify` nor `ingest` will touch one.
 */
export const KINDS = ['base', 'expression', 'item', 'aura', 'frame', 'bot', 'body', 'bodyExpression', 'hair']
export const ITEM_SLOTS = ['head', 'face', 'outfit']
/** Spec §3: after the third failed attempt an asset is `blocked` and the loop leaves it to the user. */
export const MAX_ATTEMPTS = 3
const STATUS = /^(?:todo|generated|ok|ng|approved|blocked|rework-[1-9][0-9]*)$/
/** The pipeline target each v4 kind is ingested as (Plan 19): `parseSpec(ingest.as).kind`. */
const V4_TARGET = { body: 'body', bodyExpression: 'bodyFace', hair: 'hair' }

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
    if (V4_TARGET[asset.kind]) {
      let target = null
      try {
        target = parseSpec(asset.ingest.as).kind
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error))
      }
      if (target !== V4_TARGET[asset.kind]) fail(`a ${asset.kind} is ingested as ${V4_TARGET[asset.kind] === 'bodyFace' ? 'face' : V4_TARGET[asset.kind]}:…, not ${asset.ingest.as}`)
      // The pipeline refuses any other hairstyle at ingest; say so before a picture is generated for it.
      if (asset.kind === 'hair') {
        const { code } = parseSpec(asset.ingest.as)
        if (!HAIR_CODES.includes(code)) fail(`hairstyle ${code} is not one of ${HAIR_CODES.join(', ')}`)
      }
    }
    if (asset.ingest.flags !== undefined && !Array.isArray(asset.ingest.flags)) fail('ingest.flags is not an array')
    if (typeof asset.status !== 'string' || !STATUS.test(asset.status)) fail(`status ${asset.status} is not one of todo, generated, ok, ng, rework-<n>, approved, blocked`)
    if (!Array.isArray(asset.attempts)) fail('attempts is not an array')
    if (asset.superseded !== undefined && asset.superseded !== true && (typeof asset.superseded !== 'string' || asset.superseded === '')) {
      fail(`superseded is ${JSON.stringify(asset.superseded)} — the id of the asset that replaced it, or true`)
    }
    if (asset.note !== undefined && (typeof asset.note !== 'string' || asset.note === '')) fail('note is not a sentence')
  }
  for (const asset of registry.assets) {
    if (typeof asset.superseded === 'string') {
      const by = findAsset(registry, asset.superseded)
      if (by === null) throw new Error(`asset ${asset.id}: superseded by ${asset.superseded}, which is not in the registry`)
      if (by.id === asset.id || isSuperseded(by)) throw new Error(`asset ${asset.id}: superseded by ${asset.superseded}, which is not a live asset`)
    }
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

/** Whether an asset is a superseded Plan 12 entry, kept as history (`superseded`: an id, or `true`). */
export const isSuperseded = (asset) => asset.superseded !== undefined && asset.superseded !== false

/**
 * Throw, naming the asset and what replaced it, when `what` (`ingest`, `verify`) is asked of a superseded entry (Plan 19
 * final review). Plan 12's bots, casual01 and hats and glasses were drawn and cut on the flat base f01, which the
 * switch-over retired: cut again today, a bot or casual01 would land under its v4 replacement's `ingest.as` and overwrite
 * that art, and a hat or a pair of glasses — `base` null, no `--hair` — would be diffed against the bald body f, F01's
 * hair and all read as the item.
 */
export function refuseSuperseded(asset, what) {
  if (!isSuperseded(asset)) return
  const by = typeof asset.superseded === 'string' ? `superseded by ${asset.superseded}` : 'superseded'
  throw new Error(`asset ${asset.id} is ${by} — ${asset.note ?? 'kept as history'}; ${what} refuses it (Plan 19 final review)`)
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
 * The pipeline target an `ingest.as` names: `item:head:beret_red01`, `bot:3`, `bot:3:happy`, and since Plan 19
 * `body:f`, `face:f:happy` (`{ kind: 'bodyFace', … }`, the pipeline's name; the registry's kind is `bodyExpression`,
 * see `kindOfSpec`) and `hair:f_bob01` (gendered by its code). Mirrors `parseTarget` in `avatar-pipeline.mjs`, which
 * is private to that CLI and exits the process on a bad spec; this one throws.
 *
 * Plan 12's `base:<id>` and `expr:<id>:<expr>` are retired (D1, see `KINDS`): refused, saying what replaced them.
 */
export function parseSpec(spec) {
  const [kind, first, second, ...rest] = String(spec).split(':')
  if (kind === 'base' || kind === 'expr') {
    throw new Error(`the ingest target ${spec} is retired (Plan 19 D1): the flat bases are gone — a figure is a body (body:<g>) and its faces (face:<g>:<expr>)`)
  }
  if (kind === 'item' && first && second) return { kind: 'item', slot: first, code: second }
  if (kind === 'bot' && first !== undefined && first !== '') return { kind: 'bot', bot: Number(first), expr: second ?? 'neutral' }
  if (kind === 'body' && first && second === undefined) return { kind: 'body', gender: first }
  if (kind === 'face' && first && second && rest.length === 0) return { kind: 'bodyFace', gender: first, expr: second }
  if (kind === 'hair' && first && second === undefined) {
    let gender
    try {
      gender = hairGender(first)
    } catch (error) {
      throw new Error(`cannot read the ingest target ${spec}: ${error instanceof Error ? error.message : String(error)}`)
    }
    return { kind: 'hair', code: first, gender }
  }
  throw new Error(`cannot read the ingest target ${spec}`)
}

/** `--recolour-to`'s value: the pipeline's own rule (`checkV4Options` in extract.mjs). */
const HEX = /^#[0-9a-f]{6}$/i

/**
 * `ingest.flags` → the pipeline's `ingest()` options. Booleans are `--hides-hair-front`,
 * `--hides-hair-back` and `--white`; `--color-tol`, `--min-region`, `--max-hole`, `--tolerance` and
 * `--lock-scale` take the next entry as a number (or `--name=value`). Plan 19's three take a word:
 * `--hair <code>` (an item drawn over that hairstyle), `--anchor head` (a body placed by its eyes) and
 * `--recolour-to <#rrggbb>` (a hairstyle recoloured); the pipeline itself decides which target each belongs to.
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
    const takeWord = () => {
      if (value === undefined) value = list[++at]
      if (value === undefined || value === '' || String(value).startsWith('--')) throw new Error(`ingest flag ${name} needs a value`)
      return String(value)
    }
    if (name === '--hides-hair-front') hides.hidesHairFront = true
    else if (name === '--hides-hair-back') hides.hidesHairBack = true
    else if (name === '--white') options.white = true
    else if (name === '--color-tol') diff.colorTol = takeValue()
    else if (name === '--min-region') diff.minRegion = takeValue()
    else if (name === '--max-hole') diff.maxHole = takeValue()
    else if (name === '--tolerance') options.tolerance = takeValue()
    else if (name === '--lock-scale') options.lockScale = takeValue()
    else if (name === '--hair') options.hair = takeWord()
    else if (name === '--anchor') {
      options.anchor = takeWord()
      if (options.anchor !== 'head') throw new Error(`ingest flag --anchor ${options.anchor} is not one the pipeline knows — only head`)
    } else if (name === '--recolour-to') {
      options.recolourTo = takeWord()
      if (!HEX.test(options.recolourTo)) throw new Error(`ingest flag --recolour-to ${options.recolourTo} is not a #rrggbb colour`)
    } else throw new Error(`unknown ingest flag ${name}`)
  }
  return { hides, diff, ...options }
}

/**
 * Whose own picture a reference is — the body that picture is the drawing of — or null: `@body_f` → `f`. Anything
 * else — a bot's picture, a hairstyle's, `f01_candidate_1.png` (F01's, the canvas the bodies were drawn from, which
 * names no transform since the switch-over retired the base, D1), `ref.png` — is nobody's.
 */
export function referenceOwner(reference, registry) {
  if (reference === null || reference === undefined || !reference.startsWith('@')) return null
  const other = findAsset(registry, reference.slice(1))
  if (other?.kind === 'body') return parseSpec(other.ingest.as).gender ?? null
  return null
}

/**
 * The body whose stored transform the pipeline cuts an asset's picture on (`--transform-from`), or null when the
 * pipeline needs none from the registry. The one copy, shared by `ingest` and `verify` (Plan 19, pre-flight #28; it
 * lived in ingest.mjs before).
 *
 * - A **bot** (2026-09-24) follows its chain of references back to the first picture that is a body's own
 *   (`referenceOwner`): a v4 redraw `v4/bot_3:happy` → `@v4/bot_3` → `@body_f` → `f`. A chain that reaches no such
 *   picture — Plan 12's `bot_3:happy` → `@bot_3` → `f01_candidate_1.png` — ends on `BOT_TRANSFORM_FROM`, body f, whose
 *   transform is f01's verbatim.
 * - A **body** drawn from another body's picture takes that body's (`@body_f` → `f`). One drawn from F01's picture —
 *   both of them — gets null: the pipeline places it on its own stored transform, or else on body f's (`bodyTransform`
 *   in extract.mjs). `--anchor head` then moves it by the eyes, starting from there.
 * - Anything else — an item, a body's face, a hairstyle — is cut on its owner's own transform, which the pipeline
 *   reads itself: null. (Until D1 a flat base drawn from another took that base's transform here.)
 */
export function transformSource(asset, registry) {
  if (asset.kind === 'bot') {
    const seen = new Set()
    let at = asset
    while (at?.reference && !seen.has(at.id)) {
      seen.add(at.id)
      const owner = referenceOwner(at.reference, registry)
      if (owner !== null) return owner
      if (!at.reference.startsWith('@')) return BOT_TRANSFORM_FROM
      at = findAsset(registry, at.reference.slice(1))
    }
    return BOT_TRANSFORM_FROM
  }
  if (asset.kind === 'body') return referenceOwner(asset.reference, registry)
  return null
}
