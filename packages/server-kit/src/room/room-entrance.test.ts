import type { EntranceTitle, RoomConfig } from '@bp/core'
import { describe, expect, it } from 'vitest'
import { createRoomHarness, type RoomHarness } from '../testing/room-harness.js'
import type { TitlePort } from '../title-port.js'

const HOLDEM: RoomConfig = { name: 'T', mode: 'holdem', maxPlayers: 4, isPrivate: false, turnTimerSec: 30, autoStart: false, holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 } }
const BLIND_WITH_BOT: RoomConfig = { name: 'B', mode: 'blind', maxPlayers: 4, isPrivate: false, turnTimerSec: 15, autoStart: false, blind: { holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1000, botCount: 1 } }
const BUY_IN = 10_000

/** A port backed by a map, recording every player it was asked about. */
function fakeTitles(initial: [string, EntranceTitle | null][] = []): TitlePort & { titles: Map<string, EntranceTitle | null>; asked: string[] } {
  const titles = new Map(initial)
  const asked: string[] = []
  return { titles, asked, equippedTitle: (playerId) => { asked.push(playerId); return Promise.resolve(titles.get(playerId) ?? null) } }
}

/** Lets the lookup's promise chain and the room-queue job it enqueues run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const entrances = (h: RoomHarness, viewer: string) => h.ofType(viewer, 'ROOM_EVENT').filter((m) => m.event.type === 'TITLE_ENTRANCE').map((m) => m.event)

async function twoHumans(titles?: TitlePort) {
  const h = createRoomHarness(HOLDEM, titles ? { titles } : {})
  await h.room.join(h.identity('a'))
  await h.room.join(h.identity('b'))
  return h
}

describe('Room title entrance (BP-42)', () => {
  it('a human wearing title_god who sits is announced to everyone in the room', async () => {
    const port = fakeTitles([['a', 'god']])
    const h = await twoHumans(port)
    await h.room.sitDown('a', 2, BUY_IN)
    await settle()
    const expected = { type: 'TITLE_ENTRANCE', title: 'god', seat: 2, playerId: 'a' }
    for (const viewer of ['h', 'a', 'b']) {
      const events = h.ofType(viewer, 'ROOM_EVENT').map((m) => m.event.type)
      expect(entrances(h, viewer)).toEqual([expected])
      expect(events.indexOf('TITLE_ENTRANCE')).toBeGreaterThan(events.indexOf('PLAYER_SAT'))
    }
    // One broadcast, one seq for all: the same frame for everybody.
    expect(new Set(['h', 'a', 'b'].map((v) => h.ofType(v, 'ROOM_EVENT').find((m) => m.event.type === 'TITLE_ENTRANCE')!.seq)).size).toBe(1)
  })

  it('the host sitting first is announced like anyone (to an otherwise empty room)', async () => {
    const h = createRoomHarness(HOLDEM, { titles: fakeTitles([['h', 'godslayer']]) })
    await h.room.sitDown('h', 0, BUY_IN)
    await settle()
    expect(entrances(h, 'h')).toEqual([{ type: 'TITLE_ENTRANCE', title: 'godslayer', seat: 0, playerId: 'h' }])
  })

  it('no title, no announcement, and no cooldown', async () => {
    const port = fakeTitles([['a', null]])
    const h = await twoHumans(port)
    await h.room.sitDown('a', 1, BUY_IN)
    await settle()
    expect(entrances(h, 'b')).toEqual([])
    port.titles.set('a', 'demigod')
    await h.room.standUp('a')
    await h.room.sitDown('a', 1, BUY_IN)
    await settle()
    expect(entrances(h, 'b')).toEqual([{ type: 'TITLE_ENTRANCE', title: 'demigod', seat: 1, playerId: 'a' }])
    expect(port.asked).toEqual(['a', 'a'])
  })

  it('sitting again inside ten minutes is not announced', async () => {
    const port = fakeTitles([['a', 'god']])
    const h = await twoHumans(port)
    await h.room.sitDown('a', 0, BUY_IN)
    await settle()
    expect(entrances(h, 'b')).toHaveLength(1)
    await h.room.standUp('a')
    h.clock.advance(599_999)
    await h.room.sitDown('a', 0, BUY_IN)
    await settle()
    expect(entrances(h, 'b')).toHaveLength(1)
    expect(port.asked).toEqual(['a']) // inside the cooldown the port is not even asked
    await h.room.standUp('a')
    h.clock.advance(2)
    await h.room.sitDown('a', 0, BUY_IN)
    await settle()
    expect(entrances(h, 'b')).toHaveLength(2)
  })

  it('the sit does not wait for the lookup', async () => {
    const port: TitlePort = { equippedTitle: () => new Promise<never>(() => {}) }
    const h = await twoHumans(port)
    await h.room.sitDown('a', 0, BUY_IN) // resolves although the lookup never does
    expect(h.ofType('b', 'ROOM_EVENT').some((m) => m.event.type === 'PLAYER_SAT')).toBe(true)
    await h.room.setReady('a', true) // the room's queue is free
    expect(h.ofType('b', 'ROOM_EVENT').some((m) => m.event.type === 'PLAYER_READY')).toBe(true)
    expect(entrances(h, 'b')).toEqual([])
  })

  it('a failed lookup only warns', async () => {
    const port: TitlePort = { equippedTitle: () => Promise.reject(new Error('db down')) }
    const h = await twoHumans(port)
    await h.room.sitDown('a', 0, BUY_IN)
    await settle()
    expect(entrances(h, 'b')).toEqual([])
    expect(h.logs.filter((l) => l.level === 'warn' && l.msg === 'title lookup failed')).toHaveLength(1)
    expect(h.logs.filter((l) => l.level === 'error')).toEqual([])
  })

  it('a player who left the seat before the answer is not announced', async () => {
    let answer!: (title: EntranceTitle) => void
    const port: TitlePort = { equippedTitle: () => new Promise<EntranceTitle>((resolve) => { answer = resolve }) }
    const h = await twoHumans(port)
    await h.room.sitDown('a', 0, BUY_IN)
    await h.room.standUp('a')
    answer('god')
    await settle()
    expect(entrances(h, 'b')).toEqual([])
    // ... nor one who stood and sat again in another seat: the answer belongs to the first sitting.
    await h.room.sitDown('a', 3, BUY_IN)
    answer('god')
    await settle()
    expect(entrances(h, 'b')).toEqual([{ type: 'TITLE_ENTRANCE', title: 'god', seat: 3, playerId: 'a' }])
  })

  it('a room that closes before the answer announces nothing', async () => {
    let answer!: (title: EntranceTitle) => void
    const port: TitlePort = { equippedTitle: () => new Promise<EntranceTitle>((resolve) => { answer = resolve }) }
    const h = await twoHumans(port)
    await h.room.sitDown('a', 0, BUY_IN)
    await h.room.shutdown('test')
    const before = h.ofType('b', 'ROOM_EVENT').length
    answer('god')
    await settle()
    expect(h.ofType('b', 'ROOM_EVENT').length).toBe(before)
  })

  it('bots and reconnects are never announced', async () => {
    const port = fakeTitles([['a', 'god']])
    const h = createRoomHarness(BLIND_WITH_BOT, { titles: port })
    await h.room.join(h.identity('a'))
    expect([...h.room.players.values()].some((p) => p.identity.isBot && p.seat !== null)).toBe(true)
    await h.room.sitDown('a', 0)
    await settle()
    expect(entrances(h, 'h')).toHaveLength(1)
    expect(port.asked).toEqual(['a']) // the bot, seated by the constructor, was never asked about
    await h.room.onDisconnect('a')
    await h.room.onReconnect('a')
    await settle()
    expect(entrances(h, 'h')).toHaveLength(1)
    expect(port.asked).toEqual(['a'])
  })

  it('no port, no announcement', async () => {
    const h = await twoHumans()
    await h.room.sitDown('a', 0, BUY_IN)
    await settle()
    expect(entrances(h, 'b')).toEqual([])
    expect(h.logs).toEqual([])
  })
})
