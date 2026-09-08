import type { RoomPlayerView } from '@bp/core'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '../i18n/index.js'
import { holdemHand as hand, holdemRoom as room, makePlayer, makeRoom } from '../test-fixtures.js'
import { PokerTable } from './PokerTable.js'
import s from './table.module.css'

const NAMES = ['Ann', 'Bảo', 'Cúc', 'Dũng', 'Em', 'Phúc', 'Giang', 'Hà', 'Yến']

/** A full nine-handed table: the viewer in seat 0 and eight opponents around them. */
const fullRoom = makeRoom({
  maxPlayers: 9,
  playerCount: 9,
  hostPlayerId: 'p0',
  players: NAMES.map((displayName, seat) =>
    makePlayer({ playerId: `p${seat}`, displayName, seat, status: 'SEATED', stack: 20_000, isHost: seat === 0 }),
  ),
})

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
  it('stack layout shows every opponent at a nine-handed table, in a strip that holds two rows open', () => {
    wrap(
      <PokerTable
        room={fullRoom}
        hand={null}
        myPlayerId="p0"
        deadlineAt={null}
        serverNow={() => 0}
        turnTimerMs={30000}
        lang="en"
        layout="stack"
        canSit={false}
      />,
    )
    const strip = screen.getByRole('group', { name: 'Players' })
    for (const name of NAMES.slice(1)) expect(within(strip).getByText(name)).toBeInTheDocument()
    expect(within(strip).getAllByRole('group')).toHaveLength(8)
    expect(strip.className).toContain(s.othersTwoRow)
    expect(strip.className).toContain(s.othersChip)
    // The viewer's own seat is pinned below the felt, never in the opponents' strip.
    expect(within(strip).queryByText('Ann')).toBeNull()
    expect(screen.getByText('Ann')).toBeInTheDocument()
  })

  it('hangs the app caption under each seated player, and asks about that player alone', () => {
    const captionFor = vi.fn((p: RoomPlayerView) => (p.playerId === 'a' ? 'Tay nóng' : null))
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
        captionFor={captionFor}
      />,
    )

    const ann = screen.getByText('Ann').parentElement
    expect(ann).not.toBeNull()
    expect(within(ann!).getByText('Tay nóng')).toBeInTheDocument()
    // The name is still the plate's first line; the caption sits under it.
    expect(within(ann!).getByText('Ann').nextElementSibling).toHaveTextContent('Tay nóng')

    // Only seated players are asked about, and a `null` answer leaves that plate alone.
    expect(captionFor.mock.calls.map(([p]) => p.playerId)).toEqual(['a', 'b'])
    const bob = screen.getByText('Bob').parentElement
    expect(within(bob!).queryByText('Tay nóng')).toBeNull()
  })

  it('draws no caption line at all when the app supplies no slot', () => {
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
      />,
    )
    expect(document.querySelectorAll(`.${s.seatCaption}`)).toHaveLength(0)
  })

  it("keeps a bot's virtual bankroll off its plate: the Bot badge says what it is, and the figure would only mislead", () => {
    const withBot = makeRoom({
      players: [
        makePlayer({ playerId: 'a', displayName: 'Ann', isHost: true, seat: 0, status: 'SEATED', stack: 20_000 }),
        makePlayer({ playerId: 'bot-1', displayName: 'Bot 1', isBot: true, seat: 1, status: 'SEATED', stack: 1_000_000 }),
      ],
    })
    wrap(
      <PokerTable
        room={withBot}
        hand={null}
        myPlayerId="a"
        deadlineAt={null}
        serverNow={() => 0}
        turnTimerMs={30000}
        lang="en"
        layout="ring"
        canSit={false}
      />,
    )
    const bot = screen.getByRole('group', { name: 'Seat 2' })
    expect(within(bot).getByText('Bot')).toBeInTheDocument()
    // The frame holds a 2D face for the bot, whatever the app's avatar slot would say.
    expect(bot.querySelector(`.${s.avatar}`)).toHaveAttribute('data-face', 'bot')
    expect(bot.querySelector('svg[data-bot-face]')).not.toBeNull()
    expect(screen.getByRole('group', { name: 'Seat 1' }).querySelector(`.${s.avatar}`)).toHaveAttribute('data-face', 'initial')
    expect(within(bot).queryByText('1,000,000')).toBeNull()
    expect(bot.querySelector(`.${s.seatStack}`)).toBeNull()
    // A human's stack is still the plate's job.
    expect(within(screen.getByRole('group', { name: 'Seat 1' })).getByText('20,000')).toBeInTheDocument()
  })
})
