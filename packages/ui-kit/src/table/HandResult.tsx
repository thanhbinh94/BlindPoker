import type { RoomView, ShowdownHand } from '@bp/core'
import { useTranslation } from 'react-i18next'
import type { ClientHand } from '../client/types.js'
import { formatPoints, handLabel, type Language } from '../i18n/index.js'
import { Button } from '../primitives/Button.js'
import { cx } from '../primitives/cx.js'
import { Card } from './Card.js'
import s from './table.module.css'

export interface HandResultProps {
  hand: ClientHand
  room: RoomView
  myPlayerId: string | null
  lang: Language
  onDismiss?: () => void
}

/** Showdown card: who won, with what, and for how much. Renders only for a completed hand that carries a result. */
export function HandResult({ hand, room, myPlayerId, lang, onDismiss }: HandResultProps) {
  const { t } = useTranslation()
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
    <div className={s.result} role="status">
      <div className={s.resultHead}>
        <h2 className={s.resultTitle}>{title}</h2>
        {onDismiss === undefined ? null : (
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            {t('actions.close')}
          </Button>
        )}
      </div>

      {result.cancelled && result.reason !== null ? <p className={s.resultNote}>{result.reason}</p> : null}

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
                    <Card key={card} card={card} size="sm" delayMs={i * 60} highlighted={amount > 0} />
                  ))}
                </span>
              )}
              {amount > 0 ? <span className={s.resultPayout}>{payoutText}</span> : null}
            </li>
          )
        })}
      </ul>

      <div className={s.resultFoot}>
        {result.fee > 0 ? <span className={s.resultMeta}>{feeText}</span> : null}
        {result.carryOverOut > 0 ? <span className={s.resultMeta}>{carryText}</span> : null}
        {uncalled === null ? null : <span className={s.resultMeta}>{uncalledText}</span>}
      </div>
    </div>
  )
}
