import { CHAOS_CARDS_SPEC, type ChaosCardDef, type LegalActions, type PlayerAction, type RoomConfig, type RoomEvent, type ServerMessage } from '@bp/core'
import { describe, expect, it } from 'vitest'
import { createRoomHarness, type RoomHarness } from '../testing/room-harness.js'
import { RoomError } from './types.js'

/** A chaos Blind table: two bots on seats 3 and 2, a draft every 5 hands. */
const CHAOS: RoomConfig = {
  name: 'C', mode: 'blind', maxPlayers: 4, isPrivate: false, turnTimerSec: 15, autoStart: false,
  blind: { holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1000, botCount: 2, chaosCycle: 5 },
}
const DRAFT_MS = 15_000
const byId = new Map(CHAOS_CARDS_SPEC.map((c) => [c.id, c]))
/** Only the Cấp cứu cards, all Bạc: every offer is `s_rescue`, a card that waits (it stays held until it pays). */
const RESCUE_ONLY: readonly ChaosCardDef[] = CHAOS_CARDS_SPEC.filter((c) => c.effect === 'rescue')
const SILVER_ONLY = { tierWeights: { silver: 1, gold: 0, diamond: 0 } }

type Policy = (playerId: string, legal: LegalActions) => PlayerAction
const passive: Policy = (_id, legal) => ({ kind: legal.kinds.includes('play') ? 'play' : legal.kinds.includes('check') ? 'check' : 'fold' })
const folds: Policy = () => ({ kind: 'fold' })
const code = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof RoomError ? e.code : String(e)))
const tick = (h: RoomHarness) => h.room.enqueue(() => undefined)

const roomEvents = (h: RoomHarness, id: string): RoomEvent[] => h.ofType(id, 'ROOM_EVENT').map((m) => m.event)
const ofEvent = <T extends RoomEvent['type']>(h: RoomHarness, id: string, type: T) =>
  roomEvents(h, id).filter((e): e is Extract<RoomEvent, { type: T }> => e.type === type)
type Offer = { offerId: string; tier: string; cardIds: string[]; deadlineAt: number; draftMs: number }
const offers = (h: RoomHarness, id: string): Offer[] =>
  h.ofType(id, 'NOTIFICATION').filter((m: Extract<ServerMessage, { t: 'NOTIFICATION' }>) => m.kind === 'CHAOS_OFFER').map((m) => m.payload as Offer)
const lastOffer = (h: RoomHarness, id: string): Offer => offers(h, id).at(-1)!

/** Drives the current hand to completion: humans follow `policy`, bots, reveals and timers run by advancing the clock. */
async function playOut(h: RoomHarness, policy: Policy = passive): Promise<void> {
  let guard = 0
  while (h.room.handActive && guard++ < 300) {
    const hand = h.room.snapshot(null).hand!
    if (hand.phase === 'REVEAL') {
      h.clock.advance(10)
      await tick(h)
      continue
    }
    const human = hand.phase === 'DECISION'
      ? hand.seats.find((s) => !s.hasDecided && !s.isBot)
      : hand.seats.find((s) => s.seat === hand.actingSeat && !s.isBot)
    if (!human) {
      h.clock.advance(10)
      await tick(h)
      continue
    }
    const legal = h.room.snapshot(human.playerId).hand!.legal!
    await h.room.action(human.playerId, policy(human.playerId, legal), h.room.seq)
  }
  if (h.room.handActive) throw new Error('hand did not finish')
  await tick(h)
}

/** Every human with an open offer picks its first card (the draft then deals). */
async function pickAll(h: RoomHarness, ids: string[]): Promise<void> {
  for (const id of ids) {
    const snap = h.room.snapshot(id).chaos?.draft
    if (snap?.offer && !snap.picked) await h.room.pickChaos(id, snap.offer.offerId, snap.offer.cardIds[0]!)
  }
  await tick(h)
}

/** To the next deal: the hand interval, then the draft if one opened (everyone picks). */
async function nextHand(h: RoomHarness, ids: string[]): Promise<void> {
  h.clock.advance(100)
  await tick(h)
  if (h.room.snapshot(null).chaos?.draft) await pickAll(h, ids)
}

async function seat(h: RoomHarness, ids: string[]): Promise<void> {
  for (const [i, id] of ids.entries()) {
    if (id !== h.room.hostPlayerId) await h.room.join(h.identity(id))
    await h.room.sitDown(id, i)
    await h.room.setReady(id, true)
  }
}

