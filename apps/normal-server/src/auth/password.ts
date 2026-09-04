/**
 * Passwords: how one is hashed, how one is checked, and what counts as one at all.
 *
 * argon2id at OWASP's memory-hard baseline (64 MiB, 3 passes, 1 lane). The parameters live in one
 * exported constant rather than at each call site: a hash records the cost it was made with, so a
 * second set of numbers somewhere else would silently create two populations of hashes and make
 * "are we still at the intended cost?" unanswerable.
 *
 * `verifyPassword` never throws. A stored value that argon2 cannot parse — a truncated row, a hash
 * from some other scheme — is a failed login, not a 500: the caller must not be able to tell the
 * difference between "wrong password" and "this row is damaged", and neither must an attacker.
 *
 * `DUMMY_HASH` exists for that same reason at the account level. Verifying a password against a real
 * hash costs ~50 ms; returning "no such email" without doing that work makes the two answers
 * distinguishable by a stopwatch, which turns login into an account-enumeration oracle. The unknown-
 * email path therefore verifies against this hash of an unguessable random string and fails the same
 * way, at the same cost. It is computed once, at import, because a hash per attempted login would
 * hand an attacker the amplification the delay was meant to deny them.
 */
import { randomBytes } from 'node:crypto'
import { argon2id, hash, verify } from 'argon2'

/** The one place the cost is decided. Changing these invalidates nothing — old hashes carry their own. */
export const ARGON2_PARAMS = { memoryCost: 65_536, timeCost: 3, parallelism: 1 } as const

/** The knobs `hashPassword` accepts; tests lower `memoryCost` so a suite is not a benchmark. */
export interface Argon2Params {
  memoryCost: number
  timeCost: number
  parallelism: number
}

const MIN_LENGTH = 8
const MAX_LENGTH = 128

export function hashPassword(plain: string, params: Argon2Params = ARGON2_PARAMS): Promise<string> {
  return hash(plain, { type: argon2id, ...params })
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain)
  } catch {
    return false
  }
}

/** A hash of 32 random bytes: nothing verifies against it, and nothing has to, for it to cost what a real one costs. */
export const DUMMY_HASH: Promise<string> = hashPassword(randomBytes(32).toString('base64url'))

// The promise is created at import and first awaited on the first unknown-email sign-in, which may be
// hours later. If argon2 fails at boot — a missing native binding, an allocation refused — Node's
// default unhandled-rejection behaviour would kill the process in the meantime, with nothing said
// about why. This marks it handled; `DUMMY_HASH` itself still rejects for whoever awaits it, so the
// failure surfaces at the login that needed it rather than as a silent exit at start-up.
void DUMMY_HASH.catch(() => {})

export type PasswordRefusal = 'length' | 'weak'

export type PasswordVerdict = { ok: true } | { ok: false; reason: PasswordRefusal }

/**
 * The rule: 8–128 characters, and not the local part of the address it protects.
 *
 * Length is counted in code points, like a display name's, so an accented or emoji-bearing password
 * is measured the way the person typing it counts. `email` is optional because the rule is about the
 * pair, and a caller that has no address to compare against still wants the length check.
 */
export function validatePassword(password: string, email?: string): PasswordVerdict {
  const length = [...password].length
  if (length < MIN_LENGTH || length > MAX_LENGTH) return { ok: false, reason: 'length' }
  if (email !== undefined) {
    const local = email.trim().toLowerCase().split('@')[0] ?? ''
    if (local !== '' && local === password.trim().toLowerCase()) return { ok: false, reason: 'weak' }
  }
  return { ok: true }
}
