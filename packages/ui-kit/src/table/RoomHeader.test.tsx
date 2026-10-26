import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import type { RoomView } from '@bp/core'
import { createI18n } from '../i18n/index.js'
import badge from '../primitives/primitives.module.css'
import { RoomHeader } from './RoomHeader.js'
import s from './table.module.css'

const blindRoom = (squeeze?: boolean, chaosCycle?: 5 | 10): RoomView => ({
  roomId: 'r',
  code: 'BBBBBB',
  name: 'Chiếu Bạc',
  mode: 'blind',
  config: {
    name: 'Chiếu Bạc',
    mode: 'blind',
    maxPlayers: 4,
    isPrivate: false,
    turnTimerSec: squeeze === true ? 20 : 15,
    autoStart: true,
    hasPassword: false,
    blind: { holeCards: 2, decisionMode: 'none', fixedWager: 5000, botCount: 1, ...(squeeze === undefined ? {} : { squeeze }), ...(chaosCycle === undefined ? {} : { chaosCycle }) },
  },
  playerCount: 2,
  maxPlayers: 4,
  status: 'OPEN',
  hostPlayerId: 'a',
  players: [],
  carryOverPot: 0,
  nextHandAt: null,
})

const holdemRoom: RoomView = {
  ...blindRoom(),
  mode: 'holdem',
  config: {
    name: 'Đêm Sài Gòn',
    mode: 'holdem',
    maxPlayers: 6,
    isPrivate: false,
    turnTimerSec: 30,
    autoStart: false,
    hasPassword: false,
    holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 },
  },
}

const wrap = (room: RoomView, onLeave = vi.fn()) =>
  render(
    <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
      <RoomHeader room={room} status="open" onLeave={onLeave} lang="vi" />
    </I18nextProvider>,
  )

