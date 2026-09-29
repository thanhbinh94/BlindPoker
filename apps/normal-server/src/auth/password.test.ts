import { describe, expect, it } from 'vitest'
import { ARGON2_PARAMS, DUMMY_HASH, hashPassword, validatePassword, verifyPassword } from './password.js'

/** Every test but the one that pins the production cost runs at 8 MiB: the suite is not a benchmark. */
const CHEAP = { memoryCost: 8_192, timeCost: 1, parallelism: 1 }

describe('hashPassword / verifyPassword', () => {
  it('hashes with argon2id at the production parameters, and verifies what it produced', async () => {
    const hash = await hashPassword('correct horse battery')
    expect(hash.startsWith(`$argon2id$v=19$m=${ARGON2_PARAMS.memoryCost},p=${ARGON2_PARAMS.parallelism},t=${ARGON2_PARAMS.timeCost}$`)).toBe(true)
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true)
    expect(await verifyPassword(hash, 'correct horse batterY')).toBe(false)
  })

  it('salts: the same password twice is two different hashes, and both verify', async () => {
    const a = await hashPassword('same password', CHEAP)
    const b = await hashPassword('same password', CHEAP)
    expect(a).not.toBe(b)
    expect(await verifyPassword(a, 'same password')).toBe(true)
    expect(await verifyPassword(b, 'same password')).toBe(true)
  })

  it('answers a stored value it cannot parse with false rather than a throw', async () => {
    expect(await verifyPassword('', 'anything')).toBe(false)
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false)
    expect(await verifyPassword('$argon2id$v=19$m=8,t=1,p=1$truncated', 'anything')).toBe(false)
  })
})

describe('DUMMY_HASH', () => {
  it('is a real argon2id hash at the production cost that nothing verifies against', async () => {
    const dummy = await DUMMY_HASH
    expect(dummy.startsWith(`$argon2id$v=19$m=${ARGON2_PARAMS.memoryCost}`)).toBe(true)
    expect(await verifyPassword(dummy, 'password123')).toBe(false)
    expect(await verifyPassword(dummy, '')).toBe(false)
  })

  it('is hashed once, so the unknown-email path costs one verification and not a hash as well', async () => {
    expect(await DUMMY_HASH).toBe(await DUMMY_HASH)
  })
})

describe('validatePassword', () => {
  it('accepts 8 to 128 characters', () => {
    expect(validatePassword('12345678')).toEqual({ ok: true })
    expect(validatePassword('x'.repeat(128))).toEqual({ ok: true })
  })

  it('refuses anything shorter or longer as a length problem', () => {
    expect(validatePassword('1234567')).toEqual({ ok: false, reason: 'length' })
    expect(validatePassword('')).toEqual({ ok: false, reason: 'length' })
    expect(validatePassword('x'.repeat(129))).toEqual({ ok: false, reason: 'length' })
  })

  it('counts code points, not UTF-16 units', () => {
    // Eight emoji are eight characters to the person typing them, and sixteen units to JavaScript.
    expect(validatePassword('😀'.repeat(8))).toEqual({ ok: true })
    expect(validatePassword('😀'.repeat(7))).toEqual({ ok: false, reason: 'length' })
  })

  it('refuses a password that is the local part of its own address, whatever the casing', () => {
    expect(validatePassword('binhlathanh', 'binhlathanh@example.com')).toEqual({ ok: false, reason: 'weak' })
    expect(validatePassword('BinhLaThanh', 'binhlathanh@EXAMPLE.com')).toEqual({ ok: false, reason: 'weak' })
    expect(validatePassword('binhlathanh!', 'binhlathanh@example.com')).toEqual({ ok: true })
  })

  it('refuses the whole address as well, whatever the casing (T2)', () => {
    expect(validatePassword('binhlathanh@example.com', 'binhlathanh@example.com')).toEqual({ ok: false, reason: 'weak' })
    expect(validatePassword(' BinhLaThanh@Example.com ', 'binhlathanh@example.com')).toEqual({ ok: false, reason: 'weak' })
  })

  it('still checks the length when no address is offered', () => {
    expect(validatePassword('short')).toEqual({ ok: false, reason: 'length' })
    expect(validatePassword('long enough')).toEqual({ ok: true })
  })
})
