/**
 * Names and the manifest: what the stage-1 set *is*, what each file is called, and the one JSON file
 * that says so.
 *
 * The naming rules are D01 §9.1 with the changes the avatar plans made to them. Since Plan 19 (v4) a figure is a
 * body per gender (`body_f_L30`), its six faces (`body_f_face_happy_L50`) and a hairstyle of two layers
 * (`item_hair_f_bob01_L20` / `_L60`). Items are worn by both bodies, so they carry no body in their name — only a
 * per-wear cut does (`item_outfit_dealer01_m_L40`). The six flat bases of Plans 11–12 (`base_f01_L30` …) were retired
 * by the switch-over (Plan 19 D1): no name of theirs is legal any more.
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
import { CROP, DENSITIES, FRAME, LAYERS, placeholderMaskSvg, placeholderSvg } from './frame.mjs'
import { alphaBBox, applyIconFit, blankPicture, iconFit, iconPicture, readPicture, renderSvg, writeDensities, writeIfChanged } from './png.mjs'
import { meanLightness } from '../../../../packages/ui-kit/src/avatar2d/recolour.mjs'

export const MANIFEST_NAME = 'avatar-manifest.json'
export const MANIFEST_VERSION = 1

export const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url))
/** Where the layers live, and what the app serves them from (`assetBase` = `/avatar/`). */
export const PUBLIC_DIR = resolve(PACKAGE_ROOT, 'public/avatar')
export const SERVER_MANIFEST = resolve(PACKAGE_ROOT, '../normal-server/data/avatar-manifest.json')
export const SHEET_FILE = resolve(PACKAGE_ROOT, '../../docs/avatar-2d-sheet.png')
/** Plan 19 spec §5.6: the fit sheet — every hat and every face item on each of the eight hairstyles. */
export const FIT_SHEET_FILE = resolve(PACKAGE_ROOT, '../../docs/avatar-2d-fit-sheet.png')
/** Plan 13 spec §4.2: the tint review sheet — each gender's three hair × three eye colours, every tintable item. */
export const TINT_SHEET_FILE = resolve(PACKAGE_ROOT, '../../docs/avatar-2d-tint-sheet.png')
/** The catalogue `tint-sheet` reads its tintable items from (spec §4.2's "mọi món `tintable`"). */
export const ITEMS_FILE = resolve(PACKAGE_ROOT, '../normal-server/data/items.json')

// ──────────────────────────────────────────────────────── the stage-1 set ──

/**
 * v4 (Plan 19, spec §4.1–§4.3): gender, hairstyle and skin are chosen separately. A body is drawn once per
 * gender — bald, cream-skinned, in the relaxed pose with fingers — and a hairstyle is an item of its own, cut
 * into a back layer (L20) and a front layer (L60). The six flat bases this replaced (f01…m03, one picture each
 * with the hair baked in) are retired (D1).
 */
export const GENDERS = ['f', 'm']

/**
 * The two bodies an item layer can be cut for (2026-09-20, phase 2 variants): one per gender since Plan 19.
 *
 * One inventory item may ship one layer per wear — a skirted dealer's uniform and a trousered one are the same
 * owned item, drawn differently. See `itemFile` for the names and `docs/avatar-2d.md` §3.1 for the rule.
 */
export const WEARS = ['f', 'm']

/**
 * The wear of an owner id: a v4 body (Plan 19, pre-flight #28) is owned by its gender, and a gender is its own wear —
 * `wearOf('m')` is `'m'`, so `--variant m` is cut with `--base m`. `null` for anything else, an old base's id included.
 */
export const wearOf = (id) => (GENDERS.includes(id) ? id : null)

/** Spec §4.3: six faces per body, and — a decision of Plan 11 — six per bot as well. */
export const EXPRESSIONS = ['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep']
/** Spec §7: eight bots, chibi robots on the same proportions. */
export const BOTS = [0, 1, 2, 3, 4, 5, 6, 7]

/** Spec §4.2's eight hairstyles, four per gender, in the table's order. The code starts with its gender. */
export const HAIR_CODES = ['f_bob01', 'f_hime01', 'f_wavy01', 'f_ponytail01', 'm_tousled01', 'm_neat01', 'm_curly01', 'm_spiky01']
/** The two layers a hairstyle is cut into: behind the body, and over the face. */
export const HAIR_LAYERS = [LAYERS.hairBack, LAYERS.hairFront]

