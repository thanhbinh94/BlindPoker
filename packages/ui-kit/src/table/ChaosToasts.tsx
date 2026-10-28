import { Fragment, useEffect, useId, useReducer, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChaosGodCurse } from '@bp/core'
import type { AppliedChaosView } from '../client/types.js'
import type { Language } from '../i18n/index.js'
import { cx } from '../primitives/cx.js'
import { DICE_ROLL_MS, chaosDetail } from './chaos-detail.js'
import { ChaosCardInfo, tierOfCardId } from './ChaosCardInfo.js'
import { useMediaQuery } from './useMediaQuery.js'
import s from './table.module.css'

/** Between a card's line and what it did (BP-41). */
const DETAIL_SEP = ' · '

/** How long a toast stays up, counted from its arrival (spec 2026-10-27 §3.1): every toast of one batch leaves together. */
export const TOAST_MS = 4_000

/** Where the band is: a row under the header (phone upright), the top band (phone on its side), the felt's top-right (desktop). */
export type ChaosToastLayout = 'stack' | 'landscape' | 'desktop'

/** How many toasts the band shows at once, the reverse note included; the rest of a batch goes under "+N thẻ khác". */
export const TOAST_CAP: Readonly<Record<ChaosToastLayout, number>> = { stack: 3, desktop: 3, landscape: 2 }
/**
 * A phone held upright at a table of seven seats or more (`crowded`): the opponents take three rows, and at 360 × 780 the felt
 * has room for two rows of toasts, not three (BP-39 final wave, I2). The rest go under "+N thẻ khác" as ever.
 */
export const CROWDED_STACK_CAP = 2
/**
 * A phone on its side narrower than this (667 × 375, 640 × 360) has under 400 px of header between the connection pill and
 * the menu: two toasts there would each run to four lines and reach the seats, so it shows one.
 */
export const NARROW_LANDSCAPE_QUERY = '(max-width: 739px)'

export interface ChaosToastsProps {
  /** The cards that fired this hand, in the order the server applied them. */
  applied: readonly AppliedChaosView[]
  handId: string | null
  /** The hand was rebuilt from a snapshot: what it already holds has been seen, so nothing replays. */
  restored: boolean
  /** A seat's display name. */
  nameOf: (seat: number) => string
  layout: ChaosToastLayout
  /** "Thế giới đảo ngược" for the rest of the hand: a pinned toast, first in the band. `null`: none. */
  reverseNote: string | null
  /** The result is open: cards that arrive now go straight under "+N", so the band never grows over the result's time. */
  resultOpen: boolean
  /** A table of seven seats or more: upright, the band holds `CROWDED_STACK_CAP` toasts. */
  crowded?: boolean
  /** The language the points are written in (BP-41's lines say amounts). Defaults to the translation's own. */
  lang?: Language
  /** The reigning Thần's curse (`ChaosTableView.god.curse`), for the line its curse tells. */
  curse?: ChaosGodCurse | null
}

interface Toast {
  /** Its place in `applied`. */
  index: number
  /** The batch it arrived with: one timer per batch. */
  batch: number
  /** Its `TOAST_MS` are up; a pinned toast stays until it is unpinned. */
  expired: boolean
  pinned: boolean
}

interface Band {
  handId: string | null
  /** How many of `applied` have arrived (been shown or put under "+N"). */
  seen: number
  toasts: Toast[]
  /** The cards under "+N thẻ khác", as places in `applied`. */
  more: number[]
  /** The batch whose timer the "+N" toast lives by: the last one that joined it. */
  moreBatch: number | null
  /** The last batch number handed out — never reset, so a timer left from an earlier hand matches nothing. */
  batch: number
}

const fresh = (handId: string | null, seen: number, batch: number): Band => ({ handId, seen, toasts: [], more: [], moreBatch: null, batch })

/**
 * The cards that arrived since the band last looked: as many as there are free places get a toast, the rest go under "+N".
 * Nothing gets a toast while the result was already open, nor while "+N" is up (a card never jumps ahead of one waiting there).
 */
