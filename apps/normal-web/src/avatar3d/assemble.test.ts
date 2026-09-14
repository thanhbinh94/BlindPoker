import { Bone, BufferGeometry, DataTexture, Euler, Group, Mesh, MeshStandardMaterial, Object3D, Quaternion, Skeleton, SkinnedMesh } from 'three'
import { describe, expect, it } from 'vitest'
import type { AvatarConfigDto } from './legacy-avatar.js'
import { assemble, disposeAssembled, nodeKeysOf, poseArmsDown } from './assemble.js'
import type { AvatarManifest, ManifestNode, NodeLoader } from './assets.js'

/**
 * The assembler, against a stubbed loader.
 *
 * three's own classes are used rather than doubles — a `Skeleton` of real `Bone`s is what the pose code
 * actually walks, and none of it needs a renderer, so all of it runs under jsdom. What is stubbed is the
 * loader, because that is the half that needs a network and a WASM decoder.
 */

const POSE: Record<string, [number, number, number]> = {
  upperarm_l: [0, 0, -1.134],
  upperarm_r: [0, 0, 1.134],
}

const BOUNDS = { min: [-0.9, 0, -0.2] as [number, number, number], max: [0.9, 1.81, 0.13] as [number, number, number] }

const NODES: Record<string, ManifestNode> = {
  'body/male': { file: 'body-male.glb', bytes: 1, bounds: BOUNDS },
  'body/female': { file: 'body-female.glb', bytes: 1, bounds: { min: [-0.8, 0, -0.2], max: [0.8, 1.75, 0.12] } },
  'hair/hair_short/male': { file: 'hair.glb', bytes: 1, bounds: BOUNDS },
  'hair/hair_short/female': { file: 'hair.glb', bytes: 1, bounds: BOUNDS },
  'top/top_tee/male': { file: 'outfits.glb', bytes: 1, bounds: BOUNDS, tint: '#00ff00' },
  'top/top_tee/female': { file: 'outfits.glb', bytes: 1, bounds: BOUNDS, tint: '#0000ff' },
  'bottom/bottom_jeans/male': { file: 'outfits.glb', bytes: 1, bounds: BOUNDS },
  'bottom/bottom_jeans/female': { file: 'outfits.glb', bytes: 1, bounds: BOUNDS },
  'shoes/shoes_sneakers/male': { file: 'outfits.glb', bytes: 1, bounds: BOUNDS },
  'shoes/shoes_sneakers/female': { file: 'outfits.glb', bytes: 1, bounds: BOUNDS },
  'hat/hat_crown/male': { file: 'accessories.glb', bytes: 1, bounds: BOUNDS },
}

const MANIFEST: AvatarManifest = {
  version: 1,
  generatedAt: '2026-09-05T00:00:00.000Z',
  placeholder: false,
  compression: 'meshopt',
  mapSha256: 'stub',
  files: {},
  nodes: NODES,
  materials: ['skin', 'eyes', 'hair', 'cloth_primary', 'cloth_secondary', 'metal'],
  anchors: {
    male: { Head: [0, 1.6, -0.017], neck_01: [0, 1.52, -0.041] },
    female: { Head: [0, 1.55, -0.011], neck_01: [0, 1.485, -0.041] },
  },
  pose: { armsDown: POSE },
  budget: { totalBytes: 1, maxFileBytes: 1, maxBodyBytes: 1 },
}

const CONFIG: AvatarConfigDto = {
  v: 2,
  body: 'male',
  skin: '#ff0000',
  eyes: '#00ffff',
  hairColor: '#ffff00',
  hair: 'hair_short',
  top: 'top_tee',
  bottom: 'bottom_jeans',
  shoes: 'shoes_sneakers',
}

/**
 * A loader that answers out of a table, sharing one material per canonical name.
 *
 * The sharing is the point of half these assertions: the real loader hands out clones of a scene graph
 * whose materials came out of a per-file cache, so an assembler that tinted them in place would repaint
 * every avatar already on screen.
 */
