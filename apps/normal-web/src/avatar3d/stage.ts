import {
  AmbientLight,
  DirectionalLight,
  Group,
  MathUtils,
  Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type Camera,
  type Texture,
} from 'three'
import type { AvatarConfigDto } from './legacy-avatar.js'
import { assemble as assembleConfig, disposeAssembled, type Assembled } from './assemble.js'
import { assetLoader, type NodeLoader } from './assets.js'
import { applyEnvironment } from './environment.js'
import { contextLost, watchContext, type ContextWatch } from './gl-context.js'
import { BASE_YAW, clampYaw } from './yaw.js'

/**
 * The full-body character on a canvas: the profile header's figure and the wardrobe's mannequin
 * (avatar-3d design §6).
 *
 * It is the *second* WebGL context this app is allowed, and the last (§7): one for the hidden
 * portrait renderer, one for whichever stage is on screen. Everything else in the app draws pictures.
 * So this module is written to be created late, disposed eagerly, and to cost nothing while nobody is
 * touching it —
 *
 * - **No animation loop.** Nothing here calls `requestAnimationFrame` in a cycle. A frame is drawn
 *   when something changed — a new configuration, a drag, a resize — and the requests are coalesced,
 *   so dragging across sixty pointer events in one frame draws once. A stage sitting on the profile
 *   page is, between interactions, exactly as expensive as a static image.
 * - **The figure turns, not the camera.** Yaw is a rotation on the group holding the character, which
 *   keeps the lights, the camera and the framing fixed: the face is lit the same at −60° as at +60°,
 *   which orbiting a camera through a static rig would not give.
 * - **`assemble` does the modelling.** The body, the variants, the tints and the arms-down pose are
 *   `assemble.ts`'s, shared verbatim with the portrait renderer. What is here is a camera, a light
 *   rig, a canvas and a policy for when to draw.
 *
 * Everything three touches is behind `createStage`, and everything a test needs to replace is a
 * dependency (`StageDeps`) — jsdom has no WebGL, so the scene graph, the framing arithmetic, the
 * clamp and the coalescing are all exercised with a renderer that counts calls.
 */

/** A standing figure is tall and thin, so the vertical field of view is what frames it. */
const FIELD_OF_VIEW = 30

/** Empty space above the crown and below the feet, together, as a fraction of the figure's height. */
const MARGIN = 0.14

/**
 * Where the camera stands, as a fraction of the figure's height off the ground.
 *
 * Above the middle and aimed at the middle, which is the slight downward tilt design §6 asks for —
 * about three degrees. It reads as looking *at* somebody standing in front of you rather than as a
 * product shot taken from their navel.
 */
const EYE_LEVEL = 0.62

/** Retina, capped: two is where the extra pixels stop being visible and start being heat. */
const MAX_PIXEL_RATIO = 2

/** The half of `WebGLRenderer` this module uses — and all a test double has to provide. */
export interface StageRenderer {
  domElement: HTMLCanvasElement
  setPixelRatio(value: number): void
  setSize(width: number, height: number, updateStyle?: boolean): void
  setClearColor(color: number, alpha: number): void
  render(scene: Scene, camera: Camera): void
  /** `ContextHolder` in `gl-context.ts`: how the stage asks whether drawing would produce anything. */
  getContext(): { isContextLost(): boolean } | null | undefined
  forceContextLoss(): void
  dispose(): void
}

export interface StageDeps {
  /** Builds the renderer for this canvas. */
  renderer?: (canvas: HTMLCanvasElement) => StageRenderer
  /** Turns a configuration into a posed, recoloured figure. */
  assemble?: (config: AvatarConfigDto, loader: NodeLoader) => Promise<Assembled>
  loader?: NodeLoader
  /** Attaches the image-based light and answers with the texture to dispose, or `null`. */
  environment?: (scene: Scene, renderer: StageRenderer) => Texture | null
  /** Asks for a frame. Defaults to `requestAnimationFrame`. */
  schedule?: (draw: () => void) => number
  unschedule?: (handle: number) => void
}

export interface Stage {
  /**
   * Show this configuration, replacing whatever is on the stage.
   *
   * Rejects when the figure cannot be built at all (the body's bundle would not load) — the caller's
   * cue to fall back to a portrait. A *garment* that will not load is `assemble`'s business and is
   * simply not worn.
   */
  setConfig(config: AvatarConfigDto): Promise<void>
  /** Turn the figure. Clamped to ±`YAW_LIMIT`; the value that took effect is readable from `yaw()`. */
  setYaw(radians: number): void
  /** Back to the three-quarter view the stage opens at. */
  resetYaw(): void
  yaw(): number
  /** Re-reads the canvas's laid-out size. Cheap and idempotent; call it on any layout change. */
  resize(): void
  /** Releases the context, the canvas and the figure. The stage is unusable afterwards. */
  dispose(): void
}

