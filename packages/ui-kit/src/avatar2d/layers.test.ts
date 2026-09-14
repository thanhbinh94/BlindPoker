import { describe, expect, it } from 'vitest'
import { defaultChibi } from './defaults.js'
import { hashChibi, layersFor } from './layers.js'
import type { BotChibi, ChibiConfig, WearRef } from './types.js'

const AURA: WearRef = { id: 'aura_fire01', order: 10, file: 'item_aura_fire01_L10' }
const FRAME: WearRef = { id: 'frame_gold', order: 90, file: 'item_frame_gold_L90' }
const BERET: WearRef = { id: 'head_beret_red01', order: 80, file: 'item_head_beret_red01_L80' }
const HOOD: WearRef = { id: 'head_hood_black01', order: 80, file: 'item_head_hood_black01_L80', hidesHairFront: true, hidesHairBack: true }
const FACE_ACC: WearRef = { id: 'face_sunglasses01', order: 70, file: 'item_face_sunglasses01_L70' }

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
})
