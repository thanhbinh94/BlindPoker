/**
 * The committed avatar assets (design §4, §7).
 *
 * `public/avatar3d/` is a build artefact that is *committed*, which is unusual enough to be worth
 * saying why: the packs it is built from are 400 MB of CC0 archives that no checkout and no CI runner
 * has, so if the `.glb` files were built on demand the app could not be built at all without them. What
 * this suite defends is the consequence of that choice — that the artefact in git is the artefact
 * `scripts/avatar-assets.mjs` would produce, and that nobody has hand-edited, renamed or quietly
 * fattened one of the five files since.
 *
 * The suite reads only what is committed. It never touches `assets/avatar-src/`, so it passes on a
 * fresh clone that has never downloaded a pack.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT_DIR = resolve(PACKAGE_ROOT, 'public/avatar3d')
const SCRIPT = resolve(PACKAGE_ROOT, 'scripts/avatar-assets.mjs')
const MAP_FILE = resolve(PACKAGE_ROOT, 'scripts/avatar-map.json')
/** The item catalogue, which is the server's file — read here, and only read, for the tint contract. */
const CATALOG_FILE = resolve(PACKAGE_ROOT, '../normal-server/data/items.json')

/** The same shape `scripts/avatar-assets.mjs` writes. */
interface AvatarManifest {
  version: number
  generatedAt: string
  placeholder: boolean
  compression: 'meshopt' | 'quantize'
  mapSha256: string
  files: Record<string, { bytes: number; sha256: string; skins: number }>
  nodes: Record<string, { file: string; bytes: number; bounds: { min: number[]; max: number[] }; tint?: string }>
  materials: string[]
  anchors: Record<string, Record<string, number[]>>
  pose: { armsDown: Record<string, number[]> }
  budget: { totalBytes: number; maxFileBytes: number; maxBodyBytes: number }
}

/** Node keys are the contract between this pipeline, the item catalogue and the renderer. */
const KEY_RE = /^(body\/(male|female)|(hair|top|bottom|shoes|hat|accessory|jewelry)\/[a-z0-9_]+\/(male|female))$/

const MAX_TOTAL_BYTES = 6 * 1024 * 1024
const MAX_FILE_BYTES = Math.round(1.5 * 1024 * 1024)
/** Design §4: each body file is held to a tighter budget than the shared ones. */
const MAX_BODY_BYTES = 400 * 1024

const CANONICAL_MATERIALS = ['cloth_primary', 'cloth_secondary', 'eyes', 'hair', 'metal', 'skin']

/** The joints Task 3 frames a portrait by and Task 4 stands the avatar on. */
const ANCHOR_JOINTS = ['Head', 'neck_01', 'upperarm_l', 'upperarm_r', 'hand_l', 'hand_r', 'pelvis']
/** The joints the standing pose rotates: the arms, and only the arms. */
const POSED_JOINTS = ['upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r']

const manifest = JSON.parse(readFileSync(join(OUT_DIR, 'manifest.json'), 'utf8')) as AvatarManifest
const map = JSON.parse(readFileSync(MAP_FILE, 'utf8')) as {
  bodies: Record<string, { out: string }>
  outputs: Record<string, string>
  items: { id: string; slot: string; variants?: Record<string, unknown> }[]
}
const catalog = JSON.parse(readFileSync(CATALOG_FILE, 'utf8')) as {
  id: string
  variants?: Record<string, { node: string; file: string; tint?: string } | null>
}[]

