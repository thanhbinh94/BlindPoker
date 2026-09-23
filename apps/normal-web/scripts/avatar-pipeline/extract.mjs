/**
 * Cutting a layer out of a generated picture.
 *
 * Spec §6 and D02 §7 describe the same job by hand: put the master picture under the one wearing the
 * hat at fifty per cent, line the heads up, select the hat, soften the edge, export. Everything here is
 * that, with the "line the heads up" step replaced by the one thing a script can be trusted with — the
 * two pictures were generated from the same character lock on the same canvas, so the *base's* transform
 * anchors both, and what is left over after a pixel-by-pixel difference is the item.
 *
 * Why a difference and not a colour key on the item itself: a hat generated on a character is a hat *on
 * a character*, and no colour separates the two. The base is the only description of "everything that is
 * not the item" that exists.
 *
 * The three slot rules exist because the difference is honest but not clever. `head` drops everything
 * below `HEAD_LIMIT_Y` — no hat reaches the waist. `face` keeps only the head region (the portrait crop
 * above `FACE_LIMIT_Y`). `outfit` drops everything above the chin line `OUTFIT_TOP_Y` and then adds back
 * exactly as much of the base as D01 §10.7 needs — see `underwearUnion`.
 *
 * 2026-09-17: an item layer holds only the item. Items are worn by M01 too and shown alone as inventory
 * icons, so the hair under a brim, the skin round a rim and the head above a collar — all of which the
 * generator redraws a little differently in every picture — have to stay out: `registerToBase` lines the
 * picture up first, `diffAgainstBase` compares neighbourhoods rather than pixels, and `cutItem` takes the
 * soft edge's colour from the item rather than from whatever it was drawn over.
 *
 * 2026-09-17, phase 2: an **outfit layer holds clothing only**, no skin at all. More bases are coming that
 * share F01's body and pose but not her skin tone, and the two places an outfit layer still picked skin up
 * were the union with the base below the underwear band (now `baseClothingUnion`: the band itself, and only
 * over the base's own clothing or where the picture changed something) and the limb cover (now seeded from
 * the layer's *clothing* pixels only). Skin is defined against the base being ingested on, not against a
 * constant: `baseSkinColour` (frame.mjs) measures it in the middle of that base's own face.
 *
 * 2026-09-21: the first eight real outfits showed that "is this pixel skin?" cannot be asked of one pixel
 * at a time. White silk trousers shade into the base's own skin colour, and the second clause of
 * `skinOfBase` then punched cream blotches through both legs. So an outfit's skin is decided **by region**
 * (`fillEnclosedGaps`): a gap in the clothing is the body showing through only when it reaches the outside
 * of the figure or the chin line, and a gap sealed in by cloth is cloth whatever colour it is. With it, the
 * colour clause is restricted to pixels the base draws skin under (`skinOfBase`), and the base's own
 * clothing is covered by the layer wherever it is, not only inside the underwear band
 * (`baseClothingUnion`, `coverBaseLimbs`).
 */
import { join } from 'node:path'
import {
  ALPHA_INK,
  ALPHA_SOLID,
  applyMask,
  alphaBBox,
  blankPicture,
  bleedColour,
  clonePicture,
  colourDistance,
  dilateMask,
  erodeMask,
  featherMask,
  keepLargeRegions,
  maskBBox,
  overPicture,
  placeOnCanvas,
  readPicture,
  removeChroma,
  writeDensities,
} from './png.mjs'
import { AURA_CY, AURA_SIZE, AXIS_X, BASELINE_Y, CROP, FACE_LIMIT_Y, FRAME, HEAD_LIMIT_Y, LAYERS, RING, RING_HOLLOW, SKIN_TOLERANCE, STRAND_MARGIN, TORSO_COLUMN, UNDERWEAR_BAND, anchorBase, applyTransform, baseSkinColour, isSkin, placeByInk } from './frame.mjs'
import { BOTS, EXPRESSIONS, ICON, MANIFEST_NAME, SLOT_LAYER, WEARS, baseFile, botFaceFile, botFile, entryFor, faceFile, itemFile, readManifest, wearOf, writeIcon, writeManifest } from './manifest.mjs'

/** D02 §8.3: a chibi is between two and two and a half heads tall, or it is not this character. */
export const HEADS_RANGE = [2, 2.5]
/** D02 §8.4: the eyes sit in the lower half of the head. */
export const EYE_RANGE = [0.5, 0.8]
/** D02 §8.2: front-on and symmetric about the canvas axis, to within two per cent of the width. */
export const CENTRE_TOLERANCE = 0.02
/** `measure`: the neck is where the silhouette under the axis stays narrower than this share of the head. */
export const NECK_RATIO = 0.7
/** `measure`: rows above the head narrower than this share of its width are a strand (an ahoge), not head. */
export const STRAND_RATIO = 0.2

/**
 * The chin line of the first real F01 picture, in frame units: an outfit keeps nothing above it
 * (2026-09-17). Collars and bow ties sit below it; everything above is the character's own head, which a
 * generator redraws slightly differently in every picture and which must not ride along in a layer that
 * M01 wears too.
 */
export const OUTFIT_TOP_Y = 236
/** `diffAgainstBase`, outfits only: the rows (@1x) under the chin line where the window reaches `radius` (@1x) instead. */
export const CHIN_BAND = { rows: 4, radius: 4 }
/**
 * How wide the line art around a limb is, in frame units (`coverBaseLimbsOutside`, G2). A bare thigh in a
 * generated picture is drawn inside its own 1–2 px outline, and that outline is not the base's colour
 * anywhere, so the difference keeps it: in the layer it looks exactly like cloth. This is how far the
 * "that is a limb, not a garment" label is grown over the layer before the two race.
 */
export const OUTLINE_SPAN = 2
/**
 * How far (frame units) past the base's own hair `fillEnclosedGaps` keeps treating a gap as hair. The ends
 * of F01's bob hang over her shoulders, so the last few pixels of a strand sit over skin rather than over
 * hair, and without the margin those tips are the one part of her hair a shared layer still picks up.
 */
export const HAIR_MARGIN = 4

/** `registerToBase`: how far, in pixels at the density being registered, the search looks each way. */
export const REGISTER_RANGE = 12
/** …and the scale factors it tries about the axis and the baseline. */
export const REGISTER_SCALES = [0.99, 0.995, 1, 1.005, 1.01]
/** `registerBySilhouette`: how many times a pixel near the base's outline counts, and how wide (@1x) that band is. */
export const SILHOUETTE_EDGE = { weight: 8, band: 2 }

/**
 * The defaults `diffAgainstBase` was tuned to on the first three real items (2026-09-17). Areas are in
 * frame units (pixels at @1x) and grow with the square of the density; `colorTol` is an RGB distance.
 */
export const DIFF_DEFAULTS = { colorTol: 36, shadowTol: 14, skinTol: SKIN_TOLERANCE, minRegion: 100, relativeRegion: 0.05, closeRadius: 1.5, maxHole: 400, gapOpening: 3, coverReach: 6 }
/** How much darker than the base a pixel may be and still be read as the item's shadow on it. */
export const SHADOW_RANGE = [0.45, 0.92]

/**
 * Where colour registration measures a picture against the base: the part of the figure the slot does
 * *not* change. A hat or a pair of glasses leaves the body alone. (An outfit changes the body's colours
 * everywhere, so it is registered by silhouette instead — see `registerBySilhouette`.)
 */
function registrationRegion(slot, density) {
  if (slot === 'head' || slot === 'face') {
    const top = HEAD_LIMIT_Y * density
    return (_x, y) => y >= top
  }
  return () => true
}

/**
 * A picture scaled by `factor` about the pivot `(px, py)`, on a canvas of the same size. Bilinear, over
 * premultiplied colour so that transparent pixels do not bleed black into the rim.
 */
export function scaleAbout(pic, factor, px, py) {
  if (factor === 1) return pic
  const { width, height, data } = pic
  const out = blankPicture(width, height)
  for (let y = 0; y < height; y++) {
    const sy = py + (y - py) / factor
    const y0 = Math.floor(sy)
    const fy = sy - y0
    for (let x = 0; x < width; x++) {
      const sx = px + (x - px) / factor
      const x0 = Math.floor(sx)
      const fx = sx - x0
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (const [cx, cy, weight] of [[x0, y0, (1 - fx) * (1 - fy)], [x0 + 1, y0, fx * (1 - fy)], [x0, y0 + 1, (1 - fx) * fy], [x0 + 1, y0 + 1, fx * fy]]) {
        if (weight === 0 || cx < 0 || cy < 0 || cx >= width || cy >= height) continue
        const at = (cy * width + cx) * 4
        const alpha = data[at + 3] * weight
        r += data[at] * alpha
        g += data[at + 1] * alpha
        b += data[at + 2] * alpha
        a += alpha
      }
      if (a <= 0) continue
      const at = (y * width + x) * 4
      out.data[at] = Math.round(r / a)
      out.data[at + 1] = Math.round(g / a)
      out.data[at + 2] = Math.round(b / a)
      out.data[at + 3] = Math.round(a)
    }
  }
  return out
}

/** A picture moved by whole pixels on a canvas of the same size. */
export function shiftPicture(pic, dx, dy) {
  if (dx === 0 && dy === 0) return pic
  return placeOnCanvas(pic, pic.width, pic.height, dx, dy)
}

/**
 * Line an item picture up with the base before diffing it (2026-09-17).
 *
 * Every generated item picture is the base *redrawn* with one change, and the redraw drifts: 2–6 px of
 * translation and a percent or so of size against the base on the first real pictures. A per-pixel
 * difference reads that drift as change along every edge of the figure, which is how a hat came out with
 * a band of hair under its brim. So: try every whole-pixel translation within `range` and each scale in
 * `scales` (about the axis and the baseline), and keep the one with the lowest mean absolute RGB difference
 * over the pixels solid in both pictures — measured only on the part of the figure the slot does not
 * touch (see `registrationRegion`). Every pixel of that region counts — sampling every other one leaves a
 * one-pixel ambiguity on any edge that happens to fall on the sampling grid. A candidate that overlaps the
 * base by less than 80 % of the best overlap is not considered, so a shift cannot win by sliding the figure
 * off the textured part.
 *
 * Returns the picture moved onto the base, and the move: `dx`/`dy` (pixels at this density, positive
 * right/down) and `scale`.
 *
 * @param {{ data: Buffer, width: number, height: number }} itemPic
 * @param {{ data: Buffer, width: number, height: number }} basePic
 * @param {{ slot?: string, density?: number, range?: number, scales?: number[] }} [options]
 */
