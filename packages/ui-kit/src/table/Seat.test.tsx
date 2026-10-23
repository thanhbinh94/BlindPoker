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

  // BP-28, R1: on the short landscape tier an opponent's line keeps its bet — who the seat is goes, its state is a dot.
  // The seat marks the badges for those rules, and the words stay in the tree for a screen reader.
  it('marks the host and bot badges and the state pill for the short tier, keeping their words', () => {
    const decided = makeSeat({ seat: 2, playerId: 'bot2', displayName: 'Bảo', isBot: true, hasDecided: true, betThisStreet: 2_000 })
    wrap(props({ seat: decided, player: makePlayer({ playerId: 'bot2', displayName: 'Bảo', isBot: true, isHost: true, seat: 2 }), isMe: false, deadlineAt: null }))
    expect(screen.getByText('Bot')).toHaveClass(s.tagWho!)
    expect(screen.getByText('Chủ phòng').closest(`.${s.tagWho}`)).not.toBeNull()
    expect(screen.getByText('Đã chọn')).toHaveClass(s.tagState!)
    expect(screen.getByText('2.000')).not.toHaveClass(s.tagState!)
    // the rules themselves: an opponent's who-badges go, and its state shrinks to a dot whose text is 0 px
    const short = ".ring[data-frame='landscape'][data-tier='short'] .seat:not(.seatMe)"
    const rule = (sel: string): string => new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(TABLE_CSS)?.[1] ?? ''
    expect(rule(`${short} .tagWho`)).toMatch(/display:\s*none/)
    expect(rule(`${short} .tagState`)).toMatch(/font-size:\s*0/)
    expect(rule(`${short} .tagState`)).toMatch(/background:\s*currentColor/)
  })

  // BP-28: the cards and the plate share a box that is no box (`display: contents`) everywhere but the short tier's own seat.
  it('wraps the cards and the plate in a contents-only box, and keeps the lines under the plate the seat’s own children', () => {
    const { container } = wrap(props())
    const top = container.querySelector<HTMLElement>(`.${s.seatTop}`)!
    expect(top.parentElement).toHaveAttribute('data-seat')
    expect(top.querySelector('[data-plate]')).not.toBeNull()
    expect(container.querySelector(`.${s.tags}`)!.parentElement).toBe(top.parentElement)
    expect(TABLE_CSS).toMatch(/\.seatTop\s*\{\s*display:\s*contents;?\s*\}/)
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

  it('shows "IV" in the landscape frame, with the name as its title, on the stack line and not on the name’s', () => {
    wrap(plain({ rank: 4, frame: 'landscape' }))
    expect(screen.queryByText('Bậc thầy')).toBeNull()
    const pill = screen.getByText('IV')
    expect(pill).toHaveAttribute('title', 'Bậc thầy')
    expectOnStackLine(pill)
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
      const pill = screen.getByText('III')
      expect(pill).toHaveAttribute('title', 'Cao thủ')
      expectOnStackLine(pill)
      width = 160
      act(() => fire())
      const word = screen.getByText('Cao thủ')
      expect(word).toHaveClass(s.rankLabel!)
      expect(word.closest(`.${s.seatName}`), 'back beside the name').not.toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  /**
   * Lays the plate out in jsdom: the plate's text box `text` px wide (its box and its client width), the name `name` px
   * long at full length, the rank's word 45 px; with `cap`, the plate grows to its content up to `cap` px and its chrome
   * (disc, padding, gap) is 50 px — the viewer's own plate on the ring.
   */
  const layOut = ({ text, name, cap }: { text: number; name: number; cap?: number }): void => {
    const widthOf = (el: Element): number => (el.classList.contains(s.plateText!) ? text : el.classList.contains(s.rankLabel!) ? 45 : 0)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const width = widthOf(this)
      return { left: 0, top: 0, right: width, bottom: 20, width, height: 20, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return widthOf(this)
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains(s.plate!) ? text + 50 : widthOf(this)
    })
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains(s.seatNameText!) ? name : 0
    })
    if (cap === undefined) return
    const real = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
      const style = real(el, pseudo)
      return el instanceof HTMLElement && el.classList.contains(s.plate!) ? ({ ...style, maxWidth: `${cap}px` } as CSSStyleDeclaration) : style
    })
  }

  it('puts the rank’s word after the stack when it would cut a long name beside it', () => {
    // 120 + 5 + 45 = 170 px of name line in a 150 px text box
    layOut({ text: 150, name: 120 })
    wrap(plain({ rank: 3 }))
    const word = screen.getByText('Cao thủ')
    expect(word).toHaveClass(s.rankLabel!)
    expectOnStackLine(word)
  })

  it('keeps the rank’s word beside a name it fits after, with room to breathe', () => {
    // 96 + 5 + 45 = 146 px, the 150 px box less its 4 px of breathing room
    layOut({ text: 150, name: 96 })
    wrap(plain({ rank: 3 }))
    expect(screen.getByText('Cao thủ').closest(`.${s.seatName}`)).not.toBeNull()
  })

  it('measures a plate that grows to its name by how far it may grow, not by the box it has now', () => {
    // The box is 150 px today, but the plate may grow to 300 px: 300 − 50 px of chrome leaves 250 for 180 + 5 + 45.
    layOut({ text: 150, name: 180, cap: 300 })
    wrap(plain({ rank: 3 }))
    expect(screen.getByText('Cao thủ').closest(`.${s.seatName}`)).not.toBeNull()
  })
})

