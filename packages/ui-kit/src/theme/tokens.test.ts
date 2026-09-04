import { describe, expect, it } from 'vitest'
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
