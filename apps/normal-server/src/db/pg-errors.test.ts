import { describe, expect, it } from 'vitest'
import { constraintOf, DatabaseFaultError, isDatabaseFault, isUniqueViolation, sanitizeDbError, sqlstate } from './pg-errors.js'

/** What the two drivers hand back: a SQLSTATE, and — usually, but not always — the constraint's name. */
function driverError(opts: { code?: string; constraint?: string; message?: string }): Error {
  return Object.assign(new Error(opts.message ?? 'duplicate key value violates unique constraint'), opts)
}

/**
 * What drizzle wraps it in. The message is the shape that makes this file necessary: it embeds the
 * failing statement's *parameters*, which for a registration are the address and the argon2 hash.
 */
function drizzleWrapped(cause: Error, params: string[] = []): Error {
  const err = new Error(`Failed query: insert into "users" ...\nparams: ${params.join(',')}`)
  ;(err as { cause?: unknown }).cause = cause
  return err
}

describe('sqlstate', () => {
  it('finds the driver code however deep it is', () => {
    expect(sqlstate(driverError({ code: '23505' }))).toBe('23505')
    expect(sqlstate(drizzleWrapped(driverError({ code: '23503' })))).toBe('23503')
  })

  it('ignores a code that is not shaped like a SQLSTATE, so a Node ERR_* cannot mask the driver', () => {
    const wrapper = Object.assign(drizzleWrapped(driverError({ code: '23505' })), { code: 'ERR_STREAM_DESTROYED' })
    expect(sqlstate(wrapper)).toBe('23505')
  })

  it('is undefined when nothing in the chain came from a database', () => {
    expect(sqlstate(new TypeError('x is not a function'))).toBeUndefined()
    expect(sqlstate('not an error')).toBeUndefined()
  })
})

describe('isUniqueViolation', () => {
  it('matches the constraint the driver named', () => {
    const err = drizzleWrapped(driverError({ code: '23505', constraint: 'users_email_unique' }))
    expect(isUniqueViolation(err, 'users_email_unique')).toBe(true)
    expect(isUniqueViolation(err, 'players_name_key_unique')).toBe(false)
  })

  it('is not masked by a wrapper carrying a code of its own', () => {
    // Without inspecting every link, the outermost `code` wins and a 409 becomes a 500.
    const err = Object.assign(drizzleWrapped(driverError({ code: '23505', constraint: 'users_email_unique' })), { code: 'ERR_INVALID_STATE' })
    expect(isUniqueViolation(err, 'users_email_unique')).toBe(true)
  })

  it('believes the driver over the message, so a caller cannot name themselves into the other 409', () => {
    // The parameters of the failing `players` insert are in the message; one of them is a display
    // name the caller chose, and it is the *other* constraint's name.
    const err = drizzleWrapped(driverError({ code: '23505', constraint: 'players_name_key_unique' }), ['users_email_unique'])
    expect(isUniqueViolation(err, 'users_email_unique')).toBe(false)
    expect(isUniqueViolation(err, 'players_name_key_unique')).toBe(true)
  })

  it('falls back to the message only when the driver named nothing', () => {
    const err = drizzleWrapped(driverError({ code: '23505', message: 'duplicate key value violates unique constraint "users_email_unique"' }))
    expect(isUniqueViolation(err, 'users_email_unique')).toBe(true)
    expect(isUniqueViolation(err, 'players_name_key_unique')).toBe(false)
  })

  it('is false for any other failure', () => {
    expect(isUniqueViolation(drizzleWrapped(driverError({ code: '23503', constraint: 'users_email_unique' })), 'users_email_unique')).toBe(false)
    expect(isUniqueViolation(new TypeError('boom'), 'users_email_unique')).toBe(false)
    expect(isUniqueViolation(undefined, 'users_email_unique')).toBe(false)
  })
})

describe('constraintOf / isDatabaseFault', () => {
  it('reads the name the driver attached, and recognises a query failure with no SQLSTATE at all', () => {
    expect(constraintOf(drizzleWrapped(driverError({ code: '23505', constraint: 'inventory_pkey' })))).toBe('inventory_pkey')
    // A connection reset mid-statement: no SQLSTATE, but the parameters are in the message all the same.
    expect(isDatabaseFault(drizzleWrapped(new Error('Connection terminated unexpectedly')))).toBe(true)
    expect(isDatabaseFault(new TypeError('boom'))).toBe(false)
  })
})

describe('sanitizeDbError', () => {
  const secret = '$argon2id$v=19$m=65536,p=1,t=3$c2FsdA$aGFzaA'

  it('drops the statement parameters, keeping only the SQLSTATE and the constraint', () => {
    const err = sanitizeDbError('register', drizzleWrapped(driverError({ code: '23503', constraint: 'inventory_item_id_items_id_fk' }), ['binh@example.com', secret]))
    expect(err).toBeInstanceOf(DatabaseFaultError)
    const fault = err as DatabaseFaultError
    expect(fault.message).toBe('register failed (sqlstate 23503, constraint inventory_item_id_items_id_fk)')
    expect(fault.sqlstate).toBe('23503')
    expect(fault.constraint).toBe('inventory_item_id_items_id_fk')
  })

  it('leaves nothing for a logger to find: not the message, not `cause`, not an enumerable property', () => {
    const original = drizzleWrapped(driverError({ code: '23503' }), ['binh@example.com', secret])
    const fault = sanitizeDbError('register', original) as DatabaseFaultError
    const everything = `${String(fault)} ${fault.stack ?? ''} ${JSON.stringify(fault)} ${Object.keys(fault).join(',')}`
    expect(everything).not.toContain('binh@example.com')
    expect(everything).not.toContain('$argon2id$')
    expect((fault as { cause?: unknown }).cause).toBeUndefined()
    // Still reachable from a debugger attached to the process, which is the only reader that should have it.
    expect((fault as unknown as { driverError: unknown }).driverError).toBe(original)
  })

  it('leaves an error of our own making exactly as it is', () => {
    const bug = new TypeError('catalog.defaults is not a function')
    expect(sanitizeDbError('register', bug)).toBe(bug)
  })
})
