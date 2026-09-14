import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  type AvatarCatalogDto,
  type AvatarConfigDto,
  type BaseDto,
  type InventoryDto,
  type ItemDto,
  type NormalApi,
  type OwnedItemDto,
} from '../api.js'
import viNormal from '../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../test-i18n.js'
import { InventoryScreen } from './InventoryScreen.js'

const owned = (itemId: string, slot: OwnedItemDto['slot'], rarity: OwnedItemDto['rarity'], source: string): OwnedItemDto => ({
  itemId,
  slot,
  rarity,
  nameKey: `items.${itemId}`,
  assetKey: `${slot}/${itemId}`,
  source,
  acquiredAt: Date.UTC(2026, 0, 15),
})

const BASE_F01: BaseDto = {
  id: 'f01',
  nameKey: 'bases.f01',
  layers: { hairBack: 'base_f01_L20', body: 'base_f01_L30', hairFront: 'base_f01_L60' },
  faces: {
    neutral: 'base_f01_face_neutral_L50',
    happy: 'base_f01_face_happy_L50',
    sad: 'base_f01_face_sad_L50',
    surprised: 'base_f01_face_surprised_L50',
    closed: 'base_f01_face_closed_L50',
    sleep: 'base_f01_face_sleep_L50',
  },
}
const AVATAR_CATALOG: AvatarCatalogDto = { frame: { w: 384, h: 448 }, crop: { x: 112, y: 48, size: 160 }, bases: [BASE_F01], manifestVersion: 1 }

const OUTFIT_CASUAL: ItemDto = {
  id: 'outfit_casual01',
  slot: 'outfit',
  rarity: 'common',
  nameKey: 'items.outfit_casual01',
  assetKey: 'outfit/outfit_casual01',
  isDefault: true,
  asset: { layer: 40, file: 'item_outfit_casual01_L40', fitsAvatarCrop: false },
}
const HEAD_BEANIE: ItemDto = {
  id: 'head_beanie01',
  slot: 'head',
  rarity: 'common',
  nameKey: 'items.head_beanie01',
  assetKey: 'head/head_beanie01',
  isDefault: false,
  asset: { layer: 80, file: 'item_head_beanie01_L80', fitsAvatarCrop: true },
}
const HEAD_TOPHAT: ItemDto = {
  id: 'head_tophat01',
  slot: 'head',
  rarity: 'epic',
  nameKey: 'items.head_tophat01',
  assetKey: 'head/head_tophat01',
  isDefault: false,
  asset: { layer: 80, file: 'item_head_tophat01_L80', fitsAvatarCrop: true },
}
const CATALOG: ItemDto[] = [OUTFIT_CASUAL, HEAD_BEANIE, HEAD_TOPHAT]

const EQUIPPED: AvatarConfigDto = { v: 3, base: 'f01', outfit: 'outfit_casual01', head: 'head_beanie01', title: 'title_rookie' }

const INVENTORY: InventoryDto = {
  items: [
    owned('outfit_casual01', 'outfit', 'common', 'default'),
    owned('head_beanie01', 'head', 'common', 'default'),
    owned('head_tophat01', 'head', 'epic', 'achievement'),
    owned('title_rookie', 'title', 'common', 'achievement'),
  ],
  avatar: EQUIPPED,
}

function stubApi(overrides: Partial<NormalApi> = {}): NormalApi {
  return {
    inventory: vi.fn().mockResolvedValue(INVENTORY),
    catalogItems: vi.fn().mockResolvedValue({ items: CATALOG }),
    avatarCatalog: vi.fn().mockResolvedValue(AVATAR_CATALOG),
    ...overrides,
  } as unknown as NormalApi
}

const renderScreen = (api: NormalApi = stubApi()) => renderWithI18n(<InventoryScreen api={api} lang="vi" />, makeI18n('vi'))

