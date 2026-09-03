import { describe, expect, it } from 'vitest'
import { newId, newRoomCode } from './ids.js'

describe('ids', () => {
  it('newId returns unique UUIDs', () => {
    const a = newId()
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    expect(newId()).not.toBe(a)
  })
  it('newRoomCode uses the safe alphabet and avoids taken codes', () => {
    const code = newRoomCode(() => false)
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
    const taken = new Set([code])
    let calls = 0
    const next = newRoomCode((c) => {
      calls++
      return taken.has(c)
    })
    expect(next).not.toBe(code)
    expect(calls).toBeGreaterThan(0)
  })
  it('newRoomCode gives up after 100 attempts', () => {
    expect(() => newRoomCode(() => true)).toThrow(/room code/)
  })
})
