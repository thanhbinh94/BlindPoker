import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHAOS_CARDS_SPEC, CHAOS_TIERS } from '@bp/core'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultChaosCardsPath, loadChaosCatalogue } from './chaos-catalogue.js'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A copy of the shipped file in a temp directory, changed by `edit`; returns its path. */
function copyWith(edit: (cards: Record<string, unknown>[]) => unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'bp-chaos-cards-'))
  dirs.push(dir)
  const cards = JSON.parse(readFileSync(defaultChaosCardsPath(), 'utf8')) as Record<string, unknown>[]
  const path = join(dir, 'chaos-cards.json')
  writeFileSync(path, JSON.stringify(edit(cards)))
  return path
}

describe('data/chaos-cards.json', () => {
  it('loads the 47 cards of spec 2026-10-26 §5, all on, and equals the core fixture the other packages test against', () => {
    const cards = loadChaosCatalogue()
    expect(cards).toHaveLength(47)
    expect(cards.every((c) => c.enabled)).toBe(true)
    expect(cards).toEqual([...CHAOS_CARDS_SPEC])
    expect(JSON.parse(readFileSync(defaultChaosCardsPath(), 'utf8'))).toEqual(JSON.parse(JSON.stringify(CHAOS_CARDS_SPEC)))
    expect(CHAOS_TIERS.map((tier) => cards.filter((c) => c.tier === tier).length)).toEqual([18, 15, 14])
  })

  it('stops the boot on a broken copy, naming the file and the problem', () => {
    const unknownEffect = copyWith((cards) => cards.map((c, i) => (i === 3 ? { ...c, effect: 'teleport' } : c)))
    expect(() => loadChaosCatalogue(unknownEffect)).toThrow(new RegExp(`${unknownEffect.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}: invalid chaos catalogue: .*teleport`))

    const duplicate = copyWith((cards) => [...cards, cards[0]])
    expect(() => loadChaosCatalogue(duplicate)).toThrow(/duplicate id s_swap_one/)

    const fractional = copyWith((cards) => cards.map((c, i) => (i === 0 ? { ...c, params: { hands: 1.5 } } : c)))
    expect(() => loadChaosCatalogue(fractional)).toThrow(/params\.hands must be an integer/)

    const thin = copyWith((cards) => cards.map((c) => (c.tier === 'diamond' ? { ...c, enabled: false } : c)))
    expect(() => loadChaosCatalogue(thin)).toThrow(/diamond has 0 enabled cards/)
  })

  it('stops the boot on a file that is not there or not JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bp-chaos-cards-'))
    dirs.push(dir)
    expect(() => loadChaosCatalogue(join(dir, 'missing.json'))).toThrow(/could not read chaos catalogue .*missing\.json/)
    const junk = join(dir, 'junk.json')
    writeFileSync(junk, '{ not json')
    expect(() => loadChaosCatalogue(junk)).toThrow(/could not read chaos catalogue .*junk\.json/)
    const notArray = join(dir, 'object.json')
    writeFileSync(notArray, '{}')
    expect(() => loadChaosCatalogue(notArray)).toThrow(/object\.json: invalid chaos catalogue: expected an array/)
  })
})
