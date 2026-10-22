import type { Logger } from '@bp/server-kit'
import { describe, expect, it } from 'vitest'
import type { AppEvent } from './events.js'
import { createEventBus } from './events.js'

function recorder(): { log: Logger; errors: { msg: string; data?: object }[] } {
  const errors: { msg: string; data?: object }[] = []
  const log: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (msg, data) => errors.push({ msg, ...(data === undefined ? {} : { data }) }),
  }
  return { log, errors }
}

const CLAIMED: AppEvent = { type: 'DAILY_CLAIMED', playerId: 'p1', day: 1, streak: 1, consecutive: 1 }

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('createEventBus', () => {
  it('runs subscribers sequentially, in subscription order', async () => {
    const { log } = recorder()
    const bus = createEventBus(log)
    const order: string[] = []

    bus.subscribe(async () => {
      order.push('first:start')
      await tick()
      order.push('first:end')
    })
    bus.subscribe(() => {
      order.push('second')
    })

    await bus.publish(CLAIMED)

    // The second subscriber does not start until the first has finished — which is what lets the
    // achievement module read counters the stats module wrote for the same event.
    expect(order).toEqual(['first:start', 'first:end', 'second'])
  })

  it('resolves only once every subscriber has finished, so a caller can await it and then assert', async () => {
    const { log } = recorder()
    const bus = createEventBus(log)
    let done = false
    bus.subscribe(async () => {
      await tick()
      await tick()
      done = true
    })

    await bus.publish(CLAIMED)
    expect(done).toBe(true)
  })

  it('logs a failing subscriber and still runs the rest', async () => {
    const { log, errors } = recorder()
    const bus = createEventBus(log)
    const ran: string[] = []

    bus.subscribe(() => {
      throw new Error('boom')
    })
    bus.subscribe(async () => {
      await Promise.reject(new Error('async boom'))
    })
    bus.subscribe(() => {
      ran.push('third')
    })

    await expect(bus.publish(CLAIMED)).resolves.toBeUndefined()
    expect(ran).toEqual(['third'])
    expect(errors).toHaveLength(2)
    expect(errors[0]).toMatchObject({ msg: 'event subscriber failed', data: { event: 'DAILY_CLAIMED', error: 'boom' } })
    expect(errors[1]!.data).toMatchObject({ error: 'async boom' })
  })

  it('stops delivering after unsubscribe, and unsubscribing twice is harmless', async () => {
    const { log } = recorder()
    const bus = createEventBus(log)
    const seen: AppEvent[] = []
    const off = bus.subscribe((e) => {
      seen.push(e)
    })

    await bus.publish(CLAIMED)
    off()
    off()
    await bus.publish(CLAIMED)

    expect(seen).toHaveLength(1)
  })

  it('idle() waits for a publish nobody awaited, which is how every domain event arrives', async () => {
    const { log } = recorder()
    const bus = createEventBus(log)
    let done = false
    bus.subscribe(async () => {
      await tick()
      await tick()
      done = true
    })

    // `void bus.publish(e)` is exactly what the room path does: the game loop must not wait for
    // bookkeeping, so nothing holds this promise. `idle()` is the only handle shutdown has on it.
    void bus.publish(CLAIMED)
    expect(done).toBe(false)

    await bus.idle()
    expect(done).toBe(true)
  })

  it('idle() also waits for a publish a subscriber started, which is not in flight yet when it is called', async () => {
    const { log } = recorder()
    const bus = createEventBus(log)
    const seen: string[] = []

    // The real chain: a settled hand moves counters, and the stats module then raises
    // `STATS_UPDATED` of its own. A single snapshot of the in-flight set would miss the second one.
    bus.subscribe(async (e) => {
      seen.push(e.type)
      if (e.type !== 'DAILY_CLAIMED') return
      await tick()
      void bus.publish({ type: 'STATS_UPDATED', playerId: 'p1', changedMetrics: ['totalLoginDays'] })
    })

    void bus.publish(CLAIMED)
    await bus.idle()
    expect(seen).toEqual(['DAILY_CLAIMED', 'STATS_UPDATED'])
  })

  it('idle() resolves immediately when nothing is running', async () => {
    const { log } = recorder()
    await expect(createEventBus(log).idle()).resolves.toBeUndefined()
  })

  it('delivers the event in flight to subscribers that were present when it was published', async () => {
    const { log } = recorder()
    const bus = createEventBus(log)
    const ran: string[] = []

    // The first subscriber removes the *last* one while the event is still being delivered.
    // Iterating the live array would move every later handler back a slot under the loop's own
    // cursor, and the middle one would be skipped for an event it was subscribed to.
    let offLast = (): void => {}
    bus.subscribe(() => offLast())
    bus.subscribe(() => {
      ran.push('middle')
    })
    offLast = bus.subscribe(() => {
      ran.push('last')
    })

    await bus.publish(CLAIMED)
    expect(ran).toEqual(['middle', 'last'])

    ran.length = 0
    await bus.publish(CLAIMED)
    expect(ran).toEqual(['middle'])
  })
})
