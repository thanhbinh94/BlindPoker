import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import { validateRoomConfig } from '@bp/core'
import { createI18n } from '../i18n/index.js'
import { CreateRoomForm } from './CreateRoomForm.js'

const wrap = (ui: React.ReactElement) =>
  render(<I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>{ui}</I18nextProvider>)

describe('CreateRoomForm', () => {
  it('submits a valid hold’em config with defaults', async () => {
    const onSubmit = vi.fn()
    wrap(<CreateRoomForm onSubmit={onSubmit} lang="en" />)
    await userEvent.type(screen.getByLabelText(/name/i), 'My table')
    await userEvent.click(screen.getByRole('button', { name: /^create/i }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const cfg = onSubmit.mock.calls[0]![0]
    expect(validateRoomConfig(cfg).ok).toBe(true)
    expect(cfg).toMatchObject({
      name: 'My table',
      mode: 'holdem',
      holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 },
    })
  })
  it('names the buy-in unit and what it comes to at the chosen stakes (layout audit C9)', () => {
    wrap(<CreateRoomForm onSubmit={vi.fn()} lang="en" />)
    // Default stakes 100/200: 50 BB and 200 BB.
    expect(screen.getByLabelText('Min buy-in')).toHaveAccessibleDescription('50 BB = 10,000 pts')
    expect(screen.getByLabelText('Max buy-in')).toHaveAccessibleDescription('200 BB = 40,000 pts')
  })
  it('switches to blind, exposes blind fields, and rejects a bad bot count', async () => {
    const onSubmit = vi.fn()
    wrap(<CreateRoomForm onSubmit={onSubmit} lang="en" initialMode="blind" />)
    await userEvent.type(screen.getByLabelText(/name/i), 'B')
    expect(screen.getByLabelText(/wager/i)).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText(/max players/i), '3')
    await userEvent.selectOptions(screen.getByLabelText(/bots/i), '2')
    await userEvent.click(screen.getByRole('button', { name: /^create/i }))
    const cfg = onSubmit.mock.calls[0]![0]
    expect(cfg).toMatchObject({
      mode: 'blind',
      maxPlayers: 3,
      blind: { holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1000, botCount: 2 },
    })
  })
  it('says what the chosen wager means as a table limit', async () => {
    const user = userEvent.setup()
    wrap(<CreateRoomForm onSubmit={vi.fn()} lang="en" />)
    await user.click(screen.getByRole('button', { name: 'Blind Poker' }))
    expect(screen.getByText('Table limit per player: 5,000 pts (5× the wager)')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Fixed wager'), '5000')
    expect(screen.getByText('Table limit per player: 25,000 pts (5× the wager)')).toBeInTheDocument()
  })
  it('shows a localized validation error instead of submitting when the name is empty', async () => {
    const onSubmit = vi.fn()
    wrap(<CreateRoomForm onSubmit={onSubmit} lang="en" />)
    await userEvent.click(screen.getByRole('button', { name: /^create/i }))
    expect(onSubmit).not.toHaveBeenCalled()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Invalid room settings')
    expect(alert).toHaveTextContent('The room name must be 1–30 characters.')
  })

  it('never puts the validator’s own English sentence on the page', async () => {
    const onSubmit = vi.fn()
    const { container } = render(
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <CreateRoomForm onSubmit={onSubmit} lang="vi" />
      </I18nextProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: /tạo phòng/i }))
    const raw = validateRoomConfig({ name: '', mode: 'holdem' })
    expect(raw.ok).toBe(false)
    if (!raw.ok) expect(container.textContent).not.toContain(raw.message)
    expect(screen.getByRole('alert')).toHaveTextContent('Thiết lập phòng không hợp lệ')
    expect(screen.getByRole('alert')).toHaveTextContent('Tên phòng cần 1–30 ký tự.')
  })
})
