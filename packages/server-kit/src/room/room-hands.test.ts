import { CHAOS_CARDS_SPEC, type BotStrategy, type LegalActions, type PlayerAction, type RoomConfig } from '@bp/core'
import { describe, expect, it } from 'vitest'
import type { BalanceEntry, SettlementMeta } from '../repositories.js'
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
    if (hand.phase === 'SQUEEZE') {
      for (const s of hand.seats) if (!s.isBot && !s.revealed) await h.room.reveal(s.playerId)
      await tick(h)
      continue
    }
    // The decision round is table-wide: whoever is not letting the timer run decides first, or the timer would take
    // them along with the seat that is.
    const undecided = hand.phase === 'DECISION' ? hand.seats.filter((s) => !s.hasDecided && !s.isBot) : []
    const humanSeat = hand.phase === 'DECISION'
      ? undecided.find((s) => !opts.humanTimeouts?.has(s.playerId)) ?? undecided[0]
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
  it('plays a full hand with bots, settles the table stacks, records history and schedules the next hand', async () => {
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
    expect(summary.fee).toBe(0) // plan 27 D1: Blind takes no table fee
    expect(summary.players.reduce((s, p) => s + p.net, 0)).toBe(0) // money conservation
    // Spec 2026-09-29 (table limit): both seats bought in with 10.000; the hand moves table stacks only and writes no
    // ledger row at all — no fee, so no fee sink.
    expect(h.repos.entries.map((e) => e.entry.reason)).toEqual(['buy_in', 'buy_in'])
    expect(h.repos.sinks).toEqual([])
    expect(h.room.players.get('a')!.stack).toBe(10_000 - 1_000) // folded: lost the ante
    expect(await h.repos.balances.get('a')).toBe(100_000 - 10_000)
    expect(h.last('a', 'BALANCE')).toEqual({ t: 'BALANCE', balance: 90_000 }) // pushed at the buy-in, not by the hand
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
    // a folds → h's uncalled 1000 is returned; pot 4000, no fee, h receives it all → h's stack 10000 + 2000, a's 10000 − 2000.
    expect(h.room.players.get('h')!.stack).toBe(10_000 + 2_000)
    expect(h.room.players.get('a')!.stack).toBe(10_000 - 2_000)
    expect(await h.repos.balances.get('h')).toBe(90_000) // the balances only moved at the buy-in
  })

  it('a table that goes back to waiting because only bots are left tells every human their ready flag is cleared, so "Chơi tiếp" then "Sẵn sàng" then "Bắt đầu" deals (E6)', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 2 } }, { players: [['h', 100_000]] })
    await seatAndStart(h, ['h'])
    await h.room.sitOut('h', true)
    await playOut(h, () => ({ kind: 'fold' }))
    expect(h.room.players.get('h')!.ready).toBe(true) // the hand on the table does not touch it
    const readyEvents = () => h.ofType('h', 'ROOM_EVENT').map((m) => m.event).filter((e) => e.type === 'PLAYER_READY')
    const before = readyEvents().length

    // The only human sits out, so the next hand would be bots only: the table goes back to waiting.
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
    await tick(h)
    expect(h.room.status).toBe('OPEN')
    expect(h.room.handActive).toBe(false)
    expect(h.room.players.get('h')!.ready).toBe(false)
    // ...and the client is told, or it keeps showing "Hủy sẵn sàng" for a flag the server no longer holds.
    expect(readyEvents().slice(before)).toEqual([{ type: 'PLAYER_READY', playerId: 'h', ready: false }])

    // A seat that was not ready has nothing to announce.
    await h.room.sitOut('h', false)
    expect(await code(h.room.startGame('h'))).toBe('NOT_ENOUGH_PLAYERS') // nobody is ready yet, as the client now shows
    await h.room.setReady('h', true) // autoStart is off, so this only readies
    await h.room.startGame('h')
    expect(h.room.handActive).toBe(true)
  })

  it('a table that goes back to waiting announces PLAYER_READY false only for the humans who were ready', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 2 } }, { players: [['h', 100_000], ['a', 100_000]] })
    await h.room.join(h.identity('a'))
    await h.room.sitDown('h', 0)
    await h.room.sitDown('a', 1) // seated but never readied: the host starts with the bots and 'h'
    await h.room.setReady('h', true)
    await h.room.startGame('h')
    await h.room.sitOut('h', true)
    await h.room.sitOut('a', true)
    await playOut(h, () => ({ kind: 'fold' }))
    const cleared = () => h.ofType('h', 'ROOM_EVENT').map((m) => m.event).filter((e) => e.type === 'PLAYER_READY' && !e.ready)
    const before = cleared().length

    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
    await tick(h)
    expect(h.room.status).toBe('OPEN')
    expect(cleared().slice(before)).toEqual([{ type: 'PLAYER_READY', playerId: 'h', ready: false }]) // not 'a', not a bot
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
    // Blind writes no settlement row since plan 27 (no fee), so the one table that still settles — Hold'em — is used.
    const h = createRoomHarness(HOLDEM)
    await seatAndStart(h, ['h', 'a'], 20_000)
    const real = h.repos.balances.apply.bind(h.repos.balances)
    h.repos.balances.apply = async (batch, meta, opts) => {
      if (meta?.kind === 'table_fee') throw new Error('ledger unavailable')
      return real(batch, meta, opts)
    }
    const pushedBefore = h.ofType('h', 'BALANCE').length
    await playOut(h)
    const summary = h.repos.hands[0]!
    expect(summary.settlementError).toContain('ledger unavailable')
    expect(h.domainEvents.at(-1)).toMatchObject({ type: 'HAND_SETTLED', summary: { handId: summary.handId } })
    expect(h.ofType('h', 'BALANCE').length).toBe(pushedBefore) // nothing moved, so nothing is pushed
    expect(await h.repos.balances.get('h')).toBe(80_000)
    expect(await h.repos.balances.get('a')).toBe(80_000)
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
    expect(h.last(busted!.identity.playerId, 'NOTIFICATION')).toMatchObject({ kind: 'STACK_SPENT', payload: { threshold: 5_000 } })
    await h.room.sitDown(busted!.identity.playerId, 3, 10_000)
    expect(h.room.players.get(busted!.identity.playerId)!.seat).toBe(3)
  })
})

