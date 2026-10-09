import type { Card as CardId } from '@bp/core'
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { cardLabel } from '../i18n/index.js'
import { cx } from '../primitives/cx.js'
import { CardBack, CardFace, useDealFrom, type CardSize } from './Card.js'
import { DEAL_MS } from './motion.js'
import { PEEL, inward, peelDirection, peelExtent, peelFrame, shouldOpen, type Vec } from './peel.js'
import s from './table.module.css'
import { useMediaQuery } from './useMediaQuery.js'

export interface PeelCardProps {
  card: CardId
  size?: CardSize
  /**
   * Turned from outside — the seat's "Lật" button, a decision taken, the server's forced turn, the round's end. Once true
   * it stays true. Turning true, it opens the card once, from wherever the peel is; true at mount, the card is simply up.
   */
  open: boolean
  /** The card is face up and at rest: called once, however it got there. Read when it is called, so a new arrow is fine. */
  onRevealed: () => void
  /** Dealt from the deck in this render: slides in face down from the `Deck` anchor, as a `Card` does. */
  dealt?: boolean
  /** When the card comes in. Read once, when the card mounts, as `Card` reads it. */
  delayMs?: number
  className?: string
}

type Face = 'down' | 'peeling' | 'up'

/** A drag on the card: where it started, the peel it drives, and its latest moves for the flick's speed. */
interface Drag {
  id: number
  x: number
  y: number
  /** The peel's `p` when the press landed: a card caught on its way back is taken from there. */
  from: number
  u: Vec
  /** The card's length along `u`, in screen px. */
  L: number
  /** The press and the moves of the last `FLICK_WINDOW_MS`, oldest first. */
  moves: { x: number; y: number; t: number }[]
}

const SIZE_CLASS: Record<CardSize, string> = { sm: 'cardSm', md: 'cardMd', lg: 'cardLg' }
/**
 * How far back a flick's speed is read, from the release: the pointer's travel over its last 100 ms. A drag held still
 * that long before it is let go has no speed left; one that rested after the press and then flicked is still a flick.
 */
const FLICK_WINDOW_MS = 100

const px = (n: number): string => `${n.toFixed(2)}px`

/**
 * The viewer's own face-down card in a squeeze room (spec 2026-10-08 §3): pressed anywhere and dragged inward, it peels
 * from the pressed point towards the centre — a 2D peel, clip and translate, so it draws the same in every browser —
 * past half (or flicked) it finishes and slides back into place face up; let go early it snaps back. The wrapper is
 * `Card`'s, so it sizes, shadows and deals in like one.
 *
 * The motion is a JavaScript tween on `requestAnimationFrame`; under `prefers-reduced-motion` it jumps to its end, so
 * the gesture still works but the card opens or drops back at once (spec §6). While the card is down its root is the one
 * named image ("drag to turn"); once up, the face names itself.
 */
