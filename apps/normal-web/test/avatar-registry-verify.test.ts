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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ingest as pipelineIngest } from '../scripts/avatar-pipeline/extract.mjs'
import { anchorBase } from '../scripts/avatar-pipeline/frame.mjs'
import { MANIFEST_NAME } from '../scripts/avatar-pipeline/manifest.mjs'
import { alphaBBox, renderSvg, writePicture } from '../scripts/avatar-pipeline/png.mjs'
import { collect } from '../scripts/avatar-registry/collect.mjs'
import { addVariant, baseGaps, ingestAssets } from '../scripts/avatar-registry/ingest.mjs'
import { parseSpec } from '../scripts/avatar-registry/registry.mjs'
import {
  HAIR_BODY_MARGIN, allowedArea, bodyBox, compareBoxes, comparePictures, kindOfSpec, layerNames, ownerOf, scorePicture, verifyAssets,
} from '../scripts/avatar-registry/verify.mjs'

// Every case here renders synthetic pictures and runs the real pipeline on them: 3–6 s each on this machine, and
// past vitest's 5 s default when the suite shares the CPU with typecheck or a build. The budget is the work, not a
// hang, so the ceiling is generous.
vi.setConfig({ testTimeout: 60_000 })

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
const SKIN = '#e0c0a0'
const figure = ({ hair = HAIR, eyes = '#202020', head = 250 } = {}): string => `
  <ellipse cx="512" cy="420" rx="${head}" ry="${head}" fill="${hair}"/>
  <ellipse cx="512" cy="500" rx="200" ry="170" fill="#e0c0a0"/>
  <ellipse cx="440" cy="500" rx="30" ry="40" fill="${eyes}"/>
  <ellipse cx="584" cy="500" rx="30" ry="40" fill="${eyes}"/>
  <rect x="467" y="640" width="90" height="80" fill="#e0c0a0"/>
  <rect x="382" y="700" width="260" height="330" rx="30" fill="#808080"/>
  <rect x="162" y="800" width="222" height="70" rx="20" fill="#808080"/>
  <rect x="640" y="800" width="222" height="70" rx="20" fill="#808080"/>
  <rect x="410" y="1010" width="80" height="330" rx="20" fill="#808080"/>
  <rect x="534" y="1010" width="80" height="330" rx="20" fill="#808080"/>`

/**
 * A v4 body (Plan 19): the same figure with a bald head — a skin-coloured dome 20 px lower and 40 px narrower than
 * the hair outline, as the body template asks. Its box is x 162–862 (the arms), y 190–1340.
 */
const bald = ({ eyes = '#202020' } = {}): string => figure({ hair: SKIN, eyes, head: 230 })
/**
 * A hairstyle's colour: dark brown (m_spiky01's), well away from the grey clothing — `HAIR` lies within the scope
 * rule's RGB distance 40 of it (35.5), so a lock of `HAIR` over the tank top would not read as a change at all.
 */
const BROWN = '#4a2c1d'
/** A hairstyle on that body: a cap over the top of the head, above the eyes. */
const CAP = `<ellipse cx="512" cy="310" rx="250" ry="140" fill="${BROWN}"/>`
/** …a lock hanging behind the shoulder, outside the body: x 300–370 beside the torso (x 382), y 880–1000 below the arm. */
const LOCK = `<rect x="300" y="880" width="70" height="120" fill="${BROWN}"/>`
/** …and the same hair painted over the torso, which a hairstyle never does. */
const OVER_TORSO = `<rect x="420" y="850" width="180" height="150" fill="${BROWN}"/>`

