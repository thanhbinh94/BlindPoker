/**
 * Names and the manifest: what the stage-1 set *is*, what each file is called, and the one JSON file
 * that says so.
 *
 * The naming rules are D01 §9.1 with the change spec §3 makes to them — a base carries its own code, so
 * `base_f01_L30@2x.png` rather than the document's `base_body_default_L30@2x.png`, because there are two
 * bases now and there will be six. Items are generated on F01 and worn by both (spec D2), so they carry
 * no base in their name at all.
 *
 * The manifest is written **twice**, byte for byte: `public/avatar/avatar-manifest.json` for the web
 * build and `apps/normal-server/data/avatar-manifest.json` for the catalogue's validation. Two copies is
 * a deliberate duplication — the server cannot reach into the web app's `public/` at run time, and a
 * catalogue that cannot check its own asset names is a catalogue that ships a 404. `writeManifest`
 * takes the list of destinations so nothing can update one and forget the other.
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CROP, DENSITIES, FRAME, LAYERS, placeholderSvg } from './frame.mjs'
import { iconPicture, readPicture, renderSvg, writeDensities, writeIfChanged } from './png.mjs'

export const MANIFEST_NAME = 'avatar-manifest.json'
export const MANIFEST_VERSION = 1

export const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url))
/** Where the layers live, and what the app serves them from (`assetBase` = `/avatar/`). */
export const PUBLIC_DIR = resolve(PACKAGE_ROOT, 'public/avatar')
export const SERVER_MANIFEST = resolve(PACKAGE_ROOT, '../normal-server/data/avatar-manifest.json')
export const SHEET_FILE = resolve(PACKAGE_ROOT, '../../docs/avatar-2d-sheet.png')

// ──────────────────────────────────────────────────────── the stage-1 set ──

/**
 * Every base the app has art for — the **source of truth** for the base list (2026-09-17, phase 2).
 *
 * A base cannot exist before its layers do: the server's registry (`apps/normal-server/data/avatar-bases.json`)
 * names files and refuses at boot any name the committed manifest does not list, so the order of operations
 * for adding a base is always *this list first* (which gives `placeholder` a full stand-in set to draw and
 * `ingest` a place to put the real pictures), then the registry entry that points at them, then the i18n key.
 * `stageOneFiles` and `buildPlaceholders` take the list as an argument so a test can add a third base
 * without touching the committed artefact; nothing else should pass anything but this.
 *
 * Spec §4: two bases now, six in stage 2. `f02`/`f03` have i18n names waiting for them and no art yet.
 */
export const BASES = ['f01', 'm01']

/**
 * The two bodies an item layer can be cut for (2026-09-20, phase 2 variants).
 *
 * Every base wears its clothes on one of them, and one inventory item may ship one layer per wear —
 * a skirted dealer's uniform and a trousered one are the same owned item, drawn differently. See
 * `itemFile` for the names and `docs/avatar-2d.md` §3.1 for the rule.
 */
export const WEARS = ['f', 'm']

/**
 * Which body each base wears clothes on — the art side's half of `avatar-bases.json`'s `"wear"`.
 *
 * `BASES` and this map are one table written twice, so the module refuses to load with a base that
 * has no wear: a base drawn without one would silently get every default layer and never a variant.
 * The server's registry mirrors both (`docs/avatar-2d.md` §9.1); the pipeline's own test holds the
 * two files against each other.
 */
/** @type {Record<string, string>} */
export const BASE_WEAR = { f01: 'f', m01: 'm' }

for (const base of BASES) {
  if (!WEARS.includes(BASE_WEAR[base])) throw new Error(`base ${base} has no wear in BASE_WEAR — one of ${WEARS.join(', ')}`)
}

/** The wear of a base id, or `null` for an id `BASE_WEAR` does not name. */
export const wearOf = (baseId) => BASE_WEAR[baseId] ?? null

/** Spec §4.3: six per base, and — a decision of this plan — six per bot as well. */
export const EXPRESSIONS = ['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep']
/** The three layers a base is cut into. Its face is layer 50 and comes one per expression. */
export const BASE_LAYERS = [LAYERS.hairBack, LAYERS.body, LAYERS.hairFront]
/** Spec §7: eight bots, chibi robots on the same proportions. */
export const BOTS = [0, 1, 2, 3, 4, 5, 6, 7]

