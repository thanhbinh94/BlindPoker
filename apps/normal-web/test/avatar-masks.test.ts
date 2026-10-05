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
import { OUTFIT_LINE, SKIN_MASK, eyeEllipses, eyeMask, eyeZone, hairMask, maskColour, maskTargets, outfitLineMask, skinLineMask, skinMask, tintMask, writeMasks } from '../scripts/avatar-pipeline/masks.mjs'
import { writeIcon } from '../scripts/avatar-pipeline/manifest.mjs'
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
 *
 * `bald` (Plan 19 A1b, pre-flight #21) draws no cap and no locks: a v4 body face, whose head top is scalp — the
 * very patch `analysePicture` samples its "hair palette" from. `skinColour` and `scleraColour` (A1b fix round 1)
 * repaint the skin and the white of the eye: a cream face with an off-white sclera is the pair a real v4 face has,
 * the white within ΔE 22 of the skin. `extra` (A1b fix round 3) is raw SVG drawn last — a white cheek sparkle, say.
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
  bald = false,
  skinColour = SKIN,
  scleraColour = WHITE,
  extra = '',
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
            ? `<rect x="${side === 'L' ? ex + rx - innerW : ex - rx}" y="${ey - ry}" width="${innerW}" height="${2 * ry}" fill="${skinColour}"/>`
            : ''
        return `<ellipse cx="${ex}" cy="${ey}" rx="${rx}" ry="${ry}" fill="${scleraColour}"/>${hide}` +
          `<circle cx="${ex}" cy="${ey}" r="${IRIS_R}" fill="${irisColour}"/><circle cx="${ex}" cy="${ey}" r="${PUPIL_R}" fill="${PUPIL}"/>`
      }).join('')
  const hair = bald
    ? ''
    : `<clipPath id="cap"><rect x="${cx - r - 20}" y="${cy - r}" width="${2 * r + 40}" height="${capBottom - (cy - r)}"/></clipPath>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${hairColour}" clip-path="url(#cap)"/>`
  const locks = bald
    ? ''
    : `<rect x="234" y="280" width="40" height="240" rx="20" fill="${hairColour}"/>
    <rect x="494" y="280" width="40" height="240" rx="20" fill="${hairColour}"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${skinColour}"/>
    ${hair}
    <rect x="300" y="480" width="168" height="320" fill="${skinColour}"/>
    <rect x="300" y="480" width="168" height="120" fill="${TANK}"/>
    ${locks}
    ${filamentShape}
    ${shineBandShape}
    ${lashRingShape}
    ${eyes}
    ${extra}
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

/** The v4 body's colours (spec §5.2, §5.5): cream skin, a shaded cheek, the warm-brown outline, grey underwear. */
const CREAM = '#f1d2b6'
const SHADE = '#d9a47a'
const OUTLINE = '#7a4a32'
const UNDERWEAR = '#9aa3ad'
const EYE_DARK = '#2a1e22'
const MOUTH = '#d9607a'

/**
 * A v4 body as spec §5.2 asks for one, flat, on the frame's @2x canvas (Plan 19 A1b): a bald cream head ringed by
 * a 3 px warm-brown outline, with a shaded patch on its left cheek, two dark eyes and a pink mouth on it; cream
 * arms and legs; a grey tank top and shorts. The head is drawn last, over the top of the tank top, so no cream neck
 * runs up into the ring — it meets cloth or transparency all the way round, as a figure's outer line does.
 *
 * `parts` is each region by its colour (solid pixels within 20 of what was drawn, so not the antialiased rim between
 * two of them) — what the skin mask is measured against.
 *
 * `skin` and `underwear` repaint the cream and the grey (the style-gate test below gives it the real art's tank top);
 * `extra` is raw SVG drawn last, over the head — a second shaded patch or a highlight, say.
 */
async function syntheticBody({ skin = CREAM, underwear = UNDERWEAR, extra = '' } = {}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect x="300" y="430" width="168" height="220" rx="20" fill="${underwear}"/>
    <rect x="300" y="640" width="168" height="80" fill="${underwear}"/>
    <rect x="250" y="450" width="44" height="250" rx="20" fill="${skin}"/>
    <rect x="474" y="450" width="44" height="250" rx="20" fill="${skin}"/>
    <rect x="316" y="720" width="60" height="140" rx="20" fill="${skin}"/>
    <rect x="392" y="720" width="60" height="140" rx="20" fill="${skin}"/>
    <ellipse cx="384" cy="300" rx="160" ry="150" fill="${skin}" stroke="${OUTLINE}" stroke-width="3"/>
    <ellipse cx="300" cy="350" rx="30" ry="20" fill="${SHADE}"/>
    <ellipse cx="320" cy="280" rx="22" ry="30" fill="${EYE_DARK}"/>
    <ellipse cx="448" cy="280" rx="22" ry="30" fill="${EYE_DARK}"/>
    <ellipse cx="384" cy="375" rx="24" ry="13" fill="${MOUTH}"/>
    ${extra}
  </svg>`
  const pic = await renderSvg(svg, W, H)
  const parts = {
    skin: colourPixels(pic, skin),
    shading: colourPixels(pic, SHADE),
    outline: colourPixels(pic, OUTLINE),
    underwear: colourPixels(pic, underwear),
    eyes: colourPixels(pic, EYE_DARK),
    mouth: colourPixels(pic, MOUTH),
  }
  return { pic, parts }
}

// ─────────────────────────────────────────────────────────── pixel-set helpers ──