describe('RoomHeader', () => {
  it('names the room, its mode and its way out', async () => {
    const onLeave = vi.fn()
    wrap(blindRoom(), onLeave)
    expect(screen.getByRole('heading', { level: 1, name: 'Chiếu Bạc' })).toBeInTheDocument()
    expect(screen.getByText('Blind Poker')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Rời phòng' }))
    expect(onLeave).toHaveBeenCalledTimes(1)
  })

  // Plan 21: whoever is at the table sees that it is a squeeze table, not only whoever read the list.
  describe('the squeeze badge', () => {
    it('marks a squeeze table "Nặn bài"', () => {
      wrap(blindRoom(true))
      expect(screen.getByText('Nặn bài')).toBeInTheDocument()
      expect(screen.getByText('Nặn bài')).toHaveClass(badge.badge!, badge.gold!)
    })

    it('puts nothing on a Blind table without the option, or with it false, nor on a Hold’em table', () => {
      for (const room of [blindRoom(), blindRoom(false), holdemRoom]) {
        const { unmount } = wrap(room)
        expect(screen.queryByText('Nặn bài')).toBeNull()
        unmount()
      }
    })
  })

  // Plan 37: a chaos table says so to whoever sits at it, beside "Nặn bài" when it is both.
  describe('the chaos badge', () => {
    it('marks a chaos table "Hỗn loạn" in the chaos tone, and shows it beside "Nặn bài" on a table that is both', () => {
      wrap(blindRoom(true, 5))
      expect(screen.getByText('Hỗn loạn')).toHaveClass(badge.badge!, badge.chaos!)
      expect(screen.getByText('Nặn bài')).toBeInTheDocument()
    })

    it('puts nothing on a Blind table without a chaos cycle, nor on a Hold’em table', () => {
      for (const room of [blindRoom(), blindRoom(true), holdemRoom]) {
        const { unmount } = wrap(room)
        expect(screen.queryByText('Hỗn loạn')).toBeNull()
        unmount()
      }
    })

    it('stays in the header on a phone: on the meta line, so the squeeze badge keeps its cell beside the name', () => {
      const { container } = wrap(blindRoom(true, 10))
      const chaos = within(container.querySelector('header')!).getByText('Hỗn loạn')
      expect(chaos.closest(`.${s.metaFlow}`)).not.toBeNull()
    })

    it('is in the compact strip too', () => {
      render(
        <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
          <RoomHeader room={blindRoom(false, 5)} status="open" onLeave={vi.fn()} lang="vi" compact />
        </I18nextProvider>,
      )
      expect(screen.getByText('Hỗn loạn')).toBeInTheDocument()
    })
  })

  // Plan 26 (B6): on a phone the badge sits beside the name on the header's first line. jsdom draws no grid, so this holds
  // the structure the grid area hangs on: the badge is in the header, outside the meta line that takes the second row.
  it('keeps the squeeze badge inside the header on a phone', () => {
    const { container } = wrap(blindRoom(true))
    const header = container.querySelector('header')!
    const squeeze = within(header).getByText('Nặn bài')
    expect(header.contains(squeeze)).toBe(true)
    expect(header).toHaveClass(s.headerSqueeze!)
    expect(squeeze.closest(`.${s.metaFlow}`), 'not in the meta line, which takes the second row').toBeNull()
    expect(squeeze.parentElement).toHaveClass(s.headMeta!)
    expect(within(header).getByLabelText('Mã phòng'), 'the code stays on the meta line').toHaveClass(s.code!)
    expect(within(header).getByLabelText('Mã phòng').closest(`.${s.metaFlow}`)).not.toBeNull()
    const plain = wrap(blindRoom())
    expect(plain.container.querySelector('header')).not.toHaveClass(s.headerSqueeze!)
  })

  // Plan 26 (B2): a phone on its side gives the header one line — the code, the squeeze badge and the way out stay in
  // it; the head-count and the mode badges go.
  describe('compact', () => {
    const compact = (room: RoomView, onLeave = vi.fn()) =>
      render(
        <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
          <RoomHeader room={room} status="open" onLeave={onLeave} lang="vi" compact menu={<button type="button">menu</button>} />
        </I18nextProvider>,
      )

    it('renders one header with the code label, the squeeze badge, the menu and Rời phòng', async () => {
      const onLeave = vi.fn()
      const { container } = compact(blindRoom(true), onLeave)
      expect(container.querySelectorAll('header')).toHaveLength(1)
      const header = container.querySelector('header')!
      expect(header).toHaveClass(s.header!, s.headerCompact!)
      expect(within(header).getByLabelText('Mã phòng')).toHaveTextContent('BBBBBB')
      expect(within(header).getByText('Nặn bài')).toBeInTheDocument()
      expect(within(header).getByRole('heading', { level: 1, name: 'Chiếu Bạc' })).toBeInTheDocument()
      expect(within(header).getByRole('button', { name: 'menu' })).toBeInTheDocument()
      await userEvent.click(within(header).getByRole('button', { name: 'Rời phòng' }))
      expect(onLeave).toHaveBeenCalledTimes(1)
    })

    it('leaves out the head-count and the mode badges', () => {
      compact(blindRoom(true))
      expect(screen.queryByText('Blind Poker')).toBeNull()
      expect(screen.queryByText('2/4')).toBeNull()
      expect(document.querySelector(`.${s.players!}`)).toBeNull()
    })

    // BP-31 P3: the phone held upright keeps the full two-row header (stakes and limit on the meta line) and takes the
    // same "Thêm" menu as landscape, in the first row's right cell.
    it('the full header draws the menu just before Rời phòng when one is given', () => {
      const { container } = render(
        <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
          <RoomHeader room={blindRoom()} status="open" onLeave={vi.fn()} lang="vi" menu={<button type="button">menu</button>} />
        </I18nextProvider>,
      )
      const header = container.querySelector('header')!
      expect(header).not.toHaveClass(s.headerCompact!)
      expect(within(header).getByText('Mức cược 5.000 · Hạn mức 50.000')).toBeInTheDocument()
      const right = header.querySelector(`.${s.headRight!}`)!
      const buttons = within(right as HTMLElement).getAllByRole('button')
      expect(buttons.map((b) => b.textContent)).toEqual(['menu', 'Rời phòng'])
    })

    it('renders the desktop header exactly as before when not compact', () => {
      const { container } = wrap(blindRoom(true))
      const header = container.querySelector('header')!
      expect(header).not.toHaveClass(s.headerCompact!)
      expect(header.querySelector(`.${s.players!}`)).not.toBeNull()
      expect(screen.getByText('Blind Poker')).toBeInTheDocument()
    })
  })
})