describe('Blind decision timeouts (spec §8.7)', () => {
  const PLAY_OR_FOLD: RoomConfig = { ...BLIND, blind: { ...BLIND.blind!, botCount: 0 } }
  const nextHand = async (h: RoomHarness) => {
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
    await tick(h)
  }
  const strikes = (h: RoomHarness, id: string) => h.room.players.get(id)!.consecutiveTimeouts
  const timedOutActs = (h: RoomHarness, id: string) =>
    h.ofType(id, 'GAME_EVENT').filter((m) => m.event.type === 'PLAYER_ACTED' && m.event.timedOut)
  const stoodNotices = (h: RoomHarness, watcher: string, id: string) =>
    h.ofType(watcher, 'ROOM_EVENT').filter((m) => m.event.type === 'PLAYER_STOOD' && m.event.playerId === id)
  /** `a` plays every hand, so the one the timer folds is `h`. */
  const aPlays = (id: string, legal: LegalActions): PlayerAction => ({ kind: id === 'a' && legal.kinds.includes('play') ? 'play' : 'fold' })

  it('three play-or-fold decisions in a row that run out of time stand a player up after the hand, stack returned', async () => {
    const h = createRoomHarness(PLAY_OR_FOLD)
    await seatAndStart(h, ['h', 'a'])
    for (const expected of [1, 2]) {
      await playOut(h, aPlays, { humanTimeouts: new Set(['h']) })
      expect(h.room.players.get('h')!.seat).toBe(0)
      expect(strikes(h, 'h')).toBe(expected)
      expect(strikes(h, 'a')).toBe(0)
      await nextHand(h)
    }
    await playOut(h, aPlays, { humanTimeouts: new Set(['h']) })

    expect(timedOutActs(h, 'a').map((m) => m.event.type === 'PLAYER_ACTED' && m.event.seat)).toEqual([0, 0, 0]) // each hand told the table
    expect(h.room.players.get('h')!.seat).toBeNull()
    expect(stoodNotices(h, 'a', 'h')).toHaveLength(1)
    expect(h.room.players.get('a')!.seat).toBe(1) // the other seat is not touched
    // Three antes went into the pot; the other 7.000 of the 10.000 limit came home, once. It was the timeouts that stood
    // them up: the stack was not spent (7.000 is left), so no notice says it was.
    expect(h.repos.entries.filter((e) => e.entry.playerId === 'h' && e.entry.reason === 'cash_out').map((e) => e.entry.delta)).toEqual([7_000])
    expect(await h.repos.balances.get('h')).toBe(97_000)
    expect(h.ofType('h', 'NOTIFICATION').some((m) => m.kind === 'STACK_SPENT')).toBe(false)
    expect(strikes(h, 'h')).toBe(0) // and the count goes with the seat

    h.clock.advance(100)
    await tick(h)
    expect(h.room.status).toBe('OPEN') // only one seat left → back to OPEN, ready cleared
    expect(h.room.players.get('a')!.ready).toBe(false)
  })

  it('a seat the ante empties is played for it, and that counts neither way: two timeouts before it stay two', async () => {
    // 'h' brings 3.000: two hands the timer folds take 1.000 each, and the third ante takes the last 1.000, so the seat
    // plays all in without being asked. Spec R14: that auto-play is no timeout, and no decision that starts the count over.
    const h = createRoomHarness(PLAY_OR_FOLD, { players: [['h', 3_000], ['a', 100_000]] })
    await seatAndStart(h, ['h', 'a'])
    for (const expected of [1, 2]) {
      await playOut(h, aPlays, { humanTimeouts: new Set(['h']) })
      expect(strikes(h, 'h')).toBe(expected)
      await nextHand(h)
    }
    expect(h.room.players.get('h')!.stack).toBe(1_000)
    expect(h.room.snapshot('h').hand!.legal?.kinds ?? []).toEqual([]) // never asked
    await h.room.action('a', { kind: 'play' }, h.room.seq) // the last decision: the round resolves
    const acted = h.ofType('a', 'GAME_EVENT').map((m) => m.event).filter((e) => e.type === 'PLAYER_ACTED' && e.seat === 0).at(-1)
    expect(acted).toMatchObject({ action: { kind: 'play' }, amount: 0, allIn: true, timedOut: false })
    expect(h.room.handActive).toBe(true) // still revealing: the end-of-hand sweep has not run
    expect(strikes(h, 'h')).toBe(2)
  })

  it('a decision made in between starts the count over: three timeouts that are not in a row stand nobody up', async () => {
    const h = createRoomHarness(PLAY_OR_FOLD)
    await seatAndStart(h, ['h', 'a'])
    const timeOut = () => playOut(h, aPlays, { humanTimeouts: new Set(['h']) })
    await timeOut()
    await nextHand(h)
    await timeOut()
    expect(strikes(h, 'h')).toBe(2)
    await nextHand(h)
    // h chooses to play and wins the hand `a` folds (Tự động chơi sends this same play): a real action, not a timeout.
    await playOut(h, (id) => ({ kind: id === 'h' ? 'play' : 'fold' }))
    expect(strikes(h, 'h')).toBe(0)
    expect(h.room.players.get('h')!.seat).toBe(0)
    await nextHand(h)
    await timeOut() // the third timeout, but not the third in a row
    expect(strikes(h, 'h')).toBe(1)
    expect(h.room.players.get('h')!.seat).toBe(0)
    expect(timedOutActs(h, 'a')).toHaveLength(3)
    expect(stoodNotices(h, 'a', 'h')).toHaveLength(0)
  })

  it('a chosen fold is a real action as well: it too starts the count over', async () => {
    const h = createRoomHarness(PLAY_OR_FOLD)
    await seatAndStart(h, ['h', 'a'])
    await playOut(h, aPlays, { humanTimeouts: new Set(['h']) })
    await nextHand(h)
    await playOut(h, aPlays, { humanTimeouts: new Set(['h']) })
    expect(strikes(h, 'h')).toBe(2)
    await nextHand(h)
    await playOut(h, aPlays) // h folds by its own hand this time: aPlays folds everyone but `a`
    expect(strikes(h, 'h')).toBe(0)
    expect(h.room.players.get('h')!.seat).toBe(0)
    expect(timedOutActs(h, 'a')).toHaveLength(2)
  })

  it('a bot the timer folds is never counted, and is never stood up for it', async () => {
    // The bot answers a minute after the round has closed, so the timer folds it every hand.
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 1 } }, { options: { botDelayMs: [60_000, 60_000] } })
    await seatAndStart(h, ['h'])
    for (let i = 0; i < 4; i++) {
      await h.room.action('h', { kind: 'play' }, h.room.seq)
      h.clock.advance(TEST_ROOM_OPTIONS.turnTimerMsOverride!)
      await tick(h)
      await playOut(h)
      await nextHand(h)
    }
    const bot = [...h.room.players.values()].find((p) => p.identity.isBot)!
    const botSeat = bot.seat!
    expect(timedOutActs(h, 'h').filter((m) => m.event.type === 'PLAYER_ACTED' && m.event.seat === botSeat)).toHaveLength(4) // the engine did say so
    expect(bot.consecutiveTimeouts).toBe(0)
    expect(bot.seat).toBe(botSeat)
    expect(strikes(h, 'h')).toBe(0)
  })

  it('play or fold with Nặn bài: the decision round is the timed one, so a decision that runs out counts', async () => {
    const h = createRoomHarness({ ...PLAY_OR_FOLD, turnTimerSec: 20, blind: { ...PLAY_OR_FOLD.blind!, squeeze: true } })
    await seatAndStart(h, ['h', 'a'])
    expect(h.room.snapshot(null).hand?.phase).toBe('DECISION') // no SQUEEZE phase in this kind of room
    await playOut(h, aPlays, { humanTimeouts: new Set(['h']) })
    expect(strikes(h, 'h')).toBe(1)
    expect(timedOutActs(h, 'a')).toHaveLength(1)
  })

  it('the squeeze round running out is no timeout: it counts nothing, resets nothing and stands nobody up', async () => {
    const h = createRoomHarness({ ...BLIND, turnTimerSec: 20, blind: { ...BLIND.blind!, decisionMode: 'none', botCount: 0, squeeze: true } })
    await seatAndStart(h, ['h', 'a'])
    // A count of two, as a play-or-fold table could have left it: were the forced turn counted, h would be stood up
    // below; were it a real action, the count would drop to nothing.
    h.room.players.get('h')!.consecutiveTimeouts = 2
    for (let i = 0; i < 3; i++) {
      expect(h.room.snapshot(null).hand?.phase).toBe('SQUEEZE')
      h.clock.advance(TEST_ROOM_OPTIONS.turnTimerMsOverride!) // nobody turned: the server does it for both
      await tick(h)
      await playOut(h)
      expect(h.room.players.get('h')).toMatchObject({ seat: 0, consecutiveTimeouts: 2 })
      expect(h.room.players.get('a')).toMatchObject({ seat: 1, consecutiveTimeouts: 0 })
      await nextHand(h)
    }
    expect(h.ofType('a', 'GAME_EVENT').some((m) => m.event.type === 'PLAYER_ACTED')).toBe(false)
    expect(h.ofType('h', 'ROOM_EVENT').some((m) => m.event.type === 'PLAYER_STOOD')).toBe(false)
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
    // 'poor' brings its whole 2.500 (under the 10.000 limit). Both fold the hand and both asked to sit out during it, so
    // when it ends nobody can be dealt in — no hand can start, and the pot waits. The two seats are still taken, so
    // the release shares the pot between them (spec §8.4).
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 0 } }, { players: [['h', 100_000], ['poor', 2_500]] })
    await seatAndStart(h, ['h', 'poor'])
    await h.room.sitOut('h', true)
    await h.room.sitOut('poor', true)
    await playOut(h, () => ({ kind: 'fold' }))
    expect(h.room.carryOverPot).toBe(2_000)
    expect(h.room.players.get('poor')!.stack).toBe(1_500)
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs) // next-hand timer fires, nobody to deal → OPEN + release armed
    await tick(h)
    expect(h.room.status).toBe('OPEN')
    expect(h.room.carryOverPot).toBe(2_000)
    h.clock.advance(TEST_ROOM_OPTIONS.carryOverReleaseMs)
    await tick(h)
    expect(h.room.carryOverPot).toBe(0)
    expect(h.repos.entries.filter((e) => e.entry.reason === 'refund').map((e) => [e.entry.playerId, e.entry.delta])).toEqual([['h', 1_000], ['poor', 1_000]])
    expect(await h.repos.balances.get('h')).toBe(90_000 + 1_000) // half the pot: h shares it with 'poor'
    expect(h.room.players.get('h')!.stack).toBe(9_000)
    expect(await h.repos.balances.get('poor')).toBe(1_000)
    expect(h.room.players.get('poor')!.stack).toBe(1_500)
    expect(h.repos.sinks).toEqual([])
    expect(h.last('h', 'BALANCE')).toEqual({ t: 'BALANCE', balance: 91_000 })
    expect(h.last('poor', 'BALANCE')).toEqual({ t: 'BALANCE', balance: 1_000 })
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

  it('a shutdown whose cash-out fails for one player still cashes out the rest, closes the room and logs it', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 0 } })
    for (const [i, id] of ['h', 'a', 'b'].entries()) {
      if (id !== 'h') await h.room.join(h.identity(id))
      await h.room.sitDown(id, i)
    }
    const real = h.repos.balances.apply.bind(h.repos.balances)
    h.repos.balances.apply = async (batch, meta, opts) => {
      if (batch.some((e) => e.reason === 'cash_out' && e.playerId === 'a')) throw new Error('ledger unavailable')
      return real(batch, meta, opts)
    }
    await h.room.shutdown('maintenance') // resolves: one player's ledger row is not the whole server's shutdown
    expect(h.room.status).toBe('CLOSED')
    expect(h.last('b', 'ROOM_EVENT')?.event).toMatchObject({ type: 'ROOM_CLOSED', reason: 'maintenance' })
    // 'a' sits between the two in cash-out order, so 'b' is proof the failure did not stop the sweep.
    expect(h.repos.entries.filter((e) => e.entry.reason === 'cash_out').map((e) => [e.entry.playerId, e.entry.delta])).toEqual([['h', 10_000], ['b', 10_000]])
    expect(h.logs.filter((l) => l.level === 'error')).toEqual([
      { level: 'error', msg: 'shutdown settlement failed', data: expect.objectContaining({ playerId: 'a', stack: 10_000, key: expect.stringMatching(/^cash_out:room-1:/) }) },
    ])
  })

  it('a reconnect-expiry stand-up that cannot write is logged, keeps the seat out of the deal and is retried', async () => {
    // The window (50) lapses between hands, before the next deal (handIntervalMs 100).
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 1 } }, { options: { reconnectWindowMs: 50 } })
    await seatAndStart(h, ['h', 'a'])
    await playOut(h, () => ({ kind: 'fold' })) // a folds: 9.000 left on the table
    const real = h.repos.balances.apply.bind(h.repos.balances)
    let failOnce = true
    h.repos.balances.apply = async (batch, meta, opts) => {
      if (failOnce && batch.some((e) => e.reason === 'cash_out')) {
        failOnce = false
        throw new Error('ledger unavailable')
      }
      return real(batch, meta, opts)
    }
    await h.room.onDisconnect('a')
    h.clock.advance(50)
    await tick(h)
    expect(h.room.players.get('a')!.seat).toBe(1) // the cash-out could not write, so the seat stays…
    expect(h.logs.filter((l) => l.level === 'error')).toEqual([
      { level: 'error', msg: 'reconnect-expiry stand-up failed', data: expect.objectContaining({ playerId: 'a', stack: 9_000 }) },
    ])
    h.clock.advance(50)
    await tick(h)
    expect(h.room.handActive).toBe(true)
    expect(h.room.snapshot(null).hand!.seats.some((s) => s.playerId === 'a')).toBe(false) // …but is not dealt in
    await playOut(h, () => ({ kind: 'fold' }))
    expect(h.room.players.get('a')!.seat).toBeNull() // retried when that hand ended
    expect(h.repos.entries.filter((e) => e.entry.playerId === 'a' && e.entry.reason === 'cash_out').map((e) => e.entry.delta)).toEqual([9_000])
    expect(await h.repos.balances.get('a')).toBe(99_000)
    h.clock.advance(TEST_ROOM_OPTIONS.spectatorGraceMs) // the grace timer was armed all the same
    await tick(h)
    expect(h.room.hasPlayer('a')).toBe(false)
  })
})