/** The layer each wearable slot occupies. A file whose name and slot disagree fails C8. */
export const SLOT_LAYER = {
  aura: LAYERS.aura,
  outfit: LAYERS.outfit,
  face: LAYERS.faceAcc,
  head: LAYERS.head,
  frame: LAYERS.frame,
}

/**
 * Spec §4.4, verbatim, in the order the design lists them — then BP-33's wardrobe batch (spec 2026-10-24 §3.1–§3.2:
 * six hats, four face items, eight outfits), in its tables' order — then BP-35's (spec 2026-10-25 §3.1–§3.2: nine
 * head items, three face items, eight outfits for Halloween, winter and the beach), in its tables' order too.
 */
export const STAGE_ONE_ITEMS = {
  head: [
    'tophat01', 'dealer_visor01', 'beret_red01', 'crown_gold01', 'conical_hat01', 'beanie01', 'party_cone01', 'hood_black01',
    'cap_navy01', 'bucket_khaki01', 'headband_red01', 'cat_ears01', 'lotus_pin01', 'fedora01',
    'witch_hat01', 'pumpkin01', 'devil_horns01', 'santa_hat01', 'earmuffs01', 'reindeer01', 'straw_hat01', 'flower_crown01', 'crab01',
  ],
  face: [
    'glasses_round_gold01', 'sunglasses01', 'masquerade01', 'eyepatch01', 'glasses_square01', 'bandaid01', 'aviators01', 'monocle_gold01',
    'bat_mask01', 'red_nose01', 'heart_glasses01',
  ],
  outfit: [
    'casual01', 'dealer01', 'tuxedo01', 'royal_robe01', 'tet_red01', 'champion01',
    'hoodie_navy01', 'tracksuit_red01', 'ao_ba_ba01', 'denim01', 'bomber_neon01', 'ao_dai_jade01', 'trench01', 'brocade_red01',
    'skeleton01', 'witch01', 'vampire01', 'sweater_xmas01', 'puffer01', 'santa01', 'hawaii01', 'sailor01',
  ],
  aura: ['water01', 'fire01', 'wind01', 'earth01', 'lightning01', 'sakura01', 'gold_cards01', 'ice01'],
  frame: ['bronze', 'silver', 'gold', 'monthly', 'veteran', 'founder'],
}

/** D01 §4.3: the only hide rules stage 1 has. A hood covers both halves of the hair. */
export const HIDES = { hood_black01: { hidesHairFront: true, hidesHairBack: true } }

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

/** A v4 body (Plan 19): `body_f_L30`. */
export const bodyFile = (gender) => `body_${gender}_L${LAYERS.body}`
/** One of a v4 body's six faces: `body_m_face_happy_L50`. */
export const bodyFaceFile = (gender, expression) => `body_${gender}_face_${expression}_L${LAYERS.face}`
/**
 * One of a hairstyle's two layers: `item_hair_f_bob01_L20` / `_L60`. A hair code starts with its one-letter
 * gender, which `CODE` below forbids, so hair layers have a name pattern of their own and never take a
 * per-wear variant (ruling 4).
 */
export const hairFile = (code, layer) => `item_hair_${code}_L${layer}`
/** The gender a hair code belongs to: `m_spiky01` → `m`. Throws for a code that names none. */
export function hairGender(code) {
  const gender = String(code).split('_')[0]
  if (!GENDERS.includes(gender)) throw new Error(`hair code ${code} does not start with a gender — one of ${GENDERS.join(', ')}`)
  return gender
}
/** The catalogue id of a hairstyle: `m_spiky01` → `hair_m_spiky01`. */
export const hairItemId = (code) => `hair_${code}`

