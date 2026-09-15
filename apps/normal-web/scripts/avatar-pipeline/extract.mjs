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
 * The three slot rules exist because the difference is honest but not clever. It reports every pixel
 * that changed, including the shadow a hat casts on a cheek and the hair the generator redrew slightly
 * differently. `head` drops everything below `HEAD_LIMIT_Y` — no hat reaches the waist. `face` keeps only
 * the portrait crop. `outfit` goes the other way and *adds* the base's own body below the chin, because
 * D01 §10.7 asks that an outfit leave no underwear showing and an outfit that merely differs from the
 * base would leave exactly the pixels where the two happened to agree.
 */
import { join } from 'node:path'
import {
  ALPHA_INK,
  ALPHA_SOLID,
  applyMask,
  alphaBBox,
  blankPicture,
  colourDistance,
  dilateMask,
  featherMask,
  keepLargeRegions,
  maskBBox,
  readPicture,
  removeChroma,
  writeDensities,
} from './png.mjs'
import { CROP, FACE_LIMIT_Y, FRAME, HEAD_LIMIT_Y, LAYERS, UNDERWEAR_BAND, anchorBase, applyTransform } from './frame.mjs'
import { MANIFEST_NAME, SLOT_LAYER, baseFile, entryFor, faceFile, itemFile, readManifest, writeManifest } from './manifest.mjs'

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
 * The item, as a mask over the item picture.
 *
 * Both pictures must already be background-free and anchored with the same transform — that is the
 * caller's job, and getting it wrong shows up as a mask the size of the whole figure.
 *
 * @param {{ data: Buffer, width: number, height: number }} itemPic
 * @param {{ data: Buffer, width: number, height: number }} basePic
 * @param {{ slot?: string, colorTol?: number, minRegion?: number, density?: number }} [options]
 */
export function diffAgainstBase(itemPic, basePic, { slot, colorTol = 28, minRegion = 400, density = 1 } = {}) {
  const { width, height } = itemPic
  if (basePic.width !== width || basePic.height !== height) {
    throw new Error(`the base is ${basePic.width} × ${basePic.height} and the item is ${width} × ${height} — they must share a frame`)
  }
  const different = new Uint8Array(width * height)
  for (let p = 0; p < different.length; p++) {
    const at = p * 4
    if (itemPic.data[at + 3] <= ALPHA_SOLID) continue
    if (basePic.data[at + 3] <= ALPHA_SOLID) {
      different[p] = 255
      continue
    }
    const apart = colourDistance(
      itemPic.data[at], itemPic.data[at + 1], itemPic.data[at + 2],
      basePic.data[at], basePic.data[at + 1], basePic.data[at + 2],
    )
    if (apart > colorTol) different[p] = 255
  }
  // `minRegion` is an area in frame units, so it grows with the square of the density.
  const kept = keepLargeRegions(different, width, height, Math.round(minRegion * density * density))
  const grown = dilateMask(kept, width, height, 2 * density)
  for (let p = 0; p < grown.length; p++) grown[p] = Math.min(grown[p], itemPic.data[p * 4 + 3])
  const mask = featherMask(grown, width, height)
  applySlotRule(mask, basePic, { slot, width, height, density })
  return { mask, bbox: maskBBox(mask, width, height) }
}

function applySlotRule(mask, basePic, { slot, width, height, density }) {
  if (slot === 'head') {
    for (let y = HEAD_LIMIT_Y * density; y < height; y++) mask.fill(0, y * width, (y + 1) * width)
    return
  }
  if (slot === 'face') {
    keepOnlyCrop(mask, width, height, density)
    return
  }
  if (slot === 'outfit') {
    for (let y = UNDERWEAR_BAND.y0 * density; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x
        mask[p] = Math.max(mask[p], basePic.data[p * 4 + 3])
      }
    }
  }
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
export async function ingest({ file, target, dir, targets, baseId = 'f01', tolerance = 40, white = false, dryRun = false, lockScale = null, hides = {}, log = () => {} }) {
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
    const { mask } = diffAgainstBase(anchored, basePicture, { slot: target.slot, density: 2 })
    const layer = SLOT_LAYER[target.slot]
    layers.push({ file: { name: itemFile(target.slot, target.code, layer), layer, ...hides }, picture: applyMask(anchored, mask) })
  }

  for (const { file: layerFile, picture, clip = null, extra = {} } of layers) {
    const bytes2x = await writeDensities(picture, dir, layerFile.name, clip)
    manifest.files[layerFile.name] = entryFor(layerFile, bytes2x, { real: true, ...extra })
    log(`${layerFile.name} — ${(bytes2x / 1024).toFixed(1)} KB at @2x${extra.empty ? ', empty' : ''}`)
  }
  await writeManifest(manifest, targets)
  log(`${report.heads.toFixed(2)} heads`)
  return { report, name: layers[0].file.name }
}
