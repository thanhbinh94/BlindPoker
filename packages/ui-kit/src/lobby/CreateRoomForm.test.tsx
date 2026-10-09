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

  // Plan 21: a Blind table may be a squeeze table — the cards come face down and are turned by hand in a round of a fixed
  // 20 s. The round's length is the server's, so the box takes the turn-timer control away rather than leave a choice it
  // would ignore.
  describe('the "Nặn bài" option', () => {
    const wrapVi = (ui: React.ReactElement) =>
      render(<I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>{ui}</I18nextProvider>)
    const create = () => screen.getByRole('button', { name: /^tạo phòng/i })

    it('is a checkbox in Blind mode, unchecked to begin with, and says what it costs the timer', () => {
      wrapVi(<CreateRoomForm onSubmit={vi.fn()} lang="vi" initialMode="blind" />)
      const box = screen.getByLabelText('Nặn bài')
      expect(box).toHaveAttribute('type', 'checkbox')
      expect(box).not.toBeChecked()
      expect(box).toHaveAccessibleDescription('Mỗi vòng tối đa 20 giây, hết sớm khi mọi người đã lật.')
    })

    it('is not offered at a Hold’em table, and appears when the mode is flipped to Blind', async () => {
      const user = userEvent.setup()
      wrapVi(<CreateRoomForm onSubmit={vi.fn()} lang="vi" />)
      expect(screen.queryByLabelText('Nặn bài')).toBeNull()
      await user.click(screen.getByRole('button', { name: 'Blind Poker' }))
      expect(screen.getByLabelText('Nặn bài')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: "Texas Hold'em" }))
      expect(screen.queryByLabelText('Nặn bài')).toBeNull()
    })

    it('takes the turn-timer select away when it is checked, and gives it back when it is not', async () => {
      const user = userEvent.setup()
      wrapVi(<CreateRoomForm onSubmit={vi.fn()} lang="vi" initialMode="blind" />)
      expect(screen.getByLabelText('Thời gian mỗi lượt')).toBeInTheDocument()
      await user.click(screen.getByLabelText('Nặn bài'))
      expect(screen.getByLabelText('Nặn bài')).toBeChecked()
      expect(screen.queryByLabelText('Thời gian mỗi lượt')).toBeNull()
      await user.click(screen.getByLabelText('Nặn bài'))
      expect(screen.getByLabelText('Thời gian mỗi lượt')).toBeInTheDocument()
    })

    it('submits blind.squeeze true and a 20 s round, whatever timer was picked before the box was ticked', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      wrapVi(<CreateRoomForm onSubmit={onSubmit} lang="vi" initialMode="blind" />)
      await user.type(screen.getByLabelText('Tên phòng'), 'Nặn')
      await user.selectOptions(screen.getByLabelText('Thời gian mỗi lượt'), '30')
      await user.click(screen.getByLabelText('Nặn bài'))
      await user.click(create())
      expect(onSubmit).toHaveBeenCalledTimes(1)
      const cfg = onSubmit.mock.calls[0]![0]
      expect(validateRoomConfig(cfg).ok).toBe(true)
      expect(cfg).toMatchObject({ mode: 'blind', turnTimerSec: 20, blind: { squeeze: true } })
    })

    it('submits blind.squeeze false and the chosen timer when it is not checked — or was ticked and then cleared', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      wrapVi(<CreateRoomForm onSubmit={onSubmit} lang="vi" initialMode="blind" />)
      await user.type(screen.getByLabelText('Tên phòng'), 'Thường')
      await user.selectOptions(screen.getByLabelText('Thời gian mỗi lượt'), '30')
      await user.click(create())
      expect(onSubmit.mock.calls[0]![0]).toMatchObject({ turnTimerSec: 30, blind: { squeeze: false } })

      await user.click(screen.getByLabelText('Nặn bài'))
      await user.click(screen.getByLabelText('Nặn bài'))
      await user.click(create())
      expect(onSubmit.mock.calls[1]![0]).toMatchObject({ turnTimerSec: 30, blind: { squeeze: false } })
    })

    it('does not follow the host to a Hold’em table: ticked, then flipped to Hold’em, the timer and the config are Hold’em’s own', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      wrapVi(<CreateRoomForm onSubmit={onSubmit} lang="vi" initialMode="blind" />)
      await user.type(screen.getByLabelText('Tên phòng'), 'Đổi')
      await user.selectOptions(screen.getByLabelText('Thời gian mỗi lượt'), '30') // a timer both modes offer
      await user.click(screen.getByLabelText('Nặn bài'))
      await user.click(screen.getByRole('button', { name: "Texas Hold'em" }))
      expect(screen.getByLabelText('Thời gian mỗi lượt')).toHaveValue('30')
      await user.click(create())
      const cfg = onSubmit.mock.calls[0]![0]
      expect(cfg).toMatchObject({ mode: 'holdem', turnTimerSec: 30 }) // not the squeeze round's 20
      expect(cfg.blind).toBeUndefined()
    })
  })
})
