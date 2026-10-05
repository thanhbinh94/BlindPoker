/**
 * WCAG 2.1 contrast arithmetic, and a reader for the stylesheets it is asked about — shared by every contrast test
 * in the workspace through `@bp/ui-kit/testing`. It is not part of the shipped kit: `src/index.ts` does not export
 * it, and only tests import it.
 *
 * Colours are `#rrggbb` strings wherever they are opaque. A translucent colour — a tint, a placeholder — is an
 * `Rgba` until it is laid over something with `over`, which is how the browser paints it too: in gamma-encoded
 * sRGB, and into an 8-bit pixel.
 */
import TOKENS_CSS from './tokens.css?raw'

/** WCAG 1.4.3: normal-size text — which is nearly all of this kit's text, badges and placeholders included. */
export const AA = 4.5

/** WCAG 1.4.11: a rule, a border, a dot or a fill that carries meaning, against what it sits on. */
export const NON_TEXT = 3

/** Channels 0–255, alpha 0–1. */
export type Rgba = readonly [r: number, g: number, b: number, a: number]

/** WCAG 2.1 relative luminance of an `#rrggbb`. */
export function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** `(L1 + 0.05) / (L2 + 0.05)` with the lighter colour on top; the order of the arguments does not matter. */
export function contrast(fg: string, bg: string): number {
  const [lighter, darker] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number]
  return (lighter + 0.05) / (darker + 0.05)
}

/** The rule blocks of a stylesheet as `[selector, body]`, comments out of the way first (they sit between blocks
 *  and would otherwise be read as part of the next selector). A block is everything between a selector and the next
 *  `}`, so a rule nested in an at-rule is read as its own block and the at-rule's head is never a selector. */
function blocks(css: string): [string, string][] {
  // A vitest config that does not let `*.css?raw` through hands over '' (or, for a CSS module, a class-name proxy):
  // read as no declarations at all, every guard over them would pass on nothing.
  if (typeof css !== 'string' || css.trim() === '') {
    throw new Error('an empty stylesheet: the vitest config must let *.css?raw through (test.css.include)')
  }
  return [...css.replaceAll(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [
    (m[1] ?? '').replace(/\s+/g, ' ').trim(),
    m[2] ?? '',
  ])
}

/**
 * Every declaration of the blocks whose selector matches, as `property → value` with the value's whitespace
 * collapsed: custom properties and plain ones (`color`, `background`) alike. A later block wins, as in the cascade.
 */
export function declarationsOf(css: string, selectorPattern: RegExp): Record<string, string> {
  const found: Record<string, string> = {}
  for (const [selector, body] of blocks(css)) {
    if (!selectorPattern.test(selector)) continue
    for (const declaration of body.split(';')) {
      const colon = declaration.indexOf(':')
      if (colon < 0) continue
      const name = declaration.slice(0, colon).trim()
      if (name !== '') found[name] = declaration.slice(colon + 1).replace(/\s+/g, ' ').trim()
    }
  }
  return found
}

/**
 * The flat `#rrggbb` custom properties of one rule block, read out of the stylesheet itself so a test follows the
 * file rather than a copy of it. A token whose value is anything else (an `rgba`, a gradient) is left out.
 */
export function tokensOf(css: string, selectorPattern: RegExp): Record<string, string> {
  const found: Record<string, string> = {}
  for (const [name, value] of Object.entries(declarationsOf(css, selectorPattern))) {
    if (name.startsWith('--') && /^#[0-9a-fA-F]{6}$/.test(value)) found[name] = value.toLowerCase()
  }
  return found
}

/** `a, b(c, d), e` → `['a', 'b(c, d)', 'e']`: commas inside parentheses stay put. */
function splitArgs(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      out.push(text.slice(start, i).trim())
      start = i + 1
    }
  }
  out.push(text.slice(start).trim())
  return out
}

/** `name(args)` → `['name', 'args']`, or `null` when the value is not one function call. */
function call(value: string): [string, string] | null {
  const m = /^([a-z-]+)\((.*)\)$/s.exec(value.trim())
  return m === null ? null : [m[1]!, m[2]!]
}

/**
 * A CSS colour as the browser would compute it, for the handful of forms this workspace's stylesheets use:
 * `#rrggbb`, `rgb()` / `rgba()` with commas, `transparent`, `currentColor`, `var(--name[, fallback])` looked up in
 * `vars` (raw declarations, as `declarationsOf` returns them), and `color-mix(in srgb, A [p%], B [q%])` — mixed with
 * premultiplied alpha, as CSS Color 5 asks, so `color-mix(in srgb, X 16%, transparent)` is X at alpha 0.16.
 */
