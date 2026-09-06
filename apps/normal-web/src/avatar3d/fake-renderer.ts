import type { AvatarConfigDto } from '../api.js'
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
 */

export interface FakeRenderer extends PortraitRenderer {
  /** Every hash this double was asked to draw, in order, including repeats. */
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

  return {
    rendered,
    supported: () => supported,
    async render(config: AvatarConfigDto): Promise<Blob> {
      const hash = hashConfig(config)
      rendered.push(hash)
      if (holding) await new Promise<void>((resolve) => held.push(resolve))
      if (fails) throw new Error(`the fake renderer was told to fail on ${hash}`)
      return new Blob([hash], { type: 'image/webp' })
    },
    release() {
      holding = false
      const waiting = held
      held = []
      for (const resume of waiting) resume()
    },
  }
}
