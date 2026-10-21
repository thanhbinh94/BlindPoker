import { Button } from '@bp/ui-kit'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { GmActionDto } from '../../api.js'
import { formatMoment, formatMonthKey, formatSigned } from '../format.js'
import s from '../normal.module.css'
import { CopyId } from './CopyId.js'
import g from './gm.module.css'
import type { GmTabProps } from './tabProps.js'

interface Filters {
  player: string
  room: string
}

/** Only the filters that are filled in: the server treats a present-but-empty one as a filter for nothing. */
function query(filters: Filters, before: number | null): { player?: string; room?: string; before?: number } {
  const opts: { player?: string; room?: string; before?: number } = {}
  if (filters.player !== '') opts.player = filters.player
  if (filters.room !== '') opts.room = filters.room
  if (before !== null) opts.before = before
  return opts
}

/**
 * The month a gift-calendar action changed (`details.month`, `YYYY-MM`), shown where a player action names its
 * player; `''` for every other action, and for a row whose details lack the month.
 */
function monthOf(action: GmActionDto): string {
  if (action.action !== 'set_gift_month' && action.action !== 'clear_gift_month') return ''
  const month = action.details?.month
  return typeof month === 'string' ? month : ''
}

/**
 * The append-only log of what game masters did, newest first. The ids to filter by are the ones the other tabs
 * print on their rows (a copy button each); the log's own rows carry the same buttons, so "what else happened to
 * this player" is one paste away from any line of it.
 */
export function ActionsTab({ api, lang }: GmTabProps) {
  const { t } = useTranslation('normal')
  const [draft, setDraft] = useState<Filters>({ player: '', room: '' })
  /** The filters the rows on screen answer — "load more" continues these, not whatever is typed since. */
  const [applied, setApplied] = useState<Filters>({ player: '', room: '' })
  const [actions, setActions] = useState<GmActionDto[]>([])
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  /** The newest request's number: an older answer arriving late must not replace a newer one. */
  const latest = useRef(0)

  const run = useCallback(
    async (filters: Filters, before: number | null): Promise<void> => {
      const mine = ++latest.current
      setLoading(true)
      setFailed(false)
      try {
        const page = await api.gmActions(query(filters, before))
        if (mine !== latest.current) return
        setActions((prev) => (before === null ? page.actions : [...prev, ...page.actions]))
        setNextBefore(page.nextBefore)
        setApplied(filters)
      } catch {
        if (mine !== latest.current) return
        setFailed(true)
      } finally {
        if (mine === latest.current) setLoading(false)
      }
    },
    [api],
  )

  useEffect(() => {
    void run({ player: '', room: '' }, null)
  }, [run])

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void run({ player: draft.player.trim(), room: draft.room.trim() }, null)
  }

  return (
    <div className={g.stack}>
      <form className={g.filterForm} onSubmit={submit} role="search">
        <div className={`${g.field} ${g.searchField}`}>
          <label className={s.label} htmlFor="gm-log-player">
            {t('gm.log.filterPlayer')}
          </label>
          <input
            id="gm-log-player"
            className={s.input}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={draft.player}
            onChange={(event) => setDraft((prev) => ({ ...prev, player: event.target.value }))}
          />
        </div>
        <div className={`${g.field} ${g.searchField}`}>
          <label className={s.label} htmlFor="gm-log-room">
            {t('gm.log.filterRoom')}
          </label>
          <input
            id="gm-log-room"
            className={s.input}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={draft.room}
            onChange={(event) => setDraft((prev) => ({ ...prev, room: event.target.value }))}
          />
        </div>
        <Button type="submit" variant="gold" loading={loading && actions.length === 0}>
          {t('gm.log.filter')}
        </Button>
      </form>

      {failed ? (
        <p className={s.alert} role="alert">
          {t('gm.log.error')}
        </p>
      ) : null}

      {actions.length === 0 && !loading && !failed ? <p className={s.footnote}>{t('gm.log.empty')}</p> : null}

      {actions.length === 0 ? null : (
        <div className={g.tableWrap}>
          <table className={`${g.table} ${g.cards}`}>
            <thead>
              <tr>
                <th scope="col">{t('gm.log.when')}</th>
                <th scope="col">{t('gm.log.who')}</th>
                <th scope="col">{t('gm.log.what')}</th>
                <th scope="col">{t('gm.log.target')}</th>
                <th scope="col" className={g.num}>
                  {t('gm.log.amount')}
                </th>
                <th scope="col">{t('gm.log.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((action) => (
                <tr key={action.id}>
                  <td className={g.when} data-label={t('gm.log.when')}>
                    <time dateTime={new Date(action.at).toISOString()}>{formatMoment(action.at, lang)}</time>
                  </td>
                  <td data-label={t('gm.log.who')}>{action.actor === null ? t('gm.log.cli') : action.actor.displayName}</td>
                  <td data-label={t('gm.log.what')}>
                    <span className={g.value}>
                      {t(`gm.log.kind.${action.action}`, { defaultValue: action.action })}
                      {action.itemId === null ? null : <span className={g.sub}>{action.itemId}</span>}
                    </span>
                  </td>
                  <td data-label={t('gm.log.target')}>
                    {monthOf(action) !== '' ? (
                      <span className={g.rowName}>{t('gm.log.month', { month: formatMonthKey(monthOf(action)) })}</span>
                    ) : action.target === null && action.roomId === null ? null : (
                      <span className={g.value}>
                        {action.target === null ? null : (
                          <>
                            <span className={g.rowName}>{action.target.displayName}</span>
                            <CopyId id={action.target.playerId} />
                          </>
                        )}
                        {action.roomId === null ? null : <CopyId id={action.roomId} />}
                      </span>
                    )}
                  </td>
                  <td className={g.num} data-label={t('gm.log.amount')}>
                    {action.amount === null ? null : formatSigned(action.amount, lang)}
                  </td>
                  <td data-label={t('gm.log.reason')}>{action.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextBefore === null ? null : (
        <p>
          <Button variant="ghost" loading={loading} onClick={() => void run(applied, nextBefore)}>
            {t('gm.log.more')}
          </Button>
        </p>
      )}
    </div>
  )
}
