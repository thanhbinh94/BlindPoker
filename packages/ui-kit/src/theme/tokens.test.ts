import { describe, expect, it } from 'vitest'
import AVATAR2D_CSS from '../avatar2d/avatar2d.module.css?raw'
import LOBBY_CSS from '../lobby/lobby.module.css?raw'
import PRIMITIVES_CSS from '../primitives/primitives.module.css?raw'
import SCREENS_CSS from '../screens/screens.module.css?raw'
import TABLE_CSS from '../table/table.module.css?raw'
import { AA, NON_TEXT, THEME_PALETTES, contrast, declarationsOf, declarationsUsing, over, parseColor, toHex, tokensOf } from './contrast.js'
import GLOBAL_CSS from './global.css?raw'
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

// WCAG arithmetic (`luminance`, `contrast`) and the stylesheet readers (`tokensOf`, …) live in `./contrast.ts`, so
// the editions' own contrast tests reach the same code through `@bp/ui-kit/testing`. AA is 4.5:1 for normal-size
// text, which is what nearly all of this kit's text is.

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
  ['--red-ink', '--red-fill', 'the label of a destructive button'],
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
 * Pairs that are on record as below AA, with the ratio measured when they were recorded — none, now.
 *
 * Until Plan 20 this held `--red` on the dark ground: 3.59:1 on `--bg` and 3.22 on `--bg-elev` in the dark and
 * night palettes, 3.13 on `.panel.felt`'s own ground. One token carried two jobs — the ink of an error line, and
 * the fill under `--red-ink` on a fold button — and on `#0b1020` an ink needs a luminance above ~0.20 while a fill
 * under `#fdf3f0` needs one below ~0.17. It is split now the way `--teal` / `--teal-fill` are: `--red` is the ink
 * (`#e0737b` on the dark ground), `--red-fill` keeps the old value for everything painted rather than read.
 *
 * The guard stays for the next pair that has to be put on record: an entry is asserted in both directions, so a
 * pair that gets worse fails, and so does one that is fixed — fix it and delete its line.
 */
const BELOW_AA: Record<string, number> = {}

/**
 * The palettes `BELOW_AA` keys can point into: the three theme palettes by name, plus each island
 * that re-declares its own tokens locally (keyed by its selector, exactly as `tokensOf` returns it —
 * a plain space-split still isolates the selector as the first field, dots and all).
 */
const ALL_PALETTES: Record<string, Record<string, string>> = {
  ...PALETTES,
  '.panel.felt': tokensOf(PRIMITIVES_CSS, /^\.panel\.felt$/),
}

/** The parchment islands' paper: `linear-gradient(172deg, #fbf7ee 0%, #f0e9d9 100%)`, its two ends. */
const PAPER = '#f0e9d9'
const PAPER_TOP = '#fbf7ee'

/**
 * The components that are printed paper whatever the page is doing — a room ticket, a light panel — each
 * re-declaring the light inks it spends on a paper gradient of its own. (Lite's name ticket is the third; Lite's
 * own test reads it, through `@bp/ui-kit/testing`.)
 */
const ISLANDS = [
  { name: '.ticket', css: LOBBY_CSS, selector: /^\.ticket$/ },
  { name: '.panel.parchment', css: PRIMITIVES_CSS, selector: /^\.panel\.parchment$/ },
] as const

/** `.panel.felt`'s own palette: the night mirror of the parchment islands, on a ground of its own. */
const FELT = tokensOf(PRIMITIVES_CSS, /^\.panel\.felt$/)

/** What the `[data-surface='night']` block itself declares, without the dark root it is read over above. */
const NIGHT_BLOCK = declarationsOf(CSS, /^\[data-surface='night'\]$/)

