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
 *   hollow       an aura or a frame: mean alpha inside 40 % of the half-width ≥ 0.05 — asked right after
 *                `background`, and followed by the pipeline rule alone (2026-09-24: the pipeline has aura and
 *                frame targets now)
 *
 * A picture on another canvas than its reference's (the model's 1086 × 1448) is scaled and anchored onto the
 * reference's canvas before drift, hair colour and scope are measured, and before the pipeline cuts it. A
 * head item's hat covers the top of the head, so `heads` and `hair_colour` are not asked of it. A bot goes
 * through the pipeline like everything else since 2026-09-24 (`bot:<n>` checks its body and six faces,
 * `bot:<n>:happy` that one face), cut on the transform `transformSource` names: f01's, or a v4 redraw's body's.
 *
 * Plan 19 (v4) adds three kinds (docs/avatar-2d.md §10.4 has the table):
 *
 *   body            against F01's picture, its feet and centre line only (`comparePictures`; on another canvas
 *                   `redrawn`, since it is cut on f01's transform, as a bot is); `heads`; no hair colour or scope;
 *                   the pipeline on `body_<g>_L30` and its neutral face — C12 holds the head
 *   bodyExpression  as an expression, against its body's picture
 *   hair            against its body's picture, the feet and centre line of the legs only; no `heads` or hair
 *                   colour; `scope` outside the head region and the body grown by `HAIR_BODY_MARGIN`
 *                   (`allowedArea`); the pipeline on both layers — C13 holds the split
 *
 * An item drawn on a body is measured as today; its owner is the body (`ingest.base` `f`/`m`).
 *
 * Nothing here writes into public/avatar/.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { runChecks } from '../avatar-pipeline/checks.mjs'
import { ingest, measure as measureFigure } from '../avatar-pipeline/extract.mjs'
import { CROP, FACE_LIMIT_Y, HEAD_LIMIT_Y, LAYERS, anchorBase } from '../avatar-pipeline/frame.mjs'
import {
  EXPRESSIONS, GENDERS, MANIFEST_NAME, PUBLIC_DIR, SLOT_LAYER, baseFile, bodyFaceFile, bodyFile, botFaceFile, botFile, faceFile, hairFile, itemFile, readManifest,
} from '../avatar-pipeline/manifest.mjs'
import { ALPHA_SOLID, alphaBBox, colourDistance, dilateMask, placeOnCanvas, readPicture, removeChroma, resizePicture, writePicture } from '../avatar-pipeline/png.mjs'
import { MAX_ATTEMPTS, SRC_DIR, parseFlags, parseSpec, referenceOwner, referencePath, requireAsset, transformSource } from './registry.mjs'

export const PORTRAIT = { aspects: [2 / 3, 3 / 4], tolerance: 0.05, minHeight: 1152 }
export const SQUARE = { tolerance: 0.05, minSide: 1024 }
export const EDGE_BAND = 8
export const CHECKER_LIMIT = 0.05
export const SCALE_RANGE = [0.9, 1.1]
export const WIDTH_RANGE = [0.96, 1.04]
export const DRIFT_LIMIT = 12
/** …except a sleeping face's "z" glyph, which may widen one side of the box by this much (M02: 20). */
export const SLEEP_GLYPH = 40
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
/**
 * How far (reference px) round its body a hairstyle may not change the picture below the head region (Plan 19,
 * `allowedArea`): hair falls behind the shoulders and the back, never over the torso, the arms or the hands, nor
 * against their outline.
 */
export const HAIR_BODY_MARGIN = 4

