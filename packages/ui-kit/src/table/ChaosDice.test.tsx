import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientDiceRoll } from '../client/types.js'
import { createI18n } from '../i18n/index.js'
import { ChaosDice, DICE_MS, DICE_ROLL_MS } from './ChaosDice.js'
import CSS from './table.module.css?raw'
import s from './table.module.css'

const T0 = 2_000_000

const roll = (patch: Partial<ClientDiceRoll> = {}): ClientDiceRoll => ({
  id: 1, seat: 1, name: 'Bình', cardId: 'd_dice', dice: [6, 6, 6], result: { jackpot: 60_000, cards: [{ tier: 'diamond', count: 2 }], triple: true, herald: true }, at: T0, ...patch,
})

const draw = (rolls: ClientDiceRoll[]) =>
  render(
    <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
      <ChaosDice rolls={rolls} lang="vi" />
    </I18nextProvider>,
  )

function motion(reduce: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: reduce && query.includes('prefers-reduced-motion'), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  })
}

const panel = (): HTMLElement | null => screen.queryByRole('region', { name: 'Xúc xắc vận may' })

describe('ChaosDice (BP-41 §5)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 })
    motion(false)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('tumbles the dice for about 1.5 s for the whole table, then shows the faces and what they gave', () => {
    draw([roll()])
    expect(panel()).toHaveTextContent('Bình')
    expect(screen.getByRole('img', { name: 'Đang gieo…' })).toBeInTheDocument()
    expect(document.querySelectorAll(`.${s.dieTumble}`)).toHaveLength(3)
    act(() => void vi.advanceTimersByTime(DICE_ROLL_MS + 20))
    expect(screen.getByRole('img', { name: 'Xúc xắc: 6-6-6' })).toBeInTheDocument()
    expect(document.querySelectorAll(`.${s.dieTumble}`)).toHaveLength(0)
    expect([...document.querySelectorAll('[data-face]')].map((d) => d.getAttribute('data-face'))).toEqual(['6', '6', '6'])
    expect(panel()).toHaveTextContent('Bộ ba! · Nổ hũ 60.000 · 2 thẻ Kim cương')
  })

  it('goes 3 s after it came, and a tap puts it away sooner', () => {
    draw([roll()])
    act(() => void vi.advanceTimersByTime(DICE_MS - 100))
    expect(panel()).not.toBeNull()
    act(() => void vi.advanceTimersByTime(200))
    expect(panel()).toBeNull()
    cleanup()
    draw([roll({ id: 2, at: Date.now() })])
    // The panel is a button (a tap, or Enter from the keyboard), inside the named region.
    const button = panel()!.querySelector('button')!
    expect(button).toHaveAttribute('type', 'button')
    fireEvent.click(button)
    expect(panel()).toBeNull()
  })

  it('says a losing roll and an empty one in words', () => {
    draw([roll({ id: 1, dice: [1, 1], cardId: 'g_dice', result: { burned: 2_000 } }), roll({ id: 2, seat: 2, name: 'Châu', dice: [2], cardId: 's_dice', result: {} })])
    act(() => void vi.advanceTimersByTime(DICE_ROLL_MS + 20))
    expect(panel()).toHaveTextContent('Mất 2.000')
    expect(panel()).toHaveTextContent('Không trúng gì')
  })

  it('replays nothing: a roll from before it mounted shows only for what is left of its 3 s', () => {
    draw([roll({ at: T0 - DICE_MS })])
    expect(panel()).toBeNull()
  })

  it('under reduced motion the dice do not tumble: the result shows at once', () => {
    motion(true)
    draw([roll()])
    expect(document.querySelectorAll(`.${s.dieTumble}`)).toHaveLength(0)
    expect(screen.getByRole('img', { name: 'Xúc xắc: 6-6-6' })).toBeInTheDocument()
    expect(panel()).toHaveTextContent('Nổ hũ 60.000')
    const off = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? ''
    expect(off).toContain('.dieTumble')
  })
})
