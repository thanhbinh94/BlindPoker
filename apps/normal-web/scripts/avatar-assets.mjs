#!/usr/bin/env node
/**
 * The avatar asset pipeline: CC0 source packs in → five `.glb` files and a `manifest.json` out.
 *
 *   node scripts/avatar-assets.mjs                 build `public/avatar3d/` from `scripts/avatar-map.json`
 *   node scripts/avatar-assets.mjs --check         verify the committed output against the map; no writes
 *   node scripts/avatar-assets.mjs --list <path>   print the node, material and joint names of a source
 *                                                  glTF (or every glTF under a directory), which is how
 *                                                  a new `avatar-map.json` entry gets its `node` name
 *   …--no-meshopt                                  write plain KHR_mesh_quantization instead (see below)
 *
 * Why a build step at all (design §4). The packs are ~400 MB of rigged FBX/glTF with 2K textures, split
 * across a dozen files whose mesh names mean something to a Blender file and nothing to this app. What
 * the browser wants is the opposite: a handful of same-origin `.glb` files it can cache forever, whose
 * nodes are named after *our* item ids (`top/clothing_aodai/female`) and whose materials are named after
 * the six things a player can recolour. That renaming is the whole point — after this script runs, no
 * other file in the repository needs to know a source mesh exists.
 *
 * What each node loses on the way through: every animation, its texture coordinates, and its textures.
 * Textures go because they cannot survive the budget without a resizer — `sharp` is not installed and
 * the packs' base-colour maps are 1.3–4 MB each — and, more importantly, because they would fight the
 * feature: the body's base colour map bakes in *one* skin tone, and the player picks from eight. Flat
 * PBR materials with a `baseColorFactor` are what a runtime tint can actually address.
 *
 * What each node *keeps* is its skin. Bodies and outfit parts come out with `JOINTS_0`/`WEIGHTS_0` and a
 * skeleton, so the renderer can pose the arms at load time (design §4 wants a standing pose, and the
 * bind pose the packs ship is a T-pose). Hair and the generated accessories stay unskinned at the bind
 * position: only the arms are ever rotated, and nothing that sits on the head moves when they are. The
 * angles to rotate by are published in the manifest as `pose.armsDown` — see `ARMS_DOWN` below.
 *
 * `outfits.glb` carries **one skeleton per body**, shared by all fourteen garments of that body rather
 * than one skin each: 28 copies of a 65-joint inverse-bind-matrix accessor would be 116 KB of the file's
 * 1.5 MB budget. The two bodies keep their own (the base pack's rig is 2 cm wider at the shoulder than
 * the outfit pack's, so they are genuinely different skeletons — but a *pose* is a relative rotation, so
 * turning `upperarm_l` by the same angle in both keeps garment and body together).
 *
 * Compression: `weld` → `meshopt` (EXT_meshopt_compression, which is `reorder` + `quantize` — positions
 * at 14 bits and normals at 8 — plus the extension) → skin dedupe → `dedup` → `prune`. Meshopt is **on by
 * default** because of what the skins cost: measured, `--no-meshopt` gives 1496 KB for `outfits.glb`
 * against a 1536 KB per-file budget (97 % of it, no room for another garment) and 2309 KB across the five
 * files; meshopt gives 630 KB and 1017 KB. The manifest records `compression: 'meshopt'` so the loader
 * knows it must wire `MeshoptDecoder` before reading these files — three.js' `GLTFLoader` throws
 * otherwise, where it reads plain KHR_mesh_quantization unaided. `--no-meshopt` is the escape hatch if
 * that decoder ever becomes a problem; it still builds, with nothing left over for the next item.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, quantize, weld } from '@gltf-transform/functions'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..')
const SRC_DIR = resolve(REPO_ROOT, 'assets/avatar-src')
const EXTRACT_DIR = join(SRC_DIR, 'extracted')
const OUT_DIR = resolve(PACKAGE_ROOT, 'public/avatar3d')
/**
 * Everything is written here first and only becomes `public/avatar3d/` once the budgets have held.
 * Under `node_modules/` rather than beside the output so a half-finished build is never served by the
 * dev server, never shows up in `git status`, and never has to be cleaned up by hand.
 */
const TMP_DIR = resolve(PACKAGE_ROOT, 'node_modules/.cache/avatar-assets')
const MAP_FILE = resolve(PACKAGE_ROOT, 'scripts/avatar-map.json')
const MANIFEST_FILE = join(OUT_DIR, 'manifest.json')

/** Spec §7: everything the avatar downloads, the largest single file, and the tighter body limit (§4). */
const MAX_TOTAL_BYTES = 6 * 1024 * 1024
const MAX_FILE_BYTES = Math.round(1.5 * 1024 * 1024)
const MAX_BODY_BYTES = 400 * 1024

/** The two bodies, and the node key each item variant is written under. */
const BODIES = ['male', 'female']
const KEY_RE = /^(body\/(male|female)|(hair|top|bottom|shoes|hat|accessory|jewelry)\/[a-z0-9_]+\/(male|female))$/

/** The joints a camera wants: `manifest.anchors[body][joint]` is that joint's bind position, in metres. */
const ANCHOR_JOINTS = ['Head', 'neck_01', 'upperarm_l', 'upperarm_r', 'hand_l', 'hand_r', 'pelvis']

/**
 * The standing pose, published as `manifest.pose.armsDown`.
 *
 * Read it as: rotate this joint by these radians **in its own bind frame**, i.e. compose the rotation
 * *after* the bind rotation — `bone.rotation.set(x, y, z)` on a bone whose rotation is still the bind
 * one is wrong; `bone.quaternion.multiply(new Quaternion().setFromEuler(new Euler(x, y, z)))` (which is
 * what three.js' `bone.rotateX/Y/Z` do) is right. The same four numbers work on the body skeleton and on
 * the outfit skeleton because a pose is relative and both rigs orient their arm joints identically.
 *
 * Where the numbers come from, since there is no renderer in this pipeline to look at: in every rig in
 * both packs an arm joint's local **+Y** is the bone axis (`lowerarm_l` sits at local `[0, 0.251, 0]` of
 * `upperarm_l`) and its local +Z is world +Z, the direction the avatar faces. `upperarm_l`'s world basis
 * is columns X=(0,−1,0), Y=(1,0,0), Z=(0,0,1), so a rotation of θ about its local Z sends the bone
 * direction to world (cos θ, sin θ, 0): θ = −65° drops the left arm to 65° below horizontal, ~25° off
 * the body. `upperarm_r` mirrors (its local X is world +Y), hence the opposite sign. The forearms add a
 * ~10° bend about local X, which is forward for both arms, so the hands come slightly in front of the
 * hips instead of clipping into them. Task 4 should treat these as a starting point and tune by eye.
 */
const ARMS_DOWN = {
  upperarm_l: [0, 0, -1.134],
  upperarm_r: [0, 0, 1.134],
  lowerarm_l: [0.17, 0, -0.09],
  lowerarm_r: [0.17, 0, 0.09],
}

const fail = (message) => {
  console.error(`[avatar-assets] ${message}`)
  process.exitCode = 1
  throw new Error(message)
}

// ───────────────────────────────────────────────────────────── source packs ──

/**
 * glTF reader that only fetches `.bin` payloads.
 *
 * Two reasons. The packs ship glTF whose `images` point at file names that are not in the archive
 * (`T_Hair_1_Normal_png.png` beside a `T_Hair_1_Normal.png`), which stops `NodeIO` dead; and even the
 * images that *are* there are 40 MB of PNG this pipeline throws away a moment later. Handing back an
 * empty view for every non-`.bin` resource keeps the read fast and total.
 */
const GEOMETRY_EXT = new Set(['.gltf', '.glb', '.bin'])

class GeometryOnlyIO extends NodeIO {
  async readURI(uri, type) {
    // The document itself (`.gltf`/`.glb`) and its geometry payload (`.bin`) are read for real; every
    // other resource beside them is an image, and gets an empty view.
    if (GEOMETRY_EXT.has(extname(uri).toLowerCase())) return super.readURI(uri, type)
    return type === 'view' ? new Uint8Array(0) : ''
  }
}

const io = new GeometryOnlyIO().registerExtensions(ALL_EXTENSIONS)

/** Unpack any archive in `assets/avatar-src/` that has no directory of the same name under `extracted/`. */
function ensureExtracted(sources) {
  mkdirSync(EXTRACT_DIR, { recursive: true })
  for (const source of sources) {
    const archive = join(SRC_DIR, source.archive)
    const stem = basename(source.archive, '.zip')
    if (existsSync(join(EXTRACT_DIR, stem))) continue
    if (!existsSync(archive)) fail(`missing source pack ${source.archive} — see assets/avatar-src/README.md`)
    console.log(`[avatar-assets] unpacking ${source.archive}`)
    // `unzip` on a developer machine, Windows' bundled `tar` (which reads zip) as the fallback.
    try {
      execFileSync('unzip', ['-o', '-q', archive, '-d', EXTRACT_DIR], { stdio: 'inherit' })
    } catch {
      execFileSync('tar', ['-xf', archive, '-C', EXTRACT_DIR], { stdio: 'inherit' })
    }
  }
}

/** Verify the archives on disk still are the ones the map was written against. */
function verifySources(sources) {
  for (const source of sources) {
    const archive = join(SRC_DIR, source.archive)
    if (!existsSync(archive)) continue // already unpacked by hand; `extracted/` is what the build reads
    const actual = createHash('sha256').update(readFileSync(archive)).digest('hex')
    if (actual !== source.sha256) {
      fail(`${source.archive} has sha256 ${actual}, the map expects ${source.sha256} — update assets/avatar-src/README.md if this is a new release`)
    }
  }
}

/**
 * `@parts/Male_Ranger_Body.gltf` → an absolute path under `extracted/`.
 *
 * A bare alias (`@parts`, `@parts/`) resolves to the directory itself, which is what `--list` wants when
 * you are looking for a mesh name and do not yet know which file it is in.
 */
function resolveSource(map, spec) {
  const hit = /^@([a-z]+)(?:\/(.*))?$/.exec(spec)
  if (!hit) return resolve(EXTRACT_DIR, spec)
  const dir = map.dirs[hit[1]]
  if (!dir) fail(`unknown source directory alias @${hit[1]} in ${spec}`)
  return join(EXTRACT_DIR, dir, hit[2] || '.')
}

