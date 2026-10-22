import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '../i18n/index.js'
import { PlayerBar } from './PlayerBar.js'

describe('PlayerBar', () => {
  it('shows name, balance and status — and leaves the language switch to the app rail', () => {
    render(
      <I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>
        <PlayerBar displayName="Ann" balance={123456} status="reconnecting" lang="en" />
      </I18nextProvider>,
    )
    expect(screen.getByText('Ann')).toBeInTheDocument()
    expect(screen.getByText('123,456 pts')).toBeInTheDocument()
    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /tiếng việt/i })).toBeNull()
  })

  it('draws the app’s avatar in place of the initial when it is given one', () => {
    const { rerender } = render(
      <I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>
        <PlayerBar displayName="Ann" balance={0} status="open" lang="en" />
      </I18nextProvider>,
    )
    expect(screen.getByText('A')).toBeInTheDocument()

    rerender(
      <I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>
        <PlayerBar displayName="Ann" balance={0} status="open" lang="en" avatar={<a href="#/avatar">my face</a>} />
      </I18nextProvider>,
    )
    expect(screen.getByRole('link', { name: 'my face' })).toBeInTheDocument()
    expect(screen.queryByText('A')).toBeNull()
  })

  it('puts the player’s rank after their name, and nothing at rank 1', () => {
    const { rerender } = render(
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <PlayerBar displayName="Mai" balance={0} status="open" lang="vi" rank={3} />
      </I18nextProvider>,
    )
    expect(screen.getByText('Mai').nextElementSibling).toHaveTextContent('Cao thủ')
    rerender(
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <PlayerBar displayName="Mai" balance={0} status="open" lang="vi" rank={1} />
      </I18nextProvider>,
    )
    expect(screen.queryByText('Tân binh')).toBeNull()
  })

  it('states the balance in points, never as a currency amount', () => {
    const { container } = render(
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <PlayerBar displayName="Mai" balance={100_000} status="open" lang="vi" />
      </I18nextProvider>,
    )
    expect(screen.getByText('100.000 điểm')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/₫|VND/)
    expect(container.textContent).not.toMatch(/100\.000\s*đ(?!i)/)
  })

  it('carries the app’s links on its own line, after who you are and before the connection pill', () => {
    render(
      <I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>
        <PlayerBar displayName="Ann" balance={0} status="open" lang="en">
          <a href="#/shop">Shop</a>
        </PlayerBar>
      </I18nextProvider>,
    )
    const bar = screen.getByRole('banner')
    const link = screen.getByRole('link', { name: 'Shop' })
    // One strip, not a second row under it (Plan 27 fix wave: the row under the bar made a lobby of six scroll).
    expect(bar).toContainElement(link)
    const order = Array.from(bar.querySelectorAll('a, [data-status]'))
    expect(order.indexOf(link)).toBeLessThan(order.indexOf(screen.getByText('Online').closest('[data-status]')!))
  })
})
