/**
 * The ten acceptance criteria of D01 §10, as code.
 *
 * The document's list is written for a person holding a file: "size exactly right", "no white fringe",
 * "the outfit leaves no underwear showing". Each one below is that sentence turned into a number, and
 * the numbers are the interesting part of this file — they are the difference between a criterion that
 * catches bad art and one that only catches files nobody would have shipped anyway.
 *
 *   C1  the frame, exactly, at both densities (D01 §10.1 — one pixel out is a fail)
 *   C2  nothing opaque on the outermost row or column (§10.3) — except an aura, which may run off the frame
 *   C3  the empty part really is empty: no alpha at all more than 3 px outside the solid shape (§10.4)
 *   C4  no white fringe: the soft rim is the shape's colour, not white bled in (§10.5, §8.3)
 *   C5  head and face items fit inside the portrait crop (§10.6, §5)
 *   C6  an outfit covers the base's underwear (§10.7)
 *   C7  the @1x really is the @2x scaled down (§8.2 — "never enlarge from a smaller size")
 *   C8  the file name follows §9.1, with a layer number that matches its slot
 *   C9  the manifest lists it, at that layer and that frame (§10.10)
 *   C10 the @2x is inside the per-file budget, and the manifest says what is on disk
 *
 * Two of them are judgement calls that the document leaves to a person and this file has to pin down.
 * C4 compares the *rim* to the *interior*: white-on-white art is legitimate and would otherwise fail
 * every time, so a near-white rim is only a fault when the inside of the shape is not near-white too.
 * C6 has no coordinates in D01 at all — see `UNDERWEAR_BAND` in `frame.mjs` for how the region is found,
 * and note that `--skip C6` exists for the genuinely awkward outfit, because a gate with no override
 * is a gate people route around by deleting it. Since 2026-09-20 it also has to know *which* bases an
 * outfit layer is worn by, because one item may ship a layer per wear — see `wornBy`.
 *
 * One kind of layer is blank on purpose: an AI base is a flat picture, so its hair layers L20/L60 ship as
 * empty frames and the manifest marks them `empty: true` (2026-09-15). C3 holds such a layer to being
 * fully transparent at both densities, and fails any layer *not* so marked that is fully transparent;
 * C4, C5 and C6, which judge what is drawn, report `-` for it.
 */
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  ALPHA_INK,
  ALPHA_SOLID,
  alphaBBox,
  colourDistance,
  modalColour,
  readPicture,
  resizePicture,
} from './png.mjs'
import { CROP, DENSITIES, FACE_LIMIT_Y, FRAME, LAYERS, SKIN_TOLERANCE, UNDERWEAR_BAND, UNDERWEAR_COVERAGE, UNDERWEAR_TOLERANCE, baseSkinColour, isSkin } from './frame.mjs'
import { MASK_FILE_KIND } from './masks.mjs'
import { NAME_PATTERN, faceFile, itemFile, parseName, wearOf } from './manifest.mjs'

/** C10, and spec §8's 6 MB stage-1 footprint divided by the files that have to fit in it. */
export const MAX_BYTES_2X = 400 * 1024
/** C3: how far outside the ink a stray pixel still counts as inside the shape's own soft edge. */
export const STRAY_MARGIN = 3
/** C5: the same slack, around the portrait crop. */
export const CROP_MARGIN = 4
/** C4: how close to white a mean colour has to be before it is called a fringe. */
export const WHITE_TOLERANCE = 24
/** C7: how alike the two densities have to be. */
export const DENSITY_CORRELATION = 0.97
export const DENSITY_ALPHA_DRIFT = 12

const ok = (detail) => ({ ok: true, detail })
const bad = (detail) => ({ ok: false, detail })

const CHECKS = [
  { id: 'C1', run: frameSize },
  { id: 'C2', run: insideTheFrame },
  { id: 'C3', run: noStrayPixels },
  { id: 'C4', run: noWhiteFringe },
  { id: 'C5', run: fitsThePortrait },
  { id: 'C6', run: coversTheUnderwear },
  { id: 'C7', run: densitiesAgree },
  { id: 'C8', run: legalName },
  { id: 'C9', run: listedInTheManifest },
  { id: 'C10', run: insideTheBudget },
  { id: 'C11', run: maskChecks },
]

export const CHECK_IDS = CHECKS.map((check) => check.id)

