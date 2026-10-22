import { parseCards } from '@bp/core'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientSeat } from '../client/types.js'
import { createI18n } from '../i18n/index.js'
import { makePlayer, makeSeat } from '../test-fixtures.js'
import { Seat, type SeatProps } from './Seat.js'
import s from './table.module.css'
import TABLE_CSS from './table.module.css?raw'

/** Ann's queens, in Vietnamese: the two faces once they are up, and the name a card to peel carries while it is down. */
const QUEENS = ['Đầm bích', 'Đầm rô']
const HINT = 'Lá úp — kéo để lật'

/** The viewer, Ann, in seat 0 with two cards she has not turned yet. */
const ann: ClientSeat = makeSeat({ seat: 0, playerId: 'a', displayName: 'Ann', holeCards: parseCards('Qs Qd'), revealed: false })
/** A bot across the table, turned from the deal. */
const bot: ClientSeat = makeSeat({ seat: 2, playerId: 'bot2', displayName: 'Bảo', isBot: true, revealed: true })

/** Ann's seat in the middle of a squeeze round: the round's deadline 15 s off, `onReveal` a spy. */
const props = (patch: Partial<SeatProps> = {}): SeatProps => ({
  seat: ann,
  player: makePlayer({ playerId: 'a', displayName: 'Ann', seat: 0, status: 'IN_HAND' }),
  isMe: true,
  isActing: false,
  isButton: false,
  winnerPayout: null,
  showdownLabel: null,
  deadlineAt: 1_015_000,
  serverNow: () => 1_000_000,
  turnTimerMs: 20_000,
  lang: 'vi',
  position: null,
  chibi: null,
  expression: 'neutral',
  bounce: false,
  handId: 'h1',
  dealt: false,
  dealIndex: 0,
  dealCount: 2,
  reveal: 'flip',
  liftAfter: 0,
  squeezeRoom: true,
  squeezeRound: true,
  squeezeDecides: false,
  onReveal: vi.fn(),
  ...patch,
})

/** Renders a seat under one i18n instance; `rerender` keeps it, as a table update does. */
const wrap = (p: SeatProps) => {
  const i18n = createI18n({ language: 'vi', storage: null })
  const at = (next: SeatProps): ReactElement => (
    <I18nextProvider i18n={i18n}>
      <Seat {...next} />
    </I18nextProvider>
  )
  const view = render(at(p))
  return { ...view, rerender: (next: SeatProps) => view.rerender(at(next)) }
}

const peelCards = () => [...document.querySelectorAll<HTMLElement>('[data-peel]')]
const faces = () => peelCards().map((el) => el.getAttribute('data-face'))
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))
const pill = () => screen.queryByRole('button', { name: 'Lật' })

/** Peels the card `el` by hand from its bottom edge, past half, and lets go (jsdom lays nothing out: a 60 × 84 box). */
function peel(el: HTMLElement) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 60, bottom: 84, width: 60, height: 84, x: 0, y: 0, toJSON: () => ({}) })
  fireEvent.pointerDown(el, { clientX: 30, clientY: 80, pointerId: 1, buttons: 1 })
  fireEvent.pointerMove(el, { clientX: 30, clientY: 40, pointerId: 1, buttons: 1 })
  fireEvent.pointerUp(el, { clientX: 30, clientY: 40, pointerId: 1 })
  advance(1000)
}

