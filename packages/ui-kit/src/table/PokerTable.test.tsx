import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import type { RoomView } from '@bp/core'
import { parseCards } from '@bp/core'
import { createI18n } from '../i18n/index.js'
import type { ClientHand } from '../client/types.js'
import { PokerTable } from './PokerTable.js'

const room: RoomView = {
  roomId: 'r',
  code: 'ABC234',
  name: 'T',
  mode: 'holdem',
  config: {
    name: 'T',
    mode: 'holdem',
    maxPlayers: 4,
    isPrivate: false,
    turnTimerSec: 30,
    autoStart: false,
    hasPassword: false,
    holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 },
  },
  playerCount: 2,
  maxPlayers: 4,
  status: 'IN_GAME',
  hostPlayerId: 'a',
  carryOverPot: 0,
  nextHandAt: null,
  players: [
    { playerId: 'a', displayName: 'Ann', isBot: false, isHost: true, connected: true, seat: 0, status: 'IN_HAND', stack: 19800, ready: true },
    { playerId: 'b', displayName: 'Bob', isBot: false, isHost: false, connected: false, seat: 2, status: 'DISCONNECTED', stack: 19900, ready: true },
  ],
}
const hand: ClientHand = {
  handId: 'h',
  mode: 'holdem',
  phase: 'BETTING',
  community: parseCards('Ah Kd 2c'),
  pot: 300,
  carryOverIn: 0,
  button: 0,
  actingSeat: 2,
  mySeat: 0,
  legal: null,
  result: null,
  potPulse: 1,
  seats: [
    {
      seat: 0,
      playerId: 'a',
      displayName: 'Ann',
      isBot: false,
      stack: 19800,
      betThisStreet: 0,
      folded: false,
      allIn: false,
      cardCount: 2,
      holeCards: parseCards('Qs Qd'),
      hasDecided: false,
      decision: null,
      lastAction: null,
      timedOut: false,
    },
    {
      seat: 2,
      playerId: 'b',
      displayName: 'Bob',
      isBot: false,
      stack: 19900,
      betThisStreet: 0,
      folded: false,
      allIn: false,
      cardCount: 2,
      holeCards: null,
      hasDecided: false,
      decision: null,
      lastAction: null,
      timedOut: false,
    },
  ],
}
const wrap = (ui: React.ReactElement) =>
  render(<I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>{ui}</I18nextProvider>)

describe('PokerTable', () => {
  it('renders seats, my cards face up, opponents face down, community, pot, empty seats to sit on', async () => {
    const onSeatClick = vi.fn()
    wrap(
      <PokerTable
        room={room}
        hand={hand}
        myPlayerId="a"
        deadlineAt={null}
        serverNow={() => 0}
        turnTimerMs={30000}
        lang="en"
        layout="ring"
        canSit={false}
        onSeatClick={onSeatClick}
      />,
    )
    expect(screen.getByText('Ann')).toBeInTheDocument()
    expect(screen.getByLabelText('Queen of spades')).toBeInTheDocument()
    expect(screen.getAllByLabelText('Face-down card')).toHaveLength(2)
    expect(screen.getByLabelText('Ace of hearts')).toBeInTheDocument()
    expect(screen.getByText('300')).toBeInTheDocument()
    expect(screen.getByText(/disconnected/i)).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /sit down/i })).toHaveLength(0) // canSit false
  })
  it('offers empty seats when the viewer may sit', async () => {
    const onSeatClick = vi.fn()
    wrap(
      <PokerTable
        room={room}
        hand={null}
        myPlayerId="zed"
        deadlineAt={null}
        serverNow={() => 0}
        turnTimerMs={30000}
        lang="en"
        layout="stack"
        canSit
        onSeatClick={onSeatClick}
      />,
    )
    const sits = screen.getAllByRole('button', { name: /sit down/i })
    expect(sits).toHaveLength(2) // seats 1 and 3 are free
    await userEvent.click(sits[0]!)
    expect(onSeatClick).toHaveBeenCalledWith(1)
  })
})
