import type { ChaosBonusPayload } from '@bp/core'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AckOrError } from '../client/connection.js'
import { createI18n } from '../i18n/index.js'
import { BONUS_ERROR_MS, BonusHand, type BonusHandProps } from './BonusHand.js'
import TABLE_CSS from './table.module.css?raw'

const ACK: AckOrError = { t: 'ACK', reqId: 'x' }
const REFUSED: AckOrError = { t: 'ERROR', code: 'CHAOS_CANNOT_USE', message: 'FROZEN', reqId: 'x' }

const HAND: ChaosBonusPayload = {
  cards: [
    { uid: 901, cardId: 's_steal_one', tier: 'silver', handsLeft: null },
    { uid: 902, cardId: 'g_redeal_board_1', tier: 'gold', handsLeft: null },
    { uid: 903, cardId: 'd_insure_2', tier: 'diamond', handsLeft: 2 },
  ],
  armed: null,
}

const mount = (patch: Partial<BonusHandProps> = {}, lang: 'vi' | 'en' = 'vi') => {
  const onUse = vi.fn<BonusHandProps['onUse']>().mockResolvedValue(ACK)
  const props: BonusHandProps = { bonus: HAND, canUse: true, onUse, layout: 'desktop', ...patch }
  const view = render(
    <I18nextProvider i18n={createI18n({ language: lang, storage: null })}>
      <BonusHand {...props} />
    </I18nextProvider>,
  )
  return { ...view, onUse: props.onUse as typeof onUse }
}

const hand = () => screen.getByRole('group', { name: 'Thẻ thưởng' })
const cards = () => within(hand()).getAllByRole('button')
/** A tap as Chrome on a phone delivers it (see `ChaosCardInfo.test.tsx`). */
const tap = (el: HTMLElement) => {
  fireEvent.pointerDown(el, { pointerType: 'touch' })
  fireEvent.pointerUp(el, { pointerType: 'touch' })
  if (document.activeElement !== el) act(() => el.focus())
  fireEvent.click(el, { detail: 1 })
}
const dungButton = () => screen.queryByRole('button', { name: 'Dùng' })
/** A card's popup: a dialog named by the card while it offers "Dùng", a tooltip when it only says the card is set (P2). */
const popup = () => screen.queryByRole('dialog') ?? screen.getByRole('tooltip')

afterEach(() => vi.useRealTimers())

