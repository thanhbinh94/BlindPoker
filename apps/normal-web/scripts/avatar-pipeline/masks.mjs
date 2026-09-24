/**
 * Hair, eye and tint masks: cutting a recolourable region out of a layer that was drawn flat.
 *
 * Spec §4.1, port of the throwaway spike (`.superpowers/sdd/2026-09-24-plan13-avatar-tint/tint-spike.mjs`)
 * that first proved hair and iris could be told apart from a flat AI base. The spike worked on one fixed
 * canvas (768 × 896, the frame at @2x) with its numbers baked into that size; everything below is the same
 * arithmetic parametrised on `pic.width`/`pic.height` so it runs on a layer at either density. The spike's
 * own constants are written for a 768 px-wide picture, so every one of them is scaled by `pic.width / 768`
 * before use (`scale`); the few that come from `frame.mjs` (`FACE_LIMIT_Y`, `SKIN_WINDOW`) already have
 * their own frame-unit convention and are scaled by `pic.width / FRAME.w` instead (`density`) — the two
 * agree exactly at 768 px, where `density = 2` and `scale = 1`.
 *
 * A mask here is a `Uint8Array` of `width * height`, 0 or 255 per pixel (hard-edged: `writeMasks` softens
 * nothing, the @1x copy's own downscale gives the soft edge — D01 §8.3's antialiasing is a property of a
 * *picture*, not of a mask cut from one).
 */
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { FACE_LIMIT_Y, FRAME, LAYERS, SKIN_WINDOW } from './frame.mjs'
import { PACKAGE_ROOT, itemFile, parseName, wearOf } from './manifest.mjs'
import { ALPHA_INK, readPicture, resizePicture, writePicture } from './png.mjs'
import { meanLightness } from '../../../../packages/ui-kit/src/avatar2d/recolour.mjs'

/** Where a hand-drawn mask overrides the automatic one (spec §4.1). Committed — see `.gitignore` there. */
export const MASK_OVERRIDE_DIR = join(PACKAGE_ROOT, '../../assets/avatar-src/masks')

// ─────────────────────────────────────────────────────────────────── colour ──

/** sRGB (0–255) to CIE Lab, D65. Verbatim from the spike. */
function labOf(r, g, b) {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  const R = f(r)
  const G = f(g)
  const B = f(b)
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const g2 = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = g2(x)
  const fy = g2(y)
  const fz = g2(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}
const labDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/**
 * k-means over Lab points, deterministic: the seed centres are a stride through `points` rather than a
 * random sample, so the same picture always cuts the same mask (no `Math.random`, ever).
 */
function kmeans(points, k, iters = 12) {
  if (points.length === 0) return Array.from({ length: k }, () => [0, 0, 0])
  const stride = Math.max(1, Math.floor(points.length / k))
  let centres = points.filter((_, i) => i % stride === 0).slice(0, k)
  for (let extra = 0; centres.length < k; extra++) centres.push(points[extra % points.length])
  for (let it = 0; it < iters; it++) {
    const sums = centres.map(() => [0, 0, 0, 0])
    for (const p of points) {
      let bi = 0
      let bd = Infinity
      centres.forEach((c, i) => { const d = labDist(p, c); if (d < bd) { bd = d; bi = i } })
      const s = sums[bi]
      s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++
    }
    centres = sums.map((s, i) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : centres[i]))
  }
  return centres
}

function countAssignments(points, centres) {
  const counts = centres.map(() => 0)
  for (const p of points) {
    let bi = 0
    let bd = Infinity
    centres.forEach((c, i) => { const d = labDist(p, c); if (d < bd) { bd = d; bi = i } })
    counts[bi]++
  }
  return counts
}

// ─────────────────────────────────────────────────────────────── morphology ──

const NEIGHBOURS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]

/** 8-connected components, iterative (a recursive flood fill overflows the stack on a 768 × 896 mask). */
function components(mask, width, height) {
  const label = new Int32Array(width * height).fill(-1)
  const sizes = []
  const stack = []
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start] >= 0) continue
    const id = sizes.length
    sizes.push(0)
    stack.push(start)
    label[start] = id
    while (stack.length) {
      const p = stack.pop()
      sizes[id]++
      const x = p % width
      const y = (p - x) / width
      for (const [dx, dy] of NEIGHBOURS8) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const q = ny * width + nx
        if (mask[q] && label[q] < 0) { label[q] = id; stack.push(q) }
      }
    }
  }
  return { label, sizes }
}

