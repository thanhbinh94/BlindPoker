import type { EntranceTitle } from '@bp/core'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientDiceRoll, ClientEntrance, ClientHerald } from '../client/types.js'
import { createI18n, type Language } from '../i18n/index.js'
import TOKENS_CSS from '../theme/tokens.css?raw'
import { DICE_MS } from './chaos-detail.js'
import { HERALD_MS } from './ChaosHerald.js'
import { EntranceBand, useEntrances, type EntrancesNow } from './EntranceBand.js'
import { ENTRANCE_MS, ENTRANCE_STALE_MS, FRESH_MS } from './entrance-schedule.js'
import type { HeraldHold } from './useHeldWindow.js'
import CSS from './table.module.css?raw'
import s from './table.module.css'

const T0 = 1_000_000

const entrance = (patch: Partial<ClientEntrance> = {}): ClientEntrance => ({ id: 1, title: 'god', seat: 3, playerId: 'p3', name: 'Lan', at: T0, ...patch })

/** jsdom has no `matchMedia`; this one answers the reduced-motion query (when `reduce`) and nothing else. */
function motion(reduce: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: reduce && query.includes('prefers-reduced-motion'), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  })
}

const band = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-herald="entrance"]')

const withI18n = (ui: React.ReactElement, lang: Language = 'vi') => <I18nextProvider i18n={createI18n({ language: lang, storage: null })}>{ui}</I18nextProvider>

