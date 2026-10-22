import { useRef, useState, type CSSProperties } from 'react'
import { cx } from '../primitives/cx.js'
import { assetUrl, useAvatarAssetsBase } from './AvatarAssets.js'
import { useLoadedClip } from './clip.js'
import { hashChibi, layersFor } from './layers.js'
import { useInView } from './lazy.js'
import { useTintedLayer } from './tinted.js'
import type { ChibiFrame, ChibiSubject, Expression, LayerRef } from './types.js'
import s from './avatar2d.module.css'

/** D01 §5: the frame border is drawn 260×260 around the crop's centre, outside the 208×208 crop window itself —
 * it is meant to ring the round avatar, not sit inside it. Everything else on layer order 90 and below. */
const FRAME_BORDER_ORDER = 90

/**
 * A hair layer under a hat that clips the hair (2026-10-06): the hat's hair clip as the `<img>`'s CSS mask, stretched
 * over the whole frame the layer is — the clip is cut on that same frame — so the hair shows only where the clip is
 * opaque. Always the @2x clip: the mask is a few kilobytes at either density, and a 1x one would soften the edge on
 * a 2x screen. Masked rather than painted on a canvas, so a tinted layer's blob is drawn through it unchanged. Set only
 * once `useLoadedClip` has the clip in hand: until then, or if it never loads, the hair is drawn unclipped, not hidden.
 */
