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

  it('probes for the room with a RESYNC as soon as WELCOME lands, and stops probing once it is answered', () => {
    const { result } = renderHook(() => useGameClient({ url: 'ws://x/ws', token: 'tok:a', socketFactory: fakeSocketFactory }))
    const sock = () => FakeSocket.instances.at(-1)!
    act(() => sock().open())
    expect(sock().sent).toEqual([{ t: 'HELLO', sessionToken: 'tok:a' }])
    act(() => sock().receive({ t: 'WELCOME', playerId: 'a', displayName: 'A', balance: 0, serverTime: 0 }))
    expect(sock().sent.at(-1)).toEqual({ t: 'RESYNC' })
    expect(result.current.state.roomStale).toBe(true)
    act(() => sock().receive({ t: 'ERROR', code: 'NOT_IN_ROOM', message: 'not in a room' }))
    expect(result.current.state.roomStale).toBe(false)
    expect(result.current.state.lastError).toBeNull()
    expect(sock().sent.filter((m) => (m as { t: string }).t === 'RESYNC')).toHaveLength(1)
  })

  it('does not connect when autoConnect is false until connect() is called', () => {
    const { result } = renderHook(() => useGameClient({ url: 'ws://x/ws', token: null, autoConnect: false, socketFactory: fakeSocketFactory }))
    expect(FakeSocket.instances).toHaveLength(0)
    act(() => result.current.connect())
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('keeps one connection across re-renders, however often the screen above it updates', () => {
    // The room re-renders once a second while a countdown runs; a connection keyed on anything that changes with
    // it would tear the socket down and back up on every tick.
    const { result, rerender } = renderHook(() => useGameClient({ url: 'ws://x/ws', token: 'tok:a', socketFactory: fakeSocketFactory }))
    act(() => FakeSocket.instances[0]!.open())
    for (let i = 0; i < 5; i += 1) {
      rerender()
      act(() => FakeSocket.instances.at(-1)!.receive({ t: 'BALANCE', balance: 100 + i }))
    }
    expect(FakeSocket.instances).toHaveLength(1)
    expect(result.current.state.balance).toBe(104)
  })

  it('drops the room from state once the server acknowledges LEAVE_ROOM', async () => {
    const { result } = renderHook(() => useGameClient({ url: 'ws://x/ws', token: 'tok:a', socketFactory: fakeSocketFactory }))
    const sock = () => FakeSocket.instances.at(-1)!
    act(() => sock().open())
    act(() =>
      sock().receive({
        t: 'ROOM_SNAPSHOT', seq: 3, deadlineAt: null, hand: null,
        room: { roomId: 'r', code: 'C', name: 'n', mode: 'holdem', config: { name: 'n', mode: 'holdem', maxPlayers: 2, isPrivate: false, turnTimerSec: 30, autoStart: false, hasPassword: false }, playerCount: 1, maxPlayers: 2, status: 'OPEN', hostPlayerId: 'a', carryOverPot: 0, nextHandAt: null, players: [] },
      }),
    )
    expect(result.current.state.room?.code).toBe('C')

    let leaving!: Promise<unknown>
    act(() => { leaving = result.current.leaveRoom() })
    const sent = sock().sent.at(-1) as { t: string; reqId: string }
    expect(sent.t).toBe('LEAVE_ROOM')
    act(() => sock().receive({ t: 'ACK', reqId: sent.reqId }))
    await act(async () => { await leaving })
    expect(result.current.state.room).toBeNull()
    expect(result.current.state.hand).toBeNull()
  })
})

