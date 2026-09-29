import type { LegalActions, PlayerAction, RoomConfig } from '@bp/core'
import { describe, expect, it } from 'vitest'
import { createRoomHarness, TEST_ROOM_OPTIONS, type RoomHarness } from '../testing/room-harness.js'
import { RoomError } from './types.js'

const HOLDEM: RoomConfig = { name: 'T', mode: 'holdem', maxPlayers: 4, isPrivate: false, turnTimerSec: 30, autoStart: false, holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 } }
const BLIND: RoomConfig = { name: 'B', mode: 'blind', maxPlayers: 4, isPrivate: false, turnTimerSec: 15, autoStart: false, blind: { holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1000, botCount: 2 } }

type Policy = (playerId: string, legal: LegalActions) => PlayerAction
const passive: Policy = (_id, legal) => ({ kind: legal.kinds.includes('check') ? 'check' : legal.kinds.includes('call') ? 'call' : legal.kinds.includes('play') ? 'play' : 'fold' })
const code = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof RoomError ? e.code : String(e)))
const tick = (h: RoomHarness) => h.room.enqueue(() => undefined)
const events = (h: RoomHarness, id: string) => h.ofType(id, 'GAME_EVENT').map((m) => m.event.type)

/** Drives the current hand to completion: humans follow `policy`, bots/reveals/timers run by advancing the clock. */
async function playOut(h: RoomHarness, policy: Policy = passive, opts: { humanTimeouts?: Set<string> } = {}): Promise<void> {
  let guard = 0
  while (h.room.handActive && guard++ < 300) {
    const hand = h.room.snapshot(null).hand!
    if (hand.phase === 'REVEAL') {
      h.clock.advance(10)
      await tick(h)
      continue
    }
    const humanSeat = hand.phase === 'DECISION'
      ? hand.seats.find((s) => !s.hasDecided && !s.isBot)
      : hand.seats.find((s) => s.seat === hand.actingSeat && !s.isBot)
    if (!humanSeat) {
      h.clock.advance(10) // bot delay
      await tick(h)
      continue
    }
    if (opts.humanTimeouts?.has(humanSeat.playerId)) {
      h.clock.advance(5_000)
      await tick(h)
      continue
    }
    const legal = h.room.snapshot(humanSeat.playerId).hand!.legal!
    await h.room.action(humanSeat.playerId, policy(humanSeat.playerId, legal), h.room.seq)
  }
  if (h.room.handActive) throw new Error('hand did not finish')
  await tick(h)
}

async function seatAndStart(h: RoomHarness, ids: string[], buyIn?: number): Promise<void> {
  for (const [i, id] of ids.entries()) {
    if (id !== h.room.hostPlayerId) await h.room.join(h.identity(id))
    await h.room.sitDown(id, i, buyIn)
    await h.room.setReady(id, true)
  }
  await h.room.startGame(h.room.hostPlayerId)
}

