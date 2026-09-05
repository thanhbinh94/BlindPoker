import { Badge, Button, Panel, formatPoints, type BadgeTone, type Language } from '@bp/ui-kit'
import type { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ApiError,
  type CalendarEntryDto,
  type DailyClaimDto,
  type DailyStatusDto,
  type NormalApi,
  type ReliefDto,
  type ReliefStatusDto,
} from '../api.js'
import { refusalText } from './AuthScreen.js'
import { RARITY_TONE } from './catalog.js'
import { formatMoment } from './format.js'
import s from './normal.module.css'
import { useAsync, type AsyncHandle } from './useAsync.js'

/** An amount with the unit the whole app writes after one. */
const pointsText = (amount: number, lang: Language, t: TFunction): string =>
  `${formatPoints(amount, lang)} ${t('common:units.pointsShort')}`

/**
 * The calendar's item column, as something to draw.
 *
 * A random tier cannot name its item in advance — the server picks it against the inventory at the moment of
 * the claim — so days 7, 14 and 21 advertise a *rarity* and get the wardrobe's own tone for it. Day 28 is the
 * only fixed one, and it grants two things (the month's badge and its title), so it is named as the pair
 * rather than by the single id the server puts in the column.
 */
export function markerOf(entry: CalendarEntryDto): { tone: BadgeTone; key: string } | null {
  if (entry.item === null) return null
  if (entry.item === 'common' || entry.item === 'rare') return { tone: RARITY_TONE[entry.item], key: `daily.marker.${entry.item}` }
  return { tone: 'gold', key: 'daily.marker.monthly' }
}

/**
 * Why relief was refused, in the player's language.
 *
 * The two reasons are answered differently and that is the whole point of the server sending a reason at all:
 * `balance` is "you still have points", `cooldown` is "come back at this time". A cooldown with no instant
 * attached would print an empty clock reading, so it falls through to the generic line instead.
 */
export function reliefReasonText(reason: string | null, retryAt: number | null, lang: Language, t: TFunction): string {
  if (reason === 'cooldown' && retryAt !== null) return t('daily.relief.reason.cooldown', { at: formatMoment(retryAt, lang) })
  if (reason === 'balance') return t('daily.relief.reason.balance')
  return t('daily.relief.reason.other')
}

const extraString = (extra: Record<string, unknown>, key: string): string | null =>
  typeof extra[key] === 'string' ? (extra[key] as string) : null

const extraNumber = (extra: Record<string, unknown>, key: string): number | null =>
  typeof extra[key] === 'number' ? (extra[key] as number) : null

/* ── relief ────────────────────────────────────────────────────────────────── */

interface ReliefPanelProps {
  api: NormalApi
  lang: Language
  /** Loaded by the page above, because `GET /api/me` is where the relief block is served. */
  handle: AsyncHandle<ReliefStatusDto>
}

/**
 * §12.4's safety net: a balance below the threshold may be topped up to the target, once per cooldown.
 *
 * It is a panel rather than its own route because it is the same question as the daily reward — "where do I
 * get points when I have none" — and a player who has just found the check-in empty for today is exactly the
 * player who needs to be told about this one.
 */
function ReliefPanel({ api, lang, handle }: ReliefPanelProps) {
  const { t } = useTranslation('normal')
  const [receipt, setReceipt] = useState<ReliefDto | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const status = handle.data

  const claim = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNote(null)
    try {
      setReceipt(await api.relief())
    } catch (cause) {
      setReceipt(null)
      if (cause instanceof ApiError && cause.code === 'NOT_ELIGIBLE') {
        // The server's reason wins over the one this page loaded: eligibility turns on a balance and a clock,
        // and both may have moved since. `extra` is where the refusal's own reason arrives (§19.2).
        setNote(reliefReasonText(extraString(cause.extra, 'reason'), extraNumber(cause.extra, 'retryAt'), lang, t))
      } else {
        setNote(refusalText(cause, t))
      }
    } finally {
      setBusy(false)
      handle.reload()
    }
  }

  return (
    <Panel title={t('daily.relief.title')}>
      {status === null ? (
        handle.loading ? (
          <p className={s.footnote} role="status">
            {t('screens.loading')}
          </p>
        ) : (
          <>
            <p className={s.alert} role="alert">
              {t('daily.relief.error')}
            </p>
            <p>
              <Button variant="ghost" onClick={handle.reload}>
                {t('screens.retry')}
              </Button>
            </p>
          </>
        )
      ) : (
        <>
          <p className={s.footnote}>
            {t('daily.relief.lead', { threshold: pointsText(status.threshold, lang, t), target: pointsText(status.target, lang, t) })}
          </p>
          <p className={s.footnote}>
            {status.eligible ? t('daily.relief.eligible') : reliefReasonText(status.reason, status.retryAt, lang, t)}
          </p>
          <p>
            <Button variant="gold" disabled={!status.eligible || busy} onClick={() => void claim()}>
              {busy ? t('daily.relief.claiming') : t('daily.relief.claim')}
            </Button>
          </p>
          {note === null ? null : (
            <p className={s.alert} role="alert">
              {note}
            </p>
          )}
          {receipt === null ? null : (
            <p className={s.summary} role="status">
              {t('daily.relief.granted', {
                amount: pointsText(receipt.amount, lang, t),
                balance: pointsText(receipt.balance, lang, t),
              })}
            </p>
          )}
        </>
      )}
    </Panel>
  )
}

/* ── the screen ────────────────────────────────────────────────────────────── */

export interface DailyScreenProps {
  api: NormalApi
  lang: Language
}

