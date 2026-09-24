/**
 * Hair, eye and tint masks (Plan 13 Task 2, spec §4.1): `masks.mjs`, ported from the throwaway spike that
 * first proved hair and iris could be told apart from a flat AI base.
 *
 * Every picture here is synthetic, built with `renderSvg` on the frame's own @2x canvas (768 × 896) — a
 * flat head (skin circle, a hair cap plus two side locks, two eyes) or a flat item (two adjoining colour
 * blocks) — so a failure means the arithmetic is wrong, not that a real base changed.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { runChecks } from '../scripts/avatar-pipeline/checks.mjs'
import { eyeEllipses, eyeMask, hairMask, maskTargets, tintMask, writeMasks } from '../scripts/avatar-pipeline/masks.mjs'
import { readPicture, renderSvg, resizePicture, writePicture } from '../scripts/avatar-pipeline/png.mjs'
import { buildTintSheet } from '../scripts/avatar-pipeline/tint-sheet.mjs'

// Every case renders a synthetic 768 × 896 picture and runs the real mask algorithm on it — a few seconds
// each once k-means and the morphology are counted, and past vitest's 5 s default when the suite shares
// the CPU. The budget is the work, not a hang (avatar-registry-verify.test.ts sets the same ceiling).
vi.setConfig({ testTimeout: 60_000 })

const W = 768
const H = 896

const SKIN = '#e0ac81'
const HAIR = '#3a2418'
const WHITE = '#ffffff'
const IRIS = '#2f7fd6'
const PUPIL = '#101010'
const TANK = '#f4f4f4'
/** A bluish-black hair, for the round 3 shine-band case — f02's own real hair palette is bluish (b ≈ −18
 * in Lab), which a fixed chroma ceiling on the shine-pocket rule could never tell from "a different
 * colour" for a warm `HAIR` base. Lab ≈ (11, 5, −12), chroma ≈ 13. */
const HAIR_BLUE = '#1c1c2e'
/** The shine band itself: Lab ≈ (46, 6, −14), chroma ≈ 15 — past the old chroma < 12 ceiling, and its Lab
 * distance to `HAIR_BLUE` (≈ 35) is well past `HAIR_T` (14), so it is not hair-palette candidate on its
 * own; only the shine-pocket rule can bring it in. */
const SHINE_BAND = '#6b6b85'

/** The two eyes' centres in the synthetic base's own coordinates — shared with `irisRingPixels` below. */
const EYE_CENTRES: [number, number][] = [[320, 350], [448, 350]]
const IRIS_R = 24
const PUPIL_R = 9

/**
 * A flat chibi head and torso: a skin circle with a hair cap over its top 35 % and two side locks running
 * down to y 520, two eyes (white + iris + pupil, or — `closedEyes` — a bare 4 px lash line with none of
 * that), a skin body and a white tank top. `irisColour` is IRIS by default; Task 2b's own tests reuse this
 * with the iris set to the hair or the skin colour, to prove the eye mask no longer depends on the iris
 * being a colour nothing else on the head has.
 *
 * The cap fraction is 35 %, not the original 45 %: at 45 % the bangs ran down to y 315, 5 px *into* the
 * white of the eye (which starts at y 310) — no forehead between them at all. That was harmless for the
 * old "not-hair, not-skin" blob, but Task 2b's ellipse is anchored on the white and padded 15 % outward,
 * so with no gap to pad into it grew straight into the bangs and read a chunk of the hair cap as eye. A
 * real base has a forehead; this fixture now does too — but not so much of one that the cap (down to y
 * 285) stops overlapping the side locks (from y 280): the two are meant to be one hair mass, and cutting
 * them fully apart left the locks disconnected from the seed patch and unclassified.
 *
 * `outerWhiteOnly` (Task 2b round 2) hides the inner 60 % of one side's white ellipse behind a skin-
 * coloured rect, leaving the sclera visible only on that eye's outer edge — the real-base shape the round
 * 2 ruling's mirroring exists for — while the other side keeps its ordinary full white ellipse, standing
 * in for the "mirror eye" the ruling borrows a box from.
 *
 * `capFraction` (Task 2b review) overrides the 35 % default: at the *original* 45 % (bangs to y 315, 5 px
 * into the white at y 310 — the geometry that motivated `eyeMask`'s `hairlike` leak in the first place)
 * the largest-group trim alone already discards the small leak that reaches the ellipse, so a regression
 * test for the `hairlike` leak specifically needs a heavier fringe: 60 % (bangs to y 360, past the eyes'
 * own centre line) grows the leaked-in patch past the iris's own size, which — without the `hairlike`
 * leak — the trim then keeps *instead of* the iris, exactly the failure the guard exists to prevent.
 *
 * `filament` (Task 2b review) draws a small hair-coloured blob — a brow tip — near the top of one eye's
 * padded ellipse: inside it, but with a gap to both the hair cap/locks (so the `hairlike` leak's flood
 * never reaches it — it is not connected to the rest of the hair at all) and the iris (so it is not just
 * part of the iris rendering). This is what the largest-group trim exists to drop.
 *
 * `hairColour` (Task 2b round 3) overrides the hair everywhere it is drawn (cap, locks, filament, lash
 * ring) — the round's own `shineBand` case needs a bluish-black hair to match the real base it is modelled
 * on, and a fixed `HAIR` would make that band's chroma indistinguishable from the hair around it.
 *
 * `lashRing` (Task 2b round 3) draws a hair-coloured ellipse well outside one eye's own white — overlapping
 * the cap so it is genuinely part of the same hair mass, not just near it — leaving the white (and
 * whatever iris colour sits inside it) as a hole *enclosed by hair on every side*, the shape a thick ring
 * of lashes and liner makes around a real eye. This is the shape that used to read as a hair "shine
 * pocket": the eye white and the enclosed iris/pupil disc together, however large, sat inside a component
 * fully surrounded by hair and under the old 8000 px cap.
 *
 * `shineBand` (Task 2b round 3) draws a small patch — chroma ≈ 15, well within the cap, clear of the
 * `hairPal` sampling patch just under the head top (y 186–250 at this scale — a band placed inside *that*
 * becomes one of the k-means centroids that *define* the hair colour, testing nothing) and nowhere near
 * either eye — of a colour distinct enough from `hairColour` that candidate/seed growth never reaches it
 * on its own; only the shine-pocket rule can bring it in.
 */
