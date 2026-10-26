import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import { validateRoomConfig } from '@bp/core'
import { createI18n, type Language } from '../i18n/index.js'
import { CreateRoomForm } from './CreateRoomForm.js'
import s from './lobby.module.css'
import LOBBY_CSS from './lobby.module.css?raw'
import { ROOM_NAME_WORDS } from './room-names.js'

const wrap = (ui: React.ReactElement) =>
  render(<I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>{ui}</I18nextProvider>)

/** The form opens with a name of its own, so a test that wants its own words replaces it first. */
const typeName = async (text: string): Promise<void> => {
  const input = screen.getByLabelText('Room name')
  await userEvent.clear(input)
  await userEvent.type(input, text)
}

/** Every name the generator can offer in `lang`. */
const offered = (lang: Language): string[] =>
  ROOM_NAME_WORDS[lang].heads.flatMap((head) => ROOM_NAME_WORDS[lang].tails.map((tail) => `${head} ${tail}`))

describe('CreateRoomForm', () => {
  it('submits a valid hold’em config with defaults', async () => {
    const onSubmit = vi.fn()
    wrap(<CreateRoomForm onSubmit={onSubmit} lang="en" />)
    await typeName('My table')
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
    await typeName('B')
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
    expect(screen.getByText('Table limit per player: 10,000 pts (10× the wager)')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Fixed wager'), '5000')
    expect(screen.getByText('Table limit per player: 50,000 pts (10× the wager)')).toBeInTheDocument()
  })
  it('shows a localized validation error instead of submitting when the name is cleared', async () => {
    const onSubmit = vi.fn()
    wrap(<CreateRoomForm onSubmit={onSubmit} lang="en" />)
    // The form opens with a name of its own, so only a name emptied by hand is refused.
    await userEvent.clear(screen.getByLabelText('Room name'))
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
    await userEvent.clear(screen.getByLabelText('Tên phòng'))
    await userEvent.click(screen.getByRole('button', { name: /tạo phòng/i }))
    const raw = validateRoomConfig({ name: '', mode: 'holdem' })
    expect(raw.ok).toBe(false)
    if (!raw.ok) expect(container.textContent).not.toContain(raw.message)
    expect(screen.getByRole('alert')).toHaveTextContent('Thiết lập phòng không hợp lệ')
    expect(screen.getByRole('alert')).toHaveTextContent('Tên phòng cần 1–30 ký tự.')
  })

  // The dialog opens with a name already in the field, so a host who only wants a table can press "Create room" at once;
  // the 🎲 beside the field draws another, and the field stays an ordinary text field the host may type over.
  describe('the room name', () => {
    const wrapVi = (ui: React.ReactElement) =>
      render(<I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>{ui}</I18nextProvider>)
    const nameField = () => screen.getByLabelText('Room name') as HTMLInputElement
    const roll = () => screen.getByRole('button', { name: 'Another name' })

    it('opens with an enabled name field already holding one of the generator’s English names, thirty characters at most', () => {
      wrap(<CreateRoomForm onSubmit={vi.fn()} lang="en" />)
      expect(nameField().value).not.toBe('')
      expect(offered('en')).toContain(nameField().value)
      expect(nameField().value.length).toBeLessThanOrEqual(30)
      expect(nameField()).toBeEnabled()
    })

    it('draws the opening name in the form’s own language', () => {
      wrapVi(<CreateRoomForm onSubmit={vi.fn()} lang="vi" />)
      const field = screen.getByLabelText('Tên phòng') as HTMLInputElement
      expect(offered('vi')).toContain(field.value)
    })

    it('has a 🎲 button in the name’s row: a plain button named "Another name" (Tên khác), after the field', () => {
      wrap(<CreateRoomForm onSubmit={vi.fn()} lang="en" />)
      const button = roll()
      expect(button).toHaveAttribute('type', 'button')
      expect(button).toHaveTextContent('🎲')
      expect(button).toHaveAccessibleName('Another name')
      // the same row as the field (inside the one Field), and after it in the Tab order
      expect(nameField().parentElement).toContainElement(button)
      expect(nameField().compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      // it does not take over the field's label
      expect(screen.getByLabelText('Room name')).toBe(nameField())
    })

    it('is named "Tên khác" in Vietnamese', () => {
      wrapVi(<CreateRoomForm onSubmit={vi.fn()} lang="vi" />)
      expect(screen.getByRole('button', { name: 'Tên khác' })).toHaveTextContent('🎲')
    })

    it('rolls another name each time it is pressed, and keeps focus in the field', async () => {
      const user = userEvent.setup()
      wrap(<CreateRoomForm onSubmit={vi.fn()} lang="en" />)
      let previous = nameField().value
      for (let i = 0; i < 12; i++) {
        await user.click(roll())
        expect(nameField().value, `roll ${i + 1}`).not.toBe(previous)
        expect(offered('en')).toContain(nameField().value)
        expect(nameField()).toHaveFocus()
        previous = nameField().value
      }
    })

    it('selects the rolled name, so what the host types next replaces it, and leaves the focus in the field', async () => {
      const user = userEvent.setup()
      wrap(<CreateRoomForm onSubmit={vi.fn()} lang="en" />)
      for (let i = 0; i < 3; i++) {
        await user.click(roll())
        const field = nameField()
        expect(field).toHaveFocus()
        expect(field.selectionStart, `roll ${i + 1}: from the first character`).toBe(0)
        expect(field.selectionEnd, `roll ${i + 1}: to the last`).toBe(field.value.length)
      }
      await user.keyboard('Quán Ba Đình')
      expect(nameField().value).toBe('Quán Ba Đình')
    })

    it('never submits the form: pressing the 🎲 only changes the name', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      wrap(<CreateRoomForm onSubmit={onSubmit} lang="en" />)
      for (let i = 0; i < 3; i++) await user.click(roll())
      expect(onSubmit).not.toHaveBeenCalled()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('replaces a name the host typed, and a name the host cleared', async () => {
      const user = userEvent.setup()
      wrap(<CreateRoomForm onSubmit={vi.fn()} lang="en" />)
      await typeName('Quán Nhà Tôi')
      await user.click(roll())
      expect(offered('en')).toContain(nameField().value)
      await user.clear(nameField())
      await user.click(roll())
      expect(offered('en')).toContain(nameField().value)
    })

    it('submits the opening name when the host types nothing, the validated config and all', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      wrap(<CreateRoomForm onSubmit={onSubmit} lang="en" />)
      const opening = nameField().value
      await user.click(screen.getByRole('button', { name: /^create/i }))
      expect(onSubmit).toHaveBeenCalledTimes(1)
      const cfg = onSubmit.mock.calls[0]![0]
      expect(cfg.name).toBe(opening)
      expect(validateRoomConfig(cfg).ok).toBe(true)
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('submits the name that was rolled, not the one the dialog opened with', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      wrap(<CreateRoomForm onSubmit={onSubmit} lang="en" />)
      const opening = nameField().value
      await user.click(roll())
      const rolled = nameField().value
      expect(rolled).not.toBe(opening)
      await user.click(screen.getByRole('button', { name: /^create/i }))
      expect(onSubmit.mock.calls[0]![0].name).toBe(rolled)
    })

    it('stays an ordinary field: typed words are what is submitted, trimmed, up to thirty characters', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      wrap(<CreateRoomForm onSubmit={onSubmit} lang="en" />)
      await typeName('  Bàn của Bình  ')
      await user.click(screen.getByRole('button', { name: /^create/i }))
      expect(onSubmit.mock.calls[0]![0].name).toBe('Bàn của Bình')
      expect(nameField()).toHaveAttribute('maxlength', '30')
    })

    it('is switched off while the form is busy, with the rest of the controls', () => {
      wrap(<CreateRoomForm onSubmit={vi.fn()} lang="en" busy />)
      expect(roll()).toBeDisabled()
      expect(nameField()).toBeDisabled()
    })

    it('does not move the row: the button is as tall as the field beside it', () => {
      expect(LOBBY_CSS).toMatch(/\.nameRow\s*\{[^}]*display:\s*flex/)
      expect(LOBBY_CSS).toMatch(/\.rollName\s*\{[^}]*min-height:\s*var\(--tap\)/)
    })
  })

  // Plan 21: a Blind table may be a squeeze table — the cards come face down and are turned by hand in a round of a fixed
  // 20 s. The round's length is the server's, so the box swaps the turn-timer control for that length, read-only, rather
  // than leave a choice it would ignore. The box sits under the bot count (the slack in the wager row), and its hint is
  // read by a screen reader, not shown, so Blind's fields end where they did and the dialog does not grow for it.
  describe('the "Nặn bài" option', () => {
    const wrapVi = (ui: React.ReactElement) =>
      render(<I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>{ui}</I18nextProvider>)
    const create = () => screen.getByRole('button', { name: /^tạo phòng/i })

    it('is a checkbox in Blind mode, unchecked to begin with, named just "Nặn bài" and described by its hint', () => {
      wrapVi(<CreateRoomForm onSubmit={vi.fn()} lang="vi" initialMode="blind" />)
      const box = screen.getByLabelText('Nặn bài')
      expect(box).toHaveAttribute('type', 'checkbox')
      expect(box).not.toBeChecked()
      expect(box).toHaveAccessibleName('Nặn bài')
      expect(box).toHaveAccessibleDescription('Mỗi vòng tối đa 20 giây, kết thúc sớm khi mọi người đã lật.')
    })

    it('sits under the bot count, in its cell of the wager row, and shows no hint line of its own', () => {
      wrapVi(<CreateRoomForm onSubmit={vi.fn()} lang="vi" initialMode="blind" />)
      const box = screen.getByLabelText('Nặn bài')
      const cell = box.closest(`.${s.botsCell}`)
      expect(cell).not.toBeNull()
      expect(cell).toContainElement(screen.getByLabelText('Số lượng bot'))
      // after the bot count's select, not before it
      expect(screen.getByLabelText('Số lượng bot').compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      // the hint is for a screen reader: in the page, described-by, but not drawn
      const hint = document.getElementById(box.getAttribute('aria-describedby')!)!
      expect(hint).toHaveClass('visually-hidden')
      expect(cell).toContainElement(hint)
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

    it('swaps the turn-timer select for the round’s fixed length when it is checked, and gives the select back when it is not', async () => {
      const user = userEvent.setup()
      wrapVi(<CreateRoomForm onSubmit={vi.fn()} lang="vi" initialMode="blind" />)
      expect(screen.getByRole('combobox', { name: 'Thời gian mỗi lượt' })).toBeInTheDocument()
      await user.click(screen.getByLabelText('Nặn bài'))
      expect(screen.getByLabelText('Nặn bài')).toBeChecked()
      // the cell is not left empty: the same caption over a value that cannot be edited
      expect(screen.queryByRole('combobox', { name: 'Thời gian mỗi lượt' })).toBeNull()
      const fixed = screen.getByLabelText('Thời gian mỗi lượt')
      expect(fixed).toHaveValue('20 giây · nặn bài')
      expect(fixed).toHaveAttribute('readonly')
      await user.click(screen.getByLabelText('Nặn bài'))
      expect(screen.getByRole('combobox', { name: 'Thời gian mỗi lượt' })).toBeInTheDocument()
    })

    // Final fix wave P2: the fixed length is a value, not a control — no Tab stop — and it dims with the form while busy.
    it('keeps the fixed length out of the Tab order, and disables it with the form while it is busy', async () => {
      const user = userEvent.setup()
      const i18n = createI18n({ language: 'vi', storage: null })
      const form = (busy: boolean) => (
        <I18nextProvider i18n={i18n}>
          <CreateRoomForm onSubmit={vi.fn()} lang="vi" initialMode="blind" busy={busy} />
        </I18nextProvider>
      )
      const view = render(form(false))
      await user.click(screen.getByLabelText('Nặn bài'))
      const fixed = screen.getByLabelText('Thời gian mỗi lượt')
      expect(fixed).toHaveAttribute('tabindex', '-1')
      expect(fixed).toBeEnabled()
      expect(fixed).toHaveClass(s.inputFixed!)
      view.rerender(form(true))
      expect(screen.getByLabelText('Thời gian mỗi lượt')).toBeDisabled()
      expect(screen.getByLabelText('Số người tối đa'), 'as the select beside it').toBeDisabled()
      expect(LOBBY_CSS).toMatch(/\.inputFixed:disabled\s*\{[^}]*opacity:\s*0\.5/)
    })

    it('says the fixed length in English too', async () => {
      const user = userEvent.setup()
      wrap(<CreateRoomForm onSubmit={vi.fn()} lang="en" initialMode="blind" />)
      await user.click(screen.getByLabelText('Squeeze'))
      expect(screen.getByLabelText('Turn timer')).toHaveValue('20 sec · squeeze')
    })

    it('submits blind.squeeze true and a 20 s round, whatever timer was picked before the box was ticked', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      wrapVi(<CreateRoomForm onSubmit={onSubmit} lang="vi" initialMode="blind" />)
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

describe('the "Poker hỗn loạn" option', () => {
  const wrapVi = (ui: React.ReactElement) =>
    render(<I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>{ui}</I18nextProvider>)
  const create = () => screen.getByRole('button', { name: /^tạo phòng/i })
  /** The cycle select as a player finds it: by the words it shows, which carry the stable term "Chu kỳ thẻ". */
  const cycleSelect = () => screen.getByDisplayValue(/^Chu kỳ thẻ: \d+ ván$/)

  it('is not offered without chaosOffered (Lite, and any host that has no chaos)', () => {
    wrapVi(<CreateRoomForm onSubmit={vi.fn()} lang="vi" initialMode="blind" />)
    expect(screen.queryByLabelText('Poker hỗn loạn')).toBeNull()
    expect(screen.queryByLabelText('Chu kỳ thẻ')).toBeNull()
  })

  it('is a checkbox beside a 5 / 10 hand cycle in Blind mode, unchecked to begin with, and not at a Hold’em table', async () => {
    const user = userEvent.setup()
    wrapVi(<CreateRoomForm onSubmit={vi.fn()} lang="vi" chaosOffered />)
    expect(screen.queryByLabelText('Poker hỗn loạn')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Blind Poker' }))
    const box = screen.getByLabelText('Poker hỗn loạn')
    expect(box).toHaveAttribute('type', 'checkbox')
    expect(box).not.toBeChecked()
    expect(box).toHaveAccessibleDescription(expect.stringContaining('thẻ'))
    const cycle = cycleSelect()
    expect(cycle).toHaveDisplayValue('Chu kỳ thẻ: 5 ván')
    expect(cycle).toHaveAccessibleName('Chu kỳ thẻ')
    expect(cycle).toHaveValue('5')
    expect(cycle).toBeDisabled() // nothing to cycle until the table is chaotic
    expect([...(cycle as HTMLSelectElement).options].map((o) => [o.value, o.text])).toEqual([['5', 'Chu kỳ thẻ: 5 ván'], ['10', 'Chu kỳ thẻ: 10 ván']])
    await user.click(box)
    expect(cycle).toBeEnabled()
    await user.click(screen.getByRole('button', { name: "Texas Hold'em" }))
    expect(screen.queryByLabelText('Poker hỗn loạn')).toBeNull()
  })

  it('submits blind.chaosCycle 5 by default and 10 when chosen', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    wrapVi(<CreateRoomForm onSubmit={onSubmit} lang="vi" initialMode="blind" chaosOffered />)
    await user.click(screen.getByLabelText('Poker hỗn loạn'))
    await user.click(create())
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ mode: 'blind', blind: { chaosCycle: 5 } })
    expect(validateRoomConfig(onSubmit.mock.calls[0]![0]).ok).toBe(true)

    await user.selectOptions(cycleSelect(), '10')
    await user.click(create())
    expect(onSubmit.mock.calls[1]![0]).toMatchObject({ blind: { chaosCycle: 10 } })
  })

  it('omits chaosCycle when unchecked, however the cycle was set, and for a plain form', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    wrapVi(<CreateRoomForm onSubmit={onSubmit} lang="vi" initialMode="blind" chaosOffered />)
    await user.click(create())
    expect(Object.hasOwn(onSubmit.mock.calls[0]![0].blind, 'chaosCycle')).toBe(false)

    await user.click(screen.getByLabelText('Poker hỗn loạn'))
    await user.selectOptions(cycleSelect(), '10')
    await user.click(screen.getByLabelText('Poker hỗn loạn'))
    await user.click(create())
    expect(Object.hasOwn(onSubmit.mock.calls[1]![0].blind, 'chaosCycle')).toBe(false)
  })

  it('never reaches a Hold’em config, ticked and then flipped, and a form without chaosOffered never sends it', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    wrapVi(<CreateRoomForm onSubmit={onSubmit} lang="vi" initialMode="blind" chaosOffered />)
    await user.click(screen.getByLabelText('Poker hỗn loạn'))
    await user.click(screen.getByRole('button', { name: "Texas Hold'em" }))
    await user.click(create())
    expect(onSubmit.mock.calls[0]![0].blind).toBeUndefined()
  })

  it('can be combined with Nặn bài (squeeze)', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    wrapVi(<CreateRoomForm onSubmit={onSubmit} lang="vi" initialMode="blind" chaosOffered />)
    await user.click(screen.getByLabelText('Nặn bài'))
    await user.click(screen.getByLabelText('Poker hỗn loạn'))
    await user.click(create())
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ blind: { squeeze: true, chaosCycle: 5 } })
  })

  it('is named in English too', async () => {
    const user = userEvent.setup()
    wrap(<CreateRoomForm onSubmit={vi.fn()} lang="en" initialMode="blind" chaosOffered />)
    await user.click(screen.getByLabelText('Chaos poker'))
    expect(screen.getByDisplayValue('Card cycle: 5 hands')).toBeEnabled()
    expect(screen.getByLabelText('Card cycle')).toBeEnabled()
  })

  it('reserves a taller box for the mode fields when chaos is offered', () => {
    expect(LOBBY_CSS).toMatch(/\.modeFieldsChaos\s*\{[^}]*min-height:\s*\d+(\.\d+)?rem/)
  })
})
