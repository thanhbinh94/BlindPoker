import { Button } from '@bp/ui-kit'
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { AvatarConfigDto } from '../api.js'
import { Portrait } from './Portrait.js'
import { hashConfig } from './hash.js'
import type { Stage } from './stage.js'
import { clampYaw, YAW_PER_PIXEL, YAW_STEP } from './yaw.js'
import s from './stage.module.css'

/**
 * The player's figure, live, on a canvas they can turn (avatar-3d design §6).
 *
 * Two screens use it and they are the only two: the profile header (`mode="view"`) and the wardrobe
 * (`mode="edit"`). Everywhere else — seat plates, the lobby bar, wardrobe tiles — draws a rendered
 * picture through `Portrait`, because a WebGL context per seat is not a thing a phone has (design §7
 * budgets exactly two contexts for the whole app: one for the hidden portrait renderer, one for
 * whichever stage is on screen).
 *
 * Three properties are worth naming, because they are what the file is shaped by:
 *
 * - **three.js is not imported here.** `createStage` is fetched through the same dynamic
 *   `import('./portraits.js')` that `usePortrait` uses, so the stage costs a browser that never opens
 *   these two screens nothing at all, and costs one that opens both a single chunk. The numbers a drag
 *   is measured in come from `yaw.ts`, which is three-free for exactly this reason.
 * - **No WebGL is a first-class answer, not an error.** `supported()` says no on an old phone, in a
 *   locked-down browser, and in every jsdom test — and the answer is `<Portrait size="lg">`, carrying
 *   the same accessible description. Nothing is logged; this is a supported way to use the app.
 * - **The accessible name is the whole configuration in words.** `description` (see
 *   `description.ts`) is what a screen reader reads instead of the picture, which is why it is required
 *   rather than optional.
 */

/** The half of the lazy chunk this component uses — and all a test double has to provide. */
export interface StageFactory {
  supported(): boolean
  createStage(canvas: HTMLCanvasElement): Stage
}

export type StageFactoryLoader = () => Promise<StageFactory>

/**
 * The one import of three.js on this side of the app, and deliberately the *same specifier*
 * `usePortrait` uses: one dynamic import means one chunk, which is what `test/footprint.test.ts`
 * measures and what design §7's single 200 KB budget is a budget for.
 */
const importStage: StageFactoryLoader = () =>
  import('./portraits.js').then((module) => ({
    supported: module.supported,
    createStage: (canvas: HTMLCanvasElement) => module.createStage(canvas),
  }))

let injected: StageFactory | null = null
let load: StageFactoryLoader = importStage
let loading: Promise<StageFactory | null> | null = null

/**
 * Substitutes the stage, the way `setPortraitRendererForTests` substitutes the renderer.
 *
 * jsdom has no WebGL, so without this every test that renders a profile header would evaluate the whole
 * three.js graph to be told so. `src/test-setup.ts` injects an unsupported one for the entire suite;
 * a test about the stage injects `fake-stage.ts` and gets a stage that counts what it was asked to do.
 */
export function setStageFactoryForTests(factory: StageFactory | null): void {
  injected = factory
  loading = null
}

/** Substitutes *how* the real factory is loaded, so a test can watch the chunk fail to arrive. */
export function setStageLoaderForTests(loader: StageFactoryLoader | null): void {
  load = loader ?? importStage
  injected = null
  loading = null
}

async function resolveFactory(): Promise<StageFactory | null> {
  if (injected !== null) return injected
  // As in `usePortrait`: the promise itself is the cache, and a chunk that will not evaluate resolves to
  // `null` rather than rejecting — an unhandled rejection is not a fallback.
  loading ??= load().then(
    (factory) => factory,
    () => null,
  )
  return loading
}

export type StageStatus = 'loading' | 'ready' | 'unsupported'

export interface AvatarStageProps {
  config: AvatarConfigDto
  /** `view` is the profile header's small figure; `edit` is the wardrobe's mannequin. */
  mode: 'view' | 'edit'
  className?: string
  /** The configuration in words — the accessible name of both the stage and its portrait fallback. */
  description: string
  /** Whose figure it is. Only the fallback uses it, for the initial on the disc. */
  name?: string
}