describe('Blind hands', () => {
  it('plays a full hand with bots, settles balances, records history and schedules the next hand', async () => {
    const h = createRoomHarness(BLIND)
    await seatAndStart(h, ['h', 'a'])
    expect(h.room.status).toBe('IN_GAME')
    const first = h.ofType('h', 'GAME_EVENT')
    expect(first.map((m) => m.event.type).slice(0, 2)).toEqual(['HAND_STARTED', 'BLINDS_POSTED'])
    const dealt = first.filter((m) => m.event.type === 'CARDS_DEALT')
    expect(dealt.filter((m) => m.event.type === 'CARDS_DEALT' && m.event.cards.length === 2)).toHaveLength(1) // only my cards
    expect(dealt.every((m) => m.event.type === 'CARDS_DEALT' && m.event.cardCount === 2)).toBe(true)
    const phase = first.find((m) => m.event.type === 'DECISION_PHASE')!
    expect((phase.event as { deadlineAt?: number }).deadlineAt).toBe(h.clock.now() + 5_000)

    await playOut(h, (id, legal) => ({ kind: id === 'h' && legal.kinds.includes('play') ? 'play' : 'fold' }))

    expect(events(h, 'h').at(-1)).toBe('HAND_COMPLETE')
    expect(h.repos.hands).toHaveLength(1)
    const summary = h.repos.hands[0]!
    expect(summary.players).toHaveLength(4)
    expect(summary.players.reduce((s, p) => s + p.net, 0) + summary.fee).toBe(0) // money conservation
    const settled = h.repos.entries.filter((e) => e.entry.reason === 'settlement')
    expect(settled.map((e) => e.entry.playerId).sort()).toEqual(['a', 'h'])
    expect(settled[0]!.meta).toEqual({ refId: summary.handId, fee: summary.fee, kind: 'table_fee' })
    expect(h.repos.sinks).toEqual([{ refId: summary.handId, fee: summary.fee, kind: 'table_fee' }])
    expect(await h.repos.balances.get('a')).toBe(100_000 - 1_000) // folded: lost the ante
    expect(h.last('a', 'BALANCE')).toEqual({ t: 'BALANCE', balance: 99_000 })
    expect(h.domainEvents.at(-1)).toMatchObject({ type: 'HAND_SETTLED', summary: { handId: summary.handId } })
    expect(h.room.nextHandAt).toBe(h.clock.now() + 100)
    expect(h.last('h', 'ROOM_EVENT')?.event).toMatchObject({ type: 'ROOM_STATUS', status: 'IN_GAME', nextHandAt: h.room.nextHandAt })

    h.clock.advance(100)
    await tick(h)
    expect(h.room.handActive).toBe(true)
    expect(events(h, 'h').filter((t) => t === 'HAND_STARTED')).toHaveLength(2)
  })

  it('never records the room password in history or in the ROOM_CREATED-style config', async () => {
    const h = createRoomHarness({ ...BLIND, isPrivate: true, password: 'pw12', blind: { ...BLIND.blind!, botCount: 1 } })
    await h.room.sitDown('h', 0)
    await h.room.setReady('h', true)
    await h.room.startGame('h')
    await playOut(h, () => ({ kind: 'fold' }))
    const recorded = h.repos.hands[0]!.config
    expect((recorded as { password?: string }).password).toBeUndefined()
    expect(Object.hasOwn(recorded, 'password')).toBe(false)
    expect(recorded.hasPassword).toBe(true)
    expect(recorded.name).toBe('B') // the rest of the config survives
    const summarised = h.room.summary().config
    expect(summarised).toEqual(recorded)
  })

  it('carries the pot over when everyone folds and pays it out in a later hand', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 0 } })
    await seatAndStart(h, ['h', 'a'])
    await playOut(h, () => ({ kind: 'fold' }))
    expect(h.room.carryOverPot).toBe(2_000)
    expect(h.room.view().carryOverPot).toBe(2_000)
    h.clock.advance(100)
    await tick(h)
    expect(h.room.snapshot(null).hand?.carryOverIn).toBe(2_000)
    await playOut(h, (id) => ({ kind: id === 'h' ? 'play' : 'fold' }))
    expect(h.room.carryOverPot).toBe(0)
    // hand 1: h −1000, a −1000 (both fold, 2000 carried). hand 2: antes 1000 each on top of the 2000 carry; h plays (+1000);
    // a folds → h's uncalled 1000 is returned; pot 4000, fee 80, h receives 3920 → h net +1920 overall, a −2000.
    expect(await h.repos.balances.get('h')).toBe(100_000 + 1_920)
    expect(await h.repos.balances.get('a')).toBe(100_000 - 2_000)
  })

  it('a human who cannot afford the wager sits out the hand', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 1 } }, { players: [['h', 100_000], ['poor', 3_000]] })
    await seatAndStart(h, ['h', 'poor'])
    await playOut(h, (id) => ({ kind: id === 'poor' ? 'fold' : 'play' })) // poor loses the 1000 ante → 2000 left
    h.repos.records.get('poor')!.balance = 1_500 // e.g. spent elsewhere; below the 2000 requirement
    h.clock.advance(100)
    await tick(h)
    expect(h.room.handActive).toBe(true)
    expect(h.room.snapshot(null).hand!.seats.map((s) => s.playerId).sort()).toEqual(['bot:room-1:0', 'h'])
    expect(h.room.players.get('poor')!.seat).toBe(1) // still seated, just not in this hand
    const seats = h.room.snapshot(null).room.players
    expect(seats.find((p) => p.playerId === 'poor')!.status).toBe('SITTING_OUT')
    expect(seats.find((p) => p.playerId === 'h')!.status).toBe('IN_HAND')
    // topping the balance back up clears the flag on the next attempt to start a hand
    h.repos.records.get('poor')!.balance = 50_000
    await playOut(h, () => ({ kind: 'fold' }))
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
    await tick(h)
    expect(h.room.players.get('poor')!.sittingOut).toBe(false)
  })

  it('SIT_OUT plays the current hand out, skips the ones after it, and SIT_IN deals the player back in', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 2 } }, { players: [['h', 100_000], ['a', 100_000]] })
    await seatAndStart(h, ['h', 'a'])
    const dealtIn = () => h.room.snapshot(null).hand!.seats.some((s) => s.playerId === 'h')
    expect(dealtIn()).toBe(true)

    await h.room.sitOut('h', true)
    expect(dealtIn()).toBe(true) // the decision lands on the next hand, not the one on the table
    // `status` belongs to the hand on the table; the request rides beside it, so a snapshot taken now — a
    // RESYNC, a reconnect — still tells the client their sit-out stands.
    expect(h.room.snapshot(null).room.players.find((p) => p.playerId === 'h')).toMatchObject({ status: 'IN_HAND', sittingOut: true })
    await playOut(h, () => ({ kind: 'fold' }))
    expect(h.room.snapshot(null).room.players.find((p) => p.playerId === 'h')!.status).toBe('SITTING_OUT')

    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
    await tick(h)
    expect(h.room.handActive).toBe(true)
    expect(dealtIn()).toBe(false)
    expect(h.room.players.get('h')!.seat).toBe(0) // the seat is held, not given away
    await playOut(h, () => ({ kind: 'fold' }))

    await h.room.sitOut('h', false)
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
    await tick(h)
    expect(dealtIn()).toBe(true)
  })

  it('five hands skipped in a row take the seat back, stack returned, like the timeout stand-up', async () => {
    const h = createRoomHarness(HOLDEM, { players: [['h', 100_000], ['a', 100_000], ['b', 100_000]] })
    await seatAndStart(h, ['h', 'a', 'b'], 40_000)
    await h.room.sitOut('h', true)
    await playOut(h) // the hand h was already in
    const held = h.room.players.get('h')!.stack

    for (let i = 0; i < TEST_ROOM_OPTIONS.handsSatOutToStand; i++) {
      h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
      await tick(h)
      expect(h.room.snapshot(null).hand?.seats.some((s) => s.playerId === 'h')).toBe(false)
      if (h.room.players.get('h')!.seat === null) break
      await playOut(h)
    }

    expect(h.room.players.get('h')!.seat).toBeNull()
    expect(h.room.players.get('h')!.sitOutRequested).toBe(false) // and the flag goes with the seat
    expect(h.ofType('a', 'ROOM_EVENT').map((m) => m.event).filter((e) => e.type === 'PLAYER_STOOD' && e.playerId === 'h')).toHaveLength(1)
    const cashOut = h.repos.entries.filter((e) => e.entry.playerId === 'h' && e.entry.reason === 'cash_out')
    expect(cashOut.map((e) => e.entry.delta)).toEqual([held]) // every chip they were sitting on, once
    expect(await h.repos.balances.get('h')).toBe(60_000 + held)
  })

  it('a repeated SIT_OUT does not re-arm the counter, so a client cannot park on a seat it never plays', async () => {
    const h = createRoomHarness(HOLDEM, { players: [['h', 100_000], ['a', 100_000], ['b', 100_000]] })
    await seatAndStart(h, ['h', 'a', 'b'], 40_000)
    await h.room.sitOut('h', true)
    await playOut(h) // the hand h was already in

    for (let i = 0; i < TEST_ROOM_OPTIONS.handsSatOutToStand; i++) {
      await h.room.sitOut('h', true) // says nothing, changes nothing — and must not zero the counter
      h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
      await tick(h)
      if (h.room.players.get('h')!.seat === null) break
      await playOut(h)
    }

    expect(h.room.players.get('h')!.seat).toBeNull() // stood up on the fifth skipped hand all the same
  })

  it('a seat that is only short-stacked is never stood up, however many hands it misses', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 2 } }, { players: [['h', 100_000], ['poor', 3_000]] })
    await seatAndStart(h, ['h', 'poor'])
    await playOut(h, () => ({ kind: 'fold' }))
    h.repos.records.get('poor')!.balance = 1_500 // below the 2000 requirement, and they never asked to sit out

    for (let i = 0; i < TEST_ROOM_OPTIONS.handsSatOutToStand + 1; i++) {
      h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
      await tick(h)
      expect(h.room.handActive).toBe(true) // h and the bots keep playing without them
      await playOut(h, () => ({ kind: 'fold' }))
    }

    // The counter is for people who asked to sit out. Standing this seat up would move real money off the
    // table on nobody's request.
    expect(h.room.players.get('poor')!.seat).toBe(1)
    expect(h.room.players.get('poor')!.sittingOut).toBe(true)
    expect(h.room.players.get('poor')!.handsSatOut).toBe(0)
  })

  it('a hand that never starts costs the sitter nothing, and the room does not wedge', async () => {
    const h = createRoomHarness(HOLDEM, { players: [['h', 100_000], ['a', 100_000]] })
    await seatAndStart(h, ['h', 'a'], 40_000)
    await h.room.sitOut('a', true)
    await playOut(h) // the hand 'a' was already in

    // One seat left playing: the next-hand timer finds too few and falls back to OPEN rather than dealing.
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
    await tick(h)
    expect(h.room.status).toBe('OPEN')
    expect(h.room.handActive).toBe(false)
    expect(h.room.players.get('a')!.handsSatOut).toBe(0)

    // Nor do refused starts count: the seat is still theirs after five of them.
    await h.room.setReady('h', true)
    await h.room.setReady('a', true)
    for (let i = 0; i < TEST_ROOM_OPTIONS.handsSatOutToStand; i++) {
      expect(await code(h.room.startGame('h'))).toBe('NOT_ENOUGH_PLAYERS')
    }
    expect(h.room.players.get('a')!.handsSatOut).toBe(0)
    expect(h.room.players.get('a')!.seat).toBe(1)

    // And sitting back in starts the hand the room has been waiting for.
    await h.room.sitOut('a', false)
    await h.room.startGame('h')
    expect(h.room.handActive).toBe(true)
  })

  it('records and emits a hand whose settlement failed, flagged, and pushes nothing to clients', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 1 } })
    await seatAndStart(h, ['h', 'a'])
    const real = h.repos.balances.apply.bind(h.repos.balances)
    h.repos.balances.apply = async (batch, meta) => {
      if (meta?.kind === 'table_fee') throw new Error('ledger unavailable')
      return real(batch, meta)
    }
    const pushedBefore = h.ofType('h', 'BALANCE').length
    await playOut(h, (id) => ({ kind: id === 'h' ? 'play' : 'fold' }))
    const summary = h.repos.hands[0]!
    expect(summary.settlementError).toContain('ledger unavailable')
    expect(h.domainEvents.at(-1)).toMatchObject({ type: 'HAND_SETTLED', summary: { handId: summary.handId } })
    expect(h.ofType('h', 'BALANCE').length).toBe(pushedBefore) // nothing moved, so nothing is pushed
    expect(await h.repos.balances.get('h')).toBe(100_000)
    expect(await h.repos.balances.get('a')).toBe(100_000)
    expect(h.repos.sinks).toEqual([]) // the fee sink is part of the same rejected transaction
  })

  it('the host kicks a bot between hands, never out of the hand it holds cards in, and the next deal goes on without it (T3)', async () => {
    const h = createRoomHarness(BLIND)
    await seatAndStart(h, ['h', 'a'])
    const bot = [...h.room.players.values()].find((p) => p.identity.isBot)!.identity.playerId
    expect(await code(h.room.kick('h', bot))).toBe('GAME_IN_PROGRESS')
    expect(h.room.hasPlayer(bot)).toBe(true)

    await playOut(h)
    expect(h.room.status).toBe('IN_GAME') // between hands: the next deal is on its timer
    const rows = h.repos.entries.length
    const sinks = h.repos.sinks.length
    await h.room.kick('h', bot)
    expect(h.room.hasPlayer(bot)).toBe(false)
    expect(h.repos.entries).toHaveLength(rows) // a bot's chips are not anyone's points
    expect(h.repos.sinks).toHaveLength(sinks)

    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
    await tick(h)
    expect(h.room.handActive).toBe(true)
    const dealt = h.room.snapshot(null).hand!.seats.map((s) => s.playerId)
    expect(dealt).toHaveLength(3)
    expect(dealt).not.toContain(bot)
  })
})

