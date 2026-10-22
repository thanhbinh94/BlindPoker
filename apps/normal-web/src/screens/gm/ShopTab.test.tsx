import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, type GmShopConfigDto, type GmShopPriceRowDto, type NormalApi } from '../../api.js'
import viNormal from '../../locales/vi/normal.json'
import { renderWithI18n } from '../../test-i18n.js'
import { ShopTab } from './ShopTab.js'

const t = viNormal.gm

function row(itemId: string, slot: GmShopPriceRowDto['slot'], over: Partial<GmShopPriceRowDto> = {}): GmShopPriceRowDto {
  return { itemId, slot, rarity: 'rare', priced: true, pricePoints: 30_000, minRank: 3, enabled: true, salePrice: null, lock: null, ...over }
}

/** Eight items on sale, an achievement's item, and one the price list has never seen. */
const PRICES: GmShopPriceRowDto[] = [
  row('outfit_dealer01', 'outfit'),
  row('outfit_tet_red01', 'outfit'),
  row('head_conical_hat01', 'head'),
  row('head_beanie01', 'head', { rarity: 'common', pricePoints: 10_000, minRank: 1 }),
  row('aura_ice01', 'aura'),
  row('outfit_tuxedo01', 'outfit', { rarity: 'epic', pricePoints: 150_000, minRank: 4 }),
  row('outfit_royal_robe01', 'outfit', { rarity: 'epic', pricePoints: 150_000, minRank: 4 }),
  row('haircolor_rose01', 'hairColor'),
  row('head_crown_gold01', 'head', { rarity: 'epic', enabled: false, lock: { kind: 'achievement', achievementId: 'login_days_100' } }),
  row('face_new01', 'face', { priced: false, enabled: false, lock: { kind: 'unpriced' } }),
]

const WEEKS = Array.from({ length: 9 }, (_, i) => `2026-W${String(43 + i)}`)

function config(over: Partial<GmShopConfigDto> = {}): GmShopConfigDto {
  return {
    prices: PRICES,
    featured: WEEKS.map((weekKey) => ({ weekKey, itemIds: ['outfit_dealer01', 'aura_ice01'], source: 'auto' as const })),
    welcomeChoices: ['outfit_dealer01', 'outfit_tet_red01', 'head_conical_hat01'],
    welcomeSlots: ['outfit', 'head', 'face', 'aura', 'frame'],
    reputation: {
      rules: { hand_played: 1, hand_won: 3, daily_login: 10, achievement_small: 50, achievement_big: 150, achievement_item: 500, welcome: 100, newcomer_day7: 200 },
      ranks: [0, 100, 400, 1_800, 5_000].map((threshold, i) => ({ rank: i + 1, threshold })),
    },
    ...over,
  }
}

type Stub = NormalApi & Record<string, ReturnType<typeof vi.fn>>

function setup(data: GmShopConfigDto = config(), overrides: Partial<Record<keyof NormalApi, unknown>> = {}) {
  const api = {
    gmShop: vi.fn().mockResolvedValue(data),
    gmSetShopPrices: vi.fn().mockResolvedValue({ actionId: 1, changed: 2 }),
    gmSetShopFeatured: vi.fn().mockResolvedValue({ actionId: 2 }),
    gmSetWelcomeChoices: vi.fn().mockResolvedValue({ actionId: 3 }),
    gmSetReputationRules: vi.fn().mockResolvedValue({ actionId: 4 }),
    gmSetReputationRanks: vi.fn().mockResolvedValue({ actionId: 5 }),
    ...overrides,
  } as unknown as Stub
  const guard = (cause: unknown): never => {
    throw cause
  }
  renderWithI18n(<ShopTab api={api} lang="vi" guard={guard} />)
  return { api }
}

const section = async (title: string) => within((await screen.findByRole('heading', { name: title, level: 2 })).closest('section')!)
const dialog = () => within(screen.getByRole('dialog'))

async function confirmWithReason(reason: string): Promise<void> {
  const user = userEvent.setup()
  await user.type(dialog().getByLabelText(t.dialog.reason), reason)
  await user.click(dialog().getAllByRole('button').at(-1)!)
}