describe('Chaos room: the draft', () => {
  it('the first hand opens a draft: one tier, three private cards to each human, none to a spectator, bots pick at once', async () => {
    const h = createRoomHarness({ ...CHAOS, maxPlayers: 5 }, { chaos: true })
    await seat(h, ['h', 'a'])
    await h.room.join(h.identity('b')) // a spectator
    await h.room.startGame('h')

    expect(h.room.handActive).toBe(false)
    expect(h.room.status).toBe('IN_GAME')
    const deadlineAt = h.clock.now() + DRAFT_MS
    const draft = ofEvent(h, 'b', 'CHAOS_DRAFT')
    expect(draft).toHaveLength(1)
    expect(draft[0]).toMatchObject({ deadlineAt, draftMs: DRAFT_MS, seats: [0, 1, 3, 4] }) // the bots sit on 4 and 3
    expect(h.last('h', 'ROOM_EVENT')?.event).toEqual({ type: 'ROOM_STATUS', status: 'IN_GAME', nextHandAt: deadlineAt })
    expect(h.room.nextHandAt).toBe(deadlineAt)
    for (const id of ['h', 'a']) {
      expect(offers(h, id)).toHaveLength(1)
      const offer = lastOffer(h, id)
      expect(offer.tier).toBe(draft[0]!.tier)
      expect(offer.deadlineAt).toBe(deadlineAt)
      expect(offer.draftMs).toBe(DRAFT_MS)
      expect(new Set(offer.cardIds).size).toBe(3)
      expect(offer.cardIds.every((c) => byId.get(c)?.tier === offer.tier)).toBe(true)
    }
    expect(offers(h, 'b')).toEqual([])
    expect(ofEvent(h, 'h', 'CHAOS_PICKED')).toEqual([]) // nothing is said until the draft is over
    // Bots are not waited on: one human pick leaves only the other's.
    await h.room.pickChaos('h', lastOffer(h, 'h').offerId, lastOffer(h, 'h').cardIds[1]!)
    expect(h.room.handActive).toBe(false)
  })

  it('the last pick ends the draft: every seat is told what it got, then the hand is dealt', async () => {
    const h = createRoomHarness(CHAOS, { chaos: { cards: RESCUE_ONLY, config: SILVER_ONLY } })
    await seat(h, ['h', 'a'])
    await h.room.startGame('h')
    expect(lastOffer(h, 'h').cardIds).toEqual(['s_rescue'])
    await h.room.pickChaos('h', lastOffer(h, 'h').offerId, 's_rescue')
    await h.room.pickChaos('a', lastOffer(h, 'a').offerId, 's_rescue')
    expect(h.room.handActive).toBe(true)
    expect(ofEvent(h, 'h', 'CHAOS_PICKED').map((e) => e.seat).sort()).toEqual([0, 1, 2, 3])
    expect(ofEvent(h, 'h', 'CHAOS_PICKED').every((e) => e.cardIds.join() === 's_rescue')).toBe(true)
    const state = ofEvent(h, 'h', 'CHAOS_STATE').at(-1)!
    expect(state.seats.map((s) => [s.seat, s.cards.map((c) => c.cardId), s.points])).toEqual([[0, ['s_rescue'], 0], [1, ['s_rescue'], 0], [2, ['s_rescue'], 0], [3, ['s_rescue'], 0]])
    const types = h.ofType('h', 'ROOM_EVENT').map((m) => m.event.type)
    expect(types.lastIndexOf('CHAOS_STATE')).toBeLessThan(types.lastIndexOf('ROOM_STATUS')) // then the hand's IN_GAME
    expect(h.room.view().players.find((p) => p.playerId === 'h')!.chaos).toEqual({ cards: [expect.objectContaining({ cardId: 's_rescue', tier: 'silver', handsLeft: null })], points: 0, bonusCount: 0 })
    await playOut(h)
    expect(h.repos.hands[0]!.chaosUsed).toEqual([]) // a rescue card is not "used" by a hand it does not pay in
  })

  it('the deadline picks at random for whoever has not', async () => {
    const h = createRoomHarness(CHAOS, { chaos: true })
    await seat(h, ['h', 'a'])
    await h.room.startGame('h')
    h.clock.advance(DRAFT_MS - 1)
    await tick(h)
    expect(h.room.handActive).toBe(false)
    h.clock.advance(1)
    await tick(h)
    expect(h.room.handActive).toBe(true)
    const picked = ofEvent(h, 'h', 'CHAOS_PICKED')
    expect(lastOffer(h, 'h').cardIds).toContain(picked.find((e) => e.seat === 0)!.cardIds[0])
    expect(lastOffer(h, 'a').cardIds).toContain(picked.find((e) => e.seat === 1)!.cardIds[0])
    expect(await code(h.room.pickChaos('h', lastOffer(h, 'h').offerId, lastOffer(h, 'h').cardIds[0]!))).toBe('CHAOS_NO_OFFER')
  })

  it('a seat that leaves mid-draft does not hold the table', async () => {
    const h = createRoomHarness(CHAOS, { chaos: true })
    await seat(h, ['h', 'a'])
    await h.room.startGame('h')
    await h.room.pickChaos('h', lastOffer(h, 'h').offerId, lastOffer(h, 'h').cardIds[0]!)
    await h.room.leave('a')
    await tick(h)
    expect(h.room.handActive).toBe(true)
    expect(h.room.snapshot('h').hand!.seats.map((s) => s.playerId)).not.toContain('a')
    expect(ofEvent(h, 'h', 'CHAOS_PICKED').map((e) => e.seat)).not.toContain(1)
  })

  it('a seat that stands mid-draft drops its offer the same way', async () => {
    const h = createRoomHarness(CHAOS, { chaos: true })
    await seat(h, ['h', 'a'])
    await h.room.startGame('h')
    await h.room.pickChaos('a', lastOffer(h, 'a').offerId, lastOffer(h, 'a').cardIds[0]!)
    await h.room.standUp('h')
    await tick(h)
    expect(h.room.handActive).toBe(true)
    expect(h.room.players.get('h')!.chaos).toBeUndefined()
  })

  it('a disconnected human is picked for at once', async () => {
    const h = createRoomHarness(CHAOS, { chaos: true })
    await seat(h, ['h', 'a'])
    await h.room.onDisconnect('a')
    await h.room.startGame('h')
    expect(h.room.snapshot(null).chaos?.draft).not.toBeNull()
    await h.room.pickChaos('h', lastOffer(h, 'h').offerId, lastOffer(h, 'h').cardIds[0]!)
    expect(h.room.handActive).toBe(true)
    expect(ofEvent(h, 'h', 'CHAOS_PICKED').map((e) => e.seat).sort()).toEqual([0, 1, 2, 3])
  })

  it('the snapshot restores the viewer\'s draft', async () => {
    const h = createRoomHarness({ ...CHAOS, maxPlayers: 5 }, { chaos: true })
    await seat(h, ['h', 'a'])
    await h.room.join(h.identity('b'))
    await h.room.startGame('h')
    const offer = lastOffer(h, 'h')
    const deadlineAt = h.clock.now() + DRAFT_MS
    expect(h.room.snapshot('h').chaos).toEqual({ draft: { tier: offer.tier, deadlineAt, draftMs: DRAFT_MS, offer: { offerId: offer.offerId, cardIds: offer.cardIds }, picked: false } })
    expect(h.room.snapshot('b').chaos).toEqual({ draft: { tier: offer.tier, deadlineAt, draftMs: DRAFT_MS, offer: null, picked: false } })
    expect(h.room.snapshot('h').room.nextHandAt).toBe(deadlineAt)
    await h.room.pickChaos('h', offer.offerId, offer.cardIds[2]!)
    expect(h.room.snapshot('h').chaos!.draft).toMatchObject({ picked: true })
    await h.room.pickChaos('a', lastOffer(h, 'a').offerId, lastOffer(h, 'a').cardIds[0]!)
    expect(h.room.snapshot('h').chaos).toEqual({ draft: null })
  })

  it('a pick with a stale or foreign offer id is CHAOS_NO_OFFER, a card not offered is refused, and a second pick is stale', async () => {
    const h = createRoomHarness(CHAOS, { chaos: true })
    await seat(h, ['h', 'a'])
    await h.room.startGame('h')
    const mine = lastOffer(h, 'h')
    expect(await code(h.room.pickChaos('h', 'nope', mine.cardIds[0]!))).toBe('CHAOS_NO_OFFER')
    expect(await code(h.room.pickChaos('h', lastOffer(h, 'a').offerId, lastOffer(h, 'a').cardIds[0]!))).toBe('CHAOS_NO_OFFER')
    const notOffered = CHAOS_CARDS_SPEC.find((c) => !mine.cardIds.includes(c.id))!.id
    expect(await code(h.room.pickChaos('h', mine.offerId, notOffered))).toBe('ILLEGAL_ACTION')
    await h.room.pickChaos('h', mine.offerId, mine.cardIds[0]!)
    expect(await code(h.room.pickChaos('h', mine.offerId, mine.cardIds[1]!))).toBe('CHAOS_NO_OFFER')
  })

  it('a draft opens again at hand 5 (cycle 5) and not at hand 4', async () => {
    const h = createRoomHarness(CHAOS, { chaos: true })
    await seat(h, ['h', 'a'])
    await h.room.startGame('h')
    await pickAll(h, ['h', 'a'])
    expect(h.room.tableHands).toBe(1)
    for (let n = 1; n < 5; n++) {
      await playOut(h)
      await nextHand(h, [])
      expect(h.room.handActive).toBe(true) // hands at tableHands 1..4: no draft
    }
    expect(ofEvent(h, 'h', 'CHAOS_DRAFT')).toHaveLength(1)
    expect(h.room.tableHands).toBe(5)
    await playOut(h)
    h.clock.advance(100)
    await tick(h)
    expect(h.room.handActive).toBe(false)
    expect(ofEvent(h, 'h', 'CHAOS_DRAFT')).toHaveLength(2)
    expect(offers(h, 'h')).toHaveLength(2)
  })

  it('a held Tay bạc is dropped when its holder drafts in the next cycle', async () => {
    const gamblerOnly = CHAOS_CARDS_SPEC.filter((c) => c.effect === 'gambler')
    const h = createRoomHarness(CHAOS, { chaos: { cards: gamblerOnly, config: { tierWeights: { silver: 0, gold: 0, diamond: 1 } } } })
    await seat(h, ['h', 'a'])
    await h.room.startGame('h')
    await pickAll(h, ['h', 'a'])
    const first = h.room.players.get('h')!.chaos!.cards
    expect(first.map((c) => c.cardId)).toEqual(['d_gambler'])
    for (let n = 1; n < 5; n++) {
      await playOut(h)
      await nextHand(h, [])
    }
    expect(h.room.players.get('h')!.chaos!.cards).toEqual(first) // it lasts the whole cycle
    await playOut(h)
    await nextHand(h, ['h', 'a'])
    const second = h.room.players.get('h')!.chaos!.cards
    expect(second.map((c) => c.cardId)).toEqual(['d_gambler']) // the new one only
    expect(second[0]!.uid).not.toBe(first[0]!.uid)
  })

  it('a player who stands and sits again in the same cycle gets no new draft; standing clears cards and points', async () => {
    const h = createRoomHarness(CHAOS, { chaos: { cards: RESCUE_ONLY, config: SILVER_ONLY } })
    await seat(h, ['h', 'a'])
    await h.room.startGame('h')
    await pickAll(h, ['h', 'a'])
    await playOut(h)
    const before = h.room.players.get('h')!.chaos!
    expect(before.cards.map((c) => c.cardId)).toEqual(['s_rescue'])
    expect(before.points).toBeGreaterThan(0)
    await h.room.standUp('h')
    expect(h.room.players.get('h')!.chaos).toBeUndefined()
    expect(h.room.view().players.find((p) => p.playerId === 'h')!.chaos).toBeUndefined()
    await h.room.sitDown('h', 0)
    expect(h.room.view().players.find((p) => p.playerId === 'h')!.chaos).toEqual({ cards: [], points: 0, bonusCount: 0 })
    h.clock.advance(100)
    await tick(h)
    expect(h.room.handActive).toBe(true)
    expect(ofEvent(h, 'h', 'CHAOS_DRAFT')).toHaveLength(1)
  })

  it('a seat taken during the draft plays that hand undrafted and drafts before its next one', async () => {
    const h = createRoomHarness({ ...CHAOS, blind: { ...CHAOS.blind!, botCount: 1 } }, { chaos: true })
    await seat(h, ['h'])
    await h.room.startGame('h')
    await h.room.join(h.identity('a'))
    await h.room.sitDown('a', 1)
    await pickAll(h, ['h'])
    expect(h.room.handActive).toBe(true)
    expect(h.room.snapshot('h').hand!.seats.map((s) => s.playerId)).toContain('a')
    expect(offers(h, 'a')).toEqual([])
    await playOut(h)
    h.clock.advance(100)
    await tick(h)
    expect(h.room.handActive).toBe(false)
    expect(ofEvent(h, 'h', 'CHAOS_DRAFT').at(-1)!.seats).toEqual([1])
    expect(offers(h, 'a')).toHaveLength(1)
    expect(offers(h, 'h')).toHaveLength(1)
  })

  it('tells the GM’s draft length (not a fixed 15 s) in the frame, the offer and the snapshot', async () => {
    const h = createRoomHarness(CHAOS, { chaos: { config: { draftMs: 40_000 } } })
    await seat(h, ['h', 'a'])
    await h.room.startGame('h')
    expect(ofEvent(h, 'h', 'CHAOS_DRAFT')[0]).toMatchObject({ draftMs: 40_000, deadlineAt: h.clock.now() + 40_000 })
    expect(lastOffer(h, 'h').draftMs).toBe(40_000)
    expect(h.room.snapshot('h').chaos!.draft!.draftMs).toBe(40_000)
  })

  it('a port that cannot answer is logged and the hand is dealt without a draft', async () => {
    let down = true
    const h = createRoomHarness(CHAOS, { chaos: { failReads: () => down } })
    await seat(h, ['h', 'a'])
    await h.room.startGame('h')
    expect(h.room.handActive).toBe(true)
    expect(ofEvent(h, 'h', 'CHAOS_DRAFT')).toEqual([])
    expect(h.logs.some((l) => l.level === 'error' && /chaos/.test(l.msg))).toBe(true)
    await playOut(h)
    down = false
    h.clock.advance(100)
    await tick(h)
    expect(ofEvent(h, 'h', 'CHAOS_DRAFT')).toHaveLength(1) // nobody was drafted, so the next hand drafts
  })

  it('closing the room during a draft cancels its timer', async () => {
    const h = createRoomHarness(CHAOS, { chaos: true })
    await seat(h, ['h', 'a'])
    await h.room.startGame('h')
    await h.room.shutdown('test')
    expect(h.room.status).toBe('CLOSED')
    h.clock.advance(DRAFT_MS)
    await tick(h)
    expect(h.room.handActive).toBe(false)
    expect(ofEvent(h, 'h', 'CHAOS_PICKED')).toEqual([])
  })
})

