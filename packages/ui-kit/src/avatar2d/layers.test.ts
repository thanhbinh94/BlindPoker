import { describe, expect, it } from 'vitest'
import { fnv1a } from './bot.js'
import { DEFAULT_HAIR, DEFAULT_OUTFIT_FILE, defaultChibi, hairRefOf } from './defaults.js'
import { hashChibi, layersFor } from './layers.js'
import type { BodyRef, BotChibi, ChibiConfig, Expression, Gender, HairRef, WearRef } from './types.js'

const AURA: WearRef = { id: 'aura_fire01', order: 10, file: 'item_aura_fire01_L10' }
const FRAME: WearRef = { id: 'frame_gold', order: 90, file: 'item_frame_gold_L90' }
const BERET: WearRef = { id: 'head_beret_red01', order: 80, file: 'item_head_beret_red01_L80' }
const HOOD: WearRef = { id: 'head_hood_black01', order: 80, file: 'item_head_hood_black01_L80', hidesHairFront: true, hidesHairBack: true }
const FACE_ACC: WearRef = { id: 'face_sunglasses01', order: 70, file: 'item_face_sunglasses01_L70' }

const EXPRESSIONS: readonly Expression[] = ['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep']

/** A body by the v4 naming rule — `body_<g>_L30` and `body_<g>_face_<expr>_L50` — built here so a test controls its masks. */
const facesOf = (g: Gender) => Object.fromEntries(EXPRESSIONS.map((e) => [e, `body_${g}_face_${e}_L50`])) as Record<Expression, string>
const BODY_F: BodyRef = { gender: 'f', body: 'body_f_L30', faces: facesOf('f') }
const BOB: HairRef = { id: 'hair_f_bob01', back: 'item_hair_f_bob01_L20', front: 'item_hair_f_bob01_L60' }
const CASUAL: WearRef = { id: 'outfit_casual01', order: 40, file: 'item_outfit_casual01_L40' }
const bare = (): ChibiConfig => ({ kind: 'human', body: BODY_F, hair: BOB, outfit: CASUAL })

