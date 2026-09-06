import { Bone, Group, Object3D, PropertyBinding, Skeleton, SkinnedMesh } from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * The five `.glb` bundles and the manifest that indexes them (`docs/avatar-assets.md`).
 *
 * This module is the only thing in the app that knows a glTF file exists. It publishes two things and
 * nothing else: the manifest as data, and `loadNode(key)` — one node out of one bundle, detached from
 * everything it shipped beside, ready to be dropped into a scene of its own.
 *
 * Three properties of the built assets shape all of it:
 *
 * - **The files are `EXT_meshopt_compression`.** `GLTFLoader` throws on them unless the decoder is
 *   wired first, so `setMeshoptDecoder` happens where the loader is built rather than at a call site
 *   that could forget. `manifest.compression` is asserted rather than assumed, so a `--no-meshopt`
 *   rebuild (which writes `quantize`) is read the same way and anything else is refused loudly.
 * - **One file holds many nodes, and a skeleton is shared between them.** `outfits.glb` is fourteen
 *   garments per body over *one* skeleton each — deliberately, it is 116 KB of duplicate matrices
 *   otherwise. A skinned mesh lifted out of that file therefore cannot simply be re-parented: its
 *   bones would still belong to the file's own scene, and the garment beside it would be sharing
 *   them. `detach` gives every node its own copy of the bones it is rigged to, which is what lets the
 *   assembler pose a top and a pair of trousers independently.
 * - **Geometry and materials are immutable and shared.** A clone here copies the scene graph, never
 *   the buffers. Recolouring is `assemble`'s job and it clones the materials it is about to tint.
 *
 * Everything is cached by promise rather than by value, so eight seat plates that all want
 * `body/male` at once cause one download.
 */

/** Where the asset build's output is served from; `vite` copies `public/avatar3d/` here verbatim. */
export const AVATAR_ASSET_BASE = '/avatar3d/'

export interface ManifestBounds {
  /** Metres, in the same frame as `anchors` — captured before quantization, so they are real metres. */
  min: [number, number, number]
  max: [number, number, number]
}

export interface ManifestNode {
  file: string
  /** Uncompressed accessor bytes attributed to this node; a way to decide what to load, not a size. */
  bytes: number
  bounds: ManifestBounds
  /** The item's baked `cloth_primary` colour, where it has one. */
  tint?: string
}

/** A joint's bind position, or a pose rotation: `[x, y, z]`. */
export type Triple = [number, number, number]

export interface AvatarManifest {
  version: number
  generatedAt: string
  placeholder: boolean
  compression: string
  mapSha256: string
  files: Record<string, { bytes: number; sha256: string; skins?: number }>
  nodes: Record<string, ManifestNode>
  /** The six canonical material names, and only those, appear on the meshes. */
  materials: string[]
  /** Bind positions of the joints a camera or a stage wants, per body. */
  anchors: Record<string, Record<string, Triple>>
  /** Relative joint rotations, Euler XYZ radians, in each joint's own bind frame. */
  pose: { armsDown: Record<string, Triple> }
  budget: { totalBytes: number; maxFileBytes: number; maxBodyBytes: number }
}

/** What `assemble` needs, and all that a test has to stub. */
export interface NodeLoader {
  manifest(): Promise<AvatarManifest>
  /** A detached copy of one node, or `null` for a key the manifest or the file does not carry. */
  loadNode(key: string): Promise<Object3D | null>
}

/** The compressions this loader can read — the two the asset build emits. */
const READABLE = new Set(['meshopt', 'quantize'])

let base = AVATAR_ASSET_BASE
let manifestPromise: Promise<AvatarManifest> | null = null
let loaderInstance: GLTFLoader | null = null
const fileNodes = new Map<string, Promise<Map<string, Object3D>>>()

