import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import type { LegalActions, RoomView } from '@bp/core'
import { createI18n } from '../i18n/index.js'
import type { ClientHand } from '../client/types.js'
import { ActionBar } from './ActionBar.js'

const room = { config: { mode: 'holdem', blind: undefined } } as unknown as RoomView
const hand = (legal: LegalActions | null, extra: Partial<ClientHand> = {}): ClientHand => ({
  handId: 'h',
  mode: 'holdem',
  phase: 'BETTING',
  community: [],
  pot: 1000,
  carryOverIn: 0,
  button: 0,
  actingSeat: 1,
  seats: [],
  mySeat: 1,
  legal,
  result: null,
  potPulse: 0,
  ...extra,
})
const wrap = (ui: React.ReactElement) =>
  render(<I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>{ui}</I18nextProvider>)

describe('ActionBar', () => {
  it('renders nothing without legal actions', () => {
    const { container } = wrap(<ActionBar hand={hand(null)} room={room} onAct={() => {}} lang="en" />)
    expect(container).toBeEmptyDOMElement()
  })
  it('offers only legal kinds and emits fold/check/call', async () => {
    const onAct = vi.fn()
    wrap(
      <ActionBar
        hand={hand({ seat: 1, kinds: ['fold', 'call', 'allIn'], callAmount: 300, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 })}
        room={room}
        onAct={onAct}
        lang="en"
      />,
    )
    expect(screen.queryByRole('button', { name: /check/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /raise|bet/i })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /call/i }))
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'call' })
    expect(screen.getByRole('button', { name: /call/i })).toHaveTextContent('300')
    await userEvent.click(screen.getByRole('button', { name: /all.?in/i }))
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'allIn' })
    await userEvent.click(screen.getByRole('button', { name: /fold/i }))
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'fold' })
  })
  it('clamps raise amounts to the legal range and supports presets', async () => {
    const onAct = vi.fn()
    wrap(
      <ActionBar
        hand={hand({ seat: 1, kinds: ['fold', 'call', 'raise', 'allIn'], callAmount: 200, minBet: 0, maxBet: 0, minRaiseTo: 400, maxRaiseTo: 5000 })}
        room={room}
        onAct={onAct}
        lang="en"
      />,
    )
    const amount = screen.getByRole('spinbutton')
    expect(amount).toHaveValue(400)
    await userEvent.clear(amount)
    await userEvent.type(amount, '99999')
    await userEvent.click(screen.getByRole('button', { name: /^raise/i }))
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'raise', amount: 5000 })
    await userEvent.click(screen.getByRole('button', { name: /pot/i }))
    expect(amount).toHaveValue(1000)
    await userEvent.click(screen.getByRole('button', { name: /max/i }))
    expect(amount).toHaveValue(5000)
  })
  it('blind decision shows play with the wager and fold', async () => {
    const onAct = vi.fn()
    const blindRoom = { config: { mode: 'blind', blind: { fixedWager: 2000 } } } as unknown as RoomView
    wrap(
      <ActionBar
        hand={hand(
          { seat: 1, kinds: ['play', 'fold'], callAmount: 2000, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 },
          { mode: 'blind', phase: 'DECISION' },
        )}
        room={blindRoom}
        onAct={onAct}
        lang="en"
      />,
    )
    const play = screen.getByRole('button', { name: /play/i })
    expect(play).toHaveTextContent('2,000')
    await userEvent.click(play)
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'play' })
  })
})