const docCache = new Map()
async function sourceDoc(path) {
  if (!docCache.has(path)) {
    if (!existsSync(path)) fail(`source file not found: ${relative(REPO_ROOT, path)}`)
    docCache.set(path, await io.read(path))
  }
  return docCache.get(path)
}

// ──────────────────────────────────────────────────────────────── 3×3 / 4×4 ──
// Just enough linear algebra to bake a node's world transform into its vertices. glTF matrices are
// column-major, and so are these.

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function multiply(a, b) {
  const out = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k]
      out[c * 4 + r] = sum
    }
  }
  return out
}

const transformPoint = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
]

/** transpose(inverse(upper-left 3×3)) — the matrix that keeps normals perpendicular under a scale. */
function normalMatrix(m) {
  const a = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]
  const det =
    a[0] * (a[4] * a[8] - a[5] * a[7]) - a[3] * (a[1] * a[8] - a[2] * a[7]) + a[6] * (a[1] * a[5] - a[2] * a[4])
  if (Math.abs(det) < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  // inverse, then transpose — written out so the two steps cancel into one indexing pass
  return [
    (a[4] * a[8] - a[5] * a[7]) / det,
    (a[5] * a[6] - a[3] * a[8]) / det,
    (a[3] * a[7] - a[4] * a[6]) / det,
    (a[2] * a[7] - a[1] * a[8]) / det,
    (a[0] * a[8] - a[2] * a[6]) / det,
    (a[1] * a[6] - a[0] * a[7]) / det,
    (a[1] * a[5] - a[2] * a[4]) / det,
    (a[2] * a[3] - a[0] * a[5]) / det,
    (a[0] * a[4] - a[1] * a[3]) / det,
  ]
}

function transformNormal(n3, v) {
  const x = n3[0] * v[0] + n3[3] * v[1] + n3[6] * v[2]
  const y = n3[1] * v[0] + n3[4] * v[1] + n3[7] * v[2]
  const z = n3[2] * v[0] + n3[5] * v[1] + n3[8] * v[2]
  const len = Math.hypot(x, y, z) || 1
  return [x / len, y / len, z / len]
}

/** Full 4×4 inverse (column-major), for turning a joint's world matrix into a parent-relative one. */
function invert(m) {
  const inv = new Array(16)
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10]
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10]
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9]
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9]
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10]
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10]
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9]
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9]
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6]
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6]
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5]
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5]
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6]
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6]
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5]
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5]
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12]
  if (Math.abs(det) < 1e-12) fail('a joint matrix is not invertible')
  return inv.map((v) => v / det)
}

/** Bind-pose world position of a joint: the translation of inverse(inverseBindMatrix). */
function inverseTranslation(m) {
  const n = normalMatrix(m) // = transpose(inverse(R)); inverse(R) = transpose(n)
  const t = [m[12], m[13], m[14]]
  return [
    -(n[0] * t[0] + n[1] * t[1] + n[2] * t[2]),
    -(n[3] * t[0] + n[4] * t[1] + n[5] * t[2]),
    -(n[6] * t[0] + n[7] * t[1] + n[8] * t[2]),
  ]
}

// ─────────────────────────────────────────────────────────── geometry parts ──
// A "part" is one primitive's worth of raw geometry, already in body space: positions, normals,
// triangle indices and the name of the canonical material it should end up on.

/** Every mesh-bearing node of a source document, by name. */
function findNode(doc, name, path) {
  const node = doc.getRoot().listNodes().find((n) => n.getName() === name)
  if (!node) fail(`node "${name}" not found in ${relative(REPO_ROOT, path)} — run --list on it`)
  return node
}

/**
 * The skeleton behind a skinned node, as plain arrays: joint names, each joint's parent-relative bind
 * matrix, and the inverse bind matrices the vertices were weighted against.
 *
 * Locals are derived from *world* matrices (`inverse(parentWorld) · world`) rather than copied from the
 * source nodes' own TRS, because the packs park their skeletons under an `Armature` node whose transform
 * is part of the bind pose the inverse bind matrices were baked against. Rebuilding from worlds keeps
 * `jointWorld · inverseBind = identity` at rest — which is what makes the output render, unposed,
 * exactly as it did when the skin was thrown away.
 */
function readSkeleton(skin, path) {
  const joints = skin.listJoints()
  const ibmAccessor = skin.getInverseBindMatrices()
  if (!ibmAccessor) fail(`skin "${skin.getName()}" in ${relative(REPO_ROOT, path)} has no inverse bind matrices`)
  const index = new Map(joints.map((joint, i) => [joint, i]))
  const worlds = joints.map((joint) => [...joint.getWorldMatrix()])
  const parents = joints.map((joint) => {
    const parent = joint.getParentNode()
    return parent && index.has(parent) ? index.get(parent) : -1
  })
  const locals = joints.map((_, i) => (parents[i] >= 0 ? multiply(invert(worlds[parents[i]]), worlds[i]) : worlds[i]))
  const ibm = new Float32Array(joints.length * 16)
  for (let i = 0; i < joints.length; i++) ibm.set(ibmAccessor.getElement(i, new Array(16)), i * 16)
  const names = joints.map((joint) => joint.getName())
  return { names, parents, locals, ibm, id: createHash('sha256').update(`${names.join('|')}#${ibm.join(',')}`).digest('hex').slice(0, 16) }
}

/**
 * Pull one node's primitives out of a source document as plain arrays.
 *
 * A *skinned* node's transform is ignored, exactly as glTF requires: the vertices are already in its
 * own skeleton's bind space. That space is **not** shared between the packs — the outfit rig stands its
 * thighs 2.3 cm and its shoulders 2 cm closer to the centre line than the base rig does — which is what
 * `retargetParts` below exists to correct. An unskinned node (the hairstyles) gets its world matrix baked in
 * instead. Skinned nodes also carry their joint indices and weights through, so the output can be posed;
 * see the file header for why that is worth its bytes.
 */
function readParts(doc, node, path) {
  const mesh = node.getMesh()
  if (!mesh) fail(`node "${node.getName()}" in ${relative(REPO_ROOT, path)} has no mesh`)
  const skin = node.getSkin()
  const skeleton = skin ? readSkeleton(skin, path) : null
  const world = skin ? identity() : [...node.getWorldMatrix()]
  const n3 = normalMatrix(world)
  const parts = []
  for (const prim of mesh.listPrimitives()) {
    const position = prim.getAttribute('POSITION')
    const normal = prim.getAttribute('NORMAL')
    if (!position) continue
    const count = position.getCount()
    const positions = new Float32Array(count * 3)
    const normals = new Float32Array(count * 3)
    const scratch = [0, 0, 0]
    for (let i = 0; i < count; i++) {
      const p = transformPoint(world, position.getElement(i, scratch))
      positions.set(p, i * 3)
      const n = normal ? transformNormal(n3, normal.getElement(i, scratch)) : [0, 1, 0]
      normals.set(n, i * 3)
    }
    const indexAccessor = prim.getIndices()
    const indices = indexAccessor
      ? Uint32Array.from(indexAccessor.getArray())
      : Uint32Array.from({ length: count }, (_, i) => i)
    const jointAccessor = skeleton ? prim.getAttribute('JOINTS_0') : null
    const weightAccessor = skeleton ? prim.getAttribute('WEIGHTS_0') : null
    let joints = null
    let weights = null
    if (jointAccessor && weightAccessor) {
      joints = new Uint16Array(count * 4)
      weights = new Float32Array(count * 4)
      const quad = [0, 0, 0, 0]
      for (let i = 0; i < count; i++) {
        joints.set(jointAccessor.getElement(i, quad), i * 4)
        weights.set(weightAccessor.getElement(i, quad), i * 4)
      }
    } else if (skeleton) {
      fail(`node "${node.getName()}" in ${relative(REPO_ROOT, path)} is skinned but has no JOINTS_0/WEIGHTS_0`)
    }
    parts.push({ positions, normals, indices, joints, weights, skeleton, sourceMaterial: prim.getMaterial()?.getName() ?? '' })
  }
  if (parts.length === 0) fail(`node "${node.getName()}" in ${relative(REPO_ROOT, path)} has no positions`)
  return parts
}

/**
 * The one skeleton a set of parts share, or `null` if none of them are skinned.
 *
 * Every rig in both packs is the same 65 joints in the same order — only the bind *positions* differ,
 * between the two bodies and between a body and the outfit pack. So an output file can hold one skeleton
 * per body and hang every garment off it. This is where that assumption is checked: parts whose rigs
 * disagree would render deformed at rest, and the fix would be a skin per part, not a warning.
 */
function sharedSkeleton(parts, key) {
  const skinned = parts.filter((part) => part.skeleton)
  if (skinned.length === 0) return null
  if (skinned.length !== parts.length) fail(`${key} merges skinned and unskinned meshes, which cannot share one node`)
  const first = skinned[0].skeleton
  for (const part of skinned) {
    if (part.skeleton.id !== first.id) {
      fail(`${key} merges meshes rigged to different skeletons (${first.id} vs ${part.skeleton.id}) — they cannot share one skin`)
    }
  }
  return first
}

/** Axis-aligned bounds over a set of parts. */
function boundsOf(parts) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const part of parts) {
    for (let i = 0; i < part.positions.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], part.positions[i + a])
        max[a] = Math.max(max[a], part.positions[i + a])
      }
    }
  }
  return { min, max }
}

/**
 * Scale a whole variant about its own bounding box, in place.
 *
 * This is how six hairstyles and four garments cover thirteen catalogue ids: `bottom_shorts` is the
 * peasant leggings scaled to 52 % of their height *about their top edge* (so they shorten from the hip
 * down, staying attached to the waist), `hair_mohawk` is the buzzed cut narrowed and raised *about its
 * bottom edge* (so the crest grows out of the skull, not through it). The anchor is what makes the
 * result attach in the right place; without it a scale about the origin would send the part to the floor,
 * two metres below where it belongs.
 *
 * A `merge` entry marked `unscaled` is left out of both the bounding box and the transform. It is what
 * lets `clothing_aodai` lengthen the *tunic* to the knee without dragging the sleeves merged beside it
 * two thirds of the way down the arms with it.
 */