/**
 * Claim the decoder's own start-up rejection.
 *
 * `MeshoptDecoder` calls `WebAssembly.instantiate` at module scope and attaches no rejection handler to
 * the promise it keeps. Under a Content-Security-Policy without `wasm-unsafe-eval` that instantiation
 * rejects, and the browser reports an `Uncaught (in promise)` in the console — even though every
 * portrait then falls back to its initial letter exactly as designed. The decode still fails and
 * `loadNode` still rejects; what this removes is a console error that says the app is broken when the
 * only thing that happened is that this browser will not run the pictures.
 */
void Promise.resolve(MeshoptDecoder.ready).catch(() => undefined)

function loader(): GLTFLoader {
  if (loaderInstance === null) {
    loaderInstance = new GLTFLoader()
    // Without this the five committed bundles do not open at all. `MeshoptDecoder` is a small WASM
    // blob and lives in this chunk beside the loader, never in the entry.
    loaderInstance.setMeshoptDecoder(MeshoptDecoder)
  }
  return loaderInstance
}

async function fetchManifest(): Promise<AvatarManifest> {
  const res = await fetch(`${base}manifest.json`)
  if (!res.ok) throw new Error(`avatar manifest ${base}manifest.json answered ${res.status}`)
  const manifest = (await res.json()) as AvatarManifest
  if (!READABLE.has(manifest.compression)) {
    throw new Error(`avatar manifest declares compression ${manifest.compression}, which this loader cannot read`)
  }
  return manifest
}

/**
 * The manifest, fetched once — but **only a success is remembered**.
 *
 * Memoising the promise is what makes eight seat plates cost one request. Memoising a *rejected* one
 * would make a single 503, or one aborted request while a phone changes network, poison the page: every
 * later `assemble` would settle on the same failure and every portrait everywhere would be the initial
 * letter until a reload. So the entry is cleared on the way out of a rejection, and the next portrait
 * anybody actually asks for is the retry. No budget and no backoff: a browser that keeps failing keeps
 * showing letters, which is the designed fallback, and each attempt is one small `GET`.
 */
export function loadManifest(): Promise<AvatarManifest> {
  manifestPromise ??= fetchManifest().catch((cause: unknown) => {
    manifestPromise = null
    throw cause
  })
  return manifestPromise
}

const isSkinnedMesh = (node: Object3D): node is SkinnedMesh => (node as SkinnedMesh).isSkinnedMesh === true

const isBone = (node: Object3D): node is Bone => (node as Bone).isBone === true

/**
 * A copy of one skeleton, its bones parented into `into`, ready for a mesh to be bound to.
 *
 * The roots are the joints whose parent is not itself a joint — one (`root`) in both packs' rigs, but
 * read off the graph because assuming it costs nothing to avoid. `boneInverses` is shared rather than
 * copied: it is the bind pose, which is the one thing about a skeleton that never moves.
 */
function copySkeleton(into: Object3D, skeleton: Skeleton): Skeleton {
  const joints = new Set<Object3D>(skeleton.bones)
  const byName = new Map<string, Bone>()
  for (const bone of skeleton.bones) {
    if (bone.parent !== null && joints.has(bone.parent)) continue
    const copy = bone.clone(true)
    copy.traverse((node) => {
      if (isBone(node)) byName.set(node.name, node)
    })
    into.add(copy)
  }
  // Joint names are unique across both packs' rigs, which is what makes the copies findable by name. A
  // joint the clone somehow missed keeps the original bone rather than leaving a hole in the array:
  // `Skeleton` indexes by position, and a gap there deforms the mesh rather than failing.
  return new Skeleton(
    skeleton.bones.map((bone) => byName.get(bone.name) ?? bone),
    skeleton.boneInverses,
  )
}