describe('EntranceBand (BP-42 spec §4)', () => {
  beforeEach(() => motion(false))
  afterEach(() => {
    cleanup()
    Reflect.deleteProperty(window, 'matchMedia')
  })

  const cases: [EntranceTitle, string, string][] = [
    ['god', 'Thần Bài Lan đã giáng lâm!', 'The Card God Lan has descended!'],
    ['demigod', 'Bán Thần Lan đã xuất hiện!', 'The Demigod Lan has appeared!'],
    ['godslayer', 'Kẻ Sát Thần Lan đã vào bàn — Thần Bài hãy cẩn thận!', 'The Godslayer Lan has taken a seat — beware, Card God!'],
  ]

  it.each(cases)('says the %s’s entrance in the plan’s exact words, with the name, in vi and en', (title, vi, en) => {
    render(withI18n(<EntranceBand entrance={entrance({ title })} onDismiss={() => {}} />))
    expect(screen.getByText(vi)).toBeInTheDocument()
    expect(band()).toHaveAttribute('data-title', title)
    cleanup()
    render(withI18n(<EntranceBand entrance={entrance({ title })} onDismiss={() => {}} />, 'en'))
    expect(screen.getByText(en)).toBeInTheDocument()
  })

  it('is a live region named for entrances, and a tap on the band dismisses it', () => {
    const onDismiss = vi.fn()
    render(withI18n(<EntranceBand entrance={entrance()} onDismiss={onDismiss} />))
    expect(screen.getByRole('status', { name: 'Màn ra mắt' })).toHaveAttribute('aria-live', 'assertive')
    fireEvent.click(screen.getByRole('button', { name: /giáng lâm/ }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('is the herald’s band in shape — and its lines carry no data-kind, which the BP-41 watcher reads (A17)', () => {
    render(withI18n(<EntranceBand entrance={entrance()} onDismiss={() => {}} />))
    expect(band()).toHaveClass(s.herald!, s.entrance!, s.heraldMotion!)
    expect(band()?.querySelector('[data-kind]')).toBeNull()
  })

  it('keeps its live region with nothing in it when no entrance shows', () => {
    render(withI18n(<EntranceBand entrance={null} onDismiss={() => {}} />))
    expect(screen.getByRole('status', { name: 'Màn ra mắt' })).toBeEmptyDOMElement()
  })

  it('under reduced motion only shows its words: no motion class', () => {
    motion(true)
    render(withI18n(<EntranceBand entrance={entrance({ title: 'godslayer' })} onDismiss={() => {}} />))
    expect(band()).not.toBeNull()
    expect(band()).not.toHaveClass(s.heraldMotion!)
  })
})

describe('the entrance band’s colours and the seat flash (CSS)', () => {
  const alphaOf = (token: string): number => {
    const value = new RegExp(`${token}:\\s*rgba\\(([^)]*)\\)`).exec(TOKENS_CSS)?.[1] ?? ''
    return Number(value.split(',')[3])
  }

  it('every title’s band is at least 0.9 opaque (A17: the overlap check looks through thinner ones)', () => {
    for (const t of ['chaos-god', 'entrance-demigod', 'entrance-slayer']) {
      for (const part of ['band', 'band-top', 'band-foot']) expect(alphaOf(`--${t}-${part}`)).toBeGreaterThanOrEqual(0.9)
    }
    expect(CSS).toMatch(/\.entrance\[data-title='demigod'\]\s*\{[^}]*background-color:\s*var\(--entrance-demigod-band\)/)
    expect(CSS).toMatch(/\.entrance\[data-title='godslayer'\]\s*\{[^}]*background-color:\s*var\(--entrance-slayer-band\)/)
  })

  it('the flash is a pulse of its own layer, which motion off stops (static ring)', () => {
    expect(CSS).toMatch(/\.seat\[data-entrance\] \.plate::before\s*\{[^}]*animation:\s*entranceFlash/)
    const off = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? ''
    expect(off).toContain('.seat[data-entrance] .plate::before')
    // the reign's aura keeps its own layer
    expect(CSS).not.toMatch(/\.seat\[data-entrance\][^{]*::after/)
  })
})

/** Drives `useEntrances` and draws its band; the latest answer lands in `seen`. */
const seen: EntrancesNow[] = []
function Harness(props: { entrances: ClientEntrance[]; heralds?: ClientHerald[]; rolls?: ClientDiceRoll[]; hold?: HeraldHold | null }) {
  const now = useEntrances({ entrances: props.entrances, heralds: props.heralds ?? [], rolls: props.rolls ?? [], hold: props.hold ?? null })
  seen.push(now)
  return <EntranceBand entrance={now.shown} onDismiss={now.dismiss} />
}

describe('useEntrances (BP-42 spec §4)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 })
    motion(false)
    seen.length = 0
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    Reflect.deleteProperty(window, 'matchMedia')
  })

  const draw = (props: Parameters<typeof Harness>[0]) => render(withI18n(<Harness {...props} />))
  const last = (): EntrancesNow => seen[seen.length - 1]!

  it('shows one for 3 s, fresh on its first render only, then goes by itself', () => {
    const view = draw({ entrances: [entrance()] })
    expect(band()).not.toBeNull()
    expect(seen.some((n) => n.fresh)).toBe(true)
    view.rerender(withI18n(<Harness entrances={[entrance()]} />))
    expect(last().fresh).toBe(false)
    act(() => void vi.advanceTimersByTime(ENTRANCE_MS - 100))
    expect(band()).not.toBeNull()
    act(() => void vi.advanceTimersByTime(200))
    expect(band()).toBeNull()
    expect(last().shown).toBeNull()
  })

  it('shows them one at a time, and the next comes fresh in its turn', () => {
    draw({ entrances: [entrance(), entrance({ id: 2, title: 'demigod', name: 'Bình', at: T0 + 100 })] })
    expect(screen.getByText(/Lan/)).toBeInTheDocument()
    expect(screen.queryByText(/Bình/)).toBeNull()
    seen.length = 0
    act(() => void vi.advanceTimersByTime(ENTRANCE_MS + 20))
    expect(screen.getByText('Bán Thần Bình đã xuất hiện!')).toBeInTheDocument()
    expect(seen.some((n) => n.fresh && n.shown?.id === 2)).toBe(true)
  })

  it('a tap puts it away, and the next starts at once', () => {
    draw({ entrances: [entrance(), entrance({ id: 2, title: 'godslayer', name: 'Châu', at: T0 })] })
    act(() => void vi.advanceTimersByTime(1_000))
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText(/Lan/)).toBeNull()
    expect(screen.getByText(/Kẻ Sát Thần Châu/)).toBeInTheDocument()
    act(() => void vi.advanceTimersByTime(ENTRANCE_MS - 100))
    expect(band()).not.toBeNull()
    act(() => void vi.advanceTimersByTime(200))
    expect(band()).toBeNull()
  })

  it('waits for the Thần’s herald and for the dice, never over them', () => {
    const herald: ClientHerald = { id: 1, kind: 'god', seat: 0, name: 'Ann', at: T0 }
    draw({ entrances: [entrance({ at: T0 + 200 })], heralds: [herald] })
    act(() => void vi.advanceTimersByTime(HERALD_MS - 100))
    expect(band()).toBeNull()
    act(() => void vi.advanceTimersByTime(200))
    expect(band()).not.toBeNull()
    cleanup()
    const roll: ClientDiceRoll = { id: 1, seat: 0, name: 'Ann', cardId: 's_dice', dice: [2], result: {}, at: Date.now() }
    draw({ entrances: [entrance({ id: 5, at: Date.now() })], rolls: [roll] })
    expect(band()).toBeNull()
    act(() => void vi.advanceTimersByTime(DICE_MS + 20))
    expect(band()).not.toBeNull()
  })

  it('a herald that comes cuts the one on screen short, and it does not come back (Ruling 3)', () => {
    const view = draw({ entrances: [entrance()] })
    act(() => void vi.advanceTimersByTime(1_000))
    const herald: ClientHerald = { id: 1, kind: 'demigod', seat: 0, name: 'Ann', at: Date.now() }
    view.rerender(withI18n(<Harness entrances={[entrance()]} heralds={[herald]} />))
    expect(band()).toBeNull()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    // Even if what cut it goes away within its 3 s (the heralds cleared), its time is over.
    act(() => void vi.advanceTimersByTime(500))
    view.rerender(withI18n(<Harness entrances={[entrance()]} />))
    expect(band()).toBeNull()
    act(() => void vi.advanceTimersByTime(HERALD_MS))
    expect(band()).toBeNull()
  })

  it('never shows during the reveal hold, and a late first show is not fresh', () => {
    const hold = { since: T0, until: null }
    const view = draw({ entrances: [entrance({ at: T0 + 100 })], hold })
    act(() => void vi.advanceTimersByTime(3_000))
    expect(band()).toBeNull()
    seen.length = 0
    view.rerender(withI18n(<Harness entrances={[entrance({ at: T0 + 100 })]} hold={{ since: T0, until: Date.now() }} />))
    expect(band()).not.toBeNull()
    // It starts at the hold's end, so its sound is due.
    expect(seen.some((n) => n.fresh)).toBe(true)
  })

  it('one that waited out more than 10 s of hold is dropped', () => {
    const view = draw({ entrances: [entrance()], hold: { since: T0, until: null } })
    act(() => void vi.advanceTimersByTime(ENTRANCE_STALE_MS + 500))
    view.rerender(withI18n(<Harness entrances={[entrance()]} hold={{ since: T0, until: Date.now() }} />))
    expect(band()).toBeNull()
  })

  it('an entrance that came before it mounted shows only what is left of its time, and makes no sound', () => {
    draw({ entrances: [entrance({ at: T0 - FRESH_MS - 500 })] })
    expect(band()).not.toBeNull()
    expect(seen.every((n) => !n.fresh)).toBe(true)
    act(() => void vi.advanceTimersByTime(ENTRANCE_MS - FRESH_MS - 400))
    expect(band()).toBeNull()
  })
})