describe('Blind table limit (spec 2026-09-29)', () => {
  it('a seat takes the table limit from the balance, and a hand moves only table stacks', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 0 } })
    await seatAndStart(h, ['h', 'a'])
    expect(h.repos.entries.map((e) => [e.entry.playerId, e.entry.delta, e.entry.reason, e.entry.refId])).toEqual([
      ['h', -10_000, 'buy_in', 'room-1'],
      ['a', -10_000, 'buy_in', 'room-1'],
    ])
    expect(await h.repos.balances.get('h')).toBe(90_000)
    expect(h.last('h', 'BALANCE')).toEqual({ t: 'BALANCE', balance: 90_000 }) // pushed at the buy-in
    await playOut(h, (id) => ({ kind: id === 'h' ? 'play' : 'fold' }))
    // a folded the 1.000 ante; h's play went uncalled and came back, and h took the whole 2.000 pot: Blind has no fee.
    expect(h.room.players.get('a')!.stack).toBe(9_000)
    expect(h.room.players.get('h')!.stack).toBe(10_000 + 1_000)
    expect(h.repos.entries).toHaveLength(2) // no per-hand rows: the balances did not move
    expect(await h.repos.balances.get('a')).toBe(90_000)
    expect(h.repos.sinks).toEqual([])
  })

  it('sitting down needs one wager, not two, in play-or-fold', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 0 } }, { players: [['h', 100_000], ['one', 1_000], ['short', 999]] })
    await h.room.join(h.identity('one'))
    await h.room.join(h.identity('short'))
    expect(await code(h.room.sitDown('short', 1))).toBe('INSUFFICIENT_BALANCE') // a point short of one wager
    expect(await h.repos.balances.get('short')).toBe(999)
    await h.room.sitDown('one', 1) // one wager is enough: the play goes all in for what is left after the ante
    expect(h.room.players.get('one')!.stack).toBe(1_000)
    expect(await h.repos.balances.get('one')).toBe(0)
  })

  it('a Blind seat with 3,000 at a 5,000 table is dealt and plays all in', async () => {
    // A 5.000 wager: 'poor' sits with all of an 8.000 balance, folds the first hand (the ante goes → 3.000), and is
    // dealt the next one anyway. Its 3.000 ante is all it has, so it plays all in without being asked.
    const WIDE: RoomConfig = { ...BLIND, blind: { ...BLIND.blind!, fixedWager: 5_000, botCount: 0 } }
    const h = createRoomHarness(WIDE, { players: [['h', 100_000], ['poor', 8_000]] })
    await seatAndStart(h, ['h', 'poor'])
    expect(h.room.players.get('poor')!.stack).toBe(8_000)
    await playOut(h, (id) => ({ kind: id === 'poor' ? 'fold' : 'play' }))
    expect(h.room.players.get('poor')!.stack).toBe(3_000)
    expect(h.room.players.get('poor')!.seat).toBe(1) // short of a wager, and still seated
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
    await tick(h)
    const hand = h.room.snapshot('poor').hand!
    const mine = hand.seats.find((s) => s.playerId === 'poor')!
    expect(mine).toBeDefined() // dealt in
    expect(mine.hasDecided).toBe(true) // never asked
    expect(hand.legal?.kinds ?? []).toEqual([])
    const from = h.ofType('poor', 'GAME_EVENT').length
    await playOut(h, () => ({ kind: 'play' }))
    const later = h.ofType('poor', 'GAME_EVENT').slice(from).map((m) => m.event)
    expect(later.find((e) => e.type === 'PLAYER_ACTED' && e.seat === 1)).toMatchObject({ action: { kind: 'play' }, amount: 0, stack: 0, allIn: true, timedOut: false })
    const net = h.repos.hands[1]!.players.find((p) => p.playerId === 'poor')!.net
    // Its 3.000 is matched by 3.000 of h's: it wins that 6.000 main pot (+3.000) or loses its 3.000; the rest is h's.
    expect([-3_000, 3_000]).toContain(net)
    expect(h.repos.sinks).toEqual([])
    expect(await books(h, { h: 100_000, poor: 8_000 })).toBe(0)
  })

  it('a seat that reaches 0 is stood up after the hand with STACK_SPENT and books() stays 0', async () => {
    // Pure luck (`none`): nobody decides, so a lost hand takes the whole 1.000 a one-wager seat brought.
    const h = createRoomHarness(
      { ...BLIND, blind: { ...BLIND.blind!, decisionMode: 'none', botCount: 0 } },
      { players: [['h', 100_000], ['poor', 1_000]], seed: 2 },
    )
    await seatAndStart(h, ['h', 'poor'])
    expect(h.room.players.get('poor')!.stack).toBe(1_000)
    await playOut(h)
    // Precondition: this seed deals 'poor' the losing hand. If dealing changes, pick another seed where it still does.
    expect(h.repos.hands[0]!.players.find((p) => p.playerId === 'poor')!.net).toBe(-1_000)
    expect(h.room.players.get('poor')!.seat).toBeNull()
    expect(h.room.hasPlayer('poor')).toBe(true) // still in the room, watching
    // Nothing was left to go home, so no cash-out row is written.
    expect(h.repos.entries.filter((e) => e.entry.playerId === 'poor').map((e) => [e.entry.delta, e.entry.reason])).toEqual([[-1_000, 'buy_in']])
    expect(await h.repos.balances.get('poor')).toBe(0)
    expect(h.last('poor', 'NOTIFICATION')).toEqual({ t: 'NOTIFICATION', kind: 'STACK_SPENT', payload: { roomId: 'room-1', threshold: 5_000 } })
    expect(h.ofType('h', 'ROOM_EVENT').some((m) => m.event.type === 'PLAYER_STOOD' && m.event.playerId === 'poor')).toBe(true)
    expect(h.ofType('h', 'NOTIFICATION').some((m) => m.kind === 'STACK_SPENT')).toBe(false) // only the one it concerns
    expect(await books(h, { h: 100_000, poor: 1_000 })).toBe(0)

    // Sitting again is a fresh buy-in: refused with nothing to bring, the limit again once there is enough.
    expect(await code(h.room.sitDown('poor', 1))).toBe('INSUFFICIENT_BALANCE')
    h.repos.records.get('poor')!.balance = 50_000
    await h.room.sitDown('poor', 1)
    expect(h.room.players.get('poor')!.stack).toBe(10_000)
    expect(await h.repos.balances.get('poor')).toBe(40_000)
  })

  it('every way off a seat takes the table stack home', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 0 } })
    for (const [i, id] of ['h', 'a', 'b'].entries()) {
      if (id !== 'h') await h.room.join(h.identity(id))
      await h.room.sitDown(id, i)
    }
    await h.room.standUp('h')
    await h.room.leave('a')
    await h.room.kick('h', 'b')
    expect(h.repos.entries.filter((e) => e.entry.reason === 'cash_out').map((e) => [e.entry.playerId, e.entry.delta])).toEqual([
      ['h', 10_000],
      ['a', 10_000],
      ['b', 10_000],
    ])
    for (const id of ['h', 'a', 'b']) expect(await h.repos.balances.get(id)).toBe(100_000)
  })

  it('bots play from a virtual table limit, play a short stack all in, and are topped back up once it is spent', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 1 } })
    const bot = [...h.room.players.values()].find((p) => p.identity.isBot)!
    expect(bot.stack).toBe(10_000)
    await seatAndStart(h, ['h'])
    await playOut(h, () => ({ kind: 'fold' }))
    bot.stack = 500 // as if it had lost most of its limit: like a human seat, it is dealt and goes all in (plan 27 D2)
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
    await tick(h)
    expect(h.room.snapshot(null).hand!.seats.some((s) => s.playerId === bot.identity.playerId)).toBe(true)
    expect(bot.stack).toBe(500)
    await playOut(h, () => ({ kind: 'fold' }))
    bot.stack = 0 // as if it had lost all of it
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
    await tick(h)
    expect(h.room.snapshot(null).hand!.seats.some((s) => s.playerId === bot.identity.playerId)).toBe(true)
    expect(bot.stack).toBe(10_000)
    expect(h.repos.entries.every((e) => e.entry.playerId !== bot.identity.playerId)).toBe(true) // never the ledger
  })

  it('a balance change elsewhere is pushed, and the table stack is left alone', async () => {
    const h = createRoomHarness(BLIND)
    await h.room.sitDown('h', 0)
    h.repos.records.get('h')!.balance = 142_000
    await h.room.refreshBalance('h')
    expect(h.last('h', 'BALANCE')).toEqual({ t: 'BALANCE', balance: 142_000 })
    expect(h.room.players.get('h')!.stack).toBe(10_000)
  })

  it('a cash-out that fails at the end of a hand does not wedge the room; it is retried after the next', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 1 } }, { players: [['h', 100_000], ['poor', 2_500]] })
    await seatAndStart(h, ['h', 'poor'])
    const real = h.repos.balances.apply.bind(h.repos.balances)
    let failOnce = true
    h.repos.balances.apply = async (batch, meta, opts) => {
      if (failOnce && batch.some((e) => e.reason === 'cash_out')) {
        failOnce = false
        throw new Error('ledger unavailable')
      }
      return real(batch, meta, opts)
    }
    await h.room.standUp('poor') // mid-hand: it takes effect when the hand ends
    await playOut(h, (id) => ({ kind: id === 'poor' ? 'fold' : 'play' }))
    expect(h.room.players.get('poor')!.seat).toBe(1) // the stand-up could not write, so the seat stays…
    expect(h.room.nextHandAt).not.toBeNull() // …and the room still deals on
    expect(h.logs.filter((l) => l.level === 'error')).toEqual([
      { level: 'error', msg: 'stand-up after hand failed', data: expect.objectContaining({ playerId: 'poor', err: 'Error: ledger unavailable' }) },
    ]) // …said out loud, not swallowed
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
    await tick(h)
    expect(h.room.snapshot(null).hand!.seats.some((s) => s.playerId === 'poor')).toBe(false) // frozen: not dealt in
    await playOut(h, () => ({ kind: 'fold' }))
    expect(h.room.players.get('poor')!.seat).toBeNull()
    expect(h.repos.entries.filter((e) => e.entry.playerId === 'poor' && e.entry.reason === 'cash_out').map((e) => e.entry.delta)).toEqual([1_500])
    expect(await h.repos.balances.get('poor')).toBe(1_500)
    expect(h.ofType('poor', 'NOTIFICATION').some((m) => m.kind === 'STACK_SPENT')).toBe(false) // it stood up of its own accord
  })

  it('a seat that hits 0 in the hand its player chose to stand or leave is stood up or removed without a STACK_SPENT notice', async () => {
    // Pure luck: a lost hand takes all of the 1.000 each of 's' and 'l' brought.
    const h = createRoomHarness(
      { ...BLIND, blind: { ...BLIND.blind!, decisionMode: 'none', botCount: 0 } },
      { players: [['h', 100_000], ['s', 1_000], ['l', 1_000]], seed: 1 },
    )
    await seatAndStart(h, ['h', 's', 'l'])
    await h.room.standUp('s')
    await h.room.leave('l')
    await playOut(h)
    const net = (id: string) => h.repos.hands[0]!.players.find((p) => p.playerId === id)!.net
    // Precondition: this seed deals both of them a losing hand. If dealing changes, pick another seed where it does.
    expect([net('s'), net('l')]).toEqual([-1_000, -1_000])
    for (const id of ['s', 'l']) {
      expect(h.repos.entries.filter((e) => e.entry.playerId === id && e.entry.reason === 'cash_out')).toEqual([]) // nothing left to send home
      expect(await h.repos.balances.get(id)).toBe(0)
      expect(h.ofType(id, 'NOTIFICATION').some((m) => m.kind === 'STACK_SPENT')).toBe(false) // they left of their own accord
    }
    expect(h.room.players.get('s')!.seat).toBeNull()
    expect(h.room.hasPlayer('s')).toBe(true)
    expect(h.room.hasPlayer('l')).toBe(false)
  })

  it('a reconnect window that lapses between hands takes the table stack home', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 0 } })
    await h.room.join(h.identity('a'))
    await h.room.sitDown('h', 0)
    await h.room.sitDown('a', 1)
    await h.room.onDisconnect('a')
    h.clock.advance(TEST_ROOM_OPTIONS.reconnectWindowMs)
    await tick(h)
    expect(h.room.players.get('a')!.seat).toBeNull()
    expect(h.room.hasPlayer('a')).toBe(true) // a spectator until the grace runs out
    expect(h.repos.entries.filter((e) => e.entry.playerId === 'a' && e.entry.reason === 'cash_out').map((e) => e.entry.delta)).toEqual([10_000])
    expect(await h.repos.balances.get('a')).toBe(100_000)
  })

  it('a seat taken back after handsSatOutToStand skipped hands takes its table stack home', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 2 } }, { options: { handsSatOutToStand: 2 } })
    await seatAndStart(h, ['h', 'a'])
    await h.room.sitOut('a', true)
    await playOut(h, () => ({ kind: 'fold' })) // the hand a was already in: the ante goes, 9.000 left
    for (let i = 0; i < 2; i++) {
      h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
      await tick(h)
      if (h.room.players.get('a')!.seat === null) break
      await playOut(h, () => ({ kind: 'fold' }))
    }
    expect(h.room.players.get('a')!.seat).toBeNull()
    expect(h.repos.entries.filter((e) => e.entry.playerId === 'a' && e.entry.reason === 'cash_out').map((e) => e.entry.delta)).toEqual([9_000])
    expect(await h.repos.balances.get('a')).toBe(99_000)
    expect(h.ofType('a', 'NOTIFICATION').some((m) => m.kind === 'STACK_SPENT')).toBe(false) // not spent: taken back
  })

  it('an all-fold table plays its last wagers all in, so the carried-over pot goes to a seat and never to the house', async () => {
    // Two humans with 5.000 each (all of it brought: under the 10.000 limit) fold four hands running: every ante stays
    // in the carried pot (2.000 → 8.000) and each stack falls to 1.000 — one ante, still seated (plan 27 D2). The fifth
    // ante takes all of both stacks, so both play all in without being asked, and the whole pot goes to the better hand:
    // nothing is left carried, nothing to the house.
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 0 } }, { players: [['h', 5_000], ['a', 5_000]], seed: 2 })
    await seatAndStart(h, ['h', 'a'])
    for (let i = 0; i < 4; i++) {
      if (i > 0) {
        h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
        await tick(h)
      }
      await playOut(h, () => ({ kind: 'fold' }))
    }
    expect(h.room.carryOverPot).toBe(8_000)
    for (const id of ['h', 'a']) {
      expect(h.room.players.get(id)!.seat).not.toBeNull()
      expect(h.room.players.get(id)!.stack).toBe(1_000)
    }
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
    await tick(h)
    expect(h.room.snapshot(null).hand!.seats.every((s) => s.hasDecided)).toBe(true) // nobody is asked
    await playOut(h, () => ({ kind: 'fold' }))
    expect(h.room.carryOverPot).toBe(0)
    const stacks = ['h', 'a'].map((id) => h.room.players.get(id)!.stack).sort((x, y) => x - y)
    // Precondition: this seed gives one of them the better hand (no split). If dealing changes, pick another seed.
    expect(stacks).toEqual([0, 10_000])
    const loser = ['h', 'a'].find((id) => h.room.players.get(id)!.seat === null)!
    expect(h.last(loser, 'NOTIFICATION')).toEqual({ t: 'NOTIFICATION', kind: 'STACK_SPENT', payload: { roomId: 'room-1', threshold: 5_000 } })
    expect(h.repos.sinks).toEqual([])
    expect(await books(h, { h: 5_000, a: 5_000 })).toBe(0)
  })
})

/** Bots that fold every hand, so a hand everyone folds carries its antes over. */
const folding: BotStrategy = { decide: () => ({ kind: 'fold' }) }

/**
 * The conservation test's sum, by default for one human `h` who started with 100.000 (`humans` names everyone else
 * and what they started with): their balance changes, what is still on the table for them, every bot's net, every
 * sink, the pot still carried and a carried pot whose release is not yet settled add up to nothing. Taken between
 * hands, and never while a cash-out is pending: its credit has landed and its seat still holds the stack, so the
 * two would be counted twice until the retry settles it.
 *
 * Chaos tables (Plan 37): the new points a card paid a human are a source row (`chaos_rescue|chaos_crit|chaos_fortune`)
 * that the paired `chaos_to_table` row moved straight onto the stack, so they are taken back out here. A bot's credit
 * lands on its virtual stack only, which the sum never counts (a bot is counted by its nets).
 */
const CHAOS_SOURCES = new Set(['chaos_rescue', 'chaos_crit', 'chaos_fortune', 'chaos_jackpot'])
async function books(h: RoomHarness, humans: Record<string, number> = { h: 100_000 }): Promise<number> {
  let humanDelta = 0
  for (const [id, start] of Object.entries(humans)) humanDelta += (await h.repos.balances.get(id)) + (h.room.players.get(id)?.stack ?? 0) - start
  const botNet = h.repos.hands.flatMap((x) => x.players).filter((p) => p.isBot).reduce((s, p) => s + p.net, 0)
  const sources = h.repos.entries.filter((e) => CHAOS_SOURCES.has(e.entry.reason)).reduce((s, e) => s + e.entry.delta, 0)
  return humanDelta + botNet + h.repos.sinks.reduce((s, x) => s + x.fee, 0) + h.room.carryOverPot + (h.room.pendingRelease?.pot ?? 0) - sources
}

