import { describe, expect, it } from 'vitest'
import type { EngineErrorCode } from '../hand/types.js'
import { ECONOMY } from '../constants/economy.js'
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
    expect(roomConfigToRuleset(r.value)).toEqual({ mode: 'blind', holeCards: 3, decisionMode: 'playOrFold', fixedWager: 5000, tableFeeRate: 0, squeeze: false })
    const h = validateRoomConfig(holdem)
    if (h.ok) expect(roomConfigToRuleset(h.value)).toEqual({ mode: 'holdem', smallBlind: 100, bigBlind: 200, tableFeeRate: 0.02, tableFeeCapBB: 1 })
  })
  it('a chaos cycle of 5 or 10 reaches the ruleset; absent, the ruleset has no chaosCycle key', () => {
    for (const chaosCycle of [5, 10] as const) {
      const r = validateRoomConfig({ ...blind, blind: { ...blind.blind, chaosCycle } })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.value.blind!.chaosCycle).toBe(chaosCycle)
      expect(roomConfigToRuleset(r.value)).toEqual({ mode: 'blind', holeCards: 3, decisionMode: 'playOrFold', fixedWager: 5000, tableFeeRate: 0, squeeze: false, chaosCycle })
    }
    const plain = validateRoomConfig(blind)
    expect(plain.ok && Object.hasOwn(plain.value.blind!, 'chaosCycle')).toBe(false)
    expect(ECONOMY.chaosCycles).toEqual([5, 10])
  })
  it.each([7, 0, '5', null, true])('refuses chaosCycle %j', (chaosCycle) => {
    const r = validateRoomConfig({ ...blind, blind: { ...blind.blind, chaosCycle } })
    expect(r).toMatchObject({ ok: false, code: 'INVALID_ROOM_CONFIG', message: expect.stringMatching(/chaosCycle/) })
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
  it('parses the payload-free seat messages, ignoring anything bolted onto them', () => {
    expect(parseClientMessage({ t: 'SIT_OUT' })).toEqual({ ok: true, value: { t: 'SIT_OUT' } })
    expect(parseClientMessage({ t: 'SIT_IN' })).toEqual({ ok: true, value: { t: 'SIT_IN' } })
    expect(parseClientMessage({ t: 'SIT_OUT', sittingOut: false })).toEqual({ ok: true, value: { t: 'SIT_OUT' } })
  })
  it('preserves reqId on every message variant', () => {
    expect(parseClientMessage({ t: 'READY', ready: true, reqId: 'r9' })).toEqual({ ok: true, value: { t: 'READY', ready: true, reqId: 'r9' } })
    expect(parseClientMessage({ t: 'START_GAME', reqId: 'r9' })).toEqual({ ok: true, value: { t: 'START_GAME', reqId: 'r9' } })
    expect(parseClientMessage({ t: 'HELLO', sessionToken: 'tok', reqId: 'r9' })).toEqual({ ok: true, value: { t: 'HELLO', sessionToken: 'tok', reqId: 'r9' } })
    expect(parseClientMessage({ t: 'KICK', playerId: 'p1', reqId: 'r9' })).toEqual({ ok: true, value: { t: 'KICK', playerId: 'p1', reqId: 'r9' } })
    for (const t of ['LIST_ROOMS', 'LEAVE_ROOM', 'STAND_UP', 'SIT_OUT', 'SIT_IN', 'RESYNC', 'PONG']) {
      expect(parseClientMessage({ t, reqId: 'r9' })).toEqual({ ok: true, value: { t, reqId: 'r9' } })
    }
    expect(parseClientMessage({ t: 'PONG' })).toEqual({ ok: true, value: { t: 'PONG' } }) // absent stays absent
  })
  it('parses a CHAOS_PICK with its offer and card', () => {
    expect(parseClientMessage({ t: 'CHAOS_PICK', reqId: 'r1', offerId: 'o1', cardId: 's_rescue', extra: 1 }))
      .toEqual({ ok: true, value: { t: 'CHAOS_PICK', reqId: 'r1', offerId: 'o1', cardId: 's_rescue' } })
  })
  it('parses a CHAOS_USE with its card uid, and a RESULT_SKIP with or without a reqId', () => {
    expect(parseClientMessage({ t: 'CHAOS_USE', reqId: 'r1', uid: 3, extra: 1 }))
      .toEqual({ ok: true, value: { t: 'CHAOS_USE', reqId: 'r1', uid: 3 } })
    expect(parseClientMessage({ t: 'CHAOS_USE', uid: 3 })).toEqual({ ok: true, value: { t: 'CHAOS_USE', uid: 3 } })
    expect(parseClientMessage({ t: 'RESULT_SKIP', reqId: 'r2' })).toEqual({ ok: true, value: { t: 'RESULT_SKIP', reqId: 'r2' } })
    expect(parseClientMessage({ t: 'RESULT_SKIP' })).toEqual({ ok: true, value: { t: 'RESULT_SKIP' } })
  })
  it('reports a rejected CREATE_ROOM config as INVALID_ROOM_CONFIG, not INVALID_MESSAGE', () => {
    const r = parseClientMessage({ t: 'CREATE_ROOM', config: {} })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('INVALID_ROOM_CONFIG')
      expect(r.message).toMatch(/name/) // the specific reason survives too
    }
    const missing = parseClientMessage({ t: 'CREATE_ROOM' })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.code).toBe('INVALID_ROOM_CONFIG')
  })
  it.each([
    [null], ['ACTION'], [{ t: 'NOPE' }], [{ t: 'ACTION', action: { kind: 'fold' } }],
    [{ t: 'ACTION', reqId: 'r', baseSeq: 1, action: { kind: 'bet' } }],
    [{ t: 'ACTION', reqId: 'r', baseSeq: 1, action: { kind: 'bet', amount: 1.5 } }],
    [{ t: 'SIT_DOWN', seat: 'x' }], [{ t: 'READY' }], [{ t: 'JOIN_ROOM' }], [{ t: 'HELLO' }],
    [{ t: 'CHAOS_PICK', offerId: 'o1' }], [{ t: 'CHAOS_PICK', cardId: 's_rescue' }], [{ t: 'CHAOS_PICK', offerId: '', cardId: 's_rescue' }],
    [{ t: 'CHAOS_USE' }], [{ t: 'CHAOS_USE', uid: 0 }], [{ t: 'CHAOS_USE', uid: -2 }], [{ t: 'CHAOS_USE', uid: 1.5 }], [{ t: 'CHAOS_USE', uid: '3' }],
  ])('rejects %j with INVALID_MESSAGE', (input) => {
    const r = parseClientMessage(input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('INVALID_MESSAGE')
  })
})