function applyScale(allParts, scale, anchor) {
  const parts = allParts.filter((part) => !part.unscaled)
  if (parts.length === 0) return
  const { min, max } = boundsOf(parts)
  const centre = [(min[0] + max[0]) / 2, 0, (min[2] + max[2]) / 2]
  centre[1] = anchor === 'top' ? max[1] : anchor === 'center' ? (min[1] + max[1]) / 2 : min[1]
  const n3 = normalMatrix([scale[0], 0, 0, 0, 0, scale[1], 0, 0, 0, 0, scale[2], 0, 0, 0, 0, 1])
  for (const part of parts) {
    for (let i = 0; i < part.positions.length; i += 3) {
      for (let a = 0; a < 3; a++) part.positions[i + a] = centre[a] + (part.positions[i + a] - centre[a]) * scale[a]
    }
    for (let i = 0; i < part.normals.length; i += 3) {
      const n = transformNormal(n3, [part.normals[i], part.normals[i + 1], part.normals[i + 2]])
      part.normals.set(n, i)
    }
  }
}

/**
 * Decimate a part to a fraction of its triangles, with `meshoptimizer`'s simplifier.
 *
 * One mesh in the packs is wildly out of proportion to the rest: the ranger boots are 10,174 vertices
 * each — five times the peasant footwrap they stand beside, and a fifth of every outfit put together —
 * because they were modelled with the detail of a hero prop. At the size a boot occupies in a 128 px
 * portrait none of that survives rasterisation, but all of it survives into the download. `simplify` in
 * the map is how a part like that pays its way.
 */
async function simplifyParts(parts, ratio) {
  const { MeshoptSimplifier } = await import('meshoptimizer')
  await MeshoptSimplifier.ready
  for (const part of parts) {
    const target = Math.max(12, Math.floor((part.indices.length * ratio) / 3) * 3)
    if (target >= part.indices.length) continue
    const [kept] = MeshoptSimplifier.simplify(part.indices, part.positions, 3, target, 0.02, ['LockBorder'])
    // The simplifier leaves the vertex arrays alone and only drops indices, so compact them by hand;
    // otherwise every vertex it removed would still be paid for in the buffer.
    const remap = new Map()
    const positions = []
    const normals = []
    const joints = []
    const weights = []
    const indices = new Uint32Array(kept.length)
    for (let i = 0; i < kept.length; i++) {
      const source = kept[i]
      let index = remap.get(source)
      if (index === undefined) {
        index = remap.size
        remap.set(source, index)
        positions.push(part.positions[source * 3], part.positions[source * 3 + 1], part.positions[source * 3 + 2])
        normals.push(part.normals[source * 3], part.normals[source * 3 + 1], part.normals[source * 3 + 2])
        // Skinning travels with the vertex it belongs to, or a decimated boot would fall off the leg.
        for (let c = 0; c < 4 && part.joints; c++) joints.push(part.joints[source * 4 + c])
        for (let c = 0; c < 4 && part.weights; c++) weights.push(part.weights[source * 4 + c])
      }
      indices[i] = index
    }
    part.positions = Float32Array.from(positions)
    part.normals = Float32Array.from(normals)
    if (part.joints) part.joints = Uint16Array.from(joints)
    if (part.weights) part.weights = Float32Array.from(weights)
    part.indices = indices
  }
}

// ───────────────────────────────────────────────────────── fitting to a body ──
/**
 * Why a garment has to be *fitted* to a body at build time.
 *
 * The two CC0 packs were not modelled for each other. The bodies are the base pack's **Superhero**
 * build; every garment is cut for the outfit pack's own **Regular** body, which is both slimmer and
 * differently rigged — its thighs sit at x = ±0.091 against the base rig's ±0.114, its shoulders at
 * ±0.192 against ±0.212. Dropped onto a Superhero body unchanged, a garment is *inside* it: measured
 * against the nearest body surface, the ranger legs sink up to 40 mm and the ranger jerkin up to 54 mm.
 * What that renders as is the bug this pass fixes — a trouser leg that shows as a few ragged blue
 * patches on an otherwise bare thigh, a tunic that reads as a crop top because the chest comes through
 * it, sleeves floating an inch off the arms.
 *
 * Two operations, in this order, and both are geometry the *build* does so the renderer never has to:
 *
 * 1. **Retarget** (`retargetParts`). Re-express the mesh in the body's bind pose by pushing every
 *    vertex through `W_body(joint) · IBM_source(joint)`, blended by its skin weights, and re-bind it to
 *    the body's skeleton with the joint indices remapped by name. This is what puts the trouser legs
 *    over the body's legs and the sleeves on the body's arms, and it is a *correctness* fix as much as
 *    a cosmetic one: afterwards a garment and the body turn about the same joints, so
 *    `manifest.pose.armsDown` moves them together instead of 2 cm apart. It also collapses every rig in
 *    `outfits.glb` onto the two the bodies use, which is what keeps that file at one skin per body.
 * 2. **Shrinkwrap** (`conformParts`). Project every vertex that is inside the body — or within
 *    `margin` of it — onto the body's surface plus `margin` along the surface normal there. The
 *    silhouette becomes the body's, which for a stylised figure seen at 128 px is exactly right: cloth
 *    on skin. Anything genuinely standing off the body (a hood, a pauldron, a skirt's flare, a boot
 *    sole) is further out than `margin` and is not touched at all.
 *
 * The margin is per slot (`fit.margin` in the map) so a top can sit *over* a bottom rather than
 * z-fighting it at the waist. An item may override with its own `fit`, or opt out with `fit: false`.
 */

/** One joint's 4×4 out of a packed inverse-bind-matrix table. */
const matAt = (array, index) => Array.from(array.subarray(index * 16, index * 16 + 16))

/**
 * Move a mesh from the rig it was modelled on to the body's, and re-bind it there.
 *
 * A no-op for anything already on the body's skeleton (the body itself) or not skinned at all (hair,
 * and the generated accessories, which are placed against the body's own joint table to begin with).
 */
function retargetParts(parts, target, key) {
  const index = new Map(target.names.map((name, at) => [name, at]))
  for (const part of parts) {
    const source = part.skeleton
    if (!source || source.id === target.id) continue
    const remap = source.names.map((name) => {
      const at = index.get(name)
      if (at === undefined) fail(`${key} is rigged to a joint "${name}" the body's rig has not got`)
      return at
    })
    const transforms = source.names.map((_, i) => multiply(invert(matAt(target.ibm, remap[i])), matAt(source.ibm, i)))
    const blended = new Array(16)
    for (let v = 0; v < part.positions.length / 3; v++) {
      blended.fill(0)
      let total = 0
      for (let c = 0; c < 4; c++) {
        const weight = part.weights[v * 4 + c]
        if (weight === 0) continue
        const transform = transforms[part.joints[v * 4 + c]]
        for (let e = 0; e < 16; e++) blended[e] += transform[e] * weight
        total += weight
      }
      // A vertex with no weights at all is left where it is rather than collapsed onto the origin.
      if (total === 0) continue
      for (let e = 0; e < 16; e++) blended[e] /= total
      const at = v * 3
      part.positions.set(transformPoint(blended, [part.positions[at], part.positions[at + 1], part.positions[at + 2]]), at)
      const n3 = normalMatrix(blended)
      part.normals.set(transformNormal(n3, [part.normals[at], part.normals[at + 1], part.normals[at + 2]]), at)
    }
    for (let i = 0; i < part.joints.length; i++) part.joints[i] = remap[part.joints[i]]
    part.skeleton = target
  }
}

/** The body's own triangles, as one indexed soup — what a garment is projected onto. */
function surfaceOf(parts) {
  const positions = []
  const normals = []
  const indices = []
  for (const part of parts) {
    const base = positions.length / 3
    for (const value of part.positions) positions.push(value)
    for (const value of part.normals) normals.push(value)
    for (const value of part.indices) indices.push(base + value)
  }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), indices: Uint32Array.from(indices) }
}

/** Side of a cell in the uniform grid the projection searches. Roughly a hand's breadth. */
const GRID_CELL = 0.04

/** Every triangle of a surface, bucketed by the cells its bounding box touches. */
function buildGrid(surface) {
  const cells = new Map()
  for (let t = 0; t < surface.indices.length / 3; t++) {
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let corner = 0; corner < 3; corner++) {
      const at = surface.indices[t * 3 + corner] * 3
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], surface.positions[at + a])
        max[a] = Math.max(max[a], surface.positions[at + a])
      }
    }
    for (let i = Math.floor(min[0] / GRID_CELL); i <= Math.floor(max[0] / GRID_CELL); i++) {
      for (let j = Math.floor(min[1] / GRID_CELL); j <= Math.floor(max[1] / GRID_CELL); j++) {
        for (let k = Math.floor(min[2] / GRID_CELL); k <= Math.floor(max[2] / GRID_CELL); k++) {
          const key = `${i},${j},${k}`
          const bucket = cells.get(key)
          if (bucket) bucket.push(t)
          else cells.set(key, [t])
        }
      }
    }
  }
  return cells
}

/**
 * The point of triangle `abc` nearest `p`, as barycentric weights — Ericson's region test.
 *
 * Barycentric rather than the point itself because the *normal* there has to be interpolated from the
 * three vertex normals: a face normal would shade the fitted garment as flat facets of the body.
 */
function closestOnTriangle(p, a, b, c) {
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]]
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
  const ab = sub(b, a)
  const ac = sub(c, a)
  const ap = sub(p, a)
  const d1 = dot(ab, ap)
  const d2 = dot(ac, ap)
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0]
  const bp = sub(p, b)
  const d3 = dot(ab, bp)
  const d4 = dot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0]
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    return [1 - v, v, 0]
  }
  const cp = sub(p, c)
  const d5 = dot(ab, cp)
  const d6 = dot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1]
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    return [1 - w, 0, w]
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return [0, 1 - w, w]
  }
  const denom = 1 / (va + vb + vc)
  const v = vb * denom
  const w = vc * denom
  return [1 - v - w, v, w]
}