describe('ShopTab', () => {
  it('draws the four blocks: prices, this week’s shelf, the welcome gift and reputation', async () => {
    setup()

    expect(await screen.findByRole('heading', { name: t.shop.prices.title })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: t.shop.featured.title })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: t.shop.welcome.title })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: t.reputation.title })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: t.reputation.rulesTitle })).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: t.reputation.ranksTitle })).getAllByRole('row')).toHaveLength(6)
    expect(within(screen.getByRole('table', { name: t.reputation.rulesTitle })).getAllByRole('row')).toHaveLength(9)
  })

  it('lists the unpriced item first and labels each row with the shop’s verdict', async () => {
    setup()
    const table = await screen.findByRole('table', { name: t.shop.prices.title })

    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('face_new01')
    expect(rows[0]).toHaveTextContent(t.shop.lock.unpriced)
    expect(within(table).getByText('🏆 Thành tựu: Trăm ngày ghé bàn')).toBeInTheDocument()
    expect(within(table).getAllByText(t.shop.lock.none).length).toBeGreaterThan(0)
  })

  it('filters by slot and by rarity', async () => {
    const user = userEvent.setup()
    setup()
    const table = await screen.findByRole('table', { name: t.shop.prices.title })

    await user.selectOptions(screen.getByLabelText(t.shop.prices.filterSlot), 'outfit')
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 4)
    await user.selectOptions(screen.getByLabelText(t.shop.prices.filterRarity), 'epic')
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 2)
  })

  it('saves only the rows that changed, each with only its changed fields, under one reason', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    const prices = await section(t.shop.prices.title)
    await screen.findByRole('table', { name: t.shop.prices.title })
    const save = prices.getByRole('button', { name: t.shop.prices.save })
    expect(save).toBeDisabled()

    const price = prices.getByLabelText('Giá của Mũ len')
    await user.clear(price)
    await user.type(price, '12000')
    await user.click(prices.getByLabelText('Bán Bộ tuxedo'))
    await user.selectOptions(prices.getByLabelText('Bậc tối thiểu của Nón lá'), '2')
    expect(prices.getByText('Đã sửa 3 hàng, chưa lưu.')).toBeInTheDocument()

    await user.click(save)
    await confirmWithReason('chỉnh giá mùa thu')

    expect(api.gmSetShopPrices).toHaveBeenCalledWith(
      [
        { itemId: 'head_conical_hat01', minRank: 2 },
        { itemId: 'head_beanie01', pricePoints: 12_000 },
        { itemId: 'outfit_tuxedo01', enabled: false },
      ],
      'chỉnh giá mùa thu',
    )
    expect(await screen.findByText('Đã lưu 2 giá.')).toBeInTheDocument()
    expect(api.gmShop).toHaveBeenCalledTimes(2)
  })

  it('refuses a price that is not a whole number before anything is sent', async () => {
    const user = userEvent.setup()
    setup()
    const prices = await section(t.shop.prices.title)
    await screen.findByRole('table', { name: t.shop.prices.title })

    const price = prices.getByLabelText('Giá của Mũ len')
    await user.clear(price)
    await user.type(price, '12.5')

    // The alert names the row, which a filter may since have hidden (B4 review).
    expect(prices.getByRole('alert')).toHaveTextContent(`${t.shop.prices.invalid} Sửa giá của: Mũ len.`)
    expect(prices.getByRole('button', { name: t.shop.prices.save })).toBeDisabled()
  })

  it('shows the rotation for a week nobody arranged, and lets the GM start a shelf of their own', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    const shelf = await section(t.shop.featured.title)
    await screen.findByRole('heading', { name: t.shop.featured.title })

    expect(shelf.getByText(t.shop.featured.auto)).toBeInTheDocument()
    expect(within(shelf.getByRole('list', { name: t.shop.featured.items })).getByText('Đồng phục chia bài')).toBeInTheDocument()
    // Only what sells is offered: never the achievement's crown nor the unpriced item.
    const picker = shelf.getByLabelText(t.shop.featured.pick)
    expect(within(picker).queryByText('Vương miện vàng')).toBeNull()
    expect(within(picker).queryByText('face_new01')).toBeNull()

    await user.selectOptions(shelf.getByLabelText(t.shop.featured.week), '2026-W44')
    await user.selectOptions(shelf.getByLabelText(t.shop.featured.pick), 'outfit_tuxedo01')
    await user.click(shelf.getByRole('button', { name: t.shop.featured.add }))
    await user.click(shelf.getByRole('button', { name: t.shop.featured.save }))
    await confirmWithReason('kệ tuần sau')

    expect(api.gmSetShopFeatured).toHaveBeenCalledWith('2026-W44', ['outfit_tuxedo01'], 'kệ tuần sau')
    expect(await screen.findByText(t.done.shopFeatured)).toBeInTheDocument()
  })

  it('refuses a seventh item on the shelf', async () => {
    const six = ['outfit_dealer01', 'outfit_tet_red01', 'head_conical_hat01', 'head_beanie01', 'aura_ice01', 'outfit_tuxedo01']
    const data = config()
    data.featured[0] = { weekKey: WEEKS[0]!, itemIds: six, source: 'gm' }
    setup(data)
    const shelf = await section(t.shop.featured.title)
    await screen.findByRole('heading', { name: t.shop.featured.title })

    expect(shelf.getByText('Đã chọn 6/6')).toBeInTheDocument()
    expect(shelf.getByText(t.shop.featured.full)).toBeInTheDocument()
    expect(shelf.getByLabelText(t.shop.featured.pick)).toBeDisabled()
    expect(shelf.getByRole('button', { name: t.shop.featured.add })).toBeDisabled()
    // A GM's week can be handed back to the rotation.
    expect(shelf.getByRole('button', { name: t.shop.featured.clear })).toBeEnabled()
  })

  it('needs exactly three different welcome items, offered from the wearable slots only', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    const welcome = await section(t.shop.welcome.title)
    await screen.findByRole('heading', { name: t.shop.welcome.title })
    const save = welcome.getByRole('button', { name: t.shop.welcome.save })
    expect(save).toBeDisabled() // nothing changed yet

    const third = welcome.getByLabelText('Món 3')
    expect(within(third).queryByText('haircolor_rose01')).toBeNull()
    await user.selectOptions(third, '')
    expect(welcome.getByText(t.shop.welcome.needThree)).toBeInTheDocument()
    expect(save).toBeDisabled()
    await user.selectOptions(third, 'outfit_dealer01') // the same as the first
    expect(save).toBeDisabled()

    await user.selectOptions(third, 'aura_ice01')
    expect(save).toBeEnabled()
    await user.click(save)
    await confirmWithReason('quà chào mừng mới')

    expect(api.gmSetWelcomeChoices).toHaveBeenCalledWith(['outfit_dealer01', 'outfit_tet_red01', 'aura_ice01'], 'quà chào mừng mới')
  })

  it('saves the changed reputation sources only', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    const rep = await section(t.reputation.title)
    await screen.findByRole('heading', { name: t.reputation.title })

    const daily = rep.getByLabelText('Danh vọng cho: Một ngày điểm danh')
    await user.clear(daily)
    await user.type(daily, '15')
    await user.click(rep.getByRole('button', { name: t.reputation.saveRules }))
    await confirmWithReason('tăng điểm danh')

    expect(api.gmSetReputationRules).toHaveBeenCalledWith({ daily_login: 15 }, 'tăng điểm danh')
    expect(await screen.findByText(t.done.reputationRules)).toBeInTheDocument()
  })

  it('sends the whole ladder and prints the server’s refusal in the dialog', async () => {
    const user = userEvent.setup()
    const gmSetReputationRanks = vi.fn().mockRejectedValue(new ApiError(400, 'INVALID_RANKS', 'rank 3 must start above rank 2'))
    setup(config(), { gmSetReputationRanks })
    const rep = await section(t.reputation.title)
    await screen.findByRole('heading', { name: t.reputation.title })

    const sharp = rep.getByLabelText('Ngưỡng của Cao thủ')
    await user.clear(sharp)
    await user.type(sharp, '450')
    await user.click(rep.getByRole('button', { name: t.reputation.saveRanks }))
    await confirmWithReason('giãn bậc')

    expect(gmSetReputationRanks).toHaveBeenCalledWith(
      [0, 100, 450, 1_800, 5_000].map((threshold, i) => ({ rank: i + 1, threshold })),
      'giãn bậc',
    )
    await waitFor(() => expect(dialog().getByRole('alert')).toHaveTextContent('Ngưỡng bậc không hợp lệ: rank 3 must start above rank 2'))
  })

  it('refuses a ladder that falls before any dialog, with the rule it breaks', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    const rep = await section(t.reputation.title)
    await screen.findByRole('heading', { name: t.reputation.title })

    const sharp = rep.getByLabelText('Ngưỡng của Cao thủ')
    await user.clear(sharp)
    await user.type(sharp, '50')

    expect(rep.getByRole('alert')).toHaveTextContent(t.reputation.ranksNote)
    expect(rep.getByRole('button', { name: t.reputation.saveRanks })).toBeDisabled()
    expect(api.gmSetReputationRanks).not.toHaveBeenCalled()
  })

  it('refuses a source above 100.000 and a threshold above 1.000.000.000 before any dialog', async () => {
    const user = userEvent.setup()
    setup()
    const rep = await section(t.reputation.title)
    await screen.findByRole('heading', { name: t.reputation.title })

    const daily = rep.getByLabelText('Danh vọng cho: Một ngày điểm danh')
    await user.clear(daily)
    await user.type(daily, '100001')
    expect(rep.getByRole('alert')).toHaveTextContent(t.reputation.invalidRules)
    expect(rep.getByRole('button', { name: t.reputation.saveRules })).toBeDisabled()
    await user.clear(daily)
    await user.type(daily, '100000')
    expect(rep.queryByRole('alert')).toBeNull()

    const legend = rep.getByLabelText('Ngưỡng của Huyền thoại')
    await user.clear(legend)
    await user.type(legend, '1000000001')
    expect(rep.getByRole('alert')).toHaveTextContent(t.reputation.invalidRanks)
    expect(rep.getByRole('button', { name: t.reputation.saveRanks })).toBeDisabled()
  })

  it('offers a retry when the settings cannot be loaded', async () => {
    setup(config(), { gmShop: vi.fn().mockRejectedValue(new Error('down')) })

    expect(await screen.findByText(t.shop.error)).toBeInTheDocument()
  })
})
