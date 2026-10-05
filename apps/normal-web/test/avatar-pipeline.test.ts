/**
 * The 2D avatar asset pipeline (spec §6, D01 §3/§4/§8/§9/§10).
 *
 * Two halves, and they test different things.
 *
 * The **algorithm** half builds its own source pictures with `sharp` — a flat green canvas with a grey
 * figure on it, the same figure wearing a red hat, the same figure wearing blue clothes — and drives
 * `removeChroma`, `anchorBase`, `diffAgainstBase` and each of the ten acceptance checks over them. No
 * file in `public/` is involved, so these pass on a checkout that has never run the pipeline and they
 * fail for exactly one reason: the arithmetic is wrong.
 *
 * The **artefact** half reads what is committed under `public/avatar/`: the placeholder set is a build
 * artefact that is committed, because the app has to build before the generated art exists. What it
 * defends is that the committed set is the set the stage-1 list names, at both densities, that both
 * copies of the manifest agree byte for byte, and that `check` still passes on them.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { STRAY_MARGIN, eachStray, headMetrics, runChecks } from '../scripts/avatar-pipeline/checks.mjs'
import { BODY_SKIN_RULE, OUTFIT_TOP_Y, cutItem, diffAgainstBase, dropStrays, ingest, measure, registerBySilhouette, registerToBase, shiftPicture } from '../scripts/avatar-pipeline/extract.mjs'
import { AURA_CY, AURA_SIZE, AXIS_X, BASELINE_Y, BODY, CHIN_TOLERANCE, CROP, DENSITIES, F01_TRANSFORM, FACE_LIMIT_Y, FRAME, HEAD_REFERENCE, HEAD_TOLERANCE, LAYERS, RING, SKIN_AREA, TORSO_COLUMN, UNDERWEAR_BAND, anchorBase, applyTransform, baseSkinColour, placeholderSvg } from '../scripts/avatar-pipeline/frame.mjs'
import { EXPRESSIONS, FIT_SHEET_FILE, HAIR_CODES, ICON, ITEMS_FILE, MANIFEST_NAME, NAME_PATTERN, SHEET_FILE, WEARS, bodyFaceFile, bodyFile, buildPlaceholders, hairFile, hairItemId, iconName, itemFile, parseName, serialiseManifest, stageOneFiles, variantFile, wearOf, writeIcon } from '../scripts/avatar-pipeline/manifest.mjs'
import { MASK_FILE_KIND, describeColours } from '../scripts/avatar-pipeline/masks.mjs'
import { alphaBBox, blankPicture, cropPicture, overPicture, readPicture, removeChroma, renderSvg, writeDensities, writePicture } from '../scripts/avatar-pipeline/png.mjs'
import { FIT_GRID, SHEET_GRID, composeCard, fitCards, sheetCards, sheetLayout } from '../scripts/avatar-pipeline/sheet.mjs'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = resolve(PACKAGE_ROOT, 'scripts/avatar-pipeline.mjs')
const OUT_DIR = resolve(PACKAGE_ROOT, 'public/avatar')
const WEB_MANIFEST = join(OUT_DIR, MANIFEST_NAME)
const SERVER_MANIFEST = resolve(PACKAGE_ROOT, '../normal-server/data/avatar-manifest.json')
const SHEET = resolve(PACKAGE_ROOT, '../../docs/avatar-2d-sheet.png')
const FIT_SHEET = resolve(PACKAGE_ROOT, '../../docs/avatar-2d-fit-sheet.png')

/** The generation canvas the prompts in D02 ask for: @3x, which everything is scaled down from. */
const SRC = { w: 1152, h: 1344 }
/** Where the synthetic figure sits on that canvas. Chosen so the frame maths comes out round. */
const SRC_FIGURE = { top: 200, bottom: 1208, cx: 576, headBottom: 646 }
/** The red hat on the synthetic item picture, in source pixels. */
const SRC_HAT = { x0: 430, y0: 180, x1: 722, y1: 330 }
/** A second red blob at the waist: the `head` rule has to drop it, or the extraction is not a hat. */
const SRC_SMUDGE = { x0: 500, y0: 850, x1: 650, y1: 980 }

interface Picture {
  data: Buffer
  width: number
  height: number
}

interface ManifestEntry {
  layer: number
  w: number
  h: number
  bytes2x: number
  placeholder?: boolean
  real?: boolean
  /** A real layer with nothing on it, on purpose: a short hairstyle's back layer (L20). */
  empty?: boolean
  /** The body an item or a bot was cut on (Plan 19): `f` or `m`. */
  cutOn?: string
  hidesHairFront?: boolean
  hidesHairBack?: boolean
  /** A per-wear cut of another item layer (2026-09-20): the layer it is a cut of, and which wear wears it. */
  variantOf?: string
  wear?: string
  /** Hair, eye and tint masks (Plan 13 Task 2); skin masks (Plan 19). */
  masks?: Record<string, { bytes2x: number; meanL?: number; empty?: boolean; override?: boolean }>
  /** A hair L60's region and how it splits between the two hair layers, in @2x pixels (Plan 19, spec §5.4). */
  split?: { region: number; front: number; back: number }
}

interface Manifest {
  version: number
  frame: { w: number; h: number }
  crop: { x: number; y: number; size: number }
  files: Record<string, ManifestEntry>
  /** One inventory icon per item layer (2026-09-17), named `<layer without _L<n>>_icon`. `tintMask` (Plan 18, No8a):
   * the icon has its own `<icon>_tintmask`, cut from its layer's tint mask. */
  icons?: Record<string, { kind: 'icon'; of: string; w: number; h: number; bytes2x: number; placeholder?: boolean; real?: boolean; tintMask?: boolean }>
  /** Each v4 body's stored transform (Plan 19), once one is ingested. */
  bodies?: Record<string, { transform: { scale: number; offsetX: number; offsetY: number }; anchor?: string }>
}

/** A bot's face written as a copy of its neutral face at ingest (2026-09-24): the layer it copies. */
type BotManifest = Manifest & { files: Record<string, ManifestEntry & { copyOf?: string }> }

// ───────────────────────────────────────────────────────── synthetic sources ──

/** The grey figure every synthetic picture is built on: head, neck, torso, arms, legs, two dark eyes. */
const FIGURE = `
  <ellipse cx="576" cy="423" rx="240" ry="223" fill="#808080"/>
  <ellipse cx="466" cy="477" rx="60" ry="70" fill="#202020"/>
  <ellipse cx="686" cy="477" rx="60" ry="70" fill="#202020"/>
  <rect x="531" y="600" width="90" height="90" fill="#808080"/>
  <rect x="444" y="660" width="264" height="320" rx="30" fill="#808080"/>
  <rect x="390" y="690" width="60" height="290" rx="28" fill="#808080"/>
  <rect x="702" y="690" width="60" height="290" rx="28" fill="#808080"/>
  <rect x="480" y="960" width="72" height="248" rx="24" fill="#808080"/>
  <rect x="600" y="960" width="72" height="248" rx="24" fill="#808080"/>
`

const sourceSvg = (extra = ''): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SRC.w}" height="${SRC.h}">` +
  `<rect width="${SRC.w}" height="${SRC.h}" fill="#00ff00"/>${FIGURE}${extra}</svg>`

const HAT = `<rect x="${SRC_HAT.x0}" y="${SRC_HAT.y0}" width="${SRC_HAT.x1 - SRC_HAT.x0}" height="${SRC_HAT.y1 - SRC_HAT.y0}" rx="18" fill="#cc2222"/>`
const SMUDGE = `<rect x="${SRC_SMUDGE.x0}" y="${SRC_SMUDGE.y0}" width="${SRC_SMUDGE.x1 - SRC_SMUDGE.x0}" height="${SRC_SMUDGE.y1 - SRC_SMUDGE.y0}" fill="#cc2222"/>`
const CLOTHES = `<rect x="416" y="640" width="320" height="568" rx="24" fill="#2244cc"/>`

/** A bob-haired figure: hair curtains to y = 760 on either side of a face that ends at y ≈ 670. */
const BOB = `
  <ellipse cx="576" cy="420" rx="300" ry="240" fill="#a07050"/>
  <rect x="276" y="420" width="144" height="340" rx="20" fill="#a07050"/>
  <rect x="732" y="420" width="144" height="340" rx="20" fill="#a07050"/>
  <ellipse cx="576" cy="470" rx="180" ry="200" fill="#e0c0a0"/>
  <ellipse cx="506" cy="500" rx="30" ry="40" fill="#202020"/>
  <ellipse cx="646" cy="500" rx="30" ry="40" fill="#202020"/>
  <rect x="536" y="640" width="80" height="90" fill="#e0c0a0"/>
  <rect x="456" y="720" width="240" height="300" rx="24" fill="#808080"/>
  <rect x="480" y="1000" width="80" height="300" rx="24" fill="#808080"/>
  <rect x="592" y="1000" width="80" height="300" rx="24" fill="#808080"/>
`

// ──────────────────────────────────────────────────────────────── test state ──

let temp = ''
/** The three synthetic sources, chroma-keyed. */
let keyedBase: Picture
let keyedItem: Picture
let keyedOutfit: Picture
/** …and the three anchored onto the 384 × 448 frame with the base's transform. */
let framedBase: Picture
let framedItem: Picture
let framedOutfit: Picture
let transform: { scale: number; offsetX: number; offsetY: number }

beforeAll(async () => {
  temp = mkdtempSync(join(tmpdir(), 'avatar-pipeline-'))
  const render = async (extra: string): Promise<Picture> => removeChroma(await renderSvg(sourceSvg(extra), SRC.w, SRC.h), { tolerance: 40 })
  keyedBase = await render('')
  keyedItem = await render(HAT + SMUDGE)
  keyedOutfit = await render(CLOTHES)
  transform = anchorBase(keyedBase)
  framedBase = await applyTransform(keyedBase, transform, 1)
  framedItem = await applyTransform(keyedItem, transform, 1)
  framedOutfit = await applyTransform(keyedOutfit, transform, 1)
}, 60_000)

afterAll(() => {
  if (temp) rmSync(temp, { recursive: true, force: true })
})

/** A fresh directory for one crafted-file case, so each case's failure is its own. */
function caseDir(name: string): string {
  const dir = join(temp, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Seed `dir`'s manifest with the synthetic canvas's own transform for each of `genders`, before a case ingests the grey
 * FIGURE as that body. A body with no stored transform of its own lands on F01's (`F01_TRANSFORM`, Plan 19 final review):
 * the real canvas, 1024 × 1536. This one is 1152 × 1344, laid out so the frame maths comes out round, and on F01's
 * transform its figure would stand off the axis and short of the baseline — so the canvas brings its own, `anchorBase` of
 * the figure, as a body was placed in an empty directory until then. The body then keeps it, as a body ingested again does.
 */
function seedCanvas(dir: string, genders: string[] = ['f']): { scale: number; offsetX: number; offsetY: number } {
  const canvas = { scale: transform.scale, offsetX: transform.offsetX, offsetY: transform.offsetY }
  const bodies = Object.fromEntries(genders.map((gender) => [gender, { transform: { ...canvas } }]))
  writeFileSync(join(dir, MANIFEST_NAME), serialiseManifest({ version: 1, frame: FRAME, crop: CROP, files: {}, bodies }))
  return canvas
}

/** The manifest `check` reads: one entry per file, the same shape the pipeline writes. */
function manifestFor(dir: string, entries: Record<string, ManifestEntry>): Manifest {
  const manifest: Manifest = { version: 1, frame: FRAME, crop: CROP, files: entries }
  writeFileSync(join(dir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

/** Render one placeholder at @2x and write both densities — what `placeholder` does for a single name. */
async function writePlaceholder(dir: string, name: string): Promise<ManifestEntry> {
  const entry = stageOneFiles().find((file) => file.name === name)
  expect(entry, `${name} is not a stage-1 name`).toBeDefined()
  const pic = await renderSvg(placeholderSvg(entry!, 2), FRAME.w * 2, FRAME.h * 2)
  const bytes2x = await writeDensities(pic, dir, name)
  return { layer: entry!.layer, w: FRAME.w, h: FRAME.h, bytes2x, placeholder: true }
}

/** The id → ok map of one file's check run. */
async function checkOne(dir: string, name: string, manifest: Manifest): Promise<Map<string, { ok: boolean; detail: string }>> {
  const [row] = await runChecks({ dir, manifest, names: [name] })
  expect(row, `no check row for ${name}`).toBeDefined()
  return new Map(row!.results.map((result: { id: string; ok: boolean; detail: string }) => [result.id, { ok: result.ok, detail: result.detail }]))
}

/** Every pixel of a solid picture, as a raw RGBA buffer. */
function solid(width: number, height: number, rgba: [number, number, number, number]): Picture {
  const data = Buffer.alloc(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0]
    data[i + 1] = rgba[1]
    data[i + 2] = rgba[2]
    data[i + 3] = rgba[3]
  }
  return { data, width, height }
}

// ────────────────────────────────────────────────────────────── green screen ──

describe('removeChroma', () => {
  it('leaves the figure opaque and the flat green background empty', () => {
    const at = (x: number, y: number): number[] => [...keyedBase.data.subarray((y * SRC.w + x) * 4, (y * SRC.w + x) * 4 + 4)]
    // Four corners and the middle of each margin: nothing but background lives there.
    for (const [x, y] of [[4, 4], [SRC.w - 5, 4], [4, SRC.h - 5], [SRC.w - 5, SRC.h - 5], [SRC.w / 2, 40], [60, SRC.h / 2]]) {
      expect(at(x!, y!)[3], `background alpha at ${x},${y}`).toBe(0)
    }
    // …and the middle of the head, the torso and a leg are untouched.
    for (const [x, y] of [[576, 380], [576, 800], [516, 1100]]) {
      expect(at(x!, y!)[3], `figure alpha at ${x},${y}`).toBe(255)
    }
  })

  it('despills the edge so no pixel keeps a green fringe', () => {
    // Twenty pixels along the head's antialiased rim — where the green actually bleeds into the grey.
    let sampled = 0
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2
      const x = Math.round(576 + Math.cos(angle) * 240)
      const y = Math.round(423 + Math.sin(angle) * 223)
      const at = (y * SRC.w + x) * 4
      const [r, g, b, a] = [keyedBase.data[at]!, keyedBase.data[at + 1]!, keyedBase.data[at + 2]!, keyedBase.data[at + 3]!]
      if (a === 0) continue
      sampled++
      expect(g, `green fringe at ${x},${y} (rgba ${r},${g},${b},${a})`).toBeLessThanOrEqual(Math.max(r, b) + 8)
    }
    expect(sampled, 'the rim samples all landed on transparent pixels — the test is not looking at an edge').toBeGreaterThan(10)
  })

  it('keeps a soft edge rather than a hard cut', () => {
    // D01 §8.3: at least one pixel of ramp from opaque to clear, or the layer aliases when it is scaled.
    let soft = 0
    for (let x = 336; x < 816; x++) {
      for (let y = 190; y < 660; y++) {
        const a = keyedBase.data[(y * SRC.w + x) * 4 + 3]!
        if (a > 8 && a < 247) soft++
      }
    }
    expect(soft, 'the silhouette has no partly transparent edge at all').toBeGreaterThan(200)
  })
})

// ─────────────────────────────────────────────────────────────── the anchors ──

describe('anchorBase', () => {
  it('scales the figure so the frame invariants hold', () => {
    const box = alphaBBox(framedBase, 8)!
    expect(box).toBeDefined()
    expect(Math.abs(box.y - BODY.y), 'top of the head').toBeLessThanOrEqual(1)
    expect(Math.abs(box.y + box.h - BASELINE_Y), 'the baseline').toBeLessThanOrEqual(1)
    expect(Math.abs(box.x + box.w / 2 - AXIS_X), 'the vertical axis').toBeLessThanOrEqual(1)
  })

  it('reports the transform it used, uniformly scaled', () => {
    // One number, applied to both axes: a non-uniform fit would make every item that reuses it wrong.
    expect(transform.scale).toBeCloseTo(BODY.h / (SRC_FIGURE.bottom - SRC_FIGURE.top), 3)
    expect(transform.offsetX).toBeCloseTo(AXIS_X - SRC_FIGURE.cx * transform.scale, 1)
    expect(transform.offsetY).toBeCloseTo(BODY.y - SRC_FIGURE.top * transform.scale, 1)
  })

  it('puts the same source pixel in the same frame pixel at both densities', async () => {
    const at2x = await applyTransform(keyedBase, transform, 2)
    expect(at2x.width).toBe(FRAME.w * 2)
    expect(at2x.height).toBe(FRAME.h * 2)
    const box = alphaBBox(at2x, 8)!
    expect(Math.abs(box.y - BODY.y * 2)).toBeLessThanOrEqual(2)
    expect(Math.abs(box.y + box.h - BASELINE_Y * 2)).toBeLessThanOrEqual(2)
  })
})

describe('measure', () => {
  it('reports the D02 §8 proportions of a source picture', () => {
    const report = measure(keyedBase)
    expect(report.headHeight, 'head height').toBeGreaterThan(0)
    // The head is 446 source pixels of a 1008-pixel figure — 2.26 heads, which is the style's 2.25.
    expect(report.heads).toBeGreaterThan(2)
    expect(report.heads).toBeLessThan(2.5)
    // Two dark ellipses at 62 % of the head: detectable, and in the lower half as D02 §8.4 asks.
    expect(report.eyeRatio, 'eye line').not.toBeNull()
    expect(report.eyeRatio!).toBeGreaterThan(0.5)
    expect(report.eyeRatio!).toBeLessThan(0.75)
    // The figure is drawn on the canvas axis, so it is not off centre.
    expect(Math.abs(report.centreOffset)).toBeLessThanOrEqual(2)
    expect(report.ok).toBe(true)
  })

  it('finds the chin inside a bob rather than at the ends of the hair', async () => {
    // A bob seen front-on: a wide head of hair whose two side curtains hang past the chin to y = 760,
    // a narrower face ending at y ≈ 670, the neck between the curtains, then the body. The outline's
    // narrowest row after the hair is the torso under the curtains' ends — reading that as the chin
    // makes this a 1.9-head figure. The chin is where the face meets the neck, at y ≈ 665.
    const bob = removeChroma(await renderSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${SRC.w}" height="${SRC.h}">` +
      `<rect width="${SRC.w}" height="${SRC.h}" fill="#00ff00"/>${BOB}</svg>`, SRC.w, SRC.h), { tolerance: 40 })
    const report = measure(bob)
    expect(Math.abs(report.chin - 665), `chin at y = ${report.chin}`).toBeLessThanOrEqual(12)
    expect(report.headHeight).toBe(report.chin - report.top)
    expect(report.heads).toBeGreaterThan(2.1)
    expect(report.heads).toBeLessThan(2.5)
    expect(report.eyeRatio, 'eye line').not.toBeNull()
    expect(report.ok).toBe(true)
  })

  it('does not count a thin strand above the head as head', async () => {
    // An ahoge: 14 px wide, 125 px tall, on top of the plain figure. Counted as head it turns a
    // 2.26-head figure into a 1.99-head one; the head starts where the hair gets wide.
    const strand = `<rect x="569" y="80" width="14" height="140" fill="#808080"/>`
    const report = measure(removeChroma(await renderSvg(sourceSvg(strand), SRC.w, SRC.h), { tolerance: 40 }))
    expect(report.bbox.y).toBeLessThanOrEqual(82)
    expect(Math.abs(report.top - 200), `head top at y = ${report.top}`).toBeLessThanOrEqual(10)
    expect(report.heads).toBeGreaterThan(2.1)
    expect(report.heads).toBeLessThan(2.4)
    expect(report.ok).toBe(true)
    expect(report.notes.join(' ')).toMatch(/strand/)
  })

  it('fails a figure that is off the axis', async () => {
    const shifted = removeChroma(await renderSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${SRC.w}" height="${SRC.h}"><rect width="${SRC.w}" height="${SRC.h}" fill="#00ff00"/><g transform="translate(160 0)">${FIGURE}</g></svg>`, SRC.w, SRC.h), { tolerance: 40 })
    const report = measure(shifted)
    expect(Math.abs(report.centreOffset)).toBeGreaterThan(100)
    expect(report.ok).toBe(false)
  })
})

describe('cropPicture', () => {
  it('cuts the requested rectangle out, mapped to (0, 0) of the result', () => {
    const pic = blankPicture(4, 4)
    // One opaque red pixel at source (2, 1).
    const at = (1 * 4 + 2) * 4
    pic.data[at] = 255
    pic.data[at + 3] = 255
    const cropped = cropPicture(pic, 1, 1, 2, 2)
    expect(cropped.width).toBe(2)
    expect(cropped.height).toBe(2)
    // (2, 1) in the source lands at (1, 0) in a crop starting at (1, 1).
    const outAt = (0 * 2 + 1) * 4
    expect(cropped.data[outAt]).toBe(255)
    expect(cropped.data[outAt + 3]).toBe(255)
  })

  // The regression this guards: a negative offset used to fold silently into `Math.max(0, x)` on the
  // source side with no matching shift on the destination side, pasting the crop's far edge into its
  // near one instead of refusing — a misplaced picture nobody would notice until the contact sheet.
  it('refuses a negative x or y rather than silently misplacing the picture', () => {
    const pic = blankPicture(4, 4)
    expect(() => cropPicture(pic, -1, 0, 2, 2)).toThrow(/non-negative/)
    expect(() => cropPicture(pic, 0, -1, 2, 2)).toThrow(/non-negative/)
  })
})

// ─────────────────────────────────────────────────────────────── item cutout ──

describe('diffAgainstBase', () => {
  it('cuts out the hat and nothing else', () => {
    const { bbox } = diffAgainstBase(framedItem, framedBase, { slot: 'head', density: 1 })
    expect(bbox, 'the hat was not found at all').not.toBeNull()
    // The mask is deliberately 2 px larger than the difference on every side — the 1 px dilation that
    // recovers the item's own antialiased rim, plus the 1 px feather — so that is what it is measured
    // against. Anything beyond this is the difference finding something that is not the hat.
    const GROWTH = 2
    const expected = {
      x0: SRC_HAT.x0 * transform.scale + transform.offsetX - GROWTH,
      y0: SRC_HAT.y0 * transform.scale + transform.offsetY - GROWTH,
      x1: SRC_HAT.x1 * transform.scale + transform.offsetX + GROWTH,
      y1: SRC_HAT.y1 * transform.scale + transform.offsetY + GROWTH,
    }
    expect(Math.abs(bbox!.x - expected.x0), 'left').toBeLessThanOrEqual(3)
    expect(Math.abs(bbox!.y - expected.y0), 'top').toBeLessThanOrEqual(3)
    expect(Math.abs(bbox!.x + bbox!.w - expected.x1), 'right').toBeLessThanOrEqual(3)
    expect(Math.abs(bbox!.y + bbox!.h - expected.y1), 'bottom').toBeLessThanOrEqual(3)
  })

  it('drops everything a hat cannot reach', () => {
    // The red smudge at the waist is a legal connected region of the right colour; only the `head`
    // rule — nothing below y = 260 — keeps it out of the layer.
    const { mask } = diffAgainstBase(framedItem, framedBase, { slot: 'head', density: 1 })
    for (let y = 260; y < FRAME.h; y++) {
      for (let x = 0; x < FRAME.w; x++) expect(mask[y * FRAME.w + x], `mask at ${x},${y}`).toBe(0)
    }
  })

  it('keeps the smudge when the slot does not forbid it', () => {
    // The same picture as an `outfit`: the waist blob is now inside the layer, which is what says the
    // `head` rule above is a rule and not the diff quietly missing a region.
    const { mask } = diffAgainstBase(framedItem, framedBase, { slot: 'outfit', density: 1 })
    const midX = Math.round(((SRC_SMUDGE.x0 + SRC_SMUDGE.x1) / 2) * transform.scale + transform.offsetX)
    const midY = Math.round(((SRC_SMUDGE.y0 + SRC_SMUDGE.y1) / 2) * transform.scale + transform.offsetY)
    expect(mask[midY * FRAME.w + midX], 'the waist blob').toBeGreaterThan(0)
  })

  it('makes an outfit cover the underwear band of the body it is worn over, and only that', () => {
    // D01 §10.7: the outfit must leave no underwear showing, so inside `UNDERWEAR_BAND` the mask absorbs
    // the base whatever the difference says — outside the head region, which the base's own face layer
    // paints. 2026-09-17 (R1): *only* inside that band. Below it the base's own limbs are the base's to
    // draw, or an outfit layer could never be worn by a figure with a different skin tone.
    const { mask } = diffAgainstBase(framedOutfit, framedBase, { slot: 'outfit', density: 1 })
    const inHead = (x: number, y: number): boolean => y < FACE_LIMIT_Y && x >= CROP.x && x < CROP.x + CROP.size
    const inked = (x: number, y: number): boolean => framedBase.data[(y * FRAME.w + x) * 4 + 3]! > 8
    // This fixture's base is one flat grey with no underwear on it at all, so what the band absorbs here is
    // everything the clothes block changed — the torso, edge to edge, with no gap left by the difference.
    let uncovered = 0
    for (let y = Math.max(OUTFIT_TOP_Y, UNDERWEAR_BAND.y0); y < UNDERWEAR_BAND.y1; y++) {
      for (let x = 0; x < FRAME.w; x++) {
        if (inHead(x, y) || !inked(x, y)) continue
        const at = (y * FRAME.w + x) * 4
        if (framedOutfit.data[at] === framedBase.data[at]) continue
        if (mask[y * FRAME.w + x] === 0) uncovered++
      }
    }
    expect(uncovered, 'pixels of the base inside the band the outfit layer does not cover').toBe(0)

    // The arms this figure holds away from its body are outside the clothes block and unchanged by it:
    // below the band they are not in the layer at all, where the old union would have taken every one.
    const armY = UNDERWEAR_BAND.y1 + 8
    const arms = [...Array(FRAME.w).keys()].filter((x) => inked(x, armY) && framedOutfit.data[(armY * FRAME.w + x) * 4] === framedBase.data[(armY * FRAME.w + x) * 4])
    expect(arms.length, 'the fixture has base pixels below the band that the outfit picture left alone').toBeGreaterThan(8)
    for (const x of arms) expect(mask[armY * FRAME.w + x], `base at ${x},${armY}, which the picture did not change`).toBe(0)
  })

  it('keeps nothing of an outfit above the chin line', () => {
    // The picture's head has changed too (a generator redraws it every time): none of it may ride along.
    const { mask } = diffAgainstBase(framedItem, framedBase, { slot: 'outfit', density: 1 })
    for (let p = 0; p < OUTFIT_TOP_Y * FRAME.w; p++) expect(mask[p], `mask at ${p % FRAME.w},${Math.floor(p / FRAME.w)}`).toBe(0)
  })

  it('keeps a face accessory inside the portrait crop', () => {
    const { bbox } = diffAgainstBase(framedItem, framedBase, { slot: 'face', density: 1 })
    expect(bbox).not.toBeNull()
    expect(bbox!.x).toBeGreaterThanOrEqual(CROP.x)
    expect(bbox!.y).toBeGreaterThanOrEqual(CROP.y)
    expect(bbox!.x + bbox!.w).toBeLessThanOrEqual(CROP.x + CROP.size)
    expect(bbox!.y + bbox!.h).toBeLessThanOrEqual(CROP.y + CROP.size)
  })

  it('ignores specks smaller than the minimum region', async () => {
    // A 30 × 30 blob is 900 source pixels, which the frame's third of scale turns into 100 — under
    // `minRegion`, and exactly the kind of speck a green screen leaves behind.
    const speck = `<rect x="900" y="300" width="30" height="30" fill="#cc2222"/>`
    const keyed = removeChroma(await renderSvg(sourceSvg(HAT + speck), SRC.w, SRC.h), { tolerance: 40 })
    const framed = await applyTransform(keyed, transform, 1)
    // No slot, so no slot rule can be what removes it.
    const { mask } = diffAgainstBase(framed, framedBase, { density: 1, minRegion: 400 })
    const x = Math.round(915 * transform.scale + transform.offsetX)
    const y = Math.round(315 * transform.scale + transform.offsetY)
    expect(mask[y * FRAME.w + x], 'the speck survived the minimum-region filter').toBe(0)
  }, 60_000)
})

// ──────────────────────────────────────── a redrawn picture, at @2x (2026-09-17) ──

/**
 * What a generator actually hands back: the base *redrawn* — every pixel a little different, the figure a
 * few pixels off — with one change. Built straight on the @2x frame, no key and no transform involved.
 */
describe('a redrawn item picture', () => {
  const W = FRAME.w * 2
  const H = FRAME.h * 2
  /** The item picture is the base moved by this much, before registration puts it back. */
  const DRIFT = { dx: 3, dy: -2 }
  /** The hat, in base (registered) coordinates. */
  const HAT_BLOCK = { x0: 300, y0: 100, x1: 460, y1: 200 }
  /** A clothes block below the chin, for the outfit case. */
  const CLOTHES_BLOCK = { x0: 300, y0: 520, x1: 470, y1: 760 }

  /** A deterministic pseudo-random sequence, so the texture and the noise are the same on every run. */
  function lcg(seed: number): () => number {
    let state = seed >>> 0
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 0x1_0000_0000
    }
  }

  /** A figure tiled with 12 px blocks of unrelated colours: edges everywhere, and no period to lock onto. */
  function texturedBase(): Picture {
    const pic = blankPicture(W, H)
    const random = lcg(7)
    const tiles = new Map<string, number[]>()
    for (let y = 80; y < 820; y++) {
      for (let x = 250; x < 520; x++) {
        const key = `${Math.floor(x / 12)},${Math.floor(y / 12)}`
        if (!tiles.has(key)) tiles.set(key, [40 + random() * 170, 40 + random() * 170, 40 + random() * 170])
        const [r, g, b] = tiles.get(key)!
        pic.data.set([Math.round(r!), Math.round(g!), Math.round(b!), 255], (y * W + x) * 4)
      }
    }
    return pic
  }

  function fill(pic: Picture, block: { x0: number; y0: number; x1: number; y1: number }, rgb: [number, number, number]): Picture {
    for (let y = block.y0; y < block.y1; y++) {
      for (let x = block.x0; x < block.x1; x++) pic.data.set([...rgb, 255], (y * W + x) * 4)
    }
    return pic
  }

  /** The base with `change` applied, moved by `DRIFT`, with ±6 of noise on every channel of every solid pixel. */
  function redrawn(base: Picture, change: (pic: Picture) => Picture): Picture {
    const changed = change({ data: Buffer.from(base.data), width: W, height: H })
    const moved = blankPicture(W, H)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const sx = x - DRIFT.dx
        const sy = y - DRIFT.dy
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue
        moved.data.set(changed.data.subarray((sy * W + sx) * 4, (sy * W + sx) * 4 + 4), (y * W + x) * 4)
      }
    }
    const random = lcg(11)
    for (let i = 0; i < moved.data.length; i += 4) {
      if (moved.data[i + 3] === 0) continue
      for (let c = 0; c < 3; c++) moved.data[i + c] = Math.max(0, Math.min(255, moved.data[i + c]! + Math.round(random() * 12 - 6)))
    }
    return moved
  }

  const base = texturedBase()
  const hatPicture = redrawn(base, (pic) => fill(pic, HAT_BLOCK, [200, 30, 30]))
  let registeredHat: ReturnType<typeof registerToBase> | null = null
  /** Registration is the slow step; the three hat cases share one. */
  const hatRegistered = (): ReturnType<typeof registerToBase> => (registeredHat ??= registerToBase(hatPicture, base, { slot: 'head', density: 2 }))

  it('an outfit covers a base limb wider than its own, and leaves a far base limb alone', () => {
    // A base leg 4 px (@1x) wider than the outfit's on each side, with a dark outline, and a base arm far
    // from any outfit pixel.
    const W2 = FRAME.w * 2
    const limbBase = blankPicture(W2, FRAME.h * 2)
    const paint = (pic: Picture, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]): void => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) pic.data.set([...rgb, 255], (y * W2 + x) * 4)
    }
    paint(limbBase, 300, 600, 340, 800, [90, 40, 30])
    paint(limbBase, 302, 600, 338, 800, [230, 200, 180])
    paint(limbBase, 600, 600, 640, 700, [230, 200, 180])
    const outfit = blankPicture(W2, FRAME.h * 2)
    paint(outfit, 308, 600, 332, 800, [30, 40, 150])
    const cut = diffAgainstBase(outfit, limbBase, { slot: 'outfit', density: 2 })
    const layer = cutItem(outfit, cut)
    const shows: string[] = []
    // Two rows in at each end: this fixture's outfit leg begins and ends on the same rows its base leg
    // does, so the layer's own feathered rim sits on the base's, which no drawn figure does. What is being
    // measured is the *side* of the leg — where a base outline beside a narrower sleeve is the double outline.
    for (let y = 604; y < 796; y++) {
      for (let x = 280; x < 360; x++) {
        const p = (y * W2 + x) * 4
        if (layer.data[p + 3]! < limbBase.data[p + 3]!) shows.push(`${x},${y}`)
        // Nothing grows past the base's own silhouette.
        if (limbBase.data[p + 3] === 0) expect(layer.data[p + 3], `outfit outside the base leg at ${x},${y}`).toBe(0)
      }
    }
    expect(shows.length, `base pixels showing beside the outfit leg, e.g. ${shows.slice(0, 4).join(' ')}`).toBe(0)
    // The cover is the outfit's colour bled outward, not the base's skin or outline.
    const at = (700 * W2 + 301) * 4
    expect(layer.data[at + 2]! - layer.data[at]!, 'the cover takes the outfit colour').toBeGreaterThan(60)
    expect(layer.data[(650 * W2 + 620) * 4 + 3], 'a base arm with no outfit arm near it').toBe(0)
  }, 60_000)

  it('an outfit registers on the body silhouette below the chin line', () => {
    // The body moved by the drift while its head and every colour changed: only the outline is left to go by.
    const outfit = redrawn(base, (pic) => fill(fill(pic, { x0: 250, y0: 470, x1: 520, y1: 820 }, [30, 40, 150]), { x0: 250, y0: 80, x1: 520, y1: 470 }, [230, 200, 60]))
    const { dx, dy, scale, iou } = registerBySilhouette(outfit, base, { density: 2 })
    expect({ dx, dy, scale }).toEqual({ dx: -DRIFT.dx, dy: -DRIFT.dy, scale: 1 })
    expect(iou).toBeGreaterThan(0.99)
  }, 60_000)

  it('registration recovers the drift', () => {
    const { dx, dy, scale } = hatRegistered()
    expect({ dx, dy, scale }).toEqual({ dx: -DRIFT.dx, dy: -DRIFT.dy, scale: 1 })
  }, 60_000)

  it('cuts a head layer with ink only inside the hat', () => {
    const registered = hatRegistered()
    const layer = cutItem(registered.picture, diffAgainstBase(registered.picture, base, { slot: 'head', density: 2 }))
    const SLACK = 2
    const strays: string[] = []
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (layer.data[(y * W + x) * 4 + 3] === 0) continue
        const inside = x >= HAT_BLOCK.x0 - SLACK && x < HAT_BLOCK.x1 + SLACK && y >= HAT_BLOCK.y0 - SLACK && y < HAT_BLOCK.y1 + SLACK
        if (!inside) strays.push(`${x},${y}`)
      }
    }
    expect(strays.length, `ink outside the hat, e.g. ${strays.slice(0, 5).join(' ')}`).toBe(0)
    const box = alphaBBox(layer, 128)!
    expect(box, 'the hat itself is missing').not.toBeNull()
    expect(Math.abs(box.x - HAT_BLOCK.x0)).toBeLessThanOrEqual(SLACK)
    expect(Math.abs(box.y - HAT_BLOCK.y0)).toBeLessThanOrEqual(SLACK)
    expect(Math.abs(box.x + box.w - HAT_BLOCK.x1)).toBeLessThanOrEqual(SLACK)
    expect(Math.abs(box.y + box.h - HAT_BLOCK.y1)).toBeLessThanOrEqual(SLACK)
  }, 60_000)

  it('without registration the same picture leaks the figure', () => {
    // The control for the two cases above: a 3 px drift on a textured figure is change along every edge.
    const layer = cutItem(hatPicture, diffAgainstBase(hatPicture, base, { slot: 'head', density: 2 }))
    let outside = 0
    for (let y = HAT_BLOCK.y1 + 10; y < 520; y++) {
      for (let x = 0; x < W; x++) if (layer.data[(y * W + x) * 4 + 3]! > 0) outside++
    }
    expect(outside).toBeGreaterThan(100)
  }, 60_000)

  it('keeps nothing of an outfit above the chin line, even when the head changed too', () => {
    const outfitPicture = redrawn(base, (pic) => fill(fill(pic, CLOTHES_BLOCK, [30, 40, 150]), { x0: 280, y0: 90, x1: 500, y1: 470 }, [230, 200, 60]))
    const registered = registerToBase(outfitPicture, base, { slot: 'outfit', density: 2 })
    const { mask } = diffAgainstBase(registered.picture, base, { slot: 'outfit', density: 2 })
    let above = 0
    for (let p = 0; p < OUTFIT_TOP_Y * 2 * W; p++) if (mask[p]! > 0) above++
    expect(above, 'mask pixels above y 236 @1x').toBe(0)
    expect(mask[650 * W + 380], 'the clothes themselves').toBeGreaterThan(0)
  }, 60_000)

  it('writes a square icon at both densities with the ink centred', async () => {
    const dir = caseDir('icon')
    const registered = hatRegistered()
    const layer = cutItem(registered.picture, diffAgainstBase(registered.picture, base, { slot: 'head', density: 2 }))
    const manifest = { files: {}, icons: {} as Record<string, { kind: string; of: string; w: number; h: number; bytes2x: number; real?: boolean }> }
    const name = await writeIcon(layer, dir, 'item_head_tophat01_L80', manifest, { real: true })
    expect(name).toBe('item_head_tophat01_icon')
    expect(iconName('item_face_glasses_round_gold01_L70')).toBe('item_face_glasses_round_gold01_icon')
    expect(manifest.icons[name]).toEqual({
      kind: 'icon',
      of: 'item_head_tophat01_L80',
      w: ICON.w,
      h: ICON.h,
      bytes2x: statSync(join(dir, `${name}@2x.png`)).size,
      real: true,
    })
    for (const density of DENSITIES) {
      const icon = await readPicture(join(dir, `${name}@${density}x.png`))
      expect([icon.width, icon.height]).toEqual([ICON.w * density, ICON.h * density])
      const box = alphaBBox(icon)!
      expect(box, `@${density}x icon is empty`).not.toBeNull()
      // Fitted into 84 % of the square along its longer side, and centred on both axes.
      expect(Math.abs(Math.max(box.w, box.h) - ICON.w * density * ICON.fill)).toBeLessThanOrEqual(2 * density)
      expect(Math.abs(box.x + box.w / 2 - (ICON.w * density) / 2)).toBeLessThanOrEqual(density)
      expect(Math.abs(box.y + box.h / 2 - (ICON.h * density) / 2)).toBeLessThanOrEqual(density)
    }
  }, 60_000)
})

