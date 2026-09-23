/**
 * `verify` (spec §5, amended 2026-09-24): score a generated picture against the rules a picture has to
 * meet before it is worth ingesting, and record the verdict on the asset's last attempt.
 *
 * The rules run in this order and the first one that fails is the verdict's `reason`; `measure` holds every
 * number computed up to that point.
 *
 *   size         a figure: portrait, height ≥ 1152, aspect within 5 % of 2:3 or of 3:4 (the image model
 *                returns 1086 × 1448 for an edit of a 1024 × 1536 reference, and that picture is usable);
 *                an aura or a frame: within 5 % of square, side ≥ 1024
 *   background   alpha 0 in all four corners, and no painted checkerboard: at most 5 % of the outer 8 px
 *                band may be opaque near-white or near-grey
 *   redrawn      against the reference picture (`compareBoxes`): the picture's scale — the reference's
 *                height over the picture's, head top to feet — is outside 0.90–1.10, or its box's width
 *                ratio after that scaling is outside 0.96–1.04 (a figure drawn wider at the same height —
 *                the ChatGPT edit that the pipeline could only register at IoU 0.645)
 *   drift        …or an edge of the box is more than 12 px off the reference's — an outfit's bottom edge may
 *                sit up to 24 px lower, for shoes (which edges, and where the picture stands when they are
 *                measured: `compareBoxes`)
 *   heads        2.0–2.5 heads (`measure` after `removeChroma`, as the pipeline's `--dry-run` does)
 *   hair_colour  the mean colour of the top-of-head band (x 330–700, y 250–330 of the reference) moved more
 *                than 12 (RGB distance) — expressions and face/outfit items
 *   scope        ≥ 1 % of the figure changed outside the area the asset may change (`scopeFraction`: RGB
 *                distance > 40 from everything within 2 px, or opaque where the other has nothing near) —
 *                expressions, head and face items; not an outfit (`allowedArea`)
 *   check:<Cn>   the pipeline's own acceptance criteria, on a copy: public/avatar/ is copied to a temporary
 *                directory, the picture is ingested there with the asset's `ingest` spec (`--out`), and
 *                `runChecks` runs over the layers that wrote (`pipeline` if the ingest itself throws)
 *   hollow       an aura or a frame: mean alpha inside 40 % of the half-width ≥ 0.05
 *
 * A picture on another canvas than its reference's (the model's 1086 × 1448) is scaled and anchored onto the
 * reference's canvas before drift, hair colour and scope are measured, and before the pipeline cuts it. A
 * head item's hat covers the top of the head, so `heads` and `hair_colour` are not asked of it. A bot has no
 * pipeline target yet and skips that rule (`pipeline: skipped (bot)`).
 *
 * Nothing here writes into public/avatar/.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { runChecks } from '../avatar-pipeline/checks.mjs'
import { ingest, measure as measureFigure } from '../avatar-pipeline/extract.mjs'
import { CROP, FACE_LIMIT_Y, HEAD_LIMIT_Y, LAYERS, anchorBase } from '../avatar-pipeline/frame.mjs'
import { MANIFEST_NAME, PUBLIC_DIR, SLOT_LAYER, baseFile, faceFile, itemFile, readManifest } from '../avatar-pipeline/manifest.mjs'
import { ALPHA_SOLID, alphaBBox, colourDistance, placeOnCanvas, readPicture, removeChroma, resizePicture, writePicture } from '../avatar-pipeline/png.mjs'
import { MAX_ATTEMPTS, SRC_DIR, parseFlags, parseSpec, referencePath, requireAsset } from './registry.mjs'

export const PORTRAIT = { aspects: [2 / 3, 3 / 4], tolerance: 0.05, minHeight: 1152 }
export const SQUARE = { tolerance: 0.05, minSide: 1024 }
export const EDGE_BAND = 8
export const CHECKER_LIMIT = 0.05
export const SCALE_RANGE = [0.9, 1.1]
export const WIDTH_RANGE = [0.96, 1.04]
export const DRIFT_LIMIT = 12
/** How far (source px) an outfit's bottom edge may sit *below* the reference's: shoes add height (ruling 2026-09-24). */
export const OUTFIT_SHOES = 24
export const HEADS_RANGE = [2, 2.5]
export const HAIR_BAND = { x0: 330, x1: 700, y0: 250, y1: 330 }
export const HAIR_LIMIT = 12
export const SCOPE_DIFF = 40
/** How far (source px) `scope` looks for the same colour — the pipeline's 5 × 5 difference window. */
export const SCOPE_RADIUS = 2
export const SCOPE_LIMIT = 0.01
export const HOLLOW = { radius: 0.4, limit: 0.05 }

