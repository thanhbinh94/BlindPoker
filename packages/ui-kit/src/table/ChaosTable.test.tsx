import { parseCards } from '@bp/core'
import { render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import { initialChaos, type ClientChaos, type ClientHand } from '../client/types.js'
import { createI18n } from '../i18n/index.js'
import { makeHand, makePlayer, makeRoom, makeSeat } from '../test-fixtures.js'
import { PokerTable } from './PokerTable.js'
import s from './table.module.css'

// A play-or-fold Blind table on the 5-hand chaos cycle: Ann (me, seat 0) and Bob, three cards each.
const room = makeRoom({
  mode: 'blind',
  config: {
    name: 'T',
    mode: 'blind',
    maxPlayers: 4,
    isPrivate: false,
    turnTimerSec: 20,
    autoStart: false,
    hasPassword: false,
    blind: { holeCards: 3, decisionMode: 'playOrFold', fixedWager: 1_000, botCount: 0, chaosCycle: 5 },
  },
  players: [
    makePlayer({ playerId: 'a', displayName: 'Ann', isHost: true, seat: 0, status: 'IN_HAND', stack: 20_000 }),
    makePlayer({ playerId: 'b', displayName: 'Bob', seat: 2, status: 'IN_HAND', stack: 20_000 }),
  ],
})

const handOf = (patch: Partial<ClientHand> = {}, mine: Parameters<typeof makeSeat>[0] extends infer P ? Partial<P> : never = {}): ClientHand =>
  makeHand({
    mode: 'blind',
    phase: 'DECISION',
    community: [],
    actingSeat: null,
    seats: [
      makeSeat({ seat: 0, playerId: 'a', displayName: 'Ann', cardCount: 3, holeCards: parseCards('Qs Qd 7c'), ...mine }),
      makeSeat({ seat: 2, playerId: 'b', displayName: 'Bob', cardCount: 3 }),
    ],
    ...patch,
  })

const chaos = (patch: Partial<ClientChaos> = {}): ClientChaos => ({ ...initialChaos, ...patch })

const draw = (hand: ClientHand | null, c: ClientChaos | null, extra: Partial<Parameters<typeof PokerTable>[0]> = {}) =>
  render(
    <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
      <PokerTable room={room} hand={hand} myPlayerId="a" deadlineAt={null} serverNow={() => 0} turnTimerMs={20_000} lang="vi" canSit={false} chaos={c} {...extra} />
    </I18nextProvider>,
  )

const seatBox = (n: number): HTMLElement => document.querySelector<HTMLElement>(`[data-seat="${n}"]`)!

describe('PokerTable on a Poker hỗn loạn table', () => {
  it('draws each seat’s cards as icons from the chaos state', () => {
    draw(
      handOf(),
      chaos({
        seats: {
          0: { cards: [{ uid: 1, cardId: 's_shield', tier: 'silver', handsLeft: null }], points: 3 },
          2: { cards: [{ uid: 2, cardId: 'g_swap_all', tier: 'gold', handsLeft: null }, { uid: 3, cardId: 'd_mirror', tier: 'diamond', handsLeft: 2 }], points: 0 },
        },
      }),
    )
    expect(within(seatBox(0)).getAllByRole('img', { name: /Khiên gỗ/ })).toHaveLength(1)
    expect([...seatBox(2).querySelectorAll('[data-chaos-cards] [data-tier]')].map((i) => i.getAttribute('data-tier'))).toEqual(['gold', 'diamond'])
  })

  it('draws a table without chaos state exactly as before: no icons, no banner slot', () => {
    draw(handOf(), null)
    expect(document.querySelector('[data-chaos-cards]')).toBeNull()
    expect(document.querySelector(`.${s.chaosBannerSlot}`)).toBeNull()
  })

  it('lays the peeked cards face up in the first empty board slots, with a "Nhìn trộm" tag over the first', () => {
    draw(handOf(), chaos({ peek: { seat: 0, cards: parseCards('Ah Kd') } }))
    const board = screen.getByRole('group', { name: 'Bài chung' })
    const peeked = board.querySelectorAll('[data-peek]')
    expect(peeked).toHaveLength(2)
    expect(peeked[0]).toHaveTextContent('Nhìn trộm')
    expect(peeked[1]).not.toHaveTextContent('Nhìn trộm')
    // the other three slots are still ghosts, and the board is still five wide
    expect(board.children).toHaveLength(5)
  })

  it('puts the peek away once any of those cards is on the board', () => {
    draw(handOf({ phase: 'BETTING', community: parseCards('Ah Kd 2c') }), chaos({ peek: { seat: 0, cards: parseCards('Ah Kd') } }))
    expect(document.querySelector('[data-peek]')).toBeNull()
  })

  it('tells the viewer their cards are down under a blindfold, with a back for each, and tells no one else', () => {
    draw(handOf({}, { holeCards: null }), chaos())
    expect(within(seatBox(0)).getByText('Bị che mắt')).toBeInTheDocument()
    expect(seatBox(0).querySelectorAll(`.${s.cardDown}`)).toHaveLength(3)
    expect(within(seatBox(2)).queryByText('Bị che mắt')).toBeNull()
  })

  it('does not call a hand that is over, or a table without chaos, blindfolded', () => {
    const { unmount } = draw(handOf({ phase: 'COMPLETE' }, { holeCards: null }), chaos())
    expect(screen.queryByText('Bị che mắt')).toBeNull()
    unmount()
    render(
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <PokerTable
          room={makeRoom({ ...room, config: { ...room.config, blind: { ...room.config.blind!, chaosCycle: undefined } } })}
          hand={handOf({}, { holeCards: null })}
          myPlayerId="a"
          deadlineAt={null}
          serverNow={() => 0}
          turnTimerMs={20_000}
          lang="vi"
          canSit={false}
          chaos={chaos()}
        />
      </I18nextProvider>,
    )
    expect(screen.queryByText('Bị che mắt')).toBeNull()
  })

  it('shouts the winner’s Bạo kích, and holds it back while the result is pending', () => {
    const done = handOf({
      phase: 'COMPLETE',
      result: { payouts: [{ seat: 2, amount: 6_000 }], pots: [], fee: 0, showdown: null, carryOverOut: 0, uncalledReturned: null, cancelled: false, reason: null },
    })
    const credits = chaos({ credits: [{ seat: 2, amount: 3_000, reason: 'chaos_crit', capped: false, multiplier: 3 }] })
    const { unmount } = draw(done, credits)
    expect(within(seatBox(2)).getByText('Bạo kích ×3!')).toBeInTheDocument()
    unmount()
    draw(done, credits, { resultPending: true })
    expect(screen.queryByText(/Bạo kích/)).toBeNull()
  })

  it('carries the banner inside the board’s own box, so it is centred on the board wherever the layout puts it', () => {
    draw(handOf(), chaos(), { banner: <p data-testid="banner">cờ</p> })
    const board = screen.getByRole('group', { name: 'Bài chung' })
    expect(screen.getByTestId('banner').parentElement).toBe(board)
    expect(board).toHaveClass(s.community!)
  })
})

describe('PokerTable on a crowded Poker hỗn loạn phone table', () => {
  const nine = makeRoom({
    ...room,
    maxPlayers: 9,
    playerCount: 9,
    players: Array.from({ length: 9 }, (_, seat) => makePlayer({ playerId: seat === 0 ? 'a' : `p${seat}`, displayName: seat === 0 ? 'Ann' : `P${seat}`, seat, status: 'IN_HAND', stack: 20_000 })),
  })
  const held = { cards: [1, 2, 3].map((uid) => ({ uid, cardId: 's_shield', tier: 'silver' as const, handsLeft: null })), points: 0 }
  const drawNine = (layout: 'stack' | 'ring') =>
    render(
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <PokerTable room={nine} hand={null} myPlayerId="a" deadlineAt={null} serverNow={() => 0} turnTimerMs={20_000} lang="vi" canSit={false} layout={layout} chaos={chaos({ seats: { 0: held, 3: held } })} />
      </I18nextProvider>,
    )

  it('gives an opponent’s chip one icon with the count, and the viewer’s strip the full row', () => {
    drawNine('stack')
    expect(seatBox(3).querySelectorAll('[data-chaos-cards] [role="img"]')).toHaveLength(1)
    expect(seatBox(3).querySelector('[data-chaos-cards] [role="img"]')).toHaveTextContent('3')
    expect(seatBox(0).querySelectorAll('[data-chaos-cards] [role="img"]')).toHaveLength(3)
  })

  it('draws the full row on the ring, however many seats there are', () => {
    drawNine('ring')
    expect(seatBox(3).querySelectorAll('[data-chaos-cards] [role="img"]')).toHaveLength(3)
  })
})

describe('the chaos banner’s slot in the stylesheet', () => {
  it('fills the board’s box and takes no room, and the board is its anchor', async () => {
    const css = (await import('./table.module.css?raw')).default.replace(/\r\n/g, '\n')
    const slot = /\.chaosBannerSlot\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(slot).toMatch(/position:\s*absolute/)
    expect(slot).toMatch(/inset:\s*0/)
    expect(slot).toMatch(/pointer-events:\s*none/)
    expect(/\.community\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/position:\s*relative/)
  })
})
