/**
 * Pixels. Everything in this pipeline that reads, writes or rewrites an RGBA buffer lives here, and
 * nothing here knows what a frame, a layer or an item is — that is `frame.mjs`'s business.
 *
 * The currency is a **picture**: `{ data, width, height }`, where `data` is a straight (not
 * premultiplied) 8-bit RGBA buffer of `width * height * 4` bytes. It is what `sharp` hands back from
 * `.raw()` and what it takes back in, so a picture can be passed to `sharp` at any point without a
 * re-encode.
 *
 * The one non-obvious step is the *colour bleed* inside `removeChroma`. D01 §8.3 asks for at least one
 * pixel of soft edge and for no white (or, here, green) fringe, and those two pull against each other:
 * the 1 px feather at the end is a blur of the alpha channel, so it hands alpha back to pixels that the
 * key had already emptied — and those pixels still hold the *background's* colour. Blurring alpha over
 * un-bled colour is precisely how a green halo is manufactured. So before the erosion, every emptied
 * pixel next to a surviving one takes that neighbour's colour: the feather then fades the silhouette's
 * own colour out to nothing, which is what a soft edge is.
 */
import sharp from 'sharp'
import { writeFile } from 'node:fs/promises'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Opaque enough to be part of the picture. Used for bounding boxes and for every "is there ink here". */
export const ALPHA_INK = 8
/** Opaque enough to count as coverage — what C6 and the difference pass mean by "solid". */
export const ALPHA_SOLID = 128

/** An empty RGBA picture: every byte zero, which is transparent black. */
export function blankPicture(width, height) {
  return { data: Buffer.alloc(width * height * 4), width, height }
}

export function clonePicture(pic) {
  return { data: Buffer.from(pic.data), width: pic.width, height: pic.height }
}

