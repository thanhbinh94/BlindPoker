import { Euler, Group, Mesh, Object3D, Quaternion, Skeleton, SkinnedMesh, type Material, type MeshStandardMaterial } from 'three'
import { GEOMETRIC_SLOTS, type AvatarConfigDto, type Body } from '../api.js'
import type { AvatarManifest, ManifestBounds, NodeLoader, Triple } from './assets.js'

/**
 * A configuration turned into a scene: one `Group` holding a body and the items worn on it, recoloured
 * and standing up (avatar-3d design §3.1, `docs/avatar-assets.md`).
 *
 * This is the only place that knows how a `AvatarConfigDto` becomes geometry, and it is deliberately
 * ignorant of *why* — no camera, no renderer, no canvas. The portrait renderer and Task 4's stage both
 * call it and frame the result differently.
 *
 * Three rules, all of them from the asset pipeline:
 *
 * - **A node key is `<slot>/<itemId>/<body>`, and the body decides the variant.** An item that has not
 *   been modelled for the chosen body simply does not appear: the source packs are not symmetric, the
 *   server refuses to *equip* such an item, and a configuration that predates that check must still
 *   draw a person rather than throw.
 * - **The player owns three colours and the item owns the rest.** `skin`, `eyes` and `hair` are
 *   recoloured from the configuration wherever they appear — including on a garment that carries part
 *   of a bare forearm — and `cloth_primary` takes the item's published tint. `cloth_secondary` and
 *   `metal` keep what the build baked, which is the item's own second colour.
 * - **The geometry ships in a T-pose.** `manifest.pose.armsDown` is the recipe for standing it up, in
 *   each joint's own bind frame, and nothing renders standing until it has been applied.
 *
 * Materials are cloned per assembly, geometry is not. Two portraits of the same body share one set of
 * buffers and have their own colours, which is the whole reason a wardrobe can preview eight tops
 * without eight copies of a mesh.
 */

export interface Assembled {
  /** The figure, at the origin, in metres, in the manifest's own frame. */
  group: Group
  body: Body
  /** The body node's bounds, or `null` when the body node itself could not be loaded. */
  bounds: ManifestBounds | null
  /** That body's joint anchors — what a camera aims at. */
  anchors: Record<string, Triple>
  /** The node keys that actually produced geometry, in draw order. Useful in a test and in a log. */
  keys: string[]
}

/** `body/male` and `body/female` are the two keys that are not `<slot>/<item>/<body>`. */
export const bodyKey = (body: Body): string => `body/${body}`

/**
 * Every node key a configuration names, body first and then the slots in the assembler's order.
 *
 * Order is not cosmetic: it is what makes two assemblies of the same configuration produce the same
 * scene graph, which is what makes a portrait of it reproducible.
 */
export function nodeKeysOf(config: AvatarConfigDto): string[] {
  const keys = [bodyKey(config.body)]
  for (const slot of GEOMETRIC_SLOTS) {
    const itemId = config[slot]
    if (itemId === undefined || itemId === '') continue
    keys.push(`${slot}/${itemId}/${config.body}`)
  }
  return keys
}

const isMesh = (node: Object3D): node is Mesh => (node as Mesh).isMesh === true

const isSkinnedMesh = (node: Object3D): node is SkinnedMesh => (node as SkinnedMesh).isSkinnedMesh === true

const hasColor = (material: Material): material is MeshStandardMaterial =>
  (material as MeshStandardMaterial).color !== undefined

/**
 * The colour a material takes, by its canonical name — the six names the build guarantees.
 *
 * `undefined` means "keep what was baked", which is the answer for `cloth_secondary`, `metal`, an item
 * with no published tint, and any name this bundle does not recognise.
 */
function colourOf(name: string, config: AvatarConfigDto, tint: string | undefined): string | undefined {
  switch (name) {
    case 'skin':
      return config.skin
    case 'eyes':
      return config.eyes
    case 'hair':
      return config.hairColor
    case 'cloth_primary':
      return tint
    default:
      return undefined
  }
}

/**
 * Recolour one loaded node in place, cloning every material it touches.
 *
 * The clone is not an optimisation to remove later: the materials come out of the per-file cache and
 * are shared by every portrait ever assembled from that file. Tinting one in place would repaint every
 * avatar already on screen.
 */
function recolour(node: Object3D, config: AvatarConfigDto, tint: string | undefined): void {
  node.traverse((child) => {
    if (!isMesh(child)) return
    const paint = (material: Material): Material => {
      const copy = material.clone()
      const colour = colourOf(copy.name, config, tint)
      // `Color.set` reads `#rrggbb` as sRGB and converts into three's linear working space, which is
      // the same conversion the build applied to the tints it baked.
      if (colour !== undefined && hasColor(copy)) copy.color.set(colour)
      return copy
    }
    child.material = Array.isArray(child.material) ? child.material.map(paint) : paint(child.material)
  })
}

/**
 * Stand the figure up.
 *
 * The angles are *relative* rotations in each joint's own bind frame — the packs' bind pose is a
 * T-pose, and what `manifest.pose.armsDown` publishes is how far to turn four joints from it. So the
 * quaternion is multiplied onto what the bone already carries rather than replacing it; `rotation.set`
 * would throw the bind orientation away and put the arms somewhere neither pack intended.
 *
 * Every skeleton under the root is posed, not just the body's: a garment carries its own copy of the
 * rig (see `assets.ts`), and a sleeve that stayed in the T-pose while the arm came down is the failure
 * this loop exists to avoid.
 */
export function poseArmsDown(root: Object3D, pose: Record<string, Triple>): void {
  const done = new Set<Skeleton>()
  const turn = new Quaternion()
  const angles = new Euler()

  root.traverse((node) => {
    if (!isSkinnedMesh(node) || done.has(node.skeleton)) return
    done.add(node.skeleton)
    for (const bone of node.skeleton.bones) {
      const rotation = pose[bone.name]
      if (rotation === undefined) continue
      angles.set(rotation[0], rotation[1], rotation[2], 'XYZ')
      bone.quaternion.multiply(turn.setFromEuler(angles))
    }
  })

  root.updateMatrixWorld(true)
  for (const skeleton of done) skeleton.update()
}

/**
 * Build the scene for one configuration.
 *
 * Every node is requested at once and added in `nodeKeysOf` order, so the shared per-file cache is hit
 * once per bundle rather than once per item and the resulting graph is still deterministic.
 */
export async function assemble(config: AvatarConfigDto, loader: NodeLoader): Promise<Assembled> {
  const manifest: AvatarManifest = await loader.manifest()
  const wanted = nodeKeysOf(config)
  const loaded = await Promise.all(wanted.map((key) => loader.loadNode(key)))

  const group = new Group()
  group.name = `avatar/${config.body}`
  const keys: string[] = []

  loaded.forEach((node, at) => {
    if (node === null) return
    const key = wanted[at]!
    recolour(node, config, manifest.nodes[key]?.tint)
    group.add(node)
    keys.push(key)
  })

  poseArmsDown(group, manifest.pose.armsDown)

  return {
    group,
    body: config.body,
    bounds: manifest.nodes[bodyKey(config.body)]?.bounds ?? null,
    anchors: manifest.anchors[config.body] ?? {},
    keys,
  }
}

/**
 * Release what an assembly allocated on the GPU.
 *
 * Materials only. The geometry belongs to the per-file cache and is shared by every assembly made from
 * that bundle, so disposing it here would empty the cache under the next portrait's feet.
 */
export function disposeAssembled(root: Object3D): void {
  root.traverse((node) => {
    if (!isMesh(node)) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    for (const material of materials) material.dispose()
  })
}