/** Where `p` lands on the surface, and the interpolated normal there — or `null` if nothing is near. */
function project(surface, cells, p) {
  const base = [Math.floor(p[0] / GRID_CELL), Math.floor(p[1] / GRID_CELL), Math.floor(p[2] / GRID_CELL)]
  const seen = new Set()
  let best = null
  let distance = Infinity
  for (let ring = 0; ring <= 8; ring++) {
    for (let i = base[0] - ring; i <= base[0] + ring; i++) {
      for (let j = base[1] - ring; j <= base[1] + ring; j++) {
        for (let k = base[2] - ring; k <= base[2] + ring; k++) {
          // Only the shell of the cube is new on each ring; its interior was searched already.
          const onShell = Math.abs(i - base[0]) === ring || Math.abs(j - base[1]) === ring || Math.abs(k - base[2]) === ring
          if (ring > 0 && !onShell) continue
          const bucket = cells.get(`${i},${j},${k}`)
          if (!bucket) continue
          for (const t of bucket) {
            if (seen.has(t)) continue
            seen.add(t)
            const corners = [0, 1, 2].map((corner) => surface.indices[t * 3 + corner] * 3)
            const vertices = corners.map((at) => [surface.positions[at], surface.positions[at + 1], surface.positions[at + 2]])
            const bary = closestOnTriangle(p, ...vertices)
            const point = [0, 1, 2].map((a) => bary[0] * vertices[0][a] + bary[1] * vertices[1][a] + bary[2] * vertices[2][a])
            const d = Math.hypot(p[0] - point[0], p[1] - point[1], p[2] - point[2])
            if (d >= distance) continue
            distance = d
            const normal = [0, 1, 2].map(
              (a) => bary[0] * surface.normals[corners[0] + a] + bary[1] * surface.normals[corners[1] + a] + bary[2] * surface.normals[corners[2] + a],
            )
            const length = Math.hypot(...normal) || 1
            best = { point, normal: normal.map((v) => v / length) }
          }
        }
      }
    }
    // A triangle inside the cube searched so far is only *the* nearest once the cube's inradius covers
    // it; anything closer would have to be in a cell this ring has not reached.
    if (best !== null && distance <= ring * GRID_CELL) break
  }
  return best
}

/**
 * How far a vertex the shrinkwrap moved may end up back inside the body before the build refuses it.
 *
 * Not zero, and the reason is geometric rather than a fudge. A vertex is moved to the nearest point on
 * the body plus `margin`, and "nearest" is not the same point afterwards: in a concave crease — an
 * armpit, the fork of the legs — a vertex pushed 26 mm clear of the torso can land inside the arm folded
 * against it. Measured across the catalogue that is 8 to 30 vertices of a three-thousand-vertex garment,
 * and 11.0 mm at the worst (six vertices of `bottom_skirt`, between the legs, under the skirt).
 *
 * A second sweep that re-pushes those vertices does drive the number down — and makes the *picture*
 * worse: a vertex wedged between two thighs is pushed onto the far one, its triangles stretch across the
 * fork, and `bottom_skirt` opens a skin-coloured hole that one sweep does not have. Tried, rendered,
 * reverted. So the residual stays and the tolerance is where the residual is.
 *
 * What the guard is *for* is the other order of magnitude: a garment that is not fitted, fitted at the
 * wrong margin, or built for the wrong body is 25–54 mm inside over a whole limb — the defect this pass
 * exists to remove, and one nobody would notice again until they looked at a render.
 */
const FIT_TOLERANCE = 0.012

/** How far outside the surface `p` lies, along the interpolated normal of the point nearest it. */
function signedDistance(surface, cells, p) {
  const hit = project(surface, cells, p)
  if (hit === null) return { hit: null, outside: Infinity }
  return { hit, outside: (p[0] - hit.point[0]) * hit.normal[0] + (p[1] - hit.point[1]) * hit.normal[1] + (p[2] - hit.point[2]) * hit.normal[2] }
}

/**
 * Push every vertex that is inside the body — or nearer than `margin` — out onto the body's surface.
 *
 * Results are cached by position: the seams of a low-poly garment duplicate a vertex two or three
 * times over (one per hard edge) and every copy has to move identically or the mesh tears open.
 *
 * **A part whose canonical material is `skin` is not touched.** `*_Ranger_Arms` is not only cloth: it
 * carries an `MI_Regular_*` mesh, which is a copy of the body's own bare forearm and hand, and is why
 * that sleeve was chosen over the peasant one. That copy is *coincident with the body surface* by
 * construction, so every one of its vertices reads as "inside or within margin" and a shrinkwrap would
 * push the whole hand out by the top margin — 26 mm of it — turning it into a fingerless mitten twice
 * its real thickness on every sleeved top. A skin primitive duplicates the body; there is nothing for a
 * cloth margin to correct it towards.
 *
 * Returns the worst residual penetration it leaves behind, in metres, which the build publishes per node
 * and refuses to ship over `FIT_TOLERANCE`. Most garments come out at 0.0 mm.
 */
function conformParts(parts, surface, cells, margin) {
  const cache = new Map()
  const landed = []
  for (const part of parts) {
    if (part.canonical === 'skin') continue
    for (let v = 0; v < part.positions.length / 3; v++) {
      const at = v * 3
      const p = [part.positions[at], part.positions[at + 1], part.positions[at + 2]]
      const key = `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)},${Math.round(p[2] * 1e5)}`
      let moved = cache.get(key)
      if (moved === undefined) {
        const { hit, outside } = signedDistance(surface, cells, p)
        moved =
          hit === null || outside >= margin
            ? null
            : { position: [0, 1, 2].map((a) => hit.point[a] + hit.normal[a] * margin), normal: hit.normal }
        cache.set(key, moved)
        if (moved !== null) landed.push(moved.position)
      }
      if (moved === null) continue
      part.positions.set(moved.position, at)
      // The garment now *is* the body's surface offset outwards, so the body's own interpolated normal
      // is the honest one — the mesh's own would shade a shape it no longer has.
      part.normals.set(moved.normal, at)
    }
  }
  // Only a vertex that moved can have ended up on the wrong side: one left alone was already at least
  // `margin` outside, and nothing here moves it.
  let worst = 0
  for (const position of landed) {
    const { outside } = signedDistance(surface, cells, position)
    if (-outside > worst) worst = -outside
  }
  return worst
}

/**
 * How far off the skin this variant sits, in metres, or `null` for a variant that is not fitted.
 *
 * The default is the slot's entry in `fit.margin`, which is how the map says *which* slots are fitted
 * at all: hair comes from the base pack and already belongs to these bodies, so `hair` is not listed
 * and no hairstyle is touched. An item may name its own margin, or `false` to be left alone.
 */
function fitMargin(map, item, variant) {
  const bySlot = map.fit?.margin?.[item.slot]
  const own = variant.fit ?? item.fit
  if (own === false) return null
  if (typeof own === 'number') return own
  if (own === true && bySlot === undefined) fail(`item ${item.id} asks to be fitted, but fit.margin has no entry for slot "${item.slot}"`)
  return bySlot ?? null
}

// ──────────────────────────────────────────────────────── generated shapes ──
// Hats, glasses, masks and jewellery have no counterpart in the free tier of either pack — a fantasy
// hood is not a nón lá and a pauldron is not a wedding ring — so those items are generated here from
// primitives and placed against a joint of the body's own bind pose (`Head`, `neck_01`, `ring_01_l`),
// which is why they land correctly on both the male and the female skeleton without hand-tuned offsets.

const TAU = Math.PI * 2

function emptyGeometry() {
  return { positions: [], normals: [], indices: [] }
}

function pushVertex(g, p, n) {
  g.positions.push(p[0], p[1], p[2])
  g.normals.push(n[0], n[1], n[2])
  return g.positions.length / 3 - 1
}

function box(size) {
  const g = emptyGeometry()
  const [x, y, z] = size.map((v) => v / 2)
  const faces = [
    { n: [0, 0, 1], v: [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]] },
    { n: [0, 0, -1], v: [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]] },
    { n: [1, 0, 0], v: [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]] },
    { n: [-1, 0, 0], v: [[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]] },
    { n: [0, 1, 0], v: [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]] },
    { n: [0, -1, 0], v: [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]] },
  ]
  for (const face of faces) {
    const base = g.positions.length / 3
    for (const v of face.v) pushVertex(g, v, face.n)
    g.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return g
}

function sphere(radius, rings = 12, segments = 18) {
  const g = emptyGeometry()
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI
    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * TAU
      const n = [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)]
      pushVertex(g, [n[0] * radius, n[1] * radius, n[2] * radius], n)
    }
  }
  const row = segments + 1
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * row + s
      g.indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1)
    }
  }
  return g
}

/** A cone or a cylinder along +Y, centred on the origin; `topRadius === 0` makes it a cone. */
function tube(bottomRadius, topRadius, height, segments = 20) {
  const g = emptyGeometry()
  const half = height / 2
  const slope = Math.atan2(bottomRadius - topRadius, height)
  for (let s = 0; s <= segments; s++) {
    const theta = (s / segments) * TAU
    const dir = [Math.cos(theta), 0, Math.sin(theta)]
    const n = [dir[0] * Math.cos(slope), Math.sin(slope), dir[2] * Math.cos(slope)]
    pushVertex(g, [dir[0] * bottomRadius, -half, dir[2] * bottomRadius], n)
    pushVertex(g, [dir[0] * topRadius, half, dir[2] * topRadius], n)
  }
  for (let s = 0; s < segments; s++) {
    const a = s * 2
    g.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  for (const cap of [{ y: -half, radius: bottomRadius, n: [0, -1, 0] }, { y: half, radius: topRadius, n: [0, 1, 0] }]) {
    if (cap.radius <= 0) continue
    const centre = pushVertex(g, [0, cap.y, 0], cap.n)
    const first = g.positions.length / 3
    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * TAU
      pushVertex(g, [Math.cos(theta) * cap.radius, cap.y, Math.sin(theta) * cap.radius], cap.n)
    }
    for (let s = 0; s < segments; s++) {
      if (cap.n[1] > 0) g.indices.push(centre, first + s, first + s + 1)
      else g.indices.push(centre, first + s + 1, first + s)
    }
  }
  return g
}

/** A torus in the XY plane (so its axis is +Z), which the caller then rotates onto the axis it wants. */
function torus(radius, tubeRadius, radialSegments = 24, tubularSegments = 10) {
  const g = emptyGeometry()
  for (let i = 0; i <= radialSegments; i++) {
    const u = (i / radialSegments) * TAU
    for (let j = 0; j <= tubularSegments; j++) {
      const v = (j / tubularSegments) * TAU
      const n = [Math.cos(u) * Math.cos(v), Math.sin(u) * Math.cos(v), Math.sin(v)]
      pushVertex(g, [Math.cos(u) * radius + n[0] * tubeRadius, Math.sin(u) * radius + n[1] * tubeRadius, n[2] * tubeRadius], n)
    }
  }
  const row = tubularSegments + 1
  for (let i = 0; i < radialSegments; i++) {
    for (let j = 0; j < tubularSegments; j++) {
      const a = i * row + j
      g.indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1)
    }
  }
  return g
}

