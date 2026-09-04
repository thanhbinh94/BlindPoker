import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import type { ClientState } from '../client/types.js'
import type { GameClientApi } from '../client/useGameClient.js'
import { createI18n } from '../i18n/index.js'
import { makeHand, makePlayer, makeRoom, makeState } from '../test-fixtures.js'
import { RoomScreen } from './RoomScreen.js'

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
    setReady: vi.fn().mockResolvedValue(ACK),
    startGame: vi.fn().mockResolvedValue(ACK),
    kick: vi.fn().mockResolvedValue(ACK),
    act: vi.fn().mockResolvedValue(ACK),
    resync: vi.fn(),
    clearError: vi.fn(),
    dismissNotification: vi.fn(),
    serverNow: () => 1_000_000,
    ...overrides,
  }
}

const screenFor = (client: GameClientApi, onLeft = vi.fn()) => (
  <I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>
    <RoomScreen client={client} lang="en" onLeft={onLeft} />
  </I18nextProvider>
)

const wrap = (client: GameClientApi, onLeft = vi.fn()) => ({ view: render(screenFor(client, onLeft)), onLeft })

/** Ann is seated in seat 0; I am in the room but standing. */
const standingRoom = makeRoom({
  status: 'OPEN',
  playerCount: 2,
  players: [
    makePlayer({ playerId: 'a', displayName: 'Ann', isHost: true, seat: 0, status: 'SEATED', stack: 20_000 }),
    makePlayer({ playerId: 'me', displayName: 'Mai' }),
  ],
})

/** Both of us seated and ready, and I am the host. */
const readyRoom = makeRoom({
  status: 'OPEN',
  hostPlayerId: 'me',
  playerCount: 2,
  players: [
    makePlayer({ playerId: 'a', displayName: 'Ann', seat: 0, status: 'READY', stack: 20_000, ready: true }),
    makePlayer({ playerId: 'me', displayName: 'Mai', isHost: true, seat: 1, status: 'READY', stack: 20_000, ready: true }),
  ],
})

