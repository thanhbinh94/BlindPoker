import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type AvatarConfigDto, type InventoryDto, type ItemSlot, type NormalApi, type OwnedItemDto, type Rarity } from '../api.js'
import { withSlot } from '../avatar3d/config.js'
import { fakeRenderer } from '../avatar3d/fake-renderer.js'
import { hashConfig } from '../avatar3d/hash.js'
import { resetPortraitMemory } from '../avatar3d/portrait-cache.js'
import { setPortraitRendererForTests } from '../avatar3d/usePortrait.js'
import viNormal from '../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../test-i18n.js'
import { InventoryScreen } from './InventoryScreen.js'

const owned = (itemId: string, slot: ItemSlot, rarity: Rarity, source: string): OwnedItemDto => ({
  itemId,
  slot,
  rarity,
  nameKey: `items.${itemId}`,
  assetKey: `${slot}/${itemId}`,
  source,
  acquiredAt: Date.UTC(2026, 0, 15),
})

const EQUIPPED: AvatarConfigDto = {
  v: 2,
  body: 'male',
  skin: '#e0ac81',
  eyes: '#3b2415',
  hairColor: '#2b2b2b',
  hair: 'hair_short',
  top: 'top_tee',
  bottom: 'bottom_jeans',
  shoes: 'shoes_sneakers',
  title: 'title_rookie',
}

const INVENTORY: InventoryDto = {
  items: [
    owned('hair_short', 'hair', 'common', 'default'),
    owned('hair_bun', 'hair', 'rare', 'daily'),
    owned('top_tee', 'top', 'common', 'default'),
    owned('bottom_jeans', 'bottom', 'common', 'default'),
    owned('shoes_sneakers', 'shoes', 'common', 'default'),
    owned('hat_crown', 'hat', 'epic', 'achievement'),
    owned('title_rookie', 'title', 'common', 'achievement'),
  ],
  avatar: EQUIPPED,
}

function stubApi(overrides: Partial<NormalApi> = {}): NormalApi {
  return { inventory: vi.fn().mockResolvedValue(INVENTORY), ...overrides } as unknown as NormalApi
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
  beforeEach(() => {
    resetPortraitMemory()
    setPortraitRendererForTests(fakeRenderer())
  })

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

    expect(await screen.findByText(viNormal.items.hair_short)).toBeInTheDocument()
  })

  it('groups every slot and counts what is owned', async () => {
    renderScreen()
    await screen.findByText(viNormal.items.hair_short)

    for (const label of Object.values(viNormal.inventory.slot)) {
      expect(screen.getByRole('heading', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByText(viNormal.inventory.summary.replace('{{owned}}', '7'))).toBeInTheDocument()
  })

  it('gives each piece its rarity, its source and the day it arrived', async () => {
    renderScreen()
    await screen.findByText(viNormal.items.hair_short)

    const hair = panelOf('hair')
    expect(hair.getByText(viNormal.items.hair_bun)).toBeInTheDocument()
    expect(hair.getByText(viNormal.inventory.rarity.rare)).toBeInTheDocument()
    expect(hair.getByText(viNormal.inventory.source.daily)).toBeInTheDocument()
    expect(hair.getAllByText(/2026/).length).toBeGreaterThan(0)

    const hats = panelOf('hat')
    expect(hats.getByText(viNormal.inventory.rarity.epic)).toBeInTheDocument()
    expect(hats.getByText(viNormal.inventory.source.achievement)).toBeInTheDocument()
  })

  it('previews each geometric item on the figure that would wear it, and draws nothing for a word', async () => {
    renderScreen()
    await screen.findByText(viNormal.items.hair_short)

    // The tile for a hairstyle the player is *not* wearing is a portrait of them wearing it — the same
    // configuration with one slot swapped, so it is cached under that configuration's own hash.
    const tried = withSlot(EQUIPPED, 'hair', 'hair_bun')
    await waitFor(() => {
      expect(panelOf('hair').getByText(viNormal.items.hair_bun).closest('li')?.querySelector('img')).toHaveAttribute(
        'data-hash',
        hashConfig(tried),
      )
    })
    // `title` has no geometry, so its tile carries words and nothing else.
    expect(panelOf('title').getByText(viNormal.items.title_rookie).closest('li')?.querySelector('img')).toBeNull()
  })

  it('marks what the avatar is actually wearing, worn pieces and words alike', async () => {
    renderScreen()
    await screen.findByText(viNormal.items.hair_short)

    // Read off the config that came in the same body, so the mark cannot disagree with the face.
    expect(panelOf('hair').getAllByText(viNormal.inventory.equipped)).toHaveLength(1)
    expect(panelOf('title').getByText(viNormal.inventory.equipped)).toBeInTheDocument()
    expect(panelOf('badge').queryByText(viNormal.inventory.equipped)).toBeNull()
  })

  it('says a slot is empty rather than showing an empty box', async () => {
    renderScreen()
    await screen.findByText(viNormal.items.hair_short)

    expect(panelOf('jewelry').getByText(viNormal.inventory.empty)).toBeInTheDocument()
    expect(panelOf('badge').getByText(viNormal.inventory.empty)).toBeInTheDocument()
    expect(panelOf('hair').queryByText(viNormal.inventory.empty)).toBeNull()
  })

  it('names an item this bundle has never heard of by its id, never by an i18n key', async () => {
    // The server publishes the catalogue and this bundle ships the names for it; the two are deployed
    // separately, so a browser holding yesterday's bundle will meet ids it has no key for.
    renderScreen(
      stubApi({
        inventory: vi.fn().mockResolvedValue({ ...INVENTORY, items: [owned('hat_lunar_2027', 'hat', 'epic', 'daily')] }),
      }),
    )

    expect(await screen.findByText('hat_lunar_2027')).toBeInTheDocument()
    expect(screen.queryByText('items.hat_lunar_2027')).toBeNull()
  })
})
