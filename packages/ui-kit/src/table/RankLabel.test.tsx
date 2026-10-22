import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import { createI18n, type Language } from '../i18n/index.js'
import { RankLabel, rankNumeral } from './RankLabel.js'
import s from './table.module.css'

const wrap = (node: ReactElement, language: Language = 'vi') =>
  render(<I18nextProvider i18n={createI18n({ language, storage: null })}>{node}</I18nextProvider>)

describe('RankLabel', () => {
  it('renders nothing for rank 1, for no rank and for a rank off the ladder', () => {
    for (const rank of [1, null, undefined, 0, 6]) {
      const { container, unmount } = wrap(<RankLabel rank={rank} lang="vi" />)
      expect(container.innerHTML, String(rank)).toBe('')
      unmount()
    }
  })

  it('renders rank 3 as its name, coloured by its rank', () => {
    wrap(<RankLabel rank={3} lang="vi" />)
    const label = screen.getByText('Cao thủ')
    expect(label).toHaveClass(s.rankLabel!)
    expect(label).toHaveAttribute('data-rank', '3')
  })

  it('renders the name in the language it is given', () => {
    wrap(<RankLabel rank={5} lang="en" />, 'vi')
    expect(screen.getByText('Legend')).toBeInTheDocument()
  })

  it('renders compact as the roman numeral, with the name as its title and its accessible name', () => {
    wrap(<RankLabel rank={3} lang="vi" compact />)
    const pill = screen.getByText('III')
    expect(pill).toHaveClass(s.rankPill!)
    expect(pill).toHaveAttribute('title', 'Cao thủ')
    expect(pill).toHaveAttribute('data-rank', '3')
    expect(screen.getByRole('img', { name: 'Cao thủ' })).toBe(pill)
  })

  it('numbers the ladder in roman numerals', () => {
    expect([1, 2, 3, 4, 5].map(rankNumeral)).toEqual(['I', 'II', 'III', 'IV', 'V'])
  })
})
