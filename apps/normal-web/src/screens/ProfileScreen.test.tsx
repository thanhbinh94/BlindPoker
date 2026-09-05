import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, type AvatarConfigDto, type HistoryEntryDto, type LedgerPageDto, type MeDto, type NormalApi, type PlayerStatsDto } from '../api.js'
import viNormal from '../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../test-i18n.js'
import { ProfileScreen } from './ProfileScreen.js'

const AVATAR: AvatarConfigDto = {
  base: 'base_01',
  face: 'face_02',
  clothing: 'clothing_aodai',
  hair: 'hair_bun',
  hairColor: '#d9a441',
  title: 'title_hot_hand',
  badge: 'badge_gold',
}

const ME = {
  playerId: 'p1',
  displayName: 'Bình',
  email: 'binh@example.com',
  balance: 123_000,
  avatar: AVATAR,
  createdAt: Date.UTC(2026, 0, 15),
  lastLoginAt: Date.UTC(2026, 8, 1),
} as unknown as MeDto

const STATS: PlayerStatsDto = {
  handsPlayedHoldem: 240,
  handsWonHoldem: 61,
  handsPlayedBlind: 12,
  handsWonBlind: 3,
  botHands: 40,
  currentWinStreak: 2,
  bestWinStreak: 7,
  currentLoseStreak: 0,
  bestLoseStreak: 4,
  bestHandRank: 5,
  biggestWin: 88_000,
  roomsJoined: 19,
  gamesCompleted: 230,
  totalLoginDays: 44,
  loginStreak: 6,
  bestLoginStreak: 21,
}

const HAND: HistoryEntryDto = {
  handId: 'h1',
  roomId: 'r1',
  mode: 'holdem',
  startedAt: Date.UTC(2026, 8, 3, 10, 0),
  endedAt: Date.UTC(2026, 8, 3, 10, 5),
  net: 5_880,
  won: true,
  bestCategory: 6,
  cancelled: false,
  players: [
    { playerId: 'p1', label: 'Binh', seat: 0, isBot: false, net: 5_880, won: true },
    { playerId: 'p2', label: 'Lan', seat: 1, isBot: false, net: -4_000, won: false },
    { playerId: null, label: 'bot-7', seat: 2, isBot: true, net: -1_880, won: false },
  ],
}

const PAGE_ONE: LedgerPageDto = {
  entries: [
    { id: 42, amount: 5_880, reason: 'settlement', refId: 'h1', createdAt: Date.UTC(2026, 8, 3, 10, 5) },
    { id: 41, amount: -2_000, reason: 'buy_in', refId: 'r1', createdAt: Date.UTC(2026, 8, 3, 9, 55) },
  ],
  nextBefore: 41,
}

const PAGE_TWO: LedgerPageDto = {
  entries: [{ id: 1, amount: 1_000_000, reason: 'starting_balance', refId: null, createdAt: Date.UTC(2026, 0, 15) }],
  nextBefore: null,
}

function stubApi(overrides: Partial<NormalApi> = {}): NormalApi {
  return {
    me: vi.fn().mockResolvedValue(ME),
    stats: vi.fn().mockResolvedValue(STATS),
    history: vi.fn().mockResolvedValue([HAND]),
    ledger: vi.fn().mockResolvedValue(PAGE_ONE),
    rename: vi.fn(),
    ...overrides,
  } as unknown as NormalApi
}

const renderScreen = (api: NormalApi = stubApi()) =>
  renderWithI18n(<ProfileScreen api={api} lang="vi" balance={123_000} />, makeI18n('vi'))

