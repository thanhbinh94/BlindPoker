import { render, screen, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TurnTimer } from './TurnTimer.js'

describe('TurnTimer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('counts down against server time and hides when there is no deadline', () => {
    let now = 10_000
    const { rerender } = render(<TurnTimer deadlineAt={now + 5_000} serverNow={() => now} totalMs={30_000} />)
    expect(screen.getByRole('timer')).toHaveTextContent('5')
    now += 2_400
    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(screen.getByRole('timer')).toHaveTextContent('3')
    rerender(<TurnTimer deadlineAt={null} serverNow={() => now} totalMs={30_000} />)
    expect(screen.queryByRole('timer')).toBeNull()
  })
  it('stops ticking once the deadline has passed', () => {
    let now = 10_000
    render(<TurnTimer deadlineAt={now + 500} serverNow={() => now} totalMs={30_000} />)
    expect(vi.getTimerCount()).toBe(1)
    now += 600
    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(screen.getByRole('timer')).toHaveTextContent('0')
    // A seat can sit timed out for a while; four re-renders a second for a ring frozen at zero is four too many.
    expect(vi.getTimerCount()).toBe(0)
  })
  it('never starts a ticker for a deadline that is already gone', () => {
    render(<TurnTimer deadlineAt={9_000} serverNow={() => 10_000} totalMs={30_000} />)
    expect(screen.getByRole('timer')).toHaveTextContent('0')
    expect(vi.getTimerCount()).toBe(0)
  })
})