export function AvatarStage({ config, mode, className, description, name }: AvatarStageProps) {
  const { t } = useTranslation('normal')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Stage | null>(null)
  const [status, setStatus] = useState<StageStatus>('loading')
  /** Ties the frame to the sentence that says what the arrow keys do. Two stages on one page, two ids. */
  const hintId = useId()

  /** Where the figure is turned to, and where a drag started. Neither is state: nothing renders on them. */
  const yaw = useRef(0)
  const drag = useRef<{ x: number; from: number } | null>(null)

  // The configuration reaches the effects through a ref, keyed by its *hash*: every caller spreads a
  // fresh object every render, so an effect that depended on the object would rebuild the figure forever.
  // The ref is written in an effect of its own rather than during render, and declared first — effects
  // run in the order they are written, so the ones below always read the current configuration.
  const latest = useRef(config)
  useEffect(() => {
    latest.current = config
  })
  const hash = hashConfig(config)

  /**
   * The figure could not be built — the body's bundle would not load, or the context went away.
   *
   * The stage goes with it rather than being left holding a context nothing will draw into: the app is
   * allowed two in total (design §7), and the portrait fallback below needs the other one.
   */
  const fail = useCallback((): void => {
    stageRef.current?.dispose()
    stageRef.current = null
    setStatus('unsupported')
  }, [])

  useEffect(() => {
    let live = true
    void resolveFactory().then((factory) => {
      if (!live) return
      const canvas = canvasRef.current
      if (factory === null || canvas === null || !factory.supported()) {
        setStatus('unsupported')
        return
      }
      stageRef.current = factory.createStage(canvas)
      // The figure itself is put on by the effect below, which this `ready` wakes: one place asks for a
      // figure, so a mount and a change of outfit cannot both ask and render the same one twice.
      setStatus('ready')
    })

    return () => {
      live = false
      stageRef.current?.dispose()
      stageRef.current = null
    }
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    if (stage === null || status !== 'ready') return
    void stage.setConfig(latest.current).catch(fail)
    // `hash` rather than `config`: the identity of a figure is what is in it, not which object it is.
  }, [hash, status, fail])

  useEffect(() => {
    if (status !== 'ready') return
    const frame = frameRef.current
    // jsdom has no `ResizeObserver`, and neither has a browser old enough to matter: a stage that never
    // hears about a resize is one that keeps its first aspect ratio, which is wrong but not broken.
    if (frame === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => stageRef.current?.resize())
    observer.observe(frame)
    return () => observer.disconnect()
  }, [status])

  const turn = (radians: number): void => {
    yaw.current = clampYaw(radians)
    stageRef.current?.setYaw(yaw.current)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (status !== 'ready') return
    drag.current = { x: event.clientX, from: yaw.current }
    // Capture keeps the moves coming when the pointer leaves the frame mid-drag. jsdom has neither
    // method, and a drag inside the element works without it.
    if (typeof event.currentTarget.setPointerCapture === 'function') event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const from = drag.current
    if (from === null) return
    turn(from.from + (event.clientX - from.x) * YAW_PER_PIXEL)
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag.current === null) return
    drag.current = null
    if (typeof event.currentTarget.releasePointerCapture === 'function') {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // The capture may already be gone (the pointer was cancelled). Nothing to release, nothing to do.
      }
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (status !== 'ready') return
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    turn(yaw.current + (event.key === 'ArrowRight' ? YAW_STEP : -YAW_STEP))
  }

  const reset = (): void => {
    yaw.current = 0
    stageRef.current?.resetYaw()
  }

  const box = className === undefined ? s.stage : `${s.stage} ${className}`

  if (status === 'unsupported') {
    return (
      <span className={box} data-mode={mode} data-stage="unsupported">
        <Portrait config={config} name={name} size="lg" label={description} />
      </span>
    )
  }

  return (
    <div className={box} data-mode={mode} data-stage={status}>
      {/* `role="img"` on the frame and not on the whole component: an image is a leaf in the
          accessibility tree, so a button inside one is a button nobody can reach. The description is the
          picture's alternative text.

          The frame is also focusable, and `img` is not an interactive role — so tabbing onto it would
          otherwise announce the figure and nothing about the arrow keys that turn it. `aria-describedby`
          points at the hint below (which is why the hint is rendered in *both* modes, merely hidden in
          `view` where the layout has no line to spare), and `aria-roledescription` says what kind of
          picture this is before the description of what is in it. */}
      <div
        className={s.frame}
        ref={frameRef}
        role="img"
        aria-label={description}
        aria-roledescription={t('wardrobe.figureRole')}
        aria-describedby={hintId}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <canvas className={s.canvas} ref={canvasRef} aria-hidden="true" />
      </div>
      <div className={s.controls}>
        <Button variant="ghost" size="sm" onClick={reset}>
          {t('wardrobe.resetView')}
        </Button>
      </div>
      <p className={mode === 'edit' ? s.hint : 'visually-hidden'} id={hintId}>
        {t('wardrobe.rotateHint')}
      </p>
    </div>
  )
}