export function registerToBase(itemPic, basePic, { slot, density = 1, range = REGISTER_RANGE, scales = REGISTER_SCALES } = {}) {
  if (slot === 'outfit') return registerBySilhouette(itemPic, basePic, { density, range, scales })
  const { width, height } = itemPic
  const inside = registrationRegion(slot, density)
  const samples = []
  for (let y = range; y < height - range; y++) {
    for (let x = range; x < width - range; x++) {
      if (!inside(x, y)) continue
      const at = (y * width + x) * 4
      if (basePic.data[at + 3] <= ALPHA_SOLID) continue
      samples.push(x, y)
    }
  }
  const pivotX = AXIS_X * density
  const pivotY = BASELINE_Y * density
  const candidates = []
  for (const scale of scales) {
    const scaled = scaleAbout(itemPic, scale, pivotX, pivotY)
    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        let sum = 0
        let overlap = 0
        for (let i = 0; i < samples.length; i += 2) {
          const x = samples[i]
          const y = samples[i + 1]
          // The item moved by (dx, dy): what lands on base (x, y) came from item (x - dx, y - dy).
          const from = ((y - dy) * width + (x - dx)) * 4
          if (scaled.data[from + 3] <= ALPHA_SOLID) continue
          const to = (y * width + x) * 4
          sum += Math.abs(scaled.data[from] - basePic.data[to]) +
            Math.abs(scaled.data[from + 1] - basePic.data[to + 1]) +
            Math.abs(scaled.data[from + 2] - basePic.data[to + 2])
          overlap++
        }
        if (overlap > 0) candidates.push({ dx, dy, scale, overlap, error: sum / (overlap * 3) })
      }
    }
  }
  const most = Math.max(0, ...candidates.map((candidate) => candidate.overlap))
  let best = { dx: 0, dy: 0, scale: 1, overlap: 0, error: Infinity }
  for (const candidate of candidates) {
    if (candidate.overlap < most * 0.8) continue
    // Ties go to the smaller move, so a flat region that cannot tell shifts apart does not invent one.
    const nearer = Math.abs(candidate.dx) + Math.abs(candidate.dy) + Math.abs(candidate.scale - 1) * 1000 <
      Math.abs(best.dx) + Math.abs(best.dy) + Math.abs(best.scale - 1) * 1000
    if (candidate.error < best.error - 1e-9 || (Math.abs(candidate.error - best.error) <= 1e-9 && nearer)) best = candidate
  }
  const picture = shiftPicture(scaleAbout(itemPic, best.scale, pivotX, pivotY), best.dx, best.dy)
  return { picture, dx: best.dx, dy: best.dy, scale: best.scale, error: best.error }
}

/**
 * An outfit's registration (2026-09-17, fix round 1): line the *body* up, not the head.
 *
 * An outfit keeps the base's own body alpha below the chin (D01 §10.7), so wherever the generated figure's
 * arms and legs sit a pixel or two off the base's, the base's outline shows beside them. And a generated
 * figure's body does not line up with its own head — on dealer01 the head fits at dy +8, scale 1.01 and the
 * limbs then miss. So: the same search as `registerToBase`, maximising the intersection-over-union of the
 * two *silhouettes* (pixels solid in each) over the rows at and below the chin line, `OUTFIT_TOP_Y`. Colour
 * is useless here — the outfit changed every colour of the body.
 *
 * Returns what `registerToBase` returns, with `error` as 1 − IoU and `iou` itself.
 */
export function registerBySilhouette(itemPic, basePic, { density = 1, range = REGISTER_RANGE, scales = REGISTER_SCALES, edgeWeight = SILHOUETTE_EDGE.weight, edgeBand = SILHOUETTE_EDGE.band } = {}) {
  const { width, height } = itemPic
  const top = OUTFIT_TOP_Y * density
  const baseSolid = new Uint8Array(width * height)
  for (let y = top; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (basePic.data[(y * width + x) * 4 + 3] > ALPHA_SOLID) baseSolid[y * width + x] = 1
    }
  }
  // Weights: a band either side of the base's outline counts `edgeWeight` times, so the fit is decided by
  // where the limbs' edges fall rather than by how much wider a skirt is than the legs under it.
  const edge = new Uint8Array(width * height)
  for (let y = top; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const here = baseSolid[p]
      if ((x > 0 && baseSolid[p - 1] !== here) || (x < width - 1 && baseSolid[p + 1] !== here) || (y > top && baseSolid[p - width] !== here) || (y < height - 1 && baseSolid[p + width] !== here)) edge[p] = 255
    }
  }
  const band = dilateMask(edge, width, height, Math.max(1, Math.round(edgeBand * density)))
  const weight = new Float32Array(width * height)
  let baseWeight = 0
  for (let y = top; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      weight[p] = band[p] ? edgeWeight : 1
      if (baseSolid[p]) baseWeight += weight[p]
    }
  }
  const pivotX = AXIS_X * density
  const pivotY = BASELINE_Y * density
  let best = { dx: 0, dy: 0, scale: 1, iou: -1 }
  for (const scale of scales) {
    const scaled = scaleAbout(itemPic, scale, pivotX, pivotY)
    const xs = []
    const ys = []
    for (let y = Math.max(0, top - range); y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (scaled.data[(y * width + x) * 4 + 3] <= ALPHA_SOLID) continue
        xs.push(x)
        ys.push(y)
      }
    }
    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        let inside = 0
        let both = 0
        for (let i = 0; i < xs.length; i++) {
          const ty = ys[i] + dy
          const tx = xs[i] + dx
          if (ty < top || ty >= height || tx < 0 || tx >= width) continue
          const p = ty * width + tx
          inside += weight[p]
          if (baseSolid[p]) both += weight[p]
        }
        const iou = both / (baseWeight + inside - both || 1)
        const nearer = Math.abs(dx) + Math.abs(dy) + Math.abs(scale - 1) * 1000 < Math.abs(best.dx) + Math.abs(best.dy) + Math.abs(best.scale - 1) * 1000
        if (iou > best.iou + 1e-9 || (Math.abs(iou - best.iou) <= 1e-9 && nearer)) best = { dx, dy, scale, iou }
      }
    }
  }
  const picture = shiftPicture(scaleAbout(itemPic, best.scale, pivotX, pivotY), best.dx, best.dy)
  return { picture, dx: best.dx, dy: best.dy, scale: best.scale, error: 1 - best.iou, iou: best.iou }
}

/**
 * The item, as a mask over the item picture.
 *
 * Both pictures must already be background-free and on the same frame — `ingest` anchors the item with
 * the base's transform and then `registerToBase` lines it up; getting that wrong shows up as a mask the
 * size of the whole figure.
 *
 * 2026-09-17, so that an item layer holds only the item (it is worn by M01 too, and shown alone as an
 * inventory icon):
 *
 * 1. **Neighbourhood difference.** A solid item pixel is *changed* only when its colour is further than
 *    `colorTol` from every solid base pixel in the (2r + 1)² window around it (r = the density — 2 px at
 *    @2x), or when that whole window is transparent in the base. A redrawn strand of hair a pixel or two
 *    away from where the base had it is not change. Nor is the base pixel right under it darkened (by a
 *    factor inside `SHADOW_RANGE`, to within `shadowTol`): that is the shadow a brim casts on the hair,
 *    and on M01 it would be a band of F01's hair colour.
 * 2. **Slot limits** (`slotLimits`) are applied before anything is measured, so a head the generator
 *    redrew cannot join an outfit's collar into one region.
 * 3. **Clean-up.** Connected regions under `minRegion` go; for `head` and `face`, so do regions under
 *    `relativeRegion` of the largest one. A closing of `closeRadius` seals the thin cracks where an outline
 *    of the base (an ahoge's) runs under the item in a matching colour, then holes under `maxHole` are
 *    filled, so a hat's flat crown that matches the hair behind it is not punched through; a lens is far
 *    larger and stays open. An **outfit** has no size limit at all (`fillEnclosedGaps`): every gap sealed
 *    in by cloth is cloth, however big, because the only thing that may show through an outfit is the body,
 *    and the body is reached from outside the figure.
 * 4. **Edge.** One pixel of dilation at @2x (half a pixel's worth at @1x, rounded up), clamped to the item
 *    picture's own alpha, then a one-pixel feather — antialiasing kept, no halo grown.
 * 5. **Slot rules** once more after the feather, and for `outfit` the part of the base the underwear rule
 *    absorbs (`underwearUnion`, through `applySlotRule`); then `minRegion` once more over the finished mask.
 *
 * Returns the `mask`, its `bbox`, and the `core` — the pixels that are the item itself rather than its soft
 * edge — which `cutItem` takes the edge's colour from.
 *
 * @param {{ data: Buffer, width: number, height: number }} itemPic
 * @param {{ data: Buffer, width: number, height: number }} basePic
 * @param {{ slot?: string, colorTol?: number, shadowTol?: number, minRegion?: number, relativeRegion?: number, closeRadius?: number, maxHole?: number, density?: number }} [options]
 */
