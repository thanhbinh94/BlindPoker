import { AmbientLight, DirectionalLight, MathUtils, Object3D, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import type { AvatarConfigDto } from '../api.js'
import { abortError } from './abort.js'
import { assemble, disposeAssembled, type Assembled } from './assemble.js'
import { assetLoader } from './assets.js'
import { applyEnvironment } from './environment.js'
import { CONTEXT_LOST, contextLost, watchContext, type ContextWatch } from './gl-context.js'

/**
 * The stage travels in this chunk too, and is re-exported from here on purpose.
 *
 * Everything three.js is behind exactly **one** dynamic `import()` specifier — `./portraits.js` — so
 * the bundler emits exactly one chunk for the whole graph. Giving `stage.ts` a dynamic import of its
 * own would split three between a shared chunk and two small ones, which is two extra requests for
 * the same bytes and a footprint budget (`test/footprint.test.ts`) that can no longer name the thing
 * it measures. `usePortrait` asks this module for `render`; `AvatarStage` asks it for `createStage`.
 */
export { createStage, type Stage, type StageDeps, type StageRenderer } from './stage.js'

/**
 * The one hidden renderer that draws every portrait in the app (avatar-3d design §5, §7).
 *
 * The budget is one WebGL context for portraits, ever. A nine-seat table, a lobby bar and a wardrobe
 * full of item thumbnails would otherwise be a dozen contexts, and browsers cap them somewhere around
 * sixteen — after which the *oldest* context is lost, which is to say the table's. So: one 256×256
 * canvas that is never in the document, one scene, one camera, one set of lights, and a **sequential
 * queue**, because two renders into one canvas are two renders into one canvas.
 *
 * The output is 128 px, drawn down from 256 through a 2D canvas. Supersampling is most of why a
 * 32 px seat plate reads at all; `preserveDrawingBuffer` stays off (it costs a full-frame copy on
 * every render) because the `drawImage` happens in the same task as the `render` call, before the
 * compositor is entitled to clear anything.
 *
 * **Nothing here is allowed to break a screen.** `supported()` answers once and honestly, and
 * `usePortrait` turns every failure — no context, a bundle that 404s, a `toBlob` that returns nothing
 * — into the initial-letter placeholder. This module's job is to say no quickly, not to cope.
 */

/** What the scene is rendered at, and what the image is saved at. The ratio is the anti-aliasing. */
export const PORTRAIT_SOURCE_PX = 256
export const PORTRAIT_PX = 128

/** A narrow lens: a portrait wants the flattening of a short telephoto, not a phone camera's nose. */
const FIELD_OF_VIEW = 28

/**
 * How much empty space sits above the head, as a fraction of the framed height.
 *
 * It was 0.06 until a look in a real browser: the crop sat high, with the shoulders barely inside the
 * frame and a head that read as floating. Ten percent of the frame height, added here, lowers the
 * window by the same ten percent — the head moves up towards the top of the disc and the shoulders
 * come in underneath it, which is what "head and shoulders" means.
 */
const HEADROOM = 0.16

interface PortraitStage {
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera
  /** The lights and their aim, moved as one to whatever height the head is at. */
  rig: Object3D
  /** Whether the GPU is still behind the canvas. See `gl-context.ts`. */
  watch: ContextWatch
}

let stage: PortraitStage | null = null
let output: { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null = null
let support: boolean | null = null
let queue: Promise<unknown> = Promise.resolve()

/**
 * Whether this browser can draw a portrait at all — asked once and cached, including the `false`.
 *
 * The probe creates its own throwaway context rather than the shared one: `supported()` is called
 * before anything is known to be needed, and a machine that answers `false` should not have paid for a
 * renderer, a scene and three lights to find out. The context is released immediately, because a
 * browser's context budget is small and this one has no further use.
 */
export function supported(): boolean {
  if (support !== null) return support
  support = probe()
  return support
}

function probe(): boolean {
  try {
    if (typeof document === 'undefined' || typeof WebGL2RenderingContext === 'undefined') return false
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const gl = canvas.getContext('webgl2')
    if (gl === null) return false
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}

function ensureStage(): PortraitStage {
  if (stage !== null) return stage

  const canvas = document.createElement('canvas')
  canvas.width = PORTRAIT_SOURCE_PX
  canvas.height = PORTRAIT_SOURCE_PX

  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: false })
  renderer.setPixelRatio(1)
  renderer.setSize(PORTRAIT_SOURCE_PX, PORTRAIT_SOURCE_PX, false)
  // Transparent, so a portrait sits on whatever the theme paints behind it rather than carrying a
  // colour that only matched the theme it was rendered under.
  renderer.setClearColor(0x000000, 0)

  const scene = new Scene()
  const camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 0.05, 20)

  // The rig is aimed at its own origin and then moved to the head, so the three lights keep the same
  // relationship to the face whether the body is the male one (head at 1.60 m) or the female (1.55 m).
  const rig = new Object3D()
  const aim = new Object3D()
  rig.add(aim)
  const key = new DirectionalLight(0xfff4e6, 2.6)
  key.position.set(0.7, 0.55, 1.1)
  key.target = aim
  const fill = new DirectionalLight(0xdce6ff, 1.1)
  fill.position.set(-0.9, 0.1, 0.85)
  fill.target = aim
  const rim = new DirectionalLight(0xffffff, 1.8)
  rim.position.set(-0.25, 0.8, -1.2)
  rim.target = aim
  rig.add(key, fill, rim)
  // The ambient term used to be 1.1 and is now mostly the environment map below — a `metalness = 1`
  // material has no diffuse response at all, so glasses rims, earrings and the crown's edge render
  // black under lights alone however bright they are. See `environment.ts`.
  scene.add(rig, new AmbientLight(0xffffff, 0.4))
  applyEnvironment(scene, renderer)

  // A context can be taken away at any moment, and everything afterwards still *looks* like it worked.
  // The watch is what turns that into a rejection instead of a transparent picture in IndexedDB.
  stage = { renderer, scene, camera, rig, watch: watchContext(canvas) }
  return stage
}

