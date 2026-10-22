import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import type { GameClientApi } from '../client/useGameClient.js'
import type { ClientState } from '../client/types.js'
import { createI18n } from '../i18n/index.js'
import { lobbyRooms, makeState } from '../test-fixtures.js'
import { LobbyScreen } from './LobbyScreen.js'

const ACK = { t: 'ACK' as const, reqId: 'x' }

function fakeClient(state: ClientState, overrides: Partial<GameClientApi> = {}): GameClientApi {
  return {
    state,
    connect: vi.fn(),
    disconnect: vi.fn(),
    listRooms: vi.fn(),
    createRoom: vi.fn().mockResolvedValue(ACK),
    joinRoom: vi.fn().mockResolvedValue(ACK),
    leaveRoom: vi.fn().mockResolvedValue(ACK),
    sitDown: vi.fn().mockResolvedValue(ACK),
    standUp: vi.fn().mockResolvedValue(ACK),
    sitOut: vi.fn().mockResolvedValue(ACK),
    sitIn: vi.fn().mockResolvedValue(ACK),
    setReady: vi.fn().mockResolvedValue(ACK),
    startGame: vi.fn().mockResolvedValue(ACK),
    kick: vi.fn().mockResolvedValue(ACK),
    act: vi.fn().mockResolvedValue(ACK),
    reveal: vi.fn().mockResolvedValue(ACK),
    resync: vi.fn(),
    renamed: vi.fn(),
    clearError: vi.fn(),
    dismissNotification: vi.fn(),
    setPreAction: vi.fn(),
    setAutoPlay: vi.fn(),
    reset: vi.fn(),
    serverNow: () => 1_000_000,
    ...overrides,
  }
}

const wrap = (client: GameClientApi, onEnteredRoom = vi.fn()) => {
  const view = render(
    <I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>
      <LobbyScreen client={client} lang="en" onEnteredRoom={onEnteredRoom} />
    </I18nextProvider>,
  )
  return { view, onEnteredRoom }
}

describe('LobbyScreen', () => {
  it('shows who I am, lists the rooms and asks for the list on mount', () => {
    const client = fakeClient(makeState({ lobby: lobbyRooms, balance: 123_456 }))
    wrap(client)

    expect(client.listRooms).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Mai')).toBeInTheDocument()
    expect(screen.getByText('123,456 pts')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Đêm Sài Gòn' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Chiếu Bạc' })).toBeInTheDocument()
  })

  it('puts the app’s bar links inside the player bar, not in a row of their own', () => {
    render(
      <I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>
        <LobbyScreen client={fakeClient(makeState({ lobby: lobbyRooms }))} lang="en" onEnteredRoom={vi.fn()} barLinks={<a href="#/shop">Shop</a>} />
      </I18nextProvider>,
    )
    expect(screen.getByRole('banner')).toContainElement(screen.getByRole('link', { name: 'Shop' }))
  })

  it('titles the page like every other page, with the create button beside the title', () => {
    wrap(fakeClient(makeState({ lobby: lobbyRooms })))
    const title = screen.getByRole('heading', { level: 1, name: 'Rooms' })
    // The one way to make a room sits in the title row (layout audit U6), not under the join-by-code card.
    expect(title.parentElement).toContainElement(screen.getByRole('button', { name: 'Create room' }))
    // The language switch is the app rail's now (layout audit U2).
    expect(screen.queryByRole('button', { name: /tiếng việt/i })).toBeNull()
  })

  it('re-lists the rooms when the connection re-opens', () => {
    const client = fakeClient(makeState({ status: 'reconnecting', lobby: [] }))
    const { view } = wrap(client)
    expect(client.listRooms).toHaveBeenCalledTimes(0)

    view.rerender(
      <I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>
        <LobbyScreen
          client={fakeClient(makeState({ status: 'open' }), { listRooms: client.listRooms })}
          lang="en"
          onEnteredRoom={vi.fn()}
        />
      </I18nextProvider>,
    )
    expect(client.listRooms).toHaveBeenCalledTimes(1)
  })

  it('joins a listed room by id and reports entry once the server acks', async () => {
    const client = fakeClient(makeState({ lobby: lobbyRooms }))
    const { onEnteredRoom } = wrap(client)

    await userEvent.click(screen.getByRole('button', { name: /join — Đêm Sài Gòn/i }))

    expect(client.joinRoom).toHaveBeenCalledWith({ roomId: 'r1' })
    await waitFor(() => expect(onEnteredRoom).toHaveBeenCalledTimes(1))
  })

  it('joins by code with the typed password', async () => {
    const client = fakeClient(makeState({ lobby: lobbyRooms }))
    const { onEnteredRoom } = wrap(client)

    // Scoped to the join form: a private room's ticket also carries "Room code" and "Password" labels.
    const form = within(screen.getByPlaceholderText('Enter room code').closest('form')!)
    await userEvent.type(form.getByLabelText('Room code'), 'xyz789')
    await userEvent.type(form.getByLabelText('Password'), 'hunter2')
    await userEvent.click(form.getByRole('button', { name: 'Join' }))

    expect(client.joinRoom).toHaveBeenCalledWith({ code: 'XYZ789', password: 'hunter2' })
    await waitFor(() => expect(onEnteredRoom).toHaveBeenCalledTimes(1))
  })

  it('creates a room from the modal form and reports entry', async () => {
    const client = fakeClient(makeState({ lobby: [] }))
    const { onEnteredRoom } = wrap(client)

    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Create room' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()

    // The form opens with a name of its own; the host types over it.
    await userEvent.clear(screen.getByLabelText('Room name'))
    await userEvent.type(screen.getByLabelText('Room name'), 'Night Room')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create room' }))

    expect(client.createRoom).toHaveBeenCalledTimes(1)
    const config = vi.mocked(client.createRoom).mock.calls[0]![0]
    expect(config).toMatchObject({ name: 'Night Room', mode: 'holdem', maxPlayers: 6, turnTimerSec: 30 })
    await waitFor(() => expect(onEnteredRoom).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('surfaces a rejected join as an alert and stays in the lobby', async () => {
    const client = fakeClient(makeState({ lobby: lobbyRooms }), {
      joinRoom: vi.fn().mockResolvedValue({ t: 'ERROR', code: 'ROOM_FULL', message: 'full', reqId: 'x' }),
    })
    const { onEnteredRoom } = wrap(client)

    await userEvent.click(screen.getByRole('button', { name: /join — Đêm Sài Gòn/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Room is full')
    expect(onEnteredRoom).not.toHaveBeenCalled()
  })
})
