import { screen, waitFor } from '@testing-library/react'
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
}

type Stub = NormalApi & Record<string, ReturnType<typeof vi.fn>>

function stubApi(overrides: Partial<Record<keyof NormalApi, unknown>> = {}): Stub {
  return {
    gmOverview: vi.fn().mockResolvedValue(OVERVIEW),
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
  it('has the four tabs, on the overview first', async () => {
    setup()

    expect(screen.getByRole('heading', { name: viNormal.gm.title, level: 1 })).toBeInTheDocument()
    for (const name of Object.values(viNormal.gm.tabs)) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
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

  it('opens a player from the list and comes back to it', async () => {
    const user = userEvent.setup()
    const gmSearch = vi.fn().mockResolvedValue({
      players: [{ playerId: 'p1', displayName: 'Bình', emailMasked: 'b***@example.com', role: 'player', locked: false, balance: 5, createdAt: 1, lastLoginAt: null }],
      nextBefore: null,
    })
    const gmPlayer = vi.fn().mockResolvedValue({
      playerId: 'p1', displayName: 'Bình', email: 'binh@example.com', role: 'player', locked: null, balance: 5, createdAt: 1, lastLoginAt: null,
      stats: {}, room: null, inventoryCount: 0,
    })
    setup(
      stubApi({
        gmSearch,
        gmPlayer,
        gmPlayerLedger: vi.fn().mockResolvedValue({ entries: [], nextBefore: null }),
        gmPlayerHistory: vi.fn().mockResolvedValue([]),
      }),
    )
    await user.click(screen.getByRole('button', { name: viNormal.gm.tabs.players }))
    await user.click(await screen.findByRole('button', { name: viNormal.gm.players.open }))

    expect(await screen.findByText('binh@example.com')).toBeInTheDocument()
    expect(gmPlayer).toHaveBeenCalledWith('p1')
    await user.click(screen.getByRole('button', { name: viNormal.gm.player.back }))

    expect(await screen.findByText('b***@example.com')).toBeInTheDocument()
  })
})
