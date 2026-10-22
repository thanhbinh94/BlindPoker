import type { RoomConfig, RoomSummary } from '@bp/core'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { GameClientApi } from '../client/useGameClient.js'
import type { Language } from '../i18n/index.js'
import { CreateRoomForm } from '../lobby/CreateRoomForm.js'
import { JoinByCode } from '../lobby/JoinByCode.js'
import { PlayerBar } from '../lobby/PlayerBar.js'
import { RoomList, type RoomFilter } from '../lobby/RoomList.js'
import { Button } from '../primitives/Button.js'
import { Modal } from '../primitives/Modal.js'
import { Panel } from '../primitives/Panel.js'
import { Toasts } from './Toasts.js'
import { useRequest } from './useRequest.js'
import s from './screens.module.css'

export interface LobbyScreenProps {
  client: GameClientApi
  lang: Language
  /** Called once the server acks a join or a create; the host app decides where that lands. */
  onEnteredRoom: () => void
  /** The player's own face for the player bar; the name's initial when absent. */
  avatar?: ReactNode
  /** The player's reputation rank for the player bar (Plan 27); nothing at rank 1 or when absent. */
  rank?: number | null
  /** App-specific banner above the lobby (edition branding, announcements…). */
  header?: ReactNode
  /** App links carried inside the player bar, on its line, so they add no row to the lobby's height (Plan 27 fix wave). */
  barLinks?: ReactNode
}

/**
 * The lobby: who you are, the way in, and the tickets on the board.
 *
 * Composition only. It owns three things — the mode filter, whether the create dialog is open, and the reply to its
 * own last request — and asks `GameClientApi` for everything else.
 */
export function LobbyScreen({ client, lang, onEnteredRoom, avatar, rank = null, header, barLinks }: LobbyScreenProps) {
  const { t } = useTranslation()
  const { state } = client
  const [filter, setFilter] = useState<RoomFilter>('all')
  const [creating, setCreating] = useState(false)
  const roomsId = useId()
  const request = useRequest()

  // The lobby list is a snapshot, not a subscription: ask again every time the socket comes back up.
  const clientRef = useRef(client)
  clientRef.current = client
  useEffect(() => {
    if (state.status === 'open') clientRef.current.listRooms()
  }, [state.status])

  const enter = useCallback(
    async (call: () => Promise<Awaited<ReturnType<GameClientApi['joinRoom']>>>) => {
      if (await request.run(call)) onEnteredRoom()
    },
    [request, onEnteredRoom],
  )

  const closeCreate = useCallback(() => setCreating(false), [])
  const clearError = useCallback(() => {
    request.clear()
    client.clearError()
  }, [request, client])
  const dismiss = useCallback((id: number) => client.dismissNotification(id), [client])

  const joinListed = (room: RoomSummary): void => void enter(() => client.joinRoom({ roomId: room.roomId }))
  const joinByCode = (code: string, password?: string): void =>
    void enter(() => client.joinRoom(password === undefined ? { code } : { code, password }))
  const create = async (config: RoomConfig): Promise<void> => {
    if (await request.run(() => client.createRoom(config))) {
      setCreating(false)
      onEnteredRoom()
    }
  }

  return (
    <div className={s.lobby}>
      <PlayerBar
        displayName={state.me?.displayName ?? null}
        balance={state.balance}
        status={state.status}
        lang={lang}
        avatar={avatar}
        rank={rank}
      >
        {barLinks}
      </PlayerBar>
      {header}

      <main className={s.lobbyMain}>
        <section className={s.rooms} aria-labelledby={roomsId}>
          {/* The page's one heading, sized like every other page's, with the way to make a room right beside it
              (layout audit U3/U6): under the join card it fell below the whole list once the lobby went one column. */}
          <div className={s.sectionHead}>
            <h1 className={s.sectionTitle} id={roomsId}>
              {t('nav.rooms')}
            </h1>
            <span className={s.rule} aria-hidden="true" />
            <Button variant="gold" className={s.createBtn} onClick={() => setCreating(true)}>
              {t('lobby.create')}
            </Button>
          </div>
          <RoomList rooms={state.lobby} onJoin={joinListed} filter={filter} onFilter={setFilter} lang={lang} busy={request.busy} />
        </section>

        <aside className={s.rail}>
          <Panel tone="ink" className={s.railCard}>
            <span className={s.eyebrow}>{t('lobby.joinByCode')}</span>
            <JoinByCode onJoin={joinByCode} busy={request.busy} lang={lang} />
          </Panel>
        </aside>
      </main>

      <Modal open={creating} title={t('create.title')} closeLabel={t('actions.close')} onClose={closeCreate}>
        <CreateRoomForm onSubmit={create} busy={request.busy} lang={lang} />
      </Modal>

      <Toasts
        error={request.error ?? state.lastError}
        notifications={state.notifications}
        onClearError={clearError}
        onDismiss={dismiss}
        lang={lang}
      />
    </div>
  )
}
