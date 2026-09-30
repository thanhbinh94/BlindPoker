import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Chibi } from './Chibi.js'
import { defaultChibi } from './defaults.js'
import { layersFor } from './layers.js'
import type { BaseRef, ChibiConfig } from './types.js'

/**
 * What `Chibi` does when the browser refuses a tinted layer's `blob:` URL — the failure behind No15/No16, where
 * a page policy without `blob:` in `img-src` blanked every recoloured layer. The hook itself is mocked: whether a
 * blob URL was minted is `tinted.test.ts`'s business; this file is only about what the `<img>` does with one.
 */

const mockTinted = vi.hoisted(() => ({ url: null as string | null }))
vi.mock('./tinted.js', () => ({
  useTintedLayer: (_prefix: string, layer: { tints?: unknown[] }) => (layer.tints === undefined || layer.tints.length === 0 ? null : mockTinted.url),
}))

const SUBJECT = defaultChibi('ann')
const TINTED_BASE: BaseRef = { ...SUBJECT.base, tint: { hair: { meanL: 0.4, files: [SUBJECT.base.body] } } }
const SUBJECT_WITH_HAIR: ChibiConfig = { ...SUBJECT, base: TINTED_BASE, hairColor: '#b3261e' }
const LAYERS = layersFor(SUBJECT_WITH_HAIR, 'neutral', 'full')
const BODY = LAYERS.find((l) => l.order === 30)!

/** The `<img>` of the one tinted layer — found by its inline z-index, since its `src` is what changes. */
function bodyImg(container: HTMLElement): HTMLImageElement {
  const img = [...container.querySelectorAll('img')].find((el) => el.style.zIndex === String(BODY.order))
  if (img === undefined) throw new Error('no img at the body layer')
  return img
}

const PLAIN_1X = `/avatar/${BODY.file}@1x.png`
const PLAIN_SRCSET = `/avatar/${BODY.file}@1x.png 1x, /avatar/${BODY.file}@2x.png 2x`

describe('Chibi — a tinted layer the browser refuses', () => {
  beforeEach(() => {
    mockTinted.url = 'blob:http://localhost/tint-a'
  })

  it('shows the tinted URL, with no srcset, while it loads', () => {
    expect(BODY.tints).toHaveLength(1)
    const { container } = render(<Chibi subject={SUBJECT_WITH_HAIR} />)
    const img = bodyImg(container)
    expect(img.getAttribute('src')).toBe('blob:http://localhost/tint-a')
    expect(img.hasAttribute('srcset')).toBe(false)
  })

  it('falls back to the plain two-density layer when the tinted <img> fires error', () => {
    const { container } = render(<Chibi subject={SUBJECT_WITH_HAIR} />)
    fireEvent.error(bodyImg(container))

    const img = bodyImg(container)
    expect(img.getAttribute('src')).toBe(PLAIN_1X)
    expect(img.getAttribute('srcset')).toBe(PLAIN_SRCSET)
  })

  it('leaves every other layer alone when one tinted layer fails', () => {
    const { container } = render(<Chibi subject={SUBJECT_WITH_HAIR} />)
    const before = [...container.querySelectorAll('img')].map((el) => el.getAttribute('src'))
    fireEvent.error(bodyImg(container))
    const after = [...container.querySelectorAll('img')].map((el) => el.getAttribute('src'))

    expect(after).toHaveLength(before.length)
    const changed = after.flatMap((src, i) => (src === before[i] ? [] : [i]))
    expect(changed).toHaveLength(1)
    expect(after[changed[0]!]).toBe(PLAIN_1X)
  })

  it('keeps the plain layer for the URL that failed, but tries a different tinted URL again', () => {
    const { container, rerender } = render(<Chibi subject={SUBJECT_WITH_HAIR} />)
    fireEvent.error(bodyImg(container))
    expect(bodyImg(container).getAttribute('src')).toBe(PLAIN_1X)

    // The same URL again (any re-render): still the plain layer, never a retry loop against a URL that failed.
    rerender(<Chibi subject={SUBJECT_WITH_HAIR} expression="happy" />)
    expect(bodyImg(container).getAttribute('src')).toBe(PLAIN_1X)

    // A new tint is a new URL: it is tried, without srcset, and can fail on its own account.
    mockTinted.url = 'blob:http://localhost/tint-b'
    rerender(<Chibi subject={{ ...SUBJECT_WITH_HAIR, hairColor: '#3f6fd8' }} />)
    expect(bodyImg(container).getAttribute('src')).toBe('blob:http://localhost/tint-b')
    expect(bodyImg(container).hasAttribute('srcset')).toBe(false)

    fireEvent.error(bodyImg(container))
    expect(bodyImg(container).getAttribute('src')).toBe(PLAIN_1X)
    expect(bodyImg(container).getAttribute('srcset')).toBe(PLAIN_SRCSET)
  })

  it('an untinted layer never gets an error handler that could swap it', () => {
    const { container } = render(<Chibi subject={SUBJECT} />)
    const before = [...container.querySelectorAll('img')].map((el) => [el.getAttribute('src'), el.getAttribute('srcset')])
    for (const img of container.querySelectorAll('img')) fireEvent.error(img)
    const after = [...container.querySelectorAll('img')].map((el) => [el.getAttribute('src'), el.getAttribute('srcset')])
    expect(after).toEqual(before)
  })
})
