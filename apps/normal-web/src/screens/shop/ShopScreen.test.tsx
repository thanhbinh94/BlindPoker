import { useTintedLayer } from '@bp/ui-kit'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  NETWORK_ERROR_CODE,
  type AvatarCatalogDto,
  type AvatarConfigDto,
  type BodyDto,
  type Gender,
  type InventoryDto,
  type ItemDto,
  type NormalApi,
  type ShopEntryDto,
  type ShopViewDto,
} from '../../api.js'
import viNormal from '../../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../../test-i18n.js'
import { newPurchaseId } from './purchase-id.js'
import { ShopScreen } from './ShopScreen.js'

vi.mock('@bp/ui-kit', async (importOriginal) => ({ ...(await importOriginal<typeof import('@bp/ui-kit')>()), useTintedLayer: vi.fn() }))
beforeEach(() => {
  vi.mocked(useTintedLayer).mockReturnValue(null)
})

const EXPRESSIONS = ['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep'] as const
const facesOf = (g: Gender): Record<string, string> => Object.fromEntries(EXPRESSIONS.map((e) => [e, `body_${g}_face_${e}_L50`]))
const BODY_F: BodyDto = { gender: 'f', body: 'body_f_L30', faces: facesOf('f'), naturalEyeColour: '#2e6a9b' }
const AVATAR_CATALOG: AvatarCatalogDto = { frame: { w: 384, h: 448 }, crop: { x: 88, y: 40, size: 208 }, bodies: [BODY_F], manifestVersion: 1 }

const item = (patch: Partial<ItemDto> & Pick<ItemDto, 'id' | 'slot' | 'rarity'>): ItemDto => ({
  nameKey: `items.${patch.id}`,
  assetKey: `${patch.slot}/${patch.id}`,
  isDefault: false,
  ...patch,
})
const drawn = (id: string, slot: ItemDto['slot'], rarity: ItemDto['rarity'], layer: number): ItemDto =>
  item({ id, slot, rarity, asset: { layer, file: `item_${id}_L${layer}`, fitsAvatarCrop: true } })

const HAIR_BOB = item({
  id: 'hair_f_bob01',
  slot: 'hairStyle',
  rarity: 'common',
  gender: 'f',
  counterpart: 'hair_m_tousled01',
  free: true,
  asset: { layer: 60, file: 'item_hair_f_bob01_L60', back: 'item_hair_f_bob01_L20', fitsAvatarCrop: true },
})
const OUTFIT_CASUAL = { ...drawn('outfit_casual01', 'outfit', 'common', 40), isDefault: true }
const OUTFIT_DEALER = drawn('outfit_dealer01', 'outfit', 'rare', 40)
const OUTFIT_TUXEDO = drawn('outfit_tuxedo01', 'outfit', 'epic', 40)
const HEAD_TOPHAT = drawn('head_tophat01', 'head', 'epic', 80)
const HEAD_BEANIE = drawn('head_beanie01', 'head', 'common', 80)
const FACE_SUNGLASSES = drawn('face_sunglasses01', 'face', 'rare', 70)
const HAIRCOLOR_BLUE = item({ id: 'haircolor_blue01', slot: 'hairColor', rarity: 'rare', colour: '#3355aa' })
const HAIRCOLOR_RED = item({ id: 'haircolor_red01', slot: 'hairColor', rarity: 'common', colour: '#b3261e', free: true })
const TITLE_ROOKIE = item({ id: 'title_rookie', slot: 'title', rarity: 'common' })

const CATALOG = [HAIR_BOB, OUTFIT_CASUAL, OUTFIT_DEALER, OUTFIT_TUXEDO, HEAD_TOPHAT, HEAD_BEANIE, FACE_SUNGLASSES, HAIRCOLOR_BLUE, HAIRCOLOR_RED, TITLE_ROOKIE]

