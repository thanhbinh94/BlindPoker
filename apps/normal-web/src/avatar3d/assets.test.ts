import { Bone, BufferGeometry, Group, MeshStandardMaterial, Object3D, Quaternion, Skeleton, SkinnedMesh } from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { poseArmsDown } from './assemble.js'
import { assetLoader, loadManifest, setAvatarAssetBase, type AvatarManifest, type ManifestNode } from './assets.js'

/**
 * The loader, with the network and the glTF parser replaced and nothing else.
 *
 * Two things in this module are worth a test and cannot be reached any other way. The first is
 * `detach`: the file layout puts fourteen garments on *one* skeleton, so a node lifted out of a bundle
 * has to be given its own bones or posing a top would rotate the trousers' arms — and the source's
 * bones have to be left alone, or every portrait would pose the arms a little further than the last
 * one. The second is that neither cache may remember a *failure*: one 503 on the manifest, or one
 * aborted `.glb` while a phone changes network, would otherwise turn every face in the app into an
 * initial letter until the page is reloaded.
 *
 * The `GLTFLoader` is mocked because a real one needs a WASM decoder and a real `.glb`; everything
 * below it — the name sanitising, the scene-graph copy, the skeleton rebinding — is the module's own
 * code running for real over three's own classes.
 */

const gltf = vi.hoisted(() => ({
  /** Every URL the loader was asked for, in order. */
  asked: [] as string[],
  /** What to answer with. Set per test. */
  open: null as null | ((url: string) => { scene: Object3D }),
}))

vi.mock('three/examples/jsm/libs/meshopt_decoder.module.js', () => ({
  MeshoptDecoder: { supported: true, ready: Promise.resolve() },
}))

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    setMeshoptDecoder(): this {
      return this
    }
    loadAsync(url: string): Promise<{ scene: Object3D }> {
      gltf.asked.push(url)
      if (gltf.open === null) return Promise.reject(new Error(`nothing is serving ${url}`))
      try {
        return Promise.resolve(gltf.open(url))
      } catch (cause) {
        return Promise.reject(cause as Error)
      }
    }
  },
}))

const BOUNDS = { min: [-0.9, 0, -0.2] as [number, number, number], max: [0.9, 1.81, 0.13] as [number, number, number] }
const node = (file: string): ManifestNode => ({ file, bytes: 1, bounds: BOUNDS })

const MANIFEST: AvatarManifest = {
  version: 1,
  generatedAt: '2026-09-05T00:00:00.000Z',
  placeholder: false,
  compression: 'meshopt',
  mapSha256: 'stub',
  files: {},
  nodes: {
    'body/male': node('body-male.glb'),
    'top/top_tee/male': node('outfits.glb'),
    'bottom/bottom_jeans/male': node('outfits.glb'),
    'hair/hair_none/male': node('hair.glb'),
    'hat/hat_pruned/male': node('outfits.glb'),
  },
  materials: ['skin', 'eyes', 'hair', 'cloth_primary', 'cloth_secondary', 'metal'],
  anchors: { male: { Head: [0, 1.6, -0.017] } },
  pose: { armsDown: { upperarm_l: [0, 0, -1.134] } },
  budget: { totalBytes: 1, maxFileBytes: 1, maxBodyBytes: 1 },
}

/** What is left of one bundle: a shared rig, two garments bound to it, and an empty node. */
function outfits(): { scene: Group; skeleton: Skeleton; bones: Map<string, Bone> } {
  const scene = new Group()
  const root = new Bone()
  root.name = 'root'
  const left = new Bone()
  left.name = 'upperarm_l'
  root.add(left)
  scene.add(root)

  const skeleton = new Skeleton([root, left])
  // The names the *file* carries: `GLTFLoader` runs every node name through
  // `PropertyBinding.sanitizeNodeName`, which strips the `/` out of the manifest's keys. Writing them
  // out by hand is what makes the lookup's sanitising a thing this test can fail on.
  for (const name of ['toptop_teemale', 'bottombottom_jeansmale']) {
    const mesh = new SkinnedMesh(new BufferGeometry(), new MeshStandardMaterial())
    mesh.name = name
    scene.add(mesh)
    mesh.bind(skeleton)
  }

  const empty = new Object3D()
  empty.name = 'hairhair_nonemale'
  scene.add(empty)

  return { scene, skeleton, bones: new Map([['root', root], ['upperarm_l', left]]) }
}

