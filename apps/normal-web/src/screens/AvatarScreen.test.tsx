import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type AvatarConfigDto, type InventoryDto, type ItemSlot, type NormalApi, type OwnedItemDto, type Rarity } from '../api.js'
import { fakeRenderer } from '../avatar3d/fake-renderer.js'
import { hashConfig } from '../avatar3d/hash.js'
import { resetPortraitMemory } from '../avatar3d/portrait-cache.js'
import { setPortraitRendererForTests } from '../avatar3d/usePortrait.js'
import { resetAvatarCache, useAvatars } from '../avatar/useAvatars.js'
import viNormal from '../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../test-i18n.js'
import { AvatarScreen } from './AvatarScreen.js'

const owned = (itemId: string, slot: ItemSlot, rarity: Rarity = 'common'): OwnedItemDto => ({
  itemId,
  slot,
  rarity,
  nameKey: `items.${itemId}`,
  assetKey: `${slot}/${itemId}`,
  source: 'default',
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
  accessory: 'accessory_glasses',
}

const INVENTORY: InventoryDto = {
  items: [
    owned('hair_short', 'hair'),
    owned('hair_curly', 'hair', 'rare'),
    owned('top_tee', 'top'),
    owned('clothing_aodai', 'top', 'rare'),
    owned('bottom_jeans', 'bottom'),
    owned('shoes_sneakers', 'shoes'),
    owned('accessory_glasses', 'accessory', 'epic'),
    owned('title_rookie', 'title'),
    owned('badge_bronze', 'badge'),
  ],
  avatar: EQUIPPED,
}

function stubApi(overrides: Partial<NormalApi> = {}): NormalApi {
  return {
    inventory: vi.fn().mockResolvedValue(INVENTORY),
    setAvatar: vi.fn().mockImplementation((config: AvatarConfigDto) => Promise.resolve({ config })),
    playerAvatar: vi.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'no such player')),
    ...overrides,
  } as unknown as NormalApi
}

const renderScreen = (api: NormalApi = stubApi()) => renderWithI18n(<AvatarScreen api={api} playerId="p1" />, makeI18n('vi'))

/** Whatever else in the app is drawing my face — the lobby bar, a seat plate — reading the shared cache. */
function Watcher({ api }: { api: NormalApi }) {
  const { avatars } = useAvatars(api, ['p1'])
  return <span data-testid="watcher">{avatars.size}</span>
}

