import type { CSSProperties } from 'react'
import { cx } from '../primitives/cx.js'
import { assetUrl, useAvatarAssetsBase } from './AvatarAssets.js'
import { hashChibi, layersFor } from './layers.js'
import type { ChibiFrame, ChibiSubject, Expression, LayerRef } from './types.js'
import s from './avatar2d.module.css'

/** D01 §5: the frame border is drawn 208×208 around the crop's centre, outside the 160×160 crop window itself —
 * it is meant to ring the round avatar, not sit inside it. Everything else on layer order 90 and below. */
const FRAME_BORDER_ORDER = 90

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
}

/**
 * One chibi: every layer `layersFor` returns for this subject, expression and frame, stacked as absolutely
 * positioned `<img>`s inside a box that is either the full 6:7 frame or the round 160×160 avatar crop.
 *
 * Each layer ships at two densities; the browser picks. Lazy-loaded because a table can hold nine of these (up to
 * ~72 images) and only the ones on screen are worth fetching.
 */
export function Chibi({ subject, expression = 'neutral', frame = 'full', size, label, className, bounce = false }: ChibiProps) {
  const base = useAvatarAssetsBase()
  const layers = layersFor(subject, expression, frame)
  const hash = hashChibi(subject)
  // `full`'s 6:7 box only ever needs a width — its own `aspect-ratio` derives the height. `head` is square, so an
  // explicit height alongside the width is what a flex parent actually respects (a flex item's cross-size does
  // not fall out of `aspect-ratio` the way its own layout box does); either way this sets the root's *requested*
  // size, not the head crop's geometry, which is a fixed percentage of whatever the root ends up rendered at.
  const style: CSSProperties | undefined = size === undefined ? undefined : frame === 'head' ? { width: `${size}px`, height: `${size}px` } : { width: `${size}px` }

  const renderLayer = (layer: LayerRef, extraClassName?: string) => (
    <img
      key={layer.file}
      className={cx(s.layer, extraClassName)}
      style={{ zIndex: layer.order }}
      src={assetUrl(base, layer.file, 1)}
      srcSet={`${assetUrl(base, layer.file, 1)} 1x, ${assetUrl(base, layer.file, 2)} 2x`}
      loading="lazy"
      decoding="async"
      alt=""
      draggable={false}
    />
  )

  const rootProps = {
    className: cx(s.chibi, frame === 'head' ? s.head : s.full, bounce && s.bounce, className),
    style,
    'data-chibi-hash': hash,
    'data-expression': expression,
    'data-frame': frame,
    role: label === undefined ? undefined : ('img' as const),
    'aria-label': label,
    'aria-hidden': label === undefined ? true : undefined,
  }

  if (frame === 'head') {
    // D01 §5: the 208×208 frame border rings the crop from *outside* it — inside the 160×160 crop window it is
    // meant to be empty (192 px clear). Clipping it with the rest of the layers would cut it off entirely, so it
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
