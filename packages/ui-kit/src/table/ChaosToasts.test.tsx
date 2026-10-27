import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppliedChaosView } from '../client/types.js'
import { createI18n } from '../i18n/index.js'
import { ChaosToasts, NARROW_LANDSCAPE_QUERY, TOAST_MS, type ChaosToastsProps } from './ChaosToasts.js'
import TABLE_CSS from './table.module.css?raw'
import s from './table.module.css'

const applied = (seat: number, cardId: string, patch: Partial<AppliedChaosView> = {}): AppliedChaosView => ({
  seat,
  cardId,
  effect: 'swapLowest',
  targets: [],
  outcome: 'applied',
  ...patch,
})

const NAMES = ['Ann', 'Bảo', 'Chi', 'Dũng', 'Em', 'Phúc']
const nameOf = (seat: number): string => NAMES[seat] ?? String(seat)
const FIVE = [applied(0, 's_swap_one'), applied(1, 's_shield'), applied(2, 's_peek_1'), applied(3, 'g_swap_all'), applied(4, 'd_mirror')]

type Props = Partial<ChaosToastsProps>
const base = (p: Props): ChaosToastsProps => ({ applied: [], handId: 'h1', restored: false, nameOf, layout: 'stack', reverseNote: null, resultOpen: false, ...p })

const mount = (props: Props) => {
  const i18n = createI18n({ language: 'vi', storage: null })
  const at = (p: Props) => (
    <I18nextProvider i18n={i18n}>
      <ChaosToasts {...base(p)} />
    </I18nextProvider>
  )
  const view = render(at(props))
  return { ...view, again: (p: Props) => view.rerender(at(p)) }
}

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms))
/** The card toasts on screen, in order (the note and "+N" are not cards). */
const cards = (): Element[] => [...document.querySelectorAll('[data-chaos-toast][data-outcome]')]
const texts = (): string[] => cards().map((el) => el.textContent ?? '')
const more = (): HTMLElement | null => screen.queryByRole('button', { name: /thẻ khác/ })