export function diffAgainstBase(itemPic, basePic, options = {}) {
  const { slot, density = 1 } = options
  const { colorTol, shadowTol, skinTol, minRegion, relativeRegion, closeRadius, maxHole, gapOpening, coverReach } = { ...DIFF_DEFAULTS, ...stripUndefined(options) }
  const { width, height } = itemPic
  if (basePic.width !== width || basePic.height !== height) {
    throw new Error(`the base is ${basePic.width} × ${basePic.height} and the item is ${width} × ${height} — they must share a frame`)
  }
  const radius = Math.max(1, Math.round(density))
  // Just under the chin line an outfit picture still holds the character's own chin, a few pixels off the
  // base's once the body is registered rather than the head: there the window reaches further.
  const chinTop = slot === 'outfit' ? OUTFIT_TOP_Y * density : -1
  const chinBottom = slot === 'outfit' ? (OUTFIT_TOP_Y + CHIN_BAND.rows) * density : -1
  const tolSquared = colorTol * colorTol
  const shadowSquared = shadowTol * shadowTol
  // The base's own skin, and with it what counts as clothing on either picture (2026-09-17, phase 2).
  const skin = slot === 'outfit' ? baseSkinColour(basePic, density) : null
  const different = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const at = p * 4
      if (itemPic.data[at + 3] <= ALPHA_SOLID) continue
      const r = itemPic.data[at]
      const g = itemPic.data[at + 1]
      const b = itemPic.data[at + 2]
      let anySolid = false
      let close = false
      const reach = y >= chinTop && y < chinBottom ? CHIN_BAND.radius * density : radius
      for (let wy = Math.max(0, y - reach); wy <= Math.min(height - 1, y + reach) && !close; wy++) {
        for (let wx = Math.max(0, x - reach); wx <= Math.min(width - 1, x + reach); wx++) {
          const near = (wy * width + wx) * 4
          if (basePic.data[near + 3] <= ALPHA_SOLID) continue
          anySolid = true
          const dr = r - basePic.data[near]
          const dg = g - basePic.data[near + 1]
          const db = b - basePic.data[near + 2]
          if (dr * dr + dg * dg + db * db <= tolSquared) {
            close = true
            break
          }
        }
      }
      if (!close && anySolid && shadowSquared > 0 && basePic.data[at + 3] > ALPHA_SOLID) {
        // A shadow the item casts on the character: the base pixel right here, the same colour, darker.
        // `k` is the least-squares brightness factor from the base pixel to this one.
        const br = basePic.data[at]
        const bg = basePic.data[at + 1]
        const bb = basePic.data[at + 2]
        const energy = br * br + bg * bg + bb * bb
        const k = energy === 0 ? 0 : (r * br + g * bg + b * bb) / energy
        if (k >= SHADOW_RANGE[0] && k <= SHADOW_RANGE[1] && (r - k * br) ** 2 + (g - k * bg) ** 2 + (b - k * bb) ** 2 <= shadowSquared) close = true
      }
      // R1: an outfit layer holds clothing only, so the base's skin never enters it however far the
      // picture's shading of it has drifted from the base's own (`skinOfBase`).
      if ((!anySolid || !close) && !(slot === 'outfit' && skinOfBase(itemPic, basePic, p, skin, skinTol))) different[p] = 255
    }
  }
  slotLimits(different, { slot, width, height, density })
  // Areas are in frame units, so they grow with the square of the density.
  const area = density * density
  let kept = keepLargeRegions(different, width, height, Math.round(minRegion * area))
  if (slot === 'head' || slot === 'face') kept = keepRelativeRegions(kept, width, height, relativeRegion)
  const closeBy = Math.round(closeRadius * density)
  const closed = closeBy > 0 ? erodeMask(dilateMask(kept, width, height, closeBy), width, height, closeBy) : kept
  // An outfit's holes are decided by where they lead, not by how big they are (R1); every other slot keeps
  // the size limit, because a pair of glasses is a frame around a lens that has to stay open.
  const filled = slot === 'outfit'
    ? fillEnclosedGaps(closed, itemPic, basePic, { width, height, density, gapOpening, skin, skinTol })
    : fillHoles(closed, width, height, Math.round(maxHole * area))
  const grown = dilateMask(filled, width, height, Math.max(1, Math.ceil(density / 2)))
  for (let p = 0; p < grown.length; p++) grown[p] = Math.min(grown[p], itemPic.data[p * 4 + 3])
  const union = slot === 'outfit' ? baseClothingUnion(itemPic, basePic, { width, height, density, colorTol, skinTol, skin }) : null
  const cover = slot === 'outfit' ? coverBaseLimbs(grown, itemPic, basePic, { width, height, density, union, skinTol, skin, reach: coverReach }) : null
  const mask = featherMask(grown, width, height)
  const core = slotLimits(filled, { slot, width, height, density })
  applySlotRule(mask, basePic, { slot, width, height, density, core, union, cover })
  // The outfit's union with the base can leave slivers of its own — the tips of the hair just under the
  // head region — so the same minimum region is held once more on the finished mask.
  const final = keepLargeRegions(mask, width, height, Math.round(minRegion * area))
  for (let p = 0; p < core.length; p++) if (!final[p]) core[p] = 0
  return { mask: final, core, cover, bbox: maskBBox(final, width, height) }
}

/**
 * The head region: the portrait crop, cut off at `FACE_LIMIT_Y`, which the base's own face layer paints.
 */
function headRegion(density) {
  const left = CROP.x * density
  const right = (CROP.x + CROP.size) * density
  const bottom = FACE_LIMIT_Y * density
  return (x, y) => y < bottom && x >= left && x < right
}

/**
 * 2026-09-21, tried and reverted, so that nobody tries it twice: the head region is *not* narrowed to what
 * the base's face layer still paints (the region less `TORSO_COLUMN`, which layer 50 gave up on
 * 2026-09-17). Opening that column to the underwear rule looks right — between `OUTFIT_TOP_Y` and
 * `FACE_LIMIT_Y` inside it nothing draws over the outfit at all — but what the base inks there is not its
 * tank top, it is F01's *hair*, hanging beside her neck: her straps start at y ≈ 256, below the region
 * altogether. The rule took 1 300–1 700 px of purple into every shared layer, and M01 wore it on his
 * shoulders. `casual01`'s strap patch and dotted collar sit below `FACE_LIMIT_Y` and are `fillEnclosedGaps`'
 * business, not the head region's.
 */

/**
 * Whether the outfit picture's pixel at `p` is the base's own skin showing through (2026-09-17, phase 2).
 *
 * The definition R1 fixes is *within `skinTol` of the base body's colour at the same registered position,
 * where the base is solid* — a bare thigh in a generated picture is the base's thigh redrawn, so it lands
 * within a few units of it once the body is registered, while a sleeve, a hem or a sock does not.
 *
 * With one addition the real dealer01 needed. The base's own thigh is *shaded* where a skirt would fall on
 * it; the generated picture put the skirt somewhere slightly else and painted plain skin there, so the two
 * disagree by 30–50 while the picture's pixel is the base's flat skin tone to within 3. A pixel that *is*
 * the base's skin colour is the base's skin wherever on the body it sits, so the second clause is exactly
 * that: `baseSkinColour ± skinTol`, over anything the base inks.
 *
 * Where the base has nothing under the pixel there is no skin to be — that is new silhouette, and it is the
 * item. A garment the same colour as the base's skin, to within `skinTol`, is indistinguishable from the
 * body underneath it and is lost on purpose; what it would have hidden is put back by `baseClothingUnion`.
 *
 * 2026-09-21 (R2): the colour clause is narrowed to pixels the base draws **skin** under. Unrestricted, it
 * read the shaded folds of white silk trousers as F01's cheek and punched both legs full of holes — cloth
 * that happens to land on a skin tone is only a candidate for being skin where there is skin behind it, and
 * even then only if the gap it belongs to reaches the outside of the figure (`fillEnclosedGaps`). Colour
 * alone never removes a pixel that is sealed in by cloth.
 */
function skinOfBase(itemPic, basePic, p, skin, skinTol) {
  const at = p * 4
  if (basePic.data[at + 3] <= ALPHA_SOLID) return false
  if (colourDistance(itemPic.data[at], itemPic.data[at + 1], itemPic.data[at + 2], basePic.data[at], basePic.data[at + 1], basePic.data[at + 2]) <= skinTol) return true
  return isSkin(basePic.data[at], basePic.data[at + 1], basePic.data[at + 2], skin, skinTol) &&
    isSkin(itemPic.data[at], itemPic.data[at + 1], itemPic.data[at + 2], skin, skinTol)
}

/**
 * An outfit's skin, decided by region rather than by pixel (2026-09-21, R1).
 *
 * The difference says what *changed*; it cannot say what the change was of. A fold of white silk shaded
 * down to the base's own skin tone reads as skin, and a pixel of a t-shirt that happens to sit within
 * `colorTol` of the tank-top strap five pixels away reads as unchanged — either way the pixel drops out and
 * the layer has a hole in it, which the body then shows through. On the real `tet_red01` and `champion01`
 * that was both trouser legs full of cream blotches.
 *
 * What separates the two cases is not colour, it is topology — and thickness. The only thing that may show
 * through an outfit is the *body*, and the body is not inside the clothes: a bare thigh, a hand, the neck
 * all reach the outside of the figure or the chin line the layer is cut at. So take every gap in the
 * clothing below `OUTFIT_TOP_Y` and keep it only if it is connected — 4-connected, through gap pixels — to
 * the frame's own border (which is outside the combined silhouette, since C2 and C3 keep the figure off it)
 * or to the top cut line. Everything else is sealed in by cloth, and cloth is what it is filled with: the
 * mask is set and `diffAgainstBase` then clamps it to the registered picture's own alpha, so a filled gap
 * is the picture's own pixels and nothing is invented.
 *
 * 2026-09-21, round 2 (G1): connectivity alone is not enough, because a gap can *drain*. The strip of
 * shading down `casual01`'s shoulder runs into the neck opening, the fringe down `champion01`'s inner
 * trouser seam runs into the hem, the dashes round `tet_red01`'s cuff run into the hand — every one of them
 * reaches an opening, and every one of them is one to three pixels thick, while each piece of body that is
 * genuinely meant to show is a blob tens of pixels across. So a gap now has to be **thick** as well as
 * connected: it survives a morphological opening by `gapOpening` (frame units) — erode, then dilate the
 * same radius back and clip to the gaps it came from. A strip thinner than twice the radius vanishes in
 * the erosion and never comes back; a hand, a thigh and the neck are restored whole.
 *
 * Thickness is measured on the gap **inside the combined silhouette**, and that is the one thing about
 * this worth remembering. Measured on the whole gap mask — the exterior of the figure included — an
 * opening removes nothing at all, because every one of these strips runs *alongside* the exterior (the
 * inner trouser seam beside the crotch, the shoulder beside the neck): the structuring element sits in the
 * exterior with its rim over the strip, and the dilation hands the strip straight back. So the erosion
 * treats everything outside the figure, off the frame and above the cut line as solid, and the exterior is
 * used only for connectivity, never as something to grow back from.
 *
 * There is no size limit, which is the other half of the ruling: `maxHole` goes on guarding the head and
 * face slots, where a glasses lens is an enclosed hole that has to stay open.
 */
