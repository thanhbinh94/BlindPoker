import { timingSafeEqual } from 'node:crypto'

/**
 * `Authorization: Bearer <token>`, with the scheme matched case-insensitively — RFC 7235 §2.1 makes
 * the scheme a case-insensitive token, and `bearer` from a hand-rolled client is not a 401.
 */
export function bearerToken(header: string | undefined): string {
  if (header === undefined) return ''
  const space = header.indexOf(' ')
  if (space < 0) return ''
  if (header.slice(0, space).toLowerCase() !== 'bearer') return ''
  return header.slice(space + 1).trim()
}

/**
 * True for an address that can only belong to this machine: IPv6 `::1`, anything in `127.0.0.0/8`,
 * and the IPv4-mapped form Node reports on a dual-stack Windows listener (`::ffff:127.0.0.1`).
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined || address === '') return false
  const addr = address.startsWith('::ffff:') ? address.slice(7) : address
  return addr === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr)
}

/** Constant-time comparison that does not leak the expected length through an early return. */
export function secretEquals(given: string, expected: string): boolean {
  const a = Buffer.from(given, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}