describe('useGameClient pre-actions', () => {
  beforeEach(() => { vi.useFakeTimers(); FakeSocket.reset() })
  afterEach(() => { vi.useRealTimers() })

  const room = {
    roomId: 'r', code: 'C', name: 'n', mode: 'holdem' as const,
    config: { name: 'n', mode: 'holdem' as const, maxPlayers: 3, isPrivate: false, turnTimerSec: 30, autoStart: false, hasPassword: false, holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 } },
    playerCount: 2, maxPlayers: 3, status: 'IN_GAME' as const, hostPlayerId: 'a', carryOverPot: 0, nextHandAt: null,
    players: [
      { playerId: 'a', displayName: 'A', isBot: false, isHost: true, connected: true, seat: 0, status: 'IN_HAND' as const, sittingOut: false, stack: 20000, ready: true },
      { playerId: 'b', displayName: 'B', isBot: false, isHost: false, connected: true, seat: 1, status: 'IN_HAND' as const, sittingOut: false, stack: 20000, ready: true },
    ],
  }
  const legal = (kinds: ('fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn' | 'play')[], callAmount = 0) =>
    ({ seat: 0, kinds, callAmount, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 })

  function seatedInHand() {
    const rendered = renderHook(() => useGameClient({ url: 'ws://x/ws', token: 'tok:a', socketFactory: fakeSocketFactory }))
    const sock = () => FakeSocket.instances.at(-1)!
    act(() => sock().open())
    act(() => sock().receive({ t: 'WELCOME', playerId: 'a', displayName: 'A', balance: 100, serverTime: Date.now() }))
    act(() => sock().receive({ t: 'ROOM_SNAPSHOT', seq: 7, room, hand: null, deadlineAt: null }))
    act(() => sock().receive({ t: 'GAME_EVENT', seq: 8, event: { type: 'HAND_STARTED', handId: 'h1', mode: 'holdem', seats: [0, 1], button: 1, carryOverIn: 0 } }))
    return { ...rendered, sock }
  }
  const actions = (sock: () => FakeSocket) => sock().sent.filter((m) => (m as { t: string }).t === 'ACTION')

  it('sends the ticked action the moment the turn arrives, once, and clears the tick', () => {
    const { result, sock } = seatedInHand()
    act(() => result.current.setPreAction('checkFold'))
    expect(result.current.state.preAction).toEqual({ kind: 'checkFold', handId: 'h1' })
    expect(actions(sock)).toHaveLength(0)

    act(() => sock().receive({ t: 'GAME_EVENT', seq: 9, event: { type: 'TURN_CHANGED', seat: 0, turnSeq: 1, legal: legal(['fold', 'call', 'raise', 'allIn'], 200) } }))
    expect(actions(sock)).toHaveLength(1)
    expect(actions(sock)[0]).toMatchObject({ t: 'ACTION', baseSeq: 9, action: { kind: 'fold' } })
    expect(result.current.state.preAction).toBeNull()
  })

  it('does nothing on a turn frame for another seat, and nothing when no tick is set', () => {
    const { result, sock } = seatedInHand()
    act(() => result.current.setPreAction('callAny'))
    act(() => sock().receive({ t: 'GAME_EVENT', seq: 9, event: { type: 'TURN_CHANGED', seat: 1, turnSeq: 1, legal: legal(['fold', 'call'], 200) } }))
    expect(actions(sock)).toHaveLength(0)
    act(() => result.current.setPreAction(null))
    act(() => sock().receive({ t: 'GAME_EVENT', seq: 10, event: { type: 'TURN_CHANGED', seat: 0, turnSeq: 1, legal: legal(['fold', 'call'], 200) } }))
    expect(actions(sock)).toHaveLength(0)
  })

  it('lets a tick lapse rather than send something the server did not list', () => {
    const { result, sock } = seatedInHand()
    act(() => result.current.setPreAction('callAny'))
    act(() => sock().receive({ t: 'GAME_EVENT', seq: 9, event: { type: 'TURN_CHANGED', seat: 0, turnSeq: 1, legal: legal(['fold', 'allIn'], 30000) } }))
    expect(actions(sock)).toHaveLength(0)
    expect(result.current.state.preAction).toBeNull()
  })

  it('auto-play answers every blind decision with play until it is switched off', () => {
    const { result, sock } = seatedInHand()
    act(() => result.current.setAutoPlay(true))
    act(() => sock().receive({ t: 'GAME_EVENT', seq: 9, event: { type: 'DECISION_PHASE', seats: [0, 1], turnSeq: 1 } }))
    expect(actions(sock)).toHaveLength(1)
    expect(actions(sock)[0]).toMatchObject({ action: { kind: 'play' } })
    expect(result.current.state.autoPlay).toBe(true)

    act(() => result.current.setAutoPlay(false))
    act(() => sock().receive({ t: 'GAME_EVENT', seq: 10, event: { type: 'HAND_STARTED', handId: 'h2', mode: 'holdem', seats: [0, 1], button: 0, carryOverIn: 0 } }))
    act(() => sock().receive({ t: 'GAME_EVENT', seq: 11, event: { type: 'DECISION_PHASE', seats: [0, 1], turnSeq: 1 } }))
    expect(actions(sock)).toHaveLength(1)
  })
})