const respondWith = (scene: Object3D) => (): { scene: Object3D } => ({ scene })

/** A `fetch` that answers the manifest, and can be told to fail the first time. */
function servedManifest(options: { failures?: number } = {}): { calls: () => number } {
  let calls = 0
  let left = options.failures ?? 0
  vi.stubGlobal('fetch', () => {
    calls += 1
    if (left > 0) {
      left -= 1
      return Promise.reject(new TypeError('Failed to fetch'))
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(MANIFEST) } as unknown as Response)
  })
  return { calls: () => calls }
}

/** The one skinned mesh inside a detached node. (The node itself is a `Group` of the same name.) */
const skinnedIn = (root: Object3D): SkinnedMesh => {
  let found: SkinnedMesh | null = null
  root.traverse((node) => {
    if ((node as SkinnedMesh).isSkinnedMesh === true) found = node as SkinnedMesh
  })
  if (found === null) throw new Error('no skinned mesh under this node')
  return found
}

const boneNamed = (root: Object3D, name: string): Bone => {
  const found = root.getObjectByName(name)
  if (found === undefined) throw new Error(`no bone ${name}`)
  return found as Bone
}

beforeEach(() => {
  gltf.asked.length = 0
  gltf.open = null
  // Also clears the manifest promise and the per-file node cache.
  setAvatarAssetBase('/avatar3d/')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadManifest', () => {
  it('reads the manifest once for however many portraits ask at the same instant', async () => {
    const fetched = servedManifest()

    const [a, b] = await Promise.all([loadManifest(), loadManifest()])

    expect(a).toBe(b)
    expect(fetched.calls()).toBe(1)
  })

  it('retries after a failure instead of holding the rejection for the life of the page', async () => {
    const fetched = servedManifest({ failures: 1 })

    // One transient network error — a 503, or a phone changing network mid-request.
    await expect(loadManifest()).rejects.toThrow('Failed to fetch')

    // The next portrait anybody asks for is the retry. Without clearing the memo this second call
    // settles on the same rejection and every face in the app is a letter until a reload.
    await expect(loadManifest()).resolves.toBe(MANIFEST)
    expect(fetched.calls()).toBe(2)
  })

  it('refuses a compression it cannot read, rather than failing later inside the parser', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ ...MANIFEST, compression: 'draco' }) } as unknown as Response),
    )

    await expect(loadManifest()).rejects.toThrow('draco')
  })

  it('refuses a manifest with no pose or anchors, which the assembler would have read blindly', async () => {
    // `assemble` reaches straight into `manifest.pose.armsDown` — every figure in the app is posed —
    // so a manifest from an older deploy fails there as a `TypeError` about `undefined`, in a module
    // nobody reading the console would connect to the file that is actually wrong.
    for (const broken of [{ ...MANIFEST, pose: undefined }, { ...MANIFEST, anchors: undefined }]) {
      vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve(broken) } as unknown as Response))
      await expect(loadManifest()).rejects.toThrow(/pose\.armsDown or anchors/)
    }
  })
})

