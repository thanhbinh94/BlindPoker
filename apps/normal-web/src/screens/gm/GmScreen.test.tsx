import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, type GmOverviewDto, type NormalApi } from '../../api.js'
import viNormal from '../../locales/vi/normal.json'
import { renderWithI18n } from '../../test-i18n.js'
import { GmScreen } from './GmScreen.js'

const OVERVIEW: GmOverviewDto = {
  online: 3,
  rooms: 2,
  accounts: 41,
  locked: 1,
  gms: 2,
  points24h: {
    sources: 9_000,
    sinks: 4_000,
    byReason: [
      { reason: 'daily_login', total: 6_000 },
      { reason: 'relief', total: 3_000 },
    ],
  },
  reputation: { total: 900, byRank: [38, 2, 1, 0, 0] },
}

type Stub = NormalApi & Record<string, ReturnType<typeof vi.fn>>

function stubApi(overrides: Partial<Record<keyof NormalApi, unknown>> = {}): Stub {
  return {
    gmOverview: vi.fn().mockResolvedValue(OVERVIEW),
    gmDailyStats: vi.fn().mockResolvedValue([]),
    gmSearch: vi.fn().mockResolvedValue({ players: [], nextBefore: null }),
    gmRooms: vi.fn().mockResolvedValue({ rooms: [] }),
    gmActions: vi.fn().mockResolvedValue({ actions: [], nextBefore: null }),
    ...overrides,
  } as unknown as Stub
}

function setup(api: Stub = stubApi()) {
  const onForbidden = vi.fn()
  const result = renderWithI18n(<GmScreen api={api} lang="vi" onForbidden={onForbidden} />)
  return { ...result, api, onForbidden }
}

describe('GmScreen', () => {
  it('has the seven tabs, in order, on the overview first', async () => {
    setup()

    expect(screen.getByRole('heading', { name: viNormal.gm.title, level: 1 })).toBeInTheDocument()
    for (const name of Object.values(viNormal.gm.tabs)) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.getAllByRole('button').slice(0, 7).map((tab) => tab.textContent)).toEqual([
      'Tổng quan',
      'Người chơi',
      'Phòng',
      'Quà tháng',
      'Cửa hàng',
      'Thẻ hỗn loạn',
      'Nhật ký',
    ])
    expect(screen.getByRole('button', { name: viNormal.gm.tabs.overview })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText('41')).toBeInTheDocument()
  })

  it('prints the overview: the counts and the last day of points by reason', async () => {
    setup()

    expect(await screen.findByText('41')).toBeInTheDocument()
    expect(screen.getByText(viNormal.gm.overview.accounts)).toBeInTheDocument()
    expect(screen.getByText(viNormal.ledger.reason.daily_login)).toBeInTheDocument()
    expect(screen.getByText(viNormal.ledger.reason.relief)).toBeInTheDocument()
  })

  it('switches tabs', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    await screen.findByText('41')

    await user.click(screen.getByRole('button', { name: viNormal.gm.tabs.players }))

    expect(screen.getByRole('button', { name: viNormal.gm.tabs.players })).toHaveAttribute('aria-pressed', 'true')
    expect(api.gmSearch).toHaveBeenCalledWith('')
  })

  it('opens the Cửa hàng tab on one read of the shop settings', async () => {
    const user = userEvent.setup()
    const gmShop = vi.fn().mockResolvedValue({
      prices: [],
      featured: [{ weekKey: '2026-W43', itemIds: [], source: 'auto' }],
      welcomeChoices: [],
      welcomeSlots: ['outfit'],
      reputation: { rules: { hand_played: 1 }, ranks: [{ rank: 1, threshold: 0 }] },
    })
    setup(stubApi({ gmShop }))
    await screen.findByText('41')

    await user.click(screen.getByRole('button', { name: viNormal.gm.tabs.shop }))

    expect(await screen.findByText(viNormal.gm.shop.prices.title)).toBeInTheDocument()
    expect(gmShop).toHaveBeenCalledTimes(1)
  })

  it('leaves the console when the server says the role is gone', async () => {
    const gmOverview = vi.fn().mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'not a gm'))
    const { onForbidden } = setup(stubApi({ gmOverview }))

    await waitFor(() => expect(onForbidden).toHaveBeenCalledTimes(1))
    await screen.findByRole('alert')
  })

  it('does not leave for a 403 that is about the target, not the caller', async () => {
    const gmOverview = vi.fn().mockRejectedValue(new ApiError(403, 'SELF_TARGET', ''))
    const { onForbidden } = setup(stubApi({ gmOverview }))

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.gm.overview.error)
    expect(onForbidden).not.toHaveBeenCalled()
  })

  it('does not leave for any other failure', async () => {
    const gmOverview = vi.fn().mockRejectedValue(new ApiError(500, 'INTERNAL', ''))
    const { onForbidden } = setup(stubApi({ gmOverview }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(onForbidden).not.toHaveBeenCalled()
  })

  it('leaves once, even when several calls are refused together', async () => {
    const refuse = vi.fn().mockRejectedValue(new ApiError(403, 'FORBIDDEN', ''))
    const { onForbidden } = setup(stubApi({ gmOverview: refuse }))
    const user = userEvent.setup()

    await waitFor(() => expect(onForbidden).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: viNormal.screens.retry }))
    await waitFor(() => expect(refuse).toHaveBeenCalledTimes(2))
    await screen.findByRole('alert')

    expect(onForbidden).toHaveBeenCalledTimes(1)
  })
})