function arrive(band: Band, count: number, slots: number, resultWasOpen: boolean): Band {
  const batch = band.batch + 1
  const incoming = Array.from({ length: count - band.seen }, (_, i) => band.seen + i)
  const free = resultWasOpen || band.more.length > 0 ? 0 : Math.max(0, slots - band.toasts.length)
  const shown = incoming.slice(0, free)
  const rest = incoming.slice(free)
  return {
    ...band,
    seen: count,
    batch,
    toasts: [...band.toasts, ...shown.map((index) => ({ index, batch, expired: false, pinned: false }))],
    ...(rest.length === 0 ? {} : { more: [...band.more, ...rest], moreBatch: batch }),
  }
}

/** A template's `{{slot}}` markers replaced by nodes: the card's name is a button, so the line cannot be one string. */
function fill(template: string, slots: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\{\w+\}\})/).map((part, i) => {
    const key = /^\{\{(\w+)\}\}$/.exec(part)?.[1]
    return key !== undefined && key in slots ? <Fragment key={i}>{slots[key]}</Fragment> : part
  })
}

/**
 * The cards that fire, as toasts in a band of their own (spec 2026-10-27 §3.1): "Bot 1 dùng Rút lá lẻ → Bạn", with how it
 * went when it did not land. A batch — the reveal's cards come with the settlement — shows as many toasts as the band has
 * places (`TOAST_CAP`) and puts the rest under one "+N thẻ khác", which opens the hand's whole list; each toast leaves
 * `TOAST_MS` after it came, unless a tap pinned it (a second tap, or the next hand, lets it go). The card's name opens its
 * `ChaosCardInfo`. The band is a region of the room's layout, never a layer over the result: `RoomScreen` puts it under the
 * header on a phone held upright, across the top on one held sideways and in the felt's top-right corner on a desktop.
 *
 * A live region, so a screen reader hears each toast. A hand rebuilt from a snapshot replays nothing. Under
 * `prefers-reduced-motion` a toast shows in place, with no slide.
 */
