import { describe, expect, it } from 'vitest'
import type { ItemDto } from '../../api.js'
import { applyFilter, counts, GROUPS, groupOf, tabItems, tabOfSlot, type TabId } from './categories.js'

const item = (patch: Partial<ItemDto> & Pick<ItemDto, 'id' | 'slot' | 'rarity'>): ItemDto => ({
  nameKey: `items.${patch.id}`,
  assetKey: `${patch.slot}/${patch.id}`,
  isDefault: false,
  ...patch,
})

describe('categories', () => {
  describe('GROUPS / groupOf / tabOfSlot', () => {
    it('lists the three groups in design §3.1 order, each with its tabs', () => {
      expect(GROUPS).toEqual([
        { id: 'look', tabs: ['base', 'hairColor', 'eyeColor'] },
        { id: 'wear', tabs: ['head', 'face', 'outfit'] },
        { id: 'decor', tabs: ['aura', 'frame', 'words'] },
      ])
    })

    it('maps every tab back to the group that lists it', () => {
      for (const group of GROUPS) {
        for (const tab of group.tabs) {
          expect(groupOf(tab)).toBe(group.id)
        }
      }
    })

    it('maps every drawn/coloured slot to the tab of the same name', () => {
      expect(tabOfSlot('head')).toBe('head')
      expect(tabOfSlot('face')).toBe('face')
      expect(tabOfSlot('outfit')).toBe('outfit')
      expect(tabOfSlot('aura')).toBe('aura')
      expect(tabOfSlot('frame')).toBe('frame')
      expect(tabOfSlot('hairColor')).toBe('hairColor')
      expect(tabOfSlot('eyeColor')).toBe('eyeColor')
    })

    it('maps title and badge — the two word slots — to the words tab', () => {
      expect(tabOfSlot('title')).toBe('words')
      expect(tabOfSlot('badge')).toBe('words')
    })
  })

  describe('tabItems', () => {
    // Deliberately out of rarity order and interleaved with an unrelated slot, so a naive `.filter` that
    // happens to preserve catalogue order is not enough to pass — the sort has to actually run.
    const HEAD_EPIC = item({ id: 'head_crown', slot: 'head', rarity: 'epic' })
    const HEAD_COMMON_A = item({ id: 'head_beanie', slot: 'head', rarity: 'common' })
    const OUTFIT_ONE = item({ id: 'outfit_one', slot: 'outfit', rarity: 'common' })
    const HEAD_RARE = item({ id: 'head_beret', slot: 'head', rarity: 'rare', asset: { layer: 80, file: 'item_head_beret_L80', fitsAvatarCrop: true } })
    const HEAD_COMMON_B = item({ id: 'head_cap', slot: 'head', rarity: 'common' })
    // A colour variant of `head_beret`: shares its `asset.file` and carries its own `tint` — a dot, not a card.
    const HEAD_BERET_BLUE = item({
      id: 'head_beret_blue',
      slot: 'head',
      rarity: 'rare',
      asset: { layer: 80, file: 'item_head_beret_L80', fitsAvatarCrop: true, tint: '#336', tintMeanL: 0.5 },
    })
    const TITLE_ONE = item({ id: 'title_one', slot: 'title', rarity: 'rare' })
    const BADGE_ONE = item({ id: 'badge_one', slot: 'badge', rarity: 'common' })

    const CATALOG = [HEAD_EPIC, HEAD_COMMON_A, OUTFIT_ONE, HEAD_RARE, HEAD_COMMON_B, HEAD_BERET_BLUE, TITLE_ONE, BADGE_ONE]

    it('lists only the slot in question, excludes colour variants, and orders common → rare → epic then catalogue order', () => {
      expect(tabItems('head', CATALOG)).toEqual([HEAD_COMMON_A, HEAD_COMMON_B, HEAD_RARE, HEAD_EPIC])
    })

    it('never lists a colour variant as its own card', () => {
      const ids = tabItems('head', CATALOG).map((row) => row.id)
      expect(ids).not.toContain(HEAD_BERET_BLUE.id)
    })

    it('combines title and badge under the words tab', () => {
      expect(tabItems('words', CATALOG)).toEqual([BADGE_ONE, TITLE_ONE])
    })

    it('answers an empty list for the base tab — a base is chosen, not a catalogue row', () => {
      expect(tabItems('base', CATALOG)).toEqual([])
    })
  })

  describe('counts', () => {
    const HEAD_A = item({ id: 'head_a', slot: 'head', rarity: 'common' })
    const HEAD_B = item({ id: 'head_b', slot: 'head', rarity: 'rare' })
    const HEAD_B_BLUE = item({
      id: 'head_b_blue',
      slot: 'head',
      rarity: 'rare',
      asset: { layer: 80, file: 'item_head_b_L80', fitsAvatarCrop: true, tint: '#336', tintMeanL: 0.5 },
    })
    const OUTFIT_A = item({ id: 'outfit_a', slot: 'outfit', rarity: 'common' })
    const CATALOG = [HEAD_A, HEAD_B, HEAD_B_BLUE, OUTFIT_A]

    it('counts owned against the total of every catalogue row for the tab, colour variants included', () => {
      const owned = new Set(['head_a', 'head_b_blue'])
      expect(counts('head', CATALOG, owned)).toEqual({ owned: 2, total: 3 })
    })

    it('is null for the base tab — a base is never "owned"', () => {
      expect(counts('base', CATALOG, new Set())).toBeNull()
    })

    it('is zero over zero for a tab the catalogue has nothing in', () => {
      expect(counts('aura', CATALOG, new Set())).toEqual({ owned: 0, total: 0 })
    })
  })

  describe('applyFilter', () => {
    const A = item({ id: 'a', slot: 'head', rarity: 'common' })
    const B = item({ id: 'b', slot: 'head', rarity: 'common' })
    const C = item({ id: 'c', slot: 'head', rarity: 'common' })
    const rows = [A, B, C]
    const owned = new Set(['a', 'c'])

    it('"all" keeps everything', () => {
      expect(applyFilter(rows, owned, 'all')).toEqual([A, B, C])
    })

    it('"owned" keeps only what is owned', () => {
      expect(applyFilter(rows, owned, 'owned')).toEqual([A, C])
    })

    it('"locked" keeps only what is not owned', () => {
      expect(applyFilter(rows, owned, 'locked')).toEqual([B])
    })
  })

  it('TabId covers every group tab (type-level smoke: this assignment must compile)', () => {
    const all: TabId[] = GROUPS.flatMap((g) => g.tabs)
    expect(all).toHaveLength(9)
  })
})
