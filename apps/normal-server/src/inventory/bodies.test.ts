import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { EXPRESSIONS, loadBodies } from './bodies.js'
import type { AvatarManifest, AvatarManifestFile, MaskInfo } from './manifest.js'
import { loadAvatarManifest } from './manifest.js'

let scratch: string
let seq = 0

function fixture(content: unknown): string {
  scratch ??= mkdtempSync(join(tmpdir(), 'bp-bodies-'))
  seq += 1
  const path = join(scratch, `bodies-${seq}.json`)
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content), 'utf8')
  return path
}

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true })
})

function entry(layer: number, masks?: AvatarManifestFile['masks']): AvatarManifestFile {
  return masks === undefined ? { layer, w: 384, h: 448, bytes2x: 1 } : { layer, w: 384, h: 448, bytes2x: 1, masks }
}

const faceFile = (gender: string, expr: string): string => `body_${gender}_face_${expr}_L50`
const facesOf = (gender: string): Record<string, string> => Object.fromEntries(EXPRESSIONS.map((expr) => [expr, faceFile(gender, expr)]))

/** Both bodies' seven layers, at the right layers and with no masks at all. */
const manifest: AvatarManifest = {
  version: 1,
  frame: { w: 384, h: 448 },
  crop: { x: 88, y: 40, size: 208 },
  files: {
    body_f_L30: entry(30),
    body_m_L30: entry(30),
    ...Object.fromEntries(EXPRESSIONS.flatMap((expr) => [[faceFile('f', expr), entry(50)], [faceFile('m', expr), entry(50)]])),
    item_hair_f_bob01_L20: entry(20),
  },
}

const VALID = {
  f: { body: 'body_f_L30', faces: facesOf('f'), naturalEyeColour: '#2e6a9b' },
  m: { body: 'body_m_L30', faces: facesOf('m'), naturalEyeColour: '#cc924c' },
}

