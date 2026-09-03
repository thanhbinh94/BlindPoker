import type { Clock } from '../infra/clock.js'

export class TokenBucket {
  private tokens: number
  private last: number

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly clock: Clock,
  ) {
    this.tokens = capacity
    this.last = clock.now()
  }

  tryTake(): boolean {
    const now = this.clock.now()
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSecond)
    this.last = now
    if (this.tokens >= 1) {
      this.tokens -= 1
      return true
    }
    return false
  }
}
