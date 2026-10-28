import {
  CHAOS_CARDS_SPEC, EMPTY_CHAOS_SEAT, toHeld, type ChaosCardDef, type ChaosSeat, type ChaosTableState, type GameEvent, type HandState,
  type LegalActions, type PlayerAction, type RoomConfig, type RoomEvent, type ServerMessage,
} from '@bp/core'
import { describe, expect, it } from 'vitest'
import { createRoomHarness, type RoomHarness } from '../testing/room-harness.js'
import type { ChaosTable } from './room-chaos.js'

/**
 * BP-41 Task 7a: the chaos table's own state across hands (the Thần, the Bán Thần, the bombs), its events (herald, dice,
 * table, steal), the per-seat draft tier, the no-fold rule for a seat that left, and the money the round-three cards
 * move, at room level. Task 7b: the dice sink, the title marks in the hand summary, the cancelled ascension. Most tests
 * build a small catalogue of exactly the cards they use.
 */

/** A chaos Blind table: humans on seats 0 and 1, two bots on 3 and 2, a draft every 5 hands. */
const CHAOS: RoomConfig = {
  name: 'C', mode: 'blind', maxPlayers: 4, isPrivate: false, turnTimerSec: 15, autoStart: false,
  blind: { holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1000, botCount: 2, chaosCycle: 5 },
}
const byId = new Map(CHAOS_CARDS_SPEC.map((c) => [c.id, c]))
/** A card switched on, its params replaced when given (`params` whole, so a dice table can be pinned). */
const on = (id: string, params?: Record<string, number>): ChaosCardDef => ({ ...byId.get(id)!, enabled: true, ...(params ? { params } : {}) })
/** Cá chép hóa rồng at full energy: it ascends at the first hand its holder is dealt. */
const CARP_FULL = on('d_carp', { ...byId.get('d_carp')!.params, energy0: 100 })
/** Cá chép at 0 %: it never ascends; a win crowns a Bán Thần. */
const CARP_EMPTY = on('d_carp')
/** One die, every roll in the loss band: 1 wager lost. */
const DICE_LOSE = on('g_dice', { dice: 1, a1: 1, l1: 1 })
/** One die, every roll a jackpot of 2 wagers. */
const DICE_JACKPOT = on('s_dice', { dice: 1, a1: 1, j1: 2 })
const RESCUE_ONLY: readonly ChaosCardDef[] = CHAOS_CARDS_SPEC.filter((c) => c.effect === 'rescue')
/** The silver Cấp cứu and Trộm điểm (gold): a table drafting silver offers the steal only to a seat lifted a tier. */
const STEAL_DRAFT: readonly ChaosCardDef[] = [...RESCUE_ONLY.filter((c) => c.tier === 'silver'), on('g_steal_points')]
const SILVER_ONLY = { tierWeights: { silver: 1, gold: 0, diamond: 0 } }
/** Every card on — the 47 and BP-41's 39. */
const ALL_ON: readonly ChaosCardDef[] = CHAOS_CARDS_SPEC.map((c) => ({ ...c, enabled: true }))
/** BP-41's 39, after the 47 of Plan 37 in the catalogue. */
const ROUND3 = new Set(CHAOS_CARDS_SPEC.slice(47).map((c) => c.id))

type Policy = (playerId: string, legal: LegalActions) => PlayerAction
const passive: Policy = (_id, legal) => ({ kind: legal.kinds.includes('play') ? 'play' : legal.kinds.includes('check') ? 'check' : 'fold' })
const tick = (h: RoomHarness) => h.room.enqueue(() => undefined)

const roomEvents = (h: RoomHarness, id: string): RoomEvent[] => h.ofType(id, 'ROOM_EVENT').map((m) => m.event)
const ofEvent = <T extends RoomEvent['type']>(h: RoomHarness, id: string, type: T) =>
  roomEvents(h, id).filter((e): e is Extract<RoomEvent, { type: T }> => e.type === type)
const gameEvents = (h: RoomHarness, id: string): GameEvent[] => h.ofType(id, 'GAME_EVENT').map((m) => m.event)
/** Where in everything sent to `id` the message `pred` matches last (−1: never). */
const lastIndex = (h: RoomHarness, id: string, pred: (m: ServerMessage) => boolean): number => {
  const sent = h.sent.get(id) ?? []
  for (let i = sent.length - 1; i >= 0; i--) if (pred(sent[i]!)) return i
  return -1
}
const isRoom = (type: RoomEvent['type']) => (m: ServerMessage) => m.t === 'ROOM_EVENT' && m.event.type === type
const isGame = (type: GameEvent['type']) => (m: ServerMessage) => m.t === 'GAME_EVENT' && m.event.type === type
const chaosOf = (h: RoomHarness): ChaosTable => (h.room as unknown as { chaos: ChaosTable }).chaos
const live = (h: RoomHarness): HandState => (h.room as unknown as { runner: { state: HandState } }).runner.state

let nextUid = 9_000
/** Puts cards in a seated player's hand (held, public), as a draft would. */
function give(h: RoomHarness, id: string, ...cards: ChaosCardDef[]): void {
  const p = h.room.players.get(id)!
  const chaos: ChaosSeat = p.chaos ?? EMPTY_CHAOS_SEAT
  p.chaos = { ...chaos, cards: [...chaos.cards, ...cards.map((c) => toHeld(c, nextUid++))] }
}
const botIds = (h: RoomHarness): string[] => [...h.room.players.values()].filter((p) => p.identity.isBot).map((p) => p.identity.playerId)

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