describe('layersFor', () => {
  it('orders a bare human bottom to top: hair back, body, outfit, face, hair front', () => {
    expect(layersFor(bare(), 'neutral', 'full').map((l) => [l.order, l.file])).toEqual([
      [20, 'item_hair_f_bob01_L20'],
      [30, 'body_f_L30'],
      [40, 'item_outfit_casual01_L40'],
      [50, 'body_f_face_neutral_L50'],
      [60, 'item_hair_f_bob01_L60'],
    ])
  })

  it('stacks every optional slot in order once equipped', () => {
    const config: ChibiConfig = { ...bare(), aura: AURA, face: FACE_ACC, head: BERET, frame: FRAME }
    const layers = layersFor(config, 'neutral', 'full')
    // `full` keeps the aura (layer 10) but drops the frame border item (layer 90) — that one is only ever
    // drawn on the avatar crop.
    expect(layers.map((l) => l.order)).toEqual([10, 20, 30, 40, 50, 60, 70, 80])
    expect(layers.some((l) => l.order === 90)).toBe(false)
  })

  it('a beret hides no hair', () => {
    const config: ChibiConfig = { ...bare(), head: BERET }
    const layers = layersFor(config, 'neutral', 'full')
    expect(layers.find((l) => l.order === 20)?.file).toBe(BOB.back)
    expect(layers.find((l) => l.order === 60)?.file).toBe(BOB.front)
    expect(layers.find((l) => l.order === 80)?.file).toBe(BERET.file)
  })

  it('a hat hiding the front hair drops L60; one hiding the back hair drops L20', () => {
    const front: WearRef = { ...BERET, hidesHairFront: true }
    const onlyFront = layersFor({ ...bare(), head: front }, 'neutral', 'full').map((l) => l.order)
    expect(onlyFront).toContain(20)
    expect(onlyFront).not.toContain(60)

    const back: WearRef = { ...BERET, hidesHairBack: true }
    const onlyBack = layersFor({ ...bare(), head: back }, 'neutral', 'full').map((l) => l.order)
    expect(onlyBack).not.toContain(20)
    expect(onlyBack).toContain(60)
  })

  it('a hood hides both hair layers', () => {
    const config: ChibiConfig = { ...bare(), head: HOOD }
    const layers = layersFor(config, 'neutral', 'full')
    expect(layers.map((l) => l.order)).not.toContain(20)
    expect(layers.map((l) => l.order)).not.toContain(60)
    expect(layers.find((l) => l.order === 80)?.file).toBe(HOOD.file)
  })

  it('the head-crop frame drops the aura and keeps the frame border', () => {
    const config: ChibiConfig = { ...bare(), aura: AURA, frame: FRAME }
    const layers = layersFor(config, 'neutral', 'head')
    expect(layers.some((l) => l.order === 10)).toBe(false) // aura gone
    expect(layers.find((l) => l.order === 90)?.file).toBe(FRAME.file) // frame kept
  })

  it('the full-body frame keeps the aura and drops the frame border', () => {
    const config: ChibiConfig = { ...bare(), aura: AURA, frame: FRAME }
    const layers = layersFor(config, 'neutral', 'full')
    expect(layers.find((l) => l.order === 10)?.file).toBe(AURA.file) // aura kept
    expect(layers.some((l) => l.order === 90)).toBe(false) // frame gone
  })

  it('expression picks the layer-50 face file, nothing else', () => {
    const happy = layersFor(bare(), 'happy', 'full').find((l) => l.order === 50)
    const sad = layersFor(bare(), 'sad', 'full').find((l) => l.order === 50)
    expect(happy?.file).toContain('_face_happy_L50')
    expect(sad?.file).toContain('_face_sad_L50')
    expect(happy?.file).not.toBe(sad?.file)
  })

  it('a bot is only its body and expression face', () => {
    const bot: BotChibi = { kind: 'bot', index: 3 }
    const layers = layersFor(bot, 'happy', 'full')
    expect(layers).toEqual([
      { order: 30, file: 'bot_3_L30' },
      { order: 50, file: 'bot_3_face_happy_L50' },
    ])
  })

  it('a bot ignores the frame parameter — it has no aura or frame item to drop', () => {
    const bot: BotChibi = { kind: 'bot', index: 0 }
    expect(layersFor(bot, 'neutral', 'head')).toEqual(layersFor(bot, 'neutral', 'full'))
  })
})

