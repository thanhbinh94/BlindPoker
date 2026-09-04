import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { parseHash, useHashRoute } from './useHashRoute.js'

describe('parseHash', () => {
  it('parses paths, segments and queries', () => {
    expect(parseHash('')).toEqual({ path: '/', segments: [], query: new URLSearchParams() })
    const r = parseHash('#/room/ABC234?x=1')
    expect(r.path).toBe('/room/ABC234')
    expect(r.segments).toEqual(['room', 'ABC234'])
    expect(r.query.get('x')).toBe('1')
  })
})

describe('useHashRoute', () => {
  it('tracks location.hash and navigates', () => {
    window.location.hash = '#/lobby'
    const { result } = renderHook(() => useHashRoute())
    expect(result.current.route.path).toBe('/lobby')
    act(() => result.current.navigate('/room/X'))
    expect(window.location.hash).toBe('#/room/X')
    act(() => {
      window.location.hash = '#/settings'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(result.current.route.path).toBe('/settings')
  })
})
