import { act, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n/index.js'
import { ChaosCardInfo, INFO_MARGIN, placeChaosInfo, type ChaosCardInfoProps } from './ChaosCardInfo.js'
import TABLE_CSS from './table.module.css?raw'

const draw = (props: Omit<ChaosCardInfoProps, 'children'> & { children?: React.ReactNode }, lang: 'vi' | 'en' = 'vi') =>
  render(
    <I18nextProvider i18n={createI18n({ language: lang, storage: null })}>
      <p>
        <span data-testid="outside">outside</span>
      </p>
      <ChaosCardInfo {...(props as ChaosCardInfoProps)}>
        <span role="img" data-tier="gold" aria-label="icon">
          K
        </span>
      </ChaosCardInfo>
    </I18nextProvider>,
  )

const trigger = () => screen.getByRole('button')
/** The popup: a tooltip, or — holding a button — a non-modal dialog (P2). */
const tip = () => screen.queryByRole('tooltip') ?? screen.queryByRole('dialog')
/** A tap as Chrome on a phone delivers it: the button takes the focus after the finger lifts, then the click (`detail` 1). */
const tap = (el: HTMLElement) => {
  fireEvent.pointerDown(el, { pointerType: 'touch' })
  fireEvent.pointerUp(el, { pointerType: 'touch' })
  if (document.activeElement !== el) act(() => el.focus())
  fireEvent.click(el, { detail: 1 })
}

afterEach(() => vi.useRealTimers())

describe('ChaosCardInfo', () => {
  it('is a button named by the card, its tier and the hands left, around the icon it was given', () => {
    draw({ cardId: 'g_shield_3', handsLeft: 2 })
    expect(trigger()).toHaveAttribute('type', 'button')
    expect(trigger()).toHaveAccessibleName('Khiên sắt (Vàng) · còn 2 ván')
    expect(trigger().querySelector('[role="img"][data-tier="gold"]')).not.toBeNull()
    expect(tip()).toBeNull()
  })

  it('opens on a tap with the name, the tier, the whole description, when it acts and the hands left; a second tap closes it', () => {
    draw({ cardId: 'g_shield_3', handsLeft: 2 })
    tap(trigger())
    const box = tip()
    expect(box).not.toBeNull()
    expect(box).toHaveTextContent('Khiên sắt')
    expect(box).toHaveTextContent('Vàng')
    expect(box!.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'gold')
    expect(box).toHaveTextContent('Chờ điều kiện để áp · còn 2 ván')
    expect(trigger()).toHaveAttribute('aria-describedby', box!.id)
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    // Drawn on the page, not inside the seat that would clip it, on the felt's palette.
    expect(box!.parentElement).toBe(document.body)
    expect(box).toHaveAttribute('data-surface', 'night')
    tap(trigger())
    expect(tip()).toBeNull()
    expect(trigger()).not.toHaveAttribute('aria-describedby')
  })

  it('shows the full description from the copy, with no clamp', () => {
    const i18n = createI18n({ language: 'vi', storage: null })
    draw({ cardId: 's_steal_one' })
    tap(trigger())
    expect(tip()).toHaveTextContent(i18n.t('game:chaos.cards.s_steal_one.desc'))
    expect(tip()).toHaveTextContent('một lá riêng ngẫu nhiên')
    expect(tip()).toHaveTextContent('Áp lúc lật bài')
  })

  it('closes on a press outside it, but not on a press inside the popup', () => {
    draw({ cardId: 's_shield' })
    tap(trigger())
    fireEvent.pointerDown(tip()!)
    expect(tip()).not.toBeNull()
    fireEvent.pointerDown(screen.getByTestId('outside'))
    expect(tip()).toBeNull()
  })

  it('closes on Esc', () => {
    draw({ cardId: 's_shield' })
    tap(trigger())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(tip()).toBeNull()
  })

  it('opens while a mouse rests on it and closes a moment after it leaves; a click pins it', () => {
    vi.useFakeTimers()
    draw({ cardId: 's_shield' })
    fireEvent.pointerEnter(trigger(), { pointerType: 'mouse' })
    expect(tip()).not.toBeNull()
    fireEvent.pointerLeave(trigger(), { pointerType: 'mouse' })
    expect(tip()).not.toBeNull()
    act(() => void vi.advanceTimersByTime(200))
    expect(tip()).toBeNull()

    fireEvent.pointerEnter(trigger(), { pointerType: 'mouse' })
    fireEvent.pointerDown(trigger(), { pointerType: 'mouse' })
    fireEvent.pointerUp(trigger(), { pointerType: 'mouse' })
    fireEvent.click(trigger(), { detail: 1 })
    fireEvent.pointerLeave(trigger(), { pointerType: 'mouse' })
    act(() => void vi.advanceTimersByTime(200))
    expect(tip()).not.toBeNull()
  })

  it('keeps a hover popup open while the mouse crosses onto it', () => {
    vi.useFakeTimers()
    draw({ cardId: 's_shield' })
    fireEvent.pointerEnter(trigger(), { pointerType: 'mouse' })
    fireEvent.pointerLeave(trigger(), { pointerType: 'mouse' })
    fireEvent.pointerEnter(tip()!, { pointerType: 'mouse' })
    act(() => void vi.advanceTimersByTime(200))
    expect(tip()).not.toBeNull()
  })

  it('does not open on a touch pointer entering (a tap must not flash it open and shut)', () => {
    draw({ cardId: 's_shield' })
    fireEvent.pointerEnter(trigger(), { pointerType: 'touch' })
    expect(tip()).toBeNull()
    tap(trigger())
    expect(tip()).not.toBeNull()
  })

  it('opens on keyboard focus and closes when the focus leaves', () => {
    draw({ cardId: 's_shield' })
    fireEvent.focus(trigger())
    expect(tip()).not.toBeNull()
    fireEvent.blur(trigger())
    expect(tip()).toBeNull()
  })

  it('toggles on Enter or Space (a click with no detail) once the focus has opened it', () => {
    draw({ cardId: 's_shield' })
    act(() => trigger().focus())
    expect(tip()).not.toBeNull()
    fireEvent.click(trigger(), { detail: 0 })
    expect(tip()).toBeNull()
    fireEvent.click(trigger(), { detail: 0 })
    expect(tip()).not.toBeNull()
  })

  it('opens on a mouse click whose press brought the focus, and stays open', () => {
    draw({ cardId: 's_shield' })
    fireEvent.pointerDown(trigger(), { pointerType: 'mouse' })
    act(() => trigger().focus())
    expect(tip()).toBeNull()
    fireEvent.pointerUp(trigger(), { pointerType: 'mouse' })
    fireEvent.click(trigger(), { detail: 1 })
    expect(tip()).not.toBeNull()
  })

  it('closes when its trigger goes away', () => {
    const { unmount } = draw({ cardId: 's_shield' })
    tap(trigger())
    expect(tip()).not.toBeNull()
    unmount()
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('keeps one popup open on the page: opening another closes the first', () => {
    render(
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <ChaosCardInfo cardId="s_shield">
          <span>A</span>
        </ChaosCardInfo>
        <ChaosCardInfo cardId="d_mirror">
          <span>B</span>
        </ChaosCardInfo>
      </I18nextProvider>,
    )
    const [a, b] = screen.getAllByRole('button')
    tap(a!)
    act(() => {
      fireEvent.pointerEnter(b!, { pointerType: 'mouse' })
    })
    const tips = screen.getAllByRole('tooltip')
    expect(tips).toHaveLength(1)
    expect(tips[0]).toHaveTextContent('Gương phản chiếu')
  })

  it('says who played a card, on whom, and how it went', () => {
    draw({ cardId: 's_steal_one', use: { by: 'Phương Anh', targets: ['Minh', 'Lan'], outcome: 'blocked' } })
    tap(trigger())
    expect(tip()).toHaveTextContent('Người dùng: Phương Anh')
    expect(tip()).toHaveTextContent('Nhắm vào: Minh, Lan')
    expect(tip()).toHaveTextContent('Kết quả: Bị chặn')
  })

  it('leaves the target line out for a card on the player itself, and speaks English', () => {
    draw({ cardId: 's_luck_1', use: { by: 'Lan', targets: [], outcome: 'applied' } }, 'en')
    tap(trigger())
    expect(tip()).toHaveTextContent('Played by Lan')
    expect(tip()).not.toHaveTextContent('On ')
    expect(tip()).toHaveTextContent('Result: Applied')
    expect(tip()).toHaveTextContent('Acts at the deal')
  })

  it('describes several cards in one popup', () => {
    draw({ cards: [{ cardId: 'g_swap_all', handsLeft: 1 }, { cardId: 'd_mirror' }], label: 'Đổi bài, Gương phản chiếu' })
    expect(trigger()).toHaveAccessibleName('Đổi bài, Gương phản chiếu')
    tap(trigger())
    expect([...tip()!.querySelectorAll('[data-tier]')].map((e) => e.getAttribute('data-tier'))).toEqual(['gold', 'diamond'])
    expect(tip()).toHaveTextContent('Đổi bài')
    expect(tip()).toHaveTextContent('Gương phản chiếu')
  })

  describe('with a step to take (the bonus hand’s "Dùng", BP-39)', () => {
    const card = () => screen.getByRole('button', { name: /Khiên gỗ/ })
    const use = () => screen.getByRole('button', { name: 'Dùng' })

    it('is a non-modal dialog named by its card while it holds the button, its trigger saying so; read-only it stays a tooltip (P2)', () => {
      const { unmount } = draw({ cardId: 's_shield', action: { kind: 'button', label: 'Dùng', onPress: vi.fn() } })
      expect(card()).toHaveAttribute('aria-haspopup', 'dialog')
      expect(card()).toHaveAttribute('aria-expanded', 'false')
      tap(card())
      const dialog = screen.getByRole('dialog', { name: 'Khiên gỗ' })
      expect(dialog).not.toHaveAttribute('aria-modal', 'true')
      expect(dialog).toContainElement(use())
      expect(screen.queryByRole('tooltip')).toBeNull()
      expect(card()).toHaveAttribute('aria-expanded', 'true')
      expect(card()).toHaveAttribute('aria-controls', dialog.id)
      expect(card()).not.toHaveAttribute('aria-describedby')
      unmount()

      draw({ cardId: 's_shield', action: { kind: 'status', label: 'Đã đặt dùng · ván sau' } })
      expect(card()).not.toHaveAttribute('aria-haspopup')
      tap(card())
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(card()).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id)
    })

    it('offers the button under the description, in a separate step from the tap that opened it', () => {
      const onPress = vi.fn()
      draw({ cardId: 's_shield', action: { kind: 'button', label: 'Dùng', onPress } })
      expect(screen.queryByRole('button', { name: 'Dùng' }), 'not before the popup opens').toBeNull()
      tap(card())
      expect(tip()).toContainElement(use())
      expect(onPress, 'opening it plays nothing').not.toHaveBeenCalled()
    })

    it('calls the step exactly once on a press and closes, handing the focus back to the card without reopening', () => {
      const onPress = vi.fn()
      draw({ cardId: 's_shield', action: { kind: 'button', label: 'Dùng', onPress } })
      tap(card())
      const button = use()
      fireEvent.pointerDown(button, { pointerType: 'touch' })
      act(() => button.focus())
      fireEvent.pointerUp(button, { pointerType: 'touch' })
      fireEvent.click(button, { detail: 1 })
      fireEvent.click(button, { detail: 1 })
      expect(onPress).toHaveBeenCalledTimes(1)
      expect(tip()).toBeNull()
      expect(document.activeElement).toBe(card())
    })

    it('stays open when the trigger blurs towards the popup itself — Chrome’s press on its text or its button', () => {
      draw({ cardId: 's_shield', action: { kind: 'button', label: 'Dùng', onPress: vi.fn() } })
      tap(card())
      const box = tip()!
      expect(box).toHaveAttribute('tabindex', '-1')
      fireEvent.pointerDown(box.querySelector('p')!)
      fireEvent.blur(card(), { relatedTarget: box })
      expect(tip()).not.toBeNull()
      fireEvent.blur(card(), { relatedTarget: use() })
      expect(tip()).not.toBeNull()
      // …and a press on the popup's text, where Chrome moves the focus to the popup: nothing closes it either.
      act(() => box.focus())
      expect(tip()).not.toBeNull()
    })

    it('greys the button and calls nothing while the step is not open', () => {
      const onPress = vi.fn()
      draw({ cardId: 's_shield', action: { kind: 'button', label: 'Dùng', disabled: true, onPress } })
      tap(card())
      expect(tip()).toHaveTextContent('Khiên gỗ') // still readable
      expect(use()).toBeDisabled()
      fireEvent.click(use())
      expect(onPress).not.toHaveBeenCalled()
    })

    it('says a card is already set instead of offering the button', () => {
      draw({ cardId: 's_shield', action: { kind: 'status', label: 'Đã đặt dùng' } })
      tap(card())
      expect(tip()).toHaveTextContent('Đã đặt dùng')
      expect(screen.queryByRole('button', { name: 'Dùng' })).toBeNull()
    })

    it('lets the keyboard reach the button: Tab from the card steps into it, Tab out of it comes back and closes', () => {
      draw({ cardId: 's_shield', action: { kind: 'button', label: 'Dùng', onPress: vi.fn() } })
      act(() => card().focus())
      expect(tip()).not.toBeNull()
      fireEvent.keyDown(card(), { key: 'Tab' })
      expect(document.activeElement).toBe(use())
      fireEvent.blur(card(), { relatedTarget: use() })
      expect(tip()).not.toBeNull()
      fireEvent.keyDown(use(), { key: 'Tab' })
      expect(tip()).toBeNull()
      expect(document.activeElement).toBe(card())
    })

    it('closes on Esc from inside the popup and gives the focus back to the card', () => {
      draw({ cardId: 's_shield', action: { kind: 'button', label: 'Dùng', onPress: vi.fn() } })
      tap(card())
      act(() => use().focus())
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(tip()).toBeNull()
      expect(document.activeElement).toBe(card())
    })
  })

  it('drops its fade under reduced motion', () => {
    expect(TABLE_CSS).toMatch(/\.cardInfo\s*\{[^}]*animation:\s*cardInfoIn/)
    const off = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(TABLE_CSS)?.[1] ?? ''
    expect(off).toMatch(/\.cardInfo\b[^{]*\{\s*animation:\s*none/)
  })
})

describe('placeChaosInfo', () => {
  const size = { width: 280, height: 120 }

  it('sits centred above its trigger when it fits there', () => {
    const at = placeChaosInfo({ left: 500, top: 400, width: 20, bottom: 420 }, size, { width: 1920, height: 940 })
    expect(at).toEqual({ left: 370, top: 274, side: 'above' })
  })

  it('goes below a trigger near the top of the screen', () => {
    const at = placeChaosInfo({ left: 500, top: 30, width: 20, bottom: 50 }, size, { width: 1920, height: 940 })
    expect(at.side).toBe('below')
    expect(at.top).toBe(56)
  })

  it('never runs off either side at 360 px', () => {
    for (const x of [0, 4, 170, 330, 352]) {
      const at = placeChaosInfo({ left: x, top: 500, width: 18, bottom: 518 }, size, { width: 360, height: 780 })
      expect(at.left).toBeGreaterThanOrEqual(INFO_MARGIN)
      expect(at.left + size.width).toBeLessThanOrEqual(360 - INFO_MARGIN)
    }
  })

  it('stays inside a phone held sideways (780×360) even when neither side has the room', () => {
    const tall = { width: 280, height: 200 }
    const at = placeChaosInfo({ left: 400, top: 170, width: 18, bottom: 188 }, tall, { width: 780, height: 360 })
    expect(at.top).toBeGreaterThanOrEqual(INFO_MARGIN)
    expect(at.top + tall.height).toBeLessThanOrEqual(360 - INFO_MARGIN)
  })
})
