import { HandCategory, parseCards, type RoomPlayerView } from '@bp/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultChibi, useTableExpressions } from '../avatar2d/index.js'
import type { ClientHand, ClientState } from '../client/types.js'
import type { GameClientApi } from '../client/useGameClient.js'
import { createI18n } from '../i18n/index.js'
import { makeHand, makePlayer, makeRoom, makeSeat, makeState } from '../test-fixtures.js'
import s from '../table/table.module.css'
import { REVEAL_HOLD_MS } from './reveal-hold.js'
import { RoomScreen } from './RoomScreen.js'

// The faces are the one thing of the table's result the screen cannot be asked about from outside, so one test reads what
// `RoomScreen` hands `useTableExpressions`. The hook itself runs as it is: the spy calls straight through.
vi.mock('../avatar2d/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../avatar2d/index.js')>()
  return { ...actual, useTableExpressions: vi.fn(actual.useTableExpressions) }
})

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

  it('threads the app slots down to the seats', () => {
    // Ann hosts, so the viewer sees no kick roster and every "Ann" on screen is her seat plate.
    const room = makeRoom({
      status: 'OPEN',
      playerCount: 2,
      players: [
        makePlayer({ playerId: 'a', displayName: 'Ann', isHost: true, seat: 0, status: 'SEATED', stack: 20_000 }),
        makePlayer({ playerId: 'me', displayName: 'Mai', seat: 1, status: 'SEATED', stack: 20_000 }),
      ],
    })
    const client = fakeClient(makeState({ room }))
    render(
      <I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>
        <RoomScreen
          client={client}
          lang="en"
          onLeft={vi.fn()}
          chibiFor={(p) => (p.playerId === 'a' ? defaultChibi(p.playerId) : null)}
          captionFor={(p) => (p.playerId === 'a' ? 'Hot Hand' : null)}
        />
      </I18nextProvider>,
    )

    // Ann's plate draws the app's chibi (data-face="app"); Mai's answered `null`, so hers falls back to her
    // initial the way a seat with no `chibiFor` at all would.
    const ann = screen.getByText('Ann').parentElement
    expect(within(ann!).getByText('Hot Hand')).toBeInTheDocument()
    expect(screen.getByText('Ann').closest(`.${s.plate}`)!.querySelector(`.${s.avatar}`)).toHaveAttribute('data-face', 'app')
    // Mai answered `null`, so her plate keeps the two lines it always had and falls back to her initial.
    const mai = screen.getByText('Mai').parentElement
    expect(within(mai!).queryByText('Hot Hand')).toBeNull()
    expect(screen.getByText('Mai').closest(`.${s.plate}`)!.querySelector(`.${s.avatar}`)).toHaveAttribute('data-face', 'default')
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

  it('toggles sitting out from the tray, and offers it to nobody who is not in a seat', async () => {
    const seatedAs = (sittingOut: boolean) =>
      makeRoom({
        status: 'OPEN',
        playerCount: 2,
        players: [
          makePlayer({ playerId: 'a', displayName: 'Ann', isHost: true, seat: 0, status: 'SEATED', stack: 20_000 }),
          makePlayer({ playerId: 'me', displayName: 'Mai', seat: 1, status: sittingOut ? 'SITTING_OUT' : 'SEATED', sittingOut, stack: 20_000 }),
        ],
      })

    const standing = fakeClient(makeState({ room: standingRoom }))
    const { view } = wrap(standing)
    const idle = screen.getByRole('button', { name: 'Sit out' })
    expect(idle).toBeDisabled()
    expect(idle).not.toHaveAttribute('aria-pressed') // no seat, so no toggle state to announce

    const seated = fakeClient(makeState({ room: seatedAs(false) }))
    view.rerender(screenFor(seated))
    const out = screen.getByRole('button', { name: 'Sit out' })
    expect(out).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(out)
    expect(seated.sitOut).toHaveBeenCalledTimes(1)
    expect(seated.sitIn).not.toHaveBeenCalled()

    // The server answers with PLAYER_SIT_OUT; the seat's own `sittingOut` flag is what flips the control over.
    const sitting = fakeClient(makeState({ room: seatedAs(true) }))
    view.rerender(screenFor(sitting))
    const back = screen.getByRole('button', { name: 'Sit back in' })
    expect(back).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(back)
    expect(sitting.sitIn).toHaveBeenCalledTimes(1)
  })

  it('keeps the toggle pressed through a snapshot taken mid-hand, where the seat still reads IN_HAND', async () => {
    // A RESYNC, a seq gap or a reconnect rebuilds the room from a snapshot, and `status` reports the hand the
    // sitter is still finishing. Only the seat's own flag can keep the control honest — and cancellable.
    const room = makeRoom({
      status: 'IN_GAME',
      playerCount: 2,
      players: [
        makePlayer({ playerId: 'a', displayName: 'Ann', isHost: true, seat: 0, status: 'IN_HAND', stack: 20_000 }),
        makePlayer({ playerId: 'me', displayName: 'Mai', seat: 1, status: 'IN_HAND', sittingOut: true, stack: 20_000 }),
      ],
    })
    const client = fakeClient(makeState({ room }))
    wrap(client)

    const back = screen.getByRole('button', { name: 'Sit back in' })
    expect(back).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(back)
    expect(client.sitIn).toHaveBeenCalledTimes(1)
    expect(client.sitOut).not.toHaveBeenCalled()
  })

  it('counts only playing seats as ready, so the host cannot start a table one player is sitting out of', () => {
    // The server's `readySeats()` drops sitters; the tray must agree, or the host gets "2/2 ready", a live Start
    // and no hint for a table that answers NOT_ENOUGH_PLAYERS.
    const room = makeRoom({
      status: 'OPEN',
      hostPlayerId: 'me',
      playerCount: 2,
      players: [
        makePlayer({ playerId: 'a', displayName: 'Ann', seat: 0, status: 'SITTING_OUT', sittingOut: true, stack: 20_000, ready: true }),
        makePlayer({ playerId: 'me', displayName: 'Mai', isHost: true, seat: 1, status: 'READY', stack: 20_000, ready: true }),
      ],
    })
    wrap(fakeClient(makeState({ room })))

    expect(screen.getByText('1/2 ready')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    expect(screen.getByText('At least 2 players must be ready to start')).toBeInTheDocument()
  })

  it('lets the host start once two players are ready, and kick the others from Manage table', async () => {
    const client = fakeClient(makeState({ room: readyRoom }))
    wrap(client)

    expect(screen.getByText('2/2 ready')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(client.startGame).toHaveBeenCalledTimes(1)

    // The roster is not open in the tray any more (layout audit C5): it is one button away.
    expect(screen.queryByRole('button', { name: 'Kick — Ann' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Manage table' }))
    const dialog = screen.getByRole('dialog', { name: 'People in the room' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kick — Ann' }))
    expect(client.kick).toHaveBeenCalledWith('a')
  })

  it("lists a bot in the kick roster without its virtual bankroll", async () => {
    const withBot = makeRoom({
      status: 'OPEN',
      players: [
        ...readyRoom.players,
        makePlayer({ playerId: 'bot-1', displayName: 'Bot 1', isBot: true, seat: 2, status: 'READY', stack: 1_000_000, ready: true }),
      ],
    })
    wrap(fakeClient(makeState({ room: withBot })))
    await userEvent.click(screen.getByRole('button', { name: 'Manage table' }))
    const roster = screen.getByRole('list', { name: 'Players' })
    expect(within(roster).getByText('Bot 1')).toBeInTheDocument()
    expect(within(roster).queryByText('1,000,000')).toBeNull()
    expect(within(roster).getByText('20,000')).toBeInTheDocument()
  })

  it('kicks a bot from Manage table; once the server lets it go, its seat is free and the list keeps the rest (T3)', async () => {
    const bot = makePlayer({ playerId: 'bot:r:0', displayName: 'Bot 1', isBot: true, seat: 2, status: 'READY', stack: 1_000_000, ready: true })
    const client = fakeClient(makeState({ room: makeRoom({ status: 'OPEN', hostPlayerId: 'me', players: [...readyRoom.players, bot] }) }))
    const { view } = wrap(client)
    expect(screen.getByText('Bot 1')).toBeInTheDocument() // its seat plate

    await userEvent.click(screen.getByRole('button', { name: 'Manage table' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Kick — Bot 1' }))
    expect(client.kick).toHaveBeenCalledWith('bot:r:0')

    // The server answers with PLAYER_LEFT, which the reducer applies to the roster: the same screen, one bot fewer.
    view.rerender(screenFor(fakeClient(makeState({ room: makeRoom({ status: 'OPEN', hostPlayerId: 'me', players: readyRoom.players }) }))))
    const roster = screen.getByRole('list', { name: 'Players' })
    expect(within(roster).getByText('Ann')).toBeInTheDocument()
    expect(screen.queryByText('Bot 1'), 'gone from the list and from its seat').toBeNull()
  })

  it('offers Manage table in the countdown between hands too, and closes it for good when the next hand is dealt', async () => {
    // A Blind table with bots stays IN_GAME between its hands; that countdown is when the server lets a bot go.
    const bot = makePlayer({ playerId: 'bot:r:0', displayName: 'Bot 1', isBot: true, seat: 2, status: 'READY', stack: 1_000_000, ready: true })
    const players = [...readyRoom.players, bot]
    const between = makeRoom({ status: 'IN_GAME', hostPlayerId: 'me', nextHandAt: 1_004_000, players })
    const finished = makeHand({ handId: 'h1', phase: 'COMPLETE', mySeat: 1, actingSeat: null, legal: null })
    const client = fakeClient(makeState({ room: between, hand: finished }))
    const { view } = wrap(client)

    await userEvent.click(screen.getByRole('button', { name: 'Manage table' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Kick — Bot 1' }))
    expect(client.kick).toHaveBeenCalledWith('bot:r:0')

    // The next deal: the list closes and the button goes while cards are out…
    const live = makeHand({ handId: 'h2', phase: 'BETTING', mySeat: 1, actingSeat: 0, legal: null })
    view.rerender(screenFor(fakeClient(makeState({ room: between, hand: live }))))
    expect(screen.queryByRole('dialog', { name: 'People in the room' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Manage table' })).toBeNull()

    // …and when that hand is over the button is back, but the list stays shut until it is asked for again.
    view.rerender(screenFor(fakeClient(makeState({ room: between, hand: { ...live, phase: 'COMPLETE' } }))))
    expect(screen.getByRole('button', { name: 'Manage table' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'People in the room' })).toBeNull()
  })

  it('keeps Start off while the only ready seats are bots, and says what the host must do', async () => {
    const bots = [1, 2, 3].map((i) => makePlayer({ playerId: `bot-${i}`, displayName: `Bot ${i}`, isBot: true, seat: i, status: 'READY', stack: 1_000_000, ready: true }))
    const host = makePlayer({ playerId: 'me', displayName: 'Mai', isHost: true, seat: 0, status: 'SEATED', stack: 20_000, ready: false })
    const client = fakeClient(makeState({ room: makeRoom({ status: 'OPEN', hostPlayerId: 'me', playerCount: 4, players: [host, ...bots] }) }))
    const { view } = wrap(client)

    expect(screen.getByText('3/4 ready')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    expect(screen.getByText('Press Ready to start — a hand needs at least one real player.')).toBeInTheDocument()

    // The host presses Ready: the same table can now deal, and the hint goes away.
    view.rerender(screenFor(fakeClient(makeState({ room: makeRoom({ status: 'OPEN', hostPlayerId: 'me', playerCount: 4, players: [{ ...host, ready: true, status: 'READY' }, ...bots] }) }))))
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    expect(screen.queryByText(/Press Ready to start/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
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
    expect(screen.queryByRole('button', { name: 'Manage table' })).toBeNull()
  })

  describe('a player the balance cannot seat (T4, table limit)', () => {
    /** Play-or-fold at 5,000: a hand needs the ante and the play, 10,000; the table limit is 25,000. */
    const blindRoom = (me: Partial<RoomPlayerView>, decisionMode: 'none' | 'playOrFold' = 'playOrFold') =>
      makeRoom({
        mode: 'blind',
        status: 'OPEN',
        hostPlayerId: 'me',
        config: {
          name: 'B',
          mode: 'blind',
          maxPlayers: 4,
          isPrivate: false,
          turnTimerSec: 15,
          autoStart: false,
          hasPassword: false,
          blind: { holeCards: 3, decisionMode, fixedWager: 5_000, botCount: 1 },
        },
        players: [
          makePlayer({ playerId: 'me', displayName: 'Mai', isHost: true, seat: null, status: null, stack: 0, ...me }),
          makePlayer({ playerId: 'bot:r:0', displayName: 'Bot 1', isBot: true, seat: 3, status: 'READY', stack: 25_000, ready: true }),
        ],
      })

    it('tells a spectator whose balance cannot cover a hand what sitting down needs', () => {
      wrap(fakeClient(makeState({ balance: 7_000, room: blindRoom({}) })))
      expect(screen.getByText('Not enough points to take a seat (need 10,000)')).toBeInTheDocument()
      expect(screen.queryByText('Take a seat to play.')).toBeNull()
    })

    it('measures pure luck against the stake alone', () => {
      wrap(fakeClient(makeState({ balance: 4_000, room: blindRoom({}, 'none') })))
      expect(screen.getByText('Not enough points to take a seat (need 5,000)')).toBeInTheDocument()
    })

    it('says it between hands too, while the table plays on without them', () => {
      const room = { ...blindRoom({}), status: 'IN_GAME' as const, nextHandAt: 1_005_000 }
      wrap(fakeClient(makeState({ balance: 7_000, room })))
      expect(screen.getByText('Not enough points to take a seat (need 10,000)')).toBeInTheDocument()
    })

    it('never says it to a seated player: their points are on the table, and a short seat is stood up', () => {
      wrap(fakeClient(makeState({ balance: 0, room: blindRoom({ seat: 0, status: 'SEATED', stack: 25_000 }) })))
      expect(screen.queryByText(/Not enough points/)).toBeNull()
      expect(screen.getByText('Press Ready to start — a hand needs at least one real player.')).toBeInTheDocument()
    })

    it('keeps the usual hint once the balance covers a hand', () => {
      wrap(fakeClient(makeState({ balance: 10_000, room: blindRoom({}) })))
      expect(screen.queryByText(/Not enough points/)).toBeNull()
      expect(screen.getByText('Take a seat to play.')).toBeInTheDocument()
    })

    it('writes the amount the way the app writes points, in Vietnamese too', () => {
      render(
        <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
          <RoomScreen client={fakeClient(makeState({ balance: 7_000, room: blindRoom({}) }))} lang="vi" onLeft={vi.fn()} />
        </I18nextProvider>,
      )
      expect(screen.getByText('Số dư không đủ để vào bàn (cần 10.000 điểm)')).toBeInTheDocument()
    })

    it('shows the wager and the table limit in the header', () => {
      wrap(fakeClient(makeState({ balance: 50_000, room: blindRoom({}) })))
      expect(screen.getByText(/Wager 5,000 · Limit 25,000/)).toBeInTheDocument()
    })
  })

  it('tells a host who has not sat down to take a seat, not to press Ready (layout audit C5)', () => {
    const bots = [1, 2, 3].map((i) => makePlayer({ playerId: `bot-${i}`, displayName: `Bot ${i}`, isBot: true, seat: i, status: 'READY', stack: 1_000_000, ready: true }))
    const host = makePlayer({ playerId: 'me', displayName: 'Mai', isHost: true, seat: null, status: 'SEATED', stack: 0, ready: false })
    wrap(fakeClient(makeState({ room: makeRoom({ status: 'OPEN', hostPlayerId: 'me', playerCount: 4, players: [host, ...bots] }) })))

    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    expect(screen.getByText('Take a seat to play.')).toBeInTheDocument()
    expect(screen.queryByText(/Press Ready/)).toBeNull()
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

  // Review round 2, R2-3: on a short stage the result card covered the viewer's own seat. The overlay's foot now stops
  // above that seat when there is room for the card there — jsdom lays nothing out, so the boxes are pinned here.
  describe('the result card stops above the viewer’s own seat', () => {
    const box = (top: number, bottom: number): DOMRect =>
      ({ top, bottom, left: 0, right: 900, x: 0, y: top, width: 900, height: bottom - top, toJSON: () => ({}) }) as DOMRect
    /** The stage 100–700 px, the viewer's seat from 480 px with its plate from 540 px: room for the card above it all. */
    const pinBoxes = () =>
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        if (this.tagName === 'MAIN') return box(100, 700)
        if (this.getAttribute('data-me') === 'true') return box(480, 680)
        if (this.hasAttribute('data-plate') && this.closest('[data-me="true"]') !== null) return box(540, 590)
        return box(0, 0)
      })
    const finished = (mySeat: number | null) =>
      makeHand({
        phase: 'COMPLETE',
        mySeat,
        actingSeat: null,
        result: { payouts: [{ seat: 0, amount: 600 }], pots: [], fee: 0, showdown: null, carryOverOut: 0, uncalledReturned: null, cancelled: false, reason: null },
      })
    const seatedRoom = makeRoom({
      players: [
        makePlayer({ playerId: 'a', displayName: 'Ann', isHost: true, seat: 0, status: 'IN_HAND', stack: 20_400 }),
        makePlayer({ playerId: 'me', displayName: 'Mai', seat: 2, status: 'IN_HAND', stack: 19_800 }),
      ],
    })
    const overlayOf = (): HTMLElement => screen.getByRole('group', { name: 'Winner' }).parentElement!

    it('pads the overlay by the seat block plus the gap while the card is up', () => {
      const spy = pinBoxes()
      try {
        wrap(fakeClient(makeState({ room: seatedRoom, hand: finished(2) })))
        // 700 − 480 + 8: the stage ends 8 px above the top of the viewer's seat block
        expect(overlayOf().style.getPropertyValue('--seat-clearance')).toBe('228px')
      } finally {
        spy.mockRestore()
      }
    })

    it('leaves a spectator’s card the whole stage', () => {
      const spy = pinBoxes()
      try {
        const watching = makeRoom({
          players: [
            makePlayer({ playerId: 'a', displayName: 'Ann', isHost: true, seat: 0, status: 'IN_HAND', stack: 20_400 }),
            makePlayer({ playerId: 'me', displayName: 'Mai' }),
          ],
        })
        wrap(fakeClient(makeState({ room: watching, hand: finished(null) })))
        expect(document.querySelector('[data-me]')).toBeNull()
        expect(overlayOf().style.getPropertyValue('--seat-clearance')).toBe('')
      } finally {
        spy.mockRestore()
      }
    })

    it('clears the viewer’s seat once they take one under the card, and gives the stage back when they leave it', () => {
      const spy = pinBoxes()
      try {
        const hand = finished(null)
        const watching = makeRoom({
          players: [
            makePlayer({ playerId: 'a', displayName: 'Ann', isHost: true, seat: 0, status: 'IN_HAND', stack: 20_400 }),
            makePlayer({ playerId: 'me', displayName: 'Mai' }),
          ],
        })
        const { view } = wrap(fakeClient(makeState({ room: watching, hand })))
        expect(overlayOf().style.getPropertyValue('--seat-clearance')).toBe('')
        // nothing on the stage changes size when a seat is taken: the hook looks again because the viewer's seat did
        view.rerender(screenFor(fakeClient(makeState({ room: seatedRoom, hand }))))
        expect(overlayOf().style.getPropertyValue('--seat-clearance')).toBe('228px')
        view.rerender(screenFor(fakeClient(makeState({ room: watching, hand }))))
        expect(overlayOf().style.getPropertyValue('--seat-clearance')).toBe('')
      } finally {
        spy.mockRestore()
      }
    })

    // The overlay is the card's own wrapper, so this proves only that the two leave together; the hook's own reset on
    // switching off is `seat-clearance.test.ts`'s.
    it('takes the overlay away with the card when it is waved off', async () => {
      const spy = pinBoxes()
      try {
        wrap(fakeClient(makeState({ room: seatedRoom, hand: finished(2) })))
        expect(overlayOf().style.getPropertyValue('--seat-clearance')).toBe('228px')
        await userEvent.click(screen.getByRole('button', { name: 'Close' }))
        expect(screen.queryByRole('group', { name: 'Winner' })).toBeNull()
        expect(document.querySelector('[style*="--seat-clearance"]')).toBeNull()
      } finally {
        spy.mockRestore()
      }
    })
  })

  // Review 2026-09-29, No2: printed under the card, the countdown landed on the viewer's own seat. It is the card's
  // footer line now, and it moves to the tray only once the card has been waved off.
  it('counts down to the next deal on the result card, and in the tray once the card is closed', async () => {
    const room = makeRoom({
      nextHandAt: 1_005_000,
      players: [
        makePlayer({ playerId: 'a', displayName: 'Ann', isHost: true, seat: 0, status: 'IN_HAND', stack: 19_800 }),
        makePlayer({ playerId: 'me', displayName: 'Mai', seat: 2, status: 'IN_HAND', stack: 20_400 }),
      ],
    })
    const hand = makeHand({
      phase: 'COMPLETE',
      mySeat: 2,
      actingSeat: null,
      result: { payouts: [{ seat: 2, amount: 600 }], pots: [], fee: 12, showdown: null, carryOverOut: 0, uncalledReturned: null, cancelled: false, reason: null },
    })
    wrap(fakeClient(makeState({ room, hand })))

    const card = screen.getByRole('group', { name: 'Winner' })
    const next = within(card).getByText((_, el) => el?.textContent === 'Next hand in 5 sec' && el.tagName === 'P')
    // R2-4: outside every live region, so a screen reader that ignores a nested `aria-live="off"` still keeps quiet
    expect(next.closest('[role="status"], [role="alert"], [aria-live="polite"], [aria-live="assertive"]')).toBeNull()
    const controls = screen.getByRole('group', { name: 'Table controls' })
    expect(within(controls).queryByText(/Next hand in/)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(within(controls).getByText((_, el) => el?.textContent === 'Next hand in 5 sec' && el.tagName === 'P')).toBeInTheDocument()
  })

  // Review round 2, fix wave (No1): the result card opened in the very render that turned an opponent's cards over, so
  // it covered the turn it was meant to follow — the top seat's at 1920 × 940, every opponent's on a 375 × 812 phone.
  describe('the result card waits while an opponent’s cards turn over', () => {
    const room = makeRoom({
      nextHandAt: 1_005_000,
      players: [
        makePlayer({ playerId: 'a', displayName: 'Ann', isHost: true, seat: 0, status: 'IN_HAND', stack: 19_800 }),
        makePlayer({ playerId: 'me', displayName: 'Mai', seat: 2, status: 'IN_HAND', stack: 19_800 }),
      ],
    })
    /** Ann to act on the last street, seen from my seat: my queens up, Ann's two cards backs. */
    const river = makeHand({
      handId: 'h7',
      mySeat: 2,
      actingSeat: 0,
      seats: [
        makeSeat({ seat: 0, playerId: 'a', displayName: 'Ann', stack: 19_800 }),
        makeSeat({ seat: 2, playerId: 'me', displayName: 'Mai', stack: 19_800, holeCards: parseCards('Qs Qd') }),
      ],
    })
    const settled = { pots: [], fee: 0, carryOverOut: 0, uncalledReturned: null, cancelled: false, reason: null }
    /** `SHOWDOWN`, `SETTLEMENT` and `HAND_COMPLETE` as the reducer leaves them: Ann's cards up, both hands shown. */
    const shownDown: ClientHand = {
      ...river,
      phase: 'COMPLETE',
      actingSeat: null,
      seats: [{ ...river.seats[0]!, holeCards: parseCards('Js Th') }, river.seats[1]!],
      result: {
        ...settled,
        payouts: [{ seat: 2, amount: 600 }],
        showdown: [
          { seat: 0, cards: parseCards('Js Th'), rank: 1, category: HandCategory.HIGH_CARD, best: parseCards('Ah Kd Js Th 2c') },
          { seat: 2, cards: parseCards('Qs Qd'), rank: 2, category: HandCategory.PAIR, best: parseCards('Qs Qd Ah Kd 2c') },
        ],
      },
    }
    /** Ann folded on the river: nothing is shown, so nothing turns. */
    const foldWin: ClientHand = {
      ...river,
      phase: 'COMPLETE',
      actingSeat: null,
      seats: [{ ...river.seats[0]!, folded: true }, river.seats[1]!],
      result: { ...settled, payouts: [{ seat: 2, amount: 600 }], showdown: null },
    }

    const resultCard = () => screen.queryByRole('group', { name: 'Winner' })
    /** The table as it was on the river, then the frames that end the hand landing on the same screen. */
    const playTo = (end: ClientHand) => {
      const { view } = wrap(fakeClient(makeState({ room, hand: river })))
      view.rerender(screenFor(fakeClient(makeState({ room, hand: end }))))
    }

    let reduceMotion = false
    beforeEach(() => {
      vi.useFakeTimers()
      reduceMotion = false
      // jsdom has no `matchMedia`; this one answers the reduced-motion query and nothing else.
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (query: string) => ({
          matches: reduceMotion && query.includes('prefers-reduced-motion: reduce'),
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }),
      })
    })
    afterEach(() => {
      vi.useRealTimers()
      Reflect.deleteProperty(window, 'matchMedia')
    })

    it('holds the card while the cards turn, and deals it once the turn is over', () => {
      playTo(shownDown)
      const ann = screen.getByRole('group', { name: 'Seat 1' })
      expect(within(ann).getByRole('img', { name: 'Jack of spades' }), 'Ann’s cards are up from the first render').toBeInTheDocument()
      expect(ann.querySelectorAll(`.${s.cardTurn}`), 'and turning').toHaveLength(2)
      expect(resultCard(), 'no card over the turn').toBeNull()
      // The countdown waits with the card: printed in the tray for the hold, it would jump onto the card a moment
      // later and shift the tray's buttons as it went.
      const controls = screen.getByRole('group', { name: 'Table controls' })
      expect(within(controls).queryByText(/Next hand in/)).toBeNull()

      act(() => vi.advanceTimersByTime(REVEAL_HOLD_MS - 1))
      expect(resultCard()).toBeNull()
      act(() => vi.advanceTimersByTime(1))
      expect(resultCard()).toBeInTheDocument()
      expect(within(resultCard()!).getByText((_, el) => el?.textContent === 'Next hand in 5 sec' && el.tagName === 'P')).toBeInTheDocument()
      expect(within(controls).queryByText(/Next hand in/)).toBeNull()
    })

    it('deals the card at once under reduced motion, where nothing turns', () => {
      reduceMotion = true
      playTo(shownDown)
      expect(resultCard()).toBeInTheDocument()
    })

    // Follow-up to No1: the table keeps the result to itself for the hold as well — the lines under the seats, the winner's
    // glow and the gold edge on the board wait with the card, and all of it lands in the render that deals the card.
    describe('and the table keeps the result to itself until then', () => {
      const seatOf = (n: number) => screen.getByRole('group', { name: `Seat ${n}` })
      const resultLines = () => document.querySelectorAll(`.${s.seatResult}`)
      const winnerGlows = () => document.querySelectorAll(`.${s.seatWin}`)
      // the board's own cards: the result card draws gold-edged cards of its own
      const goldEdges = () => screen.getByRole('group', { name: 'Community cards' }).querySelectorAll(`.${s.cardHi}`)
      /** Everything the table says about the result: none of it, or all of it. */
      const tableSaysNothing = () => {
        expect(resultLines(), 'no result line under any seat').toHaveLength(0)
        expect(winnerGlows(), 'no winner glow').toHaveLength(0)
        expect(goldEdges(), 'no gold edge on the board').toHaveLength(0)
        for (const text of ['Pair', 'High card', '+600']) expect(screen.queryByText(text), text).toBeNull()
      }
      const tableSaysItAll = () => {
        // Ann (seat 1) lost with jack high; I (seat 3) won 600 with a pair of queens, on the ace, the king and the deuce
        expect(within(seatOf(1)).getByText('High card')).toBeInTheDocument()
        expect(within(seatOf(3)).getByText('Pair')).toBeInTheDocument()
        expect(within(seatOf(3)).getByText('+600')).toBeInTheDocument()
        expect(winnerGlows()).toHaveLength(1)
        expect(seatOf(3).className).toContain(s.seatWin)
        expect(goldEdges()).toHaveLength(3)
      }

      it('shows the cards turning and nothing of the result, then everything together with the card', () => {
        playTo(shownDown)
        expect(within(seatOf(1)).getByRole('img', { name: 'Jack of spades' }), 'Ann’s cards are up from the first render').toBeInTheDocument()
        expect(seatOf(1).querySelectorAll(`.${s.cardTurn}`), 'and turning').toHaveLength(2)
        expect(resultCard()).toBeNull()
        tableSaysNothing()

        act(() => vi.advanceTimersByTime(REVEAL_HOLD_MS - 1))
        expect(resultCard()).toBeNull()
        tableSaysNothing()
        expect(seatOf(1).querySelectorAll(`.${s.cardTurn}`), 'the turn is still playing').toHaveLength(2)

        act(() => vi.advanceTimersByTime(1))
        expect(resultCard()).toBeInTheDocument()
        tableSaysItAll()
        expect(seatOf(1).querySelectorAll(`.${s.cardTurn}`), 'the turn is left alone').toHaveLength(2)
      })

      it('shows all of it at once under reduced motion, where nothing turns', () => {
        reduceMotion = true
        playTo(shownDown)
        expect(resultCard()).toBeInTheDocument()
        tableSaysItAll()
      })

      it('shows all of it at once when the hand was won by a fold', () => {
        playTo(foldWin)
        expect(resultCard()).toBeInTheDocument()
        expect(within(seatOf(3)).getByText('+600')).toBeInTheDocument()
        expect(winnerGlows()).toHaveLength(1)
      })

      it('shows all of it for a hand already over when the screen mounts — a snapshot after a refresh', () => {
        wrap(fakeClient(makeState({ room, hand: shownDown })))
        expect(resultCard()).toBeInTheDocument()
        tableSaysItAll()
      })

      it('keeps what is waved off off: the hold does not bring the lines back', () => {
        playTo(shownDown)
        act(() => vi.advanceTimersByTime(REVEAL_HOLD_MS))
        fireEvent.click(screen.getByRole('button', { name: 'Close' }))
        expect(resultCard()).toBeNull()
        // the lines belong to the table, not to the card: they stay under the seats once it is closed
        tableSaysItAll()
      })

      // The faces keep the result to themselves on the same flag, so their reaction counts from the end of the hold and runs
      // its full length (`expression.test.ts` holds what the hook does with it). Here: the room raises the flag for the
      // hold, and not a render longer or shorter.
      describe('and tells the faces the result is pending', () => {
        const pending = () => vi.mocked(useTableExpressions).mock.lastCall?.[2]

        it('for exactly the hold', () => {
          playTo(shownDown)
          expect(pending()).toBe(true)
          act(() => vi.advanceTimersByTime(REVEAL_HOLD_MS - 1))
          expect(pending()).toBe(true)
          act(() => vi.advanceTimersByTime(1))
          expect(pending()).toBe(false)
        })

        it('not for the hand before the showdown, nor under reduced motion, a fold, or a snapshot of a finished hand', () => {
          const { view } = wrap(fakeClient(makeState({ room, hand: river })))
          expect(pending(), 'the river').toBe(false)
          view.unmount()

          reduceMotion = true
          playTo(shownDown)
          expect(pending(), 'reduced motion').toBe(false)
          cleanup()

          reduceMotion = false
          playTo(foldWin)
          expect(pending(), 'a fold').toBe(false)
          cleanup()

          wrap(fakeClient(makeState({ room, hand: shownDown })))
          expect(pending(), 'a snapshot').toBe(false)
        })
      })
    })

    it('deals the card at once when the hand was won by a fold', () => {
      playTo(foldWin)
      expect(resultCard()).toBeInTheDocument()
    })

    it('deals the card at once for a hand already over when the screen mounts — a snapshot after a refresh', () => {
      wrap(fakeClient(makeState({ room, hand: shownDown })))
      expect(resultCard()).toBeInTheDocument()
    })

    it('can be waved off once it is dealt, and the countdown moves to the tray', () => {
      playTo(shownDown)
      act(() => vi.advanceTimersByTime(REVEAL_HOLD_MS))
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      expect(resultCard()).toBeNull()
      const controls = screen.getByRole('group', { name: 'Table controls' })
      expect(within(controls).getByText((_, el) => el?.textContent === 'Next hand in 5 sec' && el.tagName === 'P')).toBeInTheDocument()

      act(() => vi.advanceTimersByTime(REVEAL_HOLD_MS))
      expect(resultCard(), 'the hold does not bring a waved-off card back').toBeNull()
    })
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