describe('layersFor — tints (spec 2026-10-03-avatar-v4-design.md §6.3)', () => {
  it('paints skin on the body and on each listed face, skin before eyes on a face', () => {
    const body: BodyRef = {
      ...BODY_F,
      tint: { skin: { meanL: 0.78, files: ['body_f_L30', 'body_f_face_neutral_L50'] }, eyes: { meanL: 0.41, files: ['body_f_face_neutral_L50'] } },
    }
    const layers = layersFor({ ...bare(), body, skinColor: '#5c3a28', eyeColor: '#2f7fd6' }, 'neutral', 'full')
    expect(layers.find((l) => l.order === 30)?.tints).toEqual([{ mask: 'body_f_L30_skinmask', colour: '#5c3a28', meanL: 0.78 }])
    expect(layers.find((l) => l.order === 50)?.tints).toEqual([
      { mask: 'body_f_face_neutral_L50_skinmask', colour: '#5c3a28', meanL: 0.78 },
      { mask: 'body_f_face_neutral_L50_eyemask', colour: '#2f7fd6', meanL: 0.41 },
    ])
    // The hair is not the body's: neither colour reaches it.
    expect(layers.find((l) => l.order === 20)?.tints).toBeUndefined()
    expect(layers.find((l) => l.order === 60)?.tints).toBeUndefined()
  })

  it('shades the skin’s line art after its skin, at the skin’s meanL, on the body and each listed face (2026-10-05)', () => {
    const body: BodyRef = {
      ...BODY_F,
      tint: {
        skin: { meanL: 0.78, files: ['body_f_L30', 'body_f_face_neutral_L50'] },
        skinLine: { meanL: 0.78, files: ['body_f_L30', 'body_f_face_neutral_L50'] },
        eyes: { meanL: 0.41, files: ['body_f_face_neutral_L50'] },
      },
    }
    const layers = layersFor({ ...bare(), body, skinColor: '#5c3a28', eyeColor: '#2f7fd6' }, 'neutral', 'full')
    expect(layers.find((l) => l.order === 30)?.tints).toEqual([
      { mask: 'body_f_L30_skinmask', colour: '#5c3a28', meanL: 0.78 },
      { mask: 'body_f_L30_skinlinemask', colour: '#5c3a28', meanL: 0.78, mode: 'shade' },
    ])
    expect(layers.find((l) => l.order === 50)?.tints).toEqual([
      { mask: 'body_f_face_neutral_L50_skinmask', colour: '#5c3a28', meanL: 0.78 },
      { mask: 'body_f_face_neutral_L50_skinlinemask', colour: '#5c3a28', meanL: 0.78, mode: 'shade' },
      { mask: 'body_f_face_neutral_L50_eyemask', colour: '#2f7fd6', meanL: 0.41 },
    ])
    // The outfit's copy of the outline, when the set lists the outfit's file: shaded after the outfit's own colour.
    const withOutfit: BodyRef = { ...body, tint: { ...body.tint, skinLine: { meanL: 0.78, files: ['body_f_L30', CASUAL.file] } } }
    const red: WearRef = { ...CASUAL, tint: { colour: '#c0392b', meanL: 0.5 } }
    const dressed = layersFor({ ...bare(), body: withOutfit, outfit: red, skinColor: '#5c3a28' }, 'neutral', 'full')
    expect(dressed.find((l) => l.order === 40)?.tints).toEqual([
      { mask: `${CASUAL.file}_tintmask`, colour: '#c0392b', meanL: 0.5 },
      { mask: `${CASUAL.file}_skinlinemask`, colour: '#5c3a28', meanL: 0.78, mode: 'shade' },
    ])
    // An outfit the set does not list keeps only its own colour; no skin colour, nothing at all.
    expect(layers.find((l) => l.order === 40)?.tints).toBeUndefined()
    expect(layersFor({ ...bare(), body: withOutfit }, 'neutral', 'full').find((l) => l.order === 40)?.tints).toBeUndefined()
    // A tone as light as the skin's meanL or lighter leaves the line as drawn (`shade` would multiply by 1): no job at all,
    // so a porcelain outfit is not re-rendered for nothing, nor lost if its line mask fails to load.
    const porcelain = layersFor({ ...bare(), body: withOutfit, outfit: CASUAL, skinColor: '#fcf0e9' }, 'neutral', 'full')
    expect(porcelain.find((l) => l.order === 30)?.tints).toEqual([{ mask: 'body_f_L30_skinmask', colour: '#fcf0e9', meanL: 0.78 }])
    expect(porcelain.find((l) => l.order === 40)?.tints).toBeUndefined()
    // No skin colour, no line shading either: the eye colour alone on the face.
    const eyesOnly = layersFor({ ...bare(), body, eyeColor: '#2f7fd6' }, 'neutral', 'full')
    expect(eyesOnly.find((l) => l.order === 30)?.tints).toBeUndefined()
    expect(eyesOnly.find((l) => l.order === 50)?.tints).toEqual([{ mask: 'body_f_face_neutral_L50_eyemask', colour: '#2f7fd6', meanL: 0.41 }])
  })

  it('paints the skin colour on the skin an outfit or the front hair redrew, by ratio, after the layer’s own colour (2026-10-05)', () => {
    const body: BodyRef = {
      ...BODY_F,
      tint: {
        skin: { meanL: 0.88, files: ['body_f_L30'] },
        skinLine: { meanL: 0.88, files: ['body_f_L30', CASUAL.file] },
        layerSkin: { meanL: 0.88, files: [CASUAL.file, BOB.front] },
      },
    }
    const hair: HairRef = { ...BOB, tint: { meanL: 0.31, files: [BOB.back, BOB.front] } }
    const red: WearRef = { ...CASUAL, tint: { colour: '#c0392b', meanL: 0.5 } }
    const layers = layersFor({ ...bare(), body, hair, outfit: red, hairColor: '#b3261e', skinColor: '#643e2b' }, 'neutral', 'full')
    // The outfit: its own colour, then its redrawn skin, then its copy of the outline.
    expect(layers.find((l) => l.order === 40)?.tints).toEqual([
      { mask: `${CASUAL.file}_tintmask`, colour: '#c0392b', meanL: 0.5 },
      { mask: `${CASUAL.file}_skinmask`, colour: '#643e2b', meanL: 0.88, mode: 'ratio' },
      { mask: `${CASUAL.file}_skinlinemask`, colour: '#643e2b', meanL: 0.88, mode: 'shade' },
    ])
    // The front hair: its hair colour, then its redrawn skin. The back hair is behind the body: no skin of its own.
    expect(layers.find((l) => l.order === 60)?.tints).toEqual([
      { mask: 'item_hair_f_bob01_L60_hairmask', colour: '#b3261e', meanL: 0.31 },
      { mask: 'item_hair_f_bob01_L60_skinmask', colour: '#643e2b', meanL: 0.88, mode: 'ratio' },
    ])
    expect(layers.find((l) => l.order === 20)?.tints).toEqual([{ mask: 'item_hair_f_bob01_L20_hairmask', colour: '#b3261e', meanL: 0.31 }])
    // A light tone still gets the job: `ratio` gives the redrawn skin the tone's hue, as `recolour` gives the body's.
    const porcelain = layersFor({ ...bare(), body, skinColor: '#fcf0e9' }, 'neutral', 'full')
    expect(porcelain.find((l) => l.order === 60)?.tints).toEqual([{ mask: 'item_hair_f_bob01_L60_skinmask', colour: '#fcf0e9', meanL: 0.88, mode: 'ratio' }])
    // No skin colour, no job; a hair colour alone keeps only its own.
    const hairOnly = layersFor({ ...bare(), body, hair, hairColor: '#b3261e' }, 'neutral', 'full')
    expect(hairOnly.find((l) => l.order === 60)?.tints).toEqual([{ mask: 'item_hair_f_bob01_L60_hairmask', colour: '#b3261e', meanL: 0.31 }])
    expect(hairOnly.find((l) => l.order === 40)?.tints).toBeUndefined()
    // A layer the set does not list redrew no skin: nothing.
    const unlisted: BodyRef = { ...body, tint: { ...body.tint, layerSkin: { meanL: 0.88, files: ['item_outfit_tuxedo01_L40'] } } }
    const plain = layersFor({ ...bare(), body: unlisted, skinColor: '#643e2b' }, 'neutral', 'full')
    expect(plain.find((l) => l.order === 60)?.tints).toBeUndefined()
    expect(plain.find((l) => l.order === 40)?.tints).toEqual([{ mask: `${CASUAL.file}_skinlinemask`, colour: '#643e2b', meanL: 0.88, mode: 'shade' }])
  })

  it('paints the hair colour on both hair layers at the hairstyle’s own meanL', () => {
    const hair: HairRef = { ...BOB, tint: { meanL: 0.31, files: [BOB.back, BOB.front] } }
    const body: BodyRef = { ...BODY_F, tint: { skin: { meanL: 0.78, files: ['body_f_L30'] } } }
    const layers = layersFor({ ...bare(), body, hair, hairColor: '#b3261e' }, 'neutral', 'full')
    expect(layers.find((l) => l.order === 20)?.tints).toEqual([{ mask: 'item_hair_f_bob01_L20_hairmask', colour: '#b3261e', meanL: 0.31 }])
    expect(layers.find((l) => l.order === 60)?.tints).toEqual([{ mask: 'item_hair_f_bob01_L60_hairmask', colour: '#b3261e', meanL: 0.31 }])
    // A hair colour is not a skin colour: the body keeps its own pixels.
    expect(layers.find((l) => l.order === 30)?.tints).toBeUndefined()
  })

  it('a hair layer missing from hair.tint.files gets no hair tint', () => {
    const hair: HairRef = { ...BOB, tint: { meanL: 0.31, files: [BOB.front] } }
    const layers = layersFor({ ...bare(), hair, hairColor: '#b3261e' }, 'neutral', 'full')
    expect(layers.find((l) => l.order === 20)?.tints).toBeUndefined()
    expect(layers.find((l) => l.order === 60)?.tints).toHaveLength(1)
  })

  it('a face missing from tint.skin.files gets no skin tint', () => {
    const body: BodyRef = { ...BODY_F, tint: { skin: { meanL: 0.78, files: ['body_f_L30', 'body_f_face_neutral_L50'] } } }
    const layers = layersFor({ ...bare(), body, skinColor: '#5c3a28' }, 'happy', 'full')
    expect(layers.find((l) => l.order === 50)?.tints).toBeUndefined()
    expect(layers.find((l) => l.order === 30)?.tints).toHaveLength(1)
  })

  it('a body and a hairstyle without tint ignore the colours entirely', () => {
    const config: ChibiConfig = { ...bare(), hairColor: '#b3261e', eyeColor: '#2f7fd6', skinColor: '#5c3a28' }
    expect(layersFor(config, 'neutral', 'full').every((l) => l.tints === undefined)).toBe(true)
  })

  it('an item with tint gets its own tintmask', () => {
    const tintedHead: WearRef = { id: 'head_beret_blue01', order: 80, file: 'item_head_beret_red01_L80', tint: { colour: '#3f6fd8', meanL: 0.5 } }
    const layers = layersFor({ ...bare(), head: tintedHead }, 'neutral', 'full')
    expect(layers.find((l) => l.order === 80)?.tints).toEqual([{ mask: 'item_head_beret_red01_L80_tintmask', colour: '#3f6fd8', meanL: 0.5 }])
  })

  it('bots never carry tints', () => {
    const layers = layersFor({ kind: 'bot', index: 2 }, 'neutral', 'full')
    expect(layers.every((l) => l.tints === undefined)).toBe(true)
  })
})