/**
 * The real renderer.
 *
 * `alpha: true` so the page's own background shows through — a stage that painted its own would carry
 * one theme's colour into the other. `preserveDrawingBuffer` stays off: nothing reads these pixels
 * back (that is the portrait renderer's job), and the copy it forces costs a full frame every frame.
 */
function realRenderer(canvas: HTMLCanvasElement): StageRenderer {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: false })
  renderer.setClearColor(0x000000, 0)
  return renderer
}

/**
 * The environment, for the real renderer.
 *
 * The cast is the one place the narrow `StageRenderer` port and `PMREMGenerator`'s need for a real
 * `WebGLRenderer` meet. A test that replaces `renderer` replaces this too — there is nothing for a
 * PMREM to run on without a GPU.
 */
function realEnvironment(scene: Scene, renderer: StageRenderer): Texture | null {
  return applyEnvironment(scene, renderer as WebGLRenderer)
}

/**
 * The light rig, parented to one object so it can be moved to the figure's own height.
 *
 * Key from the front left, fill from the right and a rim from behind — the same three-point shape the
 * portrait renderer uses, opened out for a whole body. The ambient term is small because the
 * environment map (`environment.ts`) is the other half of it; without one the figure is flatter but
 * still lit, which is the right way round for a fallback.
 */
function buildRig(): Object3D {
  const rig = new Object3D()
  const aim = new Object3D()
  rig.add(aim)

  const key = new DirectionalLight(0xfff4e6, 2.4)
  key.position.set(1.1, 1.3, 1.6)
  key.target = aim
  const fill = new DirectionalLight(0xdce6ff, 1.0)
  fill.position.set(-1.4, 0.3, 1.2)
  fill.target = aim
  const rim = new DirectionalLight(0xffffff, 1.6)
  rim.position.set(-0.4, 1.2, -1.8)
  rim.target = aim
  rig.add(key, fill, rim)

  return rig
}

/** The body's extent when the manifest could not say — a person-shaped box, so nothing divides by zero. */
const FALLBACK_BOUNDS = { min: [-0.5, 0, -0.25] as const, max: [0.5, 1.8, 0.25] as const }

/**
 * Point the camera at the whole figure.
 *
 * The numbers come off the body node's own bounds, which the asset build captured in metres before
 * quantization, so the same camera frames the 1.81 m male body and the 1.77 m female one identically
 * — and would frame a third without being touched. Only the *height* is fitted: the bounds are the
 * T-pose's, so their width includes two outstretched arms the assembler has since brought down, and
 * fitting to it would leave the figure small in the middle of a lot of nothing.
 */
function frame(camera: PerspectiveCamera, rig: Object3D, bounds: Assembled['bounds']): void {
  const min = bounds?.min ?? FALLBACK_BOUNDS.min
  const max = bounds?.max ?? FALLBACK_BOUNDS.max
  const span = Math.max(max[1] - min[1], 0.5)
  const height = span * (1 + MARGIN)
  const centre = (max[1] + min[1]) / 2
  const distance = height / 2 / Math.tan(MathUtils.degToRad(FIELD_OF_VIEW) / 2)

  camera.position.set(0, min[1] + span * EYE_LEVEL, max[2] + distance)
  camera.lookAt(0, centre, 0)
  camera.updateProjectionMatrix()

  // The lights follow the figure's own height rather than sitting at a fixed one, so the male and
  // female bodies are lit the same way at the same places on the face.
  rig.position.set(0, centre, 0)
}

/**
 * One stage on one canvas.
 *
 * The returned handle is the whole API: no scene, no camera and no renderer escape, because the
 * lifetime of every one of them is `dispose()`'s to end.
 */
