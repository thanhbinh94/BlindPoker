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
 *
 * Plan 19 (spec §5.5) adds the v4 set: a **skin** mask on every body and body face (`skinMask`), the eyes of a
 * body face found on a bald head, the ink of a hair layer as its hair — and `maskColour`, the colour a mask
 * covers, which the `colours` command prints (`describeColours`).
 */
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { FACE_LIMIT_Y, FRAME, SKIN_WINDOW, baseSkinColour } from './frame.mjs'
import { GENDERS, PACKAGE_ROOT, bodyFile, hairItemId, parseName, writeIconTintMask } from './manifest.mjs'
import { ALPHA_INK, ALPHA_SOLID, readPicture, resizePicture, writePicture } from './png.mjs'
import { meanLightness } from '../../../../packages/ui-kit/src/avatar2d/recolour.mjs'

/** Where a hand-drawn mask overrides the automatic one (spec §4.1). Committed — see `.gitignore` there. */
export const MASK_OVERRIDE_DIR = join(PACKAGE_ROOT, '../../assets/avatar-src/masks')

/**
 * The merge radius `eyeMask`'s largest-group trim and C11's own blob count (`checks.mjs`) both use, in
 * @2x px — one exported constant rather than two literals that only claimed to agree: `eyeMask` dilates by
 * `Math.round(EYE_GROUP_MERGE_RADIUS * scale)` before deciding which pieces belong with an eye's largest
 * piece, and C11's `eyeBlobs` dilates a written mask by the same radius before counting blobs, so a pupil,
 * highlight or lash split of one eye is exactly what both agree still counts as one eye.
 */
export const EYE_GROUP_MERGE_RADIUS = 3

// ─────────────────────────────────────────────────────────────────── colour ──

/** sRGB (0–255) to CIE Lab, D65. Verbatim from the spike. The body-skin rule (`extract.mjs`) measures in it too. */
export function labOf(r, g, b) {
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
const labOfHex = (hex) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return labOf((n >> 16) & 255, (n >> 8) & 255, n & 255)
}
/** CIE76 between two `#rrggbb` — the ΔE the plan's colour rules are written in (A4's `deltaE`). */
const deltaE76 = (a, b) => labDist(labOfHex(a), labOfHex(b))

/** HSL saturation and lightness (0–1) of an sRGB triple — the space `recolour` tints in (`IRIS` below). */
function saturationLightness(r, g, b) {
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const l = (max + min) / 2
  if (max === min) return [0, l]
  return [l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min), l]
}

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
/** Task 2b's own connectivity for the eye-mask skin-leak flood (spec §4.1 ruling): a skin-like pixel joins
 * the flood only edge-to-edge, not corner-to-corner, so a single diagonal pixel of iris outline still blocks it. */
const NEIGHBOURS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]

/** Connected components, iterative (a recursive flood fill overflows the stack on a 768 × 896 mask).
 * 8-connected by default; pass `NEIGHBOURS4` for a stricter, edge-only flood. */
export function components(mask, width, height, neighbours = NEIGHBOURS8) {
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
      for (const [dx, dy] of neighbours) {
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
 *
 * On a **bald** head — every v4 body face (Plan 19, pre-flight #21) — the patch under the head top is scalp, so
 * the "hair palette" is skin, and `skinOnly` (clusters more than 12 from it) may keep no skin at all. `eyeMask`
 * still finds the eyes there: its hair-coloured leak flood, run on a scalp palette, drops the skin corners of the
 * ellipse exactly as its skin flood would have. `writeMasks` never cuts hair on a body face; it hands `eyeMask` an
 * empty hair array, and a unit test holds a synthetic bald face to two eyes.
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

// ────────────────────────────────────────────────────────────────── eyes ──

/**
 * The eye ellipses (Task 2b round 3, spec §4.1): per side of the face centre line, the padded box —
 * unioned with its mirror across the face's eye axis when both sides have whites (round 2) — inscribed as
 * an ellipse (round 1). Steps 1–2 of `eyeMask`'s own algorithm, factored out because `hairMask` now needs
 * the same ellipses too: an eye white enclosed by hair-coloured lashes/iris used to read as a hair "shine
 * pocket", and a bang reaching into an eye's own territory from outside needs to be told apart from hair
 * that merely sits near an eye without ever having a reason to be there. `eyeMask` no longer computes its
 * own boxes; it calls this and carries on from the ellipse.
 *
 * Returns one ellipse per side that found eye-white to anchor on (`{ side, cx, cy, a, b }`, in this
 * picture's own pixel coordinates) and the union of both as a `width × height` `Uint8Array` mask.
 */
export function eyeEllipses(pic) {
  const { width, height, scale, density, labAt, top, cx } = analysePicture(pic)
  const isWhite = (i) => { const p = labAt(i); return p[0] > 88 && Math.hypot(p[1], p[2]) < 10 }
  const headH = FACE_LIMIT_Y * density - top
  const yStart = Math.max(0, Math.floor(top + headH * 0.3))
  const yEnd = Math.min(height, Math.ceil(top + headH * 0.75))

  // eye-white components in the band, unioned into one box per side
  const whiteMask = new Uint8Array(width * height)
  for (let y = yStart; y < yEnd; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (opaqueAt(pic, i) && isWhite(i)) whiteMask[i] = 1
    }
  }
  const wc = components(whiteMask, width, height)
  const boxes = wc.sizes.map(() => ({ x0: width, x1: -1, y0: height, y1: -1 }))
  for (let i = 0; i < width * height; i++) {
    const l = wc.label[i]
    if (l < 0) continue
    const x = i % width
    const y = (i - x) / width
    const b = boxes[l]
    if (x < b.x0) b.x0 = x
    if (x > b.x1) b.x1 = x
    if (y < b.y0) b.y0 = y
    if (y > b.y1) b.y1 = y
  }
  const minWhite = Math.max(1, Math.round(20 * scale * scale))
  const boxOf = { L: null, R: null }
  for (let l = 0; l < wc.sizes.length; l++) {
    if (wc.sizes[l] < minWhite) continue
    const b = boxes[l]
    if (b.x0 < cx && b.x1 > cx) continue // straddles the centre line — teeth, not an eye
    const sd = b.x1 <= cx ? 'L' : 'R'
    const box = boxOf[sd]
    boxOf[sd] = box
      ? { x0: Math.min(box.x0, b.x0), x1: Math.max(box.x1, b.x1), y0: Math.min(box.y0, b.y0), y1: Math.max(box.y1, b.y1) }
      : { ...b }
  }

  // when both sides have whites, each side's box is unioned with the mirror of the other side's box
  // about the face's own eye axis (round 2) — see `eyeMask`'s own doc comment for why.
  if (boxOf.L && boxOf.R) {
    const axis = (boxOf.L.x0 + boxOf.R.x1) / 2
    const mirror = (box) => ({ x0: 2 * axis - box.x1, x1: 2 * axis - box.x0, y0: box.y0, y1: box.y1 })
    const union = (a, b) => ({ x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1) })
    const mirroredR = mirror(boxOf.R)
    const mirroredL = mirror(boxOf.L)
    boxOf.L = union(boxOf.L, mirroredR)
    boxOf.R = union(boxOf.R, mirroredL)
  }

  // expand 15 % each way, the eye is the ellipse inscribed in the result
  const ellipses = []
  for (const sd of ['L', 'R']) {
    const box = boxOf[sd]
    if (!box) continue
    const padX = (box.x1 - box.x0 + 1) * 0.15
    const padY = (box.y1 - box.y0 + 1) * 0.15
    const ex0 = box.x0 - padX
    const ex1 = box.x1 + padX
    const ey0 = box.y0 - padY
    const ey1 = box.y1 + padY
    ellipses.push({ side: sd, cx: (ex0 + ex1) / 2, cy: (ey0 + ey1) / 2, a: (ex1 - ex0) / 2, b: (ey1 - ey0) / 2 })
  }
  const mask = new Uint8Array(width * height)
  if (ellipses.length) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (const e of ellipses) {
          const dx = (x - e.cx) / e.a
          const dy = (y - e.cy) / e.b
          if (dx * dx + dy * dy <= 1) { mask[y * width + x] = 1; break }
        }
      }
    }
  }
  return { ellipses, mask }
}

