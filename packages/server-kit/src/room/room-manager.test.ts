import { createBotStrategy, seededRng, type RoomConfig } from '@bp/core'
import { describe, expect, it } from 'vitest'
import type { DomainEvent } from '../domain-events.js'
import { silentLogger } from '../infra/logger.js'
import { createMemoryRepositories } from '../memory-repositories.js'
import { ManualClock } from '../testing/manual-clock.js'
import { TEST_ROOM_OPTIONS } from '../testing/room-harness.js'
import { RoomManager } from './room-manager.js'
import { RoomError } from './types.js'

const PUBLIC: RoomConfig = { name: 'Pub', mode: 'holdem', maxPlayers: 4, isPrivate: false, turnTimerSec: 30, autoStart: false, holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 } }
const PRIVATE: RoomConfig = { ...PUBLIC, name: 'Priv', isPrivate: true }
const id = (playerId: string) => ({ playerId, displayName: playerId, isBot: false })

function setup() {
  const clock = new ManualClock()
  const repos = createMemoryRepositories()
  for (const p of ['h', 'a', 'b']) repos.addPlayer(p, p, 100_000)
  const domainEvents: DomainEvent[] = []
  const manager = new RoomManager({ clock, rng: seededRng(1), repos, outbox: { send: () => {} }, bot: createBotStrategy(), log: silentLogger, options: TEST_ROOM_OPTIONS, onDomainEvent: (e) => domainEvents.push(e) })
  return { clock, repos, manager, domainEvents }
}

describe('RoomManager', () => {
  it('creates rooms with unique codes, lists public ones newest first, finds by id/code/player', () => {
    const { manager, domainEvents } = setup()
    const r1 = manager.create(id('h'), PUBLIC)
    const r2 = manager.create(id('a'), PRIVATE)
    const r3 = manager.create(id('b'), { ...PUBLIC, name: 'Pub2' })
    expect(r1.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
    expect(new Set([r1.code, r2.code, r3.code]).size).toBe(3)
    expect(manager.listPublic().map((s) => s.name)).toEqual(['Pub2', 'Pub'])
    expect(manager.get(r2.roomId)).toBe(r2)
    expect(manager.getByCode(r1.code.toLowerCase())).toBe(r1)
    expect(manager.roomOf('a')).toBe(r2)
    expect(manager.roomOf('zzz')).toBeUndefined()
    expect(manager.size).toBe(3)
    expect(domainEvents.filter((e) => e.type === 'ROOM_CREATED')).toHaveLength(3)
  })

  it('never puts the room password in the ROOM_CREATED domain event', () => {
    const { manager, domainEvents } = setup()
    manager.create(id('h'), { ...PRIVATE, password: 'pw12' })
    const created = domainEvents.find((e) => e.type === 'ROOM_CREATED')!
    expect(created.type === 'ROOM_CREATED' && created.config.hasPassword).toBe(true)
    expect(created.type === 'ROOM_CREATED' && Object.hasOwn(created.config, 'password')).toBe(false)
    expect(JSON.stringify(created)).not.toContain('pw12')
  })

  it('keeps an O(1) player index in step with joins, leaves and closes', async () => {
    const { manager, clock } = setup()
    const room = manager.create(id('h'), { ...PUBLIC, mode: 'blind', turnTimerSec: 15, holdem: undefined, blind: { holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1000, botCount: 2 } })
    expect(manager.roomOf('h')).toBe(room) // the host is indexed even though the constructor seated them
    for (const bot of [...room.players.keys()].filter((p) => p.startsWith('bot:'))) expect(manager.roomOf(bot)).toBe(room)
    await room.join(id('a'))
    expect(manager.roomOf('a')).toBe(room)
    await room.leave('a')
    expect(manager.roomOf('a')).toBeUndefined()
    expect(manager.roomOf('h')).toBe(room)
    await room.leave('h')
    clock.advance(TEST_ROOM_OPTIONS.emptyRoomCloseMs)
    await room.enqueue(() => undefined)
    expect(room.status).toBe('CLOSED')
    // a closed room keeps its player map, but the index must not keep pointing at it
    expect([...room.players.keys()].length).toBeGreaterThan(0)
    expect(manager.roomOf('h')).toBeUndefined()
    for (const bot of [...room.players.keys()]) expect(manager.roomOf(bot)).toBeUndefined()
  })

  it('drops a kicked bot from the player index and lists the room one seat emptier (T3)', async () => {
    const { manager } = setup()
    const room = manager.create(id('h'), { ...PUBLIC, mode: 'blind', turnTimerSec: 15, holdem: undefined, blind: { holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1000, botCount: 2 } })
    const [bot, other] = [...room.players.keys()].filter((p) => p.startsWith('bot:'))
    expect(manager.listPublic()[0]!.playerCount).toBe(3)
    await room.kick('h', bot!)
    expect(manager.roomOf(bot!)).toBeUndefined()
    expect(manager.roomOf(other!)).toBe(room)
    expect(manager.listPublic()[0]!.playerCount).toBe(2)
  })

  it('refuses a second room for a player already in one', () => {
    const { manager } = setup()
    manager.create(id('h'), PUBLIC)
    expect(() => manager.create(id('h'), PUBLIC)).toThrow(RoomError)
  })

  it('notifies list subscribers on create, change and close, and drops closed rooms', async () => {
    const { manager, clock } = setup()
    let notified = 0
    const off = manager.onListChanged(() => notified++)
    const room = manager.create(id('h'), PUBLIC)
    expect(notified).toBe(1)
    await room.join(id('a'))
    expect(notified).toBeGreaterThanOrEqual(2)
    await room.leave('a')
    await room.leave('h')
    clock.advance(TEST_ROOM_OPTIONS.emptyRoomCloseMs)
    await room.enqueue(() => undefined)
    expect(manager.get(room.roomId)).toBeUndefined()
    expect(manager.getByCode(room.code)).toBeUndefined()
    expect(manager.listPublic()).toEqual([])
    const before = notified
    off()
    manager.create(id('b'), PUBLIC)
    expect(notified).toBe(before)
  })

  it('shutdown closes every room and refuses new ones', async () => {
    const { manager } = setup()
    const r1 = manager.create(id('h'), PUBLIC)
    const r2 = manager.create(id('a'), PRIVATE)
    await manager.shutdown('bye')
    expect(r1.status).toBe('CLOSED')
    expect(r2.status).toBe('CLOSED')
    expect(manager.size).toBe(0)
    let code: string | null = null
    try {
      manager.create(id('b'), PUBLIC)
    } catch (err) {
      code = err instanceof RoomError ? err.code : String(err)
    }
    expect(code).toBe('SERVER_SHUTDOWN')
  })
})