const SQUARE_KINDS = new Set(['aura', 'frame'])
/** The kinds whose picture is a redraw of a face on its owner's picture (Plan 12's expression, Plan 19's body face). */
const FACE_KINDS = new Set(['expression', 'bodyExpression'])
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
  if (kind === 'bot' || kind === 'body') {
    // A bot is its own figure — a robot has no hair (box top 88 px lower than F01's) and ear discs (1.16× as
    // wide) — drawn on F01's canvas and cut on F01's transform. What must agree is where it stands: its feet
    // and its centre line. Another canvas is a redraw, since the transform is F01's.
    // A v4 body (Plan 19, pre-flight #23) is the same case: drawn from F01's picture and cut on f01's transform,
    // with a bald head where F01 has hair (its top lower, its head narrower) and a new pose (its arms elsewhere).
    // Its feet stay on F01's ground line and its centre line on F01's; C12, in the pipeline rule, holds the head.
    const box = figureBox(pic)
    const refBox = figureBox(ref)
    const placement = { scale: 1, left: 0, top: 0 }
    if (anchored) return { scale: 1, widthRatio: box.w / refBox.w, edges: { left: null, top: null, right: null, bottom: null }, drift: Infinity, placement, reason: 'redrawn' }
    const bottom = Math.round(box.y + box.h - (refBox.y + refBox.h))
    const centre = Math.round(box.x + box.w / 2 - (refBox.x + refBox.w / 2))
    const drift = Math.max(Math.abs(bottom), Math.abs(centre))
    return { scale: 1, widthRatio: box.w / refBox.w, edges: { left: null, top: null, right: null, bottom, centre }, drift, placement, reason: drift > DRIFT_LIMIT ? 'drift' : null }
  }
  if (kind === 'hair') return compareHair(pic, ref, anchored)
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
/** …and a new base's: the legs alone (F02's hair reaches her hips, about 0.67 of the figure). A hairstyle's too. */
export const BASE_LEGS_FROM = 0.8

/**
 * A hairstyle against its bald body (Plan 19, the `hair` row of §10.4). The hair may raise the box's top, widen
 * its sides and reach the hips, so the picture is held to its legs — the rows from `BASE_LEGS_FROM` of the body's
 * height down, which no hairstyle reaches — and of those only the bottom edge (the feet, on the body's ground line)
 * and the centre line count, up to `DRIFT_LIMIT`.
 *
 * On another canvas (the model's 1086 × 1448, which keeps the figure's size and moves it — the 2026-09-24 case)
 * where it stands says nothing, so it is placed at scale 1 by those two instead, as a head item is by its feet,
 * and the pipeline is given that placed copy (`pipelineInput`). Then only the legs' width can still tell a figure
 * redrawn at another size: outside `WIDTH_RANGE` it is `redrawn`, since the cut would miss the body.
 */
function compareHair(pic, ref, anchored) {
  const refBox = alphaBBox(ref)
  const fromY = refBox.y + Math.floor(refBox.h * BASE_LEGS_FROM)
  const refLegs = bodyBox(ref, fromY)
  // On another canvas the legs start as far above the picture's own feet as the body's start above its feet.
  const picBox = alphaBBox(pic)
  const picLegs = picBox ? bodyBox(pic, anchored ? picBox.y + picBox.h - (refBox.y + refBox.h - fromY) : fromY) : null
  const none = { left: null, top: null, right: null, bottom: null, centre: null }
  const placement = { scale: 1, left: 0, top: 0 }
  if (!refLegs || !picLegs) return { scale: 1, widthRatio: null, edges: none, drift: Infinity, placement, reason: 'redrawn' }
  const bottomOf = (b) => b.y + b.h
  const centreOf = (b) => b.x + b.w / 2
  const widthRatio = picLegs.w / refLegs.w
  if (anchored) {
    placement.left = centreOf(refLegs) - centreOf(picLegs)
    placement.top = bottomOf(refLegs) - bottomOf(picLegs)
  }
  const bottom = Math.round(bottomOf(picLegs) + placement.top - bottomOf(refLegs))
  const centre = Math.round(centreOf(picLegs) + placement.left - centreOf(refLegs))
  const drift = Math.max(Math.abs(bottom), Math.abs(centre))
  let reason = null
  if (anchored && (widthRatio < WIDTH_RANGE[0] || widthRatio > WIDTH_RANGE[1])) reason = 'redrawn'
  else if (drift > DRIFT_LIMIT) reason = 'drift'
  return { scale: 1, widthRatio, edges: { ...none, bottom, centre }, drift, placement, reason }
}

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
 *
 * Plan 19: a body's face (`bodyExpression`) has an expression's. A hairstyle (`hair`) may change the head region
 * and anything outside its body, but not the body itself below the head region nor within `HAIR_BODY_MARGIN` of it
 * — hair never covers the torso, the arms or the hands — which is why it needs the body's picture, `ref`.
 *
 * @param {string} kind
 * @param {string | null} slot
 * @param {{ scale: number, offsetX: number, offsetY: number }} transform
 * @param {{ data: Buffer, width: number, height: number } | null} [ref]
 */