async function syntheticBase({
  closedEyes = false,
  irisColour = IRIS,
  outerWhiteOnly = null as 'L' | 'R' | null,
  capFraction = 0.35,
  filament = null as 'L' | 'R' | null,
  hairColour = HAIR,
  lashRing = null as 'L' | 'R' | null,
  shineBand = false,
} = {}) {
  const cx = 384
  const cy = 330
  const r = 150
  const capBottom = cy - r + capFraction * (2 * r)
  const filamentShape = filament
    ? (() => {
        const [ex] = EYE_CENTRES[filament === 'L' ? 0 : 1]!
        const fx = filament === 'L' ? ex - 15 : ex + 15
        return `<ellipse cx="${fx}" cy="304" rx="9" ry="3" fill="${hairColour}"/>`
      })()
    : ''
  const lashRingShape = lashRing
    ? (() => {
        const [ex, ey] = EYE_CENTRES[lashRing === 'L' ? 0 : 1]!
        return `<ellipse cx="${ex}" cy="${ey}" rx="50" ry="70" fill="${hairColour}"/>`
      })()
    : ''
  // y 270, not the more central y 220 first tried: `hairPal` is itself sampled from a patch just under
  // the head top (y 186–250 at this scale), and a band placed inside that patch becomes one of the four
  // k-means centroids that *define* the hair colour — trivially "hair" by construction, testing nothing.
  const shineBandShape = shineBand ? `<ellipse cx="${cx}" cy="270" rx="30" ry="14" fill="${SHINE_BAND}"/>` : ''
  const eyes = closedEyes
    ? `<path d="M296 350 Q320 358 344 350" stroke="${PUPIL}" stroke-width="4" fill="none" stroke-linecap="round"/>` +
      `<path d="M424 350 Q448 358 472 350" stroke="${PUPIL}" stroke-width="4" fill="none" stroke-linecap="round"/>`
    : EYE_CENTRES.map(([ex, ey], i) => {
        const side = i === 0 ? 'L' : 'R'
        const rx = 34
        const ry = 40
        const hideFrac = 0.6
        const innerW = 2 * rx * hideFrac
        const hide =
          side === outerWhiteOnly
            ? `<rect x="${side === 'L' ? ex + rx - innerW : ex - rx}" y="${ey - ry}" width="${innerW}" height="${2 * ry}" fill="${SKIN}"/>`
            : ''
        return `<ellipse cx="${ex}" cy="${ey}" rx="${rx}" ry="${ry}" fill="${WHITE}"/>${hide}` +
          `<circle cx="${ex}" cy="${ey}" r="${IRIS_R}" fill="${irisColour}"/><circle cx="${ex}" cy="${ey}" r="${PUPIL_R}" fill="${PUPIL}"/>`
      }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${SKIN}"/>
    <clipPath id="cap"><rect x="${cx - r - 20}" y="${cy - r}" width="${2 * r + 40}" height="${capBottom - (cy - r)}"/></clipPath>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${hairColour}" clip-path="url(#cap)"/>
    <rect x="300" y="480" width="168" height="320" fill="${SKIN}"/>
    <rect x="300" y="480" width="168" height="120" fill="${TANK}"/>
    <rect x="234" y="280" width="40" height="240" rx="20" fill="${hairColour}"/>
    <rect x="494" y="280" width="40" height="240" rx="20" fill="${hairColour}"/>
    ${filamentShape}
    ${shineBandShape}
    ${lashRingShape}
    ${eyes}
  </svg>`
  return renderSvg(svg, W, H)
}

/** Two adjoining colour blocks, an outlined red rect and a plain blue one, on the frame's @2x canvas. */
async function syntheticItem() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect x="197" y="297" width="206" height="206" fill="#401010"/>
    <rect x="200" y="300" width="200" height="200" fill="#c0392b"/>
    <rect x="400" y="300" width="160" height="200" fill="#2c3e70"/>
  </svg>`
  return renderSvg(svg, W, H)
}

// ─────────────────────────────────────────────────────────── pixel-set helpers ──

type Picture = { data: Buffer; width: number; height: number }
type MaskEntry = { bytes2x: number; meanL: number; empty?: boolean; override?: boolean }
type ManifestEntry = { real?: boolean; empty?: boolean; tintSeed?: { x: number; y: number }; masks?: Record<string, MaskEntry> }
type Manifest = { files: Record<string, ManifestEntry> }

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Every solid pixel within a small tolerance of `hex` — the shapes a test SVG drew, not their soft rim. */
function colourPixels(pic: Picture, hex: string, tolerance = 20): Uint8Array {
  const [r, g, b] = hexToRgb(hex)
  const out = new Uint8Array(pic.width * pic.height)
  for (let i = 0; i < out.length; i++) {
    const o = i * 4
    if (pic.data[o + 3]! <= 200) continue
    const d = Math.hypot(pic.data[o]! - r, pic.data[o + 1]! - g, pic.data[o + 2]! - b)
    if (d <= tolerance) out[i] = 1
  }
  return out
}

const capPixels = (pic: Picture) => colourPixels(pic, HAIR)
const skinPixels = (pic: Picture) => colourPixels(pic, SKIN)
const irisPixels = (pic: Picture) => colourPixels(pic, IRIS)

/**
 * The iris ring by geometry, not by colour: `EYE_CENTRES` at `IRIS_R`, minus the `PUPIL_R` hole in the
 * middle. Task 2b's hair/skin-coloured-iris tests reuse the iris colour for something else already drawn
 * on the head (the hair, the skin), so `colourPixels` can no longer tell the iris apart from that — this
 * finds it from the SVG's own geometry instead, independent of what colour it was drawn.
 */
function irisRingPixels(pic: Picture, centres: [number, number][] = EYE_CENTRES): Uint8Array {
  const out = new Uint8Array(pic.width * pic.height)
  for (let y = 0; y < pic.height; y++) {
    for (let x = 0; x < pic.width; x++) {
      for (const [ex, ey] of centres) {
        const d = Math.hypot(x - ex, y - ey)
        if (d <= IRIS_R && d > PUPIL_R) { out[y * pic.width + x] = 1; break }
      }
    }
  }
  return out
}

/** The `filament` brow-tip ellipse by geometry (Task 2b review), matching `syntheticBase`'s own shape —
 * `colourPixels(pic, HAIR)` alone cannot isolate it from the hair cap and locks, which are the same colour. */
function filamentPixels(pic: Picture, side: 'L' | 'R'): Uint8Array {
  const out = new Uint8Array(pic.width * pic.height)
  const [ex] = EYE_CENTRES[side === 'L' ? 0 : 1]!
  const fx = side === 'L' ? ex - 15 : ex + 15
  const fy = 304
  const rx = 9
  const ry = 3
  for (let y = 0; y < pic.height; y++) {
    for (let x = 0; x < pic.width; x++) {
      const dx = (x - fx) / rx
      const dy = (y - fy) / ry
      if (dx * dx + dy * dy <= 1) out[y * pic.width + x] = 1
    }
  }
  return out
}

/** The full white-ellipse disc by geometry (Task 2b round 3) — `EYE_CENTRES` at rx 34, ry 40, the same
 * shape `syntheticBase` draws the eye white as. Covers the iris/pupil disc it encloses too: none of that
 * should be hair either, whatever colour `lashRing`'s test draws it in. */
function eyeWhiteDiscPixels(pic: Picture, side: 'L' | 'R'): Uint8Array {
  const out = new Uint8Array(pic.width * pic.height)
  const [ex, ey] = EYE_CENTRES[side === 'L' ? 0 : 1]!
  const rx = 34
  const ry = 40
  for (let y = 0; y < pic.height; y++) {
    for (let x = 0; x < pic.width; x++) {
      const dx = (x - ex) / rx
      const dy = (y - ey) / ry
      if (dx * dx + dy * dy <= 1) out[y * pic.width + x] = 1
    }
  }
  return out
}

/** The `shineBand` patch by geometry (Task 2b round 3), matching `syntheticBase`'s own shape. */
function shineBandPixels(pic: Picture): Uint8Array {
  const out = new Uint8Array(pic.width * pic.height)
  const cx = 384
  const cy = 270
  const rx = 30
  const ry = 14
  for (let y = 0; y < pic.height; y++) {
    for (let x = 0; x < pic.width; x++) {
      const dx = (x - cx) / rx
      const dy = (y - cy) / ry
      if (dx * dx + dy * dy <= 1) out[y * pic.width + x] = 1
    }
  }
  return out
}

/** The share of `pixelSet` that `mask` (≥ 128) also covers. `NaN`-safe: an empty set counts as full coverage. */
function coverage(mask: Uint8Array, pixelSet: Uint8Array): number {
  let inSet = 0
  let both = 0
  for (let i = 0; i < mask.length; i++) {
    if (!pixelSet[i]) continue
    inSet++
    if (mask[i]! >= 128) both++
  }
  return inSet === 0 ? 1 : both / inSet
}

function sum(mask: Uint8Array): number {
  let total = 0
  for (const v of mask) total += v > 0 ? 1 : 0
  return total
}

/** 4-connected components of `mask` (≥ 128) of at least 20 px, split left/right of the picture's centre column. */
function blobsPerSide(mask: Uint8Array, width = W): [number, number] {
  const height = mask.length / width
  const seen = new Uint8Array(mask.length)
  const counts: [number, number] = [0, 0]
  for (let start = 0; start < mask.length; start++) {
    if (seen[start] || mask[start]! < 128) continue
    const stack = [start]
    seen[start] = 1
    let size = 0
    let side = -1
    while (stack.length) {
      const p = stack.pop()!
      size++
      const x = p % width
      const y = (p - x) / width
      if (side < 0) side = x < width / 2 ? 0 : 1
      const neighbours = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1]
      for (const q of neighbours) {
        if (q < 0 || seen[q] || mask[q]! < 128) continue
        seen[q] = 1
        stack.push(q)
      }
    }
    if (size >= 20) counts[side]!++
  }
  return counts
}

// ──────────────────────────────────────────────────────────────────── tests ──

describe('hairMask / eyeMask (synthetic base)', () => {
  it('cuts the hair cap and locks, not the face', async () => {
    const pic = await syntheticBase()
    const hair = hairMask(pic, { neverVisible: null })
    expect(coverage(hair, capPixels(pic))).toBeGreaterThan(0.9)
    expect(coverage(hair, skinPixels(pic))).toBeLessThan(0.02)
  })

  it('finds one iris per side and takes it out of the hair', async () => {
    const pic = await syntheticBase()
    const hair = hairMask(pic, { neverVisible: null })
    const eyes = eyeMask(pic, hair)
    expect(coverage(eyes, irisPixels(pic))).toBeGreaterThan(0.8)
    expect(blobsPerSide(eyes)).toEqual([1, 1])
    expect(coverage(hair, irisPixels(pic))).toBe(0)
  })

  it('answers an empty eye mask for closed eyes (lash lines only)', async () => {
    const pic = await syntheticBase({ closedEyes: true })
    const hair = hairMask(pic, { neverVisible: null })
    expect(sum(eyeMask(pic, hair))).toBe(0)
  })

  // Task 2b (spec §4.1 ruling): the real bases showed the spike's "not-hair, not-skin" blob swallowing a
  // dark or skin-coloured iris into the hair mask, because the region it searched already excluded
  // whatever `hairMask` had claimed. The sclera-anchored ellipse below does not have that dependency —
  // it finds the eye from the white around the iris, so the iris's own colour cannot hide it any more.

  it('keeps an iris the same colour as the hair in the eye mask, and out of the hair mask', async () => {
    const pic = await syntheticBase({ irisColour: HAIR })
    const hair = hairMask(pic, { neverVisible: null })
    const eyes = eyeMask(pic, hair)
    const ring = irisRingPixels(pic)
    expect(coverage(eyes, ring)).toBeGreaterThan(0.8)
    expect(coverage(hair, ring)).toBe(0)
  })

  it('keeps an iris the same colour as the skin, enclosed by the white of the eye, in the eye mask', async () => {
    const pic = await syntheticBase({ irisColour: SKIN })
    const hair = hairMask(pic, { neverVisible: null })
    const eyes = eyeMask(pic, hair)
    const ring = irisRingPixels(pic)
    expect(coverage(eyes, ring)).toBeGreaterThan(0.8)
  })

  // Task 2b round 2 (spec §4.1 ruling): the real bases showed the box built from one side's own whites
  // missing the inner half of that eye, because the sclera there shows mostly on the iris's outer side —
  // asymmetric per eye, so no single-side fix can catch it. With whites on both sides, each side's box is
  // unioned with the *mirror* of the other side's box about the face's own eye axis; a side whose own box
  // is thin borrows the fuller shape of the other eye, reflected into place.
  it('covers both irises when one eye shows white only on its outer side, paired with a normal eye', async () => {
    const pic = await syntheticBase({ outerWhiteOnly: 'L' })
    const hair = hairMask(pic, { neverVisible: null })
    const eyes = eyeMask(pic, hair)
    const [leftCentre, rightCentre] = EYE_CENTRES
    expect(coverage(eyes, irisRingPixels(pic, [leftCentre!]))).toBeGreaterThanOrEqual(0.8)
    expect(coverage(eyes, irisRingPixels(pic, [rightCentre!]))).toBeGreaterThanOrEqual(0.8)
  })

  // Task 2b review: `eyeMask`'s `hairlike` leak/closing and its largest-group trim each exist only
  // because of a real-art failure (f02's bangs, a stray brow/filament) that no synthetic case exercised —
  // both were verified by a one-off `masks`/`check` run against art that is not in CI. These two cover
  // them directly, each confirmed to fail with its guard disabled and pass with it restored (see the round
  // 3 fix report for the disable/re-enable output).

  it('keeps a hair cap that overlaps the padded ellipse out of the eye mask, iris still covered (hairlike leak)', async () => {
    // capFraction 0.6 (see syntheticBase's own doc comment): a heavy fringe reaching past the eyes' own
    // centre line, so the leaked-in patch grows past the iris's own size — without the `hairlike` leak,
    // the largest-group trim then keeps the hair patch *instead of* the iris.
    const pic = await syntheticBase({ capFraction: 0.6 })
    const hair = hairMask(pic, { neverVisible: null })
    const eyes = eyeMask(pic, hair)
    expect(coverage(eyes, capPixels(pic))).toBe(0)
    expect(coverage(eyes, irisPixels(pic))).toBeGreaterThan(0.8)
  })

  it('drops a hair-coloured filament fully inside the padded ellipse, separate from the iris (largest-group trim)', async () => {
    const pic = await syntheticBase({ filament: 'L' })
    const hair = hairMask(pic, { neverVisible: null })
    const eyes = eyeMask(pic, hair)
    expect(coverage(eyes, filamentPixels(pic, 'L'))).toBe(0)
    expect(coverage(eyes, irisRingPixels(pic, [EYE_CENTRES[0]!]))).toBeGreaterThan(0.8)
  })

  // Task 2b round 3 (spec §4.1 ruling): the real tint sheet showed `hairMask` itself going wrong in both
  // directions on the shine-pocket rule — an eye white enclosed by hair-coloured lashes read as a "shine
  // pocket" (m03), and a bluish-grey shine band on bluish hair did not (f02, m02), because the rule's own
  // chroma < 12 ceiling can only ever describe *one* hair's shine. Both are now judged by whether the
  // pocket touches an eye's own ellipse (`eyeEllipses`, factored out of `eyeMask` this round) rather than
  // by colour.

  it('keeps an eye white enclosed by hair-coloured lashes out of the hair mask', async () => {
    const pic = await syntheticBase({ lashRing: 'L' })
    const hair = hairMask(pic, { neverVisible: null })
    // < 2 %, not exactly 0: the same antialiasing tolerance the very first case in this file gives
    // `skinPixels` — a soft edge between the white and the ring round it, a pixel or two wide.
    expect(coverage(hair, eyeWhiteDiscPixels(pic, 'L'))).toBeLessThan(0.02)
  })

  it('puts a bluish-grey shine band (chroma ≈ 15) enclosed by bluish-black hair in the hair mask', async () => {
    const pic = await syntheticBase({ hairColour: HAIR_BLUE, shineBand: true })
    const hair = hairMask(pic, { neverVisible: null })
    expect(coverage(hair, shineBandPixels(pic))).toBeGreaterThan(0.9)
  })

  it('keeps a bang that connects into an eye\'s own ellipse from outside as hair', async () => {
    // capFraction 0.6, the same heavy fringe the `hairlike` leak test uses: it genuinely reaches down
    // across the left eye's own padded ellipse, connected the whole way back to the cap.
    const pic = await syntheticBase({ capFraction: 0.6 })
    const hair = hairMask(pic, { neverVisible: null })
    const { mask: ellipseMask } = eyeEllipses(pic)
    const cap = capPixels(pic)
    let insideEllipse = 0
    let keptHair = 0
    for (let i = 0; i < cap.length; i++) {
      if (!cap[i] || !ellipseMask[i]) continue
      insideEllipse++
      if (hair[i]! >= 128) keptHair++
    }
    expect(insideEllipse, 'the fixture should actually put some cap colour inside an eye ellipse').toBeGreaterThan(0)
    expect(keptHair / insideEllipse).toBeGreaterThan(0.8)
  })
})

describe('tintMask (synthetic item)', () => {
  it('cuts the seeded colour region of an item and nothing else', async () => {
    const pic = await syntheticItem()
    // (150, 200) at 1x is (300, 400) at this @2x picture — inside the red rect, clear of its outline.
    const tint = tintMask(pic, { x: 150, y: 200 })
    expect(coverage(tint, colourPixels(pic, '#c0392b'))).toBeGreaterThan(0.95)
    expect(coverage(tint, colourPixels(pic, '#2c3e70'))).toBe(0)
  })
})

describe('writeMasks', () => {
  let temp = ''
  let dir = ''
  let overridesDir = ''

  beforeAll(() => {
    temp = mkdtempSync(join(tmpdir(), 'avatar-masks-'))
    dir = join(temp, 'out')
    overridesDir = join(temp, 'overrides')
    mkdirSync(dir, { recursive: true })
    mkdirSync(overridesDir, { recursive: true })
  })
  afterAll(() => rmSync(temp, { recursive: true, force: true }))

  it('lets a hand-drawn override win and marks it', async () => {
    const name = 'base_f01_face_neutral_L50'
    await writePicture(await syntheticBase(), join(dir, `${name}@2x.png`))
    const manifest = { files: { [name]: { real: true } } } as Manifest

    const overridePic = { data: Buffer.alloc(W * H * 4), width: W, height: H }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        const inside = x >= 300 && x < 400 && y >= 300 && y < 400
        overridePic.data[i * 4] = 255
        overridePic.data[i * 4 + 1] = 255
        overridePic.data[i * 4 + 2] = 255
        overridePic.data[i * 4 + 3] = inside ? 255 : 0
      }
    }
    await writePicture(overridePic, join(overridesDir, `${name}_eyemask.png`))

    await writeMasks({ dir, manifest, names: [name], overridesDir })

    expect(manifest.files[name]!.masks!.eyes!.override).toBe(true)
    const written = await readPicture(join(dir, `${name}_eyemask@2x.png`))
    for (let i = 3; i < written.data.length; i += 4) expect(written.data[i]).toBe(overridePic.data[i])
  })

  it('writes both densities and records meanL for every mask it writes', async () => {
    const name = 'base_f02_L30'
    await writePicture(await syntheticBase(), join(dir, `${name}@2x.png`))
    const manifest = { files: { [name]: { real: true } } } as Manifest

    await writeMasks({ dir, manifest, names: [name], overridesDir })

    expect(existsSync(join(dir, `${name}_hairmask@1x.png`))).toBe(true)
    expect(existsSync(join(dir, `${name}_hairmask@2x.png`))).toBe(true)
    const at1x = await readPicture(join(dir, `${name}_hairmask@1x.png`))
    const at2x = await readPicture(join(dir, `${name}_hairmask@2x.png`))
    expect([at1x.width, at1x.height]).toEqual([384, 448])
    expect([at2x.width, at2x.height]).toEqual([768, 896])
    const hair = manifest.files[name]!.masks!.hair!
    expect(hair.meanL).toBeGreaterThan(0)
    expect(hair.meanL).toBeLessThan(1)
    expect(hair.bytes2x).toBeGreaterThan(0)
  })
})

