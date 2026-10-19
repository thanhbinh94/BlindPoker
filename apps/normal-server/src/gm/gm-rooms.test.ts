/**
 * The façade's error mapping, on a stub room: a room's own refusal is a `ServiceError` the route turns into a 4xx;
 * anything else is a bug and must reach the route as itself, so it stays a 500.
 */
import { RoomError, type GameServer } from '@bp/server-kit'
import { describe, expect, it, vi } from 'vitest'
import { ServiceError } from '../errors.js'
import { createGmRoomService } from './gm-rooms.js'

function serviceWith(adminKick: () => Promise<'now' | 'after_hand'>) {
  const room = { status: 'WAITING', players: new Map([['p1', {}]]), adminKick }
  const notify = vi.fn()
  const game = { rooms: { get: () => room, all: () => [room] }, notify } as unknown as Pick<GameServer, 'rooms' | 'notify'>
  return { gmRooms: createGmRoomService(game), notify }
}

describe('GmRoomService.kick — what a failed kick becomes', () => {
  it('maps a RoomError to a ServiceError with the same code, and tells nobody', async () => {
    const { gmRooms, notify } = serviceWith(() => Promise.reject(new RoomError('ILLEGAL_ACTION', 'cannot remove a bot this way')))
    const err: unknown = await gmRooms.kick('r1', 'p1', 'phá bàn').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ServiceError)
    expect(err).toMatchObject({ code: 'ILLEGAL_ACTION', message: 'cannot remove a bot this way' })
    expect(notify).not.toHaveBeenCalled()
  })

  it('rethrows anything else unchanged — a bug is not a 400', async () => {
    const bug = new TypeError('room.seat is undefined')
    const { gmRooms, notify } = serviceWith(() => Promise.reject(bug))
    const err: unknown = await gmRooms.kick('r1', 'p1', 'phá bàn').catch((e: unknown) => e)
    expect(err).toBe(bug)
    expect(err).not.toBeInstanceOf(ServiceError)
    expect(notify).not.toHaveBeenCalled()
  })

  it('a kick that works tells the player, with the reason', async () => {
    const { gmRooms, notify } = serviceWith(() => Promise.resolve('after_hand'))
    expect(await gmRooms.kick('r1', 'p1', 'phá bàn')).toBe('after_hand')
    expect(notify).toHaveBeenCalledWith('p1', { t: 'NOTIFICATION', kind: 'GM_NOTICE', payload: { action: 'kick', reason: 'phá bàn' } })
  })
})
