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
import { runChecks } from '../scripts/avatar-pipeline/checks.mjs'
import { diffAgainstBase, ingest, measure } from '../scripts/avatar-pipeline/extract.mjs'
import { AXIS_X, BASELINE_Y, BODY, CROP, DENSITIES, FACE_LIMIT_Y, FRAME, LAYERS, anchorBase, applyTransform, placeholderSvg } from '../scripts/avatar-pipeline/frame.mjs'
import { MANIFEST_NAME, buildPlaceholders, stageOneFiles } from '../scripts/avatar-pipeline/manifest.mjs'
import { alphaBBox, blankPicture, cropPicture, readPicture, removeChroma, renderSvg, writeDensities, writePicture } from '../scripts/avatar-pipeline/png.mjs'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = resolve(PACKAGE_ROOT, 'scripts/avatar-pipeline.mjs')
const OUT_DIR = resolve(PACKAGE_ROOT, 'public/avatar')
const WEB_MANIFEST = join(OUT_DIR, MANIFEST_NAME)
const SERVER_MANIFEST = resolve(PACKAGE_ROOT, '../normal-server/data/avatar-manifest.json')
const SHEET = resolve(PACKAGE_ROOT, '../../docs/avatar-2d-sheet.png')

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
  /** A real layer with nothing on it, on purpose: an AI base's hair layers (its hair is baked into L30/L50). */
  empty?: boolean
  hidesHairFront?: boolean
  hidesHairBack?: boolean
}

interface Manifest {
  version: number
  frame: { w: number; h: number }
  crop: { x: number; y: number; size: number }
  files: Record<string, ManifestEntry>
  bases?: Record<string, { transform: { scale: number; offsetX: number; offsetY: number } }>
}

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
    // The mask is deliberately 3 px larger than the difference on every side — the 2 px dilation that
    // recovers the item's own antialiased rim, plus the 1 px feather — so that is what it is measured
    // against. Anything beyond this is the difference finding something that is not the hat.
    const GROWTH = 3
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

  it('makes an outfit cover the body it is worn over', () => {
    // D01 §10.7: the outfit must leave no underwear showing, so the mask absorbs the base below y = 176
    // whatever the difference says.
    const { mask } = diffAgainstBase(framedOutfit, framedBase, { slot: 'outfit', density: 1 })
    let uncovered = 0
    for (let y = 176; y < FRAME.h; y++) {
      for (let x = 0; x < FRAME.w; x++) {
        if (framedBase.data[(y * FRAME.w + x) * 4 + 3]! > 8 && mask[y * FRAME.w + x] === 0) uncovered++
      }
    }
    expect(uncovered, 'pixels of the base the outfit layer does not cover').toBe(0)
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
    const { mask } = diffAgainstBase(framed, framedBase, { slot: 'outfit', density: 1, minRegion: 400 })
    const x = Math.round(915 * transform.scale + transform.offsetX)
    const y = Math.round(315 * transform.scale + transform.offsetY)
    expect(mask[y * FRAME.w + x], 'the speck survived the minimum-region filter').toBe(0)
  }, 60_000)
})

// ────────────────────────────────────────────────────────────────── the gate ──

