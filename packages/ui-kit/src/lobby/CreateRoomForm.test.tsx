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
  it('shows a validation error instead of submitting when the name is empty', async () => {
    const onSubmit = vi.fn()
    wrap(<CreateRoomForm onSubmit={onSubmit} lang="en" />)
    await userEvent.click(screen.getByRole('button', { name: /^create/i }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
