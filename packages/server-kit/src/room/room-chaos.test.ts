import {
  CHAOS_CARDS_SPEC, DEFAULT_CHAOS_CONFIG, EMPTY_CHAOS_SEAT, toHeld, type ChaosBonusPayload, type ChaosCardDef, type ChaosSeat, type GameEvent, type HandState, type LegalActions,
  type PlayerAction, type RoomConfig, type RoomEvent, type ServerMessage,
} from '@bp/core'
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
    expect(h.room.snapshot('h').chaos).toEqual({ draft: { tier: offer.tier, deadlineAt, draftMs: DRAFT_MS, offer: { offerId: offer.offerId, cardIds: offer.cardIds }, picked: false }, bonus: { cards: [], armed: null } })
    expect(h.room.snapshot('b').chaos).toEqual({ draft: { tier: offer.tier, deadlineAt, draftMs: DRAFT_MS, offer: null, picked: false } })
    expect(h.room.snapshot('h').room.nextHandAt).toBe(deadlineAt)
    await h.room.pickChaos('h', offer.offerId, offer.cardIds[2]!)
    expect(h.room.snapshot('h').chaos!.draft).toMatchObject({ picked: true })
    await h.room.pickChaos('a', lastOffer(h, 'a').offerId, lastOffer(h, 'a').cardIds[0]!)
    expect(h.room.snapshot('h').chaos).toEqual({ draft: null, bonus: { cards: [], armed: null } })
    expect(h.room.snapshot('b').chaos).toEqual({ draft: null })
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
    // The port was down at the settlement too, so the result stays up for the default result time (10 s), logged.
    expect(h.room.nextHandAt).toBe(h.clock.now() + DEFAULT_CHAOS_CONFIG.resultMs)
    expect(h.logs.some((l) => l.level === 'error' && l.msg.startsWith('chaos result time unread'))).toBe(true)
    h.clock.advance(DEFAULT_CHAOS_CONFIG.resultMs - 1)
    await tick(h)
    expect(ofEvent(h, 'h', 'CHAOS_DRAFT')).toEqual([])
    h.clock.advance(1)
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

