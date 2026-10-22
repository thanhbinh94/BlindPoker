import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DailyStatusDto, NormalApi } from './api.js'
import { DAILY_NUDGE_KEY, useDailyNudge, type NudgeArrival } from './daily-nudge.js'

const STATUS: DailyStatusDto = { claimable: true, day: 3, streak: 2, reward: 7000, item: null, nextResetAt: 1_800_000_000_000, month: '2027-01', calendar: [] }

const apiWith = (status: DailyStatusDto = STATUS): NormalApi => ({ daily: vi.fn().mockResolvedValue(status) }) as unknown as NormalApi

function mount(arrival: NudgeArrival, api: NormalApi = apiWith(), path = '/lobby') {
  const navigate = vi.fn()
  const hook = renderHook((props: { arrival: NudgeArrival; path: string }) => useDailyNudge({ api, playerId: 'p1', path: props.path, navigate, arrival: props.arrival }), {
    initialProps: { arrival, path },
  })
  return { ...hook, navigate, api }
}

/** Lets the status read land, and anything it set off with it. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useDailyNudge — the welcome gift comes first (Plan 27, P25)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('opens the reward page on arrival when the welcome gift is already taken', async () => {
    const { result, navigate } = mount('go')

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/daily'))
    expect(result.current.ready).toBe(true)
    expect(localStorage.getItem(DAILY_NUDGE_KEY)).toBe(String(STATUS.nextResetAt))
  })

  it('stays in the lobby while the welcome gift is unclaimed, but keeps the dot and the day unspent', async () => {
    const { result, navigate } = mount('skip')

    await waitFor(() => expect(result.current.ready).toBe(true))
    await flush()
    expect(navigate).not.toHaveBeenCalled()
    expect(localStorage.getItem(DAILY_NUDGE_KEY)).toBeNull()
  })

  it('holds the move until the welcome status is known, then makes it once it says the gift is taken', async () => {
    const { result, navigate, rerender } = mount('wait')
    await waitFor(() => expect(result.current.ready).toBe(true))
    await flush()
    expect(navigate).not.toHaveBeenCalled()

    rerender({ arrival: 'go', path: '/lobby' })

    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/daily')
  })

  it('drops the held move when the welcome status says the gift is still waiting', async () => {
    const { result, navigate, rerender } = mount('wait')
    await waitFor(() => expect(result.current.ready).toBe(true))
    await flush()

    rerender({ arrival: 'skip', path: '/lobby' })
    rerender({ arrival: 'go', path: '/lobby' })

    expect(navigate).not.toHaveBeenCalled()
  })

  it('drops the held move when the player has left the lobby by the time the status is known', async () => {
    const { result, navigate, rerender } = mount('wait')
    await waitFor(() => expect(result.current.ready).toBe(true))
    await flush()

    rerender({ arrival: 'wait', path: '/shop' })
    rerender({ arrival: 'go', path: '/shop' })

    expect(navigate).not.toHaveBeenCalled()
  })
})
