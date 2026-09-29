import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeRoom } from '../test-fixtures.js'
import { FakeSocket, fakeSocketFactory } from './fake-socket.js'
import { useGameClient } from './useGameClient.js'
import { useRoomReturn } from './useRoomReturn.js'

describe('useRoomReturn (T5)', () => {
  it('takes a live client back to the room the server answers a connect with — even when both frames land at once', () => {
    FakeSocket.reset()
    const onReturn = vi.fn()
    renderHook(() => {
      const client = useGameClient({ url: 'ws://x/ws', token: 'tok:a', socketFactory: fakeSocketFactory })
      useRoomReturn(client.state, onReturn)
      return client
    })
    const sock = FakeSocket.instances.at(-1)!
    act(() => sock.open())
    act(() => {
      sock.receive({ t: 'WELCOME', playerId: 'me', displayName: 'Mai', balance: 0, serverTime: 0 })
      sock.receive({ t: 'ROOM_SNAPSHOT', seq: 3, room: makeRoom({ status: 'OPEN' }), hand: null, deadlineAt: null })
    })
    expect(onReturn).toHaveBeenCalledTimes(1)

    // The answer to the hook's own RESYNC repeats the room: still one return.
    act(() => sock.receive({ t: 'ROOM_SNAPSHOT', seq: 4, room: makeRoom({ status: 'OPEN' }), hand: null, deadlineAt: null }))
    expect(onReturn).toHaveBeenCalledTimes(1)
  })

  it('stays put when the server says the player is in no room', () => {
    FakeSocket.reset()
    const onReturn = vi.fn()
    renderHook(() => {
      const client = useGameClient({ url: 'ws://x/ws', token: 'tok:a', socketFactory: fakeSocketFactory })
      useRoomReturn(client.state, onReturn)
      return client
    })
    const sock = FakeSocket.instances.at(-1)!
    act(() => sock.open())
    act(() => sock.receive({ t: 'WELCOME', playerId: 'me', displayName: 'Mai', balance: 0, serverTime: 0 }))
    act(() => sock.receive({ t: 'ERROR', code: 'NOT_IN_ROOM', message: 'not in a room' }))
    expect(onReturn).not.toHaveBeenCalled()
  })

  const mount = (initial: number) => {
    const onReturn = vi.fn()
    const view = renderHook(({ roomReturns }) => useRoomReturn({ roomReturns }, onReturn), { initialProps: { roomReturns: initial } })
    return { ...view, onReturn }
  }

  it('says nothing on mount, however the count stands', () => {
    expect(mount(0).onReturn).not.toHaveBeenCalled()
    expect(mount(3).onReturn).not.toHaveBeenCalled()
  })

  it('fires once for every return the reducer counts, and not for a re-render', () => {
    const { rerender, onReturn } = mount(0)
    rerender({ roomReturns: 1 })
    expect(onReturn).toHaveBeenCalledTimes(1)
    rerender({ roomReturns: 1 })
    expect(onReturn).toHaveBeenCalledTimes(1)
    rerender({ roomReturns: 2 })
    expect(onReturn).toHaveBeenCalledTimes(2)
  })

  it('does not fire for the reset a sign-out makes, but does for the next session’s first return', () => {
    const { rerender, onReturn } = mount(2)
    rerender({ roomReturns: 0 })
    expect(onReturn).not.toHaveBeenCalled()
    rerender({ roomReturns: 1 })
    expect(onReturn).toHaveBeenCalledTimes(1)
  })

  it('calls the latest callback, not the one it was mounted with', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ roomReturns, onReturn }) => useRoomReturn({ roomReturns }, onReturn), {
      initialProps: { roomReturns: 0, onReturn: first },
    })
    rerender({ roomReturns: 1, onReturn: second })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
