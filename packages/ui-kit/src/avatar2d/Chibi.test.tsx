import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AvatarAssets } from './AvatarAssets.js'
import { Chibi } from './Chibi.js'
import { defaultChibi } from './defaults.js'
import { hashChibi, layersFor } from './layers.js'
import type { BotChibi } from './types.js'

const SUBJECT = defaultChibi('ann')

describe('Chibi', () => {
  it('draws one img per layer, in ascending layer order', () => {
    const { container } = render(<Chibi subject={SUBJECT} />)
    const imgs = [...container.querySelectorAll('img')]
    const expected = layersFor(SUBJECT, 'neutral', 'full')
    expect(imgs).toHaveLength(expected.length)
    // DOM order matches ascending `order`…
    expect(imgs.map((img) => img.getAttribute('src'))).toEqual(expected.map((l) => `/avatar/${l.file}@1x.png`))
    // …and so does the inline z-index each layer carries, so overlap is correct even if DOM order ever changes.
    expect(imgs.map((img) => img.style.zIndex)).toEqual(expected.map((l) => String(l.order)))
  })

  it('gives every layer both densities in `srcset`, resolved against the asset base', () => {
    const { container } = render(
      <AvatarAssets base="https://cdn.example/avatar/">
        <Chibi subject={SUBJECT} />
      </AvatarAssets>,
    )
    const img = container.querySelector('img')!
    const file = layersFor(SUBJECT, 'neutral', 'full')[0]!.file
    expect(img.getAttribute('srcset')).toBe(
      `https://cdn.example/avatar/${file}@1x.png 1x, https://cdn.example/avatar/${file}@2x.png 2x`,
    )
    expect(img.getAttribute('src')).toBe(`https://cdn.example/avatar/${file}@1x.png`)
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).toHaveAttribute('decoding', 'async')
    expect(img).toHaveAttribute('alt', '')
    expect(img).toHaveAttribute('draggable', 'false')
  })

  it('falls back to /avatar/ with no provider in the tree', () => {
    const { container } = render(<Chibi subject={SUBJECT} />)
    expect(container.querySelector('img')!.getAttribute('src')).toMatch(/^\/avatar\//)
  })

  it('stamps a stable data-chibi-hash, and data-expression / data-frame from props', () => {
    const { container } = render(<Chibi subject={SUBJECT} expression="happy" frame="head" />)
    const root = container.firstElementChild!
    expect(root).toHaveAttribute('data-chibi-hash', hashChibi(SUBJECT))
    expect(root).toHaveAttribute('data-expression', 'happy')
    expect(root).toHaveAttribute('data-frame', 'head')
  })

  it('a bot gets its own hash and its own two-layer stack', () => {
    const bot: BotChibi = { kind: 'bot', index: 2 }
    const { container } = render(<Chibi subject={bot} expression="sleep" />)
    expect(container.querySelectorAll('img')).toHaveLength(2)
    expect(container.firstElementChild).toHaveAttribute('data-chibi-hash', hashChibi(bot))
  })

  it('the full frame draws the crop box at its native, un-cropped size', () => {
    const { container } = render(<Chibi subject={SUBJECT} frame="full" />)
    const crop = container.querySelector('[class*="crop"]') as HTMLElement
    expect(crop.style.left).toBe('')
    expect(crop.style.width).toBe('')
    expect(crop.style.transform).toBe('')
  })

  // The regression this guards: a `transform: translate(...) scale(...)` never magnifies the translate's own
  // offset (`scale`, being rightmost, applies to the point first), which left every `frame="head"` chibi showing
  // only its top-left quadrant. Plain left/top/width/height has no such ordering trap, and — unlike a transform
  // string — is asserted directly here rather than trusted by eye.
  it('at size=160 (the crops own native size), the head crop sits the un-cropped frame at (-112, -48), 384×448', () => {
    const { container } = render(<Chibi subject={SUBJECT} frame="head" size={160} />)
    const crop = container.querySelector('[class*="crop"]') as HTMLElement
    expect(crop.style.left).toBe('-112px')
    expect(crop.style.top).toBe('-48px')
    expect(crop.style.width).toBe('384px')
    expect(crop.style.height).toBe('448px')
  })

  it('the head crop geometry scales linearly with size — 40px is exactly a quarter of 160px', () => {
    const { container } = render(<Chibi subject={SUBJECT} frame="head" size={40} />)
    const crop = container.querySelector('[class*="crop"]') as HTMLElement
    expect(crop.style.left).toBe('-28px')
    expect(crop.style.top).toBe('-12px')
    expect(crop.style.width).toBe('96px')
    expect(crop.style.height).toBe('112px')
  })

  it('with no explicit size, the head crop falls back to the equivalent percentages of its container', () => {
    const { container } = render(<Chibi subject={SUBJECT} frame="head" />)
    const crop = container.querySelector('[class*="crop"]') as HTMLElement
    expect(crop.style.left).toBe('-70%')
    expect(crop.style.top).toBe('-30%')
    expect(crop.style.width).toBe('240%')
    expect(crop.style.height).toBe('280%')
  })

  it('is decorative with no label, and an announced role="img" with one', () => {
    const { container: bare } = render(<Chibi subject={SUBJECT} />)
    expect(bare.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(bare.firstElementChild).not.toHaveAttribute('role')

    const { container: labelled } = render(<Chibi subject={SUBJECT} label="Ann" />)
    expect(labelled.firstElementChild).toHaveAttribute('role', 'img')
    expect(labelled.firstElementChild).toHaveAttribute('aria-label', 'Ann')
    expect(labelled.firstElementChild).not.toHaveAttribute('aria-hidden')
  })

  it('applies the bounce class only when asked', () => {
    const { container: still } = render(<Chibi subject={SUBJECT} />)
    const { container: bouncing } = render(<Chibi subject={SUBJECT} bounce />)
    expect(bouncing.firstElementChild!.className).not.toBe(still.firstElementChild!.className)
  })
})
