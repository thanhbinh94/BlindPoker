import { describe, expect, it } from 'vitest'
import { ManualClock } from '../testing/manual-clock.js'
import { TokenBucket } from './rate-limit.js'

describe('TokenBucket', () => {
  it('allows a burst, then refills at the configured rate', () => {
    const clock = new ManualClock()
    const bucket = new TokenBucket(3, 2, clock)
    expect([bucket.tryTake(), bucket.tryTake(), bucket.tryTake(), bucket.tryTake()]).toEqual([true, true, true, false])
    clock.advance(500) // +1 token
    expect(bucket.tryTake()).toBe(true)
    expect(bucket.tryTake()).toBe(false)
    clock.advance(10_000) // caps at capacity
    expect([bucket.tryTake(), bucket.tryTake(), bucket.tryTake(), bucket.tryTake()]).toEqual([true, true, true, false])
  })
})
