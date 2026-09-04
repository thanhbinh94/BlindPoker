import type { RoomConfig } from '@bp/core'
import { describe, expect, it } from 'vitest'
import { createRoomHarness, TEST_ROOM_OPTIONS } from '../testing/room-harness.js'
import { RoomError } from './types.js'

const HOLDEM: RoomConfig = { name: 'T', mode: 'holdem', maxPlayers: 4, isPrivate: false, turnTimerSec: 30, autoStart: false, holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 } }
const BLIND: RoomConfig = { name: 'B', mode: 'blind', maxPlayers: 4, isPrivate: true, password: 'pw12', turnTimerSec: 15, autoStart: false, blind: { holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1000, botCount: 2 } }

const code = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof RoomError ? e.code : String(e)))

describe('Room membership', () => {
  it('starts with the host in the room and bots seated at the top seats (blind)', () => {
    const h = createRoomHarness(BLIND)
    expect(h.room.hostPlayerId).toBe('h')
    expect(h.room.humanCount).toBe(1)
    const bots = [...h.room.players.values()].filter((p) => p.identity.isBot)
    expect(bots.map((b) => b.seat).sort()).toEqual([2, 3])
    expect(bots.every((b) => b.ready && b.connected)).toBe(true)
    expect(h.room.summary()).toMatchObject({ code: 'ABC234', mode: 'blind', playerCount: 1, maxPlayers: 4, status: 'OPEN', config: { hasPassword: true } })
    expect((h.room.summary().config as { password?: string }).password).toBeUndefined()
  })

  it('join: password, capacity, duplicates; leave: host transfer and empty-room close', async () => {
    const h = createRoomHarness(BLIND, { players: [['h', 1e5], ['a', 1e5], ['b', 1e5], ['c', 1e5], ['d', 1e5]] })
    expect(await code(h.room.join(h.identity('a'), 'nope'))).toBe('WRONG_PASSWORD')
    await h.room.join(h.identity('a'), 'pw12')
    expect(await code(h.room.join(h.identity('a'), 'pw12'))).toBe('ALREADY_IN_ROOM')
    expect(h.last('h', 'ROOM_EVENT')?.event).toMatchObject({ type: 'PLAYER_JOINED', player: { playerId: 'a' } })
    expect(h.domainEvents.at(-1)).toMatchObject({ type: 'ROOM_JOINED', playerId: 'a' })
    await h.room.join(h.identity('b'), 'pw12')
    await h.room.join(h.identity('c'), 'pw12')
    expect(await code(h.room.join(h.identity('d'), 'pw12'))).toBe('ROOM_FULL') // 4 humans = maxPlayers
    await h.room.leave('h')
    expect(h.room.hostPlayerId).toBe('a') // earliest joiner
    expect(h.last('a', 'ROOM_EVENT')?.event).toMatchObject({ type: 'HOST_CHANGED', hostPlayerId: 'a' })
    expect(await code(h.room.leave('h'))).toBe('NOT_IN_ROOM')
    let closed: string | null = null
    h.room.onClosed = (_r, reason) => { closed = reason }
    await h.room.leave('a'); await h.room.leave('b'); await h.room.leave('c')
    expect(h.room.status).toBe('OPEN')
    h.clock.advance(500)
    await h.room.enqueue(() => undefined)
    expect(h.room.status).toBe('CLOSED')
    expect(closed).toBe('empty')
  })
})