function ensureOutput(): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  if (output !== null) return output
  const canvas = document.createElement('canvas')
  canvas.width = PORTRAIT_PX
  canvas.height = PORTRAIT_PX
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('the portrait output canvas has no 2D context')
  output = { canvas, context }
  return output
}

/**
 * Point the camera at the head.
 *
 * The frame runs from a little above the crown — `bounds.max.y` of the body node, which is the top of
 * the skull in metres — down to somewhere around mid-chest, sized as a multiple of the head's own
 * height (`crown - neck_01`). Reading it off the anchors rather than hard-coding metres is what makes
 * one camera correct for both bodies, and what would make it correct for a third.
 *
 * The figure faces **+Z** (it is where the pipeline puts a pair of glasses' lenses), so the camera
 * stands in front of the chest at `bounds.max.z` plus whatever distance the lens needs.
 */
function frame(camera: PerspectiveCamera, rig: Object3D, built: Assembled): void {
  const head = built.anchors['Head'] ?? [0, 1.6, 0]
  const neck = built.anchors['neck_01'] ?? [head[0], head[1] - 0.08, head[2]]
  const crown = built.bounds === null ? head[1] + 0.22 : built.bounds.max[1]
  const front = built.bounds === null ? 0.15 : built.bounds.max[2]

  // A head is about 0.29 m from neck joint to crown on these rigs; a head-and-shoulders shot is a
  // little under twice that. `max` keeps a body with implausible bounds from producing a zero frame.
  const headHeight = Math.max(crown - neck[1], 0.12)
  const height = headHeight * 1.75
  const centre = crown + height * HEADROOM - height / 2
  const distance = height / 2 / Math.tan(MathUtils.degToRad(FIELD_OF_VIEW) / 2)

  camera.position.set(0, centre, front + distance)
  camera.lookAt(0, centre, head[2])
  camera.updateProjectionMatrix()
  rig.position.set(0, centre, head[2])
}