describe('assetLoader.loadNode', () => {
  it('finds a node by the manifest key, which is not the name inside the file', async () => {
    servedManifest()
    gltf.open = respondWith(outfits().scene)

    const top = await assetLoader.loadNode('top/top_tee/male')

    expect(top).not.toBeNull()
    expect(gltf.asked).toEqual(['/avatar3d/outfits.glb'])
    // The manifest publishes `top/top_tee/male`; the file carries `toptop_teemale`, because
    // `GLTFLoader` strips the characters an animation path reserves. Looking up the raw key finds
    // nothing at all, and the portrait would be a body with no clothes on and no error anywhere.
    expect(skinnedIn(top as Object3D).name).toBe('toptop_teemale')
  })

  it('reads a bundle once and answers a second node from the same copy', async () => {
    servedManifest()
    gltf.open = respondWith(outfits().scene)

    await assetLoader.loadNode('top/top_tee/male')
    await assetLoader.loadNode('bottom/bottom_jeans/male')

    expect(gltf.asked).toEqual(['/avatar3d/outfits.glb'])
  })

  it('retries a bundle that failed to arrive, rather than writing the item off for the session', async () => {
    servedManifest()
    let attempts = 0
    gltf.open = (url) => {
      attempts += 1
      if (attempts === 1) throw new Error(`${url} answered 503`)
      return { scene: outfits().scene }
    }

    await expect(assetLoader.loadNode('top/top_tee/male')).rejects.toThrow('503')
    await expect(assetLoader.loadNode('top/top_tee/male')).resolves.not.toBeNull()
    expect(attempts).toBe(2)
  })

  it('answers null for a node the manifest names but the bundle does not carry', async () => {
    servedManifest()
    gltf.open = respondWith(outfits().scene)

    // A future item pruned out of its bundle: wear nothing there, exactly as for an unknown id.
    await expect(assetLoader.loadNode('hat/hat_pruned/male')).resolves.toBeNull()
    await expect(assetLoader.loadNode('cape/cape_01/male')).resolves.toBeNull()
  })

  it('carries an empty node — `hair_none` — through the same path as a mesh', async () => {
    servedManifest()
    gltf.open = respondWith(outfits().scene)

    const none = (await assetLoader.loadNode('hair/hair_none/male')) as Object3D

    // A node with no geometry at all still has to come back as a node: the assembler adds it, the
    // renderer draws nothing, and "no hair" is a thing a player chose rather than a load failure.
    expect(none.name).toBe('hairhair_nonemale')
    expect(none.children).toHaveLength(1)
  })
})

/**
 * The property the whole file layout depends on: one skeleton in the bundle, one skeleton *each* out
 * of it.
 */
describe('detach', () => {
  const POSE: Record<string, [number, number, number]> = { upperarm_l: [0, 0, -1.134] }

  it('gives every node its own bones, so posing a top does not move the trousers', async () => {
    servedManifest()
    const file = outfits()
    gltf.open = respondWith(file.scene)

    const top = (await assetLoader.loadNode('top/top_tee/male')) as Object3D
    const bottom = (await assetLoader.loadNode('bottom/bottom_jeans/male')) as Object3D

    const topArm = boneNamed(top, 'upperarm_l')
    const bottomArm = boneNamed(bottom, 'upperarm_l')
    expect(topArm).not.toBe(bottomArm)
    expect(topArm).not.toBe(file.bones.get('upperarm_l'))

    // The rebind has to reach the mesh's own `skeleton.bones`, not just the copied hierarchy: a mesh
    // still holding the file's array would deform to the file's bones however many copies exist.
    const skinned = skinnedIn(top)
    expect(skinned.skeleton.bones).toContain(topArm)
    expect(skinned.skeleton).not.toBe(file.skeleton)

    poseArmsDown(top, POSE)

    expect(topArm.quaternion.angleTo(new Quaternion())).toBeGreaterThan(1)
    expect(bottomArm.quaternion.angleTo(new Quaternion())).toBe(0)
  })

  it('leaves the file’s own bones in the bind pose, however often a copy of them is posed', async () => {
    servedManifest()
    const file = outfits()
    gltf.open = respondWith(file.scene)
    const source = file.bones.get('upperarm_l') as Bone

    // Twice, because this is the failure the multiplication makes possible: a pose applied to the
    // *source* accumulates, and every portrait would put the arms a little lower than the last one.
    for (const key of ['top/top_tee/male', 'top/top_tee/male']) {
      poseArmsDown((await assetLoader.loadNode(key)) as Object3D, POSE)
    }

    expect(source.quaternion.angleTo(new Quaternion())).toBe(0)
    expect(file.skeleton.bones[1]).toBe(source)
  })

  it('turns off frustum culling on the node, because the pose leaves the bind pose’s bounding volume', async () => {
    servedManifest()
    gltf.open = respondWith(outfits().scene)

    const top = (await assetLoader.loadNode('top/top_tee/male')) as Object3D

    expect(skinnedIn(top).frustumCulled).toBe(false)
  })
})