const svg =(body: string, width = W, height = H, background = ''): string =>
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
  | 'bald' | 'baldHappy' | 'baldTorso' | 'bodyRaised' | 'hairOk' | 'hairTorso' | 'hairWide'
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
  // Plan 19: a body, its happy face, a face that changed the torso, a body whose feet sit 20 px higher, and hairstyles.
  files.bald = await draw('bald.png', svg(bald()))
  files.baldHappy = await draw('bald-happy.png', svg(bald({ eyes: '#6a2020' })))
  files.baldTorso = await draw('bald-torso.png', svg(`${bald()}<rect x="420" y="850" width="180" height="150" fill="#cc2222"/>`))
  files.bodyRaised = await draw('body-raised.png', svg(`<g transform="translate(0 -20)">${bald()}</g>`))
  files.hairOk = await draw('hair-ok.png', svg(`${bald()}${CAP}${LOCK}`))
  files.hairTorso = await draw('hair-torso.png', svg(`${bald()}${CAP}${OVER_TORSO}`))
  files.hairWide = await draw('hair-wide.png', svg(`<g transform="translate(31 -44)">${bald()}${CAP}${LOCK}</g>`, 1086, 1448), 1086, 1448)
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

describe('verify: the v4 kinds (Plan 19)', () => {
  it('reads what kind of asset a v4 spec describes', () => {
    expect(kindOfSpec('hair:m_neat01')).toEqual({ kind: 'hair', slot: null })
    expect(kindOfSpec('face:f:sad')).toEqual({ kind: 'bodyExpression', slot: null })
    expect(kindOfSpec('body:m')).toEqual({ kind: 'body', slot: null })
    expect(kindOfSpec('expr:f02:sad')).toEqual({ kind: 'expression', slot: null })
    expect(kindOfSpec('item:outfit:casual01')).toEqual({ kind: 'item', slot: 'outfit' })
  })

  it('names the layers each v4 target writes', () => {
    expect(layerNames({ kind: 'hair', code: 'm_neat01', gender: 'm' }, 'm')).toEqual(['item_hair_m_neat01_L20', 'item_hair_m_neat01_L60'])
    expect(layerNames(parseSpec('body:f'), 'f')).toEqual(['body_f_L30', 'body_f_face_neutral_L50'])
    expect(layerNames(parseSpec('face:m:sleep'), 'm')).toEqual(['body_m_face_sleep_L50'])
    expect(layerNames(parseSpec('item:outfit:dealer01'), 'm', 'm')).toEqual(['item_outfit_dealer01_m_L40'])
  })

  it('names the owner of a v4 ingest: a body, a face or a hairstyle its gender, an item its --base', () => {
    expect(ownerOf(parseSpec('body:m'), null)).toBe('m')
    expect(ownerOf(parseSpec('face:f:happy'), null)).toBe('f')
    expect(ownerOf(parseSpec('hair:m_spiky01'), { base: null })).toBe('m')
    expect(ownerOf(parseSpec('item:outfit:casual01'), { base: 'f' })).toBe('f')
    expect(ownerOf(parseSpec('item:head:beret_red01'), { base: null })).toBe('f01')
  })

  it('holds a body to its feet and centre line only: a bald head lower and narrower than the hair is fine', async () => {
    const body = await score(files.bald, { kind: 'body' })
    expect(body.verdict, body.reason).toBe('ok')
    expect(body.measure.drift).toEqual({ left: null, top: null, right: null, bottom: 0, centre: 0 })
    expect(body.measure.heads).toBeGreaterThanOrEqual(2)
    expect(body.measure.heads).toBeLessThanOrEqual(2.5)
    expect(body.measure.hairDelta).toBeUndefined()
    expect(body.measure.scope).toBeUndefined()
    // The same picture held to all four edges, as an expression is, drifts on its top.
    expect(await score(files.bald, { kind: 'expression' })).toMatchObject({ verdict: 'ng', reason: 'drift' })
  })

  it('fails a body whose feet sit 20 px higher than the reference, and one on another canvas (it is cut on f01)', async () => {
    const raised = await score(files.bodyRaised, { kind: 'body' })
    expect(raised).toMatchObject({ verdict: 'ng', reason: 'drift' })
    expect(raised.measure.drift).toMatchObject({ bottom: -20, centre: 0 })
    expect(await score(files.wide, { kind: 'body' })).toMatchObject({ verdict: 'ng', reason: 'redrawn' })
  })

  it('scores a body expression as an expression, against its body', async () => {
    const happy = await score(files.baldHappy, { kind: 'bodyExpression', referenceFile: files.bald })
    expect(happy.verdict, happy.reason).toBe('ok')
    expect(happy.measure.drift).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
    expect(happy.measure.hairDelta).toBe(0)
    expect(happy.measure.scope).toBeLessThan(0.01)
    const torso = await score(files.baldTorso, { kind: 'bodyExpression', referenceFile: files.bald })
    expect(torso).toMatchObject({ verdict: 'ng', reason: 'scope' })
  })

  it('holds a hairstyle to its feet and centre line, lets it fall outside the body, and asks neither heads nor hair colour', async () => {
    const hair = await score(files.hairOk, { kind: 'hair', referenceFile: files.bald })
    expect(hair.verdict, hair.reason).toBe('ok')
    expect(hair.measure.drift).toEqual({ left: null, top: null, right: null, bottom: 0, centre: 0 })
    expect(hair.measure.scope).toBeLessThan(0.01)
    expect(hair.measure.heads).toBeUndefined()
    expect(hair.measure.hairDelta).toBeUndefined()
  })

  it('fails a hairstyle that paints over the torso on scope', async () => {
    const torso = await score(files.hairTorso, { kind: 'hair', referenceFile: files.bald })
    expect(torso).toMatchObject({ verdict: 'ng', reason: 'scope' })
    expect(torso.measure.scope).toBeGreaterThan(0.01)
  })

  it('places a hairstyle on another canvas by its feet and centre line before measuring scope', async () => {
    const wide = await score(files.hairWide, { kind: 'hair', referenceFile: files.bald })
    expect(wide.verdict, wide.reason).toBe('ok')
    expect(wide.notes.join('\n')).toMatch(/another canvas/)
    expect(wide.measure.scope).toBeLessThan(0.01)
  })

  it("allows a hairstyle above the face line and outside the body grown by 4 px, and nowhere else", async () => {
    const ref = await renderSvg(svg(bald()), W, H)
    const allowed = allowedArea('hair', null, anchorBase(ref), ref)!
    expect(HAIR_BODY_MARGIN).toBe(4)
    expect(allowed(512, 300)).toBe(true) // the head
    expect(allowed(512, 700)).toBe(true) // the neck, above FACE_LIMIT_Y on this figure
    expect(allowed(512, 950)).toBe(false) // the torso
    expect(allowed(200, 835)).toBe(false) // an arm
    expect(allowed(320, 950)).toBe(true) // beside the torso, behind the shoulder
    // The torso's left side is x 382: 4 px out is still the body's, 5 px out is not.
    expect(allowed(378, 950)).toBe(false)
    expect(allowed(377, 950)).toBe(true)
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

  it('runs a bot through the pipeline on f01 transform, and checks its body and all six faces', async () => {
    const result = await scorePicture({ file: files.ref, referenceFile: files.ref, kind: 'bot', ingest: { as: 'bot:0', base: null, variant: null, flags: [] }, publicDir })
    expect(result.verdict, JSON.stringify(result.measure)).toBe('ok')
    expect(result.notes).not.toContain('pipeline: skipped (bot)')
    expect(Object.keys(result.measure.checks).sort()).toEqual(['bot_0_L30', ...['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep'].map((expr) => `bot_0_face_${expr}_L50`)].sort())
    for (const failed of Object.values(result.measure.checks)) expect(failed).toEqual([])
  }, 120_000)

  it('checks only the face a bot happy picture writes', async () => {
    const result = await scorePicture({ file: files.happy, referenceFile: files.ref, kind: 'bot', ingest: { as: 'bot:0:happy', base: null, variant: null, flags: [] }, publicDir })
    expect(result.verdict, JSON.stringify(result.measure)).toBe('ok')
    expect(result.measure.checks).toEqual({ bot_0_face_happy_L50: [] })
  }, 120_000)

  it('runs an aura and a frame through the pipeline once they pass hollow, and leaves public/avatar alone', async () => {
    const before = readFileSync(join(publicDir, MANIFEST_NAME), 'utf8')
    const aura = await scorePicture({ file: files.ring, kind: 'aura', slot: 'aura', ingest: { as: 'item:aura:water01', base: null, variant: null, flags: [] }, publicDir })
    expect(aura.verdict, JSON.stringify(aura)).toBe('ok')
    expect(aura.measure.hollow).toBeLessThan(0.05)
    expect(aura.measure.checks).toEqual({ item_aura_water01_L10: [] })
    const frame = await scorePicture({ file: files.ring, kind: 'frame', slot: 'frame', ingest: { as: 'item:frame:gold', base: null, variant: null, flags: [] }, publicDir })
    expect(frame.verdict, JSON.stringify(frame)).toBe('ok')
    expect(frame.measure.checks).toEqual({ item_frame_gold_L90: [] })
    // hollow still comes first: a disc never reaches the pipeline.
    const disc = await scorePicture({ file: files.disc, kind: 'frame', slot: 'frame', ingest: { as: 'item:frame:gold', base: null, variant: null, flags: [] }, publicDir })
    expect(disc).toMatchObject({ verdict: 'ng', reason: 'hollow' })
    expect(disc.measure.checks).toBeUndefined()
    expect(readFileSync(join(publicDir, MANIFEST_NAME), 'utf8')).toBe(before)
  }, 120_000)

  it('names the layers each ingest target writes', () => {
    const faces = (bot: number): string[] => ['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep'].map((expr) => `bot_${bot}_face_${expr}_L50`)
    expect(layerNames({ kind: 'item', slot: 'aura', code: 'water01' }, 'f01')).toEqual(['item_aura_water01_L10'])
    expect(layerNames({ kind: 'item', slot: 'frame', code: 'gold' }, 'f01')).toEqual(['item_frame_gold_L90'])
    expect(layerNames(parseSpec('bot:3'), 'f01')).toEqual(['bot_3_L30', ...faces(3)])
    expect(layerNames(parseSpec('bot:3:happy'), 'f01')).toEqual(['bot_3_face_happy_L50'])
  })

  // ── Plan 19: the v4 targets in the copy ──

  const spec = (as: string, flags: string[] = [], base: string | null = null): Asset => ({ as, base, variant: null, flags })

  /** Score with `keepTmp`, hand back the copy's manifest, and remove the copy. */
  async function scoreKeeping(fields: Record<string, unknown>): Promise<{ result: any; copy: any }> {
    const lines: string[] = []
    const result = await scorePicture({ publicDir, keepTmp: true, log: (line: string) => lines.push(line), ...fields } as any)
    const kept = /^kept (.+)$/.exec(lines.find((line) => line.startsWith('kept ')) ?? '')?.[1]
    expect(kept, lines.join('\n')).toBeDefined()
    const copy = JSON.parse(readFileSync(join(kept!, 'avatar', MANIFEST_NAME), 'utf8'))
    rmSync(kept!, { recursive: true, force: true })
    return { result, copy }
  }

  it('checks a body on its two layers, cut in the copy on f01 transform', async () => {
    const { result, copy } = await scoreKeeping({ file: files.bald, referenceFile: files.ref, kind: 'body', ingest: spec('body:f') })
    expect(result.measure.pipelineError, JSON.stringify(result)).toBeUndefined()
    expect(Object.keys(result.measure.checks).sort()).toEqual(['body_f_L30', 'body_f_face_neutral_L50'])
    expect(copy.bodies.f.transform).toEqual(copy.bases.f01.transform)
  }, 120_000)

  it('ingests the reference as body:<g> first when the copy has no body yet, then checks both hair layers', async () => {
    const before = readFileSync(join(publicDir, MANIFEST_NAME), 'utf8')
    expect(JSON.parse(before).bodies?.f).toBeUndefined()
    const { result, copy } = await scoreKeeping({ file: files.hairOk, referenceFile: files.bald, kind: 'hair', ingest: spec('hair:f_bob01') })
    expect(result.measure.pipelineError, JSON.stringify(result)).toBeUndefined()
    expect(Object.keys(result.measure.checks).sort()).toEqual(['item_hair_f_bob01_L20', 'item_hair_f_bob01_L60'])
    expect(copy.bodies.f.transform).toEqual(copy.bases.f01.transform)
    expect(copy.files.body_f_L30).toMatchObject({ real: true })
    expect(readFileSync(join(publicDir, MANIFEST_NAME), 'utf8')).toBe(before)
  }, 120_000)

  it('cuts a v4 bot on its body, ingesting the body from the reference only when the reference is that body', async () => {
    const { result, copy } = await scoreKeeping({ file: files.bald, referenceFile: files.bald, kind: 'bot', ingest: spec('bot:0'), transformFrom: 'f', referenceOwner: 'f' })
    expect(result.measure.pipelineError, JSON.stringify(result)).toBeUndefined()
    expect(Object.keys(result.measure.checks)).toContain('bot_0_L30')
    expect(copy.files.bot_0_L30.cutOn).toBe('f')
    // A happy face is drawn from the bot's own picture, which cannot stand in for body f.
    const happy = await scorePicture({ file: files.baldHappy, referenceFile: files.bald, kind: 'bot', ingest: spec('bot:0:happy'), transformFrom: 'f', referenceOwner: null, publicDir })
    expect(happy).toMatchObject({ verdict: 'ng', reason: 'pipeline' })
    expect(happy.measure.pipelineError).toMatch(/no body f in .* and no reference/)
  }, 120_000)

  it('passes an asset --recolour-to, --hair and --anchor through to the pipeline', async () => {
    // Each on a target it does not belong to, so the pipeline's own refusal shows it arrived.
    const recolour = await scorePicture({ file: files.bald, referenceFile: files.ref, kind: 'body', ingest: spec('body:f', ['--recolour-to', '#5e3e6f']), publicDir })
    expect(recolour.measure.pipelineError).toMatch(/--recolour-to belongs to a hairstyle/)
    const hair = await scorePicture({ file: files.bald, referenceFile: files.ref, kind: 'body', ingest: spec('body:f', ['--hair', 'f_bob01']), publicDir })
    expect(hair.measure.pipelineError).toMatch(/--hair belongs to a worn item/)
    const anchor = await scorePicture({ file: files.hat, referenceFile: files.ref, kind: 'item', slot: 'head', ingest: spec('item:head:x01', ['--anchor', 'head'], 'f01'), publicDir })
    expect(anchor.measure.pipelineError).toMatch(/--anchor head belongs to a body/)
  }, 120_000)
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
    // f09 is a base nothing knows yet (f02–m03 joined BASES on 2026-09-24).
    writeFileSync(basesFile, JSON.stringify({ f01: {}, f09: {} }))
    const vi = join(temp, 'vi.json')
    const en = join(temp, 'en.json')
    writeFileSync(vi, JSON.stringify({ bases: { f01: 'a', f09: 'b' } }))
    writeFileSync(en, JSON.stringify({ bases: { f01: 'a' } }))
    const gaps = baseGaps('f09', 'f', { basesFile, localeFiles: [vi, en] })
    expect(gaps).toHaveLength(3)
    expect(gaps[0]).toMatch(/BASES .*f09/)
    expect(gaps[1]).toMatch(/BASE_WEAR .*f09.*'f'/)
    expect(gaps[2]).toContain(`${en}: bases.f09`)
    expect(baseGaps('f01', 'f', { basesFile, localeFiles: [vi, en] })).toEqual([])
    expect(baseGaps('m03', 'm', { basesFile, localeFiles: [vi] }).join('\n')).toMatch(/avatar-bases\.json.*m03/)
  })
})

