import { parseCard } from '@bp/core'
import { act, createEvent, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n/index.js'
import { DeckAnchorProvider } from './deck-anchor.js'
import { PeelCard } from './PeelCard.js'
import s from './table.module.css'
import TABLE_CSS from './table.module.css?raw'

// `fireEvent.pointer*` builds the `PointerEvent` stand-in from `test-setup.ts`: coordinates and `pointerId` both carry.

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

/** Pointer 1 pressing, moving to, and let go at (30, y) — the middle of the 60 × 84 card's width. */
const press = (root: HTMLElement, y: number) => fireEvent.pointerDown(root, { clientX: 30, clientY: y, pointerId: 1, buttons: 1 })
const moveTo = (root: HTMLElement, y: number) => fireEvent.pointerMove(root, { clientX: 30, clientY: y, pointerId: 1, buttons: 1 })
const release = (root: HTMLElement, y: number) => fireEvent.pointerUp(root, { clientX: 30, clientY: y, pointerId: 1 })

/**
 * A pointermove of pointer 1 that carries `raw`, the positions a fast screen reported since the last frame, stamped `at`
 * on `performance.now()`'s clock — what `getCoalescedEvents()` gives a page.
 */
const moveThrough = (root: HTMLElement, raw: { y: number; at: number }[]) => {
  const ev = createEvent.pointerMove(root, { clientX: 30, clientY: raw[raw.length - 1]!.y, pointerId: 1, buttons: 1 })
  Object.defineProperty(ev, 'getCoalescedEvents', { value: () => raw.map(({ y, at }) => ({ clientX: 30, clientY: y, timeStamp: at })) })
  fireEvent(root, ev)
}

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

  // Task 6 review M1: the speed is read from the positions a real pointer reports — one move a frame at 60 Hz, several
  // coalesced into each frame on a fast screen — never from a move a test made up.
  it('a flick opens a card barely begun; a drag as far but slow, or one that stopped before it was let go, drops back', () => {
    /** Presses at the bottom edge at `t0`, runs `gesture`, and says how the card ended. */
    const run = (gesture: (root: HTMLElement, t0: number) => void) => {
      const onRevealed = vi.fn()
      const { container, unmount } = wrap(<PeelCard card={ACE} open={false} onRevealed={onRevealed} />)
      const root = rootOf(container)
      const t0 = performance.now()
      press(root, 80)
      gesture(root, t0)
      advance(1000)
      const seen = [root.getAttribute('data-face'), onRevealed.mock.calls.length]
      unmount()
      return seen
    }
    // 60 Hz, nothing coalesced: 30 px up (p ≈ 0.48) in two frames, 0.94 px/ms, let go in the next
    const twoFrames = (root: HTMLElement) => {
      advance(16)
      moveTo(root, 65)
      advance(16)
      moveTo(root, 50)
      advance(4)
      release(root, 50)
    }
    expect(run(twoFrames), 'flicked').toEqual(['up', 1])
    // the same 30 px over six frames: 0.31 px/ms
    const sixFrames = (root: HTMLElement) => {
      for (let i = 1; i <= 6; i++) {
        advance(16)
        moveTo(root, 80 - 5 * i)
      }
      advance(4)
      release(root, 50)
    }
    expect(run(sixFrames), 'dragged').toEqual(['down', 0])
    // a press that rests, then 16 px (p ≈ 0.25) in one frame, which a 240 Hz screen reports as four positions 4 ms apart
    const restThenFlick = (holdMs: number) => (root: HTMLElement, t0: number) => {
      advance(416)
      moveThrough(root, [
        { y: 76, at: t0 + 404 },
        { y: 72, at: t0 + 408 },
        { y: 68, at: t0 + 412 },
        { y: 64, at: t0 + 416 },
      ])
      advance(2 + holdMs)
      release(root, 64)
    }
    expect(run(restThenFlick(0)), 'rested, then flicked').toEqual(['up', 1])
    expect(run(restThenFlick(100)), 'flicked, then held still before it was let go').toEqual(['down', 0])
  })

  // Ruling 20: on a phone a fast swipe up from the screen's bottom edge — where the viewer's cards sit — is also the
  // system's home gesture. The page then gets a `pointercancel`, never a release, and the card must not turn for it.
  it('a pointer the system takes away always drops the card back, however far or fast it went', () => {
    const onRevealed = vi.fn()
    const { container } = wrap(<PeelCard card={ACE} open={false} onRevealed={onRevealed} />)
    const root = rootOf(container)
    press(root, 80)
    moveTo(root, 42) // p ≈ 0.6, past the threshold
    fireEvent.pointerCancel(root, { pointerId: 1 })
    advance(1000)
    expect(root).toHaveAttribute('data-face', 'down')
    press(root, 80)
    advance(16)
    moveTo(root, 65)
    advance(16)
    moveTo(root, 50) // mid-flick, 0.94 px/ms
    fireEvent.pointerCancel(root, { pointerId: 1 })
    advance(1000)
    expect(root).toHaveAttribute('data-face', 'down')
    expect(onRevealed).not.toHaveBeenCalled()
  })

  // Task 6 review M3: a capture lost with no release (the card pulled from under the pointer, a release the page missed)
  // would leave the card stuck half peeled.
  it('a capture lost without a release drops the card back; the one every release brings changes nothing', () => {
    const onRevealed = vi.fn()
    const { container } = wrap(<PeelCard card={ACE} open={false} onRevealed={onRevealed} />)
    const root = rootOf(container)
    press(root, 80)
    moveTo(root, 42)
    fireEvent.lostPointerCapture(root, { pointerId: 1 })
    advance(1000)
    expect(root).toHaveAttribute('data-face', 'down')
    expect(onRevealed).not.toHaveBeenCalled()
    // a browser's release: `pointerup`, then `lostpointercapture`
    press(root, 80)
    moveTo(root, 40)
    release(root, 40)
    fireEvent.lostPointerCapture(root, { pointerId: 1 })
    advance(1000)
    expect(root).toHaveAttribute('data-face', 'up')
    expect(onRevealed).toHaveBeenCalledTimes(1)
  })

  // Task 6 review M2: the stand-in event keeps `pointerId`, so the guards are tested for real.
  it('follows the pointer that pressed it: a second finger meanwhile is ignored', () => {
    const onRevealed = vi.fn()
    const { container } = wrap(<PeelCard card={ACE} open={false} onRevealed={onRevealed} />)
    const root = rootOf(container)
    const backClip = () => root.querySelector<HTMLElement>(`.${s.peelBack}`)!.style.clipPath
    press(root, 80)
    moveTo(root, 70)
    const peeled = backClip()
    fireEvent.pointerDown(root, { clientX: 2, clientY: 2, pointerId: 2, buttons: 1 })
    fireEvent.pointerMove(root, { clientX: 2, clientY: 60, pointerId: 2, buttons: 1 })
    expect(backClip(), 'the second finger does not drive the peel').toBe(peeled)
    fireEvent.pointerUp(root, { clientX: 2, clientY: 60, pointerId: 2 })
    fireEvent.pointerCancel(root, { pointerId: 2 })
    advance(1000)
    expect(root, 'nor does it let go of it').toHaveAttribute('data-face', 'peeling')
    moveTo(root, 40)
    release(root, 40)
    advance(1000)
    expect(root).toHaveAttribute('data-face', 'up')
    expect(onRevealed).toHaveBeenCalledTimes(1)
  })

  // Task 6 review M5: `touch-action: none` is the peel's; a card that is up must not trap a touch meant to scroll.
  it('lets a touch on a card that is up scroll the room', () => {
    expect(TABLE_CSS).toMatch(/\.peel\s*\{[^}]*touch-action:\s*none/)
    expect(TABLE_CSS).toMatch(/\.peel\[data-face='up'\]\s*\{[^}]*touch-action:\s*auto/)
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
