import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { EXPRESSIONS, baseIdsOf, loadBases } from './bases.js'
import type { AvatarManifest } from './manifest.js'

let scratch: string
let seq = 0

function fixture(content: unknown): string {
  scratch ??= mkdtempSync(join(tmpdir(), 'bp-bases-'))
  seq += 1
  const path = join(scratch, `bases-${seq}.json`)
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content), 'utf8')
  return path
}

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true })
})

const manifest: AvatarManifest = {
  version: 1,
  frame: { w: 384, h: 448 },
  crop: { x: 88, y: 40, size: 208 },
  files: {
    base_f01_L20: { layer: 20, w: 384, h: 448, bytes2x: 1 },
    base_f01_L30: { layer: 30, w: 384, h: 448, bytes2x: 1 },
    base_f01_L60: { layer: 60, w: 384, h: 448, bytes2x: 1 },
    base_f01_face_neutral_L50: { layer: 50, w: 384, h: 448, bytes2x: 1 },
    base_f01_face_happy_L50: { layer: 50, w: 384, h: 448, bytes2x: 1 },
    base_f01_face_sad_L50: { layer: 50, w: 384, h: 448, bytes2x: 1 },
    base_f01_face_surprised_L50: { layer: 50, w: 384, h: 448, bytes2x: 1 },
    base_f01_face_closed_L50: { layer: 50, w: 384, h: 448, bytes2x: 1 },
    base_f01_face_sleep_L50: { layer: 50, w: 384, h: 448, bytes2x: 1 },
    base_m01_L20: { layer: 20, w: 384, h: 448, bytes2x: 1 },
    base_m01_L30: { layer: 30, w: 384, h: 448, bytes2x: 1 },
    base_m01_L60: { layer: 60, w: 384, h: 448, bytes2x: 1 },
    base_m01_face_neutral_L50: { layer: 50, w: 384, h: 448, bytes2x: 1 },
    base_m01_face_happy_L50: { layer: 50, w: 384, h: 448, bytes2x: 1 },
    base_m01_face_sad_L50: { layer: 50, w: 384, h: 448, bytes2x: 1 },
    base_m01_face_surprised_L50: { layer: 50, w: 384, h: 448, bytes2x: 1 },
    base_m01_face_closed_L50: { layer: 50, w: 384, h: 448, bytes2x: 1 },
    base_m01_face_sleep_L50: { layer: 50, w: 384, h: 448, bytes2x: 1 },
  },
}

const VALID = {
  f01: {
    nameKey: 'bases.f01',
    layers: { hairBack: 'base_f01_L20', body: 'base_f01_L30', hairFront: 'base_f01_L60' },
    faces: {
      neutral: 'base_f01_face_neutral_L50', happy: 'base_f01_face_happy_L50', sad: 'base_f01_face_sad_L50',
      surprised: 'base_f01_face_surprised_L50', closed: 'base_f01_face_closed_L50', sleep: 'base_f01_face_sleep_L50',
    },
  },
  m01: {
    nameKey: 'bases.m01',
    layers: { hairBack: 'base_m01_L20', body: 'base_m01_L30', hairFront: 'base_m01_L60' },
    faces: {
      neutral: 'base_m01_face_neutral_L50', happy: 'base_m01_face_happy_L50', sad: 'base_m01_face_sad_L50',
      surprised: 'base_m01_face_surprised_L50', closed: 'base_m01_face_closed_L50', sleep: 'base_m01_face_sleep_L50',
    },
  },
}

describe('loadBases', () => {
  it('reads the shipped bases against the shipped manifest', () => {
    const bases = loadBases()
    expect(Object.keys(bases).sort()).toEqual(['f01', 'm01'])
    for (const [id, base] of Object.entries(bases)) {
      expect(base).toMatchObject({ id, nameKey: `bases.${id}` })
      for (const expr of EXPRESSIONS) expect(base.faces[expr]).toBeTruthy()
    }
  })

  it('answers with whatever ids the file names, so a third base is data and nothing else', () => {
    // The point of the open list (2026-09-17): `f03` here is a complete figure because it names seven
    // manifest entries, not because any constant in the code was widened to admit it. The layers it
    // borrows are f01's — a registry is checked against the manifest, not against who drew what.
    const three = { ...VALID, f03: { ...VALID.f01, nameKey: 'bases.f03' } }
    const bases = loadBases(fixture(three), manifest)
    expect(Object.keys(bases)).toEqual(['f01', 'm01', 'f03'])
    expect(bases.f03).toMatchObject({ id: 'f03', nameKey: 'bases.f03' })
    expect(baseIdsOf(bases).has('f03')).toBe(true)
  })

  it('parses a well-formed fixture and stamps the id onto each entry', () => {
    const bases = loadBases(fixture(VALID), manifest)
    expect(bases.f01).toEqual({ id: 'f01', ...VALID.f01 })
    expect(bases.m01).toEqual({ id: 'm01', ...VALID.m01 })
  })

  it('refuses a base file that is not in the manifest', () => {
    const broken = { ...VALID, f01: { ...VALID.f01, layers: { ...VALID.f01.layers, body: 'base_f01_L30_missing' } } }
    expect(() => loadBases(fixture(broken), manifest)).toThrow(/base_f01_L30_missing, which is not in the avatar manifest/)
  })

  it('refuses a file whose manifest layer does not match what the field expects', () => {
    const wrongLayer = { ...VALID, f01: { ...VALID.f01, layers: { ...VALID.f01.layers, body: 'base_f01_L20' } } }
    expect(() => loadBases(fixture(wrongLayer), manifest)).toThrow(/layer 20 rather than 30/)
  })

  it('accepts a registry with one base, as long as it is the one avatars fall back to', () => {
    const { m01: _m01, ...onlyF01 } = VALID
    expect(Object.keys(loadBases(fixture(onlyF01), manifest))).toEqual(['f01'])
  })

  it('refuses a registry without the base every avatar falls back to', () => {
    const { f01: _f01, ...noF01 } = VALID
    expect(() => loadBases(fixture(noF01), manifest)).toThrow(/is missing the base f01, which every avatar falls back to/)
  })

  it('refuses an id that could not be spelled into a file name', () => {
    expect(() => loadBases(fixture({ ...VALID, 'F 02': VALID.f01 }), manifest)).toThrow(/names F 02, which is not a legal base id/)
  })

  it('refuses a face record missing or misnaming an expression', () => {
    const { neutral: _n, ...missingNeutral } = VALID.f01.faces
    expect(() => loadBases(fixture({ ...VALID, f01: { ...VALID.f01, faces: missingNeutral } }), manifest)).toThrow(/missing the neutral expression/)

    const extra = { ...VALID.f01.faces, wink: 'base_f01_face_neutral_L50' }
    expect(() => loadBases(fixture({ ...VALID, f01: { ...VALID.f01, faces: extra } }), manifest)).toThrow(/unknown expression wink/)
  })

  it('refuses a nameKey that does not follow the bases.<id> convention', () => {
    expect(() => loadBases(fixture({ ...VALID, f01: { ...VALID.f01, nameKey: 'avatar.f01' } }), manifest)).toThrow(/nameKey avatar\.f01 rather than bases\.f01/)
  })

  it('refuses a malformed file', () => {
    expect(() => loadBases(fixture([]), manifest)).toThrow(/not a JSON object/)
    expect(() => loadBases(join(tmpdir(), 'bp-bases-missing', 'nope.json'), manifest)).toThrow(/could not read avatar bases/)
  })
})
