import { describe, expect, it } from 'vitest'
import type { EngineErrorCode } from '../hand/types.js'
import { engineErrorToErrorCode, parseClientMessage, roomConfigToRuleset, validateRoomConfig } from './validate.js'

const holdem = { name: 'Table 1', mode: 'holdem', maxPlayers: 6, isPrivate: false, turnTimerSec: 30, autoStart: false, holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 } }
const blind = { name: 'Blind', mode: 'blind', maxPlayers: 4, isPrivate: true, password: 'abcd', turnTimerSec: 15, autoStart: true, blind: { holeCards: 3, decisionMode: 'playOrFold', fixedWager: 5000, botCount: 2 } }

describe('validateRoomConfig', () => {
  it('accepts a valid holdem config', () => {
    const r = validateRoomConfig(holdem)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.holdem).toEqual(holdem.holdem)
  })
  it('accepts a valid blind config and derives the ruleset', () => {
    const r = validateRoomConfig(blind)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(roomConfigToRuleset(r.value)).toEqual({ mode: 'blind', holeCards: 3, decisionMode: 'playOrFold', fixedWager: 5000, tableFeeRate: 0.02 })
    const h = validateRoomConfig(holdem)
    if (h.ok) expect(roomConfigToRuleset(h.value)).toEqual({ mode: 'holdem', smallBlind: 100, bigBlind: 200, tableFeeRate: 0.02, tableFeeCapBB: 1 })
  })
  it('applies defaults for optional fields', () => {
    const r = validateRoomConfig({ name: 'x', mode: 'holdem', holdem: { smallBlind: 100, bigBlind: 200 } })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toMatchObject({ maxPlayers: 6, isPrivate: false, turnTimerSec: 30, autoStart: false, holdem: { minBuyInBB: 50, maxBuyInBB: 200 } })
  })
  it.each([
    [{ ...holdem, holdem: { ...holdem.holdem, smallBlind: 123 } }, /blind tier/],
    [{ ...holdem, maxPlayers: 10 }, /maxPlayers/],
    [{ ...holdem, turnTimerSec: 20 }, /turnTimer/],
    [{ ...holdem, name: '' }, /name/],
    [{ ...holdem, password: 'ab' }, /password/],
    [{ ...blind, blind: { ...blind.blind, fixedWager: 1234 } }, /wager/],
    [{ ...blind, blind: { ...blind.blind, botCount: 4 } }, /botCount/],
    [{ ...blind, blind: { ...blind.blind, holeCards: 4 } }, /holeCards/],
    [{ ...blind, blind: { holeCards: 3, fixedWager: 5000, botCount: 2 } }, /decisionMode/],
    [{ ...blind, maxPlayers: 9 }, /maxPlayers/],
    [{ ...holdem, mode: 'omaha' }, /mode/],
    [{ ...holdem, holdem: undefined }, /holdem/],
    ['nope', /object/],
  ])('rejects %j', (input, message) => {
    const r = validateRoomConfig(input)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('INVALID_ROOM_CONFIG')
      expect(r.message).toMatch(message)
    }
  })
})

describe('parseClientMessage', () => {
  it('parses an ACTION with reqId and baseSeq', () => {
    const r = parseClientMessage({ t: 'ACTION', reqId: 'r1', baseSeq: 12, action: { kind: 'raise', amount: 300 } })
    expect(r).toEqual({ ok: true, value: { t: 'ACTION', reqId: 'r1', baseSeq: 12, action: { kind: 'raise', amount: 300 } } })
  })
  it('parses room messages', () => {
    expect(parseClientMessage({ t: 'JOIN_ROOM', code: 'ABC123' }).ok).toBe(true)
    expect(parseClientMessage({ t: 'SIT_DOWN', seat: 2, buyIn: 10000 }).ok).toBe(true)
    expect(parseClientMessage({ t: 'READY', ready: true }).ok).toBe(true)
    expect(parseClientMessage({ t: 'CREATE_ROOM', config: holdem }).ok).toBe(true)
    expect(parseClientMessage({ t: 'PONG' }).ok).toBe(true)
  })
  it('preserves reqId on every message variant', () => {
    expect(parseClientMessage({ t: 'READY', ready: true, reqId: 'r9' })).toEqual({ ok: true, value: { t: 'READY', ready: true, reqId: 'r9' } })
    expect(parseClientMessage({ t: 'START_GAME', reqId: 'r9' })).toEqual({ ok: true, value: { t: 'START_GAME', reqId: 'r9' } })
    expect(parseClientMessage({ t: 'HELLO', sessionToken: 'tok', reqId: 'r9' })).toEqual({ ok: true, value: { t: 'HELLO', sessionToken: 'tok', reqId: 'r9' } })
    expect(parseClientMessage({ t: 'KICK', playerId: 'p1', reqId: 'r9' })).toEqual({ ok: true, value: { t: 'KICK', playerId: 'p1', reqId: 'r9' } })
    for (const t of ['LIST_ROOMS', 'LEAVE_ROOM', 'STAND_UP', 'RESYNC', 'PONG']) {
      expect(parseClientMessage({ t, reqId: 'r9' })).toEqual({ ok: true, value: { t, reqId: 'r9' } })
    }
    expect(parseClientMessage({ t: 'PONG' })).toEqual({ ok: true, value: { t: 'PONG' } }) // absent stays absent
  })
  it.each([
    [null], ['ACTION'], [{ t: 'NOPE' }], [{ t: 'ACTION', action: { kind: 'fold' } }],
    [{ t: 'ACTION', reqId: 'r', baseSeq: 1, action: { kind: 'bet' } }],
    [{ t: 'ACTION', reqId: 'r', baseSeq: 1, action: { kind: 'bet', amount: 1.5 } }],
    [{ t: 'SIT_DOWN', seat: 'x' }], [{ t: 'READY' }], [{ t: 'JOIN_ROOM' }], [{ t: 'HELLO' }],
  ])('rejects %j with INVALID_MESSAGE', (input) => {
    const r = parseClientMessage(input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('INVALID_MESSAGE')
  })
})

describe('engineErrorToErrorCode', () => {
  it.each<[EngineErrorCode, string]>([
    ['NOT_YOUR_TURN', 'NOT_YOUR_TURN'],
    ['ILLEGAL_ACTION', 'ILLEGAL_ACTION'],
    ['INVALID_AMOUNT', 'INVALID_AMOUNT'],
    ['NOT_IN_HAND', 'NOT_IN_HAND'],
    ['HAND_COMPLETE', 'NOT_IN_HAND'],
    ['INVALID_COMMAND', 'INTERNAL'],
    ['INVALID_SETUP', 'INTERNAL'],
  ])('%s → %s', (engine, wire) => {
    expect(engineErrorToErrorCode(engine)).toBe(wire)
  })
})