/**
 * Run every check over every named file (or over everything the manifest lists).
 *
 * Returns one row per file, each with a result per check. Nothing here exits or prints: `formatChecks`
 * turns the rows into the table, and the CLI decides what a failure costs.
 *
 * @param {{ dir: string, manifest: { files: Record<string, any> }, names?: string[], skip?: string[] }} options
 */
export async function runChecks({ dir, manifest, names, skip = [] }) {
  const wanted = names?.length ? names : Object.keys(manifest.files)
  const bases = await loadBases(dir, manifest)
  const rows = []
  for (const name of wanted) {
    const context = await load(dir, manifest, name, bases)
    const results = CHECKS.map((check) => ({
      id: check.id,
      ...(skip.includes(check.id) ? ok('skipped') : check.run(context)),
    }))
    rows.push({ name, results })
  }
  return rows
}

/** The `base_*_L30` layers at @1x, which C6 measures every outfit against — each with the wear it dresses in. */
async function loadBases(dir, manifest) {
  const bases = []
  for (const name of Object.keys(manifest.files)) {
    const parsed = parseName(name)
    if (parsed?.kind !== 'base' || parsed.layer !== LAYERS.body) continue
    const file = join(dir, `${name}@1x.png`)
    if (!existsSync(file)) continue
    bases.push({ name: parsed.base, wear: wearOf(parsed.base), real: manifest.files[name]?.real === true, picture: await readPicture(file) })
  }
  return bases
}

async function load(dir, manifest, name, bases) {
  const pictures = {}
  const bytes = {}
  for (const density of DENSITIES) {
    const file = join(dir, `${name}@${density}x.png`)
    if (!existsSync(file)) continue
    pictures[density] = await readPicture(file)
    bytes[density] = statSync(file).size
  }
  const halved = pictures[2] ? await resizePicture(pictures[2], Math.round(pictures[2].width / 2), Math.round(pictures[2].height / 2)) : null
  const entry = manifest.files[name]
  const parsed = parseName(name)

  // C11: every mask this file's manifest entry lists, at @2x — the density everything above is measured
  // and drawn at (spec §4.3's pixel counts are "@2x").
  const masks = {}
  if (entry?.masks) {
    for (const kind of Object.keys(entry.masks)) {
      const file = join(dir, `${name}_${MASK_FILE_KIND[kind]}mask@2x.png`)
      masks[kind] = existsSync(file) ? await readPicture(file) : null
    }
  }
  // C11's hair-on-a-face rule measures against the same base's `face_neutral` hair mask — read once here,
  // the one place `load` may look outside its own file, because the check itself has to stay synchronous.
  let neutralHairArea = null
  if (parsed?.kind === 'baseFace' && entry?.masks?.hair) {
    const neutralName = faceFile(parsed.base, 'neutral')
    if (neutralName === name) {
      neutralHairArea = masks.hair ? maskArea(masks.hair) : null
    } else {
      const neutralInfo = manifest.files[neutralName]?.masks?.hair
      if (neutralInfo && !neutralInfo.empty) {
        const neutralFile = join(dir, `${neutralName}_hairmask@2x.png`)
        neutralHairArea = existsSync(neutralFile) ? maskArea(await readPicture(neutralFile)) : null
      }
    }
  }

  return { name, dir, manifest, entry, parsed, pictures, bytes, halved, bases, masks, neutralHairArea }
}

/** Pixels of a mask (as a `readPicture` result: white RGB, coverage in alpha) at ≥ 128 — spec §4.3's areas. */
function maskArea(pic) {
  let n = 0
  for (let i = 3; i < pic.data.length; i += 4) if (pic.data[i] >= 128) n++
  return n
}

// ───────────────────────────────────────────────────────────── the criteria ──

function frameSize({ pictures }) {
  const wrong = []
  for (const density of DENSITIES) {
    const picture = pictures[density]
    if (!picture) {
      wrong.push(`@${density}x missing`)
      continue
    }
    if (picture.width !== FRAME.w * density || picture.height !== FRAME.h * density) {
      wrong.push(`@${density}x is ${picture.width} × ${picture.height}`)
    }
  }
  return wrong.length ? bad(wrong.join(', ')) : ok(`${FRAME.w} × ${FRAME.h} at both densities`)
}

