/**
 * The committed avatar assets (design §4, §7).
 *
 * `public/avatar3d/` is a build artefact that is *committed*, which is unusual enough to be worth
 * saying why: the packs it is built from are 400 MB of CC0 archives that no checkout and no CI runner
 * has, so if the `.glb` files were built on demand the app could not be built at all without them. What
 * this suite defends is the consequence of that choice — that the artefact in git is the artefact
 * `scripts/avatar-assets.mjs` would produce, and that nobody has hand-edited, renamed or quietly
 * fattened one of the five files since.
 *
 * The suite reads only what is committed. It never touches `assets/avatar-src/`, so it passes on a
 * fresh clone that has never downloaded a pack.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT_DIR = resolve(PACKAGE_ROOT, 'public/avatar3d')
const SCRIPT = resolve(PACKAGE_ROOT, 'scripts/avatar-assets.mjs')
const MAP_FILE = resolve(PACKAGE_ROOT, 'scripts/avatar-map.json')

/** The same shape `scripts/avatar-assets.mjs` writes. */
interface AvatarManifest {
  version: number
  generatedAt: string
  placeholder: boolean
  files: Record<string, { bytes: number; sha256: string }>
  nodes: Record<string, { file: string; bytes: number }>
  materials: string[]
  budget: { totalBytes: number; maxFileBytes: number }
}

/** Node keys are the contract between this pipeline, the item catalogue and the renderer. */
const KEY_RE = /^(body\/(male|female)|(hair|top|bottom|shoes|hat|accessory|jewelry)\/[a-z0-9_]+\/(male|female))$/

const MAX_TOTAL_BYTES = 6 * 1024 * 1024
const MAX_FILE_BYTES = Math.round(1.5 * 1024 * 1024)
/** Design §4: each body file is held to a tighter budget than the shared ones. */
const MAX_BODY_BYTES = 400 * 1024

const CANONICAL_MATERIALS = ['cloth_primary', 'cloth_secondary', 'eyes', 'hair', 'metal', 'skin']

const manifest = JSON.parse(readFileSync(join(OUT_DIR, 'manifest.json'), 'utf8')) as AvatarManifest
const map = JSON.parse(readFileSync(MAP_FILE, 'utf8')) as {
  bodies: Record<string, { out: string }>
  outputs: Record<string, string>
  items: { id: string; slot: string; variants?: Record<string, unknown> }[]
}

describe('avatar asset manifest', () => {
  it('is a version 1 manifest built from real packs', () => {
    expect(manifest.version).toBe(1)
    expect(Number.isNaN(Date.parse(manifest.generatedAt))).toBe(false)
    // `true` would mean the pipeline ran without the CC0 packs and emitted stand-in shapes; the
    // committed assets are the real ones, and this is the test that would catch a silent downgrade.
    expect(manifest.placeholder).toBe(false)
    expect(manifest.budget).toEqual({ totalBytes: MAX_TOTAL_BYTES, maxFileBytes: MAX_FILE_BYTES })
  })

  it('names every file that is on disk, and nothing that is not', () => {
    const onDisk = readdirSync(OUT_DIR).filter((name) => name.endsWith('.glb')).sort()
    expect(onDisk).toEqual(Object.keys(manifest.files).sort())
    expect(onDisk).toEqual(['accessories.glb', 'body-female.glb', 'body-male.glb', 'hair.glb', 'outfits.glb'])
  })

  it('records the exact size and hash of each file', () => {
    for (const [name, info] of Object.entries(manifest.files)) {
      const path = join(OUT_DIR, name)
      expect(existsSync(path), `${name} is in the manifest but not on disk`).toBe(true)
      const binary = readFileSync(path)
      expect(binary.length, `${name} size`).toBe(info.bytes)
      expect(createHash('sha256').update(binary).digest('hex'), `${name} hash`).toBe(info.sha256)
    }
  })

  it('keeps every file, and the whole set, inside the download budget', () => {
    let total = 0
    for (const [name, info] of Object.entries(manifest.files)) {
      total += info.bytes
      expect(info.bytes, `${name} is over the per-file budget`).toBeLessThanOrEqual(MAX_FILE_BYTES)
      if (name.startsWith('body-')) expect(info.bytes, `${name} is over the body budget`).toBeLessThanOrEqual(MAX_BODY_BYTES)
    }
    console.log(`[avatar-assets] ${(total / 1024).toFixed(1)} KB across ${Object.keys(manifest.files).length} files (budget ${(MAX_TOTAL_BYTES / 1024).toFixed(0)} KB)`)
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES)
  })

  it('names every node by the slot/item/body convention', () => {
    const keys = Object.keys(manifest.nodes)
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) expect(key, `${key} is not a legal node key`).toMatch(KEY_RE)
    expect(keys).toContain('body/male')
    expect(keys).toContain('body/female')
    for (const entry of Object.values(manifest.nodes)) {
      expect(Object.keys(manifest.files)).toContain(entry.file)
      expect(entry.bytes).toBeGreaterThanOrEqual(0)
    }
  })

  it('covers both bodies of every item the map declares', () => {
    for (const item of map.items) {
      for (const body of ['male', 'female']) {
        if (!item.variants?.[body]) continue
        const key = `${item.slot}/${item.id}/${body}`
        expect(manifest.nodes[key], `${key} is missing from the manifest`).toBeDefined()
        expect(manifest.nodes[key]!.file).toBe(map.outputs[item.slot])
      }
    }
  })

  it('uses only the six canonical material names', () => {
    expect(manifest.materials).toEqual(CANONICAL_MATERIALS)
  })
})

describe('avatar asset pipeline', () => {
  it('agrees that the committed output matches the map', () => {
    // The script's own verification, which also opens each `.glb` and checks that the nodes really are
    // named what the manifest says and that no skin, animation or texture survived. It exits non-zero
    // on any mismatch, which `execFileSync` turns into a thrown error.
    const stdout = execFileSync(process.execPath, [SCRIPT, '--check'], { cwd: PACKAGE_ROOT, encoding: 'utf8' })
    expect(stdout).toMatch(/\bok\b/)
  })
})