export function fillEnclosedGaps(mask, itemPic, basePic, { width, height, density = 1, gapOpening = DIFF_DEFAULTS.gapOpening, skin = null, skinTol = DIFF_DEFAULTS.skinTol }) {
  const out = Uint8Array.from(mask)
  const top = OUTFIT_TOP_Y * density
  if (top >= height) return out
  const total = width * height
  // The gaps, split into the ones inside the figure (which have to be thick to stay open) and the exterior
  // (which is how they reach the outside in the first place).
  const inside = new Uint8Array(total)
  const gap = new Uint8Array(total)
  for (let p = top * width; p < total; p++) {
    if (mask[p] !== 0) continue
    gap[p] = 1
    if (itemPic.data[p * 4 + 3] > ALPHA_SOLID || basePic.data[p * 4 + 3] > ALPHA_SOLID) inside[p] = 1
  }
  const radius = Math.max(0, Math.round(gapOpening * density))
  let eroded = inside
  for (let step = 0; step < radius; step++) {
    const next = new Uint8Array(total)
    for (let y = top; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x
        if (!eroded[p]) continue
        let keep = true
        for (let dy = -1; dy <= 1 && keep; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || nx >= width || ny >= height || ny < top || !eroded[ny * width + nx]) {
              keep = false
              break
            }
          }
        }
        if (keep) next[p] = 1
      }
    }
    eroded = next
  }
  const thick = radius > 0 ? dilateMask(eroded, width, height, radius) : eroded
  const open = new Uint8Array(total)
  const stack = []
  const reach = (p) => {
    if (open[p] || !gap[p]) return
    open[p] = 1
    stack.push(p)
  }
  // The gap is open if it touches the chin line the layer is cut at, or the frame's border below it.
  for (let x = 0; x < width; x++) {
    reach(top * width + x)
    reach((height - 1) * width + x)
  }
  for (let y = top; y < height; y++) {
    reach(y * width)
    reach(y * width + width - 1)
  }
  while (stack.length) {
    const p = stack.pop()
    const x = p % width
    const y = (p - x) / width
    if (x > 0) reach(p - 1)
    if (x < width - 1) reach(p + 1)
    if (y > top) reach(p - width)
    if (y < height - 1) reach(p + width)
  }
  // A gap inside the figure stays a gap only if it is both reached and thick. The exterior is left as it
  // is: there is nothing there for the layer to hold in the first place.
  //
  // The base's own **hair** is exempt from the *thickness* half, and only it: inside the head region, where
  // the base draws something that is not its skin — grown by `HAIR_MARGIN` so that the ends of the strands,
  // which hang over the shoulder's skin, are exempt with the rest of the hair. The picture's hair is the
  // base's hair redrawn a strand or two out of place, so the difference leaves a lattice of one-pixel gaps
  // between the strands: thin by this rule's measure, and filling them hands F01's purple hair to every
  // base that wears the layer. Connectivity alone decides there, as it did before this rule existed. The
  // middle of a neckline is nowhere near the hair, so a collar's dotted line is judged like everything else.
  const inHead = headRegion(density)
  const hair = new Uint8Array(total)
  for (let y = top; y < Math.min(height, FACE_LIMIT_Y * density); y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const at = p * 4
      if (!inHead(x, y) || basePic.data[at + 3] <= ALPHA_SOLID) continue
      if (!isSkin(basePic.data[at], basePic.data[at + 1], basePic.data[at + 2], skin, skinTol)) hair[p] = 1
    }
  }
  const nearHair = dilateMask(hair, width, height, Math.max(1, Math.round(HAIR_MARGIN * density)))
  for (let p = top * width; p < total; p++) {
    if (!inside[p]) continue
    if (open[p] && (thick[p] || nearHair[p])) continue
    out[p] = 255
  }
  return out
}

/**
 * The part of the base an outfit layer absorbs (2026-09-17, phase 2 — R1; 2026-09-21 — R3).
 *
 * D01 §10.7 asks that an outfit leave no underwear showing, and the layer once took the base's whole body
 * below the chin to guarantee it. That put the *generated picture's* bare thighs, hands and neck into the
 * layer — F01's skin, in a file M01 and every base after him wears too — so it was cut back to the
 * underwear band. The band then turned out to be the wrong shape for the job: the base's shorts flare
 * past `UNDERWEAR_BAND.y1` at the hip, and `tuxedo01`'s trousers left two grey notches there.
 *
 * So the rule is stated by what it is about rather than by a rectangle: **the base's own clothing is never
 * visible**. Anywhere below `OUTFIT_TOP_Y`, outside the head region, a pixel the base draws that is *not
 * its skin* (`baseSkinColour` ± `skinTol`) is the tank top, the shorts or their line art, and the layer
 * takes it — with the base's own alpha, and the registered picture's own colour, *even if that colour is
 * skin*: a swimsuit-cut outfit still has to hide the underwear, and what hides it is the picture's pixel.
 * Where the picture has no pixel there at all, this adds nothing and `coverBaseLimbs` bleeds the nearest
 * cloth colour over it instead.
 *
 * The second clause is still the band's: inside `UNDERWEAR_BAND` a pixel the picture *changed* — further
 * than `colorTol` from the base at the same position — is the outfit's own cloth and joins the layer even
 * over skin, which is what keeps a collar's shadow and a neckline whole.
 *
 * On the base's skin the picture left alone, nothing is added anywhere: the base's limbs show, in the
 * base's own colour, which is the whole point.
 *
 * Returns the alpha to add, per pixel — the base's, wherever it is added at all.
 */
export function baseClothingUnion(itemPic, basePic, { width, height, density = 1, colorTol = DIFF_DEFAULTS.colorTol, skinTol = DIFF_DEFAULTS.skinTol, skin = null }) {
  const union = new Uint8Array(width * height)
  const top = OUTFIT_TOP_Y * density
  const bandTop = Math.max(UNDERWEAR_BAND.y0, OUTFIT_TOP_Y) * density
  const bandBottom = Math.min(height, UNDERWEAR_BAND.y1 * density)
  const covered = headRegion(density)
  for (let y = top; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (covered(x, y)) continue
      const p = y * width + x
      const at = p * 4
      const alpha = basePic.data[at + 3]
      if (alpha === 0) continue
      const pictured = itemPic.data[at + 3] > ALPHA_SOLID
      if (!pictured) continue
      const solid = alpha > ALPHA_SOLID
      // R3: the base's own clothing, wherever on the body it is.
      if (solid && !isSkin(basePic.data[at], basePic.data[at + 1], basePic.data[at + 2], skin, skinTol)) {
        union[p] = alpha
        continue
      }
      if (y < bandTop || y >= bandBottom) continue
      const changed = !solid ||
        colourDistance(itemPic.data[at], itemPic.data[at + 1], itemPic.data[at + 2], basePic.data[at], basePic.data[at + 1], basePic.data[at + 2]) > colorTol
      if (changed) union[p] = alpha
    }
  }
  return union
}

/**
 * An outfit covers the base's limbs where its own stop short (2026-09-17, fix round 2).
 *
 * A generated figure's arms and legs are not the base's: on dealer01 they are a few pixels narrower, so the
 * base's outline showed beside every limb. Below the chin line, every pixel the base inks and the outfit
 * layer does not cover solidly joins the layer: its alpha is the base's there, its colour that of the
 * nearest solid outfit pixel — the outfit's own edge, outline colour and all, bled outward over the base's.
 * The head region (the crop above `FACE_LIMIT_Y`) is left alone, as the outfit's union with the base leaves
 * it: the base's face layer paints it, and filling it would close the neck under a collar.
 *
 * 2026-09-17, phase 2 (R1): the cover is clothing-to-outline only, at both ends.
 *
 * - Only a *clothing* pixel of the layer bleeds. A pixel of the layer that is the base's own skin showing
 *   through (`skinOfBase`) is neither a source of colour nor a seed, so a bare thigh covers nothing.
 * - Only a *non-skin* pixel of the base is covered. What the cover was invented to hide is the base's own
 *   **outline** standing beside a sleeve the generator drew a little narrow; the base's bare limb beside it
 *   is not a defect any more, it is the point — it is the limb a darker base must be free to draw itself.
 *
 * So a cuff still bridges to the base's hand across the outline between them, a sock's rim still meets the
 * leg's, and the thigh above a hem keeps the base's own colour rather than a ten-pixel band of skirt.
 *
 * 2026-09-21 (R3): the five-pixel reach is gone. It was there so that a base limb with no outfit limb near
 * it could not be smeared — but since phase 2 the bleed never touches the base's skin at all, and what it
 * does touch is the base's own clothing and line art, which may not show at any distance. The base's shorts
 * flare further past `tuxedo01`'s trousers than five pixels, and the notch of grey that left is what this
 * ruling is about. The walk is still confined to pixels the base inks and does not call skin, so a bare
 * limb is reached only along its outline, and only from a cuff or a hem that actually meets it.
 *
 * 2026-09-21, round 2 (G2): a second, reach-limited pass follows it — `coverBaseLimbsOutside` — for the
 * base's *skin* where the picture is transparent and the nearest thing the picture does draw is cloth.
 *
 * Writes the alpha into `grown` (the mask before its feather) and returns `{ at, rgb }`: which pixels were
 * added, and the colour each takes.
 */
