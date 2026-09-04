import { createHash, randomBytes } from 'node:crypto'
import { ECONOMY, type PlayerIdentity } from '@bp/core'
import type { LiteRepositories } from '../repos/sqlite-repos.js'

export interface SessionService {
  /** Throws `InvalidNameError` on a malformed name, `NameTakenError` (from sqlite-repos) if it's in use. */
  create(displayName: string): { playerId: string; displayName: string; token: string; balance: number }
  resolve(token: string): PlayerIdentity | null
  hashToken(token: string): string
}

export class InvalidNameError extends Error {}

// Unicode letters (covers Vietnamese diacritics), digits, space, underscore, hyphen, dot.
const NAME_PATTERN = /^[\p{L}\p{N} _.-]+$/u

/**
 * `trim()` here is the validation, not a normalization step: a name with leading or trailing
 * whitespace is rejected outright rather than silently cleaned up, so the returned name is always
 * exactly what the caller typed.
 */
function validateName(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed !== raw) throw new InvalidNameError('display name must not have leading or trailing whitespace')
  if (trimmed.length < 2 || trimmed.length > 20) throw new InvalidNameError('display name must be 2-20 characters')
  if (!NAME_PATTERN.test(trimmed)) throw new InvalidNameError('display name may only contain letters, digits, spaces, "_", "-" and "."')
  return trimmed
}

function hashTokenValue(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createSessionService(repos: LiteRepositories, opts: { startingBalance?: number; random?: () => string } = {}): SessionService {
  const startingBalance = opts.startingBalance ?? ECONOMY.startingBalance
  const generateToken = opts.random ?? (() => randomBytes(32).toString('base64url'))

  return {
    create(displayName) {
      const name = validateName(displayName)
      const token = generateToken()
      const player = repos.createPlayer(name, hashTokenValue(token), startingBalance)
      return { playerId: player.playerId, displayName: player.displayName, token, balance: player.balance }
    },

    resolve(token) {
      const player = repos.findByTokenHash(hashTokenValue(token))
      return player ? { playerId: player.playerId, displayName: player.displayName, isBot: false } : null
    },

    hashToken: hashTokenValue,
  }
}
