import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { cx } from '../primitives/cx.js'
import { useMediaQuery } from '../table/useMediaQuery.js'
import { assetUrl, useAvatarAssetsBase } from './AvatarAssets.js'
import { useLoadedClip } from './clip.js'
import { hashChibi, layersFor } from './layers.js'
import { useInView } from './lazy.js'
import { useChibiLife } from './life.js'
import { useOnScreen } from './on-screen.js'
import { useTintedLayerState } from './tinted.js'
import type { ChibiFacing, ChibiFrame, ChibiLive, ChibiReaction, ChibiSubject, Expression, LayerRef } from './types.js'
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
  face,
  faceHidden = false,
  onReady,
}: {
  base: string
  layer: LayerRef
  className?: string
  tintPriority?: number
  /** `1` pins a small portrait to the @1x files, tinted and plain (Ruling 16); absent, the screen decides. */
  density?: 1
  /** BP-30: on a live chibi, the expression this face layer draws (`data-face-layer`). Absent on every other layer
   * and on every layer of a chibi that is not live, which then renders exactly as before. */
  face?: Expression
  /** A live chibi's face that is mounted but not the one showing: `opacity: 0` and `data-face-hidden`. */
  faceHidden?: boolean
  /** BP-30: told whether this layer is ready to be shown — its tint for the current colours has settled and the
   * `<img>` now rendered has fired `load` (or `error`: the browser has then given its final word on that URL). */
  onReady?: (file: string, ready: boolean) => void
}) {
  const { url: tinted, settled } = useTintedLayerState(base, layer, tintPriority, density)
  const clip = useLoadedClip(layer.clip === undefined ? null : assetUrl(base, layer.clip, 2))
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const useTinted = tinted !== null && tinted !== failedUrl
  const src = useTinted ? tinted : assetUrl(base, layer.file, 1)
  const ready = settled && loadedSrc === src

  const reportRef = useRef(onReady)
  reportRef.current = onReady
  const watched = onReady !== undefined
  useEffect(() => {
    if (!watched) return
    const file = layer.file
    reportRef.current?.(file, ready)
    // Gone (or about to report again): never left counted as ready by a layer that is no longer there.
    return () => reportRef.current?.(file, false)
  }, [watched, layer.file, ready])

  const common = {
    className: cx(s.layer, faceHidden && s.faceHidden, className),
    style: clip === null ? { zIndex: layer.order } : { zIndex: layer.order, ...clipMask(clip) },
    loading: 'lazy' as const,
    decoding: 'async' as const,
    alt: '',
    draggable: false,
    'data-face-layer': face,
    'data-face-hidden': face !== undefined && faceHidden ? '' : undefined,
    // Only a watched layer listens; the `src` it reports is the one this render draws.
    onLoad: watched ? () => setLoadedSrc(src) : undefined,
  }

  if (useTinted)
    return (
      <img
        {...common}
        src={tinted}
        onError={() => {
          if (watched) setLoadedSrc(tinted)
          setFailedUrl(tinted)
        }}
      />
    )

  const onError = watched ? () => setLoadedSrc(src) : undefined

  if (density === 1) return <img {...common} src={src} onError={onError} />

  return <img {...common} src={src} srcSet={`${assetUrl(base, layer.file, 1)} 1x, ${assetUrl(base, layer.file, 2)} 2x`} onError={onError} />
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
  /** BP-30 (spec K6 §3.1): `off`, the default, renders exactly what a chibi always rendered. `still` and `idle` mount the
   * base, `closed` and `happy` faces together (the extra two once the base face is ready) and switch them by opacity,
   * answer `react` and `facing`, and stamp the life state on the root (`data-live`, `data-face`, `data-facing`,
   * `data-reacting`, `data-breathing`, `data-motion`); `idle` also breathes and blinks while on screen. */
  live?: ChibiLive
  /** A reaction for a live chibi: a new `key` plays it (a cheer or a wave; see `useChibiLife`). Ignored when `off`. */
  react?: ChibiReaction | null
  /** Which way a live chibi faces; a change after mount plays the turn. Ignored when `off`. */
  facing?: ChibiFacing
  /** Called each time every mounted face of a live chibi has become ready to show (loaded and tinted). */
  onFacesReady?: () => void
}

/** How far a lazy chibi's tint renders sit below an eager one's in the tint queue. `useTintedLayer` ranks a layer at
 * `-order` (L10 the aura … L90 the frame: −10 … −90), so the body and the face start before the frame; a lazy chibi's
 * layers rank 100 lower still (−110 … −190), behind every layer of the stage or a seat, whatever its order. */
const LAZY_TINT_PRIORITY = -100

/** The head crop's side in the @1x art (the round 208×208 avatar crop): drawn no larger on screen, @1x is enough. */
const HEAD_CROP_PX = 208

/** The face's layer order: the one layer `layersFor` varies by expression. */
const FACE_ORDER = 50

/** The faces a live chibi mounts beside its own: a blink's and a reaction's. */
const EXTRA_FACES = ['closed', 'happy'] as const satisfies readonly Expression[]

/** One layer to draw, and on a live chibi, the expression it is the face of. */
interface StackEntry {
  layer: LayerRef
  face?: Expression
}

/**
 * One chibi: every layer `layersFor` returns for this subject, expression and frame, stacked as absolutely
 * positioned `<img>`s inside a box that is either the full 6:7 frame or the round 208×208 avatar crop.
 *
 * Each layer ships at two densities; the browser picks. Lazy-loaded because a table can hold nine of these (up to
 * ~72 images) and only the ones on screen are worth fetching.
 */