/** Every human with an open offer picks: the first card `prefer` likes, else the first offered. */
async function pickAll(h: RoomHarness, ids: string[], prefer: (cardId: string) => boolean = () => false): Promise<void> {
  for (const id of ids) {
    const snap = h.room.snapshot(id).chaos?.draft
    if (snap?.offer && !snap.picked) await h.room.pickChaos(id, snap.offer.offerId, snap.offer.cardIds.find(prefer) ?? snap.offer.cardIds[0]!)
  }
  await tick(h)
}

/** To the next deal: the result wait, then the draft if one opened (everyone picks). */
async function nextHand(h: RoomHarness, ids: string[], prefer?: (cardId: string) => boolean): Promise<void> {
  h.clock.advance(100)
  await tick(h)
  if (h.room.snapshot(null).chaos?.draft) await pickAll(h, ids, prefer)
}

async function seat(h: RoomHarness, ids: string[]): Promise<void> {
  for (const [i, id] of ids.entries()) {
    if (id !== h.room.hostPlayerId) await h.room.join(h.identity(id))
    await h.room.sitDown(id, i)
    await h.room.setReady(id, true)
  }
}

/** A table whose drafts offer only Cấp cứu (harmless), `h` holding `cards` from its first hand on. */
async function startWith(seed: number, cards: ChaosCardDef[], opts: { spectator?: boolean } = {}): Promise<RoomHarness> {
  const h = createRoomHarness({ ...CHAOS, maxPlayers: 5 }, { seed, chaos: { cards: RESCUE_ONLY, config: SILVER_ONLY } })
  await seat(h, ['h', 'a'])
  if (opts.spectator) await h.room.join(h.identity('b'))
  await h.room.startGame('h')
  give(h, 'h', ...cards)
  await pickAll(h, ['h', 'a'])
  expect(h.room.handActive).toBe(true)
  return h
}

const EMPTY_VIEW = { god: null, demigods: [], bombs: [] }
/** The title marks hand `hand`'s summary carries, by player (only the rows that have some). */
const titlesOf = (h: RoomHarness, hand: number) =>
  Object.fromEntries(h.repos.hands[hand]!.players.filter((p) => p.chaosTitles).map((p) => [p.playerId, p.chaosTitles]))