describe('Chaos room: the bonus hand (BP-39)', () => {
  const STEAL = byId.get('s_steal_one')!
  const LOWER = byId.get('s_lower')!
  /** Above any uid the room hands out in these tests. */
  const BONUS_UID = 9_001
  const quiet = () => ({ chaos: { cards: RESCUE_ONLY, config: SILVER_ONLY } })

  /** Puts `cards` in a seat's bonus hand, as a hand's points would have (uids `BONUS_UID`, `BONUS_UID + 1`, …). */
  function giveBonus(h: RoomHarness, id: string, cards: readonly ChaosCardDef[] = [STEAL], extra: Partial<ChaosSeat> = {}): void {
    const p = h.room.players.get(id)!
    p.chaos = { ...(p.chaos ?? EMPTY_CHAOS_SEAT), bonus: cards.map((c, i) => toHeld(c, BONUS_UID + i)), ...extra }
  }
  const bonusOf = (h: RoomHarness, id: string): ChaosBonusPayload[] =>
    h.ofType(id, 'NOTIFICATION').filter((m) => m.kind === 'CHAOS_BONUS').map((m) => m.payload as ChaosBonusPayload)
  const applied = (h: RoomHarness, id: string) =>
    h.ofType(id, 'GAME_EVENT').map((m) => m.event as GameEvent).filter((e): e is Extract<GameEvent, { type: 'CHAOS_APPLIED' }> => e.type === 'CHAOS_APPLIED')
  const seatState = (h: RoomHarness, id: string, seatNo: number) => ofEvent(h, id, 'CHAOS_STATE').at(-1)!.seats.find((s) => s.seat === seatNo)!
  const view = (card: ChaosCardDef, uid: number) => ({ uid, cardId: card.id, tier: card.tier, handsLeft: card.params.hands ?? null })
  const phase = (h: RoomHarness) => h.room.snapshot(null).hand?.phase
  /** A refusal's code and why (`armBonus`'s error, or the room's), so each case is refused for its own reason. */
  const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof RoomError ? `${e.code} ${e.message}` : String(e)))

  /** Every human plays, then the clock runs until the hand reaches `target` (or ends). */
  async function runTo(h: RoomHarness, target: 'REVEAL'): Promise<void> {
    let guard = 0
    while (h.room.handActive && phase(h) !== target && guard++ < 300) {
      const hand = h.room.snapshot(null).hand!
      const human = hand.phase === 'DECISION' ? hand.seats.find((s) => !s.hasDecided && !s.isBot) : undefined
      if (human) await h.room.action(human.playerId, { kind: 'play' }, h.room.seq)
      else {
        h.clock.advance(1)
        await tick(h)
      }
    }
  }

  it('a bonus card a hand awards goes to its owner alone: CHAOS_BONUS for the owner, only a count for the table', async () => {
    // The pool holds both Bạc cards, so every offer shows both: each human drafts the Cấp cứu (it waits, held), and the
    // bonus cards drawn after the hand lean to Lấy lá (a card to press) by weight; the seeded rng keeps the draws fixed.
    const pool: readonly ChaosCardDef[] = [...RESCUE_ONLY, STEAL]
    const weights = new Map([['s_steal_one', 50]])
    const h = createRoomHarness({ ...CHAOS, maxPlayers: 5 }, { chaos: { cards: pool, weights, config: { ...SILVER_ONLY, pointsThreshold: 1 } } })
    await seat(h, ['h', 'a'])
    await h.room.join(h.identity('b'))
    await h.room.startGame('h')
    for (const id of ['h', 'a']) await h.room.pickChaos(id, lastOffer(h, id).offerId, 's_rescue')
    await tick(h)
    await playOut(h)

    const mine = h.room.players.get('h')!.chaos!
    expect(mine.bonus.length).toBeGreaterThan(0)
    expect(mine.bonus.every((c) => c.cardId === 's_steal_one')).toBe(true)
    expect(mine.cards.map((c) => c.cardId)).toEqual(['s_rescue']) // the drafted card only: a bonus card is not held
    expect(bonusOf(h, 'h').at(-1)).toEqual({ cards: mine.bonus.map((c) => view(STEAL, c.uid)), armed: null })
    const pub = { cards: [view(byId.get('s_rescue')!, mine.cards[0]!.uid)], points: mine.points, bonusCount: mine.bonus.length }
    expect(seatState(h, 'b', 0)).toEqual({ seat: 0, ...pub })
    expect(h.room.snapshot('b').room.players.find((p) => p.playerId === 'h')!.chaos).toEqual(pub)
    // Only cards that act on their own are announced: the bots' (theirs act at once), never a human's bonus card.
    expect(ofEvent(h, 'b', 'CHAOS_AWARDED').map((e) => e.seat)).not.toContain(0)
    expect(ofEvent(h, 'b', 'CHAOS_AWARDED').map((e) => e.seat)).not.toContain(1)
    expect(bonusOf(h, 'b')).toEqual([])
    const uids = new Set(mine.bonus.map((c) => c.uid))
    expect(bonusOf(h, 'a').flatMap((p) => p.cards.map((c) => c.uid)).some((u) => uids.has(u))).toBe(false)
    expect(bonusOf(h, 'a').at(-1)).toEqual({ cards: h.room.players.get('a')!.chaos!.bonus.map((c) => view(STEAL, c.uid)), armed: null })
  })

  it('a card played between hands fires first in the next hand; the table learns of it only when it fires', async () => {
    const h = createRoomHarness(CHAOS, quiet())
    await seat(h, ['h', 'a'])
    giveBonus(h, 'h')
    await h.room.startGame('h') // the draft is open: between hands
    await h.room.useChaosBonus('h', BONUS_UID)
    expect(bonusOf(h, 'h')).toEqual([{ cards: [], armed: { uid: BONUS_UID, cardId: 's_steal_one', hand: 'next' } }])
    expect(h.room.view().players.find((p) => p.playerId === 'h')!.chaos!.bonusCount).toBe(1) // the armed card still counts
    expect(bonusOf(h, 'a')).toEqual([])

    await pickAll(h, ['h', 'a'])
    expect(bonusOf(h, 'h').at(-1)).toEqual({ cards: [], armed: { uid: BONUS_UID, cardId: 's_steal_one', hand: 'this' } })
    expect(applied(h, 'a')).toEqual([])
    await playOut(h)
    expect(applied(h, 'a').filter((e) => e.seat === 0).map((e) => e.cardId)).toEqual(['s_steal_one'])
    expect(h.room.players.get('h')!.chaos).toMatchObject({ bonus: [], armed: null })
    expect(bonusOf(h, 'h').at(-1)).toEqual({ cards: [], armed: null })
    expect(seatState(h, 'a', 0).bonusCount).toBe(0)
    expect(bonusOf(h, 'a')).toEqual([])
  })

  it('a steal played during the play/fold choice fires at this hand\'s reveal', async () => {
    const h = createRoomHarness(CHAOS, quiet())
    await seat(h, ['h', 'a'])
    await h.room.startGame('h')
    await pickAll(h, ['h', 'a'])
    expect(phase(h)).toBe('DECISION')
    giveBonus(h, 'h')
    await h.room.useChaosBonus('h', BONUS_UID)
    expect(bonusOf(h, 'h')).toEqual([{ cards: [], armed: { uid: BONUS_UID, cardId: 's_steal_one', hand: 'this' } }])
    expect(applied(h, 'a')).toEqual([])
    await playOut(h)
    expect(applied(h, 'a').filter((e) => e.seat === 0).map((e) => e.cardId)).toEqual(['s_steal_one'])
    expect(h.repos.hands[0]!.chaosUsed).toEqual([expect.objectContaining({ seat: 0, cardId: 's_steal_one' })])
    expect(h.room.players.get('h')!.chaos).toMatchObject({ bonus: [], armed: null })
    expect(bonusOf(h, 'h').at(-1)).toEqual({ cards: [], armed: null })
    expect(seatState(h, 'a', 0).bonusCount).toBe(0)
  })

  it('a card played during the choice by a seat that then folds goes back to its hand, and nobody else ever learns it was played (Review Focus 1)', async () => {
    const h = createRoomHarness({ ...CHAOS, maxPlayers: 5 }, quiet())
    await seat(h, ['h', 'a'])
    await h.room.join(h.identity('b'))
    await h.room.startGame('h')
    await pickAll(h, ['h', 'a'])
    giveBonus(h, 'h')
    await h.room.useChaosBonus('h', BONUS_UID)
    await playOut(h, (id, legal) => (id === 'h' ? { kind: 'fold' } : passive(id, legal)))

    expect(h.room.players.get('h')!.chaos).toMatchObject({ bonus: [toHeld(STEAL, BONUS_UID)], armed: null })
    expect(bonusOf(h, 'h').at(-1)).toEqual({ cards: [view(STEAL, BONUS_UID)], armed: null })
    expect(h.repos.hands[0]!.chaosUsed!.some((u) => u.cardId === 's_steal_one')).toBe(false)
    for (const id of ['a', 'b']) {
      expect(applied(h, id).filter((e) => e.seat === 0)).toEqual([])
      expect(bonusOf(h, id)).toEqual([])
      expect(seatState(h, id, 0).bonusCount).toBe(1)
      expect(JSON.stringify(h.sent.get(id))).not.toContain('s_steal_one')
    }
  })

  it('a reconnect mid-hand: the owner\'s snapshot has its bonus hand and armed card, every other viewer only the count (Review Focus 2)', async () => {
    const h = createRoomHarness({ ...CHAOS, maxPlayers: 5 }, quiet())
    await seat(h, ['h', 'a'])
    await h.room.join(h.identity('b'))
    await h.room.startGame('h')
    await pickAll(h, ['h', 'a'])
    giveBonus(h, 'h', [STEAL, LOWER])
    await h.room.useChaosBonus('h', BONUS_UID)
    await h.room.onDisconnect('h')
    await h.room.onReconnect('h')

    const own = h.room.snapshot('h')
    expect(own.chaos).toEqual({ draft: null, bonus: { cards: [view(LOWER, BONUS_UID + 1)], armed: { uid: BONUS_UID, cardId: 's_steal_one', hand: 'this' } } })
    expect(own.room.players.find((p) => p.playerId === 'h')!.chaos!.bonusCount).toBe(2)
    const seated = h.room.snapshot('a')
    const spectator = h.room.snapshot('b')
    expect(seated.chaos).toEqual({ draft: null, bonus: { cards: [], armed: null } })
    expect(spectator.chaos).toEqual({ draft: null })
    for (const s of [seated, spectator]) {
      expect(s.room.players.find((p) => p.playerId === 'h')!.chaos!.bonusCount).toBe(2)
      expect(JSON.stringify(s)).not.toMatch(/s_steal_one|s_lower/) // nor in the hand view: the plan never leaves the server
    }
  })

  it('past the choice (the reveal) and at a "Hoàn toàn may rủi" table mid-hand a card cannot be played', async () => {
    const h = createRoomHarness(CHAOS, quiet())
    await seat(h, ['h', 'a'])
    await h.room.startGame('h')
    await pickAll(h, ['h', 'a'])
    giveBonus(h, 'h')
    await runTo(h, 'REVEAL')
    expect(phase(h)).toBe('REVEAL')
    expect(await refusal(h.room.useChaosBonus('h', BONUS_UID))).toBe('CHAOS_CANNOT_USE not during this hand')

    const g = createRoomHarness({ ...CHAOS, blind: { ...CHAOS.blind!, decisionMode: 'none', squeeze: true } }, quiet())
    await seat(g, ['h', 'a'])
    await g.room.startGame('h')
    await pickAll(g, ['h', 'a'])
    expect(phase(g)).toBe('SQUEEZE')
    giveBonus(g, 'h')
    expect(await refusal(g.room.useChaosBonus('h', BONUS_UID))).toBe('CHAOS_CANNOT_USE not during this hand')
    expect(g.room.players.get('h')!.chaos).toMatchObject({ bonus: [toHeld(STEAL, BONUS_UID)], armed: null })
    expect(bonusOf(g, 'h')).toEqual([])
  })

  it('refuses a spectator, a plain Blind table, an unknown card, a second card, a seat frozen this hand and a seat sitting the hand out', async () => {
    const plain = createRoomHarness({ ...CHAOS, blind: { holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1000, botCount: 2 } })
    await seat(plain, ['h', 'a'])
    expect(await refusal(plain.room.useChaosBonus('h', 1))).toBe('CHAOS_CANNOT_USE no seat at a chaos table')

    const h = createRoomHarness({ ...CHAOS, maxPlayers: 5 }, quiet())
    await seat(h, ['h', 'a'])
    await h.room.join(h.identity('b'))
    giveBonus(h, 'h', [STEAL, LOWER])
    expect(await refusal(h.room.useChaosBonus('b', BONUS_UID))).toBe('CHAOS_CANNOT_USE no seat at a chaos table')
    expect(await refusal(h.room.useChaosBonus('h', 1))).toBe('CHAOS_CANNOT_USE NO_CARD')
    await h.room.useChaosBonus('h', BONUS_UID)
    expect(await refusal(h.room.useChaosBonus('h', BONUS_UID + 1))).toBe('CHAOS_CANNOT_USE ALREADY_ARMED') // one at a time
    expect(bonusOf(h, 'h')).toHaveLength(1)

    // Frozen this hand: the choice is refused (between hands the card would wait for the next unfrozen hand).
    const f = createRoomHarness(CHAOS, quiet())
    await seat(f, ['h', 'a'])
    giveBonus(f, 'h', [STEAL], { frozenNextHand: true })
    await f.room.startGame('h')
    await pickAll(f, ['h', 'a'])
    expect(phase(f)).toBe('DECISION')
    expect(await refusal(f.room.useChaosBonus('h', BONUS_UID))).toBe('CHAOS_CANNOT_USE FROZEN')

    // A seat taken during the hand is not in it: nothing to play into until the hand is over.
    const s = createRoomHarness({ ...CHAOS, maxPlayers: 5 }, quiet())
    await seat(s, ['h', 'a'])
    await s.room.startGame('h')
    await pickAll(s, ['h', 'a'])
    await s.room.join(s.identity('b'))
    await s.room.sitDown('b', 2)
    giveBonus(s, 'b')
    expect(await refusal(s.room.useChaosBonus('b', BONUS_UID))).toBe('CHAOS_CANNOT_USE not during this hand')
    await playOut(s)
    await s.room.useChaosBonus('b', BONUS_UID)
    expect(bonusOf(s, 'b').at(-1)!.armed).toMatchObject({ uid: BONUS_UID, hand: 'next' })
  })

  it('standing up empties the bonus hand, and its owner is told', async () => {
    const h = createRoomHarness(CHAOS, quiet())
    await seat(h, ['h', 'a'])
    giveBonus(h, 'h')
    await h.room.useChaosBonus('h', BONUS_UID)
    await h.room.standUp('h')
    expect(bonusOf(h, 'h').at(-1)).toEqual({ cards: [], armed: null })
    expect(h.room.snapshot('h').chaos).toEqual({ draft: null })
  })

  it('a played card that fizzles where the table saw it is spent: nobody can later tell it went back to the hand (I1)', async () => {
    const STORM = byId.get('d_storm')!
    const h = createRoomHarness({ ...CHAOS, maxPlayers: 5 }, quiet())
    await seat(h, ['h', 'a'])
    await h.room.join(h.identity('b'))
    await h.room.startGame('h')
    await pickAll(h, ['h', 'a'])
    giveBonus(h, 'h', [STORM, LOWER])
    await h.room.useChaosBonus('h', BONUS_UID)
    // Leave exactly the board in the deck: at the reveal the storm finds nothing to redeal and fizzles.
    const live = (h.room as unknown as { runner: { state: HandState } }).runner.state
    live.deck = live.deck.slice(0, live.deckIndex + 5)
    await playOut(h)

    for (const id of ['a', 'b']) {
      expect(applied(h, id).filter((e) => e.seat === 0)).toEqual([expect.objectContaining({ cardId: 'd_storm', outcome: 'fizzled' })])
      expect(seatState(h, id, 0).bonusCount).toBe(1) // the Hạ bài left in the hand; the storm is gone
    }
    expect(h.room.players.get('h')!.chaos).toMatchObject({ bonus: [toHeld(LOWER, BONUS_UID + 1)], armed: null })
    expect(bonusOf(h, 'h').at(-1)).toEqual({ cards: [view(LOWER, BONUS_UID + 1)], armed: null })
  })

  it('a seat that stands up or leaves mid-hand with a played card is folded, gets the card back, then an empty hand (P4)', async () => {
    for (const move of ['standUp', 'leave'] as const) {
      const h = createRoomHarness(CHAOS, quiet())
      await seat(h, ['h', 'a'])
      await h.room.startGame('h')
      await pickAll(h, ['h', 'a'])
      giveBonus(h, 'h')
      await h.room.useChaosBonus('h', BONUS_UID)
      await h.room[move]('a')
      await h.room[move]('h')
      await playOut(h)
      expect(applied(h, 'a').filter((e) => e.seat === 0)).toEqual([])
      expect(h.repos.hands[0]!.players.find((p) => p.playerId === 'h')!.net).toBe(-1_000) // folded: the ante is lost
      expect(bonusOf(h, 'h').slice(-2)).toEqual([{ cards: [view(STEAL, BONUS_UID)], armed: null }, { cards: [], armed: null }])
    }
  })

  it('a cancelled hand gives a played card back at once, told to its owner, before the close clears the seat (M4)', async () => {
    const h = createRoomHarness(CHAOS, quiet())
    await seat(h, ['h', 'a'])
    await h.room.startGame('h')
    await pickAll(h, ['h', 'a'])
    giveBonus(h, 'h')
    await h.room.useChaosBonus('h', BONUS_UID)
    await h.room.shutdown('test')
    expect(h.repos.hands[0]!.cancelled).toBe(true)
    expect(bonusOf(h, 'h').slice(-2)).toEqual([{ cards: [view(STEAL, BONUS_UID)], armed: null }, { cards: [], armed: null }])
    expect(bonusOf(h, 'a')).toEqual([])
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

describe('Chaos room: the result time and "Bỏ qua" (BP-39)', () => {
  /** Two humans `h` and `a` (seats 0, 1) and one bot (the last seat), every card a Cấp cứu Bạc, a 10 s result time. */
  const ONE_BOT: RoomConfig = { ...CHAOS, blind: { ...CHAOS.blind!, botCount: 1 } }
  const RESULT_MS = 10_000
  const table = (resultMs = RESULT_MS, players?: [string, number][]) =>
    createRoomHarness({ ...ONE_BOT, maxPlayers: players && players.length > 3 ? players.length + 1 : ONE_BOT.maxPlayers }, { chaos: { cards: RESCUE_ONLY, config: { ...SILVER_ONLY, resultMs } }, ...(players ? { players } : {}) })
  const skips = (h: RoomHarness, id = 'h') => ofEvent(h, id, 'RESULT_SKIPS').map((e) => [e.skipped, e.total])
  /** Seats `h` and `a`, drafts, plays the first hand out: the result wait has begun. */
  async function toResult(h: RoomHarness): Promise<void> {
    await seat(h, ['h', 'a'])
    await h.room.startGame('h')
    await pickAll(h, ['h', 'a'])
    await playOut(h)
  }

  it('the next deal waits the result time the port gives (7 s), and a plain Blind table keeps its hand interval (5 s)', async () => {
    const h = table(7_000)
    await toResult(h)
    expect(h.room.nextHandAt).toBe(h.clock.now() + 7_000)
    expect(ofEvent(h, 'h', 'ROOM_STATUS').at(-1)).toEqual({ type: 'ROOM_STATUS', status: 'IN_GAME', nextHandAt: h.clock.now() + 7_000 })
    h.clock.advance(6_999)
    await tick(h)
    expect(h.room.handActive).toBe(false)
    h.clock.advance(1)
    await tick(h)
    expect(h.room.handActive).toBe(true)

    const { blind } = CHAOS
    const plain = createRoomHarness({ ...CHAOS, blind: { holeCards: blind!.holeCards, decisionMode: blind!.decisionMode, fixedWager: blind!.fixedWager, botCount: 2 } }, { options: { handIntervalMs: 5_000 } })
    await seat(plain, ['h', 'a'])
    await plain.room.startGame('h')
    await playOut(plain)
    expect(plain.room.nextHandAt).toBe(plain.clock.now() + 5_000)
    expect(skips(plain)).toEqual([]) // no vote at a plain table
    await plain.room.skipResult('h') // ignored, no error
    expect(plain.room.handActive).toBe(false)
    plain.clock.advance(5_000)
    await tick(plain)
    expect(plain.room.handActive).toBe(true)
  })

  it('two humans and a bot: the wait starts at 0/2, one "Bỏ qua" says 1/2 and keeps the timer, the second deals at once', async () => {
    const h = table()
    await toResult(h)
    const at = h.room.nextHandAt
    expect(skips(h)).toEqual([[0, 2]])
    expect(skips(h, 'a')).toEqual([[0, 2]])
    await h.room.skipResult('h')
    expect(skips(h)).toEqual([[0, 2], [1, 2]])
    expect(h.room.handActive).toBe(false)
    expect(h.room.nextHandAt).toBe(at)
    await h.room.skipResult('h') // a second press counts nothing and says nothing
    expect(skips(h)).toEqual([[0, 2], [1, 2]])
    await h.room.skipResult('a')
    expect(skips(h)).toEqual([[0, 2], [1, 2], [2, 2]])
    expect(h.room.handActive).toBe(true)
    expect(h.room.nextHandAt).toBeNull()
    expect(ofEvent(h, 'a', 'ROOM_STATUS').at(-1)).toEqual({ type: 'ROOM_STATUS', status: 'IN_GAME', nextHandAt: null })
    // The cancelled timer deals nothing more, and a press during the hand is ignored.
    await h.room.skipResult('h')
    h.clock.advance(RESULT_MS)
    await tick(h)
    expect(h.room.tableHands).toBe(2)
    expect(skips(h)).toHaveLength(3)
  })

  it('each wait counts afresh: a press in one wait does not carry into the next', async () => {
    const h = table()
    await toResult(h)
    await h.room.skipResult('h')
    await h.room.skipResult('a')
    await playOut(h)
    expect(skips(h).at(-1)).toEqual([0, 2])
    await h.room.skipResult('a')
    expect(skips(h).at(-1)).toEqual([1, 2])
    expect(h.room.handActive).toBe(false)
  })

  it('the snapshot carries the tally of a running wait, with the viewer\'s own press, and nothing outside a wait', async () => {
    const h = table()
    await seat(h, ['h', 'a'])
    await h.room.startGame('h')
    await pickAll(h, ['h', 'a'])
    expect(h.room.snapshot('h').resultSkips).toBeUndefined() // a hand in play
    await playOut(h)
    expect(h.room.snapshot('h').resultSkips).toEqual({ skipped: 0, total: 2, mine: false })
    await h.room.skipResult('h')
    expect(h.room.snapshot('h').resultSkips).toEqual({ skipped: 1, total: 2, mine: true })
    expect(h.room.snapshot('a').resultSkips).toEqual({ skipped: 1, total: 2, mine: false })
    expect(h.room.snapshot(null).resultSkips).toEqual({ skipped: 1, total: 2, mine: false }) // a spectator
    await h.room.skipResult('a') // everyone pressed: the next hand is in play
    expect(h.room.snapshot('h').resultSkips).toBeUndefined()
  })

  it('a voter who disconnects after the other pressed "Bỏ qua" lets the hand start at once (Review Focus 3)', async () => {
    const h = table()
    await toResult(h)
    await h.room.skipResult('h')
    expect(h.room.handActive).toBe(false)
    await h.room.onDisconnect('a')
    expect(skips(h).at(-1)).toEqual([1, 1])
    expect(h.room.handActive).toBe(true)
  })

  it('the count follows the table: a seat taken raises it, a sit-out lowers it, a sit-in and a reconnect raise it, a stand-up and a Leave lower it (Review Focus 3)', async () => {
    const h = table(RESULT_MS, [['h', 100_000], ['a', 100_000], ['b', 100_000], ['c', 100_000]])
    await h.room.join(h.identity('b'))
    await h.room.join(h.identity('c'))
    await toResult(h)
    expect(skips(h).at(-1)).toEqual([0, 2])
    await h.room.sitDown('b', 2) // a human who sits down during the wait is counted
    expect(skips(h).at(-1)).toEqual([0, 3])
    await h.room.skipResult('c') // a spectator is not
    expect(skips(h).at(-1)).toEqual([0, 3])
    await h.room.skipResult('h')
    expect(skips(h).at(-1)).toEqual([1, 3])
    await h.room.sitOut('b', true)
    expect(skips(h).at(-1)).toEqual([1, 2])
    await h.room.skipResult('b') // a seat sitting out is not counted
    expect(skips(h).at(-1)).toEqual([1, 2])
    await h.room.sitOut('b', false)
    expect(skips(h).at(-1)).toEqual([1, 3])
    await h.room.onDisconnect('b')
    expect(skips(h).at(-1)).toEqual([1, 2])
    await h.room.onReconnect('b')
    expect(skips(h).at(-1)).toEqual([1, 3])
    await h.room.standUp('b')
    expect(skips(h).at(-1)).toEqual([1, 2])
    expect(h.room.handActive).toBe(false)
    await h.room.leave('a') // the last voter still waited on leaves: everyone left has pressed it
    expect(skips(h).at(-1)).toEqual([1, 1])
    expect(h.room.handActive).toBe(true)
  })

  it('a kick of the voter still waited on starts the hand', async () => {
    const h = table()
    await toResult(h)
    await h.room.skipResult('h')
    await h.room.kick('h', 'a')
    expect(skips(h).at(-1)).toEqual([1, 1])
    expect(h.room.handActive).toBe(true)
  })

  it('"Bỏ qua" outside the result wait is ignored without an error: before the first deal, in the draft, during a hand', async () => {
    const h = table()
    await seat(h, ['h', 'a'])
    expect(await code(h.room.skipResult('h'))).toBeNull()
    await h.room.startGame('h')
    expect(h.room.snapshot(null).chaos?.draft).not.toBeNull()
    expect(await code(h.room.skipResult('h'))).toBeNull()
    expect(await code(h.room.skipResult('a'))).toBeNull()
    expect(h.room.snapshot(null).chaos?.draft).not.toBeNull() // the draft still waits for its picks
    await pickAll(h, ['h', 'a'])
    expect(h.room.handActive).toBe(true)
    expect(await code(h.room.skipResult('h'))).toBeNull()
    expect(skips(h)).toEqual([])
    expect(await code(h.room.skipResult('nobody'))).toBe('NOT_IN_ROOM')
  })

  it('a wait with nobody to count says 0/0 and runs its full time: it never deals at once (P5)', async () => {
    const h = table()
    await seat(h, ['h', 'a'])
    await h.room.startGame('h')
    await pickAll(h, ['h', 'a'])
    await h.room.sitOut('h', true) // asked mid-hand: neither is counted once the hand is over
    await h.room.sitOut('a', true)
    await playOut(h)
    expect(skips(h)).toEqual([[0, 0]])
    expect(h.room.handActive).toBe(false)
    expect(h.room.nextHandAt).toBe(h.clock.now() + RESULT_MS)
    await h.room.skipResult('h') // not a voter: ignored
    expect(skips(h)).toEqual([[0, 0]])
    expect(h.room.handActive).toBe(false)
  })

  it('a port that gives a result time that is not a positive number falls back to the default, logged (P5)', async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -5_000]) {
      const h = table(bad)
      await toResult(h)
      expect(h.room.nextHandAt).toBe(h.clock.now() + DEFAULT_CHAOS_CONFIG.resultMs)
      expect(h.logs.some((l) => l.level === 'error' && l.msg.startsWith('chaos result time invalid'))).toBe(true)
    }
  })

  it('a room that closes after a hand asks the port for no result time (M9)', async () => {
    let reads = 0
    const h = createRoomHarness(ONE_BOT, { chaos: { cards: RESCUE_ONLY, config: SILVER_ONLY, failReads: () => (reads++, false) } })
    await seat(h, ['h', 'a'])
    await h.room.startGame('h')
    await pickAll(h, ['h', 'a'])
    const before = reads
    await h.room.shutdown('test') // the hand is cancelled and settled by the close
    expect(h.room.status).toBe('CLOSED')
    expect(reads).toBe(before)
  })

  it('a chaos sit-down brings the whole balance; a plain Blind table still brings its limit', async () => {
    const h = table(RESULT_MS, [['h', 5_000_000], ['a', 100_000]])
    await h.room.sitDown('h', 0)
    expect(h.room.players.get('h')!.stack).toBe(5_000_000)
    expect(await h.repos.balances.get('h')).toBe(0)
    expect(ofEvent(h, 'h', 'PLAYER_SAT').at(-1)).toMatchObject({ playerId: 'h', stack: 5_000_000 })
    expect(h.last('h', 'BALANCE')).toEqual({ t: 'BALANCE', balance: 0 })

    const { blind } = CHAOS
    const plain = createRoomHarness({ ...CHAOS, blind: { holeCards: blind!.holeCards, decisionMode: blind!.decisionMode, fixedWager: blind!.fixedWager, botCount: 2 } }, { players: [['h', 5_000_000]] })
    await plain.room.sitDown('h', 0)
    expect(plain.room.players.get('h')!.stack).toBe(10_000)
    expect(await plain.repos.balances.get('h')).toBe(4_990_000)
  })
})
