import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

  // Plan 26 (B5): the module cannot name the room's hashed class, so the card keys its landscape rules on its own attribute.
  it('stamps the frame on the card root', () => {
    const room = { players: [{ playerId: 'a', displayName: 'Ann', seat: 0 }] } as unknown as RoomView
    const hand = {
      phase: 'COMPLETE',
      mode: 'holdem',
      seats: [{ seat: 0, playerId: 'a', displayName: 'Ann' }],
      result: {
        payouts: [{ seat: 0, amount: 100 }],
        pots: [{ amount: 100, eligibleSeats: [0], winners: [{ seat: 0, amount: 100 }] }],
        fee: 0,
        showdown: null,
        carryOverOut: 0,
        uncalledReturned: null,
        cancelled: false,
        reason: null,
      },
    } as unknown as ClientHand
    const card = (frame?: 'desktop' | 'landscape') => (
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <HandResult hand={hand} room={room} myPlayerId="a" lang="vi" frame={frame} />
      </I18nextProvider>
    )
    const view = render(card('landscape'))
    expect(screen.getByRole('group', { name: 'Người thắng' })).toHaveAttribute('data-frame', 'landscape')
    view.unmount()
    render(card())
    expect(screen.getByRole('group', { name: 'Người thắng' })).toHaveAttribute('data-frame', 'desktop')
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
    expect(screen.getByText('Máy chủ vừa khởi động lại')).toBeInTheDocument()
    expect(view.container.textContent).not.toContain('server restart')

    view.rerender(
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <HandResult hand={cancelled('gremlins in the dealer shoe')} room={room} myPlayerId="a" lang="vi" />
      </I18nextProvider>,
    )
    expect(screen.getByText('Không rõ lý do')).toBeInTheDocument()
    expect(view.container.textContent).not.toContain('gremlins')
  })

  // Review 2026-09-29, No2 (R13): the countdown moved onto the card. Ticking inside a live region, the whole receipt
  // would be read out again every second. The first answer nested an `aria-live="off"` element in the region, which a
  // screen reader may or may not honour; review round 2, R2-4 made it structural instead: the card is a group named
  // by its title, its head, note and body are the one `status` region, and the footer — fee, carry-over, uncalled
  // return, countdown — follows outside every live region, apart from the rows and the fee line other code reads the
  // card by.
  describe('the live region and the countdown to the next hand', () => {
    const LIVE = '[role="status"], [role="alert"], [aria-live="polite"], [aria-live="assertive"]'
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
    const renderWith = (countdown?: string, onDismiss?: () => void, shown: ClientHand = hand) =>
      render(
        <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
          <HandResult hand={shown} room={room} myPlayerId="a" lang="vi" onDismiss={onDismiss} countdown={countdown} />
        </I18nextProvider>,
      )

    it('prints it inside the card, in its own element that does not announce each tick', () => {
      renderWith('Ván tiếp theo sau 5 giây')
      const card = screen.getByRole('group', { name: 'Người thắng' })
      const next = within(card).getByText('Ván tiếp theo sau 5 giây')
      expect(next.closest(LIVE), 'no live region around the countdown').toBeNull()
      // the class the "no countdown" test looks for, so that test cannot pass on a selector that matches nothing
      expect(next).toHaveClass(s.resultNext!)
      expect(next.closest('li')).toBeNull()
      expect(within(card).getByText('Phí bàn 80')).not.toContainElement(next)
      expect(within(card).getAllByRole('listitem').filter((li) => li.textContent?.includes('Ván tiếp theo'))).toEqual([])
    })

    it('prints nothing for it when there is no next hand to count down to', () => {
      const view = renderWith()
      expect(view.container.querySelector(`.${s.resultNext}`)).toBeNull()
      expect(screen.queryByText(/Ván tiếp theo/)).toBeNull()
      expect(screen.getByText('Phí bàn 80'), 'the footer is still there').toBeInTheDocument()
    })

    it('is a group named by its title, whose one status region holds the title and the rows', () => {
      renderWith('Ván tiếp theo sau 5 giây', vi.fn())
      const card = screen.getByRole('group', { name: 'Người thắng' })
      expect(card, 'the card itself is not the live region').not.toHaveAttribute('role', 'status')
      expect(within(card).getAllByRole('status'), 'one live region on the card').toHaveLength(1)
      const live = within(card).getByRole('status')
      expect(within(live).getByRole('heading', { name: 'Người thắng' })).toBeInTheDocument()
      expect(within(live).getByRole('button', { name: 'Đóng' }), 'the close button is in the region with the title').toBeInTheDocument()
      expect(within(live).getByText('Bob')).toBeInTheDocument()
      expect(within(live).getByText('Thùng')).toBeInTheDocument()
      expect(within(live).getByText(/3\.920/)).toBeInTheDocument()
    })

    it('names the group after the title it carries: a split pot, titled like one winner, and a cancelled hand', () => {
      const split = {
        ...hand,
        result: { ...hand.result!, payouts: [{ seat: 0, amount: 1_960 }, { seat: 1, amount: 1_960 }] },
      } as unknown as ClientHand
      const view = renderWith(undefined, undefined, split)
      // One winner and a split share the title "Người thắng" now (the copy review of 2026-10, No9).
      expect(screen.getByRole('group', { name: 'Người thắng' })).toBeInTheDocument()
      view.unmount()

      const cancelled = {
        ...hand,
        result: { ...hand.result!, payouts: [], pots: [], fee: 0, showdown: null, cancelled: true, reason: 'server restart' },
      } as unknown as ClientHand
      renderWith(undefined, undefined, cancelled)
      const card = screen.getByRole('group', { name: 'Ván bị hủy' })
      // the note on why is part of what is announced, so it sits in the region with the title
      expect(within(within(card).getByRole('status')).getByText('Máy chủ vừa khởi động lại')).toBeInTheDocument()
    })

    it('keeps the fee, the carry-over, the uncalled return and the countdown outside every live region', () => {
      const full = {
        ...hand,
        result: { ...hand.result!, carryOverOut: 40, uncalledReturned: { seat: 0, amount: 500 } },
      } as unknown as ClientHand
      renderWith('Ván tiếp theo sau 5 giây', undefined, full)
      const card = screen.getByRole('group', { name: 'Người thắng' })
      const live = within(card).getByRole('status')
      for (const text of ['Phí bàn 80', 'Cộng dồn 40', 'Hoàn cược dư cho Ann 500', 'Ván tiếp theo sau 5 giây']) {
        const line = within(card).getByText(text)
        expect(line.closest(LIVE), `"${text}" has no live region around it`).toBeNull()
        expect(live, `"${text}" is not in the status region`).not.toContainElement(line)
      }
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
      const body = screen.getByRole('group', { name: 'Winner' }).querySelector<HTMLElement>(`.${s.resultBody}`)
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

// Plan 37: the card of a hand that used chaos cards lists them by seat, and the credits they paid.
describe('HandResult on a Poker hỗn loạn table', () => {
  const room = {
    players: [
      { playerId: 'a', displayName: 'Ann', seat: 0 },
      { playerId: 'b', displayName: 'Bob', seat: 1 },
    ],
  } as unknown as RoomView
  const handWith = (chaosUsed?: { seat: number; cardId: string; outcome: string }[]): ClientHand =>
    ({
      phase: 'COMPLETE',
      mode: 'blind',
      seats: [
        { seat: 0, playerId: 'a', displayName: 'Ann' },
        { seat: 1, playerId: 'b', displayName: 'Bob' },
      ],
      result: {
        payouts: [{ seat: 1, amount: 9_000 }],
        pots: [{ amount: 9_000, eligibleSeats: [0, 1], winners: [{ seat: 1, amount: 9_000 }] }],
        fee: 0,
        showdown: null,
        carryOverOut: 0,
        uncalledReturned: null,
        cancelled: false,
        reason: null,
        ...(chaosUsed ? { chaosUsed } : {}),
      },
    }) as unknown as ClientHand
  const draw = (hand: ClientHand, credits: Parameters<typeof HandResult>[0]['chaosCredits'] = []) =>
    render(
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <HandResult hand={hand} room={room} myPlayerId="a" lang="vi" chaosCredits={credits} />
      </I18nextProvider>,
    )
  const meta = (): string[] => [...document.querySelectorAll(`.${s.resultMeta}`)].map((el) => el.textContent ?? '')

  it('lists the cards that acted by seat on a "Thẻ đã dùng" line', () => {
    draw(handWith([
      { seat: 0, cardId: 's_swap_one', outcome: 'applied' },
      { seat: 1, cardId: 's_shield', outcome: 'applied' },
      { seat: 0, cardId: 's_peek_1', outcome: 'applied' },
    ]))
    expect(meta()).toEqual(['Thẻ đã dùng: Ann — Đổi lá, Nhìn trộm; Bob — Khiên gỗ'])
  })

  it('says after a card what stopped it', () => {
    draw(handWith([{ seat: 0, cardId: 's_steal_one', outcome: 'reflected' }]))
    expect(meta()).toEqual(['Thẻ đã dùng: Ann — Rút lá lẻ (Bị phản lại)'])
  })

  it('prints no such line for a hand that used none, or one a table without chaos played', () => {
    draw(handWith([]))
    expect(meta()).toEqual([])
    cleanup()
    draw(handWith(undefined))
    expect(meta()).toEqual([])
  })

  it('keeps the chaos lines in the footer, and in the scrolling body on a phone held sideways, where the card has no height for them', () => {
    const hand = handWith([{ seat: 0, cardId: 's_swap_one', outcome: 'applied' }])
    const { unmount } = draw(hand)
    expect(document.querySelector(`.${s.resultFoot} .${s.resultChaosBox}`)).not.toBeNull()
    unmount()
    render(
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <HandResult hand={hand} room={room} myPlayerId="a" lang="vi" frame="landscape" />
      </I18nextProvider>,
    )
    expect(document.querySelector(`.${s.resultBody} .${s.resultChaosBox}`)).toHaveTextContent('Thẻ đã dùng: Ann — Đổi lá')
    expect(document.querySelector(`.${s.resultFoot} .${s.resultChaosBox}`)).toBeNull()
  })

  it('prints each credit a card paid: Cấp cứu, Bạo kích with its multiplier, Thần tài; and the daily cap', () => {
    draw(handWith(), [
      { seat: 0, amount: 10_000, reason: 'chaos_rescue', capped: false },
      { seat: 1, amount: 12_000, reason: 'chaos_crit', capped: false, multiplier: 2 },
      { seat: 1, amount: 0, reason: 'chaos_fortune', capped: true },
    ])
    expect(meta()).toEqual(['Ann: Cấp cứu +10.000', 'Bob: Bạo kích ×2 +12.000', 'Bob: Thần tài +0 · Đã chạm trần thẻ hôm nay'])
  })
})

describe('HandResult: the chaos strip and "Bỏ qua" (BP-39, spec 2026-10-27 §3.2–3.3)', () => {
  const NAMES = ['Ann', 'Bob', 'Cẩm', 'Dũng', 'Én', 'Phúc', 'Giang', 'Hà']
  /** Eight seats shown down; Bob (seat 1) wins, the viewer is Hà (seat 7). */
  const room = { players: NAMES.map((displayName, seat) => ({ playerId: `p${seat}`, displayName, seat })) } as unknown as RoomView
  const BEST = ['Ah Kh Qh Jh Th', '9s 8s 7s 6s 5s', 'Qd Qc Qs 2h 2d', '4c 4d 4h Ks 3c', 'Jd Js 9c 9d 2s', '8h 8d 5c 5d Kc', '7d 7c 3h 3s Ac', '6h 6c 4s 2c Ad']
  const eight = (chaosUsed?: { seat: number; cardId: string; outcome: string; targets: number[] }[]): ClientHand =>
    ({
      handId: 'h8',
      phase: 'COMPLETE',
      mode: 'blind',
      seats: NAMES.map((displayName, seat) => ({ seat, playerId: `p${seat}`, displayName })),
      result: {
        payouts: [{ seat: 1, amount: 14_000 }],
        pots: [{ amount: 14_000, eligibleSeats: [0, 1, 2, 3, 4, 5, 6, 7], winners: [{ seat: 1, amount: 14_000 }] }],
        fee: 0,
        showdown: BEST.map((best, seat) => ({ seat, cards: parseCards(best).slice(0, 3), rank: seat, category: HandCategory.PAIR, best: parseCards(best) })),
        carryOverOut: 0,
        uncalledReturned: null,
        cancelled: false,
        reason: null,
        ...(chaosUsed ? { chaosUsed } : {}),
      },
    }) as unknown as ClientHand
  type Props = Parameters<typeof HandResult>[0]
  const element = (props: Partial<Props> = {}) => (
    <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
      <HandResult hand={eight()} room={room} myPlayerId="p7" lang="vi" variant="strip" {...props} />
    </I18nextProvider>
  )
  const draw = (props: Partial<Props> = {}) => render(element(props))
  const group = () => screen.getByRole('group', { name: 'Người thắng' })
  const rowNames = () => [...group().querySelectorAll(`.${s.stripRow} .${s.resultName}`)].map((el) => el.textContent)

  it('keeps the title alone as the group’s name, the countdown its own element beside it, and no "Đóng"', () => {
    draw({ countdown: 'Ván tiếp theo sau 9 giây' })
    expect(group()).toHaveClass(s.strip!)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/^Người thắng$/)
    expect(screen.getByText('Ván tiếp theo sau 9 giây')).toHaveClass(s.stripNext!)
    expect(within(screen.getByRole('status')).queryByText(/Ván tiếp theo/), 'the tick stays out of the live region').toBeNull()
    expect(screen.queryByRole('button', { name: 'Đóng' }), 'the strip leaves with the hand').toBeNull()
  })

  it('shows "Bỏ qua" with the count; a press calls onSkip once, and once it is mine the button says "Đã bỏ qua" and stays down', () => {
    const onSkip = vi.fn()
    const { rerender } = draw({ skip: { skipped: 3, total: 5, mine: false, onSkip } })
    expect(screen.getByText('Bỏ qua 3/5')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ qua' }))
    expect(onSkip).toHaveBeenCalledTimes(1)
    rerender(element({ skip: { skipped: 4, total: 5, mine: true, onSkip } }))
    const done = screen.getByRole('button', { name: 'Đã bỏ qua' })
    expect(done).toBeDisabled()
    fireEvent.click(done)
    expect(onSkip).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Bỏ qua 4/5')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Bỏ qua' })).toBeNull()
  })

  it('keeps "Bỏ qua" down while the press is out — a double tap sends one — and gives it back when the press is refused', async () => {
    let settle: (value: unknown) => void = () => undefined
    const onSkip = vi.fn(() => new Promise((resolve) => (settle = resolve)))
    draw({ skip: { skipped: 0, total: 3, mine: false, onSkip } })
    const button = screen.getByRole('button', { name: 'Bỏ qua' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onSkip).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
    await act(async () => settle(false))
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(onSkip).toHaveBeenCalledTimes(2)
  })

  it('shows the count without a button when there is no press to make (a spectator)', () => {
    draw({ skip: { skipped: 1, total: 2, mine: false } })
    expect(screen.getByText('Bỏ qua 1/2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /qua/ })).toBeNull()
  })

  it('folds eight rows to the winner and the viewer and "+6 người", a toggle that opens the sheet with every row and "Đóng" to fold it back', () => {
    draw()
    expect(rowNames()).toEqual(['Bob', 'Hà'])
    expect(group().querySelector(`.${s.resultMine} .${s.resultName}`)).toHaveTextContent('Hà')
    const more = screen.getByRole('button', { name: '+6 người' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)
    expect(rowNames()).toEqual(['Bob', 'Ann', 'Cẩm', 'Dũng', 'Én', 'Phúc', 'Giang', 'Hà'])
    expect(group()).toHaveAttribute('data-open', 'true')
    expect(group().parentElement).toHaveAttribute('data-open', 'true')
    expect(screen.queryByRole('button', { name: /^\+\d+ người$/ })).toBeNull()
    const close = within(group()).getByRole('button', { name: 'Đóng' })
    expect(close).toHaveAttribute('aria-expanded', 'true')
    expect(close, 'focus moves to the toggle that folds the sheet back').toHaveFocus()
    fireEvent.click(close)
    expect(rowNames()).toEqual(['Bob', 'Hà'])
    expect(group()).not.toHaveAttribute('data-open')
    expect(screen.getByRole('button', { name: '+6 người' }), 'focus goes back to the expander that opened it').toHaveFocus()
  })

  it('clamps "Thẻ đã dùng" to two lines and counts what the clamp hides in "+N thẻ khác", which opens the whole line', () => {
    // jsdom lays nothing out: the clamp's box is two 18 px lines of a three-line text, and each card name sits on the line its
    // place in the list gives it (two to a line).
    const order = ['Rút lá lẻ', 'Khiên gỗ', 'Đổi lá', 'Nhìn trộm', 'Đổi bài']
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains(s.stripUsed!) ? 54 : 0
    })
    const client = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains(s.stripUsed!) ? 36 : 0
    })
    const lines = vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
      const i = order.indexOf(this.textContent ?? '')
      return [{ top: i < 0 ? 0 : Math.floor(i / 2) * 18 }] as unknown as DOMRectList
    })
    try {
      draw({
        hand: eight([
          { seat: 0, cardId: 's_steal_one', outcome: 'applied', targets: [7] },
          { seat: 1, cardId: 's_shield', outcome: 'applied', targets: [] },
          { seat: 2, cardId: 's_swap_one', outcome: 'applied', targets: [] },
          { seat: 3, cardId: 's_peek_1', outcome: 'applied', targets: [] },
          { seat: 4, cardId: 'g_swap_all', outcome: 'applied', targets: [] },
        ]),
      })
      const used = group().querySelector(`.${s.stripUsed}`)!
      expect(used).toHaveAttribute('data-clamped', 'true')
      const more = screen.getByRole('button', { name: '+1 thẻ khác' })
      expect(more).toHaveAttribute('aria-expanded', 'false')
      fireEvent.click(more)
      expect(used).not.toHaveAttribute('data-clamped')
      expect(screen.queryByRole('button', { name: /thẻ khác$/ })).toBeNull()
      fireEvent.click(within(group()).getByRole('button', { name: 'Đóng' }))
      expect(screen.getByRole('button', { name: '+1 thẻ khác' })).toHaveFocus()
    } finally {
      scroll.mockRestore()
      client.mockRestore()
      lines.mockRestore()
    }
  })

  it('shows no "+N thẻ khác" when the line fits its two lines', () => {
    draw({ hand: eight([{ seat: 0, cardId: 's_steal_one', outcome: 'applied', targets: [7] }]) })
    expect(screen.queryByRole('button', { name: /thẻ khác$/ })).toBeNull()
  })

  it('caps the opened sheet at its closed height plus 60 % of the stage, and never above the stage’s top', () => {
    const stage = document.createElement('main')
    document.body.append(stage)
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === stage) return { top: 100, bottom: 500, height: 400, left: 0, right: 360, width: 360 } as DOMRect
      if (this.classList.contains(s.stripSlot!)) return { top: 520, bottom: 670, height: 150, left: 0, right: 360, width: 360 } as DOMRect
      return { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0 } as DOMRect
    })
    const offset = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains(s.stripSlot!) ? 150 : 0
    })
    try {
      draw({ stage: { current: stage } })
      fireEvent.click(screen.getByRole('button', { name: '+6 người' }))
      const slot = group().parentElement!
      expect(slot.style.height, 'the slot keeps the closed height: nothing else moves').toBe('150px')
      expect(slot.style.getPropertyValue('--sheet-max'), '150 + 0.6 × 400, under 670 − 100 − 8').toBe('390px')
    } finally {
      rect.mockRestore()
      offset.mockRestore()
      stage.remove()
    }
  })

  it('folds nothing when only one row would fold, and keeps only the winners for a spectator', () => {
    const full = eight()
    const three = { ...full, seats: full.seats.slice(0, 3), result: { ...full.result!, showdown: full.result!.showdown!.slice(0, 3) } } as ClientHand
    draw({ hand: three, myPlayerId: 'p0' })
    expect(rowNames()).toEqual(['Bob', 'Ann', 'Cẩm'])
    cleanup()
    draw({ myPlayerId: null })
    expect(rowNames()).toEqual(['Bob'])
    expect(screen.getByRole('button', { name: '+7 người' })).toBeInTheDocument()
  })

  it('lists "Thẻ đã dùng" in the strip, each card’s name the button that says what it did', () => {
    draw({ hand: eight([{ seat: 0, cardId: 's_steal_one', outcome: 'blocked', targets: [7] }, { seat: 7, cardId: 's_shield', outcome: 'applied', targets: [] }]) })
    const line = within(group()).getByText(/^Thẻ đã dùng/)
    expect(line).toHaveTextContent('Thẻ đã dùng: Ann — Rút lá lẻ (Bị chặn); Hà — Khiên gỗ')
    expect(within(line).getAllByRole('button').map((b) => b.textContent)).toEqual(['Rút lá lẻ', 'Khiên gỗ'])
  })

  it('draws a phone held sideways as the same strip, stamped with its frame', () => {
    draw({ frame: 'landscape' })
    expect(group()).toHaveClass(s.strip!)
    expect(group()).toHaveAttribute('data-frame', 'landscape')
  })
})

