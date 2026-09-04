import { parseCard } from '@bp/core'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '../i18n/index.js'
import { Card } from './Card.js'

const wrap = (ui: React.ReactElement, lang: 'en' | 'vi' = 'en') =>
  render(<I18nextProvider i18n={createI18n({ language: lang, storage: null })}>{ui}</I18nextProvider>)

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
})