describe('hashChibi', () => {
  it('is stable for the same configuration', () => {
    expect(hashChibi(bare())).toBe(hashChibi(bare()))
    const bot: BotChibi = { kind: 'bot', index: 5 }
    expect(hashChibi(bot)).toBe(hashChibi({ kind: 'bot', index: 5 }))
  })

  it('differs when the configuration differs', () => {
    const withAura: ChibiConfig = { ...bare(), aura: AURA }
    expect(hashChibi(bare())).not.toBe(hashChibi(withAura))
    expect(hashChibi({ kind: 'bot', index: 0 })).not.toBe(hashChibi({ kind: 'bot', index: 1 }))
  })

  it('is unaffected by expression or frame — those are not part of the configuration', () => {
    const config = bare()
    expect(hashChibi(config)).toBe(hashChibi(config))
  })

  it('hashes gender, hairstyle and skin colour apart', () => {
    const m = { ...bare(), body: { ...BODY_F, gender: 'm' as const } }
    expect(new Set([hashChibi(bare()), hashChibi(m), hashChibi({ ...bare(), hair: { ...BOB, id: 'hair_f_hime01' } }), hashChibi({ ...bare(), skinColor: '#5c3a28' })]).size).toBe(4)
  })

  it('hashes a colourless chibi from its canonical string', () => {
    expect(hashChibi(bare())).toBe(fnv1a('human4:f:hair_f_bob01:outfit_casual01::::').toString(16))
  })

  it('appends the three colours and the item tints when any is set', () => {
    const tinted: ChibiConfig = { ...bare(), skinColor: '#5c3a28', outfit: { ...CASUAL, tint: { colour: '#c0392b', meanL: 0.5 } } }
    expect(hashChibi(tinted)).toBe(fnv1a('human4:f:hair_f_bob01:outfit_casual01::::' + ':::#5c3a28:#c0392b@0.5,,,,').toString(16))
  })

  it('differs when hairColor, eyeColor, skinColor or an item tint differs', () => {
    const config = bare()
    const variants: ChibiConfig[] = [
      config,
      { ...config, hairColor: '#b3261e' },
      { ...config, eyeColor: '#2f7fd6' },
      { ...config, skinColor: '#b3261e' },
      { ...config, outfit: { ...config.outfit, tint: { colour: '#c0392b', meanL: 0.5 } } },
    ]
    expect(new Set(variants.map(hashChibi)).size).toBe(variants.length)
  })
})