describe('ChaosToasts', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('is an empty live region until a card fires, and says so to the layout', () => {
    mount({})
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(document.querySelector('[data-chaos-toasts]')).toHaveAttribute('data-empty', 'true')
  })

  it('shows three toasts and "+2 thẻ khác" for five cards on a phone held upright', () => {
    mount({ applied: FIVE })
    expect(texts()).toEqual(['Ann dùng Đổi lá', 'Bảo dùng Khiên gỗ', 'Chi dùng Nhìn trộm'])
    expect(more()).toHaveTextContent('+2 thẻ khác')
    expect(document.querySelector('[data-chaos-toasts]')).not.toHaveAttribute('data-empty')
  })

  it('shows two side by side and "+3 thẻ khác" on a phone on its side, three again on a desktop', () => {
    const { unmount } = mount({ applied: FIVE, layout: 'landscape' })
    expect(cards()).toHaveLength(2)
    expect(more()).toHaveTextContent('+3 thẻ khác')
    unmount()
    mount({ applied: FIVE, layout: 'desktop' })
    expect(cards()).toHaveLength(3)
    expect(more()).toHaveTextContent('+2 thẻ khác')
  })

  it('shows one toast on a narrow phone on its side (667 × 375), where two would run to four lines', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: query === NARROW_LANDSCAPE_QUERY, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    })
    const { unmount } = mount({ applied: FIVE, layout: 'landscape' })
    expect(cards()).toHaveLength(1)
    expect(more()).toHaveTextContent('+4 thẻ khác')
    unmount()
    mount({ applied: FIVE, layout: 'stack' })
    expect(cards(), 'the query is for the landscape band alone').toHaveLength(3)
  })

  it('names the targets after an arrow, and what stopped a card that did not land', () => {
    mount({ applied: [applied(0, 's_steal_one', { targets: [1, 2], outcome: 'blocked' })] })
    const [toast] = cards()
    expect(toast).toHaveTextContent('Ann dùng Rút lá lẻ → Bảo, Chi')
    expect(within(toast as HTMLElement).getByText('Bị chặn')).toBeInTheDocument()
    expect(toast).toHaveAttribute('data-tier', 'silver')
  })

  it('lets every toast of a batch leave together, TOAST_MS after it came', () => {
    mount({ applied: FIVE })
    advance(TOAST_MS - 1)
    expect(cards()).toHaveLength(3)
    expect(more()).not.toBeNull()
    advance(1)
    expect(cards()).toHaveLength(0)
    expect(more()).toBeNull()
  })

  it('counts a later card’s time from its own arrival, and gives it a place that has come free', () => {
    const one = applied(0, 's_swap_one')
    const two = applied(1, 's_shield')
    const { again } = mount({ applied: [one] })
    advance(3_000)
    again({ applied: [one, two] })
    expect(texts()).toEqual(['Ann dùng Đổi lá', 'Bảo dùng Khiên gỗ'])
    advance(1_000)
    expect(texts()).toEqual(['Bảo dùng Khiên gỗ'])
    advance(3_000)
    expect(cards()).toHaveLength(0)
  })

  it('keeps a toast a tap pinned until a second tap, and lets it go at once then if its time is up', () => {
    mount({ applied: [applied(0, 's_swap_one'), applied(1, 's_shield')] })
    fireEvent.click(cards()[0]!)
    expect(cards()[0]).toHaveAttribute('data-pinned', 'true')
    advance(TOAST_MS)
    expect(texts()).toEqual(['Ann dùng Đổi lá'])
    advance(60_000)
    expect(texts()).toEqual(['Ann dùng Đổi lá'])
    fireEvent.click(cards()[0]!)
    expect(cards()).toHaveLength(0)
  })

  it('opens the card’s popup from its name, without pinning the toast', () => {
    mount({ applied: [applied(0, 's_steal_one', { targets: [1], outcome: 'blocked' })] })
    fireEvent.click(screen.getByRole('button', { name: /Rút lá lẻ/ }))
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent('Người dùng: Ann')
    expect(tip).toHaveTextContent('Nhắm vào: Bảo')
    expect(cards()[0]).not.toHaveAttribute('data-pinned')
  })

  it('unpins everything for the next hand, and starts afresh there', () => {
    const { again } = mount({ applied: [applied(0, 's_swap_one')] })
    fireEvent.click(cards()[0]!)
    again({ applied: [], handId: 'h2' })
    expect(cards()).toHaveLength(0)
    again({ applied: [applied(1, 's_shield')], handId: 'h2' })
    expect(texts()).toEqual(['Bảo dùng Khiên gỗ'])
    expect(cards()[0]).not.toHaveAttribute('data-pinned')
  })

  it('opens the hand’s whole list from "+N", and closes it on a second tap or a press outside', () => {
    mount({ applied: FIVE })
    fireEvent.click(more()!)
    const list = screen.getByRole('list', { name: 'Các thẻ đã dùng ván này' })
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Ann dùng Đổi lá',
      'Bảo dùng Khiên gỗ',
      'Chi dùng Nhìn trộm',
      'Dũng dùng Đổi bài',
      'Em dùng Gương phản chiếu',
    ])
    expect(more()).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(more()!)
    expect(screen.queryByRole('list')).toBeNull()
    fireEvent.click(more()!)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('keeps "+N" while its list is open past its time, and lets it go when the list closes', () => {
    mount({ applied: FIVE })
    fireEvent.click(more()!)
    advance(TOAST_MS)
    expect(cards()).toHaveLength(0)
    expect(screen.getByRole('list')).toBeInTheDocument()
    fireEvent.click(more()!)
    expect(more()).toBeNull()
  })

  it('puts a card that comes while the result is open straight under "+N": the band never grows then', () => {
    const one = applied(0, 's_swap_one')
    const { again } = mount({ applied: [one], resultOpen: true })
    expect(cards(), 'a batch that opens the result still gets its toasts').toHaveLength(1)
    again({ applied: [one, applied(1, 's_shield')], resultOpen: true })
    expect(texts()).toEqual(['Ann dùng Đổi lá'])
    expect(more()).toHaveTextContent('+1 thẻ khác')
  })

  it('puts a card behind one waiting under "+N", never in a place ahead of it', () => {
    const { again } = mount({ applied: FIVE })
    again({ applied: [...FIVE, applied(5, 's_shield')] })
    expect(cards()).toHaveLength(3)
    expect(more()).toHaveTextContent('+3 thẻ khác')
  })

  it('pins "Thế giới đảo ngược" first for the hand, in one of the band’s places', () => {
    mount({ applied: FIVE, reverseNote: 'Thế giới đảo ngược: bộ yếu nhất thắng' })
    const first = document.querySelector('[data-chaos-toast]')!
    expect(first).toHaveAttribute('data-chaos-note')
    expect(first).toHaveAttribute('data-pinned', 'true')
    expect(cards()).toHaveLength(2)
    expect(more()).toHaveTextContent('+3 thẻ khác')
    advance(TOAST_MS)
    expect(screen.getByText('Thế giới đảo ngược: bộ yếu nhất thắng')).toBeInTheDocument()
  })

  it('replays nothing for a hand rebuilt from a snapshot, and shows what comes after', () => {
    const { again } = mount({ applied: FIVE, restored: true })
    expect(cards()).toHaveLength(0)
    expect(more()).toBeNull()
    again({ applied: [...FIVE, applied(5, 's_shield')], restored: true })
    expect(texts()).toEqual(['Phúc dùng Khiên gỗ'])
  })

  it('slides each toast in, and under reduced motion shows it in place with no animation class', () => {
    const { unmount } = mount({ applied: [applied(0, 's_swap_one')] })
    expect(cards()[0]).toHaveClass(s.chaosToastIn!)
    unmount()
    // jsdom has no `matchMedia`; this one answers the reduced-motion query and nothing else.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: query.includes('prefers-reduced-motion'), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    })
    mount({ applied: FIVE })
    for (const el of document.querySelectorAll('[data-chaos-toast]')) expect(el).not.toHaveClass(s.chaosToastIn!)
  })

  it('frames each toast in its card’s tier', () => {
    mount({ applied: [applied(0, 'd_mirror'), applied(1, 'g_swap_all')] })
    expect(cards().map((el) => el.getAttribute('data-tier'))).toEqual(['diamond', 'gold'])
  })
})

