import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChibiFacing, ChibiLive, ChibiReaction, ChibiReactionKind, Expression } from './types.js'

/** Every timing of a live chibi (spec K6 §3.1), in milliseconds unless named a rate. The CSS keyframes in
 * `avatar2d.module.css` use the same numbers; a change here goes there too. */
export const CHIBI_LIFE = {
  /** One breath: scale 1 → 1.015 → 1. */
  breatheMs: 4000,
  /** How long the eyes stay shut in one blink. */
  blinkMs: 120,
  /** The wait between blinks is drawn evenly from this range. */
  blinkMinGapMs: 3000,
  blinkMaxGapMs: 6000,
  /** The share of blinks that come as two in a row. */
  doubleBlinkRate: 0.1,
  /** The eyes-open moment between the two blinks of a double. */
  doubleBlinkGapMs: 160,
  /** A cheer: the happy face, and how long the reaction lasts. */
  cheerFaceMs: 1200,
  /** A cheer's one hop. */
  hopMs: 420,
  /** A cheer's sparkles (drawn by `LiveFigure`). */
  sparkleMs: 700,
  /** A wave: the happy face, and how long the reaction lasts. */
  waveFaceMs: 800,
  /** A wave's tilt. */
  tiltMs: 600,
  /** A turn. */
  spinMs: 500,
} as const

/** Which face shows: the chibi's own expression (`base`), shut eyes (a blink) or happy (a reaction). */
export type ChibiLifeFace = 'base' | 'closed' | 'happy'

/** The one animation running on the root, if any. */
export type ChibiLifeMotion = 'none' | 'hop' | 'tilt' | 'spin'

export interface ChibiLifeState {
  face: ChibiLifeFace
  motion: ChibiLifeMotion
  /** Whether the breathing animation runs: only while `motion` is `none`, so one `animation` applies at a time. */
  breathing: boolean
  /** The reaction under way: a turn while it spins, else a cheer or a wave until its face time is over. */
  reacting: ChibiReactionKind | null
}

export interface ChibiLifeOptions {
  live: ChibiLive
  react: ChibiReaction | null
  facing: ChibiFacing
  /** The chibi is in the viewport and its tab is visible (`useOnScreen`): breathing and blinking need it, reactions do not. */
  onScreen: boolean
  /** Every face layer a reaction or a blink would show has loaded and been tinted: until then the face never changes. */
  facesReady: boolean
  baseExpression: Expression
  /** `prefers-reduced-motion: reduce`: no face change and no motion at all (R4). */
  reducedMotion: boolean
  /** The blink timing's randomness; `Math.random` by default. */
  rng?: () => number
}

const STILL: ChibiLifeState = { face: 'base', motion: 'none', breathing: false, reacting: null }

type TimerName = 'face' | 'motion' | 'reaction' | 'spin'

/**
 * The state machine behind a live chibi (BP-30, spec K6 §3.1): what face it shows, which one-shot animation runs and
 * whether it breathes. `Chibi` turns the result into `data-face`, `data-motion`, `data-breathing` and `data-reacting`
 * and the matching classes; every motion is a CSS animation, so the global reduced-motion rule stops it too.
 *
 * - **Blink** (`idle` only, on screen, faces ready, a base other than `closed`/`sleep`): `closed` for 120 ms, every
 *   3–6 s, one time in ten twice with 160 ms between.
 * - **Cheer** (a new `react` key of kind `cheer`): always restarts — `happy` for 1.2 s (only once the faces are ready),
 *   a 420 ms hop unless a turn is spinning.
 * - **Wave** (kind `wave`): `happy` 800 ms and a 600 ms tilt; ignored while a cheer or a turn is under way.
 * - **Spin**: a change of `facing` after mount, 500 ms; it replaces a hop or a tilt and leaves the face alone. A `react`
 *   of kind `spin` does nothing.
 *
 * A `react` key already there at mount counts as seen (a remount does not replay the last cheer). Reactions answer
 * whether or not the chibi is on screen. Under reduced motion, and when `live` is `off`, the state is always the still
 * one and no timer runs. Unmounting clears every timer.
 */
