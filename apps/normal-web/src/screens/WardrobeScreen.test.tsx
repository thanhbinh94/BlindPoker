import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  type AvatarConfigDto,
  type Body,
  type InventoryDto,
  type ItemDto,
  type ItemSlot,
  type NormalApi,
  type OwnedItemDto,
  type Rarity,
} from '../api.js'
import { fakeRenderer } from '../avatar3d/fake-renderer.js'
import { resetPortraitMemory } from '../avatar3d/portrait-cache.js'
import { setPortraitRendererForTests } from '../avatar3d/usePortrait.js'
import { resetAvatarCache, useAvatars } from '../avatar/useAvatars.js'
import viNormal from '../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../test-i18n.js'
import { WardrobeScreen } from './WardrobeScreen.js'

const owned = (itemId: string, slot: ItemSlot, rarity: Rarity = 'common'): OwnedItemDto => ({
  itemId,
  slot,
  rarity,
  nameKey: `items.${itemId}`,
  assetKey: `${slot}/${itemId}`,
  source: 'default',
  acquiredAt: Date.UTC(2026, 0, 15),
})

/** A catalogue row. `bodies` is which figures the piece was modelled for — the whole point of the row. */
const defined = (id: string, slot: ItemSlot, bodies: Body[], isDefault = false): ItemDto => ({
  id,
  slot,
  rarity: 'common',
  nameKey: `items.${id}`,
  assetKey: `${slot}/${id}`,
  isDefault,
  variants: Object.fromEntries(bodies.map((body) => [body, { file: `${slot}.glb`, node: `${slot}/${id}/${body}` }])),
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
    owned('hair_none', 'hair'),
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

/**
 * The catalogue behind that inventory, with one deliberate asymmetry: the tee was modelled for the male
 * body only. The shipped pack has a variant of everything for both figures, so this is the case the code
 * exists for rather than a case the data has today — and it is exactly what a new source pack brings.
 */
const CATALOG: ItemDto[] = [
  defined('hair_none', 'hair', ['male', 'female'], true),
  defined('hair_short', 'hair', ['male', 'female']),
  defined('hair_curly', 'hair', ['male', 'female']),
  defined('top_tee', 'top', ['male'], true),
  defined('clothing_aodai', 'top', ['male', 'female']),
  defined('bottom_jeans', 'bottom', ['male', 'female'], true),
  defined('shoes_sneakers', 'shoes', ['male', 'female'], true),
  defined('accessory_glasses', 'accessory', ['male']),
]

function stubApi(overrides: Partial<NormalApi> = {}): NormalApi {
  return {
    inventory: vi.fn().mockResolvedValue(INVENTORY),
    catalogItems: vi.fn().mockResolvedValue({ items: CATALOG }),
    setAvatar: vi.fn().mockImplementation((config: AvatarConfigDto) => Promise.resolve({ config })),
    playerAvatar: vi.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'no such player')),
    ...overrides,
  } as unknown as NormalApi
}

const renderScreen = (api: NormalApi = stubApi()) => renderWithI18n(<WardrobeScreen api={api} playerId="p1" />, makeI18n('vi'))

/** Whatever else in the app is drawing my face — the lobby bar, a seat plate — reading the shared cache. */
function Watcher({ api }: { api: NormalApi }) {
  const { avatars } = useAvatars(api, ['p1'])
  return <span data-testid="watcher">{avatars.size}</span>
}

/** The wardrobe has landed once its first tile is on screen. */
const settled = (): Promise<HTMLElement> => screen.findByRole('radio', { name: viNormal.items.hair_short })

const swatch = (name: string, color: string): string => viNormal.wardrobe.swatch.replace('{{name}}', name).replace('{{color}}', color)

