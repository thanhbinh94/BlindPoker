/**
 * The one password rule: shared by the server that stores accounts and the form that registers one.
 *
 * It lived on the server alone, and the form checked only the length, so the two could not agree on the
 * one sentence both of them print — "8–128 characters, different from your email". The form now runs
 * this exact function before the request goes out, and the server runs it again on the way in.
 *
 * Pure by construction: string length, trimming and lowercasing, nothing else. Hashing stays with the
 * server; this only decides what counts as a password at all.
 */

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

export type PasswordRefusal = 'length' | 'weak'

export type PasswordVerdict = { ok: true } | { ok: false; reason: PasswordRefusal }

/**
 * 8–128 characters, and not the address it protects — neither the whole address nor the part before the
 * `@`, whatever the casing and surrounding whitespace.
 *
 * Length is counted in code points, like a display name's, so an accented or emoji-bearing password is
 * measured the way the person typing it counts. `email` is optional because the rule is about the pair,
 * and a caller that has no address to compare against (a sign-in) still wants the length check.
 */
export function validatePassword(password: string, email?: string): PasswordVerdict {
  const length = [...password].length
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) return { ok: false, reason: 'length' }
  if (email !== undefined) {
    const address = email.trim().toLowerCase()
    const local = address.split('@')[0] ?? ''
    const typed = password.trim().toLowerCase()
    if ((address !== '' && typed === address) || (local !== '' && typed === local)) return { ok: false, reason: 'weak' }
  }
  return { ok: true }
}