/**
 * Every file stage 1 needs, in a stable order.
 *
 * This list is the contract: `placeholder` writes exactly it, `check` walks exactly it, and the tests
 * assert it against spec §4.4 so that a name added here without being added there is caught.
 *
 * The items and the bots, then the v4 set (Plan 19, spec §5.3): per gender a body and its six faces, then per
 * hairstyle its back and front layer — 30 names, which hold no icon (a hairstyle's wardrobe card is a portrait,
 * ruling 12). 118 names in all since the switch-over (D1) took the six flat bases' 54 off the front of the list, and
 * 136 since BP-33's eighteen wardrobe items, and 156 since BP-35's twenty.
 */
export function stageOneFiles() {
  const files = []
  for (const [slot, codes] of Object.entries(STAGE_ONE_ITEMS)) {
    const layer = SLOT_LAYER[slot]
    for (const code of codes) files.push({ name: itemFile(slot, code, layer), kind: 'item', layer, slot, code, ...HIDES[code] })
  }
  for (const bot of BOTS) {
    files.push({ name: botFile(bot), kind: 'bot', layer: LAYERS.body, bot })
    for (const expr of EXPRESSIONS) files.push({ name: botFaceFile(bot, expr), kind: 'botFace', layer: LAYERS.face, bot, expr })
  }
  for (const gender of GENDERS) {
    files.push({ name: bodyFile(gender), kind: 'body', layer: LAYERS.body, gender })
    for (const expr of EXPRESSIONS) files.push({ name: bodyFaceFile(gender, expr), kind: 'bodyFace', layer: LAYERS.face, gender, expr })
  }
  for (const code of HAIR_CODES) {
    for (const layer of HAIR_LAYERS) files.push({ name: hairFile(code, layer), kind: 'hair', layer, gender: hairGender(code), code })
  }
  return files
}

const EXPR_GROUP = EXPRESSIONS.join('|')
const WEAR_GROUP = WEARS.join('|')
const GENDER_GROUP = GENDERS.join('|')
/**
 * An item's code: lower case, digits and underscores, every segment **at least two characters**.
 *
 * The length is what makes a variant readable (2026-09-20). `item_outfit_dealer01_m_L40` has to be
 * `dealer01` worn `m` rather than the code `dealer01_m`, and a greedy code would take either reading;
 * with no one-letter segment in a code, the segment before `_L<n>` is the wear whenever it is one.
 */
const CODE = '[a-z0-9]{2,}(?:_[a-z0-9]{2,})*'
const ITEM_ALTERNATIVES = Object.entries(SLOT_LAYER).map(([slot, layer]) => `item_${slot}_${CODE}(?:_(?:${WEAR_GROUP}))?_L${layer}`)
/**
 * D01 §9.1: lower case, digits and underscores, and a layer number that matches the slot — plus, since Plan 19,
 * the v4 names (ruling 4): `body_<g>_L30`, `body_<g>_face_<expr>_L50` and `item_hair_<g>_<CODE>_L20|L60`. A hair
 * code is its gender and then a `CODE`, so `item_hair_f_bob01_m_L60` stays illegal: no variant, ever. The flat
 * bases' `base_<id>_L20|30|60` and `base_<id>_face_<expr>_L50` were legal until the switch-over (D1) retired them.
 */
export const NAME_PATTERN = new RegExp(
  `^(?:${ITEM_ALTERNATIVES.join('|')}` +
  `|bot_[0-9]+_L${LAYERS.body}` +
  `|bot_[0-9]+_face_(?:${EXPR_GROUP})_L${LAYERS.face}` +
  `|body_(?:${GENDER_GROUP})_L${LAYERS.body}` +
  `|body_(?:${GENDER_GROUP})_face_(?:${EXPR_GROUP})_L${LAYERS.face}` +
  `|item_hair_(?:${GENDER_GROUP})_${CODE}_L(?:${HAIR_LAYERS.join('|')}))$`,
)