describe('WardrobeScreen', () => {
  beforeEach(() => {
    resetAvatarCache()
    resetPortraitMemory()
    setPortraitRendererForTests(fakeRenderer())
    // The route this screen is served at. The navigation guard compares a link's target against the
    // current hash, so a test that starts wherever the previous one left off is a test that flakes.
    window.location.hash = '#/avatar'
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

    expect(await settled()).toBeChecked()
  })

  it('offers only what is owned, marks what is equipped, and offers "none" on the optional slots alone', async () => {
    renderScreen()
    await settled()

    expect(screen.getByRole('radio', { name: viNormal.items.hair_short })).toBeChecked()
    expect(screen.getByRole('radio', { name: viNormal.items.hair_curly })).not.toBeChecked()
    // Nothing the catalogue has but this account does not.
    expect(screen.queryByRole('radio', { name: viNormal.items.hair_bun })).toBeNull()
    // `hat`, `accessory` and `jewelry` are the three slots that may be empty, so there are exactly three.
    expect(screen.getAllByRole('radio', { name: viNormal.avatar.none })).toHaveLength(3)
  })

  it('names the figure on the stage, in words, from what it is wearing', async () => {
    renderScreen()
    await settled()

    // No WebGL under jsdom, so the stage is its portrait fallback — carrying the same description.
    const figure = screen.getByRole('img', { name: /Nhân vật nam, da Trung bình.*Áo Áo thun.*Kính cận/ })
    expect(figure).toHaveAttribute('data-size', 'lg')
  })

  it('groups the body, the skin and the eyes, each as a named radiogroup', async () => {
    renderScreen()
    await settled()

    for (const legend of [viNormal.wardrobe.body, viNormal.wardrobe.skin, viNormal.wardrobe.eyes, viNormal.avatar.slot.top]) {
      expect(screen.getByRole('group', { name: legend })).toBeInTheDocument()
    }
    // Eight tones and six eye colours, each named rather than being a bare circle of colour.
    expect(within(screen.getByRole('group', { name: viNormal.wardrobe.skin })).getAllByRole('radio')).toHaveLength(8)
    expect(within(screen.getByRole('group', { name: viNormal.wardrobe.eyes })).getAllByRole('radio')).toHaveLength(6)
    expect(screen.getByRole('radio', { name: swatch(viNormal.wardrobe.skinTone['2'], '#e0ac81') })).toBeChecked()
    expect(screen.getByRole('radio', { name: swatch(viNormal.wardrobe.eyeColor['0'], '#3b2415') })).toBeChecked()
  })

  it('keeps what the new body can wear, re-dresses what it cannot, and says which', async () => {
    const api = stubApi()
    const user = userEvent.setup()
    renderScreen(api)
    await settled()

    await user.click(screen.getByRole('radio', { name: viNormal.wardrobe.bodyName.female }))

    // Hair fits both figures and is left alone. The tee and the glasses do not: the tee is replaced by
    // the only owned top that *does* fit (the slot's default does not, so the fallback goes on down the
    // shelf), and the optional accessory slot is emptied because nothing owned fits it.
    //
    // The words matter as much as the list: neither of those two slots went to "the default piece", so
    // the note has to describe what the fallback actually does — another piece, or nothing.
    expect(await screen.findByText(viNormal.wardrobe.bodyChanged.replace('{{slots}}', 'Áo, Phụ kiện'))).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: viNormal.items.hair_short }), 'hair fits both bodies').toBeChecked()
    expect(screen.getByRole('radio', { name: viNormal.items.top_tee }), 'the tee has no female variant').not.toBeChecked()
    expect(screen.getByRole('radio', { name: viNormal.items.clothing_aodai }), 'the áo dài does').toBeChecked()

    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.save }))
    await waitFor(() => expect(api.setAvatar).toHaveBeenCalledTimes(1))
    // The accessory had no female variant and no owned replacement, so the optional slot is simply empty
    // — and an empty optional slot goes on the wire as an absence, not as `''`.
    expect(api.setAvatar).toHaveBeenCalledWith({
      v: 2,
      body: 'female',
      skin: '#e0ac81',
      eyes: '#3b2415',
      hairColor: '#2b2b2b',
      hair: 'hair_short',
      top: 'clothing_aodai',
      bottom: 'bottom_jeans',
      shoes: 'shoes_sneakers',
    })
  })

  it('takes the body-switch note down again as soon as something else is picked', async () => {
    const user = userEvent.setup()
    renderScreen()
    await settled()

    await user.click(screen.getByRole('radio', { name: viNormal.wardrobe.bodyName.female }))
    const note = viNormal.wardrobe.bodyChanged.replace('{{slots}}', 'Áo, Phụ kiện')
    expect(await screen.findByText(note)).toBeInTheDocument()

    // The note is a statement about the body switch. Left standing through every later pick it would
    // read as a statement about the pick just made — "changing body had to change your top", about a
    // top the player chose themselves a moment ago.
    await user.click(screen.getByRole('radio', { name: viNormal.items.hair_curly }))
    expect(screen.queryByText(note)).toBeNull()

    // And again for the free colour box, which writes the draft itself rather than going through the
    // same path. Undo first, so the switch has the same outfit to migrate as it had the first time.
    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.reset }))
    await user.click(screen.getByRole('radio', { name: viNormal.wardrobe.bodyName.female }))
    expect(await screen.findByText(note)).toBeInTheDocument()

    await user.clear(screen.getByLabelText(viNormal.avatar.hairCustom))
    expect(screen.queryByText(note)).toBeNull()
  })

  it('sends the whole config on save, invalidates my face, and says it is done', async () => {
    const playerAvatar = vi.fn().mockResolvedValue({ playerId: 'p1', displayName: 'Bình', avatar: EQUIPPED })
    const api = stubApi({ playerAvatar })
    const user = userEvent.setup()
    renderWithI18n(
      <>
        <WardrobeScreen api={api} playerId="p1" />
        <Watcher api={api} />
      </>,
      makeI18n('vi'),
    )
    await settled()
    await waitFor(() => expect(playerAvatar).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('radio', { name: viNormal.items.clothing_aodai }))
    await user.click(screen.getByRole('radio', { name: swatch(viNormal.wardrobe.skinTone['5'], '#8a563a') }))
    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.save }))

    await waitFor(() => expect(api.setAvatar).toHaveBeenCalledTimes(1))
    expect(api.setAvatar).toHaveBeenCalledWith({
      v: 2,
      body: 'male',
      skin: '#8a563a',
      eyes: '#3b2415',
      hairColor: '#2b2b2b',
      hair: 'hair_short',
      top: 'clothing_aodai',
      bottom: 'bottom_jeans',
      shoes: 'shoes_sneakers',
      accessory: 'accessory_glasses',
    })
    expect(await screen.findByText(viNormal.wardrobe.saved)).toBeInTheDocument()
    // The cached entry is good for a minute; without the invalidation the seat would wear the old face.
    await waitFor(() => expect(playerAvatar).toHaveBeenCalledTimes(2))
    expect(playerAvatar).toHaveBeenLastCalledWith('p1', { fresh: true })
  })

  it('equips a title and a badge from what is owned', async () => {
    const api = stubApi()
    const user = userEvent.setup()
    renderScreen(api)
    await settled()

    await user.selectOptions(screen.getByLabelText(viNormal.avatar.titleSlot), viNormal.items.title_rookie)
    await user.selectOptions(screen.getByLabelText(viNormal.avatar.badgeSlot), viNormal.items.badge_bronze)
    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.save }))

    await waitFor(() => expect(api.setAvatar).toHaveBeenCalledTimes(1))
    expect(api.setAvatar).toHaveBeenCalledWith(expect.objectContaining({ title: 'title_rookie', badge: 'badge_bronze' }))
  })

  it('takes a preset hair colour, and refuses a half-typed one without asking the server', async () => {
    const api = stubApi()
    const user = userEvent.setup()
    renderScreen(api)
    await settled()

    await user.click(screen.getByRole('button', { name: viNormal.avatar.hairPreset.replace('{{color}}', '#d9a441') }))
    const box = screen.getByLabelText(viNormal.avatar.hairCustom)
    expect(box).toHaveValue('#d9a441')

    await user.clear(box)
    await user.type(box, '#zz')
    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.save }))

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.avatar.hairInvalid)
    expect(api.setAvatar).not.toHaveBeenCalled()
  })

  it('puts the server refusal in words when a piece turns out not to be owned', async () => {
    const setAvatar = vi.fn().mockRejectedValue(new ApiError(403, 'NOT_OWNED', 'not owned: clothing_aodai'))
    const user = userEvent.setup()
    renderScreen(stubApi({ setAvatar }))
    await settled()

    await user.click(screen.getByRole('radio', { name: viNormal.items.clothing_aodai }))
    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.save }))

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.avatar.errors.NOT_OWNED)
    expect(screen.queryByText(viNormal.wardrobe.saved)).toBeNull()
  })

  it('undoes every change back to the wardrobe that was saved', async () => {
    const api = stubApi()
    const user = userEvent.setup()
    renderScreen(api)
    await settled()

    const undo = screen.getByRole('button', { name: viNormal.wardrobe.reset })
    expect(undo, 'nothing to undo yet').toBeDisabled()

    await user.click(screen.getByRole('radio', { name: viNormal.items.hair_curly }))
    expect(screen.getByText(viNormal.wardrobe.dirty)).toBeInTheDocument()

    await user.click(undo)

    expect(screen.getByRole('radio', { name: viNormal.items.hair_short })).toBeChecked()
    expect(screen.getByText(viNormal.wardrobe.resetDone)).toBeInTheDocument()
    expect(screen.queryByText(viNormal.wardrobe.dirty)).toBeNull()
    expect(api.setAvatar).not.toHaveBeenCalled()
  })

  it('does not let an unsaved change be walked away from by accident', async () => {
    const user = userEvent.setup()
    renderWithI18n(
      <>
        <WardrobeScreen api={stubApi()} playerId="p1" />
        {/* The rail, in miniature: every route in this app is a `#/…` link like this one. */}
        <a href="#/profile">{'rail'}</a>
      </>,
      makeI18n('vi'),
    )
    await settled()

    // Nothing to lose yet, so nothing is in the way of leaving.
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true)

    await user.click(screen.getByRole('radio', { name: viNormal.items.hair_curly }))

    // …and now it does not. The browser is warned about a reload, and the in-app link is held.
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true })), 'the reload is guarded').toBe(false)
    fireEvent.click(screen.getByRole('link', { name: 'rail' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent(viNormal.wardrobe.leaveBody)

    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.leaveStay }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.location.hash, 'staying means staying').toBe('#/avatar')

    fireEvent.click(screen.getByRole('link', { name: 'rail' }))
    await user.click(await screen.findByRole('button', { name: viNormal.wardrobe.leaveGo }))
    expect(window.location.hash).toBe('#/profile')
  })

  it('names a piece this bundle has never heard of by its id, and keeps it when the body changes', async () => {
    const inventory = vi.fn().mockResolvedValue({ ...INVENTORY, items: [...INVENTORY.items, owned('hat_lunar_2027', 'hat', 'epic')] })
    const api = stubApi({ inventory })
    const user = userEvent.setup()
    renderScreen(api)
    await settled()

    // The radio's accessible name is the only name a screen reader gets for the tile.
    const hat = screen.getByRole('radio', { name: 'hat_lunar_2027' })
    expect(screen.queryByText('items.hat_lunar_2027')).toBeNull()

    await user.click(hat)
    await user.click(screen.getByRole('radio', { name: viNormal.wardrobe.bodyName.female }))
    // Not in this bundle's catalogue means nothing is known about its variants — and an outfit is not
    // stripped on the strength of an answer nobody has.
    expect(screen.getByRole('radio', { name: 'hat_lunar_2027' })).toBeChecked()
  })
})