function coverBaseLimbs(grown, itemPic, basePic, { width, height, density, union = null, skinTol = DIFF_DEFAULTS.skinTol, skin = null, reach = DIFF_DEFAULTS.coverReach }) {
  const top = OUTFIT_TOP_Y * density
  const inHead = headRegion(density)
  // The layer's *clothing*: solidly covered (the outfit's own soft rim is see-through, and the base's
  // outline shows through it) and not the base showing through. That is at once where the bleed starts and
  // where it stops — a pixel of the layer that is the base redrawn is neither a source of colour nor a wall,
  // because the line art the cover exists to hide is exactly a pixel the picture left as the base had it.
  const clothing = new Uint8Array(width * height)
  const distance = new Uint16Array(width * height).fill(0xffff)
  const rgb = new Uint8Array(width * height * 3)
  let frontier = []
  for (let y = top; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      if (Math.min(Math.max(grown[p], union === null ? 0 : union[p]), itemPic.data[p * 4 + 3]) <= ALPHA_SOLID) continue
      if (skinOfBase(itemPic, basePic, p, skin, skinTol)) continue
      clothing[p] = 1
      distance[p] = 0
      rgb.set(itemPic.data.subarray(p * 4, p * 4 + 3), p * 3)
      frontier.push(p)
    }
  }
  // Bleed outward one ring at a time (8-connected), for as far as the base's own clothing and line art go
  // (R3 — there is no distance limit; the walk stops at the base's skin and at its silhouette). Each new
  // pixel takes the mean colour of its neighbours in the rings before it — nearest-neighbour, but without
  // the streaks a single arbitrary nearest pixel leaves along an antialiased outline.
  for (let step = 1; frontier.length; step++) {
    const ring = []
    for (const p of frontier) {
      const x = p % width
      const y = (p - x) / width
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < top || nx >= width || ny >= height) continue
          const q = ny * width + nx
          if (distance[q] <= step) continue
          if (clothing[q] || basePic.data[q * 4 + 3] <= ALPHA_INK || inHead(nx, ny)) continue
          // The base's own skin is left to the base: only its line art (and its own clothing) is covered.
          if (isSkin(basePic.data[q * 4], basePic.data[q * 4 + 1], basePic.data[q * 4 + 2], skin, skinTol)) continue
          // Inside the band the underwear rule has already said what the layer holds, in the picture's own
          // colours; the cover must not paint over a swimsuit-cut outfit there.
          if (union !== null && union[q] > 0) continue
          distance[q] = step
          ring.push(q)
        }
      }
    }
    for (const q of ring) {
      const x = q % width
      const y = (q - x) / width
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const o = ny * width + nx
          if (distance[o] >= step) continue
          r += rgb[o * 3]
          g += rgb[o * 3 + 1]
          b += rgb[o * 3 + 2]
          n++
        }
      }
      rgb[q * 3] = Math.round(r / n)
      rgb[q * 3 + 1] = Math.round(g / n)
      rgb[q * 3 + 2] = Math.round(b / n)
    }
    frontier = ring
  }
  const at = new Uint8Array(width * height)
  for (let p = top * width; p < width * height; p++) {
    if (distance[p] === 0 || distance[p] === 0xffff) continue
    at[p] = 1
    grown[p] = basePic.data[p * 4 + 3]
  }
  coverBaseLimbsOutside(grown, at, rgb, distance, clothing, itemPic, basePic, { width, height, density, top, inHead, reach })
  return { at, rgb }
}

/**
 * A limb that pokes out of its sleeve (2026-09-21, round 2 — G2).
 *
 * The pass above never touches the base's skin, on the principle that a bare limb is the base's to draw.
 * `tuxedo01` showed the cost: the base's legs are a pixel or two wider than the picture's trousers, so a
 * dashed line of the base's own skin — cream on F01, tan on M01 — ran down the outer edge of both trouser
 * legs, reading as a leg poking out of the trousers rather than as a leg.
 *
 * The distinction that decides it is what the *picture* has nearest, not what the base has:
 *
 * - a base pixel the picture does not reach at all, whose nearest pixel of the figure is **cloth**, is a
 *   limb the garment was drawn too narrow for. It is covered — with that cloth's colour bled outward and
 *   the base's alpha, skin or not — out to `reach` (frame units).
 * - a base pixel whose nearest pixel of the figure is an **open gap** — a bare thigh, a hand, the neck,
 *   drawn a little narrower than the base draws it — is left alone. It is the base's limb, and the base's
 *   own silhouette is what should show there.
 *
 * So the two race: the layer's cloth (and everything the unlimited pass has already covered, which is cloth
 * in the layer by now) starts at distance 0 against every pixel of the picture the layer does not hold, and
 * the walk runs only over pixels the base inks and the picture leaves transparent. Whichever reaches a
 * pixel first says what it is.
 */
function coverBaseLimbsOutside(grown, at, rgb, covered, clothing, itemPic, basePic, { width, height, density, top, inHead, reach = DIFF_DEFAULTS.coverReach }) {
  const total = width * height
  const CLOTH = 1
  const GAP = 2
  const label = new Uint8Array(total)
  const distance = new Uint16Array(total).fill(0xffff)
  // A bare limb the picture draws is a gap — and so is the **line art around it**, which is not the base's
  // colour anywhere and therefore rides into the layer as if it were the garment. Left as cloth it would
  // win every race along a bare thigh and paint the base's own edge over. So the gap label is grown over
  // the layer by `OUTLINE_SPAN` first: a limb's outline belongs to the limb.
  // Only the layer's own cloth is cloth here. What the unlimited pass has already covered is the *base's*
  // line art painted over — including the outline round a bare limb, which it reaches from the far side —
  // and letting that start a race would carry the garment two more pixels into every thigh.
  const inLayer = new Uint8Array(total)
  let gapish = new Uint8Array(total)
  for (let p = top * width; p < total; p++) {
    if (clothing[p]) inLayer[p] = 1
    else if (itemPic.data[p * 4 + 3] > ALPHA_SOLID) gapish[p] = 1
  }
  for (let step = 0; step < Math.max(1, Math.round(OUTLINE_SPAN * density)); step++) {
    const next = Uint8Array.from(gapish)
    for (let y = top; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x
        if (!gapish[p]) continue
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < top || nx >= width || ny >= height) continue
            if (inLayer[ny * width + nx]) next[ny * width + nx] = 1
          }
        }
      }
    }
    gapish = next
  }
  let frontier = []
  for (let p = top * width; p < total; p++) {
    if (gapish[p]) {
      label[p] = GAP
      distance[p] = 0
      frontier.push(p)
    } else if (inLayer[p]) {
      label[p] = CLOTH
      distance[p] = 0
      frontier.push(p)
    }
  }
  const limit = Math.max(1, Math.round(reach * density))
  for (let step = 1; step <= limit && frontier.length; step++) {
    const ring = []
    for (const p of frontier) {
      const x = p % width
      const y = (p - x) / width
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < top || nx >= width || ny >= height) continue
          const q = ny * width + nx
          if (distance[q] !== 0xffff) continue
          // Only outside the picture's own figure, only where the base inks, and never where the base's
          // face layer draws over the outfit anyway.
          if (itemPic.data[q * 4 + 3] > ALPHA_SOLID) continue
          if (basePic.data[q * 4 + 3] <= ALPHA_INK || inHead(nx, ny)) continue
          if (covered[q] !== 0xffff) continue
          distance[q] = step
          label[q] = label[p]
          ring.push(q)
        }
      }
    }
    for (const q of ring) {
      if (label[q] !== CLOTH) continue
      const x = q % width
      const y = (q - x) / width
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const o = ny * width + nx
          if (distance[o] >= step || label[o] !== CLOTH) continue
          r += rgb[o * 3]
          g += rgb[o * 3 + 1]
          b += rgb[o * 3 + 2]
          n++
        }
      }
      if (n === 0) continue
      rgb[q * 3] = Math.round(r / n)
      rgb[q * 3 + 1] = Math.round(g / n)
      rgb[q * 3 + 2] = Math.round(b / n)
    }
    frontier = ring
  }
  for (let p = top * width; p < total; p++) {
    if (distance[p] === 0 || distance[p] === 0xffff || label[p] !== CLOTH) continue
    at[p] = 1
    grown[p] = basePic.data[p * 4 + 3]
  }
}

/**
 * The item picture under its mask, with the rim recoloured from the inside.
 *
 * The one-pixel dilation and the feather give the layer a soft edge, but the pixels they reach are the
 * *character* the item was drawn on — a ring of hair under a brim, of skin round a rim. Those pixels keep
 * the alpha the edge needs and take the colour of the nearest pixels of the item itself (the `core` of
 * `diffAgainstBase`), which is `removeChroma`'s colour bleed applied to a mask instead of a key.
 *
 * @param {{ data: Buffer, width: number, height: number }} itemPic
 * @param {{ mask: Uint8Array, core: Uint8Array, cover?: { at: Uint8Array, rgb: Uint8Array } | null }} cut
 */
export function cutItem(itemPic, { mask, core, cover = null }) {
  const out = applyMask(itemPic, mask)
  const { width, height } = out
  let edge = new Uint8Array(core)
  if (cover) {
    // An outfit's cover over the base's limbs (`coverBaseLimbs`): the mask's alpha, the bled colour, and left
    // alone by the rim pass below.
    for (let p = 0; p < cover.at.length; p++) {
      if (!cover.at[p] || mask[p] === 0) continue
      out.data.set(cover.rgb.subarray(p * 3, p * 3 + 3), p * 4)
      out.data[p * 4 + 3] = mask[p]
      edge[p] = 255
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    const next = Uint8Array.from(edge)
    let changed = false
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x
        if (edge[p] || mask[p] === 0) continue
        let r = 0
        let g = 0
        let b = 0
        let n = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= width || ny >= height || !edge[ny * width + nx]) continue
            const at = (ny * width + nx) * 4
            r += out.data[at]
            g += out.data[at + 1]
            b += out.data[at + 2]
            n++
          }
        }
        if (n === 0) continue
        const at = p * 4
        out.data[at] = Math.round(r / n)
        out.data[at + 1] = Math.round(g / n)
        out.data[at + 2] = Math.round(b / n)
        next[p] = 255
        changed = true
      }
    }
    edge = next
    if (!changed) break
  }
  return out
}

function stripUndefined(options) {
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined))
}

/** The hard limits of a slot, as a mask operation: what a slot's item can never reach. */
function slotLimits(mask, { slot, width, height, density }) {
  if (slot === 'head') {
    mask.fill(0, Math.min(mask.length, HEAD_LIMIT_Y * density * width))
  } else if (slot === 'face') {
    keepOnlyHead(mask, width, height, density)
  } else if (slot === 'outfit') {
    mask.fill(0, 0, Math.min(mask.length, OUTFIT_TOP_Y * density * width))
  }
  return mask
}

function applySlotRule(mask, basePic, { slot, width, height, density, core = null, union = null, cover = null }) {
  slotLimits(mask, { slot, width, height, density })
  if (slot !== 'outfit') return
  // D01 §10.7: no underwear showing. What that costs the layer is `baseClothingUnion`'s decision now —
  // the base's own clothing anywhere below the chin, plus the pixels the picture changed inside the band.
  if (union !== null) {
    for (let p = 0; p < union.length; p++) {
      if (union[p] === 0) continue
      mask[p] = Math.max(mask[p], union[p])
      if (core && union[p] > ALPHA_SOLID) core[p] = 255
    }
  }
  // Both of those take the *base's* alpha, and both are applied after the feather on purpose: where the
  // layer ends because the base ends, its edge should be the base's own edge — soften it a second time and
  // the base's outline shows through the half-transparent ring, which is the double outline all this is
  // about avoiding.
  if (cover !== null) {
    for (let p = 0; p < cover.at.length; p++) if (cover.at[p]) mask[p] = Math.max(mask[p], basePic.data[p * 4 + 3])
  }
}

