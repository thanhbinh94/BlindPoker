import { describe, expect, it } from 'vitest'
import { TINT_CONCURRENCY, enqueue, tintQueueStats } from './tint-queue.js'

/** A job the test settles by hand (before or after it starts), recording when it started. */
function gate<T>(started: string[], name: string, value: T) {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const settled = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  // Handled here so a rejection settled before its job has started is not reported as unhandled.
  settled.catch(() => {})
  const job = () => {
    started.push(name)
    return settled
  }
  return {
    job,
    resolve: () => resolve(value),
    reject: (e: unknown) => reject(e),
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('tint queue', () => {
  it('runs at most four jobs at once and starts the next as soon as one settles', async () => {
    expect(TINT_CONCURRENCY).toBe(4)
    const started: string[] = []
    const gates = Array.from({ length: 6 }, (_, i) => gate(started, `j${i}`, i))
    const results = gates.map((g) => enqueue(g.job, 0))

    expect(started).toEqual(['j0', 'j1', 'j2', 'j3'])
    expect(tintQueueStats()).toEqual({ running: 4, waiting: 2 })

    gates[1]!.resolve()
    await expect(results[1]).resolves.toBe(1)
    await flush()
    expect(started).toEqual(['j0', 'j1', 'j2', 'j3', 'j4'])
    expect(tintQueueStats()).toEqual({ running: 4, waiting: 1 })

    for (const g of gates) g.resolve()
    await expect(Promise.all(results)).resolves.toEqual([0, 1, 2, 3, 4, 5])
    await flush()
    expect(tintQueueStats()).toEqual({ running: 0, waiting: 0 })
  })

  it('starts the waiting job with the highest priority first, and jobs of one priority in the order they came', async () => {
    const started: string[] = []
    const busy = Array.from({ length: 4 }, (_, i) => gate(started, `busy${i}`, i))
    const running = busy.map((g) => enqueue(g.job, 0))

    const low = gate(started, 'low', 'low')
    const highA = gate(started, 'highA', 'highA')
    const mid = gate(started, 'mid', 'mid')
    const highB = gate(started, 'highB', 'highB')
    const waiting = [enqueue(low.job, -50), enqueue(highA.job, 10), enqueue(mid.job, 0), enqueue(highB.job, 10)]

    // Free one slot at a time, so each start shows which waiting job the queue picked.
    for (const g of busy) {
      g.resolve()
      await flush()
    }
    expect(started.slice(4)).toEqual(['highA', 'highB', 'mid', 'low'])

    for (const g of [low, highA, mid, highB]) g.resolve()
    await Promise.all([...running, ...waiting])
  })

  it('does not let a rejected or throwing job hold its slot', async () => {
    const started: string[] = []
    const failing = Array.from({ length: 4 }, (_, i) => gate(started, `f${i}`, i))
    const failed = failing.map((g) => enqueue(g.job, 0))
    const throwsAtOnce = enqueue(() => {
      throw new Error('sync throw')
    }, 0)
    const after = gate(started, 'after', 'ok')
    const afterResult = enqueue(after.job, 0)

    for (const g of failing) g.reject(new Error('load failed'))
    for (const p of failed) await expect(p).rejects.toThrow('load failed')
    await expect(throwsAtOnce).rejects.toThrow('sync throw')
    await flush()
    expect(started).toContain('after')
    after.resolve()
    await expect(afterResult).resolves.toBe('ok')
    await flush()
    expect(tintQueueStats()).toEqual({ running: 0, waiting: 0 })
  })
})
