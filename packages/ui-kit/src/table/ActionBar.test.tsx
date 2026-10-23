import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import { parseCards, type LegalActions, type RoomView } from '@bp/core'
import { createI18n } from '../i18n/index.js'
import type { ClientHand, ClientSeat } from '../client/types.js'
import p from '../primitives/primitives.module.css'
import { ActionBar, trayWaitKey } from './ActionBar.js'
import TABLE_CSS from './table.module.css?raw'

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

// Plan 26 (B4): a phone on its side keeps its height for the table. The betting buttons sit in a bottom-right dock and
// the toggles in a bottom-left one; since BP-31 the bet panel (chips and a slider) takes the left corner once Tố is tapped.
describe('ActionBar in the landscape frame', () => {
  const raiseLegal: LegalActions = { seat: 1, kinds: ['fold', 'call', 'raise', 'allIn'], callAmount: 200, minBet: 0, maxBet: 0, minRaiseTo: 400, maxRaiseTo: 5000 }
  const me: ClientSeat = { seat: 1, playerId: 'me', displayName: 'Me', isBot: false, stack: 5000, betThisStreet: 0, folded: false, allIn: false, cardCount: 2, holeCards: null, hasDecided: false, decision: null, lastAction: null, timedOut: false }
  const blindRoom = { config: { mode: 'blind', blind: { fixedWager: 2000, decisionMode: 'playOrFold' } } } as unknown as RoomView
  const wrapVi = (ui: React.ReactElement) =>
    render(<I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>{ui}</I18nextProvider>)

  // BP-31 §3.2–3.3: the right corner keeps one row with one "Tố" button; the panel takes the left corner, and the same
  // button raises with the amount on it while the panel is open.
  it("landscape: the panel replaces the left corner and the right corner's Tố becomes Tố N", async () => {
    const onAct = vi.fn()
    wrapVi(<ActionBar hand={hand(raiseLegal)} room={room} onAct={onAct} lang="vi" frame="landscape" />)
    const tray = screen.getByRole('group', { name: 'Hành động' })
    expect(tray).toHaveAttribute('data-frame', 'landscape')
    expect(tray).toHaveAttribute('data-layout', 'ring')
    expect(tray).toHaveAttribute('data-panel', 'closed')
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.queryByRole('spinbutton'), 'no number field').toBeNull()
    expect(screen.queryByRole('button', { name: 'Tất tay' }), 'all in is a chip of the panel here (R2)').toBeNull()
    const right = tray.querySelector<HTMLElement>('[class*="trayRight"]')!
    const raise = within(right).getByRole('button', { name: 'Tố' })
    expect(raise).toHaveTextContent('Tố▴')

    await userEvent.click(raise)
    expect(onAct, 'the first tap opens the panel; it never raises').not.toHaveBeenCalled()
    expect(tray).toHaveAttribute('data-panel', 'open')
    const left = tray.querySelector<HTMLElement>('[class*="trayLeft"]')!
    const chips = within(left).getByRole('group', { name: 'Mức cược' })
    expect(within(left).getByRole('slider')).toHaveAttribute('aria-valuetext', '400')
    expect(within(left).getByRole('button', { name: 'Hủy' })).toBeInTheDocument()
    expect(within(left).queryByRole('button', { name: /^Tố( |$)/ }), "the confirm is the right corner's").toBeNull()
    // The same button, now carrying the amount; Bỏ bài and Theo stay beside it.
    expect(within(right).getByRole('button', { name: 'Tố 400' })).toBe(raise)
    expect(within(right).getByRole('button', { name: 'Bỏ bài' })).toBeInTheDocument()
    expect(within(right).getByRole('button', { name: 'Theo 200' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Tố( |$)/ })).toHaveLength(1)

    await userEvent.click(within(chips).getByRole('button', { name: 'Pot' }))
    expect(raise).toHaveAccessibleName('Tố 1.000')
    await userEvent.click(raise)
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'raise', amount: 1000 })

    await userEvent.click(within(left).getByRole('button', { name: 'Hủy' }))
    expect(tray).toHaveAttribute('data-panel', 'closed')
    expect(tray.querySelector('[class*="trayLeft"]'), 'the corner is empty on my own turn').toBeNull()
    expect(raise).toHaveAccessibleName('Tố')
    expect(onAct).toHaveBeenCalledTimes(1)
  })

  it('passes compact to the panel on the short tier', async () => {
    const { unmount } = wrap(<ActionBar hand={hand(raiseLegal)} room={room} onAct={() => {}} lang="en" frame="landscape" tier="short" />)
    await userEvent.click(screen.getByRole('button', { name: 'Raise' }))
    expect(screen.getByRole('group', { name: 'Choose the bet' })).toHaveAttribute('data-compact', 'true')
    unmount()
    wrap(<ActionBar hand={hand(raiseLegal)} room={room} onAct={() => {}} lang="en" frame="landscape" />)
    await userEvent.click(screen.getByRole('button', { name: 'Raise' }))
    expect(screen.getByRole('group', { name: 'Choose the bet' })).not.toHaveAttribute('data-compact')
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

})