const HEX = /^#[0-9a-f]{6}$/

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
   * end of the paper.
   */
  it('keeps the parchment islands at AA on the darker end of their paper', () => {
    for (const { name, css, selector } of ISLANDS) {
      const tokens = tokensOf(css, selector)
      expect(Object.keys(tokens).length, `${name} declares a palette`).toBeGreaterThan(3)
      for (const ink of ['--ink', '--ink-muted', '--gold', '--red', '--teal']) {
        const hex = tokens[ink]
        if (hex === undefined) continue // an island only re-declares what it actually spends
        const ratio = contrast(hex, PAPER)
        expect(ratio, `${name} ${ink} — ${hex} on ${PAPER} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
      }
    }
  })

  /**
   * `.panel.felt` (`primitives.module.css`) is the night mirror of the parchment islands: it
   * re-declares its own `--bg` (`#0c2226`, not the theme's `#0b1020`) and `--ink-muted`
   * (`#a3bab5`, not `#9aa4c0`) so the felt stays night-side under either theme — but that means the
   * `night` palette's pairs, asserted against `#0b1020` above, do not actually cover it. Same loop,
   * against its own ground instead of a theme's.
   */
  it('keeps the night island at AA on its own felt', () => {
    const tokens = FELT
    expect(Object.keys(tokens).length, '.panel.felt declares a palette').toBeGreaterThan(3)
    const bg = tokens['--bg']!
    for (const ink of ['--ink', '--ink-muted', '--gold', '--red', '--teal']) {
      const hex = tokens[ink]
      if (hex === undefined) continue // the island only re-declares what it actually spends
      const key = `.panel.felt ${ink} on --bg`
      if (key in BELOW_AA) continue
      const ratio = contrast(hex, bg)
      expect(ratio, `${key} — ${hex} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
    }
  })

  it('still fails on exactly the pairs on record, and no worse than recorded', () => {
    for (const [key, recorded] of Object.entries(BELOW_AA)) {
      const [name, fg, , bg] = key.split(' ') as [string, string, string, string]
      const palette = ALL_PALETTES[name]!
      const ratio = contrast(palette[fg]!, palette[bg]!)
      expect(ratio, `${key} reaches AA now — delete its line from BELOW_AA`).toBeLessThan(AA)
      expect(ratio, `${key} got worse than the ${recorded}:1 on record`).toBeGreaterThanOrEqual(recorded - 0.005)
    }
  })

  it('rarity tokens reach AA (4.5:1) against --bg-elev in every theme', () => {
    const rarityTokens = ['--rarity-common', '--rarity-rare', '--rarity-epic']
    for (const [name, palette] of Object.entries(PALETTES)) {
      if (!('--bg-elev' in palette)) continue // only palettes with bg-elev
      for (const token of rarityTokens) {
        expect(palette[token], `${name} ${token}`).toMatch(/^#[0-9a-f]{6}$/)
        const ratio = contrast(palette[token]!, palette['--bg-elev']!)
        expect(ratio, `${name} ${token} on --bg-elev — ${palette[token]} on ${palette['--bg-elev']} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
      }
    }
  })
})

// --------------------------------------------------------------------------- the red split

/** Every stylesheet the kit ships: the split is held across all of them, not only the ones that spend red today. */
const KIT_SHEETS: Record<string, string> = {
  'theme/tokens.css': CSS,
  'theme/global.css': GLOBAL_CSS,
  'primitives/primitives.module.css': PRIMITIVES_CSS,
  'lobby/lobby.module.css': LOBBY_CSS,
  'screens/screens.module.css': SCREENS_CSS,
  'table/table.module.css': TABLE_CSS,
  'avatar2d/avatar2d.module.css': AVATAR2D_CSS,
}

describe('the red split: --red is the ink, --red-fill the paint', () => {
  /**
   * Value by value. The ink is the old red lifted along its own hue (355.6°, was 356°) until it reads on the dark
   * ground — 6.23:1 on `--bg`, 5.60 on `--bg-elev`, 5.43 on the felt panel's own `--bg`. The light theme's red and
   * the paper islands' already read (6.09:1 on the light `--bg`, 5.83 on the darker paper) and stay as they were.
   *
   * `--red-fill` takes the value `--red` had, palette by palette and island by island, so nothing painted with it
   * moves by a pixel: the fold button, "Rời phòng", the sign-out confirmation, a closed connection's dot, the
   * urgent timer's ring, every red rule and border.
   */
  it('pins the pair in every palette and island', () => {
    const island = (css: string, selector: RegExp): [string | undefined, string | undefined] => {
      const tokens = tokensOf(css, selector)
      return [tokens['--red'], tokens['--red-fill']]
    }
    expect({
      dark: [dark['--red'], dark['--red-fill']],
      light: [light['--red'], light['--red-fill']],
      night: [NIGHT_BLOCK['--red'], NIGHT_BLOCK['--red-fill']],
      '.panel.felt': [FELT['--red'], FELT['--red-fill']],
      ...Object.fromEntries(ISLANDS.map(({ name, css, selector }) => [name, island(css, selector)])),
    }).toEqual({
      dark: ['#e0737b', '#c8323c'],
      light: ['#a9242d', '#a9242d'],
      night: ['#e0737b', '#c8323c'],
      '.panel.felt': ['#e0737b', '#c8323c'],
      '.ticket': ['#a9242d', '#a9242d'],
      '.panel.parchment': ['#a9242d', '#a9242d'],
    })
    expect(contrast(dark['--red']!, dark['--bg']!)).toBeCloseTo(6.23, 2)
    expect(contrast(dark['--red']!, dark['--bg-elev']!)).toBeCloseTo(5.6, 2)
    expect(contrast(FELT['--red']!, FELT['--bg']!)).toBeCloseTo(5.43, 2)
    expect(contrast(light['--red']!, light['--bg']!)).toBeCloseTo(6.09, 2)
    expect(contrast(island(LOBBY_CSS, /^\.ticket$/)[0]!, PAPER)).toBeCloseTo(5.83, 2)
  })

  /**
   * `--red-fill` is not read, it is seen: a button's ground, a dot, a ring, a rule. WCAG 1.4.11 asks 3:1 of it
   * against what it is painted on — which is why it can keep the deep lacquer value the ink had to give up — and the
   * label on a destructive button (`--red-ink`, which no island re-declares) still asks 4.5:1 of it.
   */
  it('keeps --red-fill at 3:1 against every ground it is painted on, and under its label at AA', () => {
    const grounds: [string, string | undefined, string, string | undefined][] = [
      ...Object.entries(PALETTES).flatMap(([name, p]): [string, string | undefined, string, string | undefined][] => [
        [`${name} on --bg`, p['--red-fill'], p['--bg']!, p['--red-ink']],
        [`${name} on --bg-elev`, p['--red-fill'], p['--bg-elev']!, p['--red-ink']],
      ]),
      ['.panel.felt on its own --bg', FELT['--red-fill'], FELT['--bg']!, FELT['--red-ink']],
      ...ISLANDS.map(({ name, css, selector }): [string, string | undefined, string, string | undefined] => {
        const tokens = tokensOf(css, selector)
        return [`${name} on the darker end of its paper`, tokens['--red-fill'], PAPER, tokens['--red-ink'] ?? light['--red-ink']]
      }),
    ]
    for (const [where, fill, ground, label] of grounds) {
      expect(fill, `${where}: --red-fill is declared`).toMatch(HEX)
      const seen = contrast(fill!, ground)
      expect(seen, `${where} — ${fill} on ${ground} is ${seen.toFixed(2)}:1`).toBeGreaterThanOrEqual(NON_TEXT)
      const read = contrast(label!, fill!)
      expect(read, `${where} — the label ${label} on ${fill} is ${read.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
    }
  })

  /**
   * An ink reads `--red`, everything painted reads `--red-fill`. A fill left on `--red` would quietly turn pink on
   * the dark ground (and lose its label's contrast); an ink moved onto `--red-fill` would fall back to 3.6:1.
   */
  it('spends --red only as ink and --red-fill only as paint, in every sheet the kit ships', () => {
    for (const [file, css] of Object.entries(KIT_SHEETS)) {
      const painted = declarationsUsing(css, '--red').filter((d) => d.property !== 'color')
      expect(painted.map((d) => `${d.selector} { ${d.property}: ${d.value} }`), `${file}: a fill or rule on the ink — use var(--red-fill)`).toEqual([])
      const read = declarationsUsing(css, '--red-fill').filter((d) => d.property === 'color')
      expect(read.map((d) => `${d.selector} { color: ${d.value} }`), `${file}: an ink on the fill — use var(--red)`).toEqual([])
    }
  })
})

describe('the night surface', () => {
  /**
   * `night` above is this block read over the dark root, so a red the block forgot would pass as the dark root's —
   * but under the light theme the felt would get the light root's instead. The block declares both itself.
   *
   * It also sets `color`. Re-declaring `--ink` alone left the text that merely inherits — the names on the result
   * card — in the page's own colour: under the light theme, its dark ink on a night card, about 1.1:1.
   */
  it('declares the red pair itself, and its own text colour', () => {
    expect(NIGHT_BLOCK['--red'], 'the night block declares --red').toMatch(HEX)
    expect(NIGHT_BLOCK['--red-fill'], 'the night block declares --red-fill').toMatch(HEX)
    expect(NIGHT_BLOCK.color, 'the night block sets color').toBe('var(--ink)')
  })
})

// --------------------------------------------------------------------------- badges

/**
 * A badge's text is 12 px at weight 600 — not large text, so it needs 4.5:1, and it sits on its own tint laid over
 * whatever is under the badge. The tint is translucent (an `rgba` token, or `color-mix(… N%, transparent)`), so the
 * ground it is measured against is the composite, not the page. On the table `table.module.css` swaps the tint for
 * an opaque one mixed out of the badge's own ink and the night ground, so a seat's badge reads the same on the felt
 * and where it hangs past it onto the page.
 */
describe('badge text', () => {
  const TONES = ['gold', 'red', 'teal', 'muted'] as const
  const rule = (tone: string): Record<string, string> => declarationsOf(PRIMITIVES_CSS, new RegExp(`^\\.badge\\.${tone}$`))
  const TABLE_TINT = declarationsOf(TABLE_CSS, /^\.seat \.tags > :not\(\.bet\)$/)['background-color']

  interface Ground {
    where: string
    palette: Record<string, string>
    /** Under the badge: a token of `palette`, or a literal paper colour. */
    ground: string
    /** The badge's tint, when something other than its own `background` paints it. */
    tint?: string
  }

  const islandOver = (theme: 'dark' | 'light', css: string, selector: RegExp): Record<string, string> => ({
    ...THEME_PALETTES[theme],
    ...declarationsOf(css, selector),
  })

  const GROUNDS: Ground[] = [
    ...(['dark', 'light', 'night'] as const).flatMap((theme): Ground[] => [
      { where: `${theme} on --bg`, palette: THEME_PALETTES[theme], ground: 'var(--bg)' },
      { where: `${theme} on --bg-elev`, palette: THEME_PALETTES[theme], ground: 'var(--bg-elev)' },
    ]),
    ...(['dark', 'light'] as const).flatMap((theme): Ground[] => [
      ...ISLANDS.flatMap(({ name, css, selector }): Ground[] => [
        { where: `${name} (${theme} theme) on the paper's top`, palette: islandOver(theme, css, selector), ground: PAPER_TOP },
        { where: `${name} (${theme} theme) on the paper's bottom`, palette: islandOver(theme, css, selector), ground: PAPER },
      ]),
      { where: `.panel.felt (${theme} theme) on its --bg`, palette: islandOver(theme, PRIMITIVES_CSS, /^\.panel\.felt$/), ground: 'var(--bg)' },
    ]),
    { where: 'a seat on the table (night, opaque tint)', palette: THEME_PALETTES.night, ground: 'var(--bg)', tint: TABLE_TINT },
  ]

  /**
   * Badges on record below AA, with the ratio measured when they were recorded — asserted both ways, like `BELOW_AA`.
   *
   * `.panel.felt` keeps the night palette's teal, `#3f938a`, which even as plain ink is only 4.52:1 on the panel's own
   * ground; drawn 17 % toward `--ink` and set on its own teal tint it reaches 4.45. No screen prints a badge on a
   * felt panel — no screen uses the panel at all — so the share the page, the panels, the paper and the table are
   * held to stays, and this is on record until the felt gets a teal of its own.
   */
  const BADGES_BELOW_AA: Record<string, number> = {
    '.badge.teal, .panel.felt (dark theme) on its --bg': 4.45,
    '.badge.teal, .panel.felt (light theme) on its --bg': 4.45,
  }

  it('reads the table’s opaque tint out of its stylesheet', () => {
    expect(TABLE_TINT).toMatch(/^color-mix\(in srgb, currentColor \d+%, var\(--bg\)\)$/)
  })

  it('clears AA on its own tint, wherever a badge is printed, except the badges on record', () => {
    const seen = new Set<string>()
    for (const tone of TONES) {
      const { color, background } = rule(tone)
      expect(color, `.badge.${tone} has a color`).toBeDefined()
      for (const { where, palette, ground, tint } of GROUNDS) {
        const ink = parseColor(color!, palette)
        expect(ink[3], `.badge.${tone} ink is opaque`).toBe(1)
        const under = toHex(parseColor(ground, palette))
        const behind = over(parseColor(tint ?? background!, palette, ink), under)
        const ratio = contrast(toHex(ink), behind)
        const key = `.badge.${tone}, ${where}`
        const recorded = BADGES_BELOW_AA[key]
        if (recorded === undefined) {
          expect(ratio, `${key}: ${toHex(ink)} on ${behind} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
          continue
        }
        seen.add(key)
        expect(ratio, `${key} reaches AA now — delete its line from BADGES_BELOW_AA`).toBeLessThan(AA)
        expect(ratio, `${key} got worse than the ${recorded}:1 on record`).toBeGreaterThanOrEqual(recorded - 0.005)
      }
    }
    expect([...seen].sort(), 'every badge on record is one the test still measures').toEqual(Object.keys(BADGES_BELOW_AA).sort())
  })
})
