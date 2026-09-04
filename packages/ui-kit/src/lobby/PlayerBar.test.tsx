import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '../i18n/index.js'
import { PlayerBar } from './PlayerBar.js'

describe('PlayerBar', () => {
  it('shows name, balance, status, and switches language', async () => {
    const onLanguage = vi.fn()
    render(
      <I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>
        <PlayerBar displayName="Ann" balance={123456} status="reconnecting" lang="en" onLanguage={onLanguage} />
      </I18nextProvider>,
    )
    expect(screen.getByText('Ann')).toBeInTheDocument()
    expect(screen.getByText('123,456 pts')).toBeInTheDocument()
    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /tiếng việt/i }))
    expect(onLanguage).toHaveBeenCalledWith('vi')
  })

  it('states the balance in points, never as a currency amount', () => {
    const { container } = render(
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <PlayerBar displayName="Mai" balance={100_000} status="open" lang="vi" onLanguage={vi.fn()} />
      </I18nextProvider>,
    )
    expect(screen.getByText('100.000 điểm')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/₫|VND/)
    expect(container.textContent).not.toMatch(/100\.000\s*đ(?!i)/)
  })
})