/** `toBlob` with a WebP-then-PNG fallback: Safari before 14 has the callback but not the format. */
function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((webp) => {
      if (webp !== null) return resolve(webp)
      canvas.toBlob((png) => {
        if (png === null) return reject(new Error('the portrait canvas produced no image'))
        resolve(png)
      }, 'image/png')
    }, 'image/webp')
  })
}

async function draw(config: AvatarConfigDto): Promise<Blob> {
  if (!supported()) throw new Error('this browser has no WebGL2 context to render a portrait with')
  const current = ensureStage()
  // Before the assets are even fetched: a context that is gone will still be gone in 40 ms, and the
  // cheapest failure is the one that does no work.
  if (contextLost(current.watch, current.renderer)) throw new Error(CONTEXT_LOST)
  const built = await assemble(config, assetLoader)
  current.scene.add(built.group)
  try {
    frame(current.camera, current.rig, built)
    current.renderer.render(current.scene, current.camera)
    // And again with the pixels about to be read: the loss may have happened during the await above, or
    // during the render itself, and a blank drawing buffer is indistinguishable from a good one. This
    // check is the whole reason a lost context cannot cache a transparent portrait.
    if (contextLost(current.watch, current.renderer)) throw new Error(CONTEXT_LOST)
    const out = ensureOutput()
    out.context.clearRect(0, 0, PORTRAIT_PX, PORTRAIT_PX)
    // Same task as the `render` above, which is what makes reading the drawing buffer legal without
    // `preserveDrawingBuffer`. `toBlob` may resolve later; by then the pixels are already copied.
    out.context.drawImage(current.renderer.domElement, 0, 0, PORTRAIT_PX, PORTRAIT_PX)
    return await toBlob(out.canvas)
  } finally {
    // The scene is reused, so the figure has to leave it — and its cloned materials have to be freed,
    // or every portrait would leave a shader program behind on the GPU.
    current.scene.remove(built.group)
    disposeAssembled(built.group)
  }
}

export interface RenderOptions {
  /**
   * Drops the job if it aborts before its turn comes up.
   *
   * A wardrobe tile is a portrait of *the whole current configuration* with one item swapped in, so one
   * click on a hair colour changes the hash of all forty tiles at once and queues forty renders. Two
   * clicks later, thirty-nine of those are pictures of a configuration nobody is looking at any more —
   * and the queue is sequential, so they are also thirty-nine assemblies standing between the player
   * and the picture they *are* looking at. The signal is how a caller says "not any more".
   */
  signal?: AbortSignal
}

/**
 * One portrait, 128×128, transparent background.
 *
 * Calls are serialised: the second one starts when the first has its blob, whether that one succeeded
 * or not. The queue is what stops nine seat plates from interleaving nine `render` calls into one
 * canvas and reading each other's pixels.
 *
 * The signal is checked when the job reaches the head of the queue rather than during it: a render is
 * tens of milliseconds and it has the canvas, so there is nothing useful to interrupt half way. What
 * matters is that the *waiting* ones evaporate.
 */
export function render(config: AvatarConfigDto, options: RenderOptions = {}): Promise<Blob> {
  const start = (): Promise<Blob> => {
    if (options.signal?.aborted === true) return Promise.reject(abortError())
    return draw(config)
  }
  const next = queue.then(start, start)
  // The queue itself must never hold a rejection, or one failed portrait would reject every portrait
  // queued behind it. The caller still gets `next`, rejection and all.
  queue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

/** Releases the context and the canvases. Nothing in the app calls it; a test harness might. */
export function disposePortraitRenderer(): void {
  if (stage !== null) {
    stage.watch.stop()
    // The prefiltered environment lives in this context and nothing else will free it.
    stage.scene.environment?.dispose()
    stage.scene.environment = null
    // `dispose()` frees three's own objects but leaves the GL context alive until the canvas is
    // collected, which may be never; `forceContextLoss` hands it back now. It matters for the budget of
    // one context for portraits plus one for Task 4's stage.
    stage.renderer.forceContextLoss()
    stage.renderer.dispose()
  }
  stage = null
  output = null
  support = null
  queue = Promise.resolve()
}
