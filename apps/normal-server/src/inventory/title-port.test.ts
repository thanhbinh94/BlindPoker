import { describe, expect, it } from 'vitest'
import type { PlayerRow } from '../repos/player-repo.js'
import { createTitlePort } from './title-port.js'

function portWith(rows: Record<string, string | null>) {
  return createTitlePort({
    findByIdFull: (id) =>
      Promise.resolve(id in rows ? ({ playerId: id, equippedTitle: rows[id] ?? null } as PlayerRow) : null),
  })
}

describe('createTitlePort', () => {
  it('maps the three Thần titles', async () => {
    const port = portWith({ a: 'title_god', b: 'title_demigod', c: 'title_godslayer' })
    expect(await port.equippedTitle('a')).toBe('god')
    expect(await port.equippedTitle('b')).toBe('demigod')
    expect(await port.equippedTitle('c')).toBe('godslayer')
  })

  it('other titles and none are null', async () => {
    const port = portWith({ a: 'title_devoted', b: null, c: 'toString', d: '' })
    expect(await port.equippedTitle('a')).toBeNull()
    expect(await port.equippedTitle('b')).toBeNull()
    expect(await port.equippedTitle('c')).toBeNull()
    expect(await port.equippedTitle('d')).toBeNull()
  })

  it('a missing player is null', async () => {
    expect(await portWith({}).equippedTitle('nobody')).toBeNull()
  })
})
