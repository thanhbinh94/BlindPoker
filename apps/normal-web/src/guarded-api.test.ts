import { describe, expect, it, vi } from 'vitest'
import { ApiError, type NormalApi } from './api.js'
import { guardApi } from './guarded-api.js'

const UNAUTHENTICATED = new ApiError(401, 'UNAUTHENTICATED', 'a valid session cookie is required')
/** A wrong password. Same status, different code — and not a session ending. */
const BAD_CREDENTIALS = new ApiError(401, 'BAD_CREDENTIALS', 'email or password is wrong')

const stub = (overrides: Partial<NormalApi> = {}): NormalApi =>
  ({
    me: vi.fn().mockResolvedValue({ playerId: 'p1' }),
    stats: vi.fn().mockResolvedValue({}),
    ...overrides,
  }) as unknown as NormalApi

describe('guardApi', () => {
  it('passes a successful call through untouched', async () => {
    const me = vi.fn().mockResolvedValue({ playerId: 'p1', displayName: 'Bình', balance: 1 })
    const onUnauthenticated = vi.fn()

    await expect(guardApi(stub({ me }), onUnauthenticated).me()).resolves.toMatchObject({ playerId: 'p1' })
    expect(me).toHaveBeenCalledTimes(1)
    expect(onUnauthenticated).not.toHaveBeenCalled()
  })

  it('signs the player out on an UNAUTHENTICATED refusal — and still rethrows it', async () => {
    const onUnauthenticated = vi.fn()
    const guarded = guardApi(stub({ me: vi.fn().mockRejectedValue(UNAUTHENTICATED) }), onUnauthenticated)

    // Rethrown, because the caller still has to stop: swallowing it would leave the screen loading forever.
    await expect(guarded.me()).rejects.toBe(UNAUTHENTICATED)
    expect(onUnauthenticated).toHaveBeenCalledTimes(1)
  })

  it('signs the player out once, however many calls were in flight', async () => {
    const onUnauthenticated = vi.fn()
    const guarded = guardApi(
      stub({
        me: vi.fn().mockRejectedValue(UNAUTHENTICATED),
        stats: vi.fn().mockRejectedValue(UNAUTHENTICATED),
        history: vi.fn().mockRejectedValue(UNAUTHENTICATED),
      }),
      onUnauthenticated,
    )

    // The profile fires three requests at once; three 401s must not be three sign-outs.
    await Promise.allSettled([guarded.me(), guarded.stats(), guarded.history()])
    expect(onUnauthenticated).toHaveBeenCalledTimes(1)
  })

  it('ignores a 401 that is not an expiry — a wrong password is a form error', async () => {
    const onUnauthenticated = vi.fn()
    const guarded = guardApi(stub({ login: vi.fn().mockRejectedValue(BAD_CREDENTIALS) }), onUnauthenticated)

    await expect(guarded.login({ email: 'a@b.c', password: 'wrong' })).rejects.toBe(BAD_CREDENTIALS)
    expect(onUnauthenticated).not.toHaveBeenCalled()
  })

  it('ignores every other refusal, and anything that is not an ApiError at all', async () => {
    const onUnauthenticated = vi.fn()
    const boom = new TypeError('api.stats is not a function')
    const guarded = guardApi(
      stub({
        me: vi.fn().mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'slow down')),
        stats: vi.fn().mockRejectedValue(boom),
      }),
      onUnauthenticated,
    )

    await expect(guarded.me()).rejects.toBeInstanceOf(ApiError)
    await expect(guarded.stats()).rejects.toBe(boom)
    expect(onUnauthenticated).not.toHaveBeenCalled()
  })

  it('hands back the same function every time, so a caller may put it in a dependency list', () => {
    const guarded = guardApi(stub(), vi.fn())
    expect(guarded.me).toBe(guarded.me)
  })

  it('does not wrap what is not a method', () => {
    const api = { ...stub(), edition: 'normal' } as unknown as NormalApi & { edition: string }
    expect((guardApi(api, vi.fn()) as typeof api).edition).toBe('normal')
  })
})