describe('RoomScreen', () => {
  it('takes a hold’em seat through a bounded buy-in prompt', async () => {
    const client = fakeClient(makeState({ room: standingRoom }))
    wrap(client)

    const seats = screen.getAllByRole('button', { name: /sit down/i })
    expect(seats).toHaveLength(3) // seats 1, 2 and 3 are free
    await userEvent.click(seats[0]!)

    const dialog = screen.getByRole('dialog')
    const amount = within(dialog).getByLabelText('Buy-in')
    expect(amount).toHaveAttribute('min', '10000') // 50 BB × 200
    expect(amount).toHaveAttribute('max', '40000') // 200 BB × 200
    expect(amount).toHaveAttribute('step', '200')
    expect(amount).toHaveValue(10_000)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Sit down' }))
    expect(client.sitDown).toHaveBeenCalledWith(1, 10_000)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('snaps a typed buy-in onto the big-blind grid and clamps it to the legal range', async () => {
    const client = fakeClient(makeState({ room: standingRoom }))
    wrap(client)

    const confirm = async (typed: string): Promise<void> => {
      await userEvent.click(screen.getAllByRole('button', { name: /sit down/i })[0]!)
      const dialog = within(screen.getByRole('dialog'))
      await userEvent.clear(dialog.getByLabelText('Buy-in'))
      await userEvent.type(dialog.getByLabelText('Buy-in'), typed)
      await userEvent.click(dialog.getByRole('button', { name: 'Sit down' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    }

    await confirm('10350') // nearest multiple of the 200-point step
    expect(client.sitDown).toHaveBeenLastCalledWith(1, 10_400)

    await confirm('999999') // above 200 BB
    expect(client.sitDown).toHaveBeenLastCalledWith(1, 40_000)

    await confirm('5') // below 50 BB
    expect(client.sitDown).toHaveBeenLastCalledWith(1, 10_000)
  })

  it('offers ready and stand-up once seated', async () => {
    const room = makeRoom({
      status: 'OPEN',
      playerCount: 2,
      players: [
        makePlayer({ playerId: 'a', displayName: 'Ann', isHost: true, seat: 0, status: 'SEATED', stack: 20_000 }),
        makePlayer({ playerId: 'me', displayName: 'Mai', seat: 1, status: 'SEATED', stack: 20_000 }),
      ],
    })
    const client = fakeClient(makeState({ room }))
    wrap(client)

    expect(screen.queryAllByRole('button', { name: /sit down/i })).toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: 'Ready' }))
    expect(client.setReady).toHaveBeenCalledWith(true)

    await userEvent.click(screen.getByRole('button', { name: 'Stand up' }))
    expect(client.standUp).toHaveBeenCalledTimes(1)
  })

  it('lets the host start once two players are ready, and kick the others', async () => {
    const client = fakeClient(makeState({ room: readyRoom }))
    wrap(client)

    expect(screen.getByText('2/2 ready')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(client.startGame).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'Kick — Ann' }))
    expect(client.kick).toHaveBeenCalledWith('a')
  })

  it('hides the start button from non-hosts and while fewer than two are ready', () => {
    const guest = makeRoom({
      status: 'OPEN',
      players: [
        makePlayer({ playerId: 'a', displayName: 'Ann', isHost: true, seat: 0, status: 'READY', stack: 20_000, ready: true }),
        makePlayer({ playerId: 'me', displayName: 'Mai', seat: 1, status: 'READY', stack: 20_000, ready: true }),
      ],
    })
    wrap(fakeClient(makeState({ room: guest })))

    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    expect(screen.getByText('Waiting for the host to start')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^kick/i })).toBeNull()
  })

  it('renders the action bar on my turn and sends the action I pick', async () => {
    const room = makeRoom({
      players: [
        makePlayer({ playerId: 'a', displayName: 'Ann', isHost: true, seat: 0, status: 'IN_HAND', stack: 19_800 }),
        makePlayer({ playerId: 'me', displayName: 'Mai', seat: 2, status: 'IN_HAND', stack: 19_900 }),
      ],
    })
    const hand = makeHand({
      mySeat: 2,
      actingSeat: 2,
      legal: { seat: 2, kinds: ['fold', 'call', 'allIn'], callAmount: 300, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 },
    })
    const client = fakeClient(makeState({ room, hand }))
    wrap(client)

    await userEvent.click(screen.getByRole('button', { name: 'Fold' }))
    expect(client.act).toHaveBeenCalledWith({ kind: 'fold' })
  })

  it('shows the reconnect banner while the socket is down and leaves on request', async () => {
    const client = fakeClient(makeState({ status: 'reconnecting', room: standingRoom }))
    wrap(client)

    expect(screen.getByText('Connection lost — reconnecting…')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Leave' }))
    expect(client.leaveRoom).toHaveBeenCalledTimes(1)
  })

  it('calls onLeft as soon as the room is gone', () => {
    const client = fakeClient(makeState({ room: standingRoom }))
    const { view, onLeft } = wrap(client)
    expect(onLeft).not.toHaveBeenCalled()

    view.rerender(screenFor(fakeClient(makeState({ room: null })), onLeft))
    expect(onLeft).toHaveBeenCalledTimes(1)
  })

  // Fix #11: a refresh on `#/room` mounts with no room and none confirmed yet. Bouncing on that would throw the
  // player out of the room they are still sitting in, half a second before the snapshot proves it.
  it('lets the finished hand’s result card be waved off the felt', async () => {
    const room = makeRoom({
      players: [
        makePlayer({ playerId: 'a', displayName: 'Ann', isHost: true, seat: 0, status: 'IN_HAND', stack: 19_800 }),
        makePlayer({ playerId: 'me', displayName: 'Mai', seat: 2, status: 'IN_HAND', stack: 20_400 }),
      ],
    })
    const hand = makeHand({
      phase: 'COMPLETE',
      mySeat: 2,
      actingSeat: null,
      result: { payouts: [{ seat: 2, amount: 600 }], pots: [], fee: 0, showdown: null, carryOverOut: 0, uncalledReturned: null, cancelled: false, reason: null },
    })
    wrap(fakeClient(makeState({ room, hand })))

    expect(screen.getByRole('heading', { name: 'Winner' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('heading', { name: 'Winner' })).toBeNull()
  })

  it('waits for the reconnect answer before deciding the room is gone', () => {
    const onLeft = vi.fn()
    const view = render(screenFor(fakeClient(makeState({ room: null, roomStale: true })), onLeft))
    expect(onLeft).not.toHaveBeenCalled()

    // …the RESYNC comes back with a snapshot: the room was there all along.
    view.rerender(screenFor(fakeClient(makeState({ room: standingRoom })), onLeft))
    expect(onLeft).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'T' })).toBeInTheDocument()
  })

  it('leaves once the reconnect answer says there is no room', () => {
    const onLeft = vi.fn()
    const view = render(screenFor(fakeClient(makeState({ room: null, roomStale: true })), onLeft))
    expect(onLeft).not.toHaveBeenCalled()

    view.rerender(screenFor(fakeClient(makeState({ room: null, roomStale: false })), onLeft))
    expect(onLeft).toHaveBeenCalledTimes(1)
  })
})
