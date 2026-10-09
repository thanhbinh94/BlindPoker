import { parseCard } from '@bp/core'
import { render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '../i18n/index.js'
import TOKENS_CSS from '../theme/tokens.css?raw'
import { Card, DEAL_MS, FLIP_MS, LIFT_MS } from './Card.js'
import { DeckAnchorProvider } from './deck-anchor.js'
import s from './table.module.css'
import TABLE_CSS from './table.module.css?raw'

/** Renders `ui` under one i18n instance; `rerender` swaps the card under the same instance, as a table update does. */
const wrap = (ui: React.ReactElement, lang: 'en' | 'vi' = 'en') => {
  const i18n = createI18n({ language: lang, storage: null })
  const view = render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
  return { ...view, rerender: (next: React.ReactElement) => view.rerender(<I18nextProvider i18n={i18n}>{next}</I18nextProvider>) }
}

/** Everything in the card that names itself to a screen reader or a test: role, label and the data hooks. */
const named = (root: Element) => root.querySelectorAll('[role], [aria-label], [data-card], [data-face]')

describe('Card', () => {
  it('labels a face-up card and marks its data attributes', () => {
    wrap(<Card card={parseCard('Qh')} />)
    const el = screen.getByLabelText('Queen of hearts')
    expect(el).toHaveAttribute('data-card', 'Qh')
    expect(el.querySelectorAll('[data-pip]').length).toBeGreaterThan(0)
  })
  it('labels a face-down card in Vietnamese', () => {
    wrap(<Card faceDown />, 'vi')
    expect(screen.getByLabelText('Lá úp')).toHaveAttribute('data-face', 'down')
  })

  // Review 2026-09-29, No1: an opponent's cards used to swap from back to face in one frame at the showdown.
  it('turns over when a face-down card is revealed — one labelled face, the back hidden behind it', () => {
    const { container, rerender } = wrap(<Card faceDown delayMs={60} />)
    expect(container.querySelector(`.${s.cardTurn}`)).toBeNull()
    rerender(<Card card={parseCard('Qh')} delayMs={60} />)

    // The face names the card from the very render that reveals it — not at the turn's midpoint.
    const face = screen.getByRole('img')
    expect(face).toHaveAccessibleName('Queen of hearts')
    expect(face).toHaveAttribute('data-card', 'Qh')
    expect(face).toHaveAttribute('data-face', 'up')
    expect(named(container)).toHaveLength(1)
    expect(screen.queryByLabelText('Face-down card')).toBeNull()

    // The back is still drawn, for the first half of the turn, as artwork only.
    const back = container.querySelector('[aria-hidden="true"]')
    expect(back).not.toBeNull()
    expect(back!.querySelector('pattern')).not.toBeNull()
    for (const attr of ['role', 'aria-label', 'data-card', 'data-face']) expect(back).not.toHaveAttribute(attr)

    const turning = container.querySelector(`.${s.cardTurn}`)
    expect(turning).not.toBeNull()
    expect(turning).toContainElement(face)
    expect(turning).toContainElement(back as HTMLElement)
  })

  it('does not turn a card that is dealt face up', () => {
    const { container } = wrap(<Card card={parseCard('As')} />)
    expect(screen.getByRole('img')).toHaveAccessibleName('Ace of spades')
    expect(named(container)).toHaveLength(1)
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
    expect(container.querySelector(`.${s.cardTurn}`)).toBeNull()
  })

  it('turns once per reveal: face down again it is a back alone, and the next reveal turns again', () => {
    const { container, rerender } = wrap(<Card faceDown />)
    rerender(<Card card={parseCard('7c')} />)
    rerender(<Card card={parseCard('7c')} highlighted />)
    expect(container.querySelector(`.${s.cardTurn}`), 'a re-render of the face keeps the turn it had').not.toBeNull()

    rerender(<Card faceDown />)
    expect(screen.getByRole('img')).toHaveAccessibleName('Face-down card')
    expect(screen.getByRole('img')).toHaveAttribute('data-face', 'down')
    expect(named(container)).toHaveLength(1)
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
    expect(container.querySelector(`.${s.cardTurn}`)).toBeNull()

    rerender(<Card card={parseCard('8c')} />)
    expect(screen.getByRole('img')).toHaveAccessibleName('8 of clubs')
    expect(container.querySelector(`.${s.cardTurn}`)).not.toBeNull()
  })

  it('remembers it was face down under StrictMode', () => {
    const { container, rerender } = wrap(
      <StrictMode>
        <Card faceDown />
      </StrictMode>,
    )
    rerender(
      <StrictMode>
        <Card card={parseCard('Kd')} />
      </StrictMode>,
    )
    expect(screen.getByRole('img')).toHaveAccessibleName('King of diamonds')
    expect(container.querySelector(`.${s.cardTurn}`)).not.toBeNull()
  })

  // `global.css` switches every animation off under reduced motion (`animation: none !important`), so the face-up end
  // of the turn has to be the card's resting style: the keyframes may only say where the turn starts.
  it('keeps the face-up end out of the keyframes, so reduced motion lands on the face', () => {
    const frames = /@keyframes\s+flip\s*\{([\s\S]*?\})\s*\}/.exec(TABLE_CSS)?.[1] ?? ''
    expect(frames).toMatch(/^\s*from\s*\{\s*transform:\s*rotateY\(180deg\);?\s*\}\s*$/)
  })

  // `RoomScreen` holds the result card for as long as the turn takes (`REVEAL_HOLD_MS`), counted from `FLIP_MS`.
  it('turns for FLIP_MS, the duration the --dur-flip token gives the CSS', () => {
    expect(/--dur-flip:\s*(\d+)ms;/.exec(TOKENS_CSS)?.[1]).toBe(String(FLIP_MS))
  })

  // Spec 2026-10-08 §3: a card comes out of the deck face down and, if it is to be seen, turns over where it lands.
  it('a dealt face-up card slides in from the deck anchor and then turns — the back drawn as artwork for the slide', () => {
    const anchor = { current: document.createElement('div') }
    const { container } = wrap(
      <DeckAnchorProvider value={anchor}>
        <Card card={parseCard('Qh')} dealt delayMs={300} />
      </DeckAnchorProvider>,
    )
    const wrapper = container.querySelector(`.${s.card}`)!
    expect(wrapper).toHaveClass(s.cardDealt!)
    expect(wrapper.getAttribute('style')).toContain('--deal-delay: 300ms')
    expect(wrapper.getAttribute('style')).toMatch(/--deal-dx: -?\d+(\.\d+)?px/)
    // the turn has its own delay: it starts once the slide is over
    expect(wrapper.getAttribute('style')).toContain(`--turn-delay: ${300 + DEAL_MS}ms`)
    expect(container.querySelector(`.${s.cardTurn}`)).not.toBeNull()
    expect(container.querySelector('[aria-hidden="true"] pattern')).not.toBeNull()
    expect(named(container)).toHaveLength(1)
    expect(screen.getByRole('img')).toHaveAttribute('data-card', 'Qh')
  })

  it('a dealt face-down card slides in and stays a back; with no deck anchor a dealt card fades in as before', () => {
    const anchor = { current: document.createElement('div') }
    const down = wrap(
      <DeckAnchorProvider value={anchor}>
        <Card faceDown dealt />
      </DeckAnchorProvider>,
    )
    expect(down.container.querySelector(`.${s.cardDealt}`)).not.toBeNull()
    expect(down.container.querySelector(`.${s.cardTurn}`)).toBeNull()
    const alone = wrap(<Card card={parseCard('Qh')} dealt />)
    expect(alone.container.querySelector(`.${s.cardDealt}`)).toBeNull()
    expect(alone.container.querySelector(`.${s.cardTurn}`)).toBeNull()
  })

  describe('measuring the deck', () => {
    afterEach(() => vi.restoreAllMocks())

    // Pre-flight 2026-10-09: the `.card` fade starts at `rotateY(-82deg) translateY(-8px)`, which would skew the box.
    it('measures from where the card lands to the deck, with the entrance keyframe off while it reads the boxes', () => {
      const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height }) as DOMRect
      const deck = document.createElement('div')
      deck.getBoundingClientRect = () => box(100, 40, 40, 56)
      const seen: string[] = []
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        seen.push(this.style.animation)
        return box(300, 400, 46, 64)
      })
      const { container } = wrap(
        <DeckAnchorProvider value={{ current: deck }}>
          <Card faceDown dealt />
        </DeckAnchorProvider>,
      )
      const wrapper = container.querySelector<HTMLElement>(`.${s.card}`)!
      // the deck's centre (120, 68) less the card's (323, 432)
      expect(wrapper.style.getPropertyValue('--deal-dx')).toBe('-203.0px')
      expect(wrapper.style.getPropertyValue('--deal-dy')).toBe('-364.0px')
      expect(seen).toEqual(['none'])
      expect(wrapper.style.animation, 'and back on before the paint').toBe('')
    })
  })

  it('reveal="lift" turns a revealed card with the lift keyframes instead of the flat turn', () => {
    const { container, rerender } = wrap(<Card faceDown reveal="lift" />)
    rerender(<Card card={parseCard('Qh')} reveal="lift" />)
    expect(container.querySelector(`.${s.cardLift}`)).not.toBeNull()
    expect(container.querySelector(`.${s.cardTurn}`)).toBeNull()
    expect(screen.getByRole('img')).toHaveAttribute('data-card', 'Qh')
  })

  // Pre-flight 2026-10-09: a card revealed later turns on its own delay (`turnDelayMs`), never by moving its deal delay.
  it('lifts on its own delay with the shadow widening on the wrapper, and leaves the deal delay as it mounted', () => {
    const { container, rerender } = wrap(<Card faceDown reveal="lift" delayMs={480} turnDelayMs={200} />)
    rerender(<Card card={parseCard('Qh')} reveal="lift" delayMs={480} turnDelayMs={200} />)
    const wrapper = container.querySelector<HTMLElement>(`.${s.card}`)!
    expect(wrapper).toHaveClass(s.cardLifting!)
    expect(wrapper.style.getPropertyValue('--turn-delay')).toBe('200ms')
    expect(wrapper.style.getPropertyValue('--deal-delay')).toBe('480ms')
    const flat = wrap(<Card faceDown delayMs={480} />)
    flat.rerender(<Card card={parseCard('Qh')} delayMs={480} />)
    expect(flat.container.querySelector(`.${s.cardLifting}`), 'only the lift widens the shadow').toBeNull()
  })

  it('keeps the resting face out of the lift and slide keyframes, and the constants match the tokens', () => {
    const lift = /@keyframes\s+lift\s*\{([\s\S]*?)\n\}/.exec(TABLE_CSS)?.[1] ?? ''
    expect(lift).toMatch(/0%\s*\{[^}]*rotateY\(180deg\)/)
    expect(lift).not.toMatch(/100%/)
    const slide = /@keyframes\s+dealSlide\s*\{([\s\S]*?)\n\}/.exec(TABLE_CSS)?.[1] ?? ''
    expect(slide).toMatch(/^\s*from\s*\{/)
    expect(slide).not.toMatch(/\bto\b/)
    expect(/--dur-deal:\s*(\d+)ms;/.exec(TOKENS_CSS)?.[1]).toBe(String(DEAL_MS))
    expect(/--dur-lift:\s*(\d+)ms;/.exec(TOKENS_CSS)?.[1]).toBe(String(LIFT_MS))
  })

  // `global.css` switches every animation off under reduced motion; this file's own list says so for each moving class.
  it('lists every moving class of the card under reduced motion', () => {
    const off = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(TABLE_CSS)?.[1] ?? ''
    for (const name of ['card', 'cardDealt', 'cardTurn', 'cardLift', 'cardLifting']) expect(off, name).toMatch(new RegExp(`\\.${name}\\b`))
  })
})
