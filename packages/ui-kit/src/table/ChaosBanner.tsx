import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppliedChaosView } from '../client/types.js'
import { cx } from '../primitives/cx.js'
import { tierOfCardId } from './ChaosCardIcon.js'
import { useMediaQuery } from './useMediaQuery.js'
import s from './table.module.css'

/** How long each card that fires stays up (spec 2026-10-26 §7): long enough to read one line, short enough for a queue of five. */
export const BANNER_MS = 900

interface Shown {
  handId: string | null
  /** How many of `applied` have already had their turn: the one at this index is the one up now. */
  count: number
}

/**
 * The queue of cards that fired this hand, one at a time, `BANNER_MS` each, in the order the server sent them. Returns the
 * item up now and its place in the queue, or a `null` item when the queue is empty or has run dry.
 *
 * The item is worked out in the render that brings it, never in an effect after it: `RoomScreen` holds the result card for
 * as long as this is not `null`, and an effect would let one frame of the card through. A new hand starts the queue afresh;
 * a hand rebuilt from a snapshot (`skipExisting`) counts the items it already holds as shown — a reconnect must not replay
 * the last hand's cards at the table.
 */
export function useChaosBanner(applied: readonly AppliedChaosView[], handId: string | null, skipExisting: boolean): { item: AppliedChaosView | null; index: number } {
  const [shown, setShown] = useState<Shown>(() => ({ handId, count: skipExisting ? applied.length : 0 }))
  let current = shown
  if (shown.handId !== handId || applied.length < shown.count) {
    current = { handId, count: skipExisting && shown.handId !== handId ? applied.length : 0 }
    setShown(current)
  }
  const item = applied[current.count] ?? null
  const at = current.count
  useEffect(() => {
    if (item === null) return
    const timer = setTimeout(() => setShown((prev) => (prev.handId === handId && prev.count === at ? { handId, count: at + 1 } : prev)), BANNER_MS)
    return () => clearTimeout(timer)
  }, [item, at, handId])
  return { item, index: at }
}

export interface ChaosBannerProps {
  item: AppliedChaosView | null
  /** The item's place in the queue, so two identical cards in a row both slide in. */
  index?: number
  /** A seat's display name. */
  nameOf: (seat: number) => string
}

/**
 * "Phương Anh dùng Đổi lá": the card that has just fired, over the board. A card another card stopped says so after it
 * (`Bị chặn`, `Bị phản lại`, `Không có tác dụng`). A live region, so a screen reader hears each one as it comes; under
 * `prefers-reduced-motion` it shows in place with no slide, and only the item changes.
 */
export function ChaosBanner({ item, index = 0, nameOf }: ChaosBannerProps) {
  const { t } = useTranslation()
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)')
  let line = ''
  let outcome: string | null = null
  if (item !== null) {
    const card = t(`chaos.cards.${item.cardId}.name`, { defaultValue: item.cardId })
    const name = nameOf(item.seat)
    line =
      item.targets.length === 0
        ? t('chaos.banner.use', { name, card })
        : t('chaos.banner.useOn', { name, card, targets: item.targets.map(nameOf).join(', ') })
    outcome = item.outcome === 'applied' ? null : t(`chaos.outcome.${item.outcome}`)
  }
  return (
    <div className={s.chaosBannerSlot} role="status">
      {item === null ? null : (
        <p
          // A new item is a new element, so the slide plays for each; without motion it is the same line in place.
          key={index}
          className={cx(s.chaosBanner, !reduce && s.chaosBannerIn)}
          data-tier={tierOfCardId(item.cardId)}
          data-outcome={item.outcome}
          title={outcome === null ? line : `${line} — ${outcome}`}
        >
          <span className={s.chaosBannerText}>{line}</span>
          {outcome === null ? null : <span className={s.chaosBannerOutcome}>{outcome}</span>}
        </p>
      )}
    </div>
  )
}
