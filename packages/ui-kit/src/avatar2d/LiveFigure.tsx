import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../primitives/Button.js'
import { cx } from '../primitives/cx.js'
import { useMediaQuery } from '../table/useMediaQuery.js'
import { Chibi } from './Chibi.js'
import { CHIBI_LIFE } from './life.js'
import type { ChibiFacing, ChibiFrame, ChibiLive, ChibiReaction, ChibiReactionKind, ChibiSubject, Expression } from './types.js'
import s from './live-figure.module.css'

/** The other way round: what "Xoay" turns a figure to. */
export function flipFacing(f: ChibiFacing): ChibiFacing {
  return f === 'right' ? 'left' : 'right'
}

/** The reaction after `prev`: `kind`, with the next key, so `Chibi` plays it. A stage keeps one of these in state and
 * bumps it on each event (an item put on, a buy, a welcome card picked). */
export function nextReaction(prev: ChibiReaction | null, kind: ChibiReactionKind): ChibiReaction {
  return { kind, key: (prev?.key ?? 0) + 1 }
}

export interface LiveFigureProps {
  subject: ChibiSubject
  frame?: ChibiFrame
  size?: number
  /** The figure's accessible name (`role="img"`). Absent, the figure is decorative, as a plain `Chibi` is. */
  label?: string
  expression?: Expression
  lazy?: boolean
  /** How alive the figure is; `idle` by default (see `ChibiLive`). */
  live?: ChibiLive
  /** A reaction from the stage (a cheer): each new `key` plays once. The one there at mount is not replayed. */
  react?: ChibiReaction | null
  /** Which way the figure faces; controlled by the stage, which places a `TurnButton`. `right` by default. */
  facing?: ChibiFacing
  /** The transparent greet button over the figure: a tap waves. On by default; never rendered when `live` is `off` or
   * under reduced motion, where a wave would not play. */
  greet?: boolean
  /** On the wrapper. */
  className?: string
  /** On the `Chibi` root. */
  figureClassName?: string
}

/**
 * A live chibi on a stage (BP-30, spec K6 §3.1–§3.2): `Chibi` with `live`, plus what the stage needs around it.
 *
 * - **Greet** (P10): a transparent `<button>` laid over the figure as its sibling — not a wrapper — so the figure keeps
 *   its `role="img"` and name (R6); a tap waves. A wave during a cheer or a turn is `Chibi`'s to ignore (`useChibiLife`).
 * - **Sparkles** (R7): six marks over the figure's box for `CHIBI_LIFE.sparkleMs` from each cheer, remounted per cheer
 *   so a second cheer starts them over, and taken away at once when the stage's `react` goes back to `null`; never under
 *   reduced motion, never on a figure that is not live.
 * - **Reactions**: the stage's `react` and the taps merge into one sequence of keys owned here, so a stage's own count
 *   and the taps never collide. A changed `react` key becomes the next key of that kind; the key already there at mount
 *   counts as seen.
 *
 * The wrapper shrinks to the figure: give the figure its width (`size`, or `figureClassName`). Turning is the stage's
 * job: it keeps `facing` and places a `TurnButton` where it fits.
 */
export function LiveFigure({
  subject,
  frame,
  size,
  label,
  expression,
  lazy,
  live = 'idle',
  react = null,
  facing = 'right',
  greet = true,
  className,
  figureClassName,
}: LiveFigureProps) {
  const { t } = useTranslation()
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const seq = useRef(0)
  const [reaction, setReaction] = useState<ChibiReaction | null>(null)
  const [sparkle, setSparkle] = useState<number | null>(null)
  const sparkleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const sparkles = live !== 'off' && !reducedMotion
  // `useChibiLife` ignores a wave on a figure that is not live or under reduced motion, so there the button would be
  // announced and do nothing: it is not rendered.
  const greets = greet && live !== 'off' && !reducedMotion
  const latest = useRef({ react, sparkles })
  latest.current = { react, sparkles }

  const externalKey = react?.key ?? null
  const seenExternal = useRef(externalKey)
  useEffect(() => {
    const incoming = latest.current.react
    if (incoming === null) {
      // The stage took its reaction back (the welcome dialog picked another card): the sparkles go with it, so only the
      // new pick's figure sparkles. The cheer's face and hop may finish.
      clearTimeout(sparkleTimer.current)
      setSparkle(null)
      return
    }
    if (incoming.key === seenExternal.current) return
    seenExternal.current = incoming.key
    seq.current += 1
    const key = seq.current
    setReaction({ kind: incoming.kind, key })
    if (incoming.kind !== 'cheer' || !latest.current.sparkles) return
    setSparkle(key)
    clearTimeout(sparkleTimer.current)
    sparkleTimer.current = setTimeout(() => setSparkle(null), CHIBI_LIFE.sparkleMs)
  }, [externalKey])

  useEffect(() => () => clearTimeout(sparkleTimer.current), [])

  const wave = () => {
    seq.current += 1
    setReaction({ kind: 'wave', key: seq.current })
  }

  return (
    <div className={cx(s.liveFigure, className)}>
      <Chibi
        subject={subject}
        frame={frame}
        size={size}
        label={label}
        expression={expression}
        lazy={lazy}
        live={live}
        react={reaction}
        facing={facing}
        className={figureClassName}
      />
      {sparkle !== null && sparkles ? (
        <span key={sparkle} className={s.sparkleRing} aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      ) : null}
      {greets ? <button type="button" className={s.greet} aria-label={t('avatar.greet')} onClick={wave} /> : null}
    </div>
  )
}

/** "Xoay": turns a live figure the other way. A toggle (`aria-pressed` while the figure faces left); the stage keeps
 * the facing and hands it to both this and its `LiveFigure`. */
export function TurnButton({ facing, onTurn, className }: { facing: ChibiFacing; onTurn: (next: ChibiFacing) => void; className?: string }) {
  const { t } = useTranslation()
  return (
    <Button variant="ghost" size="sm" className={className} aria-pressed={facing === 'left'} onClick={() => onTurn(flipFacing(facing))}>
      {t('avatar.turn')}
    </Button>
  )
}
