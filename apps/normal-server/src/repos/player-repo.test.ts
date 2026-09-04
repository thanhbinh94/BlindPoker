import { displayNameKey } from '@bp/core'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AppDb } from '../db/client.js'
import { players, users } from '../db/schema.js'
import type { TestDb } from '../db/test-db.js'
import { createTestDb } from '../db/test-db.js'
import type { NormalRepositories } from './index.js'
import { createRepositories, DisplayNameTakenError, UnknownPlayerError } from './index.js'

let test: TestDb
let db: AppDb
let repos: NormalRepositories

let seq = 0

async function seedPlayer(displayName: string, balance = 0): Promise<string> {
  seq += 1
  const [user] = await db.insert(users).values({ email: `p${seq}@example.com`, passwordHash: 'argon2' }).returning({ id: users.id })
  const id = user!.id
  await db.insert(players).values({ id, displayName, nameKey: displayNameKey(displayName), balance })
  return id
}

async function reset(): Promise<void> {
  await db.execute(sql`truncate table game_players, games, point_transactions, players, users restart identity cascade`)
}

const MISSING = '00000000-0000-4000-8000-000000000000'

beforeAll(async () => {
  test = await createTestDb()
  db = test.db
  repos = createRepositories(db)
})
afterAll(async () => {
  await test.close()
})
afterEach(reset)

describe('players.findById', () => {
  it('returns the three fields server-kit asks for', async () => {
    const id = await seedPlayer('Người', 1234)
    expect(await repos.players.findById(id)).toEqual({ playerId: id, displayName: 'Người', balance: 1234 })
  })

  it('returns null for an id that is not there, and for one that is not a uuid', async () => {
    expect(await repos.players.findById(MISSING)).toBeNull()
    expect(await repos.players.findById('bot-1')).toBeNull()
  })
})

describe('players.findByIdFull', () => {
  it('returns the whole profile row', async () => {
    const id = await seedPlayer('Bình', 500)
    const row = await repos.players.findByIdFull(id)
    expect(row).toMatchObject({
      playerId: id,
      displayName: 'Bình',
      nameKey: displayNameKey('Bình'),
      balance: 500,
      avatarConfig: {},
      equippedTitle: null,
      equippedBadge: null,
      lastReliefAt: null,
    })
    expect(row!.createdAt).toBeInstanceOf(Date)
  })

  it('returns null for an unknown id', async () => {
    expect(await repos.players.findByIdFull(MISSING)).toBeNull()
  })
})

describe('players.updateProfile', () => {
  it('renames and recomputes the name key', async () => {
    const id = await seedPlayer('Bình')
    await repos.players.updateProfile(id, { displayName: 'Đông' })
    const row = await repos.players.findByIdFull(id)
    expect(row?.displayName).toBe('Đông')
    expect(row?.nameKey).toBe(displayNameKey('Đông'))
  })

  it('refuses a name another player already holds, whatever its case', async () => {
    await seedPlayer('Người')
    const id = await seedPlayer('Bình')
    // The collision is on the folded key, so a different casing of the same name is the same name.
    const err = await repos.players.updateProfile(id, { displayName: 'NGƯỜI' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DisplayNameTakenError)
    expect((err as DisplayNameTakenError).displayName).toBe('NGƯỜI')
    expect((await repos.players.findByIdFull(id))?.displayName).toBe('Bình')
  })

  it('lets a player keep their own name', async () => {
    const id = await seedPlayer('Bình')
    await expect(repos.players.updateProfile(id, { displayName: 'Bình' })).resolves.toBeUndefined()
  })

  it('does nothing when the patch carries no name', async () => {
    const id = await seedPlayer('Bình')
    await repos.players.updateProfile(id, {})
    expect((await repos.players.findByIdFull(id))?.displayName).toBe('Bình')
    // Not even the id is validated: an empty patch is a no-op, not a lookup.
    await expect(repos.players.updateProfile(MISSING, {})).resolves.toBeUndefined()
  })

  it('throws UnknownPlayerError for an id that is not there', async () => {
    await expect(repos.players.updateProfile(MISSING, { displayName: 'Ai' })).rejects.toBeInstanceOf(UnknownPlayerError)
    await expect(repos.players.updateProfile('bot-1', { displayName: 'Ai' })).rejects.toBeInstanceOf(UnknownPlayerError)
  })
})

describe('players.setLastRelief', () => {
  it('stamps the cooldown', async () => {
    const id = await seedPlayer('Bình')
    const at = new Date('2026-03-04T05:06:07.000Z')
    await repos.players.setLastRelief(id, at)
    expect((await repos.players.findByIdFull(id))?.lastReliefAt).toEqual(at)
  })

  it('throws UnknownPlayerError for an id that is not there', async () => {
    await expect(repos.players.setLastRelief(MISSING, new Date())).rejects.toBeInstanceOf(UnknownPlayerError)
  })
})