/** Rotation that takes the generator's own axis (+Y for tubes, +Z for tori) onto the requested one. */
function axisMatrix(axis, native) {
  if (axis === native) return identity()
  const rotX = (a) => [1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1]
  const rotY = (a) => [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1]
  const quarter = Math.PI / 2
  if (native === 'y') return axis === 'x' ? [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : rotX(quarter)
  // native 'z' (torus)
  return axis === 'y' ? rotX(quarter) : rotY(quarter)
}

function shapeGeometry(part) {
  switch (part.shape) {
    case 'box':
      return { g: box(part.size), native: 'y' }
    case 'sphere':
      return { g: sphere(part.radius ?? 1), native: 'y' }
    case 'cylinder':
      return { g: tube(part.radius, part.topRadius ?? part.radius, part.height), native: 'y' }
    case 'cone':
      return { g: tube(part.radius, 0, part.height), native: 'y' }
    case 'torus':
      return { g: torus(part.radius, part.tube), native: 'z' }
    default:
      return fail(`unknown primitive shape "${part.shape}"`)
  }
}

/** Turn one `primitive.parts` entry into geometry parts, positioned against the body's bind pose. */
function buildPrimitive(spec, anchors, defaultTint) {
  const anchor = anchors[spec.anchor]
  if (!anchor) fail(`no joint "${spec.anchor}" in the body rig — --list a body to see the joint names`)
  const parts = []
  for (const part of spec.parts) {
    const copies = part.repeat
      ? Array.from({ length: part.repeat.count }, (_, i) => {
          const theta = ((part.repeat.startDeg ?? 0) * Math.PI) / 180 + (i / part.repeat.count) * TAU
          return [Math.sin(theta) * part.repeat.radius, 0, Math.cos(theta) * part.repeat.radius]
        })
      : [[0, 0, 0]]
    for (const copy of copies) {
      const { g, native } = shapeGeometry(part)
      const rotation = axisMatrix(part.axis ?? native, native)
      const scale = part.scale ?? [1, 1, 1]
      const m = multiply([scale[0], 0, 0, 0, 0, scale[1], 0, 0, 0, 0, scale[2], 0, 0, 0, 0, 1], rotation)
      const n3 = normalMatrix(m)
      const offset = part.offset ?? [0, 0, 0]
      const origin = [anchor[0] + offset[0] + copy[0], anchor[1] + offset[1] + copy[1], anchor[2] + offset[2] + copy[2]]
      const positions = new Float32Array(g.positions.length)
      const normals = new Float32Array(g.normals.length)
      for (let i = 0; i < g.positions.length; i += 3) {
        const p = transformPoint(m, [g.positions[i], g.positions[i + 1], g.positions[i + 2]])
        positions.set([p[0] + origin[0], p[1] + origin[1], p[2] + origin[2]], i)
        normals.set(transformNormal(n3, [g.normals[i], g.normals[i + 1], g.normals[i + 2]]), i)
      }
      parts.push({
        positions,
        normals,
        indices: Uint32Array.from(g.indices),
        canonical: part.material ?? 'cloth_primary',
        tint: part.tint ?? defaultTint,
      })
    }
  }
  return parts
}

// ─────────────────────────────────────────────────────────── document build ──

/** One output `.glb` under construction: its document, its shared buffer, and its caches. */
function newBundle() {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const scene = doc.createScene('avatar')
  doc.getRoot().setDefaultScene(scene)
  return { doc, buffer, scene, materials: new Map(), accessors: new Map(), skins: new Map(), nodes: [] }
}

/**
 * Emit a skeleton into a bundle once, and hand back the `Skin` every part rigged to it shares.
 *
 * The joint nodes are real scene nodes named exactly as the packs name them (`upperarm_l`, `Head`, …),
 * which is the whole contract with the renderer: `manifest.pose.armsDown` names joints, the renderer
 * looks them up by name and rotates them.
 */
function skinFor(bundle, skeleton, name) {
  if (bundle.skins.has(skeleton.id)) return bundle.skins.get(skeleton.id)
  const joints = skeleton.names.map((name, i) => bundle.doc.createNode(name).setMatrix(skeleton.locals[i]))
  skeleton.parents.forEach((parent, i) => {
    if (parent >= 0) joints[parent].addChild(joints[i])
    else bundle.scene.addChild(joints[i])
  })
  const inverseBind = bundle.doc.createAccessor().setType('MAT4').setArray(skeleton.ibm).setBuffer(bundle.buffer)
  const skin = bundle.doc.createSkin(name).setInverseBindMatrices(inverseBind)
  for (const joint of joints) skin.addJoint(joint)
  bundle.skins.set(skeleton.id, skin)
  return skin
}

const hexToLinear = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16)
  // glTF factors are linear; the tints in the map are the sRGB values a designer types.
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255)
  return [...srgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)), 1]
}

function materialFor(bundle, map, canonical, tint) {
  const preset = map.materials.canonical[canonical]
  if (!preset) fail(`"${canonical}" is not one of the canonical material names`)
  // Skin, eyes and hair are coloured from the player's own configuration at runtime, so an item may not
  // tint them — a sleeve that carries part of the bare arm must leave that part recolourable.
  const effective = preset.runtimeTinted ? null : (tint ?? null)
  const key = `${canonical}|${effective ?? 'default'}`
  if (!bundle.materials.has(key)) {
    const material = bundle.doc
      .createMaterial(canonical)
      .setBaseColorFactor(hexToLinear(effective ?? preset.baseColor))
      .setMetallicFactor(preset.metallic)
      .setRoughnessFactor(preset.roughness)
    bundle.materials.set(key, material)
  }
  return bundle.materials.get(key)
}

/**
 * Add one node to a bundle. `parts` carry geometry; `cacheKey` lets two items that are the same mesh in
 * different colours (five of the seven tops are) share one copy of the vertex data.
 */
function addNode(bundle, map, key, parts, cacheKey, body) {
  const mesh = bundle.doc.createMesh(key)
  const skeleton = sharedSkeleton(parts, key)
  parts.forEach((part, index) => {
    const id = cacheKey ? `${cacheKey}#${index}` : null
    let accessors = id ? bundle.accessors.get(id) : null
    if (!accessors) {
      accessors = {
        position: bundle.doc.createAccessor().setType('VEC3').setArray(part.positions).setBuffer(bundle.buffer),
        normal: bundle.doc.createAccessor().setType('VEC3').setArray(part.normals).setBuffer(bundle.buffer),
        indices: bundle.doc.createAccessor().setType('SCALAR').setArray(part.indices).setBuffer(bundle.buffer),
        joints: part.joints ? bundle.doc.createAccessor().setType('VEC4').setArray(part.joints).setBuffer(bundle.buffer) : null,
        weights: part.weights ? bundle.doc.createAccessor().setType('VEC4').setArray(part.weights).setBuffer(bundle.buffer) : null,
      }
      if (id) bundle.accessors.set(id, accessors)
    }
    const primitive = bundle.doc
      .createPrimitive()
      .setAttribute('POSITION', accessors.position)
      .setAttribute('NORMAL', accessors.normal)
      .setIndices(accessors.indices)
      .setMaterial(materialFor(bundle, map, part.canonical, part.tint))
    if (accessors.joints && accessors.weights) {
      primitive.setAttribute('JOINTS_0', accessors.joints).setAttribute('WEIGHTS_0', accessors.weights)
    }
    mesh.addPrimitive(primitive)
  })
  const node = bundle.doc.createNode(key).setMesh(mesh)
  if (skeleton) node.setSkin(skinFor(bundle, skeleton, `skeleton/${body}`))
  bundle.scene.addChild(node)
  bundle.nodes.push(key)
  return node
}

/** The extent of the POSITION accessors a node actually ended up with, from their own min/max. */
function accessorBounds(node) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
    const position = primitive.getAttribute('POSITION')
    if (!position) continue
    const lo = position.getMin([0, 0, 0])
    const hi = position.getMax([0, 0, 0])
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], lo[a])
      max[a] = Math.max(max[a], hi[a])
    }
  }
  return { min, max }
}

/**
 * The bounds the manifest is about to publish for a node must be the bounds of the vertices that were
 * written for it.
 *
 * These are two independent paths — `details[key].bounds` comes from the arrays `readVariant` produced,
 * the accessors come out of the vertex cache — and they can disagree: a cache key that leaves out
 * something the geometry depends on hands one node another node's mesh while the manifest goes on
 * describing the geometry that node *would* have had. That shipped once (the ponytail, fitted to the
 * male skull, served to both bodies), and it is invisible in every other check: the file is valid, the
 * budgets hold, `--check` re-hashes bytes that really are what was written. So it is checked here, where
 * both numbers exist in metres and before quantization has touched either.
 */
function assertPublishedBounds(key, node, expected) {
  const actual = accessorBounds(node)
  for (let a = 0; a < 3; a++) {
    if (Math.abs(actual.min[a] - expected.min[a]) > 1e-4 || Math.abs(actual.max[a] - expected.max[a]) > 1e-4) {
      fail(
        `${key} would publish bounds [${expected.min.map(round)}]…[${expected.max.map(round)}] but the accessors written for it span ` +
          `[${actual.min.map(round)}]…[${actual.max.map(round)}] — the vertex cache handed it geometry built for something else`,
      )
    }
  }
}

/**
 * The colour a node reads as, for `manifest.nodes[key].tint`.
 *
 * The item catalogue (`apps/normal-server/data/items.json`) carries a `tint` on a couple of items and
 * the renderer is told to honour it, so the two have to agree; publishing what was actually baked is how
 * the pipeline stays the single source of truth and how the test can compare. `skin`, `eyes` and `hair`
 * are recoloured from the player's configuration and have no item colour at all, so a body or a
 * hairstyle has no tint — the first cloth or metal material a node carries is what a player sees as
 * "the colour of this item".
 */
function bakedTint(map, parts) {
  for (const canonical of ['cloth_primary', 'metal', 'cloth_secondary']) {
    const part = parts.find((candidate) => candidate.canonical === canonical)
    if (part) return (part.tint ?? map.materials.canonical[canonical].baseColor).toLowerCase()
  }
  return null
}

