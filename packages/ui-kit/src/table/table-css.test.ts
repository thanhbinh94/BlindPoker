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

describe('the seat at the foot of a short stage on its side (BP-39 gate, F-13e at 780 × 360)', () => {
  const FOOT = ".ring[data-frame='landscape'][data-tier='short'] .seat[data-half='bottom']:not([data-edge])"

  it('stands 2 px above the stage’s foot, so nothing in it may hang lower', () => {
    expect(ruleIn(TABLE_CSS, FOOT)).toMatch(/transform:\s*translate\(-50%,\s*calc\(-100%\s*-\s*2px\)\)/)
  })

  it('its payout fades in where it stands: no keyframe moves it (riseUp put it 6 px past the foot and the stage scrolled)', () => {
    expect(ruleIn(TABLE_CSS, `${FOOT} .payout`)).toMatch(/animation-name:\s*payoutFade/)
    const fade = /@keyframes\s+payoutFade\s*\{([\s\S]*?)\n\}/.exec(TABLE_CSS)?.[1] ?? ''
    expect(fade).toMatch(/opacity:\s*0/)
    expect(fade).not.toMatch(/transform|translate|scale|rotate|top|bottom|margin/)
    // elsewhere the payout still rises
    expect(ruleIn(TABLE_CSS, '.payout')).toMatch(/animation:\s*riseUp/)
    // and with motion off it does not even fade: the reduced-motion list names this selector too (the same specificity, later)
    const off = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(TABLE_CSS)?.[1] ?? ''
    expect(off).toContain(`${FOOT} .payout,`)
  })

  it('its chaos cards’ hands-left count hangs 3 px under the icon, not 6, and ends inside the seat', () => {
    expect(ruleIn(TABLE_CSS, '.chaosLeft')).toMatch(/bottom:\s*-6px/)
    expect(ruleIn(TABLE_CSS, `${FOOT} .chaosLeft`)).toMatch(/bottom:\s*-3px/)
  })
})

describe('desktop table CSS (BP-31 P7, P10)', () => {
  it('the tray is capped at 980 px and centred; the controls row is centred, not capped', () => {
    expect(ruleIn(TABLE_CSS, ".tray:not([data-frame='landscape']):not([data-between])")).toMatch(CAP)
    // between hands the stack's tray sits in the dock's row: stretched to the row's width it left the dock none
    expect(ruleIn(TABLE_CSS, ".tray[data-layout='stack'][data-between]")).toMatch(/flex:\s*none/)
    expect(ruleIn(TABLE_CSS, ".tray[data-layout='stack'][data-between]")).not.toMatch(/width/)
    // a 980 px cap on the controls wrapped the pre-hand hint at 1280–1536 px and pushed the stage 12 px (final wave)
    expect(ruleIn(SCREENS_CSS, '.controls')).not.toMatch(/max-width/)
    expect(ruleIn(SCREENS_CSS, '.controls')).toMatch(/justify-content:\s*center/)
    // the footer itself stays full width: the landscape corners are placed against the room
    expect(ruleIn(SCREENS_CSS, '.roomFoot')).not.toMatch(/max-width/)
  })

  it('the dock’s labels wrap to two lines inside their buttons instead of being cut with "…" (final wave)', () => {
    const button = ruleIn(SCREENS_CSS, ".room[data-layout='stack'] .dock > button")
    expect(button).not.toBe('')
    expect(button).not.toMatch(/nowrap|ellipsis|overflow:\s*hidden/)
    expect(button).toMatch(/white-space:\s*normal/)
    expect(button).toMatch(/line-height:\s*1\.1/)
    expect(button).toMatch(/text-wrap:\s*balance/)
    expect(button).toMatch(/font-size:\s*0\.8125rem/)
    const toggle = ruleIn(TABLE_CSS, ".tray[data-layout='stack'][data-between] .preToggle")
    expect(toggle).toMatch(/white-space:\s*normal/)
    expect(toggle).toMatch(/line-height:\s*1\.1/)
    expect(toggle).toMatch(/font-size:\s*0\.8125rem/)
    // two lines, not one 100 px line that left "Hủy sẵn sàng" three lines deep beside it
    expect(toggle).toMatch(/max-width:\s*6em/)
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
    // the wider floors come after the base ring rules (94 px from 7 seats) they override; 118 wins on specificity
    // (0,3,0 vs 0,2,0)
    expect(TABLE_CSS.indexOf(desk)).toBeGreaterThan(TABLE_CSS.indexOf('--seat-min: 94px'))
    // the seat's width still reads the floor; the ring's points (geometry.ts) are untouched by it
    expect(ruleIn(TABLE_CSS, '.ring .seat')).toMatch(/min-width:\s*var\(--seat-min,\s*104px\)/)
    expect(ruleIn(TABLE_CSS, ".ring:is([data-seats='7'], [data-seats='8'], [data-seats='9']) .seat:not(.seatMe) .seatCaption")).toMatch(
      /display:\s*none/,
    )
  })
})
