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
  colourDistance,
  dilateMask,
  featherMask,
  keepLargeRegions,
  maskBBox,
  readPicture,
  removeChroma,
  writeDensities,
} from './png.mjs'
import { CROP, HEAD_LIMIT_Y, LAYERS, UNDERWEAR_BAND, anchorBase, applyTransform } from './frame.mjs'
import { MANIFEST_NAME, SLOT_LAYER, baseFile, entryFor, faceFile, itemFile, readManifest, writeManifest } from './manifest.mjs'

/** D02 §8.3: a chibi is between two and two and a half heads tall, or it is not this character. */
export const HEADS_RANGE = [2, 2.5]
/** D02 §8.4: the eyes sit in the lower half of the head. */
export const EYE_RANGE = [0.5, 0.8]
/** D02 §8.2: front-on and symmetric about the canvas axis, to within two per cent of the width. */
export const CENTRE_TOLERANCE = 0.02

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

// ─────────────────────────────────────────────────────────── the style gate ──

/**
 * The measurements D02 §8 asks a person to take by eye, taken by code instead.
 *
 * The chin is found as the narrowest row between the widest one (the head, on a chibi) and three fifths
 * of the way down: on this style the neck is the narrowest thing in the picture, and the first row that
 * reaches that width is where the head stops. The eye line is the weighted centre of the dark pixels
 * inside the head, and is reported as `null` — with a note saying so — when there are too few of them to
 * mean anything, because a picture with closed eyes or a heavy fringe is not thereby a bad picture.
 */
export function measure(pic) {
  const bbox = alphaBBox(pic)
  if (!bbox) throw new Error('the picture is empty — nothing survived the background removal')
  const notes = []
  const widths = new Int32Array(bbox.h)
  for (let row = 0; row < bbox.h; row++) {
    let first = -1
    let last = -1
    const y = bbox.y + row
    for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
      if (pic.data[(y * pic.width + x) * 4 + 3] <= ALPHA_INK) continue
      if (first < 0) first = x
      last = x
    }
    widths[row] = first < 0 ? 0 : last - first + 1
  }

  let peak = 0
  for (let row = 1; row < Math.floor(bbox.h * 0.5); row++) if (widths[row] > widths[peak]) peak = row
  const window = Math.max(peak + 2, Math.floor(bbox.h * 0.6))
  let narrowest = widths[peak + 1] ?? widths[peak]
  for (let row = peak + 1; row < window; row++) if (widths[row] < narrowest) narrowest = widths[row]
  // The *first* row that reaches the neck's width is the chin; the rows after it are the neck itself.
  let chin = peak + 1
  for (let row = peak + 1; row < window; row++) {
    if (widths[row] > narrowest) continue
    chin = row
    break
  }
  const headHeight = Math.max(1, chin)
  const heads = bbox.h / headHeight

  let darkWeight = 0
  let darkRows = 0
  for (let row = 0; row < chin; row++) {
    const y = bbox.y + row
    for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
      const at = (y * pic.width + x) * 4
      if (pic.data[at + 3] <= ALPHA_SOLID) continue
      const luma = 0.299 * pic.data[at] + 0.587 * pic.data[at + 1] + 0.114 * pic.data[at + 2]
      if (luma > 90) continue
      darkWeight += row
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
  return { bbox, headHeight, heads, eyeRatio, centreOffset, ok, notes }
}

/** The `--dry-run` report, as the lines the style gate reads. */
export function describeMeasurement(report, width) {
  return [
    `head height      ${report.headHeight} px of a ${report.bbox.h} px figure`,
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
 * One generated picture in, one layer (at both densities) and a manifest entry out.
 *
 * `target` is what `--as` parsed to: `{ kind: 'base' | 'expr' | 'item', … }`. A base establishes the
 * transform and stores it; everything after it reads that transform back, so an expression and a hat
 * generated from the same character lock land on the same pixels as the body they belong to.
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
  let picture = anchored
  let file2x
  if (target.kind === 'base') {
    file2x = { name: baseFile(owner, LAYERS.body), layer: LAYERS.body }
  } else if (target.kind === 'expr') {
    const mask = new Uint8Array(anchored.width * anchored.height).fill(255)
    keepOnlyCrop(mask, anchored.width, anchored.height, 2)
    picture = applyMask(anchored, mask)
    file2x = { name: faceFile(owner, target.expr), layer: LAYERS.face }
  } else {
    const basePicture = await readPicture(join(dir, `${baseFile(owner, LAYERS.body)}@2x.png`))
    const { mask } = diffAgainstBase(anchored, basePicture, { slot: target.slot, density: 2 })
    picture = applyMask(anchored, mask)
    file2x = { name: itemFile(target.slot, target.code, SLOT_LAYER[target.slot]), layer: SLOT_LAYER[target.slot], ...hides }
  }

  const bytes2x = await writeDensities(picture, dir, file2x.name)
  manifest.files[file2x.name] = entryFor(file2x, bytes2x, { real: true })
  await writeManifest(manifest, targets)
  log(`${file2x.name} — ${(bytes2x / 1024).toFixed(1)} KB at @2x, ${report.heads.toFixed(2)} heads`)
  return { report, name: file2x.name }
}
