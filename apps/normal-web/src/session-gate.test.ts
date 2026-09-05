import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, type AuthMeDto, type NormalApi } from './api.js'
import { useSessionGate } from './session-gate.js'

const ME: AuthMeDto = { playerId: 'p1', displayName: 'Bình', balance: 100_000 }
const UNAUTHORIZED = new ApiError(401, 'UNAUTHENTICATED', 'a valid session cookie is required')

const apiWith = (authMe: NormalApi['authMe']): NormalApi => ({ authMe }) as unknown as NormalApi

function mount(authMe: NormalApi['authMe']) {
  const onEnded = vi.fn()
  const api = apiWith(authMe)
  const view = renderHook(() => useSessionGate({ api, socketStatus: 'open', onEnded }))
  return { ...view, onEnded }
}

/**
 * Lets the boot probe's promise settle and React re-render, so the assertions below are not racing it.
 * Several microtask ticks, because the probe is a `then`/`catch` chain rather than a single await.
 */
const settle = (): Promise<void> =>
  act(async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve()
  })

describe('useSessionGate', () => {
  it('boots into checking and holds there until the probe answers', async () => {
    let answer: (me: AuthMeDto) => void = () => undefined
    const { result } = mount(vi.fn(() => new Promise<AuthMeDto>((resolve) => (answer = resolve))))

    expect(result.current.state).toBe('checking')
    expect(result.current.signedIn).toBe(false)

    await act(async () => {
      answer(ME)
    })
    expect(result.current.state).toBe('signedIn')
    expect(result.current.me).toEqual(ME)
  })

  it.each([
    ['a 401', UNAUTHORIZED],
    ['an unreachable server', new ApiError(0, 'NETWORK', 'Failed to fetch')],
  ])('falls back to anonymous with no expiry notice after %s', async (_label, cause) => {
    const { result } = mount(vi.fn().mockRejectedValue(cause))

    await waitFor(() => expect(result.current.state).toBe('anonymous'))
    // Nothing was lost, so the sign-in card carries no explanation.
    expect(result.current.expired).toBe(false)
    expect(result.current.me).toBeNull()
  })

  it('ends the session with a notice when a screen reports a 401', async () => {
    const { result, onEnded } = mount(vi.fn().mockResolvedValue(ME))
    await settle()
    expect(result.current.signedIn).toBe(true)

    act(() => result.current.onUnauthenticated())

    expect(result.current.state).toBe('anonymous')
    expect(result.current.expired).toBe(true)
    expect(result.current.me).toBeNull()
    // The app is told, so it can drop the socket that no longer has a session behind it.
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('ends it silently when the player asked to leave', async () => {
    const { result, onEnded } = mount(vi.fn().mockResolvedValue(ME))
    await settle()
    expect(result.current.signedIn).toBe(true)

    act(() => result.current.signOut())

    expect(result.current.state).toBe('anonymous')
    expect(result.current.expired).toBe(false)
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('probes exactly once, even when the caller rebuilds the api object on every render', async () => {
    const authMe = vi.fn().mockResolvedValue(ME)
    const onEnded = vi.fn()
    // The shape that would loop if the boot probe were keyed on the object rather than held in a ref.
    const { result } = renderHook(() => useSessionGate({ api: apiWith(authMe), socketStatus: 'open', onEnded }))
    await settle()

    expect(result.current.state).toBe('signedIn')
    expect(authMe).toHaveBeenCalledTimes(1)
  })

  it('clears an expiry notice once a new session begins', async () => {
    const { result } = mount(vi.fn().mockRejectedValue(UNAUTHORIZED))
    await settle()
    act(() => result.current.onUnauthenticated())
    expect(result.current.expired).toBe(true)

    act(() => result.current.signIn(ME))

    expect(result.current.state).toBe('signedIn')
    expect(result.current.expired).toBe(false)
  })
})
