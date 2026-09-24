import type { CSSProperties } from 'react'
import { cx } from '../primitives/cx.js'
import { assetUrl, useAvatarAssetsBase } from './AvatarAssets.js'
import { hashChibi, layersFor } from './layers.js'
import { useTintedLayer } from './tinted.js'
import type { ChibiFrame, ChibiSubject, Expression, LayerRef } from './types.js'
import s from './avatar2d.module.css'

/** D01 §5: the frame border is drawn 260×260 around the crop's centre, outside the 208×208 crop window itself —
 * it is meant to ring the round avatar, not sit inside it. Everything else on layer order 90 and below. */
const FRAME_BORDER_ORDER = 90

/**
 * One layer's `<img>`. A layer with `tints` (spec §5.2) asks `useTintedLayer` for its recoloured blob URL and
 * renders that — with no `srcSet`, since the hook already picked the screen's own density — the instant it is
 * ready; until then, and for a layer with no tints at all, it renders the plain two-density layer exactly as
 * before. Split out from `Chibi` itself because calling a hook inside `layers.map(...)` there would vary the
 * hook count across renders (equipping or removing an item changes how many layers there are).
 */
function ChibiLayer({ base, layer, className }: { base: string; layer: LayerRef; className?: string }) {
  const tinted = useTintedLayer(base, layer)
  const common = {
    className: cx(s.layer, className),
    style: { zIndex: layer.order },
    loading: 'lazy' as const,
    decoding: 'async' as const,
    alt: '',
    draggable: false,
  }

  if (tinted !== null) return <img {...common} src={tinted} />

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
}

/**
 * One chibi: every layer `layersFor` returns for this subject, expression and frame, stacked as absolutely
 * positioned `<img>`s inside a box that is either the full 6:7 frame or the round 208×208 avatar crop.
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

  const renderLayer = (layer: LayerRef, extraClassName?: string) => <ChibiLayer key={layer.file} base={base} layer={layer} className={extraClassName} />

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
