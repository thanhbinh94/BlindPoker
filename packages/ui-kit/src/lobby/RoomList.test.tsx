import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import type { RoomSummary } from '@bp/core'
import { createI18n } from '../i18n/index.js'
import badge from '../primitives/primitives.module.css'
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
  // Review round 2, R2-1 (final fix wave): a name that wraps used to push the badge and the lock onto a row of their
  // own, and a busy lobby then scrolled at 1920×940. The name is clamped to two lines beside them now, and says the
  // rest in a tooltip — only while it is cut: a static `title` equal to the text was read twice by a screen reader and
  // put a pointless tooltip on every ticket (Plan 20, T4).
  describe('a long room name', () => {
    const LONG = 'Bàn_Đại_Gia_Phố_Núi_Sài_Gòn_01'
    const long: RoomSummary = { ...rooms[0]!, name: LONG, config: { ...rooms[0]!.config, name: LONG } }

    /** jsdom lays nothing out, so the clamp is modelled by the two heights the component reads. */
    const heights = (heading: HTMLElement, scrollHeight: number, clientHeight: number): void => {
      Object.defineProperty(heading, 'scrollHeight', { configurable: true, value: scrollHeight })
      Object.defineProperty(heading, 'clientHeight', { configurable: true, value: clientHeight })
    }

    it('has no title to begin with, so nothing reads the name twice and no ticket carries a pointless tooltip', () => {
      wrap(<RoomList rooms={[long]} onJoin={vi.fn()} lang="vi" />)
      expect(screen.getByRole('heading', { level: 3, name: LONG })).not.toHaveAttribute('title')
    })

    it('puts the whole name in the title while the pointer is over a name the clamp cuts, and takes it away after', async () => {
      wrap(<RoomList rooms={[long]} onJoin={vi.fn()} lang="vi" />)
      const heading = screen.getByRole('heading', { level: 3, name: LONG })
      heights(heading, 62, 47) // three lines of text in a two-line box
      await userEvent.hover(heading)
      expect(heading).toHaveAttribute('title', LONG)
      await userEvent.unhover(heading)
      expect(heading).not.toHaveAttribute('title')
    })

    it('puts nothing on a name that is whole, one pixel of rounding over its box included', async () => {
      wrap(<RoomList rooms={[long]} onJoin={vi.fn()} lang="vi" />)
      const heading = screen.getByRole('heading', { level: 3, name: LONG })
      heights(heading, 47, 47)
      await userEvent.hover(heading)
      expect(heading).not.toHaveAttribute('title')
      await userEvent.unhover(heading)
      heights(heading, 48, 47)
      await userEvent.hover(heading)
      expect(heading).not.toHaveAttribute('title')
    })

    it('keeps the lock and the status badge together in one box beside the name, not in the name’s own flow', () => {
      wrap(<RoomList rooms={[long]} onJoin={vi.fn()} lang="vi" />)
      const heading = screen.getByRole('heading', { level: 3, name: LONG })
      const head = heading.parentElement!
      expect(head.children).toHaveLength(2)
      const status = heading.nextElementSibling!
      expect(status).toContainElement(screen.getByRole('img', { name: /mật khẩu/i }))
      expect(status).toContainElement(screen.getByText('Đang chờ'))
    })
  })

  // Plan 21: a squeeze table is told apart in the list before anyone joins it.
  describe('the squeeze badge', () => {
    const squeezeRoom: RoomSummary = {
      ...rooms[1]!,
      config: { ...rooms[1]!.config, blind: { holeCards: 3, decisionMode: 'none', fixedWager: 5000, botCount: 1, squeeze: true } },
    }

    it('marks a Blind room that is a squeeze table "Nặn bài"', () => {
      wrap(<RoomList rooms={[squeezeRoom]} onJoin={vi.fn()} lang="vi" />)
      expect(screen.getByText('Nặn bài')).toBeInTheDocument()
      expect(screen.getByText('Nặn bài')).toHaveClass(badge.badge!, badge.gold!) // gold: it is the table's money-side mark, not an idle tag
    })

    it('puts nothing on a Blind room without the option, or with it false, nor on a Hold’em room', () => {
      const off: RoomSummary = { ...squeezeRoom, config: { ...squeezeRoom.config, blind: { ...squeezeRoom.config.blind!, squeeze: false } } }
      wrap(<RoomList rooms={[rooms[0]!, rooms[1]!, { ...off, roomId: '4', code: 'DDDDDD' }]} onJoin={vi.fn()} lang="vi" />)
      expect(screen.queryByText('Nặn bài')).toBeNull()
    })
  })

  it('shows an empty state', () => {
    wrap(<RoomList rooms={[]} onJoin={() => {}} lang="vi" />)
    expect(screen.getByText(/chưa có phòng/i)).toBeInTheDocument()
  })
})
