/**
 * A v4 hairstyle's two layers (Plan 19, spec §5.4): the region of hair a picture adds to the bald body, cut into a
 * **front** layer (L60, drawn over the face) and a **back** layer (L20, drawn behind the body).
 *
 * The spec draws the line by the body's own head and shoulders: the fringe, the locks before the ears and the crown
 * are in front; long hair behind the shoulders and the back of the hair standing out of the head shape are behind.
 * `splitHair` turns that into three regions of the body picture, any of which puts a hair pixel in front:
 *
 * - **the head, grown** — the body's ink on every row above its chin plus `shoulderMargin`, grown by `reach`: hair
 *   lying on the skull, the face and the neck, and a little rim round them;
 * - **the crown band** — every row above `crownBand` of the way from the head top to the chin, across the grown
 *   head's whole width: the top of the hair, which is in front however far it stands out of the skull;
 * - **the body's own ink**, on any row (pre-flight #17) — hair lying over the body is drawn over it, so a lock or a
 *   braid resting on a shoulder stays in front of the outfit instead of vanishing under it. Long hair behind the
 *   back shows only outside the silhouette, so it is never on the body's ink and stays behind.
 *
 * Everything else in the region is the back. A hand-drawn front mask (`assets/avatar-src/masks/
 * item_hair_<code>_frontmask.png`) replaces the rule outright, for the hairstyle the rule gets wrong.
 *
 * C13 (`checks.mjs`) holds the two layers written from a split to it: no shared pixel, the region kept whole, the
 * front off the eyes — with `HAIR_COVERAGE` and `HAIR_EYE_LIMIT` below.
 */
import { measure } from './extract.mjs'
import { ALPHA_INK, dilateMask } from './png.mjs'

/**
 * The split's three numbers, in frame units (× the density at which a picture is split): how far the head is grown
 * (`reach`), how far down the head the crown band runs as a share of the head top → chin height (`crownBand`), and
 * how far below the chin the head's rows reach, which takes in the neck and not the shoulders (`shoulderMargin`).
 */
export const HAIR_SPLIT = { reach: 6, crownBand: 0.35, shoulderMargin: 8 }
/** C13: the two layers together hold at least this share of the hair region the split was made from. */
export const HAIR_COVERAGE = 0.99
/** C13: the front layer covers at most this share of the gender's neutral eye mask. */
export const HAIR_EYE_LIMIT = 0.01

/** Where a mask says yes: at least half covered, as every mask count in the pipeline is. */
const HALF = 128

/**
 * Cut a hair region into its front and back layers (spec §5.4).
 *
 * `region` is the hair the picture adds to the body — a mask (`Uint8Array`, 0–255, one byte a pixel) at the body
 * picture's own size, as `diffAgainstBase` returns it. `bodyPic` is the bald body L30 at `density` (2 for every
 * ingest). `override`, when given, is a hand-drawn front mask at the same size — read as `masks.mjs` reads a
 * hand-drawn mask, its alpha or, without alpha, its luminance — and then `front = region ∧ override ≥ 128` with no
 * rule consulted at all.
 *
 * Every hair pixel goes to exactly one of the two, with its own coverage: `front[p] + back[p] === region[p]`.
 *
 * @param {Uint8Array} region
 * @param {{ data: Buffer, width: number, height: number }} bodyPic
 * @param {{ density?: number, override?: Uint8Array | null }} [options]
 * @returns {{ front: Uint8Array, back: Uint8Array }}
 */
export function splitHair(region, bodyPic, { density = 2, override = null } = {}) {
  const { width, height } = bodyPic
  const n = width * height
  if (region?.length !== n) throw new Error(`the hair region holds ${region?.length ?? 'no'} pixels, the body is ${width} × ${height}`)
  if (override && override.length !== n) throw new Error(`the front-mask override holds ${override.length} pixels, the body is ${width} × ${height}`)
  const zone = override ? null : frontZone(bodyPic, density)
  const front = new Uint8Array(n)
  const back = new Uint8Array(n)
  for (let p = 0; p < n; p++) {
    if (!region[p]) continue
    if (override ? override[p] >= HALF : zone[p]) front[p] = region[p]
    else back[p] = region[p]
  }
  return { front, back }
}

/**
 * The pixels of the frame where hair is in front of the body: the head grown, the crown band and the body's ink
 * (see the file's head). The head top and the chin are `measure`'s, the rows `ingest --dry-run` reports.
 *
 * @param {{ data: Buffer, width: number, height: number }} bodyPic
 * @param {number} density
 * @returns {Uint8Array} 1 in front, 0 behind
 */
function frontZone(bodyPic, density) {
  const { data, width, height } = bodyPic
  const n = width * height
  const { top, chin } = measure(bodyPic)
  const inked = (p) => data[p * 4 + 3] > ALPHA_INK

  // The head: every pixel of the body's ink on the rows above the chin plus the margin — the skull, the face, the neck.
  const headRows = Math.min(height, Math.round(chin + HAIR_SPLIT.shoulderMargin * density))
  const head = new Uint8Array(n)
  for (let p = 0; p < headRows * width; p++) if (inked(p)) head[p] = 255
  const grown = dilateMask(head, width, height, Math.round(HAIR_SPLIT.reach * density))

  // The crown band runs across the grown head's whole width, so the top of a full style is in front where it stands
  // out past the skull.
  let left = width
  let right = -1
  for (let p = 0; p < n; p++) {
    if (!grown[p]) continue
    const x = p % width
    if (x < left) left = x
    if (x > right) right = x
  }
  const crownBottom = top + HAIR_SPLIT.crownBand * (chin - top)

  const zone = new Uint8Array(n)
  for (let y = 0; y < height; y++) {
    const inBand = y < crownBottom
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      if (grown[p] || (inBand && x >= left && x <= right) || inked(p)) zone[p] = 1
    }
  }
  return zone
}
