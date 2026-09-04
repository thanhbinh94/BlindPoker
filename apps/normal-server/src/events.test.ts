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

const LOGIN: AppEvent = { type: 'LOGIN', playerId: 'p1', at: 1 }

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

    await bus.publish(LOGIN)

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

    await bus.publish(LOGIN)
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

    await expect(bus.publish(LOGIN)).resolves.toBeUndefined()
    expect(ran).toEqual(['third'])
    expect(errors).toHaveLength(2)
    expect(errors[0]).toMatchObject({ msg: 'event subscriber failed', data: { event: 'LOGIN', error: 'boom' } })
    expect(errors[1]!.data).toMatchObject({ error: 'async boom' })
  })

  it('stops delivering after unsubscribe, and unsubscribing twice is harmless', async () => {
    const { log } = recorder()
    const bus = createEventBus(log)
    const seen: AppEvent[] = []
    const off = bus.subscribe((e) => {
      seen.push(e)
    })

    await bus.publish(LOGIN)
    off()
    off()
    await bus.publish(LOGIN)

    expect(seen).toHaveLength(1)
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

    await bus.publish(LOGIN)
    expect(ran).toEqual(['middle', 'last'])

    ran.length = 0
    await bus.publish(LOGIN)
    expect(ran).toEqual(['middle'])
  })
})
