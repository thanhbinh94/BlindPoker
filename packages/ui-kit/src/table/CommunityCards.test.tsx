import { parseCards } from '@bp/core'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '../i18n/index.js'
import { BOARD_STAGGER_MS } from './Card.js'
import { CommunityCards } from './CommunityCards.js'
import s from './table.module.css'

const wrap = (ui: React.ReactElement) => render(<I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>{ui}</I18nextProvider>)

describe('CommunityCards', () => {
  it('staggers the flop by BOARD_STAGGER_MS and starts the turn and river at once', () => {
    const { container } = wrap(<CommunityCards cards={parseCards('Qs 8d 6c 2h 9s')} dealt />)
    const delays = [...container.querySelectorAll(`.${s.card}`)].map((el) => /--deal-delay:\s*(\d+)ms/.exec(el.getAttribute('style') ?? '')?.[1] ?? '0')
    expect(delays).toEqual(['0', String(BOARD_STAGGER_MS), String(2 * BOARD_STAGGER_MS), '0', '0'])
  })
})