/** Circular-kernel dilate/erode/close, exactly the spike's — a square kernel gives a visibly different edge. */
function dilate(mask, width, height, r) {
  const out = new Uint8Array(mask)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && dx * dx + dy * dy <= r * r) out[ny * width + nx] = 1
        }
      }
    }
  }
  return out
}
function erode(mask, width, height, r) {
  const inv = new Uint8Array(width * height)
  for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1
  const d = dilate(inv, width, height, r)
  const out = new Uint8Array(width * height)
  for (let i = 0; i < out.length; i++) out[i] = d[i] ? 0 : 1
  return out
}
const close = (m, width, height, r) => erode(dilate(m, width, height, r), width, height, r)

// ─────────────────────────────────────────────────────────────────── shared ──

const opaqueAt = (pic, i) => pic.data[i * 4 + 3] > 200

function labPlane(pic) {
  const { width, height, data } = pic
  const LAB = new Float32Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    if (!opaqueAt(pic, i)) continue
    const [L, a, b] = labOf(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
    LAB[i * 3] = L; LAB[i * 3 + 1] = a; LAB[i * 3 + 2] = b
  }
  return LAB
}

/** The first opaque row, top to bottom. `height` when the picture is empty. */
function headTop(pic) {
  const { width, height } = pic
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (opaqueAt(pic, y * width + x)) return y
  }
  return height
}

function collectPoints(pic, labAt, x0, x1, y0, y1) {
  const { width, height } = pic
  const points = []
  for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
      const i = y * width + x
      if (opaqueAt(pic, i)) points.push(labAt(i))
    }
  }
  return points
}

/**
 * The steps `hairMask` and `eyeMask` share (spike steps 1–4): Lab per pixel, the head's top row and
 * horizontal centre, the hair palette (a patch just under the head top) and the skin palette (`SKIN_WINDOW`,
 * kept to the two most populous clusters that are not hair-like). Recomputed by each caller — it is cheap
 * next to the mask it feeds, and it keeps `hairMask`/`eyeMask` each a plain function of their own picture.
 */
function analysePicture(pic) {
  const { width, height } = pic
  const scale = width / 768
  const density = width / FRAME.w
  const LAB = labPlane(pic)
  const labAt = (i) => [LAB[i * 3], LAB[i * 3 + 1], LAB[i * 3 + 2]]

  const top = headTop(pic)
  const band = Math.round(200 * scale)
  let cxSum = 0
  let cxN = 0
  for (let x = 0; x < width; x++) {
    for (let y = top; y < Math.min(height, top + band); y++) {
      if (opaqueAt(pic, y * width + x)) { cxSum += x; cxN++ }
    }
  }
  const cx = cxN ? Math.round(cxSum / cxN) : Math.round(width / 2)

  const hy0 = top + Math.round(6 * scale)
  const hy1 = top + Math.round(70 * scale)
  const hx0 = cx - Math.round(70 * scale)
  const hx1 = cx + Math.round(70 * scale)
  const hairPal = kmeans(collectPoints(pic, labAt, hx0, hx1, hy0, hy1), 4)

  const sy0 = Math.round(SKIN_WINDOW.y0 * density)
  const sy1 = Math.round(FACE_LIMIT_Y * density)
  const sx0 = Math.round(SKIN_WINDOW.x0 * density)
  const sx1 = Math.round(SKIN_WINDOW.x1 * density)
  const skinPts = collectPoints(pic, labAt, sx0, sx1, sy0, sy1)
  const skinPal = kmeans(skinPts, 5)
  const counts = countAssignments(skinPts, skinPal)
  const skinOnly = skinPal
    .map((c, i) => ({ c, n: counts[i] }))
    .filter(({ c }) => c[0] > 30 && Math.min(...hairPal.map((h) => labDist(h, c))) > 12)
    .sort((a, b) => b.n - a.n)
    .slice(0, 2)
    .map(({ c }) => c)

  return { width, height, scale, density, LAB, labAt, top, cx, hairPal, skinOnly, hairWindow: { hx0, hx1, hy0, hy1 } }
}

// ────────────────────────────────────────────────────────────────── masks ──

/**
 * Hair (spike steps 5–8): candidates close in Lab to the hair palette and far from skin, grown from the
 * seed patch, with the outline round it swallowed and light highlight pockets filled back in.
 *
 * `neverVisible`, when given, is the intersection of every outfit layer the base can wear (`writeMasks`) —
 * a pixel under permanent clothing is never candidate hair, whatever colour it happens to be.
 */
