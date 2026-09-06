import { describe, expect, it } from 'vitest'
import type { AvatarConfigDto } from '../api.js'
import { avatarPayload, portraitRelevant, withSlot } from './config.js'
import { hashConfig } from './hash.js'
import { nodeKeysOf } from './assemble.js'

const DRESSED: AvatarConfigDto = {
  v: 2,
  body: 'female',
  skin: '#efc9a4',
  eyes: '#6b4a2f',
  hairColor: '#d9a441',
  hair: 'hair_bun',
  top: 'clothing_aodai',
  bottom: 'bottom_skirt',
  shoes: 'shoes_sandals',
  hat: 'hat_crown',
  accessory: 'accessory_glasses',
  jewelry: 'jewelry_earrings',
  title: 'title_rookie',
  badge: 'badge_bronze',
}

describe('portraitRelevant', () => {
  it('keeps everything a head-and-shoulders crop can show', () => {
    expect(portraitRelevant(DRESSED)).toEqual({
      v: 2,
      body: 'female',
      skin: '#efc9a4',
      eyes: '#6b4a2f',
      hairColor: '#d9a441',
      hair: 'hair_bun',
      top: 'clothing_aodai',
      // Below the crop, or not geometry at all.
      bottom: '',
      shoes: '',
      hat: 'hat_crown',
      accessory: 'accessory_glasses',
      jewelry: 'jewelry_earrings',
    })
  })

  it('hashes the same however the slots it drops are changed', () => {
    const before = hashConfig(portraitRelevant(DRESSED))

    // One click on a pair of shoes used to change the cache key of every tile in the wardrobe at once.
    for (const changed of [
      withSlot(DRESSED, 'bottom', 'bottom_jeans'),
      withSlot(DRESSED, 'shoes', 'shoes_sneakers'),
      withSlot(DRESSED, 'title', ''),
      withSlot(DRESSED, 'badge', 'badge_gold'),
    ]) {
      expect(hashConfig(portraitRelevant(changed))).toBe(before)
    }
  })

  it('still notices every slot the crop does show', () => {
    const before = hashConfig(portraitRelevant(DRESSED))

    for (const changed of [
      { ...DRESSED, body: 'male' as const },
      { ...DRESSED, skin: '#8a563a' },
      { ...DRESSED, eyes: '#33608c' },
      { ...DRESSED, hairColor: '#c8323c' },
      withSlot(DRESSED, 'hair', 'hair_short'),
      withSlot(DRESSED, 'top', 'top_tee'),
      withSlot(DRESSED, 'hat', ''),
      withSlot(DRESSED, 'accessory', ''),
      withSlot(DRESSED, 'jewelry', ''),
    ]) {
      expect(hashConfig(portraitRelevant(changed)), JSON.stringify(changed)).not.toBe(before)
    }
  })

  it('asks the assembler for nothing it is not going to draw', () => {
    // The emptied required slots are `''`, which every reader of a configuration already treats as an
    // empty slot — so a portrait fetches two fewer `.glb` nodes rather than one malformed key.
    expect(nodeKeysOf(portraitRelevant(DRESSED))).toEqual([
      'body/female',
      'hair/hair_bun/female',
      'top/clothing_aodai/female',
      'hat/hat_crown/female',
      'accessory/accessory_glasses/female',
      'jewelry/jewelry_earrings/female',
    ])
  })

  it('is never what gets saved', () => {
    // The wire format is the whole outfit, and this is a picture's worth of it. Keeping the two apart is
    // the point of them being two functions.
    expect(avatarPayload(DRESSED).bottom).toBe('bottom_skirt')
    expect(avatarPayload(DRESSED).title).toBe('title_rookie')
  })
})
