import { describe, expect, it } from 'vitest'
import type { RoomPlayerView } from './messages.js'

/**
 * The room view's shape is a contract, not behaviour, so these pin the parts a client would otherwise
 * have to re-derive — and that `pnpm typecheck` would catch if the field were dropped.
 */
describe('RoomPlayerView', () => {
  it('carries the sit-out flag beside status, so a player still finishing a hand can already be sitting out', () => {
    const midHandSitter: RoomPlayerView = {
      playerId: 'p1', displayName: 'P1', isBot: false, isHost: false, connected: true,
      seat: 0, status: 'IN_HAND', sittingOut: true, stack: 20_000, ready: true,
    }
    // The two are independent: `status` describes the hand on the table, `sittingOut` the standing request.
    expect(midHandSitter.status).toBe('IN_HAND')
    expect(midHandSitter.sittingOut).toBe(true)
  })

  it('says a seat is not sitting out rather than leaving it undefined', () => {
    const playing: RoomPlayerView = {
      playerId: 'p2', displayName: 'P2', isBot: false, isHost: false, connected: true,
      seat: 1, status: 'READY', sittingOut: false, stack: 20_000, ready: true,
    }
    expect(playing.sittingOut).toBe(false)
    expect(Object.hasOwn(playing, 'sittingOut')).toBe(true)
  })
})
