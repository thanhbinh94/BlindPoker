import { Badge, Button, formatPoints } from '@bp/ui-kit'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { GmPlayerSummaryDto } from '../../api.js'
import s from '../normal.module.css'
import { CopyId } from './CopyId.js'
import g from './gm.module.css'
import type { GmTabProps } from './tabProps.js'

export interface PlayersTabProps extends GmTabProps {
  onOpen: (playerId: string) => void
}

/**
 * Find an account. The address is masked in a list (it is read over a shoulder) and whole on the player's own page.
 *
 * A search is a write as far as the server's limiter is concerned (60 a minute per session), so it runs on the
 * button or on Enter and never on a keystroke. The list is the first page of everybody on arrival: an empty
 * query is a legitimate search, and "who signed up lately" is the most common reason to open this tab.
 */
export function PlayersTab({ api, lang, onOpen }: PlayersTabProps) {
  const { t } = useTranslation('normal')
  const [draft, setDraft] = useState('')
  /** The query the rows on screen answer — "load more" continues this one, not whatever is typed since. */
  const [query, setQuery] = useState('')
  const [players, setPlayers] = useState<GmPlayerSummaryDto[]>([])
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  /** The newest request's number: an older answer arriving late must not replace a newer one. */
  const latest = useRef(0)

  const run = useCallback(
    async (term: string, before: string | null): Promise<void> => {
      const mine = ++latest.current
      setLoading(true)
      setFailed(false)
      try {
        const page = await (before === null ? api.gmSearch(term) : api.gmSearch(term, { before }))
        if (mine !== latest.current) return
        setPlayers((prev) => (before === null ? page.players : [...prev, ...page.players]))
        setNextBefore(page.nextBefore)
        setQuery(term)
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
    void run('', null)
  }, [run])

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void run(draft.trim(), null)
  }

  return (
    <div className={g.stack}>
      <form className={g.searchForm} onSubmit={submit} role="search">
        <div className={`${g.field} ${g.searchField}`}>
          <label className={s.label} htmlFor="gm-player-search">
            {t('gm.players.search')}
          </label>
          <input
            id="gm-player-search"
            className={s.input}
            type="search"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        <Button type="submit" variant="gold" loading={loading && players.length === 0}>
          {t('gm.players.searchButton')}
        </Button>
      </form>

      {failed ? (
        <p className={s.alert} role="alert">
          {t('gm.players.error')}
        </p>
      ) : null}

      {players.length === 0 && !loading && !failed ? <p className={s.footnote}>{t('gm.players.empty')}</p> : null}

      {players.length === 0 ? null : (
        <div className={g.tableWrap}>
          <table className={`${g.table} ${g.cards}`}>
            <thead>
              <tr>
                <th scope="col">{t('gm.players.name')}</th>
                <th scope="col">{t('gm.players.email')}</th>
                <th scope="col" className={g.num}>
                  {t('gm.players.balance')}
                </th>
                <th scope="col">{t('gm.players.role')}</th>
                <th scope="col">{t('gm.players.status')}</th>
                <th scope="col">
                  <span className="visually-hidden">{t('gm.players.open')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => (
                <tr key={player.playerId}>
                  <td className={g.rowName}>{player.displayName}</td>
                  <td data-label={t('gm.players.email')}>{player.emailMasked}</td>
                  <td className={g.num} data-label={t('gm.players.balance')}>
                    {formatPoints(player.balance, lang)}
                  </td>
                  <td data-label={t('gm.players.role')}>{t(`gm.player.roles.${player.role}`)}</td>
                  <td data-label={t('gm.players.status')}>
                    {player.locked ? <Badge tone="muted">{t('gm.players.lockedBadge')}</Badge> : null}
                  </td>
                  <td>
                    <span className={g.rowActions}>
                      <Button variant="ghost" size="sm" onClick={() => onOpen(player.playerId)}>
                        {t('gm.players.open')}
                      </Button>
                      <CopyId id={player.playerId} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextBefore === null ? null : (
        <p>
          <Button variant="ghost" loading={loading} onClick={() => void run(query, nextBefore)}>
            {t('gm.players.more')}
          </Button>
        </p>
      )}
    </div>
  )
}
