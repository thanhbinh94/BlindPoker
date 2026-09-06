import { Group, Mesh, MeshStandardMaterial, PerspectiveCamera, SphereGeometry, Vector3, type Camera, type Scene } from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { AvatarConfigDto } from '../api.js'
import type { Assembled } from './assemble.js'
import type { NodeLoader } from './assets.js'
import { createStage, type StageDeps, type StageRenderer } from './stage.js'
import { BASE_YAW, YAW_LIMIT } from './yaw.js'

/**
 * The stage without a GPU.
 *
 * jsdom has no WebGL, so the renderer is a double that counts frames — but the scene, the camera and
 * the framing arithmetic are three's own, running for real. That is the split worth having: what a
 * test can check here is exactly what is *not* the GPU's answer, which is when a frame is drawn, what
 * is in the graph when it is, and where the camera is pointing.
 */

const CONFIG: AvatarConfigDto = {
  v: 2,
  body: 'male',
  skin: '#e0ac81',
  eyes: '#3b2415',
  hairColor: '#2b2b2b',
  hair: 'hair_short',
  top: 'top_tee',
  bottom: 'bottom_jeans',
  shoes: 'shoes_sneakers',
}

/** The male body's real bounds, out of `public/avatar3d/manifest.json`. */
const MALE_BOUNDS = { min: [-0.929, -0.01, -0.163] as [number, number, number], max: [0.929, 1.81, 0.128] as [number, number, number] }

interface FakeRenderer extends StageRenderer {
  readonly frames: { scene: Scene; camera: Camera }[]
  readonly disposed: { forced: boolean; disposed: boolean }
  readonly sizes: [number, number][]
}

function fakeRenderer(canvas: HTMLCanvasElement): FakeRenderer {
  const frames: { scene: Scene; camera: Camera }[] = []
  const sizes: [number, number][] = []
  const disposed = { forced: false, disposed: false }
  let lost = false
  return {
    frames,
    sizes,
    disposed,
    domElement: canvas,
    setPixelRatio: () => undefined,
    setSize: (width, height) => void sizes.push([width, height]),
    setClearColor: () => undefined,
    render: (scene, camera) => void frames.push({ scene, camera }),
    getContext: () => ({ isContextLost: () => lost }),
    forceContextLoss: () => {
      disposed.forced = true
      lost = true
    },
    dispose: () => void (disposed.disposed = true),
  }
}

/** A figure with one real mesh in it, so `disposeAssembled` has a material to free. */
function assembly(name: string): Assembled {
  const group = new Group()
  group.name = name
  const material = new MeshStandardMaterial()
  group.add(new Mesh(new SphereGeometry(0.2, 4, 3), material))
  return { group, body: 'male', bounds: MALE_BOUNDS, anchors: {}, keys: [`body/male:${name}`] }
}

interface Harness {
  canvas: HTMLCanvasElement
  renderer: FakeRenderer
  /** Runs every frame the stage has asked for, the way the browser eventually would. */
  flush(): void
  pendingFrames(): number
  deps: StageDeps
}

function harness(assemble?: StageDeps['assemble']): Harness {
  const canvas = document.createElement('canvas')
  // jsdom lays nothing out, so the stage would see 0×0; a size makes the aspect ratio real.
  Object.defineProperty(canvas, 'clientWidth', { value: 300 })
  Object.defineProperty(canvas, 'clientHeight', { value: 500 })

  let renderer: FakeRenderer | null = null
  const queue = new Map<number, () => void>()
  let next = 1

  const deps: StageDeps = {
    renderer: (element) => (renderer = fakeRenderer(element)),
    loader: { manifest: () => Promise.reject(new Error('unused')), loadNode: () => Promise.resolve(null) } as NodeLoader,
    assemble: assemble ?? (() => Promise.resolve(assembly('one'))),
    environment: () => null,
    schedule: (draw) => {
      const handle = next++
      queue.set(handle, draw)
      return handle
    },
    unschedule: (handle) => void queue.delete(handle),
  }

  return {
    canvas,
    deps,
    get renderer() {
      if (renderer === null) throw new Error('the stage has not built its renderer yet')
      return renderer
    },
    pendingFrames: () => queue.size,
    flush() {
      const due = [...queue.values()]
      queue.clear()
      for (const draw of due) draw()
    },
  }
}

