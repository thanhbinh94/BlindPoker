import type { RoomView } from '@bp/core'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConnectionStatus } from '../client/types.js'
import { formatPoints, type Language } from '../i18n/index.js'
import { Badge } from '../primitives/Badge.js'
import { Button } from '../primitives/Button.js'
import s from './table.module.css'

export interface RoomHeaderProps {
  room: RoomView
  status: ConnectionStatus
  onLeave: () => void
  lang: Language
  /** Slot for app-specific controls (language switch, balance, settings). */
  right?: ReactNode
}

const MODE_GLYPH: Record<string, string> = { holdem: '♠', blind: '⚄' }
const STATUS_KEY: Record<ConnectionStatus, string> = {
  idle: 'status.offline',
  connecting: 'status.connecting',
  open: 'status.online',
  reconnecting: 'status.reconnecting',
  closed: 'status.offline',
}

/** Room identity bar: name, mode/variant, code, stakes, connection state and the way out. */
export function RoomHeader({ room, status, onLeave, lang, right }: RoomHeaderProps) {
  const { t } = useTranslation()
  const holdem = room.config.holdem
  const blind = room.config.blind
  const stakes =
    room.mode === 'holdem' && holdem !== undefined
      ? `${t('labels.blinds')} ${formatPoints(holdem.smallBlind, lang)}/${formatPoints(holdem.bigBlind, lang)}`
      : blind === undefined
        ? ''
        : `${t('labels.wager')} ${formatPoints(blind.fixedWager, lang)}`
  const players = t('lobby.playersOf', { current: room.playerCount, max: room.maxPlayers })

  return (
    <header className={s.header}>
      <div className={s.headMain}>
        <span className={s.modeGlyph} aria-hidden="true">
          {MODE_GLYPH[room.mode]}
        </span>
        <div className={s.headText}>
          <h1 className={s.roomName}>{room.name}</h1>
          <div className={s.headMeta}>
            <Badge tone="gold">{t(`mode.${room.mode}`)}</Badge>
            {blind === undefined ? null : <Badge tone="teal">{t(blind.holeCards === 3 ? 'blind.cards3' : 'blind.cards2')}</Badge>}
            {blind === undefined ? null : <Badge tone="muted">{t(`blind.decision.${blind.decisionMode}`)}</Badge>}
            <span className={s.code} aria-label={t('labels.code')}>
              {room.code}
            </span>
            {stakes === '' ? null : <span className={s.stakes}>{stakes}</span>}
            <span className={s.players}>{players}</span>
          </div>
        </div>
      </div>

      <div className={s.headRight}>
        <span className={s.conn} data-status={status}>
          <span className={s.connDot} aria-hidden="true" />
          <span className={s.connText}>{t(STATUS_KEY[status])}</span>
        </span>
        {right}
        <Button variant="danger" size="sm" onClick={onLeave}>
          {t('actions.leave')}
        </Button>
      </div>
    </header>
  )
}
