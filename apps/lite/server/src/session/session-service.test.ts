import { createHash } from 'node:crypto'
import { ECONOMY } from '@bp/core'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/sqlite.js'
import { createSqliteRepositories, NameTakenError, type LiteRepositories } from '../repos/sqlite-repos.js'
import { createSessionService, InvalidNameError, type SessionService } from './session-service.js'

const open: LiteRepositories[] = []
function repos(): LiteRepositories {
  const r = createSqliteRepositories(openDatabase(':memory:'), { handLog: false })
  open.push(r)
  return r
}

afterEach(() => {
  for (const r of open.splice(0)) r.close()
})

function service(r: LiteRepositories, opts?: { startingBalance?: number; random?: () => string }): SessionService {
  return createSessionService(r, opts)
}

describe('name validation', () => {
  it.each(['Alice', 'Bob_99', 'A.B-C', 'Nguyễn Văn A'])('accepts a valid display name: %s', (name) => {
    const svc = service(repos())
    const result = svc.create(name)
    expect(result.displayName).toBe(name)
    expect(result.playerId).toMatch(/\S/)
  })

  it('rejects a name shorter than 2 characters', () => {
    expect(() => service(repos()).create('a')).toThrow(InvalidNameError)
  })

  it('rejects a name longer than 20 characters', () => {
    expect(() => service(repos()).create('a'.repeat(21))).toThrow(InvalidNameError)
  })

  it('rejects a name with leading whitespace', () => {
    expect(() => service(repos()).create(' Alice')).toThrow(InvalidNameError)
  })

  it('rejects a name with trailing whitespace', () => {
    expect(() => service(repos()).create('Alice ')).toThrow(InvalidNameError)
  })

  it('rejects a name containing disallowed characters', () => {
    expect(() => service(repos()).create('<script>')).toThrow(InvalidNameError)
  })
})

describe('token issuance and resolution', () => {
  it('round-trips a token through resolve()', () => {
    const r = repos()
    const svc = service(r)
    const created = svc.create('Alice')
    const identity = svc.resolve(created.token)
    expect(identity).toEqual({ playerId: created.playerId, displayName: 'Alice', isBot: false })
  })

  it('returns null for an unknown token', () => {
    const svc = service(repos())
    expect(svc.resolve('not-a-real-token')).toBeNull()
  })

  it('stores the sha256 hex of the token, not the token itself', () => {
    const r = repos()
    const svc = service(r, { random: () => 'fixed-token-value' })
    const created = svc.create('Alice')
    expect(created.token).toBe('fixed-token-value')
    expect(svc.hashToken('fixed-token-value')).toBe(createHash('sha256').update('fixed-token-value').digest('hex'))
    const stored = r.findByName('Alice')
    expect(stored?.playerId).toBe(created.playerId)
    const raw = r.db.prepare('SELECT token_hash FROM players WHERE id = ?').get(created.playerId) as { token_hash: string }
    expect(raw.token_hash).toBe(svc.hashToken('fixed-token-value'))
  })

  it('generates a fresh 32-byte base64url token per player when no random() override is given', () => {
    const r = repos()
    const svc = service(r)
    const a = svc.create('Alice')
    const b = svc.create('Bob')
    expect(a.token).not.toBe(b.token)
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{40,50}$/)
  })
})

describe('duplicate names', () => {
  it('rejects a duplicate display name case-insensitively', () => {
    const r = repos()
    const svc = service(r)
    svc.create('Alice')
    expect(() => svc.create('ALICE')).toThrow(NameTakenError)
    expect(() => svc.create('aliCE')).toThrow(NameTakenError)
  })
})

describe('starting balance', () => {
  it('defaults the starting balance to ECONOMY.startingBalance', () => {
    const svc = service(repos())
    const created = svc.create('Alice')
    expect(created.balance).toBe(ECONOMY.startingBalance)
  })

  it('honors an overridden starting balance', () => {
    const svc = service(repos(), { startingBalance: 7_777 })
    const created = svc.create('Alice')
    expect(created.balance).toBe(7_777)
  })
})