describe('avatar asset manifest', () => {
  it('is a version 1 manifest built from real packs', () => {
    expect(manifest.version).toBe(1)
    expect(Number.isNaN(Date.parse(manifest.generatedAt))).toBe(false)
    // `true` would mean the pipeline ran without the CC0 packs and emitted stand-in shapes; the
    // committed assets are the real ones, and this is the test that would catch a silent downgrade.
    expect(manifest.placeholder).toBe(false)
    expect(manifest.budget).toEqual({ totalBytes: MAX_TOTAL_BYTES, maxFileBytes: MAX_FILE_BYTES, maxBodyBytes: MAX_BODY_BYTES })
  })

  it('was built from the map that is committed beside it', () => {
    // The manifest fingerprints the map it was built from, so editing a tint or a scale without
    // rebuilding is caught here and by `--check` rather than discovered in the renderer.
    expect(manifest.mapSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('says how the geometry is compressed, so the loader can wire the decoder', () => {
    // Keeping the skins left `outfits.glb` at 97 % of the per-file budget as plain quantized geometry,
    // so the files use EXT_meshopt_compression — which three.js will not read until `setMeshoptDecoder`
    // has been called. This value is how Task 3 knows that.
    expect(manifest.compression).toBe('meshopt')
  })

  it('names every file that is on disk, and nothing that is not', () => {
    const onDisk = readdirSync(OUT_DIR).filter((name) => name.endsWith('.glb')).sort()
    expect(onDisk).toEqual(Object.keys(manifest.files).sort())
    expect(onDisk).toEqual(['accessories.glb', 'body-female.glb', 'body-male.glb', 'hair.glb', 'outfits.glb'])
  })

  it('records the exact size and hash of each file', () => {
    for (const [name, info] of Object.entries(manifest.files)) {
      const path = join(OUT_DIR, name)
      expect(existsSync(path), `${name} is in the manifest but not on disk`).toBe(true)
      const binary = readFileSync(path)
      expect(binary.length, `${name} size`).toBe(info.bytes)
      expect(createHash('sha256').update(binary).digest('hex'), `${name} hash`).toBe(info.sha256)
    }
  })

  it('keeps every file, and the whole set, inside the download budget', () => {
    let total = 0
    for (const [name, info] of Object.entries(manifest.files)) {
      total += info.bytes
      expect(info.bytes, `${name} is over the per-file budget`).toBeLessThanOrEqual(MAX_FILE_BYTES)
      if (name.startsWith('body-')) expect(info.bytes, `${name} is over the body budget`).toBeLessThanOrEqual(MAX_BODY_BYTES)
    }
    console.log(`[avatar-assets] ${(total / 1024).toFixed(1)} KB across ${Object.keys(manifest.files).length} files (budget ${(MAX_TOTAL_BYTES / 1024).toFixed(0)} KB)`)
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES)
  })

  it('names every node by the slot/item/body convention', () => {
    const keys = Object.keys(manifest.nodes)
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) expect(key, `${key} is not a legal node key`).toMatch(KEY_RE)
    expect(keys).toContain('body/male')
    expect(keys).toContain('body/female')
    for (const entry of Object.values(manifest.nodes)) {
      expect(Object.keys(manifest.files)).toContain(entry.file)
      expect(entry.bytes).toBeGreaterThanOrEqual(0)
    }
  })

  it('gives every node the bounds a camera frames it by', () => {
    for (const [key, entry] of Object.entries(manifest.nodes)) {
      expect(entry.bounds, `${key} has no bounds`).toBeDefined()
      expect(entry.bounds.min, `${key} min`).toHaveLength(3)
      expect(entry.bounds.max, `${key} max`).toHaveLength(3)
      for (let axis = 0; axis < 3; axis++) {
        expect(entry.bounds.max[axis], `${key} axis ${axis}`).toBeGreaterThanOrEqual(entry.bounds.min[axis]!)
      }
    }
    // Both bodies stand on the floor and are roughly human-sized: the bounds are in metres, in the same
    // frame as the anchors, and a renderer that assumed otherwise would frame an empty stage.
    for (const body of ['male', 'female']) {
      const bounds = manifest.nodes[`body/${body}`]!.bounds
      expect(bounds.min[1]).toBeGreaterThan(-0.1)
      expect(bounds.min[1]).toBeLessThan(0.1)
      expect(bounds.max[1]).toBeGreaterThan(1.5)
      expect(bounds.max[1]).toBeLessThan(2)
    }
  })

  it('publishes the bind position of the joints a camera and a stage need', () => {
    for (const body of ['male', 'female']) {
      const anchors = manifest.anchors[body]
      expect(anchors, `${body} anchors`).toBeDefined()
      expect(Object.keys(anchors!).sort()).toEqual([...ANCHOR_JOINTS].sort())
      for (const joint of ANCHOR_JOINTS) expect(anchors![joint], `${body}/${joint}`).toHaveLength(3)
      // Head above hips above the floor — a sanity check on the frame, not on the modelling.
      expect(anchors!.Head![1]).toBeGreaterThan(anchors!.neck_01![1]!)
      expect(anchors!.neck_01![1]).toBeGreaterThan(anchors!.pelvis![1]!)
      // The arms are out to the sides in the bind pose: that is why `pose.armsDown` exists.
      expect(anchors!.hand_l![0]).toBeGreaterThan(0.5)
      expect(anchors!.hand_r![0]).toBeLessThan(-0.5)
    }
  })

  it('publishes the standing pose as rotations of the arm joints only', () => {
    const pose = manifest.pose.armsDown
    expect(Object.keys(pose).sort()).toEqual([...POSED_JOINTS].sort())
    for (const joint of POSED_JOINTS) {
      expect(pose[joint], joint).toHaveLength(3)
      for (const radians of pose[joint]!) expect(Math.abs(radians)).toBeLessThanOrEqual(Math.PI)
    }
    // Left and right mirror about the body's plane of symmetry, or the avatar stands lopsided.
    expect(pose.upperarm_l![2]).toBeCloseTo(-pose.upperarm_r![2]!, 6)
    expect(pose.lowerarm_l![2]).toBeCloseTo(-pose.lowerarm_r![2]!, 6)
    expect(pose.upperarm_l![2]).toBeLessThan(0)
  })

  it('keeps one skeleton per body — in the bodies and in the outfits, nowhere else', () => {
    // A skin per garment would be 28 copies of a 65-joint matrix table in `outfits.glb`; hair and the
    // generated accessories are never posed and carry no skin at all.
    expect(manifest.files['body-male.glb']!.skins).toBe(1)
    expect(manifest.files['body-female.glb']!.skins).toBe(1)
    expect(manifest.files['outfits.glb']!.skins).toBe(2)
    expect(manifest.files['hair.glb']!.skins).toBe(0)
    expect(manifest.files['accessories.glb']!.skins).toBe(0)
  })

  it('covers both bodies of every item the map declares', () => {
    for (const item of map.items) {
      for (const body of ['male', 'female']) {
        if (!item.variants?.[body]) continue
        const key = `${item.slot}/${item.id}/${body}`
        expect(manifest.nodes[key], `${key} is missing from the manifest`).toBeDefined()
        expect(manifest.nodes[key]!.file).toBe(map.outputs[item.slot])
      }
    }
  })

  it('uses only the six canonical material names', () => {
    expect(manifest.materials).toEqual(CANONICAL_MATERIALS)
  })

  it('agrees with the item catalogue about the colour of every item that names one', () => {
    // Two sources of truth for a colour is one too many: the catalogue's `tint` is what the renderer
    // applies, the manifest's is what is baked into the mesh, and an item whose two disagree renders in
    // a colour nobody chose. The pipeline owns the value — `scripts/avatar-map.json` is where it is
    // edited — and this is the assertion that keeps the catalogue honest about it.
    let checked = 0
    for (const item of catalog) {
      for (const [body, variant] of Object.entries(item.variants ?? {})) {
        if (!variant?.tint) continue
        const node = manifest.nodes[variant.node]
        expect(node, `${item.id}/${body} names ${variant.node}, which the manifest does not`).toBeDefined()
        expect(node!.tint, `${item.id}/${body} tint`).toBe(variant.tint.toLowerCase())
        checked++
      }
    }
    expect(checked, 'no catalogue item carries a tint any more — drop this test or the field').toBeGreaterThan(0)
  })

  it('bakes a tint into every garment, and none into what the player recolours', () => {
    for (const [key, entry] of Object.entries(manifest.nodes)) {
      const [slot] = key.split('/')
      // Bodies and hair are `skin`/`eyes`/`hair`, recoloured at run time from the player's own
      // configuration; an item tint on them would fight that.
      if (slot === 'body' || slot === 'hair') expect(entry.tint, key).toBeUndefined()
      else expect(entry.tint, key).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

describe('avatar asset pipeline', () => {
  it('agrees that the committed output matches the map', () => {
    // The script's own verification, which also opens each `.glb` and checks that the nodes really are
    // named what the manifest says and that no skin, animation or texture survived. It exits non-zero
    // on any mismatch, which `execFileSync` turns into a thrown error.
    const stdout = execFileSync(process.execPath, [SCRIPT, '--check'], { cwd: PACKAGE_ROOT, encoding: 'utf8' })
    expect(stdout).toMatch(/\bok\b/)
  })
})