describe('BP-41 room: the Thần across hands', () => {
  it('the table and the herald go out before its first hand, nobody may fold, the reign counts down to the end, and a reconnect sees it', async () => {
    // Seed 9: the Thần is never beaten, so its reign runs the full five hands.
    const h = await startWith(9, [CARP_FULL], { spectator: true })
    const told = ofEvent(h, 'b', 'CHAOS_TABLE')
    expect(told).toHaveLength(1)
    expect(told[0]!.table).toEqual({ god: { seat: 0, handsLeft: 5, curse: 1 }, demigods: [], bombs: [] })
    expect(ofEvent(h, 'b', 'CHAOS_HERALD')).toEqual([{ type: 'CHAOS_HERALD', kind: 'god', seat: 0, playerId: 'h' }])
    // Both before the hand's first event, to the spectator as to the seats.
    const started = lastIndex(h, 'b', isGame('HAND_STARTED'))
    expect(lastIndex(h, 'b', isRoom('CHAOS_TABLE'))).toBeLessThan(started)
    expect(lastIndex(h, 'b', isRoom('CHAOS_HERALD'))).toBeLessThan(started)
    // G11: nobody may fold while the Thần acts on a "Chơi hoặc bỏ" table.
    expect(h.room.snapshot('a').hand!.legal!.kinds).toEqual(['play'])
    // A reconnect mid-hand sees the reign, and nothing private (no player id, no uid, no params).
    const snap = h.room.snapshot('b').chaos!
    expect(snap.table).toEqual({ god: { seat: 0, handsLeft: 5, curse: 1 }, demigods: [], bombs: [] })
    expect(JSON.stringify(snap)).not.toMatch(/playerId|uid|params|d_carp/)

    const counted: (number | null)[] = []
    for (let n = 0; n < 5; n++) {
      await playOut(h)
      const state = ofEvent(h, 'a', 'CHAOS_STATE').at(-1)!
      counted.push(state.table?.god?.handsLeft ?? null)
      if (n < 4) expect(h.room.snapshot('a').chaos!.table!.god!.handsLeft).toBe(4 - n) // between hands too
      await nextHand(h, ['h', 'a'])
    }
    expect(counted).toEqual([4, 3, 2, 1, null])
    expect(h.room.snapshot('a').chaos!.table).toBeUndefined()
    // One herald for the whole reign; no Thần was beaten.
    expect(ofEvent(h, 'a', 'CHAOS_HERALD')).toHaveLength(1)
  })

  it('a Thần beaten at the showdown: one godslain herald per winner at the settlement, and the throne is empty from the next hand', async () => {
    // Seed 1: the Thần loses its first hand.
    const h = await startWith(1, [CARP_FULL])
    await playOut(h)
    const slain = ofEvent(h, 'a', 'CHAOS_HERALD').filter((e) => e.kind === 'godslain')
    const winners = h.repos.hands[0]!.players.filter((p) => p.won).map((p) => p.seat)
    expect(slain.map((e) => e.seat).sort()).toEqual(winners.sort())
    expect(slain.every((e) => e.playerId === h.repos.hands[0]!.players.find((p) => p.seat === e.seat)!.playerId)).toBe(true)
    // After the hand's settlement, before the table's state.
    expect(lastIndex(h, 'a', isRoom('CHAOS_HERALD'))).toBeGreaterThan(lastIndex(h, 'a', isGame('SETTLEMENT')))
    expect(lastIndex(h, 'a', isRoom('CHAOS_HERALD'))).toBeLessThan(lastIndex(h, 'a', isRoom('CHAOS_STATE')))
    expect(ofEvent(h, 'a', 'CHAOS_STATE').at(-1)!.table).toBeUndefined() // the empty throne, told with the seats
    await nextHand(h, ['h', 'a'])
    expect(ofEvent(h, 'a', 'CHAOS_TABLE')).toHaveLength(1) // only the ascension's: nothing new to tell at this deal
    expect(h.room.snapshot('a').chaos!.table).toBeUndefined()
    expect(h.room.snapshot('a').hand!.legal!.kinds).toEqual(['play', 'fold'])
  })

  it('a Thần who stands up between hands: its reign ends, and every client is told', async () => {
    const h = await startWith(9, [CARP_FULL], { spectator: true })
    await playOut(h)
    await h.room.standUp('h')
    for (const id of ['a', 'b']) {
      expect(ofEvent(h, id, 'CHAOS_TABLE').at(-1)!.table).toEqual(EMPTY_VIEW)
      expect(h.room.snapshot(id).chaos!.table).toBeUndefined()
    }
    expect(chaosOf(h).table.god).toBeNull()
  })

  it('Ruling 14: a Thần who leaves mid-decision plays (no fold, no timeout); the hand settles, then its reign ends', async () => {
    const h = await startWith(9, [CARP_FULL])
    expect(h.room.snapshot('h').hand!.phase).toBe('DECISION')
    await h.room.leave('h')
    expect(live(h).players.find((p) => p.seat === 0)!.decision).toBe('play')
    expect(ofEvent(h, 'a', 'CHAOS_TABLE')).toHaveLength(1) // nothing changes mid-hand
    await playOut(h)
    const acted = gameEvents(h, 'a').filter((e): e is Extract<GameEvent, { type: 'PLAYER_ACTED' }> => e.type === 'PLAYER_ACTED')
    expect(acted.find((e) => e.seat === 0)).toMatchObject({ action: { kind: 'play' }, timedOut: false })
    expect(h.room.players.get('h')).toBeUndefined()
    // The hand counted the reign (4 left), then the seat left: the table is told it is empty.
    expect(ofEvent(h, 'a', 'CHAOS_STATE').at(-1)!.table?.god?.handsLeft).toBe(4)
    expect(ofEvent(h, 'a', 'CHAOS_TABLE').at(-1)!.table).toEqual(EMPTY_VIEW)
    expect(lastIndex(h, 'a', isRoom('CHAOS_TABLE'))).toBeGreaterThan(lastIndex(h, 'a', isRoom('CHAOS_STATE')))
  })
})

describe('BP-41 room: the Bán Thần', () => {
  it('a Cá chép holder who wins is crowned at the settlement and heralded at the next deal, before its first hand', async () => {
    const h = await startWith(3, [CARP_EMPTY])
    give(h, 'a', CARP_EMPTY)
    for (const id of botIds(h)) give(h, id, CARP_EMPTY)
    await playOut(h)
    const crowned = ofEvent(h, 'a', 'CHAOS_STATE').at(-1)!.table!.demigods
    const winners = h.repos.hands[0]!.players.filter((p) => p.won).map((p) => p.seat).sort()
    expect(crowned.map((d) => d.seat).sort()).toEqual(winners)
    expect(crowned.every((d) => d.handsLeft === 5)).toBe(true)
    // A12: each human crowned is marked on the hand it won; a crowned bot is not.
    const humansCrowned = h.repos.hands[0]!.players.filter((p) => !p.isBot && winners.includes(p.seat)).map((p) => p.playerId)
    expect(humansCrowned.length).toBeGreaterThan(0)
    expect(titlesOf(h, 0)).toEqual(Object.fromEntries(humansCrowned.map((id) => [id, { demigod: true }])))
    expect(ofEvent(h, 'a', 'CHAOS_HERALD').filter((e) => e.kind === 'demigod')).toEqual([]) // not yet
    await nextHand(h, ['h', 'a'])
    const heralds = ofEvent(h, 'a', 'CHAOS_HERALD').filter((e) => e.kind === 'demigod')
    expect(heralds.map((e) => e.seat).sort()).toEqual(winners)
    for (const e of heralds) expect(e.playerId).toBe([...h.room.players.values()].find((p) => p.seat === e.seat)!.identity.playerId)
    expect(lastIndex(h, 'a', isRoom('CHAOS_HERALD'))).toBeLessThan(lastIndex(h, 'a', isGame('HAND_STARTED')))
    await playOut(h)
    await nextHand(h, ['h', 'a'])
    // Once per reign: a seat crowned at the first settlement is not heralded again (another Cá chép holder may be).
    const again = ofEvent(h, 'a', 'CHAOS_HERALD').filter((e) => e.kind === 'demigod')
    for (const seat of winners) expect(again.filter((e) => e.seat === seat)).toHaveLength(1)
  })

  it('a Bán Thần crowned for a seat that leaves before the next deal is never heralded', async () => {
    const h = await startWith(3, [CARP_EMPTY])
    give(h, 'a', CARP_EMPTY)
    for (const id of botIds(h)) give(h, id, CARP_EMPTY)
    await playOut(h)
    const crowned = chaosOf(h).table.demigods.map((d) => d.seat)
    const human = ['h', 'a'].find((id) => crowned.includes(h.room.players.get(id)!.seat!))
    expect(human).toBeDefined()
    const gone = h.room.players.get(human!)!.seat!
    await h.room.standUp(human!)
    expect(ofEvent(h, 'a', 'CHAOS_TABLE').at(-1)?.table.demigods.map((d) => d.seat) ?? []).not.toContain(gone)
    await nextHand(h, ['h', 'a'])
    expect(ofEvent(h, 'h', 'CHAOS_HERALD').filter((e) => e.kind === 'demigod').map((e) => e.seat)).not.toContain(gone)
  })
})

