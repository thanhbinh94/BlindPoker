import { Button, Panel, type Language } from '@bp/ui-kit'
import type { TFunction } from 'i18next'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LedgerEntryDto, LedgerPageDto } from '../api.js'
import { formatMoment, formatSigned } from './format.js'
import s from './normal.module.css'

/** One ledger page. Fifty rows is roughly a screen and a half on a phone — enough to scroll, short to fetch. */
export const LEDGER_PAGE = 50

/** `TxReason` in `@bp/server-kit`, which this app may not import: the values, copied, with a fallback under them. */
const REASONS = new Set([
  'starting_balance',
  'settlement',
  'buy_in',
  'cash_out',
  'refund',
  'daily_reward',
  'daily_login',
  'daily_item_fallback',
  'relief',
  'achievement',
  'gm_grant',
  'gm_adjust',
  'gm_achievement',
  'gm_checkin_undo',
  'shop_purchase',
  'shop',
])

/** A reason the server invented after this bundle shipped still reads as *something*, never as a raw key. */
export function reasonLabel(reason: string, t: TFunction): string {
  return t(REASONS.has(reason) ? `ledger.reason.${reason}` : 'ledger.reason.other')
}

export interface LedgerPanelProps {
  /** One page of somebody's ledger: the player's own (`api.ledger`) or, in the console, a target's. */
  load: (opts: { limit: number; before?: number }) => Promise<LedgerPageDto>
  lang: Language
  /** The panel heading; the profile's own "Lịch sử điểm" when omitted. */
  title?: string
}

/**
 * Where the points came from and went.
 *
 * It pages on the server's own cursor (`nextBefore`, the ledger's sequence id) rather than on an offset,
 * because rows arrive at the top while the player reads: an offset would show them the same row twice, and a
 * cursor cannot. A page shorter than the limit *is* the end of the history, which is why the absence of a
 * cursor — not the length of the last page — is what puts the button away.
 *
 * `load` is read from a ref: callers write it inline, and a dependency on that closure would refetch on every
 * render. Whose ledger this is therefore belongs to the caller's `key`.
 */
export function LedgerPanel({ load, lang, title }: LedgerPanelProps) {
  const { t } = useTranslation('normal')
  const heading = title ?? t('profile.ledger.title')
  const loadRef = useRef(load)
  loadRef.current = load
  const [entries, setEntries] = useState<LedgerEntryDto[]>([])
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const pull = useCallback(async (before: number | null): Promise<void> => {
    setLoading(true)
    setFailed(false)
    try {
      const page = await loadRef.current(before === null ? { limit: LEDGER_PAGE } : { limit: LEDGER_PAGE, before })
      setEntries((prev) => (before === null ? page.entries : [...prev, ...page.entries]))
      setNextBefore(page.nextBefore)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void pull(null)
  }, [pull])

  return (
    <Panel title={heading}>
      {/* The panel's own words, not the page's: this alert fires under a profile that rendered perfectly
          well, and "could not load your profile" read out over one is simply untrue. */}
      {failed ? (
        <p className={s.alert} role="alert">
          {t('profile.ledger.error')}
        </p>
      ) : null}

      {entries.length === 0 && !loading && !failed ? <p className={s.footnote}>{t('profile.ledger.empty')}</p> : null}

      {entries.length === 0 ? null : (
        <ul className={s.rows} aria-label={heading}>
          {entries.map((entry) => (
            // The reference id is a row in someone's database, not something a player reads (layout audit C7):
            // it stays on the row as a hover title, for the bug report that needs it.
            <li
              className={s.ledgerRow}
              key={entry.id}
              title={entry.refId === null ? undefined : t('profile.ledger.ref', { id: entry.refId })}
            >
              <span className={s.rowMain}>
                <span className={s.rowTitle}>{reasonLabel(entry.reason, t)}</span>
                <time className={s.rowMeta} dateTime={new Date(entry.createdAt).toISOString()}>
                  {formatMoment(entry.createdAt, lang)}
                </time>
              </span>
              <span className={s.amount} data-sign={entry.amount < 0 ? 'down' : 'up'}>
                {formatSigned(entry.amount, lang)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* A first page that failed leaves `nextBefore` at `null`, which is also how "you have read it all"
          looks — so without this branch the only way out of a failed first page is a full page reload.
          A *later* page that failed keeps its cursor, and "load more" retries that same page. */}
      {failed && entries.length === 0 ? (
        <Button variant="ghost" loading={loading} onClick={() => void pull(null)}>
          {t('screens.retry')}
        </Button>
      ) : nextBefore === null ? null : (
        <Button variant="ghost" loading={loading} onClick={() => void pull(nextBefore)}>
          {t('profile.ledger.loadMore')}
        </Button>
      )}
    </Panel>
  )
}
