import { ECONOMY } from '../constants/economy.js'
import type { EngineErrorCode, PlayerAction, Ruleset } from '../hand/types.js'
import type { BlindRoomConfig, ClientMessage, ErrorCode, HoldemRoomConfig, RoomConfig } from './messages.js'

export type ParseResult<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; message: string }

const fail = <T>(code: ErrorCode, message: string): ParseResult<T> => ({ ok: false, code, message })
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x)
const isStr = (x: unknown): x is string => typeof x === 'string'
const isBool = (x: unknown): x is boolean => typeof x === 'boolean'

const ACTION_KINDS = new Set(['fold', 'check', 'call', 'bet', 'raise', 'allIn', 'play'])

function parseAction(raw: unknown): PlayerAction | null {
  if (!isObj(raw) || !isStr(raw.kind) || !ACTION_KINDS.has(raw.kind)) return null
  if (raw.kind === 'bet' || raw.kind === 'raise') {
    if (!isInt(raw.amount) || raw.amount <= 0) return null
    return { kind: raw.kind, amount: raw.amount }
  }
  return { kind: raw.kind as Exclude<PlayerAction['kind'], 'bet' | 'raise'> }
}

export function parseClientMessage(raw: unknown): ParseResult<ClientMessage> {
  if (!isObj(raw) || !isStr(raw.t)) return fail('INVALID_MESSAGE', 'message must be an object with a string t')
  const reqId = isStr(raw.reqId) ? raw.reqId : undefined
  const withReq = <T extends object>(m: T): T & { reqId?: string } => (reqId === undefined ? m : { ...m, reqId })
  switch (raw.t) {
    case 'HELLO':
      return isStr(raw.sessionToken) && raw.sessionToken.length > 0 ? { ok: true, value: withReq({ t: 'HELLO', sessionToken: raw.sessionToken }) } : fail('INVALID_MESSAGE', 'HELLO needs sessionToken')
    case 'LIST_ROOMS': case 'LEAVE_ROOM': case 'STAND_UP': case 'SIT_OUT': case 'SIT_IN': case 'START_GAME': case 'RESYNC': case 'PONG': case 'REVEAL':
      return { ok: true, value: withReq({ t: raw.t }) }
    case 'CREATE_ROOM': {
      const cfg = validateRoomConfig(raw.config)
      // A bad config is a rejected request, not a malformed frame: keep INVALID_ROOM_CONFIG so the
      // gateway does not count an honest client's validation mistake as protocol abuse.
      return cfg.ok ? { ok: true, value: withReq({ t: 'CREATE_ROOM', config: cfg.value }) } : fail(cfg.code, cfg.message)
    }
    case 'JOIN_ROOM': {
      if (!isStr(raw.roomId) && !isStr(raw.code)) return fail('INVALID_MESSAGE', 'JOIN_ROOM needs roomId or code')
      const m: Extract<ClientMessage, { t: 'JOIN_ROOM' }> = { t: 'JOIN_ROOM' }
      if (isStr(raw.roomId)) m.roomId = raw.roomId
      if (isStr(raw.code)) m.code = raw.code.toUpperCase()
      if (isStr(raw.password)) m.password = raw.password
      return { ok: true, value: withReq(m) }
    }
    case 'SIT_DOWN': {
      if (!isInt(raw.seat) || raw.seat < 0) return fail('INVALID_MESSAGE', 'SIT_DOWN needs an integer seat')
      const m: Extract<ClientMessage, { t: 'SIT_DOWN' }> = { t: 'SIT_DOWN', seat: raw.seat }
      if (raw.buyIn !== undefined) {
        if (!isInt(raw.buyIn) || raw.buyIn <= 0) return fail('INVALID_MESSAGE', 'buyIn must be a positive integer')
        m.buyIn = raw.buyIn
      }
      return { ok: true, value: withReq(m) }
    }
    case 'READY':
      return isBool(raw.ready) ? { ok: true, value: withReq({ t: 'READY', ready: raw.ready }) } : fail('INVALID_MESSAGE', 'READY needs boolean ready')
    case 'KICK':
      return isStr(raw.playerId) ? { ok: true, value: withReq({ t: 'KICK', playerId: raw.playerId }) } : fail('INVALID_MESSAGE', 'KICK needs playerId')
    case 'ACTION': {
      const action = parseAction(raw.action)
      if (!isStr(raw.reqId) || !isInt(raw.baseSeq) || !action) return fail('INVALID_MESSAGE', 'ACTION needs reqId, baseSeq and a valid action')
      return { ok: true, value: { t: 'ACTION', reqId: raw.reqId, baseSeq: raw.baseSeq, action } }
    }
    default:
      return fail('INVALID_MESSAGE', `unknown message type ${raw.t}`)
  }
}

