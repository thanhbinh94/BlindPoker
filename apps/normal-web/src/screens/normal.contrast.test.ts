import { AA, THEME_PALETTES, contrast, declarationsOf, declarationsUsing, over, parseColor, toHex } from '@bp/ui-kit/testing'
import { describe, expect, it } from 'vitest'
import AVATAR_CSS from '../avatar/avatar.module.css?raw'
import NORMAL_CSS from './normal.module.css?raw'
import WARDROBE_CSS from './wardrobe/wardrobe.module.css?raw'

/**
 * Normal's own stylesheets against the kit's palettes, through the kit's contrast arithmetic (`@bp/ui-kit/testing`).
 * The kit's `tokens.test.ts` holds the tokens; these hold what this app composes out of them.
 */

describe('the text field’s placeholder', () => {
  /**
   * The sign-in card's fields (e-mail, display name) and the profile's name field are `.input`: an opaque `--bg`
   * with a placeholder in a share of `--ink-muted`. At 76 % that share was 3.29:1 in the light theme. A placeholder is
   * text — on the sign-in card, the only hint of what a field wants before anything is typed.
   */
  it('reaches AA on the field in either theme', () => {
    const field = declarationsOf(NORMAL_CSS, /^\.input$/).background!
    const placeholder = declarationsOf(NORMAL_CSS, /^\.input::placeholder$/).color!
    for (const theme of ['dark', 'light'] as const) {
      const ground = toHex(parseColor(field, THEME_PALETTES[theme]))
      const text = over(parseColor(placeholder, THEME_PALETTES[theme]), ground)
      const ratio = contrast(text, ground)
      expect(ratio, `${theme}: the placeholder ${text} on the field ${ground} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
    }
  })
})

describe('the red split in Normal’s stylesheets', () => {
  /**
   * An ink reads `--red` (the password error, a loss in the ledger); a fill, a rule or a dot reads `--red-fill`
   * (the closed connection's dot, the alert's rule), which is the old `--red` palette by palette — see the kit's
   * `tokens.test.ts`.
   */
  it('spends --red only as ink and --red-fill only as paint', () => {
    for (const [file, css] of Object.entries({ 'normal.module.css': NORMAL_CSS, 'wardrobe.module.css': WARDROBE_CSS, 'avatar.module.css': AVATAR_CSS })) {
      const painted = declarationsUsing(css, '--red').filter((d) => d.property !== 'color')
      expect(painted.map((d) => `${d.selector} { ${d.property}: ${d.value} }`), `${file}: a fill or rule on the ink — use var(--red-fill)`).toEqual([])
      const read = declarationsUsing(css, '--red-fill').filter((d) => d.property === 'color')
      expect(read.map((d) => `${d.selector} { color: ${d.value} }`), `${file}: an ink on the fill — use var(--red)`).toEqual([])
    }
  })
})