describe('loadBodies', () => {
  it('reads the shipped bodies against the shipped manifest', () => {
    const bodies = loadBodies()
    expect(Object.keys(bodies).sort()).toEqual(['f', 'm'])
    expect(bodies.f).toMatchObject({ gender: 'f', body: 'body_f_L30', naturalEyeColour: '#2a6492' })
    for (const expr of EXPRESSIONS) expect(bodies.m.faces[expr]).toBe(`body_m_face_${expr}_L50`)
    // The stand-ins already carry skin and eye masks (A1a), so both bodies are tintable from day one:
    // skin at the body's own lightness, eyes at face_neutral's.
    const shipped = loadAvatarManifest()
    for (const gender of ['f', 'm'] as const) {
      const tint = bodies[gender].tint
      expect(tint?.skin?.files[0], gender).toBe(`body_${gender}_L30`)
      expect(tint?.skin?.meanL, gender).toBe(shipped.files[`body_${gender}_L30`]?.masks?.skin?.meanL)
      expect(tint?.eyes?.meanL, gender).toBe(shipped.files[faceFile(gender, 'neutral')]?.masks?.eyes?.meanL)
      // The skin's line art (2026-10-05): the body, all six faces and every outfit's copy of the outline (eight outfit
      // layers, the two male cuts included — any of them can be drawn over either body), at the skin's meanL.
      const outfits = Object.keys(shipped.files).filter((file) => file.startsWith('item_outfit_')).sort()
      expect(tint?.skinLine, gender).toEqual({ meanL: tint?.skin?.meanL, files: [`body_${gender}_L30`, ...EXPRESSIONS.map((expr) => faceFile(gender, expr)), ...outfits] })
    }
  })

  it('stamps the gender onto each entry and answers f before m, whatever order the file is in', () => {
    const bodies = loadBodies(fixture({ m: VALID.m, f: VALID.f }), manifest)
    expect(Object.keys(bodies)).toEqual(['f', 'm'])
    expect(bodies.f).toEqual({ gender: 'f', ...VALID.f })
    expect(bodies.m).toEqual({ gender: 'm', ...VALID.m })
  })

  describe('tint', () => {
    const skin = (meanL: number, empty?: true): MaskInfo => (empty ? { bytes2x: 1, meanL, empty } : { bytes2x: 1, meanL })
    /**
     * f: the body and five faces carry a skin mask; `sleep`'s is empty. Every face carries an eye mask, and
     * `closed`'s and `sleep`'s are empty — shut eyes have no iris. m carries no masks at all, the way a body
     * the `masks` stage has not reached would.
     */
    const withMasks: AvatarManifest = {
      ...manifest,
      files: {
        ...manifest.files,
        body_f_L30: entry(30, { skin: skin(0.82) }),
        [faceFile('f', 'neutral')]: entry(50, { skin: skin(0.83), eyes: { bytes2x: 1, meanL: 0.18 } }),
        [faceFile('f', 'happy')]: entry(50, { skin: skin(0.84), eyes: { bytes2x: 1, meanL: 0.2 } }),
        [faceFile('f', 'sad')]: entry(50, { skin: skin(0.85), eyes: { bytes2x: 1, meanL: 0.19 } }),
        [faceFile('f', 'surprised')]: entry(50, { skin: skin(0.86), eyes: { bytes2x: 1, meanL: 0.17 } }),
        [faceFile('f', 'closed')]: entry(50, { skin: skin(0.87), eyes: { bytes2x: 1, meanL: 0, empty: true } }),
        [faceFile('f', 'sleep')]: entry(50, { skin: skin(0, true), eyes: { bytes2x: 1, meanL: 0, empty: true } }),
      },
    }

    it('derives skin from the body and every face with a skin mask, at the body’s meanL; eyes at face_neutral’s', () => {
      const bodies = loadBodies(fixture(VALID), withMasks)
      expect(bodies.f.tint).toEqual({
        skin: {
          meanL: 0.82, // the body's own mask, not any face's
          files: ['body_f_L30', faceFile('f', 'neutral'), faceFile('f', 'happy'), faceFile('f', 'sad'), faceFile('f', 'surprised'), faceFile('f', 'closed')],
        },
        eyes: {
          meanL: 0.18, // face_neutral's own mask
          files: [faceFile('f', 'neutral'), faceFile('f', 'happy'), faceFile('f', 'sad'), faceFile('f', 'surprised')],
        },
      })
    })

    it('takes each kind’s meanL only from a non-empty reference mask, and leaves the kind out without one', () => {
      // (a) The body's own skin mask is empty while five faces carry one: there is no reference lightness
      // for skin — a face's would put a seam where it overlaps the body — so `skin` is left out, and the
      // eyes, whose reference is intact, are still derived.
      const emptyBodySkin: AvatarManifest = { ...withMasks, files: { ...withMasks.files, body_f_L30: entry(30, { skin: skin(0, true) }) } }
      expect(loadBodies(fixture(VALID), emptyBodySkin).f.tint).toEqual({
        eyes: { meanL: 0.18, files: [faceFile('f', 'neutral'), faceFile('f', 'happy'), faceFile('f', 'sad'), faceFile('f', 'surprised')] },
      })

      // (b) face_neutral's eye mask is empty while happy, sad and surprised carry one: no reference for the
      // eyes, so `eyes` is left out rather than tinted against an empty region's 0 — and skin is untouched.
      const emptyNeutralEyes: AvatarManifest = {
        ...withMasks,
        files: { ...withMasks.files, [faceFile('f', 'neutral')]: entry(50, { skin: skin(0.83), eyes: { bytes2x: 1, meanL: 0, empty: true } }) },
      }
      expect(loadBodies(fixture(VALID), emptyNeutralEyes).f.tint).toEqual({
        skin: {
          meanL: 0.82,
          files: ['body_f_L30', faceFile('f', 'neutral'), faceFile('f', 'happy'), faceFile('f', 'sad'), faceFile('f', 'surprised'), faceFile('f', 'closed')],
        },
      })
    })

    it('derives the skin’s line art from every layer with a skin-line mask, at the skin’s meanL, and only beside skin (2026-10-05)', () => {
      const line = (empty?: true): MaskInfo => (empty ? { bytes2x: 1, meanL: 0, empty } : { bytes2x: 1, meanL: 0.31 })
      const withLines: AvatarManifest = {
        ...withMasks,
        files: {
          ...withMasks.files,
          body_f_L30: entry(30, { skin: skin(0.82), skinLine: line() }),
          [faceFile('f', 'neutral')]: entry(50, { skin: skin(0.83), skinLine: line(), eyes: { bytes2x: 1, meanL: 0.18 } }),
          [faceFile('f', 'happy')]: entry(50, { skin: skin(0.84), skinLine: line(true), eyes: { bytes2x: 1, meanL: 0.2 } }),
          // An outfit's copy of the outline, and one with none: the first is the body's to shade, wherever it was cut.
          item_outfit_tuxedo01_L40: entry(40, { skinLine: line() }),
          item_outfit_casual01_L40: entry(40, { tint: { bytes2x: 1, meanL: 0.9 } }),
          item_head_tophat01_L80: entry(80, { skinLine: line() }),
        },
      }
      expect(loadBodies(fixture(VALID), withLines).f.tint?.skinLine).toEqual({
        meanL: 0.82, // the skin's, which the shading is a ratio against — not the line's own 0.31
        files: ['body_f_L30', faceFile('f', 'neutral'), 'item_outfit_tuxedo01_L40'], // an outfit layer (40) only — not a hat
      })
      // No skin reference, no line shading: the two go together.
      const noSkin: AvatarManifest = { ...withLines, files: { ...withLines.files, body_f_L30: entry(30, { skin: skin(0, true), skinLine: line() }) } }
      expect(loadBodies(fixture(VALID), noSkin).f.tint?.skinLine).toBeUndefined()
      // A manifest with no line masks at all (before 2026-10-05) still serves skin and eyes, with no skinLine key.
      expect(loadBodies(fixture(VALID), withMasks).f.tint).not.toHaveProperty('skinLine')
    })

    it('gives a body with no masks no tint key, and never reads one from the file', () => {
      expect(loadBodies(fixture(VALID), withMasks).m.tint).toBeUndefined()
      // Derived, not written (ruling 5): a hand-written `tint` in the JSON is not what the server serves.
      const handWritten = { ...VALID, m: { ...VALID.m, tint: { skin: { meanL: 0.5, files: ['body_m_L30'] } } } }
      expect(loadBodies(fixture(handWritten), manifest).m.tint).toBeUndefined()
    })
  })

  it('refuses a missing gender, a missing face, a wrong layer and a malformed natural eye colour', () => {
    const { m: _m, ...onlyF } = VALID
    expect(() => loadBodies(fixture(onlyF), manifest)).toThrow(/invalid avatar bodies .*: is missing the gender m/)

    const { sad: _sad, ...noSad } = VALID.f.faces
    expect(() => loadBodies(fixture({ ...VALID, f: { ...VALID.f, faces: noSad } }), manifest)).toThrow(/invalid avatar bodies .*: f\.faces is missing the sad expression/)

    const wrongLayer = { ...VALID, m: { ...VALID.m, body: faceFile('m', 'neutral') } }
    expect(() => loadBodies(fixture(wrongLayer), manifest)).toThrow(/invalid avatar bodies .*: m\.body names body_m_face_neutral_L50, which is layer 50 rather than 30/)

    for (const bad of ['#2E6A9B', '#2e6a9', 'blue', 42]) {
      const malformed = { ...VALID, f: { ...VALID.f, naturalEyeColour: bad } }
      expect(() => loadBodies(fixture(malformed), manifest), String(bad)).toThrow(/invalid avatar bodies .*: f has the naturalEyeColour .* rather than a lowercase #rrggbb/)
    }
  })

  it('refuses a gender nobody has, an expression nobody draws, and a file the manifest never built', () => {
    expect(() => loadBodies(fixture({ ...VALID, x: VALID.f }), manifest)).toThrow(/names x, which is not a gender \(f, m\)/)

    const wink = { ...VALID, f: { ...VALID.f, faces: { ...VALID.f.faces, wink: faceFile('f', 'neutral') } } }
    expect(() => loadBodies(fixture(wink), manifest)).toThrow(/f\.faces names the unknown expression wink/)

    const ghost = { ...VALID, f: { ...VALID.f, faces: { ...VALID.f.faces, happy: 'body_f_face_ghost_L50' } } }
    expect(() => loadBodies(fixture(ghost), manifest)).toThrow(/f\.faces\.happy names body_f_face_ghost_L50, which is not in the avatar manifest/)

    const hairAsFace = { ...VALID, m: { ...VALID.m, faces: { ...VALID.m.faces, sleep: 'item_hair_f_bob01_L20' } } }
    expect(() => loadBodies(fixture(hairAsFace), manifest)).toThrow(/m\.faces\.sleep names item_hair_f_bob01_L20, which is layer 20 rather than 50/)
  })

  it('refuses a malformed file', () => {
    expect(() => loadBodies(fixture([]), manifest)).toThrow(/invalid avatar bodies .*: the file is not a JSON object/)
    expect(() => loadBodies(fixture({ ...VALID, f: 'body_f_L30' }), manifest)).toThrow(/f is not an object/)
    expect(() => loadBodies(fixture({ ...VALID, f: { ...VALID.f, faces: [] } }), manifest)).toThrow(/f\.faces is not an object/)
    expect(() => loadBodies(join(tmpdir(), 'bp-bodies-missing', 'nope.json'), manifest)).toThrow(/could not read avatar bodies/)
  })
})
