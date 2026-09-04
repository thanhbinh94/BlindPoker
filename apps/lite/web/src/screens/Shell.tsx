import { LanguageSwitch, formatPoints, type ConnectionStatus, type Language } from '@bp/ui-kit'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import s from './lite.module.css'

const SPADE = '♠'

const NAV: { path: string; key: string }[] = [
  { path: '/lobby', key: 'nav.lobby' },
  { path: '/daily', key: 'nav.daily' },
  { path: '/settings', key: 'nav.settings' },
]

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
  children: ReactNode
}

/**
 * The Lite chrome: one slim lacquer rail and the page under it.
 *
 * It also publishes `--bp-stage` — the height `RoomScreen` sizes itself to — so the table knows whether it is
 * sharing the viewport with the rail or has it all.
 */
export function Shell({ path, identity, lang, onLanguage, bar = true, children }: ShellProps) {
  const { t } = useTranslation('lite')
  const active = (item: string): boolean => path === item || (item === '/lobby' && path === '/')
  // Amount and unit stay one string, exactly as the kit's `PlayerBar` prints it.
  const balanceText = identity === null ? '' : `${formatPoints(identity.balance, lang)} ${t('common:units.pointsShort')}`

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
              </a>
            ))}
          </nav>

          <span className={s.spacer} />

          {identity === null ? null : (
            <span className={s.identity}>
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