describe('Hold’em hands', () => {
  it('two humans check down to showdown; only table stacks move', async () => {
    const h = createRoomHarness(HOLDEM)
    await seatAndStart(h, ['h', 'a'], 20_000)
    await playOut(h)
    const stacks = [h.room.players.get('h')!.stack, h.room.players.get('a')!.stack]
    const fee = h.repos.hands[0]!.fee
    expect(stacks[0]! + stacks[1]! + fee).toBe(40_000)
    expect(fee).toBeGreaterThan(0)
    expect(h.repos.entries.map((e) => e.entry.reason)).toEqual(['buy_in', 'buy_in']) // no settlement entries for hold'em
    expect(h.repos.sinks).toEqual([{ refId: h.repos.hands[0]!.handId, fee, kind: 'table_fee' }]) // …but the fee sink is still recorded
    expect(events(h, 'a')).toContain('SHOWDOWN')
  })

  it('rejects stale, out-of-turn, illegal and non-seated actions with the right codes', async () => {
    const h = createRoomHarness(HOLDEM)
    await seatAndStart(h, ['h', 'a'], 20_000)
    await h.room.join(h.identity('b'))
    const hand = h.room.snapshot(null).hand!
    const acting = hand.seats.find((s) => s.seat === hand.actingSeat)!.playerId
    const other = acting === 'h' ? 'a' : 'h'
    expect(await code(h.room.action(acting, { kind: 'call' }, 0))).toBe('STALE_STATE')
    expect(await code(h.room.action(other, { kind: 'call' }, h.room.seq))).toBe('NOT_YOUR_TURN')
    expect(await code(h.room.action(acting, { kind: 'check' }, h.room.seq))).toBe('ILLEGAL_ACTION') // facing the big blind
    expect(await code(h.room.action(acting, { kind: 'raise', amount: 999_999 }, h.room.seq))).toBe('INVALID_AMOUNT')
    expect(await code(h.room.action('b', { kind: 'call' }, h.room.seq))).toBe('NOT_SEATED')
    await h.room.action(acting, { kind: 'call' }, h.room.seq)
    expect(h.last(other, 'GAME_EVENT')?.event.type).toBe('TURN_CHANGED')
  })

  it('three consecutive timeouts stand a player up after the hand; a lone seat returns the room to OPEN', async () => {
    const h = createRoomHarness(HOLDEM)
    await seatAndStart(h, ['h', 'a'], 20_000)
    let hands = 0
    while (h.room.players.get('h')!.seat !== null && hands++ < 6) {
      await playOut(h, passive, { humanTimeouts: new Set(['h']) })
      if (h.room.players.get('h')!.seat === null) break
      h.clock.advance(100)
      await tick(h)
    }
    expect(h.room.players.get('h')!.seat).toBeNull()
    expect(h.repos.entries.filter((e) => e.entry.reason === 'cash_out' && e.entry.playerId === 'h')).toHaveLength(1)
    expect(h.last('a', 'ROOM_EVENT')?.event.type).toBe('ROOM_STATUS')
    h.clock.advance(100)
    await tick(h)
    expect(h.room.status).toBe('OPEN') // only one seat left → back to OPEN, ready cleared
    expect(h.room.players.get('a')!.ready).toBe(false)
    expect(h.room.snapshot(null).room.status).toBe('OPEN')
  })

  it('a busted player is stood up and can re-buy', async () => {
    const h = createRoomHarness(HOLDEM, { players: [['h', 100_000], ['a', 100_000]] })
    await seatAndStart(h, ['h', 'a'], 10_000)
    await playOut(h, (_id, legal) => ({ kind: legal.kinds.includes('allIn') ? 'allIn' : legal.kinds.includes('call') ? 'call' : 'check' }))
    const busted = [...h.room.players.values()].find((p) => p.stack === 0 && p.seat === null)
    expect(busted).toBeDefined() // one of them lost everything (if the seeded deck ties, change the harness seed)
    expect(await h.repos.balances.get(busted!.identity.playerId)).toBe(90_000)
    await h.room.sitDown(busted!.identity.playerId, 3, 10_000)
    expect(h.room.players.get(busted!.identity.playerId)!.seat).toBe(3)
  })
})

