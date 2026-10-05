import { AA, NON_TEXT, THEME_PALETTES, contrast, declarationsOf, declarationsUsing, over, parseColor, placeholderColour, toHex, tokensOf } from '@bp/ui-kit/testing'
import { describe, expect, it } from 'vitest'
import LITE_CSS from './lite.module.css?raw'

/**
 * Lite's name prompt is a ticket — printed paper whatever the page is doing, like the lobby's tickets in the kit —
 * and `.ticket` re-declares the light inks it spends on a paper gradient of its own. The kit's theme test cannot see
 * this stylesheet, so the island is held here, through the kit's own contrast arithmetic (`@bp/ui-kit/testing`).
 */

/** The ticket's paper: `linear-gradient(172deg, #fbf7ee 0%, #f0e9d9 100%)`, its two ends. */
const PAPER = { top: '#fbf7ee', bottom: '#f0e9d9' } as const

const TICKET = tokensOf(LITE_CSS, /^\.ticket$/)
/** The ticket's palette as it is in effect under each theme: what it re-declares, over what it inherits. */
const ticketUnder = (theme: 'dark' | 'light'): Record<string, string> => ({ ...THEME_PALETTES[theme], ...declarationsOf(LITE_CSS, /^\.ticket$/) })

describe('the Lite ticket (parchment island)', () => {
  it('declares a palette of its own', () => {
    expect(Object.keys(TICKET).length).toBeGreaterThan(3)
  })

  it('prints every ink it declares at AA on both ends of its paper', () => {
    for (const ink of ['--ink', '--ink-muted', '--gold', '--red']) {
      const hex = TICKET[ink]
      expect(hex, `.ticket declares ${ink}`).toMatch(/^#[0-9a-f]{6}$/)
      for (const [end, paper] of Object.entries(PAPER)) {
        const ratio = contrast(hex!, paper)
        expect(ratio, `${ink} ${hex} on the paper's ${end} ${paper} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
      }
    }
  })

  /**
   * The island re-declares `--red`, so it re-declares `--red-fill` beside it: the notice's rule reads `--red-fill`,
   * and an island that forgot it would draw that rule in the theme's — the dark theme's `#c8323c` on paper.
   */
  it('gives its fills and rules its own deep red, at 3:1, and its focus ring 3:1', () => {
    expect(TICKET['--red-fill'], '.ticket declares --red-fill, the same red as its ink').toBe(TICKET['--red'])
    for (const token of ['--red-fill', '--focus']) {
      const ratio = contrast(TICKET[token]!, PAPER.bottom)
      expect(ratio, `${token} ${TICKET[token]} on ${PAPER.bottom} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(NON_TEXT)
    }
  })

  it('labels its gold button at AA', () => {
    const ratio = contrast(TICKET['--gold-ink']!, TICKET['--gold']!)
    expect(ratio, `--gold-ink on --gold is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
  })

  it('prints the stub and the notice at AA', () => {
    const stub = declarationsOf(LITE_CSS, /^\.stub$/)
    const stubRatio = contrast(stub.color!, stub['background-color']!)
    expect(stubRatio, `the stub's ${stub.color} on ${stub['background-color']} is ${stubRatio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)

    const tint = parseColor(declarationsOf(LITE_CSS, /^\.notice$/).background!, {})
    const behind = over(tint, PAPER.bottom)
    const noticeRatio = contrast(TICKET['--ink']!, behind)
    expect(noticeRatio, `the notice's ink on ${behind} is ${noticeRatio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
  })

  /**
   * The name field is a translucent white over the paper, and its placeholder a share of `--ink-muted` — at 76 % it
   * was 3.44:1 on the darker end. A placeholder is text, and the one a first-time player reads to learn what to type;
   * it is held in any engine (Firefox draws a placeholder at opacity 0.54 unless the rule says otherwise).
   */
  it('prints the name field’s placeholder at AA, on either end of the paper and under either theme', () => {
    const field = declarationsOf(LITE_CSS, /^\.input$/).background!
    const placeholder = declarationsOf(LITE_CSS, /^\.input::placeholder$/)
    for (const theme of ['dark', 'light'] as const) {
      const palette = ticketUnder(theme)
      for (const [end, paper] of Object.entries(PAPER)) {
        const ground = over(parseColor(field, palette), paper)
        const text = over(placeholderColour(placeholder, palette), ground)
        const ratio = contrast(text, ground)
        expect(ratio, `${theme}: the placeholder ${text} on the field ${ground} (paper's ${end}) is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
      }
    }
  })
})

describe('the red split in lite.module.css', () => {
  /** An ink reads `--red`; a fill, a rule or a dot reads `--red-fill` (see the kit's `tokens.test.ts`). */
  it('spends --red only as ink and --red-fill only as paint', () => {
    const painted = declarationsUsing(LITE_CSS, '--red').filter((d) => d.property !== 'color')
    expect(painted.map((d) => `${d.selector} { ${d.property}: ${d.value} }`), 'a fill or rule on the ink — use var(--red-fill)').toEqual([])
    const read = declarationsUsing(LITE_CSS, '--red-fill').filter((d) => d.property === 'color')
    expect(read.map((d) => `${d.selector} { color: ${d.value} }`), 'an ink on the fill — use var(--red)').toEqual([])
  })

  it('keeps the closed connection dot and the alert rule the colour they were', () => {
    // `--red-fill` is the old `--red`, palette by palette, so the paint does not move.
    expect(toHex(parseColor('var(--red-fill)', THEME_PALETTES.dark))).toBe('#c8323c')
    expect(toHex(parseColor('var(--red-fill)', THEME_PALETTES.light))).toBe('#a9242d')
  })
})
