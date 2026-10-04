/**
 * The avatar asset registry (Plan 12, spec `2026-09-24-avatar-asset-registry-design.md` §3/§6/§8): the
 * committed queue of pictures still to generate, and the pure half of the CLI around it — reading and
 * validating the file, rendering a prompt from a template and a look, deciding which asset is next, and
 * the user's `approve`/`reject` transitions.
 *
 * Nothing here touches a picture; `avatar-registry-verify.test.ts` covers `collect`, `verify` and `ingest`.
 * The last block reads the committed `assets/avatar-src/registry.json` itself, so a hand edit that breaks
 * the schema fails here rather than in the middle of a generation batch.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BOT_TRANSFORM_FROM } from '../scripts/avatar-pipeline/extract.mjs'
import { FIX_LINES, KIND_FIX_LINES, renderPrompt } from '../scripts/avatar-registry/prompts.mjs'
import { PRIORITY, approve, nextAssets, ready, reject, statusCounts } from '../scripts/avatar-registry/queue.mjs'
import { KINDS, REGISTRY_FILE, SRC_DIR, parseFlags, parseSpec, readRegistry, referenceOf, transformSource, validateRegistry, writeRegistry } from '../scripts/avatar-registry/registry.mjs'

/* eslint-disable @typescript-eslint/no-explicit-any -- the registry is plain JSON, typed by its validator */
type Registry = any
type Asset = any

const CLI = fileURLToPath(new URL('../scripts/avatar-registry.mjs', import.meta.url))

const TEMPLATES = {
  base: 'Base. Hair: {{look.hair}}. Skin: {{look.skin}}. Ref {{ref}}',
  expression: 'Expression: {{look.expression}}.',
  head: 'Head: {{look.description}}.',
  face: 'Face: {{look.description}}.',
  outfit: 'Outfit: {{look.description}}.',
  aura: 'Aura: {{look.description}}.',
  frame: 'Frame: {{look.description}}.',
  bot: 'Bot: {{look.description}}. Face: {{look.expression}}.',
  body: 'Body {{look.code}}. Ref {{ref}}',
  bodyExpression: 'Body expression: {{look.expression}}.',
  hair: 'Hair: {{look.description}}.',
}

/** A v4 asset's `ingest`: the target alone, as the shipped registry writes it (A2c). */
const as = (spec: string, fields: Record<string, unknown> = {}): Asset => ({ as: spec, base: null, variant: null, flags: [], ...fields })

function asset(fields: Partial<Asset> & { id: string; kind: string }): Asset {
  return {
    slot: null,
    wear: null,
    catalog: fields.id,
    look: { description: 'a thing' },
    reference: 'ref.png',
    prompt: null,
    file: `${fields.id.replace(':', '_')}.png`,
    ingest: { as: `item:head:${fields.id}`, base: null, variant: null, flags: [] },
    status: 'todo',
    attempts: [],
    ...fields,
  }
}

function registryOf(assets: Asset[]): Registry {
  return { version: 1, meta: {}, templates: { ...TEMPLATES }, assets }
}

let temp = ''
let srcDir = ''

beforeAll(() => {
  temp = mkdtempSync(join(tmpdir(), 'avatar-registry-'))
  srcDir = join(temp, 'src')
  // The reference files `ready` looks for: `ref.png` exists, `missing.png` does not.
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'ref.png'), 'not really a png')
  // …and the reference both v4 bodies are drawn from, which a fresh worktree does not have either (pre-flight #1).
  writeFileSync(join(srcDir, 'f01_candidate_1.png'), 'not really a png')
})

afterAll(() => rmSync(temp, { recursive: true, force: true }))

// ────────────────────────────────────────────────────────────── validation ──

