import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { ManualClock } from '../testing/manual-clock.js'
import { ClientConnection } from './connection.js'
import { TokenBucket } from './rate-limit.js'

/** Only `readyState` and `send` are touched by ClientConnection. */
function fakeSocket(): WebSocket {
  return { readyState: WebSocket.OPEN, send: () => {} } as unknown as WebSocket
}

function makeConnection(): ClientConnection {
  const clock = new ManualClock()
  const bucket = new TokenBucket(20, 20, clock)
  return new ClientConnection('conn-1', fakeSocket(), bucket, clock.now())
}

describe('ClientConnection.enqueue', () => {
  it('runs tasks strictly in order, even when an earlier task is still pending', async () => {
    const conn = makeConnection()
    const order: string[] = []

    let resolveTask1: () => void = () => {}
    const task1Started = conn.enqueue(async () => {
      order.push('task1-start')
      await new Promise<void>((resolve) => { resolveTask1 = resolve })
      order.push('task1-end')
    })

    const task2 = conn.enqueue(() => {
      order.push('task2')
    })

    // task2 must not run until task1 resolves, even though it was enqueued immediately.
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['task1-start'])

    resolveTask1()
    await task1Started
    await task2

    expect(order).toEqual(['task1-start', 'task1-end', 'task2'])
  })

  it('does not poison the queue when a task rejects', async () => {
    const conn = makeConnection()
    const order: string[] = []

    const failing = conn.enqueue(() => {
      order.push('task1')
      throw new Error('boom')
    })
    const after = conn.enqueue(() => {
      order.push('task2')
      return 'ok'
    })

    await expect(failing).rejects.toThrow('boom')
    await expect(after).resolves.toBe('ok')
    expect(order).toEqual(['task1', 'task2'])
  })
})