function clipMask(url: string): CSSProperties {
  const image = `url("${url}")`
  return { maskImage: image, WebkitMaskImage: image, maskSize: '100% 100%', WebkitMaskSize: '100% 100%', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' }
}

/**
 * One layer's `<img>`. A layer with `tints` (spec §5.2) asks `useTintedLayer` for its recoloured blob URL and
 * renders that — with no `srcSet`, since the hook already picked the screen's own density — the instant it is
 * ready; until then, and for a layer with no tints at all, it renders the plain two-density layer exactly as
 * before. Split out from `Chibi` itself because calling a hook inside `layers.map(...)` there would vary the
 * hook count across renders (equipping or removing an item changes how many layers there are).
 *
 * A tinted `<img>` the browser refuses to load — a page policy without `blob:` in `img-src` did exactly that
 * (No15, No16) — is never left broken: on `error` this layer remembers that URL as failed and draws the plain
 * layer instead, so the worst case is the untinted character, not a missing head. A *different* tinted URL (the
 * next colour) is a new attempt and is tried again.
 */
function ChibiLayer({
  base,
  layer,
  className,
  tintPriority,
  density,
}: {
  base: string
  layer: LayerRef
  className?: string
  tintPriority?: number
  /** `1` pins a small portrait to the @1x files, tinted and plain (Ruling 16); absent, the screen decides. */
  density?: 1
}) {
  const tinted = useTintedLayer(base, layer, tintPriority, density)
  const clip = useLoadedClip(layer.clip === undefined ? null : assetUrl(base, layer.clip, 2))
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const common = {
    className: cx(s.layer, className),
    style: clip === null ? { zIndex: layer.order } : { zIndex: layer.order, ...clipMask(clip) },
    loading: 'lazy' as const,
    decoding: 'async' as const,
    alt: '',
    draggable: false,
  }

  if (tinted !== null && tinted !== failedUrl) return <img {...common} src={tinted} onError={() => setFailedUrl(tinted)} />

  if (density === 1) return <img {...common} src={assetUrl(base, layer.file, 1)} />

  return <img {...common} src={assetUrl(base, layer.file, 1)} srcSet={`${assetUrl(base, layer.file, 1)} 1x, ${assetUrl(base, layer.file, 2)} 2x`} />
}

export interface ChibiProps {
  subject: ChibiSubject
  expression?: Expression
  frame?: ChibiFrame
  /** Fixed side length in px, set on the root (`flex: none` keeps a flex parent from shrinking it below this).
   * Omitted, the chibi fills its container's width instead (its usual mode: a seat disc, a lobby-bar avatar and
   * the playground's own grid all just size the wrapper). Either way the head crop is computed as a percentage
   * of the root's own box, not of `size` — so a caller that constrains the root further still (a narrow flex
   * column, an explicit `max-width`) gets a correct, if smaller, crop rather than a mis-aligned one. */
  size?: number
  /** Present, the chibi is an `img`-role element announced by this text; absent, it is decorative. */
  label?: string
  className?: string
  /** The 0.5 s turn bounce (spec 08 §3.4) — `PokerTable` sets this for the seat whose turn it is. */
  bounce?: boolean
  /** Plan 27 E1: draw nothing inside the root — no `<img>`, no tint render, no hat-clip preload — until the root comes
   * within 200 px of the viewport (`useInView`), then every layer as usual, for good. The root itself renders at once
   * with its size, frame and `data-chibi-hash`, so the placeholder holds the chibi's exact box and nothing jumps when
   * it fills in. Its tinted layers also queue behind every eager chibi's (`LAZY_TINT_PRIORITY`). For a grid of cards
   * (the wardrobe, the shop, saved outfits); the stage and a table seat stay eager. Off by default. */
  lazy?: boolean
}

/** How far a lazy chibi's tint renders sit below an eager one's in the tint queue. `useTintedLayer` ranks a layer at
 * `-order` (L10 the aura … L90 the frame: −10 … −90), so the body and the face start before the frame; a lazy chibi's
 * layers rank 100 lower still (−110 … −190), behind every layer of the stage or a seat, whatever its order. */
const LAZY_TINT_PRIORITY = -100

/** The head crop's side in the @1x art (the round 208×208 avatar crop): drawn no larger on screen, @1x is enough. */
const HEAD_CROP_PX = 208

/**
 * One chibi: every layer `layersFor` returns for this subject, expression and frame, stacked as absolutely
 * positioned `<img>`s inside a box that is either the full 6:7 frame or the round 208×208 avatar crop.
 *
 * Each layer ships at two densities; the browser picks. Lazy-loaded because a table can hold nine of these (up to
 * ~72 images) and only the ones on screen are worth fetching.
 */
export function Chibi({ subject, expression = 'neutral', frame = 'full', size, label, className, bounce = false, lazy = false }: ChibiProps) {
  const base = useAvatarAssetsBase()
  const rootRef = useRef<HTMLDivElement>(null)
  // Called unconditionally (hook order); with `lazy` off it observes nothing and reports `true`.
  const inView = useInView(rootRef, '200px', lazy)
  const layers = layersFor(subject, expression, frame)
  const hash = hashChibi(subject)
  // `full`'s 6:7 box only ever needs a width — its own `aspect-ratio` derives the height. `head` is square, so an
  // explicit height alongside the width is what a flex parent actually respects (a flex item's cross-size does
  // not fall out of `aspect-ratio` the way its own layout box does); either way this sets the root's *requested*
  // size, not the head crop's geometry, which is a fixed percentage of whatever the root ends up rendered at.
  const style: CSSProperties | undefined = size === undefined ? undefined : frame === 'head' ? { width: `${size}px`, height: `${size}px` } : { width: `${size}px` }

  // Ruling 16 (plan 27): a head whose crop covers no more than the art's own 208 px on this screen gains nothing from
  // the @2x files — a 72 px portrait on a 2× phone is 144 device px — and they are four times the bytes (a row of
  // portraits pulled ~440 KB @2x, 3.25 s on a 3G phone). It loads @1x, tinted and plain.
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const cheap = frame === 'head' && size !== undefined && size * dpr <= HEAD_CROP_PX

  const renderLayer = (layer: LayerRef, extraClassName?: string) => (
    <ChibiLayer
      key={layer.file}
      base={base}
      layer={layer}
      className={extraClassName}
      tintPriority={lazy ? LAZY_TINT_PRIORITY - layer.order : undefined}
      density={cheap ? 1 : undefined}
    />
  )

  const rootProps = {
    ref: rootRef,
    className: cx(s.chibi, frame === 'head' ? s.head : s.full, bounce && s.bounce, className),
    style,
    'data-chibi-hash': hash,
    'data-expression': expression,
    'data-frame': frame,
    role: label === undefined ? undefined : ('img' as const),
    'aria-label': label,
    'aria-hidden': label === undefined ? true : undefined,
  }

  // A lazy chibi not yet on screen: the root alone, holding its box. No `ChibiLayer` mounts, so no tint and no clip load.
  if (!inView) return <div {...rootProps} />

  if (frame === 'head') {
    // D01 §5: the 260×260 frame border rings the crop from *outside* it — inside the 208×208 crop window it is
    // meant to be empty (250 px clear). Clipping it with the rest of the layers would cut it off entirely, so it
    // draws unclipped, at the exact same `.headCrop` geometry as everything else, as a sibling of the clipped
    // stack rather than a member of it.
    const frameBorder = layers.find((l) => l.order === FRAME_BORDER_ORDER)
    const clipped = layers.filter((l) => l.order !== FRAME_BORDER_ORDER)

    return (
      <div {...rootProps}>
        <div className={s.clip}>
          <div className={cx(s.crop, s.headCrop)}>{clipped.map((layer) => renderLayer(layer))}</div>
        </div>
        {frameBorder === undefined ? null : renderLayer(frameBorder, s.headCrop)}
      </div>
    )
  }

  return (
    <div {...rootProps}>
      <div className={s.crop}>{layers.map((layer) => renderLayer(layer))}</div>
    </div>
  )
}