describe('validateRegistry', () => {
  it('accepts a well-formed registry', () => {
    const registry = registryOf([
      asset({ id: 'item_head_beret01', kind: 'item', slot: 'head' }),
      asset({ id: 'f02', kind: 'base', wear: 'f', ingest: { as: 'base:f02', base: null, variant: null, flags: [] } }),
      asset({ id: 'f02:happy', kind: 'expression', reference: '@f02', ingest: { as: 'expr:f02:happy', base: 'f02', variant: null, flags: [] } }),
      asset({ id: 'item_aura_fire01', kind: 'aura', slot: 'aura', reference: null, ingest: { as: 'item:aura:fire01', base: null, variant: null, flags: [] } }),
    ])
    expect(() => validateRegistry(registry)).not.toThrow()
  })

  it('refuses an unknown kind, naming the asset', () => {
    const registry = registryOf([asset({ id: 'weird01', kind: 'hat' })])
    expect(() => validateRegistry(registry)).toThrow(/weird01/)
  })

  it('refuses a duplicate id', () => {
    const registry = registryOf([asset({ id: 'item_head_a01', kind: 'item', slot: 'head' }), asset({ id: 'item_head_a01', kind: 'item', slot: 'head' })])
    expect(() => validateRegistry(registry)).toThrow(/item_head_a01/)
  })

  it('refuses an @reference to an asset that does not exist', () => {
    const registry = registryOf([asset({ id: 'f09:happy', kind: 'expression', reference: '@f09' })])
    expect(() => validateRegistry(registry)).toThrow(/f09:happy/)
  })

  it('refuses an item without a head, face or outfit slot', () => {
    const registry = registryOf([asset({ id: 'item_x01', kind: 'item', slot: 'aura' })])
    expect(() => validateRegistry(registry)).toThrow(/item_x01/)
  })

  it('refuses an empty ingest target and a status outside the set', () => {
    expect(() => validateRegistry(registryOf([asset({ id: 'a01', kind: 'item', slot: 'head', ingest: { as: '', base: null, variant: null, flags: [] } })]))).toThrow(/a01/)
    expect(() => validateRegistry(registryOf([asset({ id: 'a02', kind: 'item', slot: 'head', status: 'done' })]))).toThrow(/a02/)
    expect(() => validateRegistry(registryOf([asset({ id: 'a03', kind: 'item', slot: 'head', status: 'rework-2' })]))).not.toThrow()
  })

  it('refuses attempts that are not an array', () => {
    expect(() => validateRegistry(registryOf([asset({ id: 'a04', kind: 'item', slot: 'head', attempts: null })]))).toThrow(/a04/)
  })

  it('accepts the v4 kinds: a body, a body expression and a hairstyle (Plan 19)', () => {
    expect(KINDS).toEqual(expect.arrayContaining(['body', 'bodyExpression', 'hair']))
    const registry = registryOf([
      asset({ id: 'body_f', kind: 'body', wear: 'f', catalog: 'f', reference: 'f01_candidate_1.png', ingest: as('body:f') }),
      asset({ id: 'body_f:happy', kind: 'bodyExpression', wear: 'f', catalog: 'f', reference: '@body_f', file: 'body_f_happy.png', ingest: as('face:f:happy') }),
      asset({ id: 'item_hair_f_bob01', kind: 'hair', wear: 'f', catalog: 'hair_f_bob01', reference: '@body_f', ingest: as('hair:f_bob01') }),
      asset({ id: 'v4/item_outfit_casual01', kind: 'item', slot: 'outfit', reference: '@body_f', file: 'v4_item_outfit_casual01.png', ingest: as('item:outfit:casual01', { base: 'f' }) }),
    ])
    expect(() => validateRegistry(registry)).not.toThrow()
  })

  it('refuses a v4 asset whose ingest target is not its kind, naming it', () => {
    const v4 = (id: string, kind: string, spec: string): Asset => asset({ id, kind, reference: 'f01_candidate_1.png', file: `${id.replace(':', '_')}.png`, ingest: as(spec) })
    expect(() => validateRegistry(registryOf([v4('body_f', 'body', 'base:f')]))).toThrow(/body_f.*body:/)
    expect(() => validateRegistry(registryOf([v4('item_hair_f_bob01', 'hair', 'item:hair:f_bob01')]))).toThrow(/item_hair_f_bob01.*hair:/)
    expect(() => validateRegistry(registryOf([v4('item_hair_x', 'hair', 'hair:bob01')]))).toThrow(/item_hair_x.*bob01/)
    expect(() => validateRegistry(registryOf([v4('body_f:sad', 'bodyExpression', 'expr:f:sad')]))).toThrow(/body_f:sad.*face:/)
  })

  it('refuses a hairstyle whose code is not one of the eight, naming it', () => {
    const hair = (id: string, code: string): Asset => asset({ id, kind: 'hair', reference: 'f01_candidate_1.png', ingest: as(`hair:${code}`) })
    expect(() => validateRegistry(registryOf([hair('item_hair_f_bobb01', 'f_bobb01')]))).toThrow(/item_hair_f_bobb01.*f_bobb01/)
    expect(() => validateRegistry(registryOf([hair('item_hair_m_spiky02', 'm_spiky02')]))).toThrow(/item_hair_m_spiky02/)
    expect(() => validateRegistry(registryOf([hair('item_hair_f_bob01', 'f_bob01'), hair('item_hair_m_spiky01', 'm_spiky01')]))).not.toThrow()
  })

  it('reads a superseded entry: true, or the id of a live asset that replaced it, with a note (Plan 19 final review)', () => {
    const bot = (fields: Partial<Asset> = {}): Asset => asset({ id: 'bot_0', kind: 'bot', ingest: as('bot:0'), status: 'ok', ...fields })
    const v4 = asset({ id: 'v4/bot_0', kind: 'bot', file: 'v4_bot_0.png', ingest: as('bot:0'), status: 'ok' })
    expect(() => validateRegistry(registryOf([bot({ superseded: 'v4/bot_0', note: 'cut on f01' }), v4]))).not.toThrow()
    expect(() => validateRegistry(registryOf([bot({ superseded: true })]))).not.toThrow()
    expect(() => validateRegistry(registryOf([bot({ superseded: 'v4/bot_9' })]))).toThrow(/bot_0: superseded by v4\/bot_9, which is not in the registry/)
    expect(() => validateRegistry(registryOf([bot({ superseded: 'bot_0' })]))).toThrow(/bot_0: superseded by bot_0, which is not a live asset/)
    expect(() => validateRegistry(registryOf([bot({ superseded: 'v4/bot_0' }), { ...v4, superseded: true }]))).toThrow(/which is not a live asset/)
    expect(() => validateRegistry(registryOf([bot({ superseded: 1 })]))).toThrow(/bot_0: superseded is 1/)
    expect(() => validateRegistry(registryOf([bot({ note: '' })]))).toThrow(/bot_0: note is not a sentence/)
  })
})

// ─────────────────────────────────────────────────── specs and flags (v4) ──