describe('The last person out of a room that still seats bots (No3)', () => {
  it('the host leaving between hands closes the room in the same turn of the queue, and nothing is left armed', async () => {
    const h = createRoomHarness(BLIND)
    await seatAndStart(h, ['h'])
    await playOut(h)
    expect(h.room.status).toBe('IN_GAME') // between hands: the next deal is on its timer
    const closed: string[] = []
    h.room.onClosed = (_r, reason) => { closed.push(reason) }
    await h.room.leave('h')
    expect(h.room.status).toBe('CLOSED')
    expect(closed).toEqual(['empty'])
    expect(h.room.summary().closing).toBe(false) // gone, not counting down
    expect(h.clock.pending).toBe(0) // no next deal, no close timer, no release timer
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs + TEST_ROOM_OPTIONS.emptyRoomCloseMs)
    await tick(h)
    expect(closed).toEqual(['empty'])
    expect(h.repos.hands).toHaveLength(1)
    const net = h.repos.hands[0]!.players.find((p) => p.playerId === 'h')!.net
    expect(await h.repos.balances.get('h')).toBe(100_000 + net) // the whole table stack went home
    expect(await books(h)).toBe(0)
  })

  it('the host leaving mid-hand closes the room when that hand ends — after it is settled and recorded, not before', async () => {
    const h = createRoomHarness(BLIND)
    await seatAndStart(h, ['h'])
    const closed: [reason: string, handsRecorded: number][] = []
    h.room.onClosed = (_r, reason) => { closed.push([reason, h.repos.hands.length]) }
    await h.room.leave('h')
    expect(h.room.status).toBe('IN_GAME')
    expect(h.room.hasPlayer('h')).toBe(true) // still in the hand until it ends
    await playOut(h) // h folds itself; the bots finish the hand
    expect(h.room.status).toBe('CLOSED')
    expect(closed).toEqual([['empty', 1]])
    expect(h.repos.hands[0]!.cancelled).toBe(false)
    expect(h.room.hasPlayer('h')).toBe(false)
    expect(await h.repos.balances.get('h')).toBe(100_000 - 1_000) // the folded ante; the rest of the limit went home
    expect(h.clock.pending).toBe(0)
    expect(await books(h)).toBe(0)
  })

  it('a disconnected host keeps the room open until the spectator grace removes them, and then it closes at once', async () => {
    const h = createRoomHarness(BLIND)
    await h.room.sitDown('h', 0)
    const closed: string[] = []
    h.room.onClosed = (_r, reason) => { closed.push(reason) }
    await h.room.onDisconnect('h')
    h.clock.advance(TEST_ROOM_OPTIONS.reconnectWindowMs)
    await tick(h)
    expect(h.room.players.get('h')!.seat).toBeNull() // the window lapsed: stood up, stack home…
    expect(h.room.hasPlayer('h')).toBe(true) // …but still a member, so the room stays
    expect(h.room.status).toBe('OPEN')
    h.clock.advance(TEST_ROOM_OPTIONS.spectatorGraceMs - 1)
    await tick(h)
    expect(h.room.status).toBe('OPEN')
    expect(closed).toEqual([])
    h.clock.advance(1)
    await tick(h)
    expect(h.room.hasPlayer('h')).toBe(false)
    expect(h.room.status).toBe('CLOSED')
    expect(closed).toEqual(['empty'])
    expect(await h.repos.balances.get('h')).toBe(100_000)
  })

  it('a pot carried over when the last person leaves goes to the carry_over sink, and the books still balance', async () => {
    const h = createRoomHarness(BLIND, { bot: folding })
    await seatAndStart(h, ['h'])
    await playOut(h, () => ({ kind: 'fold' })) // everyone folds: the three antes are carried
    expect(h.room.carryOverPot).toBe(3_000)
    await h.room.leave('h')
    expect(h.room.status).toBe('CLOSED')
    expect(h.room.carryOverPot).toBe(0)
    expect(h.repos.sinks).toEqual([{ refId: 'room-1', fee: 3_000, kind: 'carry_over' }]) // nobody left to share it
    expect(h.repos.entries.filter((e) => e.entry.reason === 'refund')).toEqual([])
    expect(await h.repos.balances.get('h')).toBe(100_000 - 1_000)
    expect(await books(h)).toBe(0)
  })

  it('a Leave that lands after the last move of a hand but before its settlement waits for the settlement', async () => {
    // The hand's last move queues its settlement behind whatever is already in the room's queue. A Leave queued
    // first must not take the pre-hand stack home, nor close the room under a settlement still to come.
    const h = createRoomHarness(BLIND, { bot: folding })
    await seatAndStart(h, ['h'])
    h.clock.advance(10) // both bots decide (fold)
    await tick(h)
    const last = h.room.action('h', { kind: 'fold' }, h.room.seq) // everyone has folded: the hand is over…
    const leave = h.room.leave('h') // …and this is queued before its settlement
    await last
    await leave
    await tick(h)
    expect(h.room.status).toBe('CLOSED')
    expect(h.repos.hands).toHaveLength(1)
    expect(await h.repos.balances.get('h')).toBe(100_000 - 1_000) // the ante is in the pot, not back in the balance
    expect(h.repos.sinks).toEqual([{ refId: 'room-1', fee: 3_000, kind: 'carry_over' }])
    expect(await books(h)).toBe(0)
  })

  it('a room with nobody left and no bots either keeps its sixty-second grace and says it is closing (bug 2)', async () => {
    const noBots = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 0 } })
    const botsKicked = createRoomHarness(BLIND)
    for (const bot of [...botsKicked.room.players.keys()].filter((id) => id.startsWith('bot:'))) await botsKicked.room.kick('h', bot)
    for (const h of [noBots, botsKicked]) {
      await h.room.leave('h')
      expect(h.room.summary()).toMatchObject({ status: 'OPEN', closing: true })
      h.clock.advance(TEST_ROOM_OPTIONS.emptyRoomCloseMs - 1)
      await tick(h)
      expect(h.room.status).toBe('OPEN')
      h.clock.advance(1)
      await tick(h)
      expect(h.room.status).toBe('CLOSED')
    }
  })

  it('a shutdown during a hand whose only person pressed Leave closes the room once, for the shutdown’s reason', async () => {
    const h = createRoomHarness(BLIND)
    await seatAndStart(h, ['h'])
    await h.room.leave('h')
    const closed: string[] = []
    h.room.onClosed = (_r, reason) => { closed.push(reason) }
    await h.room.shutdown('maintenance') // its cancelled hand removes the leaver on the way out
    expect(closed).toEqual(['maintenance'])
    expect(h.room.status).toBe('CLOSED')
    expect(h.room.hasPlayer('h')).toBe(false)
    expect(h.repos.hands[0]!.cancelled).toBe(true)
    expect(await h.repos.balances.get('h')).toBe(100_000) // the cancelled hand's ante came back, and the stack went home
  })

  it('a close() that cancels a hand whose only person pressed Leave closes the room once', async () => {
    // Reached here directly, as the existing in-flight close test does: the leaver's removal inside the close must
    // not start a second one.
    const h = createRoomHarness(BLIND, { options: { botDelayMs: [10_000, 10_000] } })
    await seatAndStart(h, ['h'])
    await h.room.leave('h')
    const closed: string[] = []
    h.room.onClosed = (_r, reason) => { closed.push(reason) }
    await h.room.enqueue(() => (h.room as unknown as { close(reason: string): Promise<void> }).close('empty'))
    expect(closed).toEqual(['empty'])
    expect(h.room.status).toBe('CLOSED')
    expect(h.room.hasPlayer('h')).toBe(false)
  })
})

describe('Closing a room whose hand has just ended', () => {
  /** A Blind table of `h` and two folding bots whose bots have decided: `h`'s move is the hand's last. */
  async function lastMoveIsHs(): Promise<RoomHarness> {
    const h = createRoomHarness(BLIND, { bot: folding })
    await seatAndStart(h, ['h'])
    h.clock.advance(10) // both bots fold
    await tick(h)
    return h
  }
  const settled = (h: RoomHarness) => h.domainEvents.filter((e) => e.type === 'HAND_SETTLED')
  const refunds = (h: RoomHarness) => h.repos.entries.filter((e) => e.entry.reason === 'refund').map((e) => [e.entry.playerId, e.entry.delta])

  it('a shutdown queued between a hand’s last move and its settlement settles that hand first', async () => {
    // The last move queues the settlement behind whatever is already in the room's queue — here, the shutdown.
    const cases = [
      { move: 'fold', cashOut: 9_000, refunds: [['h', 3_000]] }, // everyone folded: three antes carried, released to h
      { move: 'play', cashOut: 12_000, refunds: [] }, // h alone played: the whole 3.000 pot, Blind has no fee
    ] as const
    for (const c of cases) {
      const h = await lastMoveIsHs()
      const closed: string[] = []
      h.room.onClosed = (_r, reason) => { closed.push(reason) }
      const last = h.room.action('h', { kind: c.move }, h.room.seq)
      const down = h.room.shutdown('maintenance')
      await last
      await down
      await tick(h) // the settlement queued behind the shutdown finds nothing left to do
      expect(h.room.status).toBe('CLOSED')
      expect(closed).toEqual(['maintenance'])
      expect(settled(h)).toHaveLength(1)
      expect(h.repos.hands).toHaveLength(1)
      expect(h.repos.hands[0]!.cancelled).toBe(false)
      // What goes home is the stack the hand left, not the one it started with.
      expect(h.repos.entries.filter((e) => e.entry.playerId === 'h' && e.entry.reason === 'cash_out').map((e) => e.entry.delta)).toEqual([c.cashOut])
      expect(refunds(h)).toEqual(c.refunds)
      expect(h.room.carryOverPot).toBe(0)
      expect(await books(h)).toBe(0)
    }
  })

  it('a close() queued between a hand’s last move and its settlement settles that hand and releases its pot', async () => {
    // Not reachable through a Leave any more (a Leave waits for the settlement), so reached directly, as the in-flight
    // close test does. close() is for rooms nobody is in, so the seated h's stack stays on the table; `books` counts it.
    const h = await lastMoveIsHs()
    const closed: string[] = []
    h.room.onClosed = (_r, reason) => { closed.push(reason) }
    const last = h.room.action('h', { kind: 'fold' }, h.room.seq)
    const shut = h.room.enqueue(() => (h.room as unknown as { close(reason: string): Promise<void> }).close('empty'))
    await last
    await shut
    await tick(h)
    expect(h.room.status).toBe('CLOSED')
    expect(closed).toEqual(['empty'])
    expect(settled(h)).toHaveLength(1)
    expect(h.room.players.get('h')!.stack).toBe(9_000)
    expect(h.room.carryOverPot).toBe(0) // released, not stranded on a closed room
    expect(refunds(h)).toEqual([['h', 3_000]])
    expect(await books(h)).toBe(0)
  })

  it('a shutdown whose steps throw still ends CLOSED, with one onClosed, and logs what failed', async () => {
    const h = createRoomHarness(BLIND)
    await seatAndStart(h, ['h'])
    h.domainEvents.push = () => { throw new Error('subscriber down') } // the hand's HAND_SETTLED subscriber
    const closed: string[] = []
    h.room.onClosed = (_r, reason) => {
      closed.push(reason)
      throw new Error('listener down')
    }
    await h.room.shutdown('maintenance') // resolves: the server's shutdown is not held up by one room
    expect(h.room.status).toBe('CLOSED')
    expect(closed).toEqual(['maintenance'])
    expect(await h.repos.balances.get('h')).toBe(100_000) // the cancelled hand's ante came back, the stack went home
    expect(h.logs.filter((l) => l.level === 'error')).toEqual([
      { level: 'error', msg: 'room close step failed', data: expect.objectContaining({ step: 'hand', err: 'Error: subscriber down' }) },
      { level: 'error', msg: 'room close step failed', data: expect.objectContaining({ step: 'onClosed', err: 'Error: listener down' }) },
    ])
  })

  it('a close whose cancel throws mid-hand still returns the pot that hand carried in, and the books balance', async () => {
    // `startHand` moves the carried pot into the hand (`carryOverPot` goes to 0). If the close cannot cancel that hand,
    // `onHandComplete` never runs to hand the pot back — so the close must, or the chips leave the books.
    for (const via of ['shutdown', 'close'] as const) {
      const h = createRoomHarness(BLIND, { bot: folding })
      await seatAndStart(h, ['h'])
      await playOut(h, () => ({ kind: 'fold' })) // everyone folds: the three antes are carried
      expect(h.room.carryOverPot).toBe(3_000)
      h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
      await tick(h)
      expect(h.room.handActive).toBe(true)
      expect(h.room.snapshot(null).hand!.carryOverIn).toBe(3_000) // the pot is this hand's now…
      expect(h.room.carryOverPot).toBe(0) // …and no longer the room's
      const runner = (h.room as unknown as { runner: { cancel(reason: string): unknown } }).runner
      runner.cancel = () => { throw new Error('engine down') }
      const closed: string[] = []
      h.room.onClosed = (_r, reason) => { closed.push(reason) }
      if (via === 'shutdown') await h.room.shutdown('maintenance')
      else await h.room.enqueue(() => (h.room as unknown as { close(reason: string): Promise<void> }).close('empty'))
      await tick(h)
      expect(h.room.status).toBe('CLOSED')
      expect(closed).toEqual([via === 'shutdown' ? 'maintenance' : 'empty'])
      expect(refunds(h)).toEqual([['h', 3_000]]) // the carried pot went to the seated human
      expect(h.room.carryOverPot).toBe(0) // released, not stranded on a closed room
      expect(h.room.handActive).toBe(false)
      expect(h.repos.hands).toHaveLength(1) // the voided hand is not recorded; the first one is
      // h's own antes in the voided hand were never taken off its table stack, so nothing else moved.
      expect(via === 'shutdown' ? await h.repos.balances.get('h') : h.room.players.get('h')!.stack).toBe(via === 'shutdown' ? 100_000 - 10_000 + 9_000 + 3_000 : 9_000)
      expect(await books(h)).toBe(0)
      expect(h.logs.filter((l) => l.level === 'error')).toEqual([
        { level: 'error', msg: 'room close step failed', data: expect.objectContaining({ step: 'hand', err: 'Error: engine down' }) },
        { level: 'error', msg: 'hand voided at close: not settled, its carried-in pot goes back', data: expect.objectContaining({ carryOverIn: 3_000 }) },
      ])
    }
  })

  it('the immediate close of a room left with only bots survives a throwing listener: the Leave still succeeds', async () => {
    const g = createRoomHarness(BLIND)
    let calls = 0
    g.room.onClosed = () => {
      calls += 1
      throw new Error('listener down')
    }
    await g.room.leave('h')
    expect(g.room.status).toBe('CLOSED')
    expect(calls).toBe(1)
    expect(g.logs.filter((l) => l.level === 'error')).toEqual([
      { level: 'error', msg: 'room close step failed', data: expect.objectContaining({ step: 'onClosed', reason: 'empty' }) },
    ])
  })
})

