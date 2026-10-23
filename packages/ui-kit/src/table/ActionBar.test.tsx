import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import type { LegalActions, RoomView } from '@bp/core'
import { createI18n } from '../i18n/index.js'
import type { ClientHand, ClientSeat } from '../client/types.js'
import { ActionBar, trayWaitKey } from './ActionBar.js'

const room = { config: { mode: 'holdem', blind: undefined } } as unknown as RoomView
const hand = (legal: LegalActions | null, extra: Partial<ClientHand> = {}): ClientHand => ({
  handId: 'h',
  mode: 'holdem',
  phase: 'BETTING',
  community: [],
  pot: 1000,
  carryOverIn: 0,
  button: 0,
  actingSeat: 1,
  seats: [],
  mySeat: 1,
  legal,
  result: null,
  potPulse: 0,
  restored: true,
  dealtAt: null,
  boardAt: null,
  showdownAt: null,
  ...extra,
})
const wrap = (ui: React.ReactElement) =>
  render(<I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>{ui}</I18nextProvider>)

describe('ActionBar', () => {
  it('holds the tray between turns instead of collapsing it', () => {
    wrap(<ActionBar hand={hand(null)} room={room} onAct={() => {}} lang="en" />)
    expect(screen.getByRole('group', { name: 'Actions' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for your turn')
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('offers only legal kinds and emits fold/check/call', async () => {
    const onAct = vi.fn()
    wrap(
      <ActionBar
        hand={hand({ seat: 1, kinds: ['fold', 'call', 'allIn'], callAmount: 300, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 })}
        room={room}
        onAct={onAct}
        lang="en"
      />,
    )
    expect(screen.queryByRole('button', { name: /check/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /raise|bet/i })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /call/i }))
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'call' })
    expect(screen.getByRole('button', { name: /call/i })).toHaveTextContent('300')
    await userEvent.click(screen.getByRole('button', { name: /all.?in/i }))
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'allIn' })
    await userEvent.click(screen.getByRole('button', { name: /fold/i }))
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'fold' })
  })
  it('clamps raise amounts to the legal range and supports presets', async () => {
    const onAct = vi.fn()
    wrap(
      <ActionBar
        hand={hand({ seat: 1, kinds: ['fold', 'call', 'raise', 'allIn'], callAmount: 200, minBet: 0, maxBet: 0, minRaiseTo: 400, maxRaiseTo: 5000 })}
        room={room}
        onAct={onAct}
        lang="en"
      />,
    )
    const amount = screen.getByRole('spinbutton')
    expect(amount).toHaveValue(400)
    await userEvent.clear(amount)
    await userEvent.type(amount, '99999')
    await userEvent.click(screen.getByRole('button', { name: /^raise/i }))
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'raise', amount: 5000 })
    await userEvent.click(screen.getByRole('button', { name: /^pot$/i }))
    expect(amount).toHaveValue(1000)
    await userEvent.click(screen.getByRole('button', { name: /max/i }))
    expect(amount).toHaveValue(5000)
  })
  it('acts on the F, C and Enter shortcuts it advertises', async () => {
    const onAct = vi.fn()
    const { unmount } = wrap(
      <ActionBar
        hand={hand({ seat: 1, kinds: ['fold', 'call', 'raise', 'allIn'], callAmount: 200, minBet: 0, maxBet: 0, minRaiseTo: 400, maxRaiseTo: 5000 })}
        room={room}
        onAct={onAct}
        lang="en"
      />,
    )
    await userEvent.keyboard('f')
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'fold' })
    await userEvent.keyboard('c')
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'call' })
    await userEvent.keyboard('{Enter}')
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'raise', amount: 400 })
    expect(onAct).toHaveBeenCalledTimes(3)

    // The listener lives on `document`, so leaving it behind would keep folding hands in the next room.
    unmount()
    await userEvent.keyboard('f')
    expect(onAct).toHaveBeenCalledTimes(3)
  })
  it('ignores its shortcuts while the tray is disabled', async () => {
    const onAct = vi.fn()
    wrap(
      <ActionBar
        hand={hand({ seat: 1, kinds: ['fold', 'check'], callAmount: 0, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 })}
        room={room}
        onAct={onAct}
        disabled
        lang="en"
      />,
    )
    await userEvent.keyboard('f')
    await userEvent.keyboard('c')
    expect(onAct).not.toHaveBeenCalled()
  })
  it('blind decision shows play with the wager and fold', async () => {
    const onAct = vi.fn()
    const blindRoom = { config: { mode: 'blind', blind: { fixedWager: 2000 } } } as unknown as RoomView
    wrap(
      <ActionBar
        hand={hand(
          { seat: 1, kinds: ['play', 'fold'], callAmount: 2000, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 },
          { mode: 'blind', phase: 'DECISION' },
        )}
        room={blindRoom}
        onAct={onAct}
        lang="en"
      />,
    )
    const play = screen.getByRole('button', { name: /play/i })
    expect(play).toHaveTextContent('2,000')
    await userEvent.click(play)
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'play' })
  })
  it('Tất tay 3.000: a Blind seat short of the wager plays all in for what it has, and still sends a play', async () => {
    // Plan 27 D2: the play goes all in for the 3.000 the ante left at a 5.000 table, and the button says so.
    const onAct = vi.fn()
    const blindRoom = { config: { mode: 'blind', blind: { fixedWager: 5000, decisionMode: 'playOrFold' } } } as unknown as RoomView
    render(
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <ActionBar
          hand={hand({ seat: 1, kinds: ['play', 'fold'], callAmount: 3000, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 }, { mode: 'blind', phase: 'DECISION' })}
          room={blindRoom}
          onAct={onAct}
          lang="vi"
        />
      </I18nextProvider>,
    )
    const play = screen.getByRole('button', { name: 'Tất tay 3.000' })
    expect(screen.queryByRole('button', { name: /^Chơi/ })).toBeNull()
    await userEvent.click(play)
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'play' })
  })
  it('keeps "Chơi" when the stack covers the whole wager', () => {
    const blindRoom = { config: { mode: 'blind', blind: { fixedWager: 5000, decisionMode: 'playOrFold' } } } as unknown as RoomView
    render(
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <ActionBar
          hand={hand({ seat: 1, kinds: ['play', 'fold'], callAmount: 5000, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 }, { mode: 'blind', phase: 'DECISION' })}
          room={blindRoom}
          onAct={() => {}}
          lang="vi"
        />
      </I18nextProvider>,
    )
    expect(screen.getByRole('button', { name: 'Chơi 5.000' })).toBeInTheDocument()
  })
})

