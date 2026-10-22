/**
 * The rank beside a name (Plan 27, spec §2 A4): each `--rank-N` is ink — 11 px text, the word or the roman numeral —
 * so it needs 4.5:1 wherever it is printed. On the table that is the seat plate, a navy gradient laid over the felt
 * (and, where a rim seat hangs past the felt, over the page's night ground); off the table it is the page and a raised
 * panel in either theme — the lobby's player bar, the GM's member list, the "Mời ra" dialog.
 */
import { describe, expect, it } from 'vitest'
import TABLE_CSS from '../table/table.module.css?raw'
import { AA, THEME_PALETTES, contrast, declarationsOf, over, parseColor, toHex } from './contrast.js'

const RANKS = ['--rank-2', '--rank-3', '--rank-4', '--rank-5'] as const

/** The plate's background: `linear-gradient(180deg, A, B)` — its two stops, translucent. */
function plateStops(): string[] {
  const background = declarationsOf(TABLE_CSS, /^\.plate$/).background ?? ''
  const m = /^linear-gradient\(180deg, (rgba\([^)]*\)), (rgba\([^)]*\))\)$/.exec(background)
  if (m === null) throw new Error(`.plate is no longer a two-stop gradient: ${background}`)
  return [m[1]!, m[2]!]
}

describe('rank ink', () => {
  const night = THEME_PALETTES.night

  it('reads the plate’s gradient out of its stylesheet', () => {
    expect(plateStops()).toHaveLength(2)
  })

  it('declares every rank in each palette as an opaque colour', () => {
    for (const theme of ['dark', 'light', 'night'] as const) {
      for (const token of RANKS) expect(THEME_PALETTES[theme][token], `${theme} ${token}`).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('clears AA on the seat plate, over the felt and over the night page', () => {
    for (const ground of ['var(--felt)', 'var(--bg)']) {
      const under = toHex(parseColor(ground, night))
      for (const stop of plateStops()) {
        const behind = over(parseColor(stop, night), under)
        for (const token of RANKS) {
          const ink = toHex(parseColor(`var(${token})`, night))
          const ratio = contrast(ink, behind)
          expect(ratio, `${token} ${ink} on the plate (${stop} over ${ground} = ${behind}) is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
        }
      }
    }
  })

  it('clears AA on the page and on a raised panel in both themes', () => {
    for (const theme of ['dark', 'light', 'night'] as const) {
      const palette = THEME_PALETTES[theme]
      for (const ground of ['--bg', '--bg-elev']) {
        const behind = toHex(parseColor(`var(${ground})`, palette))
        for (const token of RANKS) {
          const ink = toHex(parseColor(`var(${token})`, palette))
          const ratio = contrast(ink, behind)
          expect(ratio, `${theme} ${token} ${ink} on ${ground} ${behind} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
        }
      }
    }
  })

  it('colours the word and the pill by the token of their own rank', () => {
    for (const n of [2, 3, 4, 5]) {
      const rule = declarationsOf(TABLE_CSS, new RegExp(`^\\.rankLabel\\[data-rank='${n}'\\], \\.rankPill\\[data-rank='${n}'\\]$`))
      expect(rule.color, `rank ${n}`).toBe(`var(--rank-${n})`)
    }
  })
})