/** The `<ul>` inside the panel whose heading names this slot. */
const panelOf = (slot: keyof typeof viNormal.inventory.slot) => {
  const heading = screen.getByRole('heading', { name: viNormal.inventory.slot[slot] })
  const section = heading.closest('section')
  if (section === null) throw new Error(`no panel for ${slot}`)
  return within(section)
}

describe('InventoryScreen', () => {
  it('shows a status line while the inventory is in flight', () => {
    renderScreen(stubApi({ inventory: vi.fn(() => new Promise<InventoryDto>(() => undefined)) }))

    expect(screen.getByRole('status')).toHaveTextContent(viNormal.screens.loading)
  })

  it('says so when the inventory cannot be read, and asks again when told to', async () => {
    const inventory = vi.fn().mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'nope')).mockResolvedValue(INVENTORY)
    const user = userEvent.setup()
    renderScreen(stubApi({ inventory }))

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.inventory.error)

    await user.click(screen.getByRole('button', { name: viNormal.screens.retry }))

    expect(await screen.findByText(viNormal.items.head_beanie01)).toBeInTheDocument()
  })

  it('groups every slot and counts what is owned', async () => {
    renderScreen()
    await screen.findByText(viNormal.items.head_beanie01)

    for (const label of Object.values(viNormal.inventory.slot)) {
      expect(screen.getByRole('heading', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByText(viNormal.inventory.summary.replace('{{owned}}', '4'))).toBeInTheDocument()
  })

  it('gives each piece its rarity, its source and the day it arrived', async () => {
    renderScreen()
    await screen.findByText(viNormal.items.head_beanie01)

    const head = panelOf('head')
    expect(head.getByText(viNormal.items.head_tophat01)).toBeInTheDocument()
    expect(head.getByText(viNormal.inventory.rarity.epic)).toBeInTheDocument()
    expect(head.getByText(viNormal.inventory.source.achievement)).toBeInTheDocument()
    expect(head.getAllByText(/2026/).length).toBeGreaterThan(0)
  })

  it('previews each drawn item on the figure that would wear it, and draws nothing for a word', async () => {
    renderScreen()
    await screen.findByText(viNormal.items.head_beanie01)

    // The tile for a head piece the player is *not* wearing is a picture of them wearing it — the same
    // avatar with that one slot swapped in.
    await waitFor(() => {
      expect(panelOf('head').getByText(viNormal.items.head_tophat01).closest('li')?.querySelector('[data-chibi-hash]')).not.toBeNull()
    })
    // `title` has no geometry, so its tile carries words and nothing else.
    expect(panelOf('title').getByText(viNormal.items.title_rookie).closest('li')?.querySelector('[data-chibi-hash]')).toBeNull()
  })

  it('marks what the avatar is actually wearing, worn pieces and words alike', async () => {
    renderScreen()
    await screen.findByText(viNormal.items.head_beanie01)

    expect(panelOf('head').getAllByText(viNormal.inventory.equipped)).toHaveLength(1)
    expect(panelOf('title').getByText(viNormal.inventory.equipped)).toBeInTheDocument()
    expect(panelOf('outfit').getByText(viNormal.inventory.equipped)).toBeInTheDocument()
  })

  it('says a slot is empty rather than showing an empty box', async () => {
    renderScreen()
    await screen.findByText(viNormal.items.head_beanie01)

    expect(panelOf('face').getByText(viNormal.inventory.empty)).toBeInTheDocument()
    expect(panelOf('badge').getByText(viNormal.inventory.empty)).toBeInTheDocument()
    expect(panelOf('head').queryByText(viNormal.inventory.empty)).toBeNull()
  })

  it('names an item this bundle has never heard of by its id, never by an i18n key', async () => {
    renderScreen(
      stubApi({
        inventory: vi.fn().mockResolvedValue({ ...INVENTORY, items: [owned('head_lunar_2027', 'head', 'epic', 'daily')] }),
      }),
    )

    expect(await screen.findByText('head_lunar_2027')).toBeInTheDocument()
    expect(screen.queryByText('items.head_lunar_2027')).toBeNull()
  })
})
