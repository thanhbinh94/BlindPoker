import { CHIBI_LIFE, type Language } from '@bp/ui-kit'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  type AvatarCatalogDto,
  type AvatarConfigDto,
  type BodyDto,
  type HistoryEntryDto,
  type ItemDto,
  type LedgerPageDto,
  type MeDto,
  type NormalApi,
  type PlayerStatsDto,
} from '../api.js'
import enNormal from '../locales/en/normal.json'
import viNormal from '../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../test-i18n.js'
import { ProfileScreen } from './ProfileScreen.js'

const BODY_F: BodyDto = {
  gender: 'f',
  body: 'body_f_L30',
  faces: {
    neutral: 'body_f_face_neutral_L50',
    happy: 'body_f_face_happy_L50',
    sad: 'body_f_face_sad_L50',
    surprised: 'body_f_face_surprised_L50',
    closed: 'body_f_face_closed_L50',
    sleep: 'body_f_face_sleep_L50',
  },
  naturalEyeColour: '#2e6a9b',
}

const HAIR_BOB: ItemDto = {
  id: 'hair_f_bob01',
  slot: 'hairStyle',
  rarity: 'common',
  nameKey: 'items.hair_f_bob01',
  assetKey: 'hairStyle/hair_f_bob01',
  isDefault: false,
  free: true,
  gender: 'f',
  asset: { layer: 60, file: 'item_hair_f_bob01_L60', back: 'item_hair_f_bob01_L20', fitsAvatarCrop: true },
}

const OUTFIT: ItemDto = {
  id: 'outfit_royal_robe01',
  slot: 'outfit',
  rarity: 'epic',
  nameKey: 'items.outfit_royal_robe01',
  assetKey: 'outfit/outfit_royal_robe01',
  isDefault: false,
  asset: { layer: 40, file: 'item_outfit_royal_robe01_L40', fitsAvatarCrop: false },
}

const AVATAR_CATALOG: AvatarCatalogDto = { frame: { w: 384, h: 448 }, crop: { x: 88, y: 40, size: 208 }, bodies: [BODY_F], manifestVersion: 1 }

const AVATAR: AvatarConfigDto = {
  v: 4,
  gender: 'f',
  hairStyle: 'hair_f_bob01',
  outfit: 'outfit_royal_robe01',
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
  roomName: '123',
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
    // The server has already turned the engine id into the in-room name (No4).
    { playerId: null, label: 'Bot 5', seat: 2, isBot: true, net: -1_880, won: false },
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
    catalogItems: vi.fn().mockResolvedValue({ items: [HAIR_BOB, OUTFIT] }),
    avatarCatalog: vi.fn().mockResolvedValue(AVATAR_CATALOG),
    ...overrides,
  } as unknown as NormalApi
}

// `lang` is both the screen's prop (it drives number, date and case formatting) and the i18n instance's language.
const renderScreen = (api: NormalApi = stubApi(), lang: Language = 'vi') =>
  renderWithI18n(<ProfileScreen api={api} lang={lang} balance={123_000} />, makeI18n(lang))