const BINH = { playerId: 'p1', displayName: 'Bình', emailMasked: 'b***@example.com', role: 'player', locked: false, balance: 5, createdAt: 1, lastLoginAt: null }

/** An api whose search lists one player and whose player page answers; `overrides` replaces any of it. */
function playerApi(overrides: Partial<Record<keyof NormalApi, unknown>> = {}): Stub {
  return stubApi({
    gmSearch: vi.fn().mockResolvedValue({ players: [BINH], nextBefore: null }),
    gmPlayer: vi.fn().mockResolvedValue({
      playerId: 'p1', displayName: 'Bình', email: 'binh@example.com', role: 'player', locked: null, balance: 5, createdAt: 1, lastLoginAt: null,
      stats: {}, room: null, inventoryCount: 0, unlockedAchievementIds: [],
    }),
    gmPlayerLedger: vi.fn().mockResolvedValue({ entries: [], nextBefore: null }),
    gmPlayerHistory: vi.fn().mockResolvedValue([]),
    gmCheckin: vi.fn().mockResolvedValue({ claimedToday: false, day: 0, streak: 0, points: 0, itemIds: [] }),
    catalogAchievements: vi.fn().mockResolvedValue({ achievements: [] }),
    ...overrides,
  })
}

async function openPlayer(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: viNormal.gm.tabs.players }))
  await user.click(await screen.findByRole('button', { name: viNormal.gm.players.open }))
  await screen.findByText('binh@example.com')
}