describe('BP-41 room: the bombs', () => {
  it('a plant stays off the public table until the settlement names it; the next deal passes it on; plan seats are the dealt seats', async () => {
    const h = await startWith(5, [on('d_time_bomb')], { spectator: true })
    // During the plant hand: no table state anywhere, live or in a reconnect.
    expect(ofEvent(h, 'b', 'CHAOS_TABLE')).toEqual([])
    expect(h.room.snapshot('b').chaos!.table).toBeUndefined()
    const state = live(h)
    expect(state.chaos!.plan.seats.map((s) => s.seat).sort()).toEqual(state.players.map((p) => p.seat).sort())
    await playOut(h)
    const summary = gameEvents(h, 'b').filter((e): e is Extract<GameEvent, { type: 'CHAOS_SUMMARY' }> => e.type === 'CHAOS_SUMMARY').at(-1)!
    const plant = summary.used.find((u) => u.effect === 'timeBomb')!
    expect(plant).toMatchObject({ seat: 0, outcome: 'applied' })
    const carrier = plant.targets[0]!
    const after = ofEvent(h, 'b', 'CHAOS_STATE').at(-1)!.table!
    expect(after.bombs).toEqual([{ owner: 0, carrier, handsLeft: 2 }])
    expect(lastIndex(h, 'b', isGame('CHAOS_SUMMARY'))).toBeLessThan(lastIndex(h, 'b', isRoom('CHAOS_STATE')))

    await nextHand(h, ['h', 'a'])
    const passed = ofEvent(h, 'b', 'CHAOS_TABLE').at(-1)!.table.bombs
    expect(passed).toHaveLength(1)
    expect(passed[0]!.owner).toBe(0)
    expect([0, carrier]).not.toContain(passed[0]!.carrier)
    expect(lastIndex(h, 'b', isRoom('CHAOS_TABLE'))).toBeLessThan(lastIndex(h, 'b', isGame('HAND_STARTED')))
    const next = live(h)
    expect(next.chaos!.plan.seats.map((s) => s.seat).sort()).toEqual(next.players.map((p) => p.seat).sort())
    expect(next.chaos!.plan.bombs!.map((b) => [b.owner, b.carrier])).toEqual([[0, passed[0]!.carrier]])
    await playOut(h)

    // The owner stands up: its bomb is gone, unpaid, and the table is told.
    await h.room.standUp('h')
    expect(ofEvent(h, 'b', 'CHAOS_TABLE').at(-1)!.table.bombs).toEqual([])
    expect(chaosOf(h).table.bombs).toEqual([])
  })

  it('a carrier who leaves hands its bomb on at once to a seated player who is not its owner; a Bán Thần who leaves ends its reign', async () => {
    const h = createRoomHarness(CHAOS, { chaos: { cards: RESCUE_ONLY, config: SILVER_ONLY } })
    await seat(h, ['h', 'a'])
    const table: ChaosTableState = {
      god: null,
      demigods: [{ seat: 1, playerId: 'a', isBot: false, handsLeft: 3, cardId: 'd_carp', uid: 70, params: {} }],
      bombs: [{ owner: 3, carrier: 1, handsLeft: 2, cardId: 'd_time_bomb', uid: 71, wagers: 1 }, { owner: 1, carrier: 0, handsLeft: 1, cardId: 'd_time_bomb', uid: 72, wagers: 1 }],
    }
    chaosOf(h).table = table
    await h.room.standUp('a')
    const told = ofEvent(h, 'h', 'CHAOS_TABLE').at(-1)!.table
    expect(told.demigods).toEqual([])
    // Its own bomb (owner 1) is gone; the one it carried went to seat 0 or 2 — never its owner (3), never the seat left.
    expect(told.bombs).toHaveLength(1)
    expect(told.bombs[0]).toMatchObject({ owner: 3, handsLeft: 2 })
    expect([0, 2]).toContain(told.bombs[0]!.carrier)
  })

  it('a carrier who leaves with nobody but the owner left to take it: the bomb is gone', async () => {
    const h = createRoomHarness({ ...CHAOS, blind: { ...CHAOS.blind!, botCount: 0 } }, { chaos: { cards: RESCUE_ONLY, config: SILVER_ONLY } })
    await seat(h, ['h', 'a'])
    chaosOf(h).table = { god: null, demigods: [], bombs: [{ owner: 0, carrier: 1, handsLeft: 2, cardId: 'd_time_bomb', uid: 71 }] }
    await h.room.standUp('a')
    expect(chaosOf(h).table.bombs).toEqual([])
    expect(h.room.snapshot('h').chaos!.table).toBeUndefined()
  })
})

