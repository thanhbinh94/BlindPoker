import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHIBI_LIFE, useChibiLife, type ChibiLifeOptions } from './life.js'
import type { ChibiReaction } from './types.js'

/** An `rng` that hands out `values` in order and then repeats the last one. */
function seq(...values: number[]): () => number {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)] ?? 0
}

/** No blink for as long as any test here runs, unless a test asks for one: the gap is the longest, 6 s. */
const NEVER_SOON = () => 0.999

const BASE: ChibiLifeOptions = {
  live: 'idle',
  react: null,
  facing: 'right',
  onScreen: true,
  facesReady: true,
  baseExpression: 'neutral',
  reducedMotion: false,
  rng: NEVER_SOON,
}

function setup(overrides: Partial<ChibiLifeOptions> = {}) {
  let props: ChibiLifeOptions = { ...BASE, ...overrides }
  const hook = renderHook((p: ChibiLifeOptions) => useChibiLife(p), { initialProps: props })
  return {
    ...hook,
    update(next: Partial<ChibiLifeOptions>) {
      props = { ...props, ...next }
      hook.rerender(props)
    },
  }
}

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))
const cheer = (key: number): ChibiReaction => ({ kind: 'cheer', key })
const wave = (key: number): ChibiReaction => ({ kind: 'wave', key })