// ────────────────────────────────────────────────────────────────── masks ──

/**
 * Hair (spike steps 5–8): candidates close in Lab to the hair palette and far from skin, grown from the
 * seed patch, with the outline round it swallowed and light highlight pockets filled back in — then, as
 * of Task 2b round 3, checked against `eyeEllipses(pic)`: a light/shine pocket that touches an eye is
 * never a hair pocket, and a hair pixel inside an eye's own ellipse is trimmed back out unless a path of
 * hair pixels reaches it out to hair genuinely outside every eye. The real bases showed both directions
 * of this going wrong — an eye white enclosed by hair-coloured lashes read as a "shine pocket" (m03), and
 * a bluish-grey shine band across the hair stayed unmasked because a fixed chroma ceiling can't tell "this
 * hair's own shine" from "a different colour" once the hair itself is anything but neutral (f02, m02).
 *
 * Plan 19 D1: no layer the pipeline cuts needs this any more — a v4 hair layer's hair is its ink, and a body is bald —
 * so `writeMasks` never calls it. Its `neverVisible` option (every outfit a flat base could wear) went with the bases;
 * the function stays for the hair a flat picture carries, which `eyeMask` is handed and its tests build with it.
 */
export function hairMask(pic) {
  const { width, height, scale, LAB, labAt, hairPal, skinOnly, hairWindow } = analysePicture(pic)
  const { mask: eyeEllipseMask } = eyeEllipses(pic)
  const hairChroma = Math.max(...hairPal.map((c) => Math.hypot(c[1], c[2]))) + 12
  const HAIR_T = 14
  const cand = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    if (!opaqueAt(pic, i)) continue
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
    if (grownEdge[i] && !hair[i] && opaqueAt(pic, i) && LAB[i * 3] < 28 && !nearSkin[i]) hair[i] = 1
  }

  // light pockets: a small enclosed pocket of highlight (not skin) joins the hair round it. Two shapes of
  // pocket qualify: a bright one (the original rule, ≤ 2500 px @2x scaled, every pixel L ≥ 55) or a shine
  // pocket (≤ 8000 px @2x scaled, no colour restriction at all as of Task 2b round 3 — f02/m02's grey-blue
  // shine bands have chroma up to ~18-20, since f02's own hair palette is itself bluish, so a fixed chroma
  // ceiling could never separate "a shine band on this hair" from "a different colour" for every base).
  // Both shapes are now gated on the same two things: not skin-like (unchanged), and not touching any eye
  // ellipse (round 3) — without that second gate, an eye white enclosed by hair-coloured lashes or iris
  // qualifies as a shine pocket too, exactly the m03 defect this round exists to fix. A pocket is judged as
  // a whole (its *least* bright pixel, whether it touches an eye at all), not pixel by pixel, so one stray
  // dark pixel does not let the rest of an otherwise-uniform pocket through.
  {
    const inv = new Uint8Array(width * height)
    for (let i = 0; i < width * height; i++) inv[i] = hair[i] ? 0 : 1
    const hc = components(inv, width, height)
    const maxBrightPocket = Math.round(2500 * scale * scale)
    const maxShinePocket = Math.round(8000 * scale * scale)
    const excluded = new Uint8Array(hc.sizes.length) // opaque-but-not / skin / touches an eye: never a pocket
    const minL = new Float32Array(hc.sizes.length).fill(Infinity)
    for (let i = 0; i < width * height; i++) {
      const l = hc.label[i]
      if (l < 0) continue
      if (!opaqueAt(pic, i) || skinMask[i] || eyeEllipseMask[i]) { excluded[l] = 1; continue }
      if (LAB[i * 3] < minL[l]) minL[l] = LAB[i * 3]
    }
    const good = new Set()
    for (let l = 0; l < hc.sizes.length; l++) {
      if (excluded[l]) continue
      const size = hc.sizes[l]
      const bright = size <= maxBrightPocket && minL[l] >= 55
      const shine = size <= maxShinePocket
      if (bright || shine) good.add(l)
    }
    for (let i = 0; i < width * height; i++) if (hc.label[i] >= 0 && good.has(hc.label[i])) hair[i] = 1
  }

  // Task 2b round 3 (spec §4.1 ruling): whatever grew `hair` into an eye's own territory above — a shine
  // pocket, the outline swallow, even the seed growth itself — is trimmed back here, once, as the final
  // word on it. The eye white (L > 88, chroma < 10) is never hair. Past that, a hair pixel inside an eye's
  // padded ellipse stays hair only if a path of hair pixels (4-connected, the same stricter connectivity
  // `eyeMask`'s own leaks use) reaches it out to hair *outside* every ellipse — a bang that genuinely
  // crosses into an eye's territory from the cap stays (its component reaches outside), but a pocket of
  // lash- or iris-coloured pixels around the sclera, enclosed and never touching outside hair, does not.
  {
    for (let i = 0; i < width * height; i++) {
      if (!hair[i]) continue
      const p = labAt(i)
      if (p[0] > 88 && Math.hypot(p[1], p[2]) < 10) hair[i] = 0
    }
    const ec = components(hair, width, height, NEIGHBOURS4)
    const reachesOutside = new Uint8Array(ec.sizes.length)
    for (let i = 0; i < width * height; i++) {
      const l = ec.label[i]
      if (l >= 0 && !eyeEllipseMask[i]) reachesOutside[l] = 1
    }
    for (let i = 0; i < width * height; i++) {
      const l = ec.label[i]
      if (l >= 0 && eyeEllipseMask[i] && !reachesOutside[l]) hair[i] = 0
    }
  }

  const out = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) out[i] = hair[i] ? 255 : 0
  return out
}