/**
 * Read a variant (or a body) from the packs: primary node plus every `merge` entry, then the four
 * things that can be done to it — retarget, scale, shrinkwrap, decimate, in that order.
 *
 * The order is the whole of it. Retargeting first puts the mesh in the body's own space, so a `scale`
 * is written against the proportions the item will actually have; the shrinkwrap runs after, so
 * `bottom_shorts` is cut off at the knee *and then* fitted rather than fitted and then cut; and
 * `simplify` is last, because decimating a mesh and then moving its vertices about would put the
 * simplifier's error budget somewhere other than where it was spent.
 *
 * `fit` is an out-parameter as well as an in one: the shrinkwrap's worst residual penetration is written
 * back onto it as `fit.penetration`, because the build publishes that per node and refuses to ship a
 * garment that ends up back inside the body it was fitted to.
 */
async function readVariant(map, variant, defaultFile, fit = null) {
  const entries = [{ ...variant, file: variant.file ?? defaultFile }, ...(variant.merge ?? [])]
  const parts = []
  for (const entry of entries) {
    const path = resolveSource(map, entry.file ?? variant.file ?? defaultFile)
    const doc = await sourceDoc(path)
    for (const part of readParts(doc, findNode(doc, entry.node, path), path)) {
      const canonical = entry.material ?? map.materials.bySourceName[part.sourceMaterial] ?? map.materials.default
      parts.push({ ...part, canonical, tint: entry.tint ?? variant.tint, unscaled: entry.unscaled === true })
    }
  }
  if (fit?.skeleton) retargetParts(parts, fit.skeleton, fit.key)
  if (variant.scale) applyScale(parts, variant.scale, variant.scaleAnchor ?? 'bottom')
  if (fit?.margin) fit.penetration = conformParts(parts, fit.surface, fit.cells, fit.margin)
  if (variant.simplify) await simplifyParts(parts, variant.simplify)
  return parts
}

/** The bind-pose position of every joint of a body, keyed by joint name. */
async function readAnchors(map, body) {
  const path = resolveSource(map, body.file)
  const doc = await sourceDoc(path)
  const anchors = {}
  for (const skin of doc.getRoot().listSkins()) {
    const ibm = skin.getInverseBindMatrices()
    if (!ibm) continue
    skin.listJoints().forEach((joint, i) => {
      anchors[joint.getName()] = inverseTranslation(ibm.getElement(i, new Array(16)))
    })
  }
  return anchors
}

// ──────────────────────────────────────────────────────────────────── build ──

/**
 * Fold the skins `quantize` cloned back into one per skeleton.
 *
 * `quantize` rewrites every skinned node's inverse bind matrices to compensate for the quantization
 * volume, and does it by *cloning* the skin — so a file that went in with two skins comes out with one
 * per garment, each carrying its own 65 × 64 B matrix accessor. `dedup` will not put them back together
 * (it only dedupes accessors reachable from mesh primitives), so this does: identical joints and
 * identical matrices mean identical skeletons, whatever the graph says.
 */
function dedupeSkins(doc) {
  const byContent = new Map()
  const used = new Set()
  for (const node of doc.getRoot().listNodes()) {
    const skin = node.getSkin()
    if (!skin) continue
    const array = skin.getInverseBindMatrices().getArray()
    const digest = createHash('sha256')
      .update(skin.listJoints().map((joint) => joint.getName()).join('|'))
      .update(Buffer.from(array.buffer, array.byteOffset, array.byteLength))
      .digest('hex')
    if (!byContent.has(digest)) byContent.set(digest, skin)
    node.setSkin(byContent.get(digest))
    used.add(byContent.get(digest))
  }
  for (const skin of doc.getRoot().listSkins()) if (!used.has(skin)) skin.dispose()
}

async function optimise(bundle, useMeshopt) {
  // `quantizationVolume: 'scene'` and not the default `'mesh'`: nodes that are the same garment in a
  // different colour share their vertex accessors, and a per-mesh volume would want to quantize one
  // shared accessor two different ways. One volume for the file keeps the sharing (and `dedup`'s ability
  // to find it again after `weld` has copied things around) intact — and, since a per-mesh volume also
  // rewrites the inverse bind matrices per mesh, it is what lets the garments share a skeleton at all.
  //
  // Normals at 8 bits rather than the default 10: it costs about a degree of precision on a shape that
  // is never seen larger than a browser tab, and takes a fifth off every file.
  await bundle.doc.transform(weld())
  if (useMeshopt) {
    // `meshopt()` *is* `reorder` + `quantize` + the extension, so it replaces the quantize above rather
    // than running after it — quantizing twice would apply the compensating node transform twice and
    // leave the avatar a hundredth of its size. Its own quantize defaults to a per-mesh volume, which
    // would give every garment its own inverse bind matrices and defeat the shared skeleton, hence the
    // explicit `quantizationVolume`.
    const [{ meshopt }, { MeshoptEncoder }] = await Promise.all([import('@gltf-transform/functions'), import('meshoptimizer')])
    await MeshoptEncoder.ready
    io.registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
    await bundle.doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high', quantizationVolume: 'scene', quantizeNormal: 8 }))
  } else {
    await bundle.doc.transform(quantize({ quantizationVolume: 'scene', quantizeNormal: 8 }))
  }
  dedupeSkins(bundle.doc)
  await bundle.doc.transform(dedup(), prune({ keepLeaves: true }))
}

/**
 * How many bytes of a file a node accounts for.
 *
 * Accessors shared between nodes (the peasant tunic behind five different tops) are split evenly among
 * them, so the node figures sum to the file's geometry rather than to five times it. It is an
 * attribution, not a measurement — the caller uses it to decide what to load, not to check a budget.
 */
function nodeBytes(bundle) {
  const users = new Map()
  const perNode = new Map()
  for (const node of bundle.doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    perNode.set(node.getName(), new Set())
    if (!mesh) continue
    for (const prim of mesh.listPrimitives()) {
      const attributes = ['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0'].map((name) => prim.getAttribute(name))
      for (const accessor of [...attributes, prim.getIndices()]) {
        if (!accessor) continue
        perNode.get(node.getName()).add(accessor)
        users.set(accessor, (users.get(accessor) ?? 0) + 1)
      }
    }
  }
  const out = {}
  for (const [name, accessors] of perNode) {
    let bytes = 0
    for (const accessor of accessors) bytes += (accessor.getArray()?.byteLength ?? 0) / users.get(accessor)
    out[name] = Math.round(bytes)
  }
  return out
}