/**
 * C2. An aura (layer 10) is exempt (2026-09-24, Plan 12): it is an effect spread round the whole figure,
 * `AURA_SIZE` (400) wide on a 384 frame, so a real one touches the edge by design. C3 still holds it to having
 * nothing stray where nothing is drawn.
 */
function insideTheFrame({ pictures, parsed }) {
  if (parsed?.layer === LAYERS.aura) return ok('n/a — an aura may run to the frame edge')
  for (const density of DENSITIES) {
    const picture = pictures[density]
    if (!picture) continue
    const { width, height, data } = picture
    for (let x = 0; x < width; x++) {
      for (const y of [0, height - 1]) {
        if (data[(y * width + x) * 4 + 3] > ALPHA_INK) return bad(`@${density}x touches the frame at ${x},${y}`)
      }
    }
    for (let y = 0; y < height; y++) {
      for (const x of [0, width - 1]) {
        if (data[(y * width + x) * 4 + 3] > ALPHA_INK) return bad(`@${density}x touches the frame at ${x},${y}`)
      }
    }
  }
  return ok('clear of every edge')
}

/** A layer the manifest marks `empty: true` — an AI base's hair layers — which has to stay that way. */
const markedEmpty = ({ entry }) => entry?.empty === true
const EMPTY_NA = ok('n/a — marked empty')

/** Every alpha byte zero. */
function fullyTransparent(picture) {
  for (let i = 3; i < picture.data.length; i += 4) if (picture.data[i] !== 0) return false
  return true
}

function noStrayPixels(context) {
  const { pictures } = context
  // Emptiness is judged here because this is the check about "the empty part really is empty": a layer
  // marked empty must be empty everywhere, and a layer not marked so must have something on it — an
  // unmarked blank file is a failed export, not a choice.
  const present = DENSITIES.filter((density) => pictures[density])
  if (markedEmpty(context)) {
    const drawn = present.filter((density) => !fullyTransparent(pictures[density]))
    return drawn.length ? bad(`marked empty, but @${drawn.join('x and @')}x has pixels on it`) : ok('empty, as marked')
  }
  const blank = present.filter((density) => !alphaBBox(pictures[density], 0))
  if (blank.length) return bad(`@${blank.join('x and @')}x is fully transparent but the manifest does not mark it empty`)
  // An aura (layer 10) is scattered by design — sparks off a lightning arc, petals, drops — so a solid pixel
  // well away from the ring is the art, not litter (2026-09-24: lightning01 had five, alpha up to 72).
  if (context.parsed?.layer === LAYERS.aura) return ok('n/a — an aura is scattered particles by design')
  for (const density of DENSITIES) {
    const picture = pictures[density]
    if (!picture) continue
    // The box is taken over the *solid* pixels, not over every pixel with any alpha at all. Taken over
    // every pixel it would move to enclose the very rubbish it is meant to find — one alpha-40 pixel in
    // a corner and the box is the whole frame, with nothing outside it to complain about. The shape is
    // where the opaque pixels are; a faint pixel more than `STRAY_MARGIN` away from that is not the
    // shape's soft edge, it is what D01 §8.3 calls rác bán trong suốt.
    const box = alphaBBox(picture, ALPHA_SOLID) ?? alphaBBox(picture)
    if (!box) continue
    const margin = STRAY_MARGIN * density
    const { width, height, data } = picture
    let strays = 0
    let worst = 0
    for (let y = 0; y < height; y++) {
      const outsideRow = y < box.y - margin || y >= box.y + box.h + margin
      for (let x = 0; x < width; x++) {
        if (!outsideRow && x >= box.x - margin && x < box.x + box.w + margin) continue
        const alpha = data[(y * width + x) * 4 + 3]
        if (alpha === 0) continue
        strays++
        worst = Math.max(worst, alpha)
      }
    }
    if (strays) return bad(`@${density}x has ${strays} pixels outside the shape, up to alpha ${worst}`)
  }
  return ok('empty where it should be')
}

