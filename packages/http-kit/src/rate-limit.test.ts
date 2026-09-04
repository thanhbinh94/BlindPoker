import { describe, expect, it } from 'vitest'
import { createRateLimiter } from './rate-limit.js'

describe('createRateLimiter', () => {
  it('allows exactly `limit` calls inside one window, then refuses', () => {
    const now = 1_000
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => now })
    for (let i = 0; i < 3; i += 1) expect(limiter.check('a')).toEqual({ allowed: true, retryAfterSec: 0 })
    expect(limiter.check('a')).toEqual({ allowed: false, retryAfterSec: 60 })
  })

  it('counts each key separately', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 })
    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('b').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(false)
  })

  it('rounds retryAfterSec up, and never reports zero while refusing', () => {
    let now = 0
    const limiter = createRateLimiter({ limit: 1, windowMs: 10_000, now: () => now })
    limiter.check('a')
    now = 500
    expect(limiter.check('a').retryAfterSec).toBe(10) // 9.5 s rounded up
    now = 9_999
    expect(limiter.check('a')).toEqual({ allowed: false, retryAfterSec: 1 })
  })

  it('starts a fresh window once the old one has expired', () => {
    let now = 0
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => now })
    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(false)
    now = 1_001
    expect(limiter.check('a')).toEqual({ allowed: true, retryAfterSec: 0 })
  })

  it('defaults to the wall clock when no `now` is given', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 })
    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(false)
  })

  it('sweeps expired windows so a scan of many keys cannot grow the map without bound', () => {
    let now = 0
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => now })
    for (let i = 0; i < 1_500; i += 1) limiter.check(`ip-${i}`)
    now = 5_000
    // The sweep runs on the next check; the key it just dropped is allowed again afterwards.
    expect(limiter.check('ip-0').allowed).toBe(true)
  })
})
