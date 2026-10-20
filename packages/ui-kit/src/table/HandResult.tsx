import type { RoomView, ShowdownHand } from '@bp/core'
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClientHand } from '../client/types.js'
import { formatPoints, handLabel, type Language } from '../i18n/index.js'
import { Button } from '../primitives/Button.js'
import { cx } from '../primitives/cx.js'
import { Card } from './Card.js'
import type { RoomFrame } from './frame.js'
import { CARD_STAGGER_MS } from './motion.js'
import s from './table.module.css'

export interface HandResultProps {
  hand: ClientHand
  room: RoomView
  myPlayerId: string | null
  lang: Language
  onDismiss?: () => void
  /**
   * The room's "next hand in N seconds", printed in the card's footer beside the fee (review 2026-09-29, No2: free
   * text under the card landed on the viewer's own seat). It ticks every second, so it must stay out of the card's
   * live region, or a screen reader would read the whole receipt out again on every tick. It is outside it by
   * structure (review round 2, R2-4): the card is a group, only its head, note and body are the `status` region, and
   * the footer — this line included — follows it. It needs no `aria-live` of its own.
   */
  countdown?: ReactNode
  /**
   * The room's frame (Plan 26, B5). It is stamped on the card as `data-frame`: this module cannot name the room's own
   * hashed class, so the compact card of a phone held sideways keys its rules on the card's own attribute.
   */
  frame?: RoomFrame
}

/**
 * `HAND_CANCELLED.reason` is an operator-facing token the server picks ("shutdown", "server restart", …). It is not
 * a sentence, and it is certainly not Vietnamese, so it is normalised to a key and looked up — anything the kit
 * does not have wording for falls back to a plain "the hand was cancelled" rather than leaking the raw token.
 */
const reasonKey = (reason: string): string => {
  const words = reason.trim().toLowerCase().split(/[\s_-]+/).filter((w) => w !== '')
  if (words.length === 0) return 'other'
  return words.map((w, i) => (i === 0 ? w : w[0]!.toUpperCase() + w.slice(1))).join('')
}

/**
 * Whether a scroll box holds more below its fold: taller inside than out, and not yet scrolled to the end. Measured
 * again on every scroll and whenever the box, or anything directly in it, changes size (a narrower window, a font
 * landing, a side-pot ledger appearing); `key` names what the box shows, so a new one is observed afresh.
 */