/**
 * Eyes (Task 2b, spec §4.1 ruling — replaces the spike's step 9). The spike's "not-hair, not-skin" blob
 * failed on the real bases: a dark or skin-coloured iris is neither hair nor skin by colour, but it *is*
 * whatever `hairMask` already swallowed it into (the region excluded anything `hairAt`), so it could never
 * be told apart from hair at all. This is sclera-anchored instead — it finds the *white of the eye*, which
 * is unambiguous, and reads everything the white encloses as the eye, whatever colour that turns out to be:
 *
 * 1–2. `eyeEllipses(pic)` (Task 2b round 3: factored out so `hairMask` can use the same ellipses) finds,
 *    per side of the face centre line in the eye band, the eye-white components (opaque, L > 88, chroma
 *    < 10; a component whose box straddles the centre line — teeth — is ignored, and so is one under
 *    20 px @2x scaled), unions their boxes per side, and — when both sides have whites — unions each
 *    side's box with the *mirror* of the other side's box about the face's own eye axis (round 2: the
 *    sclera often shows only on the iris's outer side, so a side's own box alone can miss its inner half;
 *    the other eye, mirrored, is what fills it back in; a wink, whites on one side only, is not mirrored).
 *    The result is expanded 15 % each way and the eye is the ellipse inscribed in it — a side with no
 *    whites gets no ellipse and stays empty.
 * 3. Inside the ellipse: opaque, not white, L > 12 is a candidate. A candidate that is skin-like *and*
 *    4-connected, through other skin-like pixels inside the ellipse, out to a skin-like pixel on or
 *    outside the ellipse boundary is dropped — a corner of the ellipse that leaked into the cheek or brow.
 *    An iris the colour of skin stays exactly when the white (or a dark outline) around it blocks that
 *    path, so the leak never reaches it. "Skin-like" here excludes the eye white itself (see `skinlike`
 *    below) — otherwise the sclera can act as the very bridge this step exists to block. The same leak
 *    construction runs a second time for hair-coloured pixels (`hairlike`): on f02's real art the bangs
 *    sit close enough to the eye that the padded box reaches into them, and hair is neither white nor
 *    skin, so nothing else in step 3 would have caught it.
 * 4. What is left, per side, is trimmed to the single group that shares a 3 px dilation (C11's own merge
 *    radius) with that side's largest piece — an eyebrow or a stray filament of hair sitting fully inside
 *    the ellipse never touches its boundary, so step 3's leak cannot catch it either, but it is reliably
 *    a dozen-odd px from the iris, further than a pupil, highlight or lash gap ever is.
 *
 * A small closing (2 px @2x scaled) mops up the odd antialiased pixel the rasteriser leaves out — never
 * enough to bridge the pupil hole in the middle of a real iris, which is far wider than that. Last, a side
 * left with a plausible white box but almost nothing surviving all of the above — a squint's outline
 * catching one stray shaded pixel, say — is dropped to empty (under 100 px @2x scaled) rather than kept as
 * a sliver too small to be a real eye.
 *
 * Clears its own pixels out of `hair` in place: whatever `hairMask` mistook for hair at the eye is not —
 * this is what actually fixes the swallowed-iris bug, because it no longer matters what `hairMask` did.
 */