/**
 * Plan 20's "committed but threw": the first write that `when` picks lands — the real `apply` resolves — and the
 * call throws anyway, the way a connection dropped after `COMMIT` reports a write that is in fact durable. Every
 * other write passes straight through, key and all.
 */
function ackLostOnce(h: RoomHarness, when: (batch: BalanceEntry[], meta?: SettlementMeta) => boolean): void {
  const real = h.repos.balances.apply.bind(h.repos.balances)
  let once = true
  h.repos.balances.apply = async (batch, meta, opts) => {
    const result = await real(batch, meta, opts)
    if (once && when(batch, meta)) {
      once = false
      throw new Error('ack lost')
    }
    return result
  }
}

/** The first write that `when` picks fails without writing anything: an ordinary outage. */
function failOnce(h: RoomHarness, when: (batch: BalanceEntry[], meta?: SettlementMeta) => boolean): void {
  const real = h.repos.balances.apply.bind(h.repos.balances)
  let once = true
  h.repos.balances.apply = async (batch, meta, opts) => {
    if (once && when(batch, meta)) {
      once = false
      throw new Error('ledger unavailable')
    }
    return real(batch, meta, opts)
  }
}

const isCashOut = (batch: BalanceEntry[]) => batch.some((e) => e.reason === 'cash_out')
const isBuyIn = (batch: BalanceEntry[]) => batch.some((e) => e.reason === 'buy_in')
const isRelease = (_batch: BalanceEntry[], meta?: SettlementMeta) => meta?.kind === 'carry_over'
const rowsOf = (h: RoomHarness, id: string, reason: string) => h.repos.entries.filter((e) => e.entry.playerId === id && e.entry.reason === reason).map((e) => e.entry.delta)
const dealtIn = (h: RoomHarness, id: string) => h.room.snapshot(null).hand?.seats.some((s) => s.playerId === id) ?? false
const errors = (h: RoomHarness) => h.logs.filter((l) => l.level === 'error')