function stubLoader(): NodeLoader & { shared: Map<string, MeshStandardMaterial>; asked: string[] } {
  const shared = new Map<string, MeshStandardMaterial>()
  const asked: string[] = []

  // Keyed by name *and* colour, exactly as the built files are: several materials in one bundle share a
  // canonical name and differ only in what the build baked into them.
  const material = (name: string, hex: number): MeshStandardMaterial => {
    const key = `${name}#${hex.toString(16)}`
    const existing = shared.get(key)
    if (existing !== undefined) return existing
    const made = new MeshStandardMaterial({ name, color: hex })
    shared.set(key, made)
    return made
  }

  const skinned = (key: string, names: [string, number][]): Object3D => {
    const group = new Group()
    group.name = key
    const root = new Bone()
    root.name = 'root'
    const left = new Bone()
    left.name = 'upperarm_l'
    const right = new Bone()
    right.name = 'upperarm_r'
    root.add(left, right)
    group.add(root)
    const skeleton = new Skeleton([root, left, right])
    for (const [name, hex] of names) {
      const mesh = new SkinnedMesh(new BufferGeometry(), material(name, hex))
      mesh.bind(skeleton)
      group.add(mesh)
    }
    return group
  }

  const plain = (key: string, names: [string, number][]): Object3D => {
    const group = new Group()
    group.name = key
    for (const [name, hex] of names) group.add(new Mesh(new BufferGeometry(), material(name, hex)))
    return group
  }

  const table: Record<string, () => Object3D> = {
    'body/male': () => skinned('body/male', [['skin', 0x888888], ['eyes', 0x333333], ['hair', 0x222222]]),
    'body/female': () => skinned('body/female', [['skin', 0x888888], ['eyes', 0x333333]]),
    'hair/hair_short/male': () => plain('hair/hair_short/male', [['hair', 0x222222]]),
    'hair/hair_short/female': () => plain('hair/hair_short/female', [['hair', 0x222222]]),
    'top/top_tee/male': () =>
      skinned('top/top_tee/male', [['cloth_primary', 0x111111], ['cloth_secondary', 0x123456], ['skin', 0x888888]]),
    'top/top_tee/female': () => skinned('top/top_tee/female', [['cloth_primary', 0x111111]]),
    'bottom/bottom_jeans/male': () => skinned('bottom/bottom_jeans/male', [['cloth_primary', 0x222222]]),
    'bottom/bottom_jeans/female': () => skinned('bottom/bottom_jeans/female', [['cloth_primary', 0x222222]]),
    'shoes/shoes_sneakers/male': () => skinned('shoes/shoes_sneakers/male', [['cloth_primary', 0x333333]]),
    'shoes/shoes_sneakers/female': () => skinned('shoes/shoes_sneakers/female', [['cloth_primary', 0x333333]]),
  }

  return {
    shared,
    asked,
    manifest: () => Promise.resolve(MANIFEST),
    loadNode(key) {
      asked.push(key)
      const make = table[key]
      return Promise.resolve(make === undefined ? null : make())
    },
  }
}

/** Every material in the assembled figure, by its canonical name. */
function paintedBy(root: Object3D): Map<string, MeshStandardMaterial[]> {
  const out = new Map<string, MeshStandardMaterial[]>()
  root.traverse((node) => {
    const mesh = node as Mesh
    if (mesh.isMesh !== true) return
    const material = mesh.material as MeshStandardMaterial
    const held = out.get(material.name) ?? []
    held.push(material)
    out.set(material.name, held)
  })
  return out
}

const boneNamed = (root: Object3D, name: string): Bone => {
  const found = root.getObjectByName(name)
  if (found === undefined) throw new Error(`no bone ${name}`)
  return found as Bone
}

describe('nodeKeysOf', () => {
  it('names the body first and then the slots, in one fixed order', () => {
    expect(nodeKeysOf({ ...CONFIG, hat: 'hat_crown' })).toEqual([
      'body/male',
      'hair/hair_short/male',
      'top/top_tee/male',
      'bottom/bottom_jeans/male',
      'shoes/shoes_sneakers/male',
      'hat/hat_crown/male',
    ])
  })

  it('skips an empty optional slot rather than naming a node with no id in it', () => {
    expect(nodeKeysOf({ ...CONFIG, hat: '', jewelry: undefined })).not.toContain('hat//male')
  })
})