export function createStage(canvas: HTMLCanvasElement, deps: StageDeps = {}): Stage {
  const build = deps.renderer ?? realRenderer
  const model = deps.assemble ?? assembleConfig
  const loader = deps.loader ?? assetLoader
  const environment = deps.environment ?? realEnvironment
  const schedule = deps.schedule ?? ((draw: () => void) => requestAnimationFrame(draw))
  const unschedule = deps.unschedule ?? ((handle: number) => cancelAnimationFrame(handle))

  const renderer = build(canvas)

  /**
   * How many device pixels one CSS pixel buys, capped.
   *
   * Read afresh on every resize rather than once at construction: a window dragged from a 3× phone
   * screen to a 1× monitor fires a resize, and a stage that kept the old ratio would go on rendering
   * three times the pixels it needs (or a third of them). It costs a property read.
   */
  const pixelRatio = (): number => Math.min(typeof window === 'undefined' ? 1 : (window.devicePixelRatio || 1), MAX_PIXEL_RATIO)

  renderer.setPixelRatio(pixelRatio())

  const scene = new Scene()
  const camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 0.05, 40)
  const rig = buildRig()
  // Small on purpose: the environment map carries most of the ambient term. See `environment.ts`.
  scene.add(rig, new AmbientLight(0xffffff, 0.4))

  /** What turns. The assembled figure is parented here, so yaw survives a change of outfit. */
  const pivot = new Group()
  pivot.rotation.y = BASE_YAW
  scene.add(pivot)

  const watch: ContextWatch = watchContext(canvas)

  let built: Assembled | null = null
  let env: Texture | null = null
  let envTried = false
  let turn = 0
  let pending: number | null = null
  let disposed = false
  /** Which `setConfig` call is the current one; a slower earlier call must not overwrite a later one. */
  let generation = 0

  function draw(): void {
    pending = null
    if (disposed) return
    // A context that is gone draws nothing and reports no error. Unlike the portrait renderer this
    // one has nothing to cache, so there is nothing to protect — it simply skips the frame and waits
    // for `webglcontextrestored`, which asks for another.
    if (contextLost(watch, renderer)) return
    if (!envTried) {
      envTried = true
      env = environment(scene, renderer)
    }
    renderer.render(scene, camera)
  }

  /**
   * Ask for a frame, at most one at a time.
   *
   * This is the whole of "renders only on change": every mutator calls it, and sixty pointer moves
   * inside one frame collapse into the single draw the browser was going to give us anyway.
   */
  function invalidate(): void {
    if (disposed || pending !== null) return
    pending = schedule(draw)
  }

  const onRestored = (): void => {
    // The PMREM cube map lived in the context that just went away; the next frame builds another. The
    // old one's GPU side went with the context, but three still holds its JavaScript object — freeing it
    // here is what keeps this file's rule (nothing three owns is dropped, everything is disposed) true
    // in the one place a restore could quietly break it.
    env?.dispose()
    env = null
    envTried = false
    invalidate()
  }
  canvas.addEventListener('webglcontextrestored', onRestored)

  function measure(): { width: number; height: number } {
    // `clientWidth` is 0 under jsdom and before the first layout; a 1×1 renderer is harmless and a
    // zero-sized one is a division by zero in the projection matrix.
    return { width: Math.max(canvas.clientWidth, 1), height: Math.max(canvas.clientHeight, 1) }
  }

  function setYaw(radians: number): void {
    const clamped = clampYaw(radians)
    if (clamped === turn) return
    turn = clamped
    pivot.rotation.y = BASE_YAW + clamped
    invalidate()
  }

  function resize(): void {
    if (disposed) return
    const { width, height } = measure()
    renderer.setPixelRatio(pixelRatio())
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    invalidate()
  }

  resize()

  return {
    async setConfig(config: AvatarConfigDto): Promise<void> {
      const mine = ++generation
      const next = await model(config, loader)
      // Either this stage was disposed while the assets were in flight, or a later configuration has
      // already been asked for. Both mean these meshes are never going to be seen — and they hold
      // cloned materials and copied skeletons, so dropping the reference is not enough.
      if (disposed || mine !== generation) {
        disposeAssembled(next.group)
        return
      }
      if (built !== null) {
        pivot.remove(built.group)
        disposeAssembled(built.group)
      }
      built = next
      pivot.add(next.group)
      frame(camera, rig, next.bounds)
      // The aspect ratio is the canvas's, not the figure's, and `frame` overwrites the projection.
      const { width, height } = measure()
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      invalidate()
    },

    setYaw,

    resetYaw: () => setYaw(0),

    yaw: () => turn,

    resize,

    dispose(): void {
      if (disposed) return
      disposed = true
      if (pending !== null) unschedule(pending)
      pending = null
      canvas.removeEventListener('webglcontextrestored', onRestored)
      watch.stop()
      if (built !== null) {
        pivot.remove(built.group)
        disposeAssembled(built.group)
        built = null
      }
      env?.dispose()
      env = null
      // `dispose()` alone leaves the GL context alive until the canvas is collected, which may be
      // never — and this app is allowed exactly two contexts, so a stage that did not hand its one
      // back would cost the next screen its own.
      renderer.forceContextLoss()
      renderer.dispose()
    },
  }
}
