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
    expect(document.querySelector(`.${s.revealBtn}`), 'the same pill, still taking its row').toBe(slot)
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

  it('keeps the viewer’s cards plain cards on a table that is no squeeze table', () => {
    const { revealed: _absent, ...plain } = ann
    wrap(props({ seat: plain, squeezeRoom: false, squeezeRound: false, deadlineAt: null }))
    expect(peelCards()).toHaveLength(0)
    for (const name of QUEENS) expect(screen.getByRole('img', { name })).toBeInTheDocument()
    expect(document.querySelector(`.${s.revealBtn}`), 'no pill, nor its place').toBeNull()
    expect(screen.queryByText('Đã lật')).toBeNull()
  })
})
