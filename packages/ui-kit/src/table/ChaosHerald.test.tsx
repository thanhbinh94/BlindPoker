import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientHerald } from '../client/types.js'
import { createI18n, type Language } from '../i18n/index.js'
import { DICE_MS, DICE_ROLL_MS } from './ChaosDice.js'
import { ChaosHerald, HERALD_MS, type HeraldHold } from './ChaosHerald.js'
import { FRESH_MS } from './entrance-schedule.js'
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

  it('a 6-6-6 roll’s banner waits for the dice to land, says the jackpot, and leaves with the dice panel (Ruling 20b)', () => {
    draw([herald({ kind: 'dice', dice: [6, 6, 6], amount: 60_000 })])
    expect(band()).toBeNull()
    act(() => void vi.advanceTimersByTime(DICE_ROLL_MS - 100))
    expect(band()).toBeNull()
    act(() => void vi.advanceTimersByTime(120))
    expect(screen.getByText('Xúc xắc 6-6-6! Lan nổ hũ 60.000!')).toBeInTheDocument()
    // Up to the panel's 3 s, never past them: the result's "Người thắng" is covered no longer than spec §4.5's 3 s.
    act(() => void vi.advanceTimersByTime(DICE_MS - DICE_ROLL_MS - 120))
    expect(band()).not.toBeNull()
    act(() => void vi.advanceTimersByTime(140))
    expect(band()).toBeNull()
  })

  it('the fall of a Thần waits for the result’s reveal hold to end, then shows its full 3 s (Ruling 21)', () => {
    const at = (held: boolean, heralds: ClientHerald[]) => (
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <ChaosHerald heralds={heralds} lang="vi" held={held} />
      </I18nextProvider>
    )
    // The showdown turns the cards over: the hold starts with the settlement, and the herald comes just after it.
    const { rerender } = render(at(true, []))
    act(() => void vi.advanceTimersByTime(50))
    const slain = herald({ id: 1, kind: 'godslain', name: 'Châu', at: Date.now() })
    rerender(at(true, [slain]))
    expect(band()).toBeNull()
    act(() => void vi.advanceTimersByTime(1_200))
    expect(band()).toBeNull()
    // The hold ends: the band shows from now, for its whole 3 s.
    rerender(at(false, [slain]))
    expect(screen.getByText('Châu đã đánh bại Thần Bài!')).toBeInTheDocument()
    act(() => void vi.advanceTimersByTime(HERALD_MS - 100))
    expect(band()).not.toBeNull()
    act(() => void vi.advanceTimersByTime(200))
    expect(band()).toBeNull()
  })

  it('a reign herald and a fall with no hold show at once; the dice herald ignores the hold', () => {
    draw([herald({ id: 1, kind: 'godslain', name: 'Châu' })])
    expect(screen.getByText('Châu đã đánh bại Thần Bài!')).toBeInTheDocument()
    cleanup()
    render(
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <ChaosHerald heralds={[herald({ id: 2, kind: 'god' })]} lang="vi" held />
      </I18nextProvider>,
    )
    expect(screen.getByText(/trở thành Thần Bài!/)).toBeInTheDocument()
  })

  describe('onShow (BP-42: the stinger’s cue)', () => {
    const at = (heralds: ClientHerald[], onShow: (h: ClientHerald) => void, extra: { hold?: HeraldHold | null } = {}) => (
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <ChaosHerald heralds={heralds} lang="vi" onShow={onShow} {...extra} />
      </I18nextProvider>
    )

    it('is called once for a fresh herald, however often the band renders', () => {
      const onShow = vi.fn()
      const fresh = herald()
      const { rerender } = render(at([fresh], onShow))
      act(() => void vi.advanceTimersByTime(500))
      rerender(at([fresh], onShow))
      rerender(at([fresh, herald({ id: 2, kind: 'demigod', at: T0 - HERALD_MS - 10 })], onShow))
      expect(onShow).toHaveBeenCalledTimes(1)
      expect(onShow).toHaveBeenCalledWith(fresh)
    })

    it('is never called for a herald older than FRESH_MS when it first shows (a snapshot, a remount)', () => {
      const onShow = vi.fn()
      render(at([herald({ at: T0 - FRESH_MS - 1 })], onShow))
      expect(band()).not.toBeNull()
      act(() => void vi.advanceTimersByTime(500))
      expect(onShow).not.toHaveBeenCalled()
    })

    it('a 6-6-6 herald is announced when the dice land, the start of its window', () => {
      const onShow = vi.fn()
      render(at([herald({ kind: 'dice', dice: [6, 6, 6], amount: 60_000 })], onShow))
      expect(onShow).not.toHaveBeenCalled()
      act(() => void vi.advanceTimersByTime(DICE_ROLL_MS + 20))
      expect(onShow).toHaveBeenCalledTimes(1)
    })

    it('a fall that waited out the hold is fresh when the hold ends, from the room’s hold (A7)', () => {
      const onShow = vi.fn()
      const slain = herald({ kind: 'godslain', name: 'Châu', at: T0 + 100 })
      act(() => void vi.advanceTimersByTime(100))
      const { rerender } = render(at([slain], onShow, { hold: { since: T0, until: null } }))
      expect(band()).toBeNull()
      act(() => void vi.advanceTimersByTime(2_000))
      rerender(at([slain], onShow, { hold: { since: T0, until: Date.now() } }))
      expect(screen.getByText('Châu đã đánh bại Thần Bài!')).toBeInTheDocument()
      expect(onShow).toHaveBeenCalledTimes(1)
    })
  })

  it('the room’s hold replaces its own: a fall waits for it though `held` is never passed (A7)', () => {
    const slain = herald({ kind: 'godslain', name: 'Châu' })
    const view = (hold: HeraldHold | null) => (
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <ChaosHerald heralds={[slain]} lang="vi" hold={hold} />
      </I18nextProvider>
    )
    const { rerender } = render(view({ since: T0 - 10, until: null }))
    expect(band()).toBeNull()
    act(() => void vi.advanceTimersByTime(500))
    rerender(view({ since: T0 - 10, until: Date.now() }))
    expect(band()).not.toBeNull()
    act(() => void vi.advanceTimersByTime(HERALD_MS - 100))
    expect(band()).not.toBeNull()
    act(() => void vi.advanceTimersByTime(200))
    expect(band()).toBeNull()
  })

  it('glows and shakes, and under reduced motion only shows its words (no motion class; the CSS stops it too)', () => {
    draw([herald()])
    expect(band()).toHaveClass(s.heraldMotion!)
    cleanup()
    motion(true)
    draw([herald({ kind: 'dice', dice: [6, 6, 6], amount: 60_000 })])
    // The same window as with motion (Ruling 20b): from the landing to the panel's 3 s; only the tumble is dropped.
    expect(band()).toBeNull()
    act(() => void vi.advanceTimersByTime(DICE_ROLL_MS + 20))
    expect(band()).not.toHaveClass(s.heraldMotion!)
    expect(screen.getByText(/nổ hũ 60.000/)).toBeInTheDocument()
    const off = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? ''
    expect(off).toContain('.heraldMotion')
    expect(off).toContain('.seatGod .plate::after')
  })
})
