import type { PlayerIdentity, RoomConfig, RoomSummary } from '@bp/core'
import { newId, newRoomCode } from '../infra/ids.js'
import { Room } from './room.js'
import { RoomError, type RoomDeps } from './types.js'

export class RoomManager {
  private readonly rooms = new Map<string, Room>()
  private readonly byCode = new Map<string, Room>()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly deps: RoomDeps) {}

  get size(): number {
    return this.rooms.size
  }

  create(host: PlayerIdentity, config: RoomConfig): Room {
    if (this.roomOf(host.playerId)) throw new RoomError('ALREADY_IN_ROOM')
    const roomId = newId()
    const code = newRoomCode((c) => this.byCode.has(c))
    const room = new Room({ roomId, code, config, host, deps: this.deps })
    room.onClosed = (r, reason) => {
      this.rooms.delete(r.roomId)
      this.byCode.delete(r.code)
      this.deps.log.info('room closed', { roomId: r.roomId, reason })
      this.notify()
    }
    room.onChanged = () => this.notify()
    this.rooms.set(roomId, room)
    this.byCode.set(code, room)
    this.deps.log.info('room created', { roomId, code, hostPlayerId: host.playerId, mode: config.mode })
    this.deps.onDomainEvent?.({ type: 'ROOM_CREATED', roomId, hostPlayerId: host.playerId, config })
    this.notify()
    return room
  }

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId)
  }

  getByCode(code: string): Room | undefined {
    return this.byCode.get(code.toUpperCase())
  }

  roomOf(playerId: string): Room | undefined {
    for (const room of this.rooms.values()) if (room.hasPlayer(playerId)) return room
    return undefined
  }

  listPublic(): RoomSummary[] {
    return [...this.rooms.values()].filter((r) => !r.config.isPrivate && r.status !== 'CLOSED').reverse().map((r) => r.summary())
  }

  all(): Room[] {
    return [...this.rooms.values()]
  }

  onListChanged(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  async shutdown(reason: string): Promise<void> {
    await Promise.all([...this.rooms.values()].map((r) => r.shutdown(reason)))
  }

  private notify(): void {
    for (const fn of this.listeners) fn()
  }
}
