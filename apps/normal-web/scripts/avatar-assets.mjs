#!/usr/bin/env node
/**
 * The avatar asset pipeline: CC0 source packs in → five `.glb` files and a `manifest.json` out.
 *
 *   node scripts/avatar-assets.mjs                 build `public/avatar3d/` from `scripts/avatar-map.json`
 *   node scripts/avatar-assets.mjs --check         verify the committed output against the map; no writes
 *   node scripts/avatar-assets.mjs --list <path>   print the node, material and joint names of a source
 *                                                  glTF (or every glTF under a directory), which is how
 *                                                  a new `avatar-map.json` entry gets its `node` name
 *   …--meshopt                                     also apply EXT_meshopt_compression (see below)
 *
 * Why a build step at all (design §4). The packs are ~400 MB of rigged FBX/glTF with 2K textures, split
 * across a dozen files whose mesh names mean something to a Blender file and nothing to this app. What
 * the browser wants is the opposite: a handful of same-origin `.glb` files it can cache forever, whose
 * nodes are named after *our* item ids (`top/clothing_aodai/female`) and whose materials are named after
 * the six things a player can recolour. That renaming is the whole point — after this script runs, no
 * other file in the repository needs to know a source mesh exists.
 *
 * What each node loses on the way through: its skin and every animation (the avatar is static — the bind
 * pose is the T-pose the packs ship, and glTF defines skinned geometry in bind space, so dropping the
 * skin keeps exactly the shape you see in Blender), its texture coordinates, and its textures. Textures
 * go because they cannot survive the budget without a resizer — `sharp` is not installed and the packs'
 * base-colour maps are 1.3–4 MB each — and, more importantly, because they would fight the feature: the
 * body's base colour map bakes in *one* skin tone, and the player picks from eight. Flat PBR materials
 * with a `baseColorFactor` are what a runtime tint can actually address. See `docs/avatar-assets.md`.
 *
 * Compression: `weld` → `quantize` (KHR_mesh_quantization, positions at 14 bits and normals at 8) →
 * `dedup` → `prune`. Quantization, not meshopt, is the default *even though `meshoptimizer` is
 * installed*: three.js reads KHR_mesh_quantization with no help, but EXT_meshopt_compression throws in
 * `GLTFLoader` unless the caller has wired `setMeshoptDecoder` first — a WASM decoder in the lazy avatar
 * chunk, and a silent black stage the day someone forgets it. The output sits at a third of the budget
 * without it. `--meshopt` turns it on for anyone who later decides the trade is worth making.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
const MAP_FILE = resolve(PACKAGE_ROOT, 'scripts/avatar-map.json')
const MANIFEST_FILE = join(OUT_DIR, 'manifest.json')

/** Spec §7: everything the avatar downloads, and the largest single file inside that. */
const MAX_TOTAL_BYTES = 6 * 1024 * 1024
const MAX_FILE_BYTES = Math.round(1.5 * 1024 * 1024)

/** The two bodies, and the node key each item variant is written under. */
const BODIES = ['male', 'female']
const KEY_RE = /^(body\/(male|female)|(hair|top|bottom|shoes|hat|accessory|jewelry)\/[a-z0-9_]+\/(male|female))$/

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

/** `@parts/Male_Ranger_Body.gltf` → an absolute path under `extracted/`. */
function resolveSource(map, spec) {
  const hit = /^@([a-z]+)\/(.+)$/.exec(spec)
  if (!hit) return resolve(EXTRACT_DIR, spec)
  const dir = map.dirs[hit[1]]
  if (!dir) fail(`unknown source directory alias @${hit[1]} in ${spec}`)
  return join(EXTRACT_DIR, dir, hit[2])
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
 * Pull one node's primitives out of a source document as plain arrays.
 *
 * A *skinned* node's transform is ignored, exactly as glTF requires: the vertices are already in the
 * skeleton's bind space, which is the space every part of both packs shares. An unskinned node (the
 * hairstyles) gets its world matrix baked in instead.
 */
function readParts(doc, node, path) {
  const mesh = node.getMesh()
  if (!mesh) fail(`node "${node.getName()}" in ${relative(REPO_ROOT, path)} has no mesh`)
  const world = node.getSkin() ? identity() : [...node.getWorldMatrix()]
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
    parts.push({ positions, normals, indices, sourceMaterial: prim.getMaterial()?.getName() ?? '' })
  }
  if (parts.length === 0) fail(`node "${node.getName()}" in ${relative(REPO_ROOT, path)} has no positions`)
  return parts
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
 */
