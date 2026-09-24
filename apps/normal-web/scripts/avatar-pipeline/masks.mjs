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
/** Task 2b's own connectivity for the eye-mask skin-leak flood (spec §4.1 ruling): a skin-like pixel joins
 * the flood only edge-to-edge, not corner-to-corner, so a single diagonal pixel of iris outline still blocks it. */
const NEIGHBOURS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]

/** Connected components, iterative (a recursive flood fill overflows the stack on a 768 × 896 mask).
 * 8-connected by default; pass `NEIGHBOURS4` for a stricter, edge-only flood. */
function components(mask, width, height, neighbours = NEIGHBOURS8) {
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

  // light pockets: a small enclosed pocket of highlight (not skin) joins the hair round it. Two shapes of
  // pocket qualify (Task 2b ruling, spec §4.1): a bright one (the original rule, ≤ 2500 px @2x scaled,
  // every pixel L ≥ 55) or a grey shine band (≤ 8000 px @2x scaled, every pixel chroma < 12 — f02/m02's
  // grey highlight streaks are duller than 55 but still read as hair, not as a second colour). A pocket
  // is judged as a whole (its *least* bright / *most* chromatic pixel), not pixel by pixel, so one stray
  // dark or saturated pixel does not let the rest of an otherwise-uniform pocket through.
  {
    const inv = new Uint8Array(width * height)
    for (let i = 0; i < width * height; i++) inv[i] = hair[i] ? 0 : 1
    const hc = components(inv, width, height)
    const maxBrightPocket = Math.round(2500 * scale * scale)
    const maxShinePocket = Math.round(8000 * scale * scale)
    const excluded = new Uint8Array(hc.sizes.length) // opaque-but-not / skin: never a light pocket
    const minL = new Float32Array(hc.sizes.length).fill(Infinity)
    const maxChroma = new Float32Array(hc.sizes.length).fill(0)
    for (let i = 0; i < width * height; i++) {
      const l = hc.label[i]
      if (l < 0) continue
      if (!opaqueAt(pic, i) || skinMask[i]) { excluded[l] = 1; continue }
      if (LAB[i * 3] < minL[l]) minL[l] = LAB[i * 3]
      const chroma = Math.hypot(LAB[i * 3 + 1], LAB[i * 3 + 2])
      if (chroma > maxChroma[l]) maxChroma[l] = chroma
    }
    const good = new Set()
    for (let l = 0; l < hc.sizes.length; l++) {
      if (excluded[l]) continue
      const size = hc.sizes[l]
      const bright = size <= maxBrightPocket && minL[l] >= 55
      const greyShine = size <= maxShinePocket && maxChroma[l] < 12
      if (bright || greyShine) good.add(l)
    }
    for (let i = 0; i < width * height; i++) if (hc.label[i] >= 0 && good.has(hc.label[i])) hair[i] = 1
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
 * 1. Per side of the face centre line, in the eye band: the eye-white components (opaque, L > 88,
 *    chroma < 10; a component whose box straddles the centre line — teeth — is ignored, and so is one
 *    under 20 px @2x scaled). Their boxes union per side.
 * 2. That box is expanded 15 % each way (top/bottom/left/right), and the eye is the ellipse inscribed in
 *    the expanded box — a side with no whites (closed eyes, a wink) gets no ellipse and stays empty.
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
  const { width, height, scale, density, labAt, top, cx, skinOnly, hairPal } = analysePicture(pic)
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
  const headH = FACE_LIMIT_Y * density - top
  const yStart = Math.max(0, Math.floor(top + headH * 0.3))
  const yEnd = Math.min(height, Math.ceil(top + headH * 0.75))

  // 1. eye-white components in the band, unioned into one box per side
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

  // 2. expand 15 % each way, the eye is the ellipse inscribed in the result
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
    ellipses.push({ cx: (ex0 + ex1) / 2, cy: (ey0 + ey1) / 2, a: (ex1 - ex0) / 2, b: (ey1 - ey0) / 2 })
  }
  const ellipseMask = new Uint8Array(width * height)
  if (ellipses.length) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (const e of ellipses) {
          const dx = (x - e.cx) / e.a
          const dy = (y - e.cy) / e.b
          if (dx * dx + dy * dy <= 1) { ellipseMask[y * width + x] = 1; break }
        }
      }
    }
  }

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
  // dilated by the same 3 px C11 merges blobs with (a pupil/highlight/lash gap closes at that radius; the
  // 10–25 px gap to a brow or a stray strand does not), and drop every other group entirely.
  {
    const dilated = dilate(eyes, width, height, Math.round(3 * scale))
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
export const MASK_FILE_KIND = { hair: 'hair', eyes: 'eye', tint: 'tint' }

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