const SQUARE_KINDS = new Set(['aura', 'frame'])
const round2 = (n) => Math.round(n * 1000) / 1000

// ─────────────────────────────────────────────────────────────── the rules ──

export function sizeOk(pic, kind) {
  const { width, height } = pic
  if (SQUARE_KINDS.has(kind)) return Math.abs(width / height - 1) <= SQUARE.tolerance && Math.min(width, height) >= SQUARE.minSide
  const ratio = width / height
  return height >= PORTRAIT.minHeight && PORTRAIT.aspects.some((aspect) => Math.abs(ratio / aspect - 1) <= PORTRAIT.tolerance)
}

/** Near-white or near-grey — what a painted checkerboard is made of. */
const isPaper = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) <= 24 && Math.min(r, g, b) >= 150

/** The four corners' alpha, and the share of the outer band that is opaque paper. */
export function background(pic) {
  const { width, height, data } = pic
  const alphaAt = (x, y) => data[(y * width + x) * 4 + 3]
  const corners = [alphaAt(0, 0), alphaAt(width - 1, 0), alphaAt(0, height - 1), alphaAt(width - 1, height - 1)]
  let band = 0
  let paper = 0
  for (let y = 0; y < height; y++) {
    const edgeRow = y < EDGE_BAND || y >= height - EDGE_BAND
    for (let x = 0; x < width; x++) {
      if (!edgeRow && x >= EDGE_BAND && x < width - EDGE_BAND) {
        x = width - EDGE_BAND - 1
        continue
      }
      band++
      const at = (y * width + x) * 4
      if (data[at + 3] > ALPHA_SOLID && isPaper(data[at], data[at + 1], data[at + 2])) paper++
    }
  }
  const checker = paper / band
  return { corners, checker, ok: corners.every((alpha) => alpha === 0) && checker <= CHECKER_LIMIT }
}

/**
 * A figure's box for `compareBoxes`: its ink box, plus `top` — where `measure()` puts the head top, below
 * a strand of hair (an ahoge) that a generator redraws a little differently every time.
 */
export function figureBox(pic) {
  const box = alphaBBox(pic)
  if (!box) return null
  return { ...box, top: measureFigure(removeChroma(pic)).top }
}

/**
 * Compare a picture's box with its reference's (spec §5, as ruled on 2026-09-24).
 *
 * The **scale** is the reference's height over the picture's, both measured from the head top (`box.top`,
 * below the strand) to the feet — or from the box top, for a base, a bot, or when the box heights agree
 * better than the head heights do (see below) — except for a head item, whose hat moves the top (a visor
 * hides the strand and the box top drops 77 px), and which is not height-normalised at all (scale 1). The
 * **width ratio** is the picture's width, times that scale, over the reference's.
 *
 * The **edges** are compared where the picture will be cut. On the reference's own canvas (`anchored:
 * false`) that is where it is: a figure that moved in the frame has drifted, and the pipeline's stored
 * transform will cut it there. On another canvas (`anchored: true`, the model's 1086 × 1448) where it is
 * says nothing, so it is first scaled and anchored — by the head top and centre line, or a head item by its
 * feet and centre line — and what the edges then measure is the shape. Which edges count: a base, all four
 * of its raw box; an expression, a face or an outfit item, all four with the top taken as the scale took it;
 * a head item, left, right and bottom only.
 *
 * Returns `{ scale, widthRatio, edges, drift, placement, reason }`. `placement` (`{ scale, left, top }`)
 * puts a picture pixel at `(x * scale + left, y * scale + top)` on the reference's canvas; `reason` is
 * `redrawn`, `drift` or null.
 *
 * @param {{ x: number, y: number, w: number, h: number, top?: number }} box
 * @param {{ x: number, y: number, w: number, h: number, top?: number }} ref
 * @param {{ kind?: string, slot?: string | null, anchored?: boolean }} [options]
 */
