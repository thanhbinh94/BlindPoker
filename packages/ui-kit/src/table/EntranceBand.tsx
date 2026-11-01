import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClientDiceRoll, ClientEntrance, ClientHerald } from '../client/types.js'
import { cx } from '../primitives/cx.js'
import { DICE_MS } from './chaos-detail.js'
import { heraldWindow } from './ChaosHerald.js'
import { FRESH_MS, scheduleEntrances, type Span } from './entrance-schedule.js'
import type { HeraldHold } from './useHeldWindow.js'
import { useMediaQuery } from './useMediaQuery.js'
import s from './table.module.css'

export interface UseEntrancesOptions {
  /** `ClientState.entrances`: the room's latest entrances, oldest first. */
  entrances: readonly ClientEntrance[]
  /** `ClientState.chaos.heralds` (`[]` at a table without chaos): their windows hold the band. */
  heralds: readonly ClientHerald[]
  /** `ClientState.chaos.rolls` (`[]` without chaos): the dice panel's 3 s hold the band. */
  rolls: readonly ClientDiceRoll[]
  /** The result's reveal hold, from the room's one `useHeldWindow` (A7): nothing shows inside it. */
  hold: HeraldHold | null
}

export interface EntrancesNow {
  /** The entrance on the band now, or `null`. */
  shown: ClientEntrance | null
  /**
   * True on the first committed render that shows `shown`, if it began less than `FRESH_MS` ago — the cue for its stinger. False
   * on every later render, and for one first seen late (a snapshot, a reconnect, a remount).
   */
  fresh: boolean
  /** When `shown` began on the band (client time; 0 with none): it runs until `since + ENTRANCE_MS` unless it is put away or cut. */
  since: number
  /** Puts the shown entrance away (a tap on the band): it ends now, and the next may start at once. */
  dismiss: () => void
}

interface Kept {
  /** Entrances that have been on screen: id → when they first showed. They keep that start (`scheduleEntrances`). */
  started: ReadonlyMap<number, number>
  /** Entrances whose time is over — dismissed, cut short, run out: id → when they ended. Nothing brings them back. */
  ended: ReadonlyMap<number, number>
}

const KEPT_NONE: Kept = { started: new Map(), ended: new Map() }

/**
 * Runs `scheduleEntrances` in time (BP-42 spec §4): which entrance is on the band now, whether it has just begun, and a dismiss.
 * It keeps the started and ended entrances in state and wakes at the next boundary, as `ChaosHerald` does.
 */
export function useEntrances({ entrances, heralds, rolls, hold }: UseEntrancesOptions): EntrancesNow {
  const [kept, setKept] = useState<Kept>(KEPT_NONE)
  const [, tick] = useReducer((n: number) => n + 1, 0)
  const now = Date.now()
  const busy: Span[] = [...heralds.map((h) => heraldWindow(h, hold)), ...rolls.map((r) => ({ from: r.at, until: r.at + DICE_MS }))]
  const slots = scheduleEntrances(entrances, busy, hold, kept.started, kept.ended, now)
  let shown: ClientEntrance | null = null
  let shownFrom = 0
  let next = Number.POSITIVE_INFINITY
  for (const e of entrances) {
    const slot = slots.get(e.id)
    if (slot === undefined || typeof slot === 'string') continue
    if (slot.from <= now && now < slot.until) {
      shown = e
      shownFrom = slot.from
    }
    for (const at of [slot.from, slot.until]) if (at > now && at < next) next = at
  }

  // What this render learnt for the next ones (React's pattern for what earlier renders knew): the entrance it shows has started;
  // a started one whose time is over has ended, so a hold or a herald that changes later cannot bring it back. Entrances the room
  // no longer lists are forgotten.
  const ids = new Set(entrances.map((e) => e.id))
  const started = new Map([...kept.started].filter(([id]) => ids.has(id)))
  const ended = new Map([...kept.ended].filter(([id]) => ids.has(id)))
  if (shown !== null && !started.has(shown.id)) started.set(shown.id, shownFrom)
  for (const [id] of started) {
    const slot = slots.get(id)
    if (!ended.has(id) && slot !== undefined && typeof slot !== 'string' && slot.until <= now) ended.set(id, slot.until)
  }
  const sameMap = (a: ReadonlyMap<number, number>, b: ReadonlyMap<number, number>): boolean =>
    a.size === b.size && [...a].every(([id, at]) => b.get(id) === at)
  if (!sameMap(started, kept.started) || !sameMap(ended, kept.ended)) setKept({ started, ended })

  useEffect(() => {
    if (!Number.isFinite(next)) return
    const timer = setTimeout(tick, Math.max(0, next - Date.now()) + 16)
    return () => clearTimeout(timer)
  }, [next])

  // `fresh` for one committed render: the effect notes the id once the render that showed it is on screen.
  const announced = useRef<number | null>(null)
  const shownId = shown?.id ?? null
  const fresh = shown !== null && announced.current !== shown.id && now - shownFrom < FRESH_MS
  useEffect(() => {
    if (shownId !== null) announced.current = shownId
  }, [shownId])

  const dismiss = useCallback(() => {
    if (shownId === null) return
    const at = Date.now()
    setKept((k) => (k.ended.has(shownId) ? k : { started: k.started, ended: new Map([...k.ended, [shownId, at]]) }))
  }, [shownId])

  return { shown, fresh, since: shownFrom, dismiss }
}

export interface EntranceBandProps {
  /** `useEntrances().shown`. */
  entrance: ClientEntrance | null
  /** `useEntrances().dismiss`: a tap anywhere on the band puts it away. */
  onDismiss: () => void
}

/**
 * A Thần title's entrance (BP-42 spec §4): when a player wearing Thần Bài, Bán Thần or Kẻ Sát Thần sits down, one band across the
 * screen in the same slot, shape and motion as the Thần's herald (`ChaosHerald`), in the title's colours — the Thần Bài's gold on
 * red, the Bán Thần's white, silver and pale gold, the Kẻ Sát Thần's black and crimson. It shows what `useEntrances` gives it, one
 * at a time, never over the herald, the dice or the result's reveal hold. A live region (assertive); a tap puts it away. Under
 * `prefers-reduced-motion` the words simply show.
 *
 * Its lines carry no `data-kind`: the BP-41 watchers read `button[data-herald] [data-kind]` for the herald's own lines (A17).
 */
export function EntranceBand({ entrance, onDismiss }: EntranceBandProps) {
  const { t } = useTranslation()
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)')
  return (
    <div className={s.heraldSlot} role="status" aria-live="assertive" aria-label={t('entrance.label')}>
      {entrance === null ? null : (
        <button
          key={entrance.id}
          type="button"
          className={cx(s.herald, s.entrance, !reduce && s.heraldMotion)}
          data-herald="entrance"
          data-title={entrance.title}
          onClick={onDismiss}
        >
          <span className={s.heraldLine}>{t(`entrance.${entrance.title}`, { name: entrance.name })}</span>
        </button>
      )}
    </div>
  )
}
