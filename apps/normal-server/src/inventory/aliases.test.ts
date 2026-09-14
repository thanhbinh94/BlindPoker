import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { loadAliases, resolveItemId } from './aliases.js'

let scratch: string
let seq = 0

function fixture(content: unknown): string {
  scratch ??= mkdtempSync(join(tmpdir(), 'bp-aliases-'))
  seq += 1
  const path = join(scratch, `aliases-${seq}.json`)
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content), 'utf8')
  return path
}

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true })
})

describe('loadAliases', () => {
  it('reads the shipped aliases, and every old headwear/accessory id resolves to a current-looking id', () => {
    const aliases = loadAliases()
    expect(aliases.get('hat_crown')).toBe('head_crown_gold01')
    expect(aliases.get('accessory_glasses')).toBe('face_glasses_round_gold01')
    expect(aliases.get('ring_royal')).toBe('aura_gold_cards01')
    expect(aliases.size).toBeGreaterThan(0)
  })

  it('keeps only the non-null entries — a dropped id is simply absent from the map', () => {
    const aliases = loadAliases(fixture({ a: 'b', dropped: null }))
    expect(aliases.get('a')).toBe('b')
    expect(aliases.has('dropped')).toBe(false)
    expect(resolveItemId('dropped', aliases)).toBe('dropped')
    expect(resolveItemId('a', aliases)).toBe('b')
    expect(resolveItemId('never_aliased', aliases)).toBe('never_aliased')
  })

  it('refuses a value that is neither a string nor null', () => {
    expect(() => loadAliases(fixture({ a: 42 }))).toThrow(/a aliases to something other than a string or null/)
    expect(() => loadAliases(fixture({ a: '' }))).toThrow(/a aliases to something other than a string or null/)
  })

  it('refuses an id that aliases to itself', () => {
    expect(() => loadAliases(fixture({ a: 'a' }))).toThrow(/a aliases to itself/)
  })

  it('refuses a two-hop alias cycle', () => {
    expect(() => loadAliases(fixture({ a: 'b', b: 'a' }))).toThrow(/alias cycle: a -> b -> a/)
  })

  it('refuses a longer alias cycle', () => {
    expect(() => loadAliases(fixture({ a: 'b', b: 'c', c: 'a' }))).toThrow(/alias cycle/)
  })

  it('accepts a long chain that never loops back', () => {
    // Not a cycle: every hop lands on a fresh id, and the chain just ends.
    const aliases = loadAliases(fixture({ a: 'b', b: 'c', c: 'd' }))
    expect(aliases.get('a')).toBe('b')
  })

  it('refuses a malformed file', () => {
    expect(() => loadAliases(fixture([]))).toThrow(/not a JSON object/)
    expect(() => loadAliases(join(tmpdir(), 'bp-aliases-missing', 'nope.json'))).toThrow(/could not read item aliases/)
  })
})