const entry = (row: ItemDto, patch: Partial<ShopEntryDto> = {}): ShopEntryDto => ({
  itemId: row.id,
  slot: row.slot,
  rarity: row.rarity,
  price: row.rarity === 'common' ? 10_000 : row.rarity === 'rare' ? 30_000 : 150_000,
  minRank: row.rarity === 'common' ? 1 : row.rarity === 'rare' ? 3 : 4,
  purchasable: true,
  owned: false,
  lock: null,
  ...patch,
})

const VIEW: ShopViewDto = {
  weekKey: '2026-W43',
  featured: ['outfit_dealer01', 'outfit_tuxedo01'],
  featuredSource: 'auto',
  entries: [
    entry(HAIR_BOB, { lock: { kind: 'free' }, purchasable: false, owned: true }),
    entry(OUTFIT_CASUAL, { lock: { kind: 'default' }, purchasable: false, owned: true }),
    entry(OUTFIT_DEALER),
    entry(OUTFIT_TUXEDO),
    entry(HEAD_TOPHAT, { lock: { kind: 'achievement', achievementId: 'login_days_100' }, purchasable: false }),
    entry(HEAD_BEANIE, { owned: true, purchasable: false }),
    entry(FACE_SUNGLASSES, { price: 130_000 }),
    entry(HAIRCOLOR_BLUE),
    entry(HAIRCOLOR_RED, { lock: { kind: 'free' }, purchasable: false, owned: true }),
    entry(TITLE_ROOKIE, { lock: { kind: 'gift_month', month: '2026-11' }, purchasable: false }),
  ],
  me: { balance: 128_000, reputation: 455, rank: 3, ranks: [{ rank: 1, threshold: 0 }, { rank: 2, threshold: 100 }, { rank: 3, threshold: 400 }, { rank: 4, threshold: 1800 }, { rank: 5, threshold: 6000 }] },
}

const AVATAR: AvatarConfigDto = { v: 4, gender: 'f', hairStyle: 'hair_f_bob01', outfit: 'outfit_casual01' }
const INVENTORY: InventoryDto = { items: [], avatar: AVATAR }

function stubApi(overrides: Partial<NormalApi> = {}): NormalApi {
  return {
    shop: vi.fn().mockResolvedValue(VIEW),
    catalogItems: vi.fn().mockResolvedValue({ items: CATALOG }),
    avatarCatalog: vi.fn().mockResolvedValue(AVATAR_CATALOG),
    inventory: vi.fn().mockResolvedValue(INVENTORY),
    shopBuy: vi.fn().mockResolvedValue({ balance: 98_000, itemId: 'outfit_dealer01', repeated: false }),
    setAvatar: vi.fn().mockImplementation((config: AvatarConfigDto) => Promise.resolve({ config })),
    ...overrides,
  } as unknown as NormalApi
}

const renderShop = (api: NormalApi = stubApi(), balance = 128_000) =>
  renderWithI18n(<ShopScreen api={api} lang="vi" balance={balance} playerId="p1" />, makeI18n('vi'))

const opened = (): Promise<HTMLElement> => screen.findByRole('heading', { name: viNormal.shop.title, level: 1 })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** The stage's figure, by the hash the kit stamps on every chibi. */
const stageHash = (container: HTMLElement): string | null =>
  container.querySelector(`section[aria-label="${viNormal.shop.figure}"] [data-chibi-hash]`)?.getAttribute('data-chibi-hash') ?? null

const featuredShelf = (container: HTMLElement): HTMLElement => container.querySelector('[data-shelf="featured"]') as HTMLElement
/** The rarity shelf on screen (common until the switch moves). */
const rarityShelf = (container: HTMLElement): HTMLElement => container.querySelector('[data-shelf]:not([data-shelf="featured"])') as HTMLElement
const cardOf = (container: HTMLElement, id: string): HTMLElement => container.querySelector(`[data-item="${id}"]`) as HTMLElement
const pickButton = (scope: HTMLElement, name: string): HTMLElement => within(scope).getByRole('button', { name: new RegExp(`^${name}, `) })

