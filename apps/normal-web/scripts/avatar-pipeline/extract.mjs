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
 * above `FACE_LIMIT_Y`). `outfit` drops everything above the chin line `OUTFIT_TOP_Y` and then *adds* the
 * base's own body below it, because D01 §10.7 asks that an outfit leave no underwear showing and an outfit
 * that merely differs from the base would leave exactly the pixels where the two happened to agree.
 *
 * 2026-09-17: an item layer holds only the item. Items are worn by M01 too and shown alone as inventory
 * icons, so the hair under a brim, the skin round a rim and the head above a collar — all of which the
 * generator redraws a little differently in every picture — have to stay out: `registerToBase` lines the
 * picture up first, `diffAgainstBase` compares neighbourhoods rather than pixels, and `cutItem` takes the
 * soft edge's colour from the item rather than from whatever it was drawn over.
 */
import { join } from 'node:path'
import {
  ALPHA_INK,
  ALPHA_SOLID,
  applyMask,
  alphaBBox,
  blankPicture,
  dilateMask,
  erodeMask,
  featherMask,
  keepLargeRegions,
  maskBBox,
  placeOnCanvas,
  readPicture,
  removeChroma,
  writeDensities,
} from './png.mjs'
import { AXIS_X, BASELINE_Y, CROP, FACE_LIMIT_Y, FRAME, HEAD_LIMIT_Y, LAYERS, UNDERWEAR_BAND, anchorBase, applyTransform } from './frame.mjs'
import { ICON, MANIFEST_NAME, SLOT_LAYER, baseFile, entryFor, faceFile, itemFile, readManifest, writeIcon, writeManifest } from './manifest.mjs'

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

/** `registerToBase`: how far, in pixels at the density being registered, the search looks each way. */
export const REGISTER_RANGE = 12
/** …and the scale factors it tries about the axis and the baseline. */
export const REGISTER_SCALES = [0.99, 0.995, 1, 1.005, 1.01]

/**
 * The defaults `diffAgainstBase` was tuned to on the first three real items (2026-09-17). Areas are in
 * frame units (pixels at @1x) and grow with the square of the density; `colorTol` is an RGB distance.
 */
export const DIFF_DEFAULTS = { colorTol: 36, shadowTol: 14, minRegion: 100, relativeRegion: 0.05, closeRadius: 1.5, maxHole: 400 }
/** How much darker than the base a pixel may be and still be read as the item's shadow on it. */
export const SHADOW_RANGE = [0.45, 0.92]

/**
 * Where registration measures a picture against the base: the part of the figure the slot does *not*
 * change. A hat or a pair of glasses leaves the body alone; an outfit leaves the head alone.
 */