function noWhiteFringe(context) {
  if (markedEmpty(context)) return EMPTY_NA
  const picture = context.pictures[2]
  if (!picture) return ok('n/a — no @2x to judge')
  const rim = meanColour(picture, (alpha) => alpha >= ALPHA_INK && alpha <= 200)
  if (!rim) return ok('n/a — no soft edge to judge')
  const distance = colourDistance(rim[0], rim[1], rim[2], 255, 255, 255)
  if (distance >= WHITE_TOLERANCE) return ok(`rim is ${Math.round(distance)} from white`)
  const inside = meanColour(picture, (alpha) => alpha > 200)
  const insideDistance = inside ? colourDistance(inside[0], inside[1], inside[2], 255, 255, 255) : 255
  if (insideDistance < WHITE_TOLERANCE) return ok('white rim on white art, which is the art')
  return bad(`rim is ${Math.round(distance)} from white but the shape is ${Math.round(insideDistance)} — a white fringe`)
}

function meanColour(picture, accept) {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let p = 0; p < picture.width * picture.height; p++) {
    const at = p * 4
    if (!accept(picture.data[at + 3])) continue
    r += picture.data[at]
    g += picture.data[at + 1]
    b += picture.data[at + 2]
    n++
  }
  return n < 50 ? null : [r / n, g / n, b / n]
}

function fitsThePortrait(context) {
  const { parsed, pictures } = context
  if (markedEmpty(context)) return EMPTY_NA
  if (parsed?.layer !== LAYERS.head && parsed?.layer !== LAYERS.faceAcc) return ok('n/a — not a head or face item')
  const picture = pictures[1]
  if (!picture) return ok('n/a — no @1x to judge')
  const box = alphaBBox(picture)
  if (!box) return bad('the layer is empty')
  const inside =
    box.x >= CROP.x - CROP_MARGIN &&
    box.y >= CROP.y - CROP_MARGIN &&
    box.x + box.w <= CROP.x + CROP.size + CROP_MARGIN &&
    box.y + box.h <= CROP.y + CROP.size + CROP_MARGIN
  const where = `${box.x},${box.y} ${box.w} × ${box.h}`
  return inside ? ok(`inside the crop (${where})`) : bad(`spills out of the ${CROP.size} × ${CROP.size} crop (${where})`)
}

/**
 * Which bases this outfit layer is the one worn by (2026-09-20, per-wear variants).
 *
 * A **variant** (`item_outfit_dealer01_m_L40`) is worn only by the bases of its own wear: holding the male
 * cut to a female base measures a garment against a figure that will never wear it. A **default** layer is
 * worn by every base whose wear has no variant of this item — the moment a male dealer01 exists, the
 * default layer stops being what m01 wears and stops being measured against him, which is what lets a
 * skirt keep covering f01 while trousers cover m01.
 */
function wornBy(context, candidates) {
  const { parsed, manifest } = context
  if (parsed?.wear) return candidates.filter((candidate) => candidate.wear === parsed.wear)
  return candidates.filter((candidate) => {
    if (candidate.wear === null) return true
    return manifest.files[itemFile(parsed.slot, parsed.code, parsed.layer, candidate.wear)] === undefined
  })
}

function coversTheUnderwear(context) {
  const { parsed, pictures, bases } = context
  if (markedEmpty(context)) return EMPTY_NA
  if (parsed?.layer !== LAYERS.outfit) return ok('n/a — not an outfit')
  const outfit = pictures[1]
  if (!outfit) return ok('n/a — no @1x to judge')
  if (!bases.length) return bad('no base layer to measure against')
  // Real art is measured against real art. While one base is a photograph-grade picture and another is
  // still the labelled rectangle `placeholder` drew, holding a real dress to the stand-in's square
  // shoulders reports a fault in neither of them — the same reason the reverse mix (a real base under a
  // stand-in outfit) is the documented use of `--skip C6`. Once every base is real, every base is measured.
  const real = bases.filter((candidate) => candidate.real)
  const worn = wornBy(context, real.length ? real : bases)
  if (!worn.length) return ok(`n/a — no base wears ${parsed.wear ? `the ${parsed.wear} cut` : 'this layer'}`)
  let worst = { name: '', coverage: 1 }
  for (const candidate of worn) {
    const region = underwearRegion(candidate.picture)
    if (!region.pixels.length) return bad(`${candidate.name} has no underwear region to cover`)
    let covered = 0
    for (const p of region.pixels) if (outfit.data[p * 4 + 3] > ALPHA_SOLID) covered++
    const coverage = covered / region.pixels.length
    if (coverage < worst.coverage) worst = { name: candidate.name, coverage }
  }
  const percent = `${(worst.coverage * 100).toFixed(1)} %`
  return worst.coverage >= UNDERWEAR_COVERAGE
    ? ok(`covers ${percent} of every base`)
    : bad(`leaves ${worst.name}'s underwear showing — covers only ${percent}`)
}