/** The layer each wearable slot occupies. A file whose name and slot disagree fails C8. */
export const SLOT_LAYER = {
  aura: LAYERS.aura,
  outfit: LAYERS.outfit,
  face: LAYERS.faceAcc,
  head: LAYERS.head,
  frame: LAYERS.frame,
}

/** Spec §4.4, verbatim, in the order the design lists them. */
export const STAGE_ONE_ITEMS = {
  head: ['tophat01', 'dealer_visor01', 'beret_red01', 'crown_gold01', 'conical_hat01', 'beanie01', 'party_cone01', 'hood_black01'],
  face: ['glasses_round_gold01', 'sunglasses01', 'masquerade01', 'eyepatch01'],
  outfit: ['casual01', 'dealer01', 'tuxedo01', 'royal_robe01', 'tet_red01', 'champion01'],
  aura: ['water01', 'fire01', 'wind01', 'earth01', 'lightning01', 'sakura01', 'gold_cards01', 'ice01'],
  frame: ['bronze', 'silver', 'gold', 'monthly', 'veteran', 'founder'],
}

/** D01 §4.3: the only hide rules stage 1 has. A hood covers both halves of the hair. */
export const HIDES = { hood_black01: { hidesHairFront: true, hidesHairBack: true } }

export const baseFile = (baseId, layer) => `base_${baseId}_L${layer}`
export const faceFile = (baseId, expression) => `base_${baseId}_face_${expression}_L${LAYERS.face}`
/**
 * A wardrobe layer's name, `item_<slot>_<code>_L<layer>` — plus the wear of a *variant*, between the
 * code and the layer: `item_outfit_dealer01_m_L40` (2026-09-20).
 *
 * The slot is a parameter rather than a rule: only `outfit` has a gendered piece today, and nothing
 * here decides which slot is allowed one. The wear is the one place a single-character segment is
 * legal (`CODE` below), which is what keeps `dealer01_m` unambiguous.
 */
/** @type {(slot: string, code: string, layer: number, wear?: string | null) => string} */
export const itemFile = (slot, code, layer, wear = null) => `item_${slot}_${code}${wear === null ? '' : `_${wear}`}_L${layer}`
/** The variant of an item layer for one wear: `item_outfit_dealer01_L40` + `m` → `item_outfit_dealer01_m_L40`. */
export function variantFile(layerName, wear) {
  const parsed = parseName(layerName)
  if (parsed?.kind !== 'item') throw new Error(`${layerName} is not an item layer, so it has no variants`)
  if (parsed.wear) throw new Error(`${layerName} is already the ${parsed.wear} variant`)
  return itemFile(parsed.slot, parsed.code, parsed.layer, wear)
}
export const botFile = (bot) => `bot_${bot}_L${LAYERS.body}`
export const botFaceFile = (bot, expression) => `bot_${bot}_face_${expression}_L${LAYERS.face}`

/**
 * Every file stage 1 needs, in a stable order.
 *
 * This list is the contract: `placeholder` writes exactly it, `check` walks exactly it, and the tests
 * assert it against spec §4.4 so that a name added here without being added there is caught.
 */
export function stageOneFiles(bases = BASES) {
  const files = []
  for (const base of bases) {
    for (const layer of BASE_LAYERS) files.push({ name: baseFile(base, layer), kind: 'base', layer, base })
    for (const expr of EXPRESSIONS) files.push({ name: faceFile(base, expr), kind: 'baseFace', layer: LAYERS.face, base, expr })
  }
  for (const [slot, codes] of Object.entries(STAGE_ONE_ITEMS)) {
    const layer = SLOT_LAYER[slot]
    for (const code of codes) files.push({ name: itemFile(slot, code, layer), kind: 'item', layer, slot, code, ...HIDES[code] })
  }
  for (const bot of BOTS) {
    files.push({ name: botFile(bot), kind: 'bot', layer: LAYERS.body, bot })
    for (const expr of EXPRESSIONS) files.push({ name: botFaceFile(bot, expr), kind: 'botFace', layer: LAYERS.face, bot, expr })
  }
  return files
}

const EXPR_GROUP = EXPRESSIONS.join('|')
const WEAR_GROUP = WEARS.join('|')
/**
 * An item's code: lower case, digits and underscores, every segment **at least two characters**.
 *
 * The length is what makes a variant readable (2026-09-20). `item_outfit_dealer01_m_L40` has to be
 * `dealer01` worn `m` rather than the code `dealer01_m`, and a greedy code would take either reading;
 * with no one-letter segment in a code, the segment before `_L<n>` is the wear whenever it is one.
 */