describe('BonusHand', () => {
  it('draws each held card by its tier, named by its name, tier and hands left — under the title "Thẻ thưởng"', () => {
    mount()
    expect(hand()).toHaveTextContent('Thẻ thưởng')
    expect(cards()).toHaveLength(3)
    expect(cards().map((c) => c.getAttribute('aria-label'))).toEqual([
      'Rút lá lẻ (Bạc)',
      'Chia lại lá chung (Vàng)',
      'Bảo hiểm kim cương (Kim cương) · còn 2 ván',
    ])
    expect(cards().map((c) => c.querySelector('[data-tier]')?.getAttribute('data-tier'))).toEqual(['silver', 'gold', 'diamond'])
  })

  it('draws nothing while the hand is empty and nothing is pressed', () => {
    mount({ bonus: { cards: [], armed: null } })
    expect(screen.queryByRole('group', { name: 'Thẻ thưởng' })).toBeNull()
  })

  it('opens a card’s description on a tap, and only "Dùng" — the second step — plays it', async () => {
    const { onUse } = mount()
    tap(cards()[1]!)
    expect(screen.getByRole('dialog', { name: 'Chia lại lá chung' })).toHaveTextContent('Chia lại lá chung')
    expect(onUse).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(dungButton()!, { detail: 1 })
    })
    expect(onUse).toHaveBeenCalledTimes(1)
    expect(onUse).toHaveBeenCalledWith(902)
    expect(screen.queryByRole('dialog'), 'the popup closes with the press').toBeNull()
  })

  it('sends one request however fast the next press comes, until the answer is in', async () => {
    let answer: (r: AckOrError) => void = () => {}
    const onUse = vi.fn<BonusHandProps['onUse']>(() => new Promise((resolve) => (answer = resolve)))
    mount({ onUse })
    tap(cards()[0]!)
    fireEvent.click(dungButton()!, { detail: 1 })
    tap(cards()[2]!)
    expect(dungButton(), 'greyed while the first is out').toBeDisabled()
    fireEvent.click(dungButton()!, { detail: 1 })
    expect(onUse).toHaveBeenCalledTimes(1)
    await act(async () => answer(ACK))
  })

  it('marks the pressed card "Đã đặt dùng" with the hand it applies to — this one or the next (M3) — and greys the others’ "Dùng"', () => {
    for (const [when, words] of [['this', 'Đã đặt dùng · ván này'], ['next', 'Đã đặt dùng · ván sau']] as const) {
      const { unmount } = mount({ bonus: { cards: [HAND.cards[0]!, HAND.cards[2]!], armed: { uid: 902, cardId: 'g_redeal_board_1', hand: when } } })
      expect(cards()).toHaveLength(3)
      const armed = cards()[0]!
      expect(armed).toHaveAccessibleName(`Chia lại lá chung (Vàng) · ${words}`)
      expect(armed).toHaveTextContent(words)
      expect(armed.querySelector('[data-armed="true"]')).not.toBeNull()
      tap(armed)
      expect(screen.getByRole('tooltip')).toHaveTextContent(words)
      expect(dungButton()).toBeNull()
      tap(cards()[1]!)
      expect(dungButton()).toBeDisabled()
      unmount()
    }
  })

  it('keeps every card readable but greys "Dùng" outside the window (canUse false)', () => {
    const { onUse } = mount({ canUse: false })
    tap(cards()[0]!)
    expect(popup()).toHaveTextContent('Rút lá lẻ')
    expect(dungButton()).toBeDisabled()
    fireEvent.click(dungButton()!)
    expect(onUse).not.toHaveBeenCalled()
  })

  it('shows the hand when only the pressed card is left', () => {
    mount({ bonus: { cards: [], armed: { uid: 903, cardId: 'd_insure_2', hand: 'next' } } })
    expect(cards()).toHaveLength(1)
    expect(cards()[0]).toHaveAccessibleName('Bảo hiểm kim cương (Kim cương) · Đã đặt dùng · ván sau')
  })

  it('writes a refusal in the hand itself for a few seconds (A14), then lets the card be pressed again', async () => {
    vi.useFakeTimers()
    const onUse = vi.fn<BonusHandProps['onUse']>().mockResolvedValue(REFUSED)
    mount({ onUse })
    tap(cards()[0]!)
    await act(async () => {
      fireEvent.click(dungButton()!, { detail: 1 })
    })
    const alert = within(hand()).getByRole('alert')
    expect(alert).toHaveTextContent('Chưa dùng được thẻ này lúc này')
    act(() => void vi.advanceTimersByTime(BONUS_ERROR_MS))
    expect(within(hand()).queryByRole('alert')).toBeNull()
    tap(cards()[0]!)
    expect(dungButton()).toBeEnabled()
  })

  it('says the same when the request itself fails (the socket closed under it)', async () => {
    const onUse = vi.fn<BonusHandProps['onUse']>().mockRejectedValue(new Error('not connected'))
    mount({ onUse })
    tap(cards()[0]!)
    await act(async () => {
      fireEvent.click(dungButton()!, { detail: 1 })
    })
    expect(within(hand()).getByRole('alert')).toHaveTextContent('Chưa dùng được thẻ này lúc này')
  })

  it('speaks English', () => {
    mount({ bonus: { cards: [HAND.cards[0]!], armed: { uid: 902, cardId: 'g_redeal_board_1', hand: 'this' } } }, 'en')
    const group = screen.getByRole('group', { name: 'Bonus cards' })
    expect(group).toHaveTextContent('Set to play · this hand')
    tap(within(group).getAllByRole('button')[1]!)
    expect(screen.getByRole('button', { name: 'Use' }), 'one is set already').toBeDisabled()
  })

  it('stamps where the room lays it, for its CSS', () => {
    for (const layout of ['stack', 'landscape', 'desktop'] as const) {
      const { unmount } = mount({ layout })
      expect(hand()).toHaveAttribute('data-layout', layout)
      expect(hand()).toHaveAttribute('data-surface', 'night')
      unmount()
    }
  })

  it('sits sideways in the left corner over "Tự động chơi", clear of the result strip that starts 7.5rem in', () => {
    const rule = /\.bonusHand\[data-layout='landscape'\]\s*\{([^}]*)\}/.exec(TABLE_CSS)?.[1] ?? ''
    expect(rule).toMatch(/position:\s*absolute/)
    expect(rule).toMatch(/left:\s*max\(var\(--space-3\)/)
    expect(rule).toMatch(/max-width:\s*7\.5rem/)
  })

  it('drops its refusal’s rise under reduced motion', () => {
    expect(TABLE_CSS).toMatch(/\.bonusError\s*\{[^}]*animation:\s*riseUp/)
    const off = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(TABLE_CSS)?.[1] ?? ''
    expect(off).toMatch(/\.bonusError\b/)
  })
})