describe('parseSpec / parseFlags: the v4 targets and flags (Plan 19)', () => {
  it('reads body:<g>, face:<g>:<expr> and hair:<code>, the hairstyle gendered by its code', () => {
    expect(parseSpec('body:f')).toEqual({ kind: 'body', gender: 'f' })
    expect(parseSpec('face:m:happy')).toEqual({ kind: 'bodyFace', gender: 'm', expr: 'happy' })
    expect(parseSpec('hair:f_bob01')).toEqual({ kind: 'hair', code: 'f_bob01', gender: 'f' })
    expect(parseSpec('hair:m_neat01')).toEqual({ kind: 'hair', code: 'm_neat01', gender: 'm' })
    // Plan 12's bot targets read as before.
    expect(parseSpec('bot:3:happy')).toEqual({ kind: 'bot', bot: 3, expr: 'happy' })
  })

  it('refuses the retired base:<id> and expr:<id>:<expr>, saying what replaced them (Plan 19 D1)', () => {
    expect(() => parseSpec('base:f02')).toThrow(/base:f02 .*retired.*body:<g>/)
    expect(() => parseSpec('expr:f02:happy')).toThrow(/expr:f02:happy .*retired.*face:<g>:<expr>/)
    // The kinds stay, for Plan 12's history in the committed registry.
    expect(KINDS).toEqual(expect.arrayContaining(['base', 'expression']))
  })

  it('refuses a v4 target with a part missing or one too many, and a hair code that names no gender', () => {
    expect(() => parseSpec('body:f:happy')).toThrow(/body:f:happy/)
    expect(() => parseSpec('body:')).toThrow(/body:/)
    expect(() => parseSpec('face:f')).toThrow(/face:f/)
    expect(() => parseSpec('hair:f_bob01:x')).toThrow(/hair:f_bob01:x/)
    expect(() => parseSpec('hair:bob01')).toThrow(/bob01/)
  })

  it('takes --hair, --anchor and --recolour-to as words, beside the numbers and booleans it took before', () => {
    expect(parseFlags(['--hair', 'f_bob01'])).toEqual({ hides: {}, diff: {}, hair: 'f_bob01' })
    expect(parseFlags(['--anchor', 'head'])).toEqual({ hides: {}, diff: {}, anchor: 'head' })
    expect(parseFlags(['--recolour-to', '#5e3e6f'])).toEqual({ hides: {}, diff: {}, recolourTo: '#5e3e6f' })
    expect(parseFlags(['--recolour-to=#5E3E6F', '--hides-hair-front', '--color-tol', '30', '--hair=m_neat01'])).toEqual({
      hides: { hidesHairFront: true }, diff: { colorTol: 30 }, recolourTo: '#5E3E6F', hair: 'm_neat01',
    })
  })

  it('refuses an anchor other than head, a colour that is not #rrggbb, and a word flag with no value', () => {
    expect(() => parseFlags(['--anchor', 'feet'])).toThrow(/--anchor feet.*head/)
    expect(() => parseFlags(['--recolour-to', 'violet'])).toThrow(/#rrggbb/)
    expect(() => parseFlags(['--recolour-to', '#5e3e6'])).toThrow(/#rrggbb/)
    expect(() => parseFlags(['--hair'])).toThrow(/--hair needs/)
    expect(() => parseFlags(['--hair', '--white'])).toThrow(/--hair needs/)
    expect(() => parseFlags(['--color-tol', 'f_bob01'])).toThrow(/--color-tol needs a number/)
  })
})

describe('transformSource', () => {
  const body = asset({ id: 'body_f', kind: 'body', wear: 'f', catalog: 'f', reference: 'f01_candidate_1.png', ingest: as('body:f') })
  const bot = asset({ id: 'v4/bot_3', kind: 'bot', catalog: 'bot_3', reference: '@body_f', file: 'v4_bot_3.png', ingest: as('bot:3') })
  const happy = asset({ id: 'v4/bot_3:happy', kind: 'bot', catalog: 'bot_3', reference: '@v4/bot_3', file: 'v4_bot_3_happy.png', ingest: as('bot:3:happy') })
  const oldBot = asset({ id: 'bot_3', kind: 'bot', reference: 'f01_candidate_1.png', ingest: as('bot:3') })
  const oldHappy = asset({ id: 'bot_3:happy', kind: 'bot', reference: '@bot_3', ingest: as('bot:3:happy') })
  const bodyM = asset({ id: 'body_m', kind: 'body', wear: 'm', catalog: 'm', reference: '@body_f', file: 'body_m.png', ingest: as('body:m') })
  const hair = asset({ id: 'item_hair_f_bob01', kind: 'hair', reference: '@body_f', ingest: as('hair:f_bob01') })
  const face = asset({ id: 'body_f:sad', kind: 'bodyExpression', reference: '@body_f', ingest: as('face:f:sad') })
  const registry = registryOf([body, bot, happy, oldBot, oldHappy, bodyM, hair, face])

  it('follows a v4 bot back to the body it was drawn on: @v4/bot_3 → @body_f → f', () => {
    expect(transformSource(happy, registry)).toBe('f')
    expect(transformSource(bot, registry)).toBe('f')
  })

  it('leaves a body drawn on F01’s canvas to the pipeline (its own stored transform, else body f’s), and cuts one drawn from a body on that body', () => {
    // Plan 19 D1: `f01_candidate_1.png` is nobody's picture any more — no base is left to read a transform from.
    expect(transformSource(body, registry)).toBeNull()
    expect(transformSource(bodyM, registry)).toBe('f')
  })

  it('cuts every bot on body f, Plan 12’s too, and a hairstyle or face on none (the body is its owner)', () => {
    expect(BOT_TRANSFORM_FROM).toBe('f')
    expect(transformSource(oldBot, registry)).toBe('f')
    expect(transformSource(oldHappy, registry)).toBe('f')
    expect(transformSource(hair, registry)).toBeNull()
    expect(transformSource(face, registry)).toBeNull()
  })
})

describe('readRegistry / writeRegistry', () => {
  it('round-trips through the file as two-space JSON with LF and a trailing newline', () => {
    const file = join(temp, 'registry.json')
    const registry = registryOf([asset({ id: 'item_head_beret01', kind: 'item', slot: 'head' })])
    writeRegistry(file, registry)
    const text = readFileSync(file, 'utf8')
    expect(text.endsWith('}\n')).toBe(true)
    expect(text).not.toContain('\r')
    expect(text).toContain('\n  "version": 1')
    const back = readRegistry(file)
    expect(back.assets[0].id).toBe('item_head_beret01')
    expect(back.meta).toEqual({})
  })

  it('throws on a file that does not validate', () => {
    const file = join(temp, 'bad.json')
    writeFileSync(file, JSON.stringify(registryOf([asset({ id: 'bad01', kind: 'nope' })])))
    expect(() => readRegistry(file)).toThrow(/bad01/)
  })
})

// ──────────────────────────────────────────────────────────────── prompts ──

describe('renderPrompt', () => {
  it('substitutes the look and the reference into the template of the kind', () => {
    const base = asset({ id: 'f02', kind: 'base', look: { hair: 'long black hair', skin: 'porcelain' }, reference: 'f01_candidate_1.png' })
    expect(renderPrompt(base, registryOf([base]))).toBe('Base. Hair: long black hair. Skin: porcelain. Ref f01_candidate_1.png')
  })

  it('picks an item template by its slot', () => {
    const hat = asset({ id: 'item_head_beret01', kind: 'item', slot: 'head', look: { description: 'a red beret' } })
    const mask = asset({ id: 'item_face_mask01', kind: 'item', slot: 'face', look: { description: 'a mask' } })
    const registry = registryOf([hat, mask])
    expect(renderPrompt(hat, registry)).toBe('Head: a red beret.')
    expect(renderPrompt(mask, registry)).toBe('Face: a mask.')
  })

  it('resolves {{ref}} of an @reference to that asset file', () => {
    const base = asset({ id: 'f02', kind: 'base', file: 'f02_candidate_1.png' })
    const expr = asset({ id: 'f02:sad', kind: 'expression', reference: '@f02', look: { expression: 'sad' } })
    const registry = registryOf([base, expr])
    registry.templates.expression = 'On {{ref}}: {{look.expression}}'
    expect(renderPrompt(expr, registry)).toBe('On f02_candidate_1.png: sad')
  })

  it('throws on a look key the asset does not have', () => {
    const base = asset({ id: 'f02', kind: 'base', look: { hair: 'black' } })
    expect(() => renderPrompt(base, registryOf([base]))).toThrow(/look\.skin/)
  })

  it('appends one fix line per distinct failure reason, in the order they first failed', () => {
    const hat = asset({
      id: 'item_head_beret01', kind: 'item', slot: 'head', look: { description: 'a beret' },
      attempts: [
        { n: 1, verdict: 'ng', reason: 'background' },
        { n: 2, verdict: 'ng', reason: 'hair_colour' },
        { n: 3, verdict: 'ng', reason: 'background' },
      ],
    })
    expect(renderPrompt(hat, registryOf([hat]))).toBe(`Head: a beret.\n${FIX_LINES.background}\n${FIX_LINES.hair_colour}`)
  })

  it('adds nothing for a style rejection, an ok attempt, or a reason with no fix line', () => {
    const hat = asset({
      id: 'item_head_beret01', kind: 'item', slot: 'head', look: { description: 'a beret' },
      attempts: [
        { n: 1, verdict: 'ng', reason: 'style', by: 'user' },
        { n: 2, verdict: 'ok', reason: null },
        { n: 3, verdict: 'ng', reason: 'drift' },
      ],
    })
    expect(renderPrompt(hat, registryOf([hat]))).toBe('Head: a beret.')
  })

  it('carries the fixed table verbatim', () => {
    expect(FIX_LINES.strap).toBe('The tank top must be completely gone: no straps, no gray fabric anywhere')
    expect(FIX_LINES.scope).toBe('Change nothing outside the requested area')
    expect(FIX_LINES.style).toBeNull()
  })

  it('lets a string prompt override the template, still with its fix lines', () => {
    const hat = asset({ id: 'item_head_beret01', kind: 'item', slot: 'head', prompt: 'Draw a beret, exactly.', attempts: [{ n: 1, verdict: 'ng', reason: 'tears' }] })
    expect(renderPrompt(hat, registryOf([hat]))).toBe(`Draw a beret, exactly.\n${FIX_LINES.tears}`)
  })

  it('carries the v4 fix lines verbatim: C12, C13, and the eye-check reasons fingers, bald and pose (Plan 19)', () => {
    expect(FIX_LINES['check:C12']).toBe('Keep the face exactly the same size and in exactly the same place as in the input; only the body pose changes')
    expect(FIX_LINES['check:C13']).toBe('The hair never covers the eyes; hair longer than the neck falls behind the shoulders')
    expect(FIX_LINES.fingers).toBe('Each hand shows exactly five separate fingers: four fingers and a thumb')
    expect(FIX_LINES.bald).toBe('The head is completely bald: no hair, no hairline, no stubble')
    expect(FIX_LINES.pose).toBe('Relaxed pose: weight on one leg, arms hanging loosely away from the body')
  })

  it('renders a body whose attempts failed C12 and then the eye check on fingers with both new fix lines', () => {
    const body = asset({
      id: 'body_f', kind: 'body', look: { code: 'F' }, reference: 'f01_candidate_1.png', ingest: as('body:f'),
      attempts: [
        { n: 1, verdict: 'ng', reason: 'check:C12', by: 'verify' },
        { n: 2, verdict: 'ng', reason: 'fingers', by: 'user' },
      ],
    })
    expect(renderPrompt(body, registryOf([body]))).toBe(`Body F. Ref f01_candidate_1.png\n${FIX_LINES['check:C12']}\n${FIX_LINES.fingers}`)
  })

  it('gives a body or a hairstyle redrawn on another canvas its own fix line, never "same hair" (A2b review)', () => {
    expect(KIND_FIX_LINES.body?.redrawn).toBe('Output the exact same image size as the input, 1024 by 1536 pixels, with the face in exactly the same place and at exactly the same size as in the input')
    expect(KIND_FIX_LINES.hair?.redrawn).toBe("Output the exact same image size as the input, 1024 by 1536 pixels, and keep the body's exact outline, width and height")
    const redrawn = [{ n: 1, verdict: 'ng', reason: 'redrawn', by: 'verify' }]
    const body = asset({ id: 'body_f', kind: 'body', look: { code: 'F' }, reference: 'f01_candidate_1.png', ingest: as('body:f'), attempts: redrawn })
    const hair = asset({ id: 'item_hair_f_bob01', kind: 'hair', look: { description: 'a bob' }, reference: '@body_f', ingest: as('hair:f_bob01'), attempts: redrawn })
    const registry = registryOf([body, hair])
    const bodyPrompt = renderPrompt(body, registry)
    expect(bodyPrompt).toBe(`Body F. Ref f01_candidate_1.png\n${KIND_FIX_LINES.body?.redrawn}`)
    expect(bodyPrompt).not.toContain('same hair')
    expect(bodyPrompt).not.toContain(FIX_LINES.redrawn)
    const hairPrompt = renderPrompt(hair, registry)
    expect(hairPrompt).toBe(`Hair: a bob.\n${KIND_FIX_LINES.hair?.redrawn}`)
    expect(hairPrompt).not.toContain('same hair')
    // Every other kind keeps the line it had.
    const hat = asset({ id: 'item_head_beret01', kind: 'item', slot: 'head', look: { description: 'a beret' }, attempts: redrawn })
    expect(renderPrompt(hat, registryOf([hat]))).toBe(`Head: a beret.\n${FIX_LINES.redrawn}`)
    const face = asset({ id: 'body_f:sad', kind: 'bodyExpression', reference: '@body_f', file: 'body_f_sad.png', look: { expression: 'sad' }, ingest: as('face:f:sad'), attempts: redrawn })
    expect(renderPrompt(face, registryOf([body, face]))).toBe(`Body expression: sad.\n${FIX_LINES.redrawn}`)
  })
})

// ────────────────────────────────────────────────────────────────── queue ──

describe('ready / nextAssets', () => {
  const opts = (): { srcDir: string } => ({ srcDir })

  it('never hands out a superseded entry, whatever its status (Plan 19 final review)', () => {
    const registry = registryOf([asset({ id: 'bot_0', kind: 'bot', ingest: as('bot:0'), status: 'rework-1', attempts: [{ n: 1 }], superseded: true })])
    expect(ready(registry.assets[0], registry, { srcDir })).toBe(false)
    expect(nextAssets(registry, { srcDir })).toEqual([])
  })

  it('takes todo, ng and rework-n, and skips blocked, generated, ok and approved', () => {
    const statuses = ['todo', 'ng', 'rework-1', 'blocked', 'generated', 'ok', 'approved']
    const assets = statuses.map((status, i) => asset({ id: `item_head_s${i}0`, kind: 'item', slot: 'head', status }))
    const registry = registryOf(assets)
    expect(assets.map((a) => ready(a, registry, opts()))).toEqual([true, true, true, false, false, false, false])
  })

  it('waits for a reference file that does not exist yet', () => {
    const hat = asset({ id: 'item_head_beret01', kind: 'item', slot: 'head', reference: 'missing.png' })
    expect(ready(hat, registryOf([hat]), opts())).toBe(false)
  })

  it('waits for an @reference until that asset is ok or approved', () => {
    const base = asset({ id: 'f02', kind: 'base', status: 'generated' })
    const expr = asset({ id: 'f02:happy', kind: 'expression', reference: '@f02' })
    const registry = registryOf([base, expr])
    expect(ready(expr, registry, opts())).toBe(false)
    base.status = 'ok'
    expect(ready(expr, registry, opts())).toBe(true)
    base.status = 'approved'
    expect(ready(expr, registry, opts())).toBe(true)
  })

  it('needs no reference at all for an aura or a frame', () => {
    const aura = asset({ id: 'item_aura_fire01', kind: 'aura', slot: 'aura', reference: null })
    expect(ready(aura, registryOf([aura]), opts())).toBe(true)
  })

  it('orders bodies, hairstyles, outfits, body expressions, bots, head and face items, then bases, expressions, auras, frames — stable within a group', () => {
    // Plan 19: the v4 kinds lead. Every Plan 12 asset is done or blocked, so the reorder moves nothing of theirs.
    expect(PRIORITY).toEqual(['body', 'hair', 'item:outfit', 'bodyExpression', 'bot', 'item:head', 'item:face', 'base', 'expression', 'aura', 'frame'])
    const assets = [
      asset({ id: 'bot_0', kind: 'bot' }),
      asset({ id: 'item_frame_gold', kind: 'frame', slot: 'frame', reference: null }),
      asset({ id: 'item_aura_fire01', kind: 'aura', slot: 'aura', reference: null }),
      asset({ id: 'f02', kind: 'base', status: 'ok' }),
      asset({ id: 'f02:happy', kind: 'expression', reference: '@f02' }),
      asset({ id: 'f03', kind: 'base' }),
      asset({ id: 'body_m:sad', kind: 'bodyExpression', reference: '@body_m', file: 'body_m_sad.png', ingest: as('face:m:sad') }),
      asset({ id: 'item_outfit_casual01', kind: 'item', slot: 'outfit' }),
      asset({ id: 'item_face_mask01', kind: 'item', slot: 'face' }),
      asset({ id: 'item_hair_m_neat01', kind: 'hair', reference: '@body_m', ingest: as('hair:m_neat01') }),
      asset({ id: 'item_head_b01', kind: 'item', slot: 'head' }),
      asset({ id: 'body_m', kind: 'body', status: 'ok', reference: 'f01_candidate_1.png', ingest: as('body:m') }),
      asset({ id: 'item_head_a01', kind: 'item', slot: 'head' }),
      asset({ id: 'body_f', kind: 'body', reference: 'f01_candidate_1.png', ingest: as('body:f') }),
      // …waits for body_f, which is only todo.
      asset({ id: 'item_hair_f_bob01', kind: 'hair', reference: '@body_f', ingest: as('hair:f_bob01') }),
      asset({ id: 'm02', kind: 'base' }),
    ]
    const ids = nextAssets(registryOf(assets), opts()).map((a: Asset) => a.id)
    expect(ids).toEqual([
      'body_f', 'item_hair_m_neat01', 'item_outfit_casual01', 'body_m:sad', 'bot_0', 'item_head_b01', 'item_head_a01', 'item_face_mask01',
      'f03', 'm02', 'f02:happy', 'item_aura_fire01', 'item_frame_gold',
    ])
  })

  it('hands out only the ids next --only names, once each is ready, in priority order (Plan 19)', () => {
    const body = asset({ id: 'body_f', kind: 'body', reference: 'f01_candidate_1.png', ingest: as('body:f') })
    const bob = asset({ id: 'item_hair_f_bob01', kind: 'hair', reference: '@body_f', ingest: as('hair:f_bob01') })
    const casual = asset({ id: 'v4/item_outfit_casual01', kind: 'item', slot: 'outfit', reference: '@body_f', file: 'v4_item_outfit_casual01.png', ingest: as('item:outfit:casual01', { base: 'f' }) })
    const head = asset({ id: 'item_head_a01', kind: 'item', slot: 'head' })
    const registry = registryOf([head, casual, bob, body])
    const ids = (only: string[], limit = Infinity): string[] => nextAssets(registry, { ...opts(), only, limit }).map((a: Asset) => a.id)
    // Named, but its reference is body_f, which is not ok yet: nothing.
    expect(ids(['item_hair_f_bob01'])).toEqual([])
    expect(ids(['body_f'])).toEqual(['body_f'])
    body.status = 'ok'
    expect(ids(['item_hair_f_bob01'])).toEqual(['item_hair_f_bob01'])
    // In priority order whatever order they are named in, still capped by --limit; the ones not named never come.
    expect(ids(['item_head_a01', 'v4/item_outfit_casual01', 'item_hair_f_bob01'])).toEqual(['item_hair_f_bob01', 'v4/item_outfit_casual01', 'item_head_a01'])
    expect(ids(['item_head_a01', 'v4/item_outfit_casual01'], 1)).toEqual(['v4/item_outfit_casual01'])
    // Without --only, everything ready.
    expect(nextAssets(registry, opts()).map((a: Asset) => a.id)).toEqual(['item_hair_f_bob01', 'v4/item_outfit_casual01', 'item_head_a01'])
  })

  it('refuses an --only id that is not in the registry, naming it', () => {
    const registry = registryOf([asset({ id: 'item_head_a01', kind: 'item', slot: 'head' })])
    expect(() => nextAssets(registry, { ...opts(), only: ['item_head_a01', 'body_x'] })).toThrow(/body_x/)
  })

  it('reads next --only <id,…> on the command line', () => {
    // The CLI takes the pictures' folder from the registry's own: a temp registry beside the stub reference.
    const file = join(srcDir, 'cli-registry.json')
    const body = asset({ id: 'body_f', kind: 'body', look: { code: 'F' }, reference: 'f01_candidate_1.png', ingest: as('body:f') })
    const casual = asset({ id: 'v4/item_outfit_casual01', kind: 'item', slot: 'outfit', reference: '@body_f', file: 'v4_item_outfit_casual01.png', ingest: as('item:outfit:casual01', { base: 'f' }) })
    const head = asset({ id: 'item_head_a01', kind: 'item', slot: 'head', reference: 'f01_candidate_1.png' })
    writeRegistry(file, registryOf([head, casual, body]))
    const next = (...args: string[]): { status: number | null; stdout: string; stderr: string } =>
      spawnSync(process.execPath, [CLI, 'next', '--registry', file, ...args], { encoding: 'utf8' })
    const ids = (run: { stdout: string; stderr: string }): string[] => {
      expect(run.stderr).toBe('')
      return (JSON.parse(run.stdout) as { id: string }[]).map((entry) => entry.id)
    }
    expect(ids(next('--only', 'item_head_a01,body_f,v4/item_outfit_casual01', '--json'))).toEqual(['body_f', 'item_head_a01'])
    expect(ids(next('--json', '--only', ' body_f '))).toEqual(['body_f'])
    expect(ids(next('--json'))).toEqual(['body_f', 'item_head_a01'])
    const unknown = next('--only', 'body_x')
    expect(unknown.status).toBe(1)
    expect(unknown.stderr).toMatch(/body_x/)
  })

  it('skips what is not ready and honours the limit', () => {
    const assets = [
      asset({ id: 'item_head_a01', kind: 'item', slot: 'head', status: 'blocked' }),
      asset({ id: 'item_head_b01', kind: 'item', slot: 'head' }),
      asset({ id: 'item_head_c01', kind: 'item', slot: 'head', reference: 'missing.png' }),
      asset({ id: 'item_head_d01', kind: 'item', slot: 'head' }),
      asset({ id: 'item_head_e01', kind: 'item', slot: 'head' }),
    ]
    const ids = nextAssets(registryOf(assets), { ...opts(), limit: 2 }).map((a: Asset) => a.id)
    expect(ids).toEqual(['item_head_b01', 'item_head_d01'])
  })
})

describe('approve / reject', () => {
  it('approves named ok assets, and refuses one that is not ok', () => {
    const a = asset({ id: 'item_head_a01', kind: 'item', slot: 'head', status: 'ok' })
    const b = asset({ id: 'item_head_b01', kind: 'item', slot: 'head', status: 'generated' })
    const registry = registryOf([a, b])
    expect(approve(registry, ['item_head_a01'])).toEqual(['item_head_a01'])
    expect(a.status).toBe('approved')
    expect(() => approve(registry, ['item_head_b01'])).toThrow(/item_head_b01/)
    expect(() => approve(registry, ['nobody'])).toThrow(/nobody/)
  })

  it('approves every ok asset with --batch', () => {
    const assets = ['ok', 'ng', 'ok', 'approved'].map((status, i) => asset({ id: `item_head_x${i}0`, kind: 'item', slot: 'head', status }))
    expect(approve(registryOf(assets), 'batch')).toEqual(['item_head_x00', 'item_head_x20'])
    expect(assets.map((a) => a.status)).toEqual(['approved', 'ng', 'approved', 'approved'])
  })

  it('rejects into rework-n, recording the user reason on the attempt it judges', () => {
    const a = asset({
      id: 'item_head_a01', kind: 'item', slot: 'head', status: 'approved', ingested: true,
      attempts: [{ n: 1, verdict: 'ng', reason: 'drift' }, { n: 2, verdict: 'ok', reason: null }],
    })
    const registry = registryOf([a])
    expect(reject(registry, ['item_head_a01'])).toEqual(['item_head_a01'])
    expect(a.status).toBe('rework-2')
    expect(a.attempts[1]).toMatchObject({ n: 2, verdict: 'ng', reason: 'style', by: 'user' })
    expect(a.ingested).toBe(false)
  })

  it('takes a reason other than style, and blocks the third', () => {
    const a = asset({
      id: 'item_head_a01', kind: 'item', slot: 'head', status: 'ok',
      attempts: [{ n: 1, verdict: 'ng', reason: 'drift' }, { n: 2, verdict: 'ng', reason: 'scope' }, { n: 3, verdict: 'ok', reason: null }],
    })
    reject(registryOf([a]), ['item_head_a01'], { reason: 'tears' })
    expect(a.status).toBe('blocked')
    expect(a.attempts[2]).toMatchObject({ verdict: 'ng', reason: 'tears', by: 'user' })
  })

  it('refuses to reject an asset with no picture yet', () => {
    const a = asset({ id: 'item_head_a01', kind: 'item', slot: 'head' })
    expect(() => reject(registryOf([a]), ['item_head_a01'])).toThrow(/item_head_a01/)
  })
})

// ─────────────────────────────────────────────────────────── the seed file ──

/**
 * Plan 19's 44 v4 assets as task A2c seeds them, in file order — the style gate's five (both bodies, bob,
 * tousled, casual01) first within their kinds. It holds only the fields the art loop never changes; status,
 * attempts, prompt, `ingest.flags` and `ingested` move as the pictures are drawn.
 */
const V4_GENDERS = ['f', 'm']
const V4_EXPRESSIONS = ['happy', 'sad', 'surprised', 'closed', 'sleep']
const V4_HAIRS: [string, string][] = [
  ['f_bob01', 'f'], ['m_tousled01', 'm'],
  ['f_hime01', 'f'], ['f_wavy01', 'f'], ['f_ponytail01', 'f'], ['m_neat01', 'm'], ['m_curly01', 'm'], ['m_spiky01', 'm'],
]
const V4_BOTS = [0, 1, 2, 3, 4, 5, 6, 7]
const v4Ingest = (spec: string, base: string | null = null, variant: string | null = null): Asset => ({ as: spec, base, variant })
const v4Hair = ([code, g]: [string, string]): Asset => ({
  id: `item_hair_${code}`, kind: 'hair', slot: null, wear: g, catalog: `hair_${code}`, reference: `@body_${g}`, file: `item_hair_${code}.png`, ingest: v4Ingest(`hair:${code}`),
})
/** A v4 outfit redraw: drawn on body f (`wear` null, `base` f), or a male cut on body m. */
const v4Outfit = (code: string, cut: 'f' | 'm' = 'f'): Asset => {
  const m = cut === 'm' ? '_m' : ''
  return {
    id: `v4/item_outfit_${code}${m}`, kind: 'item', slot: 'outfit', wear: cut === 'm' ? 'm' : null, catalog: `outfit_${code}`,
    reference: `@body_${cut}`, file: `v4_item_outfit_${code}${m}.png`, ingest: v4Ingest(`item:outfit:${code}`, cut, cut === 'm' ? 'm' : null),
  }
}
const V4_SEED: Asset[] = [
  ...V4_GENDERS.map((g) => ({ id: `body_${g}`, kind: 'body', slot: null, wear: g, catalog: g, reference: 'f01_candidate_1.png', file: `body_${g}.png`, ingest: v4Ingest(`body:${g}`) })),
  ...V4_HAIRS.slice(0, 2).map(v4Hair),
  v4Outfit('casual01'),
  ...V4_HAIRS.slice(2).map(v4Hair),
  ...['dealer01', 'tuxedo01', 'royal_robe01', 'tet_red01', 'champion01'].map((code) => v4Outfit(code)),
  v4Outfit('dealer01', 'm'),
  v4Outfit('tet_red01', 'm'),
  ...V4_GENDERS.flatMap((g) => V4_EXPRESSIONS.map((e) => ({
    id: `body_${g}:${e}`, kind: 'bodyExpression', slot: null, wear: g, catalog: g, reference: `@body_${g}`, file: `body_${g}_${e}.png`, ingest: v4Ingest(`face:${g}:${e}`),
  }))),
  ...V4_BOTS.map((n) => ({ id: `v4/bot_${n}`, kind: 'bot', slot: null, wear: null, catalog: `bot_${n}`, reference: '@body_f', file: `v4_bot_${n}.png`, ingest: v4Ingest(`bot:${n}`) })),
  ...V4_BOTS.map((n) => ({
    id: `v4/bot_${n}:happy`, kind: 'bot', slot: null, wear: null, catalog: `bot_${n}`, reference: `@v4/bot_${n}`, file: `v4_bot_${n}_happy.png`, ingest: v4Ingest(`bot:${n}:happy`),
  })),
]
const V4_IDS: string[] = V4_SEED.map((row) => row.id)
/** How every v4 template's last line starts (task A2c); the body's then keeps the face in place, the others the outline. */
const SIZE_LINE = 'Output the exact same image size as the input, 1024 by 1536 pixels'

/** The kinds the v4 assets add; Plan 12's are every other asset that is not a `v4/` redraw. */
const isPlan12 = (entry: Asset): boolean => !entry.id.startsWith('v4/') && !['body', 'bodyExpression', 'hair'].includes(entry.kind)
const tally = (assets: Asset[]): Record<string, number> => assets.reduce((acc: Record<string, number>, entry: Asset) => ({ ...acc, [entry.kind]: (acc[entry.kind] ?? 0) + 1 }), {})

describe('the committed registry', () => {
  it('validates, and every null prompt renders', () => {
    const registry = readRegistry(REGISTRY_FILE)
    for (const entry of registry.assets) if (entry.prompt === null) expect(() => renderPrompt(entry, registry)).not.toThrow()
  })

  it('lists every asset the plan seeds, and every one carries a legal status', () => {
    // The committed registry is a living file: the loop moves assets from todo through generated to ok and
    // approved, and C3/C5 add more v4 redraws, so this holds the shape, not the day's tallies (pre-flight #4).
    const registry = readRegistry(REGISTRY_FILE)
    const counts = statusCounts(registry)
    expect(registry.assets.length).toBeGreaterThanOrEqual(109)
    expect(Object.values(counts).reduce((a: number, b) => a + (b as number), 0)).toBe(registry.assets.length)
    const ids = new Set(registry.assets.map((entry: Asset) => entry.id))
    expect(V4_IDS.filter((id) => !ids.has(id))).toEqual([])
    const casual = registry.assets.find((entry: Asset) => entry.id === 'item_outfit_casual01')
    // casual01's first picture painted the tank-top strap; that reason stays on the prompt until the asset is done.
    if (!['ok', 'approved'].includes(casual.status)) expect(renderPrompt(casual, registry)).toContain(FIX_LINES.strap)
    // Plan 12's assets stay exactly as they were…
    expect(tally(registry.assets.filter(isPlan12))).toEqual({ item: 11, aura: 8, frame: 6, base: 4, expression: 20, bot: 16 })
    // …and the v4 kinds hold at least the 44 A2c seeds.
    const v4 = tally(registry.assets.filter((entry: Asset) => !isPlan12(entry)))
    for (const [kind, least] of Object.entries({ body: 2, hair: 8, bodyExpression: 10, item: 8, bot: 16 })) expect(v4[kind] ?? 0).toBeGreaterThanOrEqual(least)
  })

  it('seeds the 44 v4 assets with the ids, files, references and ingest targets the plan names, in its order (Plan 19, R16)', () => {
    const registry = readRegistry(REGISTRY_FILE)
    // File order: the gate's five lead their kinds; whatever C3/C5 add later does not change these ones' order.
    expect(registry.assets.map((entry: Asset) => entry.id).filter((id: string) => V4_IDS.includes(id))).toEqual(V4_IDS)
    for (const row of V4_SEED) expect(registry.assets.find((entry: Asset) => entry.id === row.id)).toMatchObject(row)
    // B2's fallback (R1) reads a buzz cut from each body's look.
    for (const g of V4_GENDERS) expect(registry.assets.find((entry: Asset) => entry.id === `body_${g}`).look.head_fallback).toMatch(/buzz-cut/)
  })

  it('renders body_f from the character lock: bald, five fingers, the size line (Plan 19)', () => {
    const registry = readRegistry(REGISTRY_FILE)
    // The template, whatever attempts or manual override the art loop gives the asset later.
    const body = { ...registry.assets.find((entry: Asset) => entry.id === 'body_f'), prompt: null, attempts: [] }
    const prompt = renderPrompt(body, registry)
    for (const words of ['CHARACTER LOCK BODY_F', 'completely bald', 'exactly five fingers', '1024 by 1536']) expect(prompt).toContain(words)
    // The A1b ruling: a light-grey top would sit inside the skin mask's tolerance of cream skin. Only the colours are
    // held: the gate (Phase B) may retune the rest of the sentence.
    expect(prompt).toMatch(/mid-gray tank top/)
    expect(prompt).toMatch(/charcoal shorts/)
    // Every v4 template ends with the size line; the bot keeps today's text in the new pose.
    for (const key of ['body', 'bodyExpression', 'hair', 'outfit', 'head', 'face', 'bot']) {
      const lines: string[] = registry.templates[key].split('\n')
      expect(lines[lines.length - 1], key).toMatch(new RegExp(`^${SIZE_LINE}`))
    }
    expect(registry.templates.bot).toContain('same relaxed standing pose and the same five-fingered hands')
    expect(registry.templates.bot).not.toContain('arms slightly away from the body')
    // casual01 is short-sleeved: the outfit template bounds the sleeves, it does not lengthen them (A2c review).
    expect(registry.templates.outfit).toContain('No sleeve reaches past the wrists')
    expect(registry.templates.outfit).not.toContain('Sleeves end at the wrists')
  })

  describe('on a clone, beside a stub of the one reference a fresh worktree lacks (pre-flight #29)', () => {
    let shipped = ''

    beforeAll(() => {
      shipped = join(temp, 'shipped')
      mkdirSync(shipped, { recursive: true })
      writeFileSync(join(shipped, 'f01_candidate_1.png'), 'not really a png')
    })

    /** The shipped registry with every v4 asset back at its seed: todo, no attempts. */
    const seeded = (): Registry => {
      const registry = structuredClone(readRegistry(REGISTRY_FILE))
      for (const entry of registry.assets) if (V4_IDS.includes(entry.id)) Object.assign(entry, { status: 'todo', attempts: [] })
      return registry
    }
    const setOk = (registry: Registry, ids: string[]): void => {
      for (const id of ids) registry.assets.find((entry: Asset) => entry.id === id).status = 'ok'
    }
    const queue = (registry: Registry): string[] => nextAssets(registry, { srcDir: shipped }).map((entry: Asset) => entry.id)

    it('hands out the bodies first, then bob and tousled ahead of the hairstyles and casual01 ahead of the outfits', () => {
      const registry = seeded()
      expect(queue(registry).slice(0, 2)).toEqual(['body_f', 'body_m'])
      setOk(registry, ['body_f', 'body_m'])
      const ids = queue(registry)
      expect(ids.filter((id) => id.startsWith('item_hair_')).slice(0, 2)).toEqual(['item_hair_f_bob01', 'item_hair_m_tousled01'])
      expect(ids.filter((id) => id.startsWith('v4/item_outfit_'))[0]).toBe('v4/item_outfit_casual01')
      // PRIORITY alone hands out all eight hairstyles before casual01, which is why Phase B names the gate's assets with --only.
      const seeds = ids.filter((id) => V4_IDS.includes(id)).map((id) => registry.assets.find((entry: Asset) => entry.id === id))
      expect(seeds.map((entry: Asset) => (entry.kind === 'item' ? entry.slot : entry.kind))).toEqual([
        ...Array(8).fill('hair'), ...Array(8).fill('outfit'), ...Array(10).fill('bodyExpression'), ...Array(8).fill('bot'),
      ])
      expect(nextAssets(registry, { srcDir: shipped, only: ['item_hair_f_bob01', 'item_hair_m_tousled01'] }).map((entry: Asset) => entry.id)).toEqual(['item_hair_f_bob01', 'item_hair_m_tousled01'])
      expect(nextAssets(registry, { srcDir: shipped, only: ['v4/item_outfit_casual01'] }).map((entry: Asset) => entry.id)).toEqual(['v4/item_outfit_casual01'])
    })

    it('resolves every v4 reference to a v4 asset or to f01_candidate_1.png, and hands out all 44 as the ones before them are done', () => {
      const registry = seeded()
      for (const id of V4_IDS) {
        const entry = registry.assets.find((other: Asset) => other.id === id)
        const { file, asset: other } = referenceOf(entry, registry)
        if (other) expect(V4_IDS, `${id} → ${entry.reference}`).toContain(other.id)
        else expect(file, id).toBe('f01_candidate_1.png')
      }
      // Each v4 bot, the happy ones too, is cut on body f's transform; each body on its own stored one (Plan 19 D1:
      // F01's picture names no base any more, so the registry hands the pipeline no source for a body).
      for (const n of V4_BOTS) for (const id of [`v4/bot_${n}`, `v4/bot_${n}:happy`]) expect(transformSource(registry.assets.find((entry: Asset) => entry.id === id), registry)).toBe('f')
      for (const g of V4_GENDERS) expect(transformSource(registry.assets.find((entry: Asset) => entry.id === `body_${g}`), registry)).toBeNull()
      // Drain the queue: every round's ready assets come out ok, until nothing is ready.
      const handed: string[] = []
      for (let round = 0; round < 10; round++) {
        const ids = queue(registry)
        if (ids.length === 0) break
        handed.push(...ids)
        setOk(registry, ids)
      }
      expect(handed.filter((id) => V4_IDS.includes(id)).sort()).toEqual([...V4_IDS].sort())
      expect(handed.indexOf('v4/bot_0:happy')).toBeGreaterThan(handed.indexOf('v4/bot_0'))
    })
  })

  it('lives next to the pictures it describes', () => {
    expect(REGISTRY_FILE).toBe(join(SRC_DIR, 'registry.json'))
  })

  it('keeps Plan 12’s bots, casual01, hats and glasses as superseded history, and no two live assets cut the same layer (Plan 19 final review)', () => {
    const registry = readRegistry(REGISTRY_FILE)
    const byId = new Map<string, Asset>(registry.assets.map((entry: Asset): [string, Asset] => [entry.id, entry]))
    // Every Plan 12 bot, its happy face and casual01: superseded by the v4 redraw that cuts the same layer.
    const replaced = [
      ...V4_BOTS.flatMap((n) => [`bot_${n}`, `bot_${n}:happy`]),
      'item_outfit_casual01',
    ]
    for (const id of replaced) {
      const entry = byId.get(id)
      expect(entry?.superseded, id).toBe(`v4/${id}`)
      expect(entry.note, id).toMatch(/retired flat base f01/)
      expect(byId.get(`v4/${id}`).ingest.as, id).toBe(entry.ingest.as)
    }
    // Plan 12's hats and glasses, drawn on F01 with no --hair: superseded with nothing to replace them yet; the withdrawn
    // hood with them.
    const worn = registry.assets.filter((entry: Asset) => entry.kind === 'item' && ['head', 'face'].includes(entry.slot) && !entry.id.startsWith('v4/'))
    expect(worn.map((entry: Asset) => entry.id).sort()).toEqual([
      'item_face_eyepatch01', 'item_face_masquerade01', 'item_face_sunglasses01',
      'item_head_beanie01', 'item_head_beret_red01', 'item_head_conical_hat01', 'item_head_crown_gold01', 'item_head_dealer_visor01', 'item_head_hood_black01', 'item_head_party_cone01',
    ])
    for (const entry of worn) expect(entry.superseded, entry.id).toBe(true)
    // Batch 5 (C5): no hat hides the hair, and the manifests and items.json say so; only the withdrawn hood keeps its flags
    // as history. A re-cut carrying the flag would have turned it back on.
    const hiding = registry.assets.filter((entry: Asset) => (entry.ingest.flags ?? []).some((flag: string) => flag.startsWith('--hides-hair')))
    expect(hiding.map((entry: Asset) => entry.id)).toEqual(['item_head_hood_black01'])
    // What is left live never shares a layer: no two of them cut the same ingest target and wear.
    const live = registry.assets.filter((entry: Asset) => entry.superseded === undefined)
    const layers = live.map((entry: Asset) => `${entry.ingest.as} ${entry.ingest.variant ?? '-'}`)
    expect(layers.filter((layer: string, at: number) => layers.indexOf(layer) !== at)).toEqual([])
  })
})