/** Label the 4-connected regions of `inside(p)`, calling `visit(pixels, size, touchesBorder)` for each. */
function eachRegion(width, height, inside, visit) {
  const total = width * height
  const seen = new Uint8Array(total)
  const stack = new Int32Array(total)
  const region = new Int32Array(total)
  for (let start = 0; start < total; start++) {
    if (seen[start] || !inside(start)) continue
    let top = 0
    let size = 0
    let border = false
    stack[top++] = start
    seen[start] = 1
    while (top > 0) {
      const at = stack[--top]
      region[size++] = at
      const x = at % width
      const y = (at - x) / width
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) border = true
      if (x > 0 && !seen[at - 1] && inside(at - 1)) { seen[at - 1] = 1; stack[top++] = at - 1 }
      if (x < width - 1 && !seen[at + 1] && inside(at + 1)) { seen[at + 1] = 1; stack[top++] = at + 1 }
      if (y > 0 && !seen[at - width] && inside(at - width)) { seen[at - width] = 1; stack[top++] = at - width }
      if (y < height - 1 && !seen[at + width] && inside(at + width)) { seen[at + width] = 1; stack[top++] = at + width }
    }
    visit(region.subarray(0, size), size, border)
  }
}

/** Keep only the regions at least `fraction` of the largest one. */
export function keepRelativeRegions(mask, width, height, fraction) {
  const regions = []
  eachRegion(width, height, (p) => mask[p] > 0, (pixels, size) => regions.push({ pixels: Int32Array.from(pixels), size }))
  const largest = Math.max(0, ...regions.map((region) => region.size))
  const out = new Uint8Array(mask.length)
  for (const region of regions) {
    if (region.size < largest * fraction) continue
    for (const p of region.pixels) out[p] = mask[p]
  }
  return out
}

/** Fill every enclosed hole (a region of empty pixels not touching the edge) smaller than `maxHole`. */
export function fillHoles(mask, width, height, maxHole) {
  const out = Uint8Array.from(mask)
  if (maxHole <= 0) return out
  eachRegion(width, height, (p) => mask[p] === 0, (pixels, size, border) => {
    if (border || size >= maxHole) return
    for (const p of pixels) out[p] = 255
  })
  return out
}

/** Zero everything outside the portrait crop — D01 §5, and what C5 then confirms. */
export function keepOnlyCrop(mask, width, height, density) {
  const left = CROP.x * density
  const top = CROP.y * density
  const right = (CROP.x + CROP.size) * density
  const bottom = (CROP.y + CROP.size) * density
  for (let y = 0; y < height; y++) {
    if (y < top || y >= bottom) {
      mask.fill(0, y * width, (y + 1) * width)
      continue
    }
    mask.fill(0, y * width, y * width + left)
    mask.fill(0, y * width + right, (y + 1) * width)
  }
  return mask
}

/**
 * Zero everything outside the *head region* — the portrait crop, cut off at `FACE_LIMIT_Y` — which is
 * what a base's face layer (50) holds, whether it came from an expression picture or from the base.
 */
export function keepOnlyHead(mask, width, height, density) {
  keepOnlyCrop(mask, width, height, density)
  mask.fill(0, Math.min(mask.length, FACE_LIMIT_Y * density * width))
  return mask
}

/**
 * What a base's face layer (50) holds: the head region, less the torso column below y 236 (`TORSO_COLUMN`),
 * less the rows above `strandY` (frame units, or `null`) that an AI base's strand of hair went to layer 60 in.
 */
export function keepOnlyFace(mask, width, height, density, strandY = null) {
  keepOnlyHead(mask, width, height, density)
  const left = TORSO_COLUMN.x0 * density
  const right = (TORSO_COLUMN.x1 + 1) * density
  for (let y = TORSO_COLUMN.y0 * density; y < height; y++) mask.fill(0, y * width + left, y * width + right)
  if (strandY !== null) mask.fill(0, 0, Math.min(mask.length, Math.round(strandY * density) * width))
  return mask
}

/** A clip (`(pic, density) => pic`, as `writeDensities` takes) down to a base's face layer; see `keepOnlyFace`. */
export function clipToFace(strandY = null) {
  return (pic, density) => applyMask(pic, keepOnlyFace(new Uint8Array(pic.width * pic.height).fill(255), pic.width, pic.height, density, strandY))
}

/** A clip keeping only the rows `from ≤ y < to` (frame units; `null` for no bound). */
export function clipToRows(from, to) {
  return (pic, density) => {
    const mask = new Uint8Array(pic.width * pic.height).fill(255)
    if (from !== null) mask.fill(0, 0, Math.min(mask.length, Math.round(from * density) * pic.width))
    if (to !== null) mask.fill(0, Math.min(mask.length, Math.round(to * density) * pic.width))
    return applyMask(pic, mask)
  }
}

/** Every pixel under `threshold` (default `ALPHA_INK`) made fully transparent black, in place. */
export function dropFaint(pic, threshold = ALPHA_INK) {
  for (let at = 0; at < pic.data.length; at += 4) if (pic.data[at + 3] < threshold) pic.data.fill(0, at, at + 4)
  return pic
}

/**
 * The faint threshold for a strand layer (L60): a strand is solid ink, and what the key leaves around it at
 * alpha 8–30 is noise that C3 counts as litter (M03's second picture: one alpha-13 pixel off the strand).
 */
export const STRAND_FAINT = 32
/** The faint threshold for an aura (layer 10): its painterly glow trails into alpha ≤ 30 far from the ring. */
export const GLOW_FAINT = 32

/**
 * Where an AI base's strand of hair ends, in frame units, or `null` when it has none (2026-09-17, fix
 * round 1). `measure` finds the head top below any thin strand above it; the cut sits `STRAND_MARGIN` below
 * that, on a whole frame unit so both densities cut on the same row.
 */
export function strandCut(report, transform) {
  if (!report.strand) return null
  return Math.round(report.top * transform.scale + transform.offsetY + STRAND_MARGIN)
}

// ─────────────────────────────────────────────────────────── the style gate ──

/**
 * The measurements D02 §8 asks a person to take by eye, taken by code instead.
 *
 * Every row gets two widths: the *outline* (first to last pixel with ink) and the *run under the axis*
 * (the unbroken stretch of ink through the figure's centre column). The widest outline row in the top half
 * is the head.
 *
 * The top of the head is the first row of a settled stretch at least `STRAND_RATIO` of the head's width.
 * An ahoge or a single raised strand is counted in the picture's bounding box but not as head: counted,
 * it makes a 2.1-head figure measure under two.
 *
 * The chin is looked for under the axis, not in the outline. On a bob the hair's two side curtains hang
 * past the chin, so the outline stays head-wide down to the ends of the hair and its first narrow row is
 * the shoulders — that reads a 2.1-head figure as 1.9. Under the axis the face narrows into the neck
 * between the curtains. So: find the first stretch after the head where the run under the axis stays
 * below `NECK_RATIO` of the head's width for a few consecutive rows (the neck), take the narrowest run
 * from there to three fifths of the way down, and call the first row that reaches it the chin. A figure
 * with no such stretch — nothing on the axis, say — falls back to the narrowest *outline* row, the rule
 * this used to be.
 *
 * The eye line is the weighted centre of the dark pixels inside the head, and is reported as `null` — with
 * a note saying so — when there are too few of them to mean anything, because a picture with closed eyes
 * or a heavy fringe is not thereby a bad picture.
 *
 * `strand` says whether thin strands were found above `top` (the ones the note reports). `top` and `chin` are rows of the picture; `headHeight` is `chin - top` and `heads` is the figure from
 * `top` to its feet over that.
 */
export function measure(pic) {
  const bbox = alphaBBox(pic)
  if (!bbox) throw new Error('the picture is empty — nothing survived the background removal')
  const notes = []
  const inked = (x, y) => pic.data[(y * pic.width + x) * 4 + 3] > ALPHA_INK
  const axis = Math.floor(bbox.x + bbox.w / 2)
  const widths = new Int32Array(bbox.h)
  const underAxis = new Int32Array(bbox.h)
  for (let row = 0; row < bbox.h; row++) {
    let first = -1
    let last = -1
    const y = bbox.y + row
    for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
      if (!inked(x, y)) continue
      if (first < 0) first = x
      last = x
    }
    widths[row] = first < 0 ? 0 : last - first + 1
    if (!inked(axis, y)) continue
    let left = axis
    let right = axis
    while (left > bbox.x && inked(left - 1, y)) left--
    while (right < bbox.x + bbox.w - 1 && inked(right + 1, y)) right++
    underAxis[row] = right - left + 1
  }

  let peak = 0
  for (let row = 1; row < Math.floor(bbox.h * 0.5); row++) if (widths[row] > widths[peak]) peak = row
  const headWidth = widths[peak]
  /** How many rows in a row make a stretch rather than a blip. */
  const settle = Math.max(3, Math.round(bbox.h * 0.01))

  let top = 0
  let streak = 0
  for (let row = 0; row <= peak; row++) {
    streak = widths[row] >= headWidth * STRAND_RATIO ? streak + 1 : 0
    if (streak < settle) continue
    top = row - settle + 1
    break
  }
  if (top >= settle) notes.push(`ignored ${top} px of thin strands above the head — it starts at y ${bbox.y + top}`)

  const window = Math.max(peak + 2, Math.floor(bbox.h * 0.6))
  let neck = -1
  streak = 0
  for (let row = peak + 1; row < window; row++) {
    streak = underAxis[row] > 0 && underAxis[row] < headWidth * NECK_RATIO ? streak + 1 : 0
    if (streak < settle) continue
    neck = row - settle + 1
    break
  }
  const lookIn = neck >= 0 ? underAxis : widths
  const from = neck >= 0 ? neck : peak + 1
  let narrowest = Infinity
  for (let row = from; row < window; row++) if (lookIn[row] > 0 && lookIn[row] < narrowest) narrowest = lookIn[row]
  // The *first* row that reaches the neck's width is the chin; the rows after it are the neck itself.
  let chin = from
  for (let row = from; row < window; row++) {
    if (lookIn[row] === 0 || lookIn[row] > narrowest) continue
    chin = row
    break
  }
  if (neck < 0) notes.push('no neck found under the axis: the chin is the narrowest row of the outline')
  const headHeight = Math.max(1, chin - top)
  const figureHeight = bbox.h - top
  const heads = figureHeight / headHeight

  let darkWeight = 0
  let darkRows = 0
  for (let row = top; row < chin; row++) {
    const y = bbox.y + row
    for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
      const at = (y * pic.width + x) * 4
      if (pic.data[at + 3] <= ALPHA_SOLID) continue
      const luma = 0.299 * pic.data[at] + 0.587 * pic.data[at + 1] + 0.114 * pic.data[at + 2]
      if (luma > 90) continue
      darkWeight += row - top
      darkRows++
    }
  }
  let eyeRatio = null
  if (darkRows > headHeight * 2) eyeRatio = darkWeight / darkRows / headHeight
  else notes.push('no eye line: too little dark pixel area inside the head to locate one')

  const centreOffset = bbox.x + bbox.w / 2 - pic.width / 2
  const ok =
    heads >= HEADS_RANGE[0] && heads <= HEADS_RANGE[1] &&
    Math.abs(centreOffset) <= pic.width * CENTRE_TOLERANCE &&
    (eyeRatio === null || (eyeRatio >= EYE_RANGE[0] && eyeRatio <= EYE_RANGE[1]))
  return { bbox, top: bbox.y + top, strand: top >= settle, chin: bbox.y + chin, headHeight, figureHeight, heads, eyeRatio, centreOffset, ok, notes }
}

