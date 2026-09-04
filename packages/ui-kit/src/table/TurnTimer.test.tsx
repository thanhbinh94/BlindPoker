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
})
