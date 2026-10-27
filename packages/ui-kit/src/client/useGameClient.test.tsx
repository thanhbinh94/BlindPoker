import { parseCards } from '@bp/core'
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

describe('useGameClient squeeze mode', () => {
  beforeEach(() => { vi.useFakeTimers(); FakeSocket.reset() })
  afterEach(() => { vi.useRealTimers() })

  const roomOf = (squeeze: boolean) => ({
    roomId: 'r', code: 'C', name: 'n', mode: 'blind' as const,
    config: { name: 'n', mode: 'blind' as const, maxPlayers: 3, isPrivate: false, turnTimerSec: 20, autoStart: false, hasPassword: false, blind: { holeCards: 2 as const, decisionMode: 'none' as const, fixedWager: 1000, botCount: 0, squeeze } },
    playerCount: 2, maxPlayers: 3, status: 'IN_GAME' as const, hostPlayerId: 'a', carryOverPot: 0, nextHandAt: null,
    players: [
      { playerId: 'a', displayName: 'A', isBot: false, isHost: true, connected: true, seat: 0, status: 'IN_HAND' as const, sittingOut: false, stack: 20000, ready: true },
      { playerId: 'b', displayName: 'B', isBot: false, isHost: false, connected: true, seat: 1, status: 'IN_HAND' as const, sittingOut: false, stack: 20000, ready: true },
    ],
  })

  function seatedAtTable(squeeze: boolean) {
    const rendered = renderHook(() => useGameClient({ url: 'ws://x/ws', token: 'tok:a', socketFactory: fakeSocketFactory }))
    const sock = () => FakeSocket.instances.at(-1)!
    act(() => sock().open())
    act(() => sock().receive({ t: 'WELCOME', playerId: 'a', displayName: 'A', balance: 100, serverTime: Date.now() }))
    act(() => sock().receive({ t: 'ROOM_SNAPSHOT', seq: 7, room: roomOf(squeeze), hand: null, deadlineAt: null }))
    return { ...rendered, sock }
  }
  const startHand = (sock: () => FakeSocket, seq: number, handId: string) =>
    act(() => sock().receive({ t: 'GAME_EVENT', seq, event: { type: 'HAND_STARTED', handId, mode: 'blind', seats: [0, 1], button: 0, carryOverIn: 0 } }))
  const dealTo = (sock: () => FakeSocket, seq: number, seat: number) =>
    act(() => sock().receive({ t: 'GAME_EVENT', seq, event: { type: 'CARDS_DEALT', seat, cards: seat === 0 ? parseCards('As Ks') : [], cardCount: 2 } }))
  const reveals = (sock: () => FakeSocket) => sock().sent.filter((m) => (m as { t: string }).t === 'REVEAL')

  it('auto-play turns the cards at once in a squeeze room: one REVEAL per hand, none when off', () => {
    const { result, sock } = seatedAtTable(true)
    act(() => result.current.setAutoPlay(true))
    startHand(sock, 8, 'h1')
    expect(reveals(sock)).toHaveLength(0) // nothing is dealt yet, so there is nothing to turn
    dealTo(sock, 9, 0)
    expect(reveals(sock)).toHaveLength(1)
    dealTo(sock, 10, 0)
    dealTo(sock, 11, 1)
    expect(reveals(sock)).toHaveLength(1) // the same hand never asks twice

    act(() => result.current.setAutoPlay(false))
    startHand(sock, 12, 'h2')
    dealTo(sock, 13, 0)
    expect(reveals(sock)).toHaveLength(1) // auto-play is off: the player turns the cards by hand

    act(() => result.current.setAutoPlay(true))
    expect(reveals(sock)).toHaveLength(2) // switched on with the cards already down: they are turned now, once
    dealTo(sock, 14, 1)
    expect(reveals(sock)).toHaveLength(2)
  })

  // Final fix wave M2: a REVEAL lost with the socket. The reconnect's snapshot has my seat unturned; auto-play asks again,
  // once — and not after a snapshot that has it turned, nor for a snapshot that is no reconnect.
  it('auto-play sends the REVEAL once more when a reconnect finds my seat still unturned', () => {
    const { result, sock } = seatedAtTable(true)
    act(() => result.current.setAutoPlay(true))
    startHand(sock, 8, 'h1')
    dealTo(sock, 9, 0)
    expect(reveals(sock)).toHaveLength(1)
    const seatView = (seat: number, revealed: boolean) => ({
      seat, playerId: seat === 0 ? 'a' : 'b', isBot: false, stack: 19_000, betThisStreet: 1000, totalCommitted: 1000, folded: false, allIn: false,
      cardCount: 2, holeCards: seat === 0 ? parseCards('As Ks') : null, hasDecided: false, decision: null, revealed,
    })
    const handView = (revealed: boolean) => ({
      handId: 'h1', mode: 'blind' as const, phase: 'SQUEEZE' as const, street: 'PREFLOP' as const, community: [], pot: 2000, carryOverIn: 0,
      currentBet: 0, minRaise: 0, button: 0, actingSeat: null, turnSeq: 1, seats: [seatView(0, revealed), seatView(1, false)], mySeat: 0, legal: null, result: null,
    })
    /** The socket drops before the REVEAL gets through; the next one comes back to a snapshot of the hand. */
    const reconnect = (revealed: boolean, seq: number) => {
      act(() => sock().serverClose(1006))
      act(() => { vi.advanceTimersByTime(30_000) })
      act(() => sock().open())
      act(() => sock().receive({ t: 'WELCOME', playerId: 'a', displayName: 'A', balance: 100, serverTime: Date.now() }))
      act(() => sock().receive({ t: 'ROOM_SNAPSHOT', seq, room: roomOf(true), hand: handView(revealed), deadlineAt: Date.now() + 15_000 }))
    }
    reconnect(false, 10)
    expect(reveals(sock), 'asked again on the new socket').toHaveLength(1)
    // a snapshot that answers a RESYNC on the same socket is no reconnect: nothing was lost
    act(() => sock().receive({ t: 'ROOM_SNAPSHOT', seq: 11, room: roomOf(true), hand: handView(false), deadlineAt: Date.now() + 14_000 }))
    expect(reveals(sock)).toHaveLength(1)
    reconnect(true, 12)
    expect(reveals(sock), 'the server has it: nothing to ask').toHaveLength(0)
  })

  it('does not ask again once my cards are turned, and asks for nothing in a plain room', () => {
    const squeeze = seatedAtTable(true)
    startHand(squeeze.sock, 8, 'h1')
    dealTo(squeeze.sock, 9, 0)
    act(() => squeeze.sock().receive({ t: 'GAME_EVENT', seq: 10, event: { type: 'PLAYER_REVEALED', seat: 0 } }))
    act(() => squeeze.result.current.setAutoPlay(true))
    expect(reveals(squeeze.sock)).toHaveLength(0)
    squeeze.unmount()

    const plain = seatedAtTable(false)
    act(() => plain.result.current.setAutoPlay(true))
    startHand(plain.sock, 8, 'h1')
    dealTo(plain.sock, 9, 0)
    expect(reveals(plain.sock)).toHaveLength(0)
  })

  it('client.reveal() sends REVEAL with a request id and resolves on the ACK', async () => {
    const { result, sock } = seatedAtTable(true)
    let p!: Promise<{ t: string }>
    act(() => { p = result.current.reveal() })
    const sent = sock().sent.at(-1) as { t: string; reqId: string }
    expect(sent.t).toBe('REVEAL')
    expect(sent.reqId).toEqual(expect.any(String))
    act(() => sock().receive({ t: 'ACK', reqId: sent.reqId }))
    await act(async () => { await expect(p).resolves.toMatchObject({ t: 'ACK' }) })
  })
})