describe('BP-41 room: the dice', () => {
  it('each roll is told after the hand with the stack after its loss, the losses before the credits; a jackpot is a ledgered credit', async () => {
    const h = await startWith(4, [DICE_LOSE])
    give(h, 'a', DICE_JACKPOT)
    const bot = botIds(h)[0]!
    give(h, bot, DICE_LOSE)
    await playOut(h)
    const dice = ofEvent(h, 'h', 'CHAOS_DICE')
    expect(dice.map((e) => e.seat).sort()).toEqual([0, 1, h.room.players.get(bot)!.seat!].sort())
    const after = (id: string) => 100_000 + h.repos.hands[0]!.players.find((p) => p.playerId === id)!.net
    const mine = dice.find((e) => e.seat === 0)!
    expect(mine).toMatchObject({ cardId: 'g_dice', result: { burned: 1_000 }, stack: after('h') - 1_000 })
    expect(mine.dice).toHaveLength(1)
    expect(h.room.players.get('h')!.stack).toBe(after('h') - 1_000)
    // The human's loss leaves the economy as one chaos_dice sink row (A6), under the hand, seat and card's key; the
    // bot's writes nothing.
    expect(h.repos.sinks.filter((x) => x.kind === 'chaos_dice')).toEqual([
      { refId: expect.stringMatching(new RegExp(`^chaos_dice:room-1:${h.repos.hands[0]!.handId}:0:\\d+$`)), fee: 1_000, kind: 'chaos_dice' },
    ])
    expect(h.repos.keys.has(h.repos.sinks.find((x) => x.kind === 'chaos_dice')!.refId)).toBe(true)
    // A bot's loss lowers its virtual stack only.
    const botDice = dice.find((e) => e.seat === h.room.players.get(bot)!.seat)!
    expect(botDice.result.burned).toBe(1_000)
    expect(h.room.players.get(bot)!.stack).toBe(botDice.stack)
    // The jackpot: told by the dice, paid as a chaos_jackpot credit under the daily cap, after every dice event.
    const theirs = dice.find((e) => e.seat === 1)!
    expect(theirs).toMatchObject({ cardId: 's_dice', result: { jackpot: 2_000 }, stack: after('a') })
    const credit = ofEvent(h, 'h', 'CHAOS_CREDIT').find((e) => e.reason === 'chaos_jackpot')!
    expect(credit).toMatchObject({ seat: 1, amount: 2_000, stack: after('a') + 2_000, capped: false })
    expect(h.repos.entries.filter((e) => e.entry.reason === 'chaos_jackpot').map((e) => [e.entry.playerId, e.entry.delta])).toEqual([['a', 2_000]])
    expect(lastIndex(h, 'h', isRoom('CHAOS_DICE'))).toBeLessThan(lastIndex(h, 'h', isRoom('CHAOS_CREDIT')))
    expect(lastIndex(h, 'h', isRoom('CHAOS_CREDIT'))).toBeLessThan(lastIndex(h, 'h', isRoom('CHAOS_STATE')))
    // Each card rolled once and is gone.
    for (const id of ['h', 'a', bot]) expect(h.room.players.get(id)!.chaos!.cards.some((c) => c.effect === 'fortuneDice')).toBe(false)
    await nextHand(h, ['h', 'a'])
    await playOut(h)
    expect(ofEvent(h, 'h', 'CHAOS_DICE')).toHaveLength(3)
  })

  it('a loss larger than the stack takes the whole stack and sinks exactly that; the books stay at 0', async () => {
    // A die that loses 20 wagers, held by a human who brought 3 000: whatever the hand left, it is all taken.
    const start = { h: 3_000, a: 100_000 }
    const h = createRoomHarness(CHAOS, { seed: 4, chaos: { cards: RESCUE_ONLY, config: SILVER_ONLY }, players: Object.entries(start) })
    await seat(h, ['h', 'a'])
    await h.room.startGame('h')
    give(h, 'h', on('g_dice', { dice: 1, a1: 1, l1: 20 }))
    await pickAll(h, ['h', 'a'])
    await playOut(h)
    const left = 3_000 + h.repos.hands[0]!.players.find((p) => p.playerId === 'h')!.net
    expect(left).toBeGreaterThan(0)
    expect(left).toBeLessThan(20_000)
    const roll = ofEvent(h, 'a', 'CHAOS_DICE').find((e) => e.seat === 0)!
    expect(roll).toMatchObject({ result: { burned: left }, stack: 0 })
    expect(diceSinks(h)).toEqual([left])
    expect(await books(h, start)).toBe(0)
    expect(h.logs.filter((l) => l.level === 'error')).toEqual([])
  })

  it('the sink write is retried once under its key; one that fails twice is logged with its key, the stack stays lowered', async () => {
    for (const failures of [1, 2]) {
      const h = await startWith(4, [DICE_LOSE])
      const apply = h.repos.balances.apply.bind(h.repos.balances)
      let failed = 0
      const keys: (string | undefined)[] = []
      h.repos.balances.apply = async (entries, meta, opts) => {
        if (meta?.kind === 'chaos_dice') {
          keys.push(opts?.key)
          if (failed++ < failures) throw new Error('db down')
        }
        return apply(entries, meta, opts)
      }
      await playOut(h)
      const left = 100_000 + h.repos.hands[0]!.players.find((p) => p.playerId === 'h')!.net
      expect(h.room.players.get('h')!.stack).toBe(left - 1_000)
      expect(keys).toHaveLength(2)
      expect(keys[0]).toMatch(/^chaos_dice:room-1:/)
      expect(keys[1]).toBe(keys[0])
      const errors = h.logs.filter((l) => l.level === 'error')
      if (failures === 1) {
        expect(diceSinks(h)).toEqual([1_000])
        expect(errors).toEqual([])
      } else {
        expect(diceSinks(h)).toEqual([])
        expect(errors).toEqual([{ level: 'error', msg: 'chaos dice sink failed', data: expect.objectContaining({ key: keys[0], amount: 1_000, playerId: 'h' }) }])
      }
    }
  })
})