describe('defaultChibi', () => {
  it('defaultChibi takes the gender from the hash parity, and that gender’s default hair, stably', () => {
    for (const seed of ['ann', 'bob', 'cuong', 'dung']) {
      const c = defaultChibi(seed)
      const g = fnv1a(seed) % 2 === 0 ? 'f' : 'm'
      expect(c.body.gender).toBe(g)
      expect(c.hair).toEqual(hairRefOf(DEFAULT_HAIR[g]))
      expect(c.outfit.file).toBe(DEFAULT_OUTFIT_FILE[g])
      expect(c.skinColor).toBeUndefined()
    }
    expect(defaultChibi('ann')).toEqual(defaultChibi('ann'))
    expect(DEFAULT_HAIR).toEqual({ f: 'hair_f_bob01', m: 'hair_m_tousled01' })
  })

  it('is the body of its gender by the naming rule, the casual outfit, and no colours or tints', () => {
    // Both parities, so both bodies are pinned (fnv1a('ann') and fnv1a('cuong') differ in parity — asserted).
    const seeds = ['ann', 'cuong']
    expect(new Set(seeds.map((s) => fnv1a(s) % 2)).size).toBe(2)
    for (const seed of seeds) {
      const c = defaultChibi(seed)
      const g = c.body.gender
      expect(c).toEqual({ kind: 'human', body: { gender: g, body: `body_${g}_L30`, faces: facesOf(g) }, hair: hairRefOf(DEFAULT_HAIR[g]), outfit: { id: 'outfit_casual01', order: 40, file: DEFAULT_OUTFIT_FILE[g] } })
    }
  })

  it('hairRefOf names both halves of a hairstyle by the naming rule, with no tint', () => {
    expect(hairRefOf('hair_f_bob01')).toEqual({ id: 'hair_f_bob01', back: 'item_hair_f_bob01_L20', front: 'item_hair_f_bob01_L60' })
    expect(hairRefOf('hair_m_tousled01')).toEqual({ id: 'hair_m_tousled01', back: 'item_hair_m_tousled01_L20', front: 'item_hair_m_tousled01_L60' })
  })

  it('a default chibi draws its gender’s body, hairstyle and outfit', () => {
    const c = defaultChibi('ann')
    const g = c.body.gender
    expect(layersFor(c, 'neutral', 'full').map((l) => l.file)).toEqual([
      `item_${DEFAULT_HAIR[g]}_L20`,
      `body_${g}_L30`,
      DEFAULT_OUTFIT_FILE[g],
      `body_${g}_face_neutral_L50`,
      `item_${DEFAULT_HAIR[g]}_L60`,
    ])
  })
})
