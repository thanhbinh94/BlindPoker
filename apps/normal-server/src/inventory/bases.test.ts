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
    wear: 'f',
    layers: { hairBack: 'base_f01_L20', body: 'base_f01_L30', hairFront: 'base_f01_L60' },
    faces: {
      neutral: 'base_f01_face_neutral_L50', happy: 'base_f01_face_happy_L50', sad: 'base_f01_face_sad_L50',
      surprised: 'base_f01_face_surprised_L50', closed: 'base_f01_face_closed_L50', sleep: 'base_f01_face_sleep_L50',
    },
  },
  m01: {
    nameKey: 'bases.m01',
    wear: 'm',
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
    expect(Object.keys(bases).sort()).toEqual(['f01', 'f02', 'f03', 'm01', 'm02', 'm03'])
    for (const [id, base] of Object.entries(bases)) {
      expect(base).toMatchObject({ id, nameKey: `bases.${id}` })
      for (const expr of EXPRESSIONS) expect(base.faces[expr]).toBeTruthy()
    }
    // 2026-09-20: which body each figure wears its clothes on, which is what picks between an outfit's
    // cuts. The art side says the same thing in the pipeline's `BASE_WEAR`.
    expect(bases.f01?.wear).toBe('f')
    expect(bases.m01?.wear).toBe('m')
  })

  it('requires a wear, and one of the two the pipeline draws', () => {
    // Not defaulted: a base with no wear would be drawn in whichever cut happens to be the shared one,
    // which for a skirted uniform is a visible mistake on half the roster and on nothing that fails loudly.
    const { wear: _wear, ...noWear } = VALID.m01
    expect(() => loadBases(fixture({ ...VALID, m01: noWear }), manifest)).toThrow(/m01 has wear undefined rather than one of f, m/)
    expect(() => loadBases(fixture({ ...VALID, m01: { ...VALID.m01, wear: 'male' } }), manifest)).toThrow(/m01 has wear "male" rather than one of f, m/)
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

  describe('tint', () => {
    /**
     * f01's L30 (body) and L60 (hair front) carry hair masks, and every face carries both a hair and
     * an eye mask — except `happy`, whose eyes are closed and so its eye mask is `empty` — the same
     * shape the real manifest is in (design §4.1). m01 stays maskless, the way a base not yet run
     * through the `masks` pipeline command would be.
     */
    const withMasks: AvatarManifest = {
      ...manifest,
      files: {
        ...manifest.files,
        base_f01_L30: { ...manifest.files['base_f01_L30']!, masks: { hair: { bytes2x: 6532, meanL: 0.34 } } },
        base_f01_L60: { ...manifest.files['base_f01_L60']!, masks: { hair: { bytes2x: 4193, meanL: 0.28 } } },
        base_f01_face_neutral_L50: {
          ...manifest.files['base_f01_face_neutral_L50']!,
          masks: { hair: { bytes2x: 6321, meanL: 0.345 }, eyes: { bytes2x: 4547, meanL: 0.41 } },
        },
        base_f01_face_happy_L50: {
          ...manifest.files['base_f01_face_happy_L50']!,
          masks: { hair: { bytes2x: 6356, meanL: 0.34 }, eyes: { bytes2x: 4015, meanL: 0, empty: true } },
        },
        base_f01_face_sad_L50: {
          ...manifest.files['base_f01_face_sad_L50']!,
          masks: { hair: { bytes2x: 6405, meanL: 0.341 }, eyes: { bytes2x: 5439, meanL: 0.486 } },
        },
        base_f01_face_surprised_L50: {
          ...manifest.files['base_f01_face_surprised_L50']!,
          masks: { hair: { bytes2x: 6481, meanL: 0.344 }, eyes: { bytes2x: 4726, meanL: 0.437 } },
        },
        base_f01_face_closed_L50: {
          ...manifest.files['base_f01_face_closed_L50']!,
          masks: { hair: { bytes2x: 6398, meanL: 0.323 }, eyes: { bytes2x: 4015, meanL: 0, empty: true } },
        },
        base_f01_face_sleep_L50: {
          ...manifest.files['base_f01_face_sleep_L50']!,
          masks: { hair: { bytes2x: 6474, meanL: 0.334 }, eyes: { bytes2x: 4015, meanL: 0, empty: true } },
        },
      },
    }

    it('derives tint.hair from the body, hair-front and every face with a non-empty hair mask', () => {
      const bases = loadBases(fixture(VALID), withMasks)
      expect(bases.f01?.tint?.hair).toEqual({
        meanL: 0.34, // f01 L30's own mask, not any face's
        files: [
          'base_f01_L30', 'base_f01_L60',
          'base_f01_face_neutral_L50', 'base_f01_face_happy_L50', 'base_f01_face_sad_L50',
          'base_f01_face_surprised_L50', 'base_f01_face_closed_L50', 'base_f01_face_sleep_L50',
        ],
      })
    })

    it('derives tint.eyes from face_neutral’s meanL, and drops the faces whose eye mask is empty', () => {
      const bases = loadBases(fixture(VALID), withMasks)
      expect(bases.f01?.tint?.eyes).toEqual({
        meanL: 0.41, // face_neutral's own mask
        files: ['base_f01_face_neutral_L50', 'base_f01_face_sad_L50', 'base_f01_face_surprised_L50'],
      })
    })

    it('gives a base with no masks at all no tint key', () => {
      const bases = loadBases(fixture(VALID), withMasks)
      expect(bases.m01?.tint).toBeUndefined()
      // And against the plain manifest (no masks anywhere), neither base gets one.
      expect(loadBases(fixture(VALID), manifest).f01?.tint).toBeUndefined()
    })
  })
})