describe('BP-41 room: title marks into the hand summary (A12, G12)', () => {
  it('two humans: the Thần\'s ascension and the human who beat it are marked on that hand; bots never are', async () => {
    // Seed 1: the Thần (h) loses its first hand, and a is among the winners.
    const h = await startWith(1, [CARP_FULL])
    await playOut(h)
    expect(ofEvent(h, 'a', 'CHAOS_HERALD').filter((e) => e.kind === 'godslain').map((e) => e.playerId)).toContain('a')
    expect(titlesOf(h, 0)).toEqual({ h: { ascended: true }, a: { slew: 1 } })
  })

  it('one human with three bots: the ascension is heralded but marks nothing (≥ 2 humans)', async () => {
    const h = createRoomHarness({ ...CHAOS, blind: { ...CHAOS.blind!, botCount: 3 } }, { seed: 9, chaos: { cards: RESCUE_ONLY, config: SILVER_ONLY } })
    await seat(h, ['h'])
    await h.room.startGame('h')
    give(h, 'h', CARP_FULL)
    await pickAll(h, ['h'])
    await playOut(h)
    expect(ofEvent(h, 'h', 'CHAOS_HERALD').filter((e) => e.kind === 'god').map((e) => e.playerId)).toEqual(['h'])
    expect(titlesOf(h, 0)).toEqual({})
  })

  it('a bot Thần: its ascension is no title, and a human who beats it is not marked slew', async () => {
    // Seed 1: a human beats the bot Thần within its reign.
    const h = createRoomHarness(CHAOS, { seed: 1, chaos: { cards: RESCUE_ONLY, config: SILVER_ONLY } })
    await seat(h, ['h', 'a'])
    await h.room.startGame('h')
    give(h, botIds(h)[0]!, CARP_FULL)
    await pickAll(h, ['h', 'a'])
    const god = ofEvent(h, 'h', 'CHAOS_HERALD').find((e) => e.kind === 'god')!
    expect(god.playerId).toBe(botIds(h)[0])
    for (let n = 0; n < 5 && chaosOf(h).table.god; n++) {
      await playOut(h)
      await nextHand(h, ['h', 'a'])
    }
    expect(ofEvent(h, 'h', 'CHAOS_HERALD').filter((e) => e.kind === 'godslain').some((e) => e.playerId === 'h' || e.playerId === 'a')).toBe(true)
    for (let i = 0; i < h.repos.hands.length; i++) expect(titlesOf(h, i)).toEqual({})
  })

  it('Ruling 7b-1: an ascension whose hand is cancelled keeps its reign (5 hands, not counted) and its herald, the Cá chép spent, and marks no title; the reign plays on', async () => {
    const h = await startWith(9, [CARP_FULL], { spectator: true })
    expect(ofEvent(h, 'b', 'CHAOS_HERALD')).toEqual([{ type: 'CHAOS_HERALD', kind: 'god', seat: 0, playerId: 'h' }])
    expect(ofEvent(h, 'b', 'CHAOS_TABLE').at(-1)!.table.god).toEqual({ seat: 0, handsLeft: 5, curse: 1 })
    const runner = (h.room as unknown as { runner: { cancel(reason: string): unknown } }).runner
    await h.room.enqueue(() => runner.cancel('test'))
    await tick(h)
    expect(h.room.handActive).toBe(false)
    expect(h.repos.hands[0]).toMatchObject({ cancelled: true })
    expect(titlesOf(h, 0)).toEqual({})
    expect(chaosOf(h).table.god).toMatchObject({ seat: 0, handsLeft: 5 })
    expect(h.room.players.get('h')!.chaos!.cards.some((c) => c.effect === 'carp')).toBe(false)
    // The next hand plays the same reign: no second herald, nobody may fold, and it counts down from 5.
    await nextHand(h, ['h', 'a'])
    expect(h.room.handActive).toBe(true)
    expect(ofEvent(h, 'b', 'CHAOS_HERALD')).toHaveLength(1)
    expect(h.room.snapshot('a').hand!.legal!.kinds).toEqual(['play'])
    await playOut(h)
    expect(titlesOf(h, 1)).toEqual({}) // the ascension mark belonged to the cancelled hand
    expect(ofEvent(h, 'a', 'CHAOS_STATE').at(-1)!.table?.god?.handsLeft).toBe(4)
  })
})