describe('ProfileScreen', () => {
  it('shows one status line while the header, the stats and the history are in flight', () => {
    renderScreen(stubApi({ me: vi.fn(() => new Promise<MeDto>(() => undefined)) }))

    expect(screen.getByRole('status')).toHaveTextContent(viNormal.screens.loading)
    expect(screen.queryByRole('heading', { name: 'Bình' })).toBeNull()
  })

  it('draws the header from the account and the balance from the socket', async () => {
    renderScreen()

    expect(await screen.findByRole('heading', { name: 'Bình', level: 1 })).toBeInTheDocument()
    expect(screen.getByText(viNormal.items.title_hot_hand)).toBeInTheDocument()
    expect(screen.getByText(viNormal.items.badge_gold)).toBeInTheDocument()
    expect(screen.getByText(/Thành viên từ/)).toBeInTheDocument()
    // 123.000 in `vi`: the assertion is on the digits, not on the separator the locale picked.
    expect(screen.getByText(/123/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: viNormal.avatar.mine })).toHaveAttribute('data-size', 'lg')
  })

  it('groups all sixteen counters, prints points with their unit and names the best hand', async () => {
    const { i18n } = renderScreen()
    await screen.findByRole('heading', { name: 'Bình', level: 1 })

    for (const group of Object.values(viNormal.profile.stats.groups)) {
      // `getAllByText`: "Texas Hold'em" is a group heading here *and* a mode label in the history below.
      expect(screen.getAllByText(group).length).toBeGreaterThan(0)
    }
    // "Hands played" is a label under two different headings, which is exactly why the headings are there.
    expect(screen.getAllByText(viNormal.profile.stats.handsPlayedHoldem)).toHaveLength(2)
    expect(screen.getByText(`88.000 ${i18n.t('common:units.pointsShort')}`)).toBeInTheDocument()
    expect(screen.getByText(i18n.t('game:hand.flush'))).toBeInTheDocument()
  })

  it('says "none yet" for a best hand nobody has won', async () => {
    renderScreen(stubApi({ stats: vi.fn().mockResolvedValue({ ...STATS, bestHandRank: 0 }) }))
    await screen.findByRole('heading', { name: 'Bình', level: 1 })

    expect(screen.getByText(viNormal.profile.stats.none)).toBeInTheDocument()
  })

  it('lists the last hands with my own net, the mode, the best hand and who else was there', async () => {
    const api = stubApi()
    const { i18n } = renderScreen(api)
    await screen.findByRole('heading', { name: 'Bình', level: 1 })

    expect(api.history).toHaveBeenCalledWith(20)
    const hands = within(screen.getByRole('list', { name: viNormal.profile.history.title }))
    expect(hands.getByText(i18n.t('game:mode.holdem'))).toBeInTheDocument()
    expect(hands.getByText('+5.880')).toBeInTheDocument()
    expect(hands.getByText(viNormal.profile.history.won)).toBeInTheDocument()
    expect(hands.getByText(i18n.t('game:hand.fullHouse'))).toBeInTheDocument()
    // Everyone but me, with the machine marked as one.
    expect(hands.getByText('Lan')).toBeInTheDocument()
    expect(hands.getByText('bot-7')).toBeInTheDocument()
    expect(hands.getByText(viNormal.profile.history.bot)).toBeInTheDocument()
    expect(hands.queryByText('Binh')).toBeNull()
  })

  it('excludes my own seat by id, even when an opponent happens to share my name', async () => {
    // Display names are not unique, and the server sends one per human seat. Filtering on the name would
    // have dropped the namesake from the list — or, when the reader is the namesake, kept the reader in it.
    const namesake: HistoryEntryDto = {
      ...HAND,
      players: [
        { playerId: 'p1', label: 'Binh', seat: 0, isBot: false, net: 5_880, won: true },
        { playerId: 'p9', label: 'Binh', seat: 1, isBot: false, net: -5_880, won: false },
      ],
    }
    renderScreen(stubApi({ history: vi.fn().mockResolvedValue([namesake]) }))
    await screen.findByRole('heading', { name: 'Bình', level: 1 })

    const hands = within(screen.getByRole('list', { name: viNormal.profile.history.title }))
    expect(hands.getAllByText('Binh')).toHaveLength(1)
  })

  it('says the profile could not be loaded, and asks again when told to', async () => {
    const me = vi.fn().mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'nope')).mockResolvedValue(ME)
    const user = userEvent.setup()
    renderScreen(stubApi({ me }))

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.profile.error)

    await user.click(screen.getByRole('button', { name: viNormal.screens.retry }))

    expect(await screen.findByRole('heading', { name: 'Bình', level: 1 })).toBeInTheDocument()
  })

  it('refuses a name the server validator would refuse, without asking the server', async () => {
    const api = stubApi()
    const user = userEvent.setup()
    renderScreen(api)
    await screen.findByRole('heading', { name: 'Bình', level: 1 })

    const box = screen.getByLabelText(viNormal.profile.rename.label)
    await user.clear(box)
    await user.type(box, 'x')
    await user.click(screen.getByRole('button', { name: viNormal.profile.rename.submit }))

    expect(await screen.findByText(viNormal.auth.errors.INVALID_NAME)).toBeInTheDocument()
    expect(api.rename).not.toHaveBeenCalled()
  })

  it('shows the 409 on the field, then updates the header and warns about the table on success', async () => {
    const rename = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, 'DISPLAY_NAME_TAKEN', 'taken'))
      .mockResolvedValue({ playerId: 'p1', displayName: 'Minh Sài Gòn' })
    const user = userEvent.setup()
    renderScreen(stubApi({ rename }))
    await screen.findByRole('heading', { name: 'Bình', level: 1 })

    const box = screen.getByLabelText(viNormal.profile.rename.label)
    await user.clear(box)
    await user.type(box, 'Minh Sài Gòn')
    await user.click(screen.getByRole('button', { name: viNormal.profile.rename.submit }))

    expect(await screen.findByText(viNormal.auth.errors.DISPLAY_NAME_TAKEN)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Bình', level: 1 })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: viNormal.profile.rename.submit }))

    expect(await screen.findByRole('heading', { name: 'Minh Sài Gòn', level: 1 })).toBeInTheDocument()
    // The seat was named when the player joined the room, so the note is the only honest thing to say.
    expect(screen.getByText(viNormal.profile.rename.saved)).toBeInTheDocument()
    expect(rename).toHaveBeenLastCalledWith('Minh Sài Gòn')
  })

  it('prints the ledger with translated reasons and signed amounts', async () => {
    const api = stubApi()
    renderScreen(api)

    expect(await screen.findByText(viNormal.ledger.reason.settlement)).toBeInTheDocument()
    expect(api.ledger).toHaveBeenCalledWith({ limit: 50 })
    expect(screen.getByText(viNormal.ledger.reason.buy_in)).toBeInTheDocument()
    expect(screen.getByText('-2.000')).toBeInTheDocument()
    expect(screen.getByText(viNormal.profile.ledger.ref.replace('{{id}}', 'h1'))).toBeInTheDocument()
  })

  it('pages the ledger on the cursor the server handed back, and puts the button away at the end', async () => {
    const ledger = vi.fn().mockResolvedValueOnce(PAGE_ONE).mockResolvedValue(PAGE_TWO)
    const user = userEvent.setup()
    renderScreen(stubApi({ ledger }))
    await screen.findByText(viNormal.ledger.reason.settlement)

    await user.click(screen.getByRole('button', { name: viNormal.profile.ledger.loadMore }))

    expect(await screen.findByText(viNormal.ledger.reason.starting_balance)).toBeInTheDocument()
    expect(ledger).toHaveBeenLastCalledWith({ limit: 50, before: 41 })
    // The rows already read stay put, and a page with no cursor after it is the end of the history.
    expect(screen.getByText(viNormal.ledger.reason.settlement)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: viNormal.profile.ledger.loadMore })).toBeNull())
  })

  it('keeps the page when only the ledger fails, and blames only the ledger', async () => {
    renderScreen(stubApi({ ledger: vi.fn().mockRejectedValue(new ApiError(500, 'INTERNAL', 'nope')) }))

    expect(await screen.findByRole('heading', { name: 'Bình', level: 1 })).toBeInTheDocument()
    // The profile above it rendered perfectly well, so saying it did not load would simply be untrue.
    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.profile.ledger.error)
    expect(screen.queryByText(viNormal.profile.error)).toBeNull()
  })

  it('offers a way back after a first ledger page that failed', async () => {
    // A failed first page leaves no cursor, which is also what the end of the history looks like — without a
    // retry of its own the only way out would be reloading the whole page.
    const ledger = vi.fn().mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'nope')).mockResolvedValue(PAGE_ONE)
    const user = userEvent.setup()
    renderScreen(stubApi({ ledger }))
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: viNormal.screens.retry }))

    expect(await screen.findByText(viNormal.ledger.reason.settlement)).toBeInTheDocument()
    expect(ledger).toHaveBeenLastCalledWith({ limit: 50 })
    expect(screen.queryByText(viNormal.profile.ledger.error)).toBeNull()
    // …and the cursor from the page that did land takes over the button again.
    expect(screen.getByRole('button', { name: viNormal.profile.ledger.loadMore })).toBeInTheDocument()
  })

  it('retries the same page, not the first one, when a later ledger page fails', async () => {
    const ledger = vi
      .fn()
      .mockResolvedValueOnce(PAGE_ONE)
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'nope'))
      .mockResolvedValue(PAGE_TWO)
    const user = userEvent.setup()
    renderScreen(stubApi({ ledger }))
    await screen.findByText(viNormal.ledger.reason.settlement)

    await user.click(screen.getByRole('button', { name: viNormal.profile.ledger.loadMore }))
    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.profile.ledger.error)
    // The rows already read stay put, so the button is still "load more" and still carries the cursor.
    expect(screen.getByText(viNormal.ledger.reason.settlement)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: viNormal.profile.ledger.loadMore }))

    expect(await screen.findByText(viNormal.ledger.reason.starting_balance)).toBeInTheDocument()
    expect(ledger).toHaveBeenLastCalledWith({ limit: 50, before: 41 })
  })

  it('prints a title and badge this bundle has never heard of as their ids, not as i18n keys', async () => {
    const avatar = { ...AVATAR, title: 'title_from_the_future', badge: 'badge_lunar_2027' }
    renderScreen(stubApi({ me: vi.fn().mockResolvedValue({ ...ME, avatar }) }))
    await screen.findByRole('heading', { name: 'Bình', level: 1 })

    expect(screen.getByText('title_from_the_future')).toBeInTheDocument()
    expect(screen.getByText('badge_lunar_2027')).toBeInTheDocument()
    expect(screen.queryByText(/^items\./)).toBeNull()
  })
})