describe('the ten acceptance checks', () => {
  it('passes a file the pipeline itself produced', async () => {
    const dir = caseDir('good')
    const entry = await writePlaceholder(dir, 'item_head_tophat01_L80')
    const manifest = manifestFor(dir, { item_head_tophat01_L80: entry })
    const results = await checkOne(dir, 'item_head_tophat01_L80', manifest)
    expect([...results.keys()].sort()).toEqual(['C1', 'C10', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9'])
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

  it('C6 fails an outfit that leaves the base showing', async () => {
    const dir = caseDir('c6')
    const bases: Record<string, ManifestEntry> = {}
    for (const name of ['base_f01_L30', 'base_m01_L30']) bases[name] = await writePlaceholder(dir, name)
    // A tiny scrap where a full outfit should be.
    const build = (density: number): Picture => {
      const pic = blankPicture(FRAME.w * density, FRAME.h * density)
      for (let y = 240 * density; y < 260 * density; y++) {
        for (let x = 180 * density; x < 205 * density; x++) pic.data.set([30, 60, 200, 255], (y * pic.width + x) * 4)
      }
      return pic
    }
    for (const density of DENSITIES) await writePicture(build(density), join(dir, `item_outfit_casual01_L40@${density}x.png`))
    const bytes2x = statSync(join(dir, 'item_outfit_casual01_L40@2x.png')).size
    const manifest = manifestFor(dir, { ...bases, item_outfit_casual01_L40: { layer: 40, w: FRAME.w, h: FRAME.h, bytes2x, placeholder: true } })
    expect((await checkOne(dir, 'item_outfit_casual01_L40', manifest)).get('C6')!.ok).toBe(false)
  }, 60_000)

  it('C6 passes the same outfit when the check is skipped', async () => {
    const dir = caseDir('c6-skip')
    const bases: Record<string, ManifestEntry> = {}
    for (const name of ['base_f01_L30', 'base_m01_L30']) bases[name] = await writePlaceholder(dir, name)
    const outfit = await writePlaceholder(dir, 'item_outfit_casual01_L40')
    const manifest = manifestFor(dir, { ...bases, item_outfit_casual01_L40: outfit })
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

describe('the stage-1 name list', () => {
  const files = stageOneFiles()

  it('is the list the design names in §4.4, and nothing else', () => {
    const byKind = (kind: string): string[] => files.filter((file: { kind: string }) => file.kind === kind).map((file: { name: string }) => file.name)
    expect(byKind('base').sort()).toEqual([
      'base_f01_L20', 'base_f01_L30', 'base_f01_L60', 'base_m01_L20', 'base_m01_L30', 'base_m01_L60',
    ])
    expect(byKind('baseFace')).toHaveLength(12)
    expect(byKind('item').filter((name) => name.startsWith('item_head_'))).toHaveLength(8)
    expect(byKind('item').filter((name) => name.startsWith('item_face_'))).toHaveLength(4)
    expect(byKind('item').filter((name) => name.startsWith('item_outfit_'))).toHaveLength(6)
    expect(byKind('item').filter((name) => name.startsWith('item_aura_'))).toHaveLength(8)
    expect(byKind('item').filter((name) => name.startsWith('item_frame_'))).toHaveLength(6)
    expect(byKind('bot')).toHaveLength(8)
    expect(byKind('botFace')).toHaveLength(48)
    expect(files).toHaveLength(106)
    expect(files.map((file: { name: string }) => file.name)).toContain('item_head_tophat01_L80')
    expect(files.map((file: { name: string }) => file.name)).toContain('item_frame_founder_L90')
    expect(files.map((file: { name: string }) => file.name)).toContain('bot_7_face_sleep_L50')
  })

  it('gives every entry the layer its name ends in', () => {
    const known = new Set(Object.values(LAYERS))
    for (const file of files as { name: string; layer: number }[]) {
      expect(known.has(file.layer), `${file.name} claims layer ${file.layer}`).toBe(true)
      expect(file.name.endsWith(`_L${file.layer}`), file.name).toBe(true)
    }
  })
})

describe('the committed placeholder set', () => {
  const manifest = JSON.parse(readFileSync(WEB_MANIFEST, 'utf8')) as Manifest

  it('holds every stage-1 name at both densities, and nothing else', () => {
    const expected = stageOneFiles().flatMap((file: { name: string }) => DENSITIES.map((density: number) => `${file.name}@${density}x.png`))
    const onDisk = readdirSync(OUT_DIR).filter((name) => name.endsWith('.png'))
    expect(onDisk.sort()).toEqual(expected.sort())
  })

  it('describes each of them in the manifest', () => {
    expect(manifest.version).toBe(1)
    expect(manifest.frame).toEqual(FRAME)
    expect(manifest.crop).toEqual(CROP)
    const names = stageOneFiles().map((file: { name: string }) => file.name)
    expect(Object.keys(manifest.files).sort()).toEqual([...names].sort())
    for (const [name, entry] of Object.entries(manifest.files)) {
      expect(entry.w, name).toBe(FRAME.w)
      expect(entry.h, name).toBe(FRAME.h)
      expect(entry.bytes2x, name).toBe(statSync(join(OUT_DIR, `${name}@2x.png`)).size)
      // Exactly one of the two flags (docs/avatar-2d.md §6): a stand-in, or art `ingest` wrote.
      expect(entry.placeholder === true !== (entry.real === true), `${name} must be placeholder or real, not both or neither`).toBe(true)
      if (entry.empty) expect(entry.real, `${name} is marked empty, which only ingest writes`).toBe(true)
    }
  })

  it('ships the server the very same bytes', () => {
    // The catalogue validates against this copy; two manifests that drift are two truths about which
    // files exist, and the one the server trusts is the one nothing else reads.
    expect(existsSync(SERVER_MANIFEST)).toBe(true)
    expect(readFileSync(SERVER_MANIFEST).equals(readFileSync(WEB_MANIFEST))).toBe(true)
  })

  it('passes its own acceptance checks', () => {
    // C6 measures outfits against each base's real body. While a base is real art and the outfits are
    // still stand-ins drawn for the stand-in body, they cannot cover it, and that is expected rather
    // than a fault — so C6 is skipped exactly for that mix, and runs again once real outfits land.
    const entries = Object.entries(manifest.files)
    const realBase = entries.some(([name, entry]) => /^base_[a-z0-9]+_L30$/.test(name) && entry.real)
    const standInOutfit = entries.some(([name, entry]) => name.startsWith('item_outfit_') && entry.placeholder)
    const skip = realBase && standInOutfit ? ['--skip', 'C6'] : []
    const stdout = execFileSync(process.execPath, [SCRIPT, 'check', ...skip], { cwd: PACKAGE_ROOT, encoding: 'utf8' })
    expect(stdout).toMatch(/C1/)
    expect(stdout).not.toMatch(/FAIL/)
  }, 300_000)

  it('leaves a review sheet for the style gate', () => {
    expect(existsSync(SHEET), 'docs/avatar-2d-sheet.png has not been generated').toBe(true)
    return sharp(SHEET)
      .metadata()
      .then((meta) => {
        expect(meta.width!).toBeGreaterThan(1000)
        expect(meta.height!).toBeGreaterThan(1000)
      })
  })
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
    const stdout = run(['ingest', base, '--as', 'base:f01', '--dry-run', '--out', dir])
    for (const line of ['head height', 'total height', 'eye line', 'centre offset', 'verdict']) {
      expect(stdout, `the report does not mention ${line}`).toContain(line)
    }
    expect(stdout).toContain('PASS')
    // A dry run is a report, not a step: nothing on disk, not even a manifest.
    expect(existsSync(join(dir, MANIFEST_NAME))).toBe(false)
  }, 60_000)

  it('anchors a base, then cuts a hat out against it, and both pass the checks', async () => {
    const dir = caseDir('ingest-run')
    const { base, item } = await sources(dir)
    run(['ingest', base, '--as', 'base:f01', '--out', dir])
    run(['ingest', item, '--as', 'item:head:tophat01', '--out', dir])
    const manifest = JSON.parse(readFileSync(join(dir, MANIFEST_NAME), 'utf8')) as Manifest
    // The base's transform is stored so that everything generated beside it lands on the same pixels.
    expect(manifest.bases!.f01!.transform.scale).toBeCloseTo(BODY.h / (SRC_FIGURE.bottom - SRC_FIGURE.top), 3)
    for (const name of ['base_f01_L30', 'item_head_tophat01_L80']) {
      expect(manifest.files[name]!.real, `${name} should be marked as real art`).toBe(true)
      expect(manifest.files[name]!.placeholder).toBeUndefined()
    }
    const stdout = run(['check', 'base_f01_L30', 'item_head_tophat01_L80', '--dir', dir])
    expect(stdout, stdout).not.toMatch(/FAIL/)
  }, 120_000)
})

// ──────────────────────────────────────────────────────────── flat AI bases ──

/** Every pixel with any alpha, as `x,y`, that lies outside the head region at this density. */
function inkOutsideHead(pic: Picture, density: number): string[] {
  const left = CROP.x * density
  const right = (CROP.x + CROP.size) * density
  const top = CROP.y * density
  const bottom = Math.min(CROP.y + CROP.size, FACE_LIMIT_Y) * density
  const found: string[] = []
  for (let y = 0; y < pic.height; y++) {
    for (let x = 0; x < pic.width; x++) {
      if (x >= left && x < right && y >= top && y < bottom) continue
      if (pic.data[(y * pic.width + x) * 4 + 3]! > 0) found.push(`${x},${y}`)
    }
  }
  return found
}

const fullyTransparent = (pic: Picture): boolean => {
  for (let i = 3; i < pic.data.length; i += 4) if (pic.data[i] !== 0) return false
  return true
}

describe('a flat AI base', () => {
  // An AI picture is one image with hair, face and body baked together, not three layers.
  const ingestBase = async (dir: string): Promise<Manifest> => {
    const file = join(dir, 'base.png')
    await writePicture(await renderSvg(sourceSvg(), SRC.w, SRC.h), file)
    await ingest({ file, target: { kind: 'base', base: 'f01' }, dir, targets: [join(dir, MANIFEST_NAME)] })
    return JSON.parse(readFileSync(join(dir, MANIFEST_NAME), 'utf8')) as Manifest
  }

  it('writes the body, the head region as the neutral face, and empty hair layers', async () => {
    const dir = caseDir('flat-base')
    const manifest = await ingestBase(dir)
    expect(manifest.files.base_f01_L30).toMatchObject({ layer: 30, real: true })
    expect(manifest.files.base_f01_L30!.empty).toBeUndefined()

    const face = manifest.files.base_f01_face_neutral_L50
    expect(face).toMatchObject({ layer: 50, real: true })
    expect(face!.empty).toBeUndefined()
    for (const density of DENSITIES) {
      const pic = await readPicture(join(dir, `base_f01_face_neutral_L50@${density}x.png`))
      expect(alphaBBox(pic), `@${density}x face has no head in it`).not.toBeNull()
      const outside = inkOutsideHead(pic, density)
      expect(outside.length, `@${density}x face has ink outside the head region, e.g. ${outside.slice(0, 3).join(' ')}`).toBe(0)
    }
    // Inside the head region the face is the body's own pixels: layer 50 repeats the head on purpose.
    const body2x = await readPicture(join(dir, 'base_f01_L30@2x.png'))
    const face2x = await readPicture(join(dir, 'base_f01_face_neutral_L50@2x.png'))
    const at = (144 * 2 * body2x.width + 192 * 2) * 4
    expect([...face2x.data.subarray(at, at + 4)]).toEqual([...body2x.data.subarray(at, at + 4)])

    for (const name of ['base_f01_L20', 'base_f01_L60']) {
      expect(manifest.files[name], name).toMatchObject({ real: true, empty: true })
      expect(manifest.files[name]!.placeholder).toBeUndefined()
      for (const density of DENSITIES) {
        const pic = await readPicture(join(dir, `${name}@${density}x.png`))
        expect([pic.width, pic.height]).toEqual([FRAME.w * density, FRAME.h * density])
        expect(fullyTransparent(pic), `${name}@${density}x is not empty`).toBe(true)
      }
    }

    const rows = await runChecks({ dir, manifest, names: ['base_f01_L20', 'base_f01_L30', 'base_f01_face_neutral_L50', 'base_f01_L60'] })
    for (const row of rows) {
      for (const result of row.results) expect(result.ok, `${row.name} ${result.id}: ${result.detail}`).toBe(true)
    }
  }, 120_000)

  it('masks an expression to the head region', async () => {
    const dir = caseDir('flat-expr')
    await ingestBase(dir)
    const file = join(dir, 'happy.png')
    // The same figure with a red smile and a red smudge on the chest: only the smile is head.
    await writePicture(await renderSvg(sourceSvg(`<rect x="500" y="560" width="152" height="30" fill="#cc2222"/>${SMUDGE}`), SRC.w, SRC.h), file)
    await ingest({ file, target: { kind: 'expr', base: 'f01', expr: 'happy' }, dir, targets: [join(dir, MANIFEST_NAME)] })
    const manifest = JSON.parse(readFileSync(join(dir, MANIFEST_NAME), 'utf8')) as Manifest
    expect(manifest.files.base_f01_face_happy_L50).toMatchObject({ layer: 50, real: true })
    for (const density of DENSITIES) {
      const pic = await readPicture(join(dir, `base_f01_face_happy_L50@${density}x.png`))
      expect(alphaBBox(pic)).not.toBeNull()
      const outside = inkOutsideHead(pic, density)
      expect(outside.length, `@${density}x has ink outside the head region, e.g. ${outside.slice(0, 3).join(' ')}`).toBe(0)
    }
  }, 120_000)

  it('check passes a layer marked empty and fails an unmarked empty one', async () => {
    const dir = caseDir('empty-check')
    for (const name of ['base_f01_L20', 'base_f01_L60']) {
      for (const density of DENSITIES) await writePicture(blankPicture(FRAME.w * density, FRAME.h * density), join(dir, `${name}@${density}x.png`))
    }
    const bytes = (name: string): number => statSync(join(dir, `${name}@2x.png`)).size
    const manifest = manifestFor(dir, {
      base_f01_L20: { layer: 20, w: FRAME.w, h: FRAME.h, bytes2x: bytes('base_f01_L20'), real: true, empty: true },
      base_f01_L60: { layer: 60, w: FRAME.w, h: FRAME.h, bytes2x: bytes('base_f01_L60'), real: true },
    })
    const marked = await checkOne(dir, 'base_f01_L20', manifest)
    for (const [id, result] of marked) expect(result.ok, `${id}: ${result.detail}`).toBe(true)
    const unmarked = await checkOne(dir, 'base_f01_L60', manifest)
    expect([...unmarked.values()].some((result) => !result.ok), 'an unmarked empty layer passed every check').toBe(true)
  }, 30_000)

  it('check fails a layer marked empty that is not', async () => {
    const dir = caseDir('empty-not')
    const entry = await writePlaceholder(dir, 'base_f01_L20')
    const manifest = manifestFor(dir, { base_f01_L20: { layer: entry.layer, w: entry.w, h: entry.h, bytes2x: entry.bytes2x, real: true, empty: true } })
    const results = await checkOne(dir, 'base_f01_L20', manifest)
    expect([...results.values()].some((result) => !result.ok), 'a drawn layer marked empty passed every check').toBe(true)
  }, 30_000)

  it('placeholder leaves the empty real layers alone', async () => {
    const dir = caseDir('empty-placeholder')
    const blank = { layer: 0, w: FRAME.w, h: FRAME.h, bytes2x: 0, real: true, empty: true }
    const files: Record<string, ManifestEntry> = {}
    for (const [name, layer] of [['base_f01_L20', 20], ['base_f01_L60', 60]] as const) {
      for (const density of DENSITIES) await writePicture(blankPicture(FRAME.w * density, FRAME.h * density), join(dir, `${name}@${density}x.png`))
      files[name] = { ...blank, layer, bytes2x: statSync(join(dir, `${name}@2x.png`)).size }
    }
    manifestFor(dir, files)
    await buildPlaceholders({ dir, targets: [join(dir, MANIFEST_NAME)] })
    const after = JSON.parse(readFileSync(join(dir, MANIFEST_NAME), 'utf8')) as Manifest
    expect(Object.keys(after.files)).toHaveLength(stageOneFiles().length)
    for (const name of Object.keys(files)) {
      expect(after.files[name], name).toEqual(files[name])
      for (const density of DENSITIES) {
        expect(fullyTransparent(await readPicture(join(dir, `${name}@${density}x.png`))), `${name}@${density}x was redrawn`).toBe(true)
      }
    }
  }, 600_000)
})

describe('the placeholder command', () => {
  it('writes the whole set and says the same thing twice', async () => {
    const dir = caseDir('placeholder-run')
    const run = (): string => execFileSync(process.execPath, [SCRIPT, 'placeholder', '--out', dir], { cwd: PACKAGE_ROOT, encoding: 'utf8' })
    run()
    const first = readFileSync(join(dir, MANIFEST_NAME))
    const expected = stageOneFiles().flatMap((file: { name: string }) => DENSITIES.map((density: number) => `${file.name}@${density}x.png`))
    expect(readdirSync(dir).filter((name) => name.endsWith('.png')).sort()).toEqual(expected.sort())
    // Idempotent: the artefact is committed, so a second run that changed a byte would be a dirty tree.
    run()
    expect(readFileSync(join(dir, MANIFEST_NAME)).equals(first)).toBe(true)
    await Promise.resolve()
  }, 600_000)
})
