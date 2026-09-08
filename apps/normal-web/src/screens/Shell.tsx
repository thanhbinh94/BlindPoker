import { LanguageSwitch, formatCompactPoints, formatPoints, useMediaQuery, type ConnectionStatus, type Language } from '@bp/ui-kit'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import s from './normal.module.css'

const SPADE = '♠'

/**
 * Four tabs, and four is the ceiling: at 375 px the rail holds the mark, four tabs and the connection dot,
 * and nothing more. Avatar, Inventory and Achievements are reached from Profile rather than from here —
 * a fifth tab would push the fourth off the edge on the phone this game is mostly played on.
 */
const NAV: { path: string; key: string }[] = [
  { path: '/lobby', key: 'nav.lobby' },
  { path: '/daily', key: 'nav.daily' },
  { path: '/profile', key: 'nav.profile' },
  { path: '/settings', key: 'nav.settings' },
]

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
 * The width at which the rail stops being able to hold everything, and the same 640 px the stylesheet below
 * uses to drop the wordmark, the edition pill and the language switch.
 *
 * It is a media query in JavaScript rather than in CSS because what changes is not layout but *text*: at this
 * width the balance is written `123K điểm` instead of `123.000 điểm`, and no amount of CSS reformats a number.
 * Rendering both and hiding one would leave a screen reader announcing the balance twice.
 */
const NARROW_RAIL = '(max-width: 640px)'

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
          <span className={s.edition}>{t('app.edition')}</span>

          <nav className={s.nav} aria-label={t('nav.main')}>
            {NAV.map((item) => (
              <a
                key={item.path}
                className={s.navLink}
                href={`#${item.path}`}
                aria-current={active(item.path) ? 'page' : undefined}
              >
                {t(item.key)}
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
              <span className={s.railLang}>
                <LanguageSwitch lang={lang} onChange={onLanguage} />
              </span>
            </span>
          )}
        </header>
      ) : null}

      <div className={s.main}>{children}</div>
    </div>
  )
}