// ─────────────────────────────────────────────── an outfit layer holds no skin ──

/**
 * R1, 2026-09-17: an outfit layer is clothing only, so that bases which share F01's body but not her
 * skin tone can wear the same one. Two figures are built at @2x — the same body, one in its grey
 * underwear and one in a dress with bare arms and legs — and the layer cut between them is held to
 * three things: no pixel of the base's skin outside the underwear band, the band covered (which is what
 * C6 then measures), and a *recoloured* body showing its own legs through it.
 */
describe('an outfit layer cut from a base with skin and underwear', () => {
  const W = FRAME.w * 2
  const H = FRAME.h * 2
  /** The base's skin, the base's underwear, the dress, and the darker skin the same layer is worn over. */
  const S1: [number, number, number] = [236, 202, 176]
  const UNDER: [number, number, number] = [158, 164, 176]
  const DRESS: [number, number, number] = [36, 46, 128]
  const S2: [number, number, number] = [124, 88, 62]
  const OUTLINE: [number, number, number] = [62, 44, 36]
  /** In @2x pixels. The head fills the window `baseSkinColour` measures, the torso fills the band. */
  const HEAD = { x0: 268, y0: 110, x1: 516, y1: 470 }
  const TORSO = { x0: 300, y0: 474, x1: 470, y1: 598 }
  const ARMS = [{ x0: 256, y0: 480, x1: 298, y1: 640 }, { x0: 472, y0: 480, x1: 514, y1: 640 }]
  const LEGS = [{ x0: 316, y0: 598, x1: 376, y1: 800 }, { x0: 394, y0: 598, x1: 454, y1: 800 }]
  /** The dress: wider than the torso, and stopping well above the legs so bare skin is left below it. */
  const SKIRT = { x0: 288, y0: 470, x1: 482, y1: 660 }
  /**
   * The dress's sleeves: drawn to the base's arm *inside its line art*, which is what a generator does —
   * the sleeve stops where the colour stops and the base's own 3 px outline is left standing beside it.
   * That outline is the double outline, and covering it is the whole job of `coverBaseLimbs`.
   */
  const SLEEVES = [{ x0: 259, y0: 480, x1: 295, y1: 620 }, { x0: 475, y0: 480, x1: 511, y1: 620 }]

  type Box = { x0: number; y0: number; x1: number; y1: number }
  const paint = (pic: Picture, box: Box, rgb: [number, number, number]): void => {
    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) pic.data.set([...rgb, 255], (y * W + x) * 4)
    }
  }
  /** A box with a 3 px rim of line art, which is the thing a double outline would be made of. */
  const paintInked = (pic: Picture, box: Box, rgb: [number, number, number]): void => {
    paint(pic, box, OUTLINE)
    paint(pic, { x0: box.x0 + 3, y0: box.y0, x1: box.x1 - 3, y1: box.y1 }, rgb)
  }

  function figure(skin: [number, number, number], torso: [number, number, number] | null, extra: (pic: Picture) => void = () => {}): Picture {
    const pic = blankPicture(W, H)
    paint(pic, HEAD, skin)
    if (torso) paint(pic, TORSO, torso)
    for (const arm of ARMS) paintInked(pic, arm, skin)
    for (const leg of LEGS) paintInked(pic, leg, skin)
    extra(pic)
    return pic
  }

  const base = figure(S1, UNDER)
  const dressed = figure(S1, null, (pic) => {
    paint(pic, SKIRT, DRESS)
    for (const sleeve of SLEEVES) paint(pic, sleeve, DRESS)
  })
  const cut = diffAgainstBase(dressed, base, { slot: 'outfit', density: 2 })
  const layer = cutItem(dressed, cut)
  const alphaAt = (pic: Picture, x: number, y: number): number => pic.data[(y * W + x) * 4 + 3]!
  const rgbAt = (pic: Picture, x: number, y: number): number[] => [...pic.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)]

  it('measures the base own skin from its face, not from a constant', () => {
    expect(baseSkinColour(base, 2)!.map(Math.round)).toEqual(S1)
  })

  it('keeps no pixel of the base skin below the underwear band', () => {
    const strays: string[] = []
    for (let y = UNDERWEAR_BAND.y1 * 2; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (alphaAt(layer, x, y) <= 128) continue
        const [r, g, b] = rgbAt(layer, x, y)
        if (Math.hypot(r! - S1[0], g! - S1[1], b! - S1[2]) <= 24) strays.push(`${x},${y}`)
      }
    }
    expect(strays.length, `skin in the layer below the band, e.g. ${strays.slice(0, 5).join(' ')}`).toBe(0)
    // The bare leg is not in the layer at all — not even as alpha the base would show through.
    expect(alphaAt(layer, 346, 740), 'the middle of a bare leg').toBe(0)
  })

  it('covers every thread of the underwear, which is what C6 measures', () => {
    for (let y = TORSO.y0; y < TORSO.y1; y += 8) {
      for (let x = TORSO.x0; x < TORSO.x1; x += 8) {
        expect(alphaAt(layer, x, y), `underwear at ${x},${y}`).toBeGreaterThan(128)
      }
    }
  })

  it('passes C6 against the body it was cut from', async () => {
    const dir = caseDir('skin-free')
    const bytes = {
      body_f_L30: await writeDensities(base, dir, 'body_f_L30'),
      item_outfit_dealer01_L40: await writeDensities(layer, dir, 'item_outfit_dealer01_L40'),
    }
    const manifest = manifestFor(dir, {
      body_f_L30: { layer: LAYERS.body, w: FRAME.w, h: FRAME.h, bytes2x: bytes.body_f_L30, real: true },
      item_outfit_dealer01_L40: { layer: LAYERS.outfit, w: FRAME.w, h: FRAME.h, bytes2x: bytes.item_outfit_dealer01_L40, real: true, cutOn: 'f' },
    })
    const c6 = (await checkOne(dir, 'item_outfit_dealer01_L40', manifest)).get('C6')!
    expect(c6.ok, c6.detail).toBe(true)
    expect(c6.detail).toContain('100.0 %')
  }, 30_000)

  it('still bridges a sleeve that is narrower than the base arm, with no base outline beside it', () => {
    // The sleeve stops at the arm's line art; the layer carries over it to the base's own silhouette, so
    // the outline is under the layer rather than beside it. Below the band, where the old union added
    // nothing at all and the cover was the only thing there was.
    // 2026-09-21 (R3): what the layer takes there is the *picture's* own pixel — the arm's outline, which
    // the picture draws too — rather than a bleed of the dress's colour, which is only used where the
    // picture has nothing. Either way the base's outline does not stand beside the sleeve.
    for (let y = UNDERWEAR_BAND.y1 * 2 + 4; y < 616; y += 4) {
      for (let x = ARMS[0]!.x0; x < SLEEVES[0]!.x0; x++) {
        expect(alphaAt(layer, x, y), `base arm showing beside the sleeve at ${x},${y}`).toBeGreaterThan(128)
      }
      const rgb = rgbAt(layer, ARMS[0]!.x0 + 1, y)
      expect(rgb, `the layer takes the picture own outline at ${ARMS[0]!.x0 + 1},${y}`).toEqual(OUTLINE)
    }
  })

  it('shows a differently-skinned body own legs, arms and neck through the same layer', () => {
    const other = figure(S2, UNDER)
    const composite = blankPicture(W, H)
    overPicture(composite, other)
    overPicture(composite, layer)
    // A leg, an arm below the sleeve, and the skin just under the hem: all of them S2, none of them S1.
    for (const [x, y] of [[346, 740], [424, 700], [346, 670], [270, 632]] as [number, number][]) {
      const [r, g, b] = rgbAt(composite, x, y)
      expect([r, g, b], `at ${x},${y}`).toEqual(S2)
    }
  })
})

// ───────────────────────── pale cloth is not skin, and the underwear never shows ──

/**
 * R1–R3, 2026-09-21. Three faults the first eight real outfits showed, each as a synthetic figure.
 *
 * The base is the shape the real ones are: a head (which is where `baseSkinColour` reads the skin), a
 * light tank top, **darker shorts that flare 6 px (@1x) wider than the outfit's trousers at the hip**, and
 * bare arms and legs inside their own line art. Two outfits are cut from it — trousers and a skirt — and
 * the trousers carry the two things that used to punch holes in a layer: a fold of white cloth shaded to
 * exactly the base's skin colour, and a patch the colour of the base's tank top, both fully inside cloth.
 */
describe('an outfit of pale cloth over a base with skin and underwear', () => {
  const W = FRAME.w * 2
  const H = FRAME.h * 2
  type RGB = [number, number, number]
  /** The base's own skin, and the skin of the second base the same layer is worn by. */
  const S1: RGB = [236, 202, 176]
  const S2: RGB = [124, 88, 62]
  /** The base's underwear: a light tank top and darker shorts, each with the figure's line art. */
  const TANK: RGB = [206, 204, 214]
  const SHORTS: RGB = [101, 91, 104]
  const OUTLINE: RGB = [62, 44, 36]
  /** The outfit: white cloth, and the fold of it shaded to the base's skin colour to the byte. */
  const WHITE: RGB = [250, 249, 246]
  const SHADE: RGB = S1

  type Box = { x0: number; y0: number; x1: number; y1: number }
  const HEAD: Box = { x0: 268, y0: 110, x1: 516, y1: 470 }
  const TORSO: Box = { x0: 300, y0: 474, x1: 470, y1: 598 }
  /** The shorts, 12 px @2x wider than the trousers on each side: D2's grey notch at the hip. */
  const HIPS: Box = { x0: 298, y0: 598, x1: 472, y1: 660 }
  const ARMS: Box[] = [{ x0: 256, y0: 480, x1: 298, y1: 640 }, { x0: 472, y0: 480, x1: 514, y1: 640 }]
  const LEGS: Box[] = [{ x0: 320, y0: 660, x1: 378, y1: 830 }, { x0: 392, y0: 660, x1: 450, y1: 830 }]
  /** The outfit's own blocks: a top, a hip the shorts stick out of, and two trouser legs. */
  const TOP: Box = { x0: 300, y0: 470, x1: 470, y1: 600 }
  const HIP_CLOTH: Box = { x0: 310, y0: 600, x1: 460, y1: 664 }
  const TROUSERS: Box[] = [{ x0: 312, y0: 664, x1: 384, y1: 830 }, { x0: 386, y0: 664, x1: 458, y1: 830 }]
  /** Inside the left trouser leg, nowhere near its edge: the shaded fold. */
  const FOLD: Box = { x0: 332, y0: 690, x1: 356, y1: 800 }
  /** Inside the top, nowhere near its edge: a patch the colour of the tank top underneath it. */
  const PATCH: Box = { x0: 350, y0: 500, x1: 392, y1: 546 }
  /** The skirt of the second outfit, which leaves the legs bare from y 700 down. */
  const SKIRT: Box = { x0: 288, y0: 470, x1: 482, y1: 700 }

  const paint = (pic: Picture, box: Box, rgb: RGB): void => {
    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) pic.data.set([...rgb, 255], (y * W + x) * 4)
    }
  }
  /** A box with a 3 px rim of line art — the base's own outline, which is not skin and not cloth. */
  const paintInked = (pic: Picture, box: Box, rgb: RGB): void => {
    paint(pic, box, OUTLINE)
    paint(pic, { x0: box.x0 + 3, y0: box.y0, x1: box.x1 - 3, y1: box.y1 }, rgb)
  }

  /** The base: head, tank, shorts, inked arms and legs. `dressed` swaps the underwear for an outfit. */
  function figure(skin: RGB, underwear: boolean, extra: (pic: Picture) => void = () => {}): Picture {
    const pic = blankPicture(W, H)
    paint(pic, HEAD, skin)
    for (const arm of ARMS) paintInked(pic, arm, skin)
    for (const leg of LEGS) paintInked(pic, leg, skin)
    paint(pic, { ...TORSO, y1: HIPS.y1 }, skin)
    if (underwear) {
      paintInked(pic, TORSO, TANK)
      paintInked(pic, HIPS, SHORTS)
    }
    extra(pic)
    return pic
  }

  const base = figure(S1, true)
  const otherBase = figure(S2, true)
  const trousered = figure(S1, false, (pic) => {
    paint(pic, TOP, WHITE)
    paint(pic, PATCH, TANK)
    paint(pic, HIP_CLOTH, WHITE)
    for (const leg of TROUSERS) paint(pic, leg, WHITE)
    paint(pic, FOLD, SHADE)
  })
  const skirted = figure(S1, false, (pic) => {
    paint(pic, TOP, WHITE)
    paint(pic, SKIRT, WHITE)
  })

  const trousers = cutItem(trousered, diffAgainstBase(trousered, base, { slot: 'outfit', density: 2 }))
  const skirt = cutItem(skirted, diffAgainstBase(skirted, base, { slot: 'outfit', density: 2 }))
  const alphaAt = (pic: Picture, x: number, y: number): number => pic.data[(y * W + x) * 4 + 3]!
  const rgbAt = (pic: Picture, x: number, y: number): RGB => [...pic.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)] as RGB
  const compose = (body: Picture, layer: Picture): Picture => {
    const out = blankPicture(W, H)
    overPicture(out, body)
    overPicture(out, layer)
    return out
  }
  const scan = (box: Box, visit: (x: number, y: number) => void): void => {
    for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) visit(x, y)
  }

  it('keeps a fold of white cloth shaded to the base own skin colour', () => {
    // D1: the fold is within `skinTol` of the base's skin *and* sits over the base's bare leg, so the
    // difference drops every pixel of it. R1 puts it back: a gap enclosed by cloth is cloth.
    const holes: string[] = []
    scan(FOLD, (x, y) => {
      if (alphaAt(trousers, x, y) <= 128) holes.push(`${x},${y}`)
    })
    expect(holes.length, `holes in the shaded fold, e.g. ${holes.slice(0, 5).join(' ')}`).toBe(0)
  })

  it('leaves that fold cloth on a base of a different skin', () => {
    const composite = compose(otherBase, trousers)
    scan(FOLD, (x, y) => {
      const rgb = rgbAt(composite, x, y)
      expect(rgb, `the fold at ${x},${y} shows the body through it`).not.toEqual(S2)
    })
    expect(rgbAt(composite, (FOLD.x0 + FOLD.x1) >> 1, (FOLD.y0 + FOLD.y1) >> 1)).toEqual(SHADE)
  })

  it('fills an enclosed patch the colour of the base tank top', () => {
    // D2's shoulder strap: the picture's own pixel happened to match the base's underwear under it, so the
    // difference called it unchanged. Enclosed by cloth, it is cloth.
    scan(PATCH, (x, y) => {
      expect(alphaAt(trousers, x, y), `the enclosed patch at ${x},${y}`).toBeGreaterThan(128)
    })
  })

  it('leaves the thighs under a skirt open for the body to draw', () => {
    // The counterpart of the two above: a gap that reaches the outside of the silhouette is a gap.
    const composite = compose(otherBase, skirt)
    for (const leg of LEGS) {
      for (let y = 740; y < 820; y += 8) {
        const x = (leg.x0 + leg.x1) >> 1
        expect(alphaAt(skirt, x, y), `the layer over a bare thigh at ${x},${y}`).toBe(0)
        expect(rgbAt(composite, x, y), `the bare thigh at ${x},${y}`).toEqual(S2)
      }
    }
  })

  it('shows no pixel of the base underwear through an outfit narrower than its shorts', () => {
    // R3: the shorts flare 6 px (@1x) past the trousers at the hip, and the picture has nothing there at
    // all — the cover has to reach them however far they are from the nearest cloth.
    for (const [name, body] of [['f', base], ['m', otherBase]] as [string, Picture][]) {
      const composite = compose(body, trousers)
      const showing: string[] = []
      const inPatch = (x: number, y: number): boolean => x >= PATCH.x0 && x < PATCH.x1 && y >= PATCH.y0 && y < PATCH.y1
      scan({ x0: 0, y0: OUTFIT_TOP_Y * 2, x1: W, y1: H }, (x, y) => {
        // The patch above is the *outfit's* own cloth, painted the tank top's colour on purpose.
        if (inPatch(x, y)) return
        const rgb = rgbAt(composite, x, y)
        if (alphaAt(composite, x, y) <= 128) return
        for (const cloth of [TANK, SHORTS]) {
          if (Math.hypot(rgb[0] - cloth[0], rgb[1] - cloth[1], rgb[2] - cloth[2]) <= 24) showing.push(`${x},${y}`)
        }
      })
      expect(showing.length, `${name}: base underwear showing, e.g. ${showing.slice(0, 6).join(' ')}`).toBe(0)
    }
  })
})

// ───────────────────────────────────────────── a limb wider than what covers it ──

/**
 * G2, 2026-09-21: the generator draws the figure a pixel or two slimmer than the base, so the base's own
 * limb sticks out past the garment. Whether that is a defect depends on what the *picture* has nearest:
 * past a trouser leg it is a leg poking out of the trousers and the layer covers it; past a bare thigh the
 * picture drew, it is simply the base's own silhouette and the layer leaves it alone.
 */
describe('a base limb wider than the picture drawn over it', () => {
  const W = FRAME.w * 2
  const H = FRAME.h * 2
  type RGB = [number, number, number]
  const S1: RGB = [236, 202, 176]
  const S2: RGB = [124, 88, 62]
  const OUTLINE: RGB = [62, 44, 36]
  const TROUSER: RGB = [24, 26, 34]
  const HEAD = { x0: 268, y0: 110, x1: 516, y1: 470 }
  /** The trousered leg: the base's is 8 px @2x (4 @1x) wider on each side than the picture's trousers. */
  const LEG = { x0: 292, y0: 600, x1: 372, y1: 830 }
  const TROUSERS = { x0: 300, y0: 600, x1: 364, y1: 830 }
  /** The bare leg: the base's is 8 px @2x wider each side than the *bare* leg the picture draws. */
  const BARE = { x0: 420, y0: 600, x1: 500, y1: 830 }
  const BARE_PICTURE = { x0: 428, y0: 600, x1: 492, y1: 830 }
  /** A torso, so that the cut has a garment at all and the figure is not two floating legs. */
  const TORSO = { x0: 292, y0: 474, x1: 500, y1: 600 }

  type Box = { x0: number; y0: number; x1: number; y1: number }
  const paint = (pic: Picture, box: Box, rgb: RGB): void => {
    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) pic.data.set([...rgb, 255], (y * W + x) * 4)
    }
  }
  const paintInked = (pic: Picture, box: Box, rgb: RGB): void => {
    paint(pic, box, OUTLINE)
    paint(pic, { x0: box.x0 + 3, y0: box.y0, x1: box.x1 - 3, y1: box.y1 }, rgb)
  }

  const body = (skin: RGB): Picture => {
    const pic = blankPicture(W, H)
    paint(pic, HEAD, skin)
    paint(pic, TORSO, skin)
    paintInked(pic, LEG, skin)
    paintInked(pic, BARE, skin)
    return pic
  }
  const base = body(S1)
  const dressed = ((): Picture => {
    const pic = blankPicture(W, H)
    paint(pic, HEAD, S1)
    paint(pic, TORSO, TROUSER)
    paintInked(pic, TROUSERS, TROUSER)
    paintInked(pic, BARE_PICTURE, S1)
    return pic
  })()
  const layer = cutItem(dressed, diffAgainstBase(dressed, base, { slot: 'outfit', density: 2 }))
  const rgbAt = (pic: Picture, x: number, y: number): RGB => [...pic.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)] as RGB
  const alphaAt = (pic: Picture, x: number, y: number): number => pic.data[(y * W + x) * 4 + 3]!

  it('covers the leg that pokes out of the trousers, on either skin tone', () => {
    for (const [name, skin] of [['f', S1], ['m', S2]] as [string, RGB][]) {
      const composite = blankPicture(W, H)
      overPicture(composite, body(skin))
      overPicture(composite, layer)
      const showing: string[] = []
      for (let y = 620; y < 810; y += 4) {
        for (let x = LEG.x0; x < TROUSERS.x0; x++) {
          const rgb = rgbAt(composite, x, y)
          if (Math.hypot(rgb[0] - skin[0], rgb[1] - skin[1], rgb[2] - skin[2]) <= 24) showing.push(`${x},${y}`)
        }
        for (let x = TROUSERS.x1; x < LEG.x1; x++) {
          const rgb = rgbAt(composite, x, y)
          if (Math.hypot(rgb[0] - skin[0], rgb[1] - skin[1], rgb[2] - skin[2]) <= 24) showing.push(`${x},${y}`)
        }
      }
      expect(showing.length, `${name}: base skin beside the trousers, e.g. ${showing.slice(0, 6).join(' ')}`).toBe(0)
    }
  })

  it('leaves the bare leg the picture drew narrower alone', () => {
    // The nearest thing the picture has beside it is its own bare leg's line art, not cloth, so the skin
    // between the two silhouettes is the base's to draw. (Its *outline* — `BARE.x0`..`+3` — is the base's
    // own line art and R3 covers that at any distance, which is the double outline rule, not this one.)
    for (let y = 620; y < 810; y += 8) {
      for (const x of [BARE.x0 + 4, BARE.x0 + 6, BARE.x1 - 5, BARE.x1 - 7]) {
        expect(alphaAt(layer, x, y), `the layer over a bare leg at ${x},${y}`).toBe(0)
      }
    }
  })
})

// ────────────────────────────────────────────────────────────────── the gate ──