// BP-31 §3.1 (R1, R10): in the stack layout my cards fan out over the felt's foot and my seat is a one-line strip under
// them — the plate itself, carrying what used to hang under it. The ring and the opponents keep the plate and its lines.
describe('Seat as the stack strip', () => {
  const plain = (patch: Partial<SeatProps> = {}): SeatProps =>
    props({ squeezeRoom: false, squeezeRound: false, squeezeDecides: false, deadlineAt: null, ...patch })
  const fan = (): string | null => document.querySelector(`.${s.seatCards}`)!.getAttribute('data-fan')
  const plate = (): HTMLElement => document.querySelector<HTMLElement>('[data-plate]')!
  /** One rule's body in the raw stylesheet: the first block whose selector is exactly `sel`. */
  const rule = (sel: string): string => new RegExp(`(?:^|[}\\s])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(TABLE_CSS)?.[1] ?? ''

  it("the viewer's stack seat fans two or three cards and never a peel hand", () => {
    const { revealed: _absent, ...two } = ann
    const view = wrap(plain({ seat: two, strip: true }))
    expect(fan()).toBe('2')
    view.rerender(plain({ seat: { ...two, holeCards: parseCards('Qs Qd 2c'), cardCount: 3 }, strip: true }))
    expect(fan()).toBe('3')
    view.unmount()
    // a squeeze table's cards are peeled by hand: they lie flat, at the fan's width
    const peeling = wrap(props({ strip: true }))
    expect(fan()).toBe('none')
    expect(peelCards()).toHaveLength(2)
    peeling.unmount()
    // the ring's own seat and an opponent's never fan
    const ring = wrap(plain({ seat: two }))
    expect(fan()).toBeNull()
    ring.unmount()
    wrap(plain({ seat: makeSeat({ seat: 3, playerId: 'b', displayName: 'Bob' }), player: makePlayer({ playerId: 'b', displayName: 'Bob', seat: 3 }), isMe: false }))
    expect(fan()).toBeNull()
  })

  it('the strip keeps the timer ring, the dealer button, the street bet and the host badge, and drops Bạn and the caption', () => {
    const betting = makeSeat({ seat: 0, playerId: 'a', displayName: 'Ann', holeCards: parseCards('Qs Qd'), betThisStreet: 2_000 })
    const host = makePlayer({ playerId: 'a', displayName: 'Ann', seat: 0, status: 'IN_HAND', isHost: true })
    const live = { seat: betting, player: host, isActing: true, isButton: true, deadlineAt: 1_015_000, caption: 'Vua bài' }
    // the ring's own seat, for contrast: "Bạn" and the caption are there
    const ring = wrap(plain(live))
    expect(screen.getByText('Bạn')).toBeInTheDocument()
    expect(screen.getByText('Vua bài')).toBeInTheDocument()
    ring.unmount()

    const view = wrap(plain({ ...live, strip: true }))
    const row = plate()
    expect(within(row).getByRole('timer')).toHaveTextContent('15')
    expect(within(row).getByRole('img', { name: 'Cái' })).toHaveTextContent('D')
    expect(within(row).getByText('2.000')).toHaveClass(s.bet!)
    expect(within(row).getByText('Chủ phòng')).toBeInTheDocument()
    expect(within(row).getByText('20.000')).toHaveClass(s.seatStack!)
    expect(screen.queryByText('Bạn')).toBeNull()
    expect(screen.queryByText('Vua bài')).toBeNull()
    // the seat's state, when it has one, is on the same row
    view.rerender(plain({ ...live, seat: { ...betting, folded: true }, strip: true }))
    expect(within(plate()).getByText('Đã bỏ bài')).toBeInTheDocument()
    view.rerender(plain({ ...live, seat: { ...betting, allIn: true }, strip: true }))
    expect(within(plate()).getByText('Tất tay')).toBeInTheDocument()
    // the rank is its numeral's badge on the row, never a word that could cut the name
    view.rerender(plain({ ...live, rank: 4, strip: true }))
    expect(within(plate()).getByText('IV')).toHaveClass(s.rankPill!)
    expect(screen.queryByText('Bậc thầy')).toBeNull()
  })

  it('the strip’s row is still .plate[data-plate]', () => {
    const view = wrap(plain({ strip: true }))
    const row = plate()
    expect(row).toHaveClass(s.plate!)
    expect(within(row).getByText('Ann')).toHaveClass(s.seatNameText!)
    expect(row.closest('[data-me="true"]')).toHaveAttribute('role', 'group')
    expect(row.closest('[data-me="true"]')).toHaveAttribute('aria-label', 'Ghế 1')
    // nothing hangs under it: no badge line of its own
    expect(document.querySelector(`.${s.tags}`)).toBeNull()
    expect(document.querySelector(`.${s.seatResult}`)).toBeNull()
    // at showdown the hand's name and the payout are the row's second line, inside the plate
    view.rerender(plain({ strip: true, showdownLabel: 'Thùng', winnerPayout: 5_000 }))
    const result = document.querySelector<HTMLElement>(`.${s.seatResult}`)!
    expect(plate().contains(result)).toBe(true)
    expect(within(result).getByText('Thùng')).toHaveClass(s.handTag!)
    expect(within(result).getByText('+5.000')).toHaveClass(s.payout!)
    expect(plate()).toHaveClass(s.plateTwoLine!)
  })

  it('the fan rotates ±7° for two cards and ±9° for three, overlaps 14 px, hangs 30 px below the felt and the felt pads by the rest of the card', () => {
    const stack = rule('.stack')
    expect(stack).toMatch(/--fan-overlap:\s*14px/)
    expect(stack).toMatch(/--fan-drop:\s*30px/)
    expect(stack).toMatch(/--fan-over:\s*calc\(var\(--fan-card\) \* 1\.4 - var\(--fan-drop\)\)/)
    expect(rule('.stack[data-mine-cards] .stackFelt')).toMatch(/padding-bottom:\s*calc\(var\(--space-4\) \+ var\(--fan-over\)\)/)
    const mine = rule('.stack[data-mine-cards] .mine')
    expect(mine).toMatch(/margin-top:\s*calc\(-1 \* \(var\(--fan-over\) \+ var\(--space-3\)\)\)/)
    expect(mine).toMatch(/background:\s*transparent/)
    expect(rule('.stack[data-mine-cards] .mine::before')).toMatch(/content:\s*none/)
    expect(TABLE_CSS).toMatch(/\.mine \[data-fan='2'\],\s*\.mine \[data-fan='3'\]\s*\{\s*gap:\s*0;?\s*\}/)
    expect(TABLE_CSS).toMatch(/\.mine \[data-fan='2'\] > \* \+ \*,\s*\.mine \[data-fan='3'\] > \* \+ \*\s*\{\s*margin-left:\s*calc\(-1 \* var\(--fan-overlap\)\);?\s*\}/)
    // the individual `rotate` property, pivoting on the card's foot: `.cardDealt` animates `transform`, and outranks nothing here
    expect(TABLE_CSS).toMatch(/\.mine \[data-fan='2'\] > \.card,\s*\.mine \[data-fan='3'\] > \.card\s*\{\s*transform-origin:\s*50% 100%;?\s*\}/)
    expect(rule(".mine [data-fan='2'] > .card:nth-child(1)")).toMatch(/rotate:\s*-7deg/)
    expect(rule(".mine [data-fan='2'] > .card:nth-child(2)")).toMatch(/rotate:\s*7deg/)
    expect(rule(".mine [data-fan='3'] > .card:nth-child(1)")).toMatch(/rotate:\s*-9deg/)
    expect(rule(".mine [data-fan='3'] > .card:nth-child(2)")).toMatch(/rotate:\s*0deg/)
    expect(rule(".mine [data-fan='3'] > .card:nth-child(3)")).toMatch(/rotate:\s*9deg/)
    // a peel hand lies flat: nothing rotates it
    expect(TABLE_CSS).not.toMatch(/\[data-fan='none'\][^{]*\{[^}]*rotate/)
    // the fan is still: no motion of its own
    expect(TABLE_CSS).not.toMatch(/\[data-fan[^{]*\{[^}]*(animation|transition)/)
  })

  it('stack cards are clamp(52px, 15vw, 60px) and community cards clamp(40px, 11vw, 48px)', () => {
    expect(rule('.stack')).toMatch(/--fan-card:\s*clamp\(52px, 15vw, 60px\)/)
    expect(rule('.mine .cardMd')).toMatch(/--card-w:\s*var\(--fan-card\)/)
    expect(rule('.stackFelt')).toMatch(/--card-lg:\s*clamp\(40px, 11vw, 48px\)/)
  })

  it('chip tags are 11 px and the chip bet is 12 px on the phone', () => {
    expect(rule('.othersChip .tags > *')).toMatch(/font-size:\s*0\.6875rem/)
    expect(rule('.othersChip .bet')).toMatch(/font-size:\s*0\.75rem/)
    expect(rule(".ring[data-frame='landscape'] .potLabel")).toMatch(/font-size:\s*0\.6875rem/)
  })

  it('the strip is one 44 px row with a 36 px disc, 56 px with the result under the name', () => {
    expect(rule('.meStrip .plate')).toMatch(/min-height:\s*44px/)
    expect(rule('.meStrip .plate')).toMatch(/gap:\s*var\(--space-2\)/)
    expect(rule('.meStrip .avatar')).toMatch(/--seat-disc:\s*36px/)
    expect(rule('.meStrip .plateTwoLine')).toMatch(/min-height:\s*56px/)
  })
})

/** The rank stands on the stack line, beside the figure, and not on the name's line. */
function expectOnStackLine(rank: HTMLElement): void {
  const line = rank.closest(`.${s.stackLine}`)
  expect(line, 'on the stack line').not.toBeNull()
  expect(line!.querySelector(`.${s.seatStack}`), 'beside the figure').not.toBeNull()
  expect(rank.closest(`.${s.seatName}`), 'not on the name’s line').toBeNull()
}