describe('AvatarScreen', () => {
  beforeEach(() => {
    resetAvatarCache()
    resetPortraitMemory()
    setPortraitRendererForTests(fakeRenderer())
  })

  it('shows a status line until the wardrobe lands', () => {
    renderScreen(stubApi({ inventory: vi.fn(() => new Promise<InventoryDto>(() => undefined)) }))

    expect(screen.getByRole('status')).toHaveTextContent(viNormal.screens.loading)
  })

  it('says so when the wardrobe cannot be read, and asks again when told to', async () => {
    const inventory = vi.fn().mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'nope')).mockResolvedValue(INVENTORY)
    const user = userEvent.setup()
    renderScreen(stubApi({ inventory }))

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.inventory.error)

    await user.click(screen.getByRole('button', { name: viNormal.screens.retry }))

    expect(await screen.findByRole('radio', { name: viNormal.items.hair_short })).toBeChecked()
  })

  it('offers only what is owned, marks what is equipped, and offers "none" on the optional slots alone', async () => {
    renderScreen()
    await screen.findByRole('radio', { name: viNormal.items.hair_short })

    expect(screen.getByRole('radio', { name: viNormal.items.hair_short })).toBeChecked()
    expect(screen.getByRole('radio', { name: viNormal.items.hair_curly })).not.toBeChecked()
    // Nothing the catalogue has but this account does not.
    expect(screen.queryByRole('radio', { name: viNormal.items.hair_bun })).toBeNull()
    // `hat`, `accessory` and `jewelry` are the three slots that may be empty, so there are exactly three.
    expect(screen.getAllByRole('radio', { name: viNormal.avatar.none })).toHaveLength(3)
    expect(screen.getByRole('img', { name: viNormal.avatar.mine })).toHaveAttribute('data-size', 'lg')
  })

  it('redraws the preview from the draft before anything is saved', async () => {
    const api = stubApi()
    const user = userEvent.setup()
    renderScreen(api)
    await screen.findByRole('radio', { name: viNormal.items.hair_short })

    await user.click(screen.getByRole('radio', { name: viNormal.items.hair_curly }))
    await user.click(screen.getByRole('button', { name: viNormal.avatar.hairPreset.replace('{{color}}', '#d9a441') }))

    expect(screen.getByRole('radio', { name: viNormal.items.hair_curly })).toBeChecked()
    // The preview is a portrait of the *draft*, so its hash is the edited configuration's, not the saved one's.
    const drafted = { ...EQUIPPED, hair: 'hair_curly', hairColor: '#d9a441' }
    await waitFor(() => {
      expect(screen.getByRole('img', { name: viNormal.avatar.mine }).querySelector('img')).toHaveAttribute('data-hash', hashConfig(drafted))
    })
    expect(api.setAvatar).not.toHaveBeenCalled()
  })

  it('sends the whole config on save, omitting an emptied optional slot rather than blanking it', async () => {
    const api = stubApi()
    const user = userEvent.setup()
    renderScreen(api)
    await screen.findByRole('radio', { name: viNormal.items.hair_short })

    await user.click(screen.getByRole('radio', { name: viNormal.items.clothing_aodai }))
    // The last "none" of the three belongs to `accessory`, the only optional slot with anything equipped.
    await user.click(screen.getAllByRole('radio', { name: viNormal.avatar.none })[1] as HTMLElement)
    await user.click(screen.getByRole('button', { name: viNormal.avatar.save }))

    await waitFor(() => expect(api.setAvatar).toHaveBeenCalledTimes(1))
    expect(api.setAvatar).toHaveBeenCalledWith({
      v: 2,
      body: 'male',
      skin: '#e0ac81',
      eyes: '#3b2415',
      hairColor: '#2b2b2b',
      hair: 'hair_short',
      top: 'clothing_aodai',
      bottom: 'bottom_jeans',
      shoes: 'shoes_sneakers',
    })
    expect(await screen.findByText(viNormal.avatar.saved)).toBeInTheDocument()
  })

  it('equips a title and a badge from what is owned, and offers "none" for both', async () => {
    const api = stubApi()
    const user = userEvent.setup()
    renderScreen(api)
    await screen.findByRole('radio', { name: viNormal.items.hair_short })

    await user.selectOptions(screen.getByLabelText(viNormal.avatar.titleSlot), viNormal.items.title_rookie)
    await user.selectOptions(screen.getByLabelText(viNormal.avatar.badgeSlot), viNormal.items.badge_bronze)
    await user.click(screen.getByRole('button', { name: viNormal.avatar.save }))

    await waitFor(() => expect(api.setAvatar).toHaveBeenCalledTimes(1))
    expect(api.setAvatar).toHaveBeenCalledWith(expect.objectContaining({ title: 'title_rookie', badge: 'badge_bronze' }))
  })

  it('takes a preset hair colour, and refuses a half-typed one without asking the server', async () => {
    const api = stubApi()
    const user = userEvent.setup()
    renderScreen(api)
    await screen.findByRole('radio', { name: viNormal.items.hair_short })

    await user.click(screen.getByRole('button', { name: viNormal.avatar.hairPreset.replace('{{color}}', '#d9a441') }))
    const box = screen.getByLabelText(viNormal.avatar.hairCustom)
    expect(box).toHaveValue('#d9a441')

    await user.clear(box)
    await user.type(box, '#zz')
    await user.click(screen.getByRole('button', { name: viNormal.avatar.save }))

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.avatar.hairInvalid)
    expect(api.setAvatar).not.toHaveBeenCalled()
  })

  it('puts the server refusal in words when a piece turns out not to be owned', async () => {
    const setAvatar = vi.fn().mockRejectedValue(new ApiError(403, 'NOT_OWNED', 'not owned: clothing_aodai'))
    const user = userEvent.setup()
    renderScreen(stubApi({ setAvatar }))
    await screen.findByRole('radio', { name: viNormal.items.hair_short })

    await user.click(screen.getByRole('radio', { name: viNormal.items.clothing_aodai }))
    await user.click(screen.getByRole('button', { name: viNormal.avatar.save }))

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.avatar.errors.NOT_OWNED)
    expect(screen.queryByText(viNormal.avatar.saved)).toBeNull()
  })

  it('drops my cached face after a save, so the table stops drawing the old one', async () => {
    const playerAvatar = vi.fn().mockResolvedValue({ playerId: 'p1', displayName: 'Bình', avatar: EQUIPPED })
    const api = stubApi({ playerAvatar })
    const user = userEvent.setup()
    // A stand-in for the table and the lobby bar: something else, watching the same id off the shared cache.
    renderWithI18n(
      <>
        <AvatarScreen api={api} playerId="p1" />
        <Watcher api={api} />
      </>,
      makeI18n('vi'),
    )
    await screen.findByRole('radio', { name: viNormal.items.hair_short })
    await waitFor(() => expect(playerAvatar).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: viNormal.avatar.save }))

    // The cached entry is good for a minute; without the invalidation the seat would wear the old face for it.
    await waitFor(() => expect(playerAvatar).toHaveBeenCalledTimes(2))
    // …and the second read must skip the browser's own copy, which is just as good for that same minute.
    expect(playerAvatar).toHaveBeenLastCalledWith('p1', { fresh: true })
  })

  it('names a piece this bundle has never heard of by its id, in the label and on the tile', async () => {
    const inventory = vi.fn().mockResolvedValue({
      ...INVENTORY,
      items: [...INVENTORY.items, owned('hat_lunar_2027', 'hat', 'epic')],
    })
    renderScreen(stubApi({ inventory }))
    await screen.findByText(viNormal.items.hair_short)

    // The radio's accessible name is the only name a screen reader gets for the tile.
    expect(screen.getByRole('radio', { name: 'hat_lunar_2027' })).toBeInTheDocument()
    expect(screen.queryByText('items.hat_lunar_2027')).toBeNull()
  })
})