export function allowedArea(kind, slot, transform, ref = null) {
  const fx = (x) => x * transform.scale + transform.offsetX
  const fy = (y) => y * transform.scale + transform.offsetY
  const inCrop = (x, y) => fx(x) >= CROP.x && fx(x) < CROP.x + CROP.size && fy(y) >= CROP.y && fy(y) < CROP.y + CROP.size
  if (FACE_KINDS.has(kind)) return (_x, y) => fy(y) < FACE_LIMIT_Y
  if (kind === 'item' && (slot === 'head' || slot === 'face')) return (x, y) => fy(y) < HEAD_LIMIT_Y || inCrop(x, y)
  if (kind === 'hair') {
    if (!ref) throw new Error('a hairstyle is held to its body: allowedArea needs the body picture')
    const { width, height, data } = ref
    const solid = new Uint8Array(width * height)
    for (let at = 0; at < solid.length; at++) solid[at] = data[at * 4 + 3] > ALPHA_SOLID ? 255 : 0
    const body = dilateMask(solid, width, height, HAIR_BODY_MARGIN)
    return (x, y) => fy(y) < FACE_LIMIT_Y || body[y * width + x] === 0
  }
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

/**
 * The layers an ingest of `target` writes, which are the ones `runChecks` is run over. An aura or a frame is
 * its one item layer; a bot's neutral picture is its body and all six faces (the five besides neutral written
 * as copies of it, or kept where already real); a bot's second face is that face alone. Plan 19: a body is its
 * L30 and its neutral face, a body's face that face, a hairstyle its back (L20) and front (L60).
 *
 * @param {any} target a `parseSpec` result
 * @param {string} owner
 * @param {string | null} [variant]
 */
export function layerNames(target, owner, variant = null) {
  if (target.kind === 'base') return [baseFile(owner, LAYERS.body), faceFile(owner, 'neutral'), baseFile(owner, LAYERS.hairBack), baseFile(owner, LAYERS.hairFront)]
  if (target.kind === 'expr') return [faceFile(owner, target.expr)]
  if (target.kind === 'body') return [bodyFile(target.gender), bodyFaceFile(target.gender, 'neutral')]
  if (target.kind === 'bodyFace') return [bodyFaceFile(target.gender, target.expr)]
  if (target.kind === 'hair') return [hairFile(target.code, LAYERS.hairBack), hairFile(target.code, LAYERS.hairFront)]
  if (target.kind === 'bot') {
    const expr = target.expr ?? 'neutral'
    return expr === 'neutral' ? [botFile(target.bot), ...EXPRESSIONS.map((face) => botFaceFile(target.bot, face))] : [botFaceFile(target.bot, expr)]
  }
  return [itemFile(target.slot, target.code, SLOT_LAYER[target.slot], variant)]
}

/**
 * Which base or body an ingest belongs to: the base itself, an expression's base; since Plan 19 the body itself,
 * a body face's or a hairstyle's gender; or an item's `--base` (f01 when none — a body when it is `f`/`m`).
 */
export function ownerOf(target, spec) {
  if (target.kind === 'base' || target.kind === 'expr') return target.base
  if (target.kind === 'body' || target.kind === 'bodyFace' || target.kind === 'hair') return target.gender
  return spec?.base ?? 'f01'
}

/** The kinds `pipelineInput` aligns: each is cut with its owner's stored transform. */
const ALIGNED_KINDS = new Set(['expression', 'item', 'bodyExpression', 'hair'])

/**
 * The file the pipeline should be given for a picture. An expression, an item and — Plan 19 — a body's face and
 * a hairstyle are cut with their owner's stored transform, which was measured on a canvas the reference's size; a
 * picture on another canvas (the model's 1086 × 1448) is moved onto the reference's canvas first, aligned as
 * `verify` aligned it, and written to `tmp`. Anything else — a base, a body or a bot, which take a transform
 * whole, and any picture already on the reference's canvas — goes in as it is.
 */
export async function pipelineInput({ file, kind, slot = null, referenceFile, tmp }) {
  if (!referenceFile || !ALIGNED_KINDS.has(kind)) return { file, aligned: false }
  const pic = await readPicture(file)
  const ref = await readPicture(referenceFile)
  if (pic.width === ref.width && pic.height === ref.height) return { file, aligned: false }
  const { placement } = comparePictures(pic, ref, kind, slot)
  mkdirSync(tmp, { recursive: true })
  const out = join(tmp, 'aligned.png')
  await writePicture(await alignPicture(pic, ref, placement), out)
  return { file: out, aligned: true }
}

/** What a stored transform belongs to, in a message: a body (Plan 19) or a base. */
const ownerLabel = (owner) => (GENDERS.includes(owner) ? `body ${owner}` : `base ${owner}`)

/**
 * Ingest `file` into a copy of `publicDir` and run the checks (C1–C13) over what that wrote.
 *
 * The cut takes `transformFrom` — `transformSource`'s answer, never worked out here from a file name (Plan 19,
 * pre-flight #28): a new base's source base, a bot's root (f01, or a v4 redraw's body), a body's f01. A base or
 * body the copy has no transform for yet — an expression of a base not ingested, or since Plan 19 a hairstyle, a
 * body face or an item on a body not ingested — is ingested there first from the reference picture, as
 * `base:<id>` or `body:<g>`: for an expression, a face, a hairstyle or an item that is its owner's own picture.
 * A bot or a body needs its root's, so its reference stands in only when it is that picture (`referenceOwner`) —
 * a bot's happy face, drawn from the bot, cannot.
 */
async function pipelineChecks({ file, kind, slot, referenceFile, spec, transformFrom, rootPicture, publicDir, keepTmp, log }) {
  const tmp = mkdtempSync(join(tmpdir(), 'avatar-verify-'))
  const dir = join(tmp, 'avatar')
  try {
    cpSync(publicDir, dir, { recursive: true })
    const targets = [join(dir, MANIFEST_NAME)]
    const target = parseSpec(spec.as)
    const owner = ownerOf(target, spec)
    const quiet = () => {}
    // The base or body whose stored transform the cut needs: a bot's or a body's transform source, or an
    // expression's, a face's, a hairstyle's or an item's owner. A new base takes `transformFrom` from the copy as it
    // is (or is anchored by its own box), and an aura or a frame is placed by its ink box: neither needs one here.
    const square = target.kind === 'item' && SQUARE_KINDS.has(target.slot)
    const fromRoot = target.kind === 'bot' || target.kind === 'body'
    const needed = fromRoot ? transformFrom : target.kind === 'base' || square ? null : owner
    const has = (manifest) => (GENDERS.includes(needed) ? manifest.bodies?.[needed] : manifest.bases?.[needed])
    if (needed !== null && !has(readManifest(targets[0]))) {
      if (!referenceFile || (fromRoot && rootPicture !== needed)) throw new Error(`no ${ownerLabel(needed)} in ${publicDir} and no reference to ingest it from`)
      const standIn = GENDERS.includes(needed) ? { kind: 'body', gender: needed } : { kind: 'base', base: needed }
      await ingest({ file: referenceFile, target: standIn, dir, targets, log: quiet })
    }
    const input = await pipelineInput({ file, kind, slot, referenceFile, tmp: join(tmp, 'input') })
    const flags = parseFlags(spec.flags)
    await ingest({
      file: input.file, target, dir, targets, baseId: owner, variant: spec.variant ?? null,
      tolerance: flags.tolerance, white: flags.white, lockScale: flags.lockScale ?? null, transformFrom, hides: flags.hides, diff: flags.diff,
      hair: flags.hair ?? null, anchor: flags.anchor ?? null, recolourTo: flags.recolourTo ?? null, log: quiet,
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

/** No registry: what `transformSource` and `referenceOwner` read when a picture is scored on its own. */
const NO_REGISTRY = { assets: [] }

/**
 * Score one picture. `kind`/`slot` are the asset's; `referenceFile` is the reference picture's path (null
 * for an aura or a frame); `ingest` is the asset's `ingest` spec. `pipeline: false` stops before the
 * pipeline rule (the tests use it). Returns `{ verdict: 'ok' | 'ng', reason, measure, notes }`.
 *
 * `transformFrom` and `referenceOwner` are what the registry says of the asset (`transformSource`, and
 * `referenceOwner` of its reference — `verifyAssets` passes both); left out, they are worked out from the
 * reference picture's name alone, as for `verify --picture` (an `f01_candidate_1.png` is F01's).
 *
 * @param {{ file: string, kind: string, slot?: string | null, referenceFile?: string | null, ingest?: any, transformFrom?: string | null, referenceOwner?: string | null, publicDir?: string, pipeline?: boolean, keepTmp?: boolean, log?: (line: string) => void }} options
 */
export async function scorePicture({ file, kind, slot = null, referenceFile = null, ingest: spec = null, transformFrom, referenceOwner: rootPicture, publicDir = PUBLIC_DIR, pipeline = true, keepTmp = false, log = () => {} }) {
  const alone = { kind, reference: referenceFile === null ? null : basename(referenceFile) }
  const source = transformFrom === undefined ? transformSource(alone, NO_REGISTRY) : transformFrom
  const root = rootPicture === undefined ? referenceOwner(alone.reference, NO_REGISTRY) : rootPicture
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

  /** The last rule, `pipeline` / `check:<Cn>`: a trial ingest into a copy of `publicDir`, then `check`. */
  const pipelineRule = async () => {
    if (!pipeline) {
      notes.push('pipeline: not run')
      return done(null)
    }
    if (!spec) {
      notes.push('pipeline: not run (no ingest spec)')
      return done(null)
    }
    try {
      const result = await pipelineChecks({ file, kind, slot, referenceFile, spec, transformFrom: source, rootPicture: root, publicDir, keepTmp, log })
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

  // An aura or a frame has no figure and no reference: `hollow`, then straight to the pipeline (2026-09-24 —
  // until Plan 12's square targets it stopped at `hollow`, having nowhere to ingest to).
  if (SQUARE_KINDS.has(kind)) {
    measure.hollow = round2(hollowness(pic))
    if (measure.hollow >= HOLLOW.limit) return done('hollow')
    return pipelineRule()
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
    // A sleeping face floats a "z" glyph beside the head, which widens the box on that side alone (M02's: right
    // edge +20 px); the face cut keeps it — that is the expression — so a side edge up to `SLEEP_GLYPH` is fine.
    const sleepy = FACE_KINDS.has(kind) && /:sleep$/.test(spec?.as ?? '')
    const sideOnly = compared.reason === 'drift' && sleepy && (compared.edges.top === null || Math.abs(compared.edges.top) <= DRIFT_LIMIT) &&
      Math.abs(compared.edges.bottom) <= DRIFT_LIMIT && Math.abs(compared.edges.left) <= SLEEP_GLYPH && Math.abs(compared.edges.right) <= SLEEP_GLYPH
    if (compared.reason && headItem) notes.push(`body box ${compared.reason} (width ratio ${round2(compared.widthRatio)}, edges ${JSON.stringify(compared.edges)}) — advisory for a head item`)
    else if (sideOnly) notes.push(`side edge ${JSON.stringify(compared.edges)} — a sleeping face's "z" glyph`)
    else if (compared.reason) return done(compared.reason)
  } else {
    notes.push('no reference: drift, hair colour and scope not measured')
  }

  // A body is held to D02 §8's proportions like a base (Plan 19); a hairstyle's hair counts as head, so it is not.
  if (kind === 'base' || kind === 'body' || FACE_KINDS.has(kind) || (kind === 'item' && !headItem)) {
    const figure = measureFigure(removeChroma(pic))
    measure.heads = round2(figure.heads)
    // An expression is its base's own picture with the eyes and mouth redrawn: its proportions are the
    // base's, and `measure()`'s chin-finding is what moves (F02's long hair, a rounder eye). Advisory there,
    // and for a body's face (Plan 19), its proportions the body's.
    if (figure.heads < HEADS_RANGE[0] || figure.heads > HEADS_RANGE[1]) {
      if (FACE_KINDS.has(kind)) notes.push(`heads ${measure.heads} outside ${HEADS_RANGE.join('–')} — advisory for an expression (its proportions are the base's)`)
      else return done('heads')
    }
  }

  if (ref) {
    const aligned = await alignPicture(pic, ref, compared.placement)
    if (FACE_KINDS.has(kind) || (kind === 'item' && !headItem)) {
      const mine = hairColour(aligned)
      const theirs = hairColour(ref)
      if (theirs !== null) {
        measure.hairDelta = mine === null ? null : round2(colourDistance(...mine, ...theirs))
        if (mine === null || measure.hairDelta > HAIR_LIMIT) return done('hair_colour')
      }
    }
    const allowed = allowedArea(kind, slot, anchorBase(removeChroma(ref)), ref)
    if (allowed) {
      measure.scope = round2(scopeFraction(aligned, ref, allowed))
      // For a head item the body is outside the cut as well as outside the allowed area: advisory (see above).
      if (measure.scope >= SCOPE_LIMIT && headItem) notes.push(`scope ${measure.scope} outside the head — advisory for a head item`)
      else if (measure.scope >= SCOPE_LIMIT) return done('scope')
    }
  }

  return pipelineRule()
}

/**
 * What kind of asset an `--as` spec describes, for `verify --picture` (no registry entry to ask): the registry's
 * kind for the pipeline's target — `expr` an `expression`, and since Plan 19 `bodyFace` a `bodyExpression`.
 */
export function kindOfSpec(spec) {
  const target = parseSpec(spec)
  if (target.kind === 'base') return { kind: 'base', slot: null }
  if (target.kind === 'expr') return { kind: 'expression', slot: null }
  if (target.kind === 'body') return { kind: 'body', slot: null }
  if (target.kind === 'bodyFace') return { kind: 'bodyExpression', slot: null }
  if (target.kind === 'hair') return { kind: 'hair', slot: null }
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
    const result = await scorePicture({
      file, kind: asset.kind, slot: asset.slot, referenceFile, ingest: asset.ingest,
      transformFrom: transformSource(asset, registry), referenceOwner: referenceOwner(asset.reference, registry), publicDir, keepTmp, pipeline, log,
    })
    Object.assign(last, { measure: result.measure, verdict: result.verdict, reason: result.reason, by: 'verify' })
    if (result.notes.length) last.notes = result.notes
    asset.status = result.verdict === 'ok' ? 'ok' : asset.attempts.length >= MAX_ATTEMPTS ? 'blocked' : 'ng'
    results.push({ id: asset.id, ...result })
  }
  return results
}