const CODE = '[a-z0-9]{2,}(?:_[a-z0-9]{2,})*'
const ITEM_ALTERNATIVES = Object.entries(SLOT_LAYER).map(([slot, layer]) => `item_${slot}_${CODE}(?:_(?:${WEAR_GROUP}))?_L${layer}`)
/** D01 §9.1: lower case, digits and underscores, and a layer number that matches the slot. */
export const NAME_PATTERN = new RegExp(
  `^(?:base_[a-z][a-z0-9]*_L(?:${BASE_LAYERS.join('|')})` +
  `|base_[a-z][a-z0-9]*_face_(?:${EXPR_GROUP})_L${LAYERS.face}` +
  `|${ITEM_ALTERNATIVES.join('|')}` +
  `|bot_[0-9]+_L${LAYERS.body}` +
  `|bot_[0-9]+_face_(?:${EXPR_GROUP})_L${LAYERS.face})$`,
)

/** What a legal file name says about itself, or `null` when the name is not legal at all. */
export function parseName(name) {
  if (!NAME_PATTERN.test(name)) return null
  const layer = Number(name.slice(name.lastIndexOf('_L') + 2))
  const stem = name.slice(0, name.lastIndexOf('_L'))
  if (stem.startsWith('item_')) {
    const slot = Object.keys(SLOT_LAYER).find((candidate) => stem.startsWith(`item_${candidate}_`))
    const rest = stem.slice(`item_${slot}_`.length)
    // The last segment is the wear exactly when it is one letter: a code's segments are all longer.
    const cut = rest.lastIndexOf('_')
    const tail = cut < 0 ? '' : rest.slice(cut + 1)
    if (WEARS.includes(tail)) return { kind: 'item', layer, slot, code: rest.slice(0, cut), wear: tail }
    return { kind: 'item', layer, slot, code: rest }
  }
  const [prefix, owner, ...rest] = stem.split('_')
  if (rest[0] === 'face') {
    const kind = prefix === 'bot' ? 'botFace' : 'baseFace'
    return { kind, layer, expr: rest[1], ...(prefix === 'bot' ? { bot: Number(owner) } : { base: owner }) }
  }
  return prefix === 'bot' ? { kind: 'bot', layer, bot: Number(owner) } : { kind: 'base', layer, base: owner }
}

// ──────────────────────────────────────────────────────────────── the file ──

export function emptyManifest() {
  return { version: MANIFEST_VERSION, frame: FRAME, crop: CROP, files: {}, icons: {}, bases: {} }
}

// ───────────────────────────────────────────────────────────────── the icons ──

/**
 * An item's inventory icon (2026-09-17): the item layer on its own, cut to its ink, fitted into `FILL` of a
 * square and centred. Named after the layer without its `_L<n>` — `item_head_tophat01_icon` — so the client
 * derives it from `asset.file` and the API does not change. The manifest lists icons under their own
 * `icons` key rather than `files`: `files` is the set of frame-sized layers that `check`, the renderer and
 * the server's loader all read, and an icon is none of those.
 */
export const ICON = { w: 96, h: 96, fill: 0.84 }

export const iconName = (layerName) => `${layerName.replace(/_L\d+$/, '')}_icon`

/** Write both densities of one item's icon from its @2x layer, and record it in `manifest.icons`. */
export async function writeIcon(layer2x, dir, layerName, manifest, flags) {
  const name = iconName(layerName)
  const picture = await iconPicture(layer2x, ICON.w * 2, ICON.fill)
  const bytes2x = await writeDensities(picture, dir, name)
  manifest.icons ??= {}
  manifest.icons[name] = { kind: 'icon', of: layerName, w: ICON.w, h: ICON.h, bytes2x, ...flags }
  return name
}

export function readManifest(file) {
  if (!existsSync(file)) return emptyManifest()
  return JSON.parse(readFileSync(file, 'utf8'))
}

/**
 * One byte sequence, written to every destination.
 *
 * `files` is re-keyed in sorted order rather than in insertion order, so the diff of a re-run shows only
 * what actually changed — the artefact is committed, and a manifest that reshuffles itself makes every
 * regeneration look like a rewrite.
 */