describe('useChibiLife', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('has the timings of spec 3.1', () => {
    expect(CHIBI_LIFE).toEqual({
      breatheMs: 4000,
      blinkMs: 120,
      blinkMinGapMs: 3000,
      blinkMaxGapMs: 6000,
      doubleBlinkRate: 0.1,
      doubleBlinkGapMs: 160,
      cheerFaceMs: 1200,
      hopMs: 420,
      sparkleMs: 700,
      waveFaceMs: 800,
      tiltMs: 600,
      spinMs: 500,
    })
  })

  it('breathes only while live idle, on screen, not reduced and not moving', () => {
    const h = setup()
    expect(h.result.current).toEqual({ face: 'base', motion: 'none', breathing: true, reacting: null })
    h.update({ onScreen: false })
    expect(h.result.current.breathing).toBe(false)
    h.update({ onScreen: true, live: 'still' })
    expect(h.result.current.breathing).toBe(false)
    h.update({ live: 'off' })
    expect(h.result.current.breathing).toBe(false)
    h.update({ live: 'idle', reducedMotion: true })
    expect(h.result.current.breathing).toBe(false)
    h.update({ reducedMotion: false })
    expect(h.result.current.breathing).toBe(true)
    // One animation at a time: a hop stops the breath, which comes back when it ends.
    h.update({ react: cheer(1) })
    expect(h.result.current).toMatchObject({ motion: 'hop', breathing: false })
    advance(CHIBI_LIFE.hopMs)
    expect(h.result.current).toMatchObject({ motion: 'none', breathing: true })
  })

  it('blinks closed for 120 ms every 3–6 s and doubles 10 % of the time', () => {
    // gap 0 → 3000 ms, no double (0.5); gap 1 → 6000 ms, double (0.05); then gap 0.5 → 4500 ms, no double.
    const h = setup({ rng: seq(0, 0.5, 1, 0.05, 0.5, 0.5) })
    expect(h.result.current.face).toBe('base')
    advance(2999)
    expect(h.result.current.face).toBe('base')
    advance(1)
    expect(h.result.current.face).toBe('closed')
    advance(CHIBI_LIFE.blinkMs)
    expect(h.result.current.face).toBe('base')

    advance(5999)
    expect(h.result.current.face).toBe('base')
    advance(1)
    expect(h.result.current.face).toBe('closed')
    advance(CHIBI_LIFE.blinkMs)
    expect(h.result.current.face).toBe('base')
    advance(CHIBI_LIFE.doubleBlinkGapMs)
    expect(h.result.current.face).toBe('closed')
    advance(CHIBI_LIFE.blinkMs)
    expect(h.result.current.face).toBe('base')

    advance(4499)
    expect(h.result.current.face).toBe('base')
    advance(1)
    expect(h.result.current.face).toBe('closed')
    advance(CHIBI_LIFE.blinkMs)
    expect(h.result.current.face).toBe('base')
    // A single blink this time: nothing 160 ms later.
    advance(CHIBI_LIFE.doubleBlinkGapMs)
    expect(h.result.current.face).toBe('base')
  })

  it('never blinks before facesReady, and starts once they are', () => {
    const h = setup({ facesReady: false, rng: () => 0 })
    advance(20_000)
    expect(h.result.current.face).toBe('base')
    h.update({ facesReady: true })
    advance(CHIBI_LIFE.blinkMinGapMs)
    expect(h.result.current.face).toBe('closed')
  })

  it.each(['closed', 'sleep'] as const)('never blinks when the base expression is %s', (baseExpression) => {
    const h = setup({ baseExpression, rng: () => 0 })
    for (let t = 0; t < 20_000; t += 60) {
      advance(60)
      expect(h.result.current.face).toBe('base')
    }
  })

  it('stops blinking and breathing off screen or in a hidden tab, and resumes when back', () => {
    const h = setup({ rng: () => 0 })
    advance(CHIBI_LIFE.blinkMinGapMs)
    expect(h.result.current.face).toBe('closed')
    // Leaving mid-blink opens the eyes at once.
    h.update({ onScreen: false })
    expect(h.result.current).toMatchObject({ face: 'base', breathing: false })
    advance(20_000)
    expect(h.result.current.face).toBe('base')
    h.update({ onScreen: true })
    expect(h.result.current.breathing).toBe(true)
    advance(CHIBI_LIFE.blinkMinGapMs)
    expect(h.result.current.face).toBe('closed')
  })

  it('still mode: never breathes or blinks, but reacts', () => {
    const h = setup({ live: 'still', rng: () => 0 })
    advance(20_000)
    expect(h.result.current).toEqual({ face: 'base', motion: 'none', breathing: false, reacting: null })
    h.update({ react: cheer(1) })
    expect(h.result.current).toEqual({ face: 'happy', motion: 'hop', breathing: false, reacting: 'cheer' })
  })

  it('cheer sets happy for 1200 ms and hop for 420 ms, once per key', () => {
    const h = setup()
    h.update({ react: cheer(1) })
    expect(h.result.current).toEqual({ face: 'happy', motion: 'hop', breathing: false, reacting: 'cheer' })
    advance(CHIBI_LIFE.hopMs - 1)
    expect(h.result.current.motion).toBe('hop')
    advance(1)
    expect(h.result.current).toMatchObject({ face: 'happy', motion: 'none', reacting: 'cheer' })
    advance(CHIBI_LIFE.cheerFaceMs - CHIBI_LIFE.hopMs)
    expect(h.result.current).toEqual({ face: 'base', motion: 'none', breathing: true, reacting: null })
    // The same key again (a re-render with an equal object) does nothing.
    h.update({ react: cheer(1) })
    expect(h.result.current).toMatchObject({ face: 'base', motion: 'none', reacting: null })
    h.update({ react: null })
    expect(h.result.current.reacting).toBeNull()
  })

  it('a cheer before the faces are ready hops but keeps the base face', () => {
    const h = setup({ facesReady: false })
    h.update({ react: cheer(1) })
    expect(h.result.current).toMatchObject({ face: 'base', motion: 'hop', reacting: 'cheer' })
  })

  it('a react key present at mount counts as seen', () => {
    const h = setup({ react: cheer(7) })
    expect(h.result.current).toMatchObject({ face: 'base', motion: 'none', reacting: null })
    h.update({ react: cheer(8) })
    expect(h.result.current).toMatchObject({ face: 'happy', motion: 'hop', reacting: 'cheer' })
  })

  it('a new cheer key restarts; a wave during a cheer is ignored', () => {
    const h = setup()
    h.update({ react: cheer(1) })
    advance(1000)
    expect(h.result.current).toMatchObject({ face: 'happy', motion: 'none', reacting: 'cheer' })
    h.update({ react: cheer(2) })
    expect(h.result.current).toMatchObject({ face: 'happy', motion: 'hop', reacting: 'cheer' })
    // 1000 ms after the first cheer's restart, the first one's 1200 ms would have ended: the face holds.
    advance(1000)
    expect(h.result.current).toMatchObject({ face: 'happy', reacting: 'cheer' })
    h.update({ react: wave(3) })
    expect(h.result.current).toMatchObject({ face: 'happy', motion: 'none', reacting: 'cheer' })
    advance(200)
    expect(h.result.current).toEqual({ face: 'base', motion: 'none', breathing: true, reacting: null })
    // The ignored wave stays ignored; the next tap waves.
    advance(5000)
    expect(h.result.current.reacting).toBeNull()
    h.update({ react: wave(4) })
    expect(h.result.current).toMatchObject({ face: 'happy', motion: 'tilt', reacting: 'wave' })
  })

  it('wave sets happy for 800 ms and tilt for 600 ms; a cheer over a wave takes over', () => {
    const h = setup()
    h.update({ react: wave(1) })
    expect(h.result.current).toEqual({ face: 'happy', motion: 'tilt', breathing: false, reacting: 'wave' })
    advance(CHIBI_LIFE.tiltMs)
    expect(h.result.current).toMatchObject({ face: 'happy', motion: 'none', reacting: 'wave' })
    advance(CHIBI_LIFE.waveFaceMs - CHIBI_LIFE.tiltMs)
    expect(h.result.current).toMatchObject({ face: 'base', motion: 'none', reacting: null })

    h.update({ react: wave(2) })
    advance(300)
    h.update({ react: cheer(3) })
    expect(h.result.current).toMatchObject({ face: 'happy', motion: 'hop', reacting: 'cheer' })
    advance(CHIBI_LIFE.cheerFaceMs - 1)
    expect(h.result.current).toMatchObject({ face: 'happy', reacting: 'cheer' })
    advance(1)
    expect(h.result.current).toMatchObject({ face: 'base', reacting: null })
  })

  it('a facing change after mount spins for 500 ms; a spin replaces a hop and leaves the face timer alone', () => {
    const h = setup({ facing: 'left' })
    // Mounting already turned is no spin.
    expect(h.result.current).toMatchObject({ motion: 'none', reacting: null })
    h.update({ facing: 'right' })
    expect(h.result.current).toEqual({ face: 'base', motion: 'spin', breathing: false, reacting: 'spin' })
    advance(CHIBI_LIFE.spinMs)
    expect(h.result.current).toEqual({ face: 'base', motion: 'none', breathing: true, reacting: null })

    h.update({ react: cheer(1) })
    advance(100)
    h.update({ facing: 'left' })
    expect(h.result.current).toMatchObject({ face: 'happy', motion: 'spin', reacting: 'spin' })
    advance(CHIBI_LIFE.spinMs)
    // The hop is gone for good; the cheer's face and its reaction carry on to their own end (100 + 500 of 1200).
    expect(h.result.current).toMatchObject({ face: 'happy', motion: 'none', reacting: 'cheer' })
    advance(CHIBI_LIFE.cheerFaceMs - 600)
    expect(h.result.current).toMatchObject({ face: 'base', motion: 'none', reacting: null })
  })

  it('a wave during a spin is ignored; a cheer during a spin keeps the spin', () => {
    const h = setup()
    h.update({ facing: 'left' })
    h.update({ react: wave(1) })
    expect(h.result.current).toMatchObject({ face: 'base', motion: 'spin', reacting: 'spin' })
    h.update({ react: cheer(2) })
    expect(h.result.current).toMatchObject({ face: 'happy', motion: 'spin', reacting: 'spin' })
    advance(CHIBI_LIFE.spinMs)
    expect(h.result.current).toMatchObject({ face: 'happy', motion: 'none', reacting: 'cheer' })
  })

  it('a react of kind spin does nothing: the turn comes from facing', () => {
    const h = setup()
    h.update({ react: { kind: 'spin', key: 1 } })
    expect(h.result.current).toMatchObject({ motion: 'none', reacting: null })
  })

  it('reactions do not depend on onScreen', () => {
    const h = setup({ onScreen: false })
    h.update({ react: cheer(1) })
    expect(h.result.current).toEqual({ face: 'happy', motion: 'hop', breathing: false, reacting: 'cheer' })
    h.update({ facing: 'left' })
    expect(h.result.current.motion).toBe('spin')
  })

  it('reduced motion: face stays base and motion none, even with a react or a turn', () => {
    const h = setup({ reducedMotion: true, rng: () => 0 })
    const still = { face: 'base', motion: 'none', breathing: false, reacting: null }
    expect(h.result.current).toEqual(still)
    h.update({ react: cheer(1) })
    expect(h.result.current).toEqual(still)
    h.update({ react: wave(2) })
    expect(h.result.current).toEqual(still)
    h.update({ facing: 'left' })
    expect(h.result.current).toEqual(still)
    for (let t = 0; t < 10_000; t += 100) {
      advance(100)
      expect(h.result.current).toEqual(still)
    }
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reduced motion switched on mid-cheer stills the figure at once', () => {
    const h = setup()
    h.update({ react: cheer(1) })
    h.update({ reducedMotion: true })
    expect(h.result.current).toEqual({ face: 'base', motion: 'none', breathing: false, reacting: null })
  })

  it('live off: nothing moves and no timer runs', () => {
    const h = setup({ live: 'off', rng: () => 0 })
    h.update({ react: cheer(1) })
    h.update({ facing: 'left' })
    expect(h.result.current).toEqual({ face: 'base', motion: 'none', breathing: false, reacting: null })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('unmount clears every timer', () => {
    const h = setup({ rng: () => 0 })
    h.update({ react: cheer(1) })
    h.update({ facing: 'left' })
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    h.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
