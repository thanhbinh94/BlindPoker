import { describe, expect, it } from 'vitest'
import { AURA_MOTION, auraMotionOf } from './aura-motion.js'

describe('auraMotionOf', () => {
  it('names the motion of the three Thần auras', () => {
    expect(auraMotionOf('item_aura_card_god01_L10')).toBe('glow')
    expect(auraMotionOf('item_aura_demigod01_L10')).toBe('twinkle')
    expect(auraMotionOf('item_aura_godslayer01_L10')).toBe('flicker')
    expect(Object.keys(AURA_MOTION)).toHaveLength(3)
  })

  it('knows nothing of any other layer, or of an inherited key', () => {
    expect(auraMotionOf('item_aura_fire01_L10')).toBeNull()
    expect(auraMotionOf('body_f_L30')).toBeNull()
    expect(auraMotionOf('toString')).toBeNull()
  })
})