describe('A ledger write is applied once, however often it is retried (Plan 20)', () => {
  it('reconnect expiry: a cash-out that landed but reported an error is credited once, and the seat is not dealt in meanwhile', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 1 } }, { options: { reconnectWindowMs: 50 } })
    await seatAndStart(h, ['h', 'a'])
    await playOut(h, () => ({ kind: 'fold' })) // a folds: 4.000 left on the table
    ackLostOnce(h, isCashOut)
    await h.room.onDisconnect('a')
    h.clock.advance(50)
    await tick(h)
    expect(await h.repos.balances.get('a')).toBe(99_000) // the credit landed…
    expect(h.room.players.get('a')!.seat).toBe(1) // …but was reported failed, so the seat is held until a retry settles it
    expect(errors(h)).toEqual([
      { level: 'error', msg: 'reconnect-expiry stand-up failed', data: expect.objectContaining({ playerId: 'a', key: expect.stringMatching(/^cash_out:room-1:/) }) },
    ])
    h.clock.advance(50)
    await tick(h)
    expect(h.room.handActive).toBe(true)
    expect(dealtIn(h, 'a')).toBe(false)
    await playOut(h, () => ({ kind: 'fold' }))
    expect(h.room.players.get('a')!.seat).toBeNull() // retried when that hand ended: the key says it is done
    expect(rowsOf(h, 'a', 'cash_out')).toEqual([9_000])
    expect(await h.repos.balances.get('a')).toBe(99_000)
    expect(await books(h, { h: 100_000, a: 100_000 })).toBe(0)
  })

  it('end of hand: a Stand Up whose cash-out landed but reported an error is credited once, and never told it is spent', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 1 } }, { players: [['h', 100_000], ['poor', 2_500]] })
    await seatAndStart(h, ['h', 'poor'])
    ackLostOnce(h, isCashOut)
    const notices = () => h.ofType('poor', 'NOTIFICATION').filter((m) => m.kind === 'STACK_SPENT')
    await h.room.standUp('poor') // mid-hand: it takes effect when the hand ends
    await playOut(h, (id) => ({ kind: id === 'poor' ? 'fold' : 'play' })) // 1.500 left to cash out
    expect(await h.repos.balances.get('poor')).toBe(1_500)
    expect(h.room.players.get('poor')!.seat).toBe(1)
    expect(errors(h)).toEqual([
      { level: 'error', msg: 'stand-up after hand failed', data: expect.objectContaining({ playerId: 'poor', key: expect.stringMatching(/^cash_out:room-1:/) }) },
    ])
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
    await tick(h)
    expect(dealtIn(h, 'poor')).toBe(false)
    await playOut(h, () => ({ kind: 'fold' }))
    expect(h.room.players.get('poor')!.seat).toBeNull()
    expect(rowsOf(h, 'poor', 'cash_out')).toEqual([1_500])
    expect(await h.repos.balances.get('poor')).toBe(1_500)
    expect(notices()).toHaveLength(0) // it stood up of its own accord, with points left
    expect(await books(h, { h: 100_000, poor: 2_500 })).toBe(0)
  })

  it('Stand Up pressed twice in Hold’em: the second press settles the first, and the seat sat the hand out between them', async () => {
    const h = createRoomHarness(HOLDEM)
    for (const [i, id] of ['h', 'a', 'b'].entries()) {
      if (id !== 'h') await h.room.join(h.identity(id))
      await h.room.sitDown(id, i, 20_000)
    }
    ackLostOnce(h, isCashOut)
    expect(await code(h.room.standUp('a'))).toBe('Error: ack lost') // the player is told it failed…
    expect(await h.repos.balances.get('a')).toBe(100_000) // …though the 20.000 is home
    // …and the bar is re-read on the failure, not left at 80.000 until the retry settles it.
    expect(h.last('a', 'BALANCE')).toEqual({ t: 'BALANCE', balance: 100_000 })
    expect(h.room.snapshot(null).room.players.find((p) => p.playerId === 'a')).toMatchObject({ seat: 1, status: 'SITTING_OUT' })
    for (const id of ['h', 'a', 'b']) await h.room.setReady(id, true)
    await h.room.startGame('h')
    expect(dealtIn(h, 'a')).toBe(false) // a stack already paid out cannot be played
    await h.room.standUp('a') // pressed again
    expect(h.room.players.get('a')!.seat).toBeNull()
    expect(rowsOf(h, 'a', 'cash_out')).toEqual([20_000])
    expect(await h.repos.balances.get('a')).toBe(100_000)
    await playOut(h)
    expect(await books(h, { h: 100_000, a: 100_000, b: 100_000 })).toBe(0)
  })

  it('Stand Up pressed twice in Blind: an auto-start table deals on without the frozen seat, which the second press settles', async () => {
    const h = createRoomHarness({ ...BLIND, autoStart: true, blind: { ...BLIND.blind!, botCount: 1 } })
    await h.room.join(h.identity('a'))
    await h.room.sitDown('h', 0)
    await h.room.sitDown('a', 1)
    ackLostOnce(h, isCashOut)
    expect(await code(h.room.standUp('a'))).toBe('Error: ack lost')
    expect(await h.repos.balances.get('a')).toBe(100_000)
    await h.room.setReady('h', true) // nobody waits on a seat that is sitting out
    expect(h.room.handActive).toBe(true)
    expect(dealtIn(h, 'a')).toBe(false)
    await h.room.standUp('a')
    expect(h.room.players.get('a')!.seat).toBeNull()
    expect(rowsOf(h, 'a', 'cash_out')).toEqual([10_000])
    expect(await h.repos.balances.get('a')).toBe(100_000)
    await playOut(h, () => ({ kind: 'fold' }))
    expect(await books(h, { h: 100_000, a: 100_000 })).toBe(0)
  })

  it('a kick whose cash-out landed but reported an error is settled when the next hand ends, once, and the player removed', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 1 } })
    await h.room.join(h.identity('a'))
    await h.room.sitDown('h', 0)
    await h.room.sitDown('a', 1)
    await h.room.setReady('a', true)
    ackLostOnce(h, isCashOut)
    expect(await code(h.room.kick('h', 'a'))).toBe('Error: ack lost')
    expect(h.last('a', 'NOTIFICATION')).toMatchObject({ kind: 'KICKED' }) // told before the write
    expect(errors(h)).toEqual([
      { level: 'error', msg: 'kick failed', data: expect.objectContaining({ playerId: 'a', key: expect.stringMatching(/^cash_out:room-1:/) }) },
    ])
    await h.room.setReady('h', true)
    await h.room.startGame('h')
    expect(dealtIn(h, 'a')).toBe(false)
    await playOut(h, () => ({ kind: 'fold' }))
    // Retried with every other pending cash-out — and the kick goes through with it: a player told KICKED is not
    // left behind as a spectator.
    expect(h.room.hasPlayer('a')).toBe(false)
    expect(h.last('a', 'ROOM_EVENT')?.event).toEqual({ type: 'PLAYER_LEFT', playerId: 'a' })
    expect(rowsOf(h, 'a', 'cash_out')).toEqual([10_000])
    expect(await h.repos.balances.get('a')).toBe(100_000)
    expect(await books(h, { h: 100_000, a: 100_000 })).toBe(0)
  })

  it('a kick whose cash-out failed outright is finished when the next hand ends: credited once, and the player removed', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 1 } })
    await h.room.join(h.identity('a'))
    await h.room.sitDown('h', 0)
    await h.room.sitDown('a', 1)
    await h.room.setReady('a', true)
    failOnce(h, isCashOut)
    expect(await code(h.room.kick('h', 'a'))).toBe('Error: ledger unavailable')
    expect(h.last('a', 'NOTIFICATION')).toMatchObject({ kind: 'KICKED' })
    expect(await h.repos.balances.get('a')).toBe(90_000) // nothing landed: the 10.000 is still on the table
    expect(h.room.hasPlayer('a')).toBe(true)
    await h.room.setReady('h', true)
    await h.room.startGame('h')
    expect(dealtIn(h, 'a')).toBe(false)
    await playOut(h, () => ({ kind: 'fold' }))
    expect(h.room.hasPlayer('a')).toBe(false)
    expect(h.last('a', 'ROOM_EVENT')?.event).toEqual({ type: 'PLAYER_LEFT', playerId: 'a' })
    expect(rowsOf(h, 'a', 'cash_out')).toEqual([10_000])
    expect(await h.repos.balances.get('a')).toBe(100_000)
    expect(await books(h, { h: 100_000, a: 100_000 })).toBe(0)
  })

  it('a Leave whose removal landed but reported an error, then a rejoin: the seat stays out of the deal and is cashed out once', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 1 } })
    await seatAndStart(h, ['h', 'a'])
    await h.room.leave('a') // mid-hand: out when the hand ends
    ackLostOnce(h, isCashOut)
    await playOut(h, (id) => ({ kind: id === 'h' ? 'play' : 'fold' }))
    expect(h.room.hasPlayer('a')).toBe(true)
    expect(await h.repos.balances.get('a')).toBe(99_000)
    expect(errors(h)).toEqual([
      { level: 'error', msg: 'stand-up after hand failed', data: expect.objectContaining({ playerId: 'a', key: expect.stringMatching(/^cash_out:room-1:/) }) },
    ])
    await h.room.join(h.identity('a')) // back before the next deal, which calls the Leave off…
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
    await tick(h)
    expect(h.room.handActive).toBe(true)
    expect(dealtIn(h, 'a')).toBe(false) // …but not the pending cash-out: that stack is already home
    await playOut(h, () => ({ kind: 'fold' }))
    expect(h.room.players.get('a')!.seat).toBeNull()
    expect(h.room.hasPlayer('a')).toBe(true) // they came back to watch
    expect(rowsOf(h, 'a', 'cash_out')).toEqual([9_000])
    expect(await h.repos.balances.get('a')).toBe(99_000)
    expect(await books(h, { h: 100_000, a: 100_000 })).toBe(0)
  })

  it('Sit In after a sit-out sweep whose cash-out landed but reported an error does not deal the seat back in', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 2 } }, { options: { handsSatOutToStand: 1 } })
    await seatAndStart(h, ['h', 'a'])
    await h.room.sitOut('a', true)
    await playOut(h, () => ({ kind: 'fold' })) // the hand a was already in: 9.000 left
    ackLostOnce(h, isCashOut)
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs) // the next deal skips a once: the sweep stands it up
    await tick(h)
    expect(h.room.handActive).toBe(true)
    expect(await h.repos.balances.get('a')).toBe(99_000)
    expect(h.room.players.get('a')!.seat).toBe(1)
    expect(errors(h)).toEqual([
      { level: 'error', msg: 'sit-out stand-up failed', data: expect.objectContaining({ playerId: 'a', key: expect.stringMatching(/^cash_out:room-1:/) }) },
    ])
    const statusOfA = () => h.room.snapshot(null).room.players.find((p) => p.playerId === 'a')!.status
    await h.room.sitOut('a', false) // Sit In
    expect(statusOfA()).toBe('SITTING_OUT')
    // The retry when this hand ends fails as well, so the next deal is the first one after the Sit In to find the seat
    // still held: that deal is the one that must leave it out.
    failOnce(h, isCashOut)
    await playOut(h, () => ({ kind: 'fold' }))
    expect(errors(h).at(-1)).toEqual({ level: 'error', msg: 'stand-up after hand failed', data: expect.objectContaining({ playerId: 'a', key: expect.stringMatching(/^cash_out:room-1:/) }) })
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
    await tick(h)
    expect(h.room.handActive).toBe(true)
    expect(h.room.players.get('a')!.seat).toBe(1)
    expect(statusOfA()).toBe('SITTING_OUT')
    expect(dealtIn(h, 'a')).toBe(false)
    await playOut(h, () => ({ kind: 'fold' }))
    expect(h.room.players.get('a')!.seat).toBeNull() // settled when the hand it sat out ended
    expect(rowsOf(h, 'a', 'cash_out')).toEqual([9_000])
    expect(await h.repos.balances.get('a')).toBe(99_000)
    expect(await books(h, { h: 100_000, a: 100_000 })).toBe(0)
  })

  /** h and `poor` fold one hand they both asked to sit out after: 2.000 carried, both seated, the room back to OPEN. */
  async function carriedAndOpen(): Promise<RoomHarness> {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 0 } }, { players: [['h', 100_000], ['poor', 2_500]] })
    await seatAndStart(h, ['h', 'poor'])
    await h.room.sitOut('h', true)
    await h.room.sitOut('poor', true)
    await playOut(h, () => ({ kind: 'fold' }))
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
    await tick(h)
    expect(h.room.status).toBe('OPEN')
    expect(h.room.carryOverPot).toBe(2_000)
    return h
  }
  const refunds = (h: RoomHarness) => h.repos.entries.filter((e) => e.entry.reason === 'refund').map((e) => [e.entry.playerId, e.entry.delta])

  it('a carry-over release that landed but reported an error is not dealt into the next hand', async () => {
    const h = await carriedAndOpen()
    ackLostOnce(h, isRelease)
    h.clock.advance(TEST_ROOM_OPTIONS.carryOverReleaseMs)
    await tick(h)
    expect(refunds(h)).toEqual([['h', 1_000], ['poor', 1_000]]) // landed…
    expect(errors(h)).toEqual([
      { level: 'error', msg: 'carry-over release failed', data: expect.objectContaining({ pot: 2_000, key: expect.stringMatching(/^carry_over:room-1:/) }) },
    ])
    expect(h.room.view().carryOverPot).toBe(2_000) // …but not settled: still the room's, as far as anyone can tell
    expect(await books(h, { h: 100_000, poor: 2_500 })).toBe(2_000) // paid out and still held: counted twice until settled
    await h.room.sitOut('h', false) // both back in
    await h.room.sitOut('poor', false)
    await h.room.setReady('h', true)
    await h.room.setReady('poor', true)
    await h.room.startGame('h') // the deal settles the release first, under its key
    expect(h.room.snapshot(null).hand!.carryOverIn).toBe(0)
    expect(h.room.pendingRelease).toBeNull()
    expect(h.room.view().carryOverPot).toBe(0)
    expect(refunds(h)).toEqual([['h', 1_000], ['poor', 1_000]])
    await playOut(h, (id) => ({ kind: id === 'h' ? 'play' : 'fold' }))
    expect(await books(h, { h: 100_000, poor: 2_500 })).toBe(0)
  })

  it('a release that keeps failing keeps its pot aside: the hand deals without it, a newer pot is not overwritten, and each is paid once', async () => {
    const h = await carriedAndOpen()
    ackLostOnce(h, isRelease)
    h.clock.advance(TEST_ROOM_OPTIONS.carryOverReleaseMs)
    await tick(h)
    failOnce(h, isRelease) // the deal's retry fails too
    await h.room.sitOut('h', false)
    await h.room.sitOut('poor', false)
    await h.room.setReady('h', true)
    await h.room.setReady('poor', true)
    await h.room.startGame('h')
    expect(h.room.snapshot(null).hand!.carryOverIn).toBe(0) // aside, not in this hand
    expect(h.room.pendingRelease?.pot).toBe(2_000)
    await playOut(h, () => ({ kind: 'fold' })) // a new 2.000 is carried; poor is down to 500 on the table
    expect(h.room.carryOverPot).toBe(2_000)
    expect(h.room.pendingRelease?.pot).toBe(2_000) // the older pot is still aside
    expect(h.room.view().carryOverPot).toBe(4_000)
    await h.room.shutdown('maintenance') // settles the older pot (already paid), then releases the newer one
    expect(h.room.pendingRelease).toBeNull()
    expect(h.room.carryOverPot).toBe(0)
    expect(refunds(h)).toEqual([['h', 1_000], ['poor', 1_000], ['h', 1_000], ['poor', 1_000]])
    expect(await h.repos.balances.get('h')).toBe(100_000)
    expect(await h.repos.balances.get('poor')).toBe(2_500)
    expect(await books(h, { h: 100_000, poor: 2_500 })).toBe(0)
  })

  it('a close whose older release fails again logs the newer pot it cannot release behind it, with the room and the amount', async () => {
    const h = await carriedAndOpen()
    ackLostOnce(h, isRelease)
    h.clock.advance(TEST_ROOM_OPTIONS.carryOverReleaseMs) // the first 2.000 is owed from here (paid, not acknowledged)
    await tick(h)
    const real = h.repos.balances.apply.bind(h.repos.balances)
    h.repos.balances.apply = async (batch, meta, opts) => {
      if (isRelease(batch, meta)) throw new Error('ledger unavailable') // every release from here to the close
      return real(batch, meta, opts)
    }
    await h.room.sitOut('h', false)
    await h.room.sitOut('poor', false)
    await h.room.setReady('h', true)
    await h.room.setReady('poor', true)
    await h.room.startGame('h')
    await playOut(h, () => ({ kind: 'fold' })) // a newer 2.000 is carried behind it
    expect(h.room.pendingRelease?.pot).toBe(2_000)
    expect(h.room.carryOverPot).toBe(2_000)
    const pendingKey = h.room.pendingRelease!.key
    await h.room.shutdown('maintenance') // the older release fails again, so nothing newer is released behind it
    expect(h.room.status).toBe('CLOSED')
    expect(refunds(h)).toEqual([['h', 1_000], ['poor', 1_000]]) // the older pot's, once; the newer one is not paid
    expect(errors(h).slice(-2)).toEqual([
      { level: 'error', msg: 'carry-over release failed', data: expect.objectContaining({ roomId: 'room-1', pot: 2_000, key: pendingKey }) },
      { level: 'error', msg: 'carry-over not released at close', data: { roomId: 'room-1', pot: 2_000, behind: pendingKey } },
    ])
  })

  it('Sit pressed again after a Blind buy-in that landed but reported an error seats the player with that buy-in, not a second one', async () => {
    // The whole 5.000 goes to the table, so the balance left (0) is under the 2.000 a hand needs: the retry must not
    // be refused as INSUFFICIENT_BALANCE for a buy-in that is already paid.
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 1 } }, { players: [['h', 100_000], ['poor', 5_000]] })
    await h.room.join(h.identity('poor'))
    const pushed = () => h.ofType('poor', 'BALANCE').map((m) => m.balance)
    ackLostOnce(h, isBuyIn)
    expect(await code(h.room.sitDown('poor', 1))).toBe('Error: ack lost')
    expect(await h.repos.balances.get('poor')).toBe(0)
    expect(h.room.players.get('poor')!.seat).toBeNull()
    expect(pushed()).toEqual([0]) // the bar says what the ledger holds, landed or not, before the error
    await h.room.sitDown('poor', 2) // pressed again, on another seat even
    expect(h.room.players.get('poor')).toMatchObject({ seat: 2, stack: 5_000 })
    expect(pushed()).toEqual([0, 0]) // the replay seats the player and refreshes the bar, as a first Sit does
    expect(rowsOf(h, 'poor', 'buy_in')).toEqual([-5_000])
    expect(await h.repos.balances.get('poor')).toBe(0)
    await h.room.sitDown('h', 0)
    await h.room.setReady('h', true)
    await h.room.setReady('poor', true)
    await h.room.startGame('h')
    await playOut(h, () => ({ kind: 'fold' }))
    expect(await books(h, { h: 100_000, poor: 5_000 })).toBe(0)
  })

  it('Sit pressed again after a Hold’em buy-in that landed but reported an error debits once', async () => {
    const h = createRoomHarness(HOLDEM)
    await h.room.join(h.identity('a'))
    const pushed = () => h.ofType('a', 'BALANCE').map((m) => m.balance)
    ackLostOnce(h, isBuyIn)
    expect(await code(h.room.sitDown('a', 1, 20_000))).toBe('Error: ack lost')
    expect(errors(h)).toEqual([
      { level: 'error', msg: 'buy-in failed', data: expect.objectContaining({ playerId: 'a', key: expect.stringMatching(/^buy_in:room-1:/) }) },
    ])
    expect(pushed()).toEqual([80_000])
    await h.room.sitDown('a', 1, 20_000)
    expect(h.room.players.get('a')).toMatchObject({ seat: 1, stack: 20_000 })
    expect(pushed()).toEqual([80_000, 80_000])
    expect(rowsOf(h, 'a', 'buy_in')).toEqual([-20_000])
    expect(await h.repos.balances.get('a')).toBe(80_000)
    expect(await books(h, { h: 100_000, a: 100_000 })).toBe(0)
  })

  it('a buy-in left pending by a Leave or a shutdown is given back — landed or not, the player is never debited and unseated', async () => {
    const h = createRoomHarness(HOLDEM)
    await h.room.join(h.identity('a'))
    await h.room.join(h.identity('b'))
    ackLostOnce(h, (batch) => batch.some((e) => e.reason === 'buy_in' && e.playerId === 'a'))
    expect(await code(h.room.sitDown('a', 1, 20_000))).toBe('Error: ack lost')
    expect(await h.repos.balances.get('a')).toBe(80_000) // landed
    await h.room.leave('a')
    expect(h.room.hasPlayer('a')).toBe(false)
    expect(await h.repos.balances.get('a')).toBe(100_000)
    expect(h.repos.entries.filter((e) => e.entry.playerId === 'a').map((e) => [e.entry.reason, e.entry.delta])).toEqual([['buy_in', -20_000], ['refund', 20_000]])

    failOnce(h, (batch) => batch.some((e) => e.reason === 'buy_in' && e.playerId === 'b'))
    expect(await code(h.room.sitDown('b', 2, 20_000))).toBe('Error: ledger unavailable')
    expect(await h.repos.balances.get('b')).toBe(100_000) // never landed
    await h.room.shutdown('maintenance')
    expect(await h.repos.balances.get('b')).toBe(100_000) // the replay takes it, the refund gives it back
    expect(h.repos.entries.filter((e) => e.entry.playerId === 'b').map((e) => [e.entry.reason, e.entry.delta])).toEqual([['buy_in', -20_000], ['refund', 20_000]])
    expect([...h.repos.keys].filter((k) => k.startsWith('buy_in_refund:room-1:'))).toHaveLength(2)
    expect(await books(h, { h: 100_000, a: 100_000, b: 100_000 })).toBe(0)
  })

  it('a buy-in refund that fails during a shutdown is logged as a settlement, with its key and amount, and the room still closes', async () => {
    const h = createRoomHarness(HOLDEM)
    await h.room.join(h.identity('b'))
    failOnce(h, isBuyIn)
    expect(await code(h.room.sitDown('b', 2, 20_000))).toBe('Error: ledger unavailable')
    failOnce(h, (batch) => batch.some((e) => e.reason === 'refund')) // the replay lands, the refund does not
    await h.room.shutdown('maintenance')
    expect(h.room.status).toBe('CLOSED')
    expect(errors(h).at(-1)).toEqual({
      level: 'error',
      msg: 'shutdown settlement failed',
      data: expect.objectContaining({ roomId: 'room-1', playerId: 'b', buyIn: 20_000, key: expect.stringMatching(/^buy_in_refund:room-1:/) }),
    })
  })

  it('a buy-in whose refund landed but reported an error is never reused for a seat: the next Sit finishes the refund, then buys in afresh', async () => {
    const h = createRoomHarness(HOLDEM)
    await h.room.join(h.identity('a'))
    ackLostOnce(h, isBuyIn)
    expect(await code(h.room.sitDown('a', 1, 20_000))).toBe('Error: ack lost')
    ackLostOnce(h, (batch) => batch.some((e) => e.reason === 'refund'))
    expect(await code(h.room.leave('a'))).toBe('Error: ack lost') // the 20.000 went back, but the Leave was told it failed
    expect(errors(h).at(-1)).toEqual({ level: 'error', msg: 'leave failed', data: expect.objectContaining({ playerId: 'a', key: expect.stringMatching(/^buy_in_refund:room-1:/) }) })
    expect(h.room.hasPlayer('a')).toBe(true)
    expect(await h.repos.balances.get('a')).toBe(100_000)
    await h.room.sitDown('a', 1, 20_000)
    expect(h.room.players.get('a')).toMatchObject({ seat: 1, stack: 20_000 })
    expect(await h.repos.balances.get('a')).toBe(80_000) // one buy-in on the table, not one refunded and played as well
    expect(h.repos.entries.filter((e) => e.entry.playerId === 'a').map((e) => [e.entry.reason, e.entry.delta])).toEqual([['buy_in', -20_000], ['refund', 20_000], ['buy_in', -20_000]])
    expect(await books(h, { h: 100_000, a: 100_000 })).toBe(0)
  })

  it('a pending buy-in that never landed and can no longer be paid is dropped, and the next Sit is a fresh buy-in', async () => {
    const h = createRoomHarness(HOLDEM)
    await h.room.join(h.identity('a'))
    failOnce(h, isBuyIn)
    expect(await code(h.room.sitDown('a', 1, 40_000))).toBe('Error: ledger unavailable')
    h.repos.records.get('a')!.balance = 30_000 // spent elsewhere meanwhile
    expect(await code(h.room.sitDown('a', 1, 40_000))).toBe('INSUFFICIENT_BALANCE')
    await h.room.sitDown('a', 1, 20_000)
    expect(h.room.players.get('a')).toMatchObject({ seat: 1, stack: 20_000 })
    expect(await h.repos.balances.get('a')).toBe(10_000)
    expect(await books(h, { h: 100_000, a: 30_000 })).toBe(0) // from the 30.000 left once the rest was spent elsewhere
  })
})

