import type { ManifestBounds, Triple } from './assets.js'

/**
 * Where the portrait camera stands, as arithmetic — no three.js, no GPU, no canvas.
 *
 * This is the crop every avatar picture in the app is made by: seat plates, the lobby bar, the rows in
 * the inventory, every wardrobe tile. `portraits.ts` owns the renderer and the queue; what it does
 * *not* own is the framing, because the framing is a handful of constants and one piece of similar
 * triangles, and a constant that only exists inside a module which builds a `WebGLRenderer` on import
 * is a constant no test under jsdom can ever look at. `stage.ts` keeps its own `frame()` separable for
 * the same reason, and `stage.test.ts` asserts on it; `framing.test.ts` is the equivalent here.
 *
 * The figure faces **+Z** (it is where the pipeline puts a pair of glasses' lenses), so the camera
 * stands in front of the chest and looks back along −Z at the head's own depth.
 *
 * There are two crops, not one. The head-and-shoulders one is what a face is: a seat plate, the lobby
 * bar, a profile row, and every wardrobe tile of something worn above the chest. The **full-body** one
 * exists for the two slots that crop cannot contain — a pair of trousers and a pair of shoes are below
 * it by construction, so four bottoms framed on the head are four identical pictures. Both are computed
 * for the *same* camera (`PORTRAIT_FIELD_OF_VIEW`), because `portraits.ts` builds one and only changes
 * where it stands.
 */

/** Which of the two crops a picture is made by. */
export type PortraitFrame = 'portrait' | 'full'

/** A narrow lens: a portrait wants the flattening of a short telephoto, not a phone camera's nose. */
export const PORTRAIT_FIELD_OF_VIEW = 28

/**
 * How much empty space sits above the head, as a fraction of the framed height.
 *
 * It was 0.06 until a look in a real browser: the crop sat high, with the shoulders barely inside the
 * frame and a head that read as floating. Sixteen percent of the frame height, added here, lowers the
 * window by the same sixteen percent — the head moves up towards the top of the disc and the shoulders
 * come in underneath it, which is what "head and shoulders" means.
 *
 * The number is directly visible in the projection: the crown lands at `1 - 2 × HEADROOM` in normalised
 * device coordinates, which is what `framing.test.ts` asserts, so a revert or a typo here fails a test
 * rather than quietly re-cropping every face in the app.
 */
export const HEADROOM = 0.16

/**
 * The framed height, as a multiple of the head's own height (crown to neck joint).
 *
 * A head is about 0.29 m on these rigs and a head-and-shoulders shot is a little under twice that.
 * Measuring it off the anchors rather than hard-coding metres is what makes one camera correct for the
 * male body (head at 1.60 m), the female (1.55 m), and a third nobody has modelled yet.
 */
export const HEAD_FRAME = 1.75

/** A floor under the measured head height, so a body with implausible bounds cannot produce a zero frame. */
export const MIN_HEAD_HEIGHT = 0.12

/**
 * Empty space above the crown and below the feet, together, as a fraction of the figure's height.
 *
 * The same number `stage.ts` frames the on-screen figure by, and deliberately: a full-body *tile* and
 * the full-body *stage* are the same picture at two sizes, and a tile framed tighter than the stage
 * would read as a different figure the moment a player looked from one to the other.
 */
export const FULL_MARGIN = 0.14

/** Where the full-body camera stands, as a fraction of the figure's height off the ground — `stage.ts`'s. */
export const FULL_EYE_LEVEL = 0.62

/** A floor under the measured figure height, for the same reason `MIN_HEAD_HEIGHT` is one. */
export const MIN_FULL_HEIGHT = 0.5

/** A person-shaped box, for a figure whose body node never loaded — `stage.ts`'s `FALLBACK_BOUNDS`. */
const FALLBACK_BOUNDS: ManifestBounds = { min: [-0.5, 0, -0.25], max: [0.5, 1.8, 0.25] }

