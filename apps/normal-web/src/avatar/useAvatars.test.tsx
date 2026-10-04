import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type NormalApi, type PlayerAvatarDto } from '../api.js'
import { AVATAR_TTL_MS, resetAvatarCache, useAvatars } from './useAvatars.js'

const avatarOf = (playerId: string, outfit = 'outfit_casual01'): PlayerAvatarDto => ({
  playerId,
  displayName: playerId.toUpperCase(),
  avatar: { v: 4, gender: 'f', hairStyle: 'hair_f_bob01', outfit },
})

const NOT_FOUND = new ApiError(404, 'NOT_FOUND', 'no such player')

function stubApi(playerAvatar: NormalApi['playerAvatar']): NormalApi {
  return { playerAvatar } as unknown as NormalApi
}

describe('useAvatars', () => {
  beforeEach(() => {
    resetAvatarCache()
    vi.useRealTimers()
  })

  it('fetches each requested id once and hands back what the server said', async () => {
    const playerAvatar = vi.fn().mockImplementation((id: string) => Promise.resolve(avatarOf(id)))
    const { result } = renderHook(() => useAvatars(stubApi(playerAvatar), ['a', 'b']))

    await waitFor(() => expect(result.current.avatars.size).toBe(2))
    expect(playerAvatar.mock.calls.map(([id]) => id).sort()).toEqual(['a', 'b'])
    expect(result.current.avatars.get('a')?.displayName).toBe('A')
  })

  it('sends one request when several consumers ask for the same id at once', async () => {
    const playerAvatar = vi.fn().mockImplementation((id: string) => Promise.resolve(avatarOf(id)))
    const api = stubApi(playerAvatar)

    // Eight seats mounting at the same instant is the case that has to collapse to one request.
    const hooks = Array.from({ length: 8 }, () => renderHook(() => useAvatars(api, ['a'])))

    await waitFor(() => expect(hooks[7]?.result.current.avatars.has('a')).toBe(true))
    expect(playerAvatar).toHaveBeenCalledTimes(1)
    for (const hook of hooks) expect(hook.result.current.avatars.get('a')?.playerId).toBe('a')
  })

  it('serves a second consumer from the cache without touching the network', async () => {
    const playerAvatar = vi.fn().mockImplementation((id: string) => Promise.resolve(avatarOf(id)))
    const api = stubApi(playerAvatar)
    const first = renderHook(() => useAvatars(api, ['a']))
    await waitFor(() => expect(first.result.current.avatars.has('a')).toBe(true))

    const second = renderHook(() => useAvatars(api, ['a']))

    expect(second.result.current.avatars.get('a')?.playerId).toBe('a')
    expect(playerAvatar).toHaveBeenCalledTimes(1)
  })

  it('caches a 404 as null, and does not ask again inside the TTL', async () => {
    const playerAvatar = vi.fn().mockRejectedValue(NOT_FOUND)
    const api = stubApi(playerAvatar)
    const { result, rerender } = renderHook(() => useAvatars(api, ['ghost']))

    await waitFor(() => expect(result.current.avatars.has('ghost')).toBe(true))
    expect(result.current.avatars.get('ghost')).toBeNull()

    rerender()
    renderHook(() => useAvatars(api, ['ghost']))
    expect(playerAvatar).toHaveBeenCalledTimes(1)
  })

  it('caches a network failure the same way, so a broken endpoint cannot become a request storm', async () => {
    const playerAvatar = vi.fn().mockRejectedValue(new ApiError(0, 'NETWORK', 'down'))
    const api = stubApi(playerAvatar)
    const { result } = renderHook(() => useAvatars(api, ['a']))

    await waitFor(() => expect(result.current.avatars.get('a')).toBeNull())

    for (let i = 0; i < 5; i += 1) renderHook(() => useAvatars(api, ['a']))
    expect(playerAvatar).toHaveBeenCalledTimes(1)
  })

  it('survives an api that throws synchronously', async () => {
    const playerAvatar = vi.fn(() => {
      throw new TypeError('not a function')
    }) as unknown as NormalApi['playerAvatar']
    const { result } = renderHook(() => useAvatars(stubApi(playerAvatar), ['a']))

    await waitFor(() => expect(result.current.avatars.get('a')).toBeNull())
  })

  it('keeps serving a stale entry while it fetches the replacement', async () => {
    let release: ((value: PlayerAvatarDto) => void) | undefined
    const playerAvatar = vi
      .fn()
      .mockImplementationOnce((id: string) => Promise.resolve(avatarOf(id, '#111111')))
      .mockImplementationOnce(() => new Promise<PlayerAvatarDto>((resolve) => (release = resolve)))
    const api = stubApi(playerAvatar)
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)

    const first = renderHook(() => useAvatars(api, ['a']))
    await waitFor(() => expect(first.result.current.avatars.has('a')).toBe(true))

    clock.mockReturnValue(now + AVATAR_TTL_MS + 1)
    const second = renderHook(() => useAvatars(api, ['a']))

    // Stale-while-revalidate: the old face is still on the plate while the new one is on the wire. Blinking to
    // the grey silhouette for the length of a request reads as a glitch, not as a refresh.
    await waitFor(() => expect(playerAvatar).toHaveBeenCalledTimes(2))
    expect(second.result.current.avatars.get('a')?.avatar.outfit).toBe('#111111')

    await act(async () => {
      release?.(avatarOf('a', '#d9a441'))
    })
    await waitFor(() => expect(second.result.current.avatars.get('a')?.avatar.outfit).toBe('#d9a441'))
    clock.mockRestore()
  })

  it('refreshes an entry that went stale where it sits, with no other id answering to prompt it', async () => {
    // The passage of time is not something React watches: keyed on its id set alone, the hook would only ever
    // notice an expiry when some *other* request happened to land.
    const playerAvatar = vi.fn().mockImplementation((id: string) => Promise.resolve(avatarOf(id)))
    const api = stubApi(playerAvatar)
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)

    const { result, rerender } = renderHook(() => useAvatars(api, ['a']))
    await waitFor(() => expect(playerAvatar).toHaveBeenCalledTimes(1))

    clock.mockReturnValue(now + AVATAR_TTL_MS + 1)
    rerender()

    await waitFor(() => expect(playerAvatar).toHaveBeenCalledTimes(2))
    expect(result.current.avatars.has('a')).toBe(true)
    clock.mockRestore()
  })

  it('lets a reply land after the last consumer unmounts, and serves it to the next one', async () => {
    let release: ((value: PlayerAvatarDto) => void) | undefined
    const playerAvatar = vi.fn().mockImplementation(() => new Promise<PlayerAvatarDto>((resolve) => (release = resolve)))
    const api = stubApi(playerAvatar)
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const { unmount } = renderHook(() => useAvatars(api, ['a']))
    await waitFor(() => expect(playerAvatar).toHaveBeenCalledTimes(1))
    unmount()

    await act(async () => {
      release?.(avatarOf('a', '#3f938a'))
    })

    // The cache outlives the hook, which is the point of putting it at module scope: nothing was set on an
    // unmounted component (no act/update warning), and the answer is there for whoever asks next.
    expect(warn).not.toHaveBeenCalled()
    const next = renderHook(() => useAvatars(api, ['a']))
    expect(next.result.current.avatars.get('a')?.avatar.outfit).toBe('#3f938a')
    expect(playerAvatar).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('refetches one id on invalidate, and leaves the others alone', async () => {
    const playerAvatar = vi
      .fn()
      .mockImplementation((id: string) => Promise.resolve(avatarOf(id, id === 'a' ? '#111111' : '#222222')))
    const { result } = renderHook(() => useAvatars(stubApi(playerAvatar), ['a', 'b']))
    await waitFor(() => expect(result.current.avatars.size).toBe(2))

    playerAvatar.mockImplementation((id: string) => Promise.resolve(avatarOf(id, '#d9a441')))
    act(() => {
      result.current.invalidate('a')
    })

    await waitFor(() => expect(result.current.avatars.get('a')?.avatar.outfit).toBe('#d9a441'))
    expect(result.current.avatars.get('b')?.avatar.outfit).toBe('#222222')
    expect(playerAvatar.mock.calls.filter(([id]) => id === 'b')).toHaveLength(1)

    // Two caches sit between this hook and the server. Clearing the Map is half the job: the route is
    // served `private, max-age=60`, so the refetch has to be told to skip the browser's copy as well — and
    // only that refetch, since the other seats are exactly who the 60 s is for.
    expect(playerAvatar.mock.calls.filter(([id]) => id === 'a')).toEqual([
      ['a', { fresh: false }],
      ['a', { fresh: true }],
    ])
    expect(playerAvatar.mock.calls.filter(([id]) => id === 'b')).toEqual([['b', { fresh: false }]])
  })

  it('throws away a reply that invalidate has already superseded, and fetches once more', async () => {
    let release: ((value: PlayerAvatarDto) => void) | undefined
    const playerAvatar = vi
      .fn()
      .mockImplementationOnce(() => new Promise<PlayerAvatarDto>((resolve) => (release = resolve)))
      .mockImplementation((id: string) => Promise.resolve(avatarOf(id, '#d9a441')))
    const { result } = renderHook(() => useAvatars(stubApi(playerAvatar), ['a']))
    await waitFor(() => expect(playerAvatar).toHaveBeenCalledTimes(1))

    act(() => {
      result.current.invalidate('a')
    })
    await act(async () => {
      release?.(avatarOf('a', '#stale'))
    })

    await waitFor(() => expect(result.current.avatars.get('a')?.avatar.outfit).toBe('#d9a441'))
    expect(playerAvatar).toHaveBeenCalledTimes(2)
  })

  it('asks for nothing when asked for nobody', () => {
    const playerAvatar = vi.fn()
    const { result } = renderHook(() => useAvatars(stubApi(playerAvatar), []))

    expect(playerAvatar).not.toHaveBeenCalled()
    expect(result.current.avatars.size).toBe(0)
  })
})
