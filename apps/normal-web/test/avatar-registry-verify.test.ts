/**
 * The avatar registry's picture-handling half (Plan 12 Task 2, spec §4 step 3, §5, §6): `collect` (a
 * download into assets/avatar-src/), `verify` (every rule of spec §5, as amended on 2026-09-24 for the
 * image model's 1086 × 1448 edits) and `ingest` (into public/avatar/ and the catalogue).
 *
 * Every picture here is synthetic — a 1024 × 1536 transparent canvas with a flat figure drawn on it with
 * `sharp`, the way `avatar-pipeline.test.ts` builds its own — so a failure means the arithmetic is wrong,
 * not that a real picture changed. The two cases that run the pipeline itself ingest the synthetic base
 * into a temporary `public/avatar/` first; nothing under the real one is read or written.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ingest as pipelineIngest } from '../scripts/avatar-pipeline/extract.mjs'
import { MANIFEST_NAME } from '../scripts/avatar-pipeline/manifest.mjs'
import { alphaBBox, renderSvg, writePicture } from '../scripts/avatar-pipeline/png.mjs'
import { collect } from '../scripts/avatar-registry/collect.mjs'
import { addVariant, baseGaps, ingestAssets } from '../scripts/avatar-registry/ingest.mjs'
import { bodyBox, compareBoxes, comparePictures, scorePicture, verifyAssets } from '../scripts/avatar-registry/verify.mjs'

/* eslint-disable @typescript-eslint/no-explicit-any -- the registry and the score are plain JSON */
type Asset = any
type Registry = any

const W = 1024
const H = 1536

/**
 * The figure: hair, a face with two eyes, a neck, a torso, arms held out and two legs. Its box is
 * x 162–862, y 170–1340 — 700 × 1170, about the shape of the real F01 picture — and it measures 2.39
 * heads, inside D02 §8's 2.0–2.5.
 */
const HAIR = '#8a6a9a'
const figure = ({ hair = HAIR, eyes = '#202020' } = {}): string => `
  <ellipse cx="512" cy="420" rx="250" ry="250" fill="${hair}"/>
  <ellipse cx="512" cy="500" rx="200" ry="170" fill="#e0c0a0"/>
  <ellipse cx="440" cy="500" rx="30" ry="40" fill="${eyes}"/>
  <ellipse cx="584" cy="500" rx="30" ry="40" fill="${eyes}"/>
  <rect x="467" y="640" width="90" height="80" fill="#e0c0a0"/>
  <rect x="382" y="700" width="260" height="330" rx="30" fill="#808080"/>
  <rect x="162" y="800" width="222" height="70" rx="20" fill="#808080"/>
  <rect x="640" y="800" width="222" height="70" rx="20" fill="#808080"/>
  <rect x="410" y="1010" width="80" height="330" rx="20" fill="#808080"/>
  <rect x="534" y="1010" width="80" height="330" rx="20" fill="#808080"/>`

