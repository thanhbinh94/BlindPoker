import { describe, expect, it } from 'vitest'
import { rowsOf } from './client.js'

// No database here on purpose: `rowsOf` is the seam every raw-SQL call site goes through, and the
// `{ rows }` envelope is the one the production `pg` driver returns — the one PGlite tests never see.
describe('rowsOf', () => {
  it('reads the `pg` envelope', () => {
    const result = { command: 'SELECT', rowCount: 2, rows: [{ id: 1 }, { id: 2 }] }
    expect(rowsOf<{ id: number }>(result)).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('reads a bare array', () => {
    expect(rowsOf<{ id: number }>([{ id: 1 }])).toEqual([{ id: 1 }])
  })

  it('passes an empty result through as an empty array', () => {
    expect(rowsOf({ rows: [] })).toEqual([])
    expect(rowsOf([])).toEqual([])
  })

  it('throws on a shape it does not recognise, rather than reporting no rows', () => {
    // The failure this guards: a driver whose envelope changed would otherwise read as "the
    // settlement lock matched nobody", which in the money path is the worst possible silent answer.
    expect(() => rowsOf({ affectedRows: 0 })).toThrow(TypeError)
    expect(() => rowsOf({ affectedRows: 0 })).toThrow(/unrecognised query result shape.*affectedRows/)
    expect(() => rowsOf({ rows: 'nope' })).toThrow(/unrecognised query result shape/)
    expect(() => rowsOf(null)).toThrow(/unrecognised query result shape: null/)
    expect(() => rowsOf(undefined)).toThrow(/unrecognised query result shape: undefined/)
    expect(() => rowsOf(7)).toThrow(/unrecognised query result shape: number/)
  })
})
