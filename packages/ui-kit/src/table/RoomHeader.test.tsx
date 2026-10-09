import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import type { RoomView } from '@bp/core'
import { createI18n } from '../i18n/index.js'
import { RoomHeader } from './RoomHeader.js'

const blindRoom = (squeeze?: boolean): RoomView => ({
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
    blind: { holeCards: 2, decisionMode: 'none', fixedWager: 5000, botCount: 1, ...(squeeze === undefined ? {} : { squeeze }) },
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
    })

    it('puts nothing on a Blind table without the option, or with it false, nor on a Hold’em table', () => {
      for (const room of [blindRoom(), blindRoom(false), holdemRoom]) {
        const { unmount } = wrap(room)
        expect(screen.queryByText('Nặn bài')).toBeNull()
        unmount()
      }
    })
  })
})