describe('squeeze mode (spec 2026-10-08)', () => {
  const SQUEEZE: RoomConfig = { ...BLIND, turnTimerSec: 20, blind: { ...BLIND.blind!, decisionMode: 'none', botCount: 1, squeeze: true } }
  const types = (h: RoomHarness, id: string) => h.ofType(id, 'GAME_EVENT').map((m) => m.event.type)

  it('opens a SQUEEZE round with a deadline and ends it the moment the one human has turned', async () => {
    const h = createRoomHarness(SQUEEZE, { players: [['h', 100_000]] })
    await seatAndStart(h, ['h'])
    const phase = h.ofType('h', 'GAME_EVENT').find((m) => m.event.type === 'SQUEEZE_PHASE')!
    expect(phase.event).toMatchObject({ type: 'SQUEEZE_PHASE', seats: [0], deadlineAt: h.clock.now() + TEST_ROOM_OPTIONS.turnTimerMsOverride! })
    expect(h.room.snapshot('h').hand).toMatchObject({ phase: 'SQUEEZE', seats: [{ revealed: false }, { revealed: true }] })
    expect(h.room.snapshot('h').deadlineAt).toBe((phase.event as { deadlineAt?: number }).deadlineAt)

    await h.room.reveal('h')
    expect(types(h, 'h').slice(-2)).toEqual(['PLAYER_REVEALED', 'SQUEEZE_ENDED'])
    expect(h.room.snapshot('h').deadlineAt).toBeNull()
    await playOut(h)
    expect(h.repos.hands).toHaveLength(1)
  })

  it('turns the seats that have not turned when the round runs out, and goes on', async () => {
    const h = createRoomHarness({ ...SQUEEZE, blind: { ...SQUEEZE.blind!, botCount: 0 } }, { players: [['h', 100_000], ['a', 100_000]] })
    await seatAndStart(h, ['h', 'a'])
    await h.room.reveal('h')
    expect(types(h, 'a').slice(-1)).toEqual(['PLAYER_REVEALED'])
    h.clock.advance(TEST_ROOM_OPTIONS.turnTimerMsOverride!)
    await tick(h)
    const tail = types(h, 'a')
    expect(tail.slice(tail.indexOf('SQUEEZE_PHASE') + 1, tail.indexOf('SQUEEZE_ENDED') + 1)).toEqual(['PLAYER_REVEALED', 'PLAYER_REVEALED', 'SQUEEZE_ENDED'])
    expect(h.room.snapshot('a').hand?.phase).toBe('REVEAL')
    // No action timed out: the squeeze round is not a turn (spec §4.2.9).
    expect(h.room.players.get('a')!.consecutiveTimeouts).toBe(0)
    expect(h.ofType('a', 'GAME_EVENT').some((m) => m.event.type === 'PLAYER_ACTED' && m.event.timedOut)).toBe(false)
    await playOut(h)
    expect(h.repos.hands).toHaveLength(1)
  })

  // Final fix wave M1: "no hand" is a seat with no cards in the hand that is running. With no hand running at all, a
  // seated player's REVEAL is a no-op (next test); a player with no seat is refused either way.
  it('REVEAL is refused with no hand or no seat, and is nothing when sent again', async () => {
    const h = createRoomHarness(SQUEEZE, { players: [['h', 100_000], ['w', 100_000], ['x', 100_000]] })
    expect(await code(h.room.reveal('h')), 'no seat, no hand').toBe('NOT_SEATED')
    await seatAndStart(h, ['h'])
    await h.room.join(h.identity('w'))
    expect(await code(h.room.reveal('w'))).toBe('NOT_SEATED')
    // a seat taken after the deal holds no cards in the hand that is running
    await h.room.join(h.identity('x'))
    const taken = new Set([...h.room.players.values()].map((p) => p.seat))
    await h.room.sitDown('x', [0, 1, 2, 3].find((seat) => !taken.has(seat))!)
    expect(await code(h.room.reveal('x'))).toBe('NOT_IN_HAND')
    await h.room.reveal('h')
    const before = h.ofType('h', 'GAME_EVENT').length
    await h.room.reveal('h')
    expect(h.ofType('h', 'GAME_EVENT').length).toBe(before)
  })

  // Final fix wave M1: the client sends REVEAL as the last card opens; on a slow link, or with the choice made within that
  // card's animation, it lands after the hand is over. It must not come back as "you are not in this hand".
  it('a REVEAL from a seated player with no hand running is answered with nothing: no error, no event, no timer', async () => {
    const h = createRoomHarness(SQUEEZE, { players: [['h', 100_000]] })
    await h.room.sitDown('h', 0)
    expect(h.room.handActive).toBe(false)
    expect(await code(h.room.reveal('h')), 'seated, before the first hand').toBeNull()
    await h.room.setReady('h', true)
    await h.room.startGame('h')
    await h.room.reveal('h')
    await playOut(h)
    expect(h.room.handActive).toBe(false)
    const sent = h.ofType('h', 'GAME_EVENT').length
    const nextHandAt = h.room.nextHandAt
    expect(await code(h.room.reveal('h')), 'after the hand is over').toBeNull()
    expect(h.ofType('h', 'GAME_EVENT')).toHaveLength(sent)
    expect(h.ofType('h', 'ERROR')).toHaveLength(0)
    expect(h.room.nextHandAt).toBe(nextHandAt)
  })

  it('play or fold on a squeeze table keeps its decision round: the deadline comes from the config, and deciding turns the cards', async () => {
    const h = createRoomHarness({ ...SQUEEZE, blind: { ...SQUEEZE.blind!, decisionMode: 'playOrFold' } }, { players: [['h', 100_000]] })
    await seatAndStart(h, ['h'])
    expect(h.room.snapshot('h').hand?.phase).toBe('DECISION')
    await h.room.action('h', { kind: 'play' }, h.room.seq)
    expect(types(h, 'h')).toContain('PLAYER_REVEALED')
    await playOut(h)
    expect(h.repos.hands).toHaveLength(1)
  })

  // Final fix wave F4: on a play-or-fold squeeze table the decision is the round (spec §4.2.4) — a REVEAL turns the seat
  // there, for the others to see, and the decision goes on to its own deadline; it does not end anything.
  it('a REVEAL in a play-or-fold squeeze DECISION turns the seat for the others and leaves the decision running', async () => {
    const h = createRoomHarness({ ...SQUEEZE, blind: { ...SQUEEZE.blind!, decisionMode: 'playOrFold', botCount: 0 } }, { players: [['h', 100_000], ['a', 100_000]] })
    await seatAndStart(h, ['h', 'a'])
    expect(h.room.snapshot('h').hand?.phase).toBe('DECISION')
    const deadlineAt = h.room.snapshot('h').deadlineAt
    expect(deadlineAt).not.toBeNull()
    const seat = h.room.players.get('h')!.seat!
    h.clock.advance(1_000)
    await h.room.reveal('h')
    const seen = h.ofType('a', 'GAME_EVENT').at(-1)!.event
    expect(seen, 'the other player sees h turned').toEqual({ type: 'PLAYER_REVEALED', seat })
    expect(h.room.snapshot('a').hand).toMatchObject({ phase: 'DECISION' })
    expect(h.room.snapshot('a').hand?.seats.find((s) => s.seat === seat)).toMatchObject({ revealed: true, hasDecided: false })
    expect(h.room.snapshot('h').deadlineAt, 'the decision keeps its deadline').toBe(deadlineAt)
    expect(types(h, 'h')).not.toContain('SQUEEZE_ENDED')
    // and the choice is still h's to make
    await h.room.action('h', { kind: 'play' }, h.room.seq)
    await playOut(h)
    expect(h.repos.hands).toHaveLength(1)
  })

  it('a REVEAL in the DECISION of a plain play-or-fold table sends nothing and leaves the deadline where it was', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 0 } }, { players: [['h', 100_000], ['a', 100_000]] })
    await seatAndStart(h, ['h', 'a'])
    expect(h.room.snapshot('h').hand?.phase).toBe('DECISION')
    const deadlineAt = h.room.snapshot('h').deadlineAt
    expect(deadlineAt).not.toBeNull()
    const sent = { h: h.ofType('h', 'GAME_EVENT').length, a: h.ofType('a', 'GAME_EVENT').length }
    h.clock.advance(1_000)
    expect(await code(h.room.reveal('h'))).toBeNull()
    expect(h.ofType('h', 'GAME_EVENT')).toHaveLength(sent.h)
    expect(h.ofType('a', 'GAME_EVENT')).toHaveLength(sent.a)
    expect(h.room.snapshot('h').deadlineAt).toBe(deadlineAt)
  })

  it('a REVEAL after the round is over leaves the hand’s timers alone: the next card comes on time', async () => {
    const h = createRoomHarness(SQUEEZE, { players: [['h', 100_000]] })
    await seatAndStart(h, ['h'])
    await h.room.reveal('h')
    expect(h.room.snapshot('h').hand?.phase).toBe('REVEAL')
    h.clock.advance(TEST_ROOM_OPTIONS.revealDelayMs / 2)
    await h.room.reveal('h') // late; a submit would re-arm the reveal timer from here
    h.clock.advance(TEST_ROOM_OPTIONS.revealDelayMs / 2)
    await tick(h)
    expect(types(h, 'h')).toContain('COMMUNITY_REVEALED')
  })

  it('a REVEAL at a Hold’em table, in the middle of a turn, sends nothing and leaves the deadline where it was', async () => {
    const h = createRoomHarness(HOLDEM)
    await seatAndStart(h, ['h', 'a'], 20_000)
    const deadlineAt = h.room.snapshot('h').deadlineAt
    expect(deadlineAt).not.toBeNull()
    const sent = h.ofType('h', 'GAME_EVENT').length
    h.clock.advance(1_000)
    await h.room.reveal('h')
    expect(h.room.snapshot('h').deadlineAt).toBe(deadlineAt)
    expect(h.ofType('h', 'GAME_EVENT')).toHaveLength(sent)
  })

  it('a seat that leaves in the middle of the round does not hold it: it is turned for them, and the round ends with the rest', async () => {
    const h = createRoomHarness({ ...SQUEEZE, blind: { ...SQUEEZE.blind!, botCount: 0 } }, { players: [['h', 100_000], ['a', 100_000]] })
    await seatAndStart(h, ['h', 'a'])
    await h.room.leave('a')
    expect(types(h, 'h').slice(-1)).toEqual(['PLAYER_REVEALED'])
    expect(h.room.snapshot('h').hand?.phase).toBe('SQUEEZE')
    await h.room.reveal('h')
    expect(types(h, 'h').slice(-2)).toEqual(['PLAYER_REVEALED', 'SQUEEZE_ENDED'])
    expect(h.room.snapshot('h').hand?.phase).toBe('REVEAL')
    await playOut(h)
    expect(h.repos.hands).toHaveLength(1)
    expect(h.room.hasPlayer('a')).toBe(false)
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
    const onTable = (id: string) => h.room.players.get(id)?.stack ?? 0
    const humanDelta = (await h.repos.balances.get('h')) + (await h.repos.balances.get('a')) + onTable('h') + onTable('a') - 200_000
    const sinkTotal = h.repos.sinks.reduce((s, x) => s + x.fee, 0)
    // every fee the engine took is recorded as a table_fee sink row, and nothing else is
    expect(h.repos.sinks.filter((x) => x.kind === 'table_fee').reduce((s, x) => s + x.fee, 0)).toBe(totalFees)
    expect(humanDelta + botNet + sinkTotal + h.room.carryOverPot).toBe(0)
    const seqs = h.ofType('h', 'GAME_EVENT').map((m) => m.seq)
    expect(seqs.every((s, i) => i === 0 || s > seqs[i - 1]!)).toBe(true)
  })

  it('Blind writes no table_fee sink', async () => {
    // Plan 27 D1: Blind takes no fee, so twenty hands of a mixed policy leave the sinks empty (a carried pot stays a
    // pot, not a sink) and every recorded hand says fee 0.
    const h = createRoomHarness(BLIND, { seed: 11, players: [['h', 1_000_000], ['a', 1_000_000]] })
    await seatAndStart(h, ['h', 'a'])
    let n = 0
    const policy: Policy = (id, legal) => ({ kind: legal.kinds.includes('play') && (id === 'h' ? n % 3 !== 0 : n % 2 === 0) ? 'play' : 'fold' })
    while (n++ < 20) {
      await playOut(h, policy)
      // A seat that went to 0 is stood up (D2); it sits down again, so the twenty hands are played by the same two.
      for (const [i, id] of ['h', 'a'].entries()) {
        if (h.room.players.get(id)!.seat !== null) continue
        await h.room.sitDown(id, i)
        if (h.room.status === 'OPEN') await h.room.setReady(id, true)
      }
      if (h.room.status === 'OPEN') await h.room.startGame('h')
      h.clock.advance(100)
      await tick(h)
    }
    expect(h.repos.hands).toHaveLength(20)
    expect(h.repos.hands.every((x) => x.fee === 0)).toBe(true)
    expect(h.repos.sinks).toEqual([])
    expect(await books(h, { h: 1_000_000, a: 1_000_000 })).toBe(0)
  })

  it('200 chaos hands, drafts and card credits included, keep the books at 0', async () => {
    // Plan 37: the spec's 47 cards, a draft every 5 hands (every human takes the first card offered), two bots. A card
    // credit is a source row on the ledger and new points on a stack; books() takes the sources back out.
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, chaosCycle: 5 } }, { seed: 37, chaos: true, players: [['h', 1_000_000], ['a', 1_000_000]] })
    const ids = ['h', 'a']
    const pickAll = async () => {
      for (const id of ids) {
        const draft = h.room.snapshot(id).chaos?.draft
        if (draft?.offer && !draft.picked) await h.room.pickChaos(id, draft.offer.offerId, draft.offer.cardIds[0]!)
      }
    }
    for (const [i, id] of ids.entries()) {
      if (id !== 'h') await h.room.join(h.identity(id))
      await h.room.sitDown(id, i)
      await h.room.setReady(id, true)
    }
    await h.room.startGame('h')
    await pickAll()
    let n = 0
    const policy: Policy = (id, legal) => ({ kind: legal.kinds.includes('play') && (id === 'h' ? n % 3 !== 0 : n % 2 === 0) ? 'play' : 'fold' })
    while (h.repos.hands.length < 200 && n++ < 400) {
      await playOut(h, policy)
      expect(await books(h, { h: 1_000_000, a: 1_000_000 })).toBe(0)
      for (const [i, id] of ids.entries()) {
        if (h.room.players.get(id)!.seat !== null) continue
        await h.room.sitDown(id, i)
        if (h.room.status === 'OPEN') await h.room.setReady(id, true)
      }
      if (h.room.status === 'OPEN') await h.room.startGame('h')
      h.clock.advance(100)
      await tick(h)
      await pickAll()
    }
    expect(h.repos.hands).toHaveLength(200)
    expect(h.repos.hands.every((x) => x.chaosUsed !== undefined)).toBe(true)
    expect(h.repos.hands.some((x) => (x.chaosUsed?.length ?? 0) > 0)).toBe(true)
    expect(h.ofType('h', 'ROOM_EVENT').filter((m) => m.event.type === 'CHAOS_DRAFT').length).toBeGreaterThanOrEqual(40)
    // The run must actually pay: otherwise it proves nothing about the credits.
    expect(h.repos.entries.some((e) => e.entry.reason === 'chaos_to_table')).toBe(true)
    expect(await books(h, { h: 1_000_000, a: 1_000_000 })).toBe(0)
  })

  it('a chaos seat brings the whole balance (5.000.000), plays two hands — the second dealt by "Bỏ qua" — and stands: the books stay at 0 (BP-39)', async () => {
    const start = { h: 5_000_000, a: 100_000 }
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, chaosCycle: 5 } }, { seed: 39, chaos: { config: { resultMs: 10_000 } }, players: Object.entries(start) })
    const ids = ['h', 'a']
    const pickAll = async () => {
      for (const id of ids) {
        const draft = h.room.snapshot(id).chaos?.draft
        if (draft?.offer && !draft.picked) await h.room.pickChaos(id, draft.offer.offerId, draft.offer.cardIds[0]!)
      }
    }
    for (const [i, id] of ids.entries()) {
      if (id !== 'h') await h.room.join(h.identity(id))
      await h.room.sitDown(id, i)
      await h.room.setReady(id, true)
    }
    // No table limit at a chaos table: everything comes to the seat, nothing stays behind; the bots keep their limit.
    expect(h.room.players.get('h')!.stack).toBe(5_000_000)
    expect(h.room.players.get('a')!.stack).toBe(100_000)
    expect(await h.repos.balances.get('h')).toBe(0)
    expect(h.room.view().players.filter((p) => p.isBot).map((p) => p.stack)).toEqual([10_000, 10_000])
    await h.room.startGame('h')
    await pickAll()
    await playOut(h)
    expect(await books(h, start)).toBe(0)
    for (const id of ids) await h.room.skipResult(id)
    expect(h.room.handActive).toBe(true) // dealt at once, long before the 10 s result time
    await playOut(h)
    expect(h.repos.hands).toHaveLength(2)
    expect(await books(h, start)).toBe(0)
    for (const id of ids) await h.room.standUp(id)
    expect(ids.map((id) => h.room.players.get(id)!.stack)).toEqual([0, 0])
    expect(await books(h, start)).toBe(0)
  })

  /**
   * Plan 37 final wave (ledger ruling): a credit whose first write landed but whose reply was lost, and whose retry
   * failed, is kept pending under its key — never dropped — and the stack is raised once when a later retry answers.
   * Every card is a Cấp cứu Bạc; `h` brings 2.500, so one lost ante leaves 1.500 (under 2 wagers: rescued, still seated).
   */
  const RESCUE_ONLY = CHAOS_CARDS_SPEC.filter((c) => c.effect === 'rescue')
  const pendingTable = (players: [string, number][] = [['h', 2_500]]) => {
    let attempts = 0
    // Attempt 1 writes and loses its reply; attempt 2 (the in-hand retry) fails outright; attempt 3 on answers.
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, chaosCycle: 5 } }, {
      players,
      chaos: { cards: RESCUE_ONLY, config: { tierWeights: { silver: 1, gold: 0, diamond: 0 } }, failCredit: () => ++attempts === 2, loseCreditReply: () => true },
    })
    return h
  }
  const startPending = async (h: RoomHarness) => {
    await seatAndStart(h, ['h'])
    const draft = h.room.snapshot('h').chaos!.draft!
    await h.room.pickChaos('h', draft.offer!.offerId, draft.offer!.cardIds[0]!)
    await tick(h)
    await playOut(h, () => ({ kind: 'fold' }))
  }
  const credits = (h: RoomHarness) => h.ofType('h', 'ROOM_EVENT').map((m) => m.event).filter((e) => e.type === 'CHAOS_CREDIT')

  it('a chaos credit that fails twice stays pending and lands once after the next hand: the stack is raised once, books 0', async () => {
    const h = pendingTable()
    await startPending(h)
    expect(h.room.players.get('h')!.stack).toBe(1_500) // not raised yet
    expect(h.repos.entries.filter((e) => e.entry.reason === 'chaos_rescue').map((e) => e.entry.delta)).toEqual([5_000]) // but it landed
    expect(credits(h)).toEqual([])
    expect(h.logs.some((l) => l.level === 'error' && /chaos credit failed; pending/.test(l.msg))).toBe(true)
    h.clock.advance(TEST_ROOM_OPTIONS.handIntervalMs)
    await tick(h)
    await playOut(h, () => ({ kind: 'fold' }))
    expect(h.room.players.get('h')!.seat).toBe(0)
    expect(h.room.players.get('h')!.stack).toBe(500 + 5_000)
    expect(credits(h)).toEqual([{ type: 'CHAOS_CREDIT', seat: 0, amount: 5_000, stack: 5_500, reason: 'chaos_rescue', capped: false }])
    expect(h.repos.entries.filter((e) => e.entry.reason === 'chaos_rescue')).toHaveLength(1) // the replay wrote nothing
    expect(await books(h, { h: 2_500 })).toBe(0)
  })

  it('a pending chaos credit is settled before a stand-up cashes the stack out, and a stand-up it cannot settle keeps the seat frozen', async () => {
    const h = pendingTable()
    await startPending(h)
    await h.room.standUp('h')
    expect(h.room.players.get('h')!.seat).toBeNull()
    expect(await h.repos.balances.get('h')).toBe(1_500 + 5_000) // the credit, then the cash-out of the raised stack
    expect(credits(h)).toHaveLength(1)
    expect(await books(h, { h: 2_500 })).toBe(0)

    // The same, with a port that stays down: the stand-up is refused and the seat sits out with its stack until a retry.
    let down = false
    let attempts = 0
    const g = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, chaosCycle: 5 } }, {
      players: [['h', 2_500]],
      chaos: { cards: RESCUE_ONLY, config: { tierWeights: { silver: 1, gold: 0, diamond: 0 } }, failCredit: () => down || ++attempts === 2, loseCreditReply: () => true },
    })
    await startPending(g)
    down = true
    await expect(g.room.standUp('h')).rejects.toThrow()
    expect(g.room.players.get('h')!.seat).toBe(0)
    expect(g.room.players.get('h')!.stack).toBe(1_500)
    expect(g.room.players.get('h')!.cashOutPending).toBe(true)
    expect(g.room.players.get('h')!.sittingOut).toBe(true)
    down = false
    await g.room.standUp('h')
    expect(g.room.players.get('h')!.seat).toBeNull()
    expect(await g.repos.balances.get('h')).toBe(6_500)
    expect(await books(g, { h: 2_500 })).toBe(0)
  })
})

