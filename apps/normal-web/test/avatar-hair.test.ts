/**
 * The two-layer hair split (Plan 19 A1c, spec §5.4): `splitHair` (`hair.mjs`), which A2a's ingest uses to cut a
 * hairstyle's region into its front layer (L60) and its back layer (L20), and C13 (`checks.mjs`), which holds the
 * two written layers to that split.
 *
 * Everything here is synthetic, on the frame's @2x canvas (768 × 896): a bald head on a neck and a torso, and a hair
 * region of three parts whose side of the body is known — a cap over the head top, a long panel behind the
 * shoulders, a lock lying on the left shoulder. The parts are built pixel by pixel in frame units (the pixel centre
 * halved), so every count below is exact; only the body is rendered.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { runChecks } from '../scripts/avatar-pipeline/checks.mjs'
import { FRAME } from '../scripts/avatar-pipeline/frame.mjs'
import { HAIR_COVERAGE, HAIR_EYE_LIMIT, HAIR_SPLIT, splitHair } from '../scripts/avatar-pipeline/hair.mjs'
import { renderSvg, writePicture } from '../scripts/avatar-pipeline/png.mjs'

// One body render, a split and a few PNG round trips per case: well inside the budget, but the suite shares the CPU.
vi.setConfig({ testTimeout: 60_000 })

const DENSITY = 2
const W = FRAME.w * DENSITY
const H = FRAME.h * DENSITY

type Picture = { data: Buffer; width: number; height: number }
type Mask = Uint8Array
type Entry = {
  layer: number
  w: number
  h: number
  bytes2x: number
  real?: boolean
  placeholder?: boolean
  masks?: Record<string, { bytes2x: number; meanL: number; empty?: boolean }>
  split?: { region: number; front: number; back: number }
}
type Manifest = { files: Record<string, Entry> }

/** The bald body, in frame units: a head circle on a neck, and a torso from y 230 — no arms, nothing else. */
const BODY_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${FRAME.w} ${FRAME.h}">` +
  '<circle cx="192" cy="150" r="76" fill="#f1d2b6"/>' +
  '<rect x="177" y="214" width="30" height="20" fill="#f1d2b6"/>' +
  '<rect x="148" y="230" width="88" height="100" fill="#9aa3ad"/>' +
  '</svg>'

/** A mask of every @2x pixel whose centre, in frame units, `inside` accepts. */
function maskOf(inside: (x: number, y: number) => boolean): Mask {
  const mask = new Uint8Array(W * H)
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) if (inside((px + 0.5) / DENSITY, (py + 0.5) / DENSITY)) mask[py * W + px] = 255
  }
  return mask
}

/** The four parts of the synthetic hair region, each on its known side of the body. */
const parts = {
  /** Over the head top, y 60–135: an ellipse a little wider than the skull, cut off above the eyes. */
  cap: maskOf((x, y) => y >= 60 && y <= 135 && ((x - 192) / 80) ** 2 + ((y - 150) / 90) ** 2 <= 1),
  /** Long hair behind the shoulders, y 240–330, only in the columns either side of the torso (x 148–236). */
  panel: maskOf((x, y) => y >= 240 && y <= 330 && ((x >= 104 && x < 146) || (x >= 238 && x < 280))),
  /** A lock lying on the left shoulder, on the torso's own ink. */
  shoulderLock: maskOf((x, y) => x >= 150 && x <= 166 && y >= 236 && y <= 260),
  /**
   * A bunch standing out beside the left jaw, y 195–215, x 96–118: off the head shape, so spec §5.4 puts it in L20.
   * It lies below the crown band (which ends at y 127.65 on this body) and outside the head grown by `reach` (whose
   * left edge is x ≥ 120.8 on these rows) — but its right third is inside the grown head's *horizontal extent*
   * (x ≥ 110), so a crown band reaching the chin would take that part to the front, and so would a much longer reach.
   */
  sideBunch: maskOf((x, y) => x >= 96 && x <= 118 && y >= 195 && y <= 215),
}
const union = (...masks: Mask[]): Mask => masks.reduce((out, mask) => out.map((v, p) => Math.max(v, mask[p]!)), new Uint8Array(W * H))
const region = union(parts.cap, parts.panel, parts.shoulderLock, parts.sideBunch)
/** The neutral face's eyes, under the cap's lower edge: two ellipses at y 139–169. */
const eyes = maskOf((x, y) => ((x - 170) / 12) ** 2 + ((y - 154) / 15) ** 2 <= 1 || ((x - 214) / 12) ** 2 + ((y - 154) / 15) ** 2 <= 1)

