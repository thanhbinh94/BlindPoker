import { describe, expect, it } from 'vitest'
import LOBBY_CSS from '../lobby/lobby.module.css?raw'
import PRIMITIVES_CSS from '../primitives/primitives.module.css?raw'
import CSS from './tokens.css?raw'

/** Every declaration of `--font-display`, whichever `:root` block it sits in. */
const displayStacks = (): string[] => [...CSS.matchAll(/--font-display:\s*([^;]+);/g)].map((m) => (m[1] ?? '').trim())

describe('--font-display', () => {
  it('is declared, and every declaration agrees', () => {
    const stacks = displayStacks()
    expect(stacks.length).toBeGreaterThan(0)
    expect(new Set(stacks).size).toBe(1)
  })

  /**
   * Vietnamese is the product's first language and the display face is where names and headings
   * live. Georgia has no precomposed glyphs for `ế ộ ữ ằ` on Windows, so a heading that falls back
   * to it renders those characters from a different face and their diacritics sit visibly off.
   */
  it('names no fallback that lacks Vietnamese precomposed glyphs', () => {
    for (const stack of displayStacks()) expect(stack).not.toMatch(/Georgia/i)
  })

  it('reaches a Windows face with full Vietnamese coverage before the generic serif', () => {
    for (const stack of displayStacks()) {
      const families = stack.split(',').map((f) => f.trim().replaceAll("'", '').toLowerCase())
      expect(families.at(-1)).toBe('serif')
      expect(families).toContain('cambria')
      expect(families.indexOf('cambria')).toBeLessThan(families.indexOf('serif'))
    }
  })
})

// --------------------------------------------------------------------------- contrast

/**
 * WCAG 2.1 relative luminance of an `#rrggbb`, and the contrast ratio between two of them —
 * `(L1 + 0.05) / (L2 + 0.05)` with the lighter colour on top. AA asks 4.5:1 for normal-size text,
 * which is what nearly all of this kit's text is.
 */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(fg: string, bg: string): number {
  const [lighter, darker] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number]
  return (lighter + 0.05) / (darker + 0.05)
}

const AA = 4.5

/**
 * The flat `#rrggbb` tokens of one rule block, read out of the stylesheet itself so the test follows
 * the file rather than a copy of it. `tokens.css` has no nested at-rules, so a block is everything
 * between a selector and the next `}` — once the comments, which sit between the blocks and would
 * otherwise be read as part of the next selector, are out of the way.
 */
function tokensOf(css: string, selectorPattern: RegExp): Record<string, string> {
  const found: Record<string, string> = {}
  for (const [, selector, body] of css.replaceAll(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorPattern.test((selector ?? '').replace(/\s+/g, ' ').trim())) continue
    for (const [, name, hex] of (body ?? '').matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) found[name!] = hex!.toLowerCase()
  }
  return found
}

const dark = tokensOf(CSS, /^:root, :root\[data-theme='dark'\]$/)
const light = tokensOf(CSS, /^:root\[data-theme='light'\]$/)
/** The night surface only re-declares the ink half; everything else it inherits from the dark root. */
const night = { ...dark, ...tokensOf(CSS, /^\[data-surface='night'\]$/) }

const PALETTES = { dark, light, night } as const

/** `[text token, surface token, where it is spent]` — every pair the kit actually prints text on. */
const TEXT_PAIRS: readonly (readonly [string, string, string])[] = [
  ['--ink', '--bg', 'body text on the page'],
  ['--ink-muted', '--bg', 'secondary text on the page'],
  ['--gold', '--bg', 'gold ink on the page (headings, the pot, the turn)'],
  ['--red', '--bg', 'red ink on the page (errors, a full table)'],
  ['--teal', '--bg', 'teal ink on the page'],
  ['--ink', '--bg-elev', 'body text on a raised panel'],
  ['--ink-muted', '--bg-elev', 'secondary text on a raised panel'],
  ['--gold', '--bg-elev', 'gold ink on a raised panel'],
  ['--red', '--bg-elev', 'red ink on a raised panel'],
  ['--teal', '--bg-elev', 'teal ink on a raised panel'],
  ['--gold-ink', '--gold', 'the label of a primary button'],
  ['--red-ink', '--red', 'the label of a destructive button'],
  ['--teal-ink', '--teal-fill', 'the label of a teal chip'],
  ['--card-ink', '--card-face', 'a black rank on a card'],
  ['--card-red', '--card-face', 'a red rank on a card'],
]

