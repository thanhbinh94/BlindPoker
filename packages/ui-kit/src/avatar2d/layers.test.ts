import { describe, expect, it } from 'vitest'
import { fnv1a } from './bot.js'
import { defaultChibi } from './defaults.js'
import { hashChibi, layersFor } from './layers.js'
import type { BaseRef, BotChibi, ChibiConfig, Expression, WearRef } from './types.js'

const AURA: WearRef = { id: 'aura_fire01', order: 10, file: 'item_aura_fire01_L10' }
const FRAME: WearRef = { id: 'frame_gold', order: 90, file: 'item_frame_gold_L90' }
const BERET: WearRef = { id: 'head_beret_red01', order: 80, file: 'item_head_beret_red01_L80' }
const HOOD: WearRef = { id: 'head_hood_black01', order: 80, file: 'item_head_hood_black01_L80', hidesHairFront: true, hidesHairBack: true }
const FACE_ACC: WearRef = { id: 'face_sunglasses01', order: 70, file: 'item_face_sunglasses01_L70' }
const DEFAULT_OUTFIT: WearRef = { id: 'outfit_casual01', order: 40, file: 'item_outfit_casual01_L40' }

const EXPRESSIONS: readonly Expression[] = ['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep']

/** Same naming convention as `defaults.ts`'s private `makeBase`, but exposed here so tests can control which
 * layers carry a mask (`tint`) directly, instead of going through the server registry. */
function makeBase(id: string, tint?: BaseRef['tint']): BaseRef {
  const faces = {} as Record<Expression, string>
  for (const expression of EXPRESSIONS) faces[expression] = `base_${id}_face_${expression}_L50`
  return { id, hairBack: `base_${id}_L20`, body: `base_${id}_L30`, hairFront: `base_${id}_L60`, faces, tint }
}

const bare = (): ChibiConfig => defaultChibi('ann')

describe('layersFor', () => {
  it('orders a bare human bottom to top: hair back, body, outfit, face, hair front', () => {
    const layers = layersFor(bare(), 'neutral', 'full')
    expect(layers.map((l) => l.order)).toEqual([20, 30, 40, 50, 60])
    expect(layers).toEqual([...layers].sort((a, b) => a.order - b.order))
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
    expect(layers.map((l) => l.order)).toContain(20) // hair back
    expect(layers.map((l) => l.order)).toContain(60) // hair front
    expect(layers.find((l) => l.order === 80)?.file).toBe(BERET.file)
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

  it('matches today\'s canonical string exactly when no colours or item tints are set', () => {
    const config = bare()
    // The pre-tint format, reproduced verbatim: `human:<base>:<outfit>:<head>:<face>:<aura>:<frame>`.
    const expected = fnv1a(['human', config.base.id, config.outfit.id, '', '', '', ''].join(':')).toString(16)
    expect(hashChibi(config)).toBe(expected)
  })
})

describe('layersFor — tints (spec 2026-09-24-avatar-tint-design.md §5.2)', () => {
  const TINTED_BASE = makeBase('f01', {
    hair: {
      meanL: 0.42,
      files: [
        'base_f01_L30',
        'base_f01_L60',
        'base_f01_face_neutral_L50',
        'base_f01_face_happy_L50',
        'base_f01_face_sad_L50',
        'base_f01_face_surprised_L50',
        'base_f01_face_closed_L50',
        'base_f01_face_sleep_L50',
      ],
    },
    // Only `neutral` carries a non-empty eye mask here, so a face missing from this list is exercised below.
    eyes: { meanL: 0.31, files: ['base_f01_face_neutral_L50'] },
  })

  const tintedConfig = (): ChibiConfig => ({ kind: 'human', base: TINTED_BASE, outfit: { ...DEFAULT_OUTFIT } })

  it('tints body and hair-front with the hair colour, and leaves hair-back untouched', () => {
    const layers = layersFor({ ...tintedConfig(), hairColor: '#b3261e' }, 'neutral', 'full')
    expect(layers.find((l) => l.order === 30)?.tints).toEqual([{ mask: 'base_f01_L30_hairmask', colour: '#b3261e', meanL: 0.42 }])
    expect(layers.find((l) => l.order === 60)?.tints).toEqual([{ mask: 'base_f01_L60_hairmask', colour: '#b3261e', meanL: 0.42 }])
    expect(layers.find((l) => l.order === 20)?.tints).toBeUndefined()
  })

  it('carries hair then eye tint, in that order, on a face with both masks', () => {
    const layers = layersFor({ ...tintedConfig(), hairColor: '#b3261e', eyeColor: '#2f7fd6' }, 'neutral', 'full')
    expect(layers.find((l) => l.order === 50)?.tints).toEqual([
      { mask: 'base_f01_face_neutral_L50_hairmask', colour: '#b3261e', meanL: 0.42 },
      { mask: 'base_f01_face_neutral_L50_eyemask', colour: '#2f7fd6', meanL: 0.31 },
    ])
  })

  it('a face missing from eyes.files gets no eye tint even with eyeColor set', () => {
    const layers = layersFor({ ...tintedConfig(), eyeColor: '#2f7fd6' }, 'happy', 'full')
    expect(layers.find((l) => l.order === 50)?.tints).toBeUndefined()
  })

  it('a base without tint ignores the colours entirely', () => {
    const plainBase = makeBase('m01')
    const config: ChibiConfig = { kind: 'human', base: plainBase, outfit: { ...DEFAULT_OUTFIT }, hairColor: '#b3261e', eyeColor: '#2f7fd6' }
    const layers = layersFor(config, 'neutral', 'full')
    expect(layers.every((l) => l.tints === undefined)).toBe(true)
  })

  it('an item with tint gets its own tintmask', () => {
    const tintedHead: WearRef = { id: 'head_beret_blue01', order: 80, file: 'item_head_beret_red01_L80', tint: { colour: '#3f6fd8', meanL: 0.5 } }
    const layers = layersFor({ ...tintedConfig(), head: tintedHead }, 'neutral', 'full')
    expect(layers.find((l) => l.order === 80)?.tints).toEqual([{ mask: 'item_head_beret_red01_L80_tintmask', colour: '#3f6fd8', meanL: 0.5 }])
  })

  it('bots never carry tints', () => {
    const layers = layersFor({ kind: 'bot', index: 2 }, 'neutral', 'full')
    expect(layers.every((l) => l.tints === undefined)).toBe(true)
  })
})

describe('hashChibi — tints', () => {
  it('differs when hairColor, eyeColor or an item tint differs from the base configuration', () => {
    const config = bare()
    const withHair: ChibiConfig = { ...config, hairColor: '#b3261e' }
    const withEye: ChibiConfig = { ...config, eyeColor: '#2f7fd6' }
    const tintedOutfit: WearRef = { ...config.outfit, tint: { colour: '#c0392b', meanL: 0.5 } }
    const withItemTint: ChibiConfig = { ...config, outfit: tintedOutfit }

    expect(hashChibi(withHair)).not.toBe(hashChibi(config))
    expect(hashChibi(withEye)).not.toBe(hashChibi(config))
    expect(hashChibi(withItemTint)).not.toBe(hashChibi(config))
    expect(hashChibi(withHair)).not.toBe(hashChibi(withEye))
  })
})