export function hairMask(pic, { neverVisible = null } = {}) {
  const { width, height, scale, LAB, labAt, hairPal, skinOnly, hairWindow } = analysePicture(pic)
  const never = neverVisible ?? new Uint8Array(width * height)
  const hairChroma = Math.max(...hairPal.map((c) => Math.hypot(c[1], c[2]))) + 12
  const HAIR_T = 14
  const cand = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    if (!opaqueAt(pic, i) || never[i]) continue
    const p = labAt(i)
    if (Math.hypot(p[1], p[2]) > hairChroma) continue
    const dh = Math.min(...hairPal.map((c) => labDist(c, p)))
    const ds = skinOnly.length ? Math.min(...skinOnly.map((c) => labDist(c, p))) : 999
    if (dh < HAIR_T && dh < ds * 0.8) cand[i] = 1
  }
  const closedCand = close(cand, width, height, Math.round(2 * scale))
  const { label, sizes } = components(closedCand, width, height)
  const seedIds = new Set()
  const seedMinSize = Math.round(200 * scale * scale)
  for (let y = Math.max(0, hairWindow.hy0); y < Math.min(height, hairWindow.hy1); y++) {
    for (let x = Math.max(0, hairWindow.hx0); x < Math.min(width, hairWindow.hx1); x++) {
      const l = label[y * width + x]
      if (l >= 0 && sizes[l] > seedMinSize) seedIds.add(l)
    }
  }
  let hair = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) if (label[i] >= 0 && seedIds.has(label[i])) hair[i] = 1
  hair = close(hair, width, height, Math.round(3 * scale))
  for (let i = 0; i < width * height; i++) if (!opaqueAt(pic, i)) hair[i] = 0

  // outline swallow: a dark pixel touching hair that is not near skin joins it
  const skinMask = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    if (opaqueAt(pic, i) && skinOnly.length && Math.min(...skinOnly.map((c) => labDist(c, labAt(i)))) < 16) skinMask[i] = 1
  }
  const nearSkin = dilate(skinMask, width, height, Math.round(3 * scale))
  const grownEdge = dilate(hair, width, height, Math.round(2 * scale))
  for (let i = 0; i < width * height; i++) {
    if (grownEdge[i] && !hair[i] && opaqueAt(pic, i) && LAB[i * 3] < 28 && !nearSkin[i] && !never[i]) hair[i] = 1
  }

  // light pockets: a small enclosed pocket of highlight (not skin) joins the hair round it
  {
    const inv = new Uint8Array(width * height)
    for (let i = 0; i < width * height; i++) inv[i] = hair[i] ? 0 : 1
    const hc = components(inv, width, height)
    const bad = new Set()
    const maxPocket = Math.round(2500 * scale * scale)
    for (let i = 0; i < width * height; i++) {
      const l = hc.label[i]
      if (l < 0) continue
      if (!opaqueAt(pic, i) || skinMask[i] || hc.sizes[l] > maxPocket || LAB[i * 3] < 55) bad.add(l)
    }
    for (let i = 0; i < width * height; i++) if (hc.label[i] >= 0 && !bad.has(hc.label[i])) hair[i] = 1
  }

  const out = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) out[i] = hair[i] ? 255 : 0
  return out
}

/**
 * Eyes (spike step 9): the not-hair, not-skin blob per side of the centre line in the eye band — iris,
 * pupil, white and lashes together — with the brow eroded off, enclosed pockets filled and each row
 * span-filled between the outline's two ends (an eye is convex).
 *
 * Clears its own pixels out of `hair` in place: whatever `hairMask` mistook for hair at the eye is not.
 */