export function serialiseManifest(manifest) {
  const files = {}
  for (const name of Object.keys(manifest.files).sort()) files[name] = manifest.files[name]
  const icons = {}
  for (const name of Object.keys(manifest.icons ?? {}).sort()) icons[name] = manifest.icons[name]
  const bases = {}
  for (const base of Object.keys(manifest.bases ?? {}).sort()) bases[base] = manifest.bases[base]
  const ordered = {
    version: manifest.version,
    frame: manifest.frame,
    crop: manifest.crop,
    files,
    ...(Object.keys(icons).length ? { icons } : {}),
    ...(Object.keys(bases).length ? { bases } : {}),
  }
  return Buffer.from(`${JSON.stringify(ordered, null, 2)}\n`)
}

export async function writeManifest(manifest, targets) {
  const bytes = serialiseManifest(manifest)
  const written = []
  for (const target of targets) {
    await mkdir(dirname(target), { recursive: true })
    if (await writeIfChanged(target, bytes)) written.push(target)
  }
  return written
}

/** The entry the manifest holds for one layer file. */
export function entryFor(file, bytes2x, extra = {}) {
  return {
    layer: file.layer,
    w: FRAME.w,
    h: FRAME.h,
    bytes2x,
    ...(file.hidesHairFront ? { hidesHairFront: true } : {}),
    ...(file.hidesHairBack ? { hidesHairBack: true } : {}),
    ...extra,
  }
}

// ─────────────────────────────────────────────────────────── the stand-ins ──

/**
 * Fill a directory with the whole stage-1 set as labelled stand-ins, and write the manifest for it.
 *
 * `bases` is `BASES` for every real run — adding an id to that constant is all it takes for the next
 * `placeholder` to draw a complete stand-in set (body, hair, six faces) for a base nobody has drawn yet.
 *
 * Idempotent twice over. A name the manifest already marks `real: true` is left alone — ingesting art is
 * the one-way door from stand-in to art, and re-running this must never undo it — and every write goes
 * through a compare-first path, so a second run leaves a clean tree.
 *
 * 2026-09-20: **per-wear variants are carried, never drawn.** A variant (`item_outfit_dealer01_m_L40`)
 * is not part of the stage-1 list — it exists only once somebody has generated a male picture of that
 * outfit — so this never invents a stand-in for one, and the entries and icons of the real ones it finds
 * in the previous manifest are copied through untouched rather than dropped for not being on the list.
 */
export async function buildPlaceholders({ dir, targets, bases = BASES, log = () => {} }) {
  await mkdir(dir, { recursive: true })
  const previous = readManifest(join(dir, MANIFEST_NAME))
  const manifest = { ...emptyManifest(), bases: previous.bases ?? {} }
  let drawn = 0
  let kept = 0
  for (const file of stageOneFiles(bases)) {
    const before = previous.files?.[file.name]
    if (before?.real) {
      manifest.files[file.name] = before
      kept++
      // A real item keeps the icon `ingest` wrote; one ingested before icons existed gets it now, read from
      // the layer on disk, which is left exactly as it is.
      if (file.kind === 'item') {
        const icon = iconName(file.name)
        const had = previous.icons?.[icon]
        if (had && existsSync(join(dir, `${icon}@2x.png`))) manifest.icons[icon] = had
        else await writeIcon(await readPicture(join(dir, `${file.name}@2x.png`)), dir, file.name, manifest, { real: true })
      }
      continue
    }
    const picture = await renderSvg(placeholderSvg(file, 2), FRAME.w * 2, FRAME.h * 2)
    const bytes2x = await writeDensities(picture, dir, file.name)
    manifest.files[file.name] = entryFor(file, bytes2x, { placeholder: true })
    if (file.kind === 'item') await writeIcon(picture, dir, file.name, manifest, { placeholder: true })
    drawn++
  }
  // The variants the previous manifest holds, with their icons: real art for a name the stage-1 list
  // does not carry, which is exactly what must survive a rebuild of the stand-ins around it.
  let variants = 0
  for (const [name, before] of Object.entries(previous.files ?? {})) {
    if (!before.variantOf || manifest.files[name]) continue
    manifest.files[name] = before
    const icon = iconName(name)
    const had = previous.icons?.[icon]
    if (had && existsSync(join(dir, `${icon}@2x.png`))) manifest.icons[icon] = had
    else if (existsSync(join(dir, `${name}@2x.png`))) await writeIcon(await readPicture(join(dir, `${name}@2x.png`)), dir, name, manifest, { real: true })
    variants++
  }
  await writeManifest(manifest, targets)
  log(`${drawn} stand-ins drawn at ${DENSITIES.map((density) => `@${density}x`).join(' and ')}, ${kept} real layers and ${variants} variants left alone`)
  return manifest
}
