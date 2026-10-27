import { blindBuyInCap, type RoomView } from '@bp/core'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConnectionStatus } from '../client/types.js'
import { formatPoints, type Language } from '../i18n/index.js'
import { Badge } from '../primitives/Badge.js'
import { Button } from '../primitives/Button.js'
import { cx } from '../primitives/cx.js'
import s from './table.module.css'

export interface RoomHeaderProps {
  room: RoomView
  status: ConnectionStatus
  onLeave: () => void
  lang: Language
  /** Slot for app-specific controls (language switch, balance, settings). */
  right?: ReactNode
  /**
   * One line for a phone held sideways: the connection, the name, the squeeze badge, the code and the stakes, then
   * `menu` and the way out. The head-count and the mode badges are left to the lobby's card.
   */
  compact?: boolean
  /**
   * The seat's menu (`MenuButton`), drawn just before "Leave room" — on the compact line (a phone on its side) and in
   * the full header's right cell (a phone held upright, BP-31 P3). Nothing when not given (the desktop ring).
   */
  menu?: ReactNode
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
export function RoomHeader({ room, status, onLeave, lang, right, compact = false, menu }: RoomHeaderProps) {
  const { t } = useTranslation()
  const holdem = room.config.holdem
  const blind = room.config.blind
  // A chaos table has no cap (BP-39, spec 2026-10-27 §3.7): the seat brings the whole balance, and the limit says so.
  const limitText = (cap: number | null): string => (cap === null ? t('labels.noLimit') : formatPoints(cap, lang))
  const stakes =
    room.mode === 'holdem' && holdem !== undefined
      ? `${t('labels.blinds')} ${formatPoints(holdem.smallBlind, lang)}/${formatPoints(holdem.bigBlind, lang)}`
      : blind === undefined
        ? ''
        : `${t('labels.wager')} ${formatPoints(blind.fixedWager, lang)} · ${t('labels.tableLimit')} ${limitText(blindBuyInCap(blind))}`
  const players = t('lobby.playersOf', { current: room.playerCount, max: room.maxPlayers })
  const conn = (
    <span className={s.conn} data-status={status}>
      <span className={s.connDot} aria-hidden="true" />
      <span className={s.connText}>{t(STATUS_KEY[status])}</span>
    </span>
  )
  const squeeze = blind?.squeeze === true
  const squeezeBadge = squeeze ? <Badge tone="gold">{t('labels.squeezeMode')}</Badge> : null
  const chaosBadge = blind?.chaosCycle === undefined ? null : <Badge tone="chaos">{t('labels.chaosMode')}</Badge>
  const code = (
    <span className={s.code} aria-label={t('labels.code')}>
      {room.code}
    </span>
  )
  const leave = (
    <Button variant="danger" size="sm" onClick={onLeave}>
      {t('actions.leave')}
    </Button>
  )

  if (compact) {
    return (
      <header className={cx(s.header, s.headerCompact)}>
        {conn}
        <h1 className={s.roomName}>{room.name}</h1>
        {squeezeBadge}
        {chaosBadge}
        {code}
        {stakes === '' ? null : <span className={s.stakes}>{stakes}</span>}
        <div className={s.headRight}>
          {menu}
          {leave}
        </div>
      </header>
    )
  }

  return (
    <header className={cx(s.header, squeeze && s.headerSqueeze)}>
      <div className={s.headMain}>
        <span className={s.modeGlyph} aria-hidden="true">
          {MODE_GLYPH[room.mode]}
        </span>
        <div className={s.headText}>
          <h1 className={s.roomName}>{room.name}</h1>
          {/* One line of facts on a desktop. On a phone the squeeze badge steps up beside the name (the first row of the
              header's grid) and the rest of the line (`metaFlow`) is the second row: a squeeze table's gold badge no longer
              fills a row of its own, which is what scrolled its stage by 11 px (Plan 26, B6). On a desktop `metaFlow` steps
              aside and `order` puts the badge back between the badges and the code. */}
          <div className={s.headMeta}>
            <div className={s.metaFlow} data-chaos={chaosBadge === null ? undefined : 'true'}>
              <Badge tone="gold">{t(`mode.${room.mode}`)}</Badge>
              {blind === undefined ? null : <Badge tone="teal">{t(blind.holeCards === 3 ? 'blind.cards3' : 'blind.cards2')}</Badge>}
              {blind === undefined ? null : <Badge tone="muted">{t(`blind.decision.${blind.decisionMode}`)}</Badge>}
              {chaosBadge}
              <span className={cx(s.code, s.metaTail)} aria-label={t('labels.code')}>
                {room.code}
              </span>
              {stakes === '' ? null : <span className={cx(s.stakes, s.metaTail)}>{stakes}</span>}
              <span className={cx(s.players, s.metaTail)}>{players}</span>
            </div>
            {squeeze ? <Badge tone="gold" className={s.squeezeBadge}>{t('labels.squeezeMode')}</Badge> : null}
          </div>
        </div>
      </div>

      <div className={s.headRight}>
        {conn}
        {right}
        {menu}
        {leave}
      </div>
    </header>
  )
}
