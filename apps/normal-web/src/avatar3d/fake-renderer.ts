import type { AvatarConfigDto } from '../api.js'
import { abortError } from './abort.js'
import type { PortraitFrame } from './framing.js'
import { hashConfig } from './hash.js'
import type { PortraitRenderer } from './usePortrait.js'

/**
 * A portrait renderer for tests, and the reason `three` never runs under jsdom.
 *
 * jsdom has no WebGL, no `HTMLCanvasElement.toBlob` and no `fetch` for a `.glb`, so the real renderer
 * could only ever answer "unsupported" there — which would make every state but that one untestable.
 * This double stands in for it through `setPortraitRendererForTests`, and produces one distinct blob
 * per configuration: the hash itself, as bytes, standing in for the 1×1 image a real render would
 * return. A test that wants to know *which* config was drawn can read it back.
 *
 * It copies the two structural properties of `portraits.ts` that callers can observe, because a double
 * that lacked them would hide the behaviour they exist for:
 *
 * - **The queue is sequential.** One canvas, one render at a time.
 * - **A job checks its signal when its turn comes.** A caller that gave up while it was waiting is
 *   dropped, and `rendered` never records it — which is what makes "forty tiles queued, thirty-nine
 *   scrolled away, one picture drawn" a thing a test can assert.
 */

export interface FakeRenderer extends PortraitRenderer {
  /** Every hash this double actually started drawing, in order, including repeats. */
  readonly rendered: string[]
  /** Lets go of every render being held, and stops holding the ones that come after. */
  release(): void
}

export interface FakeRendererOptions {
  /** `false` makes `supported()` say no, the way a machine without WebGL does. */
  supported?: boolean
  /** `true` makes every render reject, the way a missing asset bundle does. */
  fails?: boolean
  /** `true` parks every render until `release()`, so a test can observe `loading`. */
  hold?: boolean
}

export function fakeRenderer(options: FakeRendererOptions = {}): FakeRenderer {
  const { supported = true, fails = false, hold = false } = options
  const rendered: string[] = []
  let held: (() => void)[] = []
  let holding = hold
  let queue: Promise<unknown> = Promise.resolve()

  return {
    rendered,
    supported: () => supported,
    render(config: AvatarConfigDto, renderOptions?: { signal?: AbortSignal; frame?: PortraitFrame }): Promise<Blob> {
      // Keyed by the crop as well as the configuration, exactly as the real renderer's caller is: a
      // double that ignored the frame would report one render where the app does two, and a test of the
      // wardrobe's full-body tiles would pass on a bug that served them a face.
      const hash = hashConfig(config, renderOptions?.frame ?? 'portrait')
      const start = async (): Promise<Blob> => {
        // The signal is read here — at the head of the queue — and not when `render` was called.
        if (renderOptions?.signal?.aborted === true) throw abortError()
        rendered.push(hash)
        if (holding) await new Promise<void>((resolve) => held.push(resolve))
        if (fails) throw new Error(`the fake renderer was told to fail on ${hash}`)
        return new Blob([hash], { type: 'image/webp' })
      }
      const next = queue.then(start, start)
      // As in the real module: the queue itself never carries a rejection forward, and the caller still
      // gets the real one.
      queue = next.then(
        () => undefined,
        () => undefined,
      )
      return next
    },
    release() {
      holding = false
      const waiting = held
      held = []
      for (const resume of waiting) resume()
    },
  }
}