/** The `--dry-run` report, as the lines the style gate reads. */
export function describeMeasurement(report, width) {
  return [
    `head height      ${report.headHeight} px of a ${report.figureHeight} px figure (head y ${report.top}–${report.chin})`,
    `total height     ${report.heads.toFixed(2)} heads (want ${HEADS_RANGE[0]}–${HEADS_RANGE[1]})`,
    report.eyeRatio === null
      ? 'eye line         not detected'
      : `eye line         ${(report.eyeRatio * 100).toFixed(0)} % down the head (want ${EYE_RANGE[0] * 100}–${EYE_RANGE[1] * 100} %)`,
    `centre offset    ${report.centreOffset.toFixed(1)} px of ${width} (want within ${(width * CENTRE_TOLERANCE).toFixed(0)})`,
    ...report.notes.map((note) => `note             ${note}`),
    `verdict          ${report.ok ? 'PASS' : 'FAIL'}`,
  ]
}

// ────────────────────────────────────────────────────────────────── ingest ──

/**
 * One generated picture in, its layers (at both densities) and their manifest entries out.
 *
 * `target` is what `--as` parsed to: `{ kind: 'base' | 'expr' | 'item', … }`. A base establishes the
 * transform and stores it; everything after it reads that transform back, so an expression and a hat
 * generated from the same character lock land on the same pixels as the body they belong to.
 *
 * An item and an expression write one layer each; an expression keeps only the face region (`keepOnlyFace`).
 * A base writes four (2026-09-15, AI bases are flat): L30 the whole figure, the neutral face L50 as its face
 * region, and L20/L60 as empty frames marked `empty: true` — except that since 2026-09-17 a strand of hair
 * above the head top (`measure`'s `strand`) is cut off at `strandY` (stored beside the transform) into L60,
 * and out of L30 and every face layer; items are then measured against L30 with L60 over it. Re-ingesting a
 * base therefore resets the neutral face to the base's own; ingest `expr:<base>:neutral` after it to
 * override that.
 *
 * `variant` (2026-09-20) makes an item the per-wear layer of an item that already exists rather than the
 * item itself: the same cut, against the base named by `--base`, written as `item_<slot>_<code>_<wear>_L<n>`
 * with `variantOf` and `wear` in its manifest entry. It has to agree with that base — a `m` variant is cut
 * on a base that wears `m`, or the layer would be the wrong shape for every figure that will wear it.
 *
 * 2026-09-24 (Plan 12), three more targets:
 *
 * - **An aura or a frame** (`item:aura:<code>`, `item:frame:<code>`) is a square picture with the effect in a
 *   ring and nothing to diff against a base — see `ingestSquare`.
 * - **A bot** (`bot:<n>`) is a figure drawn from F01's own picture, same canvas and pose, so it is cut like a
 *   base on the transform of `transformFrom` (default `BOT_TRANSFORM_FROM`, f01) rather than anchored by its
 *   own box: the whole figure as `bot_<n>_L30` — no strand cut, since a bot has no L60 to move it to and
 *   wears nothing that could hide it — and its head region as `bot_<n>_face_neutral_L50`. The other five
 *   faces are written as copies of the neutral one, marked `copyOf`, so `check` and the app see a complete
 *   set — except a face already real in its own right, which a new neutral picture leaves alone.
 * - **A bot's second face** (`bot:<n>:<expression>`, `bot:<n>:happy` in practice) cuts that one face from
 *   its picture's head region, on the same transform, and replaces the copy.
 *
 * @param {{ file: string, target: { kind: string, slot?: string, code?: string, base?: string, expr?: string, bot?: number }, dir: string, targets?: string[], baseId?: string, variant?: string | null, tolerance?: number, white?: boolean, dryRun?: boolean, lockScale?: number | null, transformFrom?: string | null, hides?: object, diff?: object, log?: (line: string) => void }} options
 */
export async function ingest({ file, target, dir, targets, baseId = 'f01', variant = null, tolerance = 40, white = false, dryRun = false, lockScale = null, transformFrom = null, hides = {}, diff = {}, log = () => {} }) {
  const square = target.kind === 'item' && SQUARE_SLOTS.has(target.slot)
  if (variant !== null) {
    if (!WEARS.includes(variant)) throw new Error(`--variant ${variant} is not one of ${WEARS.join(', ')}`)
    if (target.kind !== 'item') throw new Error('--variant belongs to an item — only a wardrobe layer has per-wear variants')
    if (square) throw new Error(`--variant belongs to a worn item — an ${target.slot} is one picture for every base`)
    const wear = wearOf(target.base ?? baseId)
    if (wear !== variant) {
      throw new Error(`--variant ${variant} does not match base ${target.base ?? baseId}, which wears ${wear ?? 'nothing the pipeline knows'} — cut a ${variant} variant on a ${variant} base`)
    }
  }
  if (target.kind === 'bot') {
    if (!BOTS.includes(target.bot)) throw new Error(`there is no bot ${target.bot} — the bots are ${BOTS.join(', ')}`)
    if (!EXPRESSIONS.includes(target.expr ?? 'neutral')) throw new Error(`bot ${target.bot} has no expression ${target.expr} — one of ${EXPRESSIONS.join(', ')}`)
  }
  const source = await readPicture(file)
  if (square) return ingestSquare({ source, target, dir, targets, tolerance, white, dryRun, log })
  const keyed = removeChroma(source, { key: white ? [255, 255, 255] : [0, 255, 0], tolerance, despill: !white })
  const report = measure(keyed)
  if (dryRun) {
    for (const line of describeMeasurement(report, source.width)) log(line)
    return { report, name: null }
  }

  const manifestFile = join(dir, MANIFEST_NAME)
  const manifest = readManifest(manifestFile)
  manifest.bases ??= {}
  const owner = target.kind === 'base' ? target.base : target.base ?? baseId

  let transform
  let strandY = null
  if (target.kind === 'base') {
    if (transformFrom !== null) {
      // 2026-09-24: a base drawn *from* another base (F02 from F01: same body, same pose, same canvas)
      // shares that base's body, so it takes that base's transform verbatim — anchoring it by its own box
      // would scale it by its own hair (no ahoge: 5.8 % taller a box) and every shared item would miss.
      const from = manifest.bases[transformFrom]?.transform
      if (!from) throw new Error(`no transform stored for base ${transformFrom} — ingest it with --as base:${transformFrom} first`)
      transform = { ...from }
      log(`transform taken from ${transformFrom}: scale ${from.scale.toFixed(4)}, offset ${from.offsetX.toFixed(1)}, ${from.offsetY.toFixed(1)}`)
    } else {
      const anchored = anchorBase(keyed)
      transform = { scale: anchored.scale, offsetX: anchored.offsetX, offsetY: anchored.offsetY }
    }
    strandY = strandCut(report, transform)
    manifest.bases[owner] = { transform, ...(strandY === null ? {} : { strandY }) }
  } else if (target.kind === 'bot') {
    // A bot is drawn from F01's picture (the registry's `f01_candidate_1.png`): same canvas, same pose, so
    // F01's transform places it — its own box would scale it by whatever it has instead of an ahoge.
    const from = transformFrom ?? BOT_TRANSFORM_FROM
    const stored = manifest.bases[from]?.transform
    if (!stored) throw new Error(`no transform stored for base ${from} — a bot is cut on it; ingest it with --as base:${from} first`)
    transform = { ...stored }
    log(`transform taken from ${from}: scale ${stored.scale.toFixed(4)}, offset ${stored.offsetX.toFixed(1)}, ${stored.offsetY.toFixed(1)}`)
  } else {
    transform = manifest.bases[owner]?.transform
    strandY = manifest.bases[owner]?.strandY ?? null
    if (!transform) throw new Error(`no transform stored for base ${owner} — ingest it with --as base:${owner} first`)
  }
  if (lockScale !== null) transform = { ...transform, scale: lockScale }

  const anchored = await applyTransform(keyed, transform, 2)
  /** What this picture becomes: `{ file, picture, clip?, extra? }`, one per layer written. */
  const layers = []
  if (target.kind === 'base') {
    // An AI base is one flat picture — hair, face and body baked together — so it is cut up by region:
    // the whole figure as the body; its head region again as the neutral face, because layer 50 sits
    // above the outfit and the hair ends and chin have to stay above a collar; the strand of hair above
    // the head top (an ahoge), if there is one, as the front hair (60), so a hat can hide it; and the back
    // hair (20) as an empty frame, since there is no separate hair to put in it.
    // `dropFaint` on every cut, as for items: a base whose key left a stray alpha-1 pixel a few pixels off
    // the figure (m01 did) fails C3 at @1x, and nothing under `ALPHA_INK` is visible anyway.
    const rowsBody = clipToRows(strandY, null)
    const body = (pic, density) => dropFaint(rowsBody(pic, density))
    layers.push({ file: { name: baseFile(owner, LAYERS.body), layer: LAYERS.body }, picture: body(anchored, 2), clip: body })
    const faceRows = clipToFace(strandY)
    const face = (pic, density) => dropFaint(faceRows(pic, density))
    layers.push({ file: { name: faceFile(owner, 'neutral'), layer: LAYERS.face }, picture: face(anchored, 2), clip: face })
    layers.push({ file: { name: baseFile(owner, LAYERS.hairBack), layer: LAYERS.hairBack }, picture: blankPicture(FRAME.w * 2, FRAME.h * 2), extra: { empty: true } })
    if (strandY === null) {
      layers.push({ file: { name: baseFile(owner, LAYERS.hairFront), layer: LAYERS.hairFront }, picture: blankPicture(FRAME.w * 2, FRAME.h * 2), extra: { empty: true } })
    } else {
      // Faint key noise above the head would be a stray pixel far outside a shape this small (C3), and the
      // colour a transparent pixel keeps is bytes nobody sees.
      const rows = clipToRows(null, strandY)
      const strand = (pic, density) => dropFaint(rows(pic, density), STRAND_FAINT)
      layers.push({ file: { name: baseFile(owner, LAYERS.hairFront), layer: LAYERS.hairFront }, picture: strand(anchored, 2), clip: strand })
      log(`strand above y ${strandY} moved to ${baseFile(owner, LAYERS.hairFront)}`)
    }
  } else if (target.kind === 'expr') {
    const faceRows = clipToFace(strandY)
    const face = (pic, density) => dropFaint(faceRows(pic, density))
    layers.push({ file: { name: faceFile(owner, target.expr), layer: LAYERS.face }, picture: face(anchored, 2), clip: face })
  } else if (target.kind === 'bot') {
    // The kit draws a bot as two layers (`layersFor` in packages/ui-kit/src/avatar2d/layers.ts): L30 and one
    // L50 face per expression — no hair layers, no wardrobe, so no strand cut and no icon.
    const body = (pic) => dropFaint(pic)
    const faceRows = clipToFace(null)
    const face = (pic, density) => dropFaint(faceRows(pic, density))
    const expr = target.expr ?? 'neutral'
    if (expr === 'neutral') {
      layers.push({ file: { name: botFile(target.bot), layer: LAYERS.body }, picture: body(anchored), clip: body })
      const neutral = botFaceFile(target.bot, 'neutral')
      const neutralPicture = face(anchored, 2)
      layers.push({ file: { name: neutral, layer: LAYERS.face }, picture: neutralPicture, clip: face })
      for (const other of EXPRESSIONS) {
        if (other === 'neutral') continue
        const name = botFaceFile(target.bot, other)
        const before = manifest.files[name]
        if (before?.real && !before.copyOf) {
          log(`${name} — real, left as it is`)
          continue
        }
        layers.push({ file: { name, layer: LAYERS.face }, picture: neutralPicture, clip: face, extra: { copyOf: neutral } })
      }
    } else {
      layers.push({ file: { name: botFaceFile(target.bot, expr), layer: LAYERS.face }, picture: face(anchored, 2), clip: face })
    }
  } else {
    // The item is measured against the whole base as it is drawn: its body, and its front hair when that
    // holds a strand — otherwise a strand the item picture still shows would read as part of the item.
    const basePicture = await readPicture(join(dir, `${baseFile(owner, LAYERS.body)}@2x.png`))
    const hairFront = baseFile(owner, LAYERS.hairFront)
    if (manifest.files[hairFront] && !manifest.files[hairFront].empty) overPicture(basePicture, await readPicture(join(dir, `${hairFront}@2x.png`)))
    const registered = registerToBase(anchored, basePicture, { slot: target.slot, density: 2 })
    const fit = registered.iou === undefined ? `mean difference ${registered.error.toFixed(1)}` : `silhouette IoU ${registered.iou.toFixed(3)}`
    log(`registered on ${owner}: dx ${registered.dx}, dy ${registered.dy} px @2x, scale ${registered.scale} (${fit})`)
    const cut = diffAgainstBase(registered.picture, basePicture, { ...diff, slot: target.slot, density: 2 })
    const layer = SLOT_LAYER[target.slot]
    // A variant carries the default layer's name so that everything downstream — the catalogue's
    // `asset.variants`, C6's routing, `placeholder`'s carry-over — can say which item it belongs to.
    const extra = variant === null ? {} : { variantOf: itemFile(target.slot, target.code, layer), wear: variant }
    // Below `ALPHA_INK` nothing is visible, and the halved copy of a mask edge can land a stray alpha-1
    // pixel a few pixels outside the shape — which is C3's `rác bán trong suốt`, not a soft edge.
    layers.push({ file: { name: itemFile(target.slot, target.code, layer, variant), layer, ...hides }, picture: dropFaint(cutItem(registered.picture, cut)), clip: (pic) => dropFaint(pic), extra, icon: true })
  }

  for (const { file: layerFile, picture, clip = null, extra = {}, icon = false } of layers) {
    const bytes2x = await writeDensities(picture, dir, layerFile.name, clip)
    manifest.files[layerFile.name] = entryFor(layerFile, bytes2x, { real: true, ...extra })
    log(`${layerFile.name} — ${(bytes2x / 1024).toFixed(1)} KB at @2x${extra.empty ? ', empty' : ''}${extra.copyOf ? `, a copy of ${extra.copyOf}` : ''}`)
    if (icon) {
      const name = await writeIcon(picture, dir, layerFile.name, manifest, { real: true })
      log(`${name} — ${ICON.w} × ${ICON.h}`)
    }
  }
  await writeManifest(manifest, targets)
  log(`${report.heads.toFixed(2)} heads`)
  return { report, name: layers[0].file.name }
}