describe('BP-41 room: Nâng tầm uy lực and Trộm điểm in the draft', () => {
  it('a seat holding Nâng tầm uy lực is offered a tier up (its own offer and snapshot say so; the draft frame keeps the table tier), and a Trộm điểm it takes robs the richest other seat at once', async () => {
    const h = createRoomHarness({ ...CHAOS, maxPlayers: 5 }, { chaos: { cards: STEAL_DRAFT, config: SILVER_ONLY } })
    await seat(h, ['h', 'a'])
    await h.room.join(h.identity('b'))
    give(h, 'h', on('s_tier_up'))
    h.room.players.get('a')!.chaos = { ...EMPTY_CHAOS_SEAT, points: 12 }
    await h.room.startGame('h')
    expect(ofEvent(h, 'b', 'CHAOS_DRAFT').at(-1)!.tier).toBe('silver')
    const offer = (id: string) => h.ofType(id, 'NOTIFICATION').filter((m) => m.kind === 'CHAOS_OFFER').at(-1)!.payload as { tier: string; cardIds: string[] }
    expect(offer('h')).toMatchObject({ tier: 'gold', cardIds: ['g_steal_points'] })
    expect(offer('a')).toMatchObject({ tier: 'silver', cardIds: ['s_rescue'] })
    expect(h.room.snapshot('h').chaos!.draft!.tier).toBe('gold')
    expect(h.room.snapshot('a').chaos!.draft!.tier).toBe('silver')
    expect(h.room.snapshot('b').chaos!.draft!.tier).toBe('silver')
    expect(h.room.players.get('h')!.chaos!.cards.some((c) => c.effect === 'tierUp')).toBe(false) // spent by the offer

    await pickAll(h, ['h', 'a'])
    expect(ofEvent(h, 'b', 'CHAOS_STEAL')).toEqual([{
      type: 'CHAOS_STEAL', seat: 0, cardId: 'g_steal_points', outcome: 'applied', targets: [1], from: 1, to: 0, amount: 5, spent: [],
    }])
    expect(lastIndex(h, 'b', isRoom('CHAOS_STEAL'))).toBeLessThan(lastIndex(h, 'b', isRoom('CHAOS_STATE')))
    const points = Object.fromEntries(ofEvent(h, 'b', 'CHAOS_STATE').at(-1)!.seats.map((s) => [s.seat, s.points]))
    expect(points).toMatchObject({ 0: 5, 1: 7 })
    expect(h.room.players.get('h')!.chaos!.cards.map((c) => c.cardId)).toEqual([]) // never held
  })

  it('a shield held by the richest seat blocks the theft and is spent; the event says so', async () => {
    const h = createRoomHarness(CHAOS, { chaos: { cards: STEAL_DRAFT, config: SILVER_ONLY } })
    await seat(h, ['h', 'a'])
    give(h, 'h', on('s_tier_up'))
    h.room.players.get('a')!.chaos = { ...EMPTY_CHAOS_SEAT, points: 12 }
    const shield = CHAOS_CARDS_SPEC.find((c) => c.effect === 'shield' && c.params.hands === undefined)!
    give(h, 'a', shield)
    await h.room.startGame('h')
    await pickAll(h, ['h', 'a'])
    expect(ofEvent(h, 'h', 'CHAOS_STEAL')).toEqual([{
      type: 'CHAOS_STEAL', seat: 0, cardId: 'g_steal_points', outcome: 'blocked', targets: [1], from: null, to: null, amount: 0, spent: [{ seat: 1, cardId: shield.id }],
    }])
    expect(h.room.players.get('a')!.chaos!.points).toBe(12)
    expect(h.room.players.get('a')!.chaos!.cards.some((c) => c.cardId === shield.id)).toBe(false)
  })
})

describe('BP-41 room: seats that sit a hand out', () => {
  it('Cấm bỏ bài\'s mark ends for a seat that sits its next hand out (Ruling 5a-5): the room settles sitting-out seats too', async () => {
    const h = await startWith(2, [])
    await playOut(h)
    await h.room.sitOut('a', true)
    h.room.players.get('a')!.chaos = { ...h.room.players.get('a')!.chaos!, noFoldNextHand: true }
    await nextHand(h, ['h', 'a'])
    expect(live(h).players.map((p) => p.playerId)).not.toContain('a')
    await playOut(h)
    expect(h.room.players.get('a')!.chaos!.noFoldNextHand).toBeUndefined()
  })
})