describe('the toast band in the stylesheet', () => {
  const css = TABLE_CSS.replace(/\r\n/g, '\n')
  /** The declarations of the rule whose selector is exactly `selector`, at the start of a line. */
  const rule = (selector: string): string => new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? ''

  it('takes no room when empty on a phone held upright: the negative margin gives the column’s gap back', () => {
    expect(rule(".chaosToastBand[data-layout='stack'][data-empty]")).toMatch(/margin-top:\s*calc\(-1 \* var\(--space-3\)\)/)
  })

  it('hangs on a desktop under the result overlay (z-index 1 < 2), so a toast is never drawn over the card', () => {
    expect(rule('.chaosToastBand')).toMatch(/z-index:\s*1/)
    expect(rule(".chaosToastBand[data-layout='desktop']")).toMatch(/height:\s*0/)
  })

  it('lays the toasts in one row on a phone on its side, out of the stage', () => {
    expect(rule(".chaosToastBand[data-layout='landscape']")).toMatch(/position:\s*absolute/)
    expect(rule(".chaosToastBand[data-layout='landscape'] .chaosToasts")).toMatch(/flex-direction:\s*row/)
  })

  it('wraps a toast rather than cutting it with "…"', () => {
    expect(rule('.chaosToast')).toMatch(/overflow-wrap:\s*anywhere/)
    expect(rule('.chaosToast')).not.toMatch(/ellipsis|nowrap/)
  })

  it('lists the toast’s entrance under reduced motion', () => {
    const off = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(off).toMatch(/\.chaosToastIn\b/)
  })
})
