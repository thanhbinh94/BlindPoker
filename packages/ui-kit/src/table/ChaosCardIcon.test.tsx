import type { HeldCardView } from '@bp/core'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import { createI18n } from '../i18n/index.js'
import { ChaosCardIcon, ChaosCardRow, MAX_CHAOS_ICONS, tierOfCardId } from './ChaosCardIcon.js'

const held = (uid: number, cardId: string, tier: HeldCardView['tier'], handsLeft: number | null = null): HeldCardView => ({ uid, cardId, tier, handsLeft })

const draw = (ui: React.ReactElement, lang: 'vi' | 'en' = 'vi') =>
  render(<I18nextProvider i18n={createI18n({ language: lang, storage: null })}>{ui}</I18nextProvider>)

describe('ChaosCardIcon', () => {
  it('is named by the card and its tier, with the hands it has left', () => {
    draw(<ChaosCardIcon card={held(1, 'g_shield_3', 'gold', 2)} />)
    const icon = screen.getByRole('img', { name: 'Khiên sắt (Vàng) · còn 2 ván' })
    expect(icon).toHaveAttribute('title', 'Khiên sắt (Vàng) · còn 2 ván')
    expect(icon).toHaveAttribute('data-tier', 'gold')
    expect(icon).toHaveTextContent('K')
    expect(icon).toHaveTextContent('2')
  })

  it('says "1 hand left" in English and shows no count for a card that waits on its condition', () => {
    const { unmount } = draw(<ChaosCardIcon card={held(1, 's_shield', 'silver', 1)} />, 'en')
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/· 1 hand left$/)
    unmount()
    draw(<ChaosCardIcon card={held(2, 's_rescue', 'silver', null)} />, 'en')
    expect(screen.getByRole('img').getAttribute('aria-label')).not.toMatch(/left/)
    expect(screen.getByRole('img').textContent).toBe('S')
  })

  it('reads a tier off the catalogue ids', () => {
    expect(['s_swap_one', 'g_swap_all', 'd_mirror', 'x'].map(tierOfCardId)).toEqual(['silver', 'gold', 'diamond', 'silver'])
  })
})

describe('ChaosCardRow', () => {
  it('draws nothing for a seat that holds no card', () => {
    const { container } = draw(<ChaosCardRow cards={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows up to four icons, in order', () => {
    draw(<ChaosCardRow cards={[held(1, 's_shield', 'silver'), held(2, 's_rescue', 'silver'), held(3, 'g_swap_all', 'gold'), held(4, 'd_mirror', 'diamond')]} />)
    expect(screen.getAllByRole('img')).toHaveLength(MAX_CHAOS_ICONS)
    expect(screen.queryByText(/^\+/)).toBeNull()
  })

  it('shows four and then "+N" for the rest, with the rest named in its tooltip', () => {
    const cards = [1, 2, 3, 4, 5, 6].map((uid) => held(uid, uid === 5 ? 'g_swap_all' : uid === 6 ? 'd_mirror' : 's_shield', 'silver'))
    draw(<ChaosCardRow cards={cards} />)
    expect(screen.getAllByRole('img', { name: /^Khiên gỗ \(Bạc\)$/ })).toHaveLength(4)
    const more = screen.getByText('+2')
    expect(more).toHaveAttribute('title', 'Đổi bài, Gương phản chiếu')
  })
})

describe('ChaosCardRow as a summary', () => {
  it('is one icon in the best tier held, with the number of cards in it and their names for a tooltip', () => {
    draw(<ChaosCardRow summary cards={[held(1, 's_shield', 'silver'), held(2, 'g_swap_all', 'gold'), held(3, 's_rescue', 'silver')]} />)
    const icon = screen.getByRole('img')
    expect(icon).toHaveAttribute('data-tier', 'gold')
    expect(icon).toHaveTextContent('3')
    expect(icon).toHaveAttribute('title', 'Khiên gỗ, Đổi bài, Cấp cứu bạc')
  })

  it('draws nothing for a hand of no cards', () => {
    const { container } = draw(<ChaosCardRow summary cards={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
