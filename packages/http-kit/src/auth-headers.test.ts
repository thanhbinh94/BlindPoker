import { describe, expect, it } from 'vitest'
import { bearerToken, isLoopbackAddress, secretEquals } from './auth-headers.js'

describe('bearerToken', () => {
  it('matches the scheme case-insensitively', () => {
    for (const scheme of ['Bearer', 'bearer', 'BEARER', 'BeArEr']) {
      expect(bearerToken(`${scheme} abc123`), scheme).toBe('abc123')
    }
  })

  it('trims the token and tolerates extra spacing after the scheme', () => {
    expect(bearerToken('Bearer   abc123  ')).toBe('abc123')
  })

  it('is empty for anything that is not a bearer credential', () => {
    expect(bearerToken(undefined)).toBe('')
    expect(bearerToken('')).toBe('')
    expect(bearerToken('abc123')).toBe('')
    expect(bearerToken('Basic abc123')).toBe('')
    expect(bearerToken('Bearer')).toBe('')
  })
})

describe('isLoopbackAddress', () => {
  it('accepts every form this machine reports for itself', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('127.5.6.7')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
  })

  it('rejects everything else, an unknown address included', () => {
    expect(isLoopbackAddress(undefined)).toBe(false)
    expect(isLoopbackAddress('')).toBe(false)
    expect(isLoopbackAddress('192.168.1.10')).toBe(false)
    expect(isLoopbackAddress('::ffff:192.168.1.10')).toBe(false)
    expect(isLoopbackAddress('1270.0.0.1')).toBe(false)
    expect(isLoopbackAddress('localhost')).toBe(false)
  })
})

describe('secretEquals', () => {
  it('is true only for an exact match', () => {
    expect(secretEquals('token', 'token')).toBe(true)
    expect(secretEquals('token', 'Token')).toBe(false)
    expect(secretEquals('token', 'tokenn')).toBe(false)
    expect(secretEquals('', '')).toBe(true)
    expect(secretEquals('', 'token')).toBe(false)
  })

  it('compares multi-byte values without throwing on a length mismatch', () => {
    expect(secretEquals('é', 'é')).toBe(true)
    expect(secretEquals('é', 'e')).toBe(false)
  })
})
