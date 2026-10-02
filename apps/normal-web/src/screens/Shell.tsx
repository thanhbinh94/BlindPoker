import { LanguageSwitch, formatCompactPoints, formatPoints, useMediaQuery, type ConnectionStatus, type Language } from '@bp/ui-kit'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import s from './normal.module.css'

const SPADE = '♠'

/**
 * Four tabs, and four is the ceiling: at 375 px the rail holds the mark, four tabs and the connection dot,
 * and nothing more. The wardrobe and Achievements are reached from Profile rather than from here —
 * a fifth tab would push the fourth off the edge on the phone this game is mostly played on.
 *
 * Bug 8 (2026-09-27): four Vietnamese labels side by side did not fit 375 px after all — the nav scrolled and
 * cut "Cài đặt" to "Cài đ". Under 640 px each tab is now an icon over a small label (`normal.module.css`), so
 * the four stack narrowly instead of queueing. The icon is decoration; the label stays the accessible name.
 */
const NAV: { path: string; key: string; icon: IconPath }[] = [
  { path: '/lobby', key: 'nav.lobby', icon: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z' },
  { path: '/daily', key: 'nav.daily', icon: 'M4 9h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM3 5h18v4H3zm9 0v16M12 5c-1.5-3-5-3-5 0m5 0c1.5-3 5-3 5 0' },
  { path: '/profile', key: 'nav.profile', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9c0-4 3.1-6 7-6s7 2 7 6' },
  { path: '/settings', key: 'nav.settings', icon: 'M4 6h9m4 0h3M4 12h3m4 0h9M4 18h11m4 0h1M15 4v4M9 10v4M17 16v4' },
]

/** One tab's pictogram: a stroked path in the rail's own ink (`currentColor`), never announced. */
type IconPath = string

/**
 * Routes that print the balance in the page itself, and there is exactly one: the profile header carries it.
 * On a phone the rail has room for the mark, four tabs and the connection dot — and not for a second copy of a
 * number the page below is already showing, which is what would push the fourth tab off the edge at 375 px.
 *
 * Every other account screen deliberately prints *no* balance (the live one belongs to the socket's `BALANCE`
 * frame, and a fetched copy would go stale on the next settlement), so on those the rail's copy is the only
 * one there is and hiding it would leave a player on `/daily` unable to see their points at all.
 */
const BALANCE_IN_PAGE = ['/profile']

/**
 * The width at which the rail stops being able to hold everything, and the same 900 px at which the stylesheet
 * drops the language switch (bug 8: at 640 px the wordmark, full balance and language switch still overflowed a
 * 700–900 px window; the wordmark goes under 1024 px).
 *
 * It is a media query in JavaScript rather than in CSS because what changes is not layout but *text*: at this
 * width the balance is written `123K điểm` instead of `123.000 điểm`, and no amount of CSS reformats a number.
 * Rendering both and hiding one would leave a screen reader announcing the balance twice.
 */
const NARROW_RAIL = '(max-width: 900px)'

const STATUS_KEY: Record<ConnectionStatus, string> = {
  idle: 'game:status.offline',
  connecting: 'game:status.connecting',
  open: 'game:status.online',
  reconnecting: 'game:status.reconnecting',
  closed: 'game:status.offline',
}

export interface ShellIdentity {
  balance: number
  status: ConnectionStatus
}

export interface ShellProps {
  /** The current hash route, so the rail can mark its own tab. */
  path: string
  /**
   * Balance and socket state for the rail's right-hand side. `null` on the lobby, where `LobbyScreen`'s own
   * `PlayerBar` already carries both — one balance per screen, never two.
   */
  identity: ShellIdentity | null
  lang: Language
  onLanguage: (lang: Language) => void
  /** `false` on the room route: `RoomScreen` is a stage and takes the whole viewport. */
  bar?: boolean
  /** Today's reward is still unclaimed: the Daily tab carries a dot. */
  dailyReady?: boolean
  children: ReactNode
}

/**
 * The Normal chrome: one slim lacquer rail and the page under it.
 *
 * It also publishes `--bp-stage` — the height `RoomScreen` sizes itself to — so the table knows whether it is
 * sharing the viewport with the rail or has it all.
 */
export function Shell({ path, identity, lang, onLanguage, bar = true, dailyReady = false, children }: ShellProps) {
  const { t } = useTranslation('normal')
  const narrow = useMediaQuery(NARROW_RAIL)
  const active = (item: string): boolean => path === item || (item === '/lobby' && path === '/')
  // Amount and unit stay one string, exactly as the kit's `PlayerBar` prints it. On a phone the amount goes
  // compact: a settled player carries six figures, and `123.000 điểm` beside four tabs is what pushes the
  // fourth off a 375 px rail. `123K điểm` is the same fact in a third of the room, and the exact number is one
  // tap away on the profile.
  const balanceText =
    identity === null ? '' : `${(narrow ? formatCompactPoints : formatPoints)(identity.balance, lang)} ${t('common:units.pointsShort')}`

  return (
    <div className={s.shell} data-bar={String(bar)}>
      {bar ? (
        <header className={s.bar}>
          <a className={s.mark} href="#/lobby">
            <span className={s.markGlyph} aria-hidden="true">
              {SPADE}
            </span>
            <span className={s.wordmark}>{t('app.name')}</span>
          </a>

          <nav className={s.nav} aria-label={t('nav.main')}>
            {NAV.map((item) => (
              <a
                key={item.path}
                className={s.navLink}
                href={`#${item.path}`}
                aria-current={active(item.path) ? 'page' : undefined}
              >
                <svg className={s.navIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d={item.icon} />
                </svg>
                <span className={s.navLabel}>{t(item.key)}</span>
                {item.path === '/daily' && dailyReady ? (
                  <span className={s.navDot}>
                    <span className="visually-hidden">{t('nav.dailyReady')}</span>
                  </span>
                ) : null}
              </a>
            ))}
          </nav>

          <span className={s.spacer} />

          {identity === null ? null : (
            <span className={s.identity} data-balance-in-page={String(BALANCE_IN_PAGE.includes(path))}>
              <span className={s.conn} data-status={identity.status}>
                <span className={s.connDot} aria-hidden="true" />
                <span className="visually-hidden">{t(STATUS_KEY[identity.status])}</span>
              </span>
              <span className={s.balance}>{balanceText}</span>
            </span>
          )}
          {/* On every route, the lobby included: the lobby's player bar carries the balance but not the language. */}
          <span className={s.railLang}>
            <LanguageSwitch lang={lang} onChange={onLanguage} />
          </span>
        </header>
      ) : null}

      <div className={s.main}>{children}</div>
    </div>
  )
}
