import type { PlayerIdentity, RoomConfig, RoomSummary } from '@bp/core'
import { newId, newRoomCode } from '../infra/ids.js'
import { Room } from './room.js'
import { RoomError, type RoomDeps } from './types.js'

export class RoomManager {
  private readonly rooms = new Map<string, Room>()
  private readonly byCode = new Map<string, Room>()
  /** playerId → the room they are in. Kept current by Room.onMembership; swept when a room closes. */
  private readonly playerRooms = new Map<string, Room>()
  private readonly listeners = new Set<() => void>()
  private accepting = true

  constructor(private readonly deps: RoomDeps) {}

  get size(): number {
    return this.rooms.size
  }

  create(host: PlayerIdentity, config: RoomConfig): Room {
    if (!this.accepting) throw new RoomError('SERVER_SHUTDOWN', 'server is shutting down')
    if (this.roomOf(host.playerId)) throw new RoomError('ALREADY_IN_ROOM')
    // Poker hỗn loạn needs the edition's cards and ledger (a `ChaosPort`); Lite never wires one.
    if (config.blind?.chaosCycle !== undefined && !this.deps.chaos) throw new RoomError('CHAOS_UNAVAILABLE', 'this server has no chaos cards')
    const roomId = newId()
    const code = newRoomCode((c) => this.byCode.has(c))
    const room = new Room({ roomId, code, config, host, deps: this.deps })
    room.onMembership = (playerId, joined) => {
      if (joined) this.playerRooms.set(playerId, room)
      else if (this.playerRooms.get(playerId) === room) this.playerRooms.delete(playerId)
    }
    // The constructor seated the host and any bots before the hook existed: seed them now.
    for (const playerId of room.players.keys()) this.playerRooms.set(playerId, room)
    room.onClosed = (r, reason) => {
      this.rooms.delete(r.roomId)
      this.byCode.delete(r.code)
      // A closed room keeps its player map, so drop its index entries here rather than on removal.
      for (const [playerId, inRoom] of this.playerRooms) if (inRoom === r) this.playerRooms.delete(playerId)
      this.deps.log.info('room closed', { roomId: r.roomId, reason })
      this.notify()
    }
    room.onChanged = () => this.notify()
    this.rooms.set(roomId, room)
    this.byCode.set(code, room)
    this.deps.log.info('room created', { roomId, code, hostPlayerId: host.playerId, mode: config.mode })
    this.deps.onDomainEvent?.({ type: 'ROOM_CREATED', roomId, hostPlayerId: host.playerId, config: room.summary().config })
    // The host is in the room as much as anyone who walks in later: "rooms joined" counts the rooms a player has
    // been in, their own included (finding T6 of the 2026-09-28 run — `Room.join` is the only other place this is
    // emitted, and the constructor seats the host without going through it). Once per room, like a join.
    this.deps.onDomainEvent?.({ type: 'ROOM_JOINED', roomId, playerId: host.playerId })
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
    return this.playerRooms.get(playerId)
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
    this.accepting = false
    await Promise.all([...this.rooms.values()].map((r) => r.shutdown(reason)))
  }

  private notify(): void {
    for (const fn of this.listeners) fn()
  }
}