export function eyeMask(pic, hair) {
  const { width, height, scale, labAt, cx, skinOnly, hairPal } = analysePicture(pic)
  const isWhite = (i) => { const p = labAt(i); return p[0] > 88 && Math.hypot(p[1], p[2]) < 10 }
  // The white of the eye is never "skin-like", whatever `skinOnly` (a plain top-2-by-population clustering
  // over a window that has no idea where the eyes are) happens to have picked up — without this guard, the
  // sclera can act as a bridge in the leak flood below, connecting the cheek to an iris right through the
  // eye white that is supposed to wall it off.
  const skinlike = (i) => !isWhite(i) && skinOnly.length > 0 && Math.min(...skinOnly.map((c) => labDist(c, labAt(i)))) < 14
  // Bangs sit close enough to the eyes on some real bases (f02) that the box padded 15 % reaches into the
  // hair beside it — hair is neither white nor skin, so nothing above stops it. The same leak-and-block
  // construction that keeps a skin corner out of the ellipse keeps a hair corner out too: a hair-coloured
  // pixel is only dropped when a path of hair-coloured pixels connects it out of the ellipse into the
  // actual hair mass, so a hair-coloured *iris*, fully enclosed by the white or an outline, is unaffected.
  const hairlike = (i) => !isWhite(i) && hairPal.length > 0 && Math.min(...hairPal.map((c) => labDist(c, labAt(i)))) < 14

  // 1–2. the ellipses: `eyeEllipses` builds the per-side box from eye-white components in the band,
  // mirrors it across the face's own eye axis when both sides have whites (round 2), and expands 15 %.
  const { mask: ellipseMask } = eyeEllipses(pic)

  // 3. inside the ellipse, opaque, not white, not too dark: the candidate eye
  const candidate = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    if (!ellipseMask[i] || !opaqueAt(pic, i) || isWhite(i)) continue
    if (labAt(i)[0] <= 12) continue
    candidate[i] = 1
  }

  // skin-like pixels 4-connected out of the ellipse are a leaked corner, not an iris; an iris the colour
  // of skin that the flood never reaches (blocked by the white, or a darker outline) is left alone.
  const skinlikeMask = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) if (opaqueAt(pic, i) && skinlike(i)) skinlikeMask[i] = 1
  const sc = components(skinlikeMask, width, height, NEIGHBOURS4)
  const leaks = new Uint8Array(sc.sizes.length)
  for (let i = 0; i < width * height; i++) if (sc.label[i] >= 0 && !ellipseMask[i]) leaks[sc.label[i]] = 1

  // …and the same for hair-coloured pixels leaking in from the bangs (see `hairlike` above). Closed first
  // (2 px @2x scaled, the same gap `hairMask` itself bridges for its own candidate pixels): a strand of
  // hair right beside the eye often has a glossy highlight running across it, and an un-closed flood would
  // read that thin, brighter interruption as a wall and leave the far side of the strand — still hair, just
  // on the near side of the ellipse boundary rather than genuinely enclosed — behind as a stray island.
  const hairlikeMask = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) if (opaqueAt(pic, i) && hairlike(i)) hairlikeMask[i] = 1
  const closedHairlike = close(hairlikeMask, width, height, Math.max(1, Math.round(2 * scale)))
  const hc = components(closedHairlike, width, height, NEIGHBOURS4)
  const hairLeaks = new Uint8Array(hc.sizes.length)
  for (let i = 0; i < width * height; i++) if (hc.label[i] >= 0 && !ellipseMask[i]) hairLeaks[hc.label[i]] = 1

  let eyes = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    if (!candidate[i]) continue
    const l = sc.label[i]
    if (l >= 0 && leaks[l]) continue
    const hl = hc.label[i]
    if (hl >= 0 && hairLeaks[hl]) continue
    eyes[i] = 1
  }
  // A hair-coloured eyebrow, or a filament of hair, can sit fully inside the padded ellipse without ever
  // touching its boundary — no leak catches that. What tells it apart from the eye is distance: keep only
  // the piece on each side that shares a group with the *largest* piece there once the whole side is
  // dilated by `EYE_GROUP_MERGE_RADIUS` — the same radius C11 merges blobs with (a pupil/highlight/lash
  // gap closes at that radius; the 10–25 px gap to a brow or a stray strand does not) — and drop every
  // other group entirely.
  {
    const dilated = dilate(eyes, width, height, Math.round(EYE_GROUP_MERGE_RADIUS * scale))
    const dc = components(dilated, width, height)
    const groupRawSize = new Map()
    const groupSide = new Map()
    for (let i = 0; i < width * height; i++) {
      if (!eyes[i]) continue
      const g = dc.label[i]
      groupRawSize.set(g, (groupRawSize.get(g) ?? 0) + 1)
      if (!groupSide.has(g)) groupSide.set(g, i % width < cx ? 'L' : 'R')
    }
    const primary = { L: -1, R: -1 }
    const primarySize = { L: 0, R: 0 }
    for (const [g, size] of groupRawSize) {
      const sd = groupSide.get(g)
      if (size > primarySize[sd]) { primarySize[sd] = size; primary[sd] = g }
    }
    for (let i = 0; i < width * height; i++) {
      if (!eyes[i]) continue
      const sd = groupSide.get(dc.label[i])
      if (dc.label[i] !== primary[sd]) eyes[i] = 0
    }
  }
  // close the odd antialiased pixel the rasteriser leaves under 128 alpha or just outside `isWhite`'s own
  // threshold — small enough (a couple of px) that it cannot bridge into the pupil hole above, which is a
  // good 9–20 px across on every real eye, or back into a leaked corner well outside the closing radius.
  eyes = close(eyes, width, height, Math.max(1, Math.round(2 * scale)))
  for (let i = 0; i < width * height; i++) if (!ellipseMask[i] || !opaqueAt(pic, i)) eyes[i] = 0

  // A side with a sliver too small to be a plausible eye (a squint's outline catching one stray pixel of
  // shading) is dropped to empty rather than left as a fragment nothing downstream can use — the same
  // floor C11 itself measures a real blob against (spec §4.3).
  const minSide = Math.round(100 * scale * scale)
  for (const sd of ['L', 'R']) {
    let count = 0
    for (let i = 0; i < width * height; i++) if (eyes[i] && (i % width < cx) === (sd === 'L')) count++
    if (count > 0 && count < minSide) {
      for (let i = 0; i < width * height; i++) if (eyes[i] && (i % width < cx) === (sd === 'L')) eyes[i] = 0
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

// ──────────────────────────────────────────────────────────────────── skin ──

/**
 * How `skinMask` tells skin (Plan 19, spec §5.5), in @2x px where it is a size:
 *
 * - `minChroma` — the CIE Lab chroma C* (√(a*² + b*²)) a pixel needs to be skin at all, whichever rule below lets it in;
 * - `tolerance` — ΔE76 from the seed in Lab that is skin outright (light cream, and a light warm blush off its hue);
 * - `hue`, `minL` — or, further than that, skin when its LCh hue h = atan2(b*, a*) is `hue[0]`–`hue[1]`° and its L*
 *   at least `minL`, at any chroma: shading on the same skin, which moves a long way in Lab and gains chroma as it
 *   darkens, while staying warm;
 * - `eyeGap` — how far round the eye mask the skin keeps off;
 * - `eyeMargin` — how far `eyeZone` reaches past the eye ellipses and the eye mask (C11 and the hair face rule), and
 *   how far round the eye mask the close in `skinMask` adds nothing;
 * - `minRegion` — the smallest piece of skin kept.
 *
 * Measured on the real v4 bodies (Plan 19 style gate), Lab at @2x:
 *
 * - cream skin (92, 4.8, 13.7): C* 14.5, h 71°; its highlights C* 10–13, h up to ~100°;
 * - its shading, the ears, the cheek and jaw, the neck under the chin: (79.2, 22.1, 26.1), C* 34, h 50°, down to
 *   (59.2, 26.7, 30.1), C* 40, h 48°; the ears' deepest pixels h 45°; the antialiased rim between skin and the
 *   outline L* 50–80, C* 24–40, h 47–60°;
 * - the mouth, pink: its inside L* 72–78, C* 36–45, h 29–37° (f) and 35–43° (m);
 * - the outline, the brows and the lashes: L* 21–44 — the warm-brown outline is h 45–48°, inside the window;
 * - the tank top C* 4.3, bluish; the eye whites C* ≤ 3; the iris blue (f) or amber (m, `#945e26`, h ~70°, C* 45–70
 *   on its light side — warm and inside the window, which is why the eye mask, not colour, keeps it out).
 *
 * So `hue` is 44–100°: the mouth's inside stops under 44° on both faces, the darkest ear shading starts at 45°, and
 * nothing on a body is warmer-yellow than its own highlights. There is no chroma ceiling: the shading is the most
 * saturated skin there is (C* 30–45 against the cream's 14.5), and the ceiling the rule used to have (1.6 × the
 * seed's chroma, with a hue window of 18° round the seed's) is what left the ears and the neck shadow cream.
 *
 * `minL` is 50 (pre-flight #2) because of the line art: the outline, the brows and the lashes are all under L* 45 and
 * the outline's hue is inside the window, so lightness is what keeps the line out. The close in `skinMask` adds no
 * pixel under it either, so a 3 px brow or lid line is not filled back in.
 *
 * `minChroma` is 8 (Plan 19 style gate) because `tolerance` alone cannot tell a light neutral from cream: greys from
 * about `#b9b9b9` to `#f8f8f8`, an off-white like `#fdf8f5` and the real bodies' pale bluish-grey tank top (C* 4.3, ΔE ~20
 * from the cheek) are all within ΔE 22 of cream, while skin always carries warm chroma, about 12 and over even in
 * its highlights (a real body's cheek is C* 14.5, its thigh 15.3). A near-white highlight under C* 8 drops out of the
 * mask, and so does the white of an eye (C* ≤ 3 on the real faces) — colour, not the eye ellipses, keeps it out.
 */
export const SKIN_MASK = { tolerance: 22, hue: [44, 100], minL: 50, minChroma: 8, eyeGap: 1, eyeMargin: 3, minRegion: 40 }

/**
 * A face's eye zone (Plan 19): the padded ellipse round each eye's white (`eyeEllipses`) — always — unioned with `eyes`
 * when given (any non-zero pixel: the eye mask as written, a hand-drawn one included), widened by `SKIN_MASK.eyeMargin`.
 * The region between expressions moves between "eye" and "skin" (a shut eye is eyelid skin, an open one iris, white
 * and lid): C11 adds it to the skin to compare one face with another, and the hair face rule counts it as face
 * (`extract.mjs`). `skinMask` no longer takes it out (style gate): the skin runs up to the eye mask, and the white
 * stays out on its chroma. 0/1 per pixel.
 *
 * It can come out too big: `eyeEllipses` unions every white blob on a side of the eye band and mirrors it, so a pale
 * tear, highlight or bubble there widens both ellipses. C11 guards a real face against it (the eye zone alone, against
 * the neutral face); the rest is why every real face's skin-mask overlay is checked by eye (`docs/avatar-2d.md` §4.4.1).
 *
 * @param {{ data: Buffer, width: number, height: number }} pic
 * @param {Uint8Array | null} [eyes]
 * @returns {Uint8Array}
 */
export function eyeZone(pic, eyes = null) {
  const { width, height } = pic
  const ellipses = eyeEllipses(pic).mask
  const inside = new Uint8Array(width * height)
  for (let i = 0; i < inside.length; i++) inside[i] = ellipses[i] || eyes?.[i] ? 1 : 0
  return dilate(inside, width, height, Math.max(1, Math.round(SKIN_MASK.eyeMargin * (width / 768))))
}

/**
 * Skin on a body or a body face, at @2x (Plan 19, spec §5.5) — what the skin colour item tints, so the line art,
 * the eyes, the mouth and the underwear must all stay out of it, and every skin pixel, shaded or not, must be in it:
 * a pixel left out keeps its cream under a deep tone.
 *
 * The seed is `baseSkinColour` (the modal colour of `SKIN_WINDOW`, the cheeks and chin, which are skin on every
 * body by construction). A pixel is skin when it is solid (alpha > `ALPHA_SOLID`), has at least `SKIN_MASK.minChroma`
 * chroma, and is either within `SKIN_MASK.tolerance` of the seed, or warm — its hue in `SKIN_MASK.hue` — and at least
 * `SKIN_MASK.minL` light (`SKIN_MASK` has the numbers measured on the real bodies). The line art is too dark, the
 * underwear and the eye whites too grey, a blue iris and the pink mouth outside the hue window, so all of them fall
 * out by colour; the bodies are always drawn cream (spec §5.2), so one rule fits both.
 *
 * `eyes` (any non-zero pixel) is taken out, widened by `SKIN_MASK.eyeGap`: what keeps an iris out whose colour is
 * warm (an amber one is inside the window), and keeps the skin and eye masks from meeting. `writeMasks` passes a
 * face the eye mask it wrote (a hand-drawn one included) and a body L30 the eye mask `eyeMask` finds on it. Only the
 * eye mask — not the eye ellipses (`eyeZone`), which are drawn wider than the eye and used to leave a cream ring
 * round it.
 *
 * What is left is closed by 2 px — the odd textured or near-white pixel inside the skin — but the close adds no pixel
 * that is line art (L* under `minL`), none within `SKIN_MASK.eyeMargin` of `eyes` and nothing past the solid picture,
 * so it fills no brow, lid line or outline, nor the white's corner by the iris, and does not cross the outline into
 * the clothes. Pieces under `SKIN_MASK.minRegion` px are
 * dropped. Returns 0/255 per pixel, like every mask here; empty when the window has no skin.
 *
 * @param {{ data: Buffer, width: number, height: number }} pic
 * @param {{ eyes?: Uint8Array | null }} [options]
 */
export function skinMask(pic, { eyes = null } = {}) {
  const { width, height, data } = pic
  const scale = width / 768
  const out = new Uint8Array(width * height)
  const seed = baseSkinColour(pic, width / FRAME.w)
  if (seed === null) return out
  const seedLab = labOf(seed[0], seed[1], seed[2])
  const [hueMin, hueMax] = SKIN_MASK.hue
  const solid = (i) => data[i * 4 + 3] > ALPHA_SOLID

  const skin = new Uint8Array(width * height)
  const ink = new Uint8Array(width * height)
  for (let i = 0; i < skin.length; i++) {
    if (!solid(i)) continue
    const p = labOf(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
    if (p[0] < SKIN_MASK.minL) ink[i] = 1
    // Before the close below, so it cannot fill a grey garment back in; a neutral sits within `tolerance` of pale cream.
    if (Math.hypot(p[1], p[2]) < SKIN_MASK.minChroma) continue
    if (labDist(p, seedLab) <= SKIN_MASK.tolerance) { skin[i] = 1; continue }
    if (ink[i]) continue
    let hue = (Math.atan2(p[2], p[1]) * 180) / Math.PI
    if (hue < 0) hue += 360
    if (hue >= hueMin && hue <= hueMax) skin[i] = 1
  }

  // `gap`: the eyes widened by `eyeGap`, never skin. `nearEyes`: widened by `eyeMargin`, where the close adds nothing —
  // the white's corner between the iris and the lid is a sliver of near-white the close would otherwise fill.
  let gap = null
  let nearEyes = null
  if (eyes) {
    const eyePixels = new Uint8Array(width * height)
    for (let i = 0; i < eyePixels.length; i++) eyePixels[i] = eyes[i] ? 1 : 0
    gap = dilate(eyePixels, width, height, Math.max(1, Math.round(SKIN_MASK.eyeGap * scale)))
    nearEyes = dilate(eyePixels, width, height, Math.max(1, Math.round(SKIN_MASK.eyeMargin * scale)))
    for (let i = 0; i < skin.length; i++) if (gap[i]) skin[i] = 0
  }

  const closed = close(skin, width, height, Math.max(1, Math.round(2 * scale)))
  // The closing must not reach towards the eyes, fill the line art in, nor reach past the solid picture.
  for (let i = 0; i < skin.length; i++) if (closed[i] && !skin[i] && !nearEyes?.[i] && !ink[i] && solid(i)) skin[i] = 1

  const minRegion = Math.max(1, Math.round(SKIN_MASK.minRegion * scale * scale))
  const { label, sizes } = components(skin, width, height)
  for (let i = 0; i < out.length; i++) out[i] = label[i] >= 0 && sizes[label[i]] >= minRegion ? 255 : 0
  return out
}

/**
 * How `skinLineMask` tells the skin's line art (2026-10-05), in @2x px:
 *
 * - `reach` — how far from the skin a line pixel may be. The real bodies' outline is 1–2 px of ink, L* 25–40,
 *   C* 40–53, h 30–60° (a saturated red-brown, `#832e13`), plus 1 px of soft rim to transparency at alpha 50–200;
 *   a finger's dividing line is 1–3 px; all of it is within 4 px of skin on one side or both;
 * - `eyeMargin` — how far round the eye mask the line keeps off, `SKIN_MASK.eyeMargin`'s: the iris's dark rim and
 *   the lashes are the eye's.
 */
export const SKIN_LINE = { reach: 4, eyeMargin: SKIN_MASK.eyeMargin }

/**
 * The skin's line art on a body or a body face, at @2x (2026-10-05) — what a skin colour *shades* (`shade` in
 * `recolour.mjs`), right after it recolours `skin`. The outline was drawn for cream: under a deep tone it kept its
 * red-brown, about as light as the new skin and far more saturated, and glowed round the hands, the ears and the jaw,
 * while the skin's own antialiased edge, shifted by the tone, went black beside it.
 *
 * A pixel is line art when it is not skin (`skin`, any non-zero pixel — the skin mask as written, an override
 * included), lies within `SKIN_LINE.reach` of skin, carries ink (alpha over `ALPHA_INK`), is either soft (alpha at
 * most `ALPHA_SOLID`) or dark (L* under `SKIN_MASK.minL`, the line `skinMask` leaves out), and keeps
 * `SKIN_LINE.eyeMargin` clear of `eyes` (any non-zero pixel). No colour rule beyond that: shading only ever darkens,
 * by the skin colour's lightness over the skin's `meanL` and never past 1, so a lash, a mouth line or a seam of the
 * underwear that comes along is darkened on a deep skin — as a line beside it should be — and is left exactly as drawn
 * on any skin as light as the cream. Returns 0/255 per pixel; empty when there is no skin.
 *
 * @param {{ data: Buffer, width: number, height: number }} pic
 * @param {{ skin: ArrayLike<number>, eyes?: ArrayLike<number> | null }} options
 */
export function skinLineMask(pic, { skin, eyes = null }) {
  const { width, height, data } = pic
  const scale = width / 768
  const out = new Uint8Array(width * height)
  const skinPixels = new Uint8Array(width * height)
  let any = false
  for (let i = 0; i < skinPixels.length; i++) if (skin[i]) { skinPixels[i] = 1; any = true }
  if (!any) return out
  const near = dilate(skinPixels, width, height, Math.max(1, Math.round(SKIN_LINE.reach * scale)))
  let nearEyes = null
  if (eyes) {
    const eyePixels = new Uint8Array(width * height)
    for (let i = 0; i < eyePixels.length; i++) eyePixels[i] = eyes[i] ? 1 : 0
    nearEyes = dilate(eyePixels, width, height, Math.max(1, Math.round(SKIN_LINE.eyeMargin * scale)))
  }
  for (let i = 0; i < out.length; i++) {
    if (!near[i] || skinPixels[i] || nearEyes?.[i]) continue
    const alpha = data[i * 4 + 3]
    if (alpha <= ALPHA_INK) continue
    if (alpha > ALPHA_SOLID && labOf(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])[0] >= SKIN_MASK.minL) continue
    out[i] = 255
  }
  return out
}

/**
 * How `outfitLineMask` tells an outfit's copy of the body's outline (2026-10-05), in @2x px:
 *
 * - `reach` — how far from a line pixel of the body the copy may lie. ChatGPT redraws the whole figure in an outfit
 *   picture, and the cut keeps the arms' and hands' outline where the outfit leaves them bare; registration puts it
 *   within 1–3 px of the body's own (measured on the eight v4 outfits);
 * - `tolerance` — ΔE76 to that body line pixel: the copy is drawn in the same red-brown, while the nearest cloth that
 *   meets the outline (the Tết áo dài's red, `#c0392b` against the line's `#832e13`, ΔE ~25) is further. A pixel
 *   *darker* than the line pixel needs only its a*b* within `tolerance` (the review, 2026-10-05): the royal robe's
 *   fingertips are inked darker still (L* 16, ΔE 20.5 from the line), and darkening what is already darker is harmless,
 *   while black or navy cloth is still far off in a*b*;
 * - `shown` — how far from skin the outfit leaves showing (the body's skin where the outfit is transparent) the copy
 *   may lie: a 2–3 px line and its 1 px soft rim, which is what glows on a dark background (3 left the rim of the
 *   royal robe's and the Tết áo dài's fingertips). Cloth lying over skin it covers — a sleeve over the arm's outline
 *   beneath, trousers over the shorts' — never touches shown skin, so a dark cloth the colour of the line is not
 *   taken for it;
 * - `minShown`, `nearLarge` — a piece of shown skin under `minShown` px counts only within `nearLarge` of a piece that
 *   size or over. A few pixels of thigh showing past a trouser edge (6 and 16 px on the champion's, 30–39 px from any
 *   larger piece) would otherwise make the trouser's brown side panel "beside shown skin" and shade it into notches on
 *   a deep tone; a lone finger's sliver of skin (18 and 23 px on the royal robe, 1–5 px slivers on the Tết áo dài,
 *   2–6 px from the hand) is the only shown skin within `shown` of that finger's outline, so it has to stay (the
 *   re-review, 2026-10-05).
 */
export const OUTFIT_LINE = { reach: 3, tolerance: 20, shown: 4, minShown: 24, nearLarge: 8 }

/**
 * An outfit layer's copy of the body's outline, at @2x (2026-10-05): what a skin colour shades on the outfit, as it
 * shades the body's own line (`skinLineMask`). The copy is drawn over the body, so without it the hands kept the old
 * red-brown rim under a deep tone however the body's own line was shaded.
 *
 * A pixel of `item` is in when it carries ink (alpha over `ALPHA_INK`), lies within `OUTFIT_LINE.shown` of skin the
 * outfit leaves showing (`skin` non-zero where `item` is at most `ALPHA_INK`, in pieces of at least
 * `OUTFIT_LINE.minShown` px or within `OUTFIT_LINE.nearLarge` of one), and within `OUTFIT_LINE.reach` of a pixel of
 * the body's line (`line` non-zero) whose colour on `body` is within `OUTFIT_LINE.tolerance` of its own — or in a*b*
 * alone, when the pixel is darker.
 * `body`, `skin` and `line` are the body the outfit was cut on (`cutOn`), its skin mask and its skin-line mask as
 * written. Returns 0/255 per pixel; empty when the outfit leaves no skin showing.
 *
 * @param {{ data: Buffer, width: number, height: number }} item
 * @param {{ body: { data: Buffer }, skin: ArrayLike<number>, line: ArrayLike<number> }} reference
 */
export function outfitLineMask(item, { body, skin, line }) {
  const { width, height, data } = item
  const scale = width / 768
  const out = new Uint8Array(width * height)
  const shown = new Uint8Array(width * height)
  let any = false
  for (let i = 0; i < shown.length; i++) if (skin[i] && data[i * 4 + 3] <= ALPHA_INK) { shown[i] = 1; any = true }
  if (!any) return out
  // Small pieces of shown skin stay only near a large one (`OUTFIT_LINE.minShown`, `nearLarge`).
  const minShown = Math.max(1, Math.round(OUTFIT_LINE.minShown * scale * scale))
  const pieces = components(shown, width, height)
  const large = new Uint8Array(width * height)
  for (let i = 0; i < shown.length; i++) if (shown[i] && pieces.sizes[pieces.label[i]] >= minShown) large[i] = 1
  const nearLarge = dilate(large, width, height, Math.max(1, Math.round(OUTFIT_LINE.nearLarge * scale)))
  const keep = new Uint8Array(pieces.sizes.length)
  for (let i = 0; i < shown.length; i++) if (shown[i] && (large[i] || nearLarge[i])) keep[pieces.label[i]] = 1
  for (let i = 0; i < shown.length; i++) if (shown[i] && !keep[pieces.label[i]]) shown[i] = 0
  const nearShown = dilate(shown, width, height, Math.max(1, Math.round(OUTFIT_LINE.shown * scale)))
  const lineLab = new Array(width * height)
  for (let i = 0; i < lineLab.length; i++) if (line[i]) lineLab[i] = labOf(body.data[i * 4], body.data[i * 4 + 1], body.data[i * 4 + 2])
  const reach = Math.max(1, Math.round(OUTFIT_LINE.reach * scale))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!nearShown[i] || data[i * 4 + 3] <= ALPHA_INK) continue
      const p = labOf(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
      search: for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || dx * dx + dy * dy > reach * reach) continue
          const q = lineLab[ny * width + nx]
          if (q === undefined) continue
          const close = labDist(p, q) <= OUTFIT_LINE.tolerance || (p[0] <= q[0] && Math.hypot(p[1] - q[1], p[2] - q[2]) <= OUTFIT_LINE.tolerance)
          if (close) { out[i] = 255; break search }
        }
      }
    }
  }
  return out
}