export function Chibi({
  subject,
  expression = 'neutral',
  frame = 'full',
  size,
  label,
  className,
  bounce = false,
  lazy = false,
  live = 'off',
  react = null,
  facing = 'right',
  onFacesReady,
}: ChibiProps) {
  const base = useAvatarAssetsBase()
  const rootRef = useRef<HTMLDivElement>(null)
  // Called unconditionally (hook order); with `lazy` off it observes nothing and reports `true`.
  const inView = useInView(rootRef, '200px', lazy)
  const alive = live !== 'off'
  // BP-30: the life hooks, also unconditional. Off, the observer watches nothing and the hook returns the still state.
  const onScreen = useOnScreen(rootRef, { enabled: live === 'idle' })
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [readyFiles, setReadyFiles] = useState<Readonly<Record<string, boolean>>>({})
  const [extrasWanted, setExtrasWanted] = useState(false)
  const onLayerReady = useCallback((file: string, ready: boolean) => setReadyFiles((prev) => (prev[file] === ready ? prev : { ...prev, [file]: ready })), [])

  const layers = layersFor(subject, expression, frame)
  const hash = hashChibi(subject)

  // A live chibi's stack: the base face where it always is, the extra faces (once wanted) right after it, at the same
  // order, deduplicated by file (`layersFor` varies only the face by expression).
  let stack: StackEntry[] = layers.map((layer) => ({ layer }))
  const baseFaceIndex = alive ? layers.findIndex((l) => l.order === FACE_ORDER) : -1
  const baseFace = baseFaceIndex === -1 ? undefined : layers[baseFaceIndex]
  if (baseFace !== undefined) {
    const faces: StackEntry[] = [{ layer: baseFace, face: expression }]
    if (extrasWanted) {
      for (const extra of EXTRA_FACES) {
        const layer = layersFor(subject, extra, frame).find((l) => l.order === FACE_ORDER)
        if (layer !== undefined && !faces.some((f) => f.layer.file === layer.file)) faces.push({ layer, face: extra })
      }
    }
    stack = [...stack.slice(0, baseFaceIndex), ...faces, ...stack.slice(baseFaceIndex + 1)]
  }
  const faceEntries = stack.filter((entry) => entry.face !== undefined)
  const baseFaceReady = baseFace !== undefined && readyFiles[baseFace.file] === true
  const facesReady = extrasWanted && faceEntries.length > 0 && faceEntries.every((entry) => readyFiles[entry.layer.file] === true)

  // P18: the extra faces wait until the base face is in, so they never compete with the first paint. Once in, they stay.
  useEffect(() => {
    if (baseFaceReady && !extrasWanted) setExtrasWanted(true)
  }, [baseFaceReady, extrasWanted])

  const facesReadyRef = useRef(onFacesReady)
  facesReadyRef.current = onFacesReady
  useEffect(() => {
    if (facesReady) facesReadyRef.current?.()
  }, [facesReady])

  const life = useChibiLife({ live, react, facing, onScreen, facesReady, baseExpression: expression, reducedMotion })
  // The face to show: the hook's pick, or the base one should that face not be mounted (never a blank face).
  const wanted = life.face === 'base' ? expression : life.face
  const shown = faceEntries.some((entry) => entry.face === wanted) ? wanted : expression
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

  const renderLayer = ({ layer, face }: StackEntry, extraClassName?: string) => (
    <ChibiLayer
      key={layer.file}
      base={base}
      layer={layer}
      className={extraClassName}
      tintPriority={lazy ? LAZY_TINT_PRIORITY - layer.order : undefined}
      density={cheap ? 1 : undefined}
      face={face}
      faceHidden={face !== undefined && face !== shown}
      onReady={face === undefined ? undefined : onLayerReady}
    />
  )

  const rootProps = {
    ref: rootRef,
    className: cx(
      s.chibi,
      frame === 'head' ? s.head : s.full,
      bounce && s.bounce,
      alive && life.breathing && s.breathe,
      alive && life.motion === 'hop' && s.hop,
      alive && life.motion === 'tilt' && s.tilt,
      alive && life.motion === 'spin' && s.spin,
      className,
    ),
    style,
    'data-chibi-hash': hash,
    'data-expression': expression,
    'data-frame': frame,
    // BP-30: the life state, on a live chibi only. Class names are hashed in production; these are what tests read.
    'data-live': alive ? live : undefined,
    'data-face': alive ? life.face : undefined,
    'data-facing': alive ? facing : undefined,
    'data-reacting': alive ? (life.reacting ?? undefined) : undefined,
    'data-breathing': alive ? String(life.breathing) : undefined,
    'data-motion': alive ? life.motion : undefined,
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
    const frameBorder = stack.find((entry) => entry.layer.order === FRAME_BORDER_ORDER)
    const clipped = stack.filter((entry) => entry.layer.order !== FRAME_BORDER_ORDER)

    return (
      <div {...rootProps}>
        <div className={s.clip}>
          <div className={cx(s.crop, s.headCrop)}>{clipped.map((entry) => renderLayer(entry))}</div>
        </div>
        {frameBorder === undefined ? null : renderLayer(frameBorder, s.headCrop)}
      </div>
    )
  }

  return (
    <div {...rootProps}>
      <div className={s.crop}>{stack.map((entry) => renderLayer(entry))}</div>
    </div>
  )
}