describe('squeeze mode (spec 2026-10-08)', () => {
  const squeeze = { ...blind, blind: { ...blind.blind, squeeze: true } }

  it('is off unless asked for, and comes back on a validated config either way', () => {
    const off = validateRoomConfig(blind)
    expect(off.ok && off.value.blind).toMatchObject({ squeeze: false })
    const on = validateRoomConfig(squeeze)
    expect(on.ok && on.value.blind).toMatchObject({ squeeze: true })
  })

  it('forces the round to 20 s on a squeeze table, whatever timer was sent — and refuses 20 s elsewhere', () => {
    for (const turnTimerSec of [undefined, 10, 15, 20, 30, 999]) {
      const r = validateRoomConfig({ ...squeeze, turnTimerSec })
      expect(r.ok && r.value.turnTimerSec, String(turnTimerSec)).toBe(20)
    }
    expect(validateRoomConfig({ ...blind, turnTimerSec: 20 }).ok).toBe(false)
    expect(ECONOMY.squeezeTurnTimerSec).toBe(20)
  })

  it('refuses a squeeze flag that is not a boolean, and never on a Hold\'em table', () => {
    expect(validateRoomConfig({ ...blind, blind: { ...blind.blind, squeeze: 'yes' } }).ok).toBe(false)
    const h = validateRoomConfig(holdem)
    expect(h.ok && h.value.blind).toBeUndefined()
  })

  it('carries squeeze into the ruleset', () => {
    const r = validateRoomConfig(squeeze)
    expect(r.ok && roomConfigToRuleset(r.value)).toMatchObject({ mode: 'blind', squeeze: true })
    const plain = validateRoomConfig(blind)
    expect(plain.ok && roomConfigToRuleset(plain.value)).toMatchObject({ mode: 'blind', squeeze: false })
  })

  it('parses REVEAL as a bare message with an optional reqId', () => {
    expect(parseClientMessage({ t: 'REVEAL' })).toEqual({ ok: true, value: { t: 'REVEAL' } })
    expect(parseClientMessage({ t: 'REVEAL', reqId: 'r1' })).toEqual({ ok: true, value: { t: 'REVEAL', reqId: 'r1' } })
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
