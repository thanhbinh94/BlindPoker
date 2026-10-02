import { useTintedLayer, type LayerRef } from '@bp/ui-kit'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AchievementDefDto,
  AvatarCatalogDto,
  AvatarConfigDto,
  BaseDto,
  InventoryDto,
  ItemDto,
  NormalApi,
  OutfitDto,
} from '../../api.js'
import viNormal from '../../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../../test-i18n.js'
import { WardrobeScreen } from './WardrobeScreen.js'

// Plan 18 (No8a): a card's icon is tinted through the kit's `useTintedLayer` (`ItemPreview`). The hook answers a fake
// blob URL for a layer with tints and `null` — the plain icon — for one without, as the real one does under jsdom.
// Only the export the wardrobe's cards import is replaced; the stage's `Chibi` keeps the kit's own.
vi.mock('@bp/ui-kit', async (importOriginal) => ({ ...(await importOriginal<typeof import('@bp/ui-kit')>()), useTintedLayer: vi.fn() }))
beforeEach(() => {
  vi.mocked(useTintedLayer).mockImplementation((_prefix: string, layer: LayerRef) =>
    layer.tints === undefined || layer.tints.length === 0 ? null : `blob:http://localhost/${layer.tints[0]!.colour}`,
  )
})

const FACES = {
  neutral: 'base_f01_face_neutral_L50',
  happy: 'base_f01_face_happy_L50',
  sad: 'base_f01_face_sad_L50',
  surprised: 'base_f01_face_surprised_L50',
  closed: 'base_f01_face_closed_L50',
  sleep: 'base_f01_face_sleep_L50',
}
const BASE_F01: BaseDto = {
  id: 'f01',
  nameKey: 'bases.f01',
  wear: 'f',
  layers: { hairBack: 'base_f01_L20', body: 'base_f01_L30', hairFront: 'base_f01_L60' },
  faces: FACES,
}
const BASE_M01: BaseDto = {
  id: 'm01',
  nameKey: 'bases.m01',
  wear: 'm',
  layers: { hairBack: 'base_m01_L20', body: 'base_m01_L30', hairFront: 'base_m01_L60' },
  faces: { ...FACES, neutral: 'base_m01_face_neutral_L50' },
}

const item = (patch: Partial<ItemDto> & Pick<ItemDto, 'id' | 'slot' | 'rarity'>): ItemDto => ({
  nameKey: `items.${patch.id}`,
  assetKey: `${patch.slot}/${patch.id}`,
  isDefault: false,
  ...patch,
})

const OUTFIT_CASUAL = item({
  id: 'outfit_casual01',
  slot: 'outfit',
  rarity: 'common',
  isDefault: true,
  asset: { layer: 40, file: 'item_outfit_casual01_L40', fitsAvatarCrop: false },
})
const OUTFIT_TUXEDO = item({
  id: 'outfit_tuxedo01',
  slot: 'outfit',
  rarity: 'epic',
  asset: { layer: 40, file: 'item_outfit_tuxedo01_L40', fitsAvatarCrop: false },
})
const HEAD_TOPHAT = item({
  id: 'head_tophat01',
  slot: 'head',
  rarity: 'epic',
  asset: { layer: 80, file: 'item_head_tophat01_L80', fitsAvatarCrop: true },
})
const HEAD_BEANIE = item({
  id: 'head_beanie01',
  slot: 'head',
  rarity: 'common',
  asset: { layer: 80, file: 'item_head_beanie01_L80', fitsAvatarCrop: true },
})
/** A gendered outfit: one item, one id, a layer per wear (2026-09-20). */
const OUTFIT_DEALER = item({
  id: 'outfit_dealer01',
  slot: 'outfit',
  rarity: 'rare',
  asset: { layer: 40, file: 'item_outfit_dealer01_L40', variants: { m: 'item_outfit_dealer01_m_L40' }, fitsAvatarCrop: false },
})
const TITLE_ROOKIE = item({ id: 'title_rookie', slot: 'title', rarity: 'common' })

/** Plan 13 (design §6): a hair colour the player owns, one they don't, and a head card whose colour
 * variant they own even though the card itself (the original, untinted item) is locked — the case
 * the task brief calls out by name. */
const HAIRCOLOR_RED = item({ id: 'haircolor_red01', slot: 'hairColor', rarity: 'common', colour: '#b3261e' })
const HAIRCOLOR_BLUE = item({ id: 'haircolor_blue01', slot: 'hairColor', rarity: 'rare', colour: '#3355aa' })
const HEAD_BERET_RED = item({
  id: 'head_beret_red01',
  slot: 'head',
  rarity: 'rare',
  asset: { layer: 80, file: 'item_head_beret_red01_L80', fitsAvatarCrop: true },
})
const HEAD_BERET_BLUE = item({
  id: 'head_beret_blue01',
  slot: 'head',
  rarity: 'rare',
  asset: { layer: 80, file: 'item_head_beret_red01_L80', fitsAvatarCrop: true, tint: '#3f6fd8', tintMeanL: 0.5 },
})
/** A second beret variant the player does not own (No11a): its dot is hidden while the box is unticked. */
const HEAD_BERET_GREEN = item({
  id: 'head_beret_green01',
  slot: 'head',
  rarity: 'rare',
  asset: { layer: 80, file: 'item_head_beret_red01_L80', fitsAvatarCrop: true, tint: '#2e7d4f', tintMeanL: 0.5 },
})
/** No11a: a tab with something in it and nothing owned — the face tab's empty line. */
const FACE_SUNGLASSES = item({
  id: 'face_sunglasses01',
  slot: 'face',
  rarity: 'rare',
  asset: { layer: 70, file: 'item_face_sunglasses01_L70', fitsAvatarCrop: true },
})
const BADGE_BRONZE = item({ id: 'badge_bronze', slot: 'badge', rarity: 'common' })

const CATALOG = [
  OUTFIT_CASUAL,
  OUTFIT_TUXEDO,
  OUTFIT_DEALER,
  HEAD_TOPHAT,
  HEAD_BEANIE,
  TITLE_ROOKIE,
  BADGE_BRONZE,
  HAIRCOLOR_RED,
  HAIRCOLOR_BLUE,
  HEAD_BERET_RED,
  HEAD_BERET_BLUE,
  HEAD_BERET_GREEN,
  FACE_SUNGLASSES,
]

const AVATAR: AvatarConfigDto = { v: 3, base: 'f01', outfit: 'outfit_casual01', head: 'head_beanie01' }

