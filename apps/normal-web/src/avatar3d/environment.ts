import { PMREMGenerator, type Scene, type Texture, type WebGLRenderer } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

/**
 * A neutral image-based light, so metal is not black.
 *
 * `MeshStandardMaterial` is a physically-based shader: at `metalness = 1` it has **no diffuse term at
 * all** and every pixel it draws is a reflection of the environment. With no environment there is
 * nothing to reflect, so the crown, the glasses' rims and the earrings — the `metal` material the
 * asset build bakes at high metalness — render as black silhouettes however many directional lights
 * are aimed at them. Directional lights only contribute a specular highlight, which on a small
 * curved surface is a couple of pixels.
 *
 * `RoomEnvironment` is three's own answer: a scene of white boxes and area lights, prefiltered into a
 * cube map by `PMREMGenerator` (the same pair `model-viewer` uses). It is procedural — no texture is
 * downloaded, no HDR file is shipped — and the whole of it is a few kilobytes of the lazy chunk.
 *
 * The result belongs to **one renderer**: a PMREM texture lives in that renderer's GL context, so the
 * portrait renderer and the profile stage each build their own and each dispose their own. It is
 * built once per context, at the moment the first frame is drawn, and the generator and the room
 * scene are thrown away immediately — only the cube map outlives the call.
 */

/**
 * How much of the room reaches the figure.
 *
 * A full-strength `RoomEnvironment` is a bright white studio and would wash the character's own
 * lighting rig out. What is wanted is the *reflection* — enough for metal to read as metal and for
 * cloth to pick up a little bounce — so the ambient light beside it is cut in the same proportion
 * (see `portraits.ts` and `stage.ts`) and the key/fill/rim rig stays the thing that shapes the face.
 */
export const ENVIRONMENT_INTENSITY = 0.55

/** The blur applied to the room before it is used. A little softens the box edges out of the reflections. */
const SIGMA = 0.04

/**
 * Builds the cube map for one renderer. The caller owns the texture and must `dispose()` it with the
 * renderer; nothing here is cached, because a cache keyed by nothing would hand one context's texture
 * to another.
 */
export function neutralEnvironment(renderer: WebGLRenderer): Texture {
  const generator = new PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  try {
    return generator.fromScene(room, SIGMA).texture
  } finally {
    // The room's own boxes and materials are of no further use — the prefiltered cube map is the
    // whole product — and the generator holds render targets and a shader of its own.
    room.dispose()
    generator.dispose()
  }
}

/**
 * Attaches a neutral environment to a scene, and answers with the texture to dispose later.
 *
 * `null` on failure, deliberately: a browser that cannot build a PMREM (an old driver, a context that
 * went away between the renderer and this call) should draw a figure with dull metal, not no figure.
 */
export function applyEnvironment(scene: Scene, renderer: WebGLRenderer): Texture | null {
  try {
    const texture = neutralEnvironment(renderer)
    scene.environment = texture
    scene.environmentIntensity = ENVIRONMENT_INTENSITY
    return texture
  } catch {
    return null
  }
}
