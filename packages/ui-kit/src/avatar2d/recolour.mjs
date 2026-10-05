// Pure, DOM-free recolouring shared by the avatar pipeline (Node, tint-sheet) and the browser (ui-kit Chibi).
// Spec 2026-09-24-avatar-tint-design.md §5.1.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

function hueToChannel(p, q, t) {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v] }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const k = h / 360
  return [hueToChannel(p, q, k + 1 / 3), hueToChannel(p, q, k), hueToChannel(p, q, k - 1 / 3)].map((v) => Math.round(v * 255))
}

export function hexToHsl(hex) {
  const n = Number.parseInt(hex.slice(1), 16)
  return rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255)
}

export function meanLightness(pixels, mask) {
  let sum = 0, weight = 0
  for (let i = 0; i < mask.length; i++) {
    const a = mask[i]
    if (!a) continue
    const o = i * 4
    sum += rgbToHsl(pixels[o], pixels[o + 1], pixels[o + 2])[2] * a
    weight += a
  }
  return weight === 0 ? 0 : sum / weight
}

/**
 * Line art under a region's colour (2026-10-05, the skin's outline): every masked pixel darkened by
 * k = min(1, colour's lightness / `meanL`), its own hue and saturation kept, blended by the mask like `recolour`.
 * `recolour` would hand a dark line the colour's hue and saturation and shift it by the region's lightness — on a
 * light skin a saturated orange line, on a deep one black. Darkening keeps the line as drawn on any colour at least as
 * light as the region it was drawn for, and darker by the same ratio as the skin on a darker one. Alpha is untouched;
 * a `meanL` of 0 (no reference) leaves the pixels as they are.
 */
export function shade(pixels, mask, colour, meanL) {
  if (!(meanL > 0)) return
  const k = Math.min(1, hexToHsl(colour)[2] / meanL)
  if (k === 1) return
  for (let i = 0; i < mask.length; i++) {
    const a = mask[i]
    if (!a) continue
    const o = i * 4
    const f = 1 - (a / 255) * (1 - k)
    pixels[o] = Math.round(pixels[o] * f)
    pixels[o + 1] = Math.round(pixels[o + 1] * f)
    pixels[o + 2] = Math.round(pixels[o + 2] * f)
  }
}

export function recolour(pixels, mask, colour, meanL) {
  const [hue, sat, lc] = hexToHsl(colour)
  const shift = lc - meanL
  for (let i = 0; i < mask.length; i++) {
    const a = mask[i]
    if (!a) continue
    const o = i * 4
    const l = rgbToHsl(pixels[o], pixels[o + 1], pixels[o + 2])[2]
    const [r, g, b] = hslToRgb(hue, sat, clamp01(l + shift))
    const t = a / 255
    pixels[o] = Math.round(pixels[o] * (1 - t) + r * t)
    pixels[o + 1] = Math.round(pixels[o + 1] * (1 - t) + g * t)
    pixels[o + 2] = Math.round(pixels[o + 2] * (1 - t) + b * t)
  }
}