describe('ingestAssets', () => {
  it('ingests a per-wear outfit, adds variants.m to the catalogue, and marks it ingested', async () => {
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
    const lines: string[] = []
    await ingestAssets(registryOf([outfit]), [], { srcDir, publicDir, targets, itemsFile, log: (line: string) => lines.push(line) })
    expect(outfit.ingested).toBe(true)
    expect(JSON.parse(readFileSync(itemsFile, 'utf8'))[0].asset.variants).toEqual({ m: 'item_outfit_casual01_m_L40' })
    const manifest = JSON.parse(readFileSync(targets[0]!, 'utf8'))
    expect(manifest.files.item_outfit_casual01_m_L40).toMatchObject({ real: true, wear: 'm', variantOf: 'item_outfit_casual01_L40' })
    expect(lines.join('\n')).toMatch(/registered on m01/)
  }, 120_000)

  it('ingests an aura, a frame, a bot and its happy face, and marks each ingested', async () => {
    const publicDir = join(temp, 'public-ingest-square')
    mkdirSync(publicDir, { recursive: true })
    const targets = [join(publicDir, MANIFEST_NAME)]
    await pipelineIngest({ file: files.ref, target: { kind: 'base', base: 'f01' }, dir: publicDir, targets })
    const square = (kind: string, code: string): Asset => ({
      id: `item_${kind}_${code}`, kind, slot: kind, wear: null, catalog: `${kind}_${code}`, look: { description: 'x' }, reference: null, prompt: null, file: 'ring.png',
      ingest: { as: `item:${kind}:${code}`, base: null, variant: null, flags: [] }, status: 'ok', attempts: [{ n: 1, verdict: 'ok' }],
    })
    const aura = square('aura', 'water01')
    const frame = square('frame', 'gold')
    // As the committed registry seeds them: the neutral picture drawn from F01's, the happy one from the bot's own.
    const bot: Asset = {
      id: 'bot_4', kind: 'bot', slot: null, wear: null, catalog: 'bot_4', look: { description: 'x', expression: 'y' },
      reference: 'ref.png', prompt: null, file: 'ref.png',
      ingest: { as: 'bot:4', base: null, variant: null, flags: [] }, status: 'approved', attempts: [{ n: 1, verdict: 'ok' }],
    }
    const happy: Asset = { ...bot, id: 'bot_4:happy', reference: '@bot_4', file: 'happy.png', ingest: { ...bot.ingest, as: 'bot:4:happy' } }
    const lines: string[] = []
    const results = await ingestAssets(registryOf([aura, frame, bot, happy]), [], { srcDir, publicDir, targets, log: (line: string) => lines.push(line) })
    expect(results.map((result: { id: string; done: boolean; name?: string | null }) => [result.id, result.done, result.name])).toEqual([
      ['item_aura_water01', true, 'item_aura_water01_L10'],
      ['item_frame_gold', true, 'item_frame_gold_L90'],
      ['bot_4', true, 'bot_4_L30'],
      ['bot_4:happy', true, 'bot_4_face_happy_L50'],
    ])
    for (const asset of [aura, frame, bot, happy]) expect(asset.ingested, asset.id).toBe(true)
    expect(lines.join('\n')).not.toMatch(/not supported/)
    expect(lines.join('\n')).toMatch(/transform taken from f01/)
    const manifest = JSON.parse(readFileSync(targets[0]!, 'utf8'))
    expect(manifest.files.item_aura_water01_L10).toMatchObject({ layer: 10, real: true })
    expect(manifest.files.item_frame_gold_L90).toMatchObject({ layer: 90, real: true })
    expect(manifest.files.bot_4_L30).toMatchObject({ layer: 30, real: true })
    expect(manifest.files.bot_4_face_sad_L50).toMatchObject({ real: true, copyOf: 'bot_4_face_neutral_L50' })
    expect(manifest.files.bot_4_face_happy_L50).toMatchObject({ real: true })
    expect(manifest.files.bot_4_face_happy_L50.copyOf).toBeUndefined()
  }, 180_000)

  // ── Plan 19 ──

  const v4Asset = (fields: Asset): Asset => ({
    slot: null, wear: null, look: { description: 'x' }, prompt: null, status: 'ok', attempts: [{ n: 1, verdict: 'ok' }], ...fields,
    ingest: { base: null, variant: null, flags: [], ...fields.ingest },
  })

  it('ingests a body on f01 transform, then a hairstyle drawn on it with its --recolour-to', async () => {
    const publicDir = join(temp, 'public-ingest-v4')
    mkdirSync(publicDir, { recursive: true })
    const targets = [join(publicDir, MANIFEST_NAME)]
    await pipelineIngest({ file: files.ref, target: { kind: 'base', base: 'f01' }, dir: publicDir, targets })
    const body = v4Asset({ id: 'body_f', kind: 'body', wear: 'f', catalog: 'f', reference: 'ref.png', file: 'bald.png', ingest: { as: 'body:f' } })
    const bob = v4Asset({
      id: 'item_hair_f_bob01', kind: 'hair', wear: 'f', catalog: 'hair_f_bob01', reference: '@body_f', file: 'hair-ok.png', status: 'approved',
      ingest: { as: 'hair:f_bob01', flags: ['--recolour-to', '#5e3e6f'] },
    })
    const lines: string[] = []
    const results = await ingestAssets(registryOf([body, bob]), [], { srcDir, publicDir, targets, log: (line: string) => lines.push(line) })
    expect(results.map((result: { id: string; done: boolean; name?: string | null }) => [result.id, result.done, result.name])).toEqual([
      ['body_f', true, 'body_f_L30'],
      ['item_hair_f_bob01', true, 'item_hair_f_bob01_L60'],
    ])
    expect(body.ingested && bob.ingested).toBe(true)
    expect(lines.join('\n')).toMatch(/transform taken from f01/)
    const manifest = JSON.parse(readFileSync(targets[0]!, 'utf8'))
    expect(manifest.bodies.f.transform).toEqual(manifest.bases.f01.transform)
    expect(manifest.files.body_f_face_neutral_L50).toMatchObject({ real: true })
    expect(manifest.files.item_hair_f_bob01_L20).toMatchObject({ real: true })
    expect(manifest.files.item_hair_f_bob01_L60).toMatchObject({ real: true, recolouredTo: '#5e3e6f' })
  }, 180_000)

  it('passes an asset --hair and --anchor through to the pipeline, which refuses them where they do not belong', async () => {
    const publicDir = join(temp, 'public-ingest-flags')
    mkdirSync(publicDir, { recursive: true })
    const targets = [join(publicDir, MANIFEST_NAME)]
    const hat = (flags: string[], base: string): Asset => v4Asset({ id: 'v4/item_head_x01', kind: 'item', slot: 'head', catalog: 'head_x01', reference: 'ref.png', file: 'hat.png', ingest: { as: 'item:head:x01', base, flags } })
    await expect(ingestAssets(registryOf([hat(['--hair', 'm_tousled01'], 'f')]), [], { srcDir, publicDir, targets })).rejects.toThrow(/m_tousled01 is worn on body m, not on body f/)
    await expect(ingestAssets(registryOf([hat(['--anchor', 'head'], 'f01')]), [], { srcDir, publicDir, targets })).rejects.toThrow(/--anchor head belongs to a body/)
  }, 60_000)
})
