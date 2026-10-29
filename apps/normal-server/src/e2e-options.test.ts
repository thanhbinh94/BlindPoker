import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadChaosCatalogue } from './chaos/chaos-catalogue.js'
import { packageRoot } from './db/migrate.js'
import { chaosCardsFromEnv, readRateLimitFromEnv } from './e2e-options.js'

describe('readRateLimitFromEnv — the e2e server keeps the shipped read limit unless asked', () => {
  it('leaves the read limit alone when E2E_READ_LIMIT is unset, empty or zero', () => {
    expect(readRateLimitFromEnv({})).toEqual({})
    expect(readRateLimitFromEnv({ E2E_READ_LIMIT: '' })).toEqual({})
    expect(readRateLimitFromEnv({ E2E_READ_LIMIT: '0' })).toEqual({})
  })

  it('raises the per-address read bucket to the given count a minute', () => {
    expect(readRateLimitFromEnv({ E2E_READ_LIMIT: '2400' })).toEqual({ readRateLimit: { limit: 2400, windowMs: 60_000 } })
  })

  it('ignores a value that is not a positive whole number', () => {
    expect(readRateLimitFromEnv({ E2E_READ_LIMIT: 'lots' })).toEqual({})
    expect(readRateLimitFromEnv({ E2E_READ_LIMIT: '-5' })).toEqual({})
    expect(readRateLimitFromEnv({ E2E_READ_LIMIT: '2.5' })).toEqual({})
  })
})

describe('chaosCardsFromEnv — the ops pack lays its changes over the shipped chaos cards', () => {
  const files = (map: Record<string, string>) => (path: string): string => {
    const hit = Object.entries(map).find(([name]) => path.endsWith(name))
    if (hit === undefined) throw new Error(`ENOENT ${path}`)
    return hit[1]
  }

  it('keeps the shipped file when E2E_CHAOS_CARDS is unset or empty', () => {
    expect(chaosCardsFromEnv({})).toEqual({})
    expect(chaosCardsFromEnv({ E2E_CHAOS_CARDS: '' })).toEqual({})
  })

  it("starts Cá chép at the file's energy and turns it off, leaving every other card as shipped", () => {
    const shipped = loadChaosCatalogue()
    const read = files({ 'ops.json': JSON.stringify({ d_carp: { enabled: false, params: { energy0: 100 } } }) })
    const { chaosCatalogue } = chaosCardsFromEnv({ E2E_CHAOS_CARDS: 'ops.json' }, () => shipped, read)
    expect(chaosCatalogue).toHaveLength(shipped.length)
    const carp = chaosCatalogue!.find((c) => c.id === 'd_carp')!
    const before = shipped.find((c) => c.id === 'd_carp')!
    expect(carp.enabled).toBe(false)
    expect(carp.params).toEqual({ ...before.params, energy0: 100 })
    expect(chaosCatalogue!.filter((c) => c.id !== 'd_carp')).toEqual(shipped.filter((c) => c.id !== 'd_carp'))
  })

  it('the ops pack\'s own file is one the catalogue accepts', () => {
    const { chaosCatalogue } = chaosCardsFromEnv({ E2E_CHAOS_CARDS: resolve(packageRoot(), '..', 'normal-web', 'e2e', 'ops', 'chaos-cards.ops.json') })
    const carp = chaosCatalogue!.find((c) => c.id === 'd_carp')!
    expect(carp).toMatchObject({ enabled: false, params: expect.objectContaining({ energy0: 100 }) })
  })

  it('refuses an unknown card, a file that is not JSON, and changes the catalogue check refuses', () => {
    const shipped = loadChaosCatalogue()
    expect(() => chaosCardsFromEnv({ E2E_CHAOS_CARDS: 'a.json' }, () => shipped, files({ 'a.json': '{"d_nope":{}}' }))).toThrow(/not a chaos card: d_nope/)
    expect(() => chaosCardsFromEnv({ E2E_CHAOS_CARDS: 'b.json' }, () => shipped, files({ 'b.json': 'nope' }))).toThrow(/E2E_CHAOS_CARDS .*b\.json/)
    const allDiamondsOff = Object.fromEntries(shipped.filter((c) => c.tier === 'diamond').map((c) => [c.id, { enabled: false }]))
    expect(() => chaosCardsFromEnv({ E2E_CHAOS_CARDS: 'c.json' }, () => shipped, files({ 'c.json': JSON.stringify(allDiamondsOff) }))).toThrow(/diamond has 0 enabled cards/)
  })

  it('refuses an entry that is not an object, or whose enabled or params is the wrong kind, naming the file and the card', () => {
    const shipped = loadChaosCatalogue()
    const refused = (body: string) => () => chaosCardsFromEnv({ E2E_CHAOS_CARDS: 'd.json' }, () => shipped, files({ 'd.json': body }))
    expect(refused('{"d_carp":null}')).toThrow(/E2E_CHAOS_CARDS .*d\.json: d_carp: expected an object/)
    expect(refused('{"d_carp":[1]}')).toThrow(/d\.json: d_carp: expected an object/)
    expect(refused('{"d_carp":{"enabled":"yes"}}')).toThrow(/d\.json: d_carp\.enabled/)
    expect(refused('{"d_carp":{"params":null}}')).toThrow(/d\.json: d_carp\.params/)
  })
})