/**
 * The base's underwear: the pixels in the waist band that are *cloth* and the band's dominant cloth colour.
 *
 * Two exclusions before anything is measured, both added on 2026-09-17 (phase 2) when this was run against
 * a real base for the first time and reported 34.7 % for an outfit that covers every thread of underwear
 * F01 has:
 *
 * - **The head region.** The band starts at y 176 and an outfit layer holds nothing above y 236 or inside
 *   the portrait crop, by rule (`OUTFIT_TOP_Y`, and the base's own face layer draws over it). Rows of the
 *   face counted as underwear are rows no outfit can ever cover.
 * - **Skin.** The dominant colour of F01's band, unfiltered, is her *face*: the modal colour of a band that
 *   is mostly cheek is a skin tone, and the check then asks an outfit to cover her chin. So the base's own
 *   skin (`baseSkinColour`, ± `SKIN_TOLERANCE`) is dropped first, and the modal colour of what is left is
 *   the tank top and shorts — which is what D01 §10.7 means by underwear.
 *
 * "Dominant" is a modal colour over 32-level buckets rather than a mean — a mean of two cloths is a colour
 * that appears nowhere in the picture — and `UNDERWEAR_TOLERANCE` around it is what lets line art, shading
 * and the odd highlight sit inside the region without being counted as underwear an outfit failed to cover.
 */
export function underwearRegion(picture, density = 1) {
  const { width, data } = picture
  const top = UNDERWEAR_BAND.y0 * density
  const bottom = Math.min(picture.height, UNDERWEAR_BAND.y1 * density)
  const headLeft = CROP.x * density
  const headRight = (CROP.x + CROP.size) * density
  const headBottom = FACE_LIMIT_Y * density
  const skin = baseSkinColour(picture, density)
  const cloth = (x, y, p) => {
    if (y < top || y >= bottom) return false
    if (y < headBottom && x >= headLeft && x < headRight) return false
    const at = p * 4
    return !isSkin(data[at], data[at + 1], data[at + 2], skin, SKIN_TOLERANCE)
  }
  const dominant = modalColour(picture, cloth)
  if (dominant === null) return { pixels: [], dominant: null, skin }
  const pixels = []
  for (let y = top; y < bottom; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const at = p * 4
      if (data[at + 3] <= ALPHA_SOLID || !cloth(x, y, p)) continue
      if (colourDistance(data[at], data[at + 1], data[at + 2], dominant[0], dominant[1], dominant[2]) <= UNDERWEAR_TOLERANCE) pixels.push(p)
    }
  }
  return { pixels, dominant, skin }
}

function densitiesAgree({ pictures, halved }) {
  const small = pictures[1]
  if (!small || !halved) return bad('one of the two densities is missing')
  if (small.width !== halved.width || small.height !== halved.height) return bad(`@1x is ${small.width} × ${small.height}, the halved @2x is ${halved.width} × ${halved.height}`)
  let drift = 0
  // Premultiplied, so that the colour of a fully transparent pixel — which nobody will ever see and
  // which the two encoders need not agree about — cannot drag the coefficient down.
  const sums = { n: 0, a: 0, b: 0, aa: 0, bb: 0, ab: 0 }
  for (let p = 0; p < small.width * small.height; p++) {
    const at = p * 4
    drift += Math.abs(small.data[at + 3] - halved.data[at + 3])
    const sa = small.data[at + 3] / 255
    const ha = halved.data[at + 3] / 255
    for (let c = 0; c < 4; c++) {
      const left = c === 3 ? small.data[at + 3] : small.data[at + c] * sa
      const right = c === 3 ? halved.data[at + 3] : halved.data[at + c] * ha
      sums.n++
      sums.a += left
      sums.b += right
      sums.aa += left * left
      sums.bb += right * right
      sums.ab += left * right
    }
  }
  const meanDrift = drift / (small.width * small.height)
  const r = correlation(sums)
  if (meanDrift > DENSITY_ALPHA_DRIFT) return bad(`@1x differs from the halved @2x by ${meanDrift.toFixed(1)} of alpha`)
  if (r !== null && r < DENSITY_CORRELATION) return bad(`@1x correlates with the halved @2x at only ${r.toFixed(3)}`)
  return ok(`@1x is the @2x halved (drift ${meanDrift.toFixed(2)})`)
}