describe('assemble', () => {
  it('asks for the variant of the chosen body, for every slot', async () => {
    const loader = stubLoader()

    const male = await assemble(CONFIG, loader)
    expect(male.keys).toEqual([
      'body/male',
      'hair/hair_short/male',
      'top/top_tee/male',
      'bottom/bottom_jeans/male',
      'shoes/shoes_sneakers/male',
    ])

    loader.asked.length = 0
    const female = await assemble({ ...CONFIG, body: 'female' }, loader)
    expect(loader.asked.every((key) => key.endsWith('/female'))).toBe(true)
    expect(female.body).toBe('female')
    expect(female.bounds?.max[1]).toBe(1.75)
    expect(female.anchors['Head']).toEqual([0, 1.55, -0.011])
  })

  it('drops an item the manifest has no node for, rather than failing to draw a person', async () => {
    const loader = stubLoader()

    const built = await assemble({ ...CONFIG, hat: 'hat_from_the_future' }, loader)

    expect(loader.asked).toContain('hat/hat_from_the_future/male')
    expect(built.keys).not.toContain('hat/hat_from_the_future/male')
    expect(built.group.children.length).toBe(5)
  })

  it('paints skin, eyes and hair from the player and cloth_primary from the item', async () => {
    const built = await assemble(CONFIG, stubLoader())
    const painted = paintedBy(built.group)

    // The body's skin and the tee's bare-forearm skin are both the player's, wherever they appear.
    expect(painted.get('skin')?.map((m) => m.color.getHexString())).toEqual(['ff0000', 'ff0000'])
    expect(painted.get('eyes')?.map((m) => m.color.getHexString())).toEqual(['00ffff'])
    expect(painted.get('hair')?.map((m) => m.color.getHexString())).toEqual(['ffff00', 'ffff00'])
    // `top/top_tee/male` publishes `#00ff00`; the trousers and shoes publish nothing and keep what was baked.
    expect(painted.get('cloth_primary')?.map((m) => m.color.getHexString())).toEqual(['00ff00', '222222', '333333'])
    // Neither the item nor the player owns this one.
    expect(painted.get('cloth_secondary')?.map((m) => m.color.getHexString())).toEqual(['123456'])
  })

  it('clones the materials it paints, leaving the loader’s own untouched', async () => {
    const loader = stubLoader()

    const built = await assemble(CONFIG, loader)

    const source = loader.shared.get('skin#888888')
    expect(source?.color.getHexString()).toBe('888888')
    for (const material of paintedBy(built.group).get('skin') ?? []) expect(material).not.toBe(source)
  })

  it('stands the figure up by turning the named joints, and leaves the rest of the rig alone', async () => {
    const built = await assemble(CONFIG, stubLoader())
    const expected = new Quaternion().setFromEuler(new Euler(0, 0, -1.134, 'XYZ'))

    // Every skinned node has its own copy of the rig, and every one of them has to be posed — a sleeve
    // still in the T-pose while the arm came down is the failure this checks for.
    const top = built.group.getObjectByName('top/top_tee/male')
    expect(top).toBeDefined()
    for (const root of [built.group, top as Object3D]) {
      expect(boneNamed(root, 'upperarm_l').quaternion.angleTo(expected)).toBeLessThan(1e-6)
      expect(boneNamed(root, 'upperarm_r').quaternion.z).toBeCloseTo(Math.sin(1.134 / 2), 6)
      // `root` is not in the pose table, so it keeps the bind orientation.
      expect(boneNamed(root, 'root').quaternion.angleTo(new Quaternion())).toBe(0)
    }
  })

  it('stands up a rig whose joints three.js renamed to keep them unique in their file', () => {
    // `outfits.glb` holds a skeleton per body and both name their joints identically, so `GLTFLoader`
    // hands the second one back as `root_1`, `upperarm_l_1`, … A pose matched on the manifest's names
    // alone therefore posed every male garment and left every female one with its sleeves out sideways.
    const group = new Group()
    const root = new Bone()
    root.name = 'root_1'
    const left = new Bone()
    left.name = 'upperarm_l_1'
    root.add(left)
    group.add(root)
    const mesh = new SkinnedMesh(new BufferGeometry())
    mesh.bind(new Skeleton([root, left]))
    group.add(mesh)

    poseArmsDown(group, POSE)

    expect(left.quaternion.angleTo(new Quaternion().setFromEuler(new Euler(0, 0, -1.134, 'XYZ')))).toBeLessThan(1e-6)
    // `root_1` strips to `root`, which the pose table has never named; the suffix is not a licence to
    // turn joints the pose says nothing about.
    expect(root.quaternion.angleTo(new Quaternion())).toBe(0)
  })

  it('leaves an unskinned node — hair, an accessory — where the build baked it', async () => {
    const built = await assemble(CONFIG, stubLoader())

    const hair = built.group.getObjectByName('hair/hair_short/male')
    expect(hair).toBeDefined()
    expect((hair as Object3D).getObjectByName('root')).toBeUndefined()
  })

  it('drops an item whose bundle would not load, rather than losing the whole person to it', async () => {
    const loader = stubLoader()
    const inner = loader.loadNode.bind(loader)
    loader.loadNode = (key) =>
      key.startsWith('shoes/') ? Promise.reject(new Error('accessories.glb answered 404')) : inner(key)

    const built = await assemble(CONFIG, loader)

    // The same answer as for an item the manifest does not carry: wear nothing there.
    expect(built.keys).toEqual(['body/male', 'hair/hair_short/male', 'top/top_tee/male', 'bottom/bottom_jeans/male'])
    expect(built.group.children).toHaveLength(4)
  })

  it('fails when the body itself will not load, because there is no picture without it', async () => {
    const loader = stubLoader()
    loader.loadNode = (key) => (key === 'body/male' ? Promise.reject(new Error('body-male.glb answered 503')) : Promise.resolve(null))

    await expect(assemble(CONFIG, loader)).rejects.toThrow('503')
  })
})

