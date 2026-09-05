import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, type AvatarConfigDto, type InventoryDto, type ItemCategory, type NormalApi, type OwnedItemDto, type Rarity } from '../api.js'
import viNormal from '../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../test-i18n.js'
import { InventoryScreen } from './InventoryScreen.js'

const owned = (itemId: string, category: ItemCategory, rarity: Rarity, source: string): OwnedItemDto => ({
  itemId,
  category,
  rarity,
  nameKey: `items.${itemId}`,
  assetKey: `${category}/${itemId}`,
  source,
  acquiredAt: Date.UTC(2026, 0, 15),
})

const EQUIPPED: AvatarConfigDto = {
  base: 'base_01',
  face: 'face_01',
  clothing: 'clothing_tee',
  hair: 'hair_short',
  hairColor: '#2b2b2b',
  title: 'title_rookie',
}

const INVENTORY: InventoryDto = {
  items: [
    owned('base_01', 'base', 'common', 'default'),
    owned('base_02', 'base', 'rare', 'daily'),
    owned('face_01', 'face', 'common', 'default'),
    owned('clothing_tee', 'clothing', 'common', 'default'),
    owned('hair_short', 'hair', 'common', 'default'),
    owned('hat_crown', 'accessory', 'epic', 'achievement'),
    owned('title_rookie', 'title', 'common', 'achievement'),
  ],
  avatar: EQUIPPED,
}

function stubApi(overrides: Partial<NormalApi> = {}): NormalApi {
  return { inventory: vi.fn().mockResolvedValue(INVENTORY), ...overrides } as unknown as NormalApi
}

const renderScreen = (api: NormalApi = stubApi()) => renderWithI18n(<InventoryScreen api={api} lang="vi" />, makeI18n('vi'))

/** The `<ul>` inside the panel whose heading names this category. */
const panelOf = (category: keyof typeof viNormal.inventory.category) => {
  const heading = screen.getByRole('heading', { name: viNormal.inventory.category[category] })
  const section = heading.closest('section')
  if (section === null) throw new Error(`no panel for ${category}`)
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

    expect(await screen.findByText(viNormal.items.base_01)).toBeInTheDocument()
  })

  it('groups every category and counts what is owned', async () => {
    renderScreen()
    await screen.findByText(viNormal.items.base_01)

    for (const label of Object.values(viNormal.inventory.category)) {
      expect(screen.getByRole('heading', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByText(viNormal.inventory.summary.replace('{{owned}}', '7'))).toBeInTheDocument()
  })

  it('gives each piece its rarity, its source and the day it arrived', async () => {
    renderScreen()
    await screen.findByText(viNormal.items.base_01)

    const bases = panelOf('base')
    expect(bases.getByText(viNormal.items.base_02)).toBeInTheDocument()
    expect(bases.getByText(viNormal.inventory.rarity.rare)).toBeInTheDocument()
    expect(bases.getByText(viNormal.inventory.source.daily)).toBeInTheDocument()
    expect(bases.getAllByText(/2026/).length).toBeGreaterThan(0)

    const accessories = panelOf('accessory')
    expect(accessories.getByText(viNormal.inventory.rarity.epic)).toBeInTheDocument()
    expect(accessories.getByText(viNormal.inventory.source.achievement)).toBeInTheDocument()
  })

  it('marks what the avatar is actually wearing, layers and words alike', async () => {
    renderScreen()
    await screen.findByText(viNormal.items.base_01)

    // Read off the config that came in the same body, so the mark cannot disagree with the face.
    expect(panelOf('base').getAllByText(viNormal.inventory.equipped)).toHaveLength(1)
    expect(panelOf('title').getByText(viNormal.inventory.equipped)).toBeInTheDocument()
    expect(panelOf('badge').queryByText(viNormal.inventory.equipped)).toBeNull()
  })

  it('says a category is empty rather than showing an empty box', async () => {
    renderScreen()
    await screen.findByText(viNormal.items.base_01)

    expect(panelOf('jewelry').getByText(viNormal.inventory.empty)).toBeInTheDocument()
    expect(panelOf('badge').getByText(viNormal.inventory.empty)).toBeInTheDocument()
    expect(panelOf('base').queryByText(viNormal.inventory.empty)).toBeNull()
  })

  it('names an item this bundle has never heard of by its id, never by an i18n key', async () => {
    // The server publishes the catalogue and this bundle ships the names for it; the two are deployed
    // separately, so a browser holding yesterday's bundle will meet ids it has no key for.
    renderScreen(stubApi({
      inventory: vi.fn().mockResolvedValue({ ...INVENTORY, items: [owned('hat_lunar_2027', 'accessory', 'epic', 'daily')] }),
    }))

    expect(await screen.findByText('hat_lunar_2027')).toBeInTheDocument()
    expect(screen.queryByText('items.hat_lunar_2027')).toBeNull()
  })
})
