import { Button, Panel, formatPoints, type Language } from '@bp/ui-kit'
import type { TFunction } from 'i18next'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ApiError,
  type DailyClaimDto,
  type DailyStatusDto,
  type NormalApi,
  type ReliefDto,
  type ReliefStatusDto,
} from '../api.js'
import { itemName } from '../catalog-i18n.js'
import { markClaimedToday } from '../daily-nudge.js'
import { DailyCalendar } from './DailyCalendar.js'
import { formatMoment } from './format.js'
import s from './normal.module.css'
import { refusalText } from './refusal.js'
import { useAsync, type AsyncHandle } from './useAsync.js'

/**
 * The line explaining a disabled claim button, so the button can point at it.
 *
 * A fixed id rather than `useId`: this screen renders once per visit and there is exactly one claim button on
 * it. A natively `disabled` button is not focusable, so few readers will ever hear the description — but the
 * wiring is what makes an `aria-disabled` button later a one-line change rather than a bug.
 */
const CLAIMED_NOTE_ID = 'bp-daily-claimed'

/** An amount with the unit the whole app writes after one. */
const pointsText = (amount: number, lang: Language, t: TFunction): string =>
  `${formatPoints(amount, lang)} ${t('common:units.pointsShort')}`

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
  /**
   * How many `reset_checkin` notices from a game master this tab has seen (the app counts them). A change means
   * today's claim was taken back while the page was open: the page forgets its receipt and reads its status again,
   * so the claim button comes back without a reload (Plan 26, Ruling 11).
   */
  checkinResets?: number
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
export function DailyScreen({ api, lang, checkinResets = 0 }: DailyScreenProps) {
  const { t } = useTranslation('normal')
  const daily = useAsync<DailyStatusDto>(() => api.daily())
  const relief = useAsync<ReliefStatusDto>(async () => (await api.me()).relief)

  const [receipt, setReceipt] = useState<DailyClaimDto | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // The count the page mounted with is already in what it fetched; only a later one is news.
  const resetsSeen = useRef(checkinResets)
  const { reload: reloadDaily } = daily
  const { reload: reloadRelief } = relief
  useEffect(() => {
    if (resetsSeen.current === checkinResets) return
    resetsSeen.current = checkinResets
    setReceipt(null)
    setNote(null)
    reloadDaily()
    reloadRelief()
  }, [checkinResets, reloadDaily, reloadRelief])

  const status = daily.data

  const claim = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNote(null)
    try {
      setReceipt(await api.claimDaily())
      markClaimedToday()
    } catch (cause) {
      setReceipt(null)
      const taken = cause instanceof ApiError && cause.code === 'ALREADY_CLAIMED'
      // Refused as already claimed is the same news for the rail's dot: today's reward is gone.
      if (taken) markClaimedToday()
      setNote(taken ? t('daily.errors.ALREADY_CLAIMED') : refusalText(cause, t))
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
          {/* Not `status.streak`. While the day is claimable the server sends the streak the claim *would*
              reach, so printing it raw would say "5 days" over a calendar marking four — and would greet a
              player who has never claimed with a streak of one. `streak - 1` is exact on that branch, because
              `nextStreak` returns `previous + 1` there, and a broken or first-ever streak lands on 0. */}
          {/* One card for today: the streak, what today pays and when the day turns, with the button beside them
              (layout audit C6, 2026-09-28 — these were three loose lines and a button above the calendar). */}
          <div className={s.dailySummary}>
            <div className={s.dailyFacts}>
              <p className={s.summary}>{t('daily.streak', { streak: status.claimable ? status.streak - 1 : status.streak })}</p>
              <p className={s.footnote}>{t('daily.reward', { amount: pointsText(status.reward, lang, t) })}</p>
              <p className={s.footnote}>
                <time dateTime={new Date(status.nextResetAt).toISOString()}>
                  {t('daily.resetsAt', { at: formatMoment(status.nextResetAt, lang) })}
                </time>
              </p>
            </div>
            <div className={s.dailyAction}>
              <Button
                variant="gold"
                size="lg"
                disabled={!status.claimable || busy}
                onClick={() => void claim()}
                {...(status.claimable ? {} : { 'aria-describedby': CLAIMED_NOTE_ID })}
              >
                {busy ? t('daily.claiming') : t('daily.claim')}
              </Button>
              {status.claimable ? null : (
                <p className={s.footnote} id={CLAIMED_NOTE_ID}>
                  {t('daily.claimed')}
                </p>
              )}
            </div>
          </div>
          {note === null ? null : (
            <p className={s.alert} role="alert">
              {note}
            </p>
          )}

          {/* A live region around the whole receipt, matching the relief panel's: the button label flips back
              from "claiming" and nothing else about the page announces itself, so without this a screen-reader
              user hears silence where the points, the item and the new balance are. */}
          {receipt === null ? null : (
            <div role="status">
            <Panel title={t('daily.receipt.title', { day: receipt.day })}>
              <ul className={s.rows}>
                <li className={s.ledgerRow}>
                  <span className={s.rowTitle}>{t('daily.receipt.points')}</span>
                  <span className={s.rowValue}>{pointsText(receipt.points, lang, t)}</span>
                </li>
                {receipt.items.map((id) => (
                  <li className={s.ledgerRow} key={id}>
                    <span className={s.rowTitle}>{t('daily.receipt.item')}</span>
                    <span className={s.rowValue}>{itemName(id, t)}</span>
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
            </div>
          )}

          <Panel title={t('daily.calendarTitle')}>
            <p className={s.footnote}>{t('daily.calendarLead')}</p>
            <DailyCalendar entries={status.calendar} month={status.month} day={status.day} claimable={status.claimable} lang={lang} />
          </Panel>
        </>
      )}

      <ReliefPanel api={api} lang={lang} handle={relief} />
    </main>
  )
}