/** What a legal file name says about itself, or `null` when the name is not legal at all. */
export function parseName(name) {
  if (!NAME_PATTERN.test(name)) return null
  const layer = Number(name.slice(name.lastIndexOf('_L') + 2))
  const stem = name.slice(0, name.lastIndexOf('_L'))
  // The v4 names first (Plan 19): `item_hair_` is not a wardrobe slot.
  if (stem.startsWith('item_hair_')) {
    const code = stem.slice('item_hair_'.length)
    return { kind: 'hair', layer, gender: hairGender(code), code }
  }
  if (stem.startsWith('body_')) {
    const [, gender, face, expr] = stem.split('_')
    return face === 'face' ? { kind: 'bodyFace', layer, gender, expr } : { kind: 'body', layer, gender }
  }
  if (stem.startsWith('item_')) {
    const slot = Object.keys(SLOT_LAYER).find((candidate) => stem.startsWith(`item_${candidate}_`))
    const rest = stem.slice(`item_${slot}_`.length)
    // The last segment is the wear exactly when it is one letter: a code's segments are all longer.
    const cut = rest.lastIndexOf('_')
    const tail = cut < 0 ? '' : rest.slice(cut + 1)
    if (WEARS.includes(tail)) return { kind: 'item', layer, slot, code: rest.slice(0, cut), wear: tail }
    return { kind: 'item', layer, slot, code: rest }
  }
  // What is left is a bot: `bot_<n>_L30` or `bot_<n>_face_<expr>_L50`.
  const [, bot, face, expr] = stem.split('_')
  return face === 'face' ? { kind: 'botFace', layer, bot: Number(bot), expr } : { kind: 'bot', layer, bot: Number(bot) }
}

// ──────────────────────────────────────────────────────────────── the file ──

/**
 * `bodies` (Plan 19) holds each v4 body's stored transform, `{ [gender]: { transform, anchor? } }`, once one is
 * ingested — what every face, hairstyle, item and bot cut on that body is placed with. (The flat bases kept theirs
 * under `bases` until the switch-over, D1.)
 */