const svg = (body: string, width = W, height = H, background = ''): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${background}${body}</svg>`

/** A 16 px checkerboard of white and light grey — the fake transparency the image model sometimes paints. */
const PATTERN = `<defs><pattern id="c" width="32" height="32" patternUnits="userSpaceOnUse">
  <rect width="32" height="32" fill="#ffffff"/><rect width="16" height="16" fill="#cccccc"/><rect x="16" y="16" width="16" height="16" fill="#cccccc"/>
  </pattern></defs>`
const CHECKER = `${PATTERN}<rect width="100%" height="100%" fill="url(#c)"/>`
/** The same, with an 8 px square cut out of each corner, so only the band test can catch it. */
const CHECKER_OPEN_CORNERS = `${PATTERN}<path fill="url(#c)" fill-rule="evenodd" d="M0 0H${W}V${H}H0Z M0 0H8V8H0Z M${W - 8} 0H${W}V8H${W - 8}Z M0 ${H - 8}H8V${H}H0Z M${W - 8} ${H - 8}H${W}V${H}H${W - 8}Z"/>`

let temp = ''
let srcDir = ''
type Fixture =
  | 'ref' | 'happy' | 'shifted' | 'nudged' | 'wide' | 'small' | 'zoomed' | 'wider' | 'checker' | 'checkerCorners'
  | 'recoloured' | 'torso' | 'hat' | 'shirt' | 'face' | 'ring' | 'disc'
/** Every synthetic picture, by name, as a path under `srcDir`. */
const files = {} as Record<Fixture, string>

async function draw(name: string, content: string, width = W, height = H): Promise<string> {
  const file = join(srcDir, name)
  await writePicture(await renderSvg(content, width, height), file)
  return file
}

beforeAll(async () => {
  temp = mkdtempSync(join(tmpdir(), 'avatar-registry-verify-'))
  srcDir = join(temp, 'src')
  mkdirSync(srcDir, { recursive: true })
  files.ref = await draw('ref.png', svg(figure()))
  files.happy = await draw('happy.png', svg(figure({ eyes: '#6a2020' })))
  files.shifted = await draw('shifted.png', svg(`<g transform="translate(30 -20)">${figure()}</g>`))
  files.nudged = await draw('nudged.png', svg(`<g transform="translate(2 -1)">${figure()}</g>`))
  // The 2026-09-24 case: the same figure on a 3:4 canvas, 1086 × 1448, not scaled.
  files.wide = await draw('wide.png', svg(`<g transform="translate(31 -44)">${figure()}</g>`, 1086, 1448), 1086, 1448)
  files.small = await draw('small.png', svg(figure(), 720, 1080), 720, 1080)
  files.zoomed = await draw('zoomed.png', svg(`<g transform="translate(512 755) scale(1.2) translate(-512 -755)">${figure()}</g>`))
  files.wider = await draw('wider.png', svg(`<g transform="translate(512 0) scale(1.1 1) translate(-512 0)">${figure()}</g>`))
  files.checker = await draw('checker.png', svg(figure(), W, H, CHECKER))
  files.checkerCorners = await draw('checker-corners.png', svg(figure(), W, H, CHECKER_OPEN_CORNERS))
  files.recoloured = await draw('recoloured.png', svg(figure({ hair: '#d08030' })))
  files.torso = await draw('torso.png', svg(`${figure()}<rect x="420" y="850" width="180" height="150" fill="#cc2222"/>`))
  files.hat = await draw('hat.png', svg(`${figure()}<rect x="330" y="120" width="364" height="170" rx="20" fill="#cc2222"/>`))
  files.shirt = await draw('shirt.png', svg(`${figure()}<rect x="372" y="750" width="280" height="290" rx="30" fill="#2244cc"/>`))
  files.face = await draw('face.png', svg(`${figure()}<rect x="400" y="520" width="224" height="100" fill="#cc2222"/>`))
  const ring = (inner: string): string => svg(`<circle cx="512" cy="512" r="440" fill="none" stroke="#d0a030" stroke-width="80"/>${inner}`, 1024, 1024)
  files.ring = await draw('ring.png', ring(''), 1024, 1024)
  files.disc = await draw('disc.png', ring('<circle cx="512" cy="512" r="400" fill="#d0a030"/>'), 1024, 1024)
}, 120_000)

afterAll(() => rmSync(temp, { recursive: true, force: true }))

const score = (file: string, fields: Record<string, unknown>): Promise<any> =>
  scorePicture({ file, referenceFile: files.ref, pipeline: false, ...fields } as any)

// ──────────────────────────────────────────────────────────────── verify ──

describe('verify: size', () => {
  it('passes 1024 × 1536 and the model 1086 × 1448 edit, and records the size', async () => {
    const tall = await score(files.happy, { kind: 'expression' })
    expect(tall.verdict, tall.reason).toBe('ok')
    expect(tall.measure.size).toBe('1024×1536')
    const wide = await score(files.wide, { kind: 'expression' })
    expect(wide.verdict, wide.reason).toBe('ok')
    expect(wide.measure.size).toBe('1086×1448')
  })

  it('fails a picture too small to cut the @2x layer from', async () => {
    const result = await score(files.small, { kind: 'expression' })
    expect(result).toMatchObject({ verdict: 'ng', reason: 'size' })
  })

  it('holds an aura or a frame to a square of at least 1024', async () => {
    expect((await score(files.ring, { kind: 'frame', referenceFile: null })).verdict).toBe('ok')
    expect(await score(files.ref, { kind: 'aura', referenceFile: null })).toMatchObject({ verdict: 'ng', reason: 'size' })
  })
})

describe('verify: background', () => {
  it('fails a painted checkerboard', async () => {
    expect(await score(files.checker, { kind: 'expression' })).toMatchObject({ verdict: 'ng', reason: 'background' })
  })

  it('fails a checkerboard even with the four corners cleared', async () => {
    const result = await score(files.checkerCorners, { kind: 'expression' })
    expect(result).toMatchObject({ verdict: 'ng', reason: 'background' })
    expect(result.measure.checker).toBeGreaterThan(0.05)
  })
})

describe('verify: drift and redrawn', () => {
  it('passes a figure a pixel or two off, and fails one that moved in the frame', async () => {
    const nudged = await score(files.nudged, { kind: 'expression' })
    expect(nudged.verdict, nudged.reason).toBe('ok')
    expect(nudged.measure.drift).toEqual({ left: 2, top: -1, right: 2, bottom: -1 })
    const shifted = await score(files.shifted, { kind: 'expression' })
    expect(shifted).toMatchObject({ verdict: 'ng', reason: 'drift' })
    expect(shifted.measure.scale).toBeCloseTo(1, 2)
    expect(shifted.measure.drift).toEqual({ left: 30, top: -20, right: 30, bottom: -20 })
  })

  it('anchors a picture on another canvas before measuring the edges', async () => {
    const wide = await score(files.wide, { kind: 'expression' })
    expect(wide.measure.drift).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
    expect(wide.notes.join('\n')).toMatch(/another canvas/)
  })

  it('calls a zoomed figure redrawn, and records the scale', async () => {
    const result = await score(files.zoomed, { kind: 'expression' })
    expect(result).toMatchObject({ verdict: 'ng', reason: 'redrawn' })
    expect(result.measure.scale).toBeLessThan(0.9)
  })

  it('calls a figure drawn wider at the same height redrawn, and records both ratios', async () => {
    const result = await score(files.wider, { kind: 'expression' })
    expect(result).toMatchObject({ verdict: 'ng', reason: 'redrawn' })
    expect(result.measure.scale).toBeCloseTo(1, 2)
    expect(result.measure.widthRatio).toBeGreaterThan(1.04)
  })

  it('fails an edge more than 12 px off once scale and width pass', () => {
    const ref = { x: 162, y: 170, w: 700, h: 1170 }
    // 26 px more on the left only: width ratio 1.037 passes, the left edge is 26 px out.
    const result = compareBoxes({ x: 136, y: 170, w: 726, h: 1170 }, ref)
    expect(result.widthRatio).toBeLessThan(1.04)
    expect(result.reason).toBe('drift')
    expect(result.edges.left).toBe(-26)
    expect(compareBoxes({ x: 160, y: 172, w: 700, h: 1170 }, ref).reason).toBeNull()
  })

  it('lets an outfit shoe lower the bottom edge by up to 24 px, and nothing else', () => {
    const ref = { x: 162, y: 170, w: 700, h: 1170 }
    const shoes = (lower: number): { x: number; y: number; w: number; h: number } => ({ ...ref, h: ref.h + lower })
    expect(compareBoxes(shoes(19), ref, { kind: 'item', slot: 'outfit' })).toMatchObject({ reason: null, edges: { bottom: 19 } })
    expect(compareBoxes(shoes(24), ref, { kind: 'item', slot: 'outfit' }).reason).toBeNull()
    expect(compareBoxes(shoes(25), ref, { kind: 'item', slot: 'outfit' }).reason).toBe('drift')
    // Raised feet, a face item, or an outfit's side edge get no such allowance.
    expect(compareBoxes({ ...ref, h: ref.h - 13 }, ref, { kind: 'item', slot: 'outfit' }).reason).toBe('drift')
    expect(compareBoxes(shoes(19), ref, { kind: 'item', slot: 'face' }).reason).toBe('drift')
    expect(compareBoxes({ ...ref, x: ref.x + 13 }, ref, { kind: 'item', slot: 'outfit' }).reason).toBe('drift')
  })

  it('measures the top below the strand, and a head item not at all', () => {
    // The 2026-09-24 visor: the hat hides the ahoge, and the box top drops from 82 to 159.
    const ref = { x: 164, y: 82, w: 694, h: 1360, top: 160 }
    const visor = { x: 164, y: 159, w: 694, h: 1283, top: 110 }
    expect(compareBoxes(visor, ref, { kind: 'item', slot: 'head' })).toMatchObject({ scale: 1, reason: null, edges: { left: 0, top: null, right: 0, bottom: 0 } })
    expect(compareBoxes(visor, ref, { kind: 'item', slot: 'face' }).reason).not.toBeNull()
    // A strand redrawn 10 px taller moves the box top, not the head top: an expression still passes…
    const strand = { x: 164, y: 72, w: 694, h: 1370, top: 160 }
    expect(compareBoxes(strand, ref, { kind: 'expression' }).reason).toBeNull()
    // …and so does M01's sad face, where `measure()` took the strand for head (125 against 152) and the box did not move.
    const m01 = { x: 155, y: 80, w: 713, h: 1364, top: 152 }
    const sad = { x: 153, y: 79, w: 717, h: 1367, top: 125 }
    expect(compareBoxes(sad, m01, { kind: 'expression' })).toMatchObject({ reason: null, edges: { top: -1 } })
    // …and a new base, whose hair is its own, is held to the raw box.
    expect(compareBoxes({ ...strand, y: 60, h: 1382 }, ref, { kind: 'base' }).edges.top).toBe(-22)
  })

  it('holds a head item to its body, so a hat wider than the hair is not a redraw', async () => {
    // The 2026-09-24 conical hat: the figure's box grew 1.149× wide because of the brim, with the body untouched.
    const base = await renderSvg(svg(figure()), W, H)
    const hatted = await renderSvg(svg(`${figure()}<ellipse cx="512" cy="200" rx="400" ry="90" fill="#c8a860"/>`), W, H)
    expect(comparePictures(hatted, base, 'item', 'head').reason).toBeNull()
    expect(comparePictures(hatted, base, 'item', 'face').reason).toBe('redrawn')
    const box = alphaBBox(base)!
    const from = box.y + Math.floor(box.h * 0.5)
    expect(bodyBox(hatted, from)).toEqual(bodyBox(base, from))
  })
})

describe('verify: hair colour', () => {
  it('fails an expression whose hair came back another colour', async () => {
    const result = await score(files.recoloured, { kind: 'expression' })
    expect(result).toMatchObject({ verdict: 'ng', reason: 'hair_colour' })
    expect(result.measure.hairDelta).toBeGreaterThan(12)
  })
})

describe('verify: scope', () => {
  it('fails an expression that changed the body under the head region', async () => {
    const result = await score(files.torso, { kind: 'expression' })
    expect(result).toMatchObject({ verdict: 'ng', reason: 'scope' })
    expect(result.measure.scope).toBeGreaterThan(0.01)
  })

  it('lets a head item change the head, and only notes a changed body (the cut keeps the head rows alone)', async () => {
    const hat = await score(files.hat, { kind: 'item', slot: 'head' })
    expect(hat.verdict, hat.reason).toBe('ok')
    // The 2026-09-24 party hat: arms held out, body 1.107× wide, a clean layer all the same.
    const torso = await score(files.torso, { kind: 'item', slot: 'head' })
    expect(torso.verdict, torso.reason).toBe('ok')
    expect(torso.measure.scope).toBeGreaterThanOrEqual(0.01)
    expect(torso.notes.join(' ')).toMatch(/advisory for a head item/)
  })

  it('does not ask it of an outfit, whose cut discards the head a generator redrew', async () => {
    const shirt = await score(files.shirt, { kind: 'item', slot: 'outfit' })
    expect(shirt.verdict, shirt.reason).toBe('ok')
    const redrawnHead = await score(files.face, { kind: 'item', slot: 'outfit' })
    expect(redrawnHead.verdict, redrawnHead.reason).toBe('ok')
    expect(redrawnHead.measure.scope).toBeUndefined()
  })
})

describe('verify: an aura or a frame', () => {
  it('passes a hollow ring and fails a filled disc', async () => {
    const ring = await score(files.ring, { kind: 'aura', referenceFile: null })
    expect(ring.verdict, ring.reason).toBe('ok')
    expect(ring.measure.hollow).toBeLessThan(0.05)
    expect(await score(files.disc, { kind: 'frame', referenceFile: null })).toMatchObject({ verdict: 'ng', reason: 'hollow' })
  })
})

describe('verify: the pipeline', () => {
  let publicDir = ''

  beforeAll(async () => {
    publicDir = join(temp, 'public')
    mkdirSync(publicDir, { recursive: true })
    await pipelineIngest({ file: files.ref, target: { kind: 'base', base: 'f01' }, dir: publicDir, targets: [join(publicDir, MANIFEST_NAME)] })
  }, 120_000)

  it('ingests into a copy, runs the checks on what it wrote, and leaves public/avatar alone', async () => {
    const before = readFileSync(join(publicDir, MANIFEST_NAME), 'utf8')
    const listed = readdirSync(publicDir).sort()
    const result = await scorePicture({ file: files.happy, referenceFile: files.ref, kind: 'expression', ingest: { as: 'expr:f01:happy', base: 'f01', variant: null, flags: [] }, publicDir })
    expect(result.verdict, JSON.stringify(result.measure)).toBe('ok')
    expect(result.measure.checks).toEqual({ base_f01_face_happy_L50: [] })
    expect(readFileSync(join(publicDir, MANIFEST_NAME), 'utf8')).toBe(before)
    expect(readdirSync(publicDir).sort()).toEqual(listed)
  }, 120_000)

  it('ingests a new base from the reference first, when the expression belongs to one', async () => {
    const result = await scorePicture({ file: files.happy, referenceFile: files.ref, kind: 'expression', ingest: { as: 'expr:f09:happy', base: 'f09', variant: null, flags: [] }, publicDir })
    expect(result.verdict, JSON.stringify(result.measure)).toBe('ok')
    expect(Object.keys(result.measure.checks)).toEqual(['base_f09_face_happy_L50'])
  }, 120_000)

  it('skips a bot, which the pipeline has no target for yet', async () => {
    const result = await scorePicture({ file: files.ref, referenceFile: files.ref, kind: 'bot', ingest: { as: 'bot:0', base: null, variant: null, flags: [] }, publicDir })
    expect(result.verdict, result.reason).toBe('ok')
    expect(result.reason).toBeNull()
    expect(result.notes).toContain('pipeline: skipped (bot)')
  }, 60_000)
})

// ─────────────────────────────────────────────────── verify on the registry ──

function registryOf(assets: Asset[]): Registry {
  return { version: 1, meta: {}, templates: {}, assets }
}

function auraAsset(id: string, file: string, attempts: Asset[]): Asset {
  return {
    id, kind: 'aura', slot: 'aura', wear: null, catalog: id, look: { description: 'x' }, reference: null, prompt: null, file,
    ingest: { as: `item:aura:${id}`, base: null, variant: null, flags: [] }, status: 'generated', attempts,
  }
}

describe('verifyAssets', () => {
  it('records the verdict and the numbers on the last attempt, and blocks the third failure', async () => {
    const good = auraAsset('good01', 'ring.png', [{ n: 1, verdict: null }])
    const bad = auraAsset('bad01', 'disc.png', [{ n: 1, verdict: null }])
    const last = auraAsset('last01', 'disc.png', [{ n: 1, verdict: 'ng', reason: 'hollow' }, { n: 2, verdict: 'ng', reason: 'hollow' }, { n: 3, verdict: null }])
    const untouched = { ...auraAsset('todo01', 'ring.png', []), status: 'todo' }
    const registry = registryOf([good, bad, last, untouched])
    await verifyAssets(registry, [], { srcDir })
    expect(good.status).toBe('ok')
    expect(good.attempts[0]).toMatchObject({ verdict: 'ok', reason: null })
    expect(good.attempts[0].measure.size).toBe('1024×1024')
    expect(bad.status).toBe('ng')
    expect(bad.attempts[0]).toMatchObject({ verdict: 'ng', reason: 'hollow' })
    expect(last.status).toBe('blocked')
    expect(untouched.status).toBe('todo')
  }, 60_000)
})

// ─────────────────────────────────────────────────────────────── collect ──

describe('collect', () => {
  const now = Date.parse('2026-09-24T10:00:00Z')
  let downloads = ''
  let into = ''

  function png(name: string, secondsAgo: number): string {
    const file = join(downloads, name)
    writeFileSync(file, `picture ${name}`)
    const at = new Date(now - secondsAgo * 1000)
    utimesSync(file, at, at)
    return file
  }

  function hatAsset(attempts: Asset[] = []): Asset {
    return {
      id: 'item_head_beret_red01', kind: 'item', slot: 'head', wear: null, catalog: 'head_beret_red01', look: { description: 'x' },
      reference: 'ref.png', prompt: null, file: 'item_head_beret_red01.png',
      ingest: { as: 'item:head:beret_red01', base: null, variant: null, flags: [] }, status: attempts.length ? 'ng' : 'todo', attempts,
    }
  }

  beforeAll(() => {
    downloads = join(temp, 'downloads')
    into = join(temp, 'collected')
    mkdirSync(downloads, { recursive: true })
    mkdirSync(into, { recursive: true })
    png('ChatGPT Image Sep 24, 2026, 09_50_00 AM.png', 600)
    png('ChatGPT Image Sep 24, 2026, 09_59_00 AM.png', 60)
    writeFileSync(join(downloads, 'newer.jpg'), 'not a png')
  })

  it('takes the newest PNG, records the attempt and marks the asset generated', () => {
    const asset = hatAsset()
    const registry = registryOf([asset])
    const result = collect(registry, asset.id, { chat: 'https://chatgpt.com/c/abc', downloads, srcDir: into, now })
    expect(result.from).toContain('09_59_00')
    expect(readFileSync(join(into, asset.file), 'utf8')).toContain('09_59_00')
    expect(asset.status).toBe('generated')
    expect(asset.attempts).toEqual([{ n: 1, at: new Date(now).toISOString(), chat: 'https://chatgpt.com/c/abc', file: asset.file, verdict: null }])
  })

  it('keeps the picture it replaces as <name>.prev<k>.png', () => {
    const asset = hatAsset([{ n: 1, at: new Date(now - 3600_000).toISOString(), verdict: 'ng', reason: 'scope' }])
    const registry = registryOf([asset])
    collect(registry, asset.id, { chat: 'https://chatgpt.com/c/def', downloads, srcDir: into, now })
    expect(existsSync(join(into, 'item_head_beret_red01.prev1.png'))).toBe(true)
    asset.status = 'ng'
    // `--file` names the picture outright; it lives outside the downloads folder so the other cases never see it.
    const explicit = join(temp, 'explicit.png')
    writeFileSync(explicit, 'picture explicit')
    collect(registry, asset.id, { chat: 'https://chatgpt.com/c/ghi', file: explicit, srcDir: into, now })
    expect(existsSync(join(into, 'item_head_beret_red01.prev2.png'))).toBe(true)
    expect(readFileSync(join(into, asset.file), 'utf8')).toContain('explicit')
    expect(asset.attempts.map((attempt: Asset) => attempt.n)).toEqual([1, 2, 3])
  })

  it('refuses a newest PNG older than the last attempt, saying what it found', () => {
    const asset = hatAsset([{ n: 1, at: new Date(now - 30_000).toISOString(), verdict: 'ng', reason: 'scope' }])
    expect(() => collect(registryOf([asset]), asset.id, { chat: 'x', downloads, srcDir: into, now })).toThrow(/09_59_00.*older/s)
    expect(asset.attempts).toHaveLength(1)
  })

  it('refuses a download older than 30 minutes when there is no attempt to compare with', () => {
    const empty = join(temp, 'old-downloads')
    mkdirSync(empty, { recursive: true })
    const file = join(empty, 'old.png')
    writeFileSync(file, 'old')
    const at = new Date(now - 31 * 60_000)
    utimesSync(file, at, at)
    expect(() => collect(registryOf([hatAsset()]), 'item_head_beret_red01', { chat: 'x', downloads: empty, srcDir: into, now })).toThrow(/old\.png/)
  })

  it('refuses an asset that is not waiting for a picture', () => {
    const asset = { ...hatAsset(), status: 'blocked' }
    expect(() => collect(registryOf([asset]), asset.id, { chat: 'x', downloads, srcDir: into, now })).toThrow(/blocked/)
  })
})

// ──────────────────────────────────────────────────────────────── ingest ──

const ITEMS_JSON = `[
  { "id": "outfit_casual01", "slot": "outfit", "rarity": "common", "nameKey": "items.outfit_casual01", "assetKey": "outfit/outfit_casual01", "isDefault": true,
    "asset": { "layer": 40, "file": "item_outfit_casual01_L40", "fitsAvatarCrop": false } },
  { "id": "outfit_dealer01", "slot": "outfit", "rarity": "rare", "nameKey": "items.outfit_dealer01", "assetKey": "outfit/outfit_dealer01", "isDefault": false,
    "asset": { "layer": 40, "file": "item_outfit_dealer01_L40", "variants": { "m": "item_outfit_dealer01_m_L40" }, "fitsAvatarCrop": false } }
]
`

describe('addVariant', () => {
  it('adds variants.<wear> to the one item, keeping the file formatted as it was', () => {
    const out = addVariant(ITEMS_JSON, 'outfit_casual01', 'm', 'item_outfit_casual01_m_L40')
    expect(out).toContain('"file": "item_outfit_casual01_L40", "variants": { "m": "item_outfit_casual01_m_L40" }, "fitsAvatarCrop": false')
    expect(JSON.parse(out)[0].asset.variants).toEqual({ m: 'item_outfit_casual01_m_L40' })
    expect(out.split('\n').length).toBe(ITEMS_JSON.split('\n').length)
  })

  it('adds a second wear into an existing variants object, and leaves a present one alone', () => {
    const out = addVariant(ITEMS_JSON, 'outfit_dealer01', 'f', 'item_outfit_dealer01_f_L40')
    expect(JSON.parse(out)[1].asset.variants).toEqual({ f: 'item_outfit_dealer01_f_L40', m: 'item_outfit_dealer01_m_L40' })
    expect(addVariant(ITEMS_JSON, 'outfit_dealer01', 'm', 'item_outfit_dealer01_m_L40')).toBe(ITEMS_JSON)
  })
})

describe('baseGaps', () => {
  it('names every place a new base still has to be added by hand, and nothing that is already there', () => {
    const basesFile = join(temp, 'avatar-bases.json')
    writeFileSync(basesFile, JSON.stringify({ f01: {}, f02: {} }))
    const vi = join(temp, 'vi.json')
    const en = join(temp, 'en.json')
    writeFileSync(vi, JSON.stringify({ bases: { f01: 'a', f02: 'b' } }))
    writeFileSync(en, JSON.stringify({ bases: { f01: 'a' } }))
    const gaps = baseGaps('f02', 'f', { basesFile, localeFiles: [vi, en] })
    expect(gaps).toHaveLength(3)
    expect(gaps[0]).toMatch(/BASES .*f02/)
    expect(gaps[1]).toMatch(/BASE_WEAR .*f02.*'f'/)
    expect(gaps[2]).toContain(`${en}: bases.f02`)
    expect(baseGaps('f01', 'f', { basesFile, localeFiles: [vi, en] })).toEqual([])
    expect(baseGaps('m03', 'm', { basesFile, localeFiles: [vi] }).join('\n')).toMatch(/avatar-bases\.json.*m03/)
  })
})

describe('ingestAssets', () => {
  it('ingests a per-wear outfit, adds variants.m to the catalogue, marks it ingested, and leaves a bot for later', async () => {
    const publicDir = join(temp, 'public-ingest')
    mkdirSync(publicDir, { recursive: true })
    const targets = [join(publicDir, MANIFEST_NAME)]
    await pipelineIngest({ file: files.ref, target: { kind: 'base', base: 'm01' }, dir: publicDir, targets })
    const itemsFile = join(temp, 'items.json')
    writeFileSync(itemsFile, ITEMS_JSON)
    const outfit: Asset = {
      id: 'item_outfit_casual01:m', kind: 'item', slot: 'outfit', wear: 'm', catalog: 'outfit_casual01', look: { description: 'x' },
      reference: 'ref.png', prompt: null, file: 'shirt.png',
      ingest: { as: 'item:outfit:casual01', base: 'm01', variant: 'm', flags: [] }, status: 'approved', attempts: [{ n: 1, verdict: 'ok' }],
    }
    const bot: Asset = {
      id: 'bot_0', kind: 'bot', slot: null, wear: null, catalog: 'bot_0', look: { description: 'x', expression: 'y' },
      reference: 'ref.png', prompt: null, file: 'ref.png',
      ingest: { as: 'bot:0', base: null, variant: null, flags: [] }, status: 'ok', attempts: [{ n: 1, verdict: 'ok' }],
    }
    const lines: string[] = []
    await ingestAssets(registryOf([outfit, bot]), [], { srcDir, publicDir, targets, itemsFile, log: (line: string) => lines.push(line) })
    expect(outfit.ingested).toBe(true)
    expect(JSON.parse(readFileSync(itemsFile, 'utf8'))[0].asset.variants).toEqual({ m: 'item_outfit_casual01_m_L40' })
    const manifest = JSON.parse(readFileSync(targets[0]!, 'utf8'))
    expect(manifest.files.item_outfit_casual01_m_L40).toMatchObject({ real: true, wear: 'm', variantOf: 'item_outfit_casual01_L40' })
    expect(lines.join('\n')).toMatch(/registered on m01/)
    expect(bot.ingested).toBeUndefined()
    expect(bot.status).toBe('ok')
    expect(lines.join('\n')).toMatch(/bot_0: not supported yet/)
  }, 120_000)
})
