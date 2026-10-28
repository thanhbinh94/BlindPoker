import { useEffect, useReducer, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClientHerald } from '../client/types.js'
import { formatPoints, type Language } from '../i18n/index.js'
import { cx } from '../primitives/cx.js'
import { diceText } from './chaos-detail.js'
import { DICE_ROLL_MS } from './ChaosDice.js'
import { useMediaQuery } from './useMediaQuery.js'
import s from './table.module.css'

/** How long a herald stays up (spec 2026-10-28 §4.5: about 3 s), from its arrival — or, for a 6-6-6 roll, from the dice landing. */
export const HERALD_MS = 3_000

/**
 * When a herald shows, in client time: from its arrival for a reign; for a dice roll (`dice`), once the dice have landed, so
 * the banner does not tell the roll before the table has watched it — at once under reduced motion, which skips the roll.
 */
export function heraldWindow(herald: ClientHerald, reduce: boolean): { from: number; until: number } {
  const from = herald.kind === 'dice' && !reduce ? herald.at + DICE_ROLL_MS : herald.at
  return { from, until: from + HERALD_MS }
}

export interface ChaosHeraldProps {
  /** `ClientState.chaos.heralds`: the latest heralds, oldest first. */
  heralds: readonly ClientHerald[]
  lang: Language
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
export function ChaosHerald({ heralds, lang }: ChaosHeraldProps) {
  const { t } = useTranslation()
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)')
  /** The newest herald put away by a tap: it and every one before it stay down. */
  const [dismissed, setDismissed] = useState(0)
  const [, tick] = useReducer((n: number) => n + 1, 0)
  const now = Date.now()
  const windows = heralds.map((h) => ({ h, ...heraldWindow(h, reduce) }))
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
