import type { CSSProperties } from 'react'
import { cx } from '../primitives/cx.js'
import { assetUrl, useAvatarAssetsBase } from './AvatarAssets.js'
import { headCropGeometry } from './frame.js'
import { hashChibi, layersFor } from './layers.js'
import type { ChibiFrame, ChibiSubject, Expression } from './types.js'
import s from './avatar2d.module.css'

export interface ChibiProps {
  subject: ChibiSubject
  expression?: Expression
  frame?: ChibiFrame
  /** Fixed side length in px. Omitted, the chibi fills its container's width (its usual mode: a seat disc, a
   * lobby-bar avatar and the playground's own grid all just size the wrapper). */
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
  const style = size === undefined ? undefined : { width: `${size}px` }

  // The head crop, as explicit left/top/width/height rather than a CSS transform: a transform's `scale` never
  // magnifies a same-list `translate`'s offset, so `translate(...) scale(...)` lands the crop off-centre (see
  // `frame.ts`). Pixels when `size` is known; percent-of-container (reading the same ratios back at `outputSize
  // = 100`) when it is not — `Chibi`'s usual mode, filling whatever box the caller (a seat disc, a lobby bar) set.
  const cropStyle: CSSProperties | undefined =
    frame !== 'head'
      ? undefined
      : (() => {
          const unit = size === undefined ? '%' : 'px'
          const g = headCropGeometry(size ?? 100)
          return { left: `${g.left}${unit}`, top: `${g.top}${unit}`, width: `${g.width}${unit}`, height: `${g.height}${unit}` }
        })()

  return (
    <div
      className={cx(s.chibi, frame === 'head' ? s.head : s.full, bounce && s.bounce, className)}
      style={style}
      data-chibi-hash={hash}
      data-expression={expression}
      data-frame={frame}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
    >
      <div className={s.crop} style={cropStyle}>
        {layers.map((layer) => (
          <img
            key={layer.file}
            className={s.layer}
            style={{ zIndex: layer.order }}
            src={assetUrl(base, layer.file, 1)}
            srcSet={`${assetUrl(base, layer.file, 1)} 1x, ${assetUrl(base, layer.file, 2)} 2x`}
            loading="lazy"
            decoding="async"
            alt=""
            draggable={false}
          />
        ))}
      </div>
    </div>
  )
}
