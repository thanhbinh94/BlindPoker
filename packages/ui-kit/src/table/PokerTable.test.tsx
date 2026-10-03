import { HandCategory, parseCards, type RoomPlayerView } from '@bp/core'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import { defaultChibi, type ChibiConfig, type ChibiSubject, type WearRef } from '../avatar2d/index.js'
import type { ClientHand } from '../client/types.js'
import { createI18n } from '../i18n/index.js'
import { holdemHand as hand, holdemRoom as room, makePlayer, makeRoom } from '../test-fixtures.js'
import { PokerTable } from './PokerTable.js'
import s from './table.module.css'

const NAMES = ['Ann', 'Bảo', 'Cúc', 'Dũng', 'Em', 'Phúc', 'Giang', 'Hà', 'Yến']

/** A full nine-handed table: the viewer in seat 0 and eight opponents around them. */
const fullRoom = makeRoom({
  maxPlayers: 9,
  playerCount: 9,
  hostPlayerId: 'p0',
  players: NAMES.map((displayName, seat) =>
    makePlayer({ playerId: `p${seat}`, displayName, seat, status: 'SEATED', stack: 20_000, isHost: seat === 0 }),
  ),
})

const wrap = (ui: React.ReactElement) =>
  render(<I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>{ui}</I18nextProvider>)

