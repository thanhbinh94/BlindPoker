import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GmActionDto, NormalApi } from '../../api.js'
import viNormal from '../../locales/vi/normal.json'
import { renderWithI18n } from '../../test-i18n.js'
import { ActionsTab } from './ActionsTab.js'

const GRANT: GmActionDto = {
  id: 9,
  at: Date.UTC(2026, 9, 17, 3, 0),
  actor: { userId: 'u1', displayName: 'Quản' },
  action: 'grant_points',
  target: { playerId: 'p1', displayName: 'Bình' },
  roomId: null,
  amount: 12_000,
  itemId: null,
  reason: 'thưởng sự kiện',
  details: null,
}
const CLOSE: GmActionDto = {
  ...GRANT,
  id: 8,
  actor: null,
  action: 'close_room',
  target: null,
  roomId: 'r1',
  amount: null,
  reason: 'bàn treo',
}
const DEDUCT: GmActionDto = { ...GRANT, id: 7, action: 'adjust_points', amount: -500, reason: 'sai điểm' }

function setup(gmActions = vi.fn().mockResolvedValue({ actions: [GRANT, CLOSE], nextBefore: null })) {
  const api = { gmActions } as unknown as NormalApi
  const guard = (cause: unknown): never => {
    throw cause
  }
  renderWithI18n(<ActionsTab api={api} lang="vi" guard={guard} />)
  return { gmActions }
}

describe('ActionsTab', () => {
  it('lists the log: the kind in words, the actor or the server, the signed amount and the reason', async () => {
    setup()

    const grant = (await screen.findByText('thưởng sự kiện')).closest('tr')!
    expect(within(grant).getByText(viNormal.gm.log.kind.grant_points)).toBeInTheDocument()
    expect(within(grant).getByText('Quản')).toBeInTheDocument()
    expect(within(grant).getByText('Bình')).toBeInTheDocument()
    expect(within(grant).getByText('+12.000')).toBeInTheDocument()

    const close = screen.getByText('bàn treo').closest('tr')!
    expect(within(close).getByText(viNormal.gm.log.cli)).toBeInTheDocument()
    expect(within(close).getByText(viNormal.gm.log.kind.close_room)).toBeInTheDocument()
  })

  it('prints a deduction with its minus', async () => {
    setup(vi.fn().mockResolvedValue({ actions: [DEDUCT], nextBefore: null }))

    const row = (await screen.findByText('sai điểm')).closest('tr')!
    expect(within(row).getByText('-500')).toBeInTheDocument()
  })

  it('filters by player id on Enter, and by room id too', async () => {
    const user = userEvent.setup()
    const { gmActions } = setup()
    await screen.findByText('thưởng sự kiện')
    gmActions.mockClear()

    await user.type(screen.getByRole('textbox', { name: viNormal.gm.log.filterPlayer }), 'p1{Enter}')
    expect(gmActions).toHaveBeenLastCalledWith({ player: 'p1' })

    await user.type(screen.getByRole('textbox', { name: viNormal.gm.log.filterRoom }), 'r1')
    await user.click(screen.getByRole('button', { name: viNormal.gm.log.filter }))
    expect(gmActions).toHaveBeenLastCalledWith({ player: 'p1', room: 'r1' })
  })

  it('pages on the cursor of the last filter and appends', async () => {
    const user = userEvent.setup()
    const gmActions = vi
      .fn()
      .mockResolvedValueOnce({ actions: [GRANT], nextBefore: 9 })
      .mockResolvedValueOnce({ actions: [DEDUCT], nextBefore: null })
    setup(gmActions)
    await screen.findByText('thưởng sự kiện')

    await user.click(screen.getByRole('button', { name: viNormal.gm.log.more }))

    expect(await screen.findByText('sai điểm')).toBeInTheDocument()
    expect(gmActions).toHaveBeenLastCalledWith({ before: 9 })
    expect(screen.getByText('thưởng sự kiện')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: viNormal.gm.log.more })).toBeNull()
  })

  it('says so when the log is empty, and when it cannot be loaded', async () => {
    const gmActions = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ actions: [], nextBefore: null })
    const user = userEvent.setup()
    setup(gmActions)

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.gm.log.error)
    await user.click(screen.getByRole('button', { name: viNormal.gm.log.filter }))

    expect(await screen.findByText(viNormal.gm.log.empty)).toBeInTheDocument()
  })
})