export function PeelCard({ card, size = 'md', open, onRevealed, dealt = false, delayMs = 0, className }: PeelCardProps) {
  const { t } = useTranslation()
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const ref = useRef<HTMLSpanElement>(null)
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)')
  const { sliding, vars } = useDealFrom(ref, dealt)
  // Latched at mount, as `Card` latches it: the slide's delay, and when the card lands from it.
  const [arrival] = useState(() => ({ delay: delayMs, landsAt: performance.now() + delayMs + DEAL_MS }))
  // A card that mounts open — a hand restored after its round, a remount — is up from the start: nothing to watch.
  const [openAtMount] = useState(open)

  const [face, setFace] = useState<Face>(openAtMount ? 'up' : 'down')
  const [p, setP] = useState(0)
  const [u, setU] = useState<Vec>([0, -1])
  const [box, setBox] = useState({ w: 60, h: 84 })
  const [slide, setSlide] = useState(0)

  /** The live `p`, written with every step of a drag or a tween: what a release or an outside open starts from. */
  const pNow = useRef(0)
  const drag = useRef<Drag | null>(null)
  const raf = useRef(0)
  /** Opening or open: nothing restarts it, and no press starts a peel. */
  const finishing = useRef(openAtMount)
  const reported = useRef(false)
  // The seat passes a new arrow on every render; the open must not restart for it, so the latest is read when called.
  const onRevealedRef = useRef(onRevealed)
  onRevealedRef.current = onRevealed
  const reduceRef = useRef(reduce)
  reduceRef.current = reduce

  const peelTo = useCallback((v: number) => {
    pNow.current = v
    setP(v)
  }, [])

  /**
   * The card's size and its centre on screen. The size is the layout's, which the card's own entrance (the fade's turn,
   * the slide's scale) does not distort; where nothing is laid out (jsdom) it is the box, or the 60 × 84 it is drawn at.
   */
  const measure = useCallback(() => {
    const el = ref.current
    const r = el?.getBoundingClientRect()
    const w = el?.offsetWidth || r?.width || 60
    const h = el?.offsetHeight || r?.height || 84
    setBox({ w, h })
    return { w, h, cx: (r?.left ?? 0) + (r?.width || w) / 2, cy: (r?.top ?? 0) + (r?.height || h) / 2 }
  }, [])

  /** `set` eased from `from` to `to` over `ms`, then `done`; at once under reduced motion. One tween runs at a time. */
  const tween = useCallback((from: number, to: number, ms: number, set: (v: number) => void, done?: () => void) => {
    cancelAnimationFrame(raf.current)
    if (reduceRef.current) {
      set(to)
      done?.()
      return
    }
    const t0 = performance.now()
    const step = (now: number) => {
      // the first frame's timestamp can come before `t0`
      const k = Math.min(1, Math.max(0, (now - t0) / ms))
      set(from + (to - from) * (1 - (1 - k) * (1 - k)))
      if (k < 1) raf.current = requestAnimationFrame(step)
      else done?.()
    }
    raf.current = requestAnimationFrame(step)
  }, [])

  const report = useCallback(() => {
    if (reported.current) return
    reported.current = true
    onRevealedRef.current()
  }, [])

  /** Peels the rest of the way from wherever the peel is, then slides the face back into place: the one way a card opens. */
  const finish = useCallback(() => {
    if (finishing.current) return
    finishing.current = true
    drag.current = null
    measure()
    setFace('peeling')
    const from = pNow.current
    tween(from, 1, PEEL.finishMs * (1 - from) + 60, peelTo, () =>
      tween(0, 1, PEEL.slideMs, setSlide, () => {
        setFace('up')
        report()
      }),
    )
  }, [measure, tween, peelTo, report])

  // The outside open, once, when `open` turns true — a re-render never restarts it. A card still coming in from the deck
  // lands first, as a dealt `Card` turns only once it has slid in.
  useEffect(() => {
    if (!open || openAtMount) return
    const wait = sliding && !reduce ? arrival.landsAt - performance.now() : 0
    if (wait <= 0) {
      finish()
      return
    }
    const timer = setTimeout(finish, wait)
    return () => clearTimeout(timer)
  }, [open, openAtMount, sliding, reduce, arrival, finish])
  useEffect(() => {
    if (openAtMount) report()
  }, [openAtMount, report])
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const onPointerDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (open || finishing.current || drag.current !== null || e.button > 0) return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* no pointer capture here (jsdom), or the pointer is already gone */
    }
    cancelAnimationFrame(raf.current) // a snap-back in flight: the card is taken from where it is
    const { w, h, cx, cy } = measure()
    // A fresh peel runs from the press into the centre; one caught on its way back keeps its direction.
    const dir = pNow.current === 0 ? peelDirection(e.clientX - cx, e.clientY - cy) : u
    setU(dir)
    const at = { x: e.clientX, y: e.clientY, t: performance.now() }
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: pNow.current, u: dir, L: peelExtent(dir, w, h).L, moves: [at] }
    setFace('peeling')
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const d = drag.current
    if (d === null || e.pointerId !== d.id) return
    peelTo(Math.max(0, Math.min(1, d.from + inward(d.u, e.clientX - d.x, e.clientY - d.y) / (PEEL.travel * d.L))))
    const now = performance.now()
    d.moves.push({ x: e.clientX, y: e.clientY, t: now })
    while (now - d.moves[0]!.t > FLICK_WINDOW_MS) d.moves.shift()
  }

  // A release, or a pointer the browser takes away: past the threshold or flicked it opens, else it drops back.
  const onPointerUp = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const d = drag.current
    if (d === null || e.pointerId !== d.id) return
    drag.current = null
    // The speed over the window up to the release, measured inward along the peel.
    const now = performance.now()
    const recent = d.moves.filter((m) => now - m.t <= FLICK_WINDOW_MS)
    const first = recent[0]
    const last = recent[recent.length - 1]
    const v = first !== undefined && last !== undefined && now > first.t ? inward(d.u, last.x - first.x, last.y - first.y) / (now - first.t) : 0
    if (shouldOpen(pNow.current, v)) finish()
    else tween(pNow.current, 0, PEEL.snapMs, peelTo, () => setFace('down'))
  }

  const up = face === 'up'
  const peeling = face === 'peeling'
  const frame = peelFrame(u, p, box.w, box.h)
  const reach = Math.max(box.w, box.h)
  const style = {
    ...(arrival.delay > 0 ? { '--deal-delay': `${arrival.delay}ms` } : {}),
    ...vars,
  } as CSSProperties
  return (
    <span
      ref={ref}
      className={cx(s.card, s[SIZE_CLASS[size]], s.peel, sliding && s.cardDealt, className)}
      style={style}
      data-peel=""
      data-face={face}
      role={up ? undefined : 'img'}
      aria-label={up ? undefined : t('labels.peelHint')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <span
        className={s.peelSheet}
        style={{ transform: slide > 0 && !up ? `translate(${px(-slide * frame.faceShift[0])}, ${px(-slide * frame.faceShift[1])})` : undefined }}
      >
        {up ? null : (
          <span className={s.peelBack} style={{ clipPath: frame.backClip }}>
            <CardBack uid={`${uid}-b`} label={null} />
          </span>
        )}
        {/* At rest the face is in place: face down it is clipped to nothing, and a face slid a card length off would
            still stretch the page's scrollable area. */}
        <span
          className={s.peelFlap}
          style={
            peeling
              ? {
                  transform: `translate(${px(frame.faceShift[0])}, ${px(frame.faceShift[1])})`,
                  filter: `drop-shadow(${(4 * u[0]).toFixed(1)}px ${(4 * u[1]).toFixed(1)}px 5px rgba(0, 0, 0, 0.5))`,
                }
              : undefined
          }
        >
          <span className={s.peelArt} style={{ clipPath: up ? undefined : frame.faceClip }}>
            <CardFace card={card} uid={uid} label={cardLabel(card, t)} hidden={!up} />
          </span>
        </span>
        {up ? null : (
          <span className={s.peelClip}>
            <span
              className={s.peelCurl}
              style={{
                width: px(2 * reach),
                left: px(frame.fold.x - reach),
                top: px(frame.fold.y - 5),
                transform: `rotate(${frame.fold.angle.toFixed(4)}rad)`,
                opacity: peeling && p > 0.01 && p < 0.99 ? 1 : 0,
              }}
            />
          </span>
        )}
      </span>
    </span>
  )
}