async function build({ useMeshopt }) {
  const map = JSON.parse(readFileSync(MAP_FILE, 'utf8'))
  ensureExtracted(map.sources)
  verifySources(map.sources)

  /** file name → bundle. The map decides which slot lands in which file. */
  const bundles = new Map()
  const bundleFor = (file) => {
    if (!bundles.has(file)) bundles.set(file, newBundle())
    return bundles.get(file)
  }

  /** Per node: the bounds a camera frames it by, and the colour it was baked in. Both pre-quantization. */
  const details = {}
  const anchors = {}
  /** The whole joint table per body — the generated accessories are placed against any joint of it. */
  const jointTables = {}
  /** Per body: the rig every garment is retargeted onto, and the skin every garment is fitted to. */
  const fits = {}
  for (const body of BODIES) {
    const spec = map.bodies[body]
    jointTables[body] = await readAnchors(map, spec)
    anchors[body] = Object.fromEntries(
      ANCHOR_JOINTS.map((joint) => {
        if (!jointTables[body][joint]) fail(`the ${body} rig has no joint "${joint}" — --list a body to see the joint names`)
        return [joint, jointTables[body][joint].map(round)]
      }),
    )
    const parts = await readVariant(map, spec, spec.file)
    details[`body/${body}`] = { bounds: boundsOf(parts), tint: bakedTint(map, parts) }
    assertPublishedBounds(`body/${body}`, addNode(bundleFor(spec.out), map, `body/${body}`, parts, null, body), details[`body/${body}`].bounds)

    // The *skin* only, not the eyes and eyebrows merged into the body node beside it: a hood or a
    // collar projected onto the nearest surface must not find an eyebrow and snap to that.
    const path = resolveSource(map, spec.file)
    const doc = await sourceDoc(path)
    const surface = surfaceOf(readParts(doc, findNode(doc, spec.node, path), path))
    fits[body] = { skeleton: sharedSkeleton(parts, `body/${body}`), surface, cells: buildGrid(surface) }
  }

  const emptyNodes = []
  /** Per fitted node: how far the worst shrinkwrapped vertex ended up back inside the body. */
  const penetration = {}
  for (const item of map.items) {
    const file = map.outputs[item.slot]
    if (!file) fail(`item ${item.id} has slot "${item.slot}", which no output file covers`)
    for (const body of BODIES) {
      const variant = item.variants?.[body]
      if (!variant) continue
      const key = `${item.slot}/${item.id}/${body}`
      if (!KEY_RE.test(key)) fail(`"${key}" is not a legal node key`)
      if (variant.empty) {
        emptyNodes.push({ file, key })
        continue
      }
      const margin = variant.primitive ? null : fitMargin(map, item, variant)
      const fit = variant.primitive ? null : { ...fits[body], margin, key }
      const parts = variant.primitive ? buildPrimitive(variant.primitive, jointTables[body], variant.tint) : await readVariant(map, variant, variant.file, fit)
      details[key] = { bounds: boundsOf(parts), tint: bakedTint(map, parts) }
      if (margin !== null) penetration[key] = Math.round(fit.penetration * 1e4) / 1e4
      // Two items that are the same mesh in different colours share one copy of the vertex data. The
      // fit belongs in the key as much as the scale does — the same source mesh fitted at two margins
      // is two different sets of vertices — and so does the **body**, whenever the geometry is a
      // function of one: a shrinkwrap is against that body's skin, and a retarget is onto its rig.
      // Without it, an item whose two variants are written identically in the map (every hairstyle)
      // ships whichever body was built first to both, and the manifest goes on describing geometry that
      // is not in the file. `dedup` folds back anything that really did come out identical.
      const bodyDependent = margin !== null || parts.some((part) => part.skeleton)
      const cacheKey = variant.primitive
        ? null
        : JSON.stringify([
            variant.file,
            variant.node,
            variant.merge ?? [],
            variant.scale ?? [],
            variant.scaleAnchor ?? '',
            variant.simplify ?? 0,
            margin ?? 0,
            bodyDependent ? body : '',
          ])
      assertPublishedBounds(key, addNode(bundleFor(file), map, key, parts, cacheKey, body), details[key].bounds)
    }
  }
  // Every vertex the shrinkwrap moved has to end up *outside* the body, or the garment shows skin
  // through it — which is the whole defect the fitting pass exists to remove, and it is a number, so it
  // is checked rather than looked for in a render. All of them at once: a margin change moves several
  // items and one failure at a time is a slow way to find that out.
  const overFitted = Object.entries(penetration).filter(([, deep]) => deep > FIT_TOLERANCE)
  if (overFitted.length > 0) {
    for (const [key, deep] of overFitted) console.error(`[avatar-assets] ${key} leaves a fitted vertex ${(deep * 1000).toFixed(1)} mm inside the body`)
    fail(
      `${overFitted.length} fitted node(s) end up back inside the body by more than the ${(FIT_TOLERANCE * 1000).toFixed(1)} mm tolerance — ` +
        `raise that item's \`fit\` margin in scripts/avatar-map.json`,
    )
  }
  // Everything is written into a scratch directory and only moved over `public/avatar3d/` once the
  // budgets have held, so a build that is too big — or that dies halfway through — leaves the committed
  // assets exactly as they were. `docs/avatar-assets.md` promises this; it is cheap to actually do.
  rmSync(TMP_DIR, { recursive: true, force: true })
  mkdirSync(TMP_DIR, { recursive: true })

  const files = {}
  const nodes = {}
  const materials = new Set()
  for (const [name, bundle] of bundles) {
    await optimise(bundle, useMeshopt)
    // The "no hair" item is a node with no geometry, added after `prune` so it does not get swept away.
    for (const { file, key } of emptyNodes) {
      if (file !== name) continue
      bundle.scene.addChild(bundle.doc.createNode(key))
      bundle.nodes.push(key)
      details[key] = { bounds: { min: [0, 0, 0], max: [0, 0, 0] }, tint: null }
    }
    const bytesByNode = nodeBytes(bundle)
    const binary = Buffer.from(await io.writeBinary(bundle.doc))
    writeFileSync(join(TMP_DIR, name), binary)
    files[name] = {
      bytes: binary.length,
      sha256: createHash('sha256').update(binary).digest('hex'),
      skins: bundle.doc.getRoot().listSkins().length,
    }
    for (const key of bundle.nodes) {
      nodes[key] = {
        file: name,
        bytes: bytesByNode[key] ?? 0,
        bounds: {
          min: details[key].bounds.min.map(round),
          max: details[key].bounds.max.map(round),
        },
        ...(details[key].tint ? { tint: details[key].tint } : {}),
      }
    }
    for (const material of bundle.doc.getRoot().listMaterials()) materials.add(material.getName())
  }

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    placeholder: false,
    compression: useMeshopt ? 'meshopt' : 'quantize',
    mapSha256: mapDigest(map),
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
    nodes: Object.fromEntries(Object.entries(nodes).sort(([a], [b]) => a.localeCompare(b))),
    materials: [...materials].sort(),
    // What the shrinkwrap left behind, per fitted node, in metres: the deepest a vertex it moved ended
    // up back inside the body. The build already refused to write anything over `tolerance`; publishing
    // it is what lets `--check` and `test/avatar-assets.test.ts` re-assert that on a clone that has
    // never downloaded a source pack, and what makes a slow drift towards the tolerance visible in a
    // diff instead of only in a render.
    fit: { tolerance: FIT_TOLERANCE, penetration: Object.fromEntries(Object.entries(penetration).sort(([a], [b]) => a.localeCompare(b))) },
    anchors,
    pose: { armsDown: ARMS_DOWN },
    budget: { totalBytes: MAX_TOTAL_BYTES, maxFileBytes: MAX_FILE_BYTES, maxBodyBytes: MAX_BODY_BYTES },
  }
  writeFileSync(join(TMP_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  for (const [name, info] of Object.entries(manifest.files)) {
    console.log(`[avatar-assets] ${name.padEnd(18)} ${(info.bytes / 1024).toFixed(1).padStart(8)} KB`)
  }
  const total = Object.values(manifest.files).reduce((sum, f) => sum + f.bytes, 0)
  console.log(
    `[avatar-assets] ${Object.keys(manifest.nodes).length} nodes, ${manifest.materials.length} materials, ${(total / 1024).toFixed(1)} KB total, ${manifest.compression}`,
  )
  const [worstNode, worstFit] = Object.entries(penetration).sort(([, a], [, b]) => b - a)[0] ?? ['—', 0]
  console.log(
    `[avatar-assets] ${Object.keys(penetration).length} fitted nodes, worst residual penetration ${(worstFit * 1000).toFixed(2)} mm (${worstNode}) of ${(FIT_TOLERANCE * 1000).toFixed(1)} mm allowed`,
  )
  try {
    enforceBudgets(manifest, bodyFilesOf(map))
    mkdirSync(OUT_DIR, { recursive: true })
    for (const name of readdirSync(OUT_DIR)) rmSync(join(OUT_DIR, name), { recursive: true, force: true })
    for (const name of readdirSync(TMP_DIR)) renameSync(join(TMP_DIR, name), join(OUT_DIR, name))
  } finally {
    rmSync(TMP_DIR, { recursive: true, force: true })
  }
}

/** Millimetre precision is plenty for a bounding box or a joint, and keeps the manifest readable. */
const round = (value) => Math.round(value * 1000) / 1000

/** Which files hold a body, for the tighter body budget — from the map, so it survives a rename. */
const bodyFilesOf = (map) => new Set(BODIES.map((body) => map.bodies[body].out))

function enforceBudgets(manifest, bodyFiles) {
  const total = Object.values(manifest.files).reduce((sum, f) => sum + f.bytes, 0)
  for (const [name, info] of Object.entries(manifest.files)) {
    if (info.bytes > MAX_FILE_BYTES) fail(`${name} is ${info.bytes} bytes, over the ${MAX_FILE_BYTES} byte per-file budget`)
    if (bodyFiles.has(name) && info.bytes > MAX_BODY_BYTES) {
      fail(`${name} is ${info.bytes} bytes, over the ${MAX_BODY_BYTES} byte per-body budget`)
    }
  }
  if (total > MAX_TOTAL_BYTES) fail(`the avatar assets are ${total} bytes, over the ${MAX_TOTAL_BYTES} byte budget`)
}

// ──────────────────────────────────────────────────────────────────── check ──

/**
 * The map's fingerprint, published as `manifest.mapSha256`.
 *
 * Over the map's *meaning*, not its bytes: keys are sorted and whitespace and comment formatting are
 * gone, so reflowing the JSON or editing `$comment` does not force a rebuild, while changing a tint, a
 * scale, a `merge` or a `simplify` ratio does — and `--check` then says so instead of letting a committed
 * `.glb` quietly stop matching the map that claims to describe it.
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => key !== '$comment')
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

const mapDigest = (map) => createHash('sha256').update(canonicalJson(map)).digest('hex')

/** Every node key the map says must exist, without touching the source packs. */
function expectedKeys(map) {
  const keys = new Map()
  for (const body of BODIES) keys.set(`body/${body}`, map.bodies[body].out)
  for (const item of map.items) {
    for (const body of BODIES) {
      if (item.variants?.[body]) keys.set(`${item.slot}/${item.id}/${body}`, map.outputs[item.slot])
    }
  }
  return keys
}

/** Every node key the map says is shrinkwrapped onto a body, without touching the source packs. */
function fittedKeys(map) {
  const keys = new Set()
  for (const item of map.items) {
    for (const body of BODIES) {
      const variant = item.variants?.[body]
      if (!variant || variant.empty || variant.primitive) continue
      if (fitMargin(map, item, variant) !== null) keys.add(`${item.slot}/${item.id}/${body}`)
    }
  }
  return keys
}

/**
 * How far a published bound may sit off the geometry that is actually in a committed file.
 *
 * The manifest rounds to a millimetre, and the affine below is anchored on two of those rounded numbers,
 * so a bound in the middle of the range inherits about ¾ mm of that. Quantization itself is worth a
 * thirtieth of a millimetre at 14 bits over a two-metre volume, and is not what this is for: the defect
 * it exists to catch is a node served another node's mesh, which is centimetres out.
 */
const BOUNDS_TOLERANCE = 0.002

/**
 * Check that each node of a committed file really spans what the manifest says it spans.
 *
 * The catch is that positions in a shipped file are **quantized integers**, and the transform back to
 * metres lives either on the node (unskinned meshes) or inside the skin's inverse bind matrices (skinned
 * ones), where it is not recoverable on its own. But quantization is affine and, with
 * `quantizationVolume: 'scene'`, one affine for the whole file — so it can be recovered *from the
 * manifest*: two extreme bounds fix the scale and offset per axis, and every other node's bounds then
 * have to fall on the same line. Two nodes sharing one set of accessors is the case this is aimed at:
 * their raw bounds are identical, so bounds that differ in the manifest cannot both be right.
 */
function checkPublishedBounds(doc, name, manifest, problems) {
  const points = [[], [], []]
  for (const node of doc.getRoot().listNodes()) {
    const key = node.getName()
    const entry = manifest.nodes[key]
    if (!entry || entry.file !== name || !node.getMesh()) continue
    const raw = accessorBounds(node)
    if (!Number.isFinite(raw.min[0])) continue
    const world = [...node.getWorldMatrix()]
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    for (let corner = 0; corner < 8; corner++) {
      const p = transformPoint(world, [corner & 1 ? raw.max[0] : raw.min[0], corner & 2 ? raw.max[1] : raw.min[1], corner & 4 ? raw.max[2] : raw.min[2]])
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], p[a])
        hi[a] = Math.max(hi[a], p[a])
      }
    }
    for (let a = 0; a < 3; a++) {
      points[a].push({ key, raw: lo[a], metres: entry.bounds.min[a], edge: 'min' }, { key, raw: hi[a], metres: entry.bounds.max[a], edge: 'max' })
    }
  }
  for (let a = 0; a < 3; a++) {
    const sorted = [...points[a]].sort((x, y) => x.raw - y.raw)
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    // One node in a file (each body) pins the line through its own two ends and has nothing left to
    // say; the check is only meaningful where several nodes share a quantization volume.
    if (!first || last.raw - first.raw < 1e-9) continue
    const scale = (last.metres - first.metres) / (last.raw - first.raw)
    for (const point of sorted) {
      const expected = first.metres + (point.raw - first.raw) * scale
      if (Math.abs(expected - point.metres) > BOUNDS_TOLERANCE) {
        problems.push(
          `${point.key} publishes ${point.edge} ${point.metres} on axis ${a}, but the vertices ${name} carries for it reach ${round(expected)} — ` +
            `the manifest is describing geometry that is not in the file`,
        )
      }
    }
  }
}

