import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConnectionStatus } from '../client/types.js'
import { formatPoints, type Language } from '../i18n/index.js'
import { LanguageSwitch } from './LanguageSwitch.js'
import s from './lobby.module.css'

export interface PlayerBarProps {
  displayName: string | null
  balance: number
  status: ConnectionStatus
  lang: Language
  onLanguage: (l: Language) => void
  /** Slot for app-specific controls (daily reward, profile, settings). */
  right?: ReactNode
}

const STATUS_KEY: Record<ConnectionStatus, string> = {
  idle: 'status.offline',
  connecting: 'status.connecting',
  open: 'status.online',
  reconnecting: 'status.reconnecting',
  closed: 'status.offline',
}

/** Identity strip above every lobby screen: who you are, what you hold, whether the socket is alive. */
export function PlayerBar({ displayName, balance, status, lang, onLanguage, right }: PlayerBarProps) {
  const { t } = useTranslation()
  const name = displayName ?? t('status.connecting')
  const initial = name.trim().slice(0, 1).toUpperCase()

  return (
    <header className={s.bar}>
      <span className={s.avatar} aria-hidden="true">
        {initial}
      </span>
      <span className={s.who}>
        <span className={s.name}>{name}</span>
        <span className={s.balance}>
          <span>{t('labels.balance')}</span>
          <strong className={s.points}>{formatPoints(balance, lang)}</strong>
          <span>{t('common:units.pointsShort')}</span>
        </span>
      </span>
      <span className={s.conn} data-status={status}>
        <span className={s.connDot} aria-hidden="true" />
        {t(STATUS_KEY[status])}
      </span>
      {right}
      <LanguageSwitch lang={lang} onChange={onLanguage} />
    </header>
  )
}
