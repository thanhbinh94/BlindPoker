import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, type GmRoomDto, type NormalApi } from '../../api.js'
import viNormal from '../../locales/vi/normal.json'
import { resetAvatarCache } from '../../avatar/useAvatars.js'
import { renderWithI18n } from '../../test-i18n.js'
import { RoomsTab } from './RoomsTab.js'

const OPEN: GmRoomDto = {
  roomId: 'r1',
  code: 'ABC123',
  name: 'Bàn một',
  mode: 'holdem',
  status: 'OPEN',
  isPrivate: false,
  hasPassword: false,
  players: 1,
  maxPlayers: 6,
  hostPlayerId: 'p1',
  hostDisplayName: 'Bình',
  carryOverPot: 0,
  handInProgress: false,
  createdAt: Date.UTC(2026, 9, 1),
  members: [{ playerId: 'p1', displayName: 'Bình', isBot: false, seat: 0, stack: 1_000, connected: true }],
}
const SECRET: GmRoomDto = {
  ...OPEN,
  roomId: 'r2',
  code: 'XYZ789',
  name: 'Bàn kín',
  mode: 'blind',
  status: 'IN_GAME',
  isPrivate: true,
  hasPassword: true,
  players: 2,
  hostPlayerId: 'p2',
  hostDisplayName: 'Lan',
  carryOverPot: 12_000,
  handInProgress: true,
  members: [
    { playerId: 'p2', displayName: 'Lan', isBot: false, seat: 0, stack: 2_000, connected: true },
    { playerId: 'b1', displayName: 'Máy 1', isBot: true, seat: 1, stack: 2_000, connected: true },
  ],
}

function setup(overrides: Partial<Record<'gmRooms' | 'gmKick' | 'gmCloseRoom' | 'playerAvatar', unknown>> = {}) {
  const gmRooms = vi.fn().mockResolvedValue({ rooms: [OPEN, SECRET] })
  const gmKick = vi.fn().mockResolvedValue({ effective: 'now' })
  const gmCloseRoom = vi.fn().mockResolvedValue({ closed: true, refunded: 2 })
  const api = { gmRooms, gmKick, gmCloseRoom, ...overrides } as unknown as NormalApi
  const guard = (cause: unknown): never => {
    throw cause
  }
  renderWithI18n(<RoomsTab api={api} lang="vi" guard={guard} />)
  return { gmRooms, gmKick, gmCloseRoom }
}

const rowOf = (text: string): HTMLElement => screen.getByText(text).closest('tr')!