// BP-31 §3.1–3.2: the bet panel on every frame. Two steps in the stack and in landscape (Tố ▴ opens it), one step on
// the desktop ring (chips and slider always shown); no number field anywhere.
describe('ActionBar sizing and the one-row tray', () => {
  const raiseLegal: LegalActions = { seat: 1, kinds: ['fold', 'call', 'raise', 'allIn'], callAmount: 200, minBet: 0, maxBet: 0, minRaiseTo: 400, maxRaiseTo: 5000 }
  const holdemRoom = { config: { mode: 'holdem', holdem: { smallBlind: 100, bigBlind: 200 }, blind: undefined } } as unknown as RoomView
  const me = (extra: Partial<ClientSeat> = {}): ClientSeat => ({ seat: 1, playerId: 'me', displayName: 'Me', isBot: false, stack: 5000, betThisStreet: 0, folded: false, allIn: false, cardCount: 2, holeCards: null, hasDecided: false, decision: null, lastAction: null, timedOut: false, ...extra })
  const vi18n = () => createI18n({ language: 'vi', storage: null })
  const wrapVi = (ui: React.ReactElement) => render(<I18nextProvider i18n={vi18n()}>{ui}</I18nextProvider>)
  const tray = () => screen.getByRole('group', { name: /^(Actions|Hành động)$/ })
  const chip = (name: string) => within(screen.getByRole('group', { name: /^(Bet size|Mức cược)$/ })).getByRole('button', { name })
  const raises = () => screen.queryAllByRole('button', { name: /^(Tố|Raise)( |$)/ })

  it('stack: Tố opens the panel, Hủy closes it, and there is one Tố button throughout', async () => {
    const onAct = vi.fn()
    wrapVi(<ActionBar hand={hand(raiseLegal)} room={holdemRoom} onAct={onAct} lang="vi" layout="stack" />)
    // One row: Bỏ bài · Theo 200 · Tố ▴. All in is the panel's chip (R2), not a fourth button.
    const row = screen.getByRole('button', { name: 'Bỏ bài' }).parentElement!
    expect(within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Bỏ bài', 'Theo 200', 'Tố▴'])
    expect(screen.queryByRole('button', { name: 'Tất tay' })).toBeNull()
    expect(screen.queryByRole('slider')).toBeNull()
    expect(raises()).toHaveLength(1)
    for (const b of within(row).getAllByRole('button')) expect(b, 'md buttons (44 px) in the stack').toHaveClass(p.md!)

    await userEvent.click(screen.getByRole('button', { name: 'Tố' }))
    expect(onAct).not.toHaveBeenCalled()
    expect(tray()).toHaveAttribute('data-panel', 'open')
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '400')
    expect(screen.getByRole('slider')).toHaveAttribute('step', '1')
    // The row is replaced by the panel: Bỏ bài and Theo go, Hủy ▾ and the confirm come.
    expect(screen.queryByRole('button', { name: 'Bỏ bài' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Theo 200' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Hủy' })).toHaveTextContent('Hủy▾')
    expect(raises().map((b) => b.textContent)).toEqual(['Tố 400'])

    await userEvent.click(chip('Pot'))
    expect(chip('Pot')).toHaveAttribute('aria-pressed', 'true')
    expect(raises().map((b) => b.textContent)).toEqual(['Tố 1.000'])
    await userEvent.click(chip('Tất tay'))
    expect(raises().map((b) => b.textContent)).toEqual(['Tố 5.000'])

    await userEvent.click(screen.getByRole('button', { name: 'Hủy' }))
    expect(tray()).toHaveAttribute('data-panel', 'closed')
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.getByRole('button', { name: 'Bỏ bài' })).toBeInTheDocument()
    expect(raises()).toHaveLength(1)
    expect(onAct).not.toHaveBeenCalled()

    // Reopened, it keeps the amount chosen this turn; the confirm sends it. Escape closes it again.
    await userEvent.click(screen.getByRole('button', { name: 'Tố' }))
    await userEvent.click(screen.getByRole('button', { name: 'Tố 5.000' }))
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'raise', amount: 5000 })
    await userEvent.keyboard('{Escape}')
    expect(tray()).toHaveAttribute('data-panel', 'closed')
  })

  it('stack: a bet reads Cược ▴ and Cược N', async () => {
    const onAct = vi.fn()
    const betLegal: LegalActions = { seat: 1, kinds: ['fold', 'check', 'bet', 'allIn'], callAmount: 0, minBet: 200, maxBet: 5000, minRaiseTo: 0, maxRaiseTo: 0 }
    wrapVi(<ActionBar hand={hand(betLegal)} room={holdemRoom} onAct={onAct} lang="vi" layout="stack" />)
    expect(screen.getByRole('button', { name: 'Xem' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cược' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cược 200' }))
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'bet', amount: 200 })
  })

  it('ring desktop: chips and slider are always shown and Enter sends the clamped total', async () => {
    const onAct = vi.fn()
    // a pot of 20.000: ½ pot (10.000) and Pot clamp to the 5.000 the seat may raise to
    wrap(<ActionBar hand={hand(raiseLegal, { pot: 20_000 })} room={holdemRoom} onAct={onAct} lang="en" />)
    expect(tray()).toHaveAttribute('data-layout', 'ring')
    const range = screen.getByRole('slider', { name: 'Amount slider' })
    expect(range).toHaveAttribute('min', '400')
    expect(range).toHaveAttribute('max', '5000')
    expect(range).toHaveAttribute('aria-valuetext', '400')
    expect(screen.queryByRole('button', { name: 'Cancel' }), 'one step: no Hủy').toBeNull()
    // Two buttons named All-in on the ring: the chip, and the action outside the row's raise (R4).
    expect(screen.getAllByRole('button', { name: 'All-in' })).toHaveLength(2)
    expect(raises().map((b) => b.textContent)).toEqual(['Raise 400'])
    for (const b of [screen.getByRole('button', { name: 'Fold' }), raises()[0]!]) expect(b, 'lg buttons on the ring').toHaveClass(p.lg!)

    await userEvent.click(chip('½ pot'))
    expect(range).toHaveAttribute('aria-valuetext', '5,000')
    // ½ pot, Pot and All-in all name 5.000: only the first of them lights
    expect(chip('½ pot')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Pot')).toHaveAttribute('aria-pressed', 'false')
    expect(chip('All-in')).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(chip('Min'))
    range.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    expect(range).toHaveAttribute('aria-valuetext', '600')
    await userEvent.keyboard('{Enter}')
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'raise', amount: 600 })
    expect(onAct).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{End}{Enter}')
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'raise', amount: 5000 })
    expect(onAct).toHaveBeenCalledTimes(2)

    // R focuses the slider on the ring.
    range.blur()
    await userEvent.keyboard('r')
    expect(range).toHaveFocus()
  })

  it('new legal bounds re-clamp the open panel', async () => {
    const view = wrap(<ActionBar hand={hand(raiseLegal)} room={holdemRoom} onAct={() => {}} lang="en" layout="stack" />)
    await userEvent.click(screen.getByRole('button', { name: 'Raise' }))
    const range = screen.getByRole('slider')
    range.focus()
    await userEvent.keyboard('{End}')
    expect(range).toHaveAttribute('aria-valuetext', '5,000')
    const again = (legal: LegalActions) =>
      view.rerender(
        <I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>
          <ActionBar hand={hand(legal)} room={holdemRoom} onAct={() => {}} lang="en" layout="stack" />
        </I18nextProvider>,
      )
    // a bot acted, or a reconnect brought a smaller stack: the open panel stays open and follows
    again({ ...raiseLegal, maxRaiseTo: 3000 })
    expect(tray()).toHaveAttribute('data-panel', 'open')
    expect(screen.getByRole('slider')).toHaveAttribute('max', '3000')
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '3,000')
    expect(raises().map((b) => b.textContent)).toEqual(['Raise 3,000'])
    again({ ...raiseLegal, minRaiseTo: 3500, maxRaiseTo: 6000 })
    expect(tray()).toHaveAttribute('data-panel', 'open')
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '3,500')
    expect(raises().map((b) => b.textContent)).toEqual(['Raise 3,500'])
  })

  it('a new street with the same seat to act starts at the minimum with the panel shut', async () => {
    // Heads-up, the big blind checks the flop round closed and acts first again on the turn: same hand, still my turn
    // across the re-render, but a new street — the raise chosen on the old one must not carry over.
    const view = wrap(<ActionBar hand={hand(raiseLegal)} room={holdemRoom} onAct={() => {}} lang="en" layout="stack" />)
    await userEvent.click(screen.getByRole('button', { name: 'Raise' }))
    screen.getByRole('slider').focus()
    await userEvent.keyboard('{End}')
    expect(raises().map((b) => b.textContent)).toEqual(['Raise 5,000'])
    const flop = parseCards('Ah Kd 7c')
    view.rerender(
      <I18nextProvider i18n={createI18n({ language: 'en', storage: null })}>
        <ActionBar hand={hand(raiseLegal, { community: flop })} room={holdemRoom} onAct={() => {}} lang="en" layout="stack" />
      </I18nextProvider>,
    )
    expect(tray()).toHaveAttribute('data-panel', 'closed')
    await userEvent.click(screen.getByRole('button', { name: 'Raise' }))
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '400')
    expect(raises().map((b) => b.textContent)).toEqual(['Raise 400'])
  })

  it('the focused Tố ▴ opened with Enter puts focus on the slider', async () => {
    // The stack's row unmounts under the panel, so the focus must move on, not fall to the page.
    const first = wrapVi(<ActionBar hand={hand(raiseLegal)} room={holdemRoom} onAct={() => {}} lang="vi" layout="stack" />)
    screen.getByRole('button', { name: 'Tố' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(tray()).toHaveAttribute('data-panel', 'open')
    expect(screen.getByRole('slider')).toHaveFocus()
    first.unmount()

    // Landscape keeps the button (it becomes "Tố N"): the keyboard still lands on the slider; a tap leaves the focus be.
    const second = wrapVi(<ActionBar hand={hand(raiseLegal)} room={holdemRoom} onAct={() => {}} lang="vi" frame="landscape" />)
    screen.getByRole('button', { name: 'Tố' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('slider')).toHaveFocus()
    second.unmount()
    wrapVi(<ActionBar hand={hand(raiseLegal)} room={holdemRoom} onAct={() => {}} lang="vi" frame="landscape" />)
    await userEvent.click(screen.getByRole('button', { name: 'Tố' }))
    expect(screen.getByRole('slider')).not.toHaveFocus()
  })

  it('in the stack between hands only Tự động chơi remains in the tray', () => {
    // R13: the room's dock holds Sẵn sàng / Bắt đầu; the tray keeps its "Hành động" group and, where offered, the toggle.
    const blindRoom = { config: { mode: 'blind', blind: { fixedWager: 2000, decisionMode: 'playOrFold' } } } as unknown as RoomView
    const over = hand(null, { mode: 'blind', phase: 'COMPLETE', seats: [me()] })
    const first = wrapVi(<ActionBar hand={over} room={blindRoom} onAct={() => {}} lang="vi" layout="stack" betweenHands autoPlay onAutoPlay={() => {}} />)
    expect(tray()).toHaveAttribute('data-between', 'true')
    expect(within(tray()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Tự động chơi'])
    expect(within(tray()).queryByRole('status'), 'no "hand over" line beside the dock').toBeNull()
    first.unmount()

    // Hold'em has no toggle to keep: the group stays, empty, and draws nothing (CSS on `data-between`).
    const second = wrap(<ActionBar hand={hand(null, { phase: 'COMPLETE', seats: [me()] })} room={holdemRoom} onAct={() => {}} lang="en" layout="stack" betweenHands preAction={null} onPreAction={() => {}} />)
    expect(tray()).toBeEmptyDOMElement()
    second.unmount()

    // A stale legal set between hands never opens a panel or offers a row.
    wrap(<ActionBar hand={hand(raiseLegal)} room={holdemRoom} onAct={() => {}} lang="en" layout="stack" betweenHands />)
    expect(tray()).toBeEmptyDOMElement()
    expect(tray()).toHaveAttribute('data-panel', 'closed')
    expect(TABLE_CSS).toMatch(/\.tray\[data-layout='stack'\]\[data-between\]\s*\{[^}]*padding:\s*0/)
  })

  it('with no sizing the row offers Tất tay and no panel', async () => {
    const onAct = vi.fn()
    wrapVi(
      <ActionBar
        hand={hand({ seat: 1, kinds: ['fold', 'call', 'allIn'], callAmount: 300, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 })}
        room={holdemRoom}
        onAct={onAct}
        lang="vi"
        layout="stack"
      />,
    )
    const row = screen.getByRole('button', { name: 'Bỏ bài' }).parentElement!
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Bỏ bài', 'Theo 300', 'Tất tay'])
    expect(screen.queryByRole('slider')).toBeNull()
    expect(raises()).toHaveLength(0)
    expect(tray()).toHaveAttribute('data-panel', 'closed')
    await userEvent.keyboard('{Enter}')
    expect(onAct).not.toHaveBeenCalled()
    expect(screen.queryByRole('slider')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Tất tay' }))
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'allIn' })
  })

  it('Blind: Tự động chơi, Bỏ bài, Chơi N in one row in stack; the ring keeps its two rows', () => {
    const blindRoom = { config: { mode: 'blind', blind: { fixedWager: 2000, decisionMode: 'playOrFold' } } } as unknown as RoomView
    const deciding = hand({ seat: 1, kinds: ['play', 'fold'], callAmount: 2000, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 }, { mode: 'blind', phase: 'DECISION', seats: [me()] })
    const first = wrapVi(<ActionBar hand={deciding} room={blindRoom} onAct={() => {}} lang="vi" layout="stack" autoPlay={false} onAutoPlay={() => {}} />)
    const toggle = screen.getByRole('button', { name: 'Tự động chơi' })
    const row = toggle.parentElement!
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Tự động chơi', 'Bỏ bài', 'Chơi 2.000'])
    expect(screen.getAllByRole('button', { name: 'Tự động chơi' })).toHaveLength(1)
    first.unmount()

    // Between decisions: the toggle and the wait line share the row.
    const decided = hand(null, { mode: 'blind', phase: 'DECISION', seats: [me({ hasDecided: true })] })
    const second = wrapVi(<ActionBar hand={decided} room={blindRoom} onAct={() => {}} lang="vi" layout="stack" autoPlay onAutoPlay={() => {}} />)
    expect(screen.getByRole('status').parentElement).toBe(screen.getByRole('button', { name: 'Tự động chơi' }).parentElement)
    expect(screen.getByRole('status')).toHaveTextContent('Đã chọn')
    second.unmount()

    // The ring: the play row, and the toggle in a row of its own.
    wrapVi(<ActionBar hand={deciding} room={blindRoom} onAct={() => {}} lang="vi" autoPlay={false} onAutoPlay={() => {}} />)
    expect(screen.getAllByRole('button', { name: 'Tự động chơi' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Tự động chơi' }).parentElement).not.toBe(screen.getByRole('button', { name: 'Bỏ bài' }).parentElement)
  })

  it('between turns in stack the toggles replace the row, and the wait line shows only when there are none', () => {
    const between = hand(null, { actingSeat: 0, seats: [me()] })
    const first = wrap(<ActionBar hand={between} room={holdemRoom} onAct={() => {}} lang="en" layout="stack" preAction={null} onPreAction={() => {}} />)
    expect(screen.getByRole('group', { name: 'Before your turn' })).toBeInTheDocument()
    expect(screen.queryByRole('status'), 'the toggles take the row').toBeNull()
    first.unmount()
    // Folded: no toggles, so the line says what the seat waits for.
    const second = wrap(<ActionBar hand={hand(null, { actingSeat: 0, seats: [me({ folded: true })] })} room={holdemRoom} onAct={() => {}} lang="en" layout="stack" preAction={null} onPreAction={() => {}} />)
    expect(screen.queryByRole('group', { name: 'Before your turn' })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('You folded')
    second.unmount()
    // The ring keeps the line above the toggles (P11).
    wrap(<ActionBar hand={between} room={holdemRoom} onAct={() => {}} lang="en" preAction={null} onPreAction={() => {}} />)
    expect(screen.getByRole('group', { name: 'Before your turn' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for your turn')
  })

  it('no spinbutton anywhere in ActionBar', async () => {
    for (const props of [{}, { layout: 'stack' as const }, { frame: 'landscape' as const }]) {
      const { unmount } = wrap(<ActionBar hand={hand(raiseLegal)} room={holdemRoom} onAct={() => {}} lang="en" {...props} />)
      expect(screen.queryByRole('spinbutton')).toBeNull()
      const open = screen.queryByRole('button', { name: 'Raise' })
      if (open !== null) await userEvent.click(open)
      expect(screen.getByRole('slider')).toBeInTheDocument()
      expect(screen.queryByRole('spinbutton')).toBeNull()
      expect(screen.queryByRole('dialog')).toBeNull()
      unmount()
    }
  })

  it('Enter with the panel closed opens it in stack and never raises', async () => {
    const onAct = vi.fn()
    const first = wrap(<ActionBar hand={hand(raiseLegal)} room={holdemRoom} onAct={onAct} lang="en" layout="stack" />)
    await userEvent.keyboard('{Enter}')
    expect(onAct).not.toHaveBeenCalled()
    expect(tray()).toHaveAttribute('data-panel', 'open')
    expect(screen.getByRole('slider'), 'the keyboard lands on the slider').toHaveFocus()
    await userEvent.keyboard('{ArrowRight}{Enter}')
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'raise', amount: 500 })
    expect(onAct, 'one raise, not one from the slider and one from the tray').toHaveBeenCalledTimes(1)
    first.unmount()

    // Landscape alike: the first Enter opens the corner, the second raises from the right corner's button.
    onAct.mockClear()
    wrap(<ActionBar hand={hand(raiseLegal)} room={holdemRoom} onAct={onAct} lang="en" frame="landscape" />)
    await userEvent.keyboard('{Enter}')
    expect(onAct).not.toHaveBeenCalled()
    expect(screen.getByRole('slider')).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onAct).toHaveBeenLastCalledWith({ kind: 'raise', amount: 400 })
    expect(onAct).toHaveBeenCalledTimes(1)
  })

  it('Space on the focused Tố ▴ opens the panel and puts focus on the slider', async () => {
    const onAct = vi.fn()
    wrapVi(<ActionBar hand={hand(raiseLegal)} room={holdemRoom} onAct={onAct} lang="vi" layout="stack" />)
    screen.getByRole('button', { name: 'Tố' }).focus()
    await userEvent.keyboard(' ')
    expect(tray()).toHaveAttribute('data-panel', 'open')
    expect(screen.getByRole('slider')).toHaveFocus()
    expect(onAct).not.toHaveBeenCalled()
  })

  it('R opens the panel in stack and landscape and focuses the slider', async () => {
    for (const props of [{ layout: 'stack' as const }, { frame: 'landscape' as const }]) {
      const onAct = vi.fn()
      const { unmount } = wrap(<ActionBar hand={hand(raiseLegal)} room={holdemRoom} onAct={onAct} lang="en" {...props} />)
      await userEvent.keyboard('r')
      expect(tray()).toHaveAttribute('data-panel', 'open')
      expect(screen.getByRole('slider')).toHaveFocus()
      await userEvent.keyboard('{Escape}')
      expect(tray()).toHaveAttribute('data-panel', 'closed')
      expect(screen.getByRole('button', { name: 'Raise' }), 'the focus goes back to the button that opens it').toHaveFocus()
      expect(onAct).not.toHaveBeenCalled()
      unmount()
    }
  })

  it('Enter on a focused button activates that button, never the raise', async () => {
    const onAct = vi.fn()
    const first = wrap(<ActionBar hand={hand(raiseLegal)} room={holdemRoom} onAct={onAct} lang="en" />)
    screen.getByRole('button', { name: 'Fold' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(onAct.mock.calls).toEqual([[{ kind: 'fold' }]])
    onAct.mockClear()
    chip('Pot').focus()
    await userEvent.keyboard('{Enter}')
    expect(onAct, 'a chip sets the amount; it does not raise').not.toHaveBeenCalled()
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '1,000')
    first.unmount()

    // In the stack's open panel, Enter on Hủy cancels.
    wrap(<ActionBar hand={hand(raiseLegal)} room={holdemRoom} onAct={onAct} lang="en" layout="stack" />)
    await userEvent.click(screen.getByRole('button', { name: 'Raise' }))
    screen.getByRole('button', { name: 'Cancel' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(onAct).not.toHaveBeenCalled()
    expect(tray()).toHaveAttribute('data-panel', 'closed')
  })

  it('data-layout and data-panel on the tray root', async () => {
    const cases: { props: Record<string, string>; layout: string }[] = [
      { props: {}, layout: 'ring' },
      { props: { layout: 'stack' }, layout: 'stack' },
      { props: { frame: 'landscape' }, layout: 'ring' },
      { props: { frame: 'landscape', layout: 'stack' }, layout: 'ring' },
    ]
    for (const { props, layout } of cases) {
      const { unmount } = wrap(<ActionBar hand={hand(null)} room={holdemRoom} onAct={() => {}} lang="en" {...props} />)
      expect(tray(), JSON.stringify(props)).toHaveAttribute('data-layout', layout)
      expect(tray()).toHaveAttribute('data-panel', 'closed')
      unmount()
    }
    // The ring's inline panel is there whenever sizing is offered: open.
    wrap(<ActionBar hand={hand(raiseLegal)} room={holdemRoom} onAct={() => {}} lang="en" />)
    expect(tray()).toHaveAttribute('data-panel', 'open')
  })

  it('the phone width no longer hides the slider, and the number field and the dialog are gone from the CSS', () => {
    expect(TABLE_CSS).not.toMatch(/\.slider\s*\{\s*display:\s*none/)
    expect(TABLE_CSS).not.toMatch(/\.amount\s*\{/)
    expect(TABLE_CSS).not.toMatch(/\.amountField\b/)
    expect(TABLE_CSS).toMatch(/\.tray\[data-layout='stack'\]\s*\{[^}]*padding:\s*var\(--space-2\) var\(--space-3\)/)
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