// Plan 26 (B4): a phone on its side keeps its height for the table. The betting buttons sit in a bottom-right dock, the
// toggles in a bottom-left one, presets replace the slider, and a typed amount opens a small dialog near the top (R11).
describe('ActionBar in the landscape frame', () => {
  const raiseLegal: LegalActions = { seat: 1, kinds: ['fold', 'call', 'raise', 'allIn'], callAmount: 200, minBet: 0, maxBet: 0, minRaiseTo: 400, maxRaiseTo: 5000 }
  const me: ClientSeat = { seat: 1, playerId: 'me', displayName: 'Me', isBot: false, stack: 5000, betThisStreet: 0, folded: false, allIn: false, cardCount: 2, holeCards: null, hasDecided: false, decision: null, lastAction: null, timedOut: false }
  const blindRoom = { config: { mode: 'blind', blind: { fixedWager: 2000, decisionMode: 'playOrFold' } } } as unknown as RoomView
  const wrapVi = (ui: React.ReactElement) =>
    render(<I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>{ui}</I18nextProvider>)

  it('in the landscape frame there is no slider; ✎ opens the amount dialog and confirm sets the raise amount', async () => {
    const onAct = vi.fn()
    wrap(<ActionBar hand={hand(raiseLegal)} room={room} onAct={onAct} lang="en" frame="landscape" />)
    const tray = screen.getByRole('group', { name: 'Actions' })
    expect(tray).toHaveAttribute('data-frame', 'landscape')
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.queryByRole('spinbutton'), 'no inline amount').toBeNull()
    // One row until the player asks to size: the raise button opens the presets instead of raising at once.
    expect(screen.queryByRole('button', { name: 'Pot' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Raise' }))
    expect(onAct).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Pot' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Raise 400' })).toBeInTheDocument()
    // The presets sit in the left corner (the toggles' place, empty on the player's own turn); "Max" stands in for All-in.
    expect(screen.getByRole('group', { name: 'Bet size' }).parentElement?.className).toMatch(/trayLeft/)
    expect(screen.queryByRole('button', { name: /all.?in/i })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Enter an amount' }))
    const dialog = screen.getByRole('dialog', { name: 'Enter an amount' })
    expect(dialog.className).toMatch(/dialogTop/)
    const amount = within(dialog).getByRole('spinbutton', { name: 'Bet amount' })
    expect(amount).toHaveAttribute('min', '400')
    expect(amount).toHaveAttribute('max', '5000')
    expect(amount).toHaveAttribute('inputmode', 'numeric')
    await userEvent.clear(amount)
    await userEvent.type(amount, '2500')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onAct).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Raise 2,500' }))
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'raise', amount: 2500 })

    // Enter in the dialog confirms, and an amount past the range is clamped into it.
    await userEvent.click(screen.getByRole('button', { name: 'Enter an amount' }))
    const again = within(screen.getByRole('dialog')).getByRole('spinbutton')
    await userEvent.clear(again)
    await userEvent.type(again, '99999{Enter}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onAct).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Raise 5,000' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Pot' }))
    expect(screen.getByRole('button', { name: 'Raise 1,000' })).toBeInTheDocument()
  })

  it('between hands in landscape the right part is hidden but Tự động chơi stays', async () => {
    const onAutoPlay = vi.fn()
    const over = hand(null, { mode: 'blind', phase: 'COMPLETE', seats: [me] })
    const { unmount } = wrapVi(<ActionBar hand={over} room={blindRoom} onAct={() => {}} lang="vi" frame="landscape" betweenHands autoPlay onAutoPlay={onAutoPlay} />)
    const tray = screen.getByRole('group', { name: 'Hành động' })
    expect(within(tray).queryByRole('status'), 'no "hand over" line beside the dock').toBeNull()
    const toggle = within(tray).getByRole('button', { name: 'Tự động chơi' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(toggle)
    expect(onAutoPlay).toHaveBeenLastCalledWith(false)
    unmount()

    // In the hand the right part is back: Bỏ bài and Chơi, with the toggle still in the left dock.
    const deciding = hand({ seat: 1, kinds: ['play', 'fold'], callAmount: 2000, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 }, { mode: 'blind', phase: 'DECISION', seats: [me] })
    wrapVi(<ActionBar hand={deciding} room={blindRoom} onAct={() => {}} lang="vi" frame="landscape" autoPlay onAutoPlay={onAutoPlay} />)
    const inHand = screen.getByRole('group', { name: 'Hành động' })
    expect(within(inHand).getByRole('button', { name: 'Bỏ bài' })).toBeInTheDocument()
    expect(within(inHand).getByRole('button', { name: 'Chơi 2.000' })).toBeInTheDocument()
    expect(within(inHand).getByRole('button', { name: 'Tự động chơi' })).toBeInTheDocument()
  })

  it('shows the call and raise figures as visible text on a second line under the verb', async () => {
    // A narrow corner stacks `.btnAmount` under its verb (a container query on `.trayRight`); it never hides it, since a
    // phone has no hover for a tooltip. The button's name is the whole phrase.
    const secondLine = (button: HTMLElement): HTMLElement => {
      const [verb, amount] = Array.from(button.children) as HTMLElement[]
      expect(verb, 'the verb comes first').toBeDefined()
      expect(amount?.className).toMatch(/btnAmount/)
      return amount!
    }
    wrap(<ActionBar hand={hand({ ...raiseLegal, callAmount: 104_000, minRaiseTo: 208_000, maxRaiseTo: 500_000 })} room={room} onAct={() => {}} lang="en" frame="landscape" />)
    const call = screen.getByRole('button', { name: 'Call 104,000' })
    expect(call.closest('[class*="trayRight"]')).not.toBeNull()
    expect(call.children[0]).toHaveTextContent(/^Call$/)
    const callFigure = secondLine(call)
    expect(callFigure).toHaveTextContent(/^104,000$/)
    expect(callFigure).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Raise' }))
    const raise = screen.getByRole('button', { name: 'Raise 208,000' })
    expect(raise.children[0]).toHaveTextContent(/^Raise$/)
    const raiseFigure = secondLine(raise)
    expect(raiseFigure).toHaveTextContent(/^208,000$/)
    expect(raiseFigure).toBeVisible()
  })

  it('stacks the Blind wager the same way, and leaves the desktop labels as one string', () => {
    const blindRoom = { config: { mode: 'blind', blind: { fixedWager: 2000, decisionMode: 'playOrFold' } } } as unknown as RoomView
    const deciding = hand({ seat: 1, kinds: ['play', 'fold'], callAmount: 2000, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 }, { mode: 'blind', phase: 'DECISION' })
    const { unmount } = wrap(<ActionBar hand={deciding} room={blindRoom} onAct={() => {}} lang="en" frame="landscape" />)
    const play = screen.getByRole('button', { name: 'Play 2,000' })
    expect(play.querySelector('[class*="btnAmount"]')).toHaveTextContent('2,000')
    unmount()

    wrap(<ActionBar hand={hand({ ...raiseLegal, callAmount: 104_000 })} room={room} onAct={() => {}} lang="en" />)
    const call = screen.getByRole('button', { name: 'Call 104,000' })
    expect(call.querySelector('[class*="btnAmount"]')).toBeNull()
    expect(call).not.toHaveAttribute('aria-label')
  })

  it('R opens the amount dialog in landscape', async () => {
    const onAct = vi.fn()
    wrap(<ActionBar hand={hand(raiseLegal)} room={room} onAct={onAct} lang="en" frame="landscape" />)
    await userEvent.keyboard('r')
    const amount = within(screen.getByRole('dialog', { name: 'Enter an amount' })).getByRole('spinbutton')
    expect(amount).toHaveFocus()
    await userEvent.clear(amount)
    await userEvent.type(amount, '700{Enter}')
    expect(onAct, 'Enter in the dialog sets the amount; it does not raise').not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Raise 700' })).toBeInTheDocument()
  })
})

