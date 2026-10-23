import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AvatarAssets } from './AvatarAssets.js'
import AVATAR2D_CSS from './avatar2d.module.css?raw'
import s from './avatar2d.module.css'
import { Chibi } from './Chibi.js'
import { resetLoadedClips } from './clip.js'
import { defaultChibi } from './defaults.js'
import { hashChibi, layersFor } from './layers.js'
import { CHIBI_LIFE } from './life.js'
import type { BodyRef, BotChibi, ChibiConfig, ChibiReaction, HairRef, WearRef } from './types.js'

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

  it('the .chibi root opens its own stacking context, so its layers’ z-index never competes with the page around it', () => {
    // BP-29 (bug log §10 E4): the lobby head, scrolled under the sticky rail (z-index 20), drew its hat and frame over it.
    const withoutComments = AVATAR2D_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    const rootRule = withoutComments.match(/\.chibi\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rootRule).not.toBe('')
    expect(rootRule).toMatch(/isolation:\s*isolate/)
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

/**
 * BP-30 P1: the markup a chibi rendered before it learned to live, pinned on the untouched component. Every place that
 * leaves `live` unset (the table, the PlayerBar, seats, cards, portraits, GM screens) must keep producing exactly this,
 * so the snapshot is never updated to make a change pass. Hashed class names are mapped back to their source names
 * through the imported module object, so the snapshot does not depend on the hash.
 */
describe('live off renders the same markup as before', () => {
  const sourceName = new Map(Object.entries(s as Record<string, string>).map(([name, hashed]) => [hashed, name]))
  const serialise = (root: Element): string => {
    const copy = root.cloneNode(true) as Element
    for (const el of [copy, ...copy.querySelectorAll('[class]')]) {
      const names = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
      el.setAttribute('class', names.map((name) => sourceName.get(name) ?? name).join(' '))
    }
    return copy.outerHTML.replace(/></g, '>\n<')
  }

  /** An observer that never reports anything: a lazy chibi under it stays off screen. */
  class SilentObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }

  beforeEach(() => resetLoadedClips())
  afterEach(() => vi.unstubAllGlobals())

  it('a 72 px head-frame human with tints, a hair-clipping hat and a frame item', () => {
    const subject: ChibiConfig = {
      ...SUBJECT,
      body: { ...SUBJECT.body, tint: { skin: { meanL: 0.78, files: [SUBJECT.body.body, SUBJECT.body.faces.neutral] }, eyes: { meanL: 0.3, files: [SUBJECT.body.faces.neutral] } } },
      hair: { ...SUBJECT.hair, tint: { meanL: 0.4, files: [SUBJECT.hair.back, SUBJECT.hair.front] } },
      head: { id: 'head_snapshot_hat', order: 80, file: 'item_head_snapshot_hat_L80', clipsHair: true },
      frame: FRAME_ITEM,
      skinColor: '#5c3a28',
      eyeColor: '#2f7fd6',
      hairColor: '#b3261e',
    }
    const { container } = render(<Chibi subject={subject} frame="head" size={72} label="Ann" />)
    expect(serialise(container.firstElementChild!)).toMatchInlineSnapshot(`
      "<div class="chibi head" style="width: 72px; height: 72px;" data-chibi-hash="bf1a7dac" data-expression="neutral" data-frame="head" role="img" aria-label="Ann">
      <div class="clip">
      <div class="crop headCrop">
      <img class="layer" style="z-index: 20;" loading="lazy" decoding="async" alt="" draggable="false" src="/avatar/item_hair_f_bob01_L20@1x.png">
      <img class="layer" style="z-index: 30;" loading="lazy" decoding="async" alt="" draggable="false" src="/avatar/body_f_L30@1x.png">
      <img class="layer" style="z-index: 40;" loading="lazy" decoding="async" alt="" draggable="false" src="/avatar/item_outfit_casual01_L40@1x.png">
      <img class="layer" style="z-index: 50;" loading="lazy" decoding="async" alt="" draggable="false" src="/avatar/body_f_face_neutral_L50@1x.png">
      <img class="layer" style="z-index: 60;" loading="lazy" decoding="async" alt="" draggable="false" src="/avatar/item_hair_f_bob01_L60@1x.png">
      <img class="layer" style="z-index: 80;" loading="lazy" decoding="async" alt="" draggable="false" src="/avatar/item_head_snapshot_hat_L80@1x.png">
      </div>
      </div>
      <img class="layer headCrop" style="z-index: 90;" loading="lazy" decoding="async" alt="" draggable="false" src="/avatar/item_frame_gold_L90@1x.png">
      </div>"
    `)
  })

  it('a full-frame human with an aura', () => {
    const subject: ChibiConfig = { ...SUBJECT, aura: { id: 'aura_snapshot', order: 10, file: 'item_aura_snapshot_L10' } }
    const { container } = render(<Chibi subject={subject} size={290} className="stage-figure" />)
    expect(serialise(container.firstElementChild!)).toMatchInlineSnapshot(`
      "<div class="chibi full stage-figure" style="width: 290px;" data-chibi-hash="dc14c25e" data-expression="neutral" data-frame="full" aria-hidden="true">
      <div class="crop">
      <img class="layer" style="z-index: 10;" loading="lazy" decoding="async" alt="" draggable="false" src="/avatar/item_aura_snapshot_L10@1x.png" srcset="/avatar/item_aura_snapshot_L10@1x.png 1x, /avatar/item_aura_snapshot_L10@2x.png 2x">
      <img class="layer" style="z-index: 20;" loading="lazy" decoding="async" alt="" draggable="false" src="/avatar/item_hair_f_bob01_L20@1x.png" srcset="/avatar/item_hair_f_bob01_L20@1x.png 1x, /avatar/item_hair_f_bob01_L20@2x.png 2x">
      <img class="layer" style="z-index: 30;" loading="lazy" decoding="async" alt="" draggable="false" src="/avatar/body_f_L30@1x.png" srcset="/avatar/body_f_L30@1x.png 1x, /avatar/body_f_L30@2x.png 2x">
      <img class="layer" style="z-index: 40;" loading="lazy" decoding="async" alt="" draggable="false" src="/avatar/item_outfit_casual01_L40@1x.png" srcset="/avatar/item_outfit_casual01_L40@1x.png 1x, /avatar/item_outfit_casual01_L40@2x.png 2x">
      <img class="layer" style="z-index: 50;" loading="lazy" decoding="async" alt="" draggable="false" src="/avatar/body_f_face_neutral_L50@1x.png" srcset="/avatar/body_f_face_neutral_L50@1x.png 1x, /avatar/body_f_face_neutral_L50@2x.png 2x">
      <img class="layer" style="z-index: 60;" loading="lazy" decoding="async" alt="" draggable="false" src="/avatar/item_hair_f_bob01_L60@1x.png" srcset="/avatar/item_hair_f_bob01_L60@1x.png 1x, /avatar/item_hair_f_bob01_L60@2x.png 2x">
      </div>
      </div>"
    `)
  })

  it('a bot', () => {
    const { container } = render(<Chibi subject={{ kind: 'bot', index: 3 }} expression="happy" frame="head" bounce label="Bot" />)
    expect(serialise(container.firstElementChild!)).toMatchInlineSnapshot(`
      "<div class="chibi head bounce" data-chibi-hash="d3fcf82d" data-expression="happy" data-frame="head" role="img" aria-label="Bot">
      <div class="clip">
      <div class="crop headCrop">
      <img class="layer" style="z-index: 30;" loading="lazy" decoding="async" alt="" draggable="false" src="/avatar/bot_3_L30@1x.png" srcset="/avatar/bot_3_L30@1x.png 1x, /avatar/bot_3_L30@2x.png 2x">
      <img class="layer" style="z-index: 50;" loading="lazy" decoding="async" alt="" draggable="false" src="/avatar/bot_3_face_happy_L50@1x.png" srcset="/avatar/bot_3_face_happy_L50@1x.png 1x, /avatar/bot_3_face_happy_L50@2x.png 2x">
      </div>
      </div>
      </div>"
    `)
  })

  it('a lazy chibi not yet in view', () => {
    vi.stubGlobal('IntersectionObserver', SilentObserver)
    const { container } = render(<Chibi subject={SUBJECT} size={96} lazy />)
    expect(serialise(container.firstElementChild!)).toMatchInlineSnapshot(`
      "<div class="chibi full" style="width: 96px;" data-chibi-hash="c1598b6e" data-expression="neutral" data-frame="full" aria-hidden="true">
      </div>"
    `)
  })
})

/** BP-30: a live chibi — three faces mounted, switched by opacity; the root carries the life state as data attributes. */
describe('Chibi live', () => {
  const FACE = SUBJECT.body.faces
  const faceImgs = (root: ParentNode) => [...root.querySelectorAll<HTMLImageElement>('img[data-face-layer]')]
  const faceOf = (img: HTMLImageElement) => img.getAttribute('data-face-layer')
  const shownFaces = (root: ParentNode) => faceImgs(root).filter((img) => !img.hasAttribute('data-face-hidden'))
  const classes = (el: Element) => el.className.split(/\s+/)
  const LIFE_CLASSES = [s.breathe, s.hop, s.tilt, s.spin]
  /** jsdom never loads an image: tell every face layer it has (the base first, which mounts the other two). */
  const loadFaces = (root: ParentNode) => {
    for (const img of faceImgs(root)) fireEvent.load(img)
    for (const img of faceImgs(root)) fireEvent.load(img)
  }

  class CountingObserver {
    static made = 0
    constructor() {
      CountingObserver.made++
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }

  function stubReducedMotion(reduce: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion: reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }))
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('live idle mounts the base, closed and happy faces once each, base first, and shows only data-face', () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { container } = render(<Chibi subject={SUBJECT} live="idle" />)
    const root = container.firstElementChild as HTMLElement
    loadFaces(container)

    const faces = faceImgs(container)
    expect(faces.map(faceOf)).toEqual(['neutral', 'closed', 'happy'])
    expect(faces.map((img) => img.getAttribute('src'))).toEqual([FACE.neutral, FACE.closed, FACE.happy].map((f) => `/avatar/${f}@1x.png`))
    expect(faces.map((img) => img.style.zIndex)).toEqual(['50', '50', '50'])
    // Right after the base face in the stack, before the front hair.
    const all = [...container.querySelectorAll('img')]
    expect(all.indexOf(faces[2]!) + 1).toBe(all.findIndex((img) => img.style.zIndex === '60'))
    // Every other layer once.
    expect(all).toHaveLength(layersFor(SUBJECT, 'neutral', 'full').length + 2)

    expect(root).toHaveAttribute('data-live', 'idle')
    expect(root).toHaveAttribute('data-face', 'base')
    expect(root).toHaveAttribute('data-expression', 'neutral')
    expect(root).toHaveAttribute('data-breathing', 'true')
    expect(root).toHaveAttribute('data-motion', 'none')
    expect(root).not.toHaveAttribute('data-reacting')
    expect(classes(root)).toContain(s.breathe)
    expect(shownFaces(container).map(faceOf)).toEqual(['neutral'])
    for (const img of faces.slice(1)) expect(classes(img)).toContain(s.faceHidden)

    // A blink: only the closed face shows, for 120 ms.
    act(() => vi.advanceTimersByTime(CHIBI_LIFE.blinkMinGapMs))
    expect(root).toHaveAttribute('data-face', 'closed')
    expect(shownFaces(container).map(faceOf)).toEqual(['closed'])
    act(() => vi.advanceTimersByTime(CHIBI_LIFE.blinkMs))
    expect(root).toHaveAttribute('data-face', 'base')
    expect(shownFaces(container).map(faceOf)).toEqual(['neutral'])
  })

  it('a base expression of happy or closed is not mounted twice', () => {
    const { container } = render(<Chibi subject={SUBJECT} expression="happy" live="idle" />)
    loadFaces(container)
    expect(faceImgs(container).map(faceOf)).toEqual(['happy', 'closed'])
  })

  it('extras mount only after the base face is ready', () => {
    const { container } = render(<Chibi subject={SUBJECT} live="idle" />)
    expect(faceImgs(container).map(faceOf)).toEqual(['neutral'])
    fireEvent.load(faceImgs(container)[0]!)
    expect(faceImgs(container).map(faceOf)).toEqual(['neutral', 'closed', 'happy'])
  })

  it('onFacesReady fires once every face loaded', () => {
    const onFacesReady = vi.fn()
    const { container, rerender } = render(<Chibi subject={SUBJECT} live="idle" onFacesReady={onFacesReady} />)
    fireEvent.load(faceImgs(container)[0]!)
    expect(onFacesReady).not.toHaveBeenCalled()
    const [, closed, happy] = faceImgs(container)
    fireEvent.load(closed!)
    expect(onFacesReady).not.toHaveBeenCalled()
    fireEvent.load(happy!)
    expect(onFacesReady).toHaveBeenCalledTimes(1)
    rerender(<Chibi subject={SUBJECT} live="idle" onFacesReady={onFacesReady} />)
    fireEvent.load(happy!)
    expect(onFacesReady).toHaveBeenCalledTimes(1)
  })

  it('a face that fails to load still counts as settled', () => {
    const onFacesReady = vi.fn()
    const { container } = render(<Chibi subject={SUBJECT} live="idle" onFacesReady={onFacesReady} />)
    fireEvent.error(faceImgs(container)[0]!)
    for (const img of faceImgs(container).slice(1)) fireEvent.error(img)
    expect(onFacesReady).toHaveBeenCalledTimes(1)
  })

  it('a cheer shows the happy face only once the faces are ready', () => {
    const cheer = (key: number): ChibiReaction => ({ kind: 'cheer', key })
    const { container, rerender } = render(<Chibi subject={SUBJECT} live="idle" react={null} />)
    const root = container.firstElementChild as HTMLElement
    rerender(<Chibi subject={SUBJECT} live="idle" react={cheer(1)} />)
    expect(root).toHaveAttribute('data-face', 'base')
    expect(root).toHaveAttribute('data-reacting', 'cheer')
    loadFaces(container)
    rerender(<Chibi subject={SUBJECT} live="idle" react={cheer(2)} />)
    expect(root).toHaveAttribute('data-face', 'happy')
    expect(root).toHaveAttribute('data-motion', 'hop')
    expect(root).toHaveAttribute('data-breathing', 'false')
    expect(classes(root)).toContain(s.hop)
    expect(classes(root)).not.toContain(s.breathe)
    expect(shownFaces(container).map(faceOf)).toEqual(['happy'])
  })

  it('facing left flips the root', () => {
    const { container, rerender } = render(<Chibi subject={SUBJECT} live="idle" facing="left" />)
    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveAttribute('data-facing', 'left')
    expect(getComputedStyle(root).transform).toBe('scaleX(-1)')
    // Mounted turned: no spin.
    expect(root).toHaveAttribute('data-motion', 'none')

    rerender(<Chibi subject={SUBJECT} live="idle" facing="right" />)
    expect(root).toHaveAttribute('data-facing', 'right')
    expect(root).toHaveAttribute('data-motion', 'spin')
    expect(root).toHaveAttribute('data-reacting', 'spin')
    expect(classes(root)).toContain(s.spin)
    expect(getComputedStyle(root).transform).not.toBe('scaleX(-1)')
  })

  it('the turn starts in the task that flips the facing, so no mirrored frame is painted before the spin', async () => {
    // Outside `act`, as a browser runs it: a passive effect would set the spin in a later task, after a paint could show
    // the new facing's mirrored frame; a layout effect sets it before the browser gets the chance. React's scheduler
    // runs the passive effects in the same task only while it has frame time left, so the clock is made to run out
    // (6 ms a reading: the scheduler yields after 5 ms, and nothing here comes near a task's 5 s expiry).
    const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const before = actEnv.IS_REACT_ACT_ENVIRONMENT
    actEnv.IS_REACT_ACT_ENVIRONMENT = false
    const host = document.body.appendChild(document.createElement('div'))
    const reactRoot = createRoot(host)
    try {
      flushSync(() => reactRoot.render(<Chibi subject={SUBJECT} live="idle" facing="left" />))
      const root = host.firstElementChild as HTMLElement
      expect(root).toHaveAttribute('data-motion', 'none')
      // A MutationObserver callback is a microtask: it runs right after the task that committed the new facing.
      const motionWhenFlipped = new Promise<string | null>((resolve) => {
        const observer = new MutationObserver(() => {
          observer.disconnect()
          resolve(root.getAttribute('data-motion'))
        })
        observer.observe(root, { attributes: true, attributeFilter: ['data-facing'] })
      })
      let clock = performance.now()
      vi.spyOn(performance, 'now').mockImplementation(() => (clock += 6))
      reactRoot.render(<Chibi subject={SUBJECT} live="idle" facing="right" />)
      expect(await motionWhenFlipped).toBe('spin')
    } finally {
      reactRoot.unmount()
      host.remove()
      actEnv.IS_REACT_ACT_ENVIRONMENT = before
    }
  })

  it('live idle watches the screen; still mode: no observer, no breathing, reacts to react', () => {
    vi.stubGlobal('IntersectionObserver', CountingObserver)
    CountingObserver.made = 0
    const idle = render(<Chibi subject={SUBJECT} live="idle" />)
    expect(CountingObserver.made).toBe(1)
    idle.unmount()

    CountingObserver.made = 0
    const { container, rerender } = render(<Chibi subject={SUBJECT} live="still" react={null} />)
    const root = container.firstElementChild as HTMLElement
    expect(CountingObserver.made).toBe(0)
    expect(root).toHaveAttribute('data-live', 'still')
    expect(root).toHaveAttribute('data-breathing', 'false')
    expect(classes(root)).not.toContain(s.breathe)
    loadFaces(container)
    // A still figure never blinks, so it mounts no shut-eyes face: only the reaction's.
    expect(faceImgs(container).map(faceOf)).toEqual(['neutral', 'happy'])

    rerender(<Chibi subject={SUBJECT} live="still" react={{ kind: 'cheer', key: 1 }} />)
    expect(root).toHaveAttribute('data-reacting', 'cheer')
    expect(root).toHaveAttribute('data-face', 'happy')
    expect(classes(root)).toContain(s.hop)
  })

  it('reduce: no animation class, face stays base', () => {
    stubReducedMotion(true)
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { container, rerender } = render(<Chibi subject={SUBJECT} live="idle" react={null} />)
    const root = container.firstElementChild as HTMLElement
    loadFaces(container)
    rerender(<Chibi subject={SUBJECT} live="idle" react={{ kind: 'cheer', key: 1 }} />)
    rerender(<Chibi subject={SUBJECT} live="idle" react={{ kind: 'wave', key: 2 }} facing="left" />)
    act(() => vi.advanceTimersByTime(10_000))

    expect(root).toHaveAttribute('data-face', 'base')
    expect(root).toHaveAttribute('data-motion', 'none')
    expect(root).toHaveAttribute('data-breathing', 'false')
    expect(root).not.toHaveAttribute('data-reacting')
    // The turn itself still lands, at once.
    expect(root).toHaveAttribute('data-facing', 'left')
    for (const name of LIFE_CLASSES) expect(classes(root)).not.toContain(name)
    expect(shownFaces(container).map(faceOf)).toEqual(['neutral'])
  })

  it('the life styles: every animation stops under reduced motion, the origin only on a live root, no will-change', () => {
    const css = AVATAR2D_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const name of ['chibiBreathe', 'chibiHop', 'chibiTilt', 'chibiSpinLeft', 'chibiSpinRight']) expect(css).toContain(`@keyframes ${name}`)
    const reduce = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n')
    for (const name of ['.breathe', '.hop', '.tilt', '.spin']) expect(reduce).toContain(name)
    expect(reduce).toMatch(/animation:\s*none/)
    expect(css).toMatch(/\.chibi\[data-live\]\s*\{[^}]*transform-origin:\s*50% 100%/)
    expect(css.match(/\.chibi\s*\{[^}]*\}/)?.[0]).not.toContain('transform-origin')
    expect(css).not.toContain('will-change')
    expect(css).toMatch(/\.faceHidden\s*\{\s*opacity:\s*0;?\s*\}/)
    expect(css).toMatch(/translate:\s*0 var\(--chibi-hop, -6%\)/)
  })

  it('the life styles use CHIBI_LIFE’s timings and the spec’s amplitudes (K6 §3.1)', () => {
    const css = AVATAR2D_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    const rule = (selector: string) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.[\]']/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
    const keyframes = (name: string) => css.match(new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ''
    expect(rule('.breathe')).toMatch(new RegExp(`animation:\\s*chibiBreathe\\s+${CHIBI_LIFE.breatheMs}ms\\b`))
    expect(keyframes('chibiBreathe')).toMatch(/scale:\s*1\.015\s*;/)
    expect(rule('.hop')).toMatch(new RegExp(`animation:\\s*chibiHop\\s+${CHIBI_LIFE.hopMs}ms\\b`))
    expect(rule('.tilt')).toMatch(new RegExp(`animation:\\s*chibiTilt\\s+${CHIBI_LIFE.tiltMs}ms\\b`))
    expect(keyframes('chibiTilt')).toMatch(/rotate:\s*-4deg\s*;/)
    expect(rule('.spin')).toMatch(new RegExp(`animation:\\s*chibiSpinRight\\s+${CHIBI_LIFE.spinMs}ms\\b`))
    // The other facing swaps only the name, so it keeps the duration.
    expect(rule(".spin[data-facing='left']")).toMatch(/^\s*animation-name:\s*chibiSpinLeft;\s*$/)
    expect(keyframes('chibiSpinLeft')).toMatch(/transform:\s*scaleX\(0\.06\)\s*;/)
    expect(keyframes('chibiSpinRight')).toMatch(/transform:\s*scaleX\(-0\.06\)\s*;/)
  })

  it('live off draws one face and no life attribute', () => {
    const { container } = render(<Chibi subject={SUBJECT} live="off" react={{ kind: 'cheer', key: 1 }} facing="left" />)
    const root = container.firstElementChild as HTMLElement
    expect(faceImgs(container)).toHaveLength(0)
    for (const name of ['data-live', 'data-face', 'data-facing', 'data-reacting', 'data-breathing', 'data-motion']) expect(root).not.toHaveAttribute(name)
  })
})