function applyScale(parts, scale, anchor) {
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
    const indices = new Uint32Array(kept.length)
    for (let i = 0; i < kept.length; i++) {
      const source = kept[i]
      let index = remap.get(source)
      if (index === undefined) {
        index = remap.size
        remap.set(source, index)
        positions.push(part.positions[source * 3], part.positions[source * 3 + 1], part.positions[source * 3 + 2])
        normals.push(part.normals[source * 3], part.normals[source * 3 + 1], part.normals[source * 3 + 2])
      }
      indices[i] = index
    }
    part.positions = Float32Array.from(positions)
    part.normals = Float32Array.from(normals)
    part.indices = indices
  }
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
  return { doc, buffer, scene, materials: new Map(), accessors: new Map(), nodes: [] }
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
function addNode(bundle, map, key, parts, cacheKey) {
  const mesh = bundle.doc.createMesh(key)
  parts.forEach((part, index) => {
    const id = cacheKey ? `${cacheKey}#${index}` : null
    let accessors = id ? bundle.accessors.get(id) : null
    if (!accessors) {
      accessors = {
        position: bundle.doc.createAccessor().setType('VEC3').setArray(part.positions).setBuffer(bundle.buffer),
        normal: bundle.doc.createAccessor().setType('VEC3').setArray(part.normals).setBuffer(bundle.buffer),
        indices: bundle.doc.createAccessor().setType('SCALAR').setArray(part.indices).setBuffer(bundle.buffer),
      }
      if (id) bundle.accessors.set(id, accessors)
    }
    mesh.addPrimitive(
      bundle.doc
        .createPrimitive()
        .setAttribute('POSITION', accessors.position)
        .setAttribute('NORMAL', accessors.normal)
        .setIndices(accessors.indices)
        .setMaterial(materialFor(bundle, map, part.canonical, part.tint)),
    )
  })
  const node = bundle.doc.createNode(key).setMesh(mesh)
  bundle.scene.addChild(node)
  bundle.nodes.push(key)
  return node
}