// ────────────────────────────────────────────────────────────────── colour ──

/**
 * What `maskColour` counts as the iris of an eye mask. An eye mask can hold more than the iris — the pupil and the
 * lash line (dark), the highlights (light), and on a hand-drawn mask the white — and an eye colour means the iris:
 * the pixels whose HSL lightness is `minL`–`maxL` and whose saturation is at least `minS`. HSL because it is the
 * space `recolour` works in: it gives *every* masked pixel the target's hue and saturation and shifts its lightness
 * by the target's distance from the mask's `meanL`, so what an eye colour has to match is the hue and saturation of
 * the coloured part, which the dark, light and grey pixels would only pull towards black, white or grey. A grey
 * iris has almost no saturated pixel, so when under `greyShare` of the mid-tones are saturated the mid-tones are
 * the iris; when there are no mid-tones at all (a stand-in's flat dark eye), the whole mask is.
 *
 * On the old bases' committed eye masks this lands within ΔE76 1.2–4.7 of the irises the plan pinned (ruling 6),
 * which were measured before this function existed — no simple lightness/saturation cut reproduces all six exactly.
 */
const IRIS = { minL: 0.15, maxL: 0.85, minS: 0.2, greyShare: 0.25 }

/**
 * The colour a mask covers on its layer (Plan 19, the `colours` command): the layer's RGB under the mask, each
 * pixel weighted by the mask's own alpha, as `#rrggbb` — or `null` for an empty mask. This is how the hairstyles'
 * natural colours were measured from the old bases (`base_<id>_L30_hairmask`, plan A3), and it reproduces them.
 * `iris` keeps to the iris of an eye mask (`IRIS` above).
 *
 * @param {{ data: Buffer, width: number, height: number }} pic
 * @param {Uint8Array} mask
 * @param {{ iris?: boolean }} [options]
 * @returns {string | null}
 */