/** Presses "Mua · 30.000" on the featured dealer outfit, then "Mua" in the confirmation. */
async function buyDealer(user: UserEvent, container: HTMLElement): Promise<void> {
  await user.click(within(cardOf(featuredShelf(container), 'outfit_dealer01')).getByRole('button', { name: 'Mua · 30.000' }))
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: viNormal.shop.buy }))
}

async function toShelf(user: UserEvent, rarity: keyof typeof viNormal.inventory.rarity): Promise<void> {
  const group = screen.getByRole('group', { name: viNormal.shop.shelves })
  await user.click(within(group).getByRole('button', { name: viNormal.inventory.rarity[rarity] }))
}

describe('ShopScreen', () => {
  it('shows this week\'s shelf and the three rarity shelves', async () => {
    const user = userEvent.setup()
    const { container } = renderShop()
    await opened()

    expect(screen.getByRole('heading', { name: viNormal.shop.featured, level: 2 })).toBeInTheDocument()
    expect(screen.getByText('Tuần 43/2026')).toBeInTheDocument()
    const featured = featuredShelf(container)
    expect(within(featured).getByRole('button', { name: new RegExp(`^${viNormal.items.outfit_dealer01}, `) })).toBeInTheDocument()
    expect(within(featured).getByRole('button', { name: new RegExp(`^${viNormal.items.outfit_tuxedo01}, `) })).toBeInTheDocument()

    // Common first: the beanie (owned) and the title (a gift of a month); never the free hairstyle or the free colour.
    expect(rarityShelf(container)).toHaveAttribute('data-shelf', 'common')
    expect(cardOf(rarityShelf(container), 'head_beanie01')).not.toBeNull()
    expect(cardOf(rarityShelf(container), 'title_rookie')).not.toBeNull()
    expect(cardOf(rarityShelf(container), 'hair_f_bob01')).toBeNull()
    expect(cardOf(rarityShelf(container), 'haircolor_red01')).toBeNull()

    await toShelf(user, 'rare')
    expect(rarityShelf(container)).toHaveAttribute('data-shelf', 'rare')
    expect(cardOf(rarityShelf(container), 'face_sunglasses01')).not.toBeNull()
    await toShelf(user, 'epic')
    expect(cardOf(rarityShelf(container), 'head_tophat01')).not.toBeNull()
  })

  it('narrows a shelf to one slot, with "Màu sắc" listing the colours that sell', async () => {
    const user = userEvent.setup()
    const { container } = renderShop()
    await opened()
    await toShelf(user, 'rare')

    const filters = screen.getByRole('group', { name: viNormal.shop.slotFilter })
    await user.click(within(filters).getByRole('button', { name: viNormal.shop.slot.colour }))
    expect(cardOf(rarityShelf(container), 'haircolor_blue01')).not.toBeNull()
    expect(cardOf(rarityShelf(container), 'outfit_dealer01')).toBeNull()

    await user.click(within(filters).getByRole('button', { name: viNormal.wardrobe.tabs.outfit }))
    expect(cardOf(rarityShelf(container), 'outfit_dealer01')).not.toBeNull()
    expect(cardOf(rarityShelf(container), 'haircolor_blue01')).toBeNull()
  })

  it('tries a card on the figure and takes it back with "Về đồ đang mặc"', async () => {
    const user = userEvent.setup()
    const { container } = renderShop()
    await opened()
    const before = stageHash(container)
    expect(before).not.toBeNull()

    await user.click(pickButton(featuredShelf(container), viNormal.items.outfit_tuxedo01))
    expect(stageHash(container)).not.toBe(before)
    expect(screen.getByText(`Mặc thử: ${viNormal.items.outfit_tuxedo01}`)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: viNormal.shop.reset }))
    expect(stageHash(container)).toBe(before)
    expect(screen.queryByRole('button', { name: viNormal.shop.reset })).toBeNull()
  })

  it('recolours the figure when a colour is tried on', async () => {
    const user = userEvent.setup()
    const { container } = renderShop()
    await opened()
    await toShelf(user, 'rare')
    const before = stageHash(container)

    await user.click(pickButton(rarityShelf(container), viNormal.items.haircolor_blue01))
    expect(stageHash(container)).not.toBe(before)
  })

  it('buys through the confirmation with a fresh purchase id, then shows the new balance, owns the card and offers "Mặc luôn"', async () => {
    const user = userEvent.setup()
    const api = stubApi()
    const { container } = renderShop(api)
    await opened()
    expect(screen.getByText('Số dư: 128.000 điểm')).toBeInTheDocument()

    await user.click(within(cardOf(featuredShelf(container), 'outfit_dealer01')).getByRole('button', { name: 'Mua · 30.000' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(`Mua ${viNormal.items.outfit_dealer01} với 30.000 điểm? Còn lại 98.000.`)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: viNormal.shop.buy }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.shopBuy).toHaveBeenCalledTimes(1)
    const [itemId, purchaseId] = vi.mocked(api.shopBuy).mock.calls[0]!
    expect(itemId).toBe('outfit_dealer01')
    expect(purchaseId).toMatch(UUID)
    expect(screen.getByText('Số dư: 98.000 điểm')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(`${viNormal.items.outfit_dealer01} đã vào tủ đồ`)
    expect(within(cardOf(featuredShelf(container), 'outfit_dealer01')).getByText(viNormal.shop.owned)).toBeInTheDocument()

    // The bought outfit stays on the figure, and "Mặc luôn" saves it over the saved outfit.
    await user.click(screen.getByRole('button', { name: viNormal.shop.wearNow }))
    await waitFor(() => expect(api.setAvatar).toHaveBeenCalledWith({ ...AVATAR, outfit: 'outfit_dealer01' }))
    expect(await screen.findByText(viNormal.shop.worn)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: viNormal.shop.wearNow })).toBeNull()
  })

  it('wears only what the player owns on "Mặc luôn", leaving an unowned try-on off the save', async () => {
    const user = userEvent.setup()
    const api = stubApi()
    const { container } = renderShop(api)
    await opened()

    await toShelf(user, 'rare')
    await user.click(pickButton(rarityShelf(container), viNormal.items.face_sunglasses01))
    await user.click(within(cardOf(featuredShelf(container), 'outfit_dealer01')).getByRole('button', { name: 'Mua · 30.000' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: viNormal.shop.buy }))
    await user.click(await screen.findByRole('button', { name: viNormal.shop.wearNow }))

    await waitFor(() => expect(api.setAvatar).toHaveBeenCalledWith({ ...AVATAR, outfit: 'outfit_dealer01' }))
  })

  it('shows "🔒 cần Bậc thầy" above the player\'s rank and offers no button', async () => {
    const { container } = renderShop()
    await opened()

    const tuxedo = cardOf(featuredShelf(container), 'outfit_tuxedo01')
    expect(within(tuxedo).getByText('🔒 cần Bậc thầy')).toBeInTheDocument()
    expect(within(tuxedo).queryByRole('button', { name: /^Mua/ })).toBeNull()
  })

  it('shows "✓ Đã có" and "Mặc" on an owned card', async () => {
    const { container } = renderShop()
    await opened()

    const beanie = cardOf(rarityShelf(container), 'head_beanie01')
    expect(within(beanie).getByText(viNormal.shop.owned)).toBeInTheDocument()
    expect(within(beanie).getByRole('link', { name: `Mặc ${viNormal.items.head_beanie01} trong Phòng thay đồ` })).toHaveAttribute(
      'href',
      '#/avatar?item=head_beanie01',
    )
  })

  it('labels a locked card with where it comes from', async () => {
    const user = userEvent.setup()
    const { container } = renderShop()
    await opened()

    expect(within(cardOf(rarityShelf(container), 'title_rookie')).getByText('📅 Quà tháng 11/2026')).toBeInTheDocument()
    await toShelf(user, 'epic')
    expect(
      within(cardOf(rarityShelf(container), 'head_tophat01')).getByText(`🏆 Thành tựu: ${viNormal.achievements.login_days_100.name}`),
    ).toBeInTheDocument()
  })

  it('says how many points are missing when the balance falls short', async () => {
    const user = userEvent.setup()
    const { container } = renderShop()
    await opened()
    await toShelf(user, 'rare')

    const glasses = cardOf(rarityShelf(container), 'face_sunglasses01')
    expect(within(glasses).getByRole('button', { name: 'Mua · 130.000' })).toBeDisabled()
    expect(within(glasses).getByText('thiếu 2.000 điểm')).toBeInTheDocument()
  })

  it('keeps one purchase id for the dialog: a retry after a lost answer resends the same one', async () => {
    const user = userEvent.setup()
    const shopBuy = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(0, NETWORK_ERROR_CODE, 'fetch failed'))
      .mockResolvedValueOnce({ balance: 98_000, itemId: 'outfit_dealer01', repeated: true })
    const api = stubApi({ shopBuy })
    const { container } = renderShop(api)
    await opened()

    await user.click(within(cardOf(featuredShelf(container), 'outfit_dealer01')).getByRole('button', { name: 'Mua · 30.000' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: viNormal.shop.buy }))
    expect(await within(dialog).findByText(viNormal.shop.retry)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: viNormal.shop.buy }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(shopBuy).toHaveBeenCalledTimes(2)
    expect(shopBuy.mock.calls[1]).toEqual(shopBuy.mock.calls[0])
    expect(within(cardOf(featuredShelf(container), 'outfit_dealer01')).getByText(viNormal.shop.owned)).toBeInTheDocument()
  })

  it('opens a new purchase id for the next dialog', async () => {
    const user = userEvent.setup()
    const api = stubApi()
    const { container } = renderShop(api)
    await opened()

    const buyDealer = (): HTMLElement => within(cardOf(featuredShelf(container), 'outfit_dealer01')).getByRole('button', { name: 'Mua · 30.000' })
    await user.click(buyDealer())
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: viNormal.shop.cancel }))
    vi.mocked(api.shopBuy).mockRejectedValueOnce(new ApiError(409, 'INSUFFICIENT_POINTS', 'no'))
    await user.click(buyDealer())
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: viNormal.shop.buy }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await user.click(buyDealer())
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: viNormal.shop.buy }))

    await waitFor(() => expect(api.shopBuy).toHaveBeenCalledTimes(2))
    const ids = vi.mocked(api.shopBuy).mock.calls.map((call) => call[1])
    expect(ids[0]).not.toBe(ids[1])
  })

  it('closes the dialog on a refusal and says why', async () => {
    const user = userEvent.setup()
    const api = stubApi({ shopBuy: vi.fn().mockRejectedValue(new ApiError(409, 'INSUFFICIENT_POINTS', 'no')) })
    const { container } = renderShop(api)
    await opened()

    await user.click(within(cardOf(featuredShelf(container), 'outfit_dealer01')).getByRole('button', { name: 'Mua · 30.000' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: viNormal.shop.buy }))

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.shop.refusal.INSUFFICIENT_POINTS)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes the dialog on ALREADY_OWNED and marks the card "✓ Đã có" without reloading', async () => {
    const user = userEvent.setup()
    const api = stubApi({ shopBuy: vi.fn().mockRejectedValue(new ApiError(409, 'ALREADY_OWNED', 'owned')) })
    const { container } = renderShop(api)
    await opened()

    await buyDealer(user, container)

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.shop.refusal.ALREADY_OWNED)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(cardOf(featuredShelf(container), 'outfit_dealer01')).getByText(viNormal.shop.owned)).toBeInTheDocument()
    expect(api.shop).toHaveBeenCalledTimes(1)
  })

  it.each(['RANK_TOO_LOW', 'PURCHASE_UNDONE', 'SHOP_DISABLED'] as const)(
    'closes the dialog on %s, says why, and reloads the shelves',
    async (code) => {
      const user = userEvent.setup()
      const api = stubApi({ shopBuy: vi.fn().mockRejectedValue(new ApiError(409, code, 'no')) })
      const { container } = renderShop(api)
      await opened()

      await buyDealer(user, container)

      expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.shop.refusal[code])
      expect(screen.queryByRole('dialog')).toBeNull()
      await waitFor(() => expect(api.shop).toHaveBeenCalledTimes(2))
    },
  )

  it('keeps the shelves as they are on INSUFFICIENT_POINTS: no reload', async () => {
    const user = userEvent.setup()
    const api = stubApi({ shopBuy: vi.fn().mockRejectedValue(new ApiError(409, 'INSUFFICIENT_POINTS', 'no')) })
    const { container } = renderShop(api)
    await opened()

    await buyDealer(user, container)

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.shop.refusal.INSUFFICIENT_POINTS)
    expect(api.shop).toHaveBeenCalledTimes(1)
  })

  it('closes the dialog on a 4xx the shop has no words for, offering no retry', async () => {
    const user = userEvent.setup()
    const api = stubApi({ shopBuy: vi.fn().mockRejectedValue(new ApiError(400, 'BAD_REQUEST', 'bad')) })
    const { container } = renderShop(api)
    await opened()

    await buyDealer(user, container)

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.shop.failed)
    expect(viNormal.shop.failed).toBe('Không thực hiện được, vui lòng thử lại')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(viNormal.shop.retry)).toBeNull()
  })

  it.each([
    ['a 5xx', new ApiError(503, 'UNAVAILABLE', 'down')],
    ['a 429', new ApiError(429, 'RATE_LIMITED', 'slow down')],
  ])('keeps the dialog open with the retry line on %s', async (_label, cause) => {
    const user = userEvent.setup()
    const api = stubApi({ shopBuy: vi.fn().mockRejectedValue(cause) })
    const { container } = renderShop(api)
    await opened()

    await buyDealer(user, container)

    expect(await within(screen.getByRole('dialog')).findByText(viNormal.shop.retry)).toBeInTheDocument()
  })

  it('marks the card the answer names when a repeated purchase id answers for another item', async () => {
    const user = userEvent.setup()
    const api = stubApi({ shopBuy: vi.fn().mockResolvedValue({ balance: 98_000, itemId: 'face_sunglasses01', repeated: true }) })
    const { container } = renderShop(api)
    await opened()

    await buyDealer(user, container)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    expect(within(cardOf(featuredShelf(container), 'outfit_dealer01')).getByRole('button', { name: 'Mua · 30.000' })).toBeInTheDocument()
    await toShelf(user, 'rare')
    expect(within(cardOf(rarityShelf(container), 'face_sunglasses01')).getByText(viNormal.shop.owned)).toBeInTheDocument()
  })

  it('shows the live balance once it moves after a purchase', async () => {
    const user = userEvent.setup()
    const api = stubApi()
    const { container, rerender, i18n } = renderShop(api)
    await opened()

    await buyDealer(user, container)
    expect(await screen.findByText('Số dư: 98.000 điểm')).toBeInTheDocument()

    rerender(
      <I18nextProvider i18n={i18n}>
        <ShopScreen api={api} lang="vi" balance={97_500} playerId="p1" />
      </I18nextProvider>,
    )
    expect(screen.getByText('Số dư: 97.500 điểm')).toBeInTheDocument()
  })

  it('says what happened inside the pinned stage, not at the top of the page', async () => {
    const user = userEvent.setup()
    const shopBuy = vi
      .fn()
      .mockResolvedValueOnce({ balance: 98_000, itemId: 'outfit_dealer01', repeated: false })
      .mockRejectedValueOnce(new ApiError(409, 'INSUFFICIENT_POINTS', 'no'))
    const { container } = renderShop(stubApi({ shopBuy }))
    await opened()
    const stage = container.querySelector(`section[aria-label="${viNormal.shop.figure}"]`) as HTMLElement

    await buyDealer(user, container)
    expect(await within(stage).findByRole('status')).toHaveTextContent(`${viNormal.items.outfit_dealer01} đã vào tủ đồ`)

    await toShelf(user, 'rare')
    await user.click(within(cardOf(rarityShelf(container), 'haircolor_blue01')).getByRole('button', { name: 'Mua · 30.000' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: viNormal.shop.buy }))
    expect(await within(stage).findByRole('alert')).toHaveTextContent(viNormal.shop.refusal.INSUFFICIENT_POINTS)
  })

  it('hands focus to "Mặc luôn" after a purchase, since the button that opened the dialog is gone', async () => {
    const user = userEvent.setup()
    const { container } = renderShop()
    await opened()

    await buyDealer(user, container)

    const wearNow = await screen.findByRole('button', { name: viNormal.shop.wearNow })
    await waitFor(() => expect(document.activeElement).toBe(wearNow))
  })

  it('orders a shelf by slot, as the filters read, then by id', async () => {
    const user = userEvent.setup()
    const OUTFIT_CHEF = drawn('outfit_chef01', 'outfit', 'rare', 40)
    const api = stubApi({
      shop: vi.fn().mockResolvedValue({ ...VIEW, entries: [...VIEW.entries, entry(OUTFIT_CHEF)] }),
      catalogItems: vi.fn().mockResolvedValue({ items: [...CATALOG, OUTFIT_CHEF] }),
    })
    const { container } = renderShop(api)
    await opened()
    await toShelf(user, 'rare')

    const order = [...rarityShelf(container).querySelectorAll('[data-item]')].map((card) => card.getAttribute('data-item'))
    expect(order).toEqual(['face_sunglasses01', 'outfit_chef01', 'outfit_dealer01', 'haircolor_blue01'])
  })

  it('shows a hairstyle that is for sale, hiding only the free ones', async () => {
    const user = userEvent.setup()
    const HAIR_PRICED = item({ id: 'hair_f_bun02', slot: 'hairStyle', rarity: 'rare', gender: 'f', asset: { layer: 60, file: 'item_hair_f_bun02_L60', fitsAvatarCrop: true } })
    const api = stubApi({
      shop: vi.fn().mockResolvedValue({ ...VIEW, entries: [...VIEW.entries, entry(HAIR_PRICED)] }),
      catalogItems: vi.fn().mockResolvedValue({ items: [...CATALOG, HAIR_PRICED] }),
    })
    const { container } = renderShop(api)
    await opened()

    expect(cardOf(rarityShelf(container), 'hair_f_bob01')).toBeNull()
    await toShelf(user, 'rare')
    expect(cardOf(rarityShelf(container), 'hair_f_bun02')).not.toBeNull()
  })

  it('says so when the shop cannot load, and tries again', async () => {
    const user = userEvent.setup()
    const shop = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(VIEW)
    renderShop(stubApi({ shop }))

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.shop.error)
    await user.click(screen.getByRole('button', { name: viNormal.screens.retry }))
    expect(await opened()).toBeInTheDocument()
  })
})

describe('newPurchaseId', () => {
  it('builds a lower-case UUID v4 where crypto.randomUUID is missing (a plain-http LAN host)', () => {
    const id = newPurchaseId({ getRandomValues: crypto.getRandomValues.bind(crypto) })
    expect(id).toMatch(UUID)
  })

  it('lower-cases crypto.randomUUID where it exists', () => {
    expect(newPurchaseId({ getRandomValues: crypto.getRandomValues.bind(crypto), randomUUID: () => 'ABCDEF01-2345-4678-89AB-CDEF01234567' })).toBe(
      'abcdef01-2345-4678-89ab-cdef01234567',
    )
  })
})