function registrationRegion(slot, density) {
  if (slot === 'outfit') {
    const left = CROP.x * density
    const right = (CROP.x + CROP.size) * density
    const top = CROP.y * density
    const bottom = FACE_LIMIT_Y * density
    return (x, y) => x >= left && x < right && y >= top && y < bottom
  }
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
 *    larger and stays open.
 * 4. **Edge.** One pixel of dilation at @2x (half a pixel's worth at @1x, rounded up), clamped to the item
 *    picture's own alpha, then a one-pixel feather — antialiasing kept, no halo grown.
 * 5. **Slot rules** once more after the feather, and for `outfit` the base's body below the chin line
 *    (see `applySlotRule`); then `minRegion` once more over the finished mask.
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
  const { colorTol, shadowTol, minRegion, relativeRegion, closeRadius, maxHole } = { ...DIFF_DEFAULTS, ...stripUndefined(options) }
  const { width, height } = itemPic
  if (basePic.width !== width || basePic.height !== height) {
    throw new Error(`the base is ${basePic.width} × ${basePic.height} and the item is ${width} × ${height} — they must share a frame`)
  }
  const radius = Math.max(1, Math.round(density))
  const tolSquared = colorTol * colorTol
  const shadowSquared = shadowTol * shadowTol
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
      for (let wy = Math.max(0, y - radius); wy <= Math.min(height - 1, y + radius) && !close; wy++) {
        for (let wx = Math.max(0, x - radius); wx <= Math.min(width - 1, x + radius); wx++) {
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
      if (!anySolid || !close) different[p] = 255
    }
  }
  slotLimits(different, { slot, width, height, density })
  // Areas are in frame units, so they grow with the square of the density.
  const area = density * density
  let kept = keepLargeRegions(different, width, height, Math.round(minRegion * area))
  if (slot === 'head' || slot === 'face') kept = keepRelativeRegions(kept, width, height, relativeRegion)
  const closeBy = Math.round(closeRadius * density)
  const closed = closeBy > 0 ? erodeMask(dilateMask(kept, width, height, closeBy), width, height, closeBy) : kept
  const filled = fillHoles(closed, width, height, Math.round(maxHole * area))
  const grown = dilateMask(filled, width, height, Math.max(1, Math.ceil(density / 2)))
  for (let p = 0; p < grown.length; p++) grown[p] = Math.min(grown[p], itemPic.data[p * 4 + 3])
  const mask = featherMask(grown, width, height)
  const core = slotLimits(filled, { slot, width, height, density })
  applySlotRule(mask, basePic, { slot, width, height, density, core })
  // The outfit's union with the base can leave slivers of its own — the tips of the hair just under the
  // head region — so the same minimum region is held once more on the finished mask.
  const final = keepLargeRegions(mask, width, height, Math.round(minRegion * area))
  for (let p = 0; p < core.length; p++) if (!final[p]) core[p] = 0
  return { mask: final, core, bbox: maskBBox(final, width, height) }
}

/**
 * The item picture under its mask, with the rim recoloured from the inside.
 *
 * The one-pixel dilation and the feather give the layer a soft edge, but the pixels they reach are the
 * *character* the item was drawn on — a ring of hair under a brim, of skin round a rim. Those pixels keep
 * the alpha the edge needs and take the colour of the nearest pixels of the item itself (the `core` of
 * `diffAgainstBase`), which is `removeChroma`'s colour bleed applied to a mask instead of a key.
 */
export function cutItem(itemPic, { mask, core }) {
  const out = applyMask(itemPic, mask)
  const { width, height } = out
  let edge = new Uint8Array(core)
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

function applySlotRule(mask, basePic, { slot, width, height, density, core = null }) {
  slotLimits(mask, { slot, width, height, density })
  if (slot === 'outfit') {
    // D01 §10.7: no underwear showing, so the base's own body below the band's top is part of the layer —
    // but never above the chin line, and never inside the head region, which the base's own face layer
    // (50, above the outfit) paints anyway: taken from the item picture, those rows are the character's
    // own hair ends and neck.
    const headLeft = CROP.x * density
    const headRight = (CROP.x + CROP.size) * density
    const headBottom = FACE_LIMIT_Y * density
    for (let y = Math.max(UNDERWEAR_BAND.y0, OUTFIT_TOP_Y) * density; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (y < headBottom && x >= headLeft && x < headRight) continue
        const p = y * width + x
        mask[p] = Math.max(mask[p], basePic.data[p * 4 + 3])
        if (core && basePic.data[p * 4 + 3] > ALPHA_SOLID) core[p] = 255
      }
    }
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

/** A picture cut down to the head region; the `clip` `writeDensities` applies again after halving. */
export function clipToHead(pic, density) {
  return applyMask(pic, keepOnlyHead(new Uint8Array(pic.width * pic.height).fill(255), pic.width, pic.height, density))
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
 * `top` and `chin` are rows of the picture; `headHeight` is `chin - top` and `heads` is the figure from
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
  return { bbox, top: bbox.y + top, chin: bbox.y + chin, headHeight, figureHeight, heads, eyeRatio, centreOffset, ok, notes }
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
 * An item and an expression write one layer each; an expression keeps only the head region (the crop,
 * above `FACE_LIMIT_Y`). A base writes four (2026-09-15, AI bases are flat): L30 the whole figure, the
 * neutral face L50 as its head region, and L20/L60 as empty frames marked `empty: true`. Re-ingesting a
 * base therefore resets the neutral face to the base's own; ingest `expr:<base>:neutral` after it to
 * override that.
 */
export async function ingest({ file, target, dir, targets, baseId = 'f01', tolerance = 40, white = false, dryRun = false, lockScale = null, hides = {}, diff = {}, log = () => {} }) {
  const source = await readPicture(file)
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
  if (target.kind === 'base') {
    const anchored = anchorBase(keyed)
    transform = { scale: anchored.scale, offsetX: anchored.offsetX, offsetY: anchored.offsetY }
    manifest.bases[owner] = { transform }
  } else {
    transform = manifest.bases[owner]?.transform
    if (!transform) throw new Error(`no transform stored for base ${owner} — ingest it with --as base:${owner} first`)
  }
  if (lockScale !== null) transform = { ...transform, scale: lockScale }

  const anchored = await applyTransform(keyed, transform, 2)
  /** What this picture becomes: `{ file, picture, clip?, extra? }`, one per layer written. */
  const layers = []
  if (target.kind === 'base') {
    // An AI base is one flat picture — hair, face and body baked together — so it is cut three ways:
    // the whole figure as the body; its head region again as the neutral face, because layer 50 sits
    // above the outfit and the hair ends and chin have to stay above a collar; and the two hair layers
    // as empty frames, since there is no separate hair to put in them.
    layers.push({ file: { name: baseFile(owner, LAYERS.body), layer: LAYERS.body }, picture: anchored })
    layers.push({ file: { name: faceFile(owner, 'neutral'), layer: LAYERS.face }, picture: clipToHead(anchored, 2), clip: clipToHead })
    for (const layer of [LAYERS.hairBack, LAYERS.hairFront]) {
      layers.push({ file: { name: baseFile(owner, layer), layer }, picture: blankPicture(FRAME.w * 2, FRAME.h * 2), extra: { empty: true } })
    }
  } else if (target.kind === 'expr') {
    layers.push({ file: { name: faceFile(owner, target.expr), layer: LAYERS.face }, picture: clipToHead(anchored, 2), clip: clipToHead })
  } else {
    const basePicture = await readPicture(join(dir, `${baseFile(owner, LAYERS.body)}@2x.png`))
    const registered = registerToBase(anchored, basePicture, { slot: target.slot, density: 2 })
    log(`registered on ${owner}: dx ${registered.dx}, dy ${registered.dy} px @2x, scale ${registered.scale} (mean difference ${registered.error.toFixed(1)})`)
    const cut = diffAgainstBase(registered.picture, basePicture, { ...diff, slot: target.slot, density: 2 })
    const layer = SLOT_LAYER[target.slot]
    layers.push({ file: { name: itemFile(target.slot, target.code, layer), layer, ...hides }, picture: cutItem(registered.picture, cut), icon: true })
  }

  for (const { file: layerFile, picture, clip = null, extra = {}, icon = false } of layers) {
    const bytes2x = await writeDensities(picture, dir, layerFile.name, clip)
    manifest.files[layerFile.name] = entryFor(layerFile, bytes2x, { real: true, ...extra })
    log(`${layerFile.name} — ${(bytes2x / 1024).toFixed(1)} KB at @2x${extra.empty ? ', empty' : ''}`)
    if (icon) {
      const name = await writeIcon(picture, dir, layerFile.name, manifest, { real: true })
      log(`${name} — ${ICON.w} × ${ICON.h}`)
    }
  }
  await writeManifest(manifest, targets)
  log(`${report.heads.toFixed(2)} heads`)
  return { report, name: layers[0].file.name }
}
