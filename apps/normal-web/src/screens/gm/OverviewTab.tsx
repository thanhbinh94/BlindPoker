import { Button, Panel, Segmented, formatDay, formatPoints } from '@bp/ui-kit'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DaySumsDto } from '../../api.js'
import { formatSigned } from '../format.js'
import { reasonLabel } from '../LedgerPanel.js'
import s from '../normal.module.css'
import { useAsync } from '../useAsync.js'
import g from './gm.module.css'
import type { GmTabProps } from './tabProps.js'

const COUNTS = ['online', 'rooms', 'accounts', 'locked', 'gms'] as const

/** The state of the house at a glance: who is here, how many rooms, and where the last day's points came from and went. */
export function OverviewTab({ api, lang }: GmTabProps) {
  const { t } = useTranslation('normal')
  const overview = useAsync(() => api.gmOverview())
  const data = overview.data

  if (data === null) {
    return overview.loading ? (
      <p className={s.footnote} role="status">
        {t('screens.loading')}
      </p>
    ) : (
      <div className={g.stack}>
        <p className={s.alert} role="alert">
          {t('gm.overview.error')}
        </p>
        <p>
          <Button variant="ghost" onClick={overview.reload}>
            {t('screens.retry')}
          </Button>
        </p>
      </div>
    )
  }

  return (
    <div className={g.stack}>
      <dl className={g.tiles}>
        {COUNTS.map((key) => (
          <div className={g.tile} key={key}>
            <dt>{t(`gm.overview.${key}`)}</dt>
            <dd className={g.tileValue}>{formatPoints(data[key], lang)}</dd>
          </div>
        ))}
      </dl>

      {/* Plan 27: how many accounts stand at each rank — "Tân binh 12 · Tay bài 5 · …". */}
      <p className={s.footnote}>
        {t('gm.overview.reputation', {
          counts: data.reputation.byRank
            .map((count, i) => t('gm.overview.rankCount', { rank: t(`game:rank.${i + 1}`, { defaultValue: String(i + 1) }), n: formatPoints(count, lang) }))
            .join(' · '),
        })}
      </p>

      <Panel title={t('gm.overview.points24h')}>
        <div className={g.stack}>
          <dl className={g.tiles}>
            <div className={g.tile}>
              <dt>{t('gm.overview.sources')}</dt>
              <dd className={`${g.tileValue} ${g.up}`}>{formatSigned(data.points24h.sources, lang)}</dd>
            </div>
            <div className={g.tile}>
              <dt>{t('gm.overview.sinks')}</dt>
              <dd className={`${g.tileValue} ${g.down}`}>{formatSigned(-Math.abs(data.points24h.sinks) || 0, lang)}</dd>
            </div>
          </dl>
          <div className={g.tableWrap}>
            <table className={g.table}>
              <thead>
                <tr>
                  <th scope="col">{t('gm.overview.reasonColumn')}</th>
                  <th scope="col" className={g.num}>
                    {t('gm.overview.total')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.points24h.byReason.map((row) => (
                  <tr key={row.reason}>
                    <td>{reasonLabel(row.reason, t)}</td>
                    <td className={g.num}>{formatSigned(row.total, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <Button variant="ghost" loading={overview.loading} onClick={overview.reload}>
              {t('gm.overview.refresh')}
            </Button>
          </p>
        </div>
      </Panel>

      <ByDayPanel api={api} lang={lang} />
    </div>
  )
}

type Range = '7' | '30'

const sum = (byReason: Record<string, number>): number => Object.values(byReason).reduce((a, b) => a + b, 0)
const percent = (value: number, max: number): number => (max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0)

/**
 * Sources and sinks per economy day, for a week or a month: a table whose last column draws the two sums as bars, so a
 * day that stands out reads at a glance, and the numbers beside them stay for the exact figure. Both bars share one
 * scale — the largest single sum of the range — so they compare with each other and across days. No chart library
 * (spec Q4): a bar is a `span` with an inline width.
 */
function ByDayPanel({ api, lang }: Pick<GmTabProps, 'api' | 'lang'>) {
  const { t } = useTranslation('normal')
  const [range, setRange] = useState<Range>('7')
  const [attempt, setAttempt] = useState(0)
  const [rows, setRows] = useState<DaySumsDto[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setFailed(false)
    api.gmDailyStats(range === '7' ? 7 : 30).then(
      (next) => {
        if (alive) setRows(next)
      },
      () => {
        if (alive) setFailed(true)
      },
    )
    return () => {
      alive = false
    }
  }, [api, range, attempt])

  // The old range's rows would sit under the new range's label until the reply came: clear them with the choice.
  const choose = (next: Range) => {
    if (next === range) return
    setRows(null)
    setRange(next)
  }
  const options = [
    { value: '7' as const, label: t('gm.overview.days7') },
    { value: '30' as const, label: t('gm.overview.days30') },
  ]
  const totals = (rows ?? []).map((row) => ({ row, sources: sum(row.sources), sinks: sum(row.sinks) }))
  const max = Math.max(0, ...totals.flatMap((total) => [total.sources, total.sinks]))

  let body
  if (failed) {
    body = (
      <div className={g.stack}>
        <p className={s.alert} role="alert">
          {t('gm.overview.byDayError')}
        </p>
        <p>
          <Button variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
            {t('screens.retry')}
          </Button>
        </p>
      </div>
    )
  } else if (rows === null) {
    body = (
      <p className={s.footnote} role="status">
        {t('screens.loading')}
      </p>
    )
  } else if (max === 0) {
    body = <p className={s.footnote}>{t('gm.overview.byDayEmpty')}</p>
  } else {
    body = (
      <div className={g.tableWrap}>
        <table className={`${g.table} ${g.byDay}`} aria-label={t('gm.overview.byDay')}>
          <thead>
            <tr>
              <th scope="col">{t('gm.overview.colDay')}</th>
              <th scope="col" className={g.num}>
                {t('gm.overview.colSources')}
              </th>
              <th scope="col" className={g.num}>
                {t('gm.overview.colSinks')}
              </th>
              <th scope="col" className={g.num}>
                {t('gm.overview.colNet')}
              </th>
              <th scope="col" className={g.barHead}>
                {t('gm.overview.colBar')}
              </th>
            </tr>
          </thead>
          <tbody>
            {totals.map(({ row, sources, sinks }) => {
              const sourcesText = formatPoints(sources, lang)
              const sinksText = formatPoints(sinks, lang)
              return (
                <tr key={row.day}>
                  <td>{formatDay(Date.parse(`${row.day}T00:00:00`), lang)}</td>
                  <td className={g.num}>{sourcesText}</td>
                  <td className={g.num}>{sinksText}</td>
                  <td className={`${g.num} ${row.net < 0 ? g.down : g.up}`}>{formatSigned(row.net, lang)}</td>
                  <td
                    className={g.barCell}
                    title={`${t('gm.overview.colSources')}: ${sourcesText} · ${t('gm.overview.colSinks')}: ${sinksText}`}
                  >
                    <span className={`${g.bar} ${g.barSources}`} style={{ width: `${percent(sources, max)}%` }} aria-hidden="true" />
                    <span className={`${g.bar} ${g.barSinks}`} style={{ width: `${percent(sinks, max)}%` }} aria-hidden="true" />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <Panel title={t('gm.overview.byDay')}>
      <div className={g.stack}>
        <Segmented options={options} value={range} onChange={choose} label={t('gm.overview.byDay')} />
        {body}
      </div>
    </Panel>
  )
}
