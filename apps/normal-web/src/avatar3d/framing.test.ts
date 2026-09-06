import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { ManifestBounds, Triple } from './assets.js'
import { HEADROOM, HEAD_FRAME, MIN_HEAD_HEIGHT, PORTRAIT_FIELD_OF_VIEW, portraitFraming } from './framing.js'

/**
 * The portrait crop, checked the way `stage.test.ts` checks the full-body one: build three's own
 * camera from the framing, project real points of a real body through it, and assert where they land.
 *
 * This is the one thing in the portrait renderer that has no test otherwise — `portraits.ts` builds a
 * `WebGLRenderer` at `ensureStage`, so nothing in it can be driven under jsdom, and yet `HEADROOM` is
 * what every face in the app is cropped by. A camera is pure maths; only the pixels need a GPU.
 */

/** The two bodies as `public/avatar3d/manifest.json` ships them. */
const MALE = {
  bounds: { min: [-0.929, -0.01, -0.163], max: [0.929, 1.81, 0.128] } as ManifestBounds,
  anchors: {
    Head: [0, 1.6, -0.017],
    neck_01: [0, 1.52, -0.041],
    upperarm_l: [0.212, 1.455, -0.065],
    upperarm_r: [-0.212, 1.455, -0.065],
    pelvis: [0, 0.949, -0.043],
  } as Record<string, Triple>,
}

const FEMALE = {
  bounds: { min: [-0.834, -0.008, -0.162], max: [0.834, 1.767, 0.14] } as ManifestBounds,
  anchors: {
    Head: [0, 1.55, -0.011],
    neck_01: [0, 1.485, -0.041],
    upperarm_l: [0.152, 1.418, -0.054],
    upperarm_r: [-0.152, 1.418, -0.054],
    pelvis: [0, 0.932, -0.046],
  } as Record<string, Triple>,
}

/** The camera `portraits.ts` builds, aimed the way `frame()` aims it. Square, because a portrait is. */
function cameraFor(anchors: Record<string, Triple>, bounds: ManifestBounds | null): PerspectiveCamera {
  const view = portraitFraming(anchors, bounds)
  const camera = new PerspectiveCamera(PORTRAIT_FIELD_OF_VIEW, 1, 0.05, 20)
  camera.position.set(...view.position)
  camera.lookAt(...view.target)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  return camera
}

/** Where a point of the figure lands in the picture: −1 is the bottom edge, +1 the top. */
const heightIn = (camera: PerspectiveCamera, point: Triple): number => new Vector3(...point).project(camera).y

describe('portraitFraming', () => {
  it('leaves the headroom above the crown that the constant promises', () => {
    for (const body of [MALE, FEMALE]) {
      const view = portraitFraming(body.anchors, body.bounds)
      const camera = cameraFor(body.anchors, body.bounds)
      // At the plane the window was measured on — the front of the chest — the top edge sits exactly
      // `HEADROOM` of the window's height above the crown, so the crown lands at `1 - 2 × HEADROOM`.
      const crown: Triple = [0, body.bounds.max[1], body.bounds.max[2]]

      expect(heightIn(camera, crown)).toBeCloseTo(1 - 2 * HEADROOM, 5)
      // Which is to say: inside the picture, near the top, with air above it. At the old 0.06 this was
      // 0.88 — the head against the edge that the constant was raised to fix.
      expect(heightIn(camera, crown)).toBeGreaterThan(0.5)
      expect(heightIn(camera, crown)).toBeLessThan(0.8)
      expect(view.centre + view.height / 2 - body.bounds.max[1]).toBeCloseTo(view.height * HEADROOM, 10)
    }
  })

  it('brings both shoulders in under the head rather than cropping them off', () => {
    for (const body of [MALE, FEMALE]) {
      const camera = cameraFor(body.anchors, body.bounds)

      for (const anchor of ['upperarm_l', 'upperarm_r'] as const) {
        const shoulder = body.anchors[anchor]!
        const at = heightIn(camera, shoulder)
        // Inside the frame at all — this is what "head *and shoulders*" costs.
        expect(Math.abs(at), `${anchor} is outside the picture`).toBeLessThan(1)
        // And in the lower half of it, under the face rather than level with it. At the old 0.06 the
        // shoulders sat at −0.44, which is where a head reads as floating in the middle of the disc.
        expect(at, `${anchor} is not below the face`).toBeLessThan(-0.5)
      }
    }
  })

  it('crops at the head, not at the whole figure', () => {
    const camera = cameraFor(MALE.anchors, MALE.bounds)
    const view = portraitFraming(MALE.anchors, MALE.bounds)

    // The window is a little under two head heights, so the pelvis and the feet are well outside it —
    // a portrait that framed the body would be a 128 px picture of nobody in particular.
    expect(view.height).toBeCloseTo((MALE.bounds.max[1] - MALE.anchors['neck_01']![1]) * HEAD_FRAME, 10)
    expect(heightIn(camera, MALE.anchors['pelvis']!)).toBeLessThan(-1)
    expect(heightIn(camera, [0, MALE.bounds.min[1], 0])).toBeLessThan(-1)
  })

  it('stands in front of the chest and looks back at the head', () => {
    const view = portraitFraming(MALE.anchors, MALE.bounds)

    // The figure faces +Z, so the lens is in front of the frontmost point of the body…
    expect(view.position[0]).toBe(0)
    expect(view.position[2]).toBeGreaterThan(MALE.bounds.max[2])
    expect(view.position[2] - MALE.bounds.max[2]).toBeCloseTo(view.distance, 10)
    // …and level with what it is looking at, which is the head's own depth: the crop is square on, with
    // none of the downward tilt the full-body stage has.
    expect(view.target).toEqual([0, view.centre, MALE.anchors['Head']![2]])
    expect(view.position[1]).toBe(view.centre)
  })

  it('still frames something when the body node never loaded', () => {
    // No bounds at all: `assemble` answers `null` when the body's own node failed, and a portrait of a
    // figure with holes in it is better than a thrown error on a seat plate.
    const view = portraitFraming({}, null)

    expect(Number.isFinite(view.centre)).toBe(true)
    expect(view.height).toBeGreaterThan(0)
    expect(view.distance).toBeGreaterThan(0)
  })

  it('refuses to collapse the frame when the bounds are implausible', () => {
    // A crown below the neck joint would otherwise give a zero or negative window, and a camera at the
    // origin looking at itself.
    const view = portraitFraming(MALE.anchors, { min: [-1, 0, -1], max: [1, 1.0, 0.1] })

    expect(view.height).toBeCloseTo(MIN_HEAD_HEIGHT * HEAD_FRAME, 10)
    expect(view.distance).toBeGreaterThan(0)
  })
})
