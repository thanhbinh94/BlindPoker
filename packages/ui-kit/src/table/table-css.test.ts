import { describe, expect, it } from 'vitest'
import SCREENS_CSS from '../screens/screens.module.css?raw'
import TABLE_CSS from './table.module.css?raw'

/** The body of the first rule whose selector list is exactly `sel` (whitespace-tolerant), or '' when there is none. */
const ruleIn = (css: string, sel: string): string => {
  const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')
  return new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
}

/** The text of the `@media` block opened by `query`, up to its closing brace. */
const mediaBlock = (css: string, query: string): string => {
  const start = css.indexOf(`@media ${query} {`)
  if (start < 0) return ''
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(start, i + 1)
    }
  }
  return ''
}

const CAP = /width:\s*100%;[\s\S]*max-width:\s*min\(980px,\s*100%\);[\s\S]*margin-inline:\s*auto/

describe('desktop table CSS (BP-31 P7, P10)', () => {
  it('the tray and the controls row are capped at 980 px and centred', () => {
    expect(ruleIn(TABLE_CSS, ".tray:not([data-frame='landscape']):not([data-between])")).toMatch(CAP)
    // between hands the stack's tray sits in the dock's row: stretched to the row's width it left the dock none
    expect(ruleIn(TABLE_CSS, ".tray[data-layout='stack'][data-between]")).toMatch(/flex:\s*none/)
    expect(ruleIn(TABLE_CSS, ".tray[data-layout='stack'][data-between]")).not.toMatch(/width/)
    expect(ruleIn(SCREENS_CSS, '.controls')).toMatch(CAP)
    // the footer itself stays full width: the landscape corners are placed against the room
    expect(ruleIn(SCREENS_CSS, '.roomFoot')).not.toMatch(/max-width/)
  })

  it('the landscape tray is not capped', () => {
    expect(ruleIn(TABLE_CSS, '.tray')).not.toMatch(/max-width/)
    for (const m of TABLE_CSS.matchAll(/([^{}]*\.tray\[data-frame='landscape'\][^{}]*)\{([^}]*)\}/g)) {
      expect(m[2], m[1]?.trim()).not.toMatch(/max-width:\s*min\(980px/)
    }
  })

  it('desktop ring seats are at least 132 px wide (118 px from 7 seats) and others\' captions hide from 7 seats', () => {
    const desk = mediaBlock(TABLE_CSS, '(min-width: 1024px)')
    expect(ruleIn(desk, ".ring:not([data-frame='landscape'])")).toMatch(/--seat-min:\s*132px/)
    expect(ruleIn(desk, ".ring:not([data-frame='landscape']):is([data-seats='7'], [data-seats='8'], [data-seats='9'])")).toMatch(
      /--seat-min:\s*118px/,
    )
    // the wider floors come after the base ring rules (94 px from 7 seats) they override, at equal specificity
    expect(TABLE_CSS.indexOf(desk)).toBeGreaterThan(TABLE_CSS.indexOf('--seat-min: 94px'))
    // the seat's width still reads the floor; the ring's points (geometry.ts) are untouched by it
    expect(ruleIn(TABLE_CSS, '.ring .seat')).toMatch(/min-width:\s*var\(--seat-min,\s*104px\)/)
    expect(ruleIn(TABLE_CSS, ".ring:is([data-seats='7'], [data-seats='8'], [data-seats='9']) .seat:not(.seatMe) .seatCaption")).toMatch(
      /display:\s*none/,
    )
  })
})