export function useChibiLife({ live, react, facing, onScreen, facesReady, baseExpression, reducedMotion, rng = Math.random }: ChibiLifeOptions): ChibiLifeState {
  const [happy, setHappy] = useState(false)
  const [motion, setMotion] = useState<ChibiLifeMotion>('none')
  const [reaction, setReaction] = useState<'cheer' | 'wave' | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [blinking, setBlinking] = useState(false)

  const timers = useRef(new Map<TimerName, ReturnType<typeof setTimeout>>())
  const schedule = useCallback((name: TimerName, ms: number, done: () => void) => {
    const map = timers.current
    const running = map.get(name)
    if (running !== undefined) clearTimeout(running)
    map.set(
      name,
      setTimeout(() => {
        map.delete(name)
        done()
      }, ms),
    )
  }, [])
  useEffect(() => {
    const map = timers.current
    return () => {
      for (const timer of map.values()) clearTimeout(timer)
      map.clear()
    }
  }, [])

  const animated = live !== 'off' && !reducedMotion

  // The latest values the reaction effects read without re-running on them.
  const now = useRef({ animated, facesReady, reaction, spinning })
  now.current = { animated, facesReady, reaction, spinning }

  const seenKey = useRef<number | null>(react?.key ?? null)
  useEffect(() => {
    if (react === null || react.key === seenKey.current) return
    seenKey.current = react.key
    const { animated: on, facesReady: ready, reaction: current, spinning: turning } = now.current
    if (!on) return
    if (react.kind === 'cheer') {
      setReaction('cheer')
      schedule('reaction', CHIBI_LIFE.cheerFaceMs, () => setReaction(null))
      if (ready) {
        setHappy(true)
        schedule('face', CHIBI_LIFE.cheerFaceMs, () => setHappy(false))
      }
      if (!turning) {
        setMotion('hop')
        schedule('motion', CHIBI_LIFE.hopMs, () => setMotion('none'))
      }
    } else if (react.kind === 'wave') {
      if (current === 'cheer' || turning) return
      setReaction('wave')
      schedule('reaction', CHIBI_LIFE.waveFaceMs, () => setReaction(null))
      if (ready) {
        setHappy(true)
        schedule('face', CHIBI_LIFE.waveFaceMs, () => setHappy(false))
      }
      setMotion('tilt')
      schedule('motion', CHIBI_LIFE.tiltMs, () => setMotion('none'))
    }
    // `react.kind` travels with its key: a new reaction always brings a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [react?.key, schedule])

  const seenFacing = useRef(facing)
  useEffect(() => {
    if (facing === seenFacing.current) return
    seenFacing.current = facing
    if (!now.current.animated) return
    setSpinning(true)
    setMotion('spin')
    schedule('spin', CHIBI_LIFE.spinMs, () => setSpinning(false))
    schedule('motion', CHIBI_LIFE.spinMs, () => setMotion('none'))
  }, [facing, schedule])

  const rngRef = useRef(rng)
  rngRef.current = rng
  const blinkOn = animated && live === 'idle' && onScreen && facesReady && baseExpression !== 'closed' && baseExpression !== 'sleep'
  useEffect(() => {
    if (!blinkOn) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const wait = (ms: number, then: () => void) => {
      timer = setTimeout(then, ms)
    }
    const next = () => {
      const gap = CHIBI_LIFE.blinkMinGapMs + rngRef.current() * (CHIBI_LIFE.blinkMaxGapMs - CHIBI_LIFE.blinkMinGapMs)
      wait(gap, () => blink(rngRef.current() < CHIBI_LIFE.doubleBlinkRate))
    }
    const blink = (twice: boolean) => {
      setBlinking(true)
      wait(CHIBI_LIFE.blinkMs, () => {
        setBlinking(false)
        if (twice) wait(CHIBI_LIFE.doubleBlinkGapMs, () => blink(false))
        else next()
      })
    }
    next()
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      setBlinking(false)
    }
  }, [blinkOn])

  if (!animated) return STILL
  return {
    face: happy ? 'happy' : blinking ? 'closed' : 'base',
    motion,
    breathing: live === 'idle' && onScreen && motion === 'none',
    reacting: spinning ? 'spin' : reaction,
  }
}
