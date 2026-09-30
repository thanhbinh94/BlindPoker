import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import { HandCategory, parseCards, type RoomView } from '@bp/core'
import { createI18n } from '../i18n/index.js'
import type { ClientHand } from '../client/types.js'
import { HandResult } from './HandResult.js'
import s from './table.module.css'

describe('HandResult', () => {
  it('names the winner, the hand and the payout', () => {
    const room = {
      players: [
        { playerId: 'a', displayName: 'Ann', seat: 0 },
        { playerId: 'b', displayName: 'Bob', seat: 1 },
      ],
    } as unknown as RoomView
    const hand = {
      phase: 'COMPLETE',
      mode: 'holdem',
      seats: [
        { seat: 0, playerId: 'a', displayName: 'Ann' },
        { seat: 1, playerId: 'b', displayName: 'Bob' },
      ],
      result: {
        payouts: [{ seat: 1, amount: 588 }],
        pots: [{ amount: 588, eligibleSeats: [0, 1], winners: [{ seat: 1, amount: 588 }] }],
        fee: 12,
        showdown: [{ seat: 1, cards: parseCards('Ah Kh'), rank: 0, category: HandCategory.FLUSH, best: parseCards('Ah Kh 9h 5h 2h') }],
        carryOverOut: 0,
        uncalledReturned: null,
        cancelled: false,
        reason: null,
      },
    } as unknown as ClientHand
    render(
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <HandResult hand={hand} room={room} myPlayerId="a" lang="vi" />
      </I18nextProvider>,
    )
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Thùng')).toBeInTheDocument()
    expect(screen.getByText(/588/)).toBeInTheDocument()
    expect(screen.queryByText(/Pot chính/)).toBeNull() // one pot needs no breakdown
  })

  it('breaks a short all-in down into main and side pots, naming who was eligible for each', () => {
    const room = {
      players: [
        { playerId: 'a', displayName: 'Ann', seat: 0 },
        { playerId: 'b', displayName: 'Bob', seat: 1 },
        { playerId: 'c', displayName: 'Cẩm', seat: 2 },
      ],
    } as unknown as RoomView
    const hand = {
      phase: 'COMPLETE',
      mode: 'holdem',
      seats: [
        { seat: 0, playerId: 'a', displayName: 'Ann' },
        { seat: 1, playerId: 'b', displayName: 'Bob' },
        { seat: 2, playerId: 'c', displayName: 'Cẩm' },
      ],
      result: {
        payouts: [
          { seat: 2, amount: 1200 },
          { seat: 0, amount: 800 },
        ],
        pots: [
          { amount: 1200, eligibleSeats: [0, 1, 2], winners: [{ seat: 2, amount: 1200 }] },
          { amount: 800, eligibleSeats: [0, 1], winners: [{ seat: 0, amount: 800 }] },
        ],
        fee: 0,
        showdown: null,
        carryOverOut: 0,
        uncalledReturned: null,
        cancelled: false,
        reason: null,
      },
    } as unknown as ClientHand
    render(
      <I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>
        <HandResult hand={hand} room={room} myPlayerId="a" lang="en" />
      </I18nextProvider>,
    )
    expect(screen.getByText('Main pot')).toBeInTheDocument()
    expect(screen.getByText('Side pot 1')).toBeInTheDocument()
    expect(screen.getByText('Eligible: Ann, Bob, Cẩm')).toBeInTheDocument()
    expect(screen.getByText('Eligible: Ann, Bob')).toBeInTheDocument()
    expect(screen.getByText('Cẩm +1,200')).toBeInTheDocument()
    expect(screen.getByText('Ann +800')).toBeInTheDocument()
  })

  it('translates the cancellation reason and never shows the server’s own wording', () => {
    const room = { players: [{ playerId: 'a', displayName: 'Ann', seat: 0 }] } as unknown as RoomView
    const cancelled = (reason: string): ClientHand =>
      ({
        phase: 'COMPLETE',
        mode: 'holdem',
        seats: [{ seat: 0, playerId: 'a', displayName: 'Ann' }],
        result: { payouts: [], pots: [], fee: 0, showdown: null, carryOverOut: 0, uncalledReturned: null, cancelled: true, reason },
      }) as unknown as ClientHand

    const view = render(
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <HandResult hand={cancelled('server restart')} room={room} myPlayerId="a" lang="vi" />
      </I18nextProvider>,
    )
    expect(screen.getByText('Máy chủ khởi động lại')).toBeInTheDocument()
    expect(view.container.textContent).not.toContain('server restart')

    view.rerender(
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <HandResult hand={cancelled('gremlins in the dealer shoe')} room={room} myPlayerId="a" lang="vi" />
      </I18nextProvider>,
    )
    expect(screen.getByText('Không rõ lý do')).toBeInTheDocument()
    expect(view.container.textContent).not.toContain('gremlins')
  })

  // Review 2026-09-29, No2 (R13): the countdown moved onto the card, whose root is a live region. Ticking inside it,
  // the whole receipt would be read out again every second — so it sits in its own `aria-live="off"` element in the
  // footer, apart from the rows and the fee line other code reads the card by.
  describe('the countdown to the next hand', () => {
    const room = {
      players: [
        { playerId: 'a', displayName: 'Ann', seat: 0 },
        { playerId: 'b', displayName: 'Bob', seat: 1 },
      ],
    } as unknown as RoomView
    const hand = {
      phase: 'COMPLETE',
      mode: 'blind',
      seats: [
        { seat: 0, playerId: 'a', displayName: 'Ann' },
        { seat: 1, playerId: 'b', displayName: 'Bob' },
      ],
      result: {
        payouts: [{ seat: 1, amount: 3_920 }],
        pots: [{ amount: 4_000, eligibleSeats: [0, 1], winners: [{ seat: 1, amount: 3_920 }] }],
        fee: 80,
        showdown: [{ seat: 1, cards: parseCards('Ah Kh'), rank: 0, category: HandCategory.FLUSH, best: parseCards('Ah Kh 9h 5h 2h') }],
        carryOverOut: 0,
        uncalledReturned: null,
        cancelled: false,
        reason: null,
      },
    } as unknown as ClientHand
    const renderWith = (countdown?: string) =>
      render(
        <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
          <HandResult hand={hand} room={room} myPlayerId="a" lang="vi" countdown={countdown} />
        </I18nextProvider>,
      )

    it('prints it inside the card, in its own element that does not announce each tick', () => {
      renderWith('Ván tiếp theo sau 5 giây')
      const card = screen.getByRole('status')
      const next = within(card).getByText('Ván tiếp theo sau 5 giây')
      expect(next).toHaveAttribute('aria-live', 'off')
      expect(next.closest('li')).toBeNull()
      expect(within(card).getByText('Phí bàn 80')).not.toContainElement(next)
      expect(within(card).getAllByRole('listitem').filter((li) => li.textContent?.includes('Ván tiếp theo'))).toEqual([])
    })

    it('prints nothing for it when there is no next hand to count down to', () => {
      renderWith()
      expect(screen.getByRole('status').querySelector('[aria-live="off"]')).toBeNull()
      expect(screen.queryByText(/Ván tiếp theo/)).toBeNull()
    })
  })

  // Task 8 review: capped at the felt's height, the card's body scrolls — and a side-pot ledger below the fold is only
  // found by someone who can tell there is more. `data-more` fades the body's foot while it can still scroll down.
  // jsdom lays nothing out, so the body's metrics are stubbed and the ResizeObserver is a fake whose callback the test
  // fires itself.
  describe('the fade that says the body scrolls', () => {
    const room = {
      players: [
        { playerId: 'a', displayName: 'Ann', seat: 0 },
        { playerId: 'b', displayName: 'Bob', seat: 1 },
      ],
    } as unknown as RoomView
    const hand = {
      phase: 'COMPLETE',
      mode: 'holdem',
      seats: [
        { seat: 0, playerId: 'a', displayName: 'Ann' },
        { seat: 1, playerId: 'b', displayName: 'Bob' },
      ],
      result: {
        payouts: [{ seat: 1, amount: 588 }],
        pots: [{ amount: 600, eligibleSeats: [0, 1], winners: [{ seat: 1, amount: 588 }] }],
        fee: 12,
        showdown: null,
        carryOverOut: 0,
        uncalledReturned: null,
        cancelled: false,
        reason: null,
      },
    } as unknown as ClientHand
    const box = { scrollHeight: 0, clientHeight: 0 }
    let resized: (() => void) | null = null
    let observed: Element[] = []

    beforeEach(() => {
      const metric = (key: keyof typeof box) =>
        function (this: HTMLElement): number {
          return this.classList.contains(s.resultBody!) ? box[key] : 0
        }
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(metric('scrollHeight'))
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(metric('clientHeight'))
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(callback: () => void) {
            resized = callback
          }
          observe(el: Element): void {
            observed.push(el)
          }
          disconnect(): void {
            observed = []
          }
        },
      )
    })

    afterEach(() => {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
      resized = null
      observed = []
    })

    const bodyOf = (): HTMLElement => {
      render(
        <I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>
          <HandResult hand={hand} room={room} myPlayerId="a" lang="en" />
        </I18nextProvider>,
      )
      const body = screen.getByRole('status').querySelector<HTMLElement>(`.${s.resultBody}`)
      expect(body).not.toBeNull()
      return body!
    }

    it('fades the foot while there is more below, and stops once scrolled to the end', () => {
      Object.assign(box, { scrollHeight: 400, clientHeight: 200 })
      const body = bodyOf()
      expect(body).toHaveAttribute('data-more', 'true')

      body.scrollTop = 120
      fireEvent.scroll(body)
      expect(body, 'still 80 px to go').toHaveAttribute('data-more', 'true')

      body.scrollTop = 200
      fireEvent.scroll(body)
      expect(body, 'at the end').not.toHaveAttribute('data-more')
    })

    it('draws no fade when everything fits', () => {
      Object.assign(box, { scrollHeight: 200, clientHeight: 200 })
      expect(bodyOf()).not.toHaveAttribute('data-more')
    })

    it('measures again when the box or what it holds changes size', () => {
      Object.assign(box, { scrollHeight: 200, clientHeight: 200 })
      const body = bodyOf()
      expect(body).not.toHaveAttribute('data-more')

      // the window got shorter: the card's cap came down, the rows did not — and it is the body that is watched
      Object.assign(box, { clientHeight: 120 })
      expect(observed).toContain(body)
      act(() => resized?.())
      expect(body).toHaveAttribute('data-more', 'true')
    })
  })
})
