import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
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
  layers: { hairBack: 'base_f01_L20', body: 'base_f01_L30', hairFront: 'base_f01_L60' },
  faces: FACES,
}
const BASE_M01: BaseDto = {
  id: 'm01',
  nameKey: 'bases.m01',
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
const TITLE_ROOKIE = item({ id: 'title_rookie', slot: 'title', rarity: 'common' })

const CATALOG = [OUTFIT_CASUAL, OUTFIT_TUXEDO, HEAD_TOPHAT, HEAD_BEANIE, TITLE_ROOKIE]

const AVATAR: AvatarConfigDto = { v: 3, base: 'f01', outfit: 'outfit_casual01', head: 'head_beanie01' }

const INVENTORY: InventoryDto = {
  items: [
    { itemId: 'outfit_casual01', acquiredAs: 'outfit_casual01', slot: 'outfit', rarity: 'common', nameKey: 'items.outfit_casual01', assetKey: 'outfit/outfit_casual01', source: 'default', acquiredAt: 0 },
    { itemId: 'head_beanie01', acquiredAs: 'head_beanie01', slot: 'head', rarity: 'common', nameKey: 'items.head_beanie01', assetKey: 'head/head_beanie01', source: 'default', acquiredAt: 0 },
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

describe('WardrobeScreen', () => {
  it('shows the base tab first, with both bases offered', async () => {
    renderScreen()

    await screen.findByText(viNormal.bases.f01)
    expect(screen.getByText(viNormal.bases.m01)).toBeInTheDocument()
  })

  it('switches tabs on click', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText(viNormal.bases.f01)

    await user.click(screen.getByRole('tab', { name: viNormal.wardrobe.tabs.head }))

    expect(screen.getByRole('tab', { name: viNormal.wardrobe.tabs.head })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(viNormal.items.head_tophat01)).toBeInTheDocument()
  })

  it('draws a head tile as the item icon, not as a figure wearing it', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText(viNormal.bases.f01)
    await user.click(screen.getByRole('tab', { name: viNormal.wardrobe.tabs.head }))

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

  it('locks an unowned tile, and a click on it does not equip anything', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText(viNormal.bases.f01)
    await user.click(screen.getByRole('tab', { name: viNormal.wardrobe.tabs.head }))

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
    await screen.findByText(viNormal.bases.f01)
    await user.click(screen.getByRole('tab', { name: viNormal.wardrobe.tabs.head }))

    const owned = screen.getByText(viNormal.items.head_beanie01).closest('button') as HTMLElement
    expect(owned).toHaveAttribute('aria-pressed', 'true')

    await user.click(owned)

    expect(owned).toHaveAttribute('aria-pressed', 'false')
  })

  it('cannot unequip the required outfit — a second click on it stays equipped', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText(viNormal.bases.f01)
    await user.click(screen.getByRole('tab', { name: viNormal.wardrobe.tabs.outfit }))

    const equipped = screen.getByText(viNormal.items.outfit_casual01).closest('button') as HTMLElement
    expect(equipped).toHaveAttribute('aria-pressed', 'true')

    await user.click(equipped)

    expect(equipped).toHaveAttribute('aria-pressed', 'true')
  })

  it('switches base by clicking the other tile', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText(viNormal.bases.f01)

    const m01 = screen.getByText(viNormal.bases.m01).closest('button') as HTMLElement
    expect(m01).toHaveAttribute('aria-pressed', 'false')

    await user.click(m01)

    expect(m01).toHaveAttribute('aria-pressed', 'true')
  })

  it('sends the v3 draft to setAvatar on save', async () => {
    const setAvatar = vi.fn().mockResolvedValue({ config: { ...AVATAR, base: 'm01' } })
    const user = userEvent.setup()
    renderScreen(stubApi({ setAvatar }))
    await screen.findByText(viNormal.bases.f01)

    await user.click(screen.getByText(viNormal.bases.m01))
    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.save }))

    await waitFor(() => expect(setAvatar).toHaveBeenCalledWith(expect.objectContaining({ v: 3, base: 'm01', outfit: 'outfit_casual01' })))
    expect(await screen.findByText(viNormal.wardrobe.saved)).toBeInTheDocument()
  })

  it('saves the current draft into an outfit slot with the default name', async () => {
    const saved: OutfitDto = { slot: 1, name: 'Bộ 1', config: AVATAR, updatedAt: 0 }
    const saveOutfit = vi.fn().mockResolvedValue(saved)
    const user = userEvent.setup()
    renderScreen(stubApi({ saveOutfit }))
    await screen.findByText(viNormal.bases.f01)

    await user.click(screen.getAllByRole('button', { name: viNormal.outfits.saveHere })[0] as HTMLElement)
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByDisplayValue(viNormal.outfits.defaultName.replace('{{n}}', '1'))).toBeInTheDocument()

    await user.click(dialog.getByRole('button', { name: viNormal.outfits.saveHere }))

    await waitFor(() => expect(saveOutfit).toHaveBeenCalledWith(1, 'Bộ 1', expect.objectContaining({ v: 3 })))
  })

  it('applies a saved outfit and pushes its config into the draft', async () => {
    const outfitOne: OutfitDto = { slot: 1, name: 'Đi làm', config: { v: 3, base: 'm01', outfit: 'outfit_tuxedo01' }, updatedAt: 0 }
    const applyOutfit = vi.fn().mockResolvedValue({ config: outfitOne.config })
    const user = userEvent.setup()
    renderScreen(stubApi({ outfits: vi.fn().mockResolvedValue({ outfits: [outfitOne, null, null, null, null] }), applyOutfit }))
    const filledSlot = (await screen.findByText('Đi làm')).closest('div') as HTMLElement

    await user.click(within(filledSlot).getByRole('button', { name: viNormal.outfits.apply }))

    await waitFor(() => expect(applyOutfit).toHaveBeenCalledWith(1))
  })

  it('deletes a saved outfit', async () => {
    const outfitOne: OutfitDto = { slot: 1, name: 'Đi làm', config: AVATAR, updatedAt: 0 }
    const deleteOutfit = vi.fn().mockResolvedValue({ removed: true })
    const user = userEvent.setup()
    renderScreen(stubApi({ outfits: vi.fn().mockResolvedValue({ outfits: [outfitOne, null, null, null, null] }), deleteOutfit }))
    await screen.findByText('Đi làm')

    await user.click(screen.getByRole('button', { name: viNormal.outfits.delete }))

    await waitFor(() => expect(deleteOutfit).toHaveBeenCalledWith(1))
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
      await screen.findByText(viNormal.bases.f01)

      await user.click(screen.getByText(viNormal.bases.m01)) // dirties the draft
      expect(screen.getByText(viNormal.bases.m01).closest('button')).toHaveAttribute('aria-pressed', 'true')

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
      await screen.findByText(viNormal.bases.f01)
      await user.click(screen.getByText(viNormal.bases.m01))
      await user.click(screen.getByRole('link', { name: 'profile link' }))

      await user.click(screen.getByRole('button', { name: viNormal.wardrobe.leaveStay }))

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(window.location.hash).toBe('#/wardrobe')
      expect(screen.getByText(viNormal.bases.m01).closest('button')).toHaveAttribute('aria-pressed', 'true')
    })

    it('navigates away and drops the draft when the player chooses to discard it', async () => {
      const user = userEvent.setup()
      window.location.hash = '#/wardrobe'
      renderWithLink()
      await screen.findByText(viNormal.bases.f01)
      await user.click(screen.getByText(viNormal.bases.m01))
      await user.click(screen.getByRole('link', { name: 'profile link' }))

      await user.click(screen.getByRole('button', { name: viNormal.wardrobe.leaveDiscard }))

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(window.location.hash).toBe('#/profile')
    })
  })
})
