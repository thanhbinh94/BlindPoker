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
  onLanguage: (l: Language) => void
  /** Called once the server acks a join or a create; the host app decides where that lands. */
  onEnteredRoom: () => void
  /** App-specific controls for the player bar (daily reward, profile…). */
  extraNav?: ReactNode
  /** App-specific banner above the lobby (edition branding, announcements…). */
  header?: ReactNode
}

/**
 * The lobby: who you are, the way in, and the tickets on the board.
 *
 * Composition only. It owns three things — the mode filter, whether the create dialog is open, and the reply to its
 * own last request — and asks `GameClientApi` for everything else.
 */
export function LobbyScreen({ client, lang, onLanguage, onEnteredRoom, extraNav, header }: LobbyScreenProps) {
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
        onLanguage={onLanguage}
        right={extraNav}
      />
      {header}

      <main className={s.lobbyMain}>
        <section className={s.rooms} aria-labelledby={roomsId}>
          <div className={s.sectionHead}>
            <h2 className={s.sectionTitle} id={roomsId}>
              {t('nav.rooms')}
            </h2>
            <span className={s.rule} aria-hidden="true" />
          </div>
          <RoomList rooms={state.lobby} onJoin={joinListed} filter={filter} onFilter={setFilter} lang={lang} busy={request.busy} />
        </section>

        <aside className={s.rail}>
          <Panel tone="ink" className={s.railCard}>
            <span className={s.eyebrow}>{t('lobby.joinByCode')}</span>
            <JoinByCode onJoin={joinByCode} busy={request.busy} lang={lang} />
          </Panel>
          <div className={s.railCta}>
            <span className={s.rule} aria-hidden="true" />
            <Button variant="gold" size="lg" className={s.block} onClick={() => setCreating(true)}>
              {t('lobby.create')}
            </Button>
          </div>
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
