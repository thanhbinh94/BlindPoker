import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConnectionStatus } from '../client/types.js'
import { formatPoints, type Language } from '../i18n/index.js'
import s from './lobby.module.css'

export interface PlayerBarProps {
  displayName: string | null
  balance: number
  status: ConnectionStatus
  lang: Language
  /** The player's own face (a chibi, a link to the wardrobe…); the name's initial in a gold disc when absent. */
  avatar?: ReactNode
}

const STATUS_KEY: Record<ConnectionStatus, string> = {
  idle: 'status.offline',
  connecting: 'status.connecting',
  open: 'status.online',
  reconnecting: 'status.reconnecting',
  closed: 'status.offline',
}

/**
 * Identity strip above the lobby: who you are, what you hold, whether the socket is alive — and nothing else.
 * Navigation and the language switch belong to the host app's rail, which is on screen above it (layout audit
 * U2, 2026-09-28: the bar used to repeat both, and showed an initial beside the chibi the app added).
 */
export function PlayerBar({ displayName, balance, status, lang, avatar }: PlayerBarProps) {
  const { t } = useTranslation()
  const name = displayName ?? t('status.connecting')
  const initial = name.trim().slice(0, 1).toUpperCase()
  // Amount and unit are one string on purpose: a balance is points, and "100.000" left alone beside a stray
  // symbol is exactly how a points balance starts reading as money.
  const pointsText = `${formatPoints(balance, lang)} ${t('common:units.pointsShort')}`

  return (
    <header className={s.bar}>
      {avatar ?? (
        <span className={s.avatar} aria-hidden="true">
          {initial}
        </span>
      )}
      <span className={s.who}>
        <span className={s.name}>{name}</span>
        <span className={s.balance}>
          <span>{t('labels.balance')}</span>
          <strong className={s.points}>{pointsText}</strong>
        </span>
      </span>
      <span className={s.conn} data-status={status}>
        <span className={s.connDot} aria-hidden="true" />
        {t(STATUS_KEY[status])}
      </span>
    </header>
  )
}