export function validateRoomConfig(raw: unknown): ParseResult<RoomConfig> {
  const bad = (m: string) => fail<RoomConfig>('INVALID_ROOM_CONFIG', m)
  if (!isObj(raw)) return bad('config must be an object')
  const name = isStr(raw.name) ? raw.name.trim() : ''
  if (name.length < 1 || name.length > 30) return bad('name must be 1–30 characters')
  if (raw.mode !== 'holdem' && raw.mode !== 'blind') return bad('mode must be holdem or blind')
  const mode = raw.mode
  const maxAllowed = mode === 'holdem' ? ECONOMY.maxPlayersHoldem : ECONOMY.maxPlayersBlind
  const maxPlayers = raw.maxPlayers === undefined ? Math.min(ECONOMY.defaultMaxPlayers, maxAllowed) : raw.maxPlayers
  if (!isInt(maxPlayers) || maxPlayers < 2 || maxPlayers > maxAllowed) return bad(`maxPlayers must be 2–${maxAllowed}`)
  const isPrivate = raw.isPrivate === undefined ? false : raw.isPrivate
  if (!isBool(isPrivate)) return bad('isPrivate must be boolean')
  const autoStart = raw.autoStart === undefined ? false : raw.autoStart
  if (!isBool(autoStart)) return bad('autoStart must be boolean')
  const timers: readonly number[] = mode === 'holdem' ? ECONOMY.holdemTurnTimers : ECONOMY.blindTurnTimers
  // A squeeze table's round is fixed (spec 2026-10-08 §4.2.1): the timer a client sends with it is ignored, not refused.
  const squeezeWanted = mode === 'blind' && isObj(raw.blind) && raw.blind.squeeze === true
  const turnTimerSec = (squeezeWanted ? ECONOMY.squeezeTurnTimerSec : raw.turnTimerSec === undefined ? (mode === 'holdem' ? 30 : 15) : raw.turnTimerSec) as number
  if (!squeezeWanted && (!isInt(turnTimerSec) || !timers.includes(turnTimerSec))) return bad(`turnTimerSec must be one of ${timers.join(', ')}`)
  let password: string | undefined
  if (raw.password !== undefined && raw.password !== '') {
    if (!isStr(raw.password) || raw.password.length < 4 || raw.password.length > 20) return bad('password must be 4–20 characters')
    password = raw.password
  }
  const config: RoomConfig = { name, mode, maxPlayers, isPrivate, turnTimerSec, autoStart }
  if (password !== undefined) config.password = password

  if (mode === 'holdem') {
    const h = raw.holdem
    if (!isObj(h)) return bad('holdem settings are required')
    const tier = ECONOMY.holdemBlindTiers.find((t) => t.smallBlind === h.smallBlind && t.bigBlind === h.bigBlind)
    if (!tier) return bad('blinds must match a blind tier')
    const minBuyInBB = h.minBuyInBB === undefined ? ECONOMY.defaultMinBuyInBB : h.minBuyInBB
    const maxBuyInBB = h.maxBuyInBB === undefined ? ECONOMY.defaultMaxBuyInBB : h.maxBuyInBB
    const { min, max } = ECONOMY.buyInBBRange
    if (!isInt(minBuyInBB) || !isInt(maxBuyInBB) || minBuyInBB < min || maxBuyInBB > max || minBuyInBB > maxBuyInBB) return bad(`buy-in must be ${min}–${max} BB with min ≤ max`)
    const holdem: HoldemRoomConfig = { smallBlind: tier.smallBlind, bigBlind: tier.bigBlind, minBuyInBB, maxBuyInBB }
    config.holdem = holdem
  } else {
    const b = raw.blind
    if (!isObj(b)) return bad('blind settings are required')
    if (b.holeCards !== 2 && b.holeCards !== 3) return bad('holeCards must be 2 or 3')
    const decisionMode = b.decisionMode
    if (decisionMode !== 'none' && decisionMode !== 'playOrFold') return bad('decisionMode is required and must be none or playOrFold')
    if (!isInt(b.fixedWager) || !(ECONOMY.blindWagerTiers as readonly number[]).includes(b.fixedWager)) return bad('fixedWager must match a wager tier')
    const botCount = b.botCount === undefined ? 0 : b.botCount
    if (!isInt(botCount) || botCount < 0 || botCount > maxPlayers - 1) return bad('botCount must be 0..maxPlayers-1')
    const squeeze = b.squeeze === undefined ? false : b.squeeze
    if (!isBool(squeeze)) return bad('squeeze must be boolean')
    const blind: BlindRoomConfig = { holeCards: b.holeCards, decisionMode, fixedWager: b.fixedWager, botCount, squeeze }
    config.blind = blind
  }
  return { ok: true, value: config }
}

export function roomConfigToRuleset(config: RoomConfig): Ruleset {
  if (config.mode === 'holdem') {
    const h = config.holdem!
    return { mode: 'holdem', smallBlind: h.smallBlind, bigBlind: h.bigBlind, tableFeeRate: ECONOMY.tableFeeRate, tableFeeCapBB: ECONOMY.tableFeeCapBB }
  }
  const b = config.blind!
  return { mode: 'blind', holeCards: b.holeCards, decisionMode: b.decisionMode, fixedWager: b.fixedWager, tableFeeRate: ECONOMY.tableFeeRate, squeeze: b.squeeze === true }
}

const ENGINE_ERROR_TO_CODE: Record<EngineErrorCode, ErrorCode> = {
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  ILLEGAL_ACTION: 'ILLEGAL_ACTION',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  NOT_IN_HAND: 'NOT_IN_HAND',
  HAND_COMPLETE: 'NOT_IN_HAND',
  INVALID_COMMAND: 'INTERNAL',
  INVALID_SETUP: 'INTERNAL',
}

/** Maps an `EngineError.code` onto the wire `ErrorCode` a client sees. */
export function engineErrorToErrorCode(code: EngineErrorCode): ErrorCode {
  return ENGINE_ERROR_TO_CODE[code]
}
