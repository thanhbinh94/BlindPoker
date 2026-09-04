import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSocket, fakeSocketFactory } from './fake-socket.js'
import { useGameClient } from './useGameClient.js'

describe('useGameClient', () => {
  beforeEach(() => { vi.useFakeTimers(); FakeSocket.reset() })
  afterEach(() => { vi.useRealTimers() })

  it('connects, applies messages, sends actions with the latest seq, and resyncs on STALE_STATE', async () => {
    const { result, unmount } = renderHook(() => useGameClient({ url: 'ws://x/ws', token: 'tok:a', socketFactory: fakeSocketFactory }))
    const sock = () => FakeSocket.instances.at(-1)!
    act(() => sock().open())
    expect(result.current.state.status).toBe('open')
    act(() => sock().receive({ t: 'WELCOME', playerId: 'a', displayName: 'A', balance: 100, serverTime: Date.now() + 500 }))
    expect(result.current.state.me?.playerId).toBe('a')
    expect(result.current.serverNow()).toBeGreaterThan(Date.now())
    act(() => sock().receive({ t: 'ROOM_SNAPSHOT', seq: 7, room: { roomId: 'r', code: 'C', name: 'n', mode: 'holdem', config: { name: 'n', mode: 'holdem', maxPlayers: 2, isPrivate: false, turnTimerSec: 30, autoStart: false, hasPassword: false }, playerCount: 1, maxPlayers: 2, status: 'OPEN', hostPlayerId: 'a', carryOverPot: 0, nextHandAt: null, players: [] }, hand: null, deadlineAt: null }))
    expect(result.current.state.room?.code).toBe('C')
    let p!: Promise<unknown>
    act(() => { p = result.current.act({ kind: 'call' }) })
    const sent = sock().sent.at(-1) as { t: string; baseSeq: number; reqId: string }
    expect(sent).toMatchObject({ t: 'ACTION', baseSeq: 7, action: { kind: 'call' } })
    act(() => sock().receive({ t: 'ERROR', reqId: sent.reqId, code: 'STALE_STATE', message: 'old' }))
    await act(async () => { await p })
    expect(result.current.state.lastError?.code).toBe('STALE_STATE')
    expect(sock().sent.at(-1)).toEqual({ t: 'RESYNC' })
    expect(result.current.state.resyncNeeded).toBe(false)
    act(() => { result.current.clearError() })
    expect(result.current.state.lastError).toBeNull()
    unmount()
    expect(sock().closedWith?.code).toBe(1000)
  })

  it('does not connect when autoConnect is false until connect() is called', () => {
    const { result } = renderHook(() => useGameClient({ url: 'ws://x/ws', token: null, autoConnect: false, socketFactory: fakeSocketFactory }))
    expect(FakeSocket.instances).toHaveLength(0)
    act(() => result.current.connect())
    expect(FakeSocket.instances).toHaveLength(1)
  })
})
