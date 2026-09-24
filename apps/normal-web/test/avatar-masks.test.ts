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
import { eyeMask, hairMask, maskTargets, tintMask, writeMasks } from '../scripts/avatar-pipeline/masks.mjs'
import { readPicture, renderSvg, writePicture } from '../scripts/avatar-pipeline/png.mjs'

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

/**
 * A flat chibi head and torso: a skin circle with a hair cap over its top 45 % and two side locks running
 * down to y 520, two eyes (white + iris + pupil, or — `closedEyes` — a bare 4 px lash line with none of
 * that), a skin body and a white tank top.
 */
async function syntheticBase({ closedEyes = false } = {}) {
  const cx = 384
  const cy = 330
  const r = 150
  const capBottom = cy - r + 0.45 * (2 * r) // 315: the circle's top 45 %
  const eyes = closedEyes
    ? `<path d="M296 350 Q320 358 344 350" stroke="${PUPIL}" stroke-width="4" fill="none" stroke-linecap="round"/>` +
      `<path d="M424 350 Q448 358 472 350" stroke="${PUPIL}" stroke-width="4" fill="none" stroke-linecap="round"/>`
    : `<ellipse cx="320" cy="350" rx="34" ry="40" fill="${WHITE}"/><circle cx="320" cy="350" r="24" fill="${IRIS}"/><circle cx="320" cy="350" r="9" fill="${PUPIL}"/>` +
      `<ellipse cx="448" cy="350" rx="34" ry="40" fill="${WHITE}"/><circle cx="448" cy="350" r="24" fill="${IRIS}"/><circle cx="448" cy="350" r="9" fill="${PUPIL}"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${SKIN}"/>
    <clipPath id="cap"><rect x="${cx - r - 20}" y="${cy - r}" width="${2 * r + 40}" height="${capBottom - (cy - r)}"/></clipPath>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${HAIR}" clip-path="url(#cap)"/>
    <rect x="300" y="480" width="168" height="320" fill="${SKIN}"/>
    <rect x="300" y="480" width="168" height="120" fill="${TANK}"/>
    <rect x="234" y="280" width="40" height="240" rx="20" fill="${HAIR}"/>
    <rect x="494" y="280" width="40" height="240" rx="20" fill="${HAIR}"/>
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