export function maskColour(pic, mask, { iris = false } = {}) {
  const { data } = pic
  const all = [0, 0, 0, 0]
  const mid = [0, 0, 0, 0]
  const coloured = [0, 0, 0, 0]
  const add = (sum, o, weight) => { sum[0] += data[o] * weight; sum[1] += data[o + 1] * weight; sum[2] += data[o + 2] * weight; sum[3] += weight }
  for (let i = 0; i < mask.length; i++) {
    const weight = mask[i]
    if (!weight) continue
    const o = i * 4
    add(all, o, weight)
    if (!iris) continue
    const [s, l] = saturationLightness(data[o], data[o + 1], data[o + 2])
    if (l <= IRIS.minL || l >= IRIS.maxL) continue
    add(mid, o, weight)
    if (s >= IRIS.minS) add(coloured, o, weight)
  }
  const sum = !iris ? all : coloured[3] >= IRIS.greyShare * mid[3] && coloured[3] > 0 ? coloured : mid[3] > 0 ? mid : all
  if (sum[3] === 0) return null
  return `#${[sum[0], sum[1], sum[2]].map((v) => Math.round(v / sum[3]).toString(16).padStart(2, '0')).join('')}`
}

/**
 * The `colours` command's lines (Plan 19): for each of `names`, one line per mask its manifest entry lists —
 * `<name> <kind> #rrggbb`, the eyes by their iris (`maskColour`), `empty` for an empty mask. A hair layer's hair
 * line adds its hairstyle's `naturalColour` from `items` (`items.json`, once A3 gives the hairstyles one) and how
 * far the drawn hair is from it: `natural #rrggbb ΔE n.n`. A name with no masks is logged, not printed.
 *
 * @param {{ dir: string, manifest: { files: Record<string, any> }, names: string[], items?: { id: string, naturalColour?: string }[], log?: (message: string) => void }} options
 * @returns {Promise<string[]>}
 */
