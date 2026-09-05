import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type AvatarConfigDto, type InventoryDto, type ItemCategory, type NormalApi, type OwnedItemDto, type Rarity } from '../api.js'
import { resetAvatarCache, useAvatars } from '../avatar/useAvatars.js'
import viNormal from '../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../test-i18n.js'
import { AvatarScreen } from './AvatarScreen.js'

const owned = (itemId: string, category: ItemCategory, rarity: Rarity = 'common'): OwnedItemDto => ({
  itemId,
  category,
  rarity,
  nameKey: `items.${itemId}`,
  assetKey: `${category}/${itemId}`,
  source: 'default',
  acquiredAt: Date.UTC(2026, 0, 15),
})

const EQUIPPED: AvatarConfigDto = {
  base: 'base_01',
  face: 'face_01',
  clothing: 'clothing_tee',
  hair: 'hair_short',
  hairColor: '#2b2b2b',
  accessory: 'accessory_glasses',
}

const INVENTORY: InventoryDto = {
  items: [
    owned('base_01', 'base'),
    owned('base_02', 'base', 'rare'),
    owned('face_01', 'face'),
    owned('clothing_tee', 'clothing'),
    owned('hair_short', 'hair'),
    owned('hair_curly', 'hair', 'rare'),
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

    expect(await screen.findByRole('radio', { name: viNormal.items.base_01 })).toBeChecked()
  })

  it('offers only what is owned, marks what is equipped, and offers "none" on the optional layers alone', async () => {
    renderScreen()
    await screen.findByRole('radio', { name: viNormal.items.base_01 })

    expect(screen.getByRole('radio', { name: viNormal.items.base_01 })).toBeChecked()
    expect(screen.getByRole('radio', { name: viNormal.items.base_02 })).not.toBeChecked()
    // Nothing the catalogue has but this account does not.
    expect(screen.queryByRole('radio', { name: viNormal.items.base_03 })).toBeNull()
    // `accessory` and `jewelry` are the only two slots that may be empty, so there are exactly two "none"s.
    expect(screen.getAllByRole('radio', { name: viNormal.avatar.none })).toHaveLength(2)
    expect(screen.getByRole('img', { name: viNormal.avatar.mine })).toHaveAttribute('data-size', 'lg')
  })

  it('redraws the preview from the draft before anything is saved', async () => {
    const api = stubApi()
    const user = userEvent.setup()
    renderScreen(api)
    await screen.findByRole('radio', { name: viNormal.items.base_01 })

    await user.click(screen.getByRole('radio', { name: viNormal.items.hair_curly }))
    await user.click(screen.getByRole('button', { name: viNormal.avatar.hairPreset.replace('{{color}}', '#d9a441') }))

    expect(screen.getByRole('radio', { name: viNormal.items.hair_curly })).toBeChecked()
    // The colour reaches the parts as a custom property on the `<svg>`, which is the whole hair layer's fill.
    expect(screen.getByRole('img', { name: viNormal.avatar.mine }).getAttribute('style')).toContain('#d9a441')
    expect(api.setAvatar).not.toHaveBeenCalled()
  })

  it('sends the whole config on save, omitting an emptied optional slot rather than blanking it', async () => {
    const api = stubApi()
    const user = userEvent.setup()
    renderScreen(api)
    await screen.findByRole('radio', { name: viNormal.items.base_01 })

    await user.click(screen.getByRole('radio', { name: viNormal.items.base_02 }))
    // The first "none" belongs to `accessory`, which is the only optional slot with anything equipped.
    await user.click(screen.getAllByRole('radio', { name: viNormal.avatar.none })[0] as HTMLElement)
    await user.click(screen.getByRole('button', { name: viNormal.avatar.save }))

    await waitFor(() => expect(api.setAvatar).toHaveBeenCalledTimes(1))
    expect(api.setAvatar).toHaveBeenCalledWith({
      base: 'base_02',
      face: 'face_01',
      clothing: 'clothing_tee',
      hair: 'hair_short',
      hairColor: '#2b2b2b',
    })
    expect(await screen.findByText(viNormal.avatar.saved)).toBeInTheDocument()
  })

  it('equips a title and a badge from what is owned, and offers "none" for both', async () => {
    const api = stubApi()
    const user = userEvent.setup()
    renderScreen(api)
    await screen.findByRole('radio', { name: viNormal.items.base_01 })

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
    await screen.findByRole('radio', { name: viNormal.items.base_01 })

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
    const setAvatar = vi.fn().mockRejectedValue(new ApiError(403, 'NOT_OWNED', 'not owned: base_02'))
    const user = userEvent.setup()
    renderScreen(stubApi({ setAvatar }))
    await screen.findByRole('radio', { name: viNormal.items.base_01 })

    await user.click(screen.getByRole('radio', { name: viNormal.items.base_02 }))
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
    await screen.findByRole('radio', { name: viNormal.items.base_01 })
    await waitFor(() => expect(playerAvatar).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: viNormal.avatar.save }))

    // The cached entry is good for a minute; without the invalidation the seat would wear the old face for it.
    await waitFor(() => expect(playerAvatar).toHaveBeenCalledTimes(2))
  })
})