export function emptyManifest() {
  return { version: MANIFEST_VERSION, frame: FRAME, crop: CROP, files: {}, icons: {}, bodies: {} }
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

/** The slots whose icon is cut from the ingested square picture rather than from the layer (`ingestSquare`, §4.3). */
const ICON_FROM_PICTURE = new Set(['aura', 'frame'])

/**
 * An icon's tint mask (2026-10-01, Plan 18 No8a): `<icon>_tintmask@1x/@2x.png`, the layer's own tint mask (`mask2x`,
 * the one written beside the layer — a hand-drawn override included) cut with the *layer's* ink box and fitted
 * exactly as `writeIcon` fits the layer, so it lands on the icon's own pixels. The wardrobe tints a colour
 * variant's icon with it the way `Chibi` tints the worn layer.
 *
 * Only for an icon the manifest already lists, which it flags `tintMask: true` — a field on the icon's entry, not a
 * key of its own. Not for an aura or a frame, whose icon is the source picture rather than the layer. Returns the
 * mask's name, or `null` when nothing was written.
 */
export async function writeIconTintMask(mask2x, layer2x, dir, layerName, manifest) {
  if (ICON_FROM_PICTURE.has(parseName(layerName)?.slot)) return null
  const name = iconName(layerName)
  const entry = manifest.icons?.[name]
  if (!entry) return null
  const fit = iconFit(alphaBBox(layer2x), ICON.w * 2, ICON.fill)
  const picture = fit === null ? blankPicture(ICON.w * 2, ICON.h * 2) : await applyIconFit(mask2x, fit)
  await writeDensities(picture, dir, `${name}_tintmask`)
  entry.tintMask = true
  return `${name}_tintmask`
}

/**
 * A real item's icon cut again from its layer on disk — `placeholder`'s path for an icon that has gone missing — with
 * the icon's tint mask re-cut alongside when the layer has a tint mask there (Plan 18, No8a), so the flag and the
 * file never fall out of step with the icon.
 */
async function rewriteRealIcon(dir, layerName, entry, manifest) {
  const layer2x = await readPicture(join(dir, `${layerName}@2x.png`))
  await writeIcon(layer2x, dir, layerName, manifest, { real: true })
  const tintMask = join(dir, `${layerName}_tintmask@2x.png`)
  if (entry?.masks?.tint && existsSync(tintMask)) await writeIconTintMask(await readPicture(tintMask), layer2x, dir, layerName, manifest)
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
  const bodies = {}
  for (const gender of Object.keys(manifest.bodies ?? {}).sort()) bodies[gender] = manifest.bodies[gender]
  // Only these keys are written: a manifest read with the retired `bases` (Plan 19 D1) loses it here.
  const ordered = {
    version: manifest.version,
    frame: manifest.frame,
    crop: manifest.crop,
    files,
    ...(Object.keys(icons).length ? { icons } : {}),
    ...(Object.keys(bodies).length ? { bodies } : {}),
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

/**
 * One entry with its hide rules set (Plan 19, `hides`): `front`/`back` true or false, `null` to leave that one as it
 * is. A rule that is off is absent, never `false`, and one that is on sits where `entryFor` puts it, after
 * `bytes2x` — so turning a flag off and on again gives back the very same bytes.
 */
export function withHides(entry, { front = null, back = null }) {
  const { layer, w, h, bytes2x, hidesHairFront, hidesHairBack, ...rest } = entry
  const hideFront = front ?? hidesHairFront === true
  const hideBack = back ?? hidesHairBack === true
  return {
    layer,
    w,
    h,
    bytes2x,
    ...(hideFront ? { hidesHairFront: true } : {}),
    ...(hideBack ? { hidesHairBack: true } : {}),
    ...rest,
  }
}

/**
 * Every `items.json` id drawn with one layer: its `asset.file`, or one of its `asset.variants`. A hat's colour
 * variants share the hat's layer (pre-flight #15), and the server refuses an item whose hide flags disagree with
 * the manifest's (bug 7), so `hides` names them all.
 */
export function itemsOnLayer(items, layer) {
  return (items ?? [])
    .filter((item) => item?.asset?.file === layer || Object.values(item?.asset?.variants ?? {}).includes(layer))
    .map((item) => item.id)
}

// ─────────────────────────────────────────────────────────── the stand-ins ──

/**
 * The masks a v4 stand-in carries (Plan 19), by manifest key: skin on a body, skin and eyes on a face, hair on
 * each hair layer. They are **rendered** from the stand-in's own shapes (`placeholderMaskSvg`), never computed
 * (pre-flight #8): a stand-in is flat colour by construction, so its masks are exactly what was drawn.
 */
const STAND_IN_MASKS = { body: ['skin'], bodyFace: ['skin', 'eyes'], hair: ['hair'] }

/** How many pixels of a mask are at least half covered — the count every split and C11 area is made of. */
const SOLID_COVER = 128

/**
 * Render one stand-in mask, write it at both densities exactly as `writeMasks` writes a real one (white, coverage
 * in alpha, @1x the @2x halved), and return its @2x alpha with the manifest's `{ bytes2x, meanL, empty? }` —
 * `meanL` the stand-in layer's own mean lightness under the mask, as for real art.
 */
async function writeStandInMask(file, kind, fileKind, layer2x, dir) {
  const { width, height } = layer2x
  // The mask SVG is opaque, white where the region is and black elsewhere, so red is the coverage.
  const rendered = await renderSvg(placeholderMaskSvg(file, kind), width, height)
  const alpha = new Uint8Array(width * height)
  const picture = { data: Buffer.alloc(width * height * 4, 255), width, height }
  let inked = 0
  for (let p = 0; p < alpha.length; p++) {
    alpha[p] = rendered.data[p * 4]
    picture.data[p * 4 + 3] = alpha[p]
    if (alpha[p] > 0) inked++
  }
  const bytes2x = await writeDensities(picture, dir, `${file.name}_${fileKind}mask`)
  const meanL = Math.round(meanLightness(layer2x.data, alpha) * 10000) / 10000
  return { alpha, info: { bytes2x, meanL, ...(inked === 0 ? { empty: true } : {}) } }
}

/**
 * A hair L60's `split` (spec §5.4): the hairstyle's region — every @2x pixel at least half covered by either
 * layer's hair mask — and how many of those the front and the back layer hold. The stand-in layers are drawn
 * apart, so `front + back === region`; C13 (A1c) holds real art to the same numbers.
 */
function splitOf(front, back) {
  let region = 0
  let inFront = 0
  let inBack = 0
  for (let p = 0; p < front.length; p++) {
    const f = front[p] >= SOLID_COVER
    const b = back !== null && back[p] >= SOLID_COVER
    if (f) inFront++
    if (b) inBack++
    if (f || b) region++
  }
  return { region, front: inFront, back: inBack }
}

/** A real hair layer's hair at @2x, for its stand-in sibling's split: its hair mask when it has one, else its ink. */
async function hairOnDisk(dir, name, entry, fileKind) {
  const maskFile = join(dir, `${name}_${fileKind}mask@2x.png`)
  const file = entry?.masks?.hair && existsSync(maskFile) ? maskFile : join(dir, `${name}@2x.png`)
  if (!existsSync(file)) return null
  const pic = await readPicture(file)
  const alpha = new Uint8Array(pic.width * pic.height)
  for (let p = 0; p < alpha.length; p++) alpha[p] = pic.data[p * 4 + 3]
  return alpha
}

/**
 * Fill a directory with the whole stage-1 set as labelled stand-ins, and write the manifest for it.
 *
 * Idempotent twice over. A name the manifest already marks `real: true` is left alone — ingesting art is
 * the one-way door from stand-in to art, and re-running this must never undo it — and every write goes
 * through a compare-first path, so a second run leaves a clean tree.
 *
 * 2026-09-20: **per-wear variants are carried, never drawn.** A variant (`item_outfit_dealer01_m_L40`)
 * is not part of the stage-1 list — it exists only once somebody has generated a male picture of that
 * outfit — so this never invents a stand-in for one, and the entries and icons of the real ones it finds
 * in the previous manifest are copied through untouched rather than dropped for not being on the list.
 *
 * Plan 19: a v4 stand-in (body, body face, hair layer) is drawn with its masks (`STAND_IN_MASKS`), and a hair
 * L60 with its `split`. The manifest's `bodies` — the stored transforms — is carried through as it is.
 *
 * Plan 19 D1: what is not on the list is not carried — neither a name the previous manifest still lists (the retired
 * `base_*` layers) nor its retired `bases` key — except a real per-wear variant, below. This never deletes a file: the
 * PNGs of a dropped name stay on disk until somebody does, and the committed-set test fails while they are there.
 */
export async function buildPlaceholders({ dir, targets, log = () => {} }) {
  await mkdir(dir, { recursive: true })
  // Imported here rather than at the top: `masks.mjs` imports this module and reads it while loading
  // (`MASK_OVERRIDE_DIR`), so a static import back would make the load order decide which of the two works.
  const { MASK_FILE_KIND } = await import('./masks.mjs')
  const previous = readManifest(join(dir, MANIFEST_NAME))
  const manifest = { ...emptyManifest(), bodies: previous.bodies ?? {} }
  let drawn = 0
  let kept = 0
  let masked = 0
  /** Each hair L20's stand-in hair mask at @2x, for its L60's split — the list puts L20 first. */
  const backHair = new Map()
  for (const file of stageOneFiles()) {
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
        else await rewriteRealIcon(dir, file.name, before, manifest)
      }
      continue
    }
    const picture = await renderSvg(placeholderSvg(file, 2), FRAME.w * 2, FRAME.h * 2)
    const bytes2x = await writeDensities(picture, dir, file.name)
    const extra = { placeholder: true }
    for (const kind of STAND_IN_MASKS[file.kind] ?? []) {
      const { alpha, info } = await writeStandInMask(file, kind, MASK_FILE_KIND[kind], picture, dir)
      extra.masks = { ...extra.masks, [kind]: info }
      masked++
      if (file.kind !== 'hair') continue
      if (file.layer === LAYERS.hairBack) {
        backHair.set(file.code, alpha)
      } else {
        const back = hairFile(file.code, LAYERS.hairBack)
        const backAlpha = backHair.get(file.code) ?? await hairOnDisk(dir, back, previous.files?.[back], MASK_FILE_KIND.hair)
        extra.split = splitOf(alpha, backAlpha)
      }
    }
    manifest.files[file.name] = entryFor(file, bytes2x, extra)
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
    else if (existsSync(join(dir, `${name}@2x.png`))) await rewriteRealIcon(dir, name, before, manifest)
    variants++
  }
  await writeManifest(manifest, targets)
  log(`${drawn} stand-ins drawn at ${DENSITIES.map((density) => `@${density}x`).join(' and ')} with ${masked} masks, ${kept} real layers and ${variants} variants left alone`)
  return manifest
}
