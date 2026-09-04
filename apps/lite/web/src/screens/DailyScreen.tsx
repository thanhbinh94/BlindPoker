import { ECONOMY } from '@bp/core'
import { Badge, Button, Panel, formatPoints, type Language } from '@bp/ui-kit'
import type { TFunction } from 'i18next'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, type LiteApi, type MeDto } from '../api.js'
import s from './lite.module.css'

const SEAL = '✦'
const WARN = '!'

/** Refusals this screen has words for; anything else is "could not load", which is what it is. */
const DAILY_CODES = new Set(['ALREADY_CLAIMED', 'NOT_ELIGIBLE'])

/**
 * A refused claim is not a failure of the screen: the server has decided today is already spent, or
 * that relief is not owed yet. Say which, rather than the generic "could not load the daily reward"
 * a player would otherwise get for a perfectly well-understood answer.
 */
function refusalText(cause: unknown, t: TFunction): string {
  if (cause instanceof ApiError && DAILY_CODES.has(cause.code)) return t(`daily.errors.${cause.code}`)
  return t('daily.error')
}

const LOCALE: Record<Language, string> = { vi: 'vi-VN', en: 'en-US' }

function formatMoment(at: number, lang: Language): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: 'short', timeStyle: 'short' }).format(new Date(at))
}

export interface DailyScreenProps {
  api: LiteApi
  token: string
  lang: Language
}

/**
 * The daily reward, and the safety net under it.
 *
 * Every number on this page comes from the server — the streak, the tier, whether today is still open — because
 * the calendar day is the server's timezone, not the device's. The balance it moves is not shown here: the claim
 * pushes a `BALANCE` frame down the socket and the rail above updates itself.
 */
export function DailyScreen({ api, token, lang }: DailyScreenProps) {
  const { t } = useTranslation('lite')
  const [me, setMe] = useState<MeDto | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<string | null>(null)
  const [busy, setBusy] = useState<'daily' | 'relief' | null>(null)

  // Amount and unit are one string on purpose: "3.000" alone beside a stray symbol reads as money, not points.
  const points = (n: number): string => `${formatPoints(n, lang)} ${t('common:units.pointsShort')}`

  const load = useCallback(async (): Promise<void> => {
    try {
      setMe(await api.me(token))
      setFailure(null)
    } catch {
      setFailure(t('daily.error'))
    }
  }, [api, t, token])

  useEffect(() => {
    void load()
  }, [load])

  const claim = async (): Promise<void> => {
    setBusy('daily')
    try {
      const result = await api.claimDaily(token)
      setReceipt(t('daily.receipt', { points: formatPoints(result.points, lang), streak: result.streak }))
      await load()
    } catch (cause) {
      // Reload either way: a refusal means this screen's picture of the day is out of date.
      await load()
      setFailure(refusalText(cause, t))
    } finally {
      setBusy(null)
    }
  }

  const takeRelief = async (): Promise<void> => {
    setBusy('relief')
    try {
      const result = await api.relief(token)
      setReceipt(t('daily.relief.receipt', { amount: formatPoints(result.amount, lang) }))
      await load()
    } catch (cause) {
      await load()
      setFailure(refusalText(cause, t))
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className={s.page}>
      <div className={s.pageHead}>
        <h1 className={s.pageTitle}>{t('daily.title')}</h1>
        <span className={s.rule} aria-hidden="true" />
      </div>

      {receipt === null ? null : (
        <p className={s.receipt} role="status">
          <span className={s.slipGlyph} aria-hidden="true">
            {SEAL}
          </span>
          {receipt}
        </p>
      )}
      {failure === null ? null : (
        <p className={s.alert} role="alert">
          <span className={s.slipGlyph} aria-hidden="true">
            {WARN}
          </span>
          {failure}
        </p>
      )}

      {me === null ? (
        failure !== null ? null : (
          <p className={s.loading} aria-busy="true">
            {t('daily.loading')}
          </p>
        )
      ) : (
        <>
          <Panel tone="ink">
            <div className={s.card}>
              <div className={s.seal}>
                <span className={s.sealEyebrow}>{t('daily.streak')}</span>
                <strong className={s.sealNumber}>{formatPoints(me.daily.streak, lang)}</strong>
                <span className={s.sealDay}>{t('daily.day', { day: me.daily.day })}</span>
              </div>

              <div className={s.reward}>
                <span className={s.eyebrow}>{t('daily.todayReward')}</span>
                {me.daily.alreadyClaimed ? (
                  <Badge tone="teal">{t('daily.claimed')}</Badge>
                ) : (
                  <strong className={s.rewardPoints}>{points(me.daily.points)}</strong>
                )}
                <Button variant="gold" size="lg" disabled={!me.daily.allowed} loading={busy === 'daily'} onClick={() => void claim()}>
                  {t('daily.claim')}
                </Button>
              </div>
            </div>

            <p className={s.next}>
              <span>{t('daily.next')}</span>
              <strong className={s.nextPoints}>{points(me.daily.nextPoints)}</strong>
              <span>{t('daily.day', { day: me.daily.nextDay })}</span>
            </p>
          </Panel>

          <p className={s.footnote}>{t('daily.monthlyReset')}</p>

          {me.relief.reason === 'balance' ? null : (
            <Panel tone="ink" title={t('daily.relief.title')}>
              <div className={s.relief}>
                <p className={s.cooldown}>
                  {t('daily.relief.lead', {
                    threshold: formatPoints(ECONOMY.reliefThreshold, lang),
                    target: formatPoints(ECONOMY.reliefTarget, lang),
                    hours: ECONOMY.reliefCooldownHours,
                  })}
                </p>
                {me.relief.eligible ? (
                  <Button variant="primary" loading={busy === 'relief'} onClick={() => void takeRelief()}>
                    {t('daily.relief.button')}
                  </Button>
                ) : (
                  <p className={s.cooldown}>
                    {t('daily.relief.cooldown', { at: me.relief.retryAt === null ? '' : formatMoment(me.relief.retryAt, lang) })}
                  </p>
                )}
              </div>
            </Panel>
          )}
        </>
      )}
    </main>
  )
}
