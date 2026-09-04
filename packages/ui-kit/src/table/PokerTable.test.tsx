import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '../i18n/index.js'
import { holdemHand as hand, holdemRoom as room } from '../test-fixtures.js'
import { PokerTable } from './PokerTable.js'

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