export function parseColor(value: string, vars: Record<string, string>, currentColor?: Rgba): Rgba {
  const v = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(v)) {
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(v.slice(i, i + 2), 16)) as [number, number, number]
    return [r, g, b, 1]
  }
  if (v === 'transparent') return [0, 0, 0, 0]
  if (v.toLowerCase() === 'currentcolor') {
    if (currentColor === undefined) throw new Error('currentColor with no colour to stand for')
    return currentColor
  }
  const fn = call(v)
  if (fn === null) throw new Error(`not a colour this reader knows: ${v}`)
  const [name, args] = fn
  const parts = splitArgs(args)
  if (name === 'rgb' || name === 'rgba') {
    const [r, g, b, a] = parts.map(Number) as [number, number, number, number | undefined]
    return [r, g, b, a ?? 1]
  }
  if (name === 'var') {
    const [ref, fallback] = parts as [string, string | undefined]
    const found = vars[ref]
    if (found !== undefined) return parseColor(found, vars, currentColor)
    if (fallback !== undefined) return parseColor(fallback, vars, currentColor)
    throw new Error(`${ref} is not declared`)
  }
  if (name === 'color-mix') {
    const [space, first, second] = parts as [string, string, string]
    if (space !== 'in srgb') throw new Error(`color-mix ${space}: only srgb is read`)
    const operand = (text: string): [Rgba, number | null] => {
      const m = /^(.*?)\s+(\d+(?:\.\d+)?)%$/s.exec(text)
      return m === null ? [parseColor(text, vars, currentColor), null] : [parseColor(m[1]!, vars, currentColor), Number(m[2]) / 100]
    }
    const [c1, p1Given] = operand(first)
    const [c2, p2Given] = operand(second)
    let p1 = p1Given ?? (p2Given === null ? 0.5 : 1 - p2Given)
    let p2 = p2Given ?? 1 - p1
    const sum = p1 + p2
    const scale = Math.min(sum, 1) // percentages short of 100 % leave the result that much transparent
    p1 /= sum
    p2 /= sum
    const alpha = c1[3] * p1 + c2[3] * p2
    if (alpha === 0) return [0, 0, 0, 0]
    const channel = (i: 0 | 1 | 2): number => (c1[i] * c1[3] * p1 + c2[i] * c2[3] * p2) / alpha
    return [channel(0), channel(1), channel(2), alpha * scale]
  }
  throw new Error(`not a colour this reader knows: ${v}`)
}

/** An opaque colour as `#rrggbb`, each channel rounded into the 8-bit pixel the screen shows. */
export function toHex([r, g, b]: Rgba): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`
}

/** `fg` laid over `bg` (source-over, in gamma-encoded sRGB, as the browser composites): the opaque result. */
export function over(fg: Rgba, bg: string | Rgba): string {
  const ground = typeof bg === 'string' ? parseColor(bg, {}) : bg
  if (ground[3] !== 1) throw new Error('the ground must be opaque')
  const a = fg[3]
  const lay = (top: number, under: number): number => top * a + under * (1 - a)
  return toHex([lay(fg[0], ground[0]), lay(fg[1], ground[1]), lay(fg[2], ground[2]), 1])
}

/** What a browser draws a placeholder in when no rule says: Chromium's grey, and Firefox's default opacity. */
export const UA_PLACEHOLDER = '#757575'
export const UA_PLACEHOLDER_OPACITY = 0.54

/**
 * A `::placeholder` rule's text colour as the least forgiving engine draws it: the rule's `color` (Chromium's
 * `#757575` without one), at the rule's `opacity` — or at Firefox's own default, 0.54, without one.
 */
export function placeholderColour(rule: Record<string, string>, palette: Record<string, string>): Rgba {
  const [r, g, b, a] = parseColor(rule.color ?? UA_PLACEHOLDER, palette)
  return [r, g, b, a * (rule.opacity === undefined ? UA_PLACEHOLDER_OPACITY : Number(rule.opacity))]
}

/**
 * The three palettes of `tokens.css`, every declaration raw (an `rgba` tint as well as a `#rrggbb`), each as it
 * is in effect where it applies: `light` is the light block over the dark root it overrides, and `night` the
 * `[data-surface='night']` block over the dark root — the ink half it re-declares is the same under either theme.
 */
const DARK_ROOT = declarationsOf(TOKENS_CSS, /^:root, :root\[data-theme='dark'\]$/)
export const THEME_PALETTES: Readonly<Record<'dark' | 'light' | 'night', Record<string, string>>> = {
  dark: DARK_ROOT,
  light: { ...DARK_ROOT, ...declarationsOf(TOKENS_CSS, /^:root\[data-theme='light'\]$/) },
  night: { ...DARK_ROOT, ...declarationsOf(TOKENS_CSS, /^\[data-surface='night'\]$/) },
}

export interface Declaration {
  selector: string
  property: string
  value: string
}

/**
 * Every declaration in the stylesheet whose value reads `var(<token>)` — exactly that token, so `--red` does not
 * also find `--red-fill`. A test filters these by property: since the red split, an ink (`color`) reads `--red` and
 * everything painted rather than read (a fill, a rule, a dot, a ring) reads `--red-fill`.
 */
export function declarationsUsing(css: string, token: string): Declaration[] {
  const uses = new RegExp(`var\\(${token.replaceAll('-', '\\-')}\\s*[,)]`)
  const found: Declaration[] = []
  for (const [selector, body] of blocks(css)) {
    for (const declaration of body.split(';')) {
      const colon = declaration.indexOf(':')
      if (colon < 0) continue
      const value = declaration.slice(colon + 1).replace(/\s+/g, ' ').trim()
      if (uses.test(value)) found.push({ selector, property: declaration.slice(0, colon).trim(), value })
    }
  }
  return found
}
