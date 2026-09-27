import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import type { RoomSummary } from '@bp/core'
import { createI18n } from '../i18n/index.js'
import { RoomList } from './RoomList.js'

const rooms: RoomSummary[] = [
  {
    roomId: '1',
    code: 'AAAAAA',
    name: 'Hold',
    mode: 'holdem',
    config: {
      name: 'Hold',
      mode: 'holdem',
      maxPlayers: 6,
      isPrivate: false,
      turnTimerSec: 30,
      autoStart: false,
      hasPassword: true,
      holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 },
    },
    playerCount: 2,
    maxPlayers: 6,
    status: 'OPEN',
  },
  {
    roomId: '2',
    code: 'BBBBBB',
    name: 'Blind',
    mode: 'blind',
    config: {
      name: 'Blind',
      mode: 'blind',
      maxPlayers: 4,
      isPrivate: false,
      turnTimerSec: 15,
      autoStart: true,
      hasPassword: false,
      blind: { holeCards: 3, decisionMode: 'none', fixedWager: 5000, botCount: 1 },
    },
    playerCount: 4,
    maxPlayers: 4,
    status: 'IN_GAME',
  },
]
const wrap = (ui: React.ReactElement) =>
  render(<I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>{ui}</I18nextProvider>)

describe('RoomList', () => {
  it('labels an empty room counting down to closing "Đang đóng…" instead of "Đang chờ" (bug 2)', () => {
    const closing: RoomSummary = { ...rooms[0]!, playerCount: 0, closing: true }
    wrap(<RoomList rooms={[closing]} onJoin={vi.fn()} lang="vi" />)
    expect(screen.getByText('Đang đóng…')).toBeInTheDocument()
    expect(screen.queryByText('Đang chờ')).toBeNull()
  })

  it('labels an open room without the flag, or with it false, "Đang chờ"', () => {
    wrap(<RoomList rooms={[rooms[0]!, { ...rooms[0]!, roomId: '3', code: 'CCCCCC', closing: false }]} onJoin={vi.fn()} lang="vi" />)
    expect(screen.getAllByText('Đang chờ')).toHaveLength(2)
  })

  it('renders tickets with stakes and occupancy and joins on click', async () => {
    const onJoin = vi.fn()
    wrap(<RoomList rooms={rooms} onJoin={onJoin} lang="vi" />)
    expect(screen.getByText('Hold')).toBeInTheDocument()
    expect(screen.getByText('2/6')).toBeInTheDocument()
    expect(screen.getByText('4/4')).toBeInTheDocument()
    expect(screen.getByText(/5\.000/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /mật khẩu/i })).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: /vào/i })[0]!)
    expect(onJoin).toHaveBeenCalledWith(rooms[0])
  })
  it('shows an empty state', () => {
    wrap(<RoomList rooms={[]} onJoin={() => {}} lang="vi" />)
    expect(screen.getByText(/chưa có phòng/i)).toBeInTheDocument()
  })
})