export function compareBoxes(box, ref, { kind = 'expression', slot = null, anchored = false } = {}) {
  const headItem = kind === 'item' && slot === 'head'
  const bottom = (b) => b.y + b.h
  // Which top: a new base's (or bot's) hair is its own, so its box top; anything else the head top below the
  // strand — unless `measure()` itself disagreed with itself about the strand (it takes M01's for head on some
  // pictures and not others: head top 125 against 152 with box tops 79 against 80), which shows as head
  // heights, feet up, that agree worse than the box heights do. Then the box top is the steadier of the two.
  const agreement = (top) => Math.abs((bottom(box) - top(box)) / (bottom(ref) - top(ref)) - 1)
  const headTop = (b) => b.top ?? b.y
  const boxTop = (b) => b.y
  const rawTop = kind === 'base' || kind === 'bot' || box.top === undefined || ref.top === undefined || agreement(boxTop) < agreement(headTop)
  const topOf = rawTop ? boxTop : headTop
  const scale = headItem ? 1 : (bottom(ref) - topOf(ref)) / (bottom(box) - topOf(box))
  const widthRatio = (box.w * scale) / ref.w

  const placement = { scale: 1, left: 0, top: 0 }
  if (anchored) {
    placement.scale = scale
    placement.left = ref.x + ref.w / 2 - (box.x + box.w / 2) * scale
    placement.top = headItem ? bottom(ref) - bottom(box) * scale : topOf(ref) - topOf(box) * scale
  }
  const at = (value, offset) => value * placement.scale + offset
  const edges = {
    left: Math.round(at(box.x, placement.left) - ref.x),
    top: headItem ? null : Math.round(at(topOf(box), placement.top) - topOf(ref)),
    right: Math.round(at(box.x + box.w, placement.left) - (ref.x + ref.w)),
    bottom: Math.round(at(bottom(box), placement.top) - bottom(ref)),
  }
  const drift = Math.max(...Object.values(edges).filter((edge) => edge !== null).map(Math.abs))
  // An outfit's shoes may put its feet lower than the base's bare ones (casual01's sneakers: 19 px).
  const lowest = kind === 'item' && slot === 'outfit' ? OUTFIT_SHOES : DRIFT_LIMIT
  const off = (name, edge) => edge !== null && (name === 'bottom' ? edge < -DRIFT_LIMIT || edge > lowest : Math.abs(edge) > DRIFT_LIMIT)
  let reason = null
  if (scale < SCALE_RANGE[0] || scale > SCALE_RANGE[1]) reason = 'redrawn'
  else if (widthRatio < WIDTH_RANGE[0] || widthRatio > WIDTH_RANGE[1]) reason = 'redrawn'
  else if (Object.entries(edges).some(([name, edge]) => off(name, edge))) reason = 'drift'
  return { scale, widthRatio, edges, drift, placement, reason }
}

/** The picture on the reference's canvas, as `compareBoxes`' placement puts it (itself, when that is the identity). */
export async function alignPicture(pic, ref, { scale, left, top }) {
  if (pic.width === ref.width && pic.height === ref.height && scale === 1 && left === 0 && top === 0) return pic
  const scaled = Math.abs(scale - 1) < 1e-9 ? pic : await resizePicture(pic, Math.max(1, Math.round(pic.width * scale)), Math.max(1, Math.round(pic.height * scale)))
  return placeOnCanvas(scaled, ref.width, ref.height, Math.round(left), Math.round(top))
}

/** Compare a picture with its reference: both boxes, the rules, and the placement onto the reference's canvas. */
export function comparePictures(pic, ref, kind, slot) {
  const anchored = pic.width !== ref.width || pic.height !== ref.height
  if ((kind === 'item' && slot === 'head') || kind === 'base') {
    // A hat may be far wider than the hair (the conical hat: 1.15× the figure) — that is the item, not a
    // redraw. So a head item is held to its *body*: the ink below the reference's mid-height, where no hat
    // reaches, compared left, right and bottom. A new base is the same case from the other side: its head
    // is *meant* to differ (F02's straight hair is 78 px narrower than F01's bob and has no ahoge), and what
    // it must share with the reference is the body.
    // A base's hair may fall to the waist (F02), so a base is held to its legs, lower still.
    const refBox = figureBox(ref)
    const fromY = refBox.y + Math.floor(refBox.h * (kind === 'base' ? BASE_LEGS_FROM : HEAD_ITEM_BODY_FROM))
    return compareBoxes(bodyBox(pic, fromY), bodyBox(ref, fromY), { kind, slot: kind === 'base' ? 'head' : slot, anchored })
  }
  return compareBoxes(figureBox(pic), figureBox(ref), { kind, slot, anchored })
}