const solidCount = (mask: Mask): number => mask.reduce((n, v) => n + (v >= 128 ? 1 : 0), 0)
/** The share of `part`'s pixels that `mask` holds at ≥ 128. */
function coverage(mask: Mask, part: Mask): number {
  let inPart = 0
  let held = 0
  for (let p = 0; p < part.length; p++) {
    if (part[p]! < 128) continue
    inPart++
    if (mask[p]! >= 128) held++
  }
  return held / inPart
}
/** Pixels at ≥ 128 in both masks. */
function overlap(a: Mask, b: Mask): number {
  let n = 0
  for (let p = 0; p < a.length; p++) if (a[p]! >= 128 && b[p]! >= 128) n++
  return n
}

let body: Picture

beforeAll(async () => {
  body = await renderSvg(BODY_SVG, W, H)
})

describe('splitHair (Plan 19 A1c, spec §5.4)', () => {
  it('names the numbers the plan gives it', () => {
    expect(HAIR_SPLIT).toEqual({ reach: 6, crownBand: 0.35, shoulderMargin: 8 })
    expect(HAIR_COVERAGE).toBe(0.99)
    expect(HAIR_EYE_LIMIT).toBe(0.05)
  })

  it('puts the cap in front and the long panel behind', () => {
    const { front, back } = splitHair(region, body, { density: DENSITY })
    expect(coverage(front, parts.cap)).toBeGreaterThan(0.98)
    expect(coverage(back, parts.panel)).toBeGreaterThan(0.98)
    expect(overlap(front, back)).toBe(0)
    // Nothing is lost and nothing is invented: the two layers are the region, cut in two.
    expect(solidCount(front) + solidCount(back)).toBe(solidCount(region))
  })

  it('keeps a lock lying on the shoulder in front of the body', () => {
    expect(coverage(splitHair(region, body, { density: DENSITY }).front, parts.shoulderLock)).toBeGreaterThan(0.98)
  })

  it('puts a bunch standing out beside the head, below the crown band, behind', () => {
    // Pins `crownBand` and `reach` by behaviour: a band down to the chin, or a reach of 20, takes part of it forward.
    expect(coverage(splitHair(region, body, { density: DENSITY }).back, parts.sideBunch)).toBeGreaterThan(0.98)
  })

  it('lets a front-mask override decide instead', () => {
    // A hand-drawn `item_hair_<code>_frontmask.png` that says the panel is the front: the rule is not consulted.
    const { front, back } = splitHair(region, body, { density: DENSITY, override: parts.panel })
    expect(coverage(front, parts.panel)).toBeGreaterThan(0.98)
    expect(coverage(back, parts.cap)).toBeGreaterThan(0.98)
    expect(coverage(back, parts.shoulderLock)).toBeGreaterThan(0.98)
    expect(coverage(back, parts.sideBunch)).toBeGreaterThan(0.98)
    expect(overlap(front, back)).toBe(0)
  })

  it('refuses a region or an override that is not the body’s size', () => {
    expect(() => splitHair(new Uint8Array(10), body, { density: DENSITY })).toThrow(/region/)
    expect(() => splitHair(region, body, { density: DENSITY, override: new Uint8Array(10) })).toThrow(/override/)
  })

  it('refuses a body that is not the frame at the density it is told', () => {
    // The margins are frame units × density: a @2x body split as @1x would grow the head by half the reach.
    expect(() => splitHair(region, body, { density: 1 })).toThrow('the body is 768 × 896, not the frame at density 1 (384 × 448)')
  })
})