describe('Room seats and buy-ins', () => {
  it('hold’em sit-down validates the seat and buy-in, moves points to the table, and stand-up returns them', async () => {
    const h = createRoomHarness(HOLDEM)
    await h.room.join(h.identity('a'))
    expect(await code(h.room.sitDown('a', 9, 20_000))).toBe('ILLEGAL_ACTION')
    expect(await code(h.room.sitDown('a', 0, 5_000))).toBe('INVALID_AMOUNT') // min 50 BB = 10_000
    expect(await code(h.room.sitDown('a', 0, 50_000))).toBe('INVALID_AMOUNT') // max 200 BB = 40_000
    expect(await code(h.room.sitDown('a', 0))).toBe('INVALID_AMOUNT')
    await h.room.sitDown('a', 0, 20_000)
    expect(await h.repos.balances.get('a')).toBe(80_000)
    expect(h.room.players.get('a')!.stack).toBe(20_000)
    expect(await code(h.room.sitDown('h', 0, 20_000))).toBe('SEAT_TAKEN')
    expect(await code(h.room.sitDown('a', 1, 20_000))).toBe('ILLEGAL_ACTION') // already seated
    expect(h.last('h', 'ROOM_EVENT')?.event).toMatchObject({ type: 'PLAYER_SAT', playerId: 'a', seat: 0, stack: 20_000 })
    await h.room.standUp('a')
    expect(await h.repos.balances.get('a')).toBe(100_000)
    expect(h.room.players.get('a')!.seat).toBeNull()
    expect(await code(h.room.standUp('a'))).toBe('NOT_SEATED')
    expect(h.repos.entries.map((e) => e.entry.reason)).toEqual(['buy_in', 'cash_out'])
  })

  it('rejects a hold’em buy-in the player cannot afford', async () => {
    const h = createRoomHarness(HOLDEM, { players: [['h', 100_000], ['poor', 15_000]] })
    await h.room.join(h.identity('poor'))
    expect(await code(h.room.sitDown('poor', 1, 20_000))).toBe('INSUFFICIENT_BALANCE')
    expect(await h.repos.balances.get('poor')).toBe(15_000)
  })

  it('blind sit-down needs the required balance and never moves points', async () => {
    const h = createRoomHarness(BLIND, { players: [['h', 100_000], ['poor', 1_500]] })
    await h.room.join(h.identity('poor'), 'pw12')
    expect(await code(h.room.sitDown('poor', 0))).toBe('INSUFFICIENT_BALANCE') // needs 2 × 1000
    await h.room.sitDown('h', 0)
    expect(h.room.players.get('h')!.stack).toBe(100_000)
    expect(h.repos.entries).toHaveLength(0)
    expect(await code(h.room.sitDown('h', 2))).toBe('ILLEGAL_ACTION') // seat 2 is a bot's — and h is already seated
  })

  it('ready needs a seat and an OPEN room; start needs the host and two ready seats', async () => {
    const h = createRoomHarness(HOLDEM)
    await h.room.join(h.identity('a'))
    expect(await code(h.room.setReady('a', true))).toBe('NOT_SEATED')
    await h.room.sitDown('h', 0, 20_000)
    await h.room.sitDown('a', 1, 20_000)
    expect(await code(h.room.startGame('a'))).toBe('NOT_HOST')
    expect(await code(h.room.startGame('h'))).toBe('NOT_ENOUGH_PLAYERS')
    await h.room.setReady('h', true)
    expect(h.last('a', 'ROOM_EVENT')?.event).toMatchObject({ type: 'PLAYER_READY', playerId: 'h', ready: true })
    await h.room.setReady('a', true)
    await h.room.startGame('h')
    expect(h.room.status).toBe('IN_GAME')
    expect(h.room.handActive).toBe(true)
    expect(await code(h.room.setReady('a', false))).toBe('GAME_IN_PROGRESS')
    expect(await code(h.room.startGame('h'))).toBe('GAME_IN_PROGRESS')
  })

  it('autoStart begins the hand when every seated human is ready', async () => {
    const h = createRoomHarness({ ...HOLDEM, autoStart: true })
    await h.room.join(h.identity('a'))
    await h.room.sitDown('h', 0, 20_000)
    await h.room.sitDown('a', 1, 20_000)
    await h.room.setReady('h', true)
    expect(h.room.status).toBe('OPEN')
    await h.room.setReady('a', true)
    expect(h.room.status).toBe('IN_GAME')
  })

  it('kick removes a non-playing member and notifies them', async () => {
    const h = createRoomHarness(HOLDEM)
    await h.room.join(h.identity('a'))
    expect(await code(h.room.kick('a', 'h'))).toBe('NOT_HOST')
    await h.room.kick('h', 'a')
    expect(h.room.hasPlayer('a')).toBe(false)
    expect(h.last('a', 'NOTIFICATION')).toMatchObject({ kind: 'KICKED' })
    expect(h.last('h', 'ROOM_EVENT')?.event).toMatchObject({ type: 'PLAYER_LEFT', playerId: 'a' })
  })
})

describe('Closed rooms', () => {
  it('refuses every mutation once the room is closed, so nothing can move points into or out of it', async () => {
    const h = createRoomHarness(HOLDEM)
    await h.room.join(h.identity('a'))
    await h.room.shutdown('maintenance')
    expect(h.room.status).toBe('CLOSED')
    const attempts: Promise<unknown>[] = [
      h.room.join(h.identity('b')),
      h.room.leave('a'),
      h.room.sitDown('a', 0, 20_000),
      h.room.standUp('a'),
      h.room.setReady('a', true),
      h.room.startGame('h'),
      h.room.kick('h', 'a'),
      h.room.action('a', { kind: 'call' }, 0),
    ]
    for (const attempt of attempts) expect(await code(attempt)).toBe('ROOM_NOT_FOUND')
    expect(await h.repos.balances.get('a')).toBe(100_000) // the buy-in never happened
    expect(h.repos.entries).toEqual([])
  })
})