describe('ProfileScreen', () => {
  it('shows one status line while the header, the stats and the history are in flight', () => {
    renderScreen(stubApi({ me: vi.fn(() => new Promise<MeDto>(() => undefined)) }))

    expect(screen.getByRole('status')).toHaveTextContent(viNormal.screens.loading)
    expect(screen.queryByRole('heading', { name: 'Bình' })).toBeNull()
  })

  it('draws the header from the account and the balance from the socket', async () => {
    renderScreen()

    expect(await screen.findByRole('heading', { name: 'Bình', level: 2 })).toBeInTheDocument()
    // The page is titled like every other page; the name heads the card under it (layout audit U3).
    expect(screen.getByRole('heading', { name: viNormal.profile.title, level: 1 })).toBeInTheDocument()
    expect(screen.getByText(viNormal.items.title_hot_hand)).toBeInTheDocument()
    expect(screen.getByText(viNormal.items.badge_gold)).toBeInTheDocument()
    expect(screen.getByText(/Tham gia từ/)).toBeInTheDocument()
    // 123.000 in `vi`: the assertion is on the digits, not on the separator the locale picked (and not on "123"
    // alone, which is also the name of the table in the history below).
    expect(screen.getByText(/123\D000/)).toBeInTheDocument()
    // The stage carries the full body (its aura visible) on a backdrop keyed by the equipped title.
    const stage = document.querySelector('[data-title]')
    expect(stage).toHaveAttribute('data-title', 'title_hot_hand')
    await waitFor(() => expect(within(stage as HTMLElement).getByRole('img', { name: 'Bình' })).toBeInTheDocument())
    expect(stage?.querySelectorAll('[data-chibi-hash]')).toHaveLength(1)
  })

  it('shows the reputation, the rank and what is left to the next one, with a bar that far along', async () => {
    const ranks = [
      { rank: 1, threshold: 0 },
      { rank: 2, threshold: 100 },
      { rank: 3, threshold: 400 },
      { rank: 4, threshold: 1800 },
      { rank: 5, threshold: 5000 },
    ]
    renderScreen(stubApi({ me: vi.fn().mockResolvedValue({ ...ME, reputation: 455, rank: 3, ranks }) }))
    await screen.findByRole('heading', { name: 'Bình', level: 2 })

    const line = screen.getByText('Danh vọng 455 · Cao thủ · còn 1.345 tới Bậc thầy')
    const bar = line.closest('[data-reputation]')!.querySelector<HTMLElement>('[data-progress]')
    // (455 − 400) / (1 800 − 400) ≈ 3.9 %
    expect(bar?.style.width).toBe('3.9%')
  })

  it('shows the top rank without a next step, and nothing at all from a server that sends no reputation', async () => {
    const ranks = [
      { rank: 1, threshold: 0 },
      { rank: 5, threshold: 5000 },
    ]
    const view = renderScreen(stubApi({ me: vi.fn().mockResolvedValue({ ...ME, reputation: 5210, rank: 5, ranks }) }))
    await screen.findByRole('heading', { name: 'Bình', level: 2 })
    expect(screen.getByText('Danh vọng 5.210 · Huyền thoại')).toBeInTheDocument()
    expect(document.querySelector('[data-progress]')).toBeNull()
    view.unmount()

    renderScreen()
    await screen.findByRole('heading', { name: 'Bình', level: 2 })
    expect(document.querySelector('[data-reputation]')).toBeNull()
  })

  it('offers two quick links, the wardrobe and the achievements — the inventory has folded into the wardrobe (No5)', async () => {
    renderScreen()
    await screen.findByRole('heading', { name: 'Bình', level: 2 })

    const links = within(screen.getByRole('navigation', { name: viNormal.profile.title })).getAllByRole('link')
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      [viNormal.profile.toAvatar, '#/avatar'],
      [viNormal.profile.toAchievements, '#/achievements'],
    ])
    // The old name and the old target are both gone, not merely hidden.
    expect(screen.queryByRole('link', { name: 'Kho đồ' })).toBeNull()
    expect(document.querySelector('a[href="#/inventory"]')).toBeNull()
  })

  it('stages one full-body chibi, and keeps the head crop (its frame ring) as the portrait beside the name', async () => {
    renderScreen()
    const name = await screen.findByRole('heading', { name: 'Bình', level: 2 })

    // Layout audit C7: one figure on the stage, not a body and a big head side by side.
    const stage = document.querySelector('[data-title]') as HTMLElement
    const staged = [...stage.querySelectorAll('[data-chibi-hash]')]
    expect(staged.map((el) => el.getAttribute('data-frame'))).toEqual(['full'])
    // Drawn from the saved v4 config — the body of its gender, its hairstyle, its outfit — not the default chibi.
    const sources = [...stage.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? '')
    for (const file of ['body_f_L30', 'item_hair_f_bob01_L60', 'item_outfit_royal_robe01_L40']) expect(sources.some((src) => src.includes(file)), file).toBe(true)
    const portrait = name.parentElement?.querySelector('[data-chibi-hash]')
    expect(portrait).toHaveAttribute('data-frame', 'head')
  })

  // BP-30 (spec K6 §3.2, P16): the large figure lives — it breathes, blinks and waves when tapped — and has no Xoay;
  // the portrait beside the name stays a plain chibi. The wave runs out on fake timers, so nothing waits on the clock.
  it('the large figure is live and greets; the small head is not', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderScreen()
      const name = await screen.findByRole('heading', { name: 'Bình', level: 2 })

      // One image named after the player, the large one, live (R6: the name a locator finds it by is unchanged).
      const figure = screen.getByRole('img', { name: 'Bình' })
      expect((document.querySelector('[data-title]') as HTMLElement).contains(figure)).toBe(true)
      expect(figure).toHaveAttribute('data-frame', 'full')
      expect(figure).toHaveAttribute('data-live', 'idle')
      expect(figure).not.toHaveAttribute('data-reacting')

      const portrait = name.parentElement?.querySelector('[data-chibi-hash]') as HTMLElement
      expect(portrait).toHaveAttribute('data-frame', 'head')
      expect(portrait).not.toHaveAttribute('data-live')

      // One greet button, over the large figure; no Xoay on this page.
      const greet = screen.getByRole('button', { name: 'Nhân vật của bạn, bấm để chào' })
      expect(greet.parentElement?.contains(figure)).toBe(true)
      expect(screen.queryByRole('button', { name: 'Xoay' })).toBeNull()

      await user.click(greet)
      expect(figure).toHaveAttribute('data-reacting', 'wave')
      act(() => {
        vi.advanceTimersByTime(CHIBI_LIFE.waveFaceMs + 50)
      })
      expect(figure).not.toHaveAttribute('data-reacting')
      expect(portrait).not.toHaveAttribute('data-reacting')
    } finally {
      vi.useRealTimers()
    }
  })

  it('still draws the header, stats and history when the avatar catalogue fails — the stage falls back to a default chibi', async () => {
    renderScreen(stubApi({ avatarCatalog: vi.fn().mockRejectedValue(new ApiError(500, 'INTERNAL', 'nope')) }))

    expect(await screen.findByRole('heading', { name: 'Bình', level: 2 })).toBeInTheDocument()
    expect(screen.getByText(viNormal.profile.stats.title)).toBeInTheDocument()
    const stage = document.querySelector('[data-title]')
    expect(stage?.querySelectorAll('[data-chibi-hash]')).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('groups all sixteen counters, prints points with their unit and names the best hand', async () => {
    const { i18n } = renderScreen()
    await screen.findByRole('heading', { name: 'Bình', level: 2 })

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
    await screen.findByRole('heading', { name: 'Bình', level: 2 })

    expect(screen.getByText(viNormal.profile.stats.none)).toBeInTheDocument()
  })

  it('lists the last hands with my own net, the mode, the best hand and who else was there', async () => {
    const api = stubApi()
    const { i18n } = renderScreen(api)
    await screen.findByRole('heading', { name: 'Bình', level: 2 })

    expect(api.history).toHaveBeenCalledWith(20)
    const hands = within(screen.getByRole('list', { name: viNormal.profile.history.title }))
    expect(hands.getByText(i18n.t('game:mode.holdem'))).toBeInTheDocument()
    expect(hands.getByText('+5.880')).toBeInTheDocument()
    expect(hands.getByText(viNormal.profile.history.won)).toBeInTheDocument()
    expect(hands.getByText(i18n.t('game:hand.fullHouse'))).toBeInTheDocument()
    // Everyone but me, with the machine marked as one — for a screen reader and by italics, no longer by a badge
    // that made "Bot 5" read "Bot 5 bot" (R2-2): the word is there, and it is visually hidden.
    expect(hands.getByText('Lan')).toBeInTheDocument()
    expect(hands.getByText('Bot 5')).toBeInTheDocument()
    expect(hands.getByText(viNormal.profile.history.bot)).toHaveClass('visually-hidden')
    expect(hands.queryByText('Binh')).toBeNull()
  })

  it('names the table each hand was played at, and labels the seats as opponents rather than as the table (No4)', async () => {
    renderScreen()
    await screen.findByRole('heading', { name: 'Bình', level: 2 })

    const hands = within(screen.getByRole('list', { name: viNormal.profile.history.title }))
    // "Tại bàn" used to head the list of seats, which is why a raw bot id read as a table code.
    expect(hands.getByText('Tại bàn 123')).toBeInTheDocument()
    expect(hands.getByText('Đối thủ')).toBeInTheDocument()
    expect(hands.queryByText('Tại bàn')).toBeNull()
    // The seats are the opponents' and nobody else's: the hand's own room name is not among them.
    expect(hands.getAllByText(/^Tại /)).toHaveLength(1)
  })

  // R2-2: a room called "Bàn 123" used to read "Tại bàn Bàn 123". When the name's first word already is the page
  // language's word for a table, the line is "Tại {name}"; otherwise the word is added, as before.
  it.each<[Language, string, string]>([
    ['vi', 'Bàn 123', 'Tại Bàn 123'],
    ['vi', 'BÀN VIP', 'Tại BÀN VIP'],
    ['vi', 'Bàn', 'Tại Bàn'],
    ['vi', 'Bàn123', 'Tại bàn Bàn123'],
    ['vi', '123', 'Tại bàn 123'],
    ['en', 'Table 5', 'At Table 5'],
    ['en', 'Bàn 5', 'At table Bàn 5'],
    // Another language's word is only a name: "Table 5" is a room, not the Vietnamese table word.
    ['vi', 'Table 5', 'Tại bàn Table 5'],
    // The first word is read as Unicode text: lower case, composed, without the space before it.
    ['vi', 'bàn 9', 'Tại bàn 9'],
    ['vi', '  Bàn   9', 'Tại   Bàn   9'],
    // decomposed: "a" + U+0300 COMBINING GRAVE ACCENT, written as an escape so no formatter can compose it
    ['vi', 'Ba\u0300n 9', 'Tại Ba\u0300n 9'],
    // Only the first word counts, and only when it is the whole word.
    ['vi', 'Phòng Bàn 9', 'Tại bàn Phòng Bàn 9'],
    ['vi', 'Bàn-9', 'Tại bàn Bàn-9'],
  ])('says the table once: in %s, a room named "%s" reads "%s"', async (lang, roomName, line) => {
    const hand: HistoryEntryDto = { ...HAND, roomName }
    renderScreen(stubApi({ history: vi.fn().mockResolvedValue([hand]) }), lang)
    const title = (lang === 'vi' ? viNormal : enNormal).profile.history.title
    const hands = within(await screen.findByRole('list', { name: title }))

    // `getByText` normalises whitespace in what it reads and in what it is given, so the line is compared as
    // the reader sees it; the room's own words are never rewritten.
    expect(hands.getByText(line.replace(/\s+/gu, ' '))).toBeInTheDocument()
    // One table line per row, whichever form it took.
    expect(hands.getAllByText(lang === 'vi' ? /^Tại / : /^At /)).toHaveLength(1)
  })

  it('marks a bot seat by italics and a hidden word rather than by a badge, so "Bot 5" never reads "Bot 5 bot" (R2-2)', async () => {
    renderScreen()
    await screen.findByRole('heading', { name: 'Bình', level: 2 })

    const hands = within(screen.getByRole('list', { name: viNormal.profile.history.title }))
    const chip = hands.getByText('Bot 5').parentElement as HTMLElement
    expect(chip).toHaveAttribute('data-bot', 'true')
    // For a screen reader the chip is "Bot 5 bot": the hidden word is the same key the badge used to print.
    const hidden = within(chip).getByText(viNormal.profile.history.bot)
    expect(hidden).toHaveClass('visually-hidden')
    expect(chip).toHaveTextContent(`Bot 5 ${viNormal.profile.history.bot}`)
    // Nothing *visible* says "bot": the only element with exactly that text is the hidden one.
    const visible = hands.queryAllByText(viNormal.profile.history.bot).filter((el) => el.closest('.visually-hidden') === null)
    expect(visible).toEqual([])
  })

  it('draws a human chip plain, even for a human who is called "Bot 5": no names are reserved', async () => {
    const hand: HistoryEntryDto = {
      ...HAND,
      players: [
        { playerId: 'p1', label: 'Binh', seat: 0, isBot: false, net: 5_880, won: true },
        { playerId: 'p2', label: 'Lan', seat: 1, isBot: false, net: -4_000, won: false },
        { playerId: 'p7', label: 'Bot 5', seat: 2, isBot: false, net: -1_880, won: false },
      ],
    }
    renderScreen(stubApi({ history: vi.fn().mockResolvedValue([hand]) }))
    await screen.findByRole('heading', { name: 'Bình', level: 2 })

    const hands = within(screen.getByRole('list', { name: viNormal.profile.history.title }))
    for (const name of ['Lan', 'Bot 5']) {
      const chip = hands.getByText(name).parentElement as HTMLElement
      expect(chip, name).not.toHaveAttribute('data-bot')
      expect(within(chip).queryByText(viNormal.profile.history.bot), name).toBeNull()
    }
  })

  it('shows no table line for a hand stored without a room name', async () => {
    const old: HistoryEntryDto = { ...HAND, roomName: null }
    renderScreen(stubApi({ history: vi.fn().mockResolvedValue([old]) }))
    await screen.findByRole('heading', { name: 'Bình', level: 2 })

    const hands = within(screen.getByRole('list', { name: viNormal.profile.history.title }))
    expect(hands.queryByText(/^Tại /)).toBeNull()
    // The rest of the row is unaffected.
    expect(hands.getByText('Đối thủ')).toBeInTheDocument()
    expect(hands.getByText('Bot 5')).toBeInTheDocument()
  })

  it('prints "Thẻ đã dùng" on a chaos hand — who used which card, and how a stopped one ended — and nothing on any other', async () => {
    const chaos: HistoryEntryDto = {
      ...HAND,
      mode: 'blind',
      chaosUsed: [
        { seat: 0, cardId: 's_swap_one', outcome: 'applied' },
        { seat: 0, cardId: 's_peek_1', outcome: 'applied' },
        { seat: 1, cardId: 's_steal_one', outcome: 'blocked' },
      ],
    }
    const plain: HistoryEntryDto = { ...HAND, handId: 'h2', chaosUsed: [] }
    renderScreen(stubApi({ history: vi.fn().mockResolvedValue([chaos, plain, { ...HAND, handId: 'h3' }]) }))
    await screen.findByRole('heading', { name: 'Bình', level: 2 })

    const rows = within(screen.getByRole('list', { name: viNormal.profile.history.title })).getAllByRole('listitem')
    expect(within(rows[0]!).getByText('Thẻ đã dùng')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Binh — Đổi lá, Nhìn trộm; Lan — Rút lá lẻ (Bị chặn)')).toBeInTheDocument()
    // An empty list and an absent one are the same: no label, no line.
    expect(within(rows[1]!).queryByText('Thẻ đã dùng')).toBeNull()
    expect(within(rows[2]!).queryByText('Thẻ đã dùng')).toBeNull()
  })

  it('prints a room name as text, whatever it contains', async () => {
    const odd: HistoryEntryDto = { ...HAND, roomName: '<b>Bàn</b> & co' }
    renderScreen(stubApi({ history: vi.fn().mockResolvedValue([odd]) }))
    await screen.findByRole('heading', { name: 'Bình', level: 2 })

    const hands = within(screen.getByRole('list', { name: viNormal.profile.history.title }))
    expect(hands.getByText('Tại bàn <b>Bàn</b> & co')).toBeInTheDocument()
  })

  it('excludes my own seat by id, even when an opponent happens to share my name', async () => {
    const namesake: HistoryEntryDto = {
      ...HAND,
      players: [
        { playerId: 'p1', label: 'Binh', seat: 0, isBot: false, net: 5_880, won: true },
        { playerId: 'p9', label: 'Binh', seat: 1, isBot: false, net: -5_880, won: false },
      ],
    }
    renderScreen(stubApi({ history: vi.fn().mockResolvedValue([namesake]) }))
    await screen.findByRole('heading', { name: 'Bình', level: 2 })

    const hands = within(screen.getByRole('list', { name: viNormal.profile.history.title }))
    expect(hands.getAllByText('Binh')).toHaveLength(1)
  })

  it('says the profile could not be loaded, and asks again when told to', async () => {
    const me = vi.fn().mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'nope')).mockResolvedValue(ME)
    const user = userEvent.setup()
    renderScreen(stubApi({ me }))

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.profile.error)

    await user.click(screen.getByRole('button', { name: viNormal.screens.retry }))

    expect(await screen.findByRole('heading', { name: 'Bình', level: 2 })).toBeInTheDocument()
  })

  it('refuses a name the server validator would refuse, without asking the server', async () => {
    const api = stubApi()
    const user = userEvent.setup()
    renderScreen(api)
    await screen.findByRole('heading', { name: 'Bình', level: 2 })

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
    await screen.findByRole('heading', { name: 'Bình', level: 2 })

    const box = screen.getByLabelText(viNormal.profile.rename.label)
    await user.clear(box)
    await user.type(box, 'Minh Sài Gòn')
    await user.click(screen.getByRole('button', { name: viNormal.profile.rename.submit }))

    expect(await screen.findByText(viNormal.auth.errors.DISPLAY_NAME_TAKEN)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Bình', level: 2 })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: viNormal.profile.rename.submit }))

    expect(await screen.findByRole('heading', { name: 'Minh Sài Gòn', level: 2 })).toBeInTheDocument()
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
    // The reference id is not printed any more (layout audit C7); it rides on the row as a hover title.
    expect(screen.queryByText(viNormal.profile.ledger.ref.replace('{{id}}', 'h1'))).toBeNull()
    expect(screen.getByText(viNormal.ledger.reason.settlement).closest('li')).toHaveAttribute('title', viNormal.profile.ledger.ref.replace('{{id}}', 'h1'))
  })

  it('labels the points a game master moved, rather than filing them under "other"', async () => {
    const ledger = vi.fn().mockResolvedValue({
      entries: [
        { id: 51, amount: 12_000, reason: 'gm_grant', refId: null, createdAt: Date.UTC(2026, 8, 4, 10, 0) },
        { id: 50, amount: -3_000, reason: 'gm_adjust', refId: null, createdAt: Date.UTC(2026, 8, 4, 9, 0) },
      ],
      nextBefore: null,
    })
    renderScreen(stubApi({ ledger }))

    expect(await screen.findByText(viNormal.ledger.reason.gm_grant)).toBeInTheDocument()
    expect(screen.getByText(viNormal.ledger.reason.gm_adjust)).toBeInTheDocument()
    expect(screen.queryByText(viNormal.ledger.reason.other)).toBeNull()
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

    expect(await screen.findByRole('heading', { name: 'Bình', level: 2 })).toBeInTheDocument()
    // The profile above it rendered perfectly well, so saying it did not load would simply be untrue.
    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.profile.ledger.error)
    expect(screen.queryByText(viNormal.profile.error)).toBeNull()
  })

  it('offers a way back after a first ledger page that failed', async () => {
    const ledger = vi.fn().mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'nope')).mockResolvedValue(PAGE_ONE)
    const user = userEvent.setup()
    renderScreen(stubApi({ ledger }))
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: viNormal.screens.retry }))

    expect(await screen.findByText(viNormal.ledger.reason.settlement)).toBeInTheDocument()
    expect(ledger).toHaveBeenLastCalledWith({ limit: 50 })
    expect(screen.queryByText(viNormal.profile.ledger.error)).toBeNull()
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
    expect(screen.getByText(viNormal.ledger.reason.settlement)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: viNormal.profile.ledger.loadMore }))

    expect(await screen.findByText(viNormal.ledger.reason.starting_balance)).toBeInTheDocument()
    expect(ledger).toHaveBeenLastCalledWith({ limit: 50, before: 41 })
  })

  it('prints a title and badge this bundle has never heard of as their ids, not as i18n keys', async () => {
    const avatar = { ...AVATAR, title: 'title_from_the_future', badge: 'badge_lunar_2027' }
    renderScreen(stubApi({ me: vi.fn().mockResolvedValue({ ...ME, avatar }) }))
    await screen.findByRole('heading', { name: 'Bình', level: 2 })

    expect(screen.getByText('title_from_the_future')).toBeInTheDocument()
    expect(screen.getByText('badge_lunar_2027')).toBeInTheDocument()
    expect(screen.queryByText(/^items\./)).toBeNull()
  })
})
