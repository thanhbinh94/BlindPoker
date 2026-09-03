import type { LegalActions, PlayerAction, RoomConfig } from '@bp/core'
import { describe, expect, it } from 'vitest'
import { createRoomHarness, type RoomHarness } from '../testing/room-harness.js'
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
    expect(settled[0]!.meta).toEqual({ refId: summary.handId, fee: summary.fee })
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

  it('shutdown splits a carried-over pot among seated humans', async () => {
    const h = createRoomHarness({ ...BLIND, blind: { ...BLIND.blind!, botCount: 0 } })
    await seatAndStart(h, ['h', 'a'])
    await playOut(h, () => ({ kind: 'fold' })) // both fold → 2000 carried
    expect(h.room.carryOverPot).toBe(2_000)
    await h.room.shutdown('restart')
    expect(await h.repos.balances.get('h')).toBe(100_000) // −1000 ante + 1000 refund
    expect(await h.repos.balances.get('a')).toBe(100_000)
    expect(h.repos.entries.filter((e) => e.entry.reason === 'refund')).toHaveLength(2)
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
    expect(humanDelta + botNet + totalFees + h.room.carryOverPot).toBe(0)
    const seqs = h.ofType('h', 'GAME_EVENT').map((m) => m.seq)
    expect(seqs.every((s, i) => i === 0 || s > seqs[i - 1]!)).toBe(true)
  })
})
