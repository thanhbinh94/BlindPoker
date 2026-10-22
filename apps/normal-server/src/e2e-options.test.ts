import { describe, expect, it } from 'vitest'
import { readRateLimitFromEnv } from './e2e-options.js'

describe('readRateLimitFromEnv — the e2e server keeps the shipped read limit unless asked', () => {
  it('leaves the read limit alone when E2E_READ_LIMIT is unset, empty or zero', () => {
    expect(readRateLimitFromEnv({})).toEqual({})
    expect(readRateLimitFromEnv({ E2E_READ_LIMIT: '' })).toEqual({})
    expect(readRateLimitFromEnv({ E2E_READ_LIMIT: '0' })).toEqual({})
  })

  it('raises the per-address read bucket to the given count a minute', () => {
    expect(readRateLimitFromEnv({ E2E_READ_LIMIT: '2400' })).toEqual({ readRateLimit: { limit: 2400, windowMs: 60_000 } })
  })

  it('ignores a value that is not a positive whole number', () => {
    expect(readRateLimitFromEnv({ E2E_READ_LIMIT: 'lots' })).toEqual({})
    expect(readRateLimitFromEnv({ E2E_READ_LIMIT: '-5' })).toEqual({})
    expect(readRateLimitFromEnv({ E2E_READ_LIMIT: '2.5' })).toEqual({})
  })
})