/** The item slots whose picture is a square with the effect in a ring, placed by `ingestSquare` (2026-09-24). */
export const SQUARE_SLOTS = new Set(['aura', 'frame'])
/** The base whose stored transform a bot is cut on, unless `transformFrom` says otherwise (2026-09-24). */
export const BOT_TRANSFORM_FROM = 'f01'

/** Where each square slot's ink box goes, in frame units: its larger side, and its centre. */
const SQUARE_PLACEMENT = {
  aura: { size: AURA_SIZE, cx: AXIS_X, cy: AURA_CY },
  frame: { size: RING, cx: AXIS_X, cy: CROP.y + CROP.size / 2 },
}

/**
 * An aura or a frame, in (2026-09-24, Plan 12).
 *
 * The picture is a square — at least 1024, transparent, the effect in a ring with its middle empty — and there
 * is no figure in it, so there is nothing to diff against a base and no transform to take: it is placed by
 * its ink box alone (`placeByInk`). An **aura** (layer 10) is fitted to `AURA_SIZE` and centred on
 * (`AXIS_X`, `AURA_CY`), the effect spread round the whole body; it is wider than the frame and is cut off at
 * both sides, which C2 allows for layer 10 alone. A **frame** (layer 90) is fitted to `RING` and centred on
 * the crop's centre, and must leave the portrait showing: the mean alpha inside `RING_HOLLOW.radius` of its
 * half-width is held under `RING_HOLLOW.limit`, or the ingest is refused before anything is written.
 *
 * The background: a picture with its own transparency (all four corners alpha 0, which `verify` requires) is
 * not keyed at all — `removeChroma`'s despill would pull every green in a wind or earth aura down to grey —
 * only its colour is bled under the transparent rim so the resize cannot darken it. A picture on a flat
 * green (or `--white`) background is keyed as usual. The icon is the picture itself fitted into the square
 * (`writeIcon`), so an aura's is the whole ring rather than the frame-cut layer.
 */
async function ingestSquare({ source, target, dir, targets, tolerance, white, dryRun, log }) {
  const keyed = hasOwnTransparency(source)
    ? bleedUnder(source)
    : removeChroma(source, { key: white ? [255, 255, 255] : [0, 255, 0], tolerance, despill: !white })
  const placement = SQUARE_PLACEMENT[target.slot]
  // An aura's glow trails off into alpha 10–30 far from the ring (wind01: 72 such pixels at @1x), which is
  // C3's litter and not a visible edge; a frame is hard-edged and keeps the usual threshold.
  const faint = target.slot === 'aura' ? GLOW_FAINT : undefined
  const picture = dropFaint(await placeByInk(keyed, placement, 2), faint)
  const box = alphaBBox(keyed)
  const hollow = target.slot === 'frame' ? ringHollowness(picture, 2) : null
  const report = { ok: hollow === null || hollow < RING_HOLLOW.limit, box, hollow }
  const layer = SLOT_LAYER[target.slot]
  const name = itemFile(target.slot, target.code, layer)
  const lines = [
    `ink box          ${box.w} × ${box.h} at ${box.x},${box.y} of ${source.width} × ${source.height}`,
    `placed           ${placement.size} px across, centred on ${placement.cx},${placement.cy} (frame units)`,
    ...(hollow === null ? [] : [`hollow           mean alpha ${hollow.toFixed(3)} inside ${RING_HOLLOW.radius * 100} % of the ring's radius (want under ${RING_HOLLOW.limit})`]),
  ]
  if (dryRun) {
    for (const line of [...lines, `verdict          ${report.ok ? 'PASS' : 'FAIL'}`]) log(line)
    return { report, name: null }
  }
  if (!report.ok) {
    throw new Error(`${name}: the ring is not hollow — mean alpha ${hollow.toFixed(3)} inside ${RING_HOLLOW.radius * 100} % of its radius, want under ${RING_HOLLOW.limit}; a frame that fills its middle paints over the portrait`)
  }
  for (const line of lines) log(line)
  const manifest = readManifest(join(dir, MANIFEST_NAME))
  const bytes2x = await writeDensities(picture, dir, name, (pic) => dropFaint(pic, faint), { palette: target.slot === 'aura' })
  manifest.files[name] = entryFor({ name, layer }, bytes2x, { real: true })
  log(`${name} — ${(bytes2x / 1024).toFixed(1)} KB at @2x`)
  const icon = await writeIcon(keyed, dir, name, manifest, { real: true })
  log(`${icon} — ${ICON.w} × ${ICON.h}`)
  await writeManifest(manifest, targets)
  return { report, name }
}

/** Whether a picture carries its own transparency: all four corners fully transparent. */
function hasOwnTransparency(pic) {
  const { width, height, data } = pic
  return [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]].every(([x, y]) => data[(y * width + x) * 4 + 3] === 0)
}

/** A copy of a picture with its colour bled under the transparent pixels next to it, alpha untouched. */
function bleedUnder(pic) {
  const out = clonePicture(pic)
  bleedColour(out, 2)
  return out
}

/** The mean alpha (0–1) of a placed frame layer inside `RING_HOLLOW.radius` of the ring's half-width, round the crop centre. */
export function ringHollowness(pic, density = 1) {
  const cx = AXIS_X * density
  const cy = (CROP.y + CROP.size / 2) * density
  const r = RING_HOLLOW.radius * (RING / 2) * density
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
