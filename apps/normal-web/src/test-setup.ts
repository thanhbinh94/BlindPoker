import '@testing-library/jest-dom/vitest'
import { fakeRenderer } from './avatar3d/fake-renderer.js'
import { setPortraitRendererForTests } from './avatar3d/usePortrait.js'

/**
 * `URL.createObjectURL`, which jsdom does not implement.
 *
 * The portrait cache hands the app `blob:` URLs and revokes them when an entry is evicted, so without
 * this every test that touches a `Portrait` throws on the first cache write — and the revoke half,
 * which is the part with a leak behind it, could not be asserted at all. The shim keeps the browser's
 * contract (a unique opaque string per object, invalid after a revoke) and nothing more; nothing reads
 * the bytes back out of one, in the app or in a test.
 */
if (typeof URL.createObjectURL !== 'function') {
  const live = new Map<string, Blob | MediaSource>()
  let issued = 0
  URL.createObjectURL = (object: Blob | MediaSource): string => {
    issued += 1
    const url = `blob:bind-poker/${issued}`
    live.set(url, object)
    return url
  }
  URL.revokeObjectURL = (url: string): void => {
    live.delete(url)
  }
}

/**
 * No portraits unless a test asks for them.
 *
 * `usePortrait` reaches three.js through a dynamic `import()`, and jsdom has no WebGL — so left to
 * itself every test that renders a seat plate would download and evaluate the whole three.js graph only
 * to be told there is no context. Injecting a renderer that says "unsupported" is both faster and the
 * behaviour those tests actually want to see: the initial-letter placeholder. A test about portraits
 * calls `setPortraitRendererForTests(fakeRenderer())` itself and gets pictures.
 */
setPortraitRendererForTests(fakeRenderer({ supported: false }))