describe('GmScreen — the player pages', () => {
  it('opens a player from the list and comes back to it', async () => {
    const user = userEvent.setup()
    const api = playerApi()
    setup(api)
    await openPlayer(user)
    expect(api.gmPlayer).toHaveBeenCalledWith('p1')

    await user.click(screen.getByRole('button', { name: viNormal.gm.player.back }))

    expect(await screen.findByText('b***@example.com')).toBeVisible()
  })

  it('keeps the search, its results and its cursor across a visit to a player, and asks the server nothing on Back', async () => {
    const user = userEvent.setup()
    const api = playerApi({
      gmSearch: vi
        .fn()
        .mockResolvedValueOnce({ players: [], nextBefore: null })
        .mockResolvedValueOnce({ players: [BINH], nextBefore: 'p1' }),
    })
    setup(api)
    await user.click(screen.getByRole('button', { name: viNormal.gm.tabs.players }))
    await user.type(await screen.findByRole('searchbox', { name: viNormal.gm.players.search }), 'binh')
    await user.click(screen.getByRole('button', { name: viNormal.gm.players.searchButton }))
    await user.click(await screen.findByRole('button', { name: viNormal.gm.players.open }))
    await screen.findByText('binh@example.com')
    expect(screen.getByText('b***@example.com')).not.toBeVisible()
    expect(api.gmSearch).toHaveBeenCalledTimes(2)

    await user.click(screen.getByRole('button', { name: viNormal.gm.player.back }))

    expect(screen.getByText('b***@example.com')).toBeVisible()
    expect(screen.getByRole('searchbox', { name: viNormal.gm.players.search })).toHaveValue('binh')
    expect(screen.getByRole('button', { name: viNormal.gm.players.more })).toBeVisible()
    expect(api.gmSearch).toHaveBeenCalledTimes(2)
  })

  it('leaves the console when the player list itself is refused', async () => {
    const user = userEvent.setup()
    const gmSearch = vi.fn().mockRejectedValue(new ApiError(403, 'FORBIDDEN', ''))
    const { onForbidden } = setup(playerApi({ gmSearch }))

    await user.click(screen.getByRole('button', { name: viNormal.gm.tabs.players }))

    await waitFor(() => expect(onForbidden).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.gm.players.error)
  })

  it('leaves once, and the dialog says why, when an action on a player is refused for the role', async () => {
    const user = userEvent.setup()
    const gmPoints = vi.fn().mockRejectedValue(new ApiError(403, 'FORBIDDEN', ''))
    const { onForbidden } = setup(playerApi({ gmPoints }))
    await openPlayer(user)

    await user.click(screen.getByRole('button', { name: viNormal.gm.actions.points }))
    const dialog = within(screen.getByRole('dialog'))
    await user.type(dialog.getByLabelText(viNormal.gm.dialog.amount), '-500')
    await user.type(dialog.getByLabelText(viNormal.gm.dialog.reason), 'sửa')
    await user.click(dialog.getByRole('button', { name: viNormal.gm.dialog.confirm }))

    expect(await dialog.findByRole('alert')).toHaveTextContent(viNormal.gm.errors.FORBIDDEN)
    expect(onForbidden).toHaveBeenCalledTimes(1)
  })

  it('leaves when the player page itself is refused', async () => {
    const user = userEvent.setup()
    const gmPlayer = vi.fn().mockRejectedValue(new ApiError(403, 'FORBIDDEN', ''))
    const { onForbidden } = setup(playerApi({ gmPlayer }))
    await user.click(screen.getByRole('button', { name: viNormal.gm.tabs.players }))
    await user.click(await screen.findByRole('button', { name: viNormal.gm.players.open }))

    await waitFor(() => expect(onForbidden).toHaveBeenCalledTimes(1))
    await screen.findByRole('alert')
  })

  it('does not leave for a target refusal raised by an action', async () => {
    const user = userEvent.setup()
    const gmLock = vi.fn().mockRejectedValue(new ApiError(403, 'SELF_TARGET', ''))
    const { onForbidden } = setup(playerApi({ gmLock }))
    await openPlayer(user)

    await user.click(screen.getByRole('button', { name: viNormal.gm.actions.lock }))
    const dialog = within(screen.getByRole('dialog'))
    await user.type(dialog.getByLabelText(viNormal.gm.dialog.reason), 'thử')
    await user.click(dialog.getByRole('button', { name: viNormal.gm.dialog.confirm }))

    expect(await dialog.findByRole('alert')).toHaveTextContent(viNormal.gm.errors.SELF_TARGET)
    expect(onForbidden).not.toHaveBeenCalled()
  })
})