describe('Leaving, disconnecting, shutting down', () => {
  it('leaving mid-hand auto-folds, removes the player after the hand and transfers the host', async () => {
    const h = createRoomHarness(HOLDEM)
    await seatAndStart(h, ['h', 'a'], 20_000)
    await h.room.leave('h')
    expect(h.room.hasPlayer('h')).toBe(true) // still in the hand until it ends
    await playOut(h) // h auto-folds when its turn comes → a wins
    expect(h.room.handActive).toBe(false)
    expect(h.room.hasPlayer('h')).toBe(false)
    expect(h.room.hostPlayerId).toBe('a')
    expect(await h.repos.balances.get('h')).toBeLessThan(100_000) // lost a blind, cashed out the rest
    expect(h.repos.hands).toHaveLength(1)
  })

  it('a player whose mid-hand Leave takes effect at the end of the hand hears their own PLAYER_LEFT, once', async () => {
    // Review of T5: a Leave pressed mid-hand, then a reconnect that put the player back on the room screen while the
    // hand finished. They were removed without a word, and their screen froze on a room that no longer had them.
    const h = createRoomHarness(HOLDEM)
    await seatAndStart(h, ['h', 'a'], 20_000)
    await h.room.leave('a')
    const left = () => h.ofType('a', 'ROOM_EVENT').filter((m) => m.event.type === 'PLAYER_LEFT' && m.event.playerId === 'a')
    expect(left()).toHaveLength(0) // not yet: still in the hand
    await playOut(h)
    expect(h.room.hasPlayer('a')).toBe(false)
    expect(left()).toHaveLength(1)
    // …and it is the last thing the room says to them.
    expect(h.sent.get('a')!.at(-1)).toMatchObject({ t: 'ROOM_EVENT', event: { type: 'PLAYER_LEFT', playerId: 'a' } })
  })

  it('a disconnected player removed after the spectator grace is sent nothing: there is no socket to hear it', async () => {
    const h = createRoomHarness(HOLDEM)
    await h.room.join(h.identity('a'))
    await h.room.onDisconnect('a')
    const before = (h.sent.get('a') ?? []).length
    h.clock.advance(TEST_ROOM_OPTIONS.reconnectWindowMs)
    await tick(h)
    h.clock.advance(TEST_ROOM_OPTIONS.spectatorGraceMs)
    await tick(h)
    expect(h.room.hasPlayer('a')).toBe(false)
    expect(h.last('h', 'ROOM_EVENT')?.event).toMatchObject({ type: 'PLAYER_LEFT', playerId: 'a' })
    expect((h.sent.get('a') ?? []).length).toBe(before)
  })

  it('disconnect: others are told, the player receives nothing, reconnect restores delivery; expiry stands up then removes', async () => {
    const h = createRoomHarness(BLIND)
    await seatAndStart(h, ['h', 'a'])
    const before = h.ofType('a', 'GAME_EVENT').length
    await h.room.onDisconnect('a')
    expect(h.last('h', 'ROOM_EVENT')?.event).toMatchObject({ type: 'PLAYER_DISCONNECTED', playerId: 'a', deadline: h.clock.now() + 1_000 })
    expect(h.room.snapshot(null).room.players.find((p) => p.playerId === 'a')?.status).toBe('DISCONNECTED')
    await h.room.action('h', { kind: 'play' }, h.room.seq)
    expect(h.ofType('a', 'GAME_EVENT').length).toBe(before) // nothing delivered while disconnected
    await h.room.onReconnect('a')
    expect(h.last('h', 'ROOM_EVENT')?.event).toMatchObject({ type: 'PLAYER_RECONNECTED', playerId: 'a' })
    expect(h.room.snapshot('a').hand?.mySeat).toBe(1)

    await h.room.onDisconnect('a')
    h.clock.advance(1_000) // reconnect window → auto-fold + stand after hand
    await tick(h)
    expect(h.room.snapshot(null).hand!.seats.find((s) => s.seat === 1)?.hasDecided).toBe(true)
    await playOut(h)
    expect(h.room.players.get('a')!.seat).toBeNull()
    h.clock.advance(2_000) // spectator grace
    await tick(h)
    expect(h.room.hasPlayer('a')).toBe(false)
  })

  it('shutdown cancels the hand, refunds, cashes out and closes', async () => {
    const h = createRoomHarness(HOLDEM)
    await seatAndStart(h, ['h', 'a'], 20_000)
    const hand = h.room.snapshot(null).hand!
    const acting = hand.seats.find((s) => s.seat === hand.actingSeat)!.playerId
    await h.room.action(acting, { kind: 'raise', amount: 1_000 }, h.room.seq)
    let closed: string | null = null
    h.room.onClosed = (_r, reason) => { closed = reason }
    await h.room.shutdown('maintenance')
    expect(closed).toBe('maintenance')
    expect(h.room.status).toBe('CLOSED')
    expect(events(h, 'a')).toContain('HAND_CANCELLED')
    expect(h.last('a', 'ROOM_EVENT')?.event).toMatchObject({ type: 'ROOM_CLOSED', reason: 'maintenance' })
    expect(await h.repos.balances.get('h')).toBe(100_000)
    expect(await h.repos.balances.get('a')).toBe(100_000)
    expect(h.repos.hands[0]!.cancelled).toBe(true)
  })

  it('shutdown splits a carried-over pot among seated humans and sinks the remainder', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 0 } })
    await seatAndStart(h, ['h', 'a'])
    await playOut(h, () => ({ kind: 'fold' })) // both fold → 2000 carried
    expect(h.room.carryOverPot).toBe(2_000)
    await h.room.join(h.identity('b')) // a third human takes a seat before the shutdown
    await h.room.sitDown('b', 2)
    await h.room.shutdown('restart')
    // 2000 / 3 seated humans = 666 each, 2 left over → recorded as a carry_over sink, not given away.
    expect(h.repos.entries.filter((e) => e.entry.reason === 'refund').map((e) => e.entry.delta)).toEqual([666, 666, 666])
    expect(h.repos.sinks).toEqual([{ refId: 'room-1', fee: 2, kind: 'carry_over' }])
    expect(await h.repos.balances.get('h')).toBe(99_666) // −1000 ante + 666
    expect(await h.repos.balances.get('a')).toBe(99_666)
    expect(await h.repos.balances.get('b')).toBe(100_666)
    expect(h.room.carryOverPot).toBe(0)
    const total = (await h.repos.balances.get('h')) + (await h.repos.balances.get('a')) + (await h.repos.balances.get('b'))
    expect(total + h.repos.sinks.reduce((s, x) => s + x.fee, 0)).toBe(300_000)
  })

  it('releases a carry-over pot to the seated humans once the room cannot start a hand for carryOverReleaseMs', async () => {
    // 'poor' can afford exactly one wager: after the all-fold hand its balance (1500) is below the
    // 2 × 1000 requirement, so no further hand can start while both players stay seated.
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 0 } }, { players: [['h', 100_000], ['poor', 2_500]] })
    await seatAndStart(h, ['h', 'poor'])
    await playOut(h, () => ({ kind: 'fold' }))
    expect(h.room.carryOverPot).toBe(2_000)
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs) // next-hand timer fires, nobody is eligible → OPEN + release armed
    await tick(h)
    expect(h.room.status).toBe('OPEN')
    expect(h.room.carryOverPot).toBe(2_000)
    h.clock.advance(TEST_ROOM_OPTIONS.carryOverReleaseMs)
    await tick(h)
    expect(h.room.carryOverPot).toBe(0)
    expect(await h.repos.balances.get('h')).toBe(100_000) // −1000 ante + 1000 share
    expect(await h.repos.balances.get('poor')).toBe(2_500)
    expect(h.repos.sinks).toEqual([]) // 2000 split evenly between two seated humans: nothing left over
    expect(h.last('h', 'BALANCE')).toEqual({ t: 'BALANCE', balance: 100_000 })
    expect(h.last('h', 'ROOM_EVENT')?.event).toMatchObject({ type: 'ROOM_STATUS', status: 'OPEN' })
    expect(h.room.view().carryOverPot).toBe(0)
  })

  it('sinks the whole carry-over pot when the room closes with nobody seated', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 0 } })
    await seatAndStart(h, ['h', 'a'])
    await playOut(h, () => ({ kind: 'fold' }))
    expect(h.room.carryOverPot).toBe(2_000)
    await h.room.leave('h')
    await h.room.leave('a')
    h.clock.advance(TEST_ROOM_OPTIONS.emptyRoomCloseMs)
    await tick(h)
    expect(h.room.status).toBe('CLOSED')
    expect(h.room.carryOverPot).toBe(0)
    expect(h.repos.sinks).toEqual([{ refId: 'room-1', fee: 2_000, kind: 'carry_over' }])
    const total = (await h.repos.balances.get('h')) + (await h.repos.balances.get('a'))
    expect(total + h.repos.sinks.reduce((s, x) => s + x.fee, 0)).toBe(200_000)
  })
})