export function ChaosToasts({ applied, handId, restored, nameOf, layout, reverseNote, resultOpen, crowded = false, lang, curse = null }: ChaosToastsProps) {
  const { t, i18n } = useTranslation()
  const language: Language = lang ?? (i18n.language === 'en' ? 'en' : 'vi')
  /** BP-41: what a round-three card did, said after its line ("Lan → Bình: 1.000"); `null` for a card that says nothing more. */
  const now = Date.now()
  const detailOf = (item: AppliedChaosView): string | null => chaosDetail(item, t, language, nameOf, curse, now)
  // A dice roll's line tells its faces once the dice land (Ruling 22): one wake at the next landing still to come.
  const [, tick] = useReducer((n: number) => n + 1, 0)
  const landing = Math.min(...applied.flatMap((x) => (x.rolledAt === undefined ? [] : [x.rolledAt + DICE_ROLL_MS])).filter((at) => at > now))
  useEffect(() => {
    if (!Number.isFinite(landing)) return
    const timer = setTimeout(tick, Math.max(0, landing - Date.now()) + 16)
    return () => clearTimeout(timer)
  }, [landing])
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)')
  const narrow = useMediaQuery(NARROW_LANDSCAPE_QUERY)
  const listId = useId()
  const [band, setBand] = useState<Band>(() => fresh(handId, restored ? applied.length : 0, 0))
  const [listOpen, setListOpen] = useState(false)
  const listOpenRef = useRef(false)
  listOpenRef.current = listOpen
  // Whether the result was open before this render: a batch that opens it (the reveal's cards come with the settlement)
  // still gets its toasts; a card that comes while it is up goes under "+N".
  const resultWasOpen = useRef(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  // Worked out in the render that brings the cards, so a toast shows in the same frame as the card's effect on the table.
  let current = band
  // A new hand, or the same hand rebuilt shorter (a reconnect's snapshot): the band starts afresh, its list closed (P3d).
  const reset = band.handId !== handId || applied.length < band.seen
  if (band.handId !== handId) current = fresh(handId, restored ? applied.length : 0, band.batch)
  else if (applied.length < band.seen) current = fresh(handId, applied.length, band.batch)
  const cap = layout === 'landscape' && narrow ? 1 : layout === 'stack' && crowded ? CROWDED_STACK_CAP : TOAST_CAP[layout]
  const slots = cap - (reverseNote === null ? 0 : 1)
  if (applied.length > current.seen) current = arrive(current, applied.length, slots, resultWasOpen.current)
  if (current !== band) setBand(current)
  if (reset && listOpen) setListOpen(false)

  useEffect(() => {
    resultWasOpen.current = resultOpen
  })

  // One timer per batch, started when the batch arrives.
  const live = new Set(current.toasts.filter((x) => !x.expired).map((x) => x.batch))
  if (current.more.length > 0 && current.moreBatch !== null) live.add(current.moreBatch)
  const liveKey = [...live].sort((a, b) => a - b).join(',')
  useEffect(() => {
    for (const batch of liveKey === '' ? [] : liveKey.split(',').map(Number)) {
      if (timers.current.has(batch)) continue
      timers.current.set(
        batch,
        setTimeout(() => {
          timers.current.delete(batch)
          setBand((prev) => ({
            ...prev,
            toasts: prev.toasts.flatMap((x) => (x.batch !== batch ? [x] : x.pinned ? [{ ...x, expired: true }] : [])),
            // "+N" leaves with its batch, unless its list is open: then it leaves when the list closes.
            ...(prev.moreBatch === batch ? (listOpenRef.current ? { moreBatch: null } : { more: [], moreBatch: null }) : {}),
          }))
        }, TOAST_MS),
      )
    }
  }, [liveKey])
  // A new hand drops the last one's timers (P3e): their batches left with the band. It runs after the effect above, so a
  // batch the new hand brought in the same render keeps the timer that effect has just started.
  const timedHand = useRef(handId)
  useEffect(() => {
    if (timedHand.current === handId) return
    timedHand.current = handId
    const kept = new Set(current.toasts.map((x) => x.batch).concat(current.moreBatch === null ? [] : [current.moreBatch]))
    for (const [batch, timer] of timers.current) {
      if (kept.has(batch)) continue
      clearTimeout(timer)
      timers.current.delete(batch)
    }
  })
  useEffect(() => {
    const all = timers.current
    return () => {
      for (const timer of all.values()) clearTimeout(timer)
      all.clear()
    }
  }, [])

  const closeList = (): void => {
    setListOpen(false)
    setBand((prev) => (prev.moreBatch === null && prev.more.length > 0 ? { ...prev, more: [] } : prev))
  }
  // The list closes on a press outside "+N" and its list, and on `Esc`.
  useEffect(() => {
    if (!listOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && moreRef.current?.contains(event.target) === true) return
      closeList()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeList()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [listOpen])

  const togglePin = (index: number, event: MouseEvent): void => {
    // A tap on the card's name opens its popup; it does not pin the toast.
    if (event.target instanceof Element && event.target.closest('button') !== null) return
    setBand((prev) => ({
      ...prev,
      toasts: prev.toasts.flatMap((x) => (x.index !== index ? [x] : x.pinned && x.expired ? [] : [{ ...x, pinned: !x.pinned }])),
    }))
  }

  const cardName = (cardId: string): string => t(`chaos.cards.${cardId}.name`, { defaultValue: cardId })
  const outcomeOf = (item: AppliedChaosView): string | null => (item.outcome === 'applied' ? null : t(`chaos.outcome.${item.outcome}`))
  /**
   * Whom the line names. The Thần's curse (BP-41: Cá chép with no reign) falls on every other seat at the table — its detail
   * says so and who paid whom — so the line does not list the whole table.
   */
  const targetsOf = (item: AppliedChaosView): number[] => (item.effect === 'carp' && item.reign === undefined ? [] : item.targets)
  /** The line as plain words, for the "+N" list. */
  const lineOf = (item: AppliedChaosView): string => {
    const name = nameOf(item.seat)
    if (item.reign === 'godslain') return t('chaos.toast.godslain', { slayer: item.targets.map(nameOf).join(', '), god: name })
    const card = cardName(item.cardId)
    const aimed = targetsOf(item)
    const text =
      aimed.length === 0
        ? t('chaos.toast.use', { name, card })
        : t('chaos.toast.useOn', { name, card, targets: aimed.map(nameOf).join(', ') })
    const outcome = outcomeOf(item)
    const detail = detailOf(item)
    const told = outcome === null ? text : `${text} — ${outcome}`
    return detail === null ? told : `${told} · ${detail}`
  }

  const toasts = current.toasts.flatMap((toast) => {
    const item = applied[toast.index]
    if (item === undefined) return []
    const name = nameOf(item.seat)
    const targets = targetsOf(item).map(nameOf)
    // The fall of a Thần is its own line, "Bình hạ Thần Bài Lan" (the event's seat is the Thần, its targets who beat it), not
    // a card played on someone (BP-41 fix wave 28).
    if (item.reign === 'godslain') {
      return [
        <div
          key={`t${toast.index}`}
          className={cx(s.chaosToast, !reduce && s.chaosToastIn)}
          data-chaos-toast=""
          data-tier={tierOfCardId(item.cardId)}
          data-outcome={item.outcome}
          data-reign="godslain"
          data-pinned={toast.pinned ? 'true' : undefined}
          onClick={(event) => togglePin(toast.index, event)}
        >
          {fill(t('chaos.toast.godslain', { slayer: '{{slayer}}', god: '{{god}}' }), {
            slayer: <strong className={s.chaosToastName}>{targets.join(', ')}</strong>,
            god: <strong className={s.chaosToastName}>{name}</strong>,
          })}
        </div>,
      ]
    }
    const template =
      targets.length === 0
        ? t('chaos.toast.use', { name: '{{name}}', card: '{{card}}' })
        : t('chaos.toast.useOn', { name: '{{name}}', card: '{{card}}', targets: '{{targets}}' })
    const outcome = outcomeOf(item)
    const detail = detailOf(item)
    return [
      <div
        key={`t${toast.index}`}
        className={cx(s.chaosToast, !reduce && s.chaosToastIn)}
        data-chaos-toast=""
        data-tier={tierOfCardId(item.cardId)}
        data-outcome={item.outcome}
        data-pinned={toast.pinned ? 'true' : undefined}
        onClick={(event) => togglePin(toast.index, event)}
      >
        {fill(template, {
          name: <strong className={s.chaosToastName}>{name}</strong>,
          card: (
            <ChaosCardInfo cardId={item.cardId} use={{ by: name, targets, outcome: item.outcome }} className={s.chaosToastCard}>
              {cardName(item.cardId)}
            </ChaosCardInfo>
          ),
          targets: <strong className={s.chaosToastName}>{targets.join(', ')}</strong>,
        })}
        {outcome === null ? null : <span className={s.chaosToastOutcome}>{outcome}</span>}
        {detail === null ? null : (
          <span className={s.chaosToastDetail}>
            {DETAIL_SEP}
            {detail}
          </span>
        )}
      </div>,
    ]
  })

  const moreShown = current.more.length > 0
  const empty = reverseNote === null && toasts.length === 0 && !moreShown

  return (
    <div className={s.chaosToastBand} data-chaos-toasts="" data-layout={layout} data-empty={empty ? 'true' : undefined} data-list-open={listOpen && moreShown ? 'true' : undefined} data-surface="night">
      {/* A live region that reads out what is added, never the whole band again (P3c). */}
      <div className={s.chaosToasts} role="status" aria-atomic="false" aria-relevant="additions">
        {reverseNote === null ? null : (
          <p className={cx(s.chaosToast, s.chaosToastNote)} data-chaos-toast="" data-chaos-note="" data-pinned="true">
            {reverseNote}
          </p>
        )}
        {toasts}
        {moreShown ? (
          <div ref={moreRef} className={cx(s.chaosToast, s.chaosToastMore, !reduce && s.chaosToastIn)} data-chaos-toast="" data-more="">
            <button
              type="button"
              className={s.chaosToastMoreButton}
              aria-expanded={listOpen}
              aria-controls={listOpen ? listId : undefined}
              onClick={() => (listOpen ? closeList() : setListOpen(true))}
            >
              {t('chaos.toast.more', { count: current.more.length })}
            </button>
            {listOpen ? (
              // The list the player opened is not news: `aria-live="off"` keeps it out of the live region around it (P3c).
              <ol id={listId} className={s.chaosToastList} aria-label={t('chaos.toast.all')} aria-live="off">
                {applied.map((item, i) => (
                  <li key={i} data-tier={tierOfCardId(item.cardId)} data-outcome={item.outcome}>
                    {lineOf(item)}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