const INVENTORY: InventoryDto = {
  items: [
    { itemId: 'outfit_casual01', acquiredAs: 'outfit_casual01', slot: 'outfit', rarity: 'common', nameKey: 'items.outfit_casual01', assetKey: 'outfit/outfit_casual01', source: 'default', acquiredAt: 0 },
    { itemId: 'head_beanie01', acquiredAs: 'head_beanie01', slot: 'head', rarity: 'common', nameKey: 'items.head_beanie01', assetKey: 'head/head_beanie01', source: 'default', acquiredAt: 0 },
    { itemId: 'haircolor_red01', acquiredAs: 'haircolor_red01', slot: 'hairColor', rarity: 'common', nameKey: 'items.haircolor_red01', assetKey: 'hairColor/haircolor_red01', source: 'default', acquiredAt: 0 },
    { itemId: 'head_beret_blue01', acquiredAs: 'head_beret_blue01', slot: 'head', rarity: 'rare', nameKey: 'items.head_beret_blue01', assetKey: 'head/head_beret_blue01', source: 'default', acquiredAt: 0 },
  ],
  avatar: AVATAR,
}

const AVATAR_CATALOG: AvatarCatalogDto = { frame: { w: 384, h: 448 }, crop: { x: 88, y: 40, size: 208 }, bases: [BASE_F01, BASE_M01], manifestVersion: 1 }

const ACHIEVEMENTS: AchievementDefDto[] = [
  { id: 'login_days_100', category: 'login', metric: 'totalLoginDays', threshold: 100, reward: { itemId: 'head_tophat01' } },
]

const noOutfits: (OutfitDto | null)[] = [null, null, null, null, null]

function stubApi(overrides: Partial<NormalApi> = {}): NormalApi {
  return {
    inventory: vi.fn().mockResolvedValue(INVENTORY),
    catalogItems: vi.fn().mockResolvedValue({ items: CATALOG }),
    avatarCatalog: vi.fn().mockResolvedValue(AVATAR_CATALOG),
    outfits: vi.fn().mockResolvedValue({ outfits: noOutfits }),
    catalogAchievements: vi.fn().mockResolvedValue({ achievements: ACHIEVEMENTS }),
    setAvatar: vi.fn().mockResolvedValue({ config: AVATAR }),
    saveOutfit: vi.fn(),
    deleteOutfit: vi.fn(),
    applyOutfit: vi.fn(),
    ...overrides,
  } as unknown as NormalApi
}

const renderScreen = (api: NormalApi = stubApi()) => renderWithI18n(<WardrobeScreen api={api} playerId="p1" />, makeI18n('vi'))

/**
 * `CategoryNav` nests two `tablist`s (design §3.1): the three groups, and the active group's own
 * sub-tabs. A group's label can equal one of its own sub-tabs' (`wear`'s "Trang phục" names both the
 * group and the `outfit` tab), so a bare `getByRole('tab', { name })` is ambiguous the moment that
 * group is active — this scopes each click to the right `tablist` by its `aria-label`, the same way
 * `CategoryNav.test.tsx` does. Passing no `tabLabel` lands on the group's first tab (its default).
 */
const GROUP_LABEL = viNormal.wardrobe.groups
async function goTo(user: UserEvent, group: keyof typeof GROUP_LABEL, tabLabel?: string): Promise<void> {
  const groupList = screen.getByRole('tablist', { name: viNormal.wardrobe.title })
  await user.click(within(groupList).getByRole('tab', { name: GROUP_LABEL[group] }))
  if (tabLabel === undefined) return
  const subList = screen.getByRole('tablist', { name: GROUP_LABEL[group] })
  // Every sub-tab but "Thân" carries an "n/m" count in its own accessible name (`CategoryNav`'s
  // `.tabCount`), so a caller's bare label only ever matches as a prefix.
  await user.click(within(subList).getByRole('tab', { name: new RegExp(`^${tabLabel}`) }))
}

/** No11a (design §3.1 item 3): the box that also lists what the account does not own yet. Unticked whenever the
 * wardrobe opens, hidden on the base tab; a test about a locked card ticks it first. */
const showLockedBox = (): HTMLElement => screen.getByRole('checkbox', { name: viNormal.wardrobe.showLocked })