describe('ActionBar pre-actions', () => {
  const seated = (extra: Partial<ClientHand> = {}) =>
    hand(null, { actingSeat: 0, seats: [{ seat: 1, playerId: 'me', displayName: 'Me', isBot: false, stack: 5000, betThisStreet: 0, folded: false, allIn: false, cardCount: 2, holeCards: null, hasDecided: false, decision: null, lastAction: null, timedOut: false }], ...extra })

  it('offers check/fold, call any and fold between turns, one lit at a time, and clears on a second press', async () => {
    const onPreAction = vi.fn()
    const { rerender } = wrap(<ActionBar hand={seated()} room={room} onAct={() => {}} lang="en" preAction={null} onPreAction={onPreAction} />)
    const group = screen.getByRole('group', { name: 'Before your turn' })
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for your turn')
    const buttons = ['Check/Fold', 'Call any', 'Fold'].map((name) => screen.getByRole('button', { name }))
    for (const b of buttons) expect(b).toHaveAttribute('aria-pressed', 'false')
    expect(group).toContainElement(buttons[0]!)

    await userEvent.click(buttons[1]!)
    expect(onPreAction).toHaveBeenLastCalledWith('callAny')

    rerender(
      <I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>
        <ActionBar hand={seated()} room={room} onAct={() => {}} lang="en" preAction="callAny" onPreAction={onPreAction} />
      </I18nextProvider>,
    )
    expect(screen.getByRole('button', { name: 'Call any' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Call any' }))
    expect(onPreAction).toHaveBeenLastCalledWith(null)
  })

  it('offers nothing to a spectator, a folded seat, an all-in seat, or a hand that is over', () => {
    const cases: ClientHand[] = [
      seated({ mySeat: null }),
      seated({ seats: [{ ...seated().seats[0]!, folded: true }] }),
      seated({ seats: [{ ...seated().seats[0]!, allIn: true }] }),
      seated({ phase: 'COMPLETE' }),
    ]
    for (const h of cases) {
      const { unmount } = wrap(<ActionBar hand={h} room={room} onAct={() => {}} lang="en" preAction={null} onPreAction={() => {}} />)
      expect(screen.queryByRole('group', { name: 'Before your turn' })).toBeNull()
      unmount()
    }
  })

  it('says only that it is waiting when the app wires no pre-actions', () => {
    wrap(<ActionBar hand={seated()} room={room} onAct={() => {}} lang="en" />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('blind play-or-fold rooms get an auto-play toggle, while waiting and while deciding', async () => {
    const onAutoPlay = vi.fn()
    const blindRoom = { config: { mode: 'blind', blind: { fixedWager: 2000, decisionMode: 'playOrFold' } } } as unknown as RoomView
    const { unmount } = wrap(
      <ActionBar hand={seated({ mode: 'blind', phase: 'DEALING' })} room={blindRoom} onAct={() => {}} lang="en" autoPlay={false} onAutoPlay={onAutoPlay} />,
    )
    expect(screen.queryByRole('button', { name: 'Check/Fold' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Auto play' }))
    expect(onAutoPlay).toHaveBeenLastCalledWith(true)
    unmount()

    const deciding = seated({ mode: 'blind', phase: 'DECISION', legal: { seat: 1, kinds: ['play', 'fold'], callAmount: 2000, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 } })
    wrap(<ActionBar hand={deciding} room={blindRoom} onAct={() => {}} lang="en" autoPlay onAutoPlay={onAutoPlay} />)
    expect(screen.getByRole('button', { name: 'Auto play' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^play/i })).toBeInTheDocument()
  })

  it('offers no auto-play in a pure-luck blind room, where there is nothing to decide', () => {
    const blindRoom = { config: { mode: 'blind', blind: { fixedWager: 2000, decisionMode: 'none' } } } as unknown as RoomView
    wrap(<ActionBar hand={seated({ mode: 'blind', phase: 'REVEAL' })} room={blindRoom} onAct={() => {}} lang="en" autoPlay={false} onAutoPlay={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Auto play' })).toBeNull()
  })

  it('offers auto-play in a pure-luck squeeze room, where it means turning the cards at once', async () => {
    const onAutoPlay = vi.fn()
    const squeezeRoom = { config: { mode: 'blind', blind: { fixedWager: 2000, decisionMode: 'none', squeeze: true } } } as unknown as RoomView
    wrap(<ActionBar hand={seated({ mode: 'blind', phase: 'SQUEEZE' })} room={squeezeRoom} onAct={() => {}} lang="en" autoPlay={false} onAutoPlay={onAutoPlay} />)
    await userEvent.click(screen.getByRole('button', { name: 'Auto play' }))
    expect(onAutoPlay).toHaveBeenLastCalledWith(true)
  })
})

// With no legal action the tray names what the seat is waiting for (review round 2, R2-3): one line per situation,
// picked by `trayWaitKey` in the order of the rows below.
describe('ActionBar waiting line', () => {
  const blindRoom = { config: { mode: 'blind', blind: { fixedWager: 2000, decisionMode: 'playOrFold' } } } as unknown as RoomView
  const seatOf = (seat: number, extra: Partial<ClientSeat> = {}): ClientSeat => ({
    seat, playerId: `p${seat}`, displayName: `P${seat}`, isBot: false, stack: 5000, betThisStreet: 0, folded: false, allIn: false, cardCount: 2, holeCards: null, hasDecided: false, decision: null, lastAction: null, timedOut: false, ...extra,
  })
  /** The viewer is seat 1; `others` are the seats it plays against. */
  const table = (mine: Partial<ClientSeat>, others: Partial<ClientSeat>[], extra: Partial<ClientHand> = {}): ClientHand =>
    hand(null, { actingSeat: null, seats: [seatOf(1, mine), ...others.map((o, i) => seatOf(i + 2, o))], ...extra })
  const said = (h: ClientHand, r: RoomView = room): string | null => {
    const { unmount } = wrap(<ActionBar hand={h} room={r} onAct={() => {}} lang="en" />)
    const line = screen.getByRole('status').textContent
    unmount()
    return line
  }

  it('says the hand is over once it is complete, however the seat ended it', () => {
    expect(said(table({}, [{}], { phase: 'COMPLETE' }))).toBe('Hand over')
    expect(said(table({ folded: true }, [{}], { phase: 'COMPLETE' })), 'over beats folded').toBe('Hand over')
    expect(said(table({ allIn: true }, [{}], { phase: 'COMPLETE' })), 'over beats all in').toBe('Hand over')
    expect(said(table({ hasDecided: true }, [{}], { mode: 'blind', phase: 'COMPLETE' }), blindRoom), 'over beats decided').toBe('Hand over')
    expect(said(hand(null, { phase: 'COMPLETE', mySeat: null })), 'a spectator is told the same').toBe('Hand over')
  })

  it('says it in Vietnamese too', () => {
    render(
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <ActionBar hand={table({}, [{}], { phase: 'COMPLETE' })} room={room} onAct={() => {}} lang="vi" />
      </I18nextProvider>,
    )
    expect(screen.getByRole('status')).toHaveTextContent(/^Ván đã kết thúc$/)
  })

  it('tells a folded seat it waits for the next hand', () => {
    expect(said(table({ folded: true }, [{}, {}]))).toBe('You folded — waiting for the next hand')
    expect(said(table({ folded: true, allIn: true }, [{}, {}])), 'folded beats all in').toBe('You folded — waiting for the next hand')
  })

  it('tells an all-in seat it waits for the result', () => {
    expect(said(table({ allIn: true }, [{}, {}]))).toBe("You're all in — waiting for the result")
  })

  it('tells a Blind seat that has decided it waits for the others', () => {
    expect(said(table({ hasDecided: true }, [{}, {}], { mode: 'blind', phase: 'DECISION' }), blindRoom)).toBe('Decided — waiting for the others')
  })

  it('keeps "Waiting for your turn" for a Blind seat whose decision is on its way', () => {
    expect(said(table({}, [{}, {}], { mode: 'blind', phase: 'DECISION' }), blindRoom)).toBe('Waiting for your turn')
    // a decision elsewhere in the room changes nothing for a seat that has not been asked yet
    expect(said(table({}, [{ hasDecided: true }, {}], { mode: 'blind', phase: 'DECISION' }), blindRoom)).toBe('Waiting for your turn')
  })

  it('says a Blind hand is waiting for the reveal once the decisions are in', () => {
    expect(said(table({ hasDecided: true }, [{}, {}], { mode: 'blind', phase: 'REVEAL' }), blindRoom)).toBe('Waiting for the reveal')
    // pure luck never enters DECISION: the hand goes straight to the reveal
    const luck = { config: { mode: 'blind', blind: { fixedWager: 2000, decisionMode: 'none' } } } as unknown as RoomView
    expect(said(table({}, [{}, {}], { mode: 'blind', phase: 'REVEAL' }), luck)).toBe('Waiting for the reveal')
    expect(said(table({}, [{}, {}], { mode: 'blind', phase: 'DEALING' }), luck), 'any phase that is not the decision').toBe('Waiting for the reveal')
  })

  // Spec 2026-10-08 §4.2.3: a pure-luck squeeze hand's round — the seat has its cards to turn, then waits for the others.
  it('asks a squeeze seat to turn its cards, then says it waits for the others', () => {
    const squeeze = { config: { mode: 'blind', blind: { fixedWager: 2000, decisionMode: 'none', squeeze: true } } } as unknown as RoomView
    const round = (mine: Partial<ClientSeat>) => table(mine, [{ isBot: true, revealed: true }, { revealed: false }], { mode: 'blind', phase: 'SQUEEZE' })
    expect(said(round({ revealed: false }), squeeze)).toBe('Squeeze your cards — they turn when time is up')
    expect(said(round({ revealed: true }), squeeze)).toBe('Turned — waiting for the others')
    const unturned = round({ revealed: false })
    expect(trayWaitKey(unturned, unturned.seats[0])).toBe('labels.waitSqueeze')
    const turned = round({ revealed: true })
    expect(trayWaitKey(turned, turned.seats[0])).toBe('labels.waitOthersReveal')
    // a spectator has nothing to squeeze: the cards it waits for are the table's
    expect(trayWaitKey(hand(null, { mode: 'blind', phase: 'SQUEEZE', mySeat: null }), undefined)).toBe('labels.waitReveal')
  })

  it('says the squeeze lines in Vietnamese too', () => {
    const squeeze = { config: { mode: 'blind', blind: { fixedWager: 2000, decisionMode: 'none', squeeze: true } } } as unknown as RoomView
    for (const [revealed, line] of [
      [false, 'Mời nặn bài — hết giờ sẽ tự lật'],
      [true, 'Đã lật — chờ người chơi khác'],
    ] as const) {
      const { unmount } = render(
        <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
          <ActionBar hand={table({ revealed }, [{}], { mode: 'blind', phase: 'SQUEEZE' })} room={squeeze} onAct={() => {}} lang="vi" />
        </I18nextProvider>,
      )
      expect(screen.getByRole('status')).toHaveTextContent(line)
      unmount()
    }
  })

  it("says a Hold'em run-out is waiting for the reveal, since no turn is coming", () => {
    expect(said(table({}, [{ allIn: true }], { phase: 'REVEAL' })), 'one live seat left').toBe('Waiting for the reveal')
    expect(said(table({}, [{ folded: true }, { allIn: true }], { phase: 'REVEAL' })), 'one live seat left').toBe('Waiting for the reveal')
    expect(said(hand(null, { phase: 'REVEAL', mySeat: null })), 'a spectator at a table with nobody live').toBe('Waiting for the reveal')
  })

  it("keeps \"Waiting for your turn\" for Hold'em between turns", () => {
    expect(said(table({}, [{}], { phase: 'BETTING', actingSeat: 2 }))).toBe('Waiting for your turn')
    expect(said(table({}, [{}], { phase: 'REVEAL' })), 'between streets, two seats can still act').toBe('Waiting for your turn')
    expect(said(table({}, [{ allIn: true }], { phase: 'BETTING' })), 'a betting phase is never a run-out').toBe('Waiting for your turn')
    expect(said(hand(null, { mySeat: null }))).toBe('Waiting for your turn')
  })

  it('picks its key from the hand and the own seat alone, and the own seat may be missing', () => {
    expect(trayWaitKey(hand(null), undefined)).toBe('labels.waitingForTurn')
    expect(trayWaitKey(hand(null, { phase: 'COMPLETE' }), undefined)).toBe('labels.handOver')
    expect(trayWaitKey(hand(null, { mode: 'blind', phase: 'DECISION' }), undefined)).toBe('labels.waitingForTurn')
    expect(trayWaitKey(hand(null, { mode: 'blind', phase: 'REVEAL' }), undefined)).toBe('labels.waitReveal')
    const folded = seatOf(1, { folded: true })
    expect(trayWaitKey(hand(null, { seats: [folded] }), folded)).toBe('labels.waitFolded')
  })

  it('keeps the pre-action row and the live status region as they were', () => {
    wrap(<ActionBar hand={table({}, [{}], { phase: 'BETTING', actingSeat: 2 })} room={room} onAct={() => {}} lang="en" onPreAction={() => {}} />)
    expect(screen.getByRole('group', { name: 'Before your turn' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for your turn')
  })
})