export async function readPicture(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

export async function writePicture(pic, file) {
  await sharp(pic.data, { raw: { width: pic.width, height: pic.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(file)
}

/** Rasterise an SVG string. The string carries its own `width`/`height`; the resize only asserts them. */
export async function renderSvg(svg, width, height) {
  const { data, info } = await sharp(Buffer.from(svg))
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

export async function resizePicture(pic, width, height) {
  const { data, info } = await sharp(pic.data, { raw: { width: pic.width, height: pic.height, channels: 4 } })
    .resize(width, height, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

/**
 * Write one layer at both densities: the @2x picture as given, and the @1x as that picture halved.
 *
 * @1x is never rendered on its own. C7 exists to hold the two to that relationship, and the reason is
 * D01 §8.2: a small render and a downscale of a large one are different images, and the small one is
 * always the worse of the two. Returns the byte count of the @2x file, which is what the manifest
 * publishes and C10 budgets.
 *
 * `clip`, when given, is applied to the halved picture before it is written: `(pic, density) => pic`. A
 * layer masked to a hard-edged region at @2x needs it, because the downscale's filter reaches a few
 * pixels past that edge and would hand the @1x a faint row of alpha just outside the region.
 */
export async function writeDensities(pic2x, dir, name, clip = null) {
  const resized = await resizePicture(pic2x, Math.round(pic2x.width / 2), Math.round(pic2x.height / 2))
  const half = clip ? clip(resized, 1) : resized
  await writePicture(pic2x, join(dir, `${name}@2x.png`))
  await writePicture(half, join(dir, `${name}@1x.png`))
  return statSync(join(dir, `${name}@2x.png`)).size
}

/** Write a file only when its bytes would change, so re-running a generator leaves a clean tree. */
export async function writeIfChanged(file, bytes) {
  try {
    if (readFileSync(file).equals(bytes)) return false
  } catch {
    // No file yet, or it is unreadable: write it.
  }
  await writeFile(file, bytes)
  return true
}

// ────────────────────────────────────────────────────────────── measurements ──

/** The smallest box containing every pixel with `alpha > threshold`, or `null` if there are none. */
export function alphaBBox(pic, threshold = ALPHA_INK) {
  return boxOf(pic.width, pic.height, (x, y) => pic.data[(y * pic.width + x) * 4 + 3] > threshold)
}

/** The same, over a single-channel mask. */
export function maskBBox(mask, width, height, threshold = ALPHA_INK) {
  return boxOf(width, height, (x, y) => mask[y * width + x] > threshold)
}

function boxOf(width, height, inside) {
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) return null
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** Euclidean distance between two RGB triples. The pipeline's only notion of "a different colour". */
export function colourDistance(r1, g1, b1, r2, g2, b2) {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

// ──────────────────────────────────────────────────────────────── the matte ──

/**
 * Drop a flat background and clean up what it leaves behind.
 *
 * `tolerance` is the radius, in RGB distance, inside which a pixel *is* the background; between
 * `tolerance` and `2 × tolerance` its alpha ramps back up, which is what keeps the antialiased rim of
 * the generated image from becoming a hard cut. `despill` then clamps green down to `max(R, B) + 8` on
 * everything that survived — a green screen tints the whole silhouette slightly, not only its rim — and
 * is turned off for the white-background variant, where there is no channel to pull down.
 */
export function removeChroma(pic, { key = [0, 255, 0], tolerance = 40, despill = key[1] > key[0] && key[1] > key[2] } = {}) {
  const out = clonePicture(pic)
  const [kr, kg, kb] = key
  for (let i = 0; i < out.data.length; i += 4) {
    const r = out.data[i]
    const g = out.data[i + 1]
    const b = out.data[i + 2]
    const distance = colourDistance(r, g, b, kr, kg, kb)
    if (distance <= tolerance) out.data[i + 3] = 0
    else if (distance < tolerance * 2) out.data[i + 3] = Math.round(out.data[i + 3] * ((distance - tolerance) / tolerance))
    if (despill && out.data[i + 3] > 0) out.data[i + 1] = Math.min(g, Math.max(r, b) + 8)
  }
  bleedColour(out, 2)
  erodeAlpha(out)
  featherAlpha(out)
  return out
}

/**
 * Push the silhouette's colour outward into the pixels the key emptied.
 *
 * Alpha is untouched: this only decides what colour a pixel will show *if* the feather later gives it
 * some. See the module header for why that matters.
 */
export function bleedColour(pic, passes = 1) {
  const { width, height, data } = pic
  for (let pass = 0; pass < passes; pass++) {
    const source = Buffer.from(data)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4
        if (source[at + 3] >= ALPHA_INK) continue
        let r = 0
        let g = 0
        let b = 0
        let n = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
            const near = (ny * width + nx) * 4
            if (source[near + 3] < ALPHA_INK) continue
            r += source[near]
            g += source[near + 1]
            b += source[near + 2]
            n++
          }
        }
        if (n === 0) continue
        data[at] = Math.round(r / n)
        data[at + 1] = Math.round(g / n)
        data[at + 2] = Math.round(b / n)
      }
    }
  }
}

/** One pixel off the silhouette: a 3 × 3 minimum filter over alpha. Colour is left exactly as it was. */
export function erodeAlpha(pic) {
  return setAlpha(pic, filterPlane(alphaOf(pic), pic.width, pic.height, Math.min))
}

/** One pixel of soft edge: a 3 × 3 box blur over alpha, and over alpha only. */
export function featherAlpha(pic) {
  return setAlpha(pic, blur3(alphaOf(pic), pic.width, pic.height))
}

function alphaOf(pic) {
  const alpha = new Uint8Array(pic.width * pic.height)
  for (let p = 0; p < alpha.length; p++) alpha[p] = pic.data[p * 4 + 3]
  return alpha
}

function setAlpha(pic, plane) {
  for (let p = 0; p < plane.length; p++) pic.data[p * 4 + 3] = plane[p]
  return pic
}

function filterPlane(plane, width, height, pick) {
  const out = new Uint8Array(plane.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = plane[y * width + x]
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          value = pick(value, nx < 0 || ny < 0 || nx >= width || ny >= height ? 0 : plane[ny * width + nx])
        }
      }
      out[y * width + x] = value
    }
  }
  return out
}

function blur3(plane, width, height) {
  const out = new Uint8Array(plane.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          sum += nx < 0 || ny < 0 || nx >= width || ny >= height ? 0 : plane[ny * width + nx]
        }
      }
      out[y * width + x] = Math.round(sum / 9)
    }
  }
  return out
}

// ───────────────────────────────────────────────────────────────── the masks ──

/** Grow a mask by `radius` pixels, square-kernel. */
export function dilateMask(mask, width, height, radius) {
  let current = mask
  for (let step = 0; step < radius; step++) current = filterPlane(current, width, height, Math.max)
  return current
}

