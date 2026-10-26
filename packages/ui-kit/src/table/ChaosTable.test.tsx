import { parseCards, type ServerMessage } from '@bp/core'
import { render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import { initialClientState, reduceClient } from '../client/reducer.js'
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
    expect(board).toHaveClass(s.communityAnchor!)
    expect(board).not.toHaveAttribute('data-board') // an empty board: the banner is centred on the ghosts
  })

  it('anchors only a board that carries a banner: a table without chaos lays its board out as before (M4)', () => {
    draw(handOf({ community: parseCards('Ah Kd 2c') }), null)
    const board = screen.getByRole('group', { name: 'Bài chung' })
    expect(board).toHaveClass(s.community!)
    expect(board).not.toHaveClass(s.communityAnchor!)
    expect(board).not.toHaveAttribute('data-board')
  })

  it('moves the banner onto the cards’ feet once board cards are face up, so it hides none of them (I3)', () => {
    draw(handOf({ phase: 'REVEAL', community: parseCards('Ah Kd 2c 7s 9h') }), chaos(), { banner: <p data-testid="banner">cờ</p> })
    expect(screen.getByRole('group', { name: 'Bài chung' })).toHaveAttribute('data-board', 'up')
  })

  it('reads the blindfold from the snapshot when it has one: shown cards then are not "down", and a view that says so is', () => {
    const { unmount } = draw(handOf({}, { holeCards: null }), chaos({ blindfolded: false }))
    expect(screen.queryByText('Bị che mắt')).toBeNull()
    unmount()
    draw(handOf({ restored: true }, { holeCards: null }), chaos({ blindfolded: true }))
    expect(within(seatBox(0)).getByText('Bị che mắt')).toBeInTheDocument()
  })

  it('draws a board a chaos card re-dealt, straight from the reducer (C2)', () => {
    type Msg = ServerMessage
    const feed = (st: typeof initialClientState, msg: Msg) => reduceClient(st, { type: 'server', msg, now: 1 })
    let st = feed(initialClientState, { t: 'WELCOME', playerId: 'a', displayName: 'Ann', balance: 0, serverTime: 0 })
    st = feed(st, { t: 'ROOM_SNAPSHOT', seq: 1, room, hand: null, deadlineAt: null })
    st = feed(st, { t: 'GAME_EVENT', seq: 2, event: { type: 'HAND_STARTED', handId: 'h1', mode: 'blind', button: 0, seats: [0, 2], carryOverIn: 0 } })
    st = feed(st, { t: 'GAME_EVENT', seq: 3, event: { type: 'COMMUNITY_REVEALED', street: 'RIVER', cards: parseCards('2c 3d 4h 5s 7c'), community: parseCards('2c 3d 4h 5s 7c') } })
    st = feed(st, { t: 'GAME_EVENT', seq: 4, event: { type: 'CHAOS_APPLIED', seat: 2, cardId: 'g_redeal_board', effect: 'redealBoard', targets: [], outcome: 'applied', community: parseCards('Ah Kh Qh Jh Th') } })
    draw(st.hand, st.chaos)
    const board = screen.getByRole('group', { name: 'Bài chung' })
    expect([...board.querySelectorAll('[data-card]')].map((c) => c.getAttribute('data-card'))).toEqual(['Ah', 'Kh', 'Qh', 'Jh', 'Th'])
  })

  it('draws a "Mượn lá" card beside the seat’s own at showdown with its tag, gold-edged when it is in the winning five (I4)', () => {
    const [ah, kh, qh, jh, th] = parseCards('Ah Kh Qh Jh Th')
    const done = handOf({
      phase: 'COMPLETE',
      community: [kh!, qh!, jh!, parseCards('2c')[0]!, parseCards('3d')[0]!],
      result: {
        payouts: [{ seat: 2, amount: 6_000 }], pots: [], fee: 0, carryOverOut: 0, uncalledReturned: null, cancelled: false, reason: null,
        showdown: [
          { seat: 2, cards: [th!, parseCards('4s')[0]!, parseCards('5s')[0]!], rank: 9_000_000, category: 9, best: [ah!, kh!, qh!, jh!, th!], borrowed: ah! },
          { seat: 0, cards: parseCards('Qs Qd 7c'), rank: 1, category: 1, best: parseCards('Qs Qd Kh Jh 7c') },
        ],
      },
    })
    const { unmount } = draw(done, chaos())
    const slot = seatBox(2).querySelector('[data-borrowed]')!
    expect(slot).toHaveTextContent('Mượn')
    expect(slot.querySelector('[data-card]')).toHaveAttribute('data-card', 'Ah')
    expect(slot.querySelector(`.${s.cardHi}`)).not.toBeNull()
    expect(seatBox(0).querySelector('[data-borrowed]')).toBeNull()
    unmount()
    draw(done, chaos(), { resultPending: true })
    expect(document.querySelector('[data-borrowed]')).toBeNull() // held back with the rest of the result
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
    expect(/\.communityAnchor\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/position:\s*relative/)
    // a plain table's board is not repositioned (spec §7: a table without chaos is unchanged)
    expect(/\.community\s*\{([^}]*)\}/.exec(css)?.[1]).not.toMatch(/position/)
  })

  it('puts the pill on the cards’ feet, see-through, once board cards are up, and keeps it inside the board on a phone on its side (I3)', async () => {
    const css = (await import('./table.module.css?raw')).default.replace(/\r\n/g, '\n')
    expect(/\.community\[data-board='up'\] \.chaosBannerSlot\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/align-items:\s*flex-end/)
    expect(/\.community\[data-board='up'\] \.chaosBanner\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/rgb\(10 18 32 \/ 0\.7\)/)
    expect(/\.ring\[data-frame='landscape'\] \.community\[data-board='up'\] :is\(\.chaosBanner, \.chaosNote\)\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/transform:\s*none/)
  })
})
