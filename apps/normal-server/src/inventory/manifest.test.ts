import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { loadAvatarManifest } from './manifest.js'

let scratch: string
let seq = 0

function fixture(content: unknown): string {
  scratch ??= mkdtempSync(join(tmpdir(), 'bp-manifest-'))
  seq += 1
  const path = join(scratch, `manifest-${seq}.json`)
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content), 'utf8')
  return path
}

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true })
})

const VALID = {
  version: 1,
  frame: { w: 384, h: 448 },
  crop: { x: 112, y: 48, size: 160 },
  files: {
    base_f01_L30: { layer: 30, w: 384, h: 448, bytes2x: 15716, placeholder: true },
    item_head_tophat01_L80: { layer: 80, w: 384, h: 448, bytes2x: 4000, real: true },
  },
}

describe('loadAvatarManifest', () => {
  it('reads the shipped manifest', () => {
    const manifest = loadAvatarManifest()
    expect(manifest.version).toBe(1)
    expect(manifest.frame).toEqual({ w: 384, h: 448 })
    expect(manifest.crop).toEqual({ x: 112, y: 48, size: 160 })
    expect(Object.keys(manifest.files).length).toBeGreaterThan(0)
    expect(manifest.files['base_f01_L30']).toMatchObject({ layer: 30 })
  })

  it('parses a well-formed fixture, including the optional flags', () => {
    const manifest = loadAvatarManifest(fixture(VALID))
    expect(manifest).toEqual(VALID)
  })

  it('refuses a missing file with a named error', () => {
    const path = join(tmpdir(), 'bp-manifest-does-not-exist', 'nope.json')
    expect(() => loadAvatarManifest(path)).toThrow(/could not read avatar manifest/)
  })

  it('refuses a file that is not a JSON object', () => {
    expect(() => loadAvatarManifest(fixture([]))).toThrow(/not a JSON object/)
    expect(() => loadAvatarManifest(fixture('not json'))).toThrow(/could not read avatar manifest/)
  })

  it('refuses an unknown version', () => {
    expect(() => loadAvatarManifest(fixture({ ...VALID, version: 2 }))).toThrow(/unknown version/)
  })

  it('refuses a malformed frame or crop', () => {
    expect(() => loadAvatarManifest(fixture({ ...VALID, frame: { w: 384 } }))).toThrow(/frame\.h must be a positive number/)
    expect(() => loadAvatarManifest(fixture({ ...VALID, crop: { x: 112, y: 48, size: 0 } }))).toThrow(/crop\.size must be a positive number/)
    // Zero is a legitimate pixel coordinate for x/y.
    expect(loadAvatarManifest(fixture({ ...VALID, crop: { x: 0, y: 0, size: 160 } })).crop).toEqual({ x: 0, y: 0, size: 160 })
  })

  it('refuses a malformed file entry', () => {
    expect(() => loadAvatarManifest(fixture({ ...VALID, files: { x: { layer: 30, w: 1, h: 1 } } }))).toThrow(/files\.x\.bytes2x must be a positive number/)
    expect(() => loadAvatarManifest(fixture({ ...VALID, files: { x: { layer: 0, w: 1, h: 1, bytes2x: 1 } } }))).toThrow(/files\.x has no positive layer/)
    expect(() => loadAvatarManifest(fixture({ ...VALID, files: { x: { layer: 30, w: 1, h: 1, bytes2x: 1, placeholder: 'yes' } } }))).toThrow(/files\.x\.placeholder must be a boolean/)
  })
})