/** The share of the reference's height above which a head item's ink is ignored by `comparePictures`. */
export const HEAD_ITEM_BODY_FROM = 0.5
/** …and a new base's: the legs alone (F02's hair reaches her hips, about 0.67 of the figure). */
export const BASE_LEGS_FROM = 0.8

/**
 * The *solid* ink box of the rows at or below `fromY` — a figure's body, when `fromY` is under its head.
 * Solid, not merely inked: the generator sometimes leaves a faint glow round the figure (the party hat
 * picture: 39 px of it left of the arm) which the pipeline's key drops and which is not a redraw.
 */
export function bodyBox(pic, fromY) {
  const { width, height, data } = pic
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = Math.max(0, fromY); y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= ALPHA_SOLID) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** The mean colour of the solid pixels in the top-of-head band, or null when there are none. */
export function hairColour(pic) {
  let n = 0
  const sum = [0, 0, 0]
  for (let y = HAIR_BAND.y0; y < Math.min(HAIR_BAND.y1, pic.height); y++) {
    for (let x = HAIR_BAND.x0; x < Math.min(HAIR_BAND.x1, pic.width); x++) {
      const at = (y * pic.width + x) * 4
      if (pic.data[at + 3] <= ALPHA_SOLID) continue
      n++
      for (let c = 0; c < 3; c++) sum[c] += pic.data[at + c]
    }
  }
  return n === 0 ? null : sum.map((value) => value / n)
}

/**
 * Where an asset may change the picture, as a test on a reference pixel `(x, y)`, or null when the asset
 * has no such limit — and then `scope` is not measured. The frame's rows (`FACE_LIMIT_Y`, `HEAD_LIMIT_Y`,
 * `CROP`) are mapped back onto the reference with the transform the pipeline would anchor it by.
 *
 * An outfit has none (ruling 2026-09-24): the outfit cut discards everything above the chin line, so a head
 * the generator redrew never reaches the layer — and five of the eight accepted real outfits redrew theirs
 * (tuxedo01 4.4 %, tet_red01 15.9 % of the head changed).
 */
export function allowedArea(kind, slot, transform) {
  const fx = (x) => x * transform.scale + transform.offsetX
  const fy = (y) => y * transform.scale + transform.offsetY
  const inCrop = (x, y) => fx(x) >= CROP.x && fx(x) < CROP.x + CROP.size && fy(y) >= CROP.y && fy(y) < CROP.y + CROP.size
  if (kind === 'expression') return (_x, y) => fy(y) < FACE_LIMIT_Y
  if (kind === 'item' && (slot === 'head' || slot === 'face')) return (x, y) => fy(y) < HEAD_LIMIT_Y || inCrop(x, y)
  return null
}

/**
 * The share of the figure (solid in either picture) outside `allowed` that the picture changed.
 *
 * "Changed" is asked the way the pipeline's own `diffAgainstBase` asks it, because a generated edit
 * redraws every pixel a little and moves outlines by a pixel or two: a solid pixel of the picture is
 * changed only when no solid reference pixel within `radius` is within `SCOPE_DIFF` of its colour, and a
 * solid reference pixel the picture left transparent only when the picture has no solid pixel within
 * `radius` of it. Measured over the real pictures on 2026-09-24, a same-pixel test (radius 0) put every
 * accepted expression at 2.4–9.7 % — all noise; radius 2 (the pipeline's 5 × 5 window) puts them at
 * 0.1–0.7 %.
 */
export function scopeFraction(pic, ref, allowed, radius = SCOPE_RADIUS) {
  const { width, height } = ref
  const solid = (p, x, y) => x >= 0 && y >= 0 && x < width && y < height && p.data[(y * width + x) * 4 + 3] > ALPHA_SOLID
  const limit = SCOPE_DIFF * SCOPE_DIFF
  const near = (x, y) => {
    const at = (y * width + x) * 4
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (!solid(ref, x + dx, y + dy)) continue
        const bt = ((y + dy) * width + x + dx) * 4
        const dr = pic.data[at] - ref.data[bt]
        const dg = pic.data[at + 1] - ref.data[bt + 1]
        const db = pic.data[at + 2] - ref.data[bt + 2]
        if (dr * dr + dg * dg + db * db <= limit) return true
      }
    }
    return false
  }
  const covered = (x, y) => {
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) if (solid(pic, x + dx, y + dy)) return true
    return false
  }
  let counted = 0
  let changed = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (allowed(x, y)) continue
      const a = solid(pic, x, y)
      const b = solid(ref, x, y)
      if (!a && !b) continue
      counted++
      if (a ? !near(x, y) : !covered(x, y)) changed++
    }
  }
  return counted === 0 ? 0 : changed / counted
}