describe('BP-41 room: bots and money with every round-three card on', () => {
  it('a human and three bots play 40 hands with every card on: no error, no stack below 0, round-three cards used', async () => {
    const h = createRoomHarness({ ...CHAOS, blind: { ...CHAOS.blind!, botCount: 3 } }, { seed: 41, chaos: { cards: ALL_ON }, players: [['h', 1_000_000]] })
    await seat(h, ['h'])
    await h.room.startGame('h')
    await pickAll(h, ['h'])
    let guard = 0
    while (h.repos.hands.length < 40 && guard++ < 80) {
      await playOut(h)
      for (const p of h.room.players.values()) expect(p.stack).toBeGreaterThanOrEqual(0)
      if (h.room.players.get('h')!.seat === null) await h.room.sitDown('h', 0)
      if (h.room.status === 'OPEN') await h.room.startGame('h')
      await nextHand(h, ['h'])
    }
    expect(h.repos.hands.length).toBeGreaterThanOrEqual(40)
    expect(h.logs.filter((l) => l.level === 'error')).toEqual([])
    const used = h.repos.hands.flatMap((x) => x.chaosUsed ?? []).map((u) => u.cardId)
    expect(used.filter((id) => ROUND3.has(id)).length).toBeGreaterThan(10)
  })

  it('two humans, two bots, 120 hands with the round-three money cards: the books stay at 0 (credits out, dice losses in)', async () => {
    const MONEY = new Set(['adventurer', 'bigTable', 'noFold', 'duel', 'shareWinnings', 'winTax', 'timeBomb', 'fortuneDice', 'riskyHand', 'fateDie', 'master', 'tierUp', 'stealPoints', 'carp'])
    // The Bạc die is pinned to lose 2 wagers or pay a 1-wager jackpot (half and half), so the run meets both often.
    const cards = CHAOS_CARDS_SPEC.filter((c) => !ROUND3.has(c.id) || MONEY.has(c.effect)).map((c) =>
      c.effect === 'carp' ? CARP_FULL : c.id === 's_dice' ? on('s_dice', { dice: 1, a1: 1, l1: 2, a2: 4, j2: 1 }) : c)
    const start = { h: 1_000_000, a: 1_000_000 }
    const h = createRoomHarness(CHAOS, { seed: 4141, chaos: { cards }, players: Object.entries(start) })
    const ids = ['h', 'a']
    // The humans take a round-three money card whenever one is offered, a die first.
    const prefer = (id: string): boolean => byId.get(id)!.effect === 'fortuneDice' || (ROUND3.has(id) && MONEY.has(byId.get(id)!.effect))
    await seat(h, ids)
    await h.room.startGame('h')
    await pickAll(h, ids, prefer)
    let n = 0
    const policy: Policy = (id, legal) => ({ kind: legal.kinds.includes('play') && (id === 'h' ? n % 3 !== 0 : n % 2 === 0) ? 'play' : legal.kinds.includes('play') && !legal.kinds.includes('fold') ? 'play' : 'fold' })
    while (h.repos.hands.length < 120 && n++ < 300) {
      await playOut(h, policy)
      expect(await books(h, start)).toBe(0)
      for (const [i, id] of ids.entries()) {
        if (h.room.players.get(id)!.seat !== null) continue
        await h.room.sitDown(id, i)
        if (h.room.status === 'OPEN') await h.room.setReady(id, true)
      }
      if (h.room.status === 'OPEN') await h.room.startGame('h')
      await nextHand(h, ids, prefer)
    }
    expect(h.repos.hands.length).toBeGreaterThanOrEqual(120)
    expect(h.logs.filter((l) => l.level === 'error')).toEqual([])
    // The run must actually move money through the new paths: every human dice loss is one chaos_dice sink row of it.
    expect(humanBurns(h).length).toBeGreaterThan(0)
    expect(diceSinks(h)).toEqual(humanBurns(h))
    expect(h.repos.entries.some((e) => e.entry.reason === 'chaos_jackpot')).toBe(true)
    expect(ofEvent(h, 'h', 'CHAOS_HERALD').some((e) => e.kind === 'god')).toBe(true)
  })
})

/**
 * The books of a chaos table with humans `h`/`a` on seats 0 and 1 (as room-hands.test.ts's): their balance and stack
 * changes, the bots' nets, every sink (a human's dice loss among them: the room's `chaos_dice` row, A6), the carried pot,
 * less the card credits a human was paid (ledger sources). 0 when every point is accounted for.
 */
const CHAOS_SOURCES = new Set(['chaos_rescue', 'chaos_crit', 'chaos_fortune', 'chaos_jackpot'])
async function books(h: RoomHarness, humans: Record<string, number>): Promise<number> {
  let humanDelta = 0
  for (const [id, start] of Object.entries(humans)) humanDelta += (await h.repos.balances.get(id)) + (h.room.players.get(id)?.stack ?? 0) - start
  const botNet = h.repos.hands.flatMap((x) => x.players).filter((p) => p.isBot).reduce((s, p) => s + p.net, 0)
  const sources = h.repos.entries.filter((e) => CHAOS_SOURCES.has(e.entry.reason)).reduce((s, e) => s + e.entry.delta, 0)
  const sinks = h.repos.sinks.reduce((s, x) => s + x.fee, 0)
  return humanDelta + botNet + sinks + h.room.carryOverPot + (h.room.pendingRelease?.pot ?? 0) - sources
}

/** Every human seat's dice loss as told (`CHAOS_DICE.result.burned`, seats 0 and 1), in order. */
const humanBurns = (h: RoomHarness, watcher = 'h'): number[] =>
  ofEvent(h, watcher, 'CHAOS_DICE').filter((e) => e.seat <= 1 && (e.result.burned ?? 0) > 0).map((e) => e.result.burned!)
const diceSinks = (h: RoomHarness): number[] => h.repos.sinks.filter((x) => x.kind === 'chaos_dice').map((x) => x.fee)