describe('Money conservation over many hands', () => {
  it('blind: Σ human balance changes + bot nets + fees = 0 across 12 hands with a mixed policy', async () => {
    const h = createRoomHarness(BLIND, { seed: 7 })
    await seatAndStart(h, ['h', 'a'])
    let n = 0
    const policy: Policy = (id, legal) => ({ kind: legal.kinds.includes('play') && (id === 'h' ? n % 3 !== 0 : n % 2 === 0) ? 'play' : 'fold' })
    while (n++ < 12) {
      await playOut(h, policy)
      h.clock.advance(100)
      await tick(h)
    }
    const totalFees = h.repos.hands.reduce((s, x) => s + x.fee, 0)
    const botNet = h.repos.hands.flatMap((x) => x.players).filter((p) => p.isBot).reduce((s, p) => s + p.net, 0)
    const humanDelta = (await h.repos.balances.get('h')) + (await h.repos.balances.get('a')) - 200_000
    const sinkTotal = h.repos.sinks.reduce((s, x) => s + x.fee, 0)
    // every fee the engine took is recorded as a table_fee sink row, and nothing else is
    expect(h.repos.sinks.filter((x) => x.kind === 'table_fee').reduce((s, x) => s + x.fee, 0)).toBe(totalFees)
    expect(humanDelta + botNet + sinkTotal + h.room.carryOverPot).toBe(0)
    const seqs = h.ofType('h', 'GAME_EVENT').map((m) => m.seq)
    expect(seqs.every((s, i) => i === 0 || s > seqs[i - 1]!)).toBe(true)
  })
})