describe('WardrobeScreen', () => {
  it('shows the base tab first, with both bases offered', async () => {
    renderScreen()

    await screen.findAllByText(viNormal.bases.f01)
    expect(screen.getByText(viNormal.bases.m01)).toBeInTheDocument()
  })

  it('offers a tile per base the catalogue answers with, however many that is', async () => {
    // The base list is data (2026-09-17): a third figure must reach the wardrobe with no change here
    // and no change in `BaseTab`. The name comes from its `nameKey`, which already exists in both
    // languages so the tile never shows a raw key.
    const BASE_F02: BaseDto = {
      id: 'f02',
      nameKey: 'bases.f02',
      wear: 'f',
      layers: { hairBack: 'base_f02_L20', body: 'base_f02_L30', hairFront: 'base_f02_L60' },
      faces: { ...FACES, neutral: 'base_f02_face_neutral_L50' },
    }
    renderScreen(stubApi({ avatarCatalog: vi.fn().mockResolvedValue({ ...AVATAR_CATALOG, bases: [BASE_F01, BASE_M01, BASE_F02] }) }))

    await screen.findAllByText(viNormal.bases.f01)
    const tiles = screen.getAllByRole('tabpanel')[0]!.querySelectorAll('button')
    expect(tiles).toHaveLength(3)
    expect(screen.getByText(viNormal.bases.f02)).toBeInTheDocument()
  })

  it('switches tabs on click', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findAllByText(viNormal.bases.f01)

    await goTo(user, 'wear', viNormal.wardrobe.tabs.head)

    expect(screen.getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.head}`) })).toHaveAttribute('aria-selected', 'true')
    // Scoped to the tile grid: "Mũ len" is also the wearing-list row's value, since it is the default equipped head.
    expect(within(screen.getByRole('tabpanel')).getByText(viNormal.items.head_beanie01)).toBeInTheDocument()
  })

  it('draws a head tile as the item icon, not as a figure wearing it', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findAllByText(viNormal.bases.f01)
    await goTo(user, 'wear', viNormal.wardrobe.tabs.head)
    await user.click(showLockedBox())

    const tile = screen.getByText(viNormal.items.head_tophat01).closest('button') as HTMLElement
    const icon = tile.querySelector('img')
    expect(icon).not.toBeNull()
    // Named after the layer (`item_head_tophat01_L80`) without its `_L80`, at both densities, from the asset base.
    expect(icon).toHaveAttribute('src', '/avatar/item_head_tophat01_icon@1x.png')
    expect(icon).toHaveAttribute('srcset', '/avatar/item_head_tophat01_icon@1x.png 1x, /avatar/item_head_tophat01_icon@2x.png 2x')
    expect(icon).toHaveAttribute('alt', '')
    expect(tile.querySelectorAll('img')).toHaveLength(1)
    expect(tile.querySelector('[data-chibi-hash]')).toBeNull()
  })

  it('switches a gendered outfit’s tile icon when the draft base changes', async () => {
    // 2026-09-20: one item, two cuts. The tile has to show the cut the figure on the stage beside it is
    // wearing, so it follows the *draft* base rather than the saved one — before anything is saved.
    const user = userEvent.setup()
    renderScreen()
    await screen.findAllByText(viNormal.bases.f01)

    const dealerIcon = async (): Promise<Element | null> => {
      await goTo(user, 'wear', viNormal.wardrobe.tabs.outfit)
      return screen.getByText(viNormal.items.outfit_dealer01).closest('button')!.querySelector('img')
    }
    // The dealer uniform is not owned: the box lists it, and stays ticked across the trip to the base tab below.
    await goTo(user, 'wear', viNormal.wardrobe.tabs.outfit)
    await user.click(showLockedBox())
    expect(await dealerIcon()).toHaveAttribute('src', '/avatar/item_outfit_dealer01_icon@1x.png')

    await goTo(user, 'look', viNormal.wardrobe.tabs.base)
    await user.click(screen.getByText(viNormal.bases.m01).closest('button') as HTMLElement)

    const icon = await dealerIcon()
    expect(icon).toHaveAttribute('src', '/avatar/item_outfit_dealer01_m_icon@1x.png')
    expect(icon).toHaveAttribute('srcset', '/avatar/item_outfit_dealer01_m_icon@1x.png 1x, /avatar/item_outfit_dealer01_m_icon@2x.png 2x')
    // An item with no cut for this wear is untouched: the tuxedo is one layer for everybody.
    const tuxedo = screen.getByText(viNormal.items.outfit_tuxedo01).closest('button')!.querySelector('img')
    expect(tuxedo).toHaveAttribute('src', '/avatar/item_outfit_tuxedo01_icon@1x.png')
  })

  it('locks an unowned tile, and a click on it does not equip anything', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findAllByText(viNormal.bases.f01)
    await goTo(user, 'wear', viNormal.wardrobe.tabs.head)
    await user.click(showLockedBox())

    const locked = screen.getByText(viNormal.items.head_tophat01).closest('button')
    expect(locked).toHaveAttribute('aria-disabled', 'true')
    expect(locked).toHaveAttribute('aria-pressed', 'false')

    await user.click(locked as HTMLElement)

    expect(locked).toHaveAttribute('aria-pressed', 'false')
    // The locked tile names how it could be earned — here, the achievement that rewards it.
    expect(within(locked as HTMLElement).getByText(viNormal.achievements.login_days_100.name)).toBeInTheDocument()
  })

  it('equips an owned tile, and a second click on the equipped one unequips it', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findAllByText(viNormal.bases.f01)
    await goTo(user, 'wear', viNormal.wardrobe.tabs.head)

    // Scoped to the tile grid: "Mũ len" is also the wearing-list row's value, since it is the default
    // equipped head.
    const panel = within(screen.getByRole('tabpanel'))
    const owned = panel.getByText(viNormal.items.head_beanie01).closest('button') as HTMLElement
    expect(owned).toHaveAttribute('aria-pressed', 'true')

    await user.click(owned)

    expect(owned).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows no false "unsaved changes" after unequipping and re-equipping the same slot, key order and all', async () => {
    // `sameConfig` used to compare drafts via `JSON.stringify`, which is sensitive to *key order* — and
    // `withSlot`'s `{ ...config, [slot]: itemId }` always appends a re-added key at the *end* of the
    // object, wherever it used to sit. Two optional slots (`head`, then `hairColor`) are what expose the
    // reorder: unequipping `head` and equipping it again moves it from before `hairColor` to after it, so
    // a config with the exact same slots and values as the saved one used to still read as "changed".
    const withHairColor: AvatarConfigDto = { ...AVATAR, hairColor: 'haircolor_red01' }
    const user = userEvent.setup()
    renderScreen(stubApi({ inventory: vi.fn().mockResolvedValue({ ...INVENTORY, avatar: withHairColor }) }))
    await screen.findAllByText(viNormal.bases.f01)
    await goTo(user, 'wear', viNormal.wardrobe.tabs.head)

    // Scoped to the tile grid: "Mũ len" is also the wearing-list row's value, since it is the default
    // equipped head.
    const owned = within(screen.getByRole('tabpanel')).getByText(viNormal.items.head_beanie01).closest('button') as HTMLElement
    await user.click(owned)
    expect(screen.getByText(viNormal.wardrobe.dirty)).toBeInTheDocument()

    await user.click(owned)

    expect(screen.queryByText(viNormal.wardrobe.dirty)).toBeNull()
  })

  it('cannot unequip the required outfit — a second click on it stays equipped', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findAllByText(viNormal.bases.f01)
    await goTo(user, 'wear', viNormal.wardrobe.tabs.outfit)

    // Scoped to the tile grid: "Bộ thường ngày" is also the wearing-list row's value, since it is the
    // default equipped outfit.
    const panel = within(screen.getByRole('tabpanel'))
    const equipped = panel.getByText(viNormal.items.outfit_casual01).closest('button') as HTMLElement
    expect(equipped).toHaveAttribute('aria-pressed', 'true')

    await user.click(equipped)

    expect(equipped).toHaveAttribute('aria-pressed', 'true')
  })

  it('switches base by clicking the other tile', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findAllByText(viNormal.bases.f01)

    const m01 = screen.getByText(viNormal.bases.m01).closest('button') as HTMLElement
    expect(m01).toHaveAttribute('aria-pressed', 'false')

    await user.click(m01)

    expect(m01).toHaveAttribute('aria-pressed', 'true')
  })

  it('sends the v3 draft to setAvatar on save', async () => {
    const setAvatar = vi.fn().mockResolvedValue({ config: { ...AVATAR, base: 'm01' } })
    const user = userEvent.setup()
    renderScreen(stubApi({ setAvatar }))
    await screen.findAllByText(viNormal.bases.f01)

    await user.click(screen.getByText(viNormal.bases.m01))
    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.save }))

    await waitFor(() => expect(setAvatar).toHaveBeenCalledWith(expect.objectContaining({ v: 3, base: 'm01', outfit: 'outfit_casual01' })))
    expect(await screen.findByText(viNormal.wardrobe.saved)).toBeInTheDocument()
  })

  // The saved-outfit portraits' own behaviour (menu, save/overwrite/rename/delete, empty-slot save) now
  // lives entirely in `SavedOutfits.test.tsx` — this is only the wiring: `WardrobeScreen` passes the
  // right props through and reacts to `onApplied` by pushing the config into the draft and showing
  // "saved", same as a direct `save()` (design §5.3, §3.1 item 4).
  it('wires the saved-outfit portraits in: applying one updates the draft and shows the saved notice', async () => {
    const outfitOne: OutfitDto = { slot: 1, name: 'Đi làm', config: { v: 3, base: 'm01', outfit: 'outfit_tuxedo01' }, updatedAt: 0 }
    const applyOutfit = vi.fn().mockResolvedValue({ config: outfitOne.config })
    const user = userEvent.setup()
    renderScreen(stubApi({ outfits: vi.fn().mockResolvedValue({ outfits: [outfitOne, null, null, null, null] }), applyOutfit }))
    await screen.findAllByText(viNormal.bases.f01)

    await user.click(screen.getByRole('button', { name: viNormal.outfits.menu.replace('{{name}}', 'Đi làm') }))
    await user.click(screen.getByRole('button', { name: viNormal.outfits.apply }))

    await waitFor(() => expect(applyOutfit).toHaveBeenCalledWith(1))
    expect(await screen.findByText(viNormal.wardrobe.saved)).toBeInTheDocument()
  })

  describe('colour tabs (Plan 13)', () => {
    it('lists a Natural swatch plus owned and locked colour swatches in the hair colour tab', async () => {
      const user = userEvent.setup()
      renderScreen()
      await screen.findAllByText(viNormal.bases.f01)

      await goTo(user, 'look', viNormal.wardrobe.tabs.hairColor)

      // A card's accessible name is "<name>, <rarity>[, wearing|, locked: <hint>]" (design §7) — the redesign's
      // `cardLabel`, not the bare item name Plan 13 queried by.
      const lockedName = `${viNormal.items.haircolor_blue01}, ${viNormal.inventory.rarity.rare}, ${viNormal.wardrobe.filter.locked}: ${viNormal.wardrobe.hint.daily.rare}`
      // No11a: by default only "Tự nhiên" and the owned swatches; the box adds the locked ones.
      expect(screen.getByRole('button', { name: viNormal.wardrobe.natural })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `${viNormal.items.haircolor_red01}, ${viNormal.inventory.rarity.common}` })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: lockedName })).toBeNull()

      await user.click(showLockedBox())

      expect(screen.getByRole('button', { name: viNormal.wardrobe.natural })).toBeInTheDocument()
      const owned = screen.getByRole('button', { name: `${viNormal.items.haircolor_red01}, ${viNormal.inventory.rarity.common}` })
      expect(owned).toHaveAttribute('aria-disabled', 'false')
      const locked = screen.getByRole('button', { name: lockedName })
      expect(locked).toHaveAttribute('aria-disabled', 'true')
    })

    it('a click on a locked swatch does not equip anything', async () => {
      const user = userEvent.setup()
      renderScreen()
      await screen.findAllByText(viNormal.bases.f01)
      await goTo(user, 'look', viNormal.wardrobe.tabs.hairColor)
      await user.click(showLockedBox())

      const locked = screen.getByRole('button', {
        name: `${viNormal.items.haircolor_blue01}, ${viNormal.inventory.rarity.rare}, ${viNormal.wardrobe.filter.locked}: ${viNormal.wardrobe.hint.daily.rare}`,
      })
      await user.click(locked)

      expect(locked).toHaveAttribute('aria-pressed', 'false')
    })

    it('picks an owned hair colour, changes the preview hash, sends it to setAvatar, and Natural clears it back', async () => {
      const setAvatar = vi.fn().mockResolvedValue({ config: { ...AVATAR, hairColor: 'haircolor_red01' } })
      const user = userEvent.setup()
      renderScreen(stubApi({ setAvatar }))
      await screen.findAllByText(viNormal.bases.f01)
      const chibi = document.querySelector('[data-chibi-hash]') as HTMLElement
      const before = chibi.getAttribute('data-chibi-hash')

      await goTo(user, 'look', viNormal.wardrobe.tabs.hairColor)
      const natural = screen.getByRole('button', { name: viNormal.wardrobe.natural })
      expect(natural).toHaveAttribute('aria-pressed', 'true')

      const red = screen.getByRole('button', { name: `${viNormal.items.haircolor_red01}, ${viNormal.inventory.rarity.common}` })
      await user.click(red)

      expect(red).toHaveAttribute('aria-pressed', 'true')
      expect(natural).toHaveAttribute('aria-pressed', 'false')
      expect(chibi.getAttribute('data-chibi-hash')).not.toBe(before)

      await user.click(screen.getByRole('button', { name: viNormal.wardrobe.save }))
      await waitFor(() => expect(setAvatar).toHaveBeenCalledWith(expect.objectContaining({ hairColor: 'haircolor_red01' })))

      await user.click(natural)

      expect(natural).toHaveAttribute('aria-pressed', 'true')
      expect(red).toHaveAttribute('aria-pressed', 'false')
    })

    // Final fix wave (B2): ticking the box only adds cards and dots. It used to turn this card — the owned blue beret —
    // into the locked original.
    it('with the box ticked, keeps the beret card on the owned blue variant and adds the locked members as dots — equips a variant by its dot, and never lists a variant as its own card', async () => {
      const setAvatar = vi.fn().mockResolvedValue({ config: { ...AVATAR, head: 'head_beret_blue01' } })
      const user = userEvent.setup()
      renderScreen(stubApi({ setAvatar }))
      await screen.findAllByText(viNormal.bases.f01)
      await goTo(user, 'wear', viNormal.wardrobe.tabs.head)
      const rare = viNormal.inventory.rarity.rare
      const panel = within(screen.getByRole('tabpanel'))
      const card = panel.getByRole('button', { name: `${viNormal.items.head_beret_blue01}, ${rare}` })

      await user.click(showLockedBox())

      // The same card, still the blue beret the player owns: not the locked original, and no card of the original's.
      expect(card).toHaveAccessibleName(`${viNormal.items.head_beret_blue01}, ${rare}`)
      expect(card).toHaveAttribute('aria-disabled', 'false')
      expect(card.querySelector('img')).toHaveAttribute('src', 'blob:http://localhost/#3f6fd8')
      expect(panel.queryByText(viNormal.items.head_beret_red01)).toBeNull()
      const cardCount = panel.getAllByRole('button', { name: /,/ }).length

      // No8a: the dot row is the whole family, the original first, each dot titled with its member's name; the box adds
      // the two the player does not own, locked.
      const row = panel.getByRole('group', { name: viNormal.items.head_beret_red01 })
      expect(within(row).getAllByRole('button').map((each) => each.getAttribute('title'))).toEqual([
        viNormal.items.head_beret_red01,
        viNormal.items.head_beret_blue01,
        viNormal.items.head_beret_green01,
      ])
      expect(within(row).getByRole('button', { name: viNormal.items.head_beret_red01 })).toHaveAttribute('aria-disabled', 'true')
      const dot = within(row).getByRole('button', { name: viNormal.items.head_beret_blue01 })
      expect(dot).toHaveAttribute('aria-disabled', 'false')
      const green = within(row).getByRole('button', { name: viNormal.items.head_beret_green01 })
      expect(green).toHaveAttribute('aria-disabled', 'true')

      await user.click(green)
      expect(card, 'a locked dot equips nothing').toHaveAttribute('aria-pressed', 'false')

      await user.click(dot)
      expect(dot).toHaveAttribute('aria-pressed', 'true')
      // No8a: the card follows the variant now worn — its name, owned, worn, its own colour — and is still one card.
      expect(card).toHaveAccessibleName(`${viNormal.items.head_beret_blue01}, ${rare}, ${viNormal.wardrobe.wearingBadge}`)
      expect(card).toHaveAttribute('aria-pressed', 'true')
      expect(card.querySelector('img')).toHaveAttribute('src', 'blob:http://localhost/#3f6fd8')
      expect(panel.getAllByRole('button', { name: /,/ })).toHaveLength(cardCount)

      await user.click(screen.getByRole('button', { name: viNormal.wardrobe.save }))

      await waitFor(() => expect(setAvatar).toHaveBeenCalledWith(expect.objectContaining({ head: 'head_beret_blue01' })))
    })

    it('with the box unticked, a family whose original is not owned shows its first owned variant — named, owned, a click equips it — and hides the dots not owned', async () => {
      // No11a, pre-flight amendment 5: the beret's original (`head_beret_red01`) is not owned, its blue variant is.
      const setAvatar = vi.fn().mockResolvedValue({ config: { ...AVATAR, head: 'head_beret_blue01' } })
      const user = userEvent.setup()
      renderScreen(stubApi({ setAvatar }))
      await screen.findAllByText(viNormal.bases.f01)
      await goTo(user, 'wear', viNormal.wardrobe.tabs.head)
      expect(showLockedBox()).not.toBeChecked()

      const panel = within(screen.getByRole('tabpanel'))
      expect(panel.queryByText(viNormal.items.head_beret_red01)).toBeNull()
      const card = panel.getByRole('button', { name: `${viNormal.items.head_beret_blue01}, ${viNormal.inventory.rarity.rare}` })
      expect(card).toHaveAttribute('aria-disabled', 'false')
      expect(card).toHaveAttribute('aria-pressed', 'false')
      // Drawn in its own colour (No8a).
      expect(card.querySelector('img')).toHaveAttribute('src', 'blob:http://localhost/#3f6fd8')
      // The dots not owned are hidden — the original's and the green one's — which leaves the shown variant alone, and a
      // row of one dot repeating the card is no row at all (No8a).
      expect(panel.queryByRole('group', { name: viNormal.items.head_beret_red01 })).toBeNull()
      expect(panel.queryByRole('button', { name: viNormal.items.head_beret_green01 })).toBeNull()

      await user.click(card)
      expect(card).toHaveAttribute('aria-pressed', 'true')

      await user.click(screen.getByRole('button', { name: viNormal.wardrobe.save }))
      await waitFor(() => expect(setAvatar).toHaveBeenCalledWith(expect.objectContaining({ head: 'head_beret_blue01' })))
    })

    it('follows the family member being worn: the original’s untinted dot puts the original back, and a second press on the worn card takes it off', async () => {
      // Review 2026-09-29, No8a (Plan 18, pre-flight amendment 1): both the original and the blue variant are owned, the
      // blue one is worn.
      const withBothBerets: InventoryDto = {
        items: [
          ...INVENTORY.items,
          { itemId: 'head_beret_red01', acquiredAs: 'head_beret_red01', slot: 'head', rarity: 'rare', nameKey: 'items.head_beret_red01', assetKey: 'head/head_beret_red01', source: 'default', acquiredAt: 0 },
        ],
        avatar: { ...AVATAR, head: 'head_beret_blue01' },
      }
      const user = userEvent.setup()
      renderScreen(stubApi({ inventory: vi.fn().mockResolvedValue(withBothBerets) }))
      await screen.findAllByText(viNormal.bases.f01)
      await goTo(user, 'wear', viNormal.wardrobe.tabs.head)

      const panel = within(screen.getByRole('tabpanel'))
      const rare = viNormal.inventory.rarity.rare
      const wearing = viNormal.wardrobe.wearingBadge
      const card = panel.getByRole('button', { name: `${viNormal.items.head_beret_blue01}, ${rare}, ${wearing}` })
      expect(card).toHaveAttribute('aria-pressed', 'true')
      expect(within(card).getByText(wearing)).toBeInTheDocument()
      expect(card.querySelector('img')).toHaveAttribute('src', 'blob:http://localhost/#3f6fd8')
      const row = panel.getByRole('group', { name: viNormal.items.head_beret_red01 })
      const [original, blue] = within(row).getAllByRole('button')
      expect(original).toHaveAccessibleName(viNormal.items.head_beret_red01)
      expect(original).toHaveAttribute('aria-pressed', 'false')
      expect(blue).toHaveAccessibleName(viNormal.items.head_beret_blue01)
      expect(blue).toHaveAttribute('aria-pressed', 'true')

      await user.click(original!)

      expect(card).toHaveAccessibleName(`${viNormal.items.head_beret_red01}, ${rare}, ${wearing}`)
      expect(original).toHaveAttribute('aria-pressed', 'true')
      expect(blue).toHaveAttribute('aria-pressed', 'false')
      // The original is drawn as it is, from its plain two-density icon.
      expect(card.querySelector('img')).toHaveAttribute('src', '/avatar/item_head_beret_red01_icon@1x.png')

      // Mũ is optional: a second press on the worn card takes it off, and the card stays the (owned) original.
      await user.click(card)

      expect(card).toHaveAccessibleName(`${viNormal.items.head_beret_red01}, ${rare}`)
      expect(card).toHaveAttribute('aria-pressed', 'false')
      expect(original).toHaveAttribute('aria-pressed', 'false')
    })

    // Final fix wave (B1): the outfit slot is required, so a press on the worn tee keeps it on — the original's dot is
    // the one way back to "Bộ thường ngày", and it has to say so.
    it('takes a coloured outfit back to the original by the original’s dot, named after it', async () => {
      const OUTFIT_CASUAL_RED = item({
        id: 'outfit_casual_red01',
        slot: 'outfit',
        rarity: 'common',
        asset: { layer: 40, file: 'item_outfit_casual01_L40', fitsAvatarCrop: false, tint: '#c0392b', tintMeanL: 0.5 },
      })
      const wearingTheTee: InventoryDto = {
        items: [
          ...INVENTORY.items,
          { itemId: 'outfit_casual_red01', acquiredAs: 'outfit_casual_red01', slot: 'outfit', rarity: 'common', nameKey: 'items.outfit_casual_red01', assetKey: 'outfit/outfit_casual_red01', source: 'default', acquiredAt: 0 },
        ],
        avatar: { ...AVATAR, outfit: 'outfit_casual_red01' },
      }
      const setAvatar = vi.fn().mockResolvedValue({ config: AVATAR })
      const user = userEvent.setup()
      renderScreen(
        stubApi({ catalogItems: vi.fn().mockResolvedValue({ items: [...CATALOG, OUTFIT_CASUAL_RED] }), inventory: vi.fn().mockResolvedValue(wearingTheTee), setAvatar }),
      )
      await screen.findAllByText(viNormal.bases.f01)
      await goTo(user, 'wear', viNormal.wardrobe.tabs.outfit)

      const panel = within(screen.getByRole('tabpanel'))
      const common = viNormal.inventory.rarity.common
      const wearing = viNormal.wardrobe.wearingBadge
      const card = panel.getByRole('button', { name: `${viNormal.items.outfit_casual_red01}, ${common}, ${wearing}` })
      // Required: pressing the worn tee leaves it on.
      await user.click(card)
      expect(card).toHaveAttribute('aria-pressed', 'true')

      const row = panel.getByRole('group', { name: viNormal.items.outfit_casual01 })
      const original = within(row).getByRole('button', { name: viNormal.items.outfit_casual01 })
      expect(original, 'titled for a pointer too').toHaveAttribute('title', viNormal.items.outfit_casual01)
      expect(original).toHaveAttribute('aria-pressed', 'false')
      expect(original).toHaveAttribute('aria-disabled', 'false')

      await user.click(original)

      expect(original).toHaveAttribute('aria-pressed', 'true')
      expect(card).toHaveAccessibleName(`${viNormal.items.outfit_casual01}, ${common}, ${wearing}`)
      await user.click(screen.getByRole('button', { name: viNormal.wardrobe.save }))
      await waitFor(() => expect(setAvatar).toHaveBeenCalledWith(expect.objectContaining({ outfit: 'outfit_casual01' })))
    })
  })

  describe('header (design §3.1): dirty label, undo', () => {
    it('shows the dirty label only while the draft differs from the saved config, and clears it on save', async () => {
      const setAvatar = vi.fn().mockResolvedValue({ config: { ...AVATAR, base: 'm01' } })
      const user = userEvent.setup()
      renderScreen(stubApi({ setAvatar }))
      await screen.findAllByText(viNormal.bases.f01)
      expect(screen.queryByText(viNormal.wardrobe.dirty)).toBeNull()

      await user.click(screen.getByText(viNormal.bases.m01))
      expect(screen.getByText(viNormal.wardrobe.dirty)).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: viNormal.wardrobe.save }))

      await waitFor(() => expect(setAvatar).toHaveBeenCalled())
      expect(screen.queryByText(viNormal.wardrobe.dirty)).toBeNull()
    })

    it('undoes a change without calling the server, restoring the preview hash and clearing the dirty label', async () => {
      const setAvatar = vi.fn()
      const user = userEvent.setup()
      renderScreen(stubApi({ setAvatar }))
      await screen.findAllByText(viNormal.bases.f01)
      const chibi = document.querySelector('[data-chibi-hash]') as HTMLElement
      const before = chibi.getAttribute('data-chibi-hash')
      const undoButton = screen.getByRole('button', { name: viNormal.wardrobe.undo })
      expect(undoButton).toBeDisabled()

      await user.click(screen.getByText(viNormal.bases.m01))
      expect(chibi.getAttribute('data-chibi-hash')).not.toBe(before)
      expect(undoButton).toBeEnabled()

      await user.click(undoButton)

      expect(chibi.getAttribute('data-chibi-hash')).toBe(before)
      expect(undoButton).toBeDisabled()
      expect(screen.queryByText(viNormal.wardrobe.dirty)).toBeNull()
      expect(setAvatar).not.toHaveBeenCalled()
    })
  })

  describe('CategoryNav wiring (design §3.1, §5.5)', () => {
    it('jumps to a slot’s group and tab when its wearing-list row is clicked', async () => {
      const user = userEvent.setup()
      renderScreen()
      await screen.findAllByText(viNormal.bases.f01)

      // "Mũ" (head) is rendered once at this point — the wearing-list row — since the default group,
      // "look", does not show the "wear" group's own sub-tabs yet.
      await user.click(screen.getByText(viNormal.wardrobe.tabs.head).closest('button') as HTMLElement)

      const subList = screen.getByRole('tablist', { name: viNormal.wardrobe.groups.wear })
      expect(within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.head}`) })).toHaveAttribute('aria-selected', 'true')
      // Scoped to the tile grid: "Mũ len" is also the wearing-list row just clicked.
      expect(within(screen.getByRole('tabpanel')).getByText(viNormal.items.head_beanie01)).toBeInTheDocument()
    })

    // Review 2026-09-29, No11a (design §3.1 item 3, §5.5): owned items by default, one box for the rest. Acceptance
    // row 66.19 cites this title.
    it('lists only what the account owns by default, and the box shows the rest', async () => {
      const user = userEvent.setup()
      renderScreen()
      await screen.findAllByText(viNormal.bases.f01)
      // The base tab is chosen, not owned: no box there.
      expect(screen.queryByRole('checkbox')).toBeNull()

      await goTo(user, 'wear', viNormal.wardrobe.tabs.head)
      expect(showLockedBox()).not.toBeChecked()
      const cardNames = (): string[] =>
        within(screen.getByRole('tabpanel'))
          .getAllByRole('button', { name: /,/ })
          .map((card) => card.getAttribute('aria-label')!.split(',')[0]!)
      // Owned: the beanie, and the beret family through its blue variant. Not owned: the top hat.
      expect(cardNames()).toEqual([viNormal.items.head_beanie01, viNormal.items.head_beret_blue01])
      expect(screen.queryByText(viNormal.items.head_tophat01)).toBeNull()

      await user.click(showLockedBox())

      expect(showLockedBox()).toBeChecked()
      // The box only adds: the beret family is still the blue beret the account owns (final fix wave, B2).
      expect(cardNames()).toEqual([viNormal.items.head_beanie01, viNormal.items.head_beret_blue01, viNormal.items.head_tophat01])
      const tophat = screen.getByText(viNormal.items.head_tophat01).closest('button')
      expect(tophat).toHaveAttribute('aria-disabled', 'true')

      await user.click(showLockedBox())

      expect(showLockedBox()).not.toBeChecked()
      expect(screen.queryByText(viNormal.items.head_tophat01)).toBeNull()
    })

    it('keeps the box ticked or unticked across tab changes — a jump from the wearing list included', async () => {
      const user = userEvent.setup()
      renderScreen()
      await screen.findAllByText(viNormal.bases.f01)
      await goTo(user, 'wear', viNormal.wardrobe.tabs.head)

      await user.click(showLockedBox())
      expect(screen.getByText(viNormal.items.head_tophat01)).toBeInTheDocument()

      await goTo(user, 'wear', viNormal.wardrobe.tabs.outfit)
      expect(showLockedBox()).toBeChecked()
      expect(within(screen.getByRole('tabpanel')).getByText(viNormal.items.outfit_tuxedo01)).toBeInTheDocument()

      // Through the base tab, where the box is hidden, and back by the wearing list's "Mũ" row.
      await goTo(user, 'look', viNormal.wardrobe.tabs.base)
      expect(screen.queryByRole('checkbox')).toBeNull()
      await user.click(screen.getByText(viNormal.wardrobe.tabs.head).closest('button') as HTMLElement)
      expect(showLockedBox()).toBeChecked()
      expect(screen.getByText(viNormal.items.head_tophat01)).toBeInTheDocument()

      await user.click(showLockedBox())
      await goTo(user, 'wear', viNormal.wardrobe.tabs.outfit)
      expect(showLockedBox()).not.toBeChecked()
      expect(within(screen.getByRole('tabpanel')).queryByText(viNormal.items.outfit_tuxedo01)).toBeNull()
    })

    it('replaces the grid with one line, inside the same tabpanel, on a tab where nothing is owned', async () => {
      const user = userEvent.setup()
      renderScreen()
      await screen.findAllByText(viNormal.bases.f01)

      await goTo(user, 'wear', viNormal.wardrobe.tabs.face)

      const faceTab = screen.getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.face}`) })
      const panel = screen.getByRole('tabpanel')
      expect(panel).toHaveAttribute('id', faceTab.getAttribute('aria-controls'))
      expect(panel).toHaveAttribute('aria-labelledby', faceTab.id)
      const line = within(panel).getByText(viNormal.wardrobe.emptyOwned)
      expect(line.tagName).toBe('P')
      expect(within(panel).queryAllByRole('button')).toHaveLength(0)
      // Nothing in it to Tab to, so the panel takes the focus itself (the ARIA tabs pattern).
      expect(panel).toHaveAttribute('tabindex', '0')

      await user.click(showLockedBox())

      // The same panel, now holding the grid: the locked sunglasses card, and no line.
      expect(screen.getByRole('tabpanel')).toBe(panel)
      expect(within(panel).queryByText(viNormal.wardrobe.emptyOwned)).toBeNull()
      expect(panel, 'its cards take the focus now').not.toHaveAttribute('tabindex')
      expect(within(panel).getByText(viNormal.items.face_sunglasses01).closest('button')).toHaveAttribute('aria-disabled', 'true')
    })

    it('swaps the stage to the framed head portrait on the frame tab', async () => {
      const user = userEvent.setup()
      renderScreen()
      await screen.findAllByText(viNormal.bases.f01)

      await goTo(user, 'decor', viNormal.wardrobe.tabs.frame)

      const chibi = document.querySelector('[data-chibi-hash]') as HTMLElement
      expect(chibi).toHaveAttribute('data-frame', 'head')
    })

    it('draws the words tab (title/badge) as one tabpanel wrapping both headings and grids, correctly labelled', async () => {
      const user = userEvent.setup()
      renderScreen()
      await screen.findAllByText(viNormal.bases.f01)

      await goTo(user, 'decor', viNormal.wardrobe.tabs.words)
      // Neither word is owned (pre-flight amendment 2): the box lists them.
      await user.click(showLockedBox())

      // Two `ItemTab` calls (title, badge) used to each draw their own `role="tabpanel"`, with the heading
      // sitting outside either one — exactly one tabpanel, wrapping both headings and both grids, is the fix.
      const panels = screen.getAllByRole('tabpanel')
      expect(panels).toHaveLength(1)
      const panel = within(panels[0]!)
      expect(panel.getByRole('heading', { name: viNormal.wardrobe.words.titles })).toBeInTheDocument()
      expect(panel.getByRole('heading', { name: viNormal.wardrobe.words.badges })).toBeInTheDocument()
      expect(panel.getByText(viNormal.items.title_rookie)).toBeInTheDocument()
      expect(panel.getByText(viNormal.items.badge_bronze)).toBeInTheDocument()

      // The panel and its tab name each other (design §7): the tab's `aria-controls` is the panel's own
      // `id`, and the panel's `aria-labelledby` is the tab's own `id`.
      const wordsTab = screen.getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.words}`) })
      expect(wordsTab.id).not.toBe('')
      expect(panels[0]).toHaveAttribute('id', wordsTab.getAttribute('aria-controls'))
      expect(panels[0]).toHaveAttribute('aria-labelledby', wordsTab.id)
    })

    it('on the words tab with the box unticked, hides a heading with nothing owned under it, and says so once inside the panel when neither has anything', async () => {
      const user = userEvent.setup()
      renderScreen()
      await screen.findAllByText(viNormal.bases.f01)

      await goTo(user, 'decor', viNormal.wardrobe.tabs.words)

      const panels = screen.getAllByRole('tabpanel')
      expect(panels).toHaveLength(1)
      const wordsTab = screen.getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.words}`) })
      expect(panels[0]).toHaveAttribute('id', wordsTab.getAttribute('aria-controls'))
      expect(panels[0]).toHaveAttribute('aria-labelledby', wordsTab.id)
      const panel = within(panels[0]!)
      expect(panel.queryByRole('heading')).toBeNull()
      expect(panel.getAllByText(viNormal.wardrobe.emptyOwned)).toHaveLength(1)
      expect(panel.queryAllByRole('button')).toHaveLength(0)
      expect(panels[0], 'the panel takes the focus, having nothing else to give it').toHaveAttribute('tabindex', '0')
    })

    it('on the words tab, an owned badge alone shows the badge heading and its card — no title heading, no empty line', async () => {
      const user = userEvent.setup()
      const withBadge: InventoryDto = {
        ...INVENTORY,
        items: [
          ...INVENTORY.items,
          { itemId: 'badge_bronze', acquiredAs: 'badge_bronze', slot: 'badge', rarity: 'common', nameKey: 'items.badge_bronze', assetKey: 'badge/badge_bronze', source: 'default', acquiredAt: 0 },
        ],
      }
      renderScreen(stubApi({ inventory: vi.fn().mockResolvedValue(withBadge) }))
      await screen.findAllByText(viNormal.bases.f01)

      await goTo(user, 'decor', viNormal.wardrobe.tabs.words)

      const panel = within(screen.getByRole('tabpanel'))
      expect(panel.queryByRole('heading', { name: viNormal.wardrobe.words.titles })).toBeNull()
      expect(panel.getByRole('heading', { name: viNormal.wardrobe.words.badges })).toBeInTheDocument()
      expect(panel.getByText(viNormal.items.badge_bronze).closest('button')).toHaveAttribute('aria-disabled', 'false')
      expect(panel.queryByText(viNormal.items.title_rookie)).toBeNull()
      expect(panel.queryByText(viNormal.wardrobe.emptyOwned)).toBeNull()
      expect(screen.getByRole('tabpanel')).not.toHaveAttribute('tabindex')
    })

    it('gives every tab a roving tabindex: only the selected one sits in the page Tab order', async () => {
      renderScreen()
      await screen.findAllByText(viNormal.bases.f01)

      const groupList = screen.getByRole('tablist', { name: viNormal.wardrobe.title })
      expect(within(groupList).getByRole('tab', { name: viNormal.wardrobe.groups.look })).toHaveAttribute('tabindex', '0')
      expect(within(groupList).getByRole('tab', { name: viNormal.wardrobe.groups.wear })).toHaveAttribute('tabindex', '-1')
      expect(within(groupList).getByRole('tab', { name: viNormal.wardrobe.groups.decor })).toHaveAttribute('tabindex', '-1')

      const subList = screen.getByRole('tablist', { name: viNormal.wardrobe.groups.look })
      expect(within(subList).getByRole('tab', { name: viNormal.wardrobe.tabs.base })).toHaveAttribute('tabindex', '0')
      expect(within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.hairColor}`) })).toHaveAttribute('tabindex', '-1')
    })

    it("every sub-tab's aria-controls names its own panel's id, for every one of the three panel shapes", async () => {
      const user = userEvent.setup()
      renderScreen()
      await screen.findAllByText(viNormal.bases.f01)

      // `base` (`BaseTab`) is the tab this screen opens on — no navigation needed for it.
      const baseTab = screen.getByRole('tab', { name: viNormal.wardrobe.tabs.base })
      expect(screen.getByRole('tabpanel')).toHaveAttribute('id', baseTab.getAttribute('aria-controls'))
      expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', baseTab.id)

      await goTo(user, 'wear', viNormal.wardrobe.tabs.head)
      const headTab = screen.getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.head}`) })
      let panel = screen.getByRole('tabpanel')
      expect(panel).toHaveAttribute('id', headTab.getAttribute('aria-controls'))
      expect(panel).toHaveAttribute('aria-labelledby', headTab.id)

      // `hairColor` (`ColourTab`) — the third of the three shapes.
      await goTo(user, 'look', viNormal.wardrobe.tabs.hairColor)
      const hairTab = screen.getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.hairColor}`) })
      panel = screen.getByRole('tabpanel')
      expect(panel).toHaveAttribute('id', hairTab.getAttribute('aria-controls'))
      expect(panel).toHaveAttribute('aria-labelledby', hairTab.id)
    })
  })

  describe('leaving with unsaved changes', () => {
    // The guard is document-level (any `#/…` link anywhere counts, matching how every route in the app is
    // reached), so a plain link stands in for the rail here rather than mounting the whole app shell.
    const renderWithLink = () =>
      renderWithI18n(
        <>
          <a href="#/profile">profile link</a>
          <WardrobeScreen api={stubApi()} playerId="p1" />
        </>,
        makeI18n('vi'),
      )

    it('asks before leaving a dirty draft, and does not navigate until the player says so', async () => {
      const user = userEvent.setup()
      window.location.hash = '#/wardrobe'
      renderWithLink()
      await screen.findAllByText(viNormal.bases.f01)

      await user.click(screen.getByText(viNormal.bases.m01)) // dirties the draft
      // Scoped to the tile grid: once equipped, "Tóc rối" also names the wearing-list row.
      expect(within(screen.getByRole('tabpanel')).getByText(viNormal.bases.m01).closest('button')).toHaveAttribute('aria-pressed', 'true')

      await user.click(screen.getByRole('link', { name: 'profile link' }))

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText(viNormal.wardrobe.leaveBody)).toBeInTheDocument()
      // The click was intercepted before the browser acted on it.
      expect(window.location.hash).toBe('#/wardrobe')
    })

    it('stays on the wardrobe, draft intact, when the player chooses to stay', async () => {
      const user = userEvent.setup()
      window.location.hash = '#/wardrobe'
      renderWithLink()
      await screen.findAllByText(viNormal.bases.f01)
      await user.click(screen.getByText(viNormal.bases.m01))
      await user.click(screen.getByRole('link', { name: 'profile link' }))

      await user.click(screen.getByRole('button', { name: viNormal.wardrobe.leaveStay }))

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(window.location.hash).toBe('#/wardrobe')
      expect(within(screen.getByRole('tabpanel')).getByText(viNormal.bases.m01).closest('button')).toHaveAttribute('aria-pressed', 'true')
    })

    it('navigates away and drops the draft when the player chooses to discard it', async () => {
      const user = userEvent.setup()
      window.location.hash = '#/wardrobe'
      renderWithLink()
      await screen.findAllByText(viNormal.bases.f01)
      await user.click(screen.getByText(viNormal.bases.m01))
      await user.click(screen.getByRole('link', { name: 'profile link' }))

      await user.click(screen.getByRole('button', { name: viNormal.wardrobe.leaveDiscard }))

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(window.location.hash).toBe('#/profile')
    })
  })
})
