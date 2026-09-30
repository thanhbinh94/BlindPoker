import type { RoomSummary } from '@bp/core'
import { useTranslation } from 'react-i18next'
import { formatPoints, type Language } from '../i18n/index.js'
import { Badge } from '../primitives/Badge.js'
import { Button } from '../primitives/Button.js'
import { Segmented } from '../primitives/Segmented.js'
import { cx } from '../primitives/cx.js'
import s from './lobby.module.css'

export type RoomFilter = 'all' | 'holdem' | 'blind'

export interface RoomListProps {
  rooms: RoomSummary[]
  onJoin: (room: RoomSummary) => void
  filter?: RoomFilter
  onFilter?: (f: RoomFilter) => void
  lang: Language
  busy?: boolean
}

const MODE_GLYPH: Record<string, string> = { holdem: '♠', blind: '⚄' }
const FILTERS: RoomFilter[] = ['all', 'holdem', 'blind']

/** A room is a torn-off ticket: dark stub with the mode glyph, perforated seam, printed body. */
export function RoomList({ rooms, onJoin, filter = 'all', onFilter, lang, busy = false }: RoomListProps) {
  const { t } = useTranslation()
  const shown = filter === 'all' ? rooms : rooms.filter((room) => room.mode === filter)

  return (
    <div>
      {onFilter === undefined ? null : (
        <Segmented
          className={s.filters}
          options={FILTERS.map((key) => ({ value: key, label: t(`lobby.filters.${key}`) }))}
          value={filter}
          onChange={onFilter}
          label={t('labels.mode')}
        />
      )}
      {shown.length === 0 ? (
        <p className={s.empty}>{t('lobby.empty')}</p>
      ) : (
        <ul className={s.list}>
          {shown.map((room) => (
            <RoomTicket key={room.roomId} room={room} onJoin={onJoin} lang={lang} busy={busy} />
          ))}
        </ul>
      )}
    </div>
  )
}

interface RoomTicketProps {
  room: RoomSummary
  onJoin: (room: RoomSummary) => void
  lang: Language
  busy: boolean
}

function RoomTicket({ room, onJoin, lang, busy }: RoomTicketProps) {
  const { t } = useTranslation()
  const holdem = room.config.holdem
  const blind = room.config.blind
  const full = room.playerCount >= room.maxPlayers
  const occupancy = `${room.playerCount}/${room.maxPlayers}`
  const stakeLabel = t(room.mode === 'holdem' ? 'labels.blinds' : 'labels.wager')
  const stakeValue =
    holdem !== undefined
      ? `${formatPoints(holdem.smallBlind, lang)}/${formatPoints(holdem.bigBlind, lang)}`
      : blind === undefined
        ? ''
        : formatPoints(blind.fixedWager, lang)
  const joinLabel = `${t('actions.join')} — ${room.name}`

  return (
    <li className={cx(s.ticket, s[room.mode])}>
      <div className={s.stub}>
        <span className={s.glyph} aria-hidden="true">
          {MODE_GLYPH[room.mode]}
        </span>
        <span className={s.stubCode} aria-label={t('labels.code')}>
          {room.code}
        </span>
      </div>
      <span className={cx(s.notch, s.notchTop)} aria-hidden="true" />
      <span className={cx(s.notch, s.notchBottom)} aria-hidden="true" />

      <div className={s.body}>
        {/* The name wraps in a column of its own, two lines at most (the whole of it in the tooltip); the lock and the
            status stay on its first line at the right, so a long name never pushes them onto a row of their own (R2-1). */}
        <div className={s.ticketHead}>
          <h3 className={s.roomName} title={room.name}>
            {room.name}
          </h3>
          <span className={s.ticketStatus}>
            {room.config.hasPassword ? (
              <svg className={s.lock} viewBox="0 0 12 14" width="12" height="14" role="img" aria-label={t('labels.password')}>
                <path d="M3.2 6V4a2.8 2.8 0 0 1 5.6 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <rect x="1.4" y="5.8" width="9.2" height="7.4" rx="1.7" fill="currentColor" />
              </svg>
            ) : null}
            {/* Bug 2: an empty room is kept 60 s for anyone coming back, and says so instead of "waiting". */}
            <Badge tone={room.closing === true ? 'muted' : room.status === 'OPEN' ? 'teal' : 'gold'}>
              {t(room.closing === true ? 'labels.closing' : room.status === 'OPEN' ? 'labels.waiting' : 'labels.inHand')}
            </Badge>
          </span>
        </div>

        <dl className={s.meta}>
          <div className={s.metaItem}>
            <dt>{t('labels.mode')}</dt>
            <dd className={s.metaValue}>{t(`mode.${room.mode}`)}</dd>
          </div>
          {stakeValue === '' ? null : (
            <div className={s.metaItem}>
              <dt>{stakeLabel}</dt>
              <dd className={s.metaValue}>{stakeValue}</dd>
            </div>
          )}
        </dl>

        {blind === undefined ? null : (
          <div className={s.tags}>
            <Badge tone="muted">{t(blind.holeCards === 3 ? 'blind.cards3' : 'blind.cards2')}</Badge>
            <Badge tone="muted">{t(`blind.decision.${blind.decisionMode}`)}</Badge>
          </div>
        )}

        <div className={s.ticketFoot}>
          <span
            className={cx(s.count, full && s.countFull)}
            aria-label={t('lobby.playersOf', { current: room.playerCount, max: room.maxPlayers })}
          >
            {occupancy}
          </span>
          <Button variant="gold" size="sm" disabled={busy || full} aria-label={joinLabel} onClick={() => onJoin(room)}>
            {t('actions.join')}
          </Button>
        </div>
      </div>
    </li>
  )
}
