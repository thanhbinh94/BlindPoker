import { describe, expect, it } from 'vitest'
import type { ItemDto } from '../../api.js'
import { applyFilter, counts, GROUPS, groupOf, slotCards, tabItems, tabOfSlot, variantsByFile, type TabId } from './categories.js'

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
        { id: 'look', tabs: ['hairColor', 'eyeColor'] },
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
      // Plan 19: the two v4 slots get tabs of their own (A6 puts them in `GROUPS`).
      expect(tabOfSlot('hairStyle')).toBe('hairStyle')
      expect(tabOfSlot('skinColor')).toBe('skinColor')
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


    it('is zero over zero for a tab the catalogue has nothing in', () => {
      expect(counts('aura', CATALOG, new Set())).toEqual({ owned: 0, total: 0 })
    })
  })

  // Review 2026-09-29, No11a (design §3.1 item 3, §5.5): the wardrobe lists what the player owns, and one box shows
  // the rest. A card is a family — an original plus the colour variants that share its file — so owning any member
  // keeps the card.
  describe('variantsByFile / applyFilter / slotCards (families, owned by default)', () => {
    const tinted = (id: string, file: string, tint: string): ItemDto =>
      item({ id, slot: 'head', rarity: 'rare', asset: { layer: 80, file, fitsAvatarCrop: true, tint, tintMeanL: 0.5 } })
    const BEANIE = item({ id: 'head_beanie01', slot: 'head', rarity: 'common', asset: { layer: 80, file: 'item_head_beanie01_L80', fitsAvatarCrop: true } })
    const BEANIE_RED = tinted('head_beanie_red01', 'item_head_beanie01_L80', '#b83a32')
    const CAP = item({ id: 'head_cap', slot: 'head', rarity: 'common', asset: { layer: 80, file: 'item_head_cap_L80', fitsAvatarCrop: true } })
    const BERET_RED = item({ id: 'head_beret_red01', slot: 'head', rarity: 'rare', asset: { layer: 80, file: 'item_head_beret_red01_L80', fitsAvatarCrop: true } })
    const BERET_BLUE = tinted('head_beret_blue01', 'item_head_beret_red01_L80', '#3f6fd8')
    const BERET_GREEN = tinted('head_beret_green01', 'item_head_beret_red01_L80', '#2e7d4f')
    const TITLE = item({ id: 'title_rookie', slot: 'title', rarity: 'common' })

    const CATALOG = [BEANIE, CAP, BERET_RED, BEANIE_RED, BERET_BLUE, BERET_GREEN, TITLE]
    const ORIGINALS = [BEANIE, CAP, BERET_RED]
    const VARIANTS = variantsByFile(CATALOG)

    it('groups colour variants under the file they share with their original, in catalogue order; an original is never a key', () => {
      expect([...VARIANTS.entries()]).toEqual([
        ['item_head_beanie01_L80', [BEANIE_RED]],
        ['item_head_beret_red01_L80', [BERET_BLUE, BERET_GREEN]],
      ])
    })

    // Plan 18 (No8a, pre-flight amendment 1): the dot row is the whole family, the original first, so the original
    // can be picked back from a variant — owned members only while the box is unticked, and no row at all when it
    // would hold nothing but the member the card already shows.
    it('keeps a family whose original is owned, showing the original, its dots the owned members — original first', () => {
      expect(applyFilter(ORIGINALS, new Set(['head_beanie01']), false, VARIANTS)).toEqual([{ original: BEANIE, shown: BEANIE, dots: [] }])
      expect(applyFilter(ORIGINALS, new Set(['head_beanie01', 'head_beanie_red01']), false, VARIANTS)).toEqual([
        { original: BEANIE, shown: BEANIE, dots: [BEANIE, BEANIE_RED] },
      ])
    })

    it('keeps a family when only a variant is owned (the beret): the card shows that variant, with no dot row of one', () => {
      // `head_beret_red01` (the original) is not owned, `head_beret_blue01` is, `head_beret_green01` is not.
      expect(applyFilter(ORIGINALS, new Set(['head_beret_blue01']), false, VARIANTS)).toEqual([
        { original: BERET_RED, shown: BERET_BLUE, dots: [] },
      ])
    })

    it('shows the first owned variant, in catalogue order, when the original is not owned and several are', () => {
      const [card] = applyFilter([BERET_RED], new Set(['head_beret_green01', 'head_beret_blue01']), false, VARIANTS)
      expect(card).toEqual({ original: BERET_RED, shown: BERET_BLUE, dots: [BERET_BLUE, BERET_GREEN] })
    })

    it('hides a family the player owns nothing of — unless the box is ticked', () => {
      expect(applyFilter(ORIGINALS, new Set(), false, VARIANTS)).toEqual([])
      expect(applyFilter(ORIGINALS, new Set(), true, VARIANTS).map((card) => card.original)).toEqual(ORIGINALS)
    })

    // Final fix wave (B2): ticking the box only adds cards and dots. It used to turn the owned blue beret's card into the
    // locked original.
    it('with the box ticked lists every family and the whole family as dots, owned or not — a card still shows what is owned', () => {
      expect(applyFilter(ORIGINALS, new Set(['head_beret_blue01']), true, VARIANTS)).toEqual([
        { original: BEANIE, shown: BEANIE, dots: [BEANIE, BEANIE_RED] },
        { original: CAP, shown: CAP, dots: [] },
        { original: BERET_RED, shown: BERET_BLUE, dots: [BERET_RED, BERET_BLUE, BERET_GREEN] },
      ])
    })

    // Plan 18 (No8a): the card is the member being worn — its name, its tinted icon, its "Đang dùng" — whichever box.
    it('shows the member being worn, ticked or not, and keeps the family where it was in the order', () => {
      const owned = new Set(['head_beret_red01', 'head_beret_blue01', 'head_beret_green01', 'head_cap'])
      for (const showLocked of [false, true]) {
        const cards = applyFilter(ORIGINALS, owned, showLocked, VARIANTS, 'head_beret_green01')
        const beret = cards.find((card) => card.original === BERET_RED)
        expect(beret, `box ${showLocked ? 'ticked' : 'unticked'}`).toEqual({ original: BERET_RED, shown: BERET_GREEN, dots: [BERET_RED, BERET_BLUE, BERET_GREEN] })
        expect(cards.at(-1)).toBe(beret)
      }
      // The worn original is the original, and a worn member of another family changes nothing here.
      expect(applyFilter([BERET_RED], owned, false, VARIANTS, 'head_beret_red01')[0]!.shown).toBe(BERET_RED)
      expect(applyFilter([BERET_RED], owned, false, VARIANTS, 'head_cap')[0]!.shown).toBe(BERET_RED)
    })

    it('with nothing of the family worn, shows the original when it is owned, else the first owned variant, else the original — whichever box', () => {
      const variantOnly = new Set(['head_beret_green01'])
      const both = new Set(['head_beret_red01', 'head_beret_green01'])
      for (const showLocked of [false, true]) {
        const box = `box ${showLocked ? 'ticked' : 'unticked'}`
        expect(applyFilter([BERET_RED], variantOnly, showLocked, VARIANTS)[0]!.shown, box).toBe(BERET_GREEN)
        expect(applyFilter([BERET_RED], both, showLocked, VARIANTS)[0]!.shown, box).toBe(BERET_RED)
      }
      // Nothing of it owned: only the ticked box lists it, as its original.
      expect(applyFilter([BERET_RED], new Set(), true, VARIANTS)[0]!.shown).toBe(BERET_RED)
    })

    it('treats a row with no variants (a colour swatch, a word, a variant map left out) as a family of one', () => {
      expect(applyFilter([TITLE, CAP], new Set(['title_rookie']), false)).toEqual([{ original: TITLE, shown: TITLE, dots: [] }])
    })

    it("slotCards: a slot's cards in tab order, its variants folded into families, owned only unless the box is ticked", () => {
      const owned = new Set(['head_beret_blue01', 'head_cap'])
      expect(slotCards('head', CATALOG, owned, false)).toEqual([
        { original: CAP, shown: CAP, dots: [] },
        { original: BERET_RED, shown: BERET_BLUE, dots: [] },
      ])
      expect(slotCards('head', CATALOG, owned, true).map((card) => card.shown.id)).toEqual(['head_beanie01', 'head_cap', 'head_beret_blue01'])
      // The member worn in the slot (Plan 18, No8a), ahead of the first owned variant.
      const greenToo = new Set([...owned, 'head_beret_green01'])
      expect(slotCards('head', CATALOG, greenToo, true, 'head_beret_green01').map((card) => card.shown.id)).toEqual(['head_beanie01', 'head_cap', 'head_beret_green01'])
      expect(slotCards('title', CATALOG, owned, false)).toEqual([])
      expect(slotCards('title', CATALOG, owned, true)).toEqual([{ original: TITLE, shown: TITLE, dots: [] }])
    })
  })

  it('TabId covers every group tab (type-level smoke: this assignment must compile)', () => {
    const all: TabId[] = GROUPS.flatMap((g) => g.tabs)
    // Eight since Plan 19 dropped the base tab; Kiểu tóc and Màu da join the look group in A6.
    expect(all).toHaveLength(8)
  })
})
