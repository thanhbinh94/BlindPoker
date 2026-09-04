import { createHash, randomBytes } from 'node:crypto'
import { ECONOMY, validateDisplayName, type DisplayNameRefusal, type PlayerIdentity } from '@bp/core'
import type { LiteRepositories } from '../repos/sqlite-repos.js'

export interface SessionService {
  /** Throws `InvalidNameError` on a malformed name, `NameTakenError` (from sqlite-repos) if it's in use. */
  create(displayName: string): { playerId: string; displayName: string; token: string; balance: number }
  resolve(token: string): PlayerIdentity | null
  hashToken(token: string): string
}

export class InvalidNameError extends Error {}

/**
 * The rule itself is `@bp/core`'s (`validateDisplayName`) — the same one the sign-up form and the
 * `name_key` index use. All this layer adds is the sentence a player reads.
 */
const REFUSAL_MESSAGE: Record<DisplayNameRefusal, string> = {
  length: 'display name must be 2-20 characters',
  chars: 'display name may only contain letters, digits, spaces, "_", "-" and "."',
  edges: 'display name must not start or end with " ", "_", "-" or "."',
}

/** The stored, normalized form of `raw` — NFC, trimmed, internal whitespace collapsed. */
function validateName(raw: string): string {
  const verdict = validateDisplayName(raw)
  if (!verdict.ok) throw new InvalidNameError(REFUSAL_MESSAGE[verdict.reason])
  return verdict.name
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
