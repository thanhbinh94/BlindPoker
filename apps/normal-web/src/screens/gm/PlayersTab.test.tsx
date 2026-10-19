import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GmPlayerSummaryDto, NormalApi } from '../../api.js'
import viNormal from '../../locales/vi/normal.json'
import { renderWithI18n } from '../../test-i18n.js'
import { PlayersTab } from './PlayersTab.js'

const BINH: GmPlayerSummaryDto = {
  playerId: 'p1',
  displayName: 'Bình',
  emailMasked: 'b***@example.com',
  role: 'player',
  locked: false,
  balance: 123_000,
  createdAt: Date.UTC(2026, 8, 1),
  lastLoginAt: null,
}
const LAN: GmPlayerSummaryDto = { ...BINH, playerId: 'p2', displayName: 'Lan', emailMasked: 'l***@example.com', locked: true, role: 'gm' }

function setup(gmSearch = vi.fn().mockResolvedValue({ players: [BINH, LAN], nextBefore: null })) {
  const api = { gmSearch } as unknown as NormalApi
  const onOpen = vi.fn()
  const guard = (cause: unknown): never => {
    throw cause
  }
  const result = renderWithI18n(<PlayersTab api={api} lang="vi" guard={guard} onOpen={onOpen} />)
  return { ...result, gmSearch, onOpen }
}

describe('PlayersTab', () => {
  it('lists the first page on arrival, with the address masked and the locked ones marked', async () => {
    setup()

    const row = (await screen.findByText('b***@example.com')).closest('tr')!
    expect(within(row).getByText('Bình')).toBeInTheDocument()
    expect(within(row).queryByText(viNormal.gm.players.lockedBadge)).toBeNull()
    const lanRow = screen.getByText('l***@example.com').closest('tr')!
    expect(within(lanRow).getByText(viNormal.gm.players.lockedBadge)).toBeInTheDocument()
    expect(screen.queryByText('binh@example.com')).toBeNull()
  })

  it('searches only when asked: typing alone costs nothing, Tìm sends the query as typed', async () => {
    const user = userEvent.setup()
    const { gmSearch } = setup()
    await screen.findByText('b***@example.com')
    gmSearch.mockClear()

    await user.type(screen.getByRole('searchbox', { name: viNormal.gm.players.search }), 'binh')
    expect(gmSearch).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: viNormal.gm.players.searchButton }))

    expect(gmSearch).toHaveBeenCalledTimes(1)
    expect(gmSearch).toHaveBeenCalledWith('binh')
  })

  it('searches on Enter too', async () => {
    const user = userEvent.setup()
    const { gmSearch } = setup()
    await screen.findByText('b***@example.com')
    gmSearch.mockClear()

    await user.type(screen.getByRole('searchbox', { name: viNormal.gm.players.search }), 'lan{Enter}')

    expect(gmSearch).toHaveBeenCalledWith('lan')
  })

  it('opens a player by id', async () => {
    const user = userEvent.setup()
    const { onOpen } = setup()
    const row = (await screen.findByText('l***@example.com')).closest('tr')!

    await user.click(within(row).getByRole('button', { name: viNormal.gm.players.open }))

    expect(onOpen).toHaveBeenCalledWith('p2')
  })

  it('pages on the cursor of the last search and appends', async () => {
    const user = userEvent.setup()
    const gmSearch = vi
      .fn()
      .mockResolvedValueOnce({ players: [BINH], nextBefore: 'p1' })
      .mockResolvedValueOnce({ players: [BINH], nextBefore: 'p1' })
      .mockResolvedValueOnce({ players: [LAN], nextBefore: null })
    setup(gmSearch)
    await screen.findByText('b***@example.com')

    await user.type(screen.getByRole('searchbox', { name: viNormal.gm.players.search }), 'e')
    await user.click(screen.getByRole('button', { name: viNormal.gm.players.searchButton }))
    await screen.findByText('b***@example.com')
    await user.click(screen.getByRole('button', { name: viNormal.gm.players.more }))

    expect(await screen.findByText('l***@example.com')).toBeInTheDocument()
    expect(gmSearch).toHaveBeenLastCalledWith('e', { before: 'p1' })
    expect(screen.getByText('b***@example.com')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: viNormal.gm.players.more })).toBeNull()
  })

  it('says so when nothing matches', async () => {
    setup(vi.fn().mockResolvedValue({ players: [], nextBefore: null }))

    expect(await screen.findByText(viNormal.gm.players.empty)).toBeInTheDocument()
  })

  it('says so when the search fails, and tries again on the same button', async () => {
    const user = userEvent.setup()
    const gmSearch = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ players: [BINH], nextBefore: null })
    setup(gmSearch)

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.gm.players.error)
    await user.click(screen.getByRole('button', { name: viNormal.gm.players.searchButton }))

    expect(await screen.findByText('b***@example.com')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
