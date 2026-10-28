import { useEffect, useReducer, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClientHerald } from '../client/types.js'
import { formatPoints, type Language } from '../i18n/index.js'
import { cx } from '../primitives/cx.js'
import { DICE_MS, DICE_ROLL_MS, diceText } from './chaos-detail.js'
import { useMediaQuery } from './useMediaQuery.js'
import s from './table.module.css'

/** How long a herald stays up (spec 2026-10-28 §4.5: about 3 s), from its arrival — or from the end of the result's reveal hold. */
export const HERALD_MS = 3_000

/**
 * The result's reveal hold as the herald saw it (`useRevealHold`), in client time: `since` when it began, `until` when it ended
 * (`null` while it runs).
 */
export interface HeraldHold {
  since: number
  until: number | null
}

/**
 * When a herald shows, in client time:
 * - a reign (Thần, Bán Thần): from its arrival, for `HERALD_MS`;
 * - the fall of a Thần (`godslain`, Ruling 21): the same, but never while the result's reveal hold runs — a herald that would
 *   show during the hold waits for its end, so the band does not name the winner while the cards are still turning;
 * - a 6-6-6 roll (`dice`, Ruling 20b): from the dice landing (`DICE_ROLL_MS` after the roll came) until the dice panel leaves
 *   (`DICE_MS`), so the band says nothing while the panel reads "Đang gieo…" and covers the result no longer than the panel. The
 *   window is the same under reduced motion, where only the tumble is dropped.
 */
export function heraldWindow(herald: ClientHerald, hold: HeraldHold | null = null): { from: number; until: number } {
  if (herald.kind === 'dice') return { from: herald.at + DICE_ROLL_MS, until: herald.at + DICE_MS }
  if (herald.kind === 'godslain' && hold !== null && herald.at + HERALD_MS > hold.since && (hold.until === null || herald.at < hold.until)) {
    const from = hold.until ?? Number.POSITIVE_INFINITY
    return { from, until: from + HERALD_MS }
  }
  return { from: herald.at, until: herald.at + HERALD_MS }
}

export interface ChaosHeraldProps {
  /** `ClientState.chaos.heralds`: the latest heralds, oldest first. */
  heralds: readonly ClientHerald[]
  lang: Language
  /**
   * The result card is held back while the showdown turns an opponent's cards over (`useRevealHold`, `REVEAL_HOLD_MS`): the fall
   * of a Thần waits for the hold's end (Ruling 21).
   */
  held?: boolean
}

/**
 * The Thần's banner (BP-41 §4.5, G7): one band across the whole screen, large gold-on-red words with a glow and a gentle shake,
 * for about 3 s — "Cảnh báo: Lan đã tích luỹ đủ năng lượng và trở thành Thần Bài!", the Bán Thần's, the fall of a Thần, and a
 * 6-6-6 roll's jackpot. Heralds that come together share the band, a line each. A tap anywhere on it puts it away early.
 *
 * It lies in the room's moment layer (`RoomScreen`), fixed to the screen and taller than nothing it covers, so it never makes the
 * page scroll; it covers the result or the draft no longer than its 3 s. A herald that arrived before this mounted — a snapshot,
 * a remount — shows only for what is left of its time; none is replayed. A live region (assertive: it is the table's news).
 * Under `prefers-reduced-motion` the words simply show — no glow pulse, no shake.
 */
export function ChaosHerald({ heralds, lang, held = false }: ChaosHeraldProps) {
  const { t } = useTranslation()
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)')
  /** The newest herald put away by a tap: it and every one before it stay down. */
  const [dismissed, setDismissed] = useState(0)
  const [, tick] = useReducer((n: number) => n + 1, 0)
  const now = Date.now()
  // The reveal hold's start and end, noted in the render that sees them change (React's pattern for what earlier renders knew).
  const [hold, setHold] = useState<HeraldHold | null>(null)
  let seenHold = hold
  if (held && (hold === null || hold.until !== null)) seenHold = { since: now, until: null }
  else if (!held && hold !== null && hold.until === null) seenHold = { since: hold.since, until: now }
  if (seenHold !== hold) setHold(seenHold)
  const windows = heralds.map((h) => ({ h, ...heraldWindow(h, seenHold) }))
  const shown = windows.filter((w) => w.h.id > dismissed && w.from <= now && now < w.until)
  // Wakes at the next moment something appears or leaves.
  const next = Math.min(...windows.filter((w) => w.h.id > dismissed).flatMap((w) => [w.from, w.until]).filter((at) => at > now))
  useEffect(() => {
    if (!Number.isFinite(next)) return
    const timer = setTimeout(tick, Math.max(0, next - Date.now()) + 16)
    return () => clearTimeout(timer)
  }, [next])

  const textOf = (h: ClientHerald): string => {
    if (h.kind !== 'dice') return t(`chaos.herald.${h.kind}`, { name: h.name })
    const dice = diceText(h.dice ?? [])
    return h.amount === undefined ? t('chaos.herald.diceBig', { name: h.name, dice }) : t('chaos.herald.dice', { name: h.name, dice, amount: formatPoints(h.amount, lang) })
  }

  return (
    <div className={s.heraldSlot} role="status" aria-live="assertive" aria-label={t('chaos.herald.label')}>
      {shown.length === 0 ? null : (
        <button
          type="button"
          className={cx(s.herald, !reduce && s.heraldMotion)}
          data-herald={shown[shown.length - 1]!.h.kind}
          onClick={() => setDismissed(Math.max(...shown.map((w) => w.h.id)))}
        >
          {shown.slice(-3).map(({ h }) => (
            <span key={h.id} className={s.heraldLine} data-kind={h.kind}>
              {textOf(h)}
            </span>
          ))}
        </button>
      )}
    </div>
  )
}
