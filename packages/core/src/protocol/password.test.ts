import { describe, expect, it } from 'vitest'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, validatePassword } from './password.js'

describe('validatePassword (the shared rule)', () => {
  it('takes 8 to 128 code points', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8)
    expect(PASSWORD_MAX_LENGTH).toBe(128)
    expect(validatePassword('12345678')).toEqual({ ok: true })
    expect(validatePassword('1234567')).toEqual({ ok: false, reason: 'length' })
    expect(validatePassword('😀'.repeat(8))).toEqual({ ok: true })
    expect(validatePassword('😀'.repeat(129))).toEqual({ ok: false, reason: 'length' })
  })

  it('refuses the part of the address before the @', () => {
    expect(validatePassword('binhlathanh', 'binhlathanh@example.com')).toEqual({ ok: false, reason: 'weak' })
  })

  it('refuses the whole address too, whatever the casing and surrounding spaces (T2)', () => {
    expect(validatePassword('binhlathanh@example.com', 'binhlathanh@example.com')).toEqual({ ok: false, reason: 'weak' })
    expect(validatePassword('BinhLaThanh@Example.COM', 'binhlathanh@example.com')).toEqual({ ok: false, reason: 'weak' })
    expect(validatePassword('  binhlathanh@example.com ', ' BINHLATHANH@example.com')).toEqual({ ok: false, reason: 'weak' })
  })

  it('accepts anything that merely contains the address', () => {
    expect(validatePassword('binhlathanh@example.com!', 'binhlathanh@example.com')).toEqual({ ok: true })
    expect(validatePassword('binhlathanh!', 'binhlathanh@example.com')).toEqual({ ok: true })
  })

  it('checks only the length when there is no address to compare against', () => {
    expect(validatePassword('binhlathanh@example.com')).toEqual({ ok: true })
  })
})
