import { Badge, Button, formatPoints } from '@bp/ui-kit'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GmRoomDto } from '../../api.js'
import s from '../normal.module.css'
import { useAsync } from '../useAsync.js'
import { CopyId } from './CopyId.js'
import g from './gm.module.css'
import { ReasonDialog, type ReasonValues } from './ReasonDialog.js'
import type { GmTabProps } from './tabProps.js'

const COLUMNS = 5

type Member = GmRoomDto['members'][number]

/** The one dialog that can be open: closing a whole room, or removing one person from it. */
type Pending = { kind: 'close'; room: GmRoomDto } | { kind: 'kick'; room: GmRoomDto; member: Member }

/**
 * Every room on the server, with who is in it. The list already carries each room's members, so opening a row costs
 * no request. Both actions go through the reason dialog, and both reload the list afterwards, because a closed room
 * is gone and a kicked player may be too.
 */
export function RoomsTab({ api, lang }: GmTabProps) {
  const { t } = useTranslation('normal')
  const rooms = useAsync(() => api.gmRooms())
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [pending, setPending] = useState<Pending | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const toggle = (roomId: string): void => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(roomId)) next.add(roomId)
      return next
    })
  }

  const confirm = async (values: ReasonValues): Promise<void> => {
    if (pending === null) return
    try {
      if (pending.kind === 'close') {
        const result = await api.gmCloseRoom(pending.room.roomId, values.reason)
        setDone(t('gm.done.close', { count: result.refunded }))
      } else {
        const result = await api.gmKick(pending.room.roomId, pending.member.playerId, values.reason)
        const when = result.effective === 'now' ? t('gm.done.kickNow') : t('gm.done.kickAfterHand')
        setDone(t('gm.done.kick', { when }))
      }
    } finally {
      // A refusal ("the room is gone") is news about the list too: the row it names is stale, so the list is
      // asked again whether or not the action went through. The dialog keeps printing the refusal meanwhile.
      rooms.reload()
    }
  }

  /** A new action, or a new look at the list, starts a clean slate: last action's success line is not this one's. */
  const ask = (next: Pending): void => {
    setDone(null)
    setPending(next)
  }

  const refresh = (): void => {
    setDone(null)
    rooms.reload()
  }

  const list = rooms.data?.rooms ?? null

  return (
    <div className={g.stack}>
      <p>
        <Button variant="ghost" loading={rooms.loading && list !== null} onClick={refresh}>
          {t('gm.rooms.refresh')}
        </Button>
      </p>

      {done === null ? null : (
        <p className={s.footnote} role="status">
          {done}
        </p>
      )}

      {list === null ? (
        rooms.loading ? (
          <p className={s.footnote} role="status">
            {t('screens.loading')}
          </p>
        ) : (
          <div className={g.stack}>
            <p className={s.alert} role="alert">
              {t('gm.rooms.error')}
            </p>
            <p>
              <Button variant="ghost" onClick={rooms.reload}>
                {t('screens.retry')}
              </Button>
            </p>
          </div>
        )
      ) : list.length === 0 ? (
        <p className={s.footnote}>{t('gm.rooms.empty')}</p>
      ) : (
        <div className={g.tableWrap}>
          <table className={`${g.table} ${g.cards}`}>
            <thead>
              <tr>
                <th scope="col">{[t('gm.rooms.name'), t('gm.rooms.mode')].join(' / ')}</th>
                <th scope="col" className={g.num}>
                  {t('gm.rooms.players')}
                </th>
                <th scope="col">{t('gm.rooms.host')}</th>
                <th scope="col">{t('gm.rooms.status')}</th>
                <th scope="col">
                  <span className="visually-hidden">{t('gm.rooms.members')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((room) => {
                const expanded = open.has(room.roomId)
                const membersId = `gm-room-${room.roomId}`
                const seats = [room.players, room.maxPlayers].join('/')
                return (
                  <Fragment key={room.roomId}>
                    <tr>
                      <td className={g.roomCell}>
                        <span className={g.rowName}>{room.name}</span>
                        <span className={g.sub}>{t(`gm.rooms.modes.${room.mode}`)}</span>
                        <span className={g.sub}>{room.code}</span>
                        <CopyId id={room.roomId} />
                      </td>
                      <td className={g.num} data-label={t('gm.rooms.players')}>
                        {seats}
                      </td>
                      <td data-label={t('gm.rooms.host')}>{room.hostDisplayName}</td>
                      <td data-label={t('gm.rooms.status')}>
                        {room.isPrivate || room.handInProgress || room.carryOverPot > 0 ? (
                          <span className={g.value}>
                            <span className={g.badges}>
                              {room.isPrivate ? <Badge tone="muted">{t('gm.rooms.private')}</Badge> : null}
                              {room.handInProgress ? <Badge tone="teal">{t('gm.rooms.inHand')}</Badge> : null}
                            </span>
                            {room.carryOverPot > 0 ? (
                              <span className={g.sub}>
                                {t('gm.rooms.carry')}: {formatPoints(room.carryOverPot, lang)}
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <span className={g.rowActions}>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-expanded={expanded}
                            aria-controls={membersId}
                            onClick={() => toggle(room.roomId)}
                          >
                            {t('gm.rooms.members')}
                          </Button>
                          <Button variant="danger" size="sm" onClick={() => ask({ kind: 'close', room })}>
                            {t('gm.actions.close')}
                          </Button>
                        </span>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr id={membersId}>
                        <td colSpan={COLUMNS} className={g.members}>
                          <MemberList room={room} lang={lang} onKick={(member) => ask({ kind: 'kick', room, member })} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {pending === null ? null : (
        <ReasonDialog
          open
          title={t(pending.kind === 'close' ? 'gm.actions.close' : 'gm.actions.kick')}
          body={
            pending.kind === 'close'
              ? t('gm.dialog.closeBody')
              : t('gm.dialog.kickBody', { name: pending.member.displayName })
          }
          fields={{}}
          confirmLabel={t('gm.dialog.confirm')}
          onConfirm={confirm}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  )
}

function MemberList({ room, lang, onKick }: { room: GmRoomDto; lang: GmTabProps['lang']; onKick: (member: Member) => void }) {
  const { t } = useTranslation('normal')
  return (
    <table className={`${g.table} ${g.cards}`} aria-label={`${t('gm.rooms.members')}: ${room.name}`}>
      <thead>
        <tr>
          <th scope="col">{t('gm.players.name')}</th>
          <th scope="col" className={g.num}>
            {t('gm.rooms.seat')}
          </th>
          <th scope="col" className={g.num}>
            {t('gm.rooms.stack')}
          </th>
          <th scope="col">{t('gm.rooms.status')}</th>
          <th scope="col">
            <span className="visually-hidden">{t('gm.actions.kick')}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {room.members.map((member) => (
          <tr key={member.playerId}>
            <td className={g.rowName}>{member.displayName}</td>
            <td className={g.num} data-label={t('gm.rooms.seat')}>
              {member.seat === null ? null : member.seat + 1}
            </td>
            <td className={g.num} data-label={t('gm.rooms.stack')}>
              {formatPoints(member.stack, lang)}
            </td>
            <td data-label={t('gm.rooms.status')}>
              {member.isBot || !member.connected ? (
                <span className={g.badges}>
                  {member.isBot ? <Badge tone="muted">{t('gm.rooms.bot')}</Badge> : null}
                  {member.isBot || member.connected ? null : <Badge tone="red">{t('gm.rooms.offline')}</Badge>}
                </span>
              ) : null}
            </td>
            <td>
              {member.isBot ? null : (
                <span className={g.rowActions}>
                  <CopyId id={member.playerId} />
                  <Button variant="danger" size="sm" onClick={() => onKick(member)}>
                    {t('gm.actions.kick')}
                  </Button>
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