describe('Room snapshot', () => {
  it('describes players, seats, statuses and the hand for the viewer', async () => {
    const h = createRoomHarness(BLIND)
    await h.room.join(h.identity('a'), 'pw12')
    await h.room.sitDown('h', 0)
    await h.room.sitDown('a', 1)
    await h.room.setReady('h', true)
    const snap = h.room.snapshot('a')
    expect(snap.t).toBe('ROOM_SNAPSHOT')
    expect(snap.hand).toBeNull()
    expect(snap.deadlineAt).toBeNull()
    expect(snap.room.hostPlayerId).toBe('h')
    expect(snap.room.players.map((p) => [p.playerId, p.seat, p.status, p.isHost])).toEqual([
      ['h', 0, 'READY', true], ['bot:room-1:0', 3, 'READY', false], ['bot:room-1:1', 2, 'READY', false], ['a', 1, 'SEATED', false],
    ])
    await h.room.setReady('a', true)
    await h.room.startGame('h')
    const inHand = h.room.snapshot('a')
    expect(inHand.hand?.mySeat).toBe(1)
    expect(inHand.hand?.seats.find((s) => s.seat === 1)?.holeCards).toHaveLength(2)
    expect(inHand.hand?.seats.find((s) => s.seat === 0)?.holeCards).toBeNull()
    expect(inHand.hand?.legal?.kinds).toEqual(['play', 'fold'])
    expect(inHand.deadlineAt).toBe(h.clock.now() + 5_000)
    expect(h.room.snapshot(null).hand?.seats.every((s) => s.holeCards === null)).toBe(true)
  })
})

describe('Bot-only rooms', () => {
  it('never starts a hand with no humans, and closes the empty room once the current hand finishes', async () => {
    const h = createRoomHarness(BLIND)
    await h.room.sitDown('h', 0)
    await h.room.setReady('h', true)
    await h.room.startGame('h')
    expect(h.room.handActive).toBe(true)
    await h.room.leave('h')

    // drive the (human-less-from-here) hand to completion via the bots' own timers
    for (let i = 0; i < 1000 && h.room.handActive; i++) {
      h.clock.advance(10)
      await h.room.enqueue(() => undefined)
    }
    // HandRunner marks itself complete (handActive flips false) before the room's own
    // onHandComplete() cleanup — nested-enqueued from inside the timer callback that just
    // finished the hand — actually runs. A couple more queue flushes let that settle
    // (settlement, history.recordHand, player removal) before we assert on its effects.
    await h.room.enqueue(() => undefined)
    await h.room.enqueue(() => undefined)
    expect(h.room.handActive).toBe(false)

    // the next-hand timer fires, but with zero humans eligible the room must NOT start a bot-only hand
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
    await h.room.enqueue(() => undefined)
    expect(h.room.handActive).toBe(false)
    expect(h.room.status).toBe('OPEN')

    // the empty-room grace period elapses and the room closes
    h.clock.advance(TEST_ROOM_OPTIONS.emptyRoomCloseMs)
    await h.room.enqueue(() => undefined)
    expect(h.room.status).toBe('CLOSED')
    expect(h.repos.hands).toHaveLength(1)
  })

  it('cancels and records a hand that is still in flight when the room closes', async () => {
    // Once the fix above is in place, a bot-only hand can never actually be running when the
    // empty-room timer fires (eligibleForHand always requires a human, and a human still counted
    // in the room can't be removed until their own hand completes). So this exercises the private
    // close() path directly, the same way it is reached from the empty-room timer, to verify it
    // still cancels and records an in-flight hand instead of dropping it (mirrors shutdown()).
    const h = createRoomHarness(BLIND, { options: { botDelayMs: [10_000, 10_000] } })
    await h.room.sitDown('h', 0)
    await h.room.setReady('h', true)
    await h.room.startGame('h')
    expect(h.room.handActive).toBe(true)

    await h.room.enqueue(() => (h.room as unknown as { close(reason: string): Promise<void> }).close('empty'))

    expect(h.room.status).toBe('CLOSED')
    expect(h.room.handActive).toBe(false)
    expect(h.repos.hands).toHaveLength(1)
    expect(h.repos.hands.at(-1)?.cancelled).toBe(true)
  })
})

describe('Rejoin mid-hand', () => {
  it('clears the stand-after-hand flag so a player who rejoins before the hand ends keeps their seat and stack', async () => {
    const h = createRoomHarness(HOLDEM)
    await h.room.join(h.identity('a'))
    await h.room.sitDown('h', 0, 20_000)
    await h.room.sitDown('a', 1, 20_000)
    await h.room.setReady('h', true)
    await h.room.setReady('a', true)
    await h.room.startGame('h')
    expect(h.room.handActive).toBe(true)

    await h.room.leave('h')
    await h.room.join(h.identity('h'))

    // drive the hand to completion: h is auto-folded already, so only 'a' ever needs a real decision
    for (let i = 0; i < 1000 && h.room.handActive; i++) {
      const snap = h.room.snapshot('a')
      const legal = snap.hand?.legal
      if (legal) {
        const kind = legal.kinds.includes('check') ? 'check' : legal.kinds.includes('call') ? 'call' : 'fold'
        await h.room.action('a', { kind }, snap.seq)
      } else {
        h.clock.advance(10)
        await h.room.enqueue(() => undefined)
      }
    }
    // Same queue-flush caveat as above: let the room's own onHandComplete() cleanup fully settle.
    await h.room.enqueue(() => undefined)
    await h.room.enqueue(() => undefined)
    expect(h.room.handActive).toBe(false)

    expect(h.room.hasPlayer('h')).toBe(true)
    expect(h.room.players.get('h')?.seat).toBe(0)
    expect(h.repos.entries.some((e) => e.entry.playerId === 'h' && e.entry.reason === 'cash_out')).toBe(false)
  })
})