export function eyeMask(pic, hair) {
  const { width, height, scale, density, labAt, top, cx, skinOnly } = analysePicture(pic)
  const hairAt = (i) => hair[i] >= 128
  const skinlike = (i) => skinOnly.length > 0 && Math.min(...skinOnly.map((c) => labDist(c, labAt(i)))) < 14
  const headH = FACE_LIMIT_Y * density - top
  const region = new Uint8Array(width * height)
  const yStart = Math.max(0, Math.floor(top + headH * 0.3))
  const yEnd = Math.min(height, Math.ceil(top + headH * 0.75))
  for (let y = yStart; y < yEnd; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (opaqueAt(pic, i) && !hairAt(i) && !skinlike(i)) region[i] = 1
    }
  }
  const rc = components(close(region, width, height, Math.max(1, Math.round(1 * scale))), width, height)
  const boxes = rc.sizes.map((s, id) => ({ s, id, x0: width, x1: 0 }))
  for (let i = 0; i < width * height; i++) {
    const l = rc.label[i]
    if (l < 0) continue
    const x = i % width
    boxes[l].x0 = Math.min(boxes[l].x0, x)
    boxes[l].x1 = Math.max(boxes[l].x1, x)
  }
  const side = (b) => (b.x1 < cx ? 'L' : b.x0 > cx ? 'R' : 'C')
  const minBlob = Math.round(150 * scale * scale)
  const maxBlob = Math.round(12000 * scale * scale)
  const pick = ['L', 'R']
    .map((sd) => boxes.filter((b) => side(b) === sd && b.s > minBlob && b.s < maxBlob).sort((a, b) => b.s - a.s)[0])
    .filter(Boolean)
  let blob = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) if (rc.label[i] >= 0 && pick.some((b) => b.id === rc.label[i])) blob[i] = 1

  // shut the small gaps in the lid line, fill the pockets the outline encloses
  {
    const inv = new Uint8Array(width * height)
    for (let i = 0; i < width * height; i++) inv[i] = blob[i] ? 0 : 1
    const hc = components(inv, width, height)
    const bad = new Set()
    const maxPocket = Math.round(4000 * scale * scale)
    for (let i = 0; i < width * height; i++) {
      const l = hc.label[i]
      if (l >= 0 && (hc.sizes[l] > maxPocket || !opaqueAt(pic, i))) bad.add(l)
    }
    for (let i = 0; i < width * height; i++) if (hc.label[i] >= 0 && !bad.has(hc.label[i])) blob[i] = 1
  }
  // shave the brow off: erode, keep the largest core per side, grow back
  {
    const core = erode(blob, width, height, Math.round(4 * scale))
    const cc = components(core, width, height)
    const keep = ['L', 'R'].map((sd) => {
      let best = -1
      for (let i = 0; i < width * height; i++) {
        const l = cc.label[i]
        if (l < 0) continue
        const x = i % width
        if ((sd === 'L') !== (x < cx)) continue
        if (best < 0 || cc.sizes[l] > cc.sizes[best]) best = l
      }
      return best
    })
    const kept = new Uint8Array(width * height)
    for (let i = 0; i < width * height; i++) if (cc.label[i] >= 0 && keep.includes(cc.label[i])) kept[i] = 1
    const back = dilate(kept, width, height, Math.round(5 * scale))
    for (let i = 0; i < width * height; i++) blob[i] = blob[i] && back[i] ? 1 : 0
  }
  // an eye is convex: whatever lies between the outline's two ends on a row is eye
  {
    const span = new Uint8Array(width * height)
    for (const sd of ['L', 'R']) {
      const xStart = sd === 'L' ? 0 : cx
      const xEnd = sd === 'L' ? cx : width
      for (let y = 0; y < height; y++) {
        let x0 = -1
        let x1 = -1
        for (let x = xStart; x < xEnd; x++) {
          if (blob[y * width + x]) { if (x0 < 0) x0 = x; x1 = x }
        }
        if (x0 < 0) continue
        for (let x = x0; x <= x1; x++) {
          const i = y * width + x
          if (opaqueAt(pic, i) && !hairAt(i)) span[i] = 1
        }
      }
    }
    blob = span
  }
  const eyes = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    if (!blob[i]) continue
    const p = labAt(i)
    const isWhite = p[0] > 88 && Math.hypot(p[1], p[2]) < 10
    if (!isWhite && p[0] > 15) eyes[i] = 1
  }
  // closed eyes: a side with too little left over is dropped, not a sliver of a lash line
  const minSide = Math.round(100 * scale * scale)
  for (const sd of ['L', 'R']) {
    let count = 0
    for (let i = 0; i < width * height; i++) {
      if (!eyes[i]) continue
      const x = i % width
      if ((sd === 'L') === (x < cx)) count++
    }
    if (count < minSide) {
      for (let i = 0; i < width * height; i++) {
        const x = i % width
        if (eyes[i] && (sd === 'L') === (x < cx)) eyes[i] = 0
      }
    }
  }
  for (let i = 0; i < width * height; i++) if (eyes[i]) hair[i] = 0
  const out = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) out[i] = eyes[i] ? 255 : 0
  return out
}