/** The mean alpha (0–1) inside `HOLLOW.radius` of the half-width, around the centre. */
export function hollowness(pic) {
  const cx = pic.width / 2
  const cy = pic.height / 2
  const r = (HOLLOW.radius * Math.min(pic.width, pic.height)) / 2
  let n = 0
  let sum = 0
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r) continue
      n++
      sum += pic.data[(y * pic.width + x) * 4 + 3]
    }
  }
  return sum / n / 255
}

// ─────────────────────────────────────────────────────────── the pipeline ──

/** The layers an ingest of `target` writes, which are the ones `runChecks` is run over. */
export function layerNames(target, owner, variant = null) {
  if (target.kind === 'base') return [baseFile(owner, LAYERS.body), faceFile(owner, 'neutral'), baseFile(owner, LAYERS.hairBack), baseFile(owner, LAYERS.hairFront)]
  if (target.kind === 'expr') return [faceFile(owner, target.expr)]
  return [itemFile(target.slot, target.code, SLOT_LAYER[target.slot], variant)]
}

/** Which base an ingest belongs to: the base itself, an expression's base, or an item's `--base` (f01). */
export const ownerOf = (target, spec) => (target.kind === 'base' || target.kind === 'expr' ? target.base : spec?.base ?? 'f01')

/**
 * The file the pipeline should be given for a picture. An expression and an item are cut with their base's
 * stored transform, which was measured on a canvas the reference's size; a picture on another canvas (the
 * model's 1086 × 1448) is moved onto the reference's canvas first, aligned as `verify` aligned it, and
 * written to `tmp`. Anything else — and any picture already on the reference's canvas — goes in as it is.
 */
export async function pipelineInput({ file, kind, slot = null, referenceFile, tmp }) {
  if (!referenceFile || (kind !== 'expression' && kind !== 'item')) return { file, aligned: false }
  const pic = await readPicture(file)
  const ref = await readPicture(referenceFile)
  if (pic.width === ref.width && pic.height === ref.height) return { file, aligned: false }
  const { placement } = comparePictures(pic, ref, kind, slot)
  mkdirSync(tmp, { recursive: true })
  const out = join(tmp, 'aligned.png')
  await writePicture(await alignPicture(pic, ref, placement), out)
  return { file: out, aligned: true }
}

/**
 * Ingest `file` into a copy of `publicDir` and run the ten checks over what that wrote. A base the copy
 * has no transform for yet (an expression of a base not ingested) is ingested there first from the
 * reference picture, which for an expression is that base's own picture.
 */
async function pipelineChecks({ file, kind, slot, referenceFile, spec, publicDir, keepTmp, log }) {
  const tmp = mkdtempSync(join(tmpdir(), 'avatar-verify-'))
  const dir = join(tmp, 'avatar')
  try {
    cpSync(publicDir, dir, { recursive: true })
    const targets = [join(dir, MANIFEST_NAME)]
    const target = parseSpec(spec.as)
    const owner = ownerOf(target, spec)
    const quiet = () => {}
    if (target.kind !== 'base' && !readManifest(targets[0]).bases?.[owner]) {
      if (!referenceFile) throw new Error(`no base ${owner} in ${publicDir} and no reference to ingest it from`)
      await ingest({ file: referenceFile, target: { kind: 'base', base: owner }, dir, targets, log: quiet })
    }
    const input = await pipelineInput({ file, kind, slot, referenceFile, tmp: join(tmp, 'input') })
    const flags = parseFlags(spec.flags)
    // A base drawn from another base's picture takes that base's transform (see `transformSource` in ingest.mjs).
    const fromBase = target.kind === 'base' && referenceFile ? /^([fm]\d\d)_candidate_\d+\.png$/.exec(basename(referenceFile))?.[1] ?? null : null
    await ingest({
      file: input.file, target, dir, targets, baseId: owner, variant: spec.variant ?? null,
      tolerance: flags.tolerance, white: flags.white, lockScale: flags.lockScale ?? null, transformFrom: fromBase, hides: flags.hides, diff: flags.diff, log: quiet,
    })
    const names = layerNames(target, owner, spec.variant ?? null)
    const rows = await runChecks({ dir, manifest: readManifest(targets[0]), names })
    const checks = {}
    for (const row of rows) checks[row.name] = row.results.filter((result) => !result.ok).map((result) => result.id)
    const failed = rows.flatMap((row) => row.results.filter((result) => !result.ok).map((result) => ({ name: row.name, id: result.id, detail: result.detail })))
    return { checks, failed, aligned: input.aligned }
  } finally {
    if (keepTmp) log(`kept ${tmp}`)
    else rmSync(tmp, { recursive: true, force: true })
  }
}