describe('PokerTable', () => {
  it('renders seats, my cards face up, opponents face down, community, pot, empty seats to sit on', async () => {
    const onSeatClick = vi.fn()
    wrap(
      <PokerTable
        room={room}
        hand={hand}
        myPlayerId="a"
        deadlineAt={null}
        serverNow={() => 0}
        turnTimerMs={30000}
        lang="en"
        layout="ring"
        canSit={false}
        onSeatClick={onSeatClick}
      />,
    )
    expect(screen.getByText('Ann')).toBeInTheDocument()
    expect(screen.getByLabelText('Queen of spades')).toBeInTheDocument()
    expect(screen.getAllByLabelText('Face-down card')).toHaveLength(2)
    expect(screen.getByLabelText('Ace of hearts')).toBeInTheDocument()
    expect(screen.getByText('300')).toBeInTheDocument()
    expect(screen.getByText(/disconnected/i)).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /sit down/i })).toHaveLength(0) // canSit false
  })
  // Review 2026-09-29, No1: at the showdown an opponent's cards turn over where they lie. For the first half of the turn
  // each card's back is drawn behind its face — as artwork: every card is still named once, and no back is left to count.
  it("turns an opponent's cards over at the showdown and still names each card once", () => {
    const i18n = createI18n({ language: 'en', storage: null })
    const table = (h: typeof hand) => (
      <I18nextProvider i18n={i18n}>
        <PokerTable room={room} hand={h} myPlayerId="a" deadlineAt={null} serverNow={() => 0} turnTimerMs={30000} lang="en" layout="ring" canSit={false} />
      </I18nextProvider>
    )
    const view = render(table(hand))
    const me = screen.getByRole('group', { name: 'Seat 1' })
    const bob = screen.getByRole('group', { name: 'Seat 3' })
    expect(within(bob).getAllByLabelText('Face-down card')).toHaveLength(2)

    view.rerender(table({ ...hand, actingSeat: null, seats: hand.seats.map((seat) => (seat.seat === 2 ? { ...seat, holeCards: parseCards('Jc Td') } : seat)) }))
    expect(screen.queryAllByLabelText('Face-down card')).toHaveLength(0)
    expect(within(bob).getAllByRole('img', { name: / of / })).toHaveLength(2)
    for (const name of ['Jack of clubs', '10 of diamonds', 'Queen of spades', 'Queen of diamonds', 'Ace of hearts'])
      expect(screen.getAllByLabelText(name), name).toHaveLength(1)
    expect(bob.querySelectorAll(`.${s.cardTurn}`), "Bob's two cards turn").toHaveLength(2)
    expect(me.querySelectorAll(`.${s.cardTurn}`), 'mine were dealt face up and do not').toHaveLength(0)
  })
  // Review 2026-09-29, No2: a badge, the bet chip, the hand's name and the payout used to take a line each, and the
  // viewer's block ran six lines deep past the foot of the stage. Two lines now: who the seat is and what it has in
  // front of it, then how the hand ended for it — and nothing on them is dropped.
  it('keeps a seat to two lines under its plate: the badges with the bet, then the hand with the payout', () => {
    const finished = {
      ...hand,
      phase: 'COMPLETE' as const,
      actingSeat: null,
      seats: hand.seats.map((seat) => (seat.seat === 0 ? { ...seat, betThisStreet: 2_000, allIn: true } : seat)),
      result: {
        payouts: [{ seat: 0, amount: 3_920 }],
        pots: [],
        fee: 80,
        showdown: [{ seat: 0, cards: hand.seats[0]!.holeCards!, rank: 0, category: 5 as const, best: hand.seats[0]!.holeCards! }],
        carryOverOut: 0,
        uncalledReturned: null,
        cancelled: false,
        reason: null,
      },
    }
    wrap(
      <PokerTable room={room} hand={finished} myPlayerId="a" deadlineAt={null} serverNow={() => 0} turnTimerMs={30000} lang="en" layout="ring" canSit={false} />,
    )
    const seat = screen.getByRole('group', { name: 'Seat 1' })
    const lineOf = (text: string): HTMLElement => within(seat).getByText(text).closest(`.${s.tags}, .${s.seatResult}`) as HTMLElement
    const badges = lineOf('You')
    expect(badges).not.toBeNull()
    expect(badges.parentElement).toBe(seat)
    for (const text of ['Host', 'All-in', '2,000']) expect(lineOf(text), text).toBe(badges)
    const outcome = lineOf('Flush')
    expect(outcome).not.toBeNull()
    expect(outcome.parentElement).toBe(seat)
    expect(lineOf('+3,920')).toBe(outcome)
    expect(outcome).not.toBe(badges)
  })

  // Follow-up to review round 2, No1: `RoomScreen` holds the result card while an opponent's cards turn over, and the
  // table must not give the result away in the meantime — no hand name, no payout, no winner glow, no gold edge on the
  // board — while every card still shows (the turn plays). All of it arrives with the card, in the render that drops the flag.
  describe('while the result is pending', () => {
    /** Ann (seat 0, the viewer) wins with a pair of queens over Bob's jack high; both hands are shown. */
    const showdown: ClientHand = {
      ...hand,
      phase: 'COMPLETE',
      actingSeat: null,
      community: parseCards('Ah Kd 2c 9s 5s'),
      seats: hand.seats.map((seat) => (seat.seat === 2 ? { ...seat, holeCards: parseCards('Jc Td') } : seat)),
      result: {
        payouts: [{ seat: 0, amount: 600 }],
        pots: [],
        fee: 0,
        showdown: [
          { seat: 0, cards: parseCards('Qs Qd'), rank: 2, category: HandCategory.PAIR, best: parseCards('Qs Qd Ah Kd 9s') },
          { seat: 2, cards: parseCards('Jc Td'), rank: 1, category: HandCategory.HIGH_CARD, best: parseCards('Ah Kd Jc Td 9s') },
        ],
        carryOverOut: 0,
        uncalledReturned: null,
        cancelled: false,
        reason: null,
      },
    }
    const i18n = createI18n({ language: 'en', storage: null })
    /** The table at `h`, with the flag as given (omitted when `undefined`: the prop's default). */
    const table = (h: ClientHand, layout: 'ring' | 'stack', resultPending?: boolean) => (
      <I18nextProvider i18n={i18n}>
        <PokerTable room={room} hand={h} myPlayerId="a" deadlineAt={null} serverNow={() => 0} turnTimerMs={30000} lang="en" layout={layout} canSit={false} resultPending={resultPending} />
      </I18nextProvider>
    )
    const seatOf = (n: number) => screen.getByRole('group', { name: `Seat ${n}` })
    const winnerGlows = () => document.querySelectorAll(`.${s.seatWin}`)
    const goldEdges = () => document.querySelectorAll(`.${s.cardHi}`)
    const resultLines = () => document.querySelectorAll(`.${s.seatResult}`)

    it.each(['ring', 'stack'] as const)('turns the cards over but prints no result line, winner glow or gold edge (%s)', (layout) => {
      const view = render(table(hand, layout, true))
      view.rerender(table(showdown, layout, true))
      // the cards are as they are without the flag: Bob's turn over where they lie, and the whole board is out
      expect(within(seatOf(3)).getAllByRole('img', { name: / of / }), 'Bob’s hand is face up').toHaveLength(2)
      expect(seatOf(3).querySelectorAll(`.${s.cardTurn}`), 'and turning').toHaveLength(2)
      expect(within(seatOf(1)).getAllByRole('img', { name: / of / }), 'mine are up').toHaveLength(2)
      for (const name of ['Ace of hearts', 'King of diamonds', '2 of clubs', '9 of spades', '5 of spades'])
        expect(screen.getAllByLabelText(name), name).toHaveLength(1)
      // …and nothing says who won
      expect(screen.queryByText('Pair')).toBeNull()
      expect(screen.queryByText('High card')).toBeNull()
      expect(screen.queryByText('+600')).toBeNull()
      expect(resultLines(), 'no result line under any seat').toHaveLength(0)
      expect(winnerGlows(), 'no winner glow').toHaveLength(0)
      expect(goldEdges(), 'no gold edge on the board').toHaveLength(0)
    })

    it.each(['ring', 'stack'] as const)('prints the lines, the glow and the gold edge without the flag (%s)', (layout) => {
      render(table(showdown, layout))
      expect(within(seatOf(1)).getByText('Pair')).toBeInTheDocument()
      expect(within(seatOf(1)).getByText('+600')).toBeInTheDocument()
      expect(within(seatOf(3)).getByText('High card')).toBeInTheDocument()
      expect(within(seatOf(3)).queryByText(/^\+/), 'only the winner is paid').toBeNull()
      expect(resultLines()).toHaveLength(2)
      expect(winnerGlows(), 'the winner glows').toHaveLength(1)
      expect(seatOf(1).className).toContain(s.seatWin)
      // the best hand's board cards: the ace, the king and the nine — not the two it does not use
      expect(goldEdges()).toHaveLength(3)
    })

    // The plate's stack is a result cue too: the settlement pays Ann's 600 into it in the render the hand completes.
    it.each(['ring', 'stack'] as const)('keeps the stack from before the settlement on the plate until the flag drops (%s)', (layout) => {
      const settled: ClientHand = {
        ...showdown,
        seats: showdown.seats.map((seat) => (seat.seat === 0 ? { ...seat, stack: 20_400, stackBeforeResult: 19_800 } : { ...seat, stackBeforeResult: seat.stack })),
      }
      const view = render(table(settled, layout, true))
      expect(within(seatOf(1)).getByText('19,800'), 'the stack as it stood before the pot was paid').toBeInTheDocument()
      expect(within(seatOf(1)).queryByText('20,400')).toBeNull()
      view.rerender(table(settled, layout, false))
      expect(within(seatOf(1)).getByText('20,400'), 'the paid stack, together with the result').toBeInTheDocument()
      expect(within(seatOf(1)).queryByText('19,800')).toBeNull()
    })

    it('prints the stack it has when no earlier one was kept — a hand rebuilt from a snapshot', () => {
      const rebuilt: ClientHand = { ...showdown, seats: showdown.seats.map((seat) => (seat.seat === 0 ? { ...seat, stack: 20_400 } : seat)) }
      render(table(rebuilt, 'ring', true))
      expect(within(seatOf(1)).getByText('20,400')).toBeInTheDocument()
    })

    it('prints all of it in the render that drops the flag, and leaves the turn alone', () => {
      const view = render(table(hand, 'ring', true))
      view.rerender(table(showdown, 'ring', true))
      expect(resultLines()).toHaveLength(0)
      view.rerender(table(showdown, 'ring', false))
      expect(within(seatOf(1)).getByText('Pair')).toBeInTheDocument()
      expect(within(seatOf(1)).getByText('+600')).toBeInTheDocument()
      expect(within(seatOf(3)).getByText('High card')).toBeInTheDocument()
      expect(winnerGlows()).toHaveLength(1)
      expect(goldEdges()).toHaveLength(3)
      expect(seatOf(3).querySelectorAll(`.${s.cardTurn}`), 'the turn is not cut short or played twice').toHaveLength(2)
    })
  })

  // Review round 2, R2-3: `RoomScreen` measures the viewer's own seat to stop the result card above it. It finds the seat
  // and its plate by these two attributes — a contract of their own, not the CSS modules' hashed class names.
  it("marks the viewer's own seat, and its plate, for the room to measure", () => {
    for (const layout of ['ring', 'stack'] as const) {
      const view = wrap(
        <PokerTable room={fullRoom} hand={null} myPlayerId="p4" deadlineAt={null} serverNow={() => 0} turnTimerMs={30000} lang="en" layout={layout} canSit={false} />,
      )
      const marked = document.querySelectorAll('[data-me]')
      expect(marked, layout).toHaveLength(1)
      expect(marked[0], layout).toBe(screen.getByRole('group', { name: 'Seat 5' }))
      expect(marked[0], layout).toHaveAttribute('data-me', 'true')
      const plate = marked[0]!.querySelector('[data-plate]')
      expect(plate, layout).not.toBeNull()
      expect(plate!.className, layout).toContain(s.plate)
      expect(within(plate as HTMLElement).getByText('Em'), layout).toBeInTheDocument()
      view.unmount()
    }
  })

  it('marks no seat as the viewer’s for a spectator', () => {
    wrap(<PokerTable room={fullRoom} hand={null} myPlayerId="zed" deadlineAt={null} serverNow={() => 0} turnTimerMs={30000} lang="en" layout="ring" canSit={false} />)
    expect(document.querySelectorAll('[data-me]')).toHaveLength(0)
  })

  it('offers empty seats when the viewer may sit', async () => {
    const onSeatClick = vi.fn()
    wrap(
      <PokerTable
        room={room}
        hand={null}
        myPlayerId="zed"
        deadlineAt={null}
        serverNow={() => 0}
        turnTimerMs={30000}
        lang="en"
        layout="stack"
        canSit
        onSeatClick={onSeatClick}
      />,
    )
    const sits = screen.getAllByRole('button', { name: /sit down/i })
    expect(sits).toHaveLength(2) // seats 1 and 3 are free
    await userEvent.click(sits[0]!)
    expect(onSeatClick).toHaveBeenCalledWith(1)
  })
  it('stack layout shows every opponent at a nine-handed table, in a strip that holds two rows open', () => {
    wrap(
      <PokerTable
        room={fullRoom}
        hand={null}
        myPlayerId="p0"
        deadlineAt={null}
        serverNow={() => 0}
        turnTimerMs={30000}
        lang="en"
        layout="stack"
        canSit={false}
      />,
    )
    const strip = screen.getByRole('group', { name: 'Players' })
    for (const name of NAMES.slice(1)) expect(within(strip).getByText(name)).toBeInTheDocument()
    expect(within(strip).getAllByRole('group')).toHaveLength(8)
    expect(strip.className).toContain(s.othersTwoRow)
    expect(strip.className).toContain(s.othersChip)
    expect(strip.className).toContain(s.othersDense)
    // The viewer's own seat is pinned below the felt, never in the opponents' strip.
    expect(within(strip).queryByText('Ann')).toBeNull()
    expect(screen.getByText('Ann')).toBeInTheDocument()
  })

  it('stack layout makes chips of five opponents, but keeps their captions (layout audit L1)', () => {
    const sixHanded = makeRoom({
      maxPlayers: 6,
      playerCount: 6,
      hostPlayerId: 'p0',
      players: NAMES.slice(0, 6).map((displayName, seat) =>
        makePlayer({ playerId: `p${seat}`, displayName, seat, status: 'SEATED', stack: 20_000, isHost: seat === 0 }),
      ),
    })
    wrap(
      <PokerTable
        room={sixHanded}
        hand={null}
        myPlayerId="p0"
        deadlineAt={null}
        serverNow={() => 0}
        turnTimerMs={30000}
        lang="en"
        layout="stack"
        canSit={false}
      />,
    )
    const strip = screen.getByRole('group', { name: 'Players' })
    expect(strip.className).toContain(s.othersChip)
    expect(strip.className).not.toContain(s.othersDense)
  })

  it('hangs the app caption under each seated player, and asks about that player alone', () => {
    const captionFor = vi.fn((p: RoomPlayerView) => (p.playerId === 'a' ? 'Tay nóng' : null))
    wrap(
      <PokerTable
        room={room}
        hand={hand}
        myPlayerId="a"
        deadlineAt={null}
        serverNow={() => 0}
        turnTimerMs={30000}
        lang="en"
        layout="ring"
        canSit={false}
        captionFor={captionFor}
      />,
    )

    const ann = screen.getByText('Ann').parentElement
    expect(ann).not.toBeNull()
    expect(within(ann!).getByText('Tay nóng')).toBeInTheDocument()
    // The name is still the plate's first line; the caption sits under it.
    expect(within(ann!).getByText('Ann').nextElementSibling).toHaveTextContent('Tay nóng')

    // Only seated players are asked about, and a `null` answer leaves that plate alone.
    expect(captionFor.mock.calls.map(([p]) => p.playerId)).toEqual(['a', 'b'])
    const bob = screen.getByText('Bob').parentElement
    expect(within(bob!).queryByText('Tay nóng')).toBeNull()
  })

  it('draws no caption line at all when the app supplies no slot', () => {
    wrap(
      <PokerTable
        room={room}
        hand={hand}
        myPlayerId="a"
        deadlineAt={null}
        serverNow={() => 0}
        turnTimerMs={30000}
        lang="en"
        layout="ring"
        canSit={false}
      />,
    )
    expect(document.querySelectorAll(`.${s.seatCaption}`)).toHaveLength(0)
  })

  it("keeps a bot's virtual bankroll off its plate: the Bot badge says what it is, and the figure would only mislead", () => {
    const withBot = makeRoom({
      players: [
        makePlayer({ playerId: 'a', displayName: 'Ann', isHost: true, seat: 0, status: 'SEATED', stack: 20_000 }),
        makePlayer({ playerId: 'bot-1', displayName: 'Bot 1', isBot: true, seat: 1, status: 'SEATED', stack: 1_000_000 }),
      ],
    })
    wrap(
      <PokerTable
        room={withBot}
        hand={null}
        myPlayerId="a"
        deadlineAt={null}
        serverNow={() => 0}
        turnTimerMs={30000}
        lang="en"
        layout="ring"
        canSit={false}
      />,
    )
    const bot = screen.getByRole('group', { name: 'Seat 2' })
    expect(within(bot).getByText('Bot')).toBeInTheDocument()
    // The frame holds a 2D face for the bot, whatever the app's avatar slot would say.
    expect(bot.querySelector(`.${s.avatar}`)).toHaveAttribute('data-face', 'bot')
    // The frame draws the bot's own chibi — same PNG layers a human would get, chosen by its id.
    expect(bot.querySelector('[data-chibi-hash]')).not.toBeNull()
    expect(screen.getByRole('group', { name: 'Seat 1' }).querySelector(`.${s.avatar}`)).toHaveAttribute('data-face', 'default')
    expect(within(bot).queryByText('1,000,000')).toBeNull()
    expect(bot.querySelector(`.${s.seatStack}`)).toBeNull()
    // A human's stack is still the plate's job.
    expect(within(screen.getByRole('group', { name: 'Seat 1' })).getByText('20,000')).toBeInTheDocument()
  })

  // D01 §7: the frame item's own ring is meant to show at the table, always — `.avatar` must not clip it off.
  // This cannot see the CSS clip itself (jsdom does no layout), but it pins the wiring the clip depends on: a
  // `chibiFor` config wearing a `frame` item reaches the seat as a real `<img>` for that layer.
  it("draws a seat's equipped frame ring", () => {
    const withFrame = makeRoom({
      players: [makePlayer({ playerId: 'a', displayName: 'Ann', isHost: true, seat: 0, status: 'SEATED', stack: 20_000 })],
    })
    const frameItem: WearRef = { id: 'frame_gold', order: 90, file: 'item_frame_gold_L90' }
    const chibiFor = (player: RoomPlayerView): ChibiSubject | null => {
      const base = defaultChibi(player.playerId) as ChibiConfig
      return { ...base, frame: frameItem }
    }
    wrap(
      <PokerTable
        room={withFrame}
        hand={null}
        myPlayerId="a"
        deadlineAt={null}
        serverNow={() => 0}
        turnTimerMs={30000}
        lang="en"
        layout="ring"
        canSit={false}
        chibiFor={chibiFor}
      />,
    )
    const seat = screen.getByRole('group', { name: 'Seat 1' })
    expect(seat.querySelector('img[src*="item_frame_gold_L90"]')).not.toBeNull()
  })
})