describe('maskTargets', () => {
  it('picks real, non-empty base layers, every base face, and tintable items', () => {
    const manifest = {
      files: {
        base_f01_L30: { real: true, layer: 30 },
        base_f01_L60: { real: true, layer: 60, empty: true },
        base_f01_face_neutral_L50: { real: true, layer: 50 },
        base_f01_face_happy_L50: { real: true, layer: 50 },
        item_outfit_casual01_L40: { real: true, layer: 40 },
        item_outfit_dealer01_L40: { real: true, layer: 40, tintSeed: { x: 10, y: 10 } },
        item_head_tophat01_L80: { placeholder: true, layer: 80 },
      },
    }
    const targets = maskTargets(manifest)
    expect(targets).toContain('base_f01_L30')
    expect(targets).not.toContain('base_f01_L60') // empty
    expect(targets).toContain('base_f01_face_neutral_L50')
    expect(targets).toContain('base_f01_face_happy_L50')
    expect(targets).not.toContain('item_outfit_casual01_L40') // no tintSeed
    expect(targets).toContain('item_outfit_dealer01_L40')
    expect(targets).not.toContain('item_head_tophat01_L80') // placeholder, not real
  })
})

// ─────────────────────────────────────────────────────────────────── C11 ──

describe('C11 (checks.mjs, spec §4.3)', () => {
  let temp = ''
  let dir = ''
  let overridesDir = ''

  beforeAll(() => {
    temp = mkdtempSync(join(tmpdir(), 'avatar-c11-'))
    dir = join(temp, 'out')
    overridesDir = join(temp, 'overrides')
    mkdirSync(dir, { recursive: true })
    mkdirSync(overridesDir, { recursive: true })
  })
  afterAll(() => rmSync(temp, { recursive: true, force: true }))

  /** A picture that is opaque everywhere, one flat colour — so any mask cut from it stays inside its ink
   * however big it is drawn, which is what lets the area-rule tests control the percentage directly. */
  function solidPicture(): Picture {
    const data = Buffer.alloc(W * H * 4)
    for (let i = 0; i < W * H; i++) {
      const o = i * 4
      data[o] = 200; data[o + 1] = 160; data[o + 2] = 120; data[o + 3] = 255
    }
    return { data, width: W, height: H }
  }

  async function c11Of(manifest: Manifest, name: string) {
    const [row] = await runChecks({ dir, manifest, names: [name] })
    return row!.results.find((r) => r.id === 'C11')!
  }

  it('is ok when the masks are untouched', async () => {
    const name = 'base_fc1_face_neutral_L50'
    await writePicture(await syntheticBase(), join(dir, `${name}@2x.png`))
    const manifest: Manifest = { files: { [name]: { real: true } } }
    await writeMasks({ dir, manifest, names: [name], overridesDir })

    const c11 = await c11Of(manifest, name)
    expect(c11.ok).toBe(true)
  })

  it('fails when a mask covers a pixel the layer leaves transparent', async () => {
    const name = 'base_fc2_face_neutral_L50'
    await writePicture(await syntheticBase(), join(dir, `${name}@2x.png`))
    const manifest: Manifest = { files: { [name]: { real: true } } }
    await writeMasks({ dir, manifest, names: [name], overridesDir })

    // (4, 4) is the canvas corner — nothing is drawn there in the synthetic base.
    const maskFile = join(dir, `${name}_hairmask@2x.png`)
    const mask = await readPicture(maskFile)
    const i = (4 * mask.width + 4) * 4
    mask.data[i] = 255; mask.data[i + 1] = 255; mask.data[i + 2] = 255; mask.data[i + 3] = 255
    await writePicture(mask, maskFile)

    const c11 = await c11Of(manifest, name)
    expect(c11.ok).toBe(false)
    expect(c11.detail).toContain('mask outside the layer')
  })

  it('fails a neutral face whose eye mask has one blob', async () => {
    const name = 'base_fc3_face_neutral_L50'
    await writePicture(await syntheticBase(), join(dir, `${name}@2x.png`))
    const manifest: Manifest = { files: { [name]: { real: true } } }
    await writeMasks({ dir, manifest, names: [name], overridesDir })

    const maskFile = join(dir, `${name}_eyemask@2x.png`)
    const mask = await readPicture(maskFile)
    for (let y = 0; y < mask.height; y++) {
      for (let x = Math.floor(mask.width / 2); x < mask.width; x++) mask.data[(y * mask.width + x) * 4 + 3] = 0
    }
    await writePicture(mask, maskFile)

    const c11 = await c11Of(manifest, name)
    expect(c11.ok).toBe(false)
    expect(c11.detail).toContain('neutral face needs two eyes')
  })

  it('fails an L30 hair mask covering 40 % of the frame', async () => {
    const name = 'base_fc4_L30'
    await writePicture(solidPicture(), join(dir, `${name}@2x.png`))
    const manifest: Manifest = { files: { [name]: { real: true } } }
    await writeMasks({ dir, manifest, names: [name], overridesDir })

    const maskFile = join(dir, `${name}_hairmask@2x.png`)
    const mask = await readPicture(maskFile)
    const target = Math.round(0.4 * W * H)
    for (let i = 0; i < target; i++) {
      const o = i * 4
      mask.data[o] = 255; mask.data[o + 1] = 255; mask.data[o + 2] = 255; mask.data[o + 3] = 255
    }
    await writePicture(mask, maskFile)

    const c11 = await c11Of(manifest, name)
    expect(c11.ok).toBe(false)
    expect(c11.detail).toContain('hair area')
  })

  it('is ok for an override whose area is out of range', async () => {
    const name = 'base_fc5_L30'
    await writePicture(solidPicture(), join(dir, `${name}@2x.png`))
    const manifest: Manifest = { files: { [name]: { real: true } } }
    await writePicture(solidPicture(), join(overridesDir, `${name}_hairmask.png`))

    await writeMasks({ dir, manifest, names: [name], overridesDir })
    expect(manifest.files[name]!.masks!.hair!.override).toBe(true)

    const c11 = await c11Of(manifest, name)
    expect(c11.ok).toBe(true)
  })

  it('is n/a for a layer with no masks', async () => {
    const name = 'base_fc6_L30'
    await writePicture(solidPicture(), join(dir, `${name}@2x.png`))
    const manifest: Manifest = { files: { [name]: { real: true } } }

    const c11 = await c11Of(manifest, name)
    expect(c11.ok).toBe(true)
    expect(c11.detail).toContain('n/a')
  })

  it('counts an iris split by a pupil and a highlight as one eye (Task 2b: merge before counting)', async () => {
    const name = 'base_fc7_face_neutral_L50'
    await writePicture(await syntheticBase(), join(dir, `${name}@2x.png`))
    const manifest: Manifest = { files: { [name]: { real: true } } }
    await writeMasks({ dir, manifest, names: [name], overridesDir })

    // Cut two 3 px gaps through the left eye's own mask, splitting the one blob C11 saw into three — a
    // pupil and a highlight cutting up an iris, not a change in how many eyes are there.
    const maskFile = join(dir, `${name}_eyemask@2x.png`)
    const mask = await readPicture(maskFile)
    const mid = Math.floor(mask.width / 2)
    let x0 = mask.width
    let x1 = -1
    let y0 = mask.height
    let y1 = -1
    for (let y = 0; y < mask.height; y++) {
      for (let x = 0; x < mid; x++) {
        if (mask.data[(y * mask.width + x) * 4 + 3]! < 128) continue
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
    expect(x1).toBeGreaterThan(x0) // the left eye actually has a blob to cut up
    const cuts = [x0 + Math.round((x1 - x0) / 3), x0 + Math.round((2 * (x1 - x0)) / 3)]
    for (let y = y0; y <= y1; y++) {
      for (const cut of cuts) {
        for (let dx = 0; dx < 3; dx++) {
          mask.data[(y * mask.width + cut + dx) * 4 + 3] = 0
        }
      }
    }
    await writePicture(mask, maskFile)

    const c11 = await c11Of(manifest, name)
    expect(c11.ok).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────── tint-sheet ──

describe('buildTintSheet', () => {
  let temp = ''
  let dir = ''
  let overridesDir = ''
  let manifest: Manifest = { files: {} }

  beforeAll(async () => {
    temp = mkdtempSync(join(tmpdir(), 'avatar-tint-sheet-'))
    dir = join(temp, 'out')
    overridesDir = join(temp, 'overrides')
    mkdirSync(dir, { recursive: true })
    mkdirSync(overridesDir, { recursive: true })

    manifest = { files: {} }

    // f01, masked: L30 (hair) and face_neutral (hair + eyes) — enough for baseTintMeans to find both meanLs.
    const l30 = 'base_f01_L30'
    await writePicture(await syntheticBase(), join(dir, `${l30}@2x.png`))
    manifest.files[l30] = { real: true }
    await writeMasks({ dir, manifest, names: [l30], overridesDir })

    const face = 'base_f01_face_neutral_L50'
    await writePicture(await syntheticBase(), join(dir, `${face}@2x.png`))
    manifest.files[face] = { real: true }
    await writeMasks({ dir, manifest, names: [face], overridesDir })

    // The outfit every card dresses in — plain, untinted.
    const outfit = 'item_outfit_casual01_L40'
    const outfitPic = await syntheticBase()
    await writePicture(outfitPic, join(dir, `${outfit}@2x.png`))
    await writePicture(await resizePicture(outfitPic, W / 2, H / 2), join(dir, `${outfit}@1x.png`))
    manifest.files[outfit] = { real: true }

    // A base with no masks at all — must not contribute any cards.
    const bare = 'base_fbare_L30'
    await writePicture(await syntheticBase(), join(dir, `${bare}@2x.png`))
    await writePicture(await resizePicture(await syntheticBase(), W / 2, H / 2), join(dir, `${bare}@1x.png`))
    manifest.files[bare] = { real: true }

    // A tintable item.
    const item = 'item_head_test01_L80'
    await writePicture(await syntheticItem(), join(dir, `${item}@2x.png`))
    manifest.files[item] = { real: true, tintSeed: { x: 150, y: 200 } }
    await writeMasks({ dir, manifest, names: [item], overridesDir })
  })
  afterAll(() => rmSync(temp, { recursive: true, force: true }))

  it('draws one card per base per hair × eye pair, and none for a base with no masks or an untinted item', async () => {
    const out = join(temp, 'sheet-no-items.png')
    const result = await buildTintSheet({ dir, manifest, items: [], out })
    expect(result.cards).toBe(9) // 3 hair colours × 3 eye colours, one base only
    expect(existsSync(out)).toBe(true)
  })

  it('adds one card per items.json entry with asset.tint set', async () => {
    const out = join(temp, 'sheet-with-item.png')
    const items = [{ id: 'head_test01', asset: { file: 'item_head_test01_L80', layer: 80, tint: '#c0392b' } }]
    const result = await buildTintSheet({ dir, manifest, items, out })
    expect(result.cards).toBe(10) // 9 base cards + 1 item card
    expect(existsSync(out)).toBe(true)
  })
})