/** Pearson's r, or `null` when one side is flat and the coefficient is undefined rather than low. */
function correlation({ n, a, b, aa, bb, ab }) {
  const va = n * aa - a * a
  const vb = n * bb - b * b
  if (va <= 0 || vb <= 0) return null
  return (n * ab - a * b) / Math.sqrt(va * vb)
}

function legalName({ name }) {
  return NAME_PATTERN.test(name) ? ok('follows D01 §9.1') : bad('does not follow D01 §9.1, or its layer does not match its slot')
}

function listedInTheManifest({ name, entry, parsed }) {
  if (!entry) return bad('not in the manifest')
  if (!parsed) return bad('cannot be read as a name, so the manifest cannot be checked against it')
  if (entry.layer !== parsed.layer) return bad(`the manifest says layer ${entry.layer}, the name says ${parsed.layer}`)
  if (entry.w !== FRAME.w || entry.h !== FRAME.h) return bad(`the manifest says ${entry.w} × ${entry.h}`)
  return ok(`layer ${entry.layer}, ${name.length} characters`)
}

function insideTheBudget({ entry, bytes }) {
  const onDisk = bytes[2]
  if (onDisk === undefined) return bad('no @2x on disk to weigh')
  if (entry && entry.bytes2x !== onDisk) return bad(`the manifest says ${entry.bytes2x} bytes, the file is ${onDisk}`)
  if (onDisk > MAX_BYTES_2X) return bad(`${(onDisk / 1024).toFixed(1)} KB is over the ${(MAX_BYTES_2X / 1024).toFixed(0)} KB budget`)
  return ok(`${(onDisk / 1024).toFixed(1)} KB`)
}

const EYE_NEIGHBOURS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]

/** 8-connected components of a mask picture (≥ 128), each with its size and its x-span. C11's own — the
 * eye rule needs which *side* a blob sits on, which `alphaBBox`'s single box for the whole mask cannot say. */
function eyeBlobs(maskPic) {
  const { width, height, data } = maskPic
  const bin = new Uint8Array(width * height)
  for (let i = 0; i < bin.length; i++) bin[i] = data[i * 4 + 3] >= 128 ? 1 : 0
  const label = new Int32Array(bin.length).fill(-1)
  const blobs = []
  const stack = []
  for (let start = 0; start < bin.length; start++) {
    if (!bin[start] || label[start] >= 0) continue
    const blob = { size: 0, x0: width, x1: -1 }
    const id = blobs.length
    blobs.push(blob)
    stack.push(start)
    label[start] = id
    while (stack.length) {
      const p = stack.pop()
      blob.size++
      const x = p % width
      const y = (p - x) / width
      if (x < blob.x0) blob.x0 = x
      if (x > blob.x1) blob.x1 = x
      for (const [dx, dy] of EYE_NEIGHBOURS8) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const q = ny * width + nx
        if (bin[q] && label[q] < 0) { label[q] = id; stack.push(q) }
      }
    }
  }
  return blobs
}

/**
 * C11 (spec §4.3): every mask a layer's manifest entry lists — hair, eyes, tint — sits on the layer's own
 * ink, at the layer's own size, and, unless it is a hand-drawn `override`, has a plausible shape:
 *
 * - hair on `L30`: 3–20 % of the frame area;
 * - hair on a face: 0.7–1.3 × the same base's `face_neutral` hair mask (skipped when that is empty — an
 *   AI base whose neutral face has no hair to compare against);
 * - eyes on `neutral`: exactly two 8-connected blobs, 100–8000 px each, one each side of the mask's own
 *   centre column; on another open-eyed expression, that or none; on `closed`/`sleep`, always none;
 * - tint: at least 2 % of the layer's own ink.
 *
 * A file the manifest lists no `masks` for (nothing has been through `masks`/`ingest` for it yet) reports
 * `n/a`, same as every other check that has nothing to judge.
 */
