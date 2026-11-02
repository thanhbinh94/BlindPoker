import { describe, expect, it } from 'vitest'
import { rewardItemIds, rewardItemIdsOf, type AchievementDef } from './definitions.js'

const base = { category: 'chaos', metric: 'chaosAscensions', threshold: 1 } as const
const def = (id: string, reward: AchievementDef['reward']): AchievementDef => ({ ...base, id, reward })

describe('rewardItemIds', () => {
  it('lists the reward item first and then its set, in order', () => {
    expect(rewardItemIds(def('a', { points: 1, itemId: 'title_god', setItems: ['outfit_card_god01', 'head_ace_crown01'] }))).toEqual([
      'title_god',
      'outfit_card_god01',
      'head_ace_crown01',
    ])
  })

  it('is the reward item alone when there is no set, and empty for a points-only reward', () => {
    expect(rewardItemIds(def('a', { itemId: 'title_devoted' }))).toEqual(['title_devoted'])
    expect(rewardItemIds(def('b', { points: 500 }))).toEqual([])
  })

  it('drops an undefined itemId but keeps the set', () => {
    expect(rewardItemIds(def('c', { points: 1, setItems: ['aura_card_god01'] }))).toEqual(['aura_card_god01'])
  })
})

describe('rewardItemIdsOf', () => {
  it('collects every id any definition grants, set pieces included (what the daily draw must never hand out)', () => {
    const ids = rewardItemIdsOf([
      def('god', { points: 1, itemId: 'title_god', setItems: ['aura_card_god01', 'frame_card_god'] }),
      def('plain', { points: 1 }),
      def('slayer', { itemId: 'title_godslayer' }),
    ])
    expect(ids).toEqual(['title_god', 'aura_card_god01', 'frame_card_god', 'title_godslayer'])
  })
})
