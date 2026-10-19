import { Button, Panel, formatPoints } from '@bp/ui-kit'
import { useTranslation } from 'react-i18next'
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
    </div>
  )
}
