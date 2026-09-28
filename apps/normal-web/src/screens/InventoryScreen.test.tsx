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
  acquiredAs: itemId,
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
  wear: 'f',
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
const AVATAR_CATALOG: AvatarCatalogDto = { frame: { w: 384, h: 448 }, crop: { x: 88, y: 40, size: 208 }, bases: [BASE_F01], manifestVersion: 1 }

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
/** Plan 13 (design §6): a rare hair colour won from the daily draw, and a free eye colour — every
 * account owns every `free` colour with no inventory row of its own reason to exist, but the server
 * still lists it in `/api/me/inventory` with `source: "free"` (design §3.2). */
const HAIRCOLOR_BLUE: ItemDto = {
  id: 'haircolor_blue01',
  slot: 'hairColor',
  rarity: 'rare',
  nameKey: 'items.haircolor_blue01',
  assetKey: 'hairColor/haircolor_blue01',
  isDefault: false,
  colour: '#3f6fd8',
}
const EYECOLOR_BROWN: ItemDto = {
  id: 'eyecolor_brown01',
  slot: 'eyeColor',
  rarity: 'common',
  nameKey: 'items.eyecolor_brown01',
  assetKey: 'eyeColor/eyecolor_brown01',
  isDefault: false,
  free: true,
  colour: '#6b3b1f',
}

const CATALOG: ItemDto[] = [OUTFIT_CASUAL, HEAD_BEANIE, HEAD_TOPHAT, HAIRCOLOR_BLUE, EYECOLOR_BROWN]

const EQUIPPED: AvatarConfigDto = { v: 3, base: 'f01', outfit: 'outfit_casual01', head: 'head_beanie01', title: 'title_rookie' }

const INVENTORY: InventoryDto = {
  items: [
    owned('outfit_casual01', 'outfit', 'common', 'default'),
    owned('head_beanie01', 'head', 'common', 'default'),
    owned('head_tophat01', 'head', 'epic', 'achievement'),
    owned('title_rookie', 'title', 'common', 'achievement'),
    owned('haircolor_blue01', 'hairColor', 'rare', 'daily'),
    owned('eyecolor_brown01', 'eyeColor', 'common', 'free'),
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

/** The wardrobe's name for a slot, as the inventory's sub-heading prints it (layout audit C3). */
const SLOT_LABEL = {
  head: viNormal.wardrobe.tabs.head,
  face: viNormal.wardrobe.tabs.face,
  outfit: viNormal.wardrobe.tabs.outfit,
  aura: viNormal.wardrobe.tabs.aura,
  frame: viNormal.wardrobe.tabs.frame,
  hairColor: viNormal.wardrobe.tabs.hairColor,
  eyeColor: viNormal.wardrobe.tabs.eyeColor,
  title: viNormal.wardrobe.words.titles,
  badge: viNormal.wardrobe.words.badges,
} as const

/** The section under the sub-heading (an `h3`, inside its group's panel) that names this slot. */
const panelOf = (slot: keyof typeof SLOT_LABEL) => {
  const heading = screen.getByRole('heading', { name: SLOT_LABEL[slot], level: 3 })
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

  it("lists what is owned in the wardrobe's three groups, in its order, and counts it", async () => {
    renderScreen()
    await screen.findByText(viNormal.items.head_beanie01)

    // Group panels in the wardrobe's order, each holding only the slots that have something in them.
    const groups = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(groups).toEqual([viNormal.wardrobe.groups.look, viNormal.wardrobe.groups.wear, viNormal.wardrobe.groups.decor])
    const slots = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(slots).toEqual([SLOT_LABEL.hairColor, SLOT_LABEL.eyeColor, SLOT_LABEL.head, SLOT_LABEL.outfit, SLOT_LABEL.title])
    expect(screen.getByText(viNormal.inventory.summary.replace('{{owned}}', '6'))).toBeInTheDocument()
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

  it('shows each drawn item as its own icon, and draws nothing for a word', async () => {
    renderScreen()
    await screen.findByText(viNormal.items.head_beanie01)

    // The card for a head piece is the item on its own — the pipeline's icon, not a figure wearing it.
    const card = panelOf('head').getByText(viNormal.items.head_tophat01).closest('li')
    await waitFor(() => {
      expect(card?.querySelector('img[data-item-icon]')?.getAttribute('src')).toBe('/avatar/item_head_tophat01_icon@1x.png')
    })
    expect(card?.querySelector('[data-chibi-hash]')).toBeNull()
    // `title` has no geometry, so its tile carries words and nothing else.
    expect(panelOf('title').getByText(viNormal.items.title_rookie).closest('li')?.querySelector('img')).toBeNull()
  })

  it('marks what the avatar is actually wearing, worn pieces and words alike', async () => {
    renderScreen()
    await screen.findByText(viNormal.items.head_beanie01)

    // The wardrobe's own "✓ Đang mặc" pill (layout audit C3).
    expect(panelOf('head').getAllByText(viNormal.wardrobe.wearingBadge)).toHaveLength(1)
    expect(panelOf('title').getByText(viNormal.wardrobe.wearingBadge)).toBeInTheDocument()
    expect(panelOf('outfit').getByText(viNormal.wardrobe.wearingBadge)).toBeInTheDocument()
  })

  it('leaves out a slot with nothing in it, and says so only when there is nothing at all', async () => {
    renderScreen()
    await screen.findByText(viNormal.items.head_beanie01)

    expect(screen.queryByRole('heading', { name: SLOT_LABEL.face, level: 3 })).toBeNull()
    expect(screen.queryByRole('heading', { name: SLOT_LABEL.badge, level: 3 })).toBeNull()
    expect(screen.queryByText(viNormal.inventory.empty)).toBeNull()
  })

  it('says the inventory is empty when it is', async () => {
    renderScreen(stubApi({ inventory: vi.fn().mockResolvedValue({ ...INVENTORY, items: [] }) }))

    expect(await screen.findByText(viNormal.inventory.empty)).toBeInTheDocument()
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0)
  })

  it('shows an owned rare hair colour and a free eye colour in their own panels, as colour swatches', async () => {
    renderScreen()
    await screen.findByText(viNormal.items.head_beanie01)

    const hairCard = panelOf('hairColor').getByText(viNormal.items.haircolor_blue01).closest('li') as HTMLElement
    expect(hairCard.querySelector('[data-colour-swatch]')).toHaveStyle({ background: '#3f6fd8' })
    expect(within(hairCard).getByText(viNormal.inventory.rarity.rare)).toBeInTheDocument()
    // A colour item has no picture — swatch or nothing, never the drawn-item icon.
    expect(hairCard.querySelector('img')).toBeNull()
    // Owned (non-free) items still show the day they arrived.
    expect(hairCard.querySelector('time')).not.toBeNull()

    const eyeCard = panelOf('eyeColor').getByText(viNormal.items.eyecolor_brown01).closest('li') as HTMLElement
    expect(eyeCard.querySelector('[data-colour-swatch]')).toHaveStyle({ background: '#6b3b1f' })
    // Free items are owned by every account with no inventory row reason of their own — the server
    // still reports them with `source: "free"`, and that is what the card should say.
    expect(within(eyeCard).getByText(viNormal.inventory.source.free)).toBeInTheDocument()
    // A free item's `acquiredAt: 0` (1 Jan 1970) is not a real acquisition date — the card must not
    // show a date row for one.
    expect(eyeCard.querySelector('time')).toBeNull()
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
