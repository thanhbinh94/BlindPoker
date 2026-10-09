import { parseCard } from '@bp/core'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n/index.js'
import { DeckAnchorProvider } from './deck-anchor.js'
import { PeelCard } from './PeelCard.js'
import s from './table.module.css'

// jsdom has no `PointerEvent`; a `MouseEvent` carries the `clientX`/`clientY` that `fireEvent.pointer*` passes (ruling 5).
window.PointerEvent = window.MouseEvent as unknown as typeof PointerEvent

const ACE = parseCard('Ah')
/** `cardLabel(Ah)` in Vietnamese, and the face-down card's name. */
const ACE_VI = 'Át cơ'
const HINT_VI = 'Lá úp — kéo để lật'

/** Renders `ui` under one i18n instance; `rerender` keeps it, as a table update does. */
const wrap = (ui: ReactElement) => {
  const i18n = createI18n({ language: 'vi', storage: null })
  const view = render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
  return { ...view, rerender: (next: ReactElement) => view.rerender(<I18nextProvider i18n={i18n}>{next}</I18nextProvider>) }
}

/** The card's root, laid out (jsdom lays nothing out) as a 60 × 84 box at the page's origin. */
const rootOf = (container: HTMLElement): HTMLElement => {
  const root = container.querySelector<HTMLElement>('[data-peel]')!
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 60, bottom: 84, width: 60, height: 84, x: 0, y: 0, toJSON: () => ({}) })
  return root
}

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('PeelCard (spec 2026-10-08 §3, §4.2.2)', () => {
  it('starts face down and named as a card to peel; a drag past half opens it and reports once', () => {
    const onRevealed = vi.fn()
    const { container } = wrap(<PeelCard card={ACE} open={false} onRevealed={onRevealed} />)
    const root = rootOf(container)
    expect(screen.getByRole('img')).toHaveAccessibleName(HINT_VI)
    expect(root).toHaveAttribute('data-face', 'down')
    expect(container.querySelector('[data-card]'), 'the face under the back names nothing yet').toBeNull()
    fireEvent.pointerDown(root, { clientX: 30, clientY: 80, pointerId: 1, buttons: 1 })
    fireEvent.pointerMove(root, { clientX: 30, clientY: 40, pointerId: 1, buttons: 1 }) // 40 px of 63 (0.75 × 84) → p ≈ 0.63
    expect(root).toHaveAttribute('data-face', 'peeling')
    // pressed at the bottom edge: the back keeps what lies above the fold, 0.63 of the way up from the bottom
    expect(root.querySelector<HTMLElement>(`.${s.peelBack}`)!.style.clipPath).toBe('polygon(0.00px 0.00px, 60.00px 0.00px, 60.00px 30.67px, 0.00px 30.67px)')
    fireEvent.pointerUp(root, { clientX: 30, clientY: 40, pointerId: 1 })
    advance(1000)
    expect(root).toHaveAttribute('data-face', 'up')
    expect(screen.getByRole('img')).toHaveAccessibleName(ACE_VI)
    expect(screen.getByRole('img')).toHaveAttribute('data-card', 'Ah')
    expect(root, 'the face names itself once it is up').not.toHaveAttribute('aria-label')
    expect(onRevealed).toHaveBeenCalledTimes(1)
  })

  it('a short drag snaps back and reports nothing; so does a pointer the browser cancels', () => {
    const onRevealed = vi.fn()
    const { container } = wrap(<PeelCard card={ACE} open={false} onRevealed={onRevealed} />)
    const root = rootOf(container)
    fireEvent.pointerDown(root, { clientX: 30, clientY: 80, pointerId: 1, buttons: 1 })
    fireEvent.pointerMove(root, { clientX: 30, clientY: 70, pointerId: 1, buttons: 1 })
    fireEvent.pointerUp(root, { clientX: 30, clientY: 70, pointerId: 1 })
    advance(1000)
    expect(root).toHaveAttribute('data-face', 'down')
    fireEvent.pointerDown(root, { clientX: 5, clientY: 80, pointerId: 2, buttons: 1 })
    fireEvent.pointerMove(root, { clientX: 15, clientY: 70, pointerId: 2, buttons: 1 })
    fireEvent.pointerCancel(root, { pointerId: 2 })
    advance(1000)
    expect(root).toHaveAttribute('data-face', 'down')
    expect(screen.getByRole('img')).toHaveAccessibleName(HINT_VI)
    expect(root.querySelector<HTMLElement>(`.${s.peelFlap}`)!.style.transform, 'at rest the face is not slid off the card').toBe('')
    expect(onRevealed).not.toHaveBeenCalled()
  })

  it('peels the card at its laid-out size, not the box its entrance has scaled', () => {
    const { container } = wrap(<PeelCard card={ACE} open={false} onRevealed={() => {}} />)
    const root = container.querySelector<HTMLElement>('[data-peel]')!
    // mid-slide from the deck: drawn at 0.6 of its 60 × 84 about its centre
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ left: 12, top: 16.8, right: 48, bottom: 67.2, width: 36, height: 50.4, x: 12, y: 16.8, toJSON: () => ({}) })
    Object.defineProperties(root, { offsetWidth: { value: 60 }, offsetHeight: { value: 84 } })
    fireEvent.pointerDown(root, { clientX: 30, clientY: 66, pointerId: 1, buttons: 1 })
    fireEvent.pointerMove(root, { clientX: 30, clientY: 34.5, pointerId: 1, buttons: 1 }) // 31.5 px of 63 → p = ½
    expect(root.querySelector<HTMLElement>(`.${s.peelBack}`)!.style.clipPath).toBe('polygon(0.00px 0.00px, 60.00px 0.00px, 60.00px 42.00px, 0.00px 42.00px)')
  })

  it('a flick opens a card barely begun; the same drag held still before letting go drops back', () => {
    /** Pressed, `restMs` still, 19 px up in 20 ms (0.95 px/ms, p ≈ 0.3), `holdMs` still, then let go. */
    const flick = ({ restMs = 0, holdMs = 0 }) => {
      const onRevealed = vi.fn()
      const { container, unmount } = wrap(<PeelCard card={ACE} open={false} onRevealed={onRevealed} />)
      const root = rootOf(container)
      fireEvent.pointerDown(root, { clientX: 30, clientY: 80, pointerId: 1, buttons: 1 })
      advance(restMs)
      fireEvent.pointerMove(root, { clientX: 30, clientY: 80, pointerId: 1, buttons: 1 })
      advance(10)
      fireEvent.pointerMove(root, { clientX: 30, clientY: 70, pointerId: 1, buttons: 1 })
      advance(10)
      fireEvent.pointerMove(root, { clientX: 30, clientY: 61, pointerId: 1, buttons: 1 })
      advance(holdMs)
      fireEvent.pointerUp(root, { clientX: 30, clientY: 61, pointerId: 1 })
      advance(1000)
      const seen = [root.getAttribute('data-face'), onRevealed.mock.calls.length]
      unmount()
      return seen
    }
    expect(flick({})).toEqual(['up', 1])
    expect(flick({ holdMs: 400 }), 'held still before it is let go').toEqual(['down', 0])
    expect(flick({ restMs: 400 }), 'the press rested before the flick').toEqual(['up', 1])
  })

  it('opens when told to (the "Lật" button, the server turning it), and still reports once', () => {
    const onRevealed = vi.fn()
    const { container, rerender } = wrap(<PeelCard card={ACE} open={false} onRevealed={onRevealed} />)
    const root = rootOf(container)
    rerender(<PeelCard card={ACE} open onRevealed={onRevealed} />)
    expect(root).toHaveAttribute('data-face', 'peeling')
    advance(1000)
    expect(root).toHaveAttribute('data-face', 'up')
    expect(onRevealed).toHaveBeenCalledTimes(1)
    expect(root).toHaveClass(s.card!) // the same wrapper as a Card: size, shadow, the deal-in
    expect(root).toHaveClass(s.cardMd!)
  })

  // Pre-flight 2026-10-09 (11): a seat passes a new arrow on every render, and every server message re-renders it.
  it('a re-render mid-open with a new callback neither restarts the open nor reports twice', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { container, rerender } = wrap(<PeelCard card={ACE} open={false} onRevealed={first} />)
    const root = rootOf(container)
    rerender(<PeelCard card={ACE} open onRevealed={first} />)
    advance(300)
    expect(root).toHaveAttribute('data-face', 'peeling')
    rerender(<PeelCard card={ACE} open onRevealed={second} />)
    // 600 ms in: the open (320 ms of peel, 220 ms of slide) is over only if the re-render at 300 left it running
    advance(300)
    expect(root).toHaveAttribute('data-face', 'up')
    rerender(<PeelCard card={ACE} open onRevealed={first} />)
    advance(1000)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('takes over a drag in progress when it is opened from outside', () => {
    const onRevealed = vi.fn()
    const { container, rerender } = wrap(<PeelCard card={ACE} open={false} onRevealed={onRevealed} />)
    const root = rootOf(container)
    fireEvent.pointerDown(root, { clientX: 30, clientY: 80, pointerId: 1, buttons: 1 })
    fireEvent.pointerMove(root, { clientX: 30, clientY: 75, pointerId: 1, buttons: 1 })
    rerender(<PeelCard card={ACE} open onRevealed={onRevealed} />)
    fireEvent.pointerUp(root, { clientX: 30, clientY: 75, pointerId: 1 }) // too short to open by itself
    advance(1000)
    expect(root).toHaveAttribute('data-face', 'up')
    expect(onRevealed).toHaveBeenCalledTimes(1)
  })

  it('a card that mounts open — a hand restored after the round — is simply up, and reports once', () => {
    const onRevealed = vi.fn()
    const { container } = wrap(<PeelCard card={ACE} open onRevealed={onRevealed} />)
    expect(container.querySelector('[data-peel]')).toHaveAttribute('data-face', 'up')
    expect(screen.getByRole('img')).toHaveAccessibleName(ACE_VI)
    expect(onRevealed).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount(), 'nothing animates').toBe(0)
  })

  it('unmounted mid-open, it stops and reports nothing', () => {
    const onRevealed = vi.fn()
    const { container, rerender, unmount } = wrap(<PeelCard card={ACE} open={false} onRevealed={onRevealed} />)
    rootOf(container)
    rerender(<PeelCard card={ACE} open onRevealed={onRevealed} />)
    advance(100)
    unmount()
    expect(vi.getTimerCount(), 'no frame left scheduled').toBe(0)
    advance(1000)
    expect(onRevealed).not.toHaveBeenCalled()
  })

  // Task 5: a dealt card slides in from the deck on the delay it mounted with; a card dealt face up turns once it lands.
  it('dealt from the deck it slides in like a Card, keeps the delay it mounted with, and an open waits for it to land', () => {
    const onRevealed = vi.fn()
    const anchor = { current: document.createElement('div') }
    const at = (open: boolean, delayMs: number) => (
      <DeckAnchorProvider value={anchor}>
        <PeelCard card={ACE} open={open} onRevealed={onRevealed} dealt delayMs={delayMs} />
      </DeckAnchorProvider>
    )
    const { container, rerender } = wrap(at(false, 240))
    const root = rootOf(container)
    expect(root).toHaveClass(s.cardDealt!)
    expect(root.style.getPropertyValue('--deal-delay')).toBe('240ms')
    rerender(at(true, 0))
    expect(root.style.getPropertyValue('--deal-delay')).toBe('240ms')
    advance(500) // it lands 240 + 360 ms after it mounted
    expect(root).toHaveAttribute('data-face', 'down')
    advance(1000)
    expect(root).toHaveAttribute('data-face', 'up')
    expect(onRevealed).toHaveBeenCalledTimes(1)
  })

  describe('with reduced motion', () => {
    beforeEach(() => {
      // jsdom has no `matchMedia`; this one answers the reduced-motion query and nothing else.
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (query: string) => ({
          matches: query.includes('prefers-reduced-motion: reduce'),
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }),
      })
    })
    afterEach(() => {
      Reflect.deleteProperty(window, 'matchMedia')
    })

    // Spec 2026-10-08 §6: the gesture still works, but the card opens and drops back at once.
    it('opens at once from outside, and a drag still peels but opens or drops back the moment it is let go', () => {
      const onRevealed = vi.fn()
      const outside = wrap(<PeelCard card={ACE} open={false} onRevealed={onRevealed} />)
      outside.rerender(<PeelCard card={ACE} open onRevealed={onRevealed} />)
      expect(outside.container.querySelector('[data-peel]')).toHaveAttribute('data-face', 'up')
      expect(onRevealed).toHaveBeenCalledTimes(1)
      outside.unmount()

      const { container } = wrap(<PeelCard card={ACE} open={false} onRevealed={onRevealed} />)
      const root = rootOf(container)
      fireEvent.pointerDown(root, { clientX: 30, clientY: 80, pointerId: 1, buttons: 1 })
      fireEvent.pointerMove(root, { clientX: 30, clientY: 70, pointerId: 1, buttons: 1 })
      expect(root).toHaveAttribute('data-face', 'peeling')
      fireEvent.pointerUp(root, { clientX: 30, clientY: 70, pointerId: 1 })
      expect(root).toHaveAttribute('data-face', 'down')
      fireEvent.pointerDown(root, { clientX: 30, clientY: 80, pointerId: 1, buttons: 1 })
      fireEvent.pointerMove(root, { clientX: 30, clientY: 40, pointerId: 1, buttons: 1 })
      fireEvent.pointerUp(root, { clientX: 30, clientY: 40, pointerId: 1 })
      expect(root).toHaveAttribute('data-face', 'up')
      expect(onRevealed).toHaveBeenCalledTimes(2)
      expect(vi.getTimerCount()).toBe(0)
    })
  })
})
