/**
 * How far apart two colours look, for the one question the server asks of colour (spec §4.5): when an old v3
 * base is read back as a v4 body, were its eyes drawn a different colour from the new body's, and if so,
 * which free eye colour is nearest to the old ones?
 *
 * CIE Lab with ΔE76 — the plain Euclidean distance — rather than a later ΔE formula: the question is
 * "noticeably different, and nearest to what", over six free swatches far apart from each other, and the
 * migration's outcomes were pinned with exactly this formula (ruling 6). A better formula would change which
 * swatch an old account is handed, and that is not a change this module may make silently. The constants
 * below are the plan's, to four decimals, for the same reason.
 */

/** A colour is always a lowercase 6-digit hex (design §3.2), the rule `items.ts` and `bodies.ts` hold colours to. */
const HEX_COLOUR = /^#[0-9a-f]{6}$/

/** sRGB → linear XYZ, the sRGB primaries under D65. */
const SRGB_TO_XYZ = [
  [0.4124, 0.3576, 0.1805],
  [0.2126, 0.7152, 0.0722],
  [0.0193, 0.1192, 0.9505],
] as const

/** The D65 reference white Lab is measured against. */
const WHITE = [0.95047, 1, 1.08883] as const

/** Lab's cube root, with the linear segment near black that keeps its slope finite (ε = 216/24389, κ = 24389/27). */
function f(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116
}

/** One sRGB channel, 0–255, undone from its gamma curve to linear light. */
function linear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** `[L, a, b]` of a lowercase `#rrggbb`. Throws on anything else: every caller holds a colour that was validated at load. */
export function labOf(hex: string): [number, number, number] {
  if (!HEX_COLOUR.test(hex)) throw new Error(`not a lowercase #rrggbb colour: ${JSON.stringify(hex)}`)
  const rgb = [1, 3, 5].map((at) => linear(Number.parseInt(hex.slice(at, at + 2), 16)))
  const [x, y, z] = SRGB_TO_XYZ.map((row, i) => (row[0] * rgb[0]! + row[1] * rgb[1]! + row[2] * rgb[2]!) / WHITE[i]!) as [number, number, number]
  const [fx, fy, fz] = [f(x), f(y), f(z)]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** ΔE76 between two lowercase `#rrggbb` colours: the straight-line distance between them in Lab. */
export function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = labOf(a)
  const [l2, a2, b2] = labOf(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}
