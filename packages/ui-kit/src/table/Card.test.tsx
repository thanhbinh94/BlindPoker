import { parseCard } from '@bp/core'
import { render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '../i18n/index.js'
import { Card } from './Card.js'
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
})
