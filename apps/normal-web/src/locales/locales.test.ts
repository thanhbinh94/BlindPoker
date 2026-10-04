import { describe, expect, it } from 'vitest'
// The catalogue the server actually loads, read straight from its data directory. This is the whole point of
// the test: the strings live here and the ids live there, and a new item or achievement must not ship as a
// raw key on a wardrobe tile. It is the only thing `normal-web` ever reads out of `normal-server`, it is data
// rather than code, and it never reaches the bundle — this file is a test.
import achievementDefs from '../../../normal-server/data/achievements.json'
import itemDefs from '../../../normal-server/data/items.json'
import en from './en/normal.json'
import vi from './vi/normal.json'

/** Every dotted leaf, so a key added to one language alone fails the build. */
function leaves(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix]
  return Object.entries(node).flatMap(([key, value]) => leaves(value, prefix === '' ? key : `${prefix}.${key}`))
}

const bundles: [string, typeof vi | typeof en][] = [
  ['vi', vi],
  ['en', en],
]

describe('normal locales', () => {
  it('declares every key in both languages', () => {
    expect(leaves(en).sort()).toEqual(leaves(vi).sort())
  })

  it('leaves no value empty', () => {
    for (const [, bundle] of bundles) expect(JSON.stringify(bundle)).not.toContain('""')
  })

  it.each(bundles)('names every catalogue item in %s', (_lang, bundle) => {
    const named = bundle.items as Record<string, string | undefined>
    expect(itemDefs.length).toBe(89)
    for (const def of itemDefs) expect(named[def.id], `items.${def.id}`).toBeTypeOf('string')
    // …and nothing more: a string for an id the server does not serve is a name nobody will ever read.
    expect(Object.keys(named).sort()).toEqual(itemDefs.map((d) => d.id).sort())
  })

  it.each(bundles)('names and describes every achievement in %s', (_lang, bundle) => {
    const named = bundle.achievements as Record<string, { name?: string; desc?: string } | undefined>
    expect(achievementDefs.length).toBe(34)
    for (const def of achievementDefs) {
      expect(named[def.id]?.name, `achievements.${def.id}.name`).toBeTypeOf('string')
      expect(named[def.id]?.desc, `achievements.${def.id}.desc`).toBeTypeOf('string')
    }
    // `ui` is the achievements *screen*'s own chrome — headings, the summary line, the reward label — and is
    // the one key under here that is not an achievement id. Everything else still has to be one.
    expect(Object.keys(named).filter((key) => key !== 'ui').sort()).toEqual(achievementDefs.map((d) => d.id).sort())
  })
})