/**
 * Today's reward, the month behind it and the safety net under it.
 *
 * Two requests, on purpose, each with its own retry: `GET /api/rewards/daily` is the calendar's own endpoint,
 * and the relief block is only served inside `GET /api/me`. Keeping them apart means a relief read that fails
 * cannot take the calendar down with it, and each panel refreshes on the event that actually changed it.
 *
 * No balance is printed on this page beyond the claim receipts. The live one belongs to the socket's `BALANCE`
 * frame and the rail draws it; a second copy fetched here would disagree with the rail the moment a hand
 * settled in another tab.
 */
export function DailyScreen({ api, lang }: DailyScreenProps) {
  const { t } = useTranslation('normal')
  const daily = useAsync<DailyStatusDto>(() => api.daily())
  const relief = useAsync<ReliefStatusDto>(async () => (await api.me()).relief)

  const [receipt, setReceipt] = useState<DailyClaimDto | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const status = daily.data

  const claim = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNote(null)
    try {
      setReceipt(await api.claimDaily())
    } catch (cause) {
      setReceipt(null)
      setNote(cause instanceof ApiError && cause.code === 'ALREADY_CLAIMED' ? t('daily.errors.ALREADY_CLAIMED') : refusalText(cause, t))
    } finally {
      setBusy(false)
      // Both, and whichever way the claim went: a success moved the streak *and* the balance, and an
      // `ALREADY_CLAIMED` means another tab moved them while this page was looking the other way.
      daily.reload()
      relief.reload()
    }
  }

  return (
    <main className={s.page}>
      <div className={s.pageHead}>
        <h1>{t('daily.title')}</h1>
        <span className={s.rule} aria-hidden="true" />
      </div>
      <p className={s.footnote}>{t('daily.lead')}</p>

      {status === null ? (
        daily.loading ? (
          <p className={s.footnote} role="status">
            {t('screens.loading')}
          </p>
        ) : (
          <>
            <p className={s.alert} role="alert">
              {t('daily.error')}
            </p>
            <p>
              <Button variant="ghost" onClick={daily.reload}>
                {t('screens.retry')}
              </Button>
            </p>
          </>
        )
      ) : (
        <>
          <p className={s.summary}>{t('daily.streak', { streak: status.streak })}</p>
          <p className={s.footnote}>{t('daily.reward', { amount: pointsText(status.reward, lang, t) })}</p>
          <p className={s.footnote}>
            <time dateTime={new Date(status.nextResetAt).toISOString()}>
              {t('daily.resetsAt', { at: formatMoment(status.nextResetAt, lang) })}
            </time>
          </p>

          <p>
            <Button variant="gold" disabled={!status.claimable || busy} onClick={() => void claim()}>
              {busy ? t('daily.claiming') : t('daily.claim')}
            </Button>
          </p>
          {status.claimable ? null : <p className={s.footnote}>{t('daily.claimed')}</p>}
          {note === null ? null : (
            <p className={s.alert} role="alert">
              {note}
            </p>
          )}

          {receipt === null ? null : (
            <Panel title={t('daily.receipt.title', { day: receipt.day })}>
              <ul className={s.rows}>
                <li className={s.ledgerRow}>
                  <span className={s.rowTitle}>{t('daily.receipt.points')}</span>
                  <span className={s.rowValue}>{pointsText(receipt.points, lang, t)}</span>
                </li>
                {receipt.items.map((id) => (
                  <li className={s.ledgerRow} key={id}>
                    <span className={s.rowTitle}>{t('daily.receipt.item')}</span>
                    <span className={s.rowValue}>{t(`items.${id}`, { defaultValue: id })}</span>
                  </li>
                ))}
                {receipt.fallbackPoints > 0 ? (
                  <li className={s.ledgerRow}>
                    <span className={s.rowMeta}>
                      {t('daily.receipt.fallback', { amount: pointsText(receipt.fallbackPoints, lang, t) })}
                    </span>
                  </li>
                ) : null}
                <li className={s.ledgerRow}>
                  <span className={s.rowTitle}>{t('daily.receipt.balance')}</span>
                  <span className={s.rowValue}>{pointsText(receipt.balance, lang, t)}</span>
                </li>
                <li className={s.ledgerRow}>
                  <span className={s.rowMeta}>{t('daily.receipt.streak', { streak: receipt.streak })}</span>
                </li>
              </ul>
            </Panel>
          )}

          <Panel title={t('daily.calendarTitle')}>
            <ol className={s.calendar} aria-label={t('daily.calendarTitle')}>
              {status.calendar.map((entry) => {
                // `day` is the tier this claim is *for*: the one about to be taken while it is claimable, and
                // the one already taken once it is not. So the line between claimed and unclaimed moves with it.
                const claimedThrough = status.claimable ? status.day - 1 : status.day
                const claimed = entry.day <= claimedThrough
                const marker = markerOf(entry)
                const mark = claimed ? t('daily.claimedMark') : entry.day === status.day ? t('daily.todayMark') : null
                return (
                  <li
                    className={s.calCell}
                    key={entry.day}
                    data-claimed={String(claimed)}
                    {...(entry.day === status.day ? { 'aria-current': 'date' as const } : {})}
                  >
                    <span className={s.calDay}>{t('daily.dayLabel', { day: entry.day })}</span>
                    <span className={s.calPoints}>{pointsText(entry.points, lang, t)}</span>
                    {marker === null ? null : <Badge tone={marker.tone}>{t(marker.key)}</Badge>}
                    {mark === null ? null : <span className={s.rowMeta}>{mark}</span>}
                  </li>
                )
              })}
            </ol>
          </Panel>
        </>
      )}

      <ReliefPanel api={api} lang={lang} handle={relief} />
    </main>
  )
}
