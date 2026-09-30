import { render, screen } from '@testing-library/react'
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
    await userEvent.click(screen.getByRole('button', { name: /pot/i }))
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