describe('C13 the hair splits cleanly (checks.mjs, spec §5.4)', () => {
  let temp = ''
  const front = 'item_hair_f_bob01_L60'
  const back = 'item_hair_f_bob01_L20'
  const neutral = 'body_f_face_neutral_L50'

  beforeAll(() => {
    temp = mkdtempSync(join(tmpdir(), 'avatar-c13-'))
  })
  afterAll(() => rmSync(temp, { recursive: true, force: true }))

  /** A layer drawn as `mask` in one hair colour, its coverage in alpha — what ingest writes for a hair layer. */
  function hairPicture(mask: Mask): Picture {
    const data = Buffer.alloc(W * H * 4)
    for (let p = 0; p < mask.length; p++) {
      data[p * 4] = 92; data[p * 4 + 1] = 60; data[p * 4 + 2] = 44; data[p * 4 + 3] = mask[p]!
    }
    return { data, width: W, height: H }
  }
  /** A mask file: white, the coverage in alpha. */
  function maskPicture(mask: Mask): Picture {
    const data = Buffer.alloc(W * H * 4, 255)
    for (let p = 0; p < mask.length; p++) data[p * 4 + 3] = mask[p]!
    return { data, width: W, height: H }
  }

  /**
   * One case's directory: the two hair layers at @2x and, unless `withEyes` is false, the neutral face's eye mask
   * listed in the manifest. `split` is what ingest recorded for the region (`regionCount`, the synthetic region's own
   * count by default), whatever the layers now hold. The hair and the neutral face are real unless told they are
   * stand-ins.
   */
  async function hairCase(
    name: string,
    layers: { front: Mask; back: Mask },
    { withEyes = true, split = true, regionCount = solidCount(region), hairReal = true, faceReal = true } = {},
  ): Promise<{ dir: string; manifest: Manifest }> {
    const dir = join(temp, name)
    mkdirSync(dir, { recursive: true })
    await writePicture(hairPicture(layers.front), join(dir, `${front}@2x.png`))
    await writePicture(hairPicture(layers.back), join(dir, `${back}@2x.png`))
    const entry = (layer: number, real: boolean): Entry => ({ layer, w: FRAME.w, h: FRAME.h, bytes2x: 0, ...(real ? { real: true } : { placeholder: true }) })
    const files: Manifest['files'] = {
      [front]: { ...entry(60, hairReal), ...(split ? { split: { region: regionCount, front: 0, back: 0 } } : {}) },
      [back]: entry(20, hairReal),
    }
    if (withEyes) {
      await writePicture(maskPicture(eyes), join(dir, `${neutral}_eyemask@2x.png`))
      files[neutral] = { ...entry(50, faceReal), masks: { eyes: { bytes2x: 0, meanL: 0.2 } } }
    }
    return { dir, manifest: { files } }
  }

  async function c13Of(dir: string, manifest: Manifest, name = front): Promise<{ ok: boolean; detail: string }> {
    const [row] = await runChecks({ dir, manifest, names: [name] })
    return row!.results.find((result: { id: string }) => result.id === 'C13')!
  }

  it('C13 passes the split it was given, and fails an overlap, a lost strand and a fringe over the eyes', async () => {
    const split = splitHair(region, body, { density: DENSITY })

    // (a) The split as splitHair made it.
    const good = await hairCase('good', split)
    const a = await c13Of(good.dir, good.manifest)
    expect(a.ok, a.detail).toBe(true)
    expect(a.detail).toContain('no overlap')
    expect(a.detail).toContain('covers 1.00 of the hair')

    // (b) The same pixels written into both layers: every front pixel is in the back layer too.
    const twice = await hairCase('overlap', { front: split.front, back: region })
    const b = await c13Of(twice.dir, twice.manifest)
    expect(b.ok).toBe(false)
    expect(b.detail).toContain(`the two layers overlap at ${solidCount(split.front)} pixels`)

    // (c) The back layer emptied while split.region still counts it: only the cap and the lock are left.
    const lost = await hairCase('lost', { front: split.front, back: new Uint8Array(W * H) })
    const c = await c13Of(lost.dir, lost.manifest)
    expect(c.ok).toBe(false)
    expect(c.detail).toContain('covers 0.53 of the hair, want ≥ 0.99')

    // (d) A fringe grown down over the eyes: a band y 136–150 across the face, on top of the good split.
    const fringe = maskOf((x, y) => y > 135 && y <= 150 && x >= 150 && x <= 234)
    const over = await hairCase('eyes', { front: union(split.front, fringe), back: split.back })
    const d = await c13Of(over.dir, over.manifest)
    expect(d.ok).toBe(false)
    expect(d.detail).toContain('over the eyes on 33.2 % of the eye mask, want ≤ 5 %')
    expect(d.detail).not.toContain('overlap at')
  })

  it('C13 lets a fringe rest on the upper lashes (about 4 % of the eye mask) and fails one that hangs lower (about 7 %), Plan 19 C2 ruling', async () => {
    const split = splitHair(region, body, { density: DENSITY })
    // A band from the cap down over the top of both eyes, which run y 139–169: 2.5 and 3.5 frame units into them.
    const resting = maskOf((x, y) => y > 135 && y <= 141.4 && x >= 150 && x <= 234)
    const hanging = maskOf((x, y) => y > 135 && y <= 142.6 && x >= 150 && x <= 234)
    const share = (detail: string): number => Number(/on (\d+\.\d) %/.exec(detail)![1])

    const rest = await hairCase('lashes', { front: union(split.front, resting), back: split.back })
    const a = await c13Of(rest.dir, rest.manifest)
    expect(a.ok, a.detail).toBe(true)
    expect(share(a.detail)).toBeGreaterThan(3)
    expect(share(a.detail)).toBeLessThan(5)

    const hang = await hairCase('hanging', { front: union(split.front, hanging), back: split.back })
    const b = await c13Of(hang.dir, hang.manifest)
    expect(b.ok).toBe(false)
    expect(share(b.detail)).toBeGreaterThan(5)
    expect(share(b.detail)).toBeLessThan(8)
    expect(b.detail).toContain('of the eye mask, want ≤ 5 %')
  })

  it('C13 reports n/a for the L20, an L60 with no split, and the eyes without an eye mask', async () => {
    const split = splitHair(region, body, { density: DENSITY })
    const { dir, manifest } = await hairCase('na', split, { withEyes: false })
    const l20 = await c13Of(dir, manifest, back)
    expect(l20).toMatchObject({ ok: true, detail: 'n/a — checked with its L60' })
    const noEyes = await c13Of(dir, manifest)
    expect(noEyes.ok, noEyes.detail).toBe(true)
    expect(noEyes.detail).toContain(`eyes n/a — ${neutral} has no eye mask`)

    const unsplit = await hairCase('unsplit', split, { split: false })
    const none = await c13Of(unsplit.dir, unsplit.manifest)
    expect(none.ok).toBe(true)
    expect(none.detail.startsWith('n/a'), none.detail).toBe(true)
  })

  it('C13 holds the front to the eyes only like with like, and still checks overlap and coverage on a mixed pair', async () => {
    // Real hair over a stand-in face would be judged against eyes drawn where no head was measured (pre-flight #7,
    // R26), and stand-in hair against real eyes says nothing about the art: the fringe here covers a third of them.
    const split = splitHair(region, body, { density: DENSITY })
    const fringe = maskOf((x, y) => y > 135 && y <= 150 && x >= 150 && x <= 234)
    const fringed = { front: union(split.front, fringe), back: split.back }

    const realHair = await hairCase('mixed-real-hair', fringed, { faceReal: false })
    const a = await c13Of(realHair.dir, realHair.manifest)
    expect(a.ok, a.detail).toBe(true)
    expect(a.detail).toContain(`eyes n/a — ${neutral} is a stand-in`)

    const standInHair = await hairCase('mixed-stand-in-hair', fringed, { hairReal: false })
    const b = await c13Of(standInHair.dir, standInHair.manifest)
    expect(b.ok, b.detail).toBe(true)
    expect(b.detail).toContain(`eyes n/a — ${neutral} is real, this hair is a stand-in`)

    // The other two parts still hold on a mixed pair.
    const doubled = await hairCase('mixed-overlap', { front: fringed.front, back: region }, { faceReal: false })
    const c = await c13Of(doubled.dir, doubled.manifest)
    expect(c.ok).toBe(false)
    expect(c.detail).toContain('the two layers overlap at')
    expect(c.detail).not.toContain('over the eyes')

    // Both stand-ins: measured, and over the eyes.
    const standIns = await hairCase('both-stand-ins', fringed, { hairReal: false, faceReal: false })
    const d = await c13Of(standIns.dir, standIns.manifest)
    expect(d.ok).toBe(false)
    expect(d.detail).toContain('over the eyes on 33.2 % of the eye mask')
  })

  it('C13 prints a coverage of 0.57 as 0.57, not 0.56 (rounded down, without the float error)', async () => {
    // 57 / 100 * 100 is 56.99999999999999 in floating point: floored as it stands, that is 0.56.
    const layer = new Uint8Array(W * H)
    layer.fill(255, 300 * W + 300, 300 * W + 357)
    const { dir, manifest } = await hairCase('fifty-seven', { front: layer, back: new Uint8Array(W * H) }, { regionCount: 100 })
    const c13 = await c13Of(dir, manifest)
    expect(c13.ok).toBe(false)
    expect(c13.detail).toContain('the split covers 0.57 of the hair, want ≥ 0.99')
  })
})