type Picture = { data: Buffer; width: number; height: number }
type MaskEntry = { bytes2x: number; meanL: number; empty?: boolean; override?: boolean }
type ManifestEntry = { real?: boolean; empty?: boolean; tintSeed?: { x: number; y: number }; masks?: Record<string, MaskEntry> }
type IconEntry = { kind: string; of: string; w: number; h: number; bytes2x: number; real?: boolean; tintMask?: boolean }
type Manifest = { files: Record<string, ManifestEntry>; icons?: Record<string, IconEntry> }

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
    const hair = hairMask(pic)
    expect(coverage(hair, capPixels(pic))).toBeGreaterThan(0.9)
    expect(coverage(hair, skinPixels(pic))).toBeLessThan(0.02)
  })

  it('finds one iris per side and takes it out of the hair', async () => {
    const pic = await syntheticBase()
    const hair = hairMask(pic)
    const eyes = eyeMask(pic, hair)
    expect(coverage(eyes, irisPixels(pic))).toBeGreaterThan(0.8)
    expect(blobsPerSide(eyes)).toEqual([1, 1])
    expect(coverage(hair, irisPixels(pic))).toBe(0)
  })

  it('answers an empty eye mask for closed eyes (lash lines only)', async () => {
    const pic = await syntheticBase({ closedEyes: true })
    const hair = hairMask(pic)
    expect(sum(eyeMask(pic, hair))).toBe(0)
  })

  // Task 2b (spec §4.1 ruling): the real bases showed the spike's "not-hair, not-skin" blob swallowing a
  // dark or skin-coloured iris into the hair mask, because the region it searched already excluded
  // whatever `hairMask` had claimed. The sclera-anchored ellipse below does not have that dependency —
  // it finds the eye from the white around the iris, so the iris's own colour cannot hide it any more.

  it('keeps an iris the same colour as the hair in the eye mask, and out of the hair mask', async () => {
    const pic = await syntheticBase({ irisColour: HAIR })
    const hair = hairMask(pic)
    const eyes = eyeMask(pic, hair)
    const ring = irisRingPixels(pic)
    expect(coverage(eyes, ring)).toBeGreaterThan(0.8)
    expect(coverage(hair, ring)).toBe(0)
  })

  it('keeps an iris the same colour as the skin, enclosed by the white of the eye, in the eye mask', async () => {
    const pic = await syntheticBase({ irisColour: SKIN })
    const hair = hairMask(pic)
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
    const hair = hairMask(pic)
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
    const hair = hairMask(pic)
    const eyes = eyeMask(pic, hair)
    expect(coverage(eyes, capPixels(pic))).toBe(0)
    expect(coverage(eyes, irisPixels(pic))).toBeGreaterThan(0.8)
  })

  it('drops a hair-coloured filament fully inside the padded ellipse, separate from the iris (largest-group trim)', async () => {
    const pic = await syntheticBase({ filament: 'L' })
    const hair = hairMask(pic)
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
    const hair = hairMask(pic)
    // < 2 %, not exactly 0: the same antialiasing tolerance the very first case in this file gives
    // `skinPixels` — a soft edge between the white and the ring round it, a pixel or two wide.
    expect(coverage(hair, eyeWhiteDiscPixels(pic, 'L'))).toBeLessThan(0.02)
  })

  it('puts a bluish-grey shine band (chroma ≈ 15) enclosed by bluish-black hair in the hair mask', async () => {
    const pic = await syntheticBase({ hairColour: HAIR_BLUE, shineBand: true })
    const hair = hairMask(pic)
    expect(coverage(hair, shineBandPixels(pic))).toBeGreaterThan(0.9)
  })

  it('keeps a bang that connects into an eye\'s own ellipse from outside as hair', async () => {
    // capFraction 0.6, the same heavy fringe the `hairlike` leak test uses: it genuinely reaches down
    // across the left eye's own padded ellipse, connected the whole way back to the cap.
    const pic = await syntheticBase({ capFraction: 0.6 })
    const hair = hairMask(pic)
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

// ───────────────────────────────────────────────────── v4 skin and eyes ──

describe('skinMask, and eyes on a bald face (Plan 19 A1b, spec §5.5)', () => {
  let temp = ''
  let dir = ''
  let overridesDir = ''

  beforeAll(() => {
    temp = mkdtempSync(join(tmpdir(), 'avatar-skin-'))
    dir = join(temp, 'out')
    overridesDir = join(temp, 'overrides')
    mkdirSync(dir, { recursive: true })
    mkdirSync(overridesDir, { recursive: true })
  })
  afterAll(() => rmSync(temp, { recursive: true, force: true }))

  it('cuts the cream skin, and none of the eyes, the mouth, the outline or the underwear', async () => {
    const { pic, parts } = await syntheticBody()
    const mask = skinMask(pic, { eyes: null })
    expect(coverage(mask, parts.skin)).toBeGreaterThan(0.95)
    expect(coverage(mask, parts.shading)).toBeGreaterThan(0.95)
    for (const part of ['eyes', 'mouth', 'underwear'] as const) expect(coverage(mask, parts[part]), part).toBe(0)
    expect(coverage(mask, parts.outline)).toBeLessThan(0.02)
  })

  it('keeps a pale bluish-grey tank top out of the skin though it is inside the tolerance of the cream (Plan 19 gate)', async () => {
    // The real v4 bodies came back with a light bluish-grey tank top, `#cecdd5` — Lab (82.7, 1.8, −3.8), chroma 4.3 — and
    // a cream cheek of Lab (92, 4.8, 13.7) is ΔE 20 from it, inside SKIN_MASK.tolerance (22): without a chroma floor the
    // whole top is cut as skin and a skin tint paints the shirt. `#f1d2bb` is the synthetic cream that is that close to
    // it too (Lab (86.2, 7.3, 15.4): ΔE 20.3 from the top, 19.5 from the `#fbb495` shading below).
    const CREAM_NEAR = '#f1d2bb'
    const TANK_PALE = '#cecdd5'
    const SHADED = '#fbb495' // Lab (79.2, 22.1, 26.1), chroma 34 — shaded skin, a real body's shading
    const SOFT = '#ffeadb' // Lab (94.0, 4.7, 9.8), chroma 10.9 — a pale highlight that still carries a cream's warmth
    const NEAR_WHITE = '#fff1e6' // Lab (95.9, 2.9, 7.0), chroma 7.6 — under SKIN_MASK.minChroma: the edge of the rule
    // The highlights sit on the forehead, above the eye band: a white blob inside the band is read as an eye white, which is
    // the separate, documented "eye zone can be too big" problem.
    const extra =
      `<ellipse cx="470" cy="360" rx="30" ry="20" fill="${SHADED}"/>` +
      `<ellipse cx="328" cy="205" rx="26" ry="12" fill="${SOFT}"/>` +
      `<ellipse cx="440" cy="205" rx="26" ry="12" fill="${NEAR_WHITE}"/>`
    const { pic, parts } = await syntheticBody({ skin: CREAM_NEAR, underwear: TANK_PALE, extra })
    const mask = skinMask(pic, { eyes: null })

    expect(sum(parts.underwear), 'the fixture draws a tank top and shorts').toBeGreaterThan(20000)
    expect(coverage(mask, parts.underwear), 'the pale tank top').toBeLessThan(0.01)
    expect(coverage(mask, parts.skin)).toBeGreaterThan(0.95)
    expect(coverage(mask, parts.shading)).toBeGreaterThan(0.95)
    expect(coverage(mask, colourPixels(pic, SHADED, 6)), 'shaded skin').toBeGreaterThan(0.95)
    expect(coverage(mask, colourPixels(pic, SOFT, 6)), 'a pale highlight of chroma 10.9').toBeGreaterThan(0.95)
    // Chroma 7.6 is under the floor, so a near-white highlight is not skin — it stays near-white under a tint, as a highlight
    // should. It is a hole in the mask only where the picture itself has near-white: no skin pixel of a cream carries that little.
    expect(coverage(mask, colourPixels(pic, NEAR_WHITE, 6)), 'a near-white highlight of chroma 7.6').toBeLessThan(0.05)
    for (const part of ['eyes', 'mouth'] as const) expect(coverage(mask, parts[part]), part).toBe(0)
    expect(SKIN_MASK.minChroma).toBe(8)
  })

  it('takes shaded skin, an ear and the skin round an eye, and leaves the mouth, the eye, a brow and a grey top out (Plan 19 gate)', async () => {
    // The colours the real v4 bodies are drawn in (docs/avatar-2d.md §4.4.1). Under a deep tone the old rule left the
    // shading, the ears and a ring round each eye cream: the shading is past `tolerance` and was past a chroma ceiling
    // of 1.6 × the seed's (30.6 for this cream), and the eye ellipses were taken out whole.
    const SHADE_LIGHT = '#fbb495' // Lab (79.2, 22.1, 26.1), C* 34, h 50° — a cheek, an ear
    const SHADE_DEEP = '#c87b5b' // Lab (59.2, 26.7, 30.1), C* 40, h 48° — the neck under the chin
    const EAR_DEEP = '#f6a588' // Lab (75.0, 26.7, 27.2), C* 38, h 45.6° — the ear's deepest, just inside the window
    const MOUTH_F = '#fe9c8e' // Lab (74.1, 35.0, 22.9), h 33° — f's mouth
    const MOUTH_M = '#fc9e82' // Lab (74.0, 32.1, 29.3), h 42.4° — m's mouth at its warmest, just under the window
    const SCLERA = '#fdf8f5' // C* 2.3
    const IRIS_AMBER = '#945e26' // m's iris, L* 44.9
    const IRIS_LIGHT = '#f4aa42' // its light side: Lab (75.1, 18.2, 61.9), h 74° — warm, light, inside the window
    const BROW = '#4e2c1e' // L* 22, a 3 px line the close would fill if it could
    const TANK_PALE = '#cecdd5'
    const extra =
      `<ellipse cx="470" cy="360" rx="26" ry="16" fill="${SHADE_LIGHT}"/>` +
      `<ellipse cx="384" cy="425" rx="40" ry="10" fill="${SHADE_DEEP}"/>` +
      `<ellipse cx="228" cy="300" rx="14" ry="24" fill="${EAR_DEEP}" stroke="${OUTLINE}" stroke-width="3"/>` +
      `<ellipse cx="384" cy="375" rx="24" ry="13" fill="${MOUTH_F}"/>` +
      `<ellipse cx="384" cy="381" rx="16" ry="6" fill="${MOUTH_M}"/>` +
      `<path d="M300 236 Q320 226 340 236" stroke="${BROW}" stroke-width="3" fill="none"/>` +
      `<ellipse cx="448" cy="280" rx="26" ry="32" fill="${SCLERA}"/>` +
      `<circle cx="448" cy="284" r="15" fill="${IRIS_AMBER}"/>` +
      `<circle cx="448" cy="288" r="9" fill="${IRIS_LIGHT}"/>`
    const { pic } = await syntheticBody({ underwear: TANK_PALE, extra })
    // The eye mask `eyeMask` would give: the iris, nothing of the white.
    const eyes = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x - 448, y - 284) <= 15.5) eyes[y * W + x] = 255
    const mask = skinMask(pic, { eyes })

    for (const [label, hex] of [['light shading', SHADE_LIGHT], ['deep shading', SHADE_DEEP], ['the ear', EAR_DEEP]] as const) {
      expect(sum(colourPixels(pic, hex, 6)), label).toBeGreaterThan(100)
      expect(coverage(mask, colourPixels(pic, hex, 6)), label).toBeGreaterThan(0.95)
    }
    // The cream right up to the white: what the padded ellipse round it used to take.
    const ring = new Uint8Array(W * H)
    colourPixels(pic, CREAM).forEach((v, i) => {
      const x = i % W
      const y = (i - x) / W
      if (v && ((x - 448) / 40) ** 2 + ((y - 280) / 46) ** 2 <= 1) ring[i] = 1
    })
    expect(sum(ring), 'cream round the eye').toBeGreaterThan(1500)
    expect(coverage(mask, ring), 'cream round the eye').toBeGreaterThan(0.95)

    for (const [label, hex] of [['f mouth', MOUTH_F], ['m mouth', MOUTH_M], ['sclera', SCLERA], ['amber iris', IRIS_AMBER], ['light amber iris', IRIS_LIGHT], ['brow', BROW], ['tank top', TANK_PALE]] as const) {
      expect(sum(colourPixels(pic, hex, 6)), label).toBeGreaterThan(50)
      expect(coverage(mask, colourPixels(pic, hex, 6)), label).toBe(0)
    }
    expect(coverage(mask, colourPixels(pic, OUTLINE)), 'outline').toBeLessThan(0.02)
    // The light amber is warm and light: colour alone would take it — the eye mask is what keeps an amber iris out.
    expect(coverage(skinMask(pic, { eyes: null }), colourPixels(pic, IRIS_LIGHT, 6)), 'light amber, no eye mask').toBeGreaterThan(0.9)
    expect(SKIN_MASK.hue).toEqual([44, 100])
  })

  it('cuts the skin’s line art — the outline and its soft rim — and none of the skin, the eyes, the mouth or the underwear (2026-10-05)', async () => {
    // A dark blob far from any skin: line art of something else, which the skin colour has no business shading.
    const extra = `<rect x="600" y="780" width="40" height="40" fill="${OUTLINE}"/>`
    const { pic, parts } = await syntheticBody({ extra })
    const eyes = new Uint8Array(W * H)
    for (let i = 0; i < eyes.length; i++) eyes[i] = parts.eyes[i] ? 255 : 0
    const skin = skinMask(pic, { eyes })
    const line = skinLineMask(pic, { skin, eyes })

    const ring = new Uint8Array(W * H) // the head's outline, which `parts.outline` also finds in the far blob
    for (let i = 0; i < ring.length; i++) ring[i] = parts.outline[i] && i < 700 * W ? 1 : 0
    expect(sum(ring), 'the fixture draws the head outline').toBeGreaterThan(2000)
    expect(coverage(line, ring), 'the head outline').toBeGreaterThan(0.95)
    expect(coverage(line, colourPixels(pic, OUTLINE).map((v, i) => (v && i >= 700 * W ? 1 : 0))), 'a line far from skin').toBe(0)
    for (const part of ['skin', 'shading', 'eyes', 'mouth', 'underwear'] as const) expect(coverage(line, parts[part]), part).toBe(0)
    // The soft rim outside the outline, where the head meets transparency, is in: it is the outline's own antialiasing.
    let rim = 0
    let rimIn = 0
    for (let i = 0; i < W * H; i++) {
      const a = pic.data[i * 4 + 3]!
      if (a > 8 && a < 200 && i < 470 * W) { rim++; if (line[i]) rimIn++ }
    }
    expect(rim).toBeGreaterThan(200)
    expect(rimIn / rim).toBeGreaterThan(0.9)
    // Never a pixel of the skin itself, nor within the eyes' margin.
    for (let i = 0; i < W * H; i++) {
      if (line[i] && skin[i]) throw new Error(`line and skin share pixel ${i}`)
      if (line[i] && eyes[i]) throw new Error(`line and eyes share pixel ${i}`)
    }
  })

  it('finds an outfit’s copy of the body’s outline beside skin the outfit leaves showing, and no cloth (2026-10-05)', async () => {
    const { pic: body, parts } = await syntheticBody()
    const eyes = new Uint8Array(W * H)
    for (let i = 0; i < eyes.length; i++) eyes[i] = parts.eyes[i] ? 255 : 0
    const skin = skinMask(body, { eyes })
    const line = skinLineMask(body, { skin, eyes })
    // The outfit picture redraws the head's outline where it leaves the head bare; it adds a red collar against the
    // outline's bottom (cloth of another colour), a block of cloth in the outline's own colour over the head's lower left
    // (cloth over skin it covers), and the same colour far from any skin.
    const RED = '#c0392b'
    const outfit = await renderSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <ellipse cx="384" cy="300" rx="160" ry="150" fill="none" stroke="${OUTLINE}" stroke-width="3"/>
        <rect x="330" y="440" width="108" height="30" fill="${RED}"/>
        <rect x="200" y="330" width="90" height="90" fill="${OUTLINE}"/>
        <rect x="600" y="780" width="40" height="40" fill="${OUTLINE}"/>
      </svg>`,
      W,
      H,
    )
    const copy = outfitLineMask(outfit, { body, skin, line })

    // The redrawn ring, away from the block: in.
    const outlineColoured = colourPixels(outfit, OUTLINE)
    const ring = new Uint8Array(W * H)
    for (let i = 0; i < 330 * W; i++) if (outlineColoured[i]) ring[i] = 1
    expect(sum(ring)).toBeGreaterThan(1000)
    expect(coverage(copy, ring), 'the redrawn outline').toBeGreaterThan(0.95)
    // Cloth: the red collar, the block's inside (4 px in from its edge, where no skin shows), the far square.
    expect(coverage(copy, colourPixels(outfit, RED)), 'the red collar').toBe(0)
    const inside = new Uint8Array(W * H)
    for (let y = 334; y < 416; y++) for (let x = 204; x < 286; x++) inside[y * W + x] = 1
    expect(coverage(copy, inside), 'cloth in the outline’s colour over skin it covers').toBe(0)
    const far = new Uint8Array(W * H)
    for (let y = 780; y < 820; y++) for (let x = 600; x < 640; x++) far[y * W + x] = 1
    expect(coverage(copy, far), 'the outline’s colour far from the body’s outline').toBe(0)
    expect(OUTFIT_LINE).toEqual({ reach: 3, tolerance: 20, shown: 4 })
  })

  it('cuts no line art where there is no skin', async () => {
    const { pic } = await syntheticBody()
    expect(sum(skinLineMask(pic, { skin: new Uint8Array(W * H), eyes: null }))).toBe(0)
  })

  it('takes a hand-drawn _skinmask override over the computed one', async () => {
    const name = 'body_f_L30'
    const { pic } = await syntheticBody()
    await writePicture(pic, join(dir, `${name}@2x.png`))
    const manifest = { files: { [name]: { real: true } } } as Manifest

    const overridePic = { data: Buffer.alloc(W * H * 4), width: W, height: H }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4
        overridePic.data[o] = 255; overridePic.data[o + 1] = 255; overridePic.data[o + 2] = 255
        overridePic.data[o + 3] = x >= 300 && x < 460 && y >= 200 && y < 400 ? 255 : 0
      }
    }
    await writePicture(overridePic, join(overridesDir, `${name}_skinmask.png`))

    await writeMasks({ dir, manifest, names: [name], overridesDir })

    expect(manifest.files[name]!.masks!.skin!.override).toBe(true)
    const written = await readPicture(join(dir, `${name}_skinmask@2x.png`))
    let differ = 0
    for (let i = 3; i < written.data.length; i += 4) if (written.data[i] !== overridePic.data[i]) differ++
    expect(differ).toBe(0)
  })

  it('finds two eyes on a bald face, whose scalp is what analysePicture samples as hair', async () => {
    const pic = await syntheticBase({ bald: true })
    const eyes = eyeMask(pic, new Uint8Array(W * H))
    expect(blobsPerSide(eyes)).toEqual([1, 1])
    expect(coverage(eyes, irisPixels(pic))).toBeGreaterThan(0.8)
  })

  it('keeps the eyes it is given, widened by eyeGap, out of the skin — and no more than that (Plan 19 gate)', async () => {
    const pic = await syntheticBase({ bald: true })
    const eyes = eyeMask(pic, new Uint8Array(W * H))
    const skin = skinMask(pic, { eyes })
    // The skin runs right up to the eye: the skin-coloured pixels of the eye zone (the padded ellipses the skin used to
    // give up, a cream ring round each eye under a deep tone) are skin now.
    const zone = eyeZone(pic, eyes)
    const zoneSkin = new Uint8Array(W * H)
    skinPixels(pic).forEach((v, i) => { if (v && zone[i]) zoneSkin[i] = 1 })
    expect(sum(zoneSkin), 'the eye zone holds skin round the eyes').toBeGreaterThan(2000)
    expect(coverage(skin, zoneSkin), 'the skin round the eyes').toBeGreaterThan(0.95)
    // Every skin pixel is more than `eyeGap` px from every eye pixel — the two masks never meet.
    const r = SKIN_MASK.eyeGap
    let near = 0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (skin[y * W + x]! < 128) continue
        for (let dy = -r; dy <= r && !near; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx >= 0 && ny >= 0 && nx < W && ny < H && dx * dx + dy * dy <= r * r && eyes[ny * W + nx]! >= 128) { near++; break }
          }
        }
      }
    }
    expect(near).toBe(0)
    expect(coverage(skin, skinPixels(pic))).toBeGreaterThan(0.9)
  })

  it('keeps an off-white sclera out of a cream face’s skin, though the eye mask it is given holds only the iris', async () => {
    // #fdf8f5 is ΔE ~20 from cream, inside SKIN_MASK.tolerance, and the eye ellipses are no longer taken out (Plan 19
    // gate): its chroma, C* 2.3, under SKIN_MASK.minChroma, is what keeps it out.
    const SCLERA = '#fdf8f5'
    const pic = await syntheticBase({ bald: true, skinColour: CREAM, scleraColour: SCLERA })
    const eyes = eyeMask(pic, new Uint8Array(W * H))
    const sclera = colourPixels(pic, SCLERA)
    const disc = new Uint8Array(W * H)
    for (const side of ['L', 'R'] as const) eyeWhiteDiscPixels(pic, side).forEach((inside, i) => { if (inside && sclera[i]) disc[i] = 1 })
    expect(sum(disc), 'the fixture draws a sclera').toBeGreaterThan(1000)
    expect(coverage(eyes, disc), 'the eye mask holds none of the white').toBe(0)
    const skin = skinMask(pic, { eyes })
    expect(coverage(skin, disc)).toBe(0)
    expect(coverage(skin, colourPixels(pic, CREAM))).toBeGreaterThan(0.85)
  })

  it('measures an iris by its saturated mid-tones, a grey iris by its mid-tones, and a mask with no mid-tones whole', () => {
    // A strip of flat pixels and a mask over all of them: `maskColour` only reads colours and weights.
    const strip = (runs: [string, number][]) => {
      const total = runs.reduce((n, [, count]) => n + count, 0)
      const pic = { data: Buffer.alloc(total * 4), width: total, height: 1 }
      let p = 0
      for (const [hex, count] of runs) {
        const [r, g, b] = hexToRgb(hex)
        for (let i = 0; i < count; i++, p++) pic.data.set([r, g, b, 255], p * 4)
      }
      return { pic, mask: new Uint8Array(total).fill(255) }
    }
    // Pupil (#101010, lightness 0.06) and highlight (#ffffff) never count; red is 40 of 140 mid-tones, over a quarter.
    const coloured = strip([['#101010', 30], ['#ffffff', 30], ['#808080', 100], ['#ff0000', 40]])
    expect(maskColour(coloured.pic, coloured.mask, { iris: true })).toBe('#ff0000')
    // Red is 10 of 110 mid-tones: a grey iris, measured by all its mid-tones — (128·100 + 255·10) / 110 = 139.5.
    const grey = strip([['#101010', 30], ['#ffffff', 30], ['#808080', 100], ['#ff0000', 10]])
    expect(maskColour(grey.pic, grey.mask, { iris: true })).toBe('#8c7474')
    // No mid-tone at all (a flat dark stand-in eye and a highlight): the whole mask.
    const flat = strip([['#101010', 50], ['#f0f0f0', 50]])
    expect(maskColour(flat.pic, flat.mask, { iris: true })).toBe('#808080')
    // Without `iris`, every masked pixel counts, by its weight.
    expect(maskColour(grey.pic, grey.mask)).toBe(maskColour(grey.pic, grey.mask, { iris: false }))
  })

  it('cuts skin on a real body, skin and eyes (never hair) on a real body face, and the ink of a real hair layer', async () => {
    const body = 'body_m_L30'
    const face = 'body_m_face_neutral_L50'
    const hair = 'item_hair_m_spiky01_L60'
    await writePicture((await syntheticBody()).pic, join(dir, `${body}@2x.png`))
    await writePicture(await syntheticBase({ bald: true }), join(dir, `${face}@2x.png`))
    await writePicture(await syntheticItem(), join(dir, `${hair}@2x.png`))
    const manifest = { files: { [body]: { real: true }, [face]: { real: true }, [hair]: { real: true } } } as Manifest

    await writeMasks({ dir, manifest, names: [body, face, hair], overridesDir })

    expect(Object.keys(manifest.files[body]!.masks!)).toEqual(['skin', 'skinLine'])
    expect(Object.keys(manifest.files[face]!.masks!).sort()).toEqual(['eyes', 'skin', 'skinLine'])
    expect(Object.keys(manifest.files[hair]!.masks!)).toEqual(['hair'])
    const alphaOf = async (file: string) => {
      const pic = await readPicture(join(dir, file))
      const alpha = new Uint8Array(pic.width * pic.height)
      for (let i = 0; i < alpha.length; i++) alpha[i] = pic.data[i * 4 + 3]!
      return alpha
    }
    const [skin, eyes, line] = await Promise.all([alphaOf(`${face}_skinmask@2x.png`), alphaOf(`${face}_eyemask@2x.png`), alphaOf(`${face}_skinlinemask@2x.png`)])
    let both = 0
    for (let i = 0; i < skin.length; i++) if (skin[i]! >= 128 && eyes[i]! >= 128) both++
    expect(both).toBe(0)
    // The skin's line art (2026-10-05): cut beside the skin as written, never on it or on the eyes.
    expect(sum(line)).toBeGreaterThan(200)
    expect(existsSync(join(dir, `${body}_skinlinemask@1x.png`))).toBe(true)
    for (let i = 0; i < line.length; i++) if (line[i] && (skin[i] || eyes[i])) throw new Error(`line overlaps skin or eyes at ${i}`)
    expect(blobsPerSide(eyes)).toEqual([1, 1])
    // The hair layer's mask is its ink, as a base L60's is.
    const item = await syntheticItem()
    const ink = new Uint8Array(W * H)
    for (let i = 0; i < ink.length; i++) ink[i] = item.data[i * 4 + 3]! > 8 ? 1 : 0
    expect(coverage(await alphaOf(`${hair}_hairmask@2x.png`), ink)).toBe(1)
  })

  it('measures a mask’s colour as its alpha-weighted mean, and an eye mask’s by its iris alone', async () => {
    const pic = await syntheticBase()
    const hair = hairMask(pic)
    const away = (hex: string | null, from: string) => {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/)
      const [r, g, b] = hexToRgb(hex!)
      const [R, G, B] = hexToRgb(from)
      return Math.hypot(r - R, g - G, b - B)
    }
    expect(away(maskColour(pic, hair), HAIR)).toBeLessThan(8)
    // The whole eye on each side — the white, the blue iris and the black pupil — as a hand-drawn eye mask would
    // hold it: the iris is what the eye colour is.
    const whole = new Uint8Array(W * H)
    for (const side of ['L', 'R'] as const) eyeWhiteDiscPixels(pic, side).forEach((inside, i) => { if (inside) whole[i] = 255 })
    expect(away(maskColour(pic, whole, { iris: true }), IRIS)).toBeLessThan(12)
    expect(away(maskColour(pic, whole), IRIS), 'the white and the pupil pull a plain mean off the iris').toBeGreaterThan(40)
    expect(maskColour(pic, new Uint8Array(W * H))).toBeNull()
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
    const name = 'body_f_face_neutral_L50'
    await writePicture(await syntheticBase({ bald: true, skinColour: CREAM }), join(dir, `${name}@2x.png`))
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
    const name = 'body_m_L30'
    await writePicture((await syntheticBody()).pic, join(dir, `${name}@2x.png`))
    const manifest = { files: { [name]: { real: true } } } as Manifest

    await writeMasks({ dir, manifest, names: [name], overridesDir })

    expect(existsSync(join(dir, `${name}_skinmask@1x.png`))).toBe(true)
    expect(existsSync(join(dir, `${name}_skinmask@2x.png`))).toBe(true)
    const at1x = await readPicture(join(dir, `${name}_skinmask@1x.png`))
    const at2x = await readPicture(join(dir, `${name}_skinmask@2x.png`))
    expect([at1x.width, at1x.height]).toEqual([384, 448])
    expect([at2x.width, at2x.height]).toEqual([768, 896])
    const skin = manifest.files[name]!.masks!.skin!
    expect(skin.meanL).toBeGreaterThan(0)
    expect(skin.meanL).toBeLessThan(1)
    expect(skin.bytes2x).toBeGreaterThan(0)
  })

  it('cuts nothing for a retired flat base’s name: it is no name the pipeline reads (Plan 19 D1)', async () => {
    const name = 'base_f02_L30'
    await writePicture(await syntheticBase(), join(dir, `${name}@2x.png`))
    const manifest = { files: { [name]: { real: true } } } as Manifest

    await writeMasks({ dir, manifest, names: [name], overridesDir })

    expect(manifest.files[name]!.masks).toBeUndefined()
    expect(existsSync(join(dir, `${name}_hairmask@2x.png`))).toBe(false)
  })

  // Plan 18 (No8a): a colour variant's icon is tinted the way its worn layer is, so a tint mask comes with an icon one.
  it("cuts an item's icon tint mask from its tint mask with the icon's own fit, at both densities, and flags the icon", async () => {
    const name = 'item_head_test02_L80'
    const layer = await syntheticItem()
    await writePicture(layer, join(dir, `${name}@2x.png`))
    const manifest: Manifest = { files: { [name]: { real: true, tintSeed: { x: 150, y: 200 } } }, icons: {} }
    const icon = await writeIcon(layer, dir, name, manifest, { real: true })

    await writeMasks({ dir, manifest, names: [name], overridesDir })

    expect(manifest.icons![icon]).toMatchObject({ kind: 'icon', of: name, real: true, tintMask: true })
    for (const density of [1, 2]) {
      const iconPic = await readPicture(join(dir, `${icon}@${density}x.png`))
      const maskPic = await readPicture(join(dir, `${icon}_tintmask@${density}x.png`))
      expect([maskPic.width, maskPic.height], `@${density}x`).toEqual([iconPic.width, iconPic.height])
      const alpha = new Uint8Array(maskPic.width * maskPic.height)
      for (let i = 0; i < alpha.length; i++) alpha[i] = maskPic.data[i * 4 + 3]!
      // The seeded red block of the icon, and not the blue one beside it.
      expect(coverage(alpha, colourPixels(iconPic, '#c0392b')), `@${density}x red`).toBeGreaterThan(0.9)
      expect(coverage(alpha, colourPixels(iconPic, '#2c3e70')), `@${density}x blue`).toBeLessThan(0.02)
    }
  })

  it("writes no icon tint mask for an aura or a frame, whose icon is the source picture's, nor for a layer with no icon", async () => {
    const aura = 'item_aura_test03_L10'
    const bare = 'item_head_test04_L80'
    const layer = await syntheticItem()
    await writePicture(layer, join(dir, `${aura}@2x.png`))
    await writePicture(layer, join(dir, `${bare}@2x.png`))
    const manifest: Manifest = {
      files: { [aura]: { real: true, tintSeed: { x: 150, y: 200 } }, [bare]: { real: true, tintSeed: { x: 150, y: 200 } } },
      icons: {},
    }
    const auraIcon = await writeIcon(layer, dir, aura, manifest, { real: true })

    await writeMasks({ dir, manifest, names: [aura, bare], overridesDir })

    expect(manifest.files[aura]!.masks!.tint).toBeDefined()
    expect(manifest.icons![auraIcon]!.tintMask).toBeUndefined()
    expect(existsSync(join(dir, `${auraIcon}_tintmask@2x.png`))).toBe(false)
    expect(manifest.files[bare]!.masks!.tint).toBeDefined()
    expect(Object.keys(manifest.icons!)).toEqual([auraIcon])
    expect(existsSync(join(dir, 'item_head_test04_icon_tintmask@2x.png'))).toBe(false)
  })
})

describe('maskTargets', () => {
  it('picks tintable real items, and no retired flat base, its faces or its hair (Plan 19 D1)', () => {
    const manifest = {
      files: {
        base_f01_L30: { real: true, layer: 30 },
        base_f01_face_neutral_L50: { real: true, layer: 50 },
        item_outfit_casual01_L40: { real: true, layer: 40 },
        item_outfit_dealer01_L40: { real: true, layer: 40, tintSeed: { x: 10, y: 10 } },
        item_outfit_champion01_L40: { real: true, layer: 40, cutOn: 'f' },
        item_head_tophat01_L80: { placeholder: true, layer: 80 },
      },
    }
    const targets = maskTargets(manifest)
    // A v4 outfit, cut on a body, carries that body's outline (2026-10-05), with or without a tint seed.
    expect(targets).toEqual(['item_outfit_dealer01_L40', 'item_outfit_champion01_L40'])
    expect(targets).not.toContain('item_outfit_casual01_L40') // no tintSeed, cut on no body
    expect(targets).not.toContain('item_head_tophat01_L80') // placeholder, not real
  })

  it('picks every real v4 body, body face and hair layer, and no stand-in (Plan 19 A1b)', () => {
    const manifest = {
      files: {
        body_f_L30: { real: true, layer: 30 },
        body_f_face_happy_L50: { real: true, layer: 50 },
        item_hair_f_bob01_L20: { real: true, layer: 20 },
        item_hair_f_bob01_L60: { real: true, layer: 60 },
        item_hair_m_neat01_L20: { real: true, layer: 20, empty: true },
        body_m_L30: { placeholder: true, layer: 30 },
        body_m_face_neutral_L50: { placeholder: true, layer: 50 },
        item_hair_m_spiky01_L60: { placeholder: true, layer: 60 },
      },
    }
    expect(maskTargets(manifest).sort()).toEqual(['body_f_L30', 'body_f_face_happy_L50', 'item_hair_f_bob01_L20', 'item_hair_f_bob01_L60'])
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

  async function c11Of(manifest: Manifest, name: string, where = dir) {
    const [row] = await runChecks({ dir: where, manifest, names: [name] })
    return row!.results.find((r) => r.id === 'C11')!
  }
  /**
   * A directory of one case's own, under `dir`: the cases below all use the one real neutral face's name (Plan 19 D1 —
   * the flat bases' `base_fc<n>_…` names were free to invent), so each writes its own copy.
   */
  function caseIn(name: string): string {
    const sub = join(dir, name)
    mkdirSync(sub, { recursive: true })
    return sub
  }
  /** A real neutral body face — a bald cream head with open eyes — masked (eyes, then skin) in `where`. */
  async function maskedNeutralFace(where: string): Promise<{ name: string; manifest: Manifest }> {
    const name = 'body_f_face_neutral_L50'
    await writePicture(await syntheticBase({ bald: true, skinColour: CREAM }), join(where, `${name}@2x.png`))
    const manifest: Manifest = { files: { [name]: { real: true } } }
    await writeMasks({ dir: where, manifest, names: [name], overridesDir })
    return { name, manifest }
  }

  it('is ok when the masks are untouched', async () => {
    const where = caseIn('fc1')
    const { name, manifest } = await maskedNeutralFace(where)
    const c11 = await c11Of(manifest, name, where)
    expect(c11.ok, c11.detail).toBe(true)
  })

  it('fails when a mask covers a pixel the layer leaves transparent', async () => {
    const where = caseIn('fc2')
    const { name, manifest } = await maskedNeutralFace(where)

    // (4, 4) is the canvas corner — nothing is drawn there in the synthetic face.
    const maskFile = join(where, `${name}_skinmask@2x.png`)
    const mask = await readPicture(maskFile)
    const i = (4 * mask.width + 4) * 4
    mask.data[i] = 255; mask.data[i + 1] = 255; mask.data[i + 2] = 255; mask.data[i + 3] = 255
    await writePicture(mask, maskFile)

    const c11 = await c11Of(manifest, name, where)
    expect(c11.ok).toBe(false)
    expect(c11.detail).toContain('mask outside the layer')
  })

  it('fails a neutral face whose eye mask has one blob', async () => {
    const where = caseIn('fc3')
    const { name, manifest } = await maskedNeutralFace(where)

    const maskFile = join(where, `${name}_eyemask@2x.png`)
    const mask = await readPicture(maskFile)
    for (let y = 0; y < mask.height; y++) {
      for (let x = Math.floor(mask.width / 2); x < mask.width; x++) mask.data[(y * mask.width + x) * 4 + 3] = 0
    }
    await writePicture(mask, maskFile)

    const c11 = await c11Of(manifest, name, where)
    expect(c11.ok).toBe(false)
    expect(c11.detail).toContain('neutral face needs two eyes')
  })

  it('fails a body L30 skin mask covering 40 % of an all-ink frame', async () => {
    // (Plan 13's hair rule held a flat base's L30 hair mask to 3–20 % of the frame; a body's skin is held to `SKIN_AREA`
    // of its own ink instead, D1.)
    const where = caseIn('fc4')
    const name = 'body_f_L30'
    await writePicture(solidPicture(), join(where, `${name}@2x.png`))
    const manifest: Manifest = { files: { [name]: { real: true } } }
    await writeMasks({ dir: where, manifest, names: [name], overridesDir })

    const maskFile = join(where, `${name}_skinmask@2x.png`)
    const mask = await readPicture(maskFile)
    const target = Math.round(0.4 * W * H)
    for (let i = 0; i < W * H; i++) {
      const o = i * 4
      mask.data[o] = 255; mask.data[o + 1] = 255; mask.data[o + 2] = 255; mask.data[o + 3] = i < target ? 255 : 0
    }
    await writePicture(mask, maskFile)

    const c11 = await c11Of(manifest, name, where)
    expect(c11.ok).toBe(false)
    expect(c11.detail).toContain("skin covers 0.40 of the body's ink")
  })

  it('is ok for an override whose area is out of range', async () => {
    const where = caseIn('fc5')
    const name = 'body_f_L30'
    await writePicture(solidPicture(), join(where, `${name}@2x.png`))
    const manifest: Manifest = { files: { [name]: { real: true } } }
    // The whole frame: past `SKIN_AREA`'s 0.75 of the ink, and trusted for its shape because a person drew it.
    const overrides = join(where, 'overrides')
    mkdirSync(overrides, { recursive: true })
    await writePicture(solidPicture(), join(overrides, `${name}_skinmask.png`))

    await writeMasks({ dir: where, manifest, names: [name], overridesDir: overrides })
    expect(manifest.files[name]!.masks!.skin!.override).toBe(true)

    const c11 = await c11Of(manifest, name, where)
    expect(c11.ok, c11.detail).toBe(true)
  })

  it('is n/a for a layer with no masks, which its kind does not require', async () => {
    const where = caseIn('fc6')
    const name = 'item_head_tophat01_L80'
    await writePicture(solidPicture(), join(where, `${name}@2x.png`))
    const manifest: Manifest = { files: { [name]: { real: true } } }

    const c11 = await c11Of(manifest, name, where)
    expect(c11.ok).toBe(true)
    expect(c11.detail).toContain('n/a')
  })

  // Plan 19 A1b fix round 2 (controller ruling): a body face's skin is compared with its neutral face's as skin ∪ eye
  // zone, because between expressions only the eye region moves between "eye" and "skin".
  /**
   * A real neutral face (open eyes, an off-white sclera) and a real shut-eye face of the same cream bald head, masked.
   * Cut to the head region (above y 500 at @2x, `FACE_LIMIT_Y`), as an ingested face layer is, so the eyes are the
   * share of the face they are on a real one.
   */
  async function shutAndOpen(gender: 'f' | 'm') {
    const neutral = `body_${gender}_face_neutral_L50`
    const closed = `body_${gender}_face_closed_L50`
    const headOnly = (pic: Picture): Picture => {
      for (let i = 500 * W * 4 + 3; i < pic.data.length; i += 4) pic.data[i] = 0
      return pic
    }
    await writePicture(headOnly(await syntheticBase({ bald: true, skinColour: CREAM, scleraColour: '#fdf8f5' })), join(dir, `${neutral}@2x.png`))
    await writePicture(headOnly(await syntheticBase({ bald: true, skinColour: CREAM, closedEyes: true })), join(dir, `${closed}@2x.png`))
    const manifest: Manifest = { files: { [neutral]: { real: true }, [closed]: { real: true } } }
    await writeMasks({ dir, manifest, names: [neutral, closed], overridesDir })
    const skinArea = async (name: string) => {
      const mask = await readPicture(join(dir, `${name}_skinmask@2x.png`))
      let solid = 0
      for (let i = 3; i < mask.data.length; i += 4) if (mask.data[i]! >= 128) solid++
      return solid
    }
    return { neutral, closed, manifest, skinArea }
  }

  it('passes a shut-eye face whose eyelids are skin against an open-eye neutral of the same head', async () => {
    const { neutral, closed, manifest, skinArea } = await shutAndOpen('f')
    // Skin alone would not do: the shut eyes are eyelid skin, the open ones are iris and white. (The gap is smaller than
    // it was before the Plan 19 gate, when the open face's skin also gave up a padded ring round each eye: ~1.13 here, and
    // more on a real face, whose eyes are a bigger share of it.)
    expect((await skinArea(closed)) / (await skinArea(neutral)), 'skin alone').toBeGreaterThan(1.1)
    const c11 = await c11Of(manifest, closed)
    expect(c11.ok, c11.detail).toBe(true)
  })

  it('still fails a face whose skin and eye zone are half the neutral face’s', async () => {
    const { closed, manifest } = await shutAndOpen('m')
    // The shut face has no eye zone (no white, no eye mask): halving its skin halves skin ∪ eye zone.
    const maskFile = join(dir, `${closed}_skinmask@2x.png`)
    const mask = await readPicture(maskFile)
    let solid = 0
    for (let i = 3; i < mask.data.length; i += 4) if (mask.data[i]! >= 128) solid++
    let cleared = 0
    for (let i = 3; i < mask.data.length && cleared < solid / 2; i += 4) if (mask.data[i]! >= 128) { mask.data[i] = 0; cleared++ }
    await writePicture(mask, maskFile)
    const c11 = await c11Of(manifest, closed)
    expect(c11.ok).toBe(false)
    expect(c11.detail).toMatch(/skin and eye zone are 0\.(4|5)\d × the neutral face's, want 0\.8–1\.2 ×/)
  })

  // A1b fix round 3 (controller ruling): `eyeEllipses` unions every white blob on a side and mirrors it, so a white
  // sparkle on a cheek swells both eye zones — skin ∪ eye zone stays ≈ 1 ×. On a real pair, C11 also holds skin alone to
  // ≥ 0.8 × and the eye zone to ≤ 1.5 × the neutral face's. Since the Plan 19 gate the skin mask no longer gives up the
  // eye zone, so the sparkle no longer eats the skin: the eye-zone guard is the one that catches it.
  it('fails a real face whose white cheek sparkle swells the eye zone, on the eye-zone guard; its skin is untouched', async () => {
    const neutral = 'body_f_face_neutral_L50'
    const sparkly = 'body_f_face_happy_L50'
    const headOnly = (pic: Picture): Picture => {
      for (let i = 500 * W * 4 + 3; i < pic.data.length; i += 4) pic.data[i] = 0
      return pic
    }
    const face = { bald: true, skinColour: CREAM, scleraColour: '#fdf8f5' }
    await writePicture(headOnly(await syntheticBase(face)), join(dir, `${neutral}@2x.png`))
    // Below and outside the left eye, inside the band `eyeEllipses` looks for whites in (y < 420 here).
    await writePicture(headOnly(await syntheticBase({ ...face, extra: '<circle cx="264" cy="413" r="6" fill="#ffffff"/>' })), join(dir, `${sparkly}@2x.png`))
    const manifest: Manifest = { files: { [neutral]: { real: true }, [sparkly]: { real: true } } }
    await writeMasks({ dir, manifest, names: [neutral, sparkly], overridesDir })

    const c11 = await c11Of(manifest, sparkly)
    expect(c11.ok, c11.detail).toBe(false)
    expect(c11.detail).toMatch(/eye zone \d\.\d\d × neutral's \(max 1\.5\)/)
    expect(c11.detail).not.toContain('skin alone')
    // The rule they guard is blind to it: skin and eye zone together are still the neutral face's.
    expect(c11.detail).not.toContain('skin and eye zone are')
    const skinArea = async (name: string) => {
      const mask = await readPicture(join(dir, `${name}_skinmask@2x.png`))
      let solid = 0
      for (let i = 3; i < mask.data.length; i += 4) if (mask.data[i]! >= 128) solid++
      return solid
    }
    // All the sparkle takes from the skin is its own few pixels.
    expect((await skinArea(sparkly)) / (await skinArea(neutral))).toBeGreaterThan(0.99)
  })

  it('counts an iris split by a pupil and a highlight as one eye (Task 2b: merge before counting)', async () => {
    const where = caseIn('fc7')
    const { name, manifest } = await maskedNeutralFace(where)

    // Cut two 3 px gaps through the left eye's own mask, splitting the one blob C11 saw into three — a
    // pupil and a highlight cutting up an iris, not a change in how many eyes are there.
    const maskFile = join(where, `${name}_eyemask@2x.png`)
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

    const c11 = await c11Of(manifest, name, where)
    expect(c11.ok, c11.detail).toBe(true)
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
    /** One layer at both densities, as real art, its masks cut by `writeMasks`. */
    const layer = async (name: string, pic: Picture): Promise<void> => {
      await writePicture(pic, join(dir, `${name}@2x.png`))
      await writePicture(await resizePicture(pic, W / 2, H / 2), join(dir, `${name}@1x.png`))
      manifest.files[name] = { real: true }
      await writeMasks({ dir, manifest, names: [name], overridesDir })
    }

    // Body f in its default hairstyle, masked: the body (skin), its neutral face (eyes + skin) and the bob's two layers
    // (hair, their ink) — enough for the sheet to find the hair and eye meanLs (Plan 19 D1: a gender's, not a base's).
    await layer('body_f_L30', (await syntheticBody()).pic)
    await layer('body_f_face_neutral_L50', await syntheticBase({ bald: true, skinColour: CREAM }))
    await layer('item_hair_f_bob01_L60', await syntheticItem())
    await layer('item_hair_f_bob01_L20', await syntheticItem())

    // The outfit every card dresses in — plain, untinted.
    const outfit = 'item_outfit_casual01_L40'
    const outfitPic = (await syntheticBody({ underwear: '#2c3e70' })).pic
    await writePicture(outfitPic, join(dir, `${outfit}@2x.png`))
    await writePicture(await resizePicture(outfitPic, W / 2, H / 2), join(dir, `${outfit}@1x.png`))
    manifest.files[outfit] = { real: true }

    // Body m with no masks at all, and no hairstyle — must not contribute any cards.
    const bare = 'body_m_L30'
    await writePicture((await syntheticBody()).pic, join(dir, `${bare}@2x.png`))
    await writePicture(await resizePicture((await syntheticBody()).pic, W / 2, H / 2), join(dir, `${bare}@1x.png`))
    manifest.files[bare] = { real: true }

    // A tintable item.
    const item = 'item_head_test01_L80'
    await writePicture(await syntheticItem(), join(dir, `${item}@2x.png`))
    manifest.files[item] = { real: true, tintSeed: { x: 150, y: 200 } }
    await writeMasks({ dir, manifest, names: [item], overridesDir })
  })
  afterAll(() => rmSync(temp, { recursive: true, force: true }))

  it('draws one card per gender per hair × eye pair, and none for a gender with no masks or an untinted item', async () => {
    const out = join(temp, 'sheet-no-items.png')
    const result = await buildTintSheet({ dir, manifest, items: [], out })
    expect(result.cards).toBe(9) // 3 hair colours × 3 eye colours, body f only
    expect(existsSync(out)).toBe(true)
  })

  it('adds one card per items.json entry with asset.tint set', async () => {
    const out = join(temp, 'sheet-with-item.png')
    const items = [{ id: 'head_test01', asset: { file: 'item_head_test01_L80', layer: 80, tint: '#c0392b' } }]
    const result = await buildTintSheet({ dir, manifest, items, out })
    expect(result.cards).toBe(10) // 9 gender cards + 1 item card, on body f in the bob
    expect(existsSync(out)).toBe(true)
  })

  it('draws no card for a retired flat base, and none for a gender whose default hairstyle has no hair mask (Plan 19 D1)', async () => {
    // A manifest that still lists a masked flat base gets no card for it: the cards are the genders'.
    const withBase: Manifest = { files: { ...manifest.files, base_f01_L30: { real: true, masks: { hair: { bytes2x: 1, meanL: 0.3 } } } } }
    const out = join(temp, 'sheet-old-base.png')
    expect((await buildTintSheet({ dir, manifest: withBase, items: [], out })).cards).toBe(9)
    // Without the bob's hair mask the gender has no hair meanL, so no cards at all.
    const { item_hair_f_bob01_L60: _front, item_hair_f_bob01_L20: _back, ...noHair } = manifest.files
    expect((await buildTintSheet({ dir, manifest: { files: noHair }, items: [], out })).cards).toBe(0)
  })
})