/**
 * What a finished portrait gives back.
 *
 * Both halves matter for the same reason: the renderer is a singleton that outlives every screen, so
 * anything an assembly leaves on the GPU is leaked for the life of the page — and neither three nor the
 * browser will collect it, because three's GPU bookkeeping is a `WeakMap` with no finaliser.
 */
describe('disposeAssembled', () => {
  const skeletonsOf = (root: Object3D): Set<Skeleton> => {
    const found = new Set<Skeleton>()
    root.traverse((node) => {
      const mesh = node as SkinnedMesh
      if (mesh.isSkinnedMesh === true) found.add(mesh.skeleton)
    })
    return found
  }

  it('releases the bone texture of every skeleton in the assembly', async () => {
    const built = await assemble(CONFIG, stubLoader())

    // Four skinned nodes, four copies of the rig — and three r170 gives each of them its own bone
    // `DataTexture` the first time it draws it. Standing one in for the renderer here is what lets the
    // release be observed at all: `Skeleton.dispose()` is exactly "dispose the bone texture".
    const skeletons = skeletonsOf(built.group)
    expect(skeletons.size).toBe(4)
    const released: string[] = []
    let at = 0
    for (const skeleton of skeletons) {
      const texture = new DataTexture()
      texture.name = `bones-${(at += 1)}`
      texture.addEventListener('dispose', () => released.push(texture.name))
      skeleton.boneTexture = texture
    }

    disposeAssembled(built.group)

    expect(released.sort()).toEqual(['bones-1', 'bones-2', 'bones-3', 'bones-4'])
    for (const skeleton of skeletons) expect(skeleton.boneTexture).toBeNull()
  })

  it('disposes the assembly’s own materials and not the loader’s shared originals', async () => {
    const loader = stubLoader()
    const built = await assemble(CONFIG, loader)

    const disposed: string[] = []
    for (const [name, material] of loader.shared) {
      material.addEventListener('dispose', () => disposed.push(`shared:${name}`))
    }
    let clones = 0
    built.group.traverse((node) => {
      const mesh = node as Mesh
      if (mesh.isMesh !== true) return
      clones += 1
      ;(mesh.material as MeshStandardMaterial).addEventListener('dispose', () => disposed.push('clone'))
    })

    disposeAssembled(built.group)

    expect(disposed).toEqual(Array.from({ length: clones }, () => 'clone'))
  })

  it('leaves the geometry alone, because the per-file cache still owns it', async () => {
    const built = await assemble(CONFIG, stubLoader())

    const geometries: BufferGeometry[] = []
    const disposed: BufferGeometry[] = []
    built.group.traverse((node) => {
      const mesh = node as Mesh
      if (mesh.isMesh !== true) return
      geometries.push(mesh.geometry)
      mesh.geometry.addEventListener('dispose', () => disposed.push(mesh.geometry))
    })

    disposeAssembled(built.group)

    expect(geometries.length).toBeGreaterThan(0)
    expect(disposed).toEqual([])
  })
})
