import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '../i18n/index.js'
import { JoinByCode } from './JoinByCode.js'

describe('JoinByCode', () => {
  it('normalises the code and passes the password', async () => {
    const onJoin = vi.fn()
    render(
      <I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>
        <JoinByCode onJoin={onJoin} lang="en" />
      </I18nextProvider>,
    )
    await userEvent.type(screen.getByLabelText(/code/i), ' ab12cd ')
    await userEvent.type(screen.getByLabelText(/password/i), 'pw12')
    await userEvent.click(screen.getByRole('button', { name: /join/i }))
    expect(onJoin).toHaveBeenCalledWith('AB12CD', 'pw12')
  })
  it('wires both field wrappers to their CSS-module class', () => {
    const { container } = render(
      <I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>
        <JoinByCode onJoin={() => {}} lang="en" />
      </I18nextProvider>,
    )
    expect(container.querySelectorAll('[class*="joinField"]')).toHaveLength(2)
    expect(container.querySelector('[class="undefined"]')).toBeNull()
  })
})
