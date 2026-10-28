import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientHerald } from '../client/types.js'
import { createI18n, type Language } from '../i18n/index.js'
import { DICE_ROLL_MS } from './ChaosDice.js'
import { ChaosHerald, HERALD_MS } from './ChaosHerald.js'
import CSS from './table.module.css?raw'
import s from './table.module.css'

const T0 = 1_000_000

const herald = (patch: Partial<ClientHerald> = {}): ClientHerald => ({ id: 1, kind: 'god', seat: 2, name: 'Lan', at: T0, ...patch })

const draw = (heralds: ClientHerald[], lang: Language = 'vi') =>
  render(
    <I18nextProvider i18n={createI18n({ language: lang, storage: null })}>
      <ChaosHerald heralds={heralds} lang={lang} />
    </I18nextProvider>,
  )

/** jsdom has no `matchMedia`; this one answers the reduced-motion query (when `reduce`) and nothing else. */
function motion(reduce: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: reduce && query.includes('prefers-reduced-motion'), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  })
}

const band = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-herald]')

describe('ChaosHerald (BP-41 §4.5)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 })
    motion(false)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('says each herald in the spec’s exact words', () => {
    draw([herald({ id: 1, kind: 'god' }), herald({ id: 2, kind: 'demigod', name: 'Bình' }), herald({ id: 3, kind: 'godslain', name: 'Châu' })])
    expect(screen.getByText('Cảnh báo: Lan đã tích luỹ đủ năng lượng và trở thành Thần Bài!')).toBeInTheDocument()
    expect(screen.getByText('Cảnh báo: Bình đã chiến thắng định mệnh và trở thành Bán Thần!')).toBeInTheDocument()
    expect(screen.getByText('Châu đã đánh bại Thần Bài!')).toBeInTheDocument()
  })

  it('speaks English too', () => {
    draw([herald()], 'en')
    expect(screen.getByText('Warning: Lan has gathered enough energy and become the Card God!')).toBeInTheDocument()
  })

  it('is a live region, and the band is one button across the screen that a tap puts away', () => {
    draw([herald()])
    expect(screen.getByRole('status', { name: 'Thông báo của bàn' })).toHaveAttribute('aria-live', 'assertive')
    fireEvent.click(screen.getByRole('button', { name: /Thần Bài/ }))
    expect(band()).toBeNull()
  })

  it('stays about 3 s, then goes by itself', () => {
    draw([herald()])
    act(() => void vi.advanceTimersByTime(HERALD_MS - 100))
    expect(band()).not.toBeNull()
    act(() => void vi.advanceTimersByTime(200))
    expect(band()).toBeNull()
  })

  it('replays nothing: a herald that came before it mounted shows only what is left of its time, and an old one not at all', () => {
    draw([herald({ id: 1, at: T0 - HERALD_MS - 1 }), herald({ id: 2, kind: 'demigod', at: T0 - 2_000 })])
    expect(screen.queryByText(/Thần Bài!/)).toBeNull()
    expect(screen.getByText(/Bán Thần!/)).toBeInTheDocument()
    act(() => void vi.advanceTimersByTime(1_100))
    expect(band()).toBeNull()
  })

  it('a dismissed herald stays down, and the next one shows', () => {
    const { rerender } = draw([herald()])
    fireEvent.click(screen.getByRole('button'))
    const next = herald({ id: 2, kind: 'godslain', name: 'Bình', at: T0 + 500 })
    act(() => void vi.advanceTimersByTime(500))
    rerender(
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <ChaosHerald heralds={[herald(), next]} lang="vi" />
      </I18nextProvider>,
    )
    expect(screen.queryByText(/năng lượng/)).toBeNull()
    expect(screen.getByText('Bình đã đánh bại Thần Bài!')).toBeInTheDocument()
  })

  it('a 6-6-6 roll’s banner waits for the dice to land, then says the jackpot', () => {
    draw([herald({ kind: 'dice', dice: [6, 6, 6], amount: 60_000 })])
    expect(band()).toBeNull()
    act(() => void vi.advanceTimersByTime(DICE_ROLL_MS + 20))
    expect(screen.getByText('Xúc xắc 6-6-6! Lan nổ hũ 60.000!')).toBeInTheDocument()
    act(() => void vi.advanceTimersByTime(HERALD_MS))
    expect(band()).toBeNull()
  })

  it('glows and shakes, and under reduced motion only shows its words (no motion class; the CSS stops it too)', () => {
    draw([herald()])
    expect(band()).toHaveClass(s.heraldMotion!)
    cleanup()
    motion(true)
    draw([herald({ kind: 'dice', dice: [6, 6, 6], amount: 60_000 })])
    // No roll to wait for either: the dice skip their tumble.
    expect(band()).not.toHaveClass(s.heraldMotion!)
    expect(screen.getByText(/nổ hũ 60.000/)).toBeInTheDocument()
    const off = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? ''
    expect(off).toContain('.heraldMotion')
    expect(off).toContain('.seatGod .plate::after')
  })
})