export async function describeColours({ dir, manifest, names, items = [], log = () => {} }) {
  const lines = []
  for (const name of names) {
    const entry = manifest.files?.[name]
    if (!entry) throw new Error(`no layer ${name} in the manifest`)
    const kinds = Object.keys(entry.masks ?? {})
    if (!kinds.length) { log(`${name} has no masks`); continue }
    const parsed = parseName(name)
    const layer2x = await readPicture(join(dir, `${name}@2x.png`))
    for (const kind of kinds) {
      const maskPic = await readPicture(join(dir, `${name}_${MASK_FILE_KIND[kind]}mask@2x.png`))
      const alpha = new Uint8Array(maskPic.width * maskPic.height)
      for (let i = 0; i < alpha.length; i++) alpha[i] = maskPic.data[i * 4 + 3]
      const colour = maskColour(layer2x, alpha, { iris: kind === 'eyes' })
      if (colour === null) { lines.push(`${name} ${kind} empty`); continue }
      let line = `${name} ${kind} ${colour}`
      if (kind === 'hair' && parsed?.kind === 'hair') {
        const natural = items.find((item) => item.id === hairItemId(parsed.code))?.naturalColour
        if (natural) line += ` natural ${natural} ΔE ${deltaE76(colour, natural).toFixed(1)}`
      }
      lines.push(line)
    }
  }
  return lines
}

// ──────────────────────────────────────────────────────────────── writing ──

/** A v4 outfit layer, cut on a body (`cutOn`), whose copy of that body's outline a skin colour shades (2026-10-05). */
function isOutfitOnBody(parsed, entry) {
  return parsed.kind === 'item' && parsed.slot === 'outfit' && GENDERS.includes(entry.cutOn)
}

/**
 * Every manifest name `writeMasks` can cut a mask for: every tintable item, every v4 outfit cut on a body (its copy of
 * the body's outline, 2026-10-05) and (Plan 19) every real v4 body, body face and hair layer that is not marked empty. A
 * stand-in's masks are drawn with it, never cut. (The flat bases' L30, L60 and faces were targets too, until the
 * switch-over retired them, D1.)
 */
export function maskTargets(manifest) {
  const names = []
  for (const [name, entry] of Object.entries(manifest.files ?? {})) {
    if (!entry?.real) continue
    const parsed = parseName(name)
    if (!parsed) continue
    if (parsed.kind === 'item' && (entry.tintSeed || isOutfitOnBody(parsed, entry))) {
      names.push(name)
    } else if (parsed.kind === 'body' || parsed.kind === 'bodyFace' || parsed.kind === 'hair') {
      if (!entry.empty) names.push(name)
    }
  }
  return names
}

/** Whether a picture's own alpha channel carries real coverage, as opposed to `ensureAlpha`'s all-255 filler. */
function hasRealAlpha(pic) {
  const { data } = pic
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true
  return false
}

/**
 * A hand-drawn mask (`assets/avatar-src/masks/…`) as one byte a pixel at `width` × `height`: its alpha when the file
 * carries real alpha, otherwise its luminance — so a black-and-white drawing works as well as a transparent one. A
 * frame-sized (@1x) drawing is scaled up to a layer at another density first; any other size is refused, because its
 * pixels would land nowhere in particular. How `writeOneMask` reads an override, and (Plan 19) how `ingest` reads a
 * hairstyle's hand-drawn front mask, `item_hair_<code>_frontmask.png`.
 *
 * @param {string} file
 * @param {number} width
 * @param {number} height
 * @returns {Promise<Uint8Array>}
 */
export async function readHandMask(file, width, height) {
  let pic = await readPicture(file)
  if (pic.width === FRAME.w && pic.height === FRAME.h && (width !== FRAME.w || height !== FRAME.h)) pic = await resizePicture(pic, width, height)
  if (pic.width !== width || pic.height !== height) {
    throw new Error(`${file} is ${pic.width} × ${pic.height}: a hand-drawn mask is the frame (${FRAME.w} × ${FRAME.h}) or the layer (${width} × ${height})`)
  }
  const useAlpha = hasRealAlpha(pic)
  const mask = new Uint8Array(width * height)
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4
    mask[i] = useAlpha ? pic.data[o + 3] : Math.round(0.3 * pic.data[o] + 0.59 * pic.data[o + 1] + 0.11 * pic.data[o + 2])
  }
  return mask
}

/**
 * `hair`/`eyes`/`tint`/`skin`/`skinLine` in the manifest (`entry.masks`) are `hairmask`/`eyemask`/`tintmask`/
 * `skinmask`/`skinlinemask` on disk (spec §4.1: file names say "eye", the manifest says "eyes"; Plan 19 adds skin,
 * spec §5.5, and 2026-10-05 the skin's line art) — the one place the two spellings have to meet.
 */
