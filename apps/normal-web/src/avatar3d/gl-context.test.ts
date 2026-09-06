import { describe, expect, it } from 'vitest'
import { contextLost, watchContext, type ContextEvents } from './gl-context.js'

/**
 * The context guard, against a canvas and a renderer made of nothing.
 *
 * jsdom has no WebGL at all, so the only way to exercise the loss path is to stand in for the two DOM
 * contracts it uses — which is also the honest test, because what is being asserted is a policy ("a
 * lost context refuses to draw"), not a GPU.
 */

/** A canvas that only remembers who is listening, and can fire at them. */
function stubCanvas(): ContextEvents & { fire(type: string): Event; listeners(type: string): number } {
  const listeners = new Map<string, Set<(event: Event) => void>>()
  return {
    addEventListener(type, listener) {
      const held = listeners.get(type) ?? new Set()
      held.add(listener)
      listeners.set(type, held)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    listeners: (type) => listeners.get(type)?.size ?? 0,
    fire(type) {
      let prevented = false
      const event = { type, preventDefault: () => (prevented = true) } as unknown as Event
      for (const listener of listeners.get(type) ?? []) listener(event)
      return Object.assign(event, { defaultPrevented: prevented })
    },
  }
}

/** A renderer whose context answers whatever the test says. */
const stubRenderer = (state: { lost: boolean }) => ({ getContext: () => ({ isContextLost: () => state.lost }) })

describe('watchContext', () => {
  it('is not lost until the canvas says so, and is well again once it is restored', () => {
    const canvas = stubCanvas()
    const watch = watchContext(canvas)

    expect(watch.lost()).toBe(false)

    canvas.fire('webglcontextlost')
    expect(watch.lost()).toBe(true)

    canvas.fire('webglcontextrestored')
    expect(watch.lost()).toBe(false)
  })

  it('prevents the default on the loss, which is what allows the browser to restore it at all', () => {
    const canvas = stubCanvas()
    watchContext(canvas)

    expect(canvas.fire('webglcontextlost')).toHaveProperty('defaultPrevented', true)
  })

  it('stops listening when told to, so a watch cannot outlive its canvas', () => {
    const canvas = stubCanvas()
    const watch = watchContext(canvas)
    expect(canvas.listeners('webglcontextlost')).toBe(1)
    expect(canvas.listeners('webglcontextrestored')).toBe(1)

    watch.stop()

    expect(canvas.listeners('webglcontextlost')).toBe(0)
    expect(canvas.listeners('webglcontextrestored')).toBe(0)
  })
})

describe('contextLost', () => {
  it('believes the event first — the flag is set before anything else can ask', () => {
    const canvas = stubCanvas()
    const watch = watchContext(canvas)
    const state = { lost: false }

    expect(contextLost(watch, stubRenderer(state))).toBe(false)
    canvas.fire('webglcontextlost')
    expect(contextLost(watch, stubRenderer(state))).toBe(true)
  })

  it('asks the context itself as well, for a loss no event has reported yet', () => {
    // The moment that matters: the context can go between `render` and the copy out of the drawing
    // buffer, and nothing has dispatched an event yet when the pixels are read.
    const state = { lost: true }

    expect(contextLost(null, stubRenderer(state))).toBe(true)
    state.lost = false
    expect(contextLost(null, stubRenderer(state))).toBe(false)
  })

  it('treats a context that will not answer as gone', () => {
    expect(
      contextLost(null, {
        getContext() {
          throw new Error('the context is in no state to be asked')
        },
      }),
    ).toBe(true)
    expect(contextLost(null, { getContext: () => null })).toBe(false)
  })
})