/** One pixel of soft edge on a mask, matching what `featherAlpha` does to a picture. */
export function featherMask(mask, width, height) {
  return blur3(mask, width, height)
}

/**
 * Keep only the connected runs of at least `minRegion` pixels. 4-connected, iterative: the pictures are
 * up to 768 × 896, and a recursive flood fill over that overflows the stack on a large silhouette.
 */
export function keepLargeRegions(mask, width, height, minRegion) {
  const out = new Uint8Array(mask.length)
  const seen = new Uint8Array(mask.length)
  const stack = new Int32Array(mask.length)
  const region = new Int32Array(mask.length)
  for (let start = 0; start < mask.length; start++) {
    if (seen[start] || !mask[start]) continue
    let top = 0
    let size = 0
    stack[top++] = start
    seen[start] = 1
    while (top > 0) {
      const at = stack[--top]
      region[size++] = at
      const x = at % width
      const y = (at - x) / width
      const neighbours = [x > 0 ? at - 1 : -1, x < width - 1 ? at + 1 : -1, y > 0 ? at - width : -1, y < height - 1 ? at + width : -1]
      for (const next of neighbours) {
        if (next < 0 || seen[next] || !mask[next]) continue
        seen[next] = 1
        stack[top++] = next
      }
    }
    if (size >= minRegion) for (let i = 0; i < size; i++) out[region[i]] = mask[region[i]]
  }
  return out
}

/** Paint a picture's alpha from a mask, leaving its colour alone. */
export function applyMask(pic, mask) {
  const out = clonePicture(pic)
  for (let p = 0; p < mask.length; p++) out.data[p * 4 + 3] = Math.min(out.data[p * 4 + 3], mask[p])
  return out
}

// ───────────────────────────────────────────────────────────── the compositor ──

/** Copy a picture onto a fresh transparent canvas at `(left, top)`, clipping whatever falls outside. */
export function placeOnCanvas(pic, width, height, left, top) {
  const out = blankPicture(width, height)
  for (let y = 0; y < pic.height; y++) {
    const dy = y + top
    if (dy < 0 || dy >= height) continue
    for (let x = 0; x < pic.width; x++) {
      const dx = x + left
      if (dx < 0 || dx >= width) continue
      out.data.set(pic.data.subarray((y * pic.width + x) * 4, (y * pic.width + x) * 4 + 4), (dy * width + dx) * 4)
    }
  }
  return out
}

/** Straight alpha-over of `src` onto `dst`, in place. Both must be the same size. */
export function overPicture(dst, src) {
  for (let i = 0; i < dst.data.length; i += 4) {
    const sa = src.data[i + 3] / 255
    if (sa === 0) continue
    const da = dst.data[i + 3] / 255
    const out = sa + da * (1 - sa)
    for (let c = 0; c < 3; c++) {
      dst.data[i + c] = Math.round((src.data[i + c] * sa + dst.data[i + c] * da * (1 - sa)) / out)
    }
    dst.data[i + 3] = Math.round(out * 255)
  }
  return dst
}

/**
 * Cut a rectangle out of a picture.
 *
 * `x`/`y` must be non-negative: the row copy below already clips `sy >= pic.height` at the bottom and
 * folds a negative `x` into its source offset via `Math.max(0, x)`, but never shifts the *destination*
 * to match — so a negative `x` silently pastes the crop's right-hand columns into its left-hand ones
 * instead of refusing, and a negative `y` silently pastes row 0 into every row up to `-y`. Both are a
 * caller bug (every caller in this pipeline crops with fixed, non-negative constants), and refusing it
 * beats shipping a misplaced picture that only shows up by eye, later, in the contact sheet.
 */
export function cropPicture(pic, x, y, width, height) {
  if (x < 0 || y < 0) throw new Error(`cropPicture: x and y must be non-negative, got (${x}, ${y})`)
  const out = blankPicture(width, height)
  for (let row = 0; row < height; row++) {
    const sy = y + row
    if (sy < 0 || sy >= pic.height) continue
    const from = (sy * pic.width + Math.max(0, x)) * 4
    const count = Math.min(width, pic.width - Math.max(0, x)) * 4
    out.data.set(pic.data.subarray(from, from + count), row * width * 4)
  }
  return out
}
