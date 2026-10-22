import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AvatarAssets } from './AvatarAssets.js'
import AVATAR2D_CSS from './avatar2d.module.css?raw'
import { Chibi } from './Chibi.js'
import { resetLoadedClips } from './clip.js'
import { defaultChibi } from './defaults.js'
import { hashChibi, layersFor } from './layers.js'
import type { BodyRef, BotChibi, ChibiConfig, HairRef, WearRef } from './types.js'

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

  describe('a small portrait loads @1x only (Ruling 16: a 72 px head pulled ~440 KB @2x on a phone)', () => {
    let saved: PropertyDescriptor | undefined
    beforeEach(() => {
      saved = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 })
    })
    afterEach(() => {
      if (saved === undefined) delete (window as { devicePixelRatio?: number }).devicePixelRatio
      else Object.defineProperty(window, 'devicePixelRatio', saved)
    })

    it('a head of 72 px on a 2× screen (144 device px, under the crop’s 208) draws every plain layer @1x with no `srcset`', () => {
      const { container } = render(<Chibi subject={SUBJECT} frame="head" size={72} />)
      const imgs = [...container.querySelectorAll('img')]
      expect(imgs.length).toBeGreaterThan(0)
      for (const img of imgs) {
        expect(img).not.toHaveAttribute('srcset')
        expect(img.getAttribute('src')).toMatch(/@1x\.png$/)
      }
    })

    it('a head of 120 px on a 2× screen (240 device px) keeps both densities', () => {
      const { container } = render(<Chibi subject={SUBJECT} frame="head" size={120} />)
      for (const img of container.querySelectorAll('img')) expect(img.getAttribute('srcset')).toMatch(/@2x\.png 2x$/)
    })

    it('a head with no fixed size, and a small full figure, keep both densities', () => {
      const head = render(<Chibi subject={SUBJECT} frame="head" />)
      for (const img of head.container.querySelectorAll('img')) expect(img.getAttribute('srcset')).toMatch(/@2x\.png 2x$/)
      head.unmount()
      const full = render(<Chibi subject={SUBJECT} size={72} />)
      for (const img of full.container.querySelectorAll('img')) expect(img.getAttribute('srcset')).toMatch(/@2x\.png 2x$/)
    })
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

  // The regression this guards, across two rounds: a `transform: translate(...) scale(...)` never magnifies the
  // translate's own offset (round 1); then a *fixed-pixel* geometry computed once from the `size` prop kept
  // describing a box that size no longer was, the moment anything external (a flex parent, a `max-width`)
  // rendered the root smaller than `size` asked for (round 4 — a profile page 192 px chibi squeezed to 114 px by
  // a narrow flex column showed the hairline and one cheek instead of the head). Both are why the geometry below
  // is a *static, size-independent percentage* of the root's own box (88/208, 40/208, 384/208, 448/208) rather
  // than anything computed per render: it is correct for whatever the root turns out to be, not just for the
  // `size` it was asked to be.
  it.each([undefined, 40, 96, 160, 512])('the head crop is -42.3077%%/-19.2308%%/184.6154%%/215.3846%% of the root box regardless of size=%s', (size) => {
    const { container } = render(<Chibi subject={SUBJECT} frame="head" size={size} />)
    const crop = container.querySelector('[class*="crop"]') as HTMLElement
    const computed = getComputedStyle(crop)
    expect(computed.left).toBe('-42.3077%')
    expect(computed.top).toBe('-19.2308%')
    expect(computed.width).toBe('184.6154%')
    expect(computed.height).toBe('215.3846%')
    // Not inline, either: a static class rule, so nothing here is computed from `size` at all.
    expect(crop.style.left).toBe('')
    expect(crop.style.width).toBe('')
  })

  it('sets the root to size×size px and flex: none, so a flex parent does not shrink it below that on its own', () => {
    const { container } = render(<Chibi subject={SUBJECT} frame="head" size={192} />)
    const root = container.firstElementChild as HTMLElement
    const computed = getComputedStyle(root)
    expect(computed.width).toBe('192px')
    expect(computed.height).toBe('192px')
    // `flex: none` == `flex: 0 0 auto` — `flex-shrink: 0` is the half of that which actually matters here.
    expect(computed.flexShrink).toBe('0')
    expect(computed.flexGrow).toBe('0')
  })

  it('full frame only sets a width — its own aspect-ratio derives the 6:7 height, not a forced square', () => {
    const { container } = render(<Chibi subject={SUBJECT} frame="full" size={180} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.width).toBe('180px')
    expect(root.style.height).toBe('')
  })

  // D01 §5: the frame border (layer 90) is a 260×260 ring around the crop's centre — outside the 208×208 crop
  // window, so clipping it with the rest of the head-crop stack cuts it off entirely (the regression this guards:
  // the FRAME rows on the playground showed a plain head crop with no ring at all).
  it.each([undefined, 96, 160])('draws the frame-border layer unclipped, outside the round crop box, with the same geometry as the clipped layers (size=%s)', (size) => {
    const { container } = render(<Chibi subject={FRAMED_SUBJECT} frame="head" size={size} />)
    const clip = container.querySelector('[class*="clip"]') as HTMLElement
    const clippedLayers = layersFor(FRAMED_SUBJECT, 'neutral', 'head').filter((l) => l.order !== 90)

    // Inside the clipped box: every layer except the frame border.
    expect([...clip.querySelectorAll('img')]).toHaveLength(clippedLayers.length)
    expect(clip.querySelector('img[src*="item_frame_gold_L90"]')).toBeNull()

    // The frame-border img exists, but is not a descendant of the clipped box…
    const frameImg = container.querySelector('img[src*="item_frame_gold_L90"]') as HTMLImageElement
    expect(frameImg).not.toBeNull()
    expect(clip.contains(frameImg)).toBe(false)

    // …and computes to the exact same left/top/width/height as the clipped inner box — both from the same
    // `.headCrop` class, so they line up regardless of `size`, even though nothing is clipping the overlay.
    const crop = clip.querySelector('[class*="crop"]') as HTMLElement
    const cropStyle = getComputedStyle(crop)
    const frameStyle = getComputedStyle(frameImg)
    expect(frameStyle.left).toBe(cropStyle.left)
    expect(frameStyle.top).toBe(cropStyle.top)
    expect(frameStyle.width).toBe(cropStyle.width)
    expect(frameStyle.height).toBe(cropStyle.height)
    expect(frameStyle.left).toBe('-42.3077%')
    expect(frameStyle.width).toBe('184.6154%')
  })

  it('drops the frame-border layer entirely in full frame — nothing left to un-clip', () => {
    const { container } = render(<Chibi subject={FRAMED_SUBJECT} frame="full" />)
    expect(container.querySelector('img[src*="item_frame_gold_L90"]')).toBeNull()
  })

  // The regression this guards: `global.css` sets `img, svg { max-width: 100% }` for ordinary responsive images.
  // `max-width` clamps whatever `width` a *replaced* element ends up with — inline or not, it is a separate
  // property, not something the cascade lets a same-property override win against. `.layer`'s own
  // `max-width: none` (asserted below via the CSS source, since jsdom does no layout to clamp) is what stops
  // that from ever mattering, on top of the crop now being percentage-based rather than a fixed pixel figure a
  // percentage cap could still have clashed with.
  it('the frame-border overlay is exempt from the img/svg max-width/max-height reset', () => {
    const { container } = render(<Chibi subject={FRAMED_SUBJECT} frame="head" size={96} />)
    const frameImg = container.querySelector('img[src*="item_frame_gold_L90"]') as HTMLImageElement
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

  describe('a hat that clips the hair (2026-10-06)', () => {
    const conical: WearRef = { id: 'head_conical_hat01', order: 80, file: 'item_head_conical_hat01_L80', clipsHair: true }
    const CLIP = 'https://cdn.example/avatar/item_head_conical_hat01_L80_hairclipmask@2x.png'
    const styleOf = (img: Element) => (img as HTMLImageElement).style as CSSStyleDeclaration & Record<string, string>
    const hairImgs = (root: Element) => [...root.querySelectorAll('img')].filter((img) => ['20', '60'].includes((img as HTMLImageElement).style.zIndex))
    const otherImgs = (root: Element) => [...root.querySelectorAll('img')].filter((img) => !['20', '60'].includes((img as HTMLImageElement).style.zIndex))
    const drawn = (subject: ChibiConfig = { ...SUBJECT, head: conical }) =>
      render(
        <AvatarAssets base="https://cdn.example/avatar/">
          <Chibi subject={subject} />
        </AvatarAssets>,
      ).container

    /** jsdom loads no image: this one settles a tick after its `src` is set — failing for a URL with `missing` in it. */
    let made: { crossOrigin: string | null; src: string }[] = []
    class FakeImage {
      crossOrigin: string | null = null
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      private url = ''
      constructor() {
        made.push(this)
      }
      get src(): string {
        return this.url
      }
      set src(url: string) {
        this.url = url
        setTimeout(() => (url.includes('missing') ? this.onerror?.() : this.onload?.()), 0)
      }
    }
    beforeEach(() => {
      made = []
      resetLoadedClips()
      vi.stubGlobal('Image', FakeImage)
    })
    afterEach(() => vi.unstubAllGlobals())

    it('draws both hair layers through its @2x clip as a CSS mask over the frame once the clip has loaded, and no other layer', async () => {
      const root = drawn()
      // Loading: the hair is drawn as it is — a mask still loading would draw it as nothing.
      expect(hairImgs(root)).toHaveLength(2)
      for (const img of root.querySelectorAll('img')) expect(styleOf(img).maskImage ?? '').toBe('')
      expect(made.map((img) => [img.src, img.crossOrigin])).toEqual([[CLIP, 'anonymous']])

      const url = `url("${CLIP}")`
      await waitFor(() => expect(styleOf(hairImgs(root)[0]!).maskImage).toBe(url))
      for (const img of hairImgs(root)) {
        const style = styleOf(img)
        expect(style.maskImage).toBe(url)
        expect(style.WebkitMaskImage ?? style.webkitMaskImage).toBe(url)
        expect(style.maskSize).toBe('100% 100%')
        expect(style.maskRepeat).toBe('no-repeat')
      }
      for (const img of otherImgs(root)) expect(styleOf(img).maskImage ?? '').toBe('')

      // A chibi drawn later is masked from its first render, with no second load.
      const later = drawn()
      for (const img of hairImgs(later)) expect(styleOf(img).maskImage).toBe(url)
      expect(made).toHaveLength(1)
    })

    it('leaves the hair drawn and unmasked when the clip fails to load, and tries again on the next mount', async () => {
      const missing: WearRef = { ...conical, file: 'item_head_missing_L80' }
      const root = drawn({ ...SUBJECT, head: missing })
      await waitFor(() => expect(made).toHaveLength(1))
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(hairImgs(root)).toHaveLength(2)
      for (const img of root.querySelectorAll('img')) expect(styleOf(img).maskImage ?? '').toBe('')
      drawn({ ...SUBJECT, head: missing })
      expect(made).toHaveLength(2)
    })

    it('masks nothing under a hat that does not clip', async () => {
      const root = drawn({ ...SUBJECT, head: { ...conical, clipsHair: undefined } })
      await new Promise((resolve) => setTimeout(resolve, 10))
      for (const img of root.querySelectorAll('img')) expect(styleOf(img).maskImage ?? '').toBe('')
      expect(made).toHaveLength(0)
    })
  })

  it('a tinted layer renders the plain layer src while no tinted URL exists yet (no canvas in jsdom)', () => {
    const tintedBody: BodyRef = { ...SUBJECT.body, tint: { skin: { meanL: 0.78, files: [SUBJECT.body.body] } } }
    const tintedHair: HairRef = { ...SUBJECT.hair, tint: { meanL: 0.4, files: [SUBJECT.hair.front] } }
    const subject: ChibiConfig = { ...SUBJECT, body: tintedBody, hair: tintedHair, skinColor: '#5c3a28', hairColor: '#b3261e' }
    const layers = layersFor(subject, 'neutral', 'full')
    const bodyLayer = layers.find((l) => l.order === 30)!
    const hairLayer = layers.find((l) => l.order === 60)!
    expect(bodyLayer.tints).toEqual([{ mask: `${SUBJECT.body.body}_skinmask`, colour: '#5c3a28', meanL: 0.78 }])
    expect(hairLayer.tints).toEqual([{ mask: `${SUBJECT.hair.front}_hairmask`, colour: '#b3261e', meanL: 0.4 }])

    const { container } = render(<Chibi subject={subject} />)
    for (const layer of [bodyLayer, hairLayer]) {
      const img = [...container.querySelectorAll('img')].find((el) => el.getAttribute('src')?.includes(layer.file))
      expect(img, layer.file).not.toBeUndefined()
      expect(img!.getAttribute('src')).toBe(`/avatar/${layer.file}@1x.png`)
    }
  })
})