/**
 * The felt stays night-side in both themes, so anything laid over it re-declares the ink half of the
 * palette (`data-surface="night"`). These pairs are therefore only ever the night palette's.
 */
const FELT_PAIRS: readonly (readonly [string, string, string])[] = [
  ['--ink', '--felt', 'a seat name on the felt'],
  ['--gold', '--felt', 'the pot on the felt'],
]

/**
 * Pairs that are on record as below AA, with the ratio measured when they were recorded.
 *
 * `--red` carries two jobs at once: it is the ink of an error line on the dark ground *and* the fill
 * under `--red-ink` on a fold button. On `#0b1020` an ink needs a luminance above ~0.20 to reach
 * 4.5:1, while a fill under `#fdf3f0` needs one below ~0.17 — no single value can do both, so
 * closing this means splitting the token the way `--teal` / `--teal-fill` already are, and that is a
 * palette change across three packages rather than a token tweak. Tracked in `docs/ui-kit.md`.
 *
 * The entries are asserted in both directions: a pair that gets worse fails, and so does one that is
 * fixed — fix it and delete its line.
 */
const BELOW_AA: Record<string, number> = {
  'dark --red on --bg': 3.59,
  'dark --red on --bg-elev': 3.22,
  'night --red on --bg': 3.59,
  'night --red on --bg-elev': 3.22,
}

describe('theme contrast', () => {
  it('reads all three palettes out of the stylesheet', () => {
    for (const [name, palette] of Object.entries(PALETTES)) {
      expect(Object.keys(palette).length, `${name} palette`).toBeGreaterThan(10)
      for (const [fg, bg] of TEXT_PAIRS) {
        expect(palette[fg], `${name} ${fg}`).toMatch(/^#[0-9a-f]{6}$/)
        expect(palette[bg], `${name} ${bg}`).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  it('prints no text below WCAG AA (4.5:1) except the pairs on record', () => {
    for (const [name, palette] of Object.entries(PALETTES)) {
      const pairs = name === 'night' ? [...TEXT_PAIRS, ...FELT_PAIRS] : TEXT_PAIRS
      for (const [fg, bg, what] of pairs) {
        const key = `${name} ${fg} on ${bg}`
        if (key in BELOW_AA) continue
        const ratio = contrast(palette[fg]!, palette[bg]!)
        expect(ratio, `${key} — ${what} — ${palette[fg]} on ${palette[bg]} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
      }
    }
  })

  /**
   * A handful of components are printed paper whatever the page is doing — a room ticket, a light
   * panel — and re-declare the light inks locally on a paper gradient of their own. The theme test
   * cannot see those blocks, but the ink on them is the same ink and has to clear AA on the darker
   * end of the paper. (`.panel.felt` is the mirror image and repeats the night palette, which the
   * pairs above already cover.)
   */
  it('keeps the parchment islands at AA on the darker end of their paper', () => {
    const PAPER = '#f0e9d9' // the last stop of `linear-gradient(172deg, #fbf7ee 0%, #f0e9d9 100%)`
    const islands = [
      { name: '.ticket', tokens: tokensOf(LOBBY_CSS, /^\.ticket$/) },
      { name: '.panel.parchment', tokens: tokensOf(PRIMITIVES_CSS, /^\.panel\.parchment$/) },
    ]
    for (const { name, tokens } of islands) {
      expect(Object.keys(tokens).length, `${name} declares a palette`).toBeGreaterThan(3)
      for (const ink of ['--ink', '--ink-muted', '--gold', '--red', '--teal']) {
        const hex = tokens[ink]
        if (hex === undefined) continue // an island only re-declares what it actually spends
        const ratio = contrast(hex, PAPER)
        expect(ratio, `${name} ${ink} — ${hex} on ${PAPER} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
      }
    }
  })

  it('still fails on exactly the pairs on record, and no worse than recorded', () => {
    for (const [key, recorded] of Object.entries(BELOW_AA)) {
      const [name, fg, , bg] = key.split(' ') as [keyof typeof PALETTES, string, string, string]
      const ratio = contrast(PALETTES[name][fg]!, PALETTES[name][bg]!)
      expect(ratio, `${key} reaches AA now — delete its line from BELOW_AA`).toBeLessThan(AA)
      expect(ratio, `${key} got worse than the ${recorded}:1 on record`).toBeGreaterThanOrEqual(recorded - 0.005)
    }
  })
})