export const MASK_FILE_KIND = { hair: 'hair', eyes: 'eye', tint: 'tint', skin: 'skin', skinLine: 'skinline' }

/**
 * The mask to write for one `<name>_<kind>` (`kind` a manifest key: `hair`, `eyes`, `tint` or `skin`): a hand-drawn
 * override if one exists at `overridesDir`, else `computed`. Writes both densities and records the manifest
 * entry — `{ bytes2x, meanL, empty?, override? }` — into `entry.masks[kind]`.
 *
 * A `tint` mask also gives the item's icon its own (2026-10-01, Plan 18 No8a): `writeIconTintMask` cuts this very
 * mask — override and all — with the icon's fit, as `<icon>_tintmask`, and flags the icon in `manifest.icons`.
 */
async function writeOneMask({ dir, name, kind, computed, layer2x, entry, manifest, overridesDir, log }) {
  const { width, height } = layer2x
  const fileKind = MASK_FILE_KIND[kind]
  let mask = computed
  let override = false
  const overrideFile = join(overridesDir, `${name}_${fileKind}mask.png`)
  if (existsSync(overrideFile)) {
    mask = await readHandMask(overrideFile, width, height)
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
  if (kind === 'tint') {
    const iconMask = await writeIconTintMask(maskPic, layer2x, dir, name, manifest)
    if (iconMask !== null) log(`${iconMask} — cut with the icon's fit`)
  }
}

/** The `kind` mask `writeOneMask` just wrote for `name`, read back at @2x as one alpha byte a pixel — so what is cut
 * next sees a hand-drawn override exactly as it was written. */
async function writtenMask(dir, name, kind) {
  const written = await readPicture(join(dir, `${name}_${MASK_FILE_KIND[kind]}mask@2x.png`))
  const alpha = new Uint8Array(written.width * written.height)
  for (let i = 0; i < alpha.length; i++) alpha[i] = written.data[i * 4 + 3]
  return alpha
}

/** The ink of a layer as a mask: a hair layer's hair (Plan 19) — the layer *is* the hair. */
function inkMask(layer2x) {
  const ink = new Uint8Array(layer2x.width * layer2x.height)
  for (let i = 0; i < ink.length; i++) ink[i] = layer2x.data[i * 4 + 3] > ALPHA_INK ? 255 : 0
  return ink
}

/**
 * Cut and write the masks for `names` (from `maskTargets`, or a caller's own subset), into `dir`. Mutates
 * `manifest.files[name].masks` for each; does not write the manifest — the caller does, alongside whatever
 * else it changed in the same run (`ingest`, the `masks` command).
 *
 * Plan 19 (spec §5.5): a body L30 gets **skin**, cut clear of the eyes `eyeMask` finds on it (not written); a body
 * face gets **eyes** and then **skin**, cut clear of the eye mask as written (a hand-drawn `_eyemask` included), and
 * never hair — the head is bald, so `eyeMask` is handed an empty hair array (pre-flight #21); a hair layer's **hair**
 * is its ink. Both then get **skinLine** (2026-10-05), cut beside the skin mask as written (an override included)
 * and clear of the same eyes. Its manifest `meanL` is the line's own and goes unused: the line is shaded against the
 * skin's (`bodies.ts`). A v4 outfit cut on a body gets **skinLine** too: its copy of that body's outline
 * (`outfitLineMask`), against the body's skin and line as written — so bodies are cut first, whatever order `names`
 * gives, and an outfit whose body has no such masks on disk is refused. Re-cutting a body does not re-cut the outfits
 * cut on it: name them in the same run (`masks body_f_L30 item_outfit_…`) when the body's line moves.
 */
export async function writeMasks({ dir, manifest, names, overridesDir = MASK_OVERRIDE_DIR, log = () => {} }) {
  // Bodies first: an outfit's line is cut against its body's skin and line as written in this same run.
  const bodyFirst = (name) => (/^body_/.test(name) ? 0 : 1)
  for (const name of [...names].sort((a, b) => bodyFirst(a) - bodyFirst(b))) {
    const parsed = parseName(name)
    if (!parsed) continue
    const entry = manifest.files[name]
    if (!entry?.real || entry.empty) continue
    const layer2x = await readPicture(join(dir, `${name}@2x.png`))
    const shut = parsed.expr === 'closed' || parsed.expr === 'sleep'

    if (parsed.kind === 'item') {
      // An outfit's line is cut against its body's masks as written; refuse before writing anything for it without them.
      const bodyName = isOutfitOnBody(parsed, entry) ? bodyFile(entry.cutOn) : null
      if (bodyName) {
        for (const kind of ['skin', 'skinLine']) {
          const file = join(dir, `${bodyName}_${MASK_FILE_KIND[kind]}mask@2x.png`)
          if (!existsSync(file)) throw new Error(`${name} is cut against ${bodyName}'s ${kind} mask, and ${file} is missing: cut the body's masks first`)
        }
      }
      if (entry.tintSeed) {
        const tint = tintMask(layer2x, entry.tintSeed)
        await writeOneMask({ dir, name, kind: 'tint', computed: tint, layer2x, entry, manifest, overridesDir, log })
      }
      if (bodyName) {
        const body = await readPicture(join(dir, `${bodyName}@2x.png`))
        const reference = { body, skin: await writtenMask(dir, bodyName, 'skin'), line: await writtenMask(dir, bodyName, 'skinLine') }
        await writeOneMask({ dir, name, kind: 'skinLine', computed: outfitLineMask(layer2x, reference), layer2x, entry, manifest, overridesDir, log })
      }
    } else if (parsed.kind === 'body') {
      // The body carries the neutral face too (under the face layer): its own eyes, found the way a face's are and
      // never written, keep an amber iris out of its skin.
      const { width, height } = layer2x
      const eyes = eyeMask(layer2x, new Uint8Array(width * height))
      await writeOneMask({ dir, name, kind: 'skin', computed: skinMask(layer2x, { eyes }), layer2x, entry, manifest, overridesDir, log })
      const skin = await writtenMask(dir, name, 'skin')
      await writeOneMask({ dir, name, kind: 'skinLine', computed: skinLineMask(layer2x, { skin, eyes }), layer2x, entry, manifest, overridesDir, log })
    } else if (parsed.kind === 'bodyFace') {
      const { width, height } = layer2x
      const eyes = shut ? new Uint8Array(width * height) : eyeMask(layer2x, new Uint8Array(width * height))
      await writeOneMask({ dir, name, kind: 'eyes', computed: eyes, layer2x, entry, manifest, overridesDir, log })
      const writtenEyes = await writtenMask(dir, name, 'eyes')
      await writeOneMask({ dir, name, kind: 'skin', computed: skinMask(layer2x, { eyes: writtenEyes }), layer2x, entry, manifest, overridesDir, log })
      const skin = await writtenMask(dir, name, 'skin')
      await writeOneMask({ dir, name, kind: 'skinLine', computed: skinLineMask(layer2x, { skin, eyes: writtenEyes }), layer2x, entry, manifest, overridesDir, log })
    } else if (parsed.kind === 'hair') {
      await writeOneMask({ dir, name, kind: 'hair', computed: inkMask(layer2x), layer2x, entry, manifest, overridesDir, log })
    }
  }
}