// ──────────────────────────────────────────────────────────────── scoring ──

/**
 * Score one picture. `kind`/`slot` are the asset's; `referenceFile` is the reference picture's path (null
 * for an aura or a frame); `ingest` is the asset's `ingest` spec. `pipeline: false` stops before the
 * pipeline rule (the tests use it). Returns `{ verdict: 'ok' | 'ng', reason, measure, notes }`.
 *
 * @param {{ file: string, kind: string, slot?: string | null, referenceFile?: string | null, ingest?: any, publicDir?: string, pipeline?: boolean, keepTmp?: boolean, log?: (line: string) => void }} options
 */
export async function scorePicture({ file, kind, slot = null, referenceFile = null, ingest: spec = null, publicDir = PUBLIC_DIR, pipeline = true, keepTmp = false, log = () => {} }) {
  /** @type {Record<string, any>} */
  const measure = {}
  /** @type {string[]} */
  const notes = []
  const done = (reason) => ({ verdict: reason === null ? 'ok' : 'ng', reason, measure, notes })

  const pic = await readPicture(file)
  Object.assign(measure, { size: `${pic.width}×${pic.height}`, width: pic.width, height: pic.height })
  if (!sizeOk(pic, kind)) return done('size')

  const bg = background(pic)
  Object.assign(measure, { corners: bg.corners, checker: round2(bg.checker) })
  if (!bg.ok) return done('background')
  if (!alphaBBox(pic)) {
    notes.push('the picture is empty')
    return done('background')
  }

  if (SQUARE_KINDS.has(kind)) {
    measure.hollow = round2(hollowness(pic))
    return done(measure.hollow < HOLLOW.limit ? null : 'hollow')
  }

  const headItem = kind === 'item' && slot === 'head'
  let ref = null
  let compared = null
  if (referenceFile) {
    ref = await readPicture(referenceFile)
    compared = comparePictures(pic, ref, kind, slot)
    Object.assign(measure, { scale: round2(compared.scale), widthRatio: round2(compared.widthRatio), drift: compared.edges })
    if (compared.placement.scale !== 1 || compared.placement.left !== 0 || compared.placement.top !== 0) {
      notes.push(`another canvas than the reference's: scaled by ${round2(compared.placement.scale)} and anchored before drift, hair colour and scope`)
    }
    // A head item is cut from the head rows alone (`HEAD_LIMIT_Y`), so a body the generator drew a little
    // wider or narrower never reaches the layer; the pipeline's own registration and checks below are what
    // decide it. The box numbers stay in `measure` and as a note. (The party hat: body 1.107× wide, arms
    // held out, mean difference 2.9 on registration, a clean layer.)
    if (compared.reason && headItem) notes.push(`body box ${compared.reason} (width ratio ${round2(compared.widthRatio)}, edges ${JSON.stringify(compared.edges)}) — advisory for a head item`)
    else if (compared.reason) return done(compared.reason)
  } else {
    notes.push('no reference: drift, hair colour and scope not measured')
  }

  if (kind === 'base' || kind === 'expression' || (kind === 'item' && !headItem)) {
    const figure = measureFigure(removeChroma(pic))
    measure.heads = round2(figure.heads)
    // An expression is its base's own picture with the eyes and mouth redrawn: its proportions are the
    // base's, and `measure()`'s chin-finding is what moves (F02's long hair, a rounder eye). Advisory there.
    if (figure.heads < HEADS_RANGE[0] || figure.heads > HEADS_RANGE[1]) {
      if (kind === 'expression') notes.push(`heads ${measure.heads} outside ${HEADS_RANGE.join('–')} — advisory for an expression (its proportions are the base's)`)
      else return done('heads')
    }
  }

  if (ref) {
    const aligned = await alignPicture(pic, ref, compared.placement)
    if (kind === 'expression' || (kind === 'item' && !headItem)) {
      const mine = hairColour(aligned)
      const theirs = hairColour(ref)
      if (theirs !== null) {
        measure.hairDelta = mine === null ? null : round2(colourDistance(...mine, ...theirs))
        if (mine === null || measure.hairDelta > HAIR_LIMIT) return done('hair_colour')
      }
    }
    const allowed = allowedArea(kind, slot, anchorBase(removeChroma(ref)))
    if (allowed) {
      measure.scope = round2(scopeFraction(aligned, ref, allowed))
      // For a head item the body is outside the cut as well as outside the allowed area: advisory (see above).
      if (measure.scope >= SCOPE_LIMIT && headItem) notes.push(`scope ${measure.scope} outside the head — advisory for a head item`)
      else if (measure.scope >= SCOPE_LIMIT) return done('scope')
    }
  }

  if (!pipeline) {
    notes.push('pipeline: not run')
    return done(null)
  }
  if (kind === 'bot') {
    notes.push('pipeline: skipped (bot)')
    return done(null)
  }
  if (!spec) {
    notes.push('pipeline: not run (no ingest spec)')
    return done(null)
  }
  try {
    const result = await pipelineChecks({ file, kind, slot, referenceFile, spec, publicDir, keepTmp, log })
    measure.checks = result.checks
    if (result.aligned) notes.push('pipeline: fed the picture aligned onto the reference canvas')
    if (result.failed.length) {
      for (const { name, id, detail } of result.failed) notes.push(`${name} ${id}: ${detail ?? 'failed'}`)
      return done(`check:${result.failed[0].id}`)
    }
  } catch (error) {
    measure.pipelineError = error instanceof Error ? error.message : String(error)
    return done('pipeline')
  }
  return done(null)
}

