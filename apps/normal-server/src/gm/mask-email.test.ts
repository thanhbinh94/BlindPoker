import { describe, expect, it } from 'vitest'
import { maskEmail } from './mask-email.js'

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('tbinh9031@gmail.com')).toBe('t***@gmail.com')
    expect(maskEmail('a@x.vn')).toBe('a***@x.vn')
    expect(maskEmail('weird')).toBe('***')
    expect(maskEmail('@nobody.vn')).toBe('***')
  })
})
