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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FIX_LINES, renderPrompt } from '../scripts/avatar-registry/prompts.mjs'
import { approve, nextAssets, ready, reject, statusCounts } from '../scripts/avatar-registry/queue.mjs'
import { REGISTRY_FILE, SRC_DIR, readRegistry, validateRegistry, writeRegistry } from '../scripts/avatar-registry/registry.mjs'

/* eslint-disable @typescript-eslint/no-explicit-any -- the registry is plain JSON, typed by its validator */
type Registry = any
type Asset = any

const TEMPLATES = {
  base: 'Base. Hair: {{look.hair}}. Skin: {{look.skin}}. Ref {{ref}}',
  expression: 'Expression: {{look.expression}}.',
  head: 'Head: {{look.description}}.',
  face: 'Face: {{look.description}}.',
  outfit: 'Outfit: {{look.description}}.',
  aura: 'Aura: {{look.description}}.',
  frame: 'Frame: {{look.description}}.',
  bot: 'Bot: {{look.description}}. Face: {{look.expression}}.',
}

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
})

// ────────────────────────────────────────────────────────────────── queue ──

describe('ready / nextAssets', () => {
  const opts = (): { srcDir: string } => ({ srcDir })

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

  it('orders head, face, outfit items, then bases, expressions, auras, frames, bots — stable within a group', () => {
    const assets = [
      asset({ id: 'bot_0', kind: 'bot' }),
      asset({ id: 'item_frame_gold', kind: 'frame', slot: 'frame', reference: null }),
      asset({ id: 'item_aura_fire01', kind: 'aura', slot: 'aura', reference: null }),
      asset({ id: 'f02', kind: 'base', status: 'ok' }),
      asset({ id: 'f02:happy', kind: 'expression', reference: '@f02' }),
      asset({ id: 'f03', kind: 'base' }),
      asset({ id: 'item_outfit_casual01', kind: 'item', slot: 'outfit' }),
      asset({ id: 'item_face_mask01', kind: 'item', slot: 'face' }),
      asset({ id: 'item_head_b01', kind: 'item', slot: 'head' }),
      asset({ id: 'item_head_a01', kind: 'item', slot: 'head' }),
      asset({ id: 'm02', kind: 'base' }),
    ]
    const ids = nextAssets(registryOf(assets), opts()).map((a: Asset) => a.id)
    expect(ids).toEqual(['item_head_b01', 'item_head_a01', 'item_face_mask01', 'item_outfit_casual01', 'f03', 'm02', 'f02:happy', 'item_aura_fire01', 'item_frame_gold', 'bot_0'])
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

describe('the committed registry', () => {
  it('validates, and every null prompt renders', () => {
    const registry = readRegistry(REGISTRY_FILE)
    for (const entry of registry.assets) if (entry.prompt === null) expect(() => renderPrompt(entry, registry)).not.toThrow()
  })

  it('lists every asset the plan seeds, and every one carries a legal status', () => {
    // The committed registry is a living file: the loop moves assets from todo through generated to ok and
    // approved, so this holds the shape, not the day's tallies.
    const registry = readRegistry(REGISTRY_FILE)
    const counts = statusCounts(registry)
    expect(registry.assets).toHaveLength(65)
    expect(Object.values(counts).reduce((a: number, b) => a + (b as number), 0)).toBe(65)
    const casual = registry.assets.find((entry: Asset) => entry.id === 'item_outfit_casual01')
    // casual01's first picture painted the tank-top strap; that reason stays on the prompt until the asset is done.
    if (!['ok', 'approved'].includes(casual.status)) expect(renderPrompt(casual, registry)).toContain(FIX_LINES.strap)
    const kinds = registry.assets.reduce((acc: Record<string, number>, entry: Asset) => ({ ...acc, [entry.kind]: (acc[entry.kind] ?? 0) + 1 }), {})
    expect(kinds).toEqual({ item: 11, aura: 8, frame: 6, base: 4, expression: 20, bot: 16 })
  })

  it('lives next to the pictures it describes', () => {
    expect(REGISTRY_FILE).toBe(join(SRC_DIR, 'registry.json'))
  })
})
