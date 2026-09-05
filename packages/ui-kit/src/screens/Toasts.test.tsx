import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientError } from '../client/types.js'
import { createI18n } from '../i18n/index.js'
import { Toasts } from './Toasts.js'

const wrap = (ui: ReactElement) =>
  render(<I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>{ui}</I18nextProvider>)

const rewrap = (view: ReturnType<typeof wrap>, ui: ReactElement) =>
  view.rerender(<I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>{ui}</I18nextProvider>)

const error: ClientError = { code: 'ROOM_FULL', message: 'full', reqId: null, at: 1_000 }

afterEach(() => {
  vi.useRealTimers()
})

describe('Toasts', () => {
  it('shows an error assertively and clears it exactly once, however often the screen re-renders', () => {
    vi.useFakeTimers()
    const onClearError = vi.fn()
    const slip = (): ReactElement => (
      // A brand-new closure every render, exactly as the room's ticking countdown produces.
      <Toasts error={error} notifications={[]} onClearError={() => onClearError()} onDismiss={vi.fn()} lang="en" />
    )
    const view = wrap(slip())
    expect(screen.getByRole('alert')).toHaveTextContent('Room is full')

    for (let i = 0; i < 3; i += 1) {
      act(() => void vi.advanceTimersByTime(1500))
      rewrap(view, slip())
      expect(onClearError).not.toHaveBeenCalled()
    }

    act(() => void vi.advanceTimersByTime(1500)) // 6 s since the error arrived
    expect(onClearError).toHaveBeenCalledTimes(1)

    act(() => void vi.advanceTimersByTime(60_000))
    expect(onClearError).toHaveBeenCalledTimes(1)
  })

  it('lets an error be dismissed by hand before the timer runs out', async () => {
    const onClearError = vi.fn()
    wrap(<Toasts error={error} notifications={[]} onClearError={onClearError} onDismiss={vi.fn()} lang="en" />)

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClearError).toHaveBeenCalledTimes(1)
  })

  it('announces notifications politely and dismisses them by id', async () => {
    const onDismiss = vi.fn()
    wrap(
      <Toasts
        error={null}
        notifications={[
          { id: 7, kind: 'KICKED', payload: null, at: 0 },
          { id: 9, kind: 'DAILY_REWARD', payload: { amount: 5000 }, at: 0 },
        ]}
        onClearError={vi.fn()}
        onDismiss={onDismiss}
        lang="en"
      />,
    )

    const slips = screen.getAllByRole('status')
    expect(slips).toHaveLength(2)
    expect(slips[0]).toHaveTextContent('You were removed from the room')
    expect(slips[1]).toHaveTextContent('Daily reward: 5,000 points')
    expect(screen.queryByRole('alert')).toBeNull()

    await userEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!)
    expect(onDismiss).toHaveBeenCalledWith(7)
  })

  it('clears a notification after eight seconds, however often the screen re-renders', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const note = { id: 3, kind: 'KICKED', payload: null, at: 0 }
    const slip = (): ReactElement => (
      // Again a fresh closure every render, exactly as the room's ticking countdown produces.
      <Toasts error={null} notifications={[note]} onClearError={vi.fn()} onDismiss={(id) => onDismiss(id)} lang="en" />
    )
    const view = wrap(slip())

    for (let i = 0; i < 3; i += 1) {
      act(() => void vi.advanceTimersByTime(2000))
      rewrap(view, slip())
      expect(onDismiss).not.toHaveBeenCalled()
    }
    // A notification lingers longer than an error: the player did not ask for it and may not be looking.
    act(() => void vi.advanceTimersByTime(2000)) // 8 s
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledWith(3)

    act(() => void vi.advanceTimersByTime(60_000))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('gives each notification its own timer', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const notes = [
      { id: 1, kind: 'KICKED', payload: null, at: 0 },
      { id: 2, kind: 'ROOM_CLOSED', payload: null, at: 0 },
    ]
    const view = wrap(<Toasts error={null} notifications={notes} onClearError={vi.fn()} onDismiss={onDismiss} lang="en" />)
    act(() => void vi.advanceTimersByTime(5000))
    rewrap(view, <Toasts error={null} notifications={[notes[1]!]} onClearError={vi.fn()} onDismiss={onDismiss} lang="en" />)
    act(() => void vi.advanceTimersByTime(3000)) // 8 s for the first, only 8 s of wall clock for the second too
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledWith(2)
  })

  it('interpolates the payload id, so an achievement slip names what was unlocked', () => {
    wrap(
      <Toasts
        error={null}
        notifications={[
          { id: 1, kind: 'ACHIEVEMENT_UNLOCKED', payload: { id: 'hand_royal', reward: { itemId: 'ring_royal' } }, at: 0 },
        ]}
        onClearError={vi.fn()}
        onDismiss={vi.fn()}
        lang="en"
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Achievement unlocked: hand_royal')
  })

  it('leaves the placeholder empty rather than printing "undefined" when the payload carries no id', () => {
    wrap(
      <Toasts
        error={null}
        notifications={[{ id: 1, kind: 'ACHIEVEMENT_UNLOCKED', payload: null, at: 0 }]}
        onClearError={vi.fn()}
        onDismiss={vi.fn()}
        lang="en"
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Achievement unlocked:')
    expect(screen.getByRole('status')).not.toHaveTextContent('undefined')
  })

  it('falls back to a generic line for a notification kind it does not know', () => {
    wrap(
      <Toasts
        error={null}
        notifications={[{ id: 1, kind: 'SOMETHING_NEW', payload: null, at: 0 }]}
        onClearError={vi.fn()}
        onDismiss={vi.fn()}
        lang="en"
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('New notification')
  })

  it('renders nothing when there is neither an error nor a notification', () => {
    const { container } = wrap(<Toasts error={null} notifications={[]} onClearError={vi.fn()} onDismiss={vi.fn()} lang="en" />)
    expect(container).toBeEmptyDOMElement()
  })
})