describe('useGameClient Poker hỗn loạn', () => {
  beforeEach(() => { vi.useFakeTimers(); FakeSocket.reset() })
  afterEach(() => { vi.useRealTimers() })

  const chaosRoom = {
    roomId: 'r', code: 'C', name: 'n', mode: 'blind' as const,
    config: { name: 'n', mode: 'blind' as const, maxPlayers: 3, isPrivate: false, turnTimerSec: 20, autoStart: false, hasPassword: false, blind: { holeCards: 2 as const, decisionMode: 'playOrFold' as const, fixedWager: 1000, botCount: 0, chaosCycle: 5 as const } },
    playerCount: 2, maxPlayers: 3, status: 'IN_GAME' as const, hostPlayerId: 'a', carryOverPot: 0, nextHandAt: null,
    players: [
      { playerId: 'a', displayName: 'A', isBot: false, isHost: true, connected: true, seat: 0, status: 'SEATED' as const, sittingOut: false, stack: 20000, ready: true },
      { playerId: 'b', displayName: 'B', isBot: false, isHost: false, connected: true, seat: 1, status: 'SEATED' as const, sittingOut: false, stack: 20000, ready: true },
    ],
  }
  const OFFER = { offerId: 'o1', tier: 'silver', cardIds: ['s_shield', 's_peek_board', 's_free_fold'], deadlineAt: Date.now() + 15_000 }

  function atTheDraft() {
    const rendered = renderHook(() => useGameClient({ url: 'ws://x/ws', token: 'tok:a', socketFactory: fakeSocketFactory }))
    const sock = () => FakeSocket.instances.at(-1)!
    act(() => sock().open())
    act(() => sock().receive({ t: 'WELCOME', playerId: 'a', displayName: 'A', balance: 100, serverTime: Date.now() }))
    act(() => sock().receive({ t: 'ROOM_SNAPSHOT', seq: 7, room: chaosRoom, hand: null, deadlineAt: null }))
    return { ...rendered, sock }
  }
  const offerTo = (sock: () => FakeSocket) => {
    act(() => sock().receive({ t: 'NOTIFICATION', kind: 'CHAOS_OFFER', payload: OFFER }))
    act(() => sock().receive({ t: 'ROOM_EVENT', seq: 8, event: { type: 'CHAOS_DRAFT', tier: 'silver', draftMs: 15_000, deadlineAt: OFFER.deadlineAt, seats: [0, 1] } }))
  }
  const picks = (sock: () => FakeSocket) => sock().sent.filter((m) => (m as { t: string }).t === 'CHAOS_PICK')

  it('pickChaos sends CHAOS_PICK with a request id, and marks the offer picked once the server acknowledges', async () => {
    const { result, sock } = atTheDraft()
    offerTo(sock)
    let p!: Promise<{ t: string }>
    act(() => { p = result.current.pickChaos('o1', 's_peek_board') })
    const sent = sock().sent.at(-1) as { t: string; reqId: string }
    expect(sent).toMatchObject({ t: 'CHAOS_PICK', offerId: 'o1', cardId: 's_peek_board' })
    expect(sent.reqId).toEqual(expect.any(String))
    expect(result.current.state.chaos.draft?.picked).toBe(false)
    act(() => sock().receive({ t: 'ACK', reqId: sent.reqId }))
    await act(async () => { await expect(p).resolves.toMatchObject({ t: 'ACK' }) })
    expect(result.current.state.chaos.draft?.picked).toBe(true)
  })

  it('a refused pick leaves the offer open', async () => {
    const { result, sock } = atTheDraft()
    offerTo(sock)
    let p!: Promise<{ t: string }>
    act(() => { p = result.current.pickChaos('o1', 's_shield') })
    const sent = sock().sent.at(-1) as { t: string; reqId: string }
    act(() => sock().receive({ t: 'ERROR', reqId: sent.reqId, code: 'CHAOS_NO_OFFER', message: 'late' }))
    await act(async () => { await p })
    expect(result.current.state.chaos.draft?.picked).toBe(false)
  })

  it('auto-play takes the first offered card at once, one CHAOS_PICK per offer', () => {
    const { result, sock } = atTheDraft()
    act(() => result.current.setAutoPlay(true))
    offerTo(sock)
    expect(picks(sock)).toHaveLength(1)
    expect(picks(sock)[0]).toMatchObject({ offerId: 'o1', cardId: 's_shield' })
    act(() => sock().receive({ t: 'BALANCE', balance: 5 }))
    expect(picks(sock)).toHaveLength(1)
    act(() => sock().receive({ t: 'NOTIFICATION', kind: 'CHAOS_OFFER', payload: { ...OFFER, offerId: 'o2', cardIds: ['s_free_fold'] } }))
    expect(picks(sock)).toHaveLength(2)
    expect(picks(sock)[1]).toMatchObject({ offerId: 'o2', cardId: 's_free_fold' })
  })

  it('without auto-play the player chooses', () => {
    const { sock } = atTheDraft()
    offerTo(sock)
    expect(picks(sock)).toHaveLength(0)
  })

  it('auto-play picks nothing for a spectator\'s draft (no offer) or an offer already picked', () => {
    const { result, sock } = atTheDraft()
    act(() => result.current.setAutoPlay(true))
    act(() => sock().receive({ t: 'ROOM_EVENT', seq: 8, event: { type: 'CHAOS_DRAFT', tier: 'silver', draftMs: 15_000, deadlineAt: OFFER.deadlineAt, seats: [1] } }))
    expect(picks(sock)).toHaveLength(0)
  })

  // ---- BP-39: playing a bonus card, and "Bỏ qua" ----
  const sentOf = (sock: () => FakeSocket, t: string) => sock().sent.filter((m) => (m as { t: string }).t === t)
  const waitBegins = (sock: () => FakeSocket, seq = 8, skipped = 0) =>
    act(() => sock().receive({ t: 'ROOM_EVENT', seq, event: { type: 'RESULT_SKIPS', skipped, total: 2 } }))

  it('playBonus sends CHAOS_USE with the card and a request id', () => {
    const { result, sock } = atTheDraft()
    act(() => { result.current.playBonus(21).catch(() => undefined) })
    expect(sock().sent.at(-1)).toMatchObject({ t: 'CHAOS_USE', uid: 21, reqId: expect.any(String) })
  })

  it('skipResult sends RESULT_SKIP and shows my press only once the server acknowledges', async () => {
    const { result, sock } = atTheDraft()
    waitBegins(sock)
    let p!: Promise<{ t: string }>
    act(() => { p = result.current.skipResult() })
    const sent = sock().sent.at(-1) as { t: string; reqId: string }
    expect(sent).toMatchObject({ t: 'RESULT_SKIP', reqId: expect.any(String) })
    expect(result.current.state.resultSkips).toEqual({ skipped: 0, total: 2, mine: false })
    act(() => sock().receive({ t: 'ACK', reqId: sent.reqId }))
    await act(async () => { await expect(p).resolves.toMatchObject({ t: 'ACK' }) })
    expect(result.current.state.resultSkips).toEqual({ skipped: 0, total: 2, mine: true })
  })

  it('auto-play skips the result wait once, and not when the press is already mine', async () => {
    const { result, sock } = atTheDraft()
    act(() => result.current.setAutoPlay(true))
    expect(sentOf(sock, 'RESULT_SKIP')).toHaveLength(0) // no wait yet
    waitBegins(sock)
    expect(sentOf(sock, 'RESULT_SKIP')).toHaveLength(1)
    const sent = sock().sent.at(-1) as { reqId: string }
    act(() => sock().receive({ t: 'ACK', reqId: sent.reqId }))
    await act(async () => { await Promise.resolve() })
    waitBegins(sock, 9, 1) // another seat pressed: the count moves, my press stands
    expect(sentOf(sock, 'RESULT_SKIP')).toHaveLength(1)
  })

  it('auto-play sends a refused skip once more in that wait, at the next count, and never a third time (M7)', async () => {
    const { result, sock } = atTheDraft()
    act(() => result.current.setAutoPlay(true))
    waitBegins(sock)
    const refuse = async (): Promise<void> => {
      const sent = sock().sent.at(-1) as { reqId: string }
      act(() => sock().receive({ t: 'ERROR', reqId: sent.reqId, code: 'ILLEGAL_ACTION', message: 'busy' }))
      await act(async () => { await Promise.resolve() })
    }
    await refuse()
    expect(sentOf(sock, 'RESULT_SKIP')).toHaveLength(1) // nothing new until the count moves
    waitBegins(sock, 9, 1)
    expect(sentOf(sock, 'RESULT_SKIP')).toHaveLength(2)
    await refuse()
    waitBegins(sock, 10, 0)
    expect(sentOf(sock, 'RESULT_SKIP')).toHaveLength(2)
  })

  it('without auto-play the player presses "Bỏ qua" themselves', () => {
    const { sock } = atTheDraft()
    waitBegins(sock)
    expect(sentOf(sock, 'RESULT_SKIP')).toHaveLength(0)
  })

  it('auto-play sends the skip again after a reconnect whose snapshot says it was lost, and not for a snapshot that is no reconnect', () => {
    const { result, sock } = atTheDraft()
    act(() => result.current.setAutoPlay(true))
    waitBegins(sock)
    expect(sentOf(sock, 'RESULT_SKIP')).toHaveLength(1)
    const snapshot = { t: 'ROOM_SNAPSHOT' as const, seq: 20, room: chaosRoom, hand: null, deadlineAt: null, resultSkips: { skipped: 0, total: 2, mine: false } }
    act(() => sock().receive(snapshot))
    expect(sentOf(sock, 'RESULT_SKIP')).toHaveLength(1) // the room was never unconfirmed: roomReturns did not move
    act(() => sock().receive({ t: 'WELCOME', playerId: 'a', displayName: 'A', balance: 100, serverTime: Date.now() }))
    act(() => sock().receive({ ...snapshot, seq: 21 }))
    expect(sentOf(sock, 'RESULT_SKIP')).toHaveLength(2)
  })
})