/**
 * One node, standing on its own.
 *
 * The scene graph is copied and the buffers are not: `Object3D.clone` shares geometry and materials,
 * which is what makes a second portrait of the same body cheap. What it does *not* do is give a skinned
 * mesh its own bones — the clone keeps pointing at the ones its file's other thirteen garments are
 * using — so every distinct skeleton under the node is copied and re-bound here. That is three's
 * `SkeletonUtils.clone`, narrowed to a subtree.
 *
 * A node may be a `SkinnedMesh`, a plain `Mesh`, a `Group` of several primitives, or (for `hair_none`)
 * an empty `Object3D`; all four come through the same path.
 *
 * `frustumCulled` goes off on everything: a skinned mesh's bounding volume is computed from the bind
 * pose, and the assembler is about to rotate the arms out of it. A portrait that renders an empty frame
 * because the culler disagreed with the pose is not a failure anything downstream could diagnose.
 */
function detach(source: Object3D): Object3D {
  const group = new Group()
  group.name = source.name
  const copy = source.clone(true)

  const skinned: SkinnedMesh[] = []
  copy.traverse((node) => {
    node.frustumCulled = false
    if (isSkinnedMesh(node)) skinned.push(node)
  })

  const rebound = new Map<Skeleton, Skeleton>()
  for (const mesh of skinned) {
    let replacement = rebound.get(mesh.skeleton)
    if (replacement === undefined) {
      replacement = copySkeleton(group, mesh.skeleton)
      rebound.set(mesh.skeleton, replacement)
    }
    mesh.bind(replacement, mesh.bindMatrix)
  }

  group.add(copy)
  return group
}

/**
 * What a node key is called inside the loaded scene.
 *
 * `GLTFLoader` runs every node name through `PropertyBinding.sanitizeNodeName`, which strips the
 * characters an animation track path reserves — `/` among them. So the manifest's `body/male` arrives
 * as `bodymale`, and looking a node up by the key the manifest publishes finds nothing at all. This is
 * three's own function rather than a copy of its regular expression, so the two cannot drift.
 */
const sceneName = (key: string): string => PropertyBinding.sanitizeNodeName(key)

/** One bundle's top-level nodes, read once — and, as with the manifest, only a success is kept. */
async function nodesOf(file: string): Promise<Map<string, Object3D>> {
  const cached = fileNodes.get(file)
  if (cached !== undefined) return cached
  const pending = (async () => {
    const gltf = await loader().loadAsync(`${base}${file}`)
    gltf.scene.updateMatrixWorld(true)
    const out = new Map<string, Object3D>()
    // Direct children only. A node's own primitives are named after it with a `_1` suffix, and joints
    // are named after the rig; indexing the whole tree would put both in the way of a lookup.
    for (const node of gltf.scene.children) {
      if (node.name !== '' && !isBone(node)) out.set(node.name, node)
    }
    return out
  })().catch((cause: unknown) => {
    // A `.glb` that failed to arrive must not be a permanent verdict on the items inside it.
    if (fileNodes.get(file) === pending) fileNodes.delete(file)
    throw cause
  })
  fileNodes.set(file, pending)
  return pending
}

/** The shared loader. Reads each file once, and hands out a detached copy of a node per call. */
export const assetLoader: NodeLoader = {
  manifest: loadManifest,
  async loadNode(key) {
    const manifest = await loadManifest()
    const entry = manifest.nodes[key]
    if (entry === undefined) return null
    const source = (await nodesOf(entry.file)).get(sceneName(key))
    // A node the manifest names but the file does not carry: a future item could be pruned out of its
    // bundle, and the answer is the same as for an item this bundle has never heard of — wear nothing
    // there. (`hair_none` *is* in the file, as a node with no geometry, and comes through as one.)
    return source === undefined ? null : detach(source)
  },
}

/**
 * Points the loader at a different origin and forgets everything read from the old one.
 *
 * The base is a parameter only so that a Playwright run against a preview build and a future
 * storybook-style harness do not have to serve `/avatar3d/` from the document root. Nothing in the
 * app calls it.
 */
export function setAvatarAssetBase(next: string): void {
  base = next
  manifestPromise = null
  fileNodes.clear()
}