/**
 * Tint (spike-adjacent, spec §4.1): the connected region of the seeded colour — a flood fill in Lab from
 * the seed pixel, closed once to bridge a thin outline. `seed` is in 1x frame units (as stored in the
 * manifest's `tintSeed`); it is scaled to the picture's own density before anything else.
 */
export function tintMask(pic, seed, { tolerance = 18 } = {}) {
  const { width, height } = pic
  const scale = width / 768
  const density = width / FRAME.w
  const sx = Math.round(seed.x * density)
  const sy = Math.round(seed.y * density)
  const out = new Uint8Array(width * height)
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return out
  const seedIndex = sy * width + sx
  if (!opaqueAt(pic, seedIndex)) return out
  const LAB = labPlane(pic)
  const labAt = (i) => [LAB[i * 3], LAB[i * 3 + 1], LAB[i * 3 + 2]]
  const seedLab = labAt(seedIndex)
  const flood = new Uint8Array(width * height)
  flood[seedIndex] = 1
  const stack = [seedIndex]
  while (stack.length) {
    const p = stack.pop()
    const x = p % width
    const y = (p - x) / width
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const q = ny * width + nx
      if (flood[q] || !opaqueAt(pic, q)) continue
      if (labDist(seedLab, labAt(q)) < tolerance) { flood[q] = 1; stack.push(q) }
    }
  }
  const closed = close(flood, width, height, Math.round(2 * scale))
  for (let i = 0; i < width * height; i++) out[i] = closed[i] && opaqueAt(pic, i) ? 255 : 0
  return out
}

// ──────────────────────────────────────────────────────────────── writing ──

/** Every manifest name `writeMasks` can cut a mask for: real base L30/L60, every real base face, every tintable item. */
export function maskTargets(manifest) {
  const names = []
  for (const [name, entry] of Object.entries(manifest.files ?? {})) {
    if (!entry?.real) continue
    const parsed = parseName(name)
    if (!parsed) continue
    if (parsed.kind === 'base' && (parsed.layer === LAYERS.body || parsed.layer === LAYERS.hairFront)) {
      if (!entry.empty) names.push(name)
    } else if (parsed.kind === 'baseFace') {
      names.push(name)
    } else if (parsed.kind === 'item' && entry.tintSeed) {
      names.push(name)
    }
  }
  return names
}

/** The part of a base that no outfit ever lets show: the intersection of alpha over every outfit it can wear. */
async function computeNeverVisible(dir, manifest, baseId) {
  const wear = wearOf(baseId)
  const codes = new Set()
  for (const name of Object.keys(manifest.files ?? {})) {
    const parsed = parseName(name)
    if (parsed?.kind === 'item' && parsed.slot === 'outfit' && parsed.layer === LAYERS.outfit && !parsed.wear) codes.add(parsed.code)
  }
  let never = null
  for (const code of codes) {
    let fileName = itemFile('outfit', code, LAYERS.outfit)
    if (wear === 'm') {
      const variant = itemFile('outfit', code, LAYERS.outfit, 'm')
      const variantEntry = manifest.files[variant]
      if (variantEntry?.real && !variantEntry.empty) fileName = variant
    }
    const entry = manifest.files[fileName]
    if (!entry?.real || entry.empty) continue
    const file = join(dir, `${fileName}@2x.png`)
    if (!existsSync(file)) continue
    const pic = await readPicture(file)
    const mask = new Uint8Array(pic.width * pic.height)
    for (let i = 0; i < mask.length; i++) mask[i] = pic.data[i * 4 + 3] > 200 ? 1 : 0
    if (never === null) {
      never = mask
    } else {
      for (let i = 0; i < never.length; i++) never[i] = never[i] && mask[i] ? 1 : 0
    }
  }
  return never
}

/** Whether a picture's own alpha channel carries real coverage, as opposed to `ensureAlpha`'s all-255 filler. */
function hasRealAlpha(pic) {
  const { data } = pic
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true
  return false
}

/**
 * `hair`/`eyes`/`tint` in the manifest (`entry.masks`) are `hairmask`/`eyemask`/`tintmask` on disk (spec
 * §4.1: file names say "eye", the manifest says "eyes") — the one place the two spellings have to meet.
 */
const MASK_FILE_KIND = { hair: 'hair', eyes: 'eye', tint: 'tint' }

/**
 * The mask to write for one `<name>_<kind>` (`kind` a manifest key: `hair`, `eyes` or `tint`): a hand-drawn
 * override if one exists at `overridesDir`, else `computed`. Writes both densities and records the manifest
 * entry — `{ bytes2x, meanL, empty?, override? }` — into `entry.masks[kind]`.
 */