/** Read a variant (or a body) from the packs: primary node plus every `merge` entry, then any scale. */
async function readVariant(map, variant, defaultFile) {
  const entries = [{ ...variant, file: variant.file ?? defaultFile }, ...(variant.merge ?? [])]
  const parts = []
  for (const entry of entries) {
    const path = resolveSource(map, entry.file ?? variant.file ?? defaultFile)
    const doc = await sourceDoc(path)
    for (const part of readParts(doc, findNode(doc, entry.node, path), path)) {
      const canonical = entry.material ?? map.materials.bySourceName[part.sourceMaterial] ?? map.materials.default
      parts.push({ ...part, canonical, tint: entry.tint ?? variant.tint })
    }
  }
  if (variant.scale) applyScale(parts, variant.scale, variant.scaleAnchor ?? 'bottom')
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

async function optimise(bundle, useMeshopt) {
  // `quantizationVolume: 'scene'` and not the default `'mesh'`: nodes that are the same garment in a
  // different colour share their vertex accessors, and a per-mesh volume would want to quantize one
  // shared accessor two different ways. One volume for the file keeps the sharing (and `dedup`'s ability
  // to find it again after `weld` has copied things around) intact.
  //
  // Normals at 8 bits rather than the default 10: it costs about a degree of precision on a shape that
  // is never seen larger than a browser tab, and takes a fifth off every file.
  await bundle.doc.transform(weld(), quantize({ quantizationVolume: 'scene', quantizeNormal: 8 }), dedup(), prune({ keepLeaves: true }))
  if (useMeshopt) {
    const [{ meshopt }, { MeshoptEncoder }] = await Promise.all([import('@gltf-transform/functions'), import('meshoptimizer')])
    await MeshoptEncoder.ready
    io.registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
    await bundle.doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }))
  }
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
      for (const accessor of [prim.getAttribute('POSITION'), prim.getAttribute('NORMAL'), prim.getIndices()]) {
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

  const anchors = {}
  for (const body of BODIES) {
    const spec = map.bodies[body]
    anchors[body] = await readAnchors(map, spec)
    addNode(bundleFor(spec.out), map, `body/${body}`, await readVariant(map, spec, spec.file), null)
  }

  const emptyNodes = []
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
      const parts = variant.primitive
        ? buildPrimitive(variant.primitive, anchors[body], variant.tint)
        : await readVariant(map, variant, variant.file)
      // Two items that are the same mesh in different colours share one copy of the vertex data.
      const cacheKey = variant.primitive
        ? null
        : JSON.stringify([variant.file, variant.node, variant.merge ?? [], variant.scale ?? [], variant.scaleAnchor ?? '', variant.simplify ?? 0])
      addNode(bundleFor(file), map, key, parts, cacheKey)
    }
  }

  mkdirSync(OUT_DIR, { recursive: true })
  for (const name of readdirSync(OUT_DIR)) rmSync(join(OUT_DIR, name), { force: true })

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
    }
    const bytesByNode = nodeBytes(bundle)
    const binary = Buffer.from(await io.writeBinary(bundle.doc))
    writeFileSync(join(OUT_DIR, name), binary)
    files[name] = { bytes: binary.length, sha256: createHash('sha256').update(binary).digest('hex') }
    for (const key of bundle.nodes) nodes[key] = { file: name, bytes: bytesByNode[key] ?? 0 }
    for (const material of bundle.doc.getRoot().listMaterials()) materials.add(material.getName())
  }

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    placeholder: false,
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
    nodes: Object.fromEntries(Object.entries(nodes).sort(([a], [b]) => a.localeCompare(b))),
    materials: [...materials].sort(),
    budget: { totalBytes: MAX_TOTAL_BYTES, maxFileBytes: MAX_FILE_BYTES },
  }
  writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`)

  for (const [name, info] of Object.entries(manifest.files)) {
    console.log(`[avatar-assets] ${name.padEnd(18)} ${(info.bytes / 1024).toFixed(1).padStart(8)} KB`)
  }
  const total = Object.values(manifest.files).reduce((sum, f) => sum + f.bytes, 0)
  console.log(`[avatar-assets] ${Object.keys(manifest.nodes).length} nodes, ${manifest.materials.length} materials, ${(total / 1024).toFixed(1)} KB total`)
  enforceBudgets(manifest)
}

function enforceBudgets(manifest) {
  const total = Object.values(manifest.files).reduce((sum, f) => sum + f.bytes, 0)
  for (const [name, info] of Object.entries(manifest.files)) {
    if (info.bytes > MAX_FILE_BYTES) fail(`${name} is ${info.bytes} bytes, over the ${MAX_FILE_BYTES} byte per-file budget`)
  }
  if (total > MAX_TOTAL_BYTES) fail(`the avatar assets are ${total} bytes, over the ${MAX_TOTAL_BYTES} byte budget`)
}

// ──────────────────────────────────────────────────────────────────── check ──

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

async function check() {
  const map = JSON.parse(readFileSync(MAP_FILE, 'utf8'))
  const problems = []
  if (!existsSync(MANIFEST_FILE)) fail(`${relative(REPO_ROOT, MANIFEST_FILE)} is missing — run \`pnpm avatar:assets\``)
  const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'))

  if (manifest.version !== 1) problems.push(`manifest version is ${manifest.version}, expected 1`)

  const onDisk = readdirSync(OUT_DIR).filter((name) => name.endsWith('.glb')).sort()
  const named = Object.keys(manifest.files).sort()
  if (onDisk.join() !== named.join()) problems.push(`public/avatar3d holds [${onDisk}] but the manifest names [${named}]`)

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
  }

  const total = Object.values(manifest.files).reduce((sum, f) => sum + f.bytes, 0)
  if (total > MAX_TOTAL_BYTES) problems.push(`the assets total ${total} bytes, over the ${MAX_TOTAL_BYTES} budget`)

  const expected = expectedKeys(map)
  for (const [key, file] of expected) {
    const entry = manifest.nodes[key]
    if (!entry) problems.push(`the map declares ${key}, the manifest does not`)
    else if (entry.file !== file) problems.push(`${key} should live in ${file}, the manifest says ${entry.file}`)
  }
  for (const key of Object.keys(manifest.nodes)) {
    if (!expected.has(key)) problems.push(`the manifest declares ${key}, the map does not`)
    if (!KEY_RE.test(key)) problems.push(`"${key}" is not a legal node key`)
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
    if (doc.getRoot().listSkins().length > 0) problems.push(`${name} still carries a skin`)
    if (doc.getRoot().listAnimations().length > 0) problems.push(`${name} still carries an animation`)
    if (doc.getRoot().listTextures().length > 0) problems.push(`${name} still carries a texture`)
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
const useMeshopt = args.includes('--meshopt')
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