describe('createStage', () => {
  it('sizes itself from the canvas and asks for a first frame', () => {
    const h = harness()
    const stage = createStage(h.canvas, h.deps)

    expect(h.renderer.sizes).toEqual([[300, 500]])
    expect(h.renderer.frames).toHaveLength(0)
    h.flush()
    expect(h.renderer.frames).toHaveLength(1)
    stage.dispose()
  })

  it('puts the figure on the stage, and disposes the previous one when it is replaced', async () => {
    const first = assembly('first')
    const second = assembly('second')
    const built = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const h = harness(built)
    const stage = createStage(h.canvas, h.deps)

    await stage.setConfig(CONFIG)
    h.flush()
    const scene = h.renderer.frames.at(-1)!.scene
    expect(scene.getObjectByName('first')).toBe(first.group)

    const freed = vi.spyOn(materialOf(first), 'dispose')
    await stage.setConfig({ ...CONFIG, body: 'female' })
    h.flush()

    expect(scene.getObjectByName('first')).toBeUndefined()
    expect(scene.getObjectByName('second')).toBe(second.group)
    // Not merely detached: the clone's material is that assembly's own and holds a shader program.
    expect(freed).toHaveBeenCalled()
    expect(built).toHaveBeenCalledTimes(2)
    stage.dispose()
  })

  it('throws away a figure that arrived after a later one was asked for', async () => {
    const stale = assembly('stale')
    const fresh = assembly('fresh')
    let releaseStale = (): void => undefined
    const built = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Assembled>((resolve) => (releaseStale = () => resolve(stale))))
      .mockResolvedValueOnce(fresh)
    const h = harness(built)
    const stage = createStage(h.canvas, h.deps)

    const slow = stage.setConfig(CONFIG)
    await stage.setConfig({ ...CONFIG, body: 'female' })
    releaseStale()
    await slow
    h.flush()

    const scene = h.renderer.frames.at(-1)!.scene
    expect(scene.getObjectByName('fresh')).toBe(fresh.group)
    expect(scene.getObjectByName('stale')).toBeUndefined()
    stage.dispose()
  })

  it('clamps the yaw to ±60° and leaves the resting three-quarter turn under it', () => {
    const h = harness()
    const stage = createStage(h.canvas, h.deps)
    h.flush()

    stage.setYaw(YAW_LIMIT * 4)
    expect(stage.yaw()).toBeCloseTo(YAW_LIMIT, 6)
    stage.setYaw(-YAW_LIMIT * 4)
    expect(stage.yaw()).toBeCloseTo(-YAW_LIMIT, 6)

    stage.resetYaw()
    expect(stage.yaw()).toBe(0)
    h.flush()
    // The figure at rest is turned, not square on: yaw is measured from that three-quarter view.
    const pivot = h.renderer.frames.at(-1)!.scene.children.find((child) => child.type === 'Group')
    expect(pivot?.rotation.y).toBeCloseTo(BASE_YAW, 6)
    stage.dispose()
  })

  it('draws once however many changes happen inside one frame', () => {
    const h = harness()
    const stage = createStage(h.canvas, h.deps)
    h.flush()
    const before = h.renderer.frames.length

    stage.setYaw(0.1)
    stage.setYaw(0.2)
    stage.setYaw(0.3)
    stage.resize()
    expect(h.pendingFrames()).toBe(1)

    h.flush()
    expect(h.renderer.frames.length - before).toBe(1)
    // And a change that changes nothing asks for nothing.
    stage.setYaw(0.3)
    expect(h.pendingFrames()).toBe(0)
    stage.dispose()
  })

  it('frames the whole body, from the feet to the crown, from in front and a little above', async () => {
    const h = harness()
    const stage = createStage(h.canvas, h.deps)
    await stage.setConfig(CONFIG)
    h.flush()

    const camera = h.renderer.frames.at(-1)!.camera as PerspectiveCamera
    // In front of the chest (the figure faces +Z) and above the middle, which is the downward tilt.
    expect(camera.position.z).toBeGreaterThan(MALE_BOUNDS.max[2])
    expect(camera.position.y).toBeGreaterThan((MALE_BOUNDS.max[1] + MALE_BOUNDS.min[1]) / 2)
    expect(camera.position.y).toBeLessThan(MALE_BOUNDS.max[1])

    // Everything between the soles and the crown is inside the picture, with room to spare.
    camera.updateMatrixWorld(true)
    for (const y of [MALE_BOUNDS.min[1], MALE_BOUNDS.max[1]]) {
      const ndc = new Vector3(0, y, 0).project(camera)
      expect(Math.abs(ndc.y), `y=${y} is outside the frame`).toBeLessThan(1)
      expect(Math.abs(ndc.y), `y=${y} is too far inside the frame to be framing`).toBeGreaterThan(0.7)
    }
    stage.dispose()
  })

  it('gives the context back and frees the figure when it is disposed', async () => {
    const worn = assembly('worn')
    const h = harness(() => Promise.resolve(worn))
    const stage = createStage(h.canvas, h.deps)
    await stage.setConfig(CONFIG)
    const freed = vi.spyOn(materialOf(worn), 'dispose')

    stage.setYaw(0.4)
    expect(h.pendingFrames()).toBe(1)
    stage.dispose()

    expect(h.pendingFrames()).toBe(0)
    expect(h.renderer.disposed).toEqual({ forced: true, disposed: true })
    expect(freed).toHaveBeenCalled()
    // Everything afterwards is inert rather than an error: a resize observer may still fire once.
    stage.resize()
    stage.setYaw(0)
    expect(h.pendingFrames()).toBe(0)
  })

  it('skips the frame while the context is gone rather than drawing a blank one', () => {
    const h = harness()
    const stage = createStage(h.canvas, h.deps)
    h.flush()
    const before = h.renderer.frames.length

    h.canvas.dispatchEvent(new Event('webglcontextlost'))
    stage.setYaw(0.5)
    h.flush()
    expect(h.renderer.frames.length).toBe(before)

    // …and comes back on its own when the browser hands the context back.
    h.canvas.dispatchEvent(new Event('webglcontextrestored'))
    h.flush()
    expect(h.renderer.frames.length).toBe(before + 1)
    stage.dispose()
  })
})

/** The one material of a built figure — what `disposeAssembled` is supposed to free. */
function materialOf(built: Assembled): MeshStandardMaterial {
  return (built.group.children[0] as Mesh).material as MeshStandardMaterial
}
