import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AvatarAssets } from './AvatarAssets.js'
import AVATAR2D_CSS from './avatar2d.module.css?raw'
import { Chibi } from './Chibi.js'
import { defaultChibi } from './defaults.js'
import { hashChibi, layersFor } from './layers.js'
import type { BotChibi, ChibiConfig, WearRef } from './types.js'

const SUBJECT = defaultChibi('ann')
const FRAME_ITEM: WearRef = { id: 'frame_gold', order: 90, file: 'item_frame_gold_L90' }
const FRAMED_SUBJECT: ChibiConfig = { ...SUBJECT, frame: FRAME_ITEM }

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

  // D01 §5: the frame border (layer 90) is a 208×208 ring around the crop's centre — outside the 160×160 crop
  // window, so clipping it with the rest of the head-crop stack cuts it off entirely (the regression this guards:
  // the FRAME rows on the playground showed a plain head crop with no ring at all).
  it('draws the frame-border layer unclipped, outside the round crop box, with the same geometry as the clipped layers', () => {
    const { container } = render(<Chibi subject={FRAMED_SUBJECT} frame="head" size={160} />)
    const clip = container.querySelector('[class*="clip"]') as HTMLElement
    const clippedLayers = layersFor(FRAMED_SUBJECT, 'neutral', 'head').filter((l) => l.order !== 90)

    // Inside the clipped box: every layer except the frame border.
    expect([...clip.querySelectorAll('img')]).toHaveLength(clippedLayers.length)
    expect(clip.querySelector('img[src*="item_frame_gold_L90"]')).toBeNull()

    // The frame-border img exists, but is not a descendant of the clipped box…
    const frameImg = container.querySelector('img[src*="item_frame_gold_L90"]') as HTMLImageElement
    expect(frameImg).not.toBeNull()
    expect(clip.contains(frameImg)).toBe(false)

    // …and carries the exact same left/top/width/height as the clipped inner box, so it lines up with everything
    // else even though nothing is clipping it.
    const crop = clip.querySelector('[class*="crop"]') as HTMLElement
    expect(frameImg.style.left).toBe(crop.style.left)
    expect(frameImg.style.top).toBe(crop.style.top)
    expect(frameImg.style.width).toBe(crop.style.width)
    expect(frameImg.style.height).toBe(crop.style.height)
    expect(frameImg.style.left).toBe('-112px')
    expect(frameImg.style.width).toBe('384px')
  })

  it('drops the frame-border layer entirely in full frame — nothing left to un-clip', () => {
    const { container } = render(<Chibi subject={FRAMED_SUBJECT} frame="full" />)
    expect(container.querySelector('img[src*="item_frame_gold_L90"]')).toBeNull()
  })

  // The regression this guards: `global.css` sets `img, svg { max-width: 100% }` for ordinary responsive images.
  // `max-width` clamps whatever `width` a *replaced* element ends up with — inline or not, it is a separate
  // property, not something the cascade lets a same-property override win against — so at size=96 the overlay's
  // intended 230.4 px width was silently capped to its 96 px wrapper while its 268.8 px height stood uncapped: a
  // narrow, left-shifted sliver rather than a ring around the head. `.layer`'s own `max-width: none` (below) is
  // what stops that.
  it('at size=96, the frame-border overlay still gets its full un-clipped width and height, not the 96 px wrapper', () => {
    const { container } = render(<Chibi subject={FRAMED_SUBJECT} frame="head" size={96} />)
    const frameImg = container.querySelector('img[src*="item_frame_gold_L90"]') as HTMLImageElement
    const crop = container.querySelector('[class*="clip"] [class*="crop"]') as HTMLElement

    expect(crop.style.left).toBe('-67.2px')
    expect(crop.style.top).toBe('-28.8px')
    expect(crop.style.width).toBe('230.4px')
    expect(crop.style.height).toBe('268.8px')

    // Same geometry as the clipped box — a ring centred on, and slightly larger than, the 96 px head, not a
    // sliver clamped to it.
    expect(frameImg.style.left).toBe(crop.style.left)
    expect(frameImg.style.top).toBe(crop.style.top)
    expect(frameImg.style.width).toBe(crop.style.width)
    expect(frameImg.style.height).toBe(crop.style.height)

    // jsdom does not run layout, so this only ever proves the *value* a real browser would then apply — not that
    // the 230.4 px width survives layout. The CSS-source assertion below is the one that actually pins the fix.
    expect(getComputedStyle(frameImg).maxWidth).toBe('none')
    expect(getComputedStyle(frameImg).maxHeight).toBe('none')
  })

  it('the .layer rule — every stacked img, clipped or not — sets max-width/max-height: none, overriding the img/svg reset', () => {
    // Strip comments first: this file's own comment on `.layer` quotes `img, svg { max-width: 100% }` as an
    // example, and a naive "up to the next `}`" match would stop right there instead of at the rule's actual end.
    const withoutComments = AVATAR2D_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    const layerRule = withoutComments.match(/\.layer\s*\{[^}]*\}/)?.[0] ?? ''
    expect(layerRule).not.toBe('')
    expect(layerRule).toMatch(/max-width:\s*none/)
    expect(layerRule).toMatch(/max-height:\s*none/)
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