/** Where the camera goes and what it aims at — everything `portraits.ts` has to tell three.js. */
export interface PortraitFraming {
  /**
   * The camera's world position, on the axis and in front of the figure: level with `centre` in the
   * head crop, a little above the middle of the body in the full one.
   */
  position: Triple
  /** What the camera looks at, and where the light rig is moved to — the head, or the figure's middle. */
  target: Triple
  /** The height of the window in metres, at the plane of `front`. */
  height: number
  /** The height that window is centred on. */
  centre: number
  /** How far in front of `front` the camera stands, for `height` to fill the lens exactly. */
  distance: number
}

/**
 * Point a `PORTRAIT_FIELD_OF_VIEW` camera at an assembled figure, at the crop `frame` asks for.
 *
 * `anchors` and `bounds` are `Assembled`'s two geometric facts. Both have fallbacks: a body whose node
 * failed to load has no bounds at all, and a manifest may one day ship a rig without `neck_01`. A
 * portrait of a figure that is missing pieces is better than no portrait, so nothing here throws.
 */
export function portraitFraming(
  anchors: Record<string, Triple>,
  bounds: ManifestBounds | null,
  frame: PortraitFrame = 'portrait',
): PortraitFraming {
  return frame === 'full' ? fullFraming(bounds) : headFraming(anchors, bounds)
}

/**
 * The whole figure, head to feet — the crop a pair of trousers and a pair of shoes are visible in.
 *
 * It is `stage.ts`'s arithmetic, at this module's field of view: fit the *height* (the bounds are the
 * T-pose's, so their width is two outstretched arms the assembler has since brought down), centre the
 * window on the middle of the figure, and stand a little above the middle looking at it — the slight
 * downward tilt design §6 asks for. Only the lens differs, because `portraits.ts` builds one camera and
 * this crop may not rebuild its projection.
 */
function fullFraming(bounds: ManifestBounds | null): PortraitFraming {
  const min = bounds === null ? FALLBACK_BOUNDS.min : bounds.min
  const max = bounds === null ? FALLBACK_BOUNDS.max : bounds.max
  const span = Math.max(max[1] - min[1], MIN_FULL_HEIGHT)
  const height = span * (1 + FULL_MARGIN)
  const centre = (max[1] + min[1]) / 2
  const distance = height / 2 / Math.tan((PORTRAIT_FIELD_OF_VIEW * Math.PI) / 360)

  return {
    position: [0, min[1] + span * FULL_EYE_LEVEL, max[2] + distance],
    target: [0, centre, 0],
    height,
    centre,
    distance,
  }
}

/** Head and shoulders: from a little above the crown down to about mid-chest. */
function headFraming(anchors: Record<string, Triple>, bounds: ManifestBounds | null): PortraitFraming {
  const head = anchors['Head'] ?? [0, 1.6, 0]
  const neck = anchors['neck_01'] ?? [head[0], head[1] - 0.08, head[2]]
  const crown = bounds === null ? head[1] + 0.22 : bounds.max[1]
  const front = bounds === null ? 0.15 : bounds.max[2]

  const headHeight = Math.max(crown - neck[1], MIN_HEAD_HEIGHT)
  const height = headHeight * HEAD_FRAME
  // The window's top edge sits `HEADROOM` of its own height above the crown; `centre` is half a window
  // below that edge.
  const centre = crown + height * HEADROOM - height / 2
  // Similar triangles: at `distance` from the lens, a `PORTRAIT_FIELD_OF_VIEW` cone is exactly `height`
  // tall. Measured from `front` rather than from the origin so the *face* is what fills the frame.
  const distance = height / 2 / Math.tan((PORTRAIT_FIELD_OF_VIEW * Math.PI) / 360)

  return {
    position: [0, centre, front + distance],
    target: [0, centre, head[2]],
    height,
    centre,
    distance,
  }
}