describe('adminKick (Plan 25)', () => {
  it('removes a seated player between hands at once, host included, and the host moves on', async () => {
    const h = createRoomHarness(BLIND)
    await h.room.join(h.identity('a'))
    await h.room.sitDown('h', 0)
    await h.room.sitDown('a', 1)
    expect(await h.room.adminKick('h')).toBe('now')
    expect(h.room.hasPlayer('h')).toBe(false)
    expect(h.room.hostPlayerId).toBe('a')
    expect(await h.repos.balances.get('h')).toBe(100_000) // the stack went home
    expect(h.last('h', 'NOTIFICATION')).toMatchObject({ kind: 'KICKED' })
    expect(await books(h, { h: 100_000, a: 100_000 })).toBe(0)
  })

  it('folds a player in the current hand now and removes them when it ends, the money conserved', async () => {
    const h = createRoomHarness(BLIND)
    await seatAndStart(h, ['h', 'a'])
    expect(await h.room.adminKick('a')).toBe('after_hand')
    expect(h.room.players.get('a')?.leaveAfterHand).toBe(true)
    expect(h.room.hasPlayer('a')).toBe(true) // still in the hand until it ends
    await playOut(h)
    await tick(h)
    expect(h.room.hasPlayer('a')).toBe(false)
    expect(await books(h, { h: 100_000, a: 100_000 })).toBe(0)
  })

  it('refuses a bot', async () => {
    const h = createRoomHarness(BLIND)
    expect(await code(h.room.adminKick('bot:room-1:0'))).toBe('ILLEGAL_ACTION')
    expect(h.room.hasPlayer('bot:room-1:0')).toBe(true)
  })
})

describe('adminSummary (Plan 25)', () => {
  it('lists the room as the GM screen reads it: counts, flags, members, whether a hand is running', async () => {
    const h = createRoomHarness({ ...BLIND, isPrivate: true, password: 'pw' })
    await h.room.join(h.identity('a'), 'pw')
    await h.room.sitDown('h', 0)
    await h.room.sitDown('a', 1)
    const before = h.room.adminSummary()
    expect(before).toMatchObject({ roomId: h.room.roomId, code: h.room.code, name: 'B', mode: 'blind', status: 'OPEN', isPrivate: true, hasPassword: true, players: 4, maxPlayers: 4, hostPlayerId: 'h', hostDisplayName: h.identity('h').displayName, carryOverPot: 0, handInProgress: false })
    expect(typeof before.createdAt).toBe('number')
    expect(before.members.map((m) => m.playerId).sort()).toEqual(['a', 'bot:room-1:0', 'bot:room-1:1', 'h'])
    expect(before.members.find((m) => m.playerId === 'a')).toMatchObject({ isBot: false, seat: 1, connected: true })
    expect(before.members.filter((m) => m.isBot)).toHaveLength(2)
    await h.room.setReady('h', true)
    await h.room.setReady('a', true)
    await h.room.startGame('h')
    expect(h.room.adminSummary()).toMatchObject({ status: 'IN_GAME', handInProgress: true })
  })
})