/** What kind of asset an `--as` spec describes, for `verify --picture` (no registry entry to ask). */
export function kindOfSpec(spec) {
  const target = parseSpec(spec)
  if (target.kind === 'base') return { kind: 'base', slot: null }
  if (target.kind === 'expr') return { kind: 'expression', slot: null }
  if (target.kind === 'bot') return { kind: 'bot', slot: null }
  if (target.slot === 'aura' || target.slot === 'frame') return { kind: target.slot, slot: target.slot }
  return { kind: 'item', slot: target.slot }
}

/**
 * Verify every `generated` asset, or the named ones: score the picture, write `measure`, `verdict`,
 * `reason` (and `notes`) onto the last attempt, and set the status — `ok`, `ng`, or `blocked` on the third
 * failure. Returns one `{ id, verdict, reason, measure, notes }` per asset.
 *
 * @param {any} registry
 * @param {string[]} [ids]
 * @param {{ srcDir?: string, publicDir?: string, keepTmp?: boolean, pipeline?: boolean, log?: (line: string) => void }} [options]
 */
export async function verifyAssets(registry, ids = [], { srcDir = SRC_DIR, publicDir = PUBLIC_DIR, keepTmp = false, pipeline = true, log = () => {} } = {}) {
  const targets = ids.length ? ids.map((id) => requireAsset(registry, id)) : registry.assets.filter((asset) => asset.status === 'generated')
  const results = []
  for (const asset of targets) {
    const last = asset.attempts[asset.attempts.length - 1]
    if (!last) throw new Error(`asset ${asset.id} has no attempt to verify — collect a picture first`)
    const file = join(srcDir, asset.file)
    if (!existsSync(file)) throw new Error(`asset ${asset.id}: no picture at ${file}`)
    const referenceFile = referencePath(asset, registry, srcDir)
    if (referenceFile && !existsSync(referenceFile)) throw new Error(`asset ${asset.id}: no reference picture at ${referenceFile}`)
    const result = await scorePicture({ file, kind: asset.kind, slot: asset.slot, referenceFile, ingest: asset.ingest, publicDir, keepTmp, pipeline, log })
    Object.assign(last, { measure: result.measure, verdict: result.verdict, reason: result.reason, by: 'verify' })
    if (result.notes.length) last.notes = result.notes
    asset.status = result.verdict === 'ok' ? 'ok' : asset.attempts.length >= MAX_ATTEMPTS ? 'blocked' : 'ng'
    results.push({ id: asset.id, ...result })
  }
  return results
}