describe('Chaos room: credits', () => {
  /** One human with 1.500 (so one lost ante leaves 500, under 2 wagers) and two bots, every card a Cấp cứu Bạc. */
  const rescueTable = (opts: { failCredit?: () => boolean } = {}, stake = 1_500) =>
    createRoomHarness(CHAOS, { players: [['h', stake]], chaos: { cards: RESCUE_ONLY, config: SILVER_ONLY, ...opts } })

  it('a rescue credit writes chaos_rescue + chaos_to_table under its key and raises the stack, outside the hand\'s net', async () => {
    const h = rescueTable()
    await seat(h, ['h'])
    await h.room.startGame('h')
    await pickAll(h, ['h'])
    const uid = h.room.players.get('h')!.chaos!.cards[0]!.uid
    await playOut(h, folds)
    const summary = h.repos.hands[0]!
    const key = `chaos:room-1:${summary.handId}:0:${uid}:chaos_rescue`
    expect(summary.players.find((p) => p.playerId === 'h')!.net).toBe(-1_000)
    expect(h.repos.entries.filter((e) => e.entry.refId === key).map((e) => [e.entry.reason, e.entry.delta])).toEqual([['chaos_rescue', 5_000], ['chaos_to_table', -5_000]])
    expect(h.repos.keys.has(key)).toBe(true)
    expect(await h.repos.balances.get('h')).toBe(0) // the balance is untouched: the points went to the table
    expect(h.room.players.get('h')!.stack).toBe(500 + 5_000)
    expect(h.room.players.get('h')!.seat).toBe(0)
    expect(h.room.players.get('h')!.chaos!.cards).toEqual([]) // the card paid and left
    expect(ofEvent(h, 'h', 'CHAOS_CREDIT')).toEqual([{ type: 'CHAOS_CREDIT', seat: 0, amount: 5_000, stack: 5_500, reason: 'chaos_rescue', capped: false }])
    const types = h.ofType('h', 'ROOM_EVENT').map((m) => m.event.type)
    expect(types.indexOf('CHAOS_CREDIT')).toBeLessThan(types.lastIndexOf('CHAOS_STATE'))
  })

  it('a rescue under a cap pays what is left and says it was capped', async () => {
    const h = createRoomHarness(CHAOS, { players: [['h', 1_500]], chaos: { cards: RESCUE_ONLY, config: SILVER_ONLY, capPoints: 2_000 } })
    await seat(h, ['h'])
    await h.room.startGame('h')
    await pickAll(h, ['h'])
    await playOut(h, folds)
    expect(ofEvent(h, 'h', 'CHAOS_CREDIT')).toEqual([{ type: 'CHAOS_CREDIT', seat: 0, amount: 2_000, stack: 2_500, reason: 'chaos_rescue', capped: true }])
    expect(h.room.players.get('h')!.stack).toBe(2_500)
  })

  it('a credit that fails once is retried; one that fails twice is kept pending and settled before the seat is judged spent', async () => {
    let failures = 1
    const h = rescueTable({ failCredit: () => failures-- > 0 })
    await seat(h, ['h'])
    await h.room.startGame('h')
    await pickAll(h, ['h'])
    await playOut(h, folds)
    expect(h.room.players.get('h')!.stack).toBe(5_500)

    // Twice: kept pending (logged), the stack not raised yet; a stand-up settles it before it cashes the stack out.
    failures = 2
    const g = rescueTable({ failCredit: () => failures-- > 0 })
    await seat(g, ['h'])
    await g.room.startGame('h')
    await pickAll(g, ['h'])
    await playOut(g, folds)
    expect(g.logs.some((l) => l.level === 'error' && /chaos credit failed; pending/.test(l.msg))).toBe(true)
    expect(g.room.players.get('h')!.stack).toBe(500)
    expect(ofEvent(g, 'h', 'CHAOS_CREDIT')).toEqual([])
    await g.room.standUp('h')
    expect(ofEvent(g, 'h', 'CHAOS_CREDIT')).toEqual([{ type: 'CHAOS_CREDIT', seat: 0, amount: 5_000, stack: 5_500, reason: 'chaos_rescue', capped: false }])
    expect(await g.repos.balances.get('h')).toBe(5_500)
  })

  it('a seat a hand left at 0 whose rescue is pending is settled before it is judged spent, and kept (sat out) when it fails again', async () => {
    // 1.000 brought: the folded ante leaves 0. Twice: the stand-up check retries it once more and the seat stays, rescued.
    let failures = 2
    const g = rescueTable({ failCredit: () => failures-- > 0 }, 1_000)
    await seat(g, ['h'])
    await g.room.startGame('h')
    await pickAll(g, ['h'])
    await playOut(g, folds)
    expect(g.room.players.get('h')!.seat).toBe(0)
    expect(g.room.players.get('h')!.stack).toBe(5_000)
    expect(ofEvent(g, 'h', 'CHAOS_CREDIT')).toEqual([{ type: 'CHAOS_CREDIT', seat: 0, amount: 5_000, stack: 5_000, reason: 'chaos_rescue', capped: false }])
    expect(g.ofType('h', 'NOTIFICATION').some((m) => m.kind === 'STACK_SPENT')).toBe(false)

    // Three times: still owed, nothing written, the seat kept at 0 (never cashed out as spent) and sat out of the next deal.
    failures = 3
    const k = rescueTable({ failCredit: () => failures-- > 0 }, 1_000)
    await seat(k, ['h'])
    await k.room.startGame('h')
    await pickAll(k, ['h'])
    await playOut(k, folds)
    expect(k.room.players.get('h')!.seat).toBe(0)
    expect(k.room.players.get('h')!.stack).toBe(0)
    expect(ofEvent(k, 'h', 'CHAOS_CREDIT')).toEqual([])
    expect(k.repos.entries.filter((e) => e.entry.reason.startsWith('chaos'))).toEqual([])
    k.clock.advance(100)
    await tick(k)
    expect(k.room.players.get('h')!.sittingOut).toBe(true)
  })

  it('a cancelled hand settles no chaos', async () => {
    const h = rescueTable()
    await seat(h, ['h'])
    await h.room.startGame('h')
    await pickAll(h, ['h'])
    const held = h.room.players.get('h')!.chaos
    await h.room.shutdown('test')
    expect(h.repos.hands[0]!.cancelled).toBe(true)
    expect(h.repos.hands[0]!.chaosUsed).toBeUndefined()
    expect(h.repos.entries.filter((e) => e.entry.reason.startsWith('chaos'))).toEqual([])
    expect(held!.cards).toHaveLength(1)
  })
})