function maskChecks(context) {
  const { entry, parsed, pictures, masks, neutralHairArea } = context
  if (!entry?.masks) return ok('n/a — no masks cut for this layer')
  const layer = pictures[2]
  if (!layer) return ok('n/a — no @2x to judge')

  const problems = []
  for (const [kind, info] of Object.entries(entry.masks)) {
    const maskPic = masks[kind]
    if (!maskPic) { problems.push(`${kind} mask file is missing from disk`); continue }
    if (maskPic.width !== layer.width || maskPic.height !== layer.height) {
      problems.push(`${kind} mask is ${maskPic.width} × ${maskPic.height}, the layer is ${layer.width} × ${layer.height}`)
      continue
    }

    let area = 0
    let outside = 0
    for (let i = 0; i < maskPic.width * maskPic.height; i++) {
      if (maskPic.data[i * 4 + 3] < 128) continue
      area++
      if (layer.data[i * 4 + 3] <= ALPHA_INK) outside++
    }
    if (outside) { problems.push(`${kind} mask outside the layer at ${outside} pixel${outside === 1 ? '' : 's'}`); continue }
    if (info.override) continue // a hand-drawn mask is trusted for its shape — size and coverage still hold.

    if (kind === 'hair' && parsed?.kind === 'base' && parsed.layer === LAYERS.body) {
      const pct = (area / (layer.width * layer.height)) * 100
      if (pct < 3 || pct > 20) problems.push(`hair area is ${pct.toFixed(1)} % of the frame, want 3–20 %`)
    } else if (kind === 'hair' && parsed?.kind === 'baseFace' && neutralHairArea !== null) {
      const ratio = neutralHairArea === 0 ? 1 : area / neutralHairArea
      if (ratio < 0.7 || ratio > 1.3) problems.push(`hair area is ${ratio.toFixed(2)} × the neutral face's, want 0.7–1.3 ×`)
    } else if (kind === 'eyes' && parsed?.kind === 'baseFace') {
      const wantsEmpty = parsed.expr === 'closed' || parsed.expr === 'sleep'
      const emptyAllowed = !wantsEmpty && parsed.expr !== 'neutral'
      if (wantsEmpty) {
        if (area > 0) problems.push(`${parsed.expr} face needs an empty eye mask, found ${area} px`)
      } else if (area === 0 && !emptyAllowed) {
        problems.push('neutral face needs two eyes, found none')
      } else if (area > 0) {
        const mid = maskPic.width / 2
        const valid = eyeBlobs(maskPic).filter((b) => b.size >= 100 && b.size <= 8000 && (b.x1 < mid || b.x0 >= mid))
        const left = valid.filter((b) => b.x1 < mid).length
        const right = valid.filter((b) => b.x0 >= mid).length
        if (left !== 1 || right !== 1) {
          const label = parsed.expr === 'neutral' ? 'neutral face needs two eyes' : `${parsed.expr} face needs two eyes or none`
          problems.push(`${label}, found ${left} left and ${right} right`)
        }
      }
    } else if (kind === 'tint') {
      let ink = 0
      for (let i = 3; i < layer.data.length; i += 4) if (layer.data[i] > ALPHA_INK) ink++
      const pct = ink === 0 ? 0 : (area / ink) * 100
      if (pct < 2) problems.push(`tint area is ${pct.toFixed(1)} % of the item's own ink, want ≥ 2 %`)
    }
  }
  return problems.length ? bad(problems.join('; ')) : ok(`${Object.keys(entry.masks).length} mask${Object.keys(entry.masks).length === 1 ? '' : 's'} check out`)
}

// ────────────────────────────────────────────────────────────────── the table ──

/** The table `check` prints: one line per file, then the detail of everything that failed. */
export function formatChecks(rows) {
  const width = Math.max(4, ...rows.map((row) => row.name.length))
  const lines = [`${'file'.padEnd(width)}  ${CHECK_IDS.map((id) => id.padStart(4)).join('')}`]
  const failures = []
  for (const row of rows) {
    const cells = row.results.map((result) => {
      if (!result.ok) {
        failures.push(`${row.name} ${result.id}: ${result.detail}`)
        return 'FAIL'.padStart(4)
      }
      return (result.detail.startsWith('n/a') ? '-' : result.detail === 'skipped' ? 'skip' : 'ok').padStart(4)
    })
    lines.push(`${row.name.padEnd(width)}  ${cells.join('')}`)
  }
  const total = rows.reduce((sum, row) => sum + row.results.length, 0)
  lines.push('', `${rows.length} files, ${total} checks, ${failures.length} failures`)
  if (failures.length) lines.push('', ...failures)
  return lines.join('\n')
}

export const anyFailed = (rows) => rows.some((row) => row.results.some((result) => !result.ok))