describe('HandResult: the card keeps its shape', () => {
  const room = { players: [{ playerId: 'a', displayName: 'Ann', seat: 0 }, { playerId: 'b', displayName: 'Bob', seat: 1 }] } as unknown as RoomView
  const hand = {
    handId: 'h1',
    phase: 'COMPLETE',
    mode: 'blind',
    seats: [
      { seat: 0, playerId: 'a', displayName: 'Ann' },
      { seat: 1, playerId: 'b', displayName: 'Bob' },
    ],
    result: { payouts: [{ seat: 1, amount: 500 }], pots: [], fee: 0, showdown: null, carryOverOut: 0, uncalledReturned: null, cancelled: false, reason: null },
  } as unknown as ClientHand

  it('on a plain table: the card, "Đóng", and no skip anywhere', () => {
    render(
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <HandResult hand={hand} room={room} myPlayerId="a" lang="vi" onDismiss={vi.fn()} />
      </I18nextProvider>,
    )
    const card = screen.getByRole('group', { name: 'Người thắng' })
    expect(card).toHaveClass(s.result!)
    expect(within(card).getByRole('button', { name: 'Đóng' })).toBeInTheDocument()
    expect(card.textContent).not.toMatch(/qua/)
    expect(card.querySelector(`.${s.resultSkip}`)).toBeNull()
  })

  it('on a desktop chaos table: the count and "Bỏ qua" in the head beside "Đóng", kept out of the live region’s announcements', () => {
    const onSkip = vi.fn()
    render(
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <HandResult hand={hand} room={room} myPlayerId="a" lang="vi" onDismiss={vi.fn()} skip={{ skipped: 0, total: 2, mine: false, onSkip }} />
      </I18nextProvider>,
    )
    const head = document.querySelector<HTMLElement>(`.${s.resultHead}`)!
    expect(within(head).getByText('Bỏ qua 0/2').closest('[aria-live]')).toHaveAttribute('aria-live', 'off')
    fireEvent.click(within(head).getByRole('button', { name: 'Bỏ qua' }))
    expect(onSkip).toHaveBeenCalledTimes(1)
    expect(within(head).getByRole('button', { name: 'Đóng' })).toBeInTheDocument()
  })
})