beforeEach(() => {
  // The peel's tweens run on rAF and the round's ring on an interval: all of it on the test's clock.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// Spec 2026-10-08 §4.2: in a squeeze room the viewer's own cards come face down and are theirs to turn — by hand, or all
// at once with the "Lật" pill under them — and the seat tells the table once, when the last of them is up.
describe('Seat in a squeeze room', () => {
  it('deals the viewer two cards to peel, the "Lật" pill under them and the round’s ring on the plate', () => {
    wrap(props())
    expect(peelCards()).toHaveLength(2)
    expect(faces()).toEqual(['down', 'down'])
    expect(screen.getAllByRole('img', { name: HINT })).toHaveLength(2)
    expect(pill()).toBeInTheDocument()
    expect(document.querySelectorAll(`.${s.cardTurn}`), 'nothing turns by itself').toHaveLength(0)
    const plate = document.querySelector('[data-plate]') as HTMLElement
    expect(within(plate).getByRole('timer')).toHaveTextContent('15')
  })

  it('"Lật" opens both, hides itself and the ring, and tells the table once', () => {
    const p = props()
    wrap(p)
    fireEvent.click(pill()!)
    expect(pill()).toBeNull()
    expect(screen.queryByRole('timer'), 'nothing left to turn: the round’s ring is gone').toBeNull()
    advance(1000)
    expect(faces()).toEqual(['up', 'up'])
    for (const name of QUEENS) expect(screen.getByRole('img', { name })).toBeInTheDocument()
    expect(p.onReveal).toHaveBeenCalledTimes(1)
  })

  // The shots at 1920 × 940: the pill taken out moved the viewer's block, and the cards opening in it, by half its height.
  it('keeps the pill’s place, out of sight and out of reach, once there is nothing left to turn', () => {
    const view = wrap(props())
    const slot = document.querySelector<HTMLButtonElement>(`.${s.revealBtn}`)!
    fireEvent.click(pill()!)
    expect(document.querySelector(`.${s.revealBtn}`), 'the same pill, still in its place').toBe(slot)
    expect(slot).toHaveClass(s.revealBtnIdle!)
    expect(slot).toBeDisabled()
    expect(slot).toHaveAttribute('aria-hidden', 'true')
    view.rerender(props({ squeezeRound: false, deadlineAt: null }))
    expect(document.querySelector(`.${s.revealBtn}`), 'for the rest of the hand').toBe(slot)
  })

  // Spec §3 "Đã lật": the seat has turned once every one of its cards is up — one REVEAL per hand, after the last.
  it('tells the table only when the last card is peeled up by hand', () => {
    const p = props()
    wrap(p)
    peel(peelCards()[0]!)
    expect(faces()).toEqual(['up', 'down'])
    expect(p.onReveal).not.toHaveBeenCalled()
    expect(pill(), 'one card left: the pill still turns it').toBeInTheDocument()
    peel(peelCards()[1]!)
    expect(faces()).toEqual(['up', 'up'])
    expect(p.onReveal).toHaveBeenCalledTimes(1)
    expect(pill()).toBeNull()
    expect(screen.queryByRole('timer')).toBeNull()
  })

  // Pre-flight 2026-10-09 (9, 13): the cards are PeelCards for the whole hand — swapped for Cards they would remount and
  // come out of the deck again — and what the server turns (a decision, the forced turn at the deadline) opens on screen.
  it('opens what is still down when the server has the seat turned, in the same cards, and sends nothing back', () => {
    const p = props()
    const view = wrap(p)
    peel(peelCards()[0]!)
    const before = peelCards()
    view.rerender({ ...p, seat: { ...ann, revealed: true } })
    expect(pill()).toBeNull()
    expect(screen.queryByRole('timer')).toBeNull()
    advance(1000)
    expect(faces()).toEqual(['up', 'up'])
    expect(peelCards(), 'the same two cards: nothing was dealt again').toEqual(before)
    expect(p.onReveal, 'the server turned it: nothing to tell').not.toHaveBeenCalled()
  })

  it('opens what is still down when the round is over, and sends nothing', () => {
    const p = props()
    const view = wrap(p)
    const before = peelCards()
    view.rerender({ ...p, squeezeRound: false, deadlineAt: null })
    expect(pill()).toBeNull()
    advance(1000)
    expect(faces()).toEqual(['up', 'up'])
    expect(peelCards()).toEqual(before)
    expect(p.onReveal).not.toHaveBeenCalled()
  })

  // Spec §4.2.7: back in the room mid-round, a seat that had turned shows its cards up at once — no turn, no deal.
  it('shows a seat that had turned already with its cards up at once, no pill, no ring, nothing sent', () => {
    const p = props({ seat: { ...ann, revealed: true } })
    wrap(p)
    expect(faces()).toEqual(['up', 'up'])
    for (const name of QUEENS) expect(screen.getByRole('img', { name })).toBeInTheDocument()
    expect(pill()).toBeNull()
    expect(screen.queryByRole('timer')).toBeNull()
    expect(document.querySelectorAll(`.${s.cardDealt}`)).toHaveLength(0)
    advance(1000)
    expect(p.onReveal).not.toHaveBeenCalled()
  })

  it('deals the next hand face down again, with the pill, and tells the table about that hand too', () => {
    const p = props()
    const view = wrap(p)
    fireEvent.click(pill()!)
    advance(1000)
    expect(p.onReveal).toHaveBeenCalledTimes(1)
    // between hands the old cards are up and the round is off …
    view.rerender({ ...p, squeezeRound: false, deadlineAt: null })
    // … and the next hand's are new cards, down
    view.rerender({ ...p, handId: 'h2', seat: { ...ann, holeCards: parseCards('2c 7d') } })
    expect(faces()).toEqual(['down', 'down'])
    expect(pill()).toBeInTheDocument()
    fireEvent.click(pill()!)
    advance(1000)
    expect(p.onReveal).toHaveBeenCalledTimes(2)
  })

  // Final fix wave M2: a REVEAL lost with the socket. The reconnect's snapshot rebuilds the hand (`restored`) with my seat
  // still unturned, while my cards — in this same seat — stay up and the pill stays hidden: nothing would ever tell it again.
  it('tells the table once more when a reconnect rebuilds the hand with my cards up and my seat unturned', () => {
    const p = props()
    const view = wrap(p)
    fireEvent.click(pill()!)
    advance(1000)
    expect(p.onReveal, 'told while the hand was live').toHaveBeenCalledTimes(1)
    const again = vi.fn()
    view.rerender({ ...p, restored: true, onReveal: again })
    expect(faces(), 'my cards are still up').toEqual(['up', 'up'])
    expect(again).toHaveBeenCalledTimes(1)
    // later frames of the same hand, and the ring that went with the round, change nothing
    view.rerender({ ...p, restored: true, onReveal: again, deadlineAt: 1_014_000 })
    advance(1000)
    expect(again).toHaveBeenCalledTimes(1)
    // the server has it now
    view.rerender({ ...p, restored: true, onReveal: again, seat: { ...ann, revealed: true } })
    expect(again).toHaveBeenCalledTimes(1)
  })

  it('does not tell the table again when the rebuilt hand has my seat turned', () => {
    const p = props()
    const view = wrap(p)
    fireEvent.click(pill()!)
    advance(1000)
    const again = vi.fn()
    view.rerender({ ...p, restored: true, onReveal: again, seat: { ...ann, revealed: true } })
    advance(1000)
    expect(again).not.toHaveBeenCalled()
  })

  it('tells the table once for a hand that was already a snapshot when my cards came up', () => {
    const p = props({ restored: true })
    wrap(p)
    fireEvent.click(pill()!)
    advance(1000)
    expect(faces()).toEqual(['up', 'up'])
    expect(p.onReveal, 'nothing was lost: one REVEAL').toHaveBeenCalledTimes(1)
  })

  // Final fix wave M4: the pill goes disabled and hidden as it is used; focus on it would fall to the page.
  it('hands keyboard focus to the seat when the pill hides under it', () => {
    const view = wrap(props())
    const seat = screen.getByRole('group', { name: 'Ghế 1' })
    pill()!.focus()
    expect(document.activeElement).toBe(pill())
    fireEvent.click(pill()!)
    expect(document.activeElement, 'not the page').not.toBe(document.body)
    expect(document.activeElement).toBe(seat)
    expect(seat).toHaveAttribute('tabindex', '-1')
    // the next hand's pill, focused, then turned by the server: the same
    view.rerender(props({ handId: 'h2', seat: { ...ann, holeCards: parseCards('2c 7d') } }))
    const next = screen.getByRole('button', { name: 'Lật' })
    next.focus()
    view.rerender(props({ handId: 'h2', seat: { ...ann, holeCards: parseCards('2c 7d'), revealed: true } }))
    expect(document.activeElement).toBe(seat)
  })

  it('leaves focus where it is when the pill hides without it', () => {
    wrap(props())
    const elsewhere = document.createElement('button')
    document.body.append(elsewhere)
    elsewhere.focus()
    fireEvent.click(pill()!)
    expect(document.activeElement).toBe(elsewhere)
    elsewhere.remove()
  })

  // Spec §4.2.6: the others see "Đã lật" on a seat that has turned, during the round — to know whom they are waiting on.
  it('says "Đã lật" on another seat that has turned, during the round only', () => {
    const other = (patch: Partial<SeatProps>) => props({ seat: bot, player: makePlayer({ playerId: 'bot2', displayName: 'Bảo', isBot: true, seat: 2 }), isMe: false, deadlineAt: null, ...patch })
    const view = wrap(other({}))
    expect(screen.getByText('Đã lật')).toBeInTheDocument()
    expect(peelCards(), 'an opponent’s cards are plain backs').toHaveLength(0)
    expect(screen.getAllByRole('img', { name: 'Lá úp' })).toHaveLength(2)
    expect(document.querySelector(`.${s.revealBtn}`), 'no pill on another seat').toBeNull()
    view.rerender(other({ squeezeRound: false }))
    expect(screen.queryByText('Đã lật')).toBeNull()
    view.rerender(other({ seat: { ...bot, playerId: 'c', isBot: false, revealed: false } }))
    expect(screen.queryByText('Đã lật'), 'not one that is still to turn').toBeNull()
  })

  // Ruling 21: on a play-or-fold squeeze table the round's 20 s is the decision's too — the peel and then the choice — so
  // the ring stays on my plate until I have chosen, cards up or not; a pure-luck round has nothing left once they are up.
  it('keeps the round’s ring on a play-or-fold table until I have chosen, not just until my cards are up', () => {
    const three: ClientSeat = { ...ann, holeCards: parseCards('Qs Qd 7c') }
    const p = props({ seat: three, squeezeDecides: true })
    const view = wrap(p)
    for (const card of peelCards()) peel(card)
    expect(faces()).toEqual(['up', 'up', 'up'])
    expect(p.onReveal).toHaveBeenCalledTimes(1)
    expect(pill(), 'nothing left to turn').toBeNull()
    const plate = () => document.querySelector('[data-plate]') as HTMLElement
    expect(within(plate()).getByRole('timer'), 'the decision is still to make').toHaveTextContent('15')
    // the server has the seat turned (my REVEAL is back): still undecided, still counting
    view.rerender({ ...p, seat: { ...three, revealed: true } })
    expect(within(plate()).getByRole('timer')).toBeInTheDocument()
    view.rerender({ ...p, seat: { ...three, revealed: true, hasDecided: true } })
    expect(screen.queryByRole('timer'), 'chosen: nothing left to count down').toBeNull()
  })

  // Task 7 review M1: deciding turns the seat (spec §4.2.4), so "Đã chọn" already says "Đã lật" — and two badges with the
  // bet ran the line under a plate past its width at seven seats and up.
  it('lets "Đã chọn" stand for "Đã lật" on another seat that has decided', () => {
    const decided = { ...bot, hasDecided: true }
    wrap(props({ seat: decided, player: makePlayer({ playerId: 'bot2', displayName: 'Bảo', isBot: true, seat: 2 }), isMe: false, deadlineAt: null, squeezeDecides: true }))
    expect(screen.getByText('Đã chọn')).toBeInTheDocument()
    expect(screen.queryByText('Đã lật')).toBeNull()
  })

  // Plan 26 (B6): the pill is laid over the foot of the cards, so it no longer costs the seat a row (the play-or-fold
  // squeeze table's stage scrolled 11 px on a 375 px phone). Its place stays for the whole hand all the same.
  it('keeps the reveal pill inside the cards box and hidden-but-present when idle', () => {
    wrap(props())
    const box = document.querySelector<HTMLElement>(`.${s.seatCards}`)!
    const slot = document.querySelector<HTMLButtonElement>(`.${s.revealBtn}`)!
    expect(box.contains(slot), 'inside the cards box, not a row of the seat').toBe(true)
    expect(slot.parentElement).toBe(box)
    expect(slot).not.toHaveClass(s.revealBtnIdle!)
    expect(TABLE_CSS).toMatch(/\.seatCards\s*\{[^}]*position:\s*relative/)
    expect(TABLE_CSS).toMatch(/\.revealBtn\s*\{[^}]*position:\s*absolute/)
    fireEvent.click(slot)
    expect(box.contains(document.querySelector(`.${s.revealBtn}`)), 'still there once nothing is left to turn').toBe(true)
    expect(document.querySelector(`.${s.revealBtn}`)).toHaveClass(s.revealBtnIdle!)
    expect(TABLE_CSS).toMatch(/\.revealBtnIdle\s*\{[^}]*visibility:\s*hidden/)
  })

  // Ruling 22: the pill is a touch target — at least 28 px tall, its label centred.
  it('gives the pill a 28 px tap height', () => {
    expect(TABLE_CSS).toMatch(/\.revealBtn\s*\{[^}]*min-height:\s*28px/)
  })

  it('keeps the viewer’s cards plain cards on a table that is no squeeze table', () => {
    const { revealed: _absent, ...plain } = ann
    wrap(props({ seat: plain, squeezeRoom: false, squeezeRound: false, squeezeDecides: false, deadlineAt: null }))
    expect(peelCards()).toHaveLength(0)
    for (const name of QUEENS) expect(screen.getByRole('img', { name })).toBeInTheDocument()
    expect(document.querySelector(`.${s.revealBtn}`), 'no pill, nor its place').toBeNull()
    expect(screen.queryByText('Đã lật')).toBeNull()
  })
})

// Plan 27 (spec 2026-10-21 §2 A4): the player's rank stands after the name — its name on a wide plate, its roman numeral
// on a narrow one and always in the landscape frame — and leaves the app's caption line as it was.
describe('Seat with a rank', () => {
  const plain = (patch: Partial<SeatProps> = {}): SeatProps =>
    props({ squeezeRoom: false, squeezeRound: false, squeezeDecides: false, deadlineAt: null, caption: 'Vua bài', ...patch })

  it('shows "Bậc thầy" after the name for rank 4, and the caption below is unchanged', () => {
    wrap(plain({ rank: 4 }))
    const label = screen.getByText('Bậc thầy')
    expect(label).toHaveClass(s.rankLabel!)
    const row = label.closest(`.${s.seatName}`)
    expect(row, 'on the name’s own line').not.toBeNull()
    expect(row!.textContent).toBe('AnnBậc thầy')
    const caption = screen.getByText('Vua bài')
    expect(caption).toHaveClass(s.seatCaption!)
    expect(row!.contains(caption)).toBe(false)
  })

  it('shows "IV" in the landscape frame, with the name as its title', () => {
    wrap(plain({ rank: 4, frame: 'landscape' }))
    expect(screen.queryByText('Bậc thầy')).toBeNull()
    expect(screen.getByText('IV')).toHaveAttribute('title', 'Bậc thầy')
  })

  it('shows nothing for rank 1, for no rank, and for a bot', () => {
    const { rerender } = wrap(plain({ rank: 1 }))
    expect(document.querySelector(`.${s.rankLabel}, .${s.rankPill}`)).toBeNull()
    rerender(plain({ rank: null }))
    expect(document.querySelector(`.${s.rankLabel}, .${s.rankPill}`)).toBeNull()
    rerender(plain({ seat: bot, isMe: false, rank: 5 }))
    expect(document.querySelector(`.${s.rankLabel}, .${s.rankPill}`)).toBeNull()
  })

  it('keeps the full name where nothing is laid out (jsdom: a 0 px plate is not a narrow one)', () => {
    wrap(plain({ rank: 3 }))
    expect(screen.getByText('Cao thủ')).toBeInTheDocument()
  })

  it('shortens to the numeral when the plate’s text box measures under 120 px, and back when it widens', () => {
    let width = 96
    let fire: () => void = () => {}
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ left: 0, top: 0, right: width, bottom: 30, width, height: 30, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    )
    class FakeObserver {
      constructor(callback: ResizeObserverCallback) {
        fire = () => callback([], this as unknown as ResizeObserver)
      }
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    }
    vi.stubGlobal('ResizeObserver', FakeObserver)
    try {
      wrap(plain({ rank: 3 }))
      expect(screen.getByText('III')).toHaveAttribute('title', 'Cao thủ')
      width = 160
      act(() => fire())
      expect(screen.getByText('Cao thủ')).toHaveClass(s.rankLabel!)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