async function check() {
  const map = JSON.parse(readFileSync(MAP_FILE, 'utf8'))
  const problems = []
  if (!existsSync(MANIFEST_FILE)) fail(`${relative(REPO_ROOT, MANIFEST_FILE)} is missing — run \`pnpm avatar:assets\``)
  const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'))
  // Reading a meshopt-compressed file needs the decoder, in this script exactly as in the browser.
  if (manifest.compression === 'meshopt') {
    const { MeshoptDecoder } = await import('meshoptimizer')
    await MeshoptDecoder.ready
    io.registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  }

  if (manifest.version !== 1) problems.push(`manifest version is ${manifest.version}, expected 1`)

  // The map is the input; if it has moved on, the committed `.glb` files are describing yesterday's map.
  const digest = mapDigest(map)
  if (manifest.mapSha256 !== digest) {
    problems.push(`scripts/avatar-map.json hashes to ${digest}, the manifest was built from ${manifest.mapSha256} — run \`pnpm avatar:assets\``)
  }
  if (manifest.budget?.maxBodyBytes !== MAX_BODY_BYTES) {
    problems.push(`the manifest budget says maxBodyBytes ${manifest.budget?.maxBodyBytes}, this script enforces ${MAX_BODY_BYTES}`)
  }

  const onDisk = readdirSync(OUT_DIR).filter((name) => name.endsWith('.glb')).sort()
  const named = Object.keys(manifest.files).sort()
  if (onDisk.join() !== named.join()) problems.push(`public/avatar3d holds [${onDisk}] but the manifest names [${named}]`)

  const bodyFiles = bodyFilesOf(map)
  for (const [name, info] of Object.entries(manifest.files)) {
    const path = join(OUT_DIR, name)
    if (!existsSync(path)) {
      problems.push(`${name} is in the manifest but not on disk`)
      continue
    }
    const binary = readFileSync(path)
    if (binary.length !== info.bytes) problems.push(`${name} is ${binary.length} bytes, the manifest says ${info.bytes}`)
    const sha256 = createHash('sha256').update(binary).digest('hex')
    if (sha256 !== info.sha256) problems.push(`${name} hashes to ${sha256}, the manifest says ${info.sha256}`)
    if (info.bytes > MAX_FILE_BYTES) problems.push(`${name} is over the per-file budget (${info.bytes} > ${MAX_FILE_BYTES})`)
    if (bodyFiles.has(name) && info.bytes > MAX_BODY_BYTES) {
      problems.push(`${name} is over the per-body budget (${info.bytes} > ${MAX_BODY_BYTES})`)
    }
  }

  const total = Object.values(manifest.files).reduce((sum, f) => sum + f.bytes, 0)
  if (total > MAX_TOTAL_BYTES) problems.push(`the assets total ${total} bytes, over the ${MAX_TOTAL_BYTES} budget`)

  const expected = expectedKeys(map)
  for (const [key, file] of expected) {
    const entry = manifest.nodes[key]
    if (!entry) problems.push(`the map declares ${key}, the manifest does not`)
    else if (entry.file !== file) problems.push(`${key} should live in ${file}, the manifest says ${entry.file}`)
  }
  for (const [key, entry] of Object.entries(manifest.nodes)) {
    if (!expected.has(key)) problems.push(`the manifest declares ${key}, the map does not`)
    if (!KEY_RE.test(key)) problems.push(`"${key}" is not a legal node key`)
    // Task 3 frames a camera on these and Task 4 stands the avatar in them; a node without them is a
    // node the renderer cannot place.
    if (!entry.bounds || entry.bounds.min?.length !== 3 || entry.bounds.max?.length !== 3) {
      problems.push(`${key} has no bounds`)
    }
  }

  // The shrinkwrap's guard, re-asserted from what the build published. Measuring it needs the source
  // packs, which a clone does not have; what is checkable here is that the map still asks for exactly
  // the fits the manifest reports, and that every one of them came out inside the tolerance.
  const fitted = fittedKeys(map)
  const published = manifest.fit?.penetration ?? {}
  if (manifest.fit?.tolerance !== FIT_TOLERANCE) {
    problems.push(`the manifest allows a fit penetration of ${manifest.fit?.tolerance}, this script allows ${FIT_TOLERANCE}`)
  }
  for (const key of fitted) {
    if (!(key in published)) problems.push(`the map fits ${key} to the body, the manifest publishes no penetration for it — run \`pnpm avatar:assets\``)
    else if (published[key] > FIT_TOLERANCE) {
      problems.push(`${key} leaves a vertex ${(published[key] * 1000).toFixed(1)} mm inside the body, over the ${(FIT_TOLERANCE * 1000).toFixed(1)} mm tolerance`)
    }
  }
  for (const key of Object.keys(published)) {
    if (!fitted.has(key)) problems.push(`the manifest publishes a fit penetration for ${key}, which the map does not fit`)
  }

  for (const body of BODIES) {
    for (const joint of ANCHOR_JOINTS) {
      if (manifest.anchors?.[body]?.[joint]?.length !== 3) problems.push(`the manifest has no ${body} anchor for ${joint}`)
    }
  }
  for (const joint of Object.keys(ARMS_DOWN)) {
    if (manifest.pose?.armsDown?.[joint]?.length !== 3) problems.push(`the manifest has no pose.armsDown rotation for ${joint}`)
  }

  // …and the files really do contain those nodes under those names, with only canonical materials.
  const canonical = new Set(Object.keys(map.materials.canonical))
  for (const name of onDisk) {
    const doc = await io.read(join(OUT_DIR, name))
    const present = new Set(doc.getRoot().listNodes().map((node) => node.getName()))
    for (const [key, entry] of Object.entries(manifest.nodes)) {
      if (entry.file === name && !present.has(key)) problems.push(`${name} does not contain a node named ${key}`)
    }
    for (const material of doc.getRoot().listMaterials()) {
      if (!canonical.has(material.getName())) problems.push(`${name} has a material named "${material.getName()}", which is not canonical`)
    }
    // Skins are kept now, but exactly as many as the manifest claims — one per body, not one per
    // garment, which is the difference between 4 KB of inverse bind matrices in this file and 120 KB.
    const skins = doc.getRoot().listSkins().length
    if (skins !== manifest.files[name].skins) problems.push(`${name} carries ${skins} skin(s), the manifest says ${manifest.files[name].skins}`)
    for (const [key, entry] of Object.entries(manifest.nodes)) {
      if (entry.file !== name || !present.has(key)) continue
      const node = doc.getRoot().listNodes().find((candidate) => candidate.getName() === key)
      if (skins > 0 && node.getMesh() && !node.getSkin()) problems.push(`${key} is in a skinned file but has no skin`)
    }
    const meshopt = doc.getRoot().listExtensionsUsed().some((extension) => extension.extensionName === 'EXT_meshopt_compression')
    if (meshopt !== (manifest.compression === 'meshopt')) {
      problems.push(`${name} ${meshopt ? 'uses' : 'does not use'} EXT_meshopt_compression, the manifest says compression is ${manifest.compression}`)
    }
    if (doc.getRoot().listAnimations().length > 0) problems.push(`${name} still carries an animation`)
    if (doc.getRoot().listTextures().length > 0) problems.push(`${name} still carries a texture`)
    checkPublishedBounds(doc, name, manifest, problems)
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`[avatar-assets] ${problem}`)
    fail(`${problems.length} problem(s) — the committed avatar assets do not match scripts/avatar-map.json`)
  }
  console.log(`[avatar-assets] ok: ${onDisk.length} files, ${Object.keys(manifest.nodes).length} nodes, ${(total / 1024).toFixed(1)} KB of ${(MAX_TOTAL_BYTES / 1024).toFixed(0)} KB budget`)
}

// ───────────────────────────────────────────────────────────────────── list ──

async function list(target) {
  const map = JSON.parse(readFileSync(MAP_FILE, 'utf8'))
  const root = target.startsWith('@') || !existsSync(target) ? resolveSource(map, target) : resolve(target)
  const files = statSync(root).isDirectory()
    ? readdirSync(root).filter((name) => /\.(gltf|glb)$/i.test(name)).map((name) => join(root, name))
    : [root]
  for (const file of files) {
    const doc = await io.read(file)
    console.log(`\n== ${relative(EXTRACT_DIR, file)}`)
    console.log(`   materials: ${doc.getRoot().listMaterials().map((m) => m.getName()).join(', ') || '(none)'}`)
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh()
      if (!mesh) continue
      const verts = mesh.listPrimitives().reduce((n, p) => n + (p.getAttribute('POSITION')?.getCount() ?? 0), 0)
      const mats = mesh.listPrimitives().map((p) => p.getMaterial()?.getName() ?? '(none)').join('+')
      console.log(`   node ${node.getName()} — ${verts} verts, ${mats}${node.getSkin() ? ', skinned' : ''}`)
    }
    for (const skin of doc.getRoot().listSkins()) {
      const ibm = skin.getInverseBindMatrices()
      if (!ibm) continue
      const joints = skin.listJoints().map((joint, i) => {
        const p = inverseTranslation(ibm.getElement(i, new Array(16))).map((v) => v.toFixed(3))
        return `${joint.getName()}[${p.join(',')}]`
      })
      console.log(`   joints: ${joints.join(' ')}`)
    }
  }
}

// ───────────────────────────────────────────────────────────────────── main ──

const args = process.argv.slice(2)
const useMeshopt = !args.includes('--no-meshopt')
const listAt = args.indexOf('--list')

try {
  if (listAt >= 0) {
    const target = args[listAt + 1]
    if (!target) fail('--list needs a path, e.g. --list "@parts/Male_Ranger_Body.gltf"')
    await list(target)
  } else if (args.includes('--check')) {
    await check()
  } else {
    await build({ useMeshopt })
  }
} catch (error) {
  if (!process.exitCode) {
    console.error(`[avatar-assets] ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  }
  if (process.env.AVATAR_ASSETS_DEBUG) console.error(error)
}