function useMoreBelow(ref: RefObject<HTMLElement>, key: unknown): boolean {
  const [more, setMore] = useState(false)
  useEffect(() => {
    const box = ref.current
    if (box === null) return
    const measure = (): void => setMore(box.scrollHeight - box.clientHeight - box.scrollTop > 1)
    measure()
    box.addEventListener('scroll', measure, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (observer !== null) for (const el of [box, ...Array.from(box.children)]) observer.observe(el)
    return () => {
      box.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  }, [ref, key])
  return more
}

/** Showdown card: who won, with what, and for how much. Renders only for a completed hand that carries a result. */
export function HandResult({ hand, room, myPlayerId, lang, onDismiss, countdown, frame = 'desktop' }: HandResultProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const bodyRef = useRef<HTMLDivElement>(null)
  const moreBelow = useMoreBelow(bodyRef, hand.result)
  const result = hand.result
  if (hand.phase !== 'COMPLETE' || result === null) return null

  const seats = hand.seats ?? []
  const mySeat = seats.find((x) => x.playerId === myPlayerId)?.seat ?? null
  const nameOf = (seat: number): string =>
    seats.find((x) => x.seat === seat)?.displayName ?? room.players?.find((p) => p.seat === seat)?.displayName ?? String(seat)

  const showdown = new Map<number, ShowdownHand>((result.showdown ?? []).map((h) => [h.seat, h]))
  const paid = new Map<number, number>()
  for (const p of result.payouts) paid.set(p.seat, (paid.get(p.seat) ?? 0) + p.amount)

  const winners = [...paid.entries()].filter(([, amount]) => amount > 0).sort((a, b) => b[1] - a[1])
  const rest = [...showdown.keys()].filter((seat) => !paid.has(seat)).sort((a, b) => a - b)
  const rows = [...winners.map(([seat, amount]) => ({ seat, amount })), ...rest.map((seat) => ({ seat, amount: 0 }))]

  const title = result.cancelled ? t('labels.handCancelled') : winners.length > 1 ? t('labels.winners') : t('labels.winner')
  const feeText = `${t('labels.fee')} ${formatPoints(result.fee, lang)}`
  const carryText = `${t('labels.carryOver')} ${formatPoints(result.carryOverOut, lang)}`
  const uncalled = result.uncalledReturned
  const uncalledText =
    uncalled === null ? '' : `${t('labels.uncalledReturned')} ${nameOf(uncalled.seat)} ${formatPoints(uncalled.amount, lang)}`

  return (
    <div className={s.result} role="group" aria-labelledby={titleId} data-frame={frame}>
      {/* The live region stops short of the footer (review round 2, R2-4): what a screen reader announces when the card
          appears is the title, the reason a hand was cancelled, and the rows and the pot ledger. The fee, the
          carry-over, the uncalled return and the countdown that ticks every second follow it, outside every live
          region, so no tick can have the receipt read out again. They stay on the card and are read on navigation. */}
      <div className={s.resultLive} role="status">
        <div className={s.resultHead}>
          <h2 id={titleId} className={s.resultTitle}>
            {title}
          </h2>
          {onDismiss === undefined ? null : (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              {t('actions.close')}
            </Button>
          )}
        </div>

        {result.cancelled && result.reason !== null ? (
          <p className={s.resultNote}>{t(`cancel.${reasonKey(result.reason)}`, { defaultValue: t('cancel.other') })}</p>
        ) : null}

        {/* The card never grows past the felt it is dealt onto: with six hands shown down and a side pot or two, the
            ledger and the rows scroll here while the title, the close button and the footer stay put. While there is
            more below the fold, `data-more` fades the box's foot, so it reads as a list that goes on. */}
        <div ref={bodyRef} className={s.resultBody} data-more={moreBelow ? 'true' : undefined}>
          <ul className={s.resultRows}>
            {rows.map(({ seat, amount }) => {
              const hit = showdown.get(seat)
              const payoutText = `+${formatPoints(amount, lang)}`
              return (
                <li key={seat} className={cx(s.resultRow, seat === mySeat && s.resultMine)}>
                  <span className={s.resultName}>{nameOf(seat)}</span>
                  {hit === undefined ? null : <span className={s.resultHand}>{handLabel(hit.category, t)}</span>}
                  {hit === undefined ? null : (
                    <span className={s.resultCards}>
                      {hit.best.map((card, i) => (
                        <Card key={card} card={card} size="sm" delayMs={i * CARD_STAGGER_MS} highlighted={amount > 0} />
                      ))}
                    </span>
                  )}
                  {amount > 0 ? <span className={s.resultPayout}>{payoutText}</span> : null}
                </li>
              )
            })}
          </ul>

          {/* One pot needs no breakdown — `payouts` already says who took it. Two or more means somebody was all-in
              for less than the rest, and "who was eligible for which pot" is the only way that reads as fair. The
              ledger sits under the rows, as its hairline rule was drawn for: with the card capped at the felt's
              height the rows are what shows first, and the ledger is a scroll away. */}
          {result.pots.length > 1 ? (
            <ul className={s.pots}>
              {result.pots.map((pot, i) => {
                const label = i === 0 ? t('labels.mainPot') : t('labels.sidePot', { n: i })
                const eligibleText = `${t('labels.eligible')}: ${pot.eligibleSeats.map(nameOf).join(', ')}`
                return (
                  <li key={`${label}${pot.amount}`} className={s.potRow}>
                    <span className={s.potName}>{label}</span>
                    <span className={s.potAmount}>{formatPoints(pot.amount, lang)}</span>
                    <span className={s.potEligible}>{eligibleText}</span>
                    <span className={s.potWinners}>
                      {pot.winners
                        .map((w) => ({ seat: w.seat, text: `${nameOf(w.seat)} +${formatPoints(w.amount, lang)}` }))
                        .map((w) => (
                          <span key={w.seat} className={s.potWinner}>
                            {w.text}
                          </span>
                        ))}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      </div>

      <div className={s.resultFoot}>
        {result.fee > 0 ? <span className={s.resultMeta}>{feeText}</span> : null}
        {result.carryOverOut > 0 ? <span className={s.resultMeta}>{carryText}</span> : null}
        {uncalled === null ? null : <span className={s.resultMeta}>{uncalledText}</span>}
        {countdown === undefined || countdown === null ? null : <p className={s.resultNext}>{countdown}</p>}
      </div>
    </div>
  )
}
