import { act, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppliedChaosView } from '../client/types.js'
import { createI18n } from '../i18n/index.js'
import { BANNER_MS, ChaosBanner, useChaosBanner } from './ChaosBanner.js'
import s from './table.module.css'

const applied = (seat: number, cardId: string, patch: Partial<AppliedChaosView> = {}): AppliedChaosView => ({
  seat,
  cardId,
  effect: 'swapLowest',
  targets: [],
  outcome: 'applied',
  ...patch,
})

const NAMES = ['Ann', 'Bảo', 'Chi']
const nameOf = (seat: number): string => NAMES[seat] ?? String(seat)

/** The hook and the banner as `RoomScreen` wires them. */
function Harness({ list, handId = 'h1', skip = false }: { list: AppliedChaosView[]; handId?: string; skip?: boolean }) {
  const { item, index } = useChaosBanner(list, handId, skip)
  return <ChaosBanner item={item} index={index} nameOf={nameOf} />
}

const mount = (props: Parameters<typeof Harness>[0]) => {
  const i18n = createI18n({ language: 'vi', storage: null })
  const at = (p: Parameters<typeof Harness>[0]) => (
    <I18nextProvider i18n={i18n}>
      <Harness {...p} />
    </I18nextProvider>
  )
  const view = render(at(props))
  return { ...view, again: (p: Parameters<typeof Harness>[0]) => view.rerender(at(p)) }
}

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

describe('ChaosBanner', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('is an empty live region until a card fires', () => {
    mount({ list: [] })
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('shows the cards that fired one at a time, in the order they came, about 900 ms each', () => {
    mount({ list: [applied(0, 's_swap_one'), applied(1, 's_shield'), applied(2, 's_peek_1')] })
    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('Ann dùng Đổi lá')
    advance(BANNER_MS - 1)
    expect(region).toHaveTextContent('Ann dùng Đổi lá')
    advance(1)
    expect(region).toHaveTextContent('Bảo dùng Khiên')
    advance(BANNER_MS)
    expect(region).toHaveTextContent('Chi dùng Nhìn trộm')
    advance(BANNER_MS)
    expect(region).toBeEmptyDOMElement()
  })

  it('names the target of a card laid on someone, and what stopped a card that did not land', () => {
    mount({ list: [applied(0, 's_steal_one', { targets: [1, 2], outcome: 'blocked' })] })
    expect(screen.getByRole('status')).toHaveTextContent('Ann dùng Rút lá lẻ lên Bảo, Chi')
    expect(screen.getByRole('status')).toHaveTextContent('Bị chặn')
  })

  it('picks up cards that arrive while the queue is running, and never repeats one', () => {
    const first = applied(0, 's_swap_one')
    const second = applied(1, 's_shield')
    const { again } = mount({ list: [first] })
    advance(BANNER_MS)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    again({ list: [first, second] })
    expect(screen.getByRole('status')).toHaveTextContent('Bảo dùng Khiên')
    advance(BANNER_MS)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('starts the queue over for the next hand', () => {
    const one = applied(0, 's_swap_one')
    const { again } = mount({ list: [one] })
    advance(BANNER_MS)
    again({ list: [], handId: 'h2' })
    again({ list: [one], handId: 'h2' })
    expect(screen.getByRole('status')).toHaveTextContent('Ann dùng Đổi lá')
  })

  it('does not replay the last hand’s cards for a hand rebuilt from a snapshot', () => {
    mount({ list: [applied(0, 's_swap_one'), applied(1, 's_shield')], skip: true })
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('slides each card in, and under reduced motion shows it in place with no animation class', () => {
    const { unmount } = mount({ list: [applied(0, 's_swap_one')] })
    expect(document.querySelector('[data-outcome]')).toHaveClass(s.chaosBannerIn!)
    unmount()
    // jsdom has no `matchMedia`; this one answers the reduced-motion query and nothing else.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: query.includes('prefers-reduced-motion'), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    })
    mount({ list: [applied(0, 's_swap_one'), applied(1, 's_shield')] })
    const line = document.querySelector('[data-outcome]')!
    expect(line).not.toHaveClass(s.chaosBannerIn!)
    expect(line.getAttribute('class')).toBe(s.chaosBanner)
    expect(screen.getByRole('status')).toHaveTextContent('Ann dùng Đổi lá')
    advance(BANNER_MS)
    expect(screen.getByRole('status')).toHaveTextContent('Bảo dùng Khiên')
  })

  it('frames each card in its tier', () => {
    mount({ list: [applied(0, 'd_mirror')] })
    expect(document.querySelector('[data-outcome]')).toHaveAttribute('data-tier', 'diamond')
  })
})
