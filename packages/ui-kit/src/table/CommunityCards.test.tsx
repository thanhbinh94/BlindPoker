import { parseCards } from '@bp/core'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '../i18n/index.js'
import { CommunityCards } from './CommunityCards.js'
import { BOARD_STAGGER_MS } from './motion.js'
import s from './table.module.css'

const wrap = (ui: React.ReactElement) => render(<I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>{ui}</I18nextProvider>)

/** Each board card's `--deal-delay`, in ms as written; `'0'` where none is set. */
const delays = (root: Element) =>
  [...root.querySelectorAll(`.${s.card}`)].map((el) => /--deal-delay:\s*(\d+)ms/.exec(el.getAttribute('style') ?? '')?.[1] ?? '0')

describe('CommunityCards', () => {
  it('staggers the flop by BOARD_STAGGER_MS and starts the turn and river at once', () => {
    const { container } = wrap(<CommunityCards cards={parseCards('Qs 8d 6c 2h 9s')} dealt />)
    expect(delays(container)).toEqual(['0', String(BOARD_STAGGER_MS), String(2 * BOARD_STAGGER_MS), '0', '0'])
  })

  // Ruling 18 (Task 5 review): a board that was already out — a snapshot, a remount — shows at once, unstaggered.
  it('staggers nothing on a board that was not just dealt', () => {
    const { container } = wrap(<CommunityCards cards={parseCards('Qs 8d 6c 2h 9s')} />)
    expect(delays(container)).toEqual(['0', '0', '0', '0', '0'])
  })
})