describe('RoomsTab', () => {
  it('lists every room, marking the private one and the one mid-hand, with the carried pot', async () => {
    setup()

    await screen.findByText('Bàn một')
    const open = rowOf('Bàn một')
    expect(within(open).queryByText(viNormal.gm.rooms.private)).toBeNull()
    expect(within(open).queryByText(viNormal.gm.rooms.inHand)).toBeNull()
    expect(within(open).getByText('ABC123')).toBeInTheDocument()
    expect(within(open).getByText('1/6')).toBeInTheDocument()

    const secret = rowOf('Bàn kín')
    expect(within(secret).getByText(viNormal.gm.rooms.private)).toBeInTheDocument()
    expect(within(secret).getByText(viNormal.gm.rooms.inHand)).toBeInTheDocument()
    expect(within(secret).getByText(/12\.000/)).toHaveTextContent(viNormal.gm.rooms.carry)
    expect(within(secret).getByText(viNormal.gm.rooms.modes.blind)).toBeInTheDocument()
    expect(within(secret).getByText('Lan')).toBeInTheDocument()
  })

  it('opens a room to its members: a bot is labelled and cannot be removed, a person can', async () => {
    const user = userEvent.setup()
    setup()
    const secret = (await screen.findByText('Bàn kín')).closest('tr')!
    expect(screen.queryByText('Máy 1')).toBeNull()

    await user.click(within(secret).getByRole('button', { name: viNormal.gm.rooms.members }))

    const bot = screen.getByText('Máy 1').closest('tr')!
    expect(within(bot).getByText(viNormal.gm.rooms.bot)).toBeInTheDocument()
    expect(within(bot).queryByRole('button', { name: viNormal.gm.actions.kick })).toBeNull()
    const person = screen.getAllByText('Lan').map((el) => el.closest('tr')!).find((tr) => within(tr).queryByRole('button', { name: viNormal.gm.actions.kick }) !== null)
    expect(person).toBeDefined()
  })

  it('shows each person’s rank as a numeral after their name, and asks about no bot', async () => {
    resetAvatarCache()
    const user = userEvent.setup()
    const playerAvatar = vi.fn((id: string) => Promise.resolve({ playerId: id, displayName: id, avatar: { v: 4, gender: 'f' }, rank: 4 }))
    setup({ playerAvatar })
    const secret = (await screen.findByText('Bàn kín')).closest('tr')!
    await user.click(within(secret).getByRole('button', { name: viNormal.gm.rooms.members }))

    expect(await screen.findByRole('img', { name: 'Bậc thầy' })).toHaveTextContent('IV')
    expect(playerAvatar.mock.calls.map(([id]) => id)).toEqual(['p2'])
    resetAvatarCache()
  })

  it('closes a room only with a reason, then reloads the list and says who got refunded', async () => {
    const user = userEvent.setup()
    const { gmRooms, gmCloseRoom } = setup()
    const secret = (await screen.findByText('Bàn kín')).closest('tr')!
    gmRooms.mockClear()

    await user.click(within(secret).getByRole('button', { name: viNormal.gm.actions.close }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(viNormal.gm.dialog.closeBody)).toBeInTheDocument()
    const confirm = within(dialog).getByRole('button', { name: viNormal.gm.dialog.confirm })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByLabelText(viNormal.gm.dialog.reason), 'bàn bị treo')
    await user.click(confirm)

    expect(gmCloseRoom).toHaveBeenCalledWith('r2', 'bàn bị treo')
    expect(await screen.findByRole('status')).toHaveTextContent('Đã đóng phòng, hoàn cho 2 người')
    expect(gmRooms).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('removes a player with a reason and says whether it took effect now or after the hand', async () => {
    const user = userEvent.setup()
    const gmKick = vi.fn().mockResolvedValue({ effective: 'after_hand' })
    const { gmRooms } = setup({ gmKick })
    const secret = (await screen.findByText('Bàn kín')).closest('tr')!
    await user.click(within(secret).getByRole('button', { name: viNormal.gm.rooms.members }))
    const members = screen.getAllByRole('button', { name: viNormal.gm.actions.kick })
    expect(members).toHaveLength(1)
    gmRooms.mockClear()

    await user.click(members[0]!)
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(viNormal.gm.dialog.reason), 'làm phiền')
    await user.click(within(dialog).getByRole('button', { name: viNormal.gm.dialog.confirm }))

    expect(gmKick).toHaveBeenCalledWith('r2', 'p2', 'làm phiền')
    expect(await screen.findByRole('status')).toHaveTextContent('Đã mời ra (sau ván này)')
    expect(gmRooms).toHaveBeenCalledTimes(1)
  })

  it('prints a refusal in the dialog and keeps it open', async () => {
    const user = userEvent.setup()
    const gmCloseRoom = vi.fn().mockRejectedValue(new ApiError(404, 'ROOM_NOT_FOUND', 'x'))
    setup({ gmCloseRoom })
    const secret = (await screen.findByText('Bàn kín')).closest('tr')!

    await user.click(within(secret).getByRole('button', { name: viNormal.gm.actions.close }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(viNormal.gm.dialog.reason), 'bàn bị treo')
    await user.click(within(dialog).getByRole('button', { name: viNormal.gm.dialog.confirm }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(viNormal.gm.errors.ROOM_NOT_FOUND)
  })

  it('reloads the list after a refusal that says the room is gone, so its row goes too', async () => {
    const user = userEvent.setup()
    const gmCloseRoom = vi.fn().mockRejectedValue(new ApiError(404, 'ROOM_NOT_FOUND', 'x'))
    const { gmRooms } = setup({ gmCloseRoom })
    const secret = (await screen.findByText('Bàn kín')).closest('tr')!
    gmRooms.mockResolvedValue({ rooms: [OPEN] })

    await user.click(within(secret).getByRole('button', { name: viNormal.gm.actions.close }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(viNormal.gm.dialog.reason), 'bàn bị treo')
    await user.click(within(dialog).getByRole('button', { name: viNormal.gm.dialog.confirm }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(viNormal.gm.errors.ROOM_NOT_FOUND)
    await waitFor(() => expect(screen.queryByText('Bàn kín')).toBeNull())
    expect(screen.getByText('Bàn một')).toBeInTheDocument()
  })

  it('drops the last success line when the list is refreshed', async () => {
    const user = userEvent.setup()
    setup()
    const secret = (await screen.findByText('Bàn kín')).closest('tr')!
    await user.click(within(secret).getByRole('button', { name: viNormal.gm.actions.close }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(viNormal.gm.dialog.reason), 'bàn bị treo')
    await user.click(within(dialog).getByRole('button', { name: viNormal.gm.dialog.confirm }))
    expect(await screen.findByRole('status')).toHaveTextContent('Đã đóng phòng')

    await user.click(screen.getByRole('button', { name: viNormal.gm.rooms.refresh }))

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('does not show an old success next to a new failure', async () => {
    const user = userEvent.setup()
    const gmKick = vi.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'x'))
    setup({ gmKick })
    const secret = (await screen.findByText('Bàn kín')).closest('tr')!
    await user.click(within(secret).getByRole('button', { name: viNormal.gm.actions.close }))
    let dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(viNormal.gm.dialog.reason), 'bàn bị treo')
    await user.click(within(dialog).getByRole('button', { name: viNormal.gm.dialog.confirm }))
    expect(await screen.findByRole('status')).toHaveTextContent('Đã đóng phòng')

    const again = (await screen.findByText('Bàn kín')).closest('tr')!
    await user.click(within(again).getByRole('button', { name: viNormal.gm.rooms.members }))
    await user.click(screen.getAllByRole('button', { name: viNormal.gm.actions.kick })[0]!)
    dialog = await screen.findByRole('dialog')

    expect(screen.queryByRole('status')).toBeNull()
    await user.type(within(dialog).getByLabelText(viNormal.gm.dialog.reason), 'làm phiền')
    await user.click(within(dialog).getByRole('button', { name: viNormal.gm.dialog.confirm }))
    await within(dialog).findByRole('alert')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says so when there are no rooms, and when the list cannot be loaded', async () => {
    setup({ gmRooms: vi.fn().mockResolvedValue({ rooms: [] }) })
    expect(await screen.findByText(viNormal.gm.rooms.empty)).toBeInTheDocument()
  })

  it('offers a retry when the list fails', async () => {
    const user = userEvent.setup()
    const gmRooms = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ rooms: [OPEN] })
    setup({ gmRooms })

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.gm.rooms.error)
    await user.click(screen.getByRole('button', { name: viNormal.screens.retry }))

    expect(await screen.findByText('Bàn một')).toBeInTheDocument()
  })
})
