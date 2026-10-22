import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useTintedLayer } from '@bp/ui-kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ItemDto, ShopEntryDto, ShopLockDto } from '../../api.js'
import viNormal from '../../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../../test-i18n.js'
import { footerState, ShopCard } from './ShopCard.js'

// A card's icon goes through the kit's `useTintedLayer` (`ItemPreview`); under jsdom it answers "draw the plain icon".
vi.mock('@bp/ui-kit', async (importOriginal) => ({ ...(await importOriginal<typeof import('@bp/ui-kit')>()), useTintedLayer: vi.fn() }))
beforeEach(() => {
  vi.mocked(useTintedLayer).mockReturnValue(null)
})

const item = (patch: Partial<ItemDto> & Pick<ItemDto, 'id' | 'slot' | 'rarity'>): ItemDto => ({
  nameKey: `items.${patch.id}`,
  assetKey: `${patch.slot}/${patch.id}`,
  isDefault: false,
  ...patch,
})

const OUTFIT_DEALER = item({
  id: 'outfit_dealer01',
  slot: 'outfit',
  rarity: 'rare',
  asset: { layer: 40, file: 'item_outfit_dealer01_L40', fitsAvatarCrop: false },
})
const HAIRCOLOR_BLUE = item({ id: 'haircolor_blue01', slot: 'hairColor', rarity: 'rare', colour: '#3355aa' })
const TITLE_ROOKIE = item({ id: 'title_rookie', slot: 'title', rarity: 'common' })

const entry = (row: ItemDto, patch: Partial<ShopEntryDto> = {}): ShopEntryDto => ({
  itemId: row.id,
  slot: row.slot,
  rarity: row.rarity,
  price: 30_000,
  minRank: 3,
  purchasable: true,
  owned: false,
  lock: null,
  ...patch,
})

const dealerName = viNormal.items.outfit_dealer01

function draw(props: { entry: ShopEntryDto; row?: ItemDto; balance?: number; rank?: number }) {
  const onTry = vi.fn()
  const onBuy = vi.fn()
  const utils = renderWithI18n(
    <ShopCard
      entry={props.entry}
      item={props.row ?? OUTFIT_DEALER}
      lang="vi"
      balance={props.balance ?? 100_000}
      rank={props.rank ?? 3}
      trying={false}
      onTry={onTry}
      onBuy={onBuy}
    />,
    makeI18n('vi'),
  )
  return { ...utils, onTry, onBuy }
}

describe('footerState', () => {
  it('reads owned, then a lock, then the rank, then the balance', () => {
    const dealer = entry(OUTFIT_DEALER)
    expect(footerState({ ...dealer, owned: true, purchasable: false }, 0, 1)).toBe('owned')
    expect(footerState({ ...dealer, lock: { kind: 'free' }, purchasable: false }, 1e9, 5)).toBe('lock')
    expect(footerState({ ...dealer, minRank: 4 }, 1e9, 3)).toBe('rank')
    expect(footerState(dealer, 29_999, 3)).toBe('short')
    expect(footerState(dealer, 30_000, 3)).toBe('buy')
  })
})

describe('ShopCard', () => {
  it('offers "Mua · 30.000" when the rank allows and the balance covers it, and a press asks to buy', async () => {
    const user = userEvent.setup()
    const dealer = entry(OUTFIT_DEALER)
    const { onBuy } = draw({ entry: dealer })

    const buy = screen.getByRole('button', { name: 'Mua · 30.000' })
    expect(buy).toBeEnabled()
    await user.click(buy)
    expect(onBuy).toHaveBeenCalledWith(dealer)
  })

  it('disables "Mua" and says how many points are missing', () => {
    draw({ entry: entry(OUTFIT_DEALER), balance: 18_000 })

    expect(screen.getByRole('button', { name: 'Mua · 30.000' })).toBeDisabled()
    expect(screen.getByText('thiếu 12.000 điểm')).toBeInTheDocument()
  })

  it('shows the price and "🔒 cần Bậc thầy" above the player\'s rank, with no button to press', () => {
    draw({ entry: entry(OUTFIT_DEALER, { minRank: 4, price: 150_000 }), rank: 3 })

    expect(screen.getByText('🔒 cần Bậc thầy')).toBeInTheDocument()
    expect(screen.getByText('150.000 điểm')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Mua/ })).toBeNull()
  })

  it('shows "✓ Đã có" and a "Mặc" link into the wardrobe with the item picked', () => {
    draw({ entry: entry(OUTFIT_DEALER, { owned: true, purchasable: false }) })

    expect(screen.getByText(viNormal.shop.owned)).toBeInTheDocument()
    const wear = screen.getByRole('link', { name: `Mặc ${dealerName} trong Phòng thay đồ` })
    expect(wear).toHaveTextContent(viNormal.shop.wear)
    expect(wear).toHaveAttribute('href', '#/avatar?item=outfit_dealer01')
    expect(screen.queryByRole('button', { name: /^Mua/ })).toBeNull()
  })

  it.each<[ShopLockDto, string]>([
    [{ kind: 'achievement', achievementId: 'login_days_100' }, `🏆 Thành tựu: ${viNormal.achievements.login_days_100.name}`],
    [{ kind: 'gift_month', month: '2026-11' }, '📅 Quà tháng 11/2026'],
    [{ kind: 'gift_default' }, '📅 Quà điểm danh'],
    [{ kind: 'free' }, 'Miễn phí — có sẵn trong Phòng thay đồ'],
    [{ kind: 'default' }, 'Không bán'],
    [{ kind: 'disabled' }, 'Không bán'],
    [{ kind: 'unpriced' }, 'Không bán'],
  ])('labels a %o lock with its source and offers no button', (lock, label) => {
    draw({ entry: entry(OUTFIT_DEALER, { lock, purchasable: false }) })

    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Mua/ })).toBeNull()
  })

  it('tries the item on when the card itself is pressed, whoever owns it', async () => {
    const user = userEvent.setup()
    const { onTry } = draw({ entry: entry(OUTFIT_DEALER, { minRank: 5 }), rank: 1 })

    await user.click(screen.getByRole('button', { name: new RegExp(`^${dealerName}, `) }))
    expect(onTry).toHaveBeenCalledWith(OUTFIT_DEALER)
  })

  it('draws a colour as a swatch card and a title as a word card, each with the footer', async () => {
    const user = userEvent.setup()
    const { onTry, unmount } = draw({ entry: entry(HAIRCOLOR_BLUE), row: HAIRCOLOR_BLUE })
    const swatch = screen.getByRole('button', { name: new RegExp(`^${viNormal.items.haircolor_blue01}, `) })
    await user.click(swatch)
    expect(onTry).toHaveBeenCalledWith(HAIRCOLOR_BLUE)
    expect(within(swatch.parentElement!).getByRole('button', { name: 'Mua · 30.000' })).toBeInTheDocument()
    unmount()

    draw({ entry: entry(TITLE_ROOKIE, { lock: { kind: 'gift_default' }, purchasable: false }), row: TITLE_ROOKIE })
    expect(screen.getByRole('button', { name: new RegExp(`^${viNormal.items.title_rookie}, `) })).toBeInTheDocument()
    expect(screen.getByText('📅 Quà điểm danh')).toBeInTheDocument()
  })
})