async function writeOneMask({ dir, name, kind, computed, layer2x, entry, overridesDir, log }) {
  const { width, height } = layer2x
  const fileKind = MASK_FILE_KIND[kind]
  let mask = computed
  let override = false
  const overrideFile = join(overridesDir, `${name}_${fileKind}mask.png`)
  if (existsSync(overrideFile)) {
    let overridePic = await readPicture(overrideFile)
    if (overridePic.width === FRAME.w && overridePic.height === FRAME.h) overridePic = await resizePicture(overridePic, width, height)
    const useAlpha = hasRealAlpha(overridePic)
    mask = new Uint8Array(width * height)
    for (let i = 0; i < mask.length; i++) {
      const o = i * 4
      mask[i] = useAlpha
        ? overridePic.data[o + 3]
        : Math.round(0.3 * overridePic.data[o] + 0.59 * overridePic.data[o + 1] + 0.11 * overridePic.data[o + 2])
    }
    override = true
  }
  const maskPic = { data: Buffer.alloc(width * height * 4), width, height }
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4
    maskPic.data[o] = 255; maskPic.data[o + 1] = 255; maskPic.data[o + 2] = 255; maskPic.data[o + 3] = mask[i]
  }
  const file2x = join(dir, `${name}_${fileKind}mask@2x.png`)
  await writePicture(maskPic, file2x)
  const half = await resizePicture(maskPic, FRAME.w, FRAME.h)
  await writePicture(half, join(dir, `${name}_${fileKind}mask@1x.png`))
  const bytes2x = statSync(file2x).size
  let sum = 0
  for (let i = 0; i < mask.length; i++) sum += mask[i] > 0 ? 1 : 0
  const meanL = Math.round(meanLightness(layer2x.data, mask) * 10000) / 10000
  entry.masks ??= {}
  entry.masks[kind] = { bytes2x, meanL, ...(sum === 0 ? { empty: true } : {}), ...(override ? { override: true } : {}) }
  log(`${name}_${fileKind}mask — ${(bytes2x / 1024).toFixed(1)} KB${override ? ', hand-drawn' : ''}${sum === 0 ? ', empty' : ''}`)
}

/**
 * Cut and write the masks for `names` (from `maskTargets`, or a caller's own subset), into `dir`. Mutates
 * `manifest.files[name].masks` for each; does not write the manifest — the caller does, alongside whatever
 * else it changed in the same run (`ingest`, the `masks` command).
 */
export async function writeMasks({ dir, manifest, names, overridesDir = MASK_OVERRIDE_DIR, log = () => {} }) {
  for (const name of names) {
    const parsed = parseName(name)
    if (!parsed) continue
    const entry = manifest.files[name]
    if (!entry?.real || entry.empty) continue
    const layer2x = await readPicture(join(dir, `${name}@2x.png`))

    if (parsed.kind === 'base' && parsed.layer === LAYERS.body) {
      const neverVisible = await computeNeverVisible(dir, manifest, parsed.base)
      const hair = hairMask(layer2x, { neverVisible })
      await writeOneMask({ dir, name, kind: 'hair', computed: hair, layer2x, entry, overridesDir, log })
    } else if (parsed.kind === 'base' && parsed.layer === LAYERS.hairFront) {
      const hair = new Uint8Array(layer2x.width * layer2x.height)
      for (let i = 0; i < hair.length; i++) hair[i] = layer2x.data[i * 4 + 3] > ALPHA_INK ? 255 : 0
      await writeOneMask({ dir, name, kind: 'hair', computed: hair, layer2x, entry, overridesDir, log })
    } else if (parsed.kind === 'baseFace') {
      const hair = hairMask(layer2x, { neverVisible: null })
      const computedEyes = eyeMask(layer2x, hair) // mutates hair in place regardless of expression
      const eyes = parsed.expr === 'closed' || parsed.expr === 'sleep' ? new Uint8Array(layer2x.width * layer2x.height) : computedEyes
      await writeOneMask({ dir, name, kind: 'hair', computed: hair, layer2x, entry, overridesDir, log })
      await writeOneMask({ dir, name, kind: 'eyes', computed: eyes, layer2x, entry, overridesDir, log })
    } else if (parsed.kind === 'item' && entry.tintSeed) {
      const tint = tintMask(layer2x, entry.tintSeed)
      await writeOneMask({ dir, name, kind: 'tint', computed: tint, layer2x, entry, overridesDir, log })
    }
  }
}