describe('the ten acceptance checks', () => {
  it('passes a file the pipeline itself produced', async () => {
    const dir = caseDir('good')
    const entry = await writePlaceholder(dir, 'item_head_tophat01_L80')
    const manifest = manifestFor(dir, { item_head_tophat01_L80: entry })
    const results = await checkOne(dir, 'item_head_tophat01_L80', manifest)
    expect([...results.keys()].sort()).toEqual(['C1', 'C10', 'C11', 'C12', 'C13', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9'])
    for (const [id, result] of results) expect(result.ok, `${id}: ${result.detail}`).toBe(true)
  }, 30_000)

  it('C1 fails a layer that is not the frame size', async () => {
    const dir = caseDir('c1')
    const entry = await writePlaceholder(dir, 'item_head_tophat01_L80')
    await writePicture(solid(300, 300, [200, 40, 40, 255]), join(dir, 'item_head_tophat01_L80@1x.png'))
    const manifest = manifestFor(dir, { item_head_tophat01_L80: entry })
    expect((await checkOne(dir, 'item_head_tophat01_L80', manifest)).get('C1')!.ok).toBe(false)
  }, 30_000)

  it('C2 fails a layer that touches the frame edge', async () => {
    const dir = caseDir('c2')
    const entry = await writePlaceholder(dir, 'item_head_tophat01_L80')
    for (const density of DENSITIES) {
      await writePicture(solid(FRAME.w * density, FRAME.h * density, [200, 40, 40, 255]), join(dir, `item_head_tophat01_L80@${density}x.png`))
    }
    const manifest = manifestFor(dir, { item_head_tophat01_L80: entry })
    expect((await checkOne(dir, 'item_head_tophat01_L80', manifest)).get('C2')!.ok).toBe(false)
  }, 30_000)

  it('C3 fails a layer with a stray half-transparent pixel', async () => {
    const dir = caseDir('c3')
    const entry = await writePlaceholder(dir, 'item_head_tophat01_L80')
    for (const density of DENSITIES) {
      const file = join(dir, `item_head_tophat01_L80@${density}x.png`)
      const pic = await readPicture(file)
      // Far below the hat, in the corner nothing should reach: alpha 40, invisible and fatal.
      const at = ((pic.height - 20) * pic.width + 20) * 4
      pic.data[at + 3] = 40
      await writePicture(pic, file)
    }
    const manifest = manifestFor(dir, { item_head_tophat01_L80: entry })
    expect((await checkOne(dir, 'item_head_tophat01_L80', manifest)).get('C3')!.ok).toBe(false)
  }, 30_000)

  it('C4 fails a layer whose rim is white', async () => {
    const dir = caseDir('c4')
    // A dark disc with a white halo: exactly the artefact a bad export from a paint program leaves.
    const build = (density: number): Picture => {
      const pic = blankPicture(FRAME.w * density, FRAME.h * density)
      const cx = AXIS_X * density
      const cy = 140 * density
      const radius = 50 * density
      for (let y = 0; y < pic.height; y++) {
        for (let x = 0; x < pic.width; x++) {
          const distance = Math.hypot(x - cx, y - cy)
          const at = (y * pic.width + x) * 4
          if (distance < radius - 2 * density) {
            pic.data.set([20, 30, 60, 255], at)
          } else if (distance < radius) {
            pic.data.set([252, 252, 252, 120], at)
          }
        }
      }
      return pic
    }
    for (const density of DENSITIES) await writePicture(build(density), join(dir, `item_head_tophat01_L80@${density}x.png`))
    const bytes2x = statSync(join(dir, 'item_head_tophat01_L80@2x.png')).size
    const manifest = manifestFor(dir, { item_head_tophat01_L80: { layer: 80, w: FRAME.w, h: FRAME.h, bytes2x, placeholder: true } })
    expect((await checkOne(dir, 'item_head_tophat01_L80', manifest)).get('C4')!.ok).toBe(false)
  }, 30_000)

  it('C5 fails a head item that hangs out of the portrait crop', async () => {
    const dir = caseDir('c5')
    const build = (density: number): Picture => {
      const pic = blankPicture(FRAME.w * density, FRAME.h * density)
      for (let y = 300 * density; y < 360 * density; y++) {
        for (let x = 160 * density; x < 230 * density; x++) pic.data.set([200, 40, 40, 255], (y * pic.width + x) * 4)
      }
      return pic
    }
    for (const density of DENSITIES) await writePicture(build(density), join(dir, `item_head_tophat01_L80@${density}x.png`))
    const bytes2x = statSync(join(dir, 'item_head_tophat01_L80@2x.png')).size
    const manifest = manifestFor(dir, { item_head_tophat01_L80: { layer: 80, w: FRAME.w, h: FRAME.h, bytes2x, placeholder: true } })
    expect((await checkOne(dir, 'item_head_tophat01_L80', manifest)).get('C5')!.ok).toBe(false)
  }, 30_000)

  /** The committed real body f at both densities, written into `dir` as `body_f_L30`, with its entry. */
  async function realBodyF(dir: string): Promise<Record<string, ManifestEntry>> {
    for (const density of DENSITIES) cpSync(join(OUT_DIR, `body_f_L30@${density}x.png`), join(dir, `body_f_L30@${density}x.png`))
    return { body_f_L30: { layer: LAYERS.body, w: FRAME.w, h: FRAME.h, bytes2x: statSync(join(dir, 'body_f_L30@2x.png')).size, real: true } }
  }
  /** A tiny scrap where a full outfit should be, at both densities, as `item_outfit_casual01_L40`. */
  async function outfitScrap(dir: string): Promise<number> {
    const build = (density: number): Picture => {
      const pic = blankPicture(FRAME.w * density, FRAME.h * density)
      for (let y = 240 * density; y < 260 * density; y++) {
        for (let x = 180 * density; x < 205 * density; x++) pic.data.set([30, 60, 200, 255], (y * pic.width + x) * 4)
      }
      return pic
    }
    for (const density of DENSITIES) await writePicture(build(density), join(dir, `item_outfit_casual01_L40@${density}x.png`))
    return statSync(join(dir, 'item_outfit_casual01_L40@2x.png')).size
  }

  it('C6 fails an outfit that leaves the body showing', async () => {
    const dir = caseDir('c6')
    const bytes2x = await outfitScrap(dir)
    const outfit: ManifestEntry = { layer: 40, w: FRAME.w, h: FRAME.h, bytes2x, real: true, cutOn: 'f' }
    const manifest = manifestFor(dir, { ...await realBodyF(dir), item_outfit_casual01_L40: outfit })
    const c6 = (await checkOne(dir, 'item_outfit_casual01_L40', manifest)).get('C6')!
    expect(c6.ok, c6.detail).toBe(false)
    expect(c6.detail).toContain("leaves body_f_L30's underwear showing")
  }, 60_000)

  it('C6 fails a real outfit layer cut on no body: every outfit is cut on body f or m (Plan 19 D1)', async () => {
    // Before D1 an outfit without `cutOn` was measured against the old bases. They are gone, and so is that branch:
    // a real outfit layer that names no body (or an old base) is a layer nobody re-cut for the v4 pose.
    const dir = caseDir('c6-no-body')
    const bytes2x = await outfitScrap(dir)
    const body = await realBodyF(dir)
    for (const cutOn of [undefined, 'f01']) {
      const outfit: ManifestEntry = { layer: 40, w: FRAME.w, h: FRAME.h, bytes2x, real: true, ...(cutOn ? { cutOn } : {}) }
      const c6 = (await checkOne(dir, 'item_outfit_casual01_L40', manifestFor(dir, { ...body, item_outfit_casual01_L40: outfit }))).get('C6')!
      expect(c6.ok, `cutOn ${String(cutOn)}: ${c6.detail}`).toBe(false)
      expect(c6.detail).toMatch(/cut on no body/)
    }
  }, 60_000)

  it('C6 passes the same outfit when the check is skipped', async () => {
    const dir = caseDir('c6-skip')
    const outfit = await writePlaceholder(dir, 'item_outfit_casual01_L40')
    const manifest = manifestFor(dir, { ...await realBodyF(dir), item_outfit_casual01_L40: outfit })
    const [row] = await runChecks({ dir, manifest, names: ['item_outfit_casual01_L40'], skip: ['C6'] })
    const c6 = row!.results.find((result: { id: string }) => result.id === 'C6')!
    expect(c6.ok).toBe(true)
    expect(c6.detail).toMatch(/skip/i)
  }, 60_000)

  it('C7 fails a 1x that is not the 2x scaled down', async () => {
    const dir = caseDir('c7')
    const entry = await writePlaceholder(dir, 'item_head_tophat01_L80')
    const other = await renderSvg(placeholderSvg(stageOneFiles().find((file) => file.name === 'item_aura_fire01_L10')!, 1), FRAME.w, FRAME.h)
    await writePicture(other, join(dir, 'item_head_tophat01_L80@1x.png'))
    const manifest = manifestFor(dir, { item_head_tophat01_L80: entry })
    expect((await checkOne(dir, 'item_head_tophat01_L80', manifest)).get('C7')!.ok).toBe(false)
  }, 30_000)

  it('C8 fails a name that breaks the convention', async () => {
    const dir = caseDir('c8')
    const entry = await writePlaceholder(dir, 'item_head_tophat01_L80')
    for (const density of DENSITIES) {
      cpSync(join(dir, `item_head_tophat01_L80@${density}x.png`), join(dir, `item_hat_TopHat01_L80@${density}x.png`))
    }
    const manifest = manifestFor(dir, { item_hat_TopHat01_L80: entry })
    expect((await checkOne(dir, 'item_hat_TopHat01_L80', manifest)).get('C8')!.ok).toBe(false)
  }, 30_000)

  it('C9 fails a file the manifest does not list at the layer its name claims', async () => {
    const dir = caseDir('c9')
    const entry = await writePlaceholder(dir, 'item_head_tophat01_L80')
    const manifest = manifestFor(dir, { item_head_tophat01_L80: { ...entry, layer: 40 } })
    expect((await checkOne(dir, 'item_head_tophat01_L80', manifest)).get('C9')!.ok).toBe(false)
  }, 30_000)

  it('C10 fails a layer that is over the size budget', async () => {
    const dir = caseDir('c10')
    // Random noise does not compress, so a 768 × 896 PNG of it clears 400 KB several times over. It has
    // to be an actual pseudo-random sequence: a periodic one (`i * k % 251`) deflates to nothing.
    const noise = blankPicture(FRAME.w * 2, FRAME.h * 2)
    let state = 0x2545f491
    for (let i = 0; i < noise.data.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      noise.data[i] = state >>> 24
    }
    await writePicture(noise, join(dir, 'item_head_tophat01_L80@2x.png'))
    await writePicture(await sharpDownscale(noise), join(dir, 'item_head_tophat01_L80@1x.png'))
    const bytes2x = statSync(join(dir, 'item_head_tophat01_L80@2x.png')).size
    expect(bytes2x).toBeGreaterThan(400 * 1024)
    const manifest = manifestFor(dir, { item_head_tophat01_L80: { layer: 80, w: FRAME.w, h: FRAME.h, bytes2x, placeholder: true } })
    expect((await checkOne(dir, 'item_head_tophat01_L80', manifest)).get('C10')!.ok).toBe(false)
  }, 30_000)
})

async function sharpDownscale(pic: Picture): Promise<Picture> {
  const { data, info } = await sharp(pic.data, { raw: { width: pic.width, height: pic.height, channels: 4 } })
    .resize(FRAME.w, FRAME.h)
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

// ──────────────────────────────────────────────────────── the committed set ──

/** Every PNG the stage-1 set puts on disk: each layer, and each item's icon, at both densities — plus, from the
 * manifest, each layer's masks and the tint mask of each icon flagged `tintMask` (Plan 18, No8a). */
function stageOnePngs(
  layers: string[] = (stageOneFiles() as { name: string }[]).map((file) => file.name),
  items: string[] = (stageOneFiles() as { name: string; kind: string }[]).filter((file) => file.kind === 'item').map((file) => file.name),
  manifest?: Manifest,
): string[] {
  const names = [...layers, ...items.map((name) => iconName(name))]
  const pngs = names.flatMap((name) => DENSITIES.map((density: number) => `${name}@${density}x.png`))

  // Add mask files for each layer that has masks in the manifest.
  if (manifest) {
    const maskFileKind = { hair: 'hair', eyes: 'eye', tint: 'tint', skin: 'skin', skinLine: 'skinline' }
    for (const layerName of layers) {
      const entry = manifest.files[layerName]
      if (entry?.masks) {
        for (const kind of Object.keys(entry.masks)) {
          const fileKind = maskFileKind[kind as keyof typeof maskFileKind]
          if (fileKind) {
            pngs.push(...DENSITIES.map((density: number) => `${layerName}_${fileKind}mask@${density}x.png`))
          }
        }
      }
    }
    // …and each icon's own tint mask, where the manifest flags one.
    for (const item of items) {
      const icon = iconName(item)
      if (manifest.icons?.[icon]?.tintMask === true) pngs.push(...DENSITIES.map((density: number) => `${icon}_tintmask@${density}x.png`))
    }
  }

  return pngs
}

describe('the stage-1 name list', () => {
  const files = stageOneFiles()

  it('is the list the design names in §4.4, and nothing else', () => {
    const byKind = (kind: string): string[] => files.filter((file: { kind: string }) => file.kind === kind).map((file: { name: string }) => file.name)
    // Plan 19 D1: the six flat bases (f01…m03) and their faces are retired — the stage set is bodies, their faces,
    // hairstyles, items and bots, and no name on it is a base's.
    expect([...new Set(files.map((file: { kind: string }) => file.kind))].sort()).toEqual(['body', 'bodyFace', 'bot', 'botFace', 'hair', 'item'])
    expect(files.filter((file: { name: string }) => file.name.startsWith('base_'))).toEqual([])
    expect(byKind('item').filter((name) => name.startsWith('item_head_'))).toHaveLength(8)
    expect(byKind('item').filter((name) => name.startsWith('item_face_'))).toHaveLength(4)
    expect(byKind('item').filter((name) => name.startsWith('item_outfit_'))).toHaveLength(6)
    expect(byKind('item').filter((name) => name.startsWith('item_aura_'))).toHaveLength(8)
    expect(byKind('item').filter((name) => name.startsWith('item_frame_'))).toHaveLength(6)
    expect(byKind('bot')).toHaveLength(8)
    expect(byKind('botFace')).toHaveLength(48)
    // Plan 19 (spec §5.3): the v4 bodies, their twelve faces and eight hairstyles of two layers each.
    expect(byKind('body')).toEqual(['body_f_L30', 'body_m_L30'])
    expect(byKind('bodyFace')).toHaveLength(12)
    expect(byKind('hair').sort()).toEqual(HAIR_CODES.flatMap((code: string) => [hairFile(code, 20), hairFile(code, 60)]).sort())
    expect(byKind('hair')).toHaveLength(16)
    // 172 before D1, less the six bases' three layers and six faces each (54).
    expect(files).toHaveLength(118)
    expect(files.map((file: { name: string }) => file.name)).toContain('item_head_tophat01_L80')
    expect(files.map((file: { name: string }) => file.name)).toContain('item_frame_founder_L90')
    expect(files.map((file: { name: string }) => file.name)).toContain('bot_7_face_sleep_L50')
  })

  it('reads no base name any more: a retired base_* name is not a legal one (Plan 19 D1)', () => {
    for (const name of ['base_f01_L30', 'base_m01_face_happy_L50', 'base_f02_L60']) {
      expect(parseName(name), name).toBeNull()
      expect(NAME_PATTERN.test(name), name).toBe(false)
    }
  })

  it('gives every entry the layer its name ends in', () => {
    const known = new Set(Object.values(LAYERS))
    for (const file of files as { name: string; layer: number }[]) {
      expect(known.has(file.layer), `${file.name} claims layer ${file.layer}`).toBe(true)
      expect(file.name.endsWith(`_L${file.layer}`), file.name).toBe(true)
    }
  })
})

describe('v4 names (spec §5.3)', () => {
  it('names bodies, body faces and both hair layers, and reads them back', () => {
    expect(bodyFile('f')).toBe('body_f_L30')
    expect(bodyFaceFile('m', 'happy')).toBe('body_m_face_happy_L50')
    expect(hairFile('f_bob01', 20)).toBe('item_hair_f_bob01_L20')
    expect(hairItemId('m_spiky01')).toBe('hair_m_spiky01')
    expect(parseName('body_f_L30')).toEqual({ kind: 'body', layer: 30, gender: 'f' })
    expect(parseName('body_m_face_sleep_L50')).toEqual({ kind: 'bodyFace', layer: 50, gender: 'm', expr: 'sleep' })
    expect(parseName('item_hair_m_spiky01_L60')).toEqual({ kind: 'hair', layer: 60, gender: 'm', code: 'm_spiky01' })
    for (const bad of ['body_x_L30', 'body_f_L50', 'item_hair_f_bob01_L30', 'item_hair_bob01_L60', 'item_hair_f_bob01_m_L60', 'item_hair_x_bob01_L20']) {
      expect(parseName(bad), bad).toBeNull()
      expect(NAME_PATTERN.test(bad), bad).toBe(false)
    }
  })
})

describe('the committed placeholder set', () => {
  const manifest = JSON.parse(readFileSync(WEB_MANIFEST, 'utf8')) as Manifest
  /**
   * The per-wear cuts the manifest carries (§3.1). `placeholder` never invents one — a variant is not part
   * of the stage-1 set at all — so the manifest is what says which exist, and the set on disk is the
   * stage-1 list plus these. What is held about them here is that each is real, wears a wear the pipeline
   * knows, and is a cut of a layer that *is* on the list.
   */
  const variants = Object.entries(manifest.files).filter(([, entry]) => entry.variantOf !== undefined)
  const variantLayers = variants.map(([name]) => name)
  const committedLayers = [...(stageOneFiles() as { name: string }[]).map((file) => file.name), ...variantLayers]
  const committedItems = [
    ...(stageOneFiles() as { name: string; kind: string }[]).filter((file) => file.kind === 'item').map((file) => file.name),
    ...variantLayers,
  ]

  it('cuts every per-wear variant from a stage-1 layer, for a wear the pipeline knows', () => {
    const stageOne = new Set((stageOneFiles() as { name: string }[]).map((file) => file.name))
    for (const [name, entry] of variants) {
      expect(entry.real, `${name} is a variant, which only ingest writes`).toBe(true)
      expect(WEARS, `${name} wears ${entry.wear}`).toContain(entry.wear)
      expect(stageOne.has(entry.variantOf!), `${name} is a cut of ${entry.variantOf}, which is not a stage-1 layer`).toBe(true)
      expect(name, `${name} does not name ${entry.variantOf} and its wear`).toBe(variantFile(entry.variantOf!, entry.wear!))
    }
  })

  it('holds every stage-1 name and every item icon at both densities, and nothing else', () => {
    const onDisk = readdirSync(OUT_DIR).filter((name) => name.endsWith('.png'))
    expect(onDisk.sort()).toEqual(stageOnePngs(committedLayers, committedItems, manifest).sort())
  })

  it('lists an icon for every item layer, flagged the way the layer is', async () => {
    expect(Object.keys(manifest.icons ?? {}).sort()).toEqual(committedItems.map((name) => iconName(name)).sort())
    for (const name of committedItems) {
      const icon = iconName(name)
      const entry = manifest.icons![icon]!
      expect(entry, icon).toMatchObject({ kind: 'icon', of: name, w: ICON.w, h: ICON.h })
      expect(entry.bytes2x, icon).toBe(statSync(join(OUT_DIR, `${icon}@2x.png`)).size)
      expect(entry.real === true, `${icon} is real exactly when ${name} is`).toBe(manifest.files[name]!.real === true)
      expect(entry.placeholder === true, `${icon} is a stand-in exactly when ${name} is`).toBe(manifest.files[name]!.placeholder === true)
      for (const density of DENSITIES) {
        const meta = await sharp(join(OUT_DIR, `${icon}@${density}x.png`)).metadata()
        expect([meta.width, meta.height], `${icon}@${density}x`).toEqual([ICON.w * density, ICON.h * density])
      }
    }
  }, 60_000)

  it('gives every tint-masked item layer an icon tint mask at both densities, the size of the icon and on its ink', async () => {
    // Plan 18 (No8a): the wardrobe tints a colour variant's icon the way it tints the worn layer, so every layer
    // with a tint mask — today these four — has `<icon>_tintmask`, cut with the icon's own fit and flagged on the
    // icon's manifest entry (a field, not a key of its own).
    const tinted = committedItems.filter((name) => manifest.files[name]!.masks?.tint !== undefined)
    expect([...tinted].sort()).toEqual(['item_head_beanie01_L80', 'item_head_beret_red01_L80', 'item_head_party_cone01_L80', 'item_outfit_casual01_L40'])
    const flagged = Object.entries(manifest.icons ?? {}).filter(([, entry]) => entry.tintMask === true).map(([icon]) => icon)
    expect(flagged.sort()).toEqual(tinted.map((name) => iconName(name)).sort())
    for (const name of tinted) {
      const icon = iconName(name)
      for (const density of DENSITIES) {
        const file = join(OUT_DIR, `${icon}_tintmask@${density}x.png`)
        expect(existsSync(file), `${icon}_tintmask@${density}x.png`).toBe(true)
        const [mask, picture] = await Promise.all([readPicture(file), readPicture(join(OUT_DIR, `${icon}@${density}x.png`))])
        expect([mask.width, mask.height], `${icon}_tintmask@${density}x`).toEqual([picture.width, picture.height])
        // Cut with the icon's own box and fit, so the mask sits on the icon's ink rather than beside it.
        let inked = 0
        let onIcon = 0
        for (let p = 0; p < mask.width * mask.height; p++) {
          if (mask.data[p * 4 + 3]! < 128) continue
          inked++
          if (picture.data[p * 4 + 3]! > 8) onIcon++
        }
        expect(inked, `${icon}_tintmask@${density}x is empty`).toBeGreaterThan(0)
        expect(onIcon / inked, `${icon}_tintmask@${density}x off the icon's ink`).toBeGreaterThan(0.99)
      }
    }
  }, 60_000)

  it('gives every real front hair and v4 outfit the skin its picture redrew — the outfits’ only at the insteps — and keeps each hair mask at its ink’s meanL (2026-10-05)', async () => {
    const fronts = committedLayers.filter((name) => parseName(name)?.kind === 'hair' && parseName(name)?.layer === LAYERS.hairFront && manifest.files[name]!.real === true)
    const outfits = committedLayers.filter((name) => name.startsWith('item_outfit_') && manifest.files[name]!.cutOn !== undefined && manifest.files[name]!.real === true)
    expect(fronts).toHaveLength(8)
    expect(outfits).toHaveLength(8)
    for (const name of [...fronts, ...outfits]) {
      expect(manifest.files[name]!.masks?.skin, `${name} has no skin mask`).toBeDefined()
      for (const density of DENSITIES) expect(existsSync(join(OUT_DIR, `${name}_skinmask@${density}x.png`)), `${name}_skinmask@${density}x.png`).toBe(true)
    }
    const alphaOf = async (file: string) => {
      const pic = await readPicture(join(OUT_DIR, file))
      const alpha = new Uint8Array(pic.width * pic.height)
      for (let p = 0; p < alpha.length; p++) alpha[p] = pic.data[p * 4 + 3]!
      return { alpha, width: pic.width }
    }
    // The Tết áo dài (both cuts) and the royal robe redrew an instep inside a slipper; no outfit redrew any other skin —
    // not the gold trim the Tết's collar, cuffs and slit lay over the body's skin (pre-flight B1).
    const withSkin = outfits.filter((name) => manifest.files[name]!.masks!.skin!.empty !== true)
    expect(withSkin.sort()).toEqual(['item_outfit_royal_robe01_L40', 'item_outfit_tet_red01_L40', 'item_outfit_tet_red01_m_L40'])
    for (const name of withSkin) {
      const { alpha, width } = await alphaOf(`${name}_skinmask@2x.png`)
      let off = 0
      for (let p = 0; p < alpha.length; p++) if (alpha[p] && Math.floor(p / width) < 760) off++
      expect(off, `${name}'s skin above the feet`).toBe(0)
    }
    // A hair mask is its ink less the skin's share, and its meanL the ink's as committed before the skin was cut out (I8):
    // `hairTint` paints every hair colour against it.
    const committedMeanL: Record<string, number> = {
      item_hair_f_bob01_L60: 0.3406, item_hair_f_hime01_L60: 0.2289, item_hair_f_ponytail01_L60: 0.3579, item_hair_f_wavy01_L60: 0.7899,
      item_hair_m_curly01_L60: 0.1851, item_hair_m_neat01_L60: 0.2473, item_hair_m_spiky01_L60: 0.2585, item_hair_m_tousled01_L60: 0.3204,
    }
    for (const name of fronts) {
      const [layer, hair, skin] = await Promise.all([readPicture(join(OUT_DIR, `${name}@2x.png`)), alphaOf(`${name}_hairmask@2x.png`), alphaOf(`${name}_skinmask@2x.png`)])
      let mismatched = 0
      let sum = 0
      let weight = 0
      for (let p = 0; p < hair.alpha.length; p++) {
        const ink = layer.data[p * 4 + 3]! > 8
        if (hair.alpha[p] !== (ink ? 255 - skin.alpha[p]! : 0)) mismatched++
        if (!ink) continue
        const [r, g, b] = [layer.data[p * 4]!, layer.data[p * 4 + 1]!, layer.data[p * 4 + 2]!]
        sum += (Math.max(r, g, b) + Math.min(r, g, b)) / 510
        weight++
      }
      expect(mismatched, `${name}: hair ≠ ink less skin`).toBe(0)
      expect(manifest.files[name]!.masks!.hair!.meanL, name).toBe(Math.round((sum / weight) * 10000) / 10000)
      expect(manifest.files[name]!.masks!.hair!.meanL, name).toBe(committedMeanL[name])
    }
  }, 60_000)

  it('describes each of them in the manifest', () => {
    expect(manifest.version).toBe(1)
    expect(manifest.frame).toEqual(FRAME)
    expect(manifest.crop).toEqual(CROP)
    expect(Object.keys(manifest.files).sort()).toEqual([...committedLayers].sort())
    for (const [name, entry] of Object.entries(manifest.files)) {
      expect(entry.w, name).toBe(FRAME.w)
      expect(entry.h, name).toBe(FRAME.h)
      expect(entry.bytes2x, name).toBe(statSync(join(OUT_DIR, `${name}@2x.png`)).size)
      // Exactly one of the two flags (docs/avatar-2d.md §6): a stand-in, or art `ingest` wrote.
      expect(entry.placeholder === true !== (entry.real === true), `${name} must be placeholder or real, not both or neither`).toBe(true)
      if (entry.empty) expect(entry.real, `${name} is marked empty, which only ingest writes`).toBe(true)
    }
  })

  // ── the switch-over (Plan 19 D1) ──

  it('carries no base: no base_* layer, icon or file, and no `bases` key in either manifest', () => {
    expect(Object.keys(manifest.files).filter((name) => name.startsWith('base_'))).toEqual([])
    expect(Object.keys(manifest.icons ?? {}).filter((name) => name.startsWith('base_'))).toEqual([])
    expect(readdirSync(OUT_DIR).filter((name) => name.startsWith('base_'))).toEqual([])
    for (const file of [WEB_MANIFEST, SERVER_MANIFEST]) expect(Object.keys(JSON.parse(readFileSync(file, 'utf8'))), file).not.toContain('bases')
  })

  it('cuts every outfit layer on a body: cutOn f or m, on the default layer and on every per-wear cut', () => {
    const outfits = Object.entries(manifest.files as Record<string, ManifestEntry & { cutOn?: string }>).filter(([name]) => name.startsWith('item_outfit_'))
    expect(outfits.length, 'six outfits and their male cuts').toBeGreaterThanOrEqual(6)
    for (const [name, entry] of outfits) expect(['f', 'm'], `${name} is cut on ${String(entry.cutOn)}`).toContain(entry.cutOn)
  })

  it('draws every bot on body f: its body and all six faces carry cutOn f', () => {
    const bots = Object.entries(manifest.files as Record<string, ManifestEntry & { cutOn?: string }>).filter(([name]) => name.startsWith('bot_'))
    expect(bots).toHaveLength(8 * 7)
    for (const [name, entry] of bots) expect(entry.cutOn, name).toBe('f')
  })

  // ── the v4 stand-ins (Plan 19, A1a) ──

  type V4File = { name: string; kind: string; layer: number; gender: string; expr?: string; code?: string }
  /** The masks each v4 kind is drawn with, by manifest key (`MASK_FILE_KIND` spells them on disk). */
  const V4_MASKS: Record<string, string[]> = { body: ['skin'], bodyFace: ['eyes', 'skin'], hair: ['hair'] }
  /** Every v4 name on the list: two bodies, twelve body faces, sixteen hair layers. */
  const v4Files = (): V4File[] => (stageOneFiles() as V4File[]).filter((file) => V4_MASKS[file.kind] !== undefined)
  const v4StandIns = (): V4File[] => v4Files().filter((file) => manifest.files[file.name]?.placeholder === true)
  /** The @2x mask of one layer, as the alpha byte per pixel. */
  const maskAlpha = async (name: string, kind: string): Promise<Uint8Array> => {
    const pic = await readPicture(join(OUT_DIR, `${name}_${MASK_FILE_KIND[kind as keyof typeof MASK_FILE_KIND]}mask@2x.png`))
    const alpha = new Uint8Array(pic.width * pic.height)
    for (let p = 0; p < alpha.length; p++) alpha[p] = pic.data[p * 4 + 3]!
    return alpha
  }
  const solidCount = (alpha: Uint8Array): number => alpha.reduce((n, a) => n + (a >= 128 ? 1 : 0), 0)

  it('gives every v4 stand-in the masks it is drawn with, and every stand-in hair L60 a split that adds up', async () => {
    // Skin on a body and on every face, eyes on every face (empty on closed and sleep), hair on both hair layers —
    // rendered from the stand-in's own shapes (`placeholderMaskSvg`), never computed. A hair L60 records how the
    // hairstyle's region splits between its two layers, in @2x pixels, and the two never share one. Once the art
    // phase has replaced a layer with real art it is C11's to hold (A1b), so the loop passes over it — but every one
    // of the 30 v4 names is in the manifest, stand-in or not.
    const v4 = v4Files()
    expect(v4.length, 'the v4 set is 2 bodies, 12 body faces and 16 hair layers').toBe(30)
    for (const file of v4) expect(manifest.files[file.name], `${file.name} is not in the manifest`).toBeDefined()
    for (const file of v4) {
      const entry = manifest.files[file.name]!
      if (entry.placeholder !== true) continue
      expect(Object.keys(entry.masks ?? {}).sort(), file.name).toEqual(V4_MASKS[file.kind])
      for (const [kind, info] of Object.entries(entry.masks!)) {
        const fileKind = MASK_FILE_KIND[kind as keyof typeof MASK_FILE_KIND]
        expect(info.bytes2x, `${file.name} ${kind}`).toBe(statSync(join(OUT_DIR, `${file.name}_${fileKind}mask@2x.png`)).size)
        expect(info.meanL, `${file.name} ${kind}`).toBeGreaterThanOrEqual(0)
        expect(info.meanL, `${file.name} ${kind}`).toBeLessThanOrEqual(1)
      }
      if (file.kind === 'bodyFace') {
        const shut = file.expr === 'closed' || file.expr === 'sleep'
        expect(entry.masks!.eyes!.empty === true, `${file.name}: an eye mask is empty exactly when the eyes are shut`).toBe(shut)
        expect(solidCount(await maskAlpha(file.name, 'eyes')) === 0, file.name).toBe(shut)
      }
      if (file.kind === 'hair' && file.layer === LAYERS.hairFront) {
        const split = entry.split
        expect(split, `${file.name} has no split`).toBeDefined()
        expect(split!.front + split!.back, `${file.name}: front + back`).toBe(split!.region)
        const back = hairFile(file.code!, LAYERS.hairBack)
        if (manifest.files[back]?.placeholder !== true) continue
        const [front2x, back2x] = await Promise.all([maskAlpha(file.name, 'hair'), maskAlpha(back, 'hair')])
        expect(split!.front, file.name).toBe(solidCount(front2x))
        expect(split!.back, file.name).toBe(solidCount(back2x))
        expect(split!.back, `${file.name}: the back layer is empty`).toBeGreaterThan(0)
        // The two layers' own pixels never meet, and the fringe stops above the stand-in eyes (y 130–160).
        const [layer60, layer20] = await Promise.all([readPicture(join(OUT_DIR, `${file.name}@2x.png`)), readPicture(join(OUT_DIR, `${back}@2x.png`))])
        let shared = 0
        for (let p = 0; p < layer60.width * layer60.height; p++) if (layer60.data[p * 4 + 3]! >= 128 && layer20.data[p * 4 + 3]! >= 128) shared++
        expect(shared, `${file.name} and ${back} share pixels`).toBe(0)
        const box = alphaBBox(layer60)!
        expect((box.y + box.h) / 2, `${file.name} reaches down to y ${(box.y + box.h) / 2}`).toBeLessThan(126)
      } else {
        expect(entry.split, `${file.name} carries a split`).toBeUndefined()
      }
    }
  }, 120_000)

  it('never lets a stand-in face’s skin and eye masks share a pixel', async () => {
    const faces = v4StandIns().filter((file) => file.kind === 'bodyFace')
    for (const file of faces) {
      const [skin, eyes] = await Promise.all([maskAlpha(file.name, 'skin'), maskAlpha(file.name, 'eyes')])
      let both = 0
      for (let p = 0; p < skin.length; p++) if (skin[p]! >= 128 && eyes[p]! >= 128) both++
      expect(both, `${file.name}: skin and eyes share ${both} pixels`).toBe(0)
      expect(solidCount(skin), `${file.name} has no skin`).toBeGreaterThan(0)
    }
  }, 60_000)

  it('ships the server the very same bytes', () => {
    // The catalogue validates against this copy; two manifests that drift are two truths about which
    // files exist, and the one the server trusts is the one nothing else reads.
    expect(existsSync(SERVER_MANIFEST)).toBe(true)
    expect(readFileSync(SERVER_MANIFEST).equals(readFileSync(WEB_MANIFEST))).toBe(true)
  })

  it('passes its own acceptance checks, every one of them (Plan 19 D1: no --skip)', () => {
    // Until D1, C6 was skipped while a real flat base stood under stand-in outfits. Every outfit is real art cut on a
    // real body now, so nothing is skipped.
    const stdout = execFileSync(process.execPath, [SCRIPT, 'check'], { cwd: PACKAGE_ROOT, encoding: 'utf8' })
    expect(stdout).toMatch(/C1/)
    expect(stdout).not.toMatch(/FAIL/)
  }, 300_000)

  it('leaves a review sheet for the style gate', async () => {
    expect(SHEET_FILE).toBe(SHEET)
    expect(FIT_SHEET_FILE).toBe(FIT_SHEET)
    expect(existsSync(SHEET), 'docs/avatar-2d-sheet.png has not been generated').toBe(true)
    expect(existsSync(FIT_SHEET), 'docs/avatar-2d-fit-sheet.png has not been generated').toBe(true)
    // Spec §5.6, Plan 19: the v4 grid (2 genders × 4 hairstyles × 3 tones × 2 outfits), every outfit on both genders,
    // every aura and frame, six expressions per gender, the eight bots and the three portrait sizes.
    const items = JSON.parse(readFileSync(ITEMS_FILE, 'utf8')) as unknown[]
    const cards = sheetCards(manifest, { items })
    const count = (...blocks: string[]): number => cards.filter((card) => blocks.includes(card.block)).length
    expect(count('grid')).toBe(48)
    expect(count('outfits')).toBe(12)
    expect(count('auras', 'frames')).toBe(14)
    expect(count('expressions')).toBe(12)
    expect(count('bots')).toBe(8)
    expect(count('portraits')).toBe(3)
    expect(cards).toHaveLength(48 + 12 + 14 + 12 + 8 + 3)
    // The fit sheet: every hat and every face item × the eight hairstyles.
    const fit = fitCards(manifest)
    expect(fit).toHaveLength(96)

    // The committed pictures are the ones these lists lay out: a sheet left over from another card list fails here.
    const [sheet, fitSheet] = await Promise.all([sharp(SHEET).metadata(), sharp(FIT_SHEET).metadata()])
    const want = sheetLayout(cards, SHEET_GRID)
    const wantFit = sheetLayout(fit, FIT_GRID)
    expect({ width: sheet.width, height: sheet.height }).toEqual({ width: want.width, height: want.height })
    expect({ width: fitSheet.width, height: fitSheet.height }).toEqual({ width: wantFit.width, height: wantFit.height })
    for (const meta of [sheet, fitSheet]) {
      expect(meta.width!).toBeGreaterThan(1000)
      expect(meta.height!).toBeGreaterThan(1000)
    }
  })
})

// ────────────────────────────────────────────── the v4 sheets and `hides` ──

describe('the v4 review sheet and the fit sheet (Plan 19 A1d, spec §5.6)', () => {
  const committed = JSON.parse(readFileSync(WEB_MANIFEST, 'utf8')) as Manifest
  const SKIN = { porcelain: '#f8ece4', deep: '#6b4a3a' }
  const skinItems = [
    { id: 'skin_porcelain01', slot: 'skinColor', colour: SKIN.porcelain },
    { id: 'skin_deep01', slot: 'skinColor', colour: SKIN.deep },
  ]
  const grid = (cards: { block: string }[]) => cards.filter((card) => card.block === 'grid') as { block: string; caption: string[]; names: string[]; tone?: { gender: string; colour: string } }[]

  it('narrows the v4 grid with --hairs and --outfits, and nothing else', () => {
    const all = sheetCards(committed, { items: skinItems })
    const narrow = sheetCards(committed, { items: skinItems, hairs: ['hair_f_bob01', 'm_spiky01'], outfits: ['outfit_casual01'] })
    expect(grid(narrow)).toHaveLength(2 * 3 * 1)
    expect(grid(narrow).map((card) => card.names[0])).toEqual([...Array(3).fill(hairFile('f_bob01', 20)), ...Array(3).fill(hairFile('m_spiky01', 20))])
    expect(narrow.filter((card) => card.block !== 'grid')).toEqual(all.filter((card) => card.block !== 'grid'))
    expect(() => sheetCards(committed, { hairs: ['f_mohawk01'] })).toThrow(/f_mohawk01/)
    expect(() => sheetCards(committed, { outfits: ['pyjamas01'] })).toThrow(/pyjamas01/)
  })

  it('refuses an empty --hairs or --outfits, which would narrow the grid to nothing (Plan 19 final review)', () => {
    for (const empty of [[], [''], [' ', '']]) {
      expect(() => sheetCards(committed, { hairs: empty }), JSON.stringify(empty)).toThrow(/--hairs names no hairstyle — give one or more of f_bob01/)
      expect(() => sheetCards(committed, { outfits: empty }), JSON.stringify(empty)).toThrow(/--outfits names no outfit — give one or more of/)
    }
    // On the command line, before a sheet is written: exit 1, and the reason.
    const out = join(caseDir('sheet-empty-hairs'), 'sheet.png')
    let failed: { status?: number; stderr?: string } = {}
    try {
      execFileSync(process.execPath, [SCRIPT, 'sheet', '--hairs', '', '--out', out, '--fit-out', `${out}.fit.png`], { cwd: PACKAGE_ROOT, encoding: 'utf8', stdio: 'pipe' })
    } catch (error) {
      failed = error as { status?: number; stderr?: string }
    }
    expect(failed.status).toBe(1)
    expect(failed.stderr).toMatch(/--hairs names no hairstyle/)
    expect(existsSync(out)).toBe(false)
    // The fit sheet's tile is the portrait crop at @1x, so a crop is blitted as it is.
    expect(FIT_GRID.tile).toEqual({ w: CROP.size, h: CROP.size })
  })

  it('paints the outer tones from items.json, and draws natural, saying so, while an item is missing', () => {
    const withBoth = grid(sheetCards(committed, { items: skinItems }))
    expect(withBoth.map((card) => card.tone?.colour ?? 'natural').slice(0, 3)).toEqual([SKIN.porcelain, 'natural', SKIN.deep])
    expect(withBoth[0]!.caption.join(' ')).toContain(SKIN.porcelain)
    const without = grid(sheetCards(committed, { items: [] }))
    expect(without.every((card) => card.tone === undefined)).toBe(true)
    expect(without[0]!.caption.join(' ')).toMatch(/porcelain.*no item.*natural/)
    expect(without[2]!.caption.join(' ')).toMatch(/deep.*no item.*natural/)
  })

  it('dresses every v4 card in its gender’s cut of an outfit where one exists', () => {
    const outfits = sheetCards(committed, { items: [] }).filter((card) => card.block === 'outfits')
    const dealer = outfits.filter((card) => card.names.some((name) => name.startsWith('item_outfit_dealer01')))
    expect(dealer.map((card) => card.names.find((name) => name.startsWith('item_outfit_')))).toEqual(['item_outfit_dealer01_L40', 'item_outfit_dealer01_m_L40'])
    expect(dealer.map((card) => card.names.find((name) => name.startsWith('body_')))).toEqual([bodyFile('f'), bodyFile('m')])
    // On the gender's default hairstyle: f → the bob, m → the tousled cut.
    expect(dealer.map((card) => card.names[0])).toEqual([hairFile('f_bob01', 20), hairFile('m_tousled01', 20)])
  })

  it('drops the hair layer a head item hides on the fit sheet, and only that one', () => {
    const files = { ...committed.files }
    const flags = (name: string, front: boolean, back: boolean): void => {
      const { hidesHairFront: _front, hidesHairBack: _back, ...rest } = files[name]!
      files[name] = { ...rest, ...(front ? { hidesHairFront: true } : {}), ...(back ? { hidesHairBack: true } : {}) }
    }
    flags('item_head_beanie01_L80', true, false)
    flags('item_head_hood_black01_L80', true, true)
    flags('item_head_dealer_visor01_L80', false, false)
    const cards = fitCards({ ...committed, files }) as { names: string[]; hair: string; item: string }[]
    for (const code of HAIR_CODES) {
      const back = hairFile(code, 20)
      const front = hairFile(code, 60)
      const card = (item: string): string[] => cards.find((c) => c.item === item && c.hair === code)!.names
      // On the hairstyle's own gender, in casual01.
      expect(card('item_head_beanie01_L80')).toEqual(expect.arrayContaining([bodyFile(code.slice(0, 1)), 'item_outfit_casual01_L40']))
      expect(card('item_head_beanie01_L80'), `${code} under the beanie`).toContain(back)
      expect(card('item_head_beanie01_L80'), `${code} under the beanie`).not.toContain(front)
      expect(card('item_head_hood_black01_L80').filter((name) => name.startsWith('item_hair_')), `${code} under the hood`).toEqual([])
      expect(card('item_head_dealer_visor01_L80')).toEqual(expect.arrayContaining([back, front]))
      expect(card('item_face_sunglasses01_L70')).toEqual(expect.arrayContaining([back, front]))
    }
  })

  it('paints a tone over skin and its line art only: the body, its face, the outfit’s copy of the outline and the hair’s redrawn skin, by their masks', async () => {
    const cards = grid(sheetCards(committed, { items: skinItems, hairs: ['f_bob01'], outfits: ['casual01'] }))
    const [porcelain, natural, deep] = await Promise.all(cards.map((card) => composeCard(card, { dir: OUT_DIR, manifest: committed })))
    const masks = await Promise.all([
      ...[bodyFile('f'), bodyFaceFile('f', 'neutral')].flatMap((name) => ['skin', 'skinline'].map((kind) => readPicture(join(OUT_DIR, `${name}_${kind}mask@1x.png`)))),
      readPicture(join(OUT_DIR, 'item_outfit_casual01_L40_skinlinemask@1x.png')),
      readPicture(join(OUT_DIR, 'item_outfit_casual01_L40_skinmask@1x.png')),
      readPicture(join(OUT_DIR, 'item_hair_f_bob01_L60_skinmask@1x.png')),
    ])
    for (const toned of [porcelain!, deep!]) {
      let changed = 0
      let outside = 0
      for (let p = 0; p < natural!.width * natural!.height; p++) {
        const differs = [0, 1, 2].some((c) => toned.data[p * 4 + c] !== natural!.data[p * 4 + c])
        if (!differs) continue
        changed++
        if (masks.every((mask) => mask.data[p * 4 + 3] === 0)) outside++
      }
      expect(changed, 'the tone changed nothing').toBeGreaterThan(1000)
      expect(outside, 'the tone reached past the skin masks').toBe(0)
    }
    // The lines (2026-10-05): untouched on porcelain, lighter than the cream they were drawn for; darker on deep.
    const [bodySkin, bodyLine, faceSkin, faceLine, outfitLine, outfitSkin, hairSkin] = masks
    const lineOnly = (p: number) =>
      [bodyLine, faceLine, outfitLine].some((mask) => mask!.data[p * 4 + 3]! > 0) && [bodySkin, faceSkin, outfitSkin, hairSkin].every((mask) => mask!.data[p * 4 + 3] === 0)
    let porcelainMoved = 0
    let deepDarker = 0
    for (let p = 0; p < natural!.width * natural!.height; p++) {
      if (!lineOnly(p)) continue
      if ([0, 1, 2].some((c) => porcelain!.data[p * 4 + c] !== natural!.data[p * 4 + c])) porcelainMoved++
      if (outfitLine!.data[p * 4 + 3]! >= 128 && deep!.data[p * 4]! < natural!.data[p * 4]!) deepDarker++
    }
    expect(porcelainMoved, 'porcelain moved a line pixel').toBe(0)
    expect(deepDarker, 'deep left the outfit’s copy of the outline as drawn').toBeGreaterThan(100)

    // The bob's redrawn skin (2026-10-05) takes the deep tone by `ratio` at the body's skin meanL, where the hair is the
    // top layer and opaque: the tone's own RGB scaled by min(1, l × lc / meanL) / lc, blended by the mask's alpha (the
    // @1x mask is the @2x one halved, so between the bangs it is rarely whole).
    const hair = await readPicture(join(OUT_DIR, 'item_hair_f_bob01_L60@1x.png'))
    const bodyMeanL = committed.files[bodyFile('f')]!.masks!.skin!.meanL!
    const deepRgb = [1, 3, 5].map((at) => Number.parseInt(SKIN.deep.slice(at, at + 2), 16))
    const lc = (Math.max(...deepRgb) + Math.min(...deepRgb)) / 510
    let painted = 0
    let off = 0
    for (let p = 0; p < hair.width * hair.height; p++) {
      const t = hairSkin!.data[p * 4 + 3]! / 255
      if (t === 0 || hair.data[p * 4 + 3] !== 255) continue
      painted++
      const [r, g, b] = [hair.data[p * 4]!, hair.data[p * 4 + 1]!, hair.data[p * 4 + 2]!]
      const f = Math.min(1, ((Math.max(r, g, b) + Math.min(r, g, b)) / 510) * (lc / bodyMeanL)) / lc
      const want = deepRgb.map((v, c) => hair.data[p * 4 + c]! * (1 - t) + Math.min(255, v * f) * t)
      if (want.some((v, c) => Math.abs(deep!.data[p * 4 + c]! - v) > 1)) off++
    }
    expect(painted, 'the bob redrew skin under its bangs').toBeGreaterThan(100)
    expect(off, 'redrawn skin not painted by ratio').toBe(0)
  }, 30_000)
})

describe('the hides command', () => {
  const run = (args: string[]): string => execFileSync(process.execPath, [SCRIPT, ...args], { cwd: PACKAGE_ROOT, encoding: 'utf8' })

  it('hides item_head_beanie01_L80 --front on --out <temp copy> flips that entry in the copy only, and names every items.json row on the layer', () => {
    // Since the C5 fit check no hat hides the front hair (the beanie is committed with neither flag), so this turns
    // the flag on in a copy and back off again.
    const dir = caseDir('hides')
    const committedBytes = [readFileSync(WEB_MANIFEST), readFileSync(SERVER_MANIFEST)]
    cpSync(WEB_MANIFEST, join(dir, MANIFEST_NAME))
    const layer = 'item_head_beanie01_L80'

    const stdout = run(['hides', layer, '--front', 'on', '--out', dir])
    const expected = JSON.parse(committedBytes[0]!.toString('utf8')) as Manifest
    expected.files[layer]!.hidesHairFront = true
    // Exactly the one flag (the writer gives it its own place among the keys, so compare the data here; the round
    // trip below holds the bytes).
    expect(JSON.parse(readFileSync(join(dir, MANIFEST_NAME), 'utf8'))).toEqual(expected)
    expect(readFileSync(join(dir, MANIFEST_NAME), 'utf8').endsWith('\n')).toBe(true)
    expect(stdout).toContain('remember items.json: head_beanie01, head_beanie_red01, head_beanie_grey01, head_beanie_mustard01 — same flags (bug 7)')
    // The committed manifests are untouched.
    expect(readFileSync(WEB_MANIFEST).equals(committedBytes[0]!)).toBe(true)
    expect(readFileSync(SERVER_MANIFEST).equals(committedBytes[1]!)).toBe(true)

    // Back off, and the copy is byte for byte the committed file again.
    run(['hides', layer, '--front', 'off', '--out', dir])
    expect(readFileSync(join(dir, MANIFEST_NAME)).equals(committedBytes[0]!)).toBe(true)

    // --back alone, and a refusal for an unknown layer or a value that is not on|off.
    run(['hides', layer, '--back', 'on', '--out', dir])
    const back = JSON.parse(readFileSync(join(dir, MANIFEST_NAME), 'utf8')) as Manifest
    expect(back.files[layer]).toMatchObject({ hidesHairBack: true })
    expect(back.files[layer]!.hidesHairFront).toBeUndefined()
    expect(() => run(['hides', 'item_head_nothing01_L80', '--front', 'off', '--out', dir])).toThrow()
    expect(() => run(['hides', layer, '--front', 'maybe', '--out', dir])).toThrow()
    expect(() => run(['hides', layer, '--out', dir])).toThrow()
  }, 60_000)
})

// ─────────────────────────────────────────────── C12, and C11 on the v4 set ──

describe('C12 and the v4 rules of C11 (Plan 19 A1b, spec §5.1, §5.5)', () => {
  const committed = JSON.parse(readFileSync(WEB_MANIFEST, 'utf8')) as Manifest

  /** A committed layer at both densities, with the masks named (by file kind: `skin`, `eye`, `hair`), copied to `dir`. */
  function copyLayer(dir: string, name: string, fileKinds: string[]): void {
    for (const density of DENSITIES) {
      cpSync(join(OUT_DIR, `${name}@${density}x.png`), join(dir, `${name}@${density}x.png`))
      for (const kind of fileKinds) cpSync(join(OUT_DIR, `${name}_${kind}mask@${density}x.png`), join(dir, `${name}_${kind}mask@${density}x.png`))
    }
  }
  /** The committed entry of `name`, flagged real or stand-in as the case needs, whatever it is today. */
  function flagged(name: string, real: boolean): ManifestEntry {
    const { placeholder: _placeholder, real: _real, ...rest } = committed.files[name]!
    return real ? { ...rest, real: true } : { ...rest, placeholder: true }
  }
  /** The @2x mask of `name` in `dir`, run through `edit` (alpha per pixel) and written back. */
  async function editMask(dir: string, name: string, fileKind: string, edit: (alpha: Uint8Array, width: number) => void): Promise<void> {
    const file = join(dir, `${name}_${fileKind}mask@2x.png`)
    const pic = await readPicture(file)
    const alpha = new Uint8Array(pic.width * pic.height)
    for (let p = 0; p < alpha.length; p++) alpha[p] = pic.data[p * 4 + 3]!
    edit(alpha, pic.width)
    for (let p = 0; p < alpha.length; p++) pic.data[p * 4 + 3] = alpha[p]!
    await writePicture(pic, file)
  }

  it('pins HEAD_REFERENCE to F01 as measured before D1 retired its files (rulings 1, 2; index / 2, no half-pixel)', () => {
    // headMetrics on the committed base_f01_L30@1x and base_f01_face_neutral_L50_eyemask@2x gave (190.91, 193.99),
    // 60.61 apart, chin 243 — rounded to a tenth. Those files are gone (Plan 19 D1), so the numbers are pinned as such.
    expect(HEAD_REFERENCE).toEqual({ eyeMidX: 190.9, eyeMidY: 194.0, eyeSpan: 60.6, chinY: 243 })
    expect(HEAD_TOLERANCE).toBeCloseTo(0.02 * CROP.size, 10)
    // The chin has its own, wider limit (gate ruling): a bald face is drawn shorter than F01's framed one.
    expect(CHIN_TOLERANCE).toBe(12)
  })

  /** The committed real body f's head as C12 finds it — its own eyes and chin, measured once. */
  let bodyFHead: Promise<{ eyeMidX: number; eyeMidY: number; eyeSpan: number; chinY: number }> | null = null
  const committedHead = (): Promise<{ eyeMidX: number; eyeMidY: number; eyeSpan: number; chinY: number }> =>
    (bodyFHead ??= (async () => headMetrics(await readPicture(join(OUT_DIR, 'body_f_L30@1x.png')), await readPicture(join(OUT_DIR, 'body_f_face_neutral_L50_eyemask@2x.png'))))())

  /**
   * The committed body f and its neutral eye mask (F01's were used until D1 deleted them), written into `dir` as a real
   * body f and its neutral face, moved so the chin lands `chinOff` units below `HEAD_REFERENCE.chinY` — exactly: the
   * chin is a row — and the eye line `eyeOff` units below `HEAD_REFERENCE.eyeMidY`, to within a quarter unit (the eye
   * mask moves in half units, a pixel at @2x). The eyes' midpoint x and span are body f's own, inside C12's 4.16.
   */
  async function buildHead(dir: string, chinOff: number, eyeOff = chinOff): Promise<Manifest> {
    const head = await committedHead()
    const bodyDy = HEAD_REFERENCE.chinY + chinOff - head.chinY
    const eyes2xDy = Math.round(2 * (HEAD_REFERENCE.eyeMidY + eyeOff - head.eyeMidY))
    for (const density of DENSITIES) {
      const body = await readPicture(join(OUT_DIR, `body_f_L30@${density}x.png`))
      await writePicture(shiftPicture(body, 0, bodyDy * density), join(dir, `body_f_L30@${density}x.png`))
      const eyes = await readPicture(join(OUT_DIR, `body_f_face_neutral_L50_eyemask@${density}x.png`))
      await writePicture(shiftPicture(eyes, 0, Math.round((eyes2xDy * density) / 2)), join(dir, `body_f_face_neutral_L50_eyemask@${density}x.png`))
    }
    const bytes2x = statSync(join(dir, 'body_f_L30@2x.png')).size
    return manifestFor(dir, {
      body_f_L30: { layer: 30, w: FRAME.w, h: FRAME.h, bytes2x, real: true },
      body_f_face_neutral_L50: { layer: 50, w: FRAME.w, h: FRAME.h, bytes2x: 0, real: true, masks: { eyes: { bytes2x: 0, meanL: 0.5 } } },
    })
  }
  /** C12's way of naming an eye line about 6 units off (the eye mask lands within a quarter unit of it). */
  const EYE_LINE_6 = /eye line (?:5\.[89]|6\.[0-2]) from F01's \(want within 4\.16\) — eyes \(/

  it('C12 passes a real body whose eyes and chin sit on F01, and fails one moved by 6 units on its eye line alone', async () => {
    const still = caseDir('c12-still')
    const c12 = (await checkOne(still, 'body_f_L30', await buildHead(still, 0))).get('C12')!
    expect(c12.ok, c12.detail).toBe(true)
    expect(c12.detail).toMatch(/^eyes \(.*\) [\d.]+ apart, chin \d+, eyes within 4\.16 and chin within 12 of F01's$/)
    const moved = caseDir('c12-moved')
    const off = (await checkOne(moved, 'body_f_L30', await buildHead(moved, 6))).get('C12')!
    expect(off.ok).toBe(false)
    expect(off.detail).toMatch(EYE_LINE_6)
    // The chin moved 6 too, inside its own 12: it is not named.
    expect(off.detail).not.toMatch(/chin \d+\.\d from F01's/)
  }, 60_000)

  it('C12 holds the chin to 12 units and the eyes to 4.16, each named with its own limit', async () => {
    // A bald face is drawn shorter than F01's: the body's chin 10 units up with the eyes on F01's still passes ...
    const near = caseDir('c12-chin-10')
    const ten = (await checkOne(near, 'body_f_L30', await buildHead(near, -10, 0))).get('C12')!
    expect(ten.ok, ten.detail).toBe(true)
    expect(ten.detail).toContain(`chin ${HEAD_REFERENCE.chinY - 10},`)
    // ... 13 units fails, on the chin alone, naming the 12 ...
    const far = caseDir('c12-chin-13')
    const thirteen = (await checkOne(far, 'body_f_L30', await buildHead(far, -13, 0))).get('C12')!
    expect(thirteen.ok).toBe(false)
    expect(thirteen.detail.startsWith("chin 13.0 from F01's (want within 12) — eyes (")).toBe(true)
    // ... and the eye line 6 units off still fails on the 4.16, whatever the chin does.
    const low = caseDir('c12-eyes-6')
    const six = (await checkOne(low, 'body_f_L30', await buildHead(low, 0, 6))).get('C12')!
    expect(six.ok).toBe(false)
    expect(six.detail).toMatch(EYE_LINE_6)
    expect(six.detail).not.toMatch(/chin \d+\.\d from F01's/)
  }, 90_000)

  it('C12 says n/a for a stand-in', async () => {
    const dir = caseDir('c12-stand-in')
    const entry = await writePlaceholder(dir, 'body_f_L30')
    const c12 = (await checkOne(dir, 'body_f_L30', manifestFor(dir, { body_f_L30: entry }))).get('C12')!
    expect(c12.ok).toBe(true)
    expect(c12.detail.startsWith('n/a'), c12.detail).toBe(true)
  }, 30_000)

  it('C12 says n/a for a real body whose neutral face is still a stand-in', async () => {
    // The stand-in's eyes are drawn where no head was measured; holding a real body to them says nothing.
    const dir = caseDir('c12-stand-in-face')
    for (const density of DENSITIES) {
      cpSync(join(OUT_DIR, `body_f_L30@${density}x.png`), join(dir, `body_f_L30@${density}x.png`))
      cpSync(join(OUT_DIR, `body_f_face_neutral_L50_eyemask@${density}x.png`), join(dir, `body_f_face_neutral_L50_eyemask@${density}x.png`))
    }
    const bytes2x = statSync(join(dir, 'body_f_L30@2x.png')).size
    const manifest = manifestFor(dir, {
      body_f_L30: { layer: 30, w: FRAME.w, h: FRAME.h, bytes2x, real: true },
      body_f_face_neutral_L50: { layer: 50, w: FRAME.w, h: FRAME.h, bytes2x: 0, placeholder: true, masks: { eyes: { bytes2x: 0, meanL: 0.5 } } },
    })
    const c12 = (await checkOne(dir, 'body_f_L30', manifest)).get('C12')!
    expect(c12.ok).toBe(true)
    expect(c12.detail).toMatch(/^n\/a — body_f_face_neutral_L50 is a stand-in/)
  }, 30_000)

  it('C11 compares a face’s skin with the neutral face only when both are real or both are stand-ins', async () => {
    const neutral = 'body_f_face_neutral_L50'
    const happy = 'body_f_face_happy_L50'
    // Between B3 and C1 the neutral face is real art and the other five are still stand-ins (pre-flight #7, R26).
    const mixed = caseDir('c11-mixed')
    for (const face of [neutral, happy]) copyLayer(mixed, face, ['skin', 'skinline', 'eye'])
    const mixedRow = (await checkOne(mixed, happy, manifestFor(mixed, { [neutral]: flagged(neutral, true), [happy]: flagged(happy, false) }))).get('C11')!
    expect(mixedRow.ok, mixedRow.detail).toBe(true)
    expect(mixedRow.detail).toContain('n/a — neutral is real, this face is a stand-in')
    const reverse = (await checkOne(mixed, happy, manifestFor(mixed, { [neutral]: flagged(neutral, false), [happy]: flagged(happy, true) }))).get('C11')!
    expect(reverse.detail).toContain('n/a — neutral is a stand-in, this face is real')

    // Both real, and the happy face has lost half its skin: measured, and too small.
    const halved = caseDir('c11-halved')
    for (const face of [neutral, happy]) copyLayer(halved, face, ['skin', 'skinline', 'eye'])
    await editMask(halved, happy, 'skin', (alpha) => {
      const total = alpha.reduce((n, a) => n + (a >= 128 ? 1 : 0), 0)
      let cleared = 0
      for (let p = 0; p < alpha.length && cleared < total / 2; p++) if (alpha[p]! >= 128) { alpha[p] = 0; cleared++ }
    })
    const both = (await checkOne(halved, happy, manifestFor(halved, { [neutral]: flagged(neutral, true), [happy]: flagged(happy, true) }))).get('C11')!
    expect(both.ok).toBe(false)
    expect(both.detail).toMatch(/skin and eye zone are 0\.\d\d × the neutral face's, want 0\.8–1\.2 ×/)
  }, 60_000)

  it('C11 fails a real face with no skin mask, an empty one, or no neutral skin to compare with', async () => {
    const neutral = 'body_f_face_neutral_L50'
    const happy = 'body_f_face_happy_L50'
    const dir = caseDir('c11-no-skin')
    for (const face of [neutral, happy]) copyLayer(dir, face, ['skin', 'skinline', 'eye'])
    const c11Of = async (entries: Record<string, ManifestEntry>) => (await checkOne(dir, happy, manifestFor(dir, entries))).get('C11')!
    const withoutSkin = (name: string): ManifestEntry => {
      const entry = flagged(name, true)
      const { skin: _skin, ...rest } = entry.masks!
      return { ...entry, masks: rest }
    }
    const { masks: _masks, ...bare } = flagged(happy, true)

    const missing = await c11Of({ [neutral]: flagged(neutral, true), [happy]: withoutSkin(happy) })
    expect(missing.ok).toBe(false)
    expect(missing.detail).toContain('no skin mask')
    const none = await c11Of({ [neutral]: flagged(neutral, true), [happy]: bare })
    expect(none.ok).toBe(false)
    expect(none.detail).toContain('no skin mask')
    const noReference = await c11Of({ [neutral]: withoutSkin(neutral), [happy]: flagged(happy, true) })
    expect(noReference.ok).toBe(false)
    expect(noReference.detail).toContain(`${neutral} has no skin mask to compare with`)

    // Two stand-ins, the neutral's skin entry gone: nothing real to hold to anything — a note, not a failure.
    const { real: _real, ...skinlessNeutral } = withoutSkin(neutral)
    const standIns = await c11Of({ [neutral]: { ...skinlessNeutral, placeholder: true }, [happy]: flagged(happy, false) })
    expect(standIns.ok, standIns.detail).toBe(true)
    expect(standIns.detail).toContain(`n/a — ${neutral} has no skin mask to compare with`)

    await editMask(dir, happy, 'skin', (alpha) => alpha.fill(0))
    const empty = await c11Of({ [neutral]: flagged(neutral, true), [happy]: flagged(happy, true) })
    expect(empty.ok).toBe(false)
    expect(empty.detail).toContain('skin mask is empty')
    // A hand-drawn mask is trusted for its shape, not for being there: an empty override fails as well.
    const drawn = flagged(happy, true)
    const emptyOverride = await c11Of({ [neutral]: flagged(neutral, true), [happy]: { ...drawn, masks: { ...drawn.masks, skin: { ...drawn.masks!.skin!, override: true } } } })
    expect(emptyOverride.ok).toBe(false)
    expect(emptyOverride.detail).toContain('skin mask is empty')
    // A stand-in keeps the mixed-pair note rather than a failure.
    const mixed = await c11Of({ [neutral]: flagged(neutral, true), [happy]: flagged(happy, false) })
    expect(mixed.detail).toContain('n/a — neutral is real, this face is a stand-in')
  }, 60_000)

  it('C11 holds a body’s skin to SKIN_AREA of its ink, a hair layer’s hair to 0.9 of its ink, and skin off the eyes', async () => {
    const body = 'body_m_L30'
    const face = 'body_m_face_neutral_L50'
    const hair = 'item_hair_m_spiky01_L60'
    const dir = caseDir('c11-v4')
    copyLayer(dir, body, ['skin', 'skinline'])
    copyLayer(dir, face, ['skin', 'skinline', 'eye'])
    copyLayer(dir, hair, ['hair', 'skin'])
    const manifest = manifestFor(dir, { [body]: flagged(body, true), [face]: flagged(face, true), [hair]: flagged(hair, true) })
    for (const name of [body, face, hair]) {
      const c11 = (await checkOne(dir, name, manifest)).get('C11')!
      expect(c11.ok, `${name}: ${c11.detail}`).toBe(true)
    }

    // A body whose skin mask keeps under SKIN_AREA.min of its ink.
    await editMask(dir, body, 'skin', (alpha) => {
      const keep = alpha.reduce((n, a) => n + (a >= 128 ? 1 : 0), 0) * 0.3
      let kept = 0
      for (let p = 0; p < alpha.length; p++) if (alpha[p]! >= 128 && kept++ >= keep) alpha[p] = 0
    })
    const thin = (await checkOne(dir, body, manifest)).get('C11')!
    expect(thin.ok).toBe(false)
    expect(thin.detail).toMatch(new RegExp(`skin covers 0\\.\\d\\d of the body's ink, want ${SKIN_AREA.min}–${SKIN_AREA.max}`))

    // A hair layer whose mask holds only the top half of its rows.
    await editMask(dir, hair, 'hair', (alpha, width) => {
      const rows = alpha.length / width
      let first = rows
      let last = -1
      for (let p = 0; p < alpha.length; p++) if (alpha[p]! >= 128) { first = Math.min(first, Math.floor(p / width)); last = Math.floor(p / width) }
      for (let p = Math.ceil((first + last) / 2) * width; p < alpha.length; p++) alpha[p] = 0
    })
    const bald = (await checkOne(dir, hair, manifest)).get('C11')!
    expect(bald.ok).toBe(false)
    expect(bald.detail).toMatch(/hair covers 0\.\d\d of the layer's ink, want ≥ 0\.9/)

    // A face whose skin mask runs over its eyes.
    const eyes = await readPicture(join(dir, `${face}_eyemask@2x.png`))
    await editMask(dir, face, 'skin', (alpha) => {
      for (let p = 0; p < alpha.length; p++) if (eyes.data[p * 4 + 3]! >= 128) alpha[p] = 255
    })
    const over = (await checkOne(dir, face, manifest)).get('C11')!
    expect(over.ok).toBe(false)
    expect(over.detail).toMatch(/skin and eyes share \d+ pixels/)

    // A body whose skin-line mask runs onto its skin (2026-10-05): a pixel both recoloured and shaded.
    copyLayer(dir, body, ['skin', 'skinline']) // the masks as committed again, undoing the thin skin above
    const skin = await readPicture(join(dir, `${body}_skinmask@2x.png`))
    await editMask(dir, body, 'skinline', (alpha) => {
      for (let p = 0; p < alpha.length; p++) if (skin.data[p * 4 + 3]! >= 128 && p % 97 === 0) alpha[p] = 255
    })
    const onSkin = (await checkOne(dir, body, manifest)).get('C11')!
    expect(onSkin.ok).toBe(false)
    expect(onSkin.detail).toMatch(/skin line and skin share \d+ pixels/)

    // A real body with no skin-line mask at all: the skin colour would leave its outline glowing.
    const { skinLine: _line, ...bodyMasks } = manifest.files[body]!.masks!
    const lineless = manifestFor(dir, { ...manifest.files, [body]: { ...manifest.files[body]!, masks: bodyMasks } })
    const missing = (await checkOne(dir, body, lineless)).get('C11')!
    expect(missing.ok).toBe(false)
    expect(missing.detail).toContain('no skinLine mask cut for this real layer')

    // A v4 outfit (cut on a body) carries its copy of the outline: as committed it passes; without it, or with the
    // line run onto its own colour variant's tint mask, it fails.
    const outfit = 'item_outfit_casual01_L40'
    copyLayer(dir, outfit, ['skinline', 'tint', 'skin'])
    const dressed = manifestFor(dir, { ...manifest.files, [outfit]: flagged(outfit, true) })
    const fine = (await checkOne(dir, outfit, dressed)).get('C11')!
    expect(fine.ok, fine.detail).toBe(true)
    const { skinLine: _outfitLine, ...outfitMasks } = dressed.files[outfit]!.masks!
    const bare = manifestFor(dir, { ...dressed.files, [outfit]: { ...dressed.files[outfit]!, masks: outfitMasks } })
    const unlined = (await checkOne(dir, outfit, bare)).get('C11')!
    expect(unlined.ok).toBe(false)
    expect(unlined.detail).toContain('no skinLine mask cut for this real layer')
    const tint = await readPicture(join(dir, `${outfit}_tintmask@2x.png`))
    await editMask(dir, outfit, 'skinline', (alpha) => {
      for (let p = 0; p < alpha.length; p++) if (tint.data[p * 4 + 3]! >= 128 && p % 53 === 0) alpha[p] = 255
    })
    const onTint = (await checkOne(dir, outfit, dressed)).get('C11')!
    expect(onTint.ok).toBe(false)
    expect(onTint.detail).toMatch(/skin line and tint share \d+ pixels/)
  }, 60_000)

  it('colours prints one line per mask: a body’s skin, a face’s skin and the iris of its eyes', () => {
    const stdout = execFileSync(process.execPath, [SCRIPT, 'colours', 'body_f_L30', 'body_f_face_neutral_L50'], { cwd: PACKAGE_ROOT, encoding: 'utf8' })
    expect(stdout).toMatch(/^body_f_L30 skin #[0-9a-f]{6}$/m)
    expect(stdout).toMatch(/^body_f_face_neutral_L50 eyes #[0-9a-f]{6}$/m)
    expect(stdout).toMatch(/^body_f_face_neutral_L50 skin #[0-9a-f]{6}$/m)
  }, 30_000)

  it('colours adds a hairstyle’s natural colour and how far its hair is from it, once items.json names one', async () => {
    const name = 'item_hair_f_bob01_L60'
    const dir = caseDir('colours-natural')
    copyLayer(dir, name, ['hair', 'skin'])
    const manifest = { files: { [name]: committed.files[name]! } }
    const [plain] = await describeColours({ dir, manifest, names: [name], items: [] })
    expect(plain).toMatch(new RegExp(`^${name} hair #[0-9a-f]{6}$`))
    const measured = plain!.split(' ')[2]!
    const [same] = await describeColours({ dir, manifest, names: [name], items: [{ id: hairItemId('f_bob01'), naturalColour: measured }] })
    expect(same).toBe(`${name} hair ${measured} natural ${measured} ΔE 0.0`)
    const [far] = await describeColours({ dir, manifest, names: [name], items: [{ id: hairItemId('f_bob01'), naturalColour: '#ffffff' }] })
    expect(far).toMatch(new RegExp(`^${name} hair ${measured} natural #ffffff ΔE \\d+\\.\\d$`))
  }, 30_000)
})

describe('the ingest command', () => {
  /** The two synthetic sources as files on disk, which is what the CLI takes. */
  async function sources(dir: string): Promise<{ base: string; item: string }> {
    const base = join(dir, 'base.png')
    const item = join(dir, 'hat.png')
    await writePicture(await renderSvg(sourceSvg(), SRC.w, SRC.h), base)
    await writePicture(await renderSvg(sourceSvg(HAT), SRC.w, SRC.h), item)
    return { base, item }
  }

  const run = (args: string[]): string => execFileSync(process.execPath, [SCRIPT, ...args], { cwd: PACKAGE_ROOT, encoding: 'utf8' })

  it('measures a picture against D02 §8 without writing anything', async () => {
    const dir = caseDir('ingest-dry')
    const { base } = await sources(dir)
    // An item's dry run: D02 §8's report alone (a body's adds C12, which the grey figure, eyeless, cannot pass).
    const stdout = run(['ingest', base, '--as', 'item:head:tophat01', '--dry-run', '--out', dir])
    for (const line of ['head height', 'total height', 'eye line', 'centre offset', 'verdict']) {
      expect(stdout, `the report does not mention ${line}`).toContain(line)
    }
    expect(stdout).toContain('PASS')
    // A dry run is a report, not a step: nothing on disk, not even a manifest.
    expect(existsSync(join(dir, MANIFEST_NAME))).toBe(false)
  }, 60_000)

  it('keeps the body on its canvas’s transform, then cuts a hat out against it (--base f by default), and both pass the checks', async () => {
    const dir = caseDir('ingest-run')
    const { base, item } = await sources(dir)
    seedCanvas(dir)
    run(['ingest', base, '--as', 'body:f', '--out', dir])
    run(['ingest', item, '--as', 'item:head:tophat01', '--out', dir])
    const manifest = JSON.parse(readFileSync(join(dir, MANIFEST_NAME), 'utf8')) as Manifest
    // The body keeps the canvas's stored transform — the figure's own box — so that everything generated beside it lands
    // on the same pixels.
    expect(manifest.bodies!.f!.transform.scale).toBeCloseTo(BODY.h / (SRC_FIGURE.bottom - SRC_FIGURE.top), 3)
    for (const name of ['body_f_L30', 'item_head_tophat01_L80']) {
      expect(manifest.files[name]!.real, `${name} should be marked as real art`).toBe(true)
      expect(manifest.files[name]!.placeholder).toBeUndefined()
    }
    expect(manifest.files.item_head_tophat01_L80!.cutOn).toBe('f')
    // C11 skipped: FIGURE is one flat grey (#808080, chroma ≈ 0) all over, with flat #202020 eyes — no skin for the
    // skin mask (it wants warm chroma) and no eye white for the eye mask, so a real body cut from it has neither.
    // Fine for the extraction geometry this test is about; avatar-masks.test.ts exercises the masks.
    const stdout = run(['check', 'body_f_L30', 'item_head_tophat01_L80', '--dir', dir, '--skip', 'C11'])
    expect(stdout, stdout).not.toMatch(/FAIL/)
    // …and the item's inventory icon comes with it.
    expect(manifest.icons?.item_head_tophat01_icon).toMatchObject({ kind: 'icon', of: 'item_head_tophat01_L80', w: ICON.w, h: ICON.h, real: true })
    for (const density of DENSITIES) expect(existsSync(join(dir, `item_head_tophat01_icon@${density}x.png`))).toBe(true)
  }, 120_000)
})

// ─────────────────────────────────────────── one item, a layer per wear (2026-09-20) ──

/**
 * Per-wear variants: two of the stage-1 outfits are gendered (a dealer's skirt, an áo dài), and the
 * ruling is that they stay **one item** — ownership, achievements, the daily calendar and the outfits
 * table all key on the id — with only the drawn layer differing by the wear of the base wearing it.
 *
 * What that costs the pipeline is a name (`item_<slot>_<code>_<wear>_L<n>`), an `ingest` flag, a rule
 * about what `placeholder` may touch, and a routing question for C6: *which bases is this layer the one
 * worn by?* Each of those is a case below.
 */
describe('per-wear variants', () => {
  it('names a variant between the code and the layer, and reads it back', () => {
    expect(itemFile('outfit', 'dealer01', LAYERS.outfit, 'm')).toBe('item_outfit_dealer01_m_L40')
    expect(itemFile('outfit', 'dealer01', LAYERS.outfit)).toBe('item_outfit_dealer01_L40')
    // The slot is a parameter, not a rule: only `outfit` needs this today and nothing here says so.
    expect(itemFile('head', 'tophat01', LAYERS.head, 'f')).toBe('item_head_tophat01_f_L80')
    expect(variantFile('item_outfit_tet_red01_L40', 'm')).toBe('item_outfit_tet_red01_m_L40')

    for (const name of ['item_outfit_dealer01_m_L40', 'item_outfit_tet_red01_f_L40', 'item_head_tophat01_f_L80']) {
      expect(NAME_PATTERN.test(name), name).toBe(true)
    }
    // A code's own segments are two characters or more, so the one-letter tail is unambiguously the wear.
    expect(parseName('item_outfit_dealer01_m_L40')).toEqual({ kind: 'item', layer: 40, slot: 'outfit', code: 'dealer01', wear: 'm' })
    expect(parseName('item_outfit_tet_red01_f_L40')).toEqual({ kind: 'item', layer: 40, slot: 'outfit', code: 'tet_red01', wear: 'f' })
    expect(parseName('item_outfit_dealer01_L40')).toEqual({ kind: 'item', layer: 40, slot: 'outfit', code: 'dealer01' })
    // …and a letter that is not a wear is not a name at all.
    expect(NAME_PATTERN.test('item_outfit_dealer01_x_L40')).toBe(false)
    expect(parseName('item_outfit_dealer01_x_L40')).toBeNull()
  })

  it('says which body each wear is: a gender is its own, and nothing else has one (Plan 19 D1)', () => {
    // Until D1 `BASE_WEAR` gave each flat base a wear and `data/avatar-bases.json` mirrored it; a body is owned by its
    // gender now, and its gender is its wear.
    expect(WEARS).toEqual(['f', 'm'])
    expect([wearOf('f'), wearOf('m'), wearOf('f01'), wearOf('m01'), wearOf('x')]).toEqual(['f', 'm', null, null, null])
  })

  it('refuses a variant whose wear is not the wear of the body it is cut on, and an item cut on no body', async () => {
    // The layer is the shape of the figure it was diffed against, so cutting an `m` variant on body f would
    // ship a female silhouette under a male name — a mistake nothing downstream could see.
    const dir = caseDir('variant-mismatch')
    const file = join(dir, 'clothes.png')
    await writePicture(await renderSvg(sourceSvg(CLOTHES), SRC.w, SRC.h), file)
    const run = (baseId: string, variant: string | null): Promise<unknown> =>
      ingest({ file, target: { kind: 'item', slot: 'outfit', code: 'dealer01' }, dir, targets: [join(dir, MANIFEST_NAME)], baseId, variant })
    await expect(run('f', 'm')).rejects.toThrow(/--variant m does not match body f/)
    await expect(run('m', 'f')).rejects.toThrow(/--variant f does not match body m/)
    await expect(run('m', 'x')).rejects.toThrow(/--variant x is not one of f, m/)
    // An old base names no body any more (D1): there is nothing left to cut the item on.
    await expect(run('m01', null)).rejects.toThrow(/--base m01 is not a body/)
    // …and nothing is written on the way to refusing.
    expect(existsSync(join(dir, MANIFEST_NAME))).toBe(false)
  }, 60_000)

  it('cuts a male variant on body m: its own name, its own icon, and the item it belongs to', async () => {
    const dir = caseDir('variant-ingest')
    const base = join(dir, 'base.png')
    const clothes = join(dir, 'clothes.png')
    await writePicture(await renderSvg(sourceSvg(), SRC.w, SRC.h), base)
    await writePicture(await renderSvg(sourceSvg(CLOTHES), SRC.w, SRC.h), clothes)
    const run = (args: string[]): string => {
      try {
        return execFileSync(process.execPath, [SCRIPT, ...args], { cwd: PACKAGE_ROOT, encoding: 'utf8' })
      } catch (error) {
        // The pipeline's own table is the diagnosis; the exit code alone says nothing.
        throw new Error(`${(error as { stdout?: string }).stdout ?? ''}\n${(error as { stderr?: string }).stderr ?? ''}\n${(error as Error).message}`)
      }
    }
    seedCanvas(dir, ['m'])
    run(['ingest', base, '--as', 'body:m', '--out', dir])
    // The line for a male dealer01: the body's gender is its wear.
    run(['ingest', clothes, '--as', 'item:outfit:dealer01', '--base', 'm', '--variant', 'm', '--out', dir])

    const manifest = JSON.parse(readFileSync(join(dir, MANIFEST_NAME), 'utf8')) as Manifest
    const name = 'item_outfit_dealer01_m_L40'
    expect(manifest.files[name]).toMatchObject({
      layer: LAYERS.outfit,
      w: FRAME.w,
      h: FRAME.h,
      real: true,
      variantOf: 'item_outfit_dealer01_L40',
      wear: 'm',
      cutOn: 'm',
    })
    expect(manifest.files[name]!.placeholder).toBeUndefined()
    // The default layer is *not* written by a variant ingest: it is another picture, on another body.
    expect(manifest.files.item_outfit_dealer01_L40).toBeUndefined()
    for (const density of DENSITIES) expect(existsSync(join(dir, `${name}@${density}x.png`)), `${name}@${density}x`).toBe(true)
    // Its own icon, under the manifest's `icons` key like every other item's.
    expect(manifest.icons?.item_outfit_dealer01_m_icon).toMatchObject({ kind: 'icon', of: name, w: ICON.w, h: ICON.h, real: true })
    for (const density of DENSITIES) expect(existsSync(join(dir, `item_outfit_dealer01_m_icon@${density}x.png`))).toBe(true)
    // The whole gate, bar C6: this synthetic body is one flat grey with no underwear on it at all, so
    // there is no band for an outfit to cover and no verdict to give. C6's own routing is two cases below.
    expect(run(['check', name, '--dir', dir, '--skip', 'C6'])).not.toMatch(/FAIL/)
  }, 300_000)

  it('placeholder draws no variant and leaves a real one exactly as it is', async () => {
    // A variant is not in the stage-1 list at all — it exists only once a picture of it has been
    // generated — so `placeholder` must neither invent one nor drop the one it finds for not being listed.
    const dir = caseDir('variant-placeholder')
    const name = 'item_outfit_dealer01_m_L40'
    const pic = blankPicture(FRAME.w * 2, FRAME.h * 2)
    for (let y = 500; y < 700; y++) {
      for (let x = 300; x < 460; x++) pic.data.set([30, 40, 150, 255], (y * pic.width + x) * 4)
    }
    const bytes2x = await writeDensities(pic, dir, name)
    const before = DENSITIES.map((density: number) => readFileSync(join(dir, `${name}@${density}x.png`)))
    manifestFor(dir, { [name]: { layer: LAYERS.outfit, w: FRAME.w, h: FRAME.h, bytes2x, real: true, variantOf: 'item_outfit_dealer01_L40', wear: 'm' } })

    const after = await buildPlaceholders({ dir, targets: [join(dir, MANIFEST_NAME)] }) as unknown as Manifest
    expect(after.files[name], 'the real variant was dropped for not being on the stage-1 list').toEqual({
      layer: LAYERS.outfit, w: FRAME.w, h: FRAME.h, bytes2x, real: true, variantOf: 'item_outfit_dealer01_L40', wear: 'm',
    })
    DENSITIES.forEach((density: number, index: number) => {
      expect(readFileSync(join(dir, `${name}@${density}x.png`)).equals(before[index]!), `${name}@${density}x was redrawn`).toBe(true)
    })
    // The icon it had never been given is cut from the layer on disk, exactly as for any other real item…
    expect(after.icons?.item_outfit_dealer01_m_icon).toMatchObject({ kind: 'icon', of: name, real: true })
    // …and no stand-in variant was invented for anything else.
    const invented = Object.keys(after.files).filter((file) => parseName(file)?.wear && file !== name)
    expect(invented, `placeholder drew variants: ${invented.join(', ')}`).toEqual([])
  }, 600_000)

  it('placeholder re-cuts the icon tint mask of a real icon it re-cuts (Plan 18, No8a)', async () => {
    // A real layer whose icon has gone missing gets it back from the layer on disk; when that layer has a tint mask,
    // the icon's own tint mask comes back with it, cut with the icon's fit — the left half of the block, here.
    const dir = caseDir('variant-placeholder-tint')
    const name = 'item_outfit_dealer01_m_L40'
    const pic = blankPicture(FRAME.w * 2, FRAME.h * 2)
    const mask = blankPicture(FRAME.w * 2, FRAME.h * 2)
    for (let y = 500; y < 700; y++) {
      for (let x = 300; x < 460; x++) {
        pic.data.set([30, 40, 150, 255], (y * pic.width + x) * 4)
        if (x < 380) mask.data.set([255, 255, 255, 255], (y * mask.width + x) * 4)
      }
    }
    const bytes2x = await writeDensities(pic, dir, name)
    const maskBytes = await writeDensities(mask, dir, `${name}_tintmask`)
    manifestFor(dir, {
      [name]: {
        layer: LAYERS.outfit, w: FRAME.w, h: FRAME.h, bytes2x, real: true, variantOf: 'item_outfit_dealer01_L40', wear: 'm',
        masks: { tint: { bytes2x: maskBytes, meanL: 0.3 } },
      },
    })

    const after = await buildPlaceholders({ dir, targets: [join(dir, MANIFEST_NAME)] }) as unknown as Manifest
    expect(after.icons?.item_outfit_dealer01_m_icon).toMatchObject({ kind: 'icon', of: name, real: true, tintMask: true })
    for (const density of DENSITIES) {
      const iconMask = await readPicture(join(dir, `item_outfit_dealer01_m_icon_tintmask@${density}x.png`))
      expect([iconMask.width, iconMask.height], `@${density}x`).toEqual([ICON.w * density, ICON.h * density])
    }
    // The block's box is 160 × 200 @2x, fitted to 129 × 161 from x 31: its left half lands left of the icon's centre.
    const at2x = await readPicture(join(dir, 'item_outfit_dealer01_m_icon_tintmask@2x.png'))
    const alphaAt = (x: number): number => at2x.data[(ICON.h * at2x.width + x) * 4 + 3]!
    expect(alphaAt(ICON.w - 30), 'the masked half').toBeGreaterThan(200)
    expect(alphaAt(ICON.w + 30), 'the unmasked half').toBeLessThan(10)
  }, 600_000)

  // ── C6, routed by wear (R3) ──

  /** A figure with a skin-coloured head filling `SKIN_WINDOW` and an underwear band of the given width. */
  function baseWithUnderwear(x0: number, x1: number): Picture {
    const pic = blankPicture(FRAME.w, FRAME.h)
    const paint = (bx0: number, by0: number, bx1: number, by1: number, rgb: [number, number, number]): void => {
      for (let y = by0; y < by1; y++) {
        for (let x = bx0; x < bx1; x++) pic.data.set([...rgb, 255], (y * FRAME.w + x) * 4)
      }
    }
    paint(140, 124, 244, 250, [230, 200, 180])
    // Below `FACE_LIMIT_Y`, so it is underwear rather than a face the head-region rule drops.
    paint(x0, 250, x1, 300, [90, 100, 120])
    return pic
  }

  /** A solid outfit layer over the rows the band occupies, `x0`–`x1` wide. */
  function outfitCovering(x0: number, x1: number): Picture {
    const pic = blankPicture(FRAME.w, FRAME.h)
    for (let y = 248; y < 302; y++) {
      for (let x = x0; x < x1; x++) pic.data.set([30, 40, 150, 255], (y * FRAME.w + x) * 4)
    }
    return pic
  }

  /** Body f's band is narrow, body m's is wide; the skirt covers only the first. */
  const F_BAND = [150, 230] as const
  const M_BAND = [120, 260] as const

  /** Each picture at @1x as a real layer; an outfit cut on body f — or, a variant, on the body of its wear. */
  async function c6Fixture(dir: string, files: Record<string, Picture>): Promise<Record<string, ManifestEntry>> {
    const entries: Record<string, ManifestEntry> = {}
    for (const [name, picture] of Object.entries(files)) {
      await writePicture(picture, join(dir, `${name}@1x.png`))
      const parsed = parseName(name)!
      entries[name] = { layer: parsed.layer, w: FRAME.w, h: FRAME.h, bytes2x: 1, real: true, ...(parsed.kind === 'item' ? { cutOn: parsed.wear ?? 'f' } : {}) }
    }
    return entries
  }

  it('measures a variant only against the body that wears it', async () => {
    const dir = caseDir('c6-variant')
    const entries = await c6Fixture(dir, {
      body_f_L30: baseWithUnderwear(...F_BAND),
      body_m_L30: baseWithUnderwear(...M_BAND),
      item_outfit_dealer01_L40: outfitCovering(148, 232),
      item_outfit_dealer01_m_L40: outfitCovering(118, 262),
    })
    entries.item_outfit_dealer01_m_L40 = { ...entries.item_outfit_dealer01_m_L40!, variantOf: 'item_outfit_dealer01_L40', wear: 'm' }
    const manifest = manifestFor(dir, entries)

    // The male cut covers body m and would leave body f's narrower band over-covered rather than bare, but the
    // point is that it is never held to a figure that will not wear it.
    const variant = (await checkOne(dir, 'item_outfit_dealer01_m_L40', manifest)).get('C6')!
    expect(variant.ok, variant.detail).toBe(true)
    expect(variant.detail).toContain('body_m_L30')

    // The default layer stops being what body m wears the moment the male cut exists, so it is measured
    // against body f alone — where it covers every thread — and not against the wide band it never sees.
    const shared = (await checkOne(dir, 'item_outfit_dealer01_L40', manifest)).get('C6')!
    expect(shared.ok, shared.detail).toBe(true)
    expect(shared.detail).toBe('covers 100.0 % of body_f_L30')
  }, 60_000)

  it('still measures a default layer against every wear that has no variant of it', async () => {
    // The control for the case above: with no male cut in the manifest, body m wears the shared layer and
    // C6 says so — the routing is a consequence of the variant existing, not of the name of the body.
    const dir = caseDir('c6-no-variant')
    const manifest = manifestFor(dir, await c6Fixture(dir, {
      body_f_L30: baseWithUnderwear(...F_BAND),
      body_m_L30: baseWithUnderwear(...M_BAND),
      item_outfit_dealer01_L40: outfitCovering(148, 232),
    }))
    const shared = (await checkOne(dir, 'item_outfit_dealer01_L40', manifest)).get('C6')!
    expect(shared.ok, shared.detail).toBe(false)
    expect(shared.detail).toContain("leaves body_m_L30's underwear showing")
  }, 60_000)
})

// ──────────────────────────────────────────────── a body's cut, and empty layers ──

/** Every pixel with any alpha, as `x,y`, that lies outside the head region at this density. */
function inkOutsideHead(pic: Picture, density: number): string[] {
  const left = CROP.x * density
  const right = (CROP.x + CROP.size) * density
  const top = CROP.y * density
  const bottom = Math.min(CROP.y + CROP.size, FACE_LIMIT_Y) * density
  const found: string[] = []
  for (let y = 0; y < pic.height; y++) {
    for (let x = 0; x < pic.width; x++) {
      // The torso column below y 236 is not the face layer's either (2026-09-17): a strap there shows over every outfit.
      const torso = y >= TORSO_COLUMN.y0 * density && x >= TORSO_COLUMN.x0 * density && x < (TORSO_COLUMN.x1 + 1) * density
      if (x >= left && x < right && y >= top && y < bottom && !torso) continue
      if (pic.data[(y * pic.width + x) * 4 + 3]! > 0) found.push(`${x},${y}`)
    }
  }
  return found
}

const fullyTransparent = (pic: Picture): boolean => {
  for (let i = 3; i < pic.data.length; i += 4) if (pic.data[i] !== 0) return false
  return true
}

describe('a body cut from one picture, and layers marked empty', () => {
  // The grey FIGURE as a body, on its canvas's transform (`seedCanvas`).
  const ingestBody = async (dir: string): Promise<Manifest> => {
    const file = join(dir, 'body.png')
    await writePicture(await renderSvg(sourceSvg(), SRC.w, SRC.h), file)
    seedCanvas(dir)
    await ingest({ file, target: { kind: 'body', gender: 'f' }, dir, targets: [join(dir, MANIFEST_NAME)] })
    return JSON.parse(readFileSync(join(dir, MANIFEST_NAME), 'utf8')) as Manifest
  }

  it('refuses the retired flat base and its expressions, writing nothing (Plan 19 D1)', async () => {
    const dir = caseDir('flat-base-retired')
    const file = join(dir, 'base.png')
    await writePicture(await renderSvg(sourceSvg(), SRC.w, SRC.h), file)
    for (const target of [{ kind: 'base', base: 'f01' }, { kind: 'expr', base: 'f01', expr: 'happy' }]) {
      await expect(ingest({ file, target, dir, targets: [join(dir, MANIFEST_NAME)] }), target.kind).rejects.toThrow(/retired \(Plan 19 D1\)/)
    }
    expect(existsSync(join(dir, MANIFEST_NAME))).toBe(false)
  }, 60_000)

  it('writes the whole figure as the body and its head region as the neutral face', async () => {
    const dir = caseDir('flat-base')
    const manifest = await ingestBody(dir)
    expect(manifest.files.body_f_L30).toMatchObject({ layer: 30, real: true })
    expect(manifest.files.body_f_L30!.empty).toBeUndefined()

    const face = manifest.files.body_f_face_neutral_L50
    expect(face).toMatchObject({ layer: 50, real: true })
    expect(face!.empty).toBeUndefined()
    for (const density of DENSITIES) {
      const pic = await readPicture(join(dir, `body_f_face_neutral_L50@${density}x.png`))
      expect(alphaBBox(pic), `@${density}x face has no head in it`).not.toBeNull()
      const outside = inkOutsideHead(pic, density)
      expect(outside.length, `@${density}x face has ink outside the head region, e.g. ${outside.slice(0, 3).join(' ')}`).toBe(0)
      // …but beside the torso column, under y 236, the head region is still the face layer's: the arm there.
      let beside = 0
      for (let y = TORSO_COLUMN.y0 * density; y < FACE_LIMIT_Y * density; y++) {
        for (let x = CROP.x * density; x < TORSO_COLUMN.x0 * density; x++) if (pic.data[(y * pic.width + x) * 4 + 3]! > 0) beside++
      }
      expect(beside, `@${density}x lost the head region beside the torso column`).toBeGreaterThan(0)
    }
    // Inside the head region the face is the body's own pixels: layer 50 repeats the head on purpose.
    const body2x = await readPicture(join(dir, 'body_f_L30@2x.png'))
    const face2x = await readPicture(join(dir, 'body_f_face_neutral_L50@2x.png'))
    const at = (144 * 2 * body2x.width + 192 * 2) * 4
    expect([...face2x.data.subarray(at, at + 4)]).toEqual([...body2x.data.subarray(at, at + 4)])

    // C11 skipped: FIGURE is flat grey with flat #202020 eyes — no warm skin for the skin mask, no eye white for the
    // eye mask — fine for the cut geometry this test is about; avatar-masks.test.ts draws real ones. C12 is n/a for
    // the same reason: the neutral face has no eye to measure the head by.
    const rows = await runChecks({ dir, manifest, names: ['body_f_L30', 'body_f_face_neutral_L50'], skip: ['C11'] })
    for (const row of rows) {
      for (const result of row.results) expect(result.ok, `${row.name} ${result.id}: ${result.detail}`).toBe(true)
    }
  }, 120_000)

  it('masks a body face to the head region', async () => {
    const dir = caseDir('flat-expr')
    await ingestBody(dir)
    const file = join(dir, 'happy.png')
    // The same figure with a red smile and a red smudge on the chest: only the smile is head.
    await writePicture(await renderSvg(sourceSvg(`<rect x="500" y="560" width="152" height="30" fill="#cc2222"/>${SMUDGE}`), SRC.w, SRC.h), file)
    await ingest({ file, target: { kind: 'bodyFace', gender: 'f', expr: 'happy' }, dir, targets: [join(dir, MANIFEST_NAME)] })
    const manifest = JSON.parse(readFileSync(join(dir, MANIFEST_NAME), 'utf8')) as Manifest
    expect(manifest.files.body_f_face_happy_L50).toMatchObject({ layer: 50, real: true })
    for (const density of DENSITIES) {
      const pic = await readPicture(join(dir, `body_f_face_happy_L50@${density}x.png`))
      expect(alphaBBox(pic)).not.toBeNull()
      const outside = inkOutsideHead(pic, density)
      expect(outside.length, `@${density}x has ink outside the head region, e.g. ${outside.slice(0, 3).join(' ')}`).toBe(0)
    }
  }, 120_000)

  it('check passes a layer marked empty and fails an unmarked empty one', async () => {
    // A short hairstyle's back layer is the one blank-on-purpose layer since D1 (the flat bases' hair layers were before).
    const dir = caseDir('empty-check')
    for (const name of ['item_hair_f_bob01_L20', 'item_hair_f_bob01_L60']) {
      for (const density of DENSITIES) await writePicture(blankPicture(FRAME.w * density, FRAME.h * density), join(dir, `${name}@${density}x.png`))
    }
    const bytes = (name: string): number => statSync(join(dir, `${name}@2x.png`)).size
    const manifest = manifestFor(dir, {
      item_hair_f_bob01_L20: { layer: 20, w: FRAME.w, h: FRAME.h, bytes2x: bytes('item_hair_f_bob01_L20'), real: true, empty: true },
      item_hair_f_bob01_L60: { layer: 60, w: FRAME.w, h: FRAME.h, bytes2x: bytes('item_hair_f_bob01_L60'), real: true },
    })
    const marked = await checkOne(dir, 'item_hair_f_bob01_L20', manifest)
    for (const [id, result] of marked) expect(result.ok, `${id}: ${result.detail}`).toBe(true)
    const unmarked = await checkOne(dir, 'item_hair_f_bob01_L60', manifest)
    expect([...unmarked.values()].some((result) => !result.ok), 'an unmarked empty layer passed every check').toBe(true)
  }, 30_000)

  it('check fails a layer marked empty that is not', async () => {
    const dir = caseDir('empty-not')
    const entry = await writePlaceholder(dir, 'item_hair_f_bob01_L20')
    const manifest = manifestFor(dir, { item_hair_f_bob01_L20: { layer: entry.layer, w: entry.w, h: entry.h, bytes2x: entry.bytes2x, real: true, empty: true } })
    const results = await checkOne(dir, 'item_hair_f_bob01_L20', manifest)
    expect([...results.values()].some((result) => !result.ok), 'a drawn layer marked empty passed every check').toBe(true)
  }, 30_000)

  it('placeholder leaves the empty real layers and a real item alone, and gives the item its icon', async () => {
    const dir = caseDir('empty-placeholder')
    const blank = { layer: 0, w: FRAME.w, h: FRAME.h, bytes2x: 0, real: true, empty: true }
    const files: Record<string, ManifestEntry> = {}
    for (const [name, layer] of [['item_hair_f_bob01_L20', 20], ['item_hair_m_tousled01_L20', 20]] as const) {
      for (const density of DENSITIES) await writePicture(blankPicture(FRAME.w * density, FRAME.h * density), join(dir, `${name}@${density}x.png`))
      files[name] = { ...blank, layer, bytes2x: statSync(join(dir, `${name}@2x.png`)).size }
    }
    // A real hat ingested before icons existed: its layer must stay byte for byte, and its icon appear.
    const hat = 'item_head_tophat01_L80'
    for (const density of DENSITIES) {
      const pic = blankPicture(FRAME.w * density, FRAME.h * density)
      for (let y = 60 * density; y < 120 * density; y++) {
        for (let x = 140 * density; x < 240 * density; x++) pic.data.set([30, 30, 40, 255], (y * pic.width + x) * 4)
      }
      await writePicture(pic, join(dir, `${hat}@${density}x.png`))
    }
    const hatBytes = DENSITIES.map((density: number) => readFileSync(join(dir, `${hat}@${density}x.png`)))
    files[hat] = { layer: 80, w: FRAME.w, h: FRAME.h, bytes2x: hatBytes[1]!.length, real: true }
    manifestFor(dir, files)
    await buildPlaceholders({ dir, targets: [join(dir, MANIFEST_NAME)] })
    const after = JSON.parse(readFileSync(join(dir, MANIFEST_NAME), 'utf8')) as Manifest
    expect(Object.keys(after.files)).toHaveLength(stageOneFiles().length)
    for (const name of Object.keys(files)) expect(after.files[name], name).toEqual(files[name])
    for (const name of ['item_hair_f_bob01_L20', 'item_hair_m_tousled01_L20']) {
      for (const density of DENSITIES) {
        expect(fullyTransparent(await readPicture(join(dir, `${name}@${density}x.png`))), `${name}@${density}x was redrawn`).toBe(true)
      }
    }
    DENSITIES.forEach((density: number, index: number) => {
      expect(readFileSync(join(dir, `${hat}@${density}x.png`)).equals(hatBytes[index]!), `${hat}@${density}x was redrawn`).toBe(true)
    })
    expect(after.icons?.item_head_tophat01_icon).toMatchObject({ kind: 'icon', of: hat, real: true })
    expect(after.icons?.item_head_tophat01_icon?.placeholder).toBeUndefined()
    expect(alphaBBox(await readPicture(join(dir, 'item_head_tophat01_icon@2x.png'))), 'the real hat icon is empty').not.toBeNull()
  }, 600_000)
})

describe('the placeholder command', () => {
  it('writes the whole set and says the same thing twice', async () => {
    const dir = caseDir('placeholder-run')
    const run = (): string => execFileSync(process.execPath, [SCRIPT, 'placeholder', '--out', dir], { cwd: PACKAGE_ROOT, encoding: 'utf8' })
    run()
    const first = readFileSync(join(dir, MANIFEST_NAME))
    const written = JSON.parse(first.toString('utf8')) as Manifest
    // …the v4 stand-ins with the masks they are drawn with (Plan 19), which only the manifest names.
    expect(readdirSync(dir).filter((name) => name.endsWith('.png')).sort()).toEqual(stageOnePngs(undefined, undefined, written).sort())
    expect(written.files.body_f_L30?.masks?.skin, 'a fresh stand-in set has no skin mask on its body').toBeDefined()
    expect(written.icons?.item_frame_gold_icon).toMatchObject({ kind: 'icon', of: 'item_frame_gold_L90', placeholder: true })
    // Idempotent: the artefact is committed, so a second run that changed a byte would be a dirty tree.
    run()
    expect(readFileSync(join(dir, MANIFEST_NAME)).equals(first)).toBe(true)
    await Promise.resolve()
  }, 600_000)

  it('drops what the list no longer names — a retired base_* entry and the `bases` key — and keeps `bodies` (Plan 19 D1)', async () => {
    // The switch-over's own path: the committed manifest still listed the six flat bases until `placeholder` ran over
    // it. Their entries and their `bases` transforms go; the files are deleted by hand, never by this.
    const dir = caseDir('placeholder-retired')
    const name = 'base_f01_L30'
    for (const density of DENSITIES) await writePicture(blankPicture(FRAME.w * density, FRAME.h * density), join(dir, `${name}@${density}x.png`))
    const transform = { scale: 0.25, offsetX: 66, offsetY: 52 }
    writeFileSync(join(dir, MANIFEST_NAME), `${JSON.stringify({
      version: 1, frame: FRAME, crop: CROP,
      files: { [name]: { layer: 30, w: FRAME.w, h: FRAME.h, bytes2x: 1, real: true } },
      bases: { f01: { transform } },
      bodies: { f: { transform } },
    }, null, 2)}\n`)
    const after = await buildPlaceholders({ dir, targets: [join(dir, MANIFEST_NAME)] }) as unknown as Manifest & { bases?: unknown }
    expect(after.files[name]).toBeUndefined()
    expect(Object.keys(after.files)).toHaveLength(stageOneFiles().length)
    const written = JSON.parse(readFileSync(join(dir, MANIFEST_NAME), 'utf8')) as Record<string, unknown>
    expect(Object.keys(written)).not.toContain('bases')
    expect(written.bodies).toEqual({ f: { transform } })
    for (const density of DENSITIES) expect(existsSync(join(dir, `${name}@${density}x.png`)), `${name}@${density}x was deleted`).toBe(true)
  }, 600_000)
})

// ─────────────────────────────────── auras, frames and bots (2026-09-24, Plan 12) ──

/**
 * The three targets the registry loop needed next. An aura and a frame are *square* pictures — an effect in
 * a ring on transparency, nothing to diff against a body — placed on the frame by their ink box alone. A bot
 * is a figure drawn from a body's own picture, so it is cut on that body's stored transform: body f's by default
 * since D1 (F01's, before).
 */
describe('auras, frames and bots', () => {
  /** A ring on a transparent square, what the image model returns for an aura or a frame. */
  const ringSvg = (side: number, r: number, stroke: number, inner = ''): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}">` +
    `<circle cx="${side / 2}" cy="${side / 2}" r="${r}" fill="none" stroke="#3a7fd0" stroke-width="${stroke}"/>${inner}</svg>`
  /** A robot drawn from body f's picture: the same figure, with an antenna standing above the head. */
  const ANTENNA = '<rect x="569" y="120" width="14" height="100" fill="#606060"/>'
  const SMILE = '<rect x="500" y="560" width="152" height="30" fill="#cc2222"/>'
  const botFaces = (bot: number): string[] => EXPRESSIONS.map((expr: string) => `bot_${bot}_face_${expr}_L50`)

  const targetsOf = (dir: string): string[] => [join(dir, MANIFEST_NAME)]
  const manifestIn = (dir: string): BotManifest => JSON.parse(readFileSync(join(dir, MANIFEST_NAME), 'utf8')) as BotManifest
  const alphaAt = (pic: Picture, x: number, y: number): number => pic.data[(Math.round(y) * pic.width + Math.round(x)) * 4 + 3]!
  const bytesOf = (dir: string, name: string): Buffer[] => DENSITIES.map((density: number) => readFileSync(join(dir, `${name}@${density}x.png`)))
  async function draw(dir: string, name: string, svg: string, width: number, height: number): Promise<string> {
    const file = join(dir, name)
    await writePicture(await renderSvg(svg, width, height), file)
    return file
  }
  async function allPass(dir: string, names: string[]): Promise<void> {
    const rows = await runChecks({ dir, manifest: manifestIn(dir), names })
    expect(rows.map((row: { name: string }) => row.name)).toEqual(names)
    for (const row of rows as { name: string; results: { id: string; ok: boolean; detail: string }[] }[]) {
      for (const result of row.results) expect(result.ok, `${row.name} ${result.id}: ${result.detail}`).toBe(true)
    }
  }
  /** The grey FIGURE as body f, the first body in `dir`, on its canvas's transform (`seedCanvas`). */
  async function ingestBodyF(dir: string): Promise<void> {
    const file = await draw(dir, 'body.png', sourceSvg(), SRC.w, SRC.h)
    seedCanvas(dir)
    await ingest({ file, target: { kind: 'body', gender: 'f' }, dir, targets: targetsOf(dir) })
  }

  it('fits an aura to AURA_SIZE on the axis at AURA_CY, lets it run off the frame, and passes check', async () => {
    const dir = caseDir('square-aura')
    // 1200 × 1200 with an outer radius of 550: an ink box of 1100, which becomes 400 @1x — wider than the frame.
    const file = await draw(dir, 'aura.png', ringSvg(1200, 500, 100), 1200, 1200)
    await ingest({ file, target: { kind: 'item', slot: 'aura', code: 'water01' }, dir, targets: targetsOf(dir) })
    const manifest = manifestIn(dir)
    expect(manifest.files.item_aura_water01_L10).toMatchObject({ layer: LAYERS.aura, w: FRAME.w, h: FRAME.h, real: true })
    expect(manifest.files.item_aura_water01_L10!.placeholder).toBeUndefined()
    expect(manifest.icons?.item_aura_water01_icon).toMatchObject({ kind: 'icon', of: 'item_aura_water01_L10', w: ICON.w, h: ICON.h, real: true })
    for (const density of DENSITIES) {
      const pic = await readPicture(join(dir, `item_aura_water01_L10@${density}x.png`))
      const box = alphaBBox(pic)!
      // Vertically the whole 400 fits the 448 frame, centred on AURA_CY…
      expect(Math.abs(box.h / density - AURA_SIZE), `@${density}x height ${box.h}`).toBeLessThanOrEqual(3)
      expect(Math.abs((box.y + box.h / 2) / density - AURA_CY), `@${density}x centre y`).toBeLessThanOrEqual(1.5)
      // …and horizontally it is wider than the frame, cut at both edges.
      expect([box.x, box.x + box.w], `@${density}x`).toEqual([0, pic.width])
      // The middle is empty and the ring (mid-radius 500/550 of 200) is solid.
      expect(alphaAt(pic, AXIS_X * density, AURA_CY * density)).toBe(0)
      expect(alphaAt(pic, AXIS_X * density, (AURA_CY - (AURA_SIZE / 2) * (500 / 550)) * density)).toBeGreaterThan(200)
    }
    // The icon is the picture fitted into the square, not the cut layer: a whole ring, as wide as it is tall.
    const icon = alphaBBox(await readPicture(join(dir, 'item_aura_water01_icon@2x.png')))!
    expect(Math.abs(icon.w - icon.h), `icon ${icon.w} × ${icon.h}`).toBeLessThanOrEqual(2)
    await allPass(dir, ['item_aura_water01_L10'])
  }, 120_000)

  it('fits a frame to RING centred on the crop, passes check, and refuses a filled disc', async () => {
    const dir = caseDir('square-frame')
    // 1024 × 1024 with an outer radius of 480: an ink box of 960, which becomes 260 @1x.
    const file = await draw(dir, 'frame.png', ringSvg(1024, 440, 80), 1024, 1024)
    await ingest({ file, target: { kind: 'item', slot: 'frame', code: 'gold' }, dir, targets: targetsOf(dir) })
    const manifest = manifestIn(dir)
    expect(manifest.files.item_frame_gold_L90).toMatchObject({ layer: LAYERS.frame, w: FRAME.w, h: FRAME.h, real: true })
    expect(manifest.icons?.item_frame_gold_icon).toMatchObject({ kind: 'icon', of: 'item_frame_gold_L90', real: true })
    const centreY = CROP.y + CROP.size / 2
    for (const density of DENSITIES) {
      const pic = await readPicture(join(dir, `item_frame_gold_L90@${density}x.png`))
      const box = alphaBBox(pic)!
      expect(Math.abs(box.w / density - RING), `@${density}x width ${box.w}`).toBeLessThanOrEqual(3)
      expect(Math.abs(box.h / density - RING), `@${density}x height ${box.h}`).toBeLessThanOrEqual(3)
      expect(Math.abs((box.x + box.w / 2) / density - AXIS_X), `@${density}x centre x`).toBeLessThanOrEqual(1.5)
      expect(Math.abs((box.y + box.h / 2) / density - centreY), `@${density}x centre y`).toBeLessThanOrEqual(1.5)
      expect(alphaAt(pic, AXIS_X * density, centreY * density)).toBe(0)
    }
    await allPass(dir, ['item_frame_gold_L90'])

    // A disc is not a ring: the portrait would be painted over. Refused, and nothing written on the way.
    const discDir = caseDir('square-frame-disc')
    const disc = await draw(discDir, 'disc.png', ringSvg(1024, 440, 80, '<circle cx="512" cy="512" r="400" fill="#3a7fd0"/>'), 1024, 1024)
    await expect(ingest({ file: disc, target: { kind: 'item', slot: 'frame', code: 'gold' }, dir: discDir, targets: targetsOf(discDir) })).rejects.toThrow(/hollow/)
    expect(existsSync(join(discDir, MANIFEST_NAME))).toBe(false)
    expect(existsSync(join(discDir, 'item_frame_gold_L90@2x.png'))).toBe(false)
  }, 120_000)

  it('cuts a bot on body f’s transform: its body, its neutral face and the other five as marked copies, all cut on f', async () => {
    const dir = caseDir('bot-neutral')
    await ingestBodyF(dir)
    const file = await draw(dir, 'bot.png', sourceSvg(ANTENNA), SRC.w, SRC.h)
    await ingest({ file, target: { kind: 'bot', bot: 3, expr: 'neutral' }, dir, targets: targetsOf(dir) })
    const manifest = manifestIn(dir)
    expect(manifest.files.bot_3_L30).toMatchObject({ layer: LAYERS.body, w: FRAME.w, h: FRAME.h, real: true })
    expect(manifest.files.bot_3_face_neutral_L50).toMatchObject({ layer: LAYERS.face, real: true })
    expect(manifest.files.bot_3_face_neutral_L50!.copyOf).toBeUndefined()
    const neutral = bytesOf(dir, 'bot_3_face_neutral_L50')
    for (const expr of EXPRESSIONS.filter((expr: string) => expr !== 'neutral')) {
      const name = `bot_3_face_${expr}_L50`
      expect(manifest.files[name], name).toMatchObject({ layer: LAYERS.face, w: FRAME.w, h: FRAME.h, real: true, copyOf: 'bot_3_face_neutral_L50' })
      bytesOf(dir, name).forEach((bytes, index) => expect(bytes.equals(neutral[index]!), `${name} is not the neutral face`).toBe(true))
    }
    // Exactly what the kit draws for a bot (`layersFor`): a body and six faces — no hair layers, no icon.
    expect(Object.keys(manifest.files).filter((name) => name.startsWith('bot_')).sort()).toEqual(['bot_3_L30', ...botFaces(3)].sort())
    expect(Object.keys(manifest.icons ?? {})).toEqual([])
    expect(Object.keys(manifest.bodies ?? {})).toEqual(['f'])
    for (const name of ['bot_3_L30', ...botFaces(3)]) expect((manifest.files[name] as { cutOn?: string }).cutOn, name).toBe('f')
    // Body f's transform, not its own box: the antenna makes the bot's box taller, yet its feet and its width land
    // on body f's pixels — and the antenna stays: a bot wears nothing that could hide it.
    const body = alphaBBox(await readPicture(join(dir, 'body_f_L30@1x.png')))!
    const bot = alphaBBox(await readPicture(join(dir, 'bot_3_L30@1x.png')))!
    expect([bot.x, bot.w, bot.y + bot.h]).toEqual([body.x, body.w, body.y + body.h])
    expect(bot.y).toBeLessThan(body.y - 20)
    await allPass(dir, ['bot_3_L30', ...botFaces(3)])
    // Eight bots, 0–7: a ninth has nowhere to go.
    await expect(ingest({ file, target: { kind: 'bot', bot: 9, expr: 'neutral' }, dir, targets: targetsOf(dir) })).rejects.toThrow(/bot 9/)
  }, 180_000)

  it('replaces only the happy face with a happy picture, and a later neutral ingest keeps it', async () => {
    const dir = caseDir('bot-happy')
    await ingestBodyF(dir)
    const neutralFile = await draw(dir, 'bot.png', sourceSvg(ANTENNA), SRC.w, SRC.h)
    await ingest({ file: neutralFile, target: { kind: 'bot', bot: 3, expr: 'neutral' }, dir, targets: targetsOf(dir) })
    const others = ['bot_3_L30', ...botFaces(3).filter((name) => name !== 'bot_3_face_happy_L50')]
    const before = manifestIn(dir)
    const beforeBytes = Object.fromEntries(others.map((name) => [name, bytesOf(dir, name)]))

    const happyFile = await draw(dir, 'bot-happy.png', sourceSvg(ANTENNA + SMILE), SRC.w, SRC.h)
    await ingest({ file: happyFile, target: { kind: 'bot', bot: 3, expr: 'happy' }, dir, targets: targetsOf(dir) })
    const after = manifestIn(dir)
    expect(after.files.bot_3_face_happy_L50).toMatchObject({ layer: LAYERS.face, real: true })
    expect(after.files.bot_3_face_happy_L50!.copyOf).toBeUndefined()
    expect(bytesOf(dir, 'bot_3_face_happy_L50')[1]!.equals(beforeBytes.bot_3_face_neutral_L50![1]!), 'the happy face is still the neutral one').toBe(false)
    for (const name of others) {
      expect(after.files[name], name).toEqual(before.files[name])
      bytesOf(dir, name).forEach((bytes, index) => expect(bytes.equals(beforeBytes[name]![index]!), `${name} was rewritten`).toBe(true))
    }
    // A cut of the head region only, like an expression's.
    for (const density of DENSITIES) {
      const outside = inkOutsideHead(await readPicture(join(dir, `bot_3_face_happy_L50@${density}x.png`)), density)
      expect(outside.length, `@${density}x happy face has ink outside the head region`).toBe(0)
    }

    // The neutral picture again (a regenerated one, say): every copy is refreshed, the real happy face is not.
    const happy = bytesOf(dir, 'bot_3_face_happy_L50')
    await ingest({ file: neutralFile, target: { kind: 'bot', bot: 3, expr: 'neutral' }, dir, targets: targetsOf(dir) })
    expect(manifestIn(dir).files.bot_3_face_happy_L50).toEqual(after.files.bot_3_face_happy_L50)
    bytesOf(dir, 'bot_3_face_happy_L50').forEach((bytes, index) => expect(bytes.equals(happy[index]!), 'the real happy face was overwritten').toBe(true))
    expect(manifestIn(dir).files.bot_3_face_sad_L50).toMatchObject({ copyOf: 'bot_3_face_neutral_L50' })
    await allPass(dir, ['bot_3_L30', ...botFaces(3)])
  }, 240_000)

  it('C2 lets an aura run to the frame edge, and holds every other layer to it', async () => {
    const dir = caseDir('c2-aura')
    const entries: Record<string, ManifestEntry> = {}
    for (const name of ['item_aura_water01_L10', 'item_frame_gold_L90']) {
      for (const density of DENSITIES) {
        const pic = blankPicture(FRAME.w * density, FRAME.h * density)
        for (let y = 200 * density; y < 260 * density; y++) {
          for (let x = 0; x < pic.width; x++) pic.data.set([40, 90, 200, 255], (y * pic.width + x) * 4)
        }
        await writePicture(pic, join(dir, `${name}@${density}x.png`))
      }
      entries[name] = { layer: parseName(name)!.layer, w: FRAME.w, h: FRAME.h, bytes2x: statSync(join(dir, `${name}@2x.png`)).size, real: true }
    }
    const manifest = manifestFor(dir, entries)
    const aura = (await checkOne(dir, 'item_aura_water01_L10', manifest)).get('C2')!
    expect(aura.ok, aura.detail).toBe(true)
    expect(aura.detail).toMatch(/^n\/a/)
    expect((await checkOne(dir, 'item_frame_gold_L90', manifest)).get('C2')!.ok).toBe(false)
  }, 30_000)

  it('reads all three targets on the command line, and placeholder leaves what they wrote alone', async () => {
    const dir = caseDir('square-cli')
    const run = (args: string[]): string => {
      try {
        return execFileSync(process.execPath, [SCRIPT, ...args], { cwd: PACKAGE_ROOT, encoding: 'utf8' })
      } catch (error) {
        throw new Error(`${(error as { stdout?: string }).stdout ?? ''}\n${(error as { stderr?: string }).stderr ?? ''}\n${(error as Error).message}`)
      }
    }
    const base = await draw(dir, 'base.png', sourceSvg(), SRC.w, SRC.h)
    const aura = await draw(dir, 'aura.png', ringSvg(1200, 500, 100), 1200, 1200)
    const frame = await draw(dir, 'frame.png', ringSvg(1024, 440, 80), 1024, 1024)
    const bot = await draw(dir, 'bot.png', sourceSvg(ANTENNA), SRC.w, SRC.h)
    const happy = await draw(dir, 'bot-happy.png', sourceSvg(ANTENNA + SMILE), SRC.w, SRC.h)
    seedCanvas(dir)
    run(['ingest', base, '--as', 'body:f', '--out', dir])
    // The exact lines docs/avatar-2d.md §4 gives.
    run(['ingest', aura, '--as', 'item:aura:fire01', '--out', dir])
    run(['ingest', frame, '--as', 'item:frame:silver', '--out', dir])
    run(['ingest', bot, '--as', 'bot:5', '--out', dir])
    run(['ingest', happy, '--as', 'bot:5:happy', '--out', dir])
    const layers = ['item_aura_fire01_L10', 'item_frame_silver_L90', 'bot_5_L30', ...botFaces(5)]
    expect(run(['check', ...layers, '--dir', dir])).not.toMatch(/FAIL/)

    const before = manifestIn(dir)
    const icons = ['item_aura_fire01_icon', 'item_frame_silver_icon']
    const bytes = Object.fromEntries([...layers, ...icons].map((name) => [name, bytesOf(dir, name)]))
    await buildPlaceholders({ dir, targets: targetsOf(dir) })
    const after = manifestIn(dir)
    for (const name of layers) {
      expect(after.files[name], name).toEqual(before.files[name])
      expect(after.files[name]!.placeholder, `${name} became a stand-in`).toBeUndefined()
    }
    for (const name of icons) expect(after.icons?.[name], name).toEqual(before.icons?.[name])
    for (const [name, was] of Object.entries(bytes)) {
      bytesOf(dir, name).forEach((now, index) => expect(now.equals(was[index]!), `${name} was redrawn`).toBe(true))
    }
  }, 600_000)
})

// ──────────────────────────────── v4: bodies, faces, two-layer hair (Plan 19 A2a) ──

/**
 * The v4 targets of `ingest` (Plan 19 A2a): a bald body and its faces, a hairstyle cut into a front and a back layer,
 * items and bots cut on a body, and C6 routed by an outfit's `cutOn`.
 *
 * Every picture is synthetic and drawn in **frame units**, then mapped onto the source canvas through the canvas's
 * stored transform (`onCanvas`) — the grey FIGURE's, ingested first as body f on the canvas's own transform (`seedCanvas`:
 * the figure's box, as the first flat base f01 set it before D1). A shape drawn at frame (x, y) therefore lands on frame (x, y) once a body cut
 * on that transform has ingested it — which is what puts this body's eyes and chin exactly where C12 wants F01's, and
 * what lets every assertion below name its pixels by the shapes that drew them.
 *
 * The shared state is built lazily (`setup`), once per run, and every case works in its own copy of it.
 */
describe('v4 ingest (Plan 19 A2a)', () => {
  type Transform = { scale: number; offsetX: number; offsetY: number }
  type V4Entry = ManifestEntry & { cutOn?: string; copyOf?: string; tintSeed?: { x: number; y: number }; recolouredTo?: string }
  type V4Manifest = Omit<Manifest, 'files'> & {
    files: Record<string, V4Entry>
    bodies?: Record<string, { transform: Transform; anchor?: string }>
  }

  const CREAM = '#f1d2b6'
  const SHADE = '#d9a47a'
  const TANK = '#9aa3ad'
  const SHORTS = '#4a4f57'
  const IRIS_BLUE = '#2f4f80'
  const IRIS_BROWN = '#8a5a3c'
  const MOUTH = '#c0505a'
  const BROW = '#7a4a32'
  /** What a hair picture redraws the mouth and the brows in: another pink (43 from `MOUTH`), a darker brown (51). */
  const MOUTH_REDRAWN = '#d9607a'
  const BROW_REDRAWN = '#4e3226'
  const PURPLE = '#5e3e6f'
  const DARK_BROWN = '#4a2e20'
  const RED = '#cc2222'
  /** The two eyes' centres, on `HEAD_REFERENCE`: midpoint (190.9, 194.0), 60.6 apart. */
  const EYE_XS = [HEAD_REFERENCE.eyeMidX - HEAD_REFERENCE.eyeSpan / 2, HEAD_REFERENCE.eyeMidX + HEAD_REFERENCE.eyeSpan / 2]
  const EYE_Y = HEAD_REFERENCE.eyeMidY
  const IRIS_RADIUS = 6.5
  /** A shaded patch on the left cheek: skin by the skin mask's hue rule, and a hair picture may paint it out. */
  const SHADE_AT = { cx: 150, cy: 212, rx: 10, ry: 6 }
  /**
   * The mouth as the body draws it, and as a hair picture redraws it: bigger, 8 units lower, another pink — down to
   * y 239, past y 236, below which the face layer gives up the torso column (`keepOnlyFace`) while the chin is at 244.
   */
  const MOUTH_AT = { cx: 192, cy: 226, rx: 7, ry: 2.5 }
  const MOUTH_REDRAWN_AT = { cx: 192, cy: 234, rx: 10, ry: 5 }
  /** The brows as the body draws them (thin, y 177) and as a hair picture redraws them (bolder, 5 units higher). */
  const BROW_AT = { y: 177, width: 2.5 }
  const BROW_REDRAWN_AT = { y: 172, width: 5 }
  /** A fringe hanging from the cap down over both eyes. */
  const FRINGE_AT = { x: 140, y: 120, w: 104, h: 90 }
  /** The hair: a cap over the head top (inside the crown band) and two strips beside the torso (off the body). */
  const CAP = { cx: 192, cy: 150, rx: 78, ry: 75, bottom: 132 }
  const PANELS = [{ x: 92, y: 240, w: 30, h: 90 }, { x: 262, y: 240, w: 30, h: 90 }]
  /** A hat over the head top: beanie01's real tint seed (191, 98) is inside it. */
  const HAT_AT = { x: 150, y: 62, w: 84, h: 50 }
  /** Hairline wisps: one hanging from the foot of each panel, one rising from the crown — a pixel wide at @2x, and long. */
  const WISPS = [{ x: 106.5, y: 320, w: 1, h: 34 }, { x: 276.5, y: 320, w: 1, h: 34 }, { x: 191.5, y: 52, w: 1, h: 30 }]

  /**
   * A bald body as the v4 template asks for one, in frame units: a cream head whose eyes sit on `HEAD_REFERENCE` and
   * whose chin (where the head narrows into the 30-wide neck) is at y ≈ 244, thin brown brows, a pink mouth, a grey
   * tank top, charcoal shorts, cream arms and legs, the feet on `BASELINE_Y`. `dy` moves all of it down; `iris`,
   * `shade` and `redrawn` (the mouth and the brows) are what a hair picture redraws; `cream` is the skin.
   */
  function body({ dy = 0, iris = IRIS_BLUE, shade = true, redrawn = false, extra = '', cream = CREAM } = {}): string {
    const eye = (cx: number): string =>
      `<ellipse cx="${cx}" cy="${EYE_Y}" rx="10" ry="12" fill="#ffffff"/><circle cx="${cx}" cy="${EYE_Y}" r="${IRIS_RADIUS}" fill="${iris}"/>`
    const brow = redrawn ? BROW_REDRAWN_AT : BROW_AT
    const brows = EYE_XS.map((cx) =>
      `<path d="M${cx - 10.5} ${brow.y} Q${cx} ${brow.y - 5} ${cx + 10.5} ${brow.y}" stroke="${redrawn ? BROW_REDRAWN : BROW}" stroke-width="${brow.width}" fill="none" stroke-linecap="round"/>`).join('')
    const mouth = redrawn ? MOUTH_REDRAWN_AT : MOUTH_AT
    return `<g transform="translate(0 ${dy})">` +
      `<rect x="148" y="250" width="88" height="80" rx="12" fill="${TANK}"/>` +
      `<rect x="150" y="318" width="84" height="34" rx="6" fill="${SHORTS}"/>` +
      `<rect x="128" y="254" width="18" height="78" rx="9" fill="${cream}"/>` +
      `<rect x="238" y="254" width="18" height="78" rx="9" fill="${cream}"/>` +
      `<rect x="160" y="348" width="26" height="54" rx="10" fill="${cream}"/>` +
      `<rect x="198" y="348" width="26" height="54" rx="10" fill="${cream}"/>` +
      `<ellipse cx="172" cy="402" rx="16" ry="6" fill="${cream}"/>` +
      `<ellipse cx="212" cy="402" rx="16" ry="6" fill="${cream}"/>` +
      `<rect x="177" y="225" width="30" height="30" fill="${cream}"/>` +
      `<ellipse cx="192" cy="165" rx="74" ry="80" fill="${cream}"/>` +
      (shade ? `<ellipse cx="${SHADE_AT.cx}" cy="${SHADE_AT.cy}" rx="${SHADE_AT.rx}" ry="${SHADE_AT.ry}" fill="${SHADE}"/>` : '') +
      eye(EYE_XS[0]!) + eye(EYE_XS[1]!) + brows +
      `<ellipse cx="${mouth.cx}" cy="${mouth.cy}" rx="${mouth.rx}" ry="${mouth.ry}" fill="${redrawn ? MOUTH_REDRAWN : MOUTH}"/>` +
      `${extra}</g>`
  }
  const hair = (fill: string): string =>
    `<clipPath id="cap"><rect x="0" y="0" width="${FRAME.w}" height="${CAP.bottom}"/></clipPath>` +
    `<ellipse clip-path="url(#cap)" cx="${CAP.cx}" cy="${CAP.cy}" rx="${CAP.rx}" ry="${CAP.ry}" fill="${fill}"/>` +
    PANELS.map((p) => `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="8" fill="${fill}"/>`).join('')
  const HAT = `<rect x="${HAT_AT.x}" y="${HAT_AT.y}" width="${HAT_AT.w}" height="${HAT_AT.h}" rx="10" fill="${RED}"/>`
  const OUTFIT = '<rect x="140" y="238" width="104" height="116" rx="8" fill="#2244cc"/>'
  const ANTENNA = '<rect x="189" y="60" width="6" height="26" fill="#606060"/>'
  const SMILE = `<path d="M182 224 Q192 232 202 224" stroke="${MOUTH}" stroke-width="3" fill="none"/>`

  /** Frame-unit shapes on the green source canvas, through `t`: frame (x, y) is source ((x − offsetX) / scale, …). */
  function onCanvas(shapes: string, t: Transform): string {
    const k = 1 / t.scale
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${SRC.w}" height="${SRC.h}">` +
      `<rect width="${SRC.w}" height="${SRC.h}" fill="#00ff00"/>` +
      `<g transform="matrix(${k} 0 0 ${k} ${-t.offsetX * k} ${-t.offsetY * k})">${shapes}</g></svg>`
  }

  const targetsOf = (dir: string): string[] => [join(dir, MANIFEST_NAME)]
  const manifestIn = (dir: string): V4Manifest => JSON.parse(readFileSync(join(dir, MANIFEST_NAME), 'utf8')) as V4Manifest
  const bytesOf = (dir: string, name: string): Buffer[] => DENSITIES.map((density: number) => readFileSync(join(dir, `${name}@${density}x.png`)))
  /** A case's own copy of a set-up directory. */
  function copyCase(from: string, name: string): string {
    const dir = join(temp, name)
    cpSync(from, dir, { recursive: true })
    return dir
  }
  /** An empty hand-drawn-mask directory, so no committed override reaches a case that ingests through `ingest()`. */
  const noOverrides = (): string => caseDir('v4-no-overrides')
  async function draw(dir: string, name: string, shapes: string): Promise<string> {
    const file = join(dir, name)
    await writePicture(await renderSvg(onCanvas(shapes, await canvasTransform()), SRC.w, SRC.h), file)
    return file
  }
  const run = (args: string[]): string => {
    try {
      return execFileSync(process.execPath, [SCRIPT, ...args], { cwd: PACKAGE_ROOT, encoding: 'utf8' })
    } catch (error) {
      throw new Error(`${(error as { stdout?: string }).stdout ?? ''}\n${(error as { stderr?: string }).stderr ?? ''}\n${(error as Error).message}`)
    }
  }
  /** A run that has to exit non-zero, and what it printed. */
  const runFailing = (args: string[]): string => {
    try {
      execFileSync(process.execPath, [SCRIPT, ...args], { cwd: PACKAGE_ROOT, encoding: 'utf8' })
    } catch (error) {
      return `${(error as { stdout?: string }).stdout ?? ''}${(error as { stderr?: string }).stderr ?? ''}`
    }
    throw new Error(`${args.join(' ')} exited 0`)
  }
  async function allPass(dir: string, names: string[]): Promise<Map<string, Map<string, { ok: boolean; detail: string }>>> {
    const rows = await runChecks({ dir, manifest: manifestIn(dir), names }) as { name: string; results: { id: string; ok: boolean; detail: string }[] }[]
    expect(rows.map((row) => row.name)).toEqual(names)
    for (const row of rows) {
      for (const result of row.results) expect(result.ok, `${row.name} ${result.id}: ${result.detail}`).toBe(true)
    }
    return new Map(rows.map((row) => [row.name, new Map(row.results.map((result) => [result.id, { ok: result.ok, detail: result.detail }]))]))
  }

  /** Every @2x pixel whose centre, in frame units, `inside` accepts. */
  function at2x(inside: (x: number, y: number) => boolean): Uint8Array {
    const W = FRAME.w * 2
    const out = new Uint8Array(W * FRAME.h * 2)
    for (let p = 0; p < out.length; p++) if (inside((p % W + 0.5) / 2, (Math.floor(p / W) + 0.5) / 2)) out[p] = 1
    return out
  }
  /** The share of `region`'s pixels where `pic` is solid (alpha ≥ 128), and how many there are at all. */
  function solidShare(pic: Picture, region: Uint8Array): number {
    let inside = 0
    let held = 0
    for (let p = 0; p < region.length; p++) {
      if (!region[p]) continue
      inside++
      if (pic.data[p * 4 + 3]! >= 128) held++
    }
    return inside === 0 ? 0 : held / inside
  }
  /** How many of `region`'s pixels `pic` has any alpha on. */
  function inked(pic: Picture, region: Uint8Array): number {
    let n = 0
    for (let p = 0; p < region.length; p++) if (region[p] && pic.data[p * 4 + 3]! > 0) n++
    return n
  }
  /** Solid pixels of `pic` within 30 of `hex`. */
  function solidOf(pic: Picture, hex: string): number {
    const n = Number.parseInt(hex.slice(1), 16)
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    let count = 0
    for (let p = 0; p < pic.width * pic.height; p++) {
      const at = p * 4
      if (pic.data[at + 3]! < 128) continue
      if (Math.hypot(pic.data[at]! - r, pic.data[at + 1]! - g, pic.data[at + 2]! - b) <= 30) count++
    }
    return count
  }
  const inCap = (shrink: number) => (x: number, y: number): boolean =>
    y <= CAP.bottom - shrink && ((x - CAP.cx) / (CAP.rx - shrink)) ** 2 + ((y - CAP.cy) / (CAP.ry - shrink)) ** 2 <= 1
  const inPanels = (shrink: number) => (x: number, y: number): boolean =>
    PANELS.some((p) => x >= p.x + shrink && x <= p.x + p.w - shrink && y >= p.y + shrink && y <= p.y + p.h - shrink)
  const inEllipse = (e: { cx: number; cy: number; rx: number; ry: number }, grow: number) => (x: number, y: number): boolean =>
    ((x - e.cx) / (e.rx + grow)) ** 2 + ((y - e.cy) / (e.ry + grow)) ** 2 <= 1
  /** The pixels a hair picture redraws on the face: the cheek's shading and both irises, each grown by a unit. */
  const redrawnFace = at2x((x, y) => inEllipse(SHADE_AT, 1)(x, y) || EYE_XS.some((ex) => Math.hypot(x - ex, y - EYE_Y) <= IRIS_RADIUS + 1))
  /** …and the mouth and the brows it redraws, where the body had them and where the picture puts them, grown by a unit. */
  const redrawnMouth = at2x((x, y) => inEllipse(MOUTH_AT, 1)(x, y) || inEllipse(MOUTH_REDRAWN_AT, 1)(x, y))
  const redrawnBrows = at2x((x, y) => EYE_XS.some((cx) => x >= cx - 13 && x <= cx + 13 && y >= BROW_REDRAWN_AT.y - 9 && y <= BROW_AT.y + 3))

  function memo<T>(make: () => Promise<T>): () => Promise<T> {
    let made: Promise<T> | null = null
    return () => (made ??= make())
  }
  /**
   * The canvas every v4 picture is drawn on (`f01_candidate_1.png`'s role): the grey FIGURE ingested as body f on the
   * canvas's own transform (`seedCanvas`, the figure's own box) — whose stored transform the real bald body then keeps.
   */
  const canvasDir = memo(async () => {
    const dir = caseDir('v4-canvas')
    const file = join(dir, 'canvas.png')
    await writePicture(await renderSvg(sourceSvg(), SRC.w, SRC.h), file)
    seedCanvas(dir)
    await ingest({ file, target: { kind: 'body', gender: 'f' }, dir, targets: targetsOf(dir), overridesDir: noOverrides() })
    return dir
  })
  const canvasTransform = async (): Promise<Transform> => manifestIn(await canvasDir()).bodies!.f!.transform
  /** The canvas, then the bald body as `body:f` over it. */
  const bodyDir = memo(async () => {
    const dir = copyCase(await canvasDir(), 'v4-body')
    await ingest({ file: await draw(dir, 'body.png', body()), target: { kind: 'body', gender: 'f' }, dir, targets: targetsOf(dir), overridesDir: noOverrides() })
    return dir
  })
  /**
   * …then `hair:f_bob01`: the same body with the cap and the panels — its cheek painted out, its irises brown, its
   * mouth and brows drawn again a little elsewhere.
   */
  const hairCase = memo(async () => {
    const dir = copyCase(await bodyDir(), 'v4-hair')
    const lines: string[] = []
    const file = await draw(dir, 'hair.png', body({ iris: IRIS_BROWN, shade: false, redrawn: true }) + hair(PURPLE))
    await ingest({ file, target: { kind: 'hair', code: 'f_bob01' }, dir, targets: targetsOf(dir), overridesDir: noOverrides(), log: (line: string) => lines.push(line) })
    return { dir, lines }
  })

  it('1. ingests a bald body on its stored transform (the canvas’s): its body and neutral face, real and masked, pass C1–C13', async () => {
    const dir = await bodyDir()
    const manifest = manifestIn(dir)
    expect(manifest.bodies?.f).toEqual({ transform: await canvasTransform() })
    // The canvas's transform is the grey figure's own box (`seedCanvas`): the same transform `anchorBase` gives the
    // picture, kept by both bodies cut on it.
    const { scale, offsetX, offsetY } = anchorBase(removeChroma(await renderSvg(sourceSvg(), SRC.w, SRC.h), { tolerance: 40 }))
    expect(await canvasTransform()).toEqual({ scale, offsetX, offsetY })
    for (const [name, kinds] of [['body_f_L30', ['skin', 'skinLine']], ['body_f_face_neutral_L50', ['eyes', 'skin', 'skinLine']]] as const) {
      expect(manifest.files[name], name).toMatchObject({ real: true })
      expect(manifest.files[name]!.placeholder).toBeUndefined()
      expect(Object.keys(manifest.files[name]!.masks ?? {}).sort(), name).toEqual([...kinds])
      for (const kind of kinds) expect(manifest.files[name]!.masks![kind]!.empty, `${name} ${kind}`).toBeUndefined()
    }
    // The other five faces are not this ingest's: nothing but the body and its neutral face was written.
    expect(Object.keys(manifest.files).filter((name) => name.startsWith('body_')).sort()).toEqual(['body_f_L30', 'body_f_face_neutral_L50'])
    const rows = await allPass(dir, ['body_f_L30', 'body_f_face_neutral_L50'])
    // C12 measured the head (it is not an n/a): the eyes and the chin sit on F01's.
    expect(rows.get('body_f_L30')!.get('C12')!.detail).toMatch(/^eyes \(/)
  }, 300_000)

  it('places a body with no transform of its own on F01’s — in an empty folder, and beside a body moved by its eyes (Plan 19 final review)', async () => {
    // F01's transform, pinned as a constant beside HEAD_REFERENCE: the committed manifest's, verbatim, for both bodies.
    const committed = JSON.parse(readFileSync(WEB_MANIFEST, 'utf8')) as Manifest
    expect(committed.bodies!.f!.transform).toEqual({ ...F01_TRANSFORM })
    expect(committed.bodies!.m!.transform).toEqual({ ...F01_TRANSFORM })
    expect(F01_TRANSFORM.scale).toBeCloseTo(0.2467, 4)
    expect(F01_TRANSFORM.offsetX).toBeCloseTo(65.6, 1)
    expect(F01_TRANSFORM.offsetY).toBeCloseTo(52.0, 1)

    // An empty folder: the body lands on F01's canvas, not on its own box (anchorBase put the real bald body_f at 0.2725).
    const dir = caseDir('v4-f01-transform')
    const file = join(dir, 'body.png')
    await writePicture(await renderSvg(sourceSvg(), SRC.w, SRC.h), file)
    const lines: string[] = []
    await ingest({ file, target: { kind: 'body', gender: 'f' }, dir, targets: targetsOf(dir), overridesDir: noOverrides(), log: (line: string) => lines.push(line) })
    expect(manifestIn(dir).bodies).toEqual({ f: { transform: { ...F01_TRANSFORM } } })
    expect(lines.join('\n')).toMatch(/body f has no transform of its own yet: placed on F01's canvas — scale 0\.2467, offset 65\.6, 52\.0/)
    expect(transform.scale, 'the figure’s own box would have placed it elsewhere').not.toBeCloseTo(F01_TRANSFORM.scale, 3)

    // Body f moved 6 units up by its eyes (as `--anchor head` stores it): body m still lands on F01's, not on body f's.
    const moved = manifestIn(dir)
    moved.bodies!.f = { transform: { ...F01_TRANSFORM, offsetY: F01_TRANSFORM.offsetY - 6 }, anchor: 'head' }
    writeFileSync(join(dir, MANIFEST_NAME), serialiseManifest(moved))
    await ingest({ file, target: { kind: 'body', gender: 'm' }, dir, targets: targetsOf(dir), overridesDir: noOverrides() })
    expect(manifestIn(dir).bodies!.m).toEqual({ transform: { ...F01_TRANSFORM } })
    // …and a body ingested again keeps its own, anchor and all.
    await ingest({ file, target: { kind: 'body', gender: 'f' }, dir, targets: targetsOf(dir), overridesDir: noOverrides() })
    expect(manifestIn(dir).bodies!.f).toEqual(moved.bodies!.f)
  }, 300_000)

  it('2. cuts a hairstyle into a front cap (L60) and a back panel (L20), and leaves the face it redrew out of both', async () => {
    const { dir, lines } = await hairCase()
    const manifest = manifestIn(dir)
    const front = manifest.files.item_hair_f_bob01_L60!
    const back = manifest.files.item_hair_f_bob01_L20!
    expect(front).toMatchObject({ layer: LAYERS.hairFront, real: true })
    expect(back).toMatchObject({ layer: LAYERS.hairBack, real: true })
    expect(front.empty).toBeUndefined()
    expect(back.empty).toBeUndefined()
    expect(front.split!.region).toBeGreaterThan(0)
    expect(front.split!.front + front.split!.back).toBe(front.split!.region)
    expect(back.split).toBeUndefined()
    // The front also carries the skin its picture redrew (2026-10-05), cut against the body ingested before it; the back is
    // behind the body, so its hair is all it carries.
    expect(Object.keys(front.masks ?? {}).sort()).toEqual(['hair', 'skin'])
    expect(Object.keys(back.masks ?? {})).toEqual(['hair'])

    const l60 = await readPicture(join(dir, 'item_hair_f_bob01_L60@2x.png'))
    const l20 = await readPicture(join(dir, 'item_hair_f_bob01_L20@2x.png'))
    // L60 is the cap and nothing of the panels; L20 the panels and nothing of the cap.
    expect(solidShare(l60, at2x(inCap(2)))).toBeGreaterThan(0.98)
    expect(solidShare(l20, at2x(inPanels(2)))).toBeGreaterThan(0.98)
    expect(inked(l60, at2x(inPanels(0)))).toBe(0)
    expect(inked(l20, at2x(inCap(0)))).toBe(0)
    // The cheek the picture painted out and the irises it recoloured are in neither layer (the hair face rule)…
    expect(inked(l60, redrawnFace), 'L60 holds the redrawn cheek or irises').toBe(0)
    expect(inked(l20, redrawnFace), 'L20 holds the redrawn cheek or irises').toBe(0)
    // …nor the mouth and the brows it drew again: neither skin-coloured nor near the eyes, islands inside the face —
    // the mouth across y 236 too, where the face interior has the body's own skin to reach the chin with (A2a review).
    expect(MOUTH_REDRAWN_AT.cy + MOUTH_REDRAWN_AT.ry).toBeGreaterThan(TORSO_COLUMN.y0)
    for (const [part, region] of [['mouth', redrawnMouth], ['brows', redrawnBrows]] as const) {
      expect(inked(l60, region), `L60 holds the redrawn ${part}`).toBe(0)
      expect(inked(l20, region), `L20 holds the redrawn ${part}`).toBe(0)
    }
    expect(lines.some((line) => /^hair face rule: dropped \d+ px .*\([1-9]\d* of skin, [1-9]\d* in islands inside the face\)/.test(line)), lines.join('\n')).toBe(true)

    const rows = await allPass(dir, ['item_hair_f_bob01_L60', 'item_hair_f_bob01_L20'])
    expect(rows.get('item_hair_f_bob01_L60')!.get('C13')!.detail).toContain('the front on 0.0 % of the eyes')
  }, 300_000)

  it('clears the faint litter a split leaves in a hair layer away from its solid part, so C3 holds (Plan 19 C2)', async () => {
    // A wisp that thin is joined to the hair by the region (it is connected to it), but the mask's feather leaves it
    // under alpha 128 along its whole length: faint pixels well past STRAY_MARGIN from the solid part of whichever layer
    // the split gave them to — the back's two below the panels, the front's above the cap. Without the clearing C3
    // fails both layers, at both densities: the @1x too, which the halving makes new litter in even from a clean @2x
    // (the clip, `hairClip`).
    const dir = copyCase(await bodyDir(), 'v4-wisps')
    const wisps = WISPS.map((w) => `<rect x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" fill="${PURPLE}"/>`).join('')
    const file = await draw(dir, 'wisps.png', body({ iris: IRIS_BROWN, shade: false, redrawn: true }) + hair(PURPLE) + wisps)
    const lines: string[] = []
    await ingest({ file, target: { kind: 'hair', code: 'f_bob01' }, dir, targets: targetsOf(dir), overridesDir: noOverrides(), log: (line: string) => lines.push(line) })
    const names = ['item_hair_f_bob01_L60', 'item_hair_f_bob01_L20']
    const rows = await allPass(dir, names)
    for (const name of names) expect(rows.get(name)!.get('C3')!.detail, name).toBe('empty where it should be')

    // The litter was there (a test whose wisps were lost on the way would pass for nothing), and was logged, per layer.
    for (const name of names) {
      const cleared = lines.filter((line) => new RegExp(`^${name}: dropped [1-9]\\d* px of faint litter away from its solid part @2x$`).test(line))
      expect(cleared, `${name}: no litter cleared @2x\n${lines.join('\n')}`).toHaveLength(1)
    }
    // The hair itself stays whole, and the split still adds up: what was cleared was alpha < 128, which `split` never counted.
    const l60 = await readPicture(join(dir, 'item_hair_f_bob01_L60@2x.png'))
    const l20 = await readPicture(join(dir, 'item_hair_f_bob01_L20@2x.png'))
    expect(solidShare(l60, at2x(inCap(2)))).toBeGreaterThan(0.98)
    expect(solidShare(l20, at2x(inPanels(2)))).toBeGreaterThan(0.98)
    const { split } = manifestIn(dir).files.item_hair_f_bob01_L60!
    expect(split!.front + split!.back).toBe(split!.region)
  }, 300_000)

  it('dropStrays clears what C3 flags and nothing else, at the density’s own margin', () => {
    // A 20 × 10 solid block at (40, 30), a faint pixel just inside C3's margin on each side, one just outside, and a
    // soft rim beside the block. Margin: STRAY_MARGIN × density.
    for (const density of DENSITIES) {
      const margin = STRAY_MARGIN * density
      const pic = blankPicture(120, 100)
      const put = (x: number, y: number, alpha: number): void => pic.data.set([200, 100, 50, alpha], (y * pic.width + x) * 4)
      for (let y = 30; y < 40; y++) for (let x = 40; x < 60; x++) put(x, y, 255)
      const kept = [[39, 35, 90], [60 + margin - 1, 35, 40], [50, 30 - margin, 25], [50, 39 + margin, 60]]
      const litter = [[60 + margin, 35, 31], [39 - margin, 35, 10], [50, 29 - margin, 70], [50, 40 + margin, 20], [5, 5, 1]]
      for (const [x, y, alpha] of [...kept, ...litter]) put(x!, y!, alpha!)
      expect(dropStrays(pic, density), `@${density}x`).toBe(litter.length)
      expect(dropStrays(pic, density), `@${density}x, again`).toBe(0)
      for (const [x, y, alpha] of kept) expect(pic.data[(y! * pic.width + x!) * 4 + 3], `@${density}x kept (${x}, ${y})`).toBe(alpha)
      for (const [x, y] of litter) expect([...pic.data.subarray((y! * pic.width + x!) * 4, (y! * pic.width + x!) * 4 + 4)], `@${density}x cleared (${x}, ${y})`).toEqual([0, 0, 0, 0])
      let strays = 0
      eachStray(pic, density, () => strays++)
      expect(strays, `@${density}x strays left`).toBe(0)
    }
  })

  it('splits a hairstyle by its hand-drawn front mask instead of the rule, when there is one', async () => {
    // item_hair_<code>_frontmask.png, frame-sized (@1x) and black and white: here it says the panels are the front.
    const { dir: from } = await hairCase()
    const dir = copyCase(from, 'v4-front-mask')
    const overridesDir = caseDir('v4-front-mask-overrides')
    const drawing = blankPicture(FRAME.w, FRAME.h)
    for (let y = 0; y < FRAME.h; y++) {
      for (let x = 0; x < FRAME.w; x++) {
        const white = inPanels(-4)(x + 0.5, y + 0.5)
        drawing.data.set(white ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * FRAME.w + x) * 4)
      }
    }
    await writePicture(drawing, join(overridesDir, 'item_hair_f_bob01_frontmask.png'))
    const lines: string[] = []
    await ingest({ file: join(from, 'hair.png'), target: { kind: 'hair', code: 'f_bob01' }, dir, targets: targetsOf(dir), overridesDir, log: (line: string) => lines.push(line) })
    expect(lines.some((line) => line.startsWith('front mask:')), lines.join('\n')).toBe(true)
    const l60 = await readPicture(join(dir, 'item_hair_f_bob01_L60@2x.png'))
    const l20 = await readPicture(join(dir, 'item_hair_f_bob01_L20@2x.png'))
    expect(solidShare(l60, at2x(inPanels(2)))).toBeGreaterThan(0.98)
    expect(solidShare(l20, at2x(inCap(2)))).toBeGreaterThan(0.98)
    expect(inked(l60, at2x(inCap(0)))).toBe(0)
    await allPass(dir, ['item_hair_f_bob01_L60', 'item_hair_f_bob01_L20'])
  }, 300_000)

  it('keeps a fringe hanging from the cap over the eyes in L60, where C13 fails it (A2a ruling)', async () => {
    // The hair face rule drops islands inside the face, not everything near the eyes: a fringe hangs from hair outside
    // the face, so it is hair, and it is C13's to judge.
    const dir = copyCase(await bodyDir(), 'v4-fringe')
    const fringe = `<rect x="${FRINGE_AT.x}" y="${FRINGE_AT.y}" width="${FRINGE_AT.w}" height="${FRINGE_AT.h}" rx="6" fill="${PURPLE}"/>`
    const file = await draw(dir, 'fringe.png', body() + hair(PURPLE) + fringe)
    await ingest({ file, target: { kind: 'hair', code: 'f_bob01' }, dir, targets: targetsOf(dir), overridesDir: noOverrides() })
    const l60 = await readPicture(join(dir, 'item_hair_f_bob01_L60@2x.png'))
    const inFringe = (x: number, y: number): boolean => x >= FRINGE_AT.x + 2 && x <= FRINGE_AT.x + FRINGE_AT.w - 2 && y >= FRINGE_AT.y + 2 && y <= FRINGE_AT.y + FRINGE_AT.h - 2
    expect(solidShare(l60, at2x(inFringe))).toBeGreaterThan(0.98)
    expect(solidShare(l60, at2x((x, y) => EYE_XS.some((ex) => Math.hypot(x - ex, y - EYE_Y) <= IRIS_RADIUS))), 'the fringe over the irises').toBeGreaterThan(0.98)
    const c13 = (await checkOne(dir, 'item_hair_f_bob01_L60', manifestIn(dir) as unknown as Manifest)).get('C13')!
    expect(c13.ok).toBe(false)
    expect(c13.detail).toMatch(/the front lies over the eyes on \d+\.\d % of the eye mask/)
  }, 300_000)

  it('3. cuts an outfit on body f: cutOn f, and C6 measures it against body_f_L30 — and fails it without cutOn', async () => {
    const dir = copyCase(await bodyDir(), 'v4-outfit')
    const file = await draw(dir, 'outfit.png', body() + OUTFIT)
    await ingest({ file, target: { kind: 'item', slot: 'outfit', code: 'casual01' }, dir, targets: targetsOf(dir), baseId: 'f', overridesDir: noOverrides() })
    const name = 'item_outfit_casual01_L40'
    const manifest = manifestIn(dir)
    expect(manifest.files[name]).toMatchObject({ layer: LAYERS.outfit, real: true, cutOn: 'f' })
    const rows = await allPass(dir, [name])
    expect(rows.get(name)!.get('C6')!.detail).toContain('body_f_L30')

    // The same layer without `cutOn` was measured on the old bases before D1; now it is cut on no body, and fails.
    const legacy = structuredClone(manifest)
    delete legacy.files[name]!.cutOn
    const old = (await checkOne(dir, name, legacy as unknown as Manifest)).get('C6')!
    expect(old.ok).toBe(false)
    expect(old.detail).toMatch(/^cut on no body \(cutOn missing\)/)
    // …and with no real body to wear it, there is nothing to measure yet.
    const standIn = structuredClone(manifest)
    const { real: _real, ...drawn } = standIn.files.body_f_L30!
    standIn.files.body_f_L30 = { ...drawn, placeholder: true }
    const none = (await checkOne(dir, name, standIn as unknown as Manifest)).get('C6')!
    expect(none).toEqual({ ok: true, detail: 'n/a — no real body wears it yet' })
  }, 300_000)

  it('4. keeps an item’s tint seed, and with it its tint masks, when the item is ingested again without one', async () => {
    const dir = copyCase(await bodyDir(), 'v4-tint-seed')
    const file = await draw(dir, 'beanie.png', body() + HAT)
    const name = 'item_head_beanie01_L80'
    const target = { kind: 'item', slot: 'head', code: 'beanie01' }
    await ingest({ file, target, dir, targets: targetsOf(dir), baseId: 'f', tintSeed: { x: 191, y: 98 }, overridesDir: noOverrides() })
    const first = manifestIn(dir)
    expect(first.files[name]).toMatchObject({ tintSeed: { x: 191, y: 98 }, cutOn: 'f' })
    expect(first.files[name]!.masks?.tint).toBeDefined()

    const lines: string[] = []
    await ingest({ file, target, dir, targets: targetsOf(dir), baseId: 'f', overridesDir: noOverrides(), log: (line: string) => lines.push(line) })
    const again = manifestIn(dir)
    expect(again.files[name]!.tintSeed).toEqual({ x: 191, y: 98 })
    expect(again.files[name]!.masks?.tint).toBeDefined()
    expect(again.files[name]!.masks!.tint!.empty).toBeUndefined()
    expect(again.icons?.item_head_beanie01_icon?.tintMask).toBe(true)
    for (const density of DENSITIES) {
      expect(existsSync(join(dir, `${name}_tintmask@${density}x.png`))).toBe(true)
      expect(existsSync(join(dir, `item_head_beanie01_icon_tintmask@${density}x.png`))).toBe(true)
    }
    expect(lines.some((line) => line.includes('keeps its tint seed (191, 98)')), lines.join('\n')).toBe(true)
  }, 300_000)

  it('5. cuts a bot on body f’s transform by default (D1), with cutOn f on all seven layers — and on body m’s when told', async () => {
    const dir = copyCase(await bodyDir(), 'v4-bot')
    // Body f's stored transform moved 4 units right of the canvas's: the bot lands there only if it reads bodies.f.
    const moved = manifestIn(dir)
    moved.bodies!.f!.transform.offsetX += 4
    writeFileSync(join(dir, MANIFEST_NAME), serialiseManifest(moved))
    const lines: string[] = []
    const file = await draw(dir, 'bot.png', body() + ANTENNA)
    await ingest({ file, target: { kind: 'bot', bot: 3, expr: 'neutral' }, dir, targets: targetsOf(dir), overridesDir: noOverrides(), log: (line: string) => lines.push(line) })
    expect(lines.some((line) => line.startsWith('transform taken from f:')), lines.join('\n')).toBe(true)
    const manifest = manifestIn(dir)
    const names = ['bot_3_L30', ...EXPRESSIONS.map((expr: string) => `bot_3_face_${expr}_L50`)]
    for (const name of names) expect(manifest.files[name], name).toMatchObject({ real: true, cutOn: 'f' })
    const bot = alphaBBox(await readPicture(join(dir, 'bot_3_L30@2x.png')))!
    const bodyBox = alphaBBox(await readPicture(join(dir, 'body_f_L30@2x.png')))!
    expect([bot.x, bot.w, bot.y + bot.h]).toEqual([bodyBox.x + 8, bodyBox.w, bodyBox.y + bodyBox.h])
    // `--transform-from m` reads body m's, which this directory has not ingested; an old base's id names no body at all.
    const cut = (transformFrom: string): Promise<unknown> => ingest({ file, target: { kind: 'bot', bot: 3, expr: 'neutral' }, dir, targets: targetsOf(dir), transformFrom })
    await expect(cut('m')).rejects.toThrow(/no transform stored for body m — a bot is cut on it; ingest it with --as body:m first/)
    await expect(cut('f01')).rejects.toThrow(/f01 is not a body/)
  }, 300_000)

  it('6. refuses --variant m on body f, naming the body', async () => {
    const dir = caseDir('v4-variant')
    const file = join(dir, 'outfit.png')
    await writePicture(await renderSvg(sourceSvg(CLOTHES), SRC.w, SRC.h), file)
    const cut = (baseId: string, variant: string): Promise<unknown> =>
      ingest({ file, target: { kind: 'item', slot: 'outfit', code: 'dealer01' }, dir, targets: targetsOf(dir), baseId, variant })
    await expect(cut('f', 'm')).rejects.toThrow(/--variant m does not match body f/)
    await expect(cut('m', 'f')).rejects.toThrow(/--variant f does not match body m/)
    expect(() => run(['ingest', file, '--as', 'item:outfit:dealer01', '--base', 'f', '--variant', 'm', '--out', dir])).toThrow(/--variant m does not match body f/)
    expect(existsSync(join(dir, MANIFEST_NAME))).toBe(false)
    // The gender is the body's wear (pre-flight #28); an old base has none since D1.
    expect([wearOf('f'), wearOf('m'), wearOf('f01'), wearOf('m02'), wearOf('x')]).toEqual(['f', 'm', null, null, null])
  }, 60_000)

  it('7. a body drawn 6 units low fails C12 on the canvas’s transform and passes anchored by its head, which is recorded', async () => {
    const dir = copyCase(await canvasDir(), 'v4-anchor')
    const file = await draw(dir, 'low.png', body({ dy: 6 }))
    const canvas = await canvasTransform()

    // --dry-run: D02 §8's measurements, then C12's on a cut into a temporary copy — a failing one exits 1 — and
    // nothing written here.
    const before = readFileSync(join(dir, MANIFEST_NAME))
    const dry = runFailing(['ingest', file, '--as', 'body:f', '--dry-run', '--out', dir])
    expect(dry).toContain('head height')
    expect(dry).toMatch(/C12 +FAIL — .*eye line \d+\.\d from F01's \(want within 4\.16\)/)
    expect(run(['ingest', file, '--as', 'body:f', '--anchor', 'head', '--dry-run', '--out', dir])).toMatch(/C12 +PASS — eyes \(/)
    expect(readFileSync(join(dir, MANIFEST_NAME)).equals(before)).toBe(true)
    // (The canvas's own body_f_L30 is the grey figure; the dry runs left it as it was.)
    const canvasBody = readFileSync(join(dir, 'body_f_L30@2x.png'))
    expect(readFileSync(join(await canvasDir(), 'body_f_L30@2x.png')).equals(canvasBody)).toBe(true)

    run(['ingest', file, '--as', 'body:f', '--out', dir])
    const plain = (await checkOne(dir, 'body_f_L30', manifestIn(dir) as unknown as Manifest)).get('C12')!
    expect(plain.ok).toBe(false)
    expect(plain.detail).toMatch(/eye line \d+\.\d from F01's \(want within 4\.16\)/)
    // The chin moved by about as much (6) and is inside its own 12: only the eyes fail.
    expect(plain.detail).not.toMatch(/chin \d+\.\d from F01's/)

    const out = run(['ingest', file, '--as', 'body:f', '--anchor', 'head', '--out', dir])
    expect(out).toContain('anchored on the head')
    const manifest = manifestIn(dir)
    expect(manifest.bodies?.f?.anchor).toBe('head')
    // The head moved up 6 units at the same size: the transform is the canvas's, 6 units higher.
    expect(manifest.bodies!.f!.transform.scale / canvas.scale).toBeCloseTo(1, 2)
    // (Scaling about the eyes moves the offset by up to (1 − scale ratio) × 190 — a unit or so — on top of the 6.)
    expect(Math.abs(manifest.bodies!.f!.transform.offsetY - (canvas.offsetY - 6))).toBeLessThan(1.5)
    expect(Math.abs(manifest.bodies!.f!.transform.offsetX - canvas.offsetX)).toBeLessThan(1.5)
    await allPass(dir, ['body_f_L30', 'body_f_face_neutral_L50'])
  }, 300_000)

  it('8. --recolour-to brings a hairstyle drawn in another colour within ΔE 5 of that colour, as colours measures it', async () => {
    const dir = copyCase(await bodyDir(), 'v4-recolour')
    const file = await draw(dir, 'brown.png', body() + hair(DARK_BROWN))
    const names = ['item_hair_f_bob01_L60', 'item_hair_f_bob01_L20']
    const items = [{ id: hairItemId('f_bob01'), naturalColour: PURPLE }]
    // The hair lines only: the front also prints the skin it redrew (2026-10-05), which has no natural colour.
    const deltas = async (): Promise<number[]> => (await describeColours({ dir, manifest: manifestIn(dir), names, items }) as string[])
      .filter((line) => line.split(' ')[1] === 'hair')
      .map((line) => Number(/ΔE (\d+\.\d)$/.exec(line)?.[1] ?? Number.NaN))

    // As drawn, the hair is far from the hairstyle's natural colour…
    run(['ingest', file, '--as', 'hair:f_bob01', '--out', dir])
    for (const delta of await deltas()) expect(delta).toBeGreaterThan(15)
    expect(manifestIn(dir).files[names[0]!]!.recolouredTo).toBeUndefined()

    // …and recoloured to it, it is that colour.
    run(['ingest', file, '--as', 'hair:f_bob01', '--recolour-to', PURPLE, '--out', dir])
    const after = await deltas()
    expect(after).toHaveLength(2)
    for (const delta of after) expect(delta).toBeLessThanOrEqual(5)
    const manifest = manifestIn(dir)
    expect(manifest.files[names[0]!]!.recolouredTo).toBe(PURPLE)
    expect(manifest.files[names[1]!]!.recolouredTo).toBeUndefined()
    await allPass(dir, names)

    // Ingested again without the flag, it stays recoloured, as an item keeps its tint seed (A2a review).
    expect(run(['ingest', file, '--as', 'hair:f_bob01', '--out', dir])).toContain(`item_hair_f_bob01_L60 keeps its recolour to ${PURPLE}`)
    for (const delta of await deltas()) expect(delta).toBeLessThanOrEqual(5)
    expect(manifestIn(dir).files[names[0]!]!.recolouredTo).toBe(PURPLE)
  }, 300_000)

  it('anchors a body by the eyes its cut finds, not by a hand-drawn eye mask drawn for another placement (A2a review)', async () => {
    // A hand-drawn neutral eye mask, drawn where the eyes sit once the body is anchored (on HEAD_REFERENCE). The cut
    // on the canvas's transform has them 6 units lower; measured through the drawing, the anchor would see nothing to move.
    const dir = copyCase(await canvasDir(), 'v4-anchor-hand-eyes')
    const overridesDir = caseDir('v4-anchor-hand-eyes-masks')
    const drawing = blankPicture(FRAME.w, FRAME.h)
    for (let y = 0; y < FRAME.h; y++) {
      for (let x = 0; x < FRAME.w; x++) {
        if (EYE_XS.some((ex) => Math.hypot(x + 0.5 - ex, y + 0.5 - EYE_Y) <= IRIS_RADIUS)) drawing.data.set([255, 255, 255, 255], (y * FRAME.w + x) * 4)
      }
    }
    await writePicture(drawing, join(overridesDir, 'body_f_face_neutral_L50_eyemask.png'))
    const lines: string[] = []
    const file = await draw(dir, 'low.png', body({ dy: 6 }))
    await ingest({ file, target: { kind: 'body', gender: 'f' }, dir, targets: targetsOf(dir), anchor: 'head', overridesDir, log: (line: string) => lines.push(line) })
    const measured = /on body f's transform the eyes are at \([\d.]+, ([\d.]+)\)/.exec(lines.join('\n'))
    expect(Number(measured?.[1]), lines.join('\n')).toBeGreaterThan(HEAD_REFERENCE.eyeMidY + 5)
    const canvas = await canvasTransform()
    const manifest = manifestIn(dir)
    expect(Math.abs(manifest.bodies!.f!.transform.offsetY - (canvas.offsetY - 6))).toBeLessThan(1.5)
    // The written face does take the drawing, which now sits on the anchored eyes: C12 passes through it.
    expect(manifest.files.body_f_face_neutral_L50!.masks!.eyes!.override).toBe(true)
    const c12 = (await checkOne(dir, 'body_f_L30', manifest as unknown as Manifest)).get('C12')!
    expect(c12.ok, c12.detail).toBe(true)
  }, 300_000)

  it('cuts one of a body’s faces on the body’s transform (face:<g>:<expr>), and refuses it before the body', async () => {
    const dir = copyCase(await bodyDir(), 'v4-face')
    const file = await draw(dir, 'happy.png', body({ extra: SMILE }))
    run(['ingest', file, '--as', 'face:f:happy', '--out', dir])
    const name = 'body_f_face_happy_L50'
    const manifest = manifestIn(dir)
    expect(manifest.files[name]).toMatchObject({ layer: LAYERS.face, real: true })
    expect(Object.keys(manifest.files[name]!.masks ?? {}).sort()).toEqual(['eyes', 'skin', 'skinLine'])
    for (const density of DENSITIES) {
      const outside = inkOutsideHead(await readPicture(join(dir, `${name}@${density}x.png`)), density)
      expect(outside.length, `@${density}x has ink outside the head region`).toBe(0)
    }
    // C11 compares a real face with the real neutral one, and it holds.
    const rows = await allPass(dir, [name])
    expect(rows.get(name)!.get('C11')!.detail).not.toContain('n/a')

    const bare = caseDir('v4-face-bare')
    await expect(ingest({ file, target: { kind: 'bodyFace', gender: 'f', expr: 'happy' }, dir: bare, targets: targetsOf(bare) })).rejects.toThrow(/no transform stored for body f — a face is cut on it; ingest it with --as body:f first/)
  }, 300_000)

  it('measures a hat drawn over a hairstyle against the body wearing that hairstyle (--hair)', async () => {
    const { dir: from } = await hairCase()
    const file = await draw(from, 'hat-on-hair.png', body() + hair(PURPLE) + HAT)
    const target = { kind: 'item', slot: 'head', code: 'tophat01' }
    const name = 'item_head_tophat01_L80'

    const dir = copyCase(from, 'v4-hat-hair')
    const lines: string[] = []
    await ingest({ file, target, dir, targets: targetsOf(dir), baseId: 'f', hair: 'f_bob01', overridesDir: noOverrides(), log: (line: string) => lines.push(line) })
    expect(lines.some((line) => line.includes('item_hair_f_bob01')), lines.join('\n')).toBe(true)
    expect(manifestIn(dir).files[name]).toMatchObject({ real: true, cutOn: 'f' })
    const hat = await readPicture(join(dir, `${name}@2x.png`))
    expect(solidOf(hat, RED)).toBeGreaterThan(5000)
    expect(solidOf(hat, PURPLE), 'the hat layer holds the hair round it').toBe(0)

    // The control: on the bald body, the cap round the hat is new to the picture, so it joins the hat.
    const bald = copyCase(from, 'v4-hat-bald')
    await ingest({ file, target, dir: bald, targets: targetsOf(bald), baseId: 'f', overridesDir: noOverrides() })
    expect(solidOf(await readPicture(join(bald, `${name}@2x.png`)), PURPLE)).toBeGreaterThan(1000)

    // A hairstyle is worn on its own gender's body.
    await expect(ingest({ file, target, dir, targets: targetsOf(dir), baseId: 'f', hair: 'm_tousled01' })).rejects.toThrow(/m_tousled01/)
  }, 300_000)

  it('placeholder keeps the bodies key and every real body, face and hair layer exactly as ingested', async () => {
    const { dir: from } = await hairCase()
    const dir = copyCase(from, 'v4-placeholder')
    const names = ['body_f_L30', 'body_f_face_neutral_L50', 'item_hair_f_bob01_L60', 'item_hair_f_bob01_L20']
    const before = manifestIn(dir)
    const bytes = Object.fromEntries(names.map((name) => [name, bytesOf(dir, name)]))
    await buildPlaceholders({ dir, targets: targetsOf(dir) })
    const after = manifestIn(dir)
    expect(after.bodies).toEqual(before.bodies)
    for (const name of names) {
      expect(after.files[name], name).toEqual(before.files[name])
      bytesOf(dir, name).forEach((now, index) => expect(now.equals(bytes[name]![index]!), `${name} was redrawn`).toBe(true))
    }
  }, 600_000)

  // ── The body-skin rule (Plan 19 style gate): a hair or outfit picture's redraw of the body's own skin stays out ──

  /** The real v4 bodies' cream. A platinum blonde is ΔE 10 from it: a darker cream, which the difference reads as its shadow. */
  const REAL_CREAM = '#fce5cf'
  const PLATINUM = '#e0c9b3'
  const PLATINUM_SHADE = '#c8ae96'
  /** The body's outline round its ears, arms and hands. */
  const LINE = '#7a3e2a'
  /** Skin in the hair's shadow, between the fringe strands (L* 78, C* 28, h 55°), and a redrawn ear's (L* 74, C* 30, h 54°). */
  const SHADOW_SKIN = '#eab496'
  const EAR_SHADE = '#e2a88a'
  const BLUE = '#2244cc'
  const GOLD = '#d4af37'
  const GOLD_DEEP = '#b8860b'
  /** The ears (on the head's edge), the arms' outline and the hands; `grow` widens the arms outwards and drops the hands. */
  const EARS_AT = [{ cx: 119, cy: 196 }, { cx: 265, cy: 196 }]
  const ears = (): string => EARS_AT.map((e) => `<ellipse cx="${e.cx}" cy="${e.cy}" rx="7" ry="12" fill="${REAL_CREAM}" stroke="${LINE}" stroke-width="1.5"/>`).join('')
  /** The shading inside each ear's lower half, as a hair picture redraws it — the ear's own cream round it. */
  const EAR_SHADES = EARS_AT.map((e) => ({ cx: e.cx, cy: e.cy + 2, rx: 3.5, ry: 6 }))
  const limbs = (grow = 0): string =>
    `<rect x="${128 - grow}" y="254" width="${18 + grow}" height="78" rx="9" fill="${REAL_CREAM}" stroke="${LINE}" stroke-width="1.5"/>` +
    `<rect x="238" y="254" width="${18 + grow}" height="78" rx="9" fill="${REAL_CREAM}" stroke="${LINE}" stroke-width="1.5"/>` +
    [137, 247].map((cx) => `<ellipse cx="${cx}" cy="${334 + grow}" rx="9" ry="7" fill="${REAL_CREAM}" stroke="${LINE}" stroke-width="1.5"/>`).join('')
  /** A bald body in the real cream, with ears and outlined arms and hands. */
  const skinBody = ({ grow = 0, extra = '' } = {}): string => body({ cream: REAL_CREAM, extra: ears() + limbs(grow) + extra })
  const skinBodyDir = memo(async () => {
    const dir = copyCase(await canvasDir(), 'v4-skin-body')
    await ingest({ file: await draw(dir, 'body.png', skinBody()), target: { kind: 'body', gender: 'f' }, dir, targets: targetsOf(dir), overridesDir: noOverrides() })
    return dir
  })
  /** Four fringe strands hanging from the cap over the forehead to y 150 (`tips`), and the cap and the side locks over the ears' tops. */
  const STRANDS = [150, 171, 192, 213].map((x) => ({ x, y: 120, w: 17, h: 30 }))
  const strands = (fill: string, line: string): string => STRANDS.map((s) =>
    `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="${fill}"/><rect x="${s.x + 7.5}" y="${s.y}" width="2" height="${s.h - 4}" fill="${line}"/>`).join('')
  const sideLocks = (fill: string): string => EARS_AT.map((e) => `<rect x="${e.cx - 13}" y="120" width="20" height="${e.cy - 6 - 120}" fill="${fill}"/>`).join('')
  /** Solid pixels of `pic` within 30 of `hex` inside `region`. */
  function solidOfIn(pic: Picture, hex: string, region: Uint8Array): number {
    const n = Number.parseInt(hex.slice(1), 16)
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    let count = 0
    for (let p = 0; p < region.length; p++) {
      const at = p * 4
      if (!region[p] || pic.data[at + 3]! < 128) continue
      if (Math.hypot(pic.data[at]! - r, pic.data[at + 1]! - g, pic.data[at + 2]! - b) <= 30) count++
    }
    return count
  }
  const everywhere = new Uint8Array(FRAME.w * 2 * FRAME.h * 2).fill(1)
  const keptOut = (lines: string[]): number => Number(/^body skin kept out: (\d+) px$/m.exec(lines.join('\n'))?.[1] ?? Number.NaN)

  it('keeps the skin a hair picture redraws between the fringe strands and on the ears out of both hair layers', async () => {
    // The picture shades the forehead between the strand tips and the ears below the side locks in the hair's shadow:
    // not the body's colour there, so the difference takes them, and they touch the hair, so the face rule keeps them.
    const dir = copyCase(await skinBodyDir(), 'v4-skin-hair')
    const band = `<rect x="148" y="128" width="84" height="18" fill="${SHADOW_SKIN}"/>`
    const earShades = EAR_SHADES.map((e) => `<ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}" fill="${EAR_SHADE}"/>`).join('')
    const file = await draw(dir, 'hair.png', skinBody({ extra: earShades }) + band + hair(PURPLE) + strands(PURPLE, BROW_REDRAWN) + sideLocks(PURPLE))
    const lines: string[] = []
    await ingest({ file, target: { kind: 'hair', code: 'f_bob01' }, dir, targets: targetsOf(dir), overridesDir: noOverrides(), log: (line: string) => lines.push(line) })
    const l60 = await readPicture(join(dir, 'item_hair_f_bob01_L60@2x.png'))
    const l20 = await readPicture(join(dir, 'item_hair_f_bob01_L20@2x.png'))
    for (const [name, layer] of [['L60', l60], ['L20', l20]] as const) {
      expect(solidOfIn(layer, SHADOW_SKIN, everywhere), `${name} holds the skin between the strands`).toBe(0)
      expect(solidOfIn(layer, EAR_SHADE, everywhere), `${name} holds the redrawn ears`).toBe(0)
    }
    // The hair itself is all there: the cap, every strand to its tip, the side locks.
    expect(solidShare(l60, at2x(inCap(2)))).toBeGreaterThan(0.98)
    const inStrands = (x: number, y: number): boolean => STRANDS.some((s) => x >= s.x + 1.5 && x <= s.x + s.w - 1.5 && y >= CAP.bottom && y <= s.y + s.h - 1.5)
    expect(solidShare(l60, at2x(inStrands)), 'the strands').toBeGreaterThan(0.98)
    expect(keptOut(lines), lines.join('\n')).toBeGreaterThan(0)
  }, 300_000)

  it('takes nothing of a platinum-blonde fringe over the cream forehead: blonde does not redden as skin does', async () => {
    // Measured on the difference itself, with the rule and without: a flat platinum over the cream is a darker cream,
    // which the difference reads as the skin's shadow and drops whether or not the rule runs. The fringe below is held
    // because its strands are outlined — the outline encloses each one, and the clean-up fills it — and it reaches past
    // the head's sides, so it is not an island of the face. What the rule may not do is take any more of it.
    const dir = await skinBodyDir()
    const outline = '#8c6e58'
    const CELLS = Array.from({ length: 14 }, (_, i) => 120 + i * 10)
    const fringe = `<rect x="118" y="120" width="148" height="26" fill="${PLATINUM}" stroke="${outline}" stroke-width="1.5"/>` +
      CELLS.map((x) => `<rect x="${x + 4}" y="122" width="2" height="22" fill="${PLATINUM_SHADE}"/><rect x="${x + 9.25}" y="120" width="1.5" height="26" fill="${outline}"/>`).join('')
    const file = await draw(caseDir('v4-skin-blonde'), 'blonde.png', skinBody() + hair(PLATINUM) + fringe)
    const bodyPic = await readPicture(join(dir, 'body_f_L30@2x.png'))
    const keyed = removeChroma(await readPicture(file), { tolerance: 40 })
    const { picture } = registerToBase(await applyTransform(keyed, manifestIn(dir).bodies!.f!.transform, 2), bodyPic, { slot: 'hair', density: 2 })
    const alphaOf = async (name: string): Promise<Uint8Array> => {
      const pic = await readPicture(join(dir, `${name}@2x.png`))
      return Uint8Array.from({ length: pic.width * pic.height }, (_, p) => pic.data[p * 4 + 3]!)
    }
    const faceRule = {
      skin: await alphaOf('body_f_face_neutral_L50_skinmask'),
      eyes: await alphaOf('body_f_face_neutral_L50_eyemask'),
      face: await readPicture(join(dir, 'body_f_face_neutral_L50@2x.png')),
      bodySkin: await alphaOf('body_f_L30_skinmask'),
    }
    const skin = Uint8Array.from(faceRule.skin, (value, p) => Math.max(value, faceRule.bodySkin[p]!))
    const without = diffAgainstBase(picture, bodyPic, { slot: 'hair', density: 2, faceRule })
    const withRule = diffAgainstBase(picture, bodyPic, { slot: 'hair', density: 2, faceRule, ownSkin: { skin, ...BODY_SKIN_RULE.hair } })
    const inFringe = at2x((x, y) => CELLS.some((left) => x >= left + 1.5 && x <= left + 7.5) && y >= CAP.bottom && y <= 144.5)
    let held = 0
    let inside = 0
    let lost = 0
    for (let p = 0; p < inFringe.length; p++) {
      if (inFringe[p]) inside++
      if (inFringe[p] && without.mask[p]! >= 128) held++
      if (without.mask[p]! >= 128 && withRule.mask[p]! < 128) lost++
    }
    expect(held / inside, 'the fringe, cut without the rule').toBeGreaterThan(0.98)
    expect(lost, 'blonde the rule took').toBe(0)
    expect(withRule.skinDropped).toBe(0)
  }, 300_000)

  /** A t-shirt over the tank top, short sleeves over the arms' tops; the arms bare below y 278. */
  const TSHIRT = `<rect x="147" y="238" width="90" height="116" rx="6" fill="${BLUE}"/>`
  const sleeves = (fill: string, bottom: number): string => [124, 234].map((x) => `<rect x="${x}" y="248" width="26" height="${bottom - 248}" rx="3" fill="${fill}"/>`).join('')
  /** The bare arms and hands below the sleeves, on both sides. */
  const bareArms = (top: number): Uint8Array => at2x((x, y) => y >= top && y <= 345 && (x < 147 || x > 237))

  it('keeps an outfit picture’s cream rim and finger edges out of its layer, and still covers the underwear (C6)', async () => {
    // The picture draws the arms 1.5 units wider on the outside and the hands 1.5 lower: the body's own outline then
    // lies under the picture's cream, which the union with the body takes — a cream rim round the arms and the hands.
    // And it shades the arms in the sleeves' shadow just below them.
    const dir = copyCase(await skinBodyDir(), 'v4-skin-outfit')
    const shadow = [127.5, 239].map((x) => `<rect x="${x}" y="278" width="17.5" height="4" fill="${SHADOW_SKIN}"/>`).join('')
    const file = await draw(dir, 'outfit.png', skinBody({ grow: 1.5, extra: shadow }) + TSHIRT + sleeves(BLUE, 278))
    const lines: string[] = []
    await ingest({ file, target: { kind: 'item', slot: 'outfit', code: 'casual01' }, dir, targets: targetsOf(dir), baseId: 'f', overridesDir: noOverrides(), log: (line: string) => lines.push(line) })
    const name = 'item_outfit_casual01_L40'
    const l40 = await readPicture(join(dir, `${name}@2x.png`))
    expect(solidOfIn(l40, REAL_CREAM, bareArms(278)), 'the cream rim round the arms and hands').toBe(0)
    expect(solidOfIn(l40, SHADOW_SKIN, bareArms(278)), 'the skin in the sleeves’ shadow').toBe(0)
    expect(solidOfIn(l40, BLUE, everywhere), 'the t-shirt and the sleeves').toBeGreaterThan(10_000)
    expect(keptOut(lines), lines.join('\n')).toBeGreaterThan(0)
    const rows = await allPass(dir, [name])
    expect(rows.get(name)!.get('C6')!.detail).toContain('body_f_L30')
  }, 300_000)

  it('keeps a gold sleeve over the arm whole, cuff and all: gold is not the body’s skin', async () => {
    const dir = copyCase(await skinBodyDir(), 'v4-skin-gold')
    const cuffs = [124, 234].map((x) => `<rect x="${x}" y="294" width="26" height="6" fill="${GOLD_DEEP}"/>`).join('')
    const file = await draw(dir, 'gold.png', skinBody() + TSHIRT + sleeves(GOLD, 300) + cuffs)
    await ingest({ file, target: { kind: 'item', slot: 'outfit', code: 'champion01' }, dir, targets: targetsOf(dir), baseId: 'f', overridesDir: noOverrides() })
    const l40 = await readPicture(join(dir, 'item_outfit_champion01_L40@2x.png'))
    const inSleeves = (x: number, y: number): boolean => [124, 234].some((left) => x >= left + 1.5 && x <= left + 26 - 1.5 && y >= 249.5 && y <= 298.5)
    expect(solidShare(l40, at2x(inSleeves)), 'the gold sleeves').toBeGreaterThan(0.98)
    const inCuffs = (x: number, y: number): boolean => [124, 234].some((left) => x >= left + 1.5 && x <= left + 26 - 1.5 && y >= 295 && y <= 299)
    expect(solidShare(l40, at2x(inCuffs)), 'the deep-gold cuffs on the bare forearm').toBeGreaterThan(0.98)
  }, 300_000)
})
